'use strict';
// Интерфейс дивизий и фронтов: панели дивизии и армии, вкладка «Армии» державы, редактор шаблонов,
// кнопки формирования в городе, инструменты «Выделить рамкой» и «Нарисовать линию фронта», слой фронтов на карте.
// Логика — в js/fronts.js. Здесь только браузер: в Node ничего из этого не вызывается.

const FrontsUI = {
  multi: [],          // id выбранных дивизий (рамка, Shift+щелчок, галочки)
  pick: null,         // 'group' | 'front' — открыт выбор армии или фронта для выбранных дивизий
  tplEdit: null,      // редактор шаблона { id, name, units }
  nbKey: '', nb: [],  // соседи по границе (кэш до смены земель)
  drag: null,         // рамка или линия, которую сейчас ведёт палец
  lineFor: [],        // дивизии, которые встанут на только что нарисованную линию

  // ---------- выбор ----------
  selected(ui) {
    const g = ui.g, s = ui.sel, pl = g.player;
    if (!s) return [];
    if (s.kind === 'army') { const a = g.army(s.id); return a && a.owner === pl.id ? [a] : []; }
    if (s.kind === 'group') return Fronts.members(g, s.id).filter(a => a.owner === pl.id);
    if (s.kind === 'multi') return this.multi.map(id => g.army(id)).filter(a => a && a.owner === pl.id);
    return [];
  },
  // Что подсвечивать на карте: id выбранных дивизий.
  hl(ui) {
    const s = ui.sel;
    if (!s || !ui.g || (s.kind !== 'group' && s.kind !== 'multi')) return null;
    return new Set(this.selected(ui).map(a => a.id));
  },
  setMulti(ui, ids) {
    this.multi = ids.slice();
    this.pick = null;
    if (ids.length > 1) ui.select({ kind: 'multi' });
    else if (ids.length === 1) ui.select({ kind: 'army', id: ids[0] });
    else ui.select(null);
  },
  // Shift+щелчок: добавить дивизию в выделение или убрать.
  toggle(ui, a) {
    let ids = this.selected(ui).map(x => x.id);
    const i = ids.indexOf(a.id);
    if (i >= 0) ids.splice(i, 1); else ids.push(a.id);
    this.setMulti(ui, ids);
  },
  reset() { this.pick = null; },

  // ---------- общие кусочки разметки ----------
  esc(s) { return escapeHtml(s); },
  orgCls(v) { return v < 30 ? 'low' : v < 60 ? 'mid' : 'ok'; },
  bar(label, v, cls, text) {
    const p = Math.max(0, Math.min(100, v));
    return `<div class="dbar"><span>${label}</span><b>${text === undefined ? Math.round(p) + '%' : text}</b><div class="progress ${cls}"><i style="width:${p.toFixed(0)}%"></i></div></div>`;
  },
  status(ui, a) {
    const g = ui.g;
    let s = ui.armyStatus(a);
    if (s === 'стоит') {
      const fr = Fronts.front(g, a.front);
      s = fr ? 'держит ' + (fr.kind === 'border' ? 'границу' : 'линию') : a.entrench > 0.6 ? 'окопалась' : a.entrench > 0.05 ? 'окапывается' : 'стоит';
    }
    return s;
  },
  gdot(grp) { return grp ? `<span class="gdot" style="background:${grp.color}"></span>` : ''; },
  // Строка дивизии в списках: значок шаблона, имя, численность, полоска org.
  divRow(ui, a, opt) {
    const g = ui.g, k = g.kingdom(a.owner), org = a.org === undefined ? 100 : a.org;
    const x = opt && opt.check ? `<button type="button" class="chk${opt.on ? ' on' : ''}" data-act="msel" data-id="${a.id}" aria-label="Выбрать">${opt.on ? Icons.svg('check') : ''}</button>` : '';
    return `<div class="drow" data-act="selarmy" data-id="${a.id}">${x}<span class="dic" style="background:${k.color}">${Icons.svg(Fronts.icon(g, a))}</span>` +
      `<span class="dn"><b>${this.esc(a.name || 'Дивизия')}</b><small>${this.status(ui, a)} · ${menCount(a.units)} чел.</small></span>` +
      `<span class="dorg" title="Организованность ${Math.round(org)}%"><i class="${this.orgCls(org)}" style="width:${Math.round(org)}%"></i></span></div>`;
  },
  avgOrg(divs) {
    let s = 0, m = 0;
    for (const a of divs) { const n = menCount(a.units); s += (a.org === undefined ? 100 : a.org) * n; m += n; }
    return m ? s / m : 0;
  },

  // ---------- панель дивизии ----------
  divHtml(ui, a) {
    const g = ui.g, k = g.kingdom(a.owner), mine = k.isPlayer, seen = mine || g.isVisible(a.x, a.y);
    const t = Fronts.tpl(g, a.owner, a.tpl), grp = Fronts.group(g, a.group), fr = Fronts.front(g, a.front);
    const men = menCount(a.units), full = t ? menCount(t.units) : men;
    let h = `<div class="p-head">${Icons.crest(k, 40)}<div><h2>${this.esc(a.name || 'Дивизия')}</h2><div class="sub">${this.esc(k.name)} · ${this.esc(Fronts.tplName(g, a))}</div></div></div>`;
    h += `<div class="p-stats"><span title="Воинов">${Icons.svg('people')}<b>${fmtInt(men)}</b>${t && men < full ? '<span class="muted">из ' + full + '</span>' : ''}</span>` +
      `<span title="Сила">${Icons.svg('swords')}<b>${Math.round(Fronts.power(a))}</b></span>` +
      `<span title="Скорость">${Icons.svg('flag')}${g.armySpeed(a).toFixed(2)} кл/с</span></div>`;
    h += `<div class="dstate">${this.gdot(grp)}<b>${this.status(ui, a)}</b>` +
      (grp ? ` · <span>${this.esc(grp.name)}</span>` : '') + (fr ? ` · <span class="fr">${this.esc(fr.name)}${fr.mode === 'attack' ? ' (наступление)' : ''}</span>` : '') + '</div>';
    const org = a.org === undefined ? 100 : a.org;
    h += '<div class="dbars">' + this.bar('Организованность', org, 'org ' + this.orgCls(org)) +
      this.bar('Опыт', a.xp || 0, 'xp', Math.round((a.xp || 0) / DIV.xpMax * DIV.xpAtk * 100) > 0 ? '+' + Math.round((a.xp || 0) / DIV.xpMax * DIV.xpAtk * 100) + '% к урону' : 'новобранцы') +
      this.bar('Окапывание', (a.entrench || 0) * 100, 'dig', (a.entrench || 0) > 0.02 ? '+' + Math.round(a.entrench * DIV.digDef * 100) + '% к защите' : 'нет') + '</div>';
    h += seen ? ui.unitsHtml(a.units) : '<span class="tip">Состав неизвестен</span>';
    if (mine) {
      h += `<div class="btnrow"><button class="act" type="button" data-act="stop">Стоп</button>` +
        `<button class="act ghost" type="button" data-act="hold">${fr ? 'Оборона фронта' : 'Окопаться'}</button>` +
        `<button class="act ghost" type="button" data-act="home">Домой</button></div>`;
      h += `<div class="btnrow"><button class="act ghost${this.pick === 'group' ? ' on' : ''}" type="button" data-act="dpick" data-v="group">${grp ? 'Армия…' : 'В армию…'}</button>` +
        `<button class="act ghost${this.pick === 'front' ? ' on' : ''}" type="button" data-act="dpick" data-v="front">${fr ? 'Фронт…' : 'На фронт…'}</button>` +
        `<button class="act ghost" type="button" data-act="split">Разделить</button><button class="act ghost" type="button" data-act="merge">Слить</button></div>`;
      if (this.pick) h += this.pickHtml(ui, [a]);
      h += '<p class="tip">Коснитесь земли, чтобы идти; чужого города — осада; своего — войти в гарнизон; врага — атака. Shift+щелчок или «Выделить рамкой» — собрать несколько дивизий в армию.</p>';
    } else if (a.isBandit) h += '<p class="tip">Разбойники грабят города и уходят. За их разгром дают добычу.</p>';
    return h;
  },
  // Выбор армии или фронта для дивизий divs.
  pickHtml(ui, divs) {
    const g = ui.g, pl = g.player;
    let h = `<div class="box pick" data-key="pick-${this.pick}">`;
    if (this.pick === 'group') {
      h += '<div class="box-h"><h4>В какую армию?</h4></div><div class="btnrow">';
      for (const gr of Fronts.groupsOf(g, pl.id)) h += `<button class="act ghost" type="button" data-act="dgroup" data-g="${gr.id}">${this.gdot(gr)}${this.esc(gr.name)}</button>`;
      h += `<button class="act" type="button" data-act="dgroup" data-g="new">${Icons.svg('plus')}Новая армия</button>`;
      if (divs.some(d => d.group !== null && d.group !== undefined)) h += '<button class="act ghost" type="button" data-act="dgroup" data-g="leave">Выйти из армии</button>';
    } else {
      h += '<div class="box-h"><h4>На какой фронт?</h4></div><div class="btnrow">';
      for (const f of Fronts.frontsOf(g, pl.id)) h += `<button class="act ghost" type="button" data-act="dfront" data-f="${f.id}">${this.esc(f.name)}</button>`;
      for (const e of this.neighbors(g)) {
        if (Fronts.frontsOf(g, pl.id).some(f => f.kind === 'border' && f.enemy === e)) continue;
        h += `<button class="act" type="button" data-act="dfront" data-f="b" data-e="${e}">${Icons.svg('plus')}Фронт: ${this.esc(Fronts.enemyName(g, e))}</button>`;
      }
      h += `<button class="act" type="button" data-act="dfront" data-f="line">${Icons.svg('flag')}Нарисовать линию</button>`;
      if (divs.some(d => d.front !== null && d.front !== undefined)) h += '<button class="act ghost" type="button" data-act="dfront" data-f="leave">Снять с фронта</button>';
    }
    return h + '</div></div>';
  },
  neighbors(g) {
    const key = g.territoryVersion + ':' + g.ownershipVersion;
    if (key !== this.nbKey) {
      this.nbKey = key;
      this.nb = Fronts.neighbors(g, g.player.id).filter(e => e === -1 || (g.kingdom(e) && g.kingdom(e).alive && !g.kingdom(e).bandit));
    }
    return this.nb;
  },

  // ---------- панель армии и выделения ----------
  selHtml(ui, s) {
    const g = ui.g, pl = g.player, divs = this.selected(ui);
    const grp = s.kind === 'group' ? Fronts.group(g, s.id) : null;
    let men = 0;
    for (const a of divs) men += menCount(a.units);
    const title = grp ? grp.name : 'Выбрано дивизий: ' + divs.length;
    let h = `<div class="p-head">${grp ? `<span class="flag" style="color:${grp.color}">${Icons.svg('flag')}</span>` : Icons.crest(pl, 40)}<div><h2>${this.esc(title)}</h2>` +
      `<div class="sub">${grp ? divs.length + ' ' + plural(divs.length, 'дивизия', 'дивизии', 'дивизий') + ' · ' : ''}${fmtInt(men)} воинов</div></div></div>`;
    h += '<div class="dbars">' + this.bar('Организованность', this.avgOrg(divs), 'org ' + this.orgCls(this.avgOrg(divs))) + '</div>';
    h += '<div class="dlist">';
    for (const a of divs) h += this.divRow(ui, a, s.kind === 'multi' ? { check: true, on: true } : null);
    h += '</div>';
    h += `<div class="btnrow"><button class="act" type="button" data-act="stop">Стоп</button>` +
      `<button class="act ghost" type="button" data-act="home">Домой</button>` +
      `<button class="act ghost${this.pick === 'front' ? ' on' : ''}" type="button" data-act="dpick" data-v="front">На фронт…</button></div>`;
    h += '<div class="btnrow">' + (grp
      ? `<button class="act ghost" type="button" data-act="dgroup" data-g="leave">Распустить армию</button>`
      : `<button class="act" type="button" data-act="dgroup" data-g="new">${Icons.svg('flag')}Собрать армию</button><button class="act ghost" type="button" data-act="mclear">Снять выбор</button>`) + '</div>';
    if (this.pick === 'front') h += this.pickHtml(ui, divs);
    h += '<p class="tip">Коснитесь земли: дивизии пойдут строем, каждая на своё место. Город — осадят вместе, врага — атакуют вместе. Shift+щелчок добавляет дивизию в выделение.</p>';
    return h;
  },

  // ---------- город: формирование и обучение дивизий ----------
  cityHtml(ui, c) {
    const g = ui.g, pl = g.player;
    const q = {};
    for (const id of c.divQueue || []) q[id] = (q[id] || 0) + 1;
    let h = `<h5 class="sec">Дивизии</h5><div class="box tpls" data-key="tpls"><div class="box-h"><h4>${Icons.svg('flag')} Шаблоны</h4><span class="muted">до ${DIV.maxMen} воинов</span></div>`;
    for (const t of Fronts.templates(g, c.owner)) {
      const fits = Fronts.fits(c.garrison, t.units), plan = fits ? null : Fronts.trainPlan(g, c, t.id);
      let btn;
      if (fits) btn = `<button class="act" type="button" data-act="divform" data-id="${t.id}">Сформировать</button>`;
      else if (plan.block) btn = `<button class="act build lock" type="button" disabled><span>${this.esc(plan.block)}</span></button>`;
      else if (ui.lacking(pl, plan.cost).length) btn = `<button class="act build lack" type="button" disabled><span>${ui.lackText(pl, plan.cost)}</span></button>`;
      else btn = `<button class="act ghost" type="button" data-act="divtrain" data-id="${t.id}">Обучить</button>`;
      h += `<div class="tplrow"><span class="dic" style="background:${pl.color}">${Icons.svg(t.icon)}</span>` +
        `<div class="tp-t"><b>${this.esc(t.name)}</b>${q[t.id] ? `<span class="qb">ждёт ×${q[t.id]}</span>` : ''}<span class="muted">${menCount(t.units)} воинов</span>${ui.unitsHtml(t.units)}` +
        (plan && !plan.block && plan.list.length ? `<div class="cost">${ui.costHtml(pl, plan.cost, plan.time, plan.pop)}</div>` : '') +
        `</div><div class="tp-b">${btn}</div></div>`;
    }
    return h + '</div><p class="tip">«Обучить» ставит недостающих воинов в очередь найма, и дивизия сформируется сама. Свои шаблоны — в окне державы, вкладка «Армии».</p>';
  },

  // ---------- вкладка «Армии» державы ----------
  kingdomHtml(g, pl, ui) {
    const divs = g.armiesOf(pl.id), groups = Fronts.groupsOf(g, pl.id), fronts = Fronts.frontsOf(g, pl.id);
    const chosen = new Set(this.selected(ui).map(a => a.id));
    let h = `<div class="btnrow"><button class="act" type="button" data-act="dtool" data-v="rect">${Icons.svg('target')}Выделить рамкой</button>` +
      `<button class="act" type="button" data-act="dtool" data-v="line">${Icons.svg('flag')}Нарисовать фронт</button></div>`;
    // фронты
    h += '<h5 class="sec">Фронты</h5>';
    if (!fronts.length) h += '<p class="tip">Фронт — линия, на которой дивизии встают в оборону и откуда идут в наступление. Создайте его по границе с соседом или нарисуйте сами.</p>';
    for (const f of fronts) {
      const fd = Fronts.frontDivs(g, f), attack = f.mode === 'attack';
      h += `<div class="box front" data-key="fr-${f.id}"><div class="box-h"><h4 style="color:${pl.dark || pl.color}">${this.esc(f.name)}</h4><span class="muted">${fd.length} див. · ${fd.length ? Math.round(this.avgOrg(fd)) + '% орг.' : 'пусто'}</span></div>` +
        `<div class="btnrow"><button class="act${attack ? ' ghost' : ''}" type="button" data-act="fmode" data-f="${f.id}" data-v="hold">Оборона</button>` +
        `<button class="act${attack ? '' : ' ghost'}" type="button" data-act="fmode" data-f="${f.id}" data-v="attack">Наступление</button></div>` +
        `<div class="btnrow"><button class="act ghost" type="button" data-act="fassign" data-f="${f.id}"${chosen.size ? '' : ' disabled'}>Назначить выбранных${chosen.size ? ' (' + chosen.size + ')' : ''}</button>` +
        `<button class="act ghost" type="button" data-act="fgo" data-f="${f.id}">Показать</button>` +
        `<button class="act ghost" type="button" data-act="fdel" data-f="${f.id}">Распустить</button></div></div>`;
    }
    const nb = this.neighbors(g).filter(e => !fronts.some(f => f.kind === 'border' && f.enemy === e));
    if (nb.length) {
      h += '<div class="btnrow">' + nb.map(e => `<button class="act ghost" type="button" data-act="fnew" data-e="${e}">${Icons.svg('plus')}Фронт: ${this.esc(Fronts.enemyName(g, e))}</button>`).join('') + '</div>';
    }
    // армии
    h += '<h5 class="sec">Армии</h5>';
    if (!groups.length) h += '<p class="tip">Выделите несколько дивизий и нажмите «Собрать армию»: приказ армии двинет все дивизии строем.</p>';
    else {
      h += '<table class="t"><tbody>';
      for (const gr of groups) {
        const m = Fronts.members(g, gr.id);
        let men = 0;
        for (const a of m) men += menCount(a.units);
        h += `<tr class="click" data-act="selgroup" data-id="${gr.id}"><td>${this.gdot(gr)}${this.esc(gr.name)}</td><td class="num">${m.length} див.</td><td class="num">${fmtInt(men)} чел.</td></tr>`;
      }
      h += '</tbody></table>';
    }
    // дивизии
    h += `<h5 class="sec">Дивизии · ${divs.length}</h5>`;
    if (!divs.length) h += '<p class="tip">Дивизий в поле нет. В городе откройте вкладку «Войска» и сформируйте дивизию по шаблону.</p>';
    else {
      h += '<div class="dlist">';
      for (const a of divs.slice().sort((p, q) => (p.group || 0) - (q.group || 0) || p.id - q.id)) h += this.divRow(ui, a, { check: true, on: chosen.has(a.id) });
      h += '</div>';
    }
    // шаблоны
    h += '<h5 class="sec">Шаблоны дивизий</h5>';
    h += this.tplEdit ? this.editorHtml(ui) : this.tplListHtml(ui);
    return h;
  },
  tplListHtml(ui) {
    const g = ui.g, pl = g.player;
    let h = '<div class="tpllist">';
    for (const t of Fronts.templates(g, pl.id)) {
      const own = Fronts.isCustom(t.id);
      h += `<div class="tplrow"><span class="dic" style="background:${pl.color}">${Icons.svg(t.icon)}</span><div class="tp-t"><b>${this.esc(t.name)}</b><span class="muted">${menCount(t.units)} воинов</span>${ui.unitsHtml(t.units)}</div>` +
        `<div class="tp-b">${own ? `<button class="act ghost" type="button" data-act="tpedit" data-id="${t.id}">Изменить</button><button class="act ghost icon" type="button" data-act="tpdel" data-id="${t.id}" aria-label="Удалить">${Icons.svg('close')}</button>` : `<button class="act ghost" type="button" data-act="tpcopy" data-id="${t.id}">Копия</button>`}</div></div>`;
    }
    return h + `</div><div class="btnrow"><button class="act" type="button" data-act="tpnew">${Icons.svg('plus')}Свой шаблон</button></div>`;
  },
  editorHtml(ui) {
    const e = this.tplEdit, men = menCount(e.units);
    let h = `<div class="box tpled" data-key="tpled"><div class="box-h"><h4>${e.id ? 'Изменить шаблон' : 'Новый шаблон'}</h4><span class="muted${men > DIV.maxMen ? ' neg' : ''}">${men} из ${DIV.maxMen} воинов</span></div>`;
    h += `<input class="tpname" type="text" maxlength="24" placeholder="Название" value="${this.esc(e.name)}" data-input="tpname">`;
    h += '<div class="steps">';
    for (const u of UNIT_ORDER) {
      const n = e.units[u] || 0, sq = UNITS[u].squad, add = menCount({ [u]: sq });
      h += `<div class="step"><span>${Icons.svg(u)} ${UNITS[u].name}</span><button type="button" data-act="tpstep" data-u="${u}" data-v="0">0</button>` +
        `<button type="button" data-act="tpstep" data-u="${u}" data-v="-1"${n ? '' : ' disabled'}>−</button><span class="n">${n}</span>` +
        `<button type="button" data-act="tpstep" data-u="${u}" data-v="1"${men + add > DIV.maxMen ? ' disabled' : ''}>+</button></div>`;
    }
    h += '</div><div class="btnrow"><button class="act" type="button" data-act="tpsave">Сохранить</button><button class="act ghost" type="button" data-act="tpcancel">Отмена</button></div>';
    return h + `<p class="tip">Шаг — отряд (10 бойцов, у машин одна). Не больше ${DIV.maxMen} воинов, не меньше ${DIV.minMen}.</p></div>`;
  },

  // ---------- инструменты ввода ----------
  hint(ui, text) {
    const h = document.getElementById('hint');
    if (h) { h.textContent = text; h.hidden = !text; }
    if (text) ui.toast(text, true);
  },
  startTool(ui, kind) {
    const input = ui.app.input;
    this.lineFor = kind === 'line' ? this.selected(ui) : [];
    ui.select(null);
    input.setTool(kind === 'rect' ? this.rectTool(ui, false) : this.lineTool(ui));
    this.hint(ui, kind === 'rect' ? 'Проведите рамку вокруг своих дивизий (Esc — отмена)' : 'Проведите пальцем линию фронта по карте (Esc — отмена)');
  },
  endTool(ui) {
    this.drag = null;
    ui.app.input.setTool(null);
    ui.updateHint();
  },
  // Рамка выделения. once — Shift+перетаскивание мышью без кнопки: добавляет к выделению.
  rectTool(ui, add) {
    const me = this;
    return {
      down(w, e) { me.drag = { kind: 'rect', x0: w.x, y0: w.y, x1: w.x, y1: w.y, sx: e.clientX, sy: e.clientY, add: add || !!e.shiftKey }; },
      move(w) { if (me.drag) { me.drag.x1 = w.x; me.drag.y1 = w.y; } },
      up(w, e, input, cancelled) {
        const d = me.drag;
        me.drag = null;
        if (cancelled || !d) { me.endTool(ui); return; }
        const g = ui.g, pl = g.player;
        const small = Math.hypot(e.clientX - d.sx, e.clientY - d.sy) < 8;
        let ids = [];
        if (small) {
          const hit = ui.app.renderer.pick(e.clientX, e.clientY);
          if (hit.kind === 'army' && hit.obj.owner === pl.id) ids = [hit.id];
        } else {
          const x0 = Math.min(d.x0, w.x) - 0.2, x1 = Math.max(d.x0, w.x) + 0.2, y0 = Math.min(d.y0, w.y) - 0.2, y1 = Math.max(d.y0, w.y) + 0.2;
          for (const a of g.armiesOf(pl.id)) if (a.x >= x0 && a.x <= x1 && a.y >= y0 && a.y <= y1) ids.push(a.id);
        }
        const cur = me.selected(ui).map(a => a.id);
        let removed = false;
        if (d.add && small && ids.length && cur.indexOf(ids[0]) >= 0) { ids = cur.filter(id => id !== ids[0]); removed = true; }
        else if (d.add) for (const id of cur) if (ids.indexOf(id) < 0) ids.push(id);
        me.endTool(ui);
        if (!ids.length && !removed) { ui.toast(small ? 'Коснитесь своей дивизии' : 'В рамке нет ваших дивизий'); return; }
        me.setMulti(ui, ids);
        Sfx.play('click');
      },
      cancel() { me.drag = null; },
    };
  },
  // Линия фронта: ведём палец, при отпускании линия сглаживается и становится фронтом.
  lineTool(ui) {
    const me = this;
    return {
      down(w) { me.drag = { kind: 'line', pts: [[w.x, w.y]] }; },
      move(w) {
        const d = me.drag;
        if (!d) return;
        const l = d.pts[d.pts.length - 1];
        if (Math.hypot(w.x - l[0], w.y - l[1]) > 0.3) d.pts.push([w.x, w.y]);
      },
      up(w, e, input, cancelled) {
        const d = me.drag;
        me.drag = null;
        if (cancelled || !d) { me.endTool(ui); return; }
        d.pts.push([w.x, w.y]);
        const pts = [d.pts[0]];
        for (const p of d.pts) { const l = pts[pts.length - 1]; if (Math.hypot(p[0] - l[0], p[1] - l[1]) >= 0.7) pts.push(p); }
        const last = d.pts[d.pts.length - 1];
        if (pts[pts.length - 1] !== last && Math.hypot(last[0] - pts[pts.length - 1][0], last[1] - pts[pts.length - 1][1]) > 0.05) pts.push(last);
        const f = Fronts.makeLineFront(ui.g, ui.g.player.id, pts, me.lineFor.filter(a => ui.g.army(a.id)));
        me.endTool(ui);
        if (typeof f === 'string') { ui.toast(f); Sfx.play('error'); return; }
        Sfx.play('horn');
        ui.kTab = 'fronts';
        ui.select({ kind: 'kingdom' });
        ui.toast(f.name + (me.lineFor.length ? ': дивизии занимают позиции' : ' проведена; назначьте дивизии'), true);
      },
      cancel() { me.drag = null; },
    };
  },
};

// ---------- слои карты ----------
// Линии фронтов державы игрока: толстая линия цвета державы с засечками в сторону противника,
// при наступлении — стрелки ударов.
function drawFrontsLayer(ctx, r, z, tl, br) {
  const g = r.g, pl = g.player, st = g.fr;
  if (!st || !st.fronts.length || !pl) return;
  const px = 1 / z, t = r.time;
  ctx.save();
  ctx.lineCap = 'round'; ctx.lineJoin = 'round';
  for (const f of st.fronts) {
    if (f.owner !== pl.id) continue;
    const rt = st.rt.get(f.id);
    if (!rt) continue;
    const col = pl.color, dark = pl.dark || '#1a120a';
    for (const l of rt.lines) {
      const P = l.pts;
      if (P.length < 2) continue;
      ctx.beginPath();
      ctx.moveTo(P[0].x, P[0].y);
      for (let i = 1; i < P.length; i++) ctx.lineTo(P[i].x, P[i].y);
      ctx.strokeStyle = 'rgba(24,14,6,0.8)'; ctx.lineWidth = 7.5 * px; ctx.stroke();
      ctx.strokeStyle = col; ctx.lineWidth = 4.5 * px; ctx.stroke();
      // засечки в сторону врага (нормаль смотрит на свои земли)
      const step = Math.max(0.8, 30 * px), len = 9 * px;
      ctx.beginPath();
      let next = step * 0.5, acc = 0;
      for (let i = 1; i < P.length; i++) {
        const a = P[i - 1], b = P[i], sl = Math.hypot(b.x - a.x, b.y - a.y) || 1e-6;
        while (next <= acc + sl) {
          const k = (next - acc) / sl, x = a.x + (b.x - a.x) * k, y = a.y + (b.y - a.y) * k;
          const nx = a.nx + (b.nx - a.nx) * k, ny = a.ny + (b.ny - a.ny) * k, nl = Math.hypot(nx, ny) || 1;
          ctx.moveTo(x, y); ctx.lineTo(x - nx / nl * len, y - ny / nl * len);
          next += step;
        }
        acc += sl;
      }
      ctx.strokeStyle = 'rgba(24,14,6,0.8)'; ctx.lineWidth = 5.5 * px; ctx.stroke();
      ctx.strokeStyle = col; ctx.lineWidth = 3 * px; ctx.stroke();
    }
    // стрелки ударов
    if (f.mode === 'attack') for (const a of rt.arrows) {
      let dx = a.x1 - a.x0, dy = a.y1 - a.y0;
      const L = Math.hypot(dx, dy);
      if (L < 0.6) continue;
      dx /= L; dy /= L;
      const head = 13 * px, ex = a.x1 - dx * 0.5, ey = a.y1 - dy * 0.5, bx = ex - dx * head, by = ey - dy * head;
      const c = a.foe ? '#d6402a' : col;
      ctx.setLineDash([9 * px, 6 * px]); ctx.lineDashOffset = -t * 16 * px;
      ctx.beginPath(); ctx.moveTo(a.x0, a.y0); ctx.lineTo(bx, by);
      ctx.strokeStyle = 'rgba(24,14,6,0.75)'; ctx.lineWidth = 7 * px; ctx.stroke();
      ctx.strokeStyle = c; ctx.lineWidth = 4 * px; ctx.stroke();
      ctx.setLineDash([]);
      ctx.beginPath();
      ctx.moveTo(ex, ey); ctx.lineTo(bx - dy * head * 0.62, by + dx * head * 0.62); ctx.lineTo(bx + dy * head * 0.62, by - dx * head * 0.62); ctx.closePath();
      ctx.fillStyle = c; ctx.fill();
      ctx.lineWidth = 2 * px; ctx.strokeStyle = 'rgba(24,14,6,0.85)'; ctx.stroke();
    }
  }
  ctx.restore();
}

// Названия фронтов, рамка выделения и линия, которую ведёт палец (в экранных пикселях).
function drawFrontsScreen(ctx, r, z) {
  const g = r.g, pl = g.player, st = g.fr;
  if (!pl) return;
  if (st && st.fronts.length && z >= 8) {
    ctx.save();
    ctx.font = '700 12px "PT Sans Narrow", "Arial Narrow", sans-serif';
    ctx.textAlign = 'center';
    for (const f of st.fronts) {
      if (f.owner !== pl.id) continue;
      const rt = st.rt.get(f.id);
      if (!rt || !rt.lines.length) continue;
      const P = rt.lines[0].pts, m = P[P.length >> 1], p = r.toScreen(m.x - m.nx * 1.1, m.y - m.ny * 1.1);
      if (p.x < -60 || p.y < -20 || p.x > r.w + 60 || p.y > r.h + 20) continue;
      const txt = f.name + (f.mode === 'attack' ? ' ⚔' : ''), w = ctx.measureText(txt).width + 12;
      ctx.fillStyle = 'rgba(25,15,8,0.8)';
      r.roundRect(ctx, p.x - w / 2, p.y - 10, w, 18, 6); ctx.fill();
      ctx.fillStyle = '#fff3d6'; ctx.fillText(txt, p.x, p.y + 3);
    }
    ctx.restore();
  }
  const d = FrontsUI.drag;
  if (!d) return;
  ctx.save();
  if (d.kind === 'rect') {
    const a = r.toScreen(d.x0, d.y0), b = r.toScreen(d.x1, d.y1);
    ctx.fillStyle = 'rgba(243,213,138,0.18)'; ctx.strokeStyle = '#ffe28a'; ctx.lineWidth = 2; ctx.setLineDash([7, 5]);
    ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(a.x - b.x), Math.abs(a.y - b.y));
    ctx.strokeRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(a.x - b.x), Math.abs(a.y - b.y));
  } else if (d.kind === 'line' && d.pts.length > 1) {
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    ctx.beginPath();
    d.pts.forEach((q, i) => { const p = r.toScreen(q[0], q[1]); if (i) ctx.lineTo(p.x, p.y); else ctx.moveTo(p.x, p.y); });
    ctx.strokeStyle = 'rgba(24,14,6,0.7)'; ctx.lineWidth = 8; ctx.stroke();
    ctx.strokeStyle = pl.color; ctx.lineWidth = 5; ctx.setLineDash([12, 7]); ctx.stroke();
  }
  ctx.restore();
}

// ---------- обработчики кнопок и регистрация ----------
if (typeof document !== 'undefined') {
  const A = UIExt.actions;
  const toastOk = (ui, t) => ui.toast(t, true);

  RenderExt.map.push(drawFrontsLayer);
  RenderExt.screen.push(drawFrontsScreen);
  UIExt.kingdomTabs.push({ id: 'fronts', title: 'Армии', html: (g, pl, ui) => FrontsUI.kingdomHtml(g, pl, ui) });
  UIExt.shiftTool = ui => FrontsUI.rectTool(ui, true);
  UIExt.input = (e, ui) => {
    if (e.target && e.target.dataset && e.target.dataset.input === 'tpname' && FrontsUI.tplEdit) FrontsUI.tplEdit.name = e.target.value;
  };

  A.dpick = (d, ui) => { FrontsUI.pick = FrontsUI.pick === d.v ? null : d.v; };
  A.dtool = (d, ui) => { FrontsUI.startTool(ui, d.v); return 'nopanel'; };
  A.hold = (d, ui, city, army) => {
    if (!army) return;
    const f = Fronts.front(ui.g, army.front);
    if (f) { Fronts.setMode(ui.g, f, 'hold'); toastOk(ui, f.name + ': оборона'); }
    else { ui.g.stop(army); toastOk(ui, army.name + ' окапывается'); }
  };
  A.dgroup = (d, ui) => {
    const g = ui.g, pl = g.player, divs = FrontsUI.selected(ui);
    if (!divs.length) return 'Выберите дивизии';
    FrontsUI.pick = null;
    if (d.g === 'leave') {
      const gid = divs[0].group;
      if (ui.sel.kind === 'group') Fronts.disband(g, ui.sel.id);
      else for (const a of divs) a.group = null;
      toastOk(ui, 'Армия распущена');
      if (ui.sel.kind === 'group' && gid === ui.sel.id) { FrontsUI.multi = divs.map(a => a.id); ui.select({ kind: 'multi' }); return 'nopanel'; }
      return;
    }
    let grp;
    if (d.g === 'new') {
      grp = Fronts.makeGroup(g, pl.id, divs);
      Sfx.play('horn');
      toastOk(ui, grp.name + ' собрана: ' + divs.length + ' ' + plural(divs.length, 'дивизия', 'дивизии', 'дивизий'));
    } else {
      grp = Fronts.group(g, +d.g);
      if (!grp) return 'Такой армии нет';
      for (const a of divs) a.group = grp.id;
    }
    ui.select({ kind: 'group', id: grp.id });
    return 'nopanel';
  };
  A.dfront = (d, ui) => {
    const g = ui.g, pl = g.player, divs = FrontsUI.selected(ui);
    if (!divs.length) return 'Выберите дивизии';
    FrontsUI.pick = null;
    if (d.f === 'leave') { for (const a of divs) { a.front = null; } toastOk(ui, 'Дивизии сняты с фронта'); return; }
    if (d.f === 'line') { FrontsUI.startTool(ui, 'line'); FrontsUI.lineFor = divs; return 'nopanel'; }
    let f;
    if (d.f === 'b') {
      f = Fronts.makeBorderFront(g, pl.id, +d.e, divs);
    } else {
      f = Fronts.front(g, +d.f);
      if (!f) return 'Такого фронта нет';
      Fronts.assign(g, f, divs);
    }
    Sfx.play('march');
    toastOk(ui, f.name + ': ' + divs.length + ' ' + plural(divs.length, 'дивизия', 'дивизии', 'дивизий') + ' занимают позиции');
  };
  A.fnew = (d, ui) => {
    const g = ui.g, divs = FrontsUI.selected(ui);
    const f = Fronts.makeBorderFront(g, g.player.id, +d.e, divs);
    toastOk(ui, f.name + (divs.length ? ': дивизии занимают позиции' : ' создан; назначьте дивизии'));
  };
  A.fmode = (d, ui) => {
    const f = Fronts.front(ui.g, +d.f);
    if (!f) return 'Такого фронта нет';
    Fronts.setMode(ui.g, f, d.v);
    if (d.v === 'attack') { Sfx.play('horn'); if (!Fronts.frontDivs(ui.g, f).length) return 'На фронте нет дивизий'; }
  };
  A.fassign = (d, ui) => {
    const f = Fronts.front(ui.g, +d.f), divs = FrontsUI.selected(ui);
    if (!f) return 'Такого фронта нет';
    if (!divs.length) return 'Выберите дивизии';
    Fronts.assign(ui.g, f, divs);
    toastOk(ui, f.name + ': ' + divs.length + ' ' + plural(divs.length, 'дивизия', 'дивизии', 'дивизий') + ' занимают позиции');
  };
  A.fdel = (d, ui) => {
    const f = Fronts.front(ui.g, +d.f);
    if (f) Fronts.removeFront(ui.g, f);
  };
  A.fgo = (d, ui) => {
    const g = ui.g, f = Fronts.front(g, +d.f);
    if (!f) return;
    const rt = Fronts.runtime(g, f);
    if (rt.lines.length) { const P = rt.lines[0].pts, m = P[P.length >> 1]; ui.app.focus(m.x, m.y); return 'nopanel'; }
    const c = g.citiesOf(f.owner)[0];
    if (c) ui.app.focus(c.x + 0.5, c.y + 0.5);
    return 'nopanel';
  };
  A.msel = (d, ui) => {
    const a = ui.g.army(+d.id);
    if (a && a.owner === ui.g.player.id) {
      const ids = FrontsUI.selected(ui).map(x => x.id), i = ids.indexOf(a.id);
      if (i >= 0) ids.splice(i, 1); else ids.push(a.id);
      FrontsUI.multi = ids;
      if (ui.sel && ui.sel.kind !== 'kingdom') {
        if (ids.length > 1) ui.sel = { kind: 'multi' };
        else if (ids.length === 1) ui.sel = { kind: 'army', id: ids[0] };
        else { ui.select(null); return 'nopanel'; }
      } else if (ui.sel && ui.sel.kind === 'kingdom') {
        // список в окне державы: выбор хранится отдельно и подсвечивается на карте
        if (ui.app.renderer) ui.app.renderer.hl = new Set(ids);
      }
    }
  };
  A.mclear = (d, ui) => { FrontsUI.multi = []; ui.select(null); return 'nopanel'; };
  A.selgroup = (d, ui) => { ui.select({ kind: 'group', id: +d.id }); return 'nopanel'; };

  // город
  A.divform = (d, ui, city) => {
    if (!city) return;
    const err = Fronts.form(ui.g, city, d.id);
    if (typeof err === 'string') return err;
    Sfx.play('horn');
    ui.select({ kind: 'army', id: err.id });
    ui.coachEvent('form');
    return 'nopanel';
  };
  A.divtrain = (d, ui, city) => {
    if (!city) return;
    const err = Fronts.train(ui.g, city, d.id);
    if (err) return err;
    Sfx.play('recruit');
    ui.coachEvent('recruit');
  };

  // редактор шаблонов
  const edit = () => FrontsUI.tplEdit;
  A.tpnew = () => { FrontsUI.tplEdit = { id: null, name: '', units: { spear: 50, archer: 20 } }; };
  A.tpcopy = (d, ui) => {
    const t = Fronts.tpl(ui.g, ui.g.player.id, d.id);
    if (t) FrontsUI.tplEdit = { id: null, name: t.name + ' 2', units: { ...t.units } };
  };
  A.tpedit = (d, ui) => {
    const t = Fronts.tpl(ui.g, ui.g.player.id, d.id);
    if (t) FrontsUI.tplEdit = { id: t.id, name: t.name, units: { ...t.units } };
  };
  A.tpdel = (d, ui) => { Fronts.deleteTemplate(ui.g, ui.g.player.id, d.id); };
  A.tpcancel = () => { FrontsUI.tplEdit = null; };
  A.tpstep = (d) => {
    const e = edit();
    if (!e) return;
    const u = d.u, sq = UNITS[u].squad, cur = e.units[u] || 0;
    if (d.v === '0') delete e.units[u];
    else {
      const n = Math.max(0, cur + (+d.v) * sq);
      if (n > cur && menCount(e.units) + menCount({ [u]: sq }) > DIV.maxMen) return 'Не больше ' + DIV.maxMen + ' воинов в дивизии';
      if (n) e.units[u] = n; else delete e.units[u];
    }
  };
  A.tpsave = (d, ui) => {
    const e = edit();
    if (!e) return;
    const t = Fronts.saveTemplate(ui.g, ui.g.player.id, e);
    if (typeof t === 'string') return t;
    FrontsUI.tplEdit = null;
    toastOk(ui, 'Шаблон «' + t.name + '» сохранён');
  };
}
