'use strict';
// Интерфейс: верхняя планка, панели городов, армий и державы, вести, обучение.

const $ = id => document.getElementById(id);
const UNLOCKS = {
  barracks: ['копейщики', 'мечники'], range: ['лучники', 'арбалетчики'],
  stable: ['конница', 'рыцари'], workshop: ['тараны', 'катапульты'],
};

class UI {
  constructor(app) {
    this.app = app;
    this.g = null;
    this.sel = null;
    this.cityTab = 'eco';
    this.kTab = 'treasury';
    this.form = {};
    this.formFor = null;
    this.html = '';
    this.resT = 0;
    this.toastT = 0;
    this.coach = null;
    this.buildStatic();
  }

  buildStatic() {
    $('resbar').innerHTML = RES.map(r =>
      `<div class="res" data-r="${r.id}" title="${r.name}"><span style="color:${r.color}">${Icons.svg(r.id)}</span><b>0</b><small>+0</small></div>`).join('');
    const sp = $('speed').children;
    sp[0].innerHTML = Icons.svg('pause');
    $('menu-btn').innerHTML = Icons.svg('menu');
    $('panel-close').innerHTML = Icons.svg('close');
    $('mm-toggle').innerHTML = Icons.svg('target');
    $('panel-close').addEventListener('click', () => this.select(null));
    $('kingdom-btn').addEventListener('click', () => this.select(this.sel && this.sel.kind === 'kingdom' ? null : { kind: 'kingdom' }));
    $('mm-toggle').addEventListener('click', () => $('minimap-wrap').classList.toggle('open'));
    $('panel-body').addEventListener('click', e => {
      const b = e.target.closest('[data-act]');
      if (!b || b.disabled) return;
      this.action(b.dataset);
    });
    $('coach-skip').addEventListener('click', () => this.endCoach());
    $('coach-ok').addEventListener('click', () => this.nextCoach(true));
  }

  bind(g) {
    this.g = g;
    this.sel = null;
    this.html = '';
    $('panel').hidden = true;
    $('feed').innerHTML = '';
    $('hint').hidden = true;
    const pl = g.player;
    $('k-crest').innerHTML = Icons.crest(pl, 26);
    $('k-name').textContent = pl.name;
    g.on((type, d) => this.onEvent(type, d));
    for (const ev of g.events.slice(-3)) this.feed(ev, true);
    this.startCoach();
  }

  // ---------- выбор ----------
  select(sel) {
    this.sel = sel;
    this.html = '';
    this.formFor = null;
    this.form = {};
    if (this.app.renderer) this.app.renderer.selected = sel && (sel.kind === 'army' || sel.kind === 'city') ? sel : null;
    this.renderPanel();
    this.updateHint();
    this.revealSelection();
    if (sel && sel.kind === 'city') this.coachEvent('selectCity', sel.id);
    if (sel && sel.kind === 'army') this.coachEvent('selectArmy', sel.id);
  }
  // Если панель закрыла выбранный город или армию, сдвинуть карту так, чтобы он был виден рядом с панелью.
  revealSelection() {
    const s = this.sel, r = this.app.renderer, panel = $('panel');
    if (!r || !s || panel.hidden || (s.kind !== 'city' && s.kind !== 'army')) return;
    const o = s.kind === 'city' ? this.g.city(s.id) : this.g.army(s.id);
    if (!o) return;
    const p = s.kind === 'city' ? r.toScreen(o.x + 0.5, o.y + 0.5) : r.toScreen(o.x, o.y);
    const pr = panel.getBoundingClientRect(), top = $('topbar').getBoundingClientRect().bottom;
    const m = 48;
    let tx = p.x, ty = p.y;
    if (pr.left <= 1) { if (p.y > pr.top - m) ty = (top + pr.top) / 2; } // нижняя шторка на телефоне
    else if (p.x > pr.left - m) tx = pr.left / 2; // боковая панель
    if (tx === p.x && ty === p.y) return;
    r.glideTo(r.cam.x + (p.x - tx) / r.cam.z, r.cam.y + (p.y - ty) / r.cam.z);
  }
  selectedArmy() {
    const s = this.sel;
    if (!s || s.kind !== 'army') return null;
    const a = this.g.army(s.id);
    return a && a.owner === this.g.player.id ? a : null;
  }
  updateHint() {
    const a = this.selectedArmy();
    const h = $('hint');
    if (a) { h.textContent = 'Коснитесь цели: земля — идти, город — осада или вход, враг — атака'; h.hidden = false; }
    else h.hidden = true;
  }

  // ---------- действия панели ----------
  action(d) {
    const g = this.g, pl = g.player;
    const city = this.sel && this.sel.kind === 'city' ? g.city(this.sel.id) : null;
    const army = this.selectedArmy();
    let err = null;
    switch (d.act) {
      case 'tab': this.cityTab = d.v; break;
      case 'ktab': this.kTab = d.v; break;
      case 'build':
        err = g.startBuild(city, d.kind, d.id || null);
        if (!err) { Sfx.play('build'); this.coachEvent('build'); }
        break;
      case 'cancel': g.cancelBuild(city); Sfx.play('click'); break;
      case 'recruit':
        err = g.recruit(city, d.id);
        if (!err) { Sfx.play('recruit'); this.coachEvent('recruit'); }
        break;
      case 'step': {
        const max = d.src === 'army' ? (army ? army.units[d.u] || 0 : 0) : (city ? city.garrison[d.u] || 0 : 0);
        const sq = UNITS[d.u].squad;
        const cur = this.form[d.u] !== undefined ? this.form[d.u] : max;
        this.form[d.u] = d.v === 'all' ? max : d.v === 'none' ? 0 : clamp(cur + (+d.v) * sq, 0, max);
        break;
      }
      case 'form': {
        const units = d.v === 'all' ? { ...city.garrison } : this.formUnits(city.garrison);
        const a = g.formArmy(city, units);
        if (!a) err = 'Выберите, кого вывести';
        else { Sfx.play('horn'); this.select({ kind: 'army', id: a.id }); this.coachEvent('form'); return; }
        break;
      }
      case 'split': {
        if (!army) break;
        const units = {};
        for (const u in army.units) units[u] = Math.floor(army.units[u] / 2 / UNITS[u].squad) * UNITS[u].squad || (army.units[u] > 1 ? Math.floor(army.units[u] / 2) : 0);
        const b = g.splitArmy(army, units);
        if (!b) err = 'Слишком маленькая армия';
        else { Sfx.play('click'); this.select({ kind: 'army', id: b.id }); return; }
        break;
      }
      case 'merge': {
        if (!army) break;
        const near = g.armiesOf(pl.id).filter(o => o !== army && o.state !== 'battle' && dist(o.x, o.y, army.x, army.y) < 3);
        if (!near.length) { err = 'Рядом нет других армий'; break; }
        for (const o of near) g.mergeInto(army, o);
        Sfx.play('horn');
        break;
      }
      case 'stop': if (army) { g.stop(army); Sfx.play('click'); } break;
      case 'home': {
        if (!army) break;
        let best = null, bd = Infinity;
        for (const c of g.citiesOf(pl.id)) { const dd = dist(c.x, c.y, army.x, army.y); if (dd < bd) { bd = dd; best = c; } }
        if (best) err = g.order(army, { kind: 'city', id: best.id });
        break;
      }
      case 'jump': this.app.focus(+d.x, +d.y); break;
      case 'selcity': this.app.focus(g.city(+d.id).x + 0.5, g.city(+d.id).y + 0.5); this.select({ kind: 'city', id: +d.id }); return;
      case 'selarmy': { const a = g.army(+d.id); if (a) { this.app.focus(a.x, a.y); this.select({ kind: 'army', id: a.id }); } return; }
      case 'trade':
        err = g.trade(pl, d.r, +d.n, d.sell === '1');
        if (!err) Sfx.play('coin');
        break;
    }
    if (err) { this.toast(err); Sfx.play('error'); }
    this.html = '';
    this.renderPanel();
  }
  formUnits(src) {
    const out = {};
    for (const u in src) { const n = this.form[u] !== undefined ? this.form[u] : src[u]; if (n > 0) out[u] = n; }
    return out;
  }

  // ---------- панель ----------
  renderPanel() {
    const g = this.g;
    const s = this.sel;
    let html = '';
    if (!s || !g) { $('panel').hidden = true; this.html = ''; return; }
    if (s.kind === 'city') { const c = g.city(s.id); if (!c) return this.select(null); html = this.cityHtml(c); }
    else if (s.kind === 'army') { const a = g.army(s.id); if (!a) return this.select(null); html = this.armyHtml(a); }
    else if (s.kind === 'kingdom') html = this.kingdomHtml();
    $('panel').hidden = false;
    $('panel').classList.toggle('compact', s.kind === 'army');
    if (html !== this.html) {
      const body = $('panel-body');
      const scroll = body.scrollTop;
      body.innerHTML = html;
      body.scrollTop = scroll;
      this.html = html;
    }
    this.updateLive();
  }

  costHtml(k, cost, time) {
    let h = '';
    for (const r in cost) h += `<span class="c ${k.res[r] < cost[r] ? 'lack' : ''}">${Icons.svg(r)}${cost[r]}</span>`;
    if (time) h += `<span class="t">${Icons.svg('hourglass')}${Math.round(time)} с</span>`;
    return h;
  }
  lvDots(lv, max) {
    let h = '<span class="lv">';
    for (let i = 0; i < max; i++) h += `<i class="${i < lv ? 'on' : ''}"></i>`;
    return h + '</span>';
  }
  unitsHtml(units) {
    const keys = UNIT_ORDER.filter(u => units[u] > 0);
    if (!keys.length) return '<span class="tip">Никого</span>';
    return '<div class="units">' + keys.map(u => `<span class="unit" title="${UNITS[u].name}">${Icons.svg(u)}${UNITS[u].short} <b>${units[u]}</b></span>`).join('') + '</div>';
  }
  crestFor(owner, size) {
    const k = this.g.kingdom(owner);
    return k ? Icons.crest(k, size) : Icons.crest({ color: NEUTRAL_COLOR, sigil: 'tower' }, size);
  }

  cityHtml(c) {
    const g = this.g, k = g.kingdom(c.owner), pl = g.player;
    const mine = k && k.isPlayer;
    const L = CITY_LEVELS[c.level];
    let h = `<div class="p-head">${this.crestFor(c.owner, 40)}<div><h2>${escapeHtml(c.name)}</h2><div class="sub">${L.name}${c.isCapital ? ' · столица' : ''} · ${k ? escapeHtml(k.name) : 'вольный город'}</div></div></div>`;
    h += `<div class="p-stats"><span title="Жители">${Icons.svg('people')}<b data-live="pop"></b></span>`;
    if (c.walls) h += `<span title="Стены">${Icons.svg('walls')}${WALLS[c.walls].name}</span>`;
    if (c.towers) h += `<span title="Башни">${Icons.svg('towers')}${c.towers} ур.</span>`;
    if (mine) h += `<span title="Занято мест под здания">${Icons.svg('hammer')}${g.usedSlots(c)}/${L.slots}</span>`;
    h += '</div>';
    if (c.siegeBy) h += `<div class="box"><h4>${Icons.svg('swords')} Город в осаде</h4><div class="row2"><span>Стены</span><span data-live="wallhp"></span></div><div class="progress hp"><i data-live="wallbar"></i></div><p class="tip">Пока идёт осада, стройка и найм стоят, а доходы падают.</p></div>`;
    if (!mine) return h + this.foreignCityHtml(c);
    h += `<div class="tabs"><button type="button" data-act="tab" data-v="eco" class="${this.cityTab === 'eco' ? 'on' : ''}">Хозяйство</button>` +
      `<button type="button" data-act="tab" data-v="def" class="${this.cityTab === 'def' ? 'on' : ''}">Оборона</button>` +
      `<button type="button" data-act="tab" data-v="army" class="${this.cityTab === 'army' ? 'on' : ''}">Войска</button></div>`;
    if (c.construction) {
      h += `<div class="box"><h4>${Icons.svg('hammer')} Строится: ${escapeHtml(c.construction.name)}${c.construction.kind === 'level' ? '' : ' (' + c.construction.to + ' ур.)'}</h4>` +
        `<div class="progress"><i data-live="build"></i></div><div class="btnrow"><button class="act ghost" type="button" data-act="cancel">Отменить (вернётся 75%)</button></div></div>`;
    }
    if (this.cityTab === 'eco') h += this.ecoHtml(c, pl);
    else if (this.cityTab === 'def') h += this.defHtml(c, pl);
    else h += this.armyTabHtml(c, pl);
    return h;
  }

  buildEffect(c, bid, lv) {
    const g = this.g, b = BUILDINGS[bid];
    const n = Math.max(1, lv);
    if (b.yield && bid !== 'market') {
      const r = Object.keys(b.yield)[0];
      const tf = g.terrainFactor(c, bid);
      const v = Math.round(b.yield[r] * n * tf);
      const note = tf < 0.55 ? ' — местность бедная' : tf > 1.15 ? ' — местность богатая' : '';
      return `${lv ? 'Даёт' : 'Даст'} <b>+${v}</b> ${RES_BY_ID[r].gen}/мин${note}`;
    }
    if (bid === 'market') return `${lv ? 'Даёт' : 'Даст'} <b>+${b.yield.gold * n}</b> золота/мин, налоги <b>+${10 * n}%</b>`;
    if (bid === 'factory') {
      const cv = b.convert;
      return `${cv.input.wood * n} дерева и ${cv.input.iron * n} железа → <b>+${cv.output.gold * n}</b> золота/мин`;
    }
    if (UNLOCKS[bid]) return lv ? 'Открыто: ' + UNLOCKS[bid].slice(0, lv).join(', ') : 'Откроет: ' + UNLOCKS[bid][0];
    return '';
  }

  ecoHtml(c, pl) {
    const g = this.g;
    let h = '<div class="cards">';
    for (const bid of BUILDING_IDS) {
      const b = BUILDINGS[bid];
      const lv = c.buildings[bid] || 0;
      const info = g.buildInfo(c, 'building', bid);
      let btn = '', cost = '', why = '';
      if (!info) btn = '<span class="tip">Предел</span>';
      else {
        const block = g.buildBlock(c, 'building', bid);
        const busy = !!c.construction;
        btn = `<button class="act" type="button" data-act="build" data-kind="building" data-id="${bid}" ${block ? 'disabled' : ''}>${lv ? 'Улучшить' : 'Построить'}</button>`;
        cost = `<div class="cost">${this.costHtml(pl, info.cost, info.time)}</div>`;
        if (info.block) why = `<div class="why">${info.block}</div>`;
        else if (busy && !block) why = '';
      }
      h += `<div class="card ${info ? '' : 'done'}"><div class="ic">${Icons.svg(bid)}</div><h4 title="${escapeHtml(b.desc)}">${b.name}${this.lvDots(lv, b.max)}</h4>${btn}` +
        `<div class="eff">${this.buildEffect(c, bid, lv)}</div>${cost}${why}</div>`;
    }
    h += '</div>';
    return h;
  }

  defHtml(c, pl) {
    const g = this.g;
    let h = '<div class="cards">';
    const L = CITY_LEVELS[c.level];
    const items = [
      ['level', 'level', `Уровень города: ${L.name}`, L.up ? `Следующий: ${CITY_LEVELS[c.level + 1].name} — жителей до ${fmtInt(CITY_LEVELS[c.level + 1].popMax)}, мест ${CITY_LEVELS[c.level + 1].slots}, шире границы` : 'Высший уровень'],
      ['walls', 'walls', c.walls ? WALLS[c.walls].name : 'Стен нет', WALLS[c.walls + 1] ? `Следующие: ${WALLS[c.walls + 1].name} — прочность ${WALLS[c.walls + 1].hp}, защита гарнизона +${Math.round(WALLS[c.walls + 1].bonus * 100)}%` : 'Сильнейшие стены'],
      ['towers', 'towers', c.towers ? TOWERS[c.towers].name : 'Башен нет', TOWERS[c.towers + 1] ? `Следующие: ${TOWERS[c.towers + 1].name} — ${TOWERS[c.towers + 1].dps} урона/с по осаждающим` : 'Сильнейшие башни'],
    ];
    for (const [kind, icon, title, eff] of items) {
      const info = g.buildInfo(c, kind);
      let btn = '<span class="tip">Предел</span>', cost = '', why = '';
      if (info) {
        const block = g.buildBlock(c, kind);
        btn = `<button class="act" type="button" data-act="build" data-kind="${kind}" ${block ? 'disabled' : ''}>Улучшить</button>`;
        cost = `<div class="cost">${this.costHtml(pl, info.cost, info.time)}</div>`;
        if (info.block) why = `<div class="why">${info.block}</div>`;
      }
      h += `<div class="card"><div class="ic">${Icons.svg(icon)}</div><h4>${title}</h4>${btn}<div class="eff">${eff}</div>${cost}${why}</div>`;
    }
    h += '</div>';
    if (c.walls) h += `<div class="box" style="margin-top:10px"><div class="row2"><span>Прочность стен</span><span data-live="wallhp"></span></div><div class="progress hp"><i data-live="wallbar"></i></div></div>`;
    h += '<p class="tip">При осаде горожане берутся за оружие. Пока целы стены и в гарнизоне есть воины, город не взять. Повреждённые стены чинятся сами.</p>';
    return h;
  }

  armyTabHtml(c, pl) {
    const g = this.g;
    let h = `<div class="box"><h4>${Icons.svg('shield')} Гарнизон · <span data-live="garmen"></span></h4>${this.unitsHtml(c.garrison)}`;
    const keys = UNIT_ORDER.filter(u => c.garrison[u] > 0);
    if (keys.length) {
      if (this.formFor !== 'city' + c.id) { this.formFor = 'city' + c.id; this.form = {}; }
      h += '<div class="steps">';
      for (const u of keys) {
        const n = this.form[u] !== undefined ? this.form[u] : c.garrison[u];
        h += `<div class="step"><span>${Icons.svg(u)} ${UNITS[u].name}</span><button type="button" data-act="step" data-u="${u}" data-v="none">0</button><button type="button" data-act="step" data-u="${u}" data-v="-1">−</button><span class="n">${n}</span><button type="button" data-act="step" data-u="${u}" data-v="1">+</button></div>`;
      }
      h += `</div><div class="btnrow"><button class="act" type="button" data-act="form" data-v="sel">Вывести выбранных</button><button class="act ghost" type="button" data-act="form" data-v="all">Вывести всех</button></div>`;
    }
    h += '</div>';
    if (c.queue.length) {
      h += `<div class="box"><h4>${Icons.svg('hourglass')} Очередь найма</h4><div class="units">` +
        c.queue.map((q, i) => `<span class="unit">${Icons.svg(q.unit)}${UNITS[q.unit].short}${i === 0 ? '' : ''}</span>`).join('') +
        `</div><div class="progress" style="margin-top:6px"><i data-live="queue"></i></div></div>`;
    }
    h += '<div class="cards">';
    for (const uid of UNIT_ORDER) {
      const u = UNITS[uid];
      const info = g.recruitInfo(c, uid);
      const block = g.recruitBlock(c, uid);
      const size = u.squad > 1 ? u.squad + ' чел.' : '1 машина';
      h += `<div class="card"><div class="ic">${Icons.svg(uid)}</div><h4 title="${escapeHtml(u.desc)}">${u.name} <small>(${size})</small></h4>` +
        `<button class="act" type="button" data-act="recruit" data-id="${uid}" ${block ? 'disabled' : ''}>Нанять</button>` +
        `<div class="eff">Атака <b>${u.atk}</b> · защита <b>${u.def}</b> · здоровье <b>${u.hp}</b>${u.siege >= 1 ? ' · осада <b>' + u.siege + '</b>' : ''}${u.ranged ? ' · стрелки' : ''}</div>` +
        `<div class="cost">${this.costHtml(pl, info.cost, info.time)}<span class="t">${Icons.svg('people')}${info.pop}</span></div>` +
        (info.block ? `<div class="why">${info.block}</div>` : '') + '</div>';
    }
    h += '</div>';
    return h;
  }

  foreignCityHtml(c) {
    const g = this.g;
    const seen = g.isVisible(c.x + 0.5, c.y + 0.5);
    let h = '<div class="box"><h4>Гарнизон</h4>';
    h += seen ? this.unitsHtml(c.garrison) : '<span class="tip">Город вне поля зрения — гарнизон неизвестен. Подведите войска или разведчиков.</span>';
    h += '</div>';
    if (c.walls) h += `<div class="box"><div class="row2"><span>${WALLS[c.walls].name}</span><span data-live="wallhp"></span></div><div class="progress hp"><i data-live="wallbar"></i></div></div>`;
    const def = AI.cityDefense(g, c);
    const mine = g.armiesOf(g.player.id).filter(a => a.state !== 'battle').sort((a, b) => unitPower(b.units) - unitPower(a.units))[0];
    h += `<div class="box"><div class="row2"><span>Оценка обороны</span><b>${seen ? Math.round(def) : '?'}</b></div>`;
    if (mine) {
      const p = unitPower(mine.units);
      const ratio = seen ? p / Math.max(1, def) : null;
      const verdict = ratio === null ? 'нужна разведка' : ratio > 1.6 ? 'легко возьмём' : ratio > 1.15 ? 'возьмём с потерями' : ratio > 0.8 ? 'рискованно' : 'не хватит сил';
      h += `<div class="row2"><span>Сила «${escapeHtml(mine.name)}»</span><b>${Math.round(p)}</b></div><p class="tip">Итог: ${verdict}.${c.walls >= 2 && !siegePower(mine.units) ? ' Без таранов и катапульт каменные стены рушатся очень долго.' : ''}</p>`;
    }
    h += '</div><p class="tip">Чтобы напасть, выберите свою армию и коснитесь этого города.</p>';
    return h;
  }

  armyHtml(a) {
    const g = this.g, k = g.kingdom(a.owner);
    const mine = k && k.isPlayer;
    const seen = mine || g.isVisible(a.x, a.y);
    let h = `<div class="p-head">${Icons.crest(k, 40)}<div><h2>${escapeHtml(a.name || 'Войско')}</h2><div class="sub">${escapeHtml(k.name)} · <span data-live="astatus"></span></div></div></div>`;
    h += `<div class="p-stats"><span>${Icons.svg('people')}<b data-live="amen"></b></span><span title="Сила">${Icons.svg('swords')}<b data-live="apower"></b></span>` +
      `<span title="Скорость">${Icons.svg('flag')}${this.g.armySpeed(a).toFixed(2)} кл/с</span></div>`;
    h += `<div class="row2" style="display:flex;justify-content:space-between;font-size:14px"><span>Боевой дух</span><span data-live="amorale"></span></div><div class="progress morale" style="margin-bottom:10px"><i data-live="amoralebar"></i></div>`;
    h += seen ? this.unitsHtml(a.units) : '<span class="tip">Состав неизвестен</span>';
    if (mine) {
      h += `<div class="btnrow"><button class="act" type="button" data-act="stop">Стоп</button><button class="act" type="button" data-act="home">В ближайший город</button>` +
        `<button class="act ghost" type="button" data-act="split">Разделить</button><button class="act ghost" type="button" data-act="merge">Объединить с соседними</button></div>`;
      h += '<p class="tip">Коснитесь земли, чтобы идти; чужого города — чтобы осадить; своего — чтобы войти в гарнизон; вражеской армии — чтобы атаковать. Отступающая армия не слушается приказов, пока не дойдёт до своего города.</p>';
    } else if (a.isBandit) h += '<p class="tip">Разбойники грабят города и уходят. За их разгром дают добычу.</p>';
    return h;
  }

  kingdomHtml() {
    const g = this.g, pl = g.player;
    let h = `<div class="p-head">${Icons.crest(pl, 40)}<div><h2>${escapeHtml(pl.name)}</h2><div class="sub">${g.citiesOf(pl.id).length} из ${g.cities.length} городов · для победы нужно ${Math.ceil(g.cities.length * WIN_SHARE)}</div></div></div>`;
    const tabs = [['treasury', 'Казна'], ['trade', 'Рынок'], ['cities', 'Города'], ['armies', 'Армии'], ['rivals', 'Соперники']];
    h += '<div class="tabs" style="flex-wrap:wrap">' + tabs.map(([v, n]) => `<button type="button" data-act="ktab" data-v="${v}" class="${this.kTab === v ? 'on' : ''}">${n}</button>`).join('') + '</div>';
    if (this.kTab === 'treasury') {
      h += '<table class="t"><thead><tr><th></th>' + RES.map(r => `<th class="num" style="color:${r.color}">${Icons.svg(r.id)}</th>`).join('') + '</tr></thead><tbody>';
      for (const [key, name] of [['cities', 'Города'], ['upkeep', 'Войска'], ['factory', 'Мануфактуры'], ['total', 'Итого в минуту']]) {
        h += `<tr><td>${name}</td>` + RES.map(r => `<td class="num" data-live="inc-${key}-${r.id}"></td>`).join('') + '</tr>';
      }
      h += '</tbody></table><p class="tip">Налоги зависят от числа жителей, рынки их увеличивают. Войска в поле стоят дороже гарнизона. Зимой поля дают вдвое меньше еды.</p>';
      const st = pl.stats;
      h += `<table class="t" style="margin-top:8px"><tbody><tr><td>Победы / поражения</td><td class="num">${st.won} / ${st.lost}</td></tr><tr><td>Взято городов / потеряно</td><td class="num">${st.taken} / ${st.lostCities}</td></tr><tr><td>Сражено врагов / погибло наших</td><td class="num">${st.killed} / ${st.fallen}</td></tr></tbody></table>`;
    } else if (this.kTab === 'trade') {
      h += '<div class="trade">';
      for (const r of ['food', 'wood', 'stone', 'iron']) {
        const n = r === 'iron' ? 50 : 100;
        const sell = Math.floor(n * g.tradePrice(pl, r, true)), buy = Math.ceil(n * g.tradePrice(pl, r, false));
        h += `<span>${Icons.svg(r)} ${RES_BY_ID[r].name}: ${n}</span>` +
          `<button class="act" type="button" data-act="trade" data-r="${r}" data-n="${n}" data-sell="1" ${pl.res[r] < n ? 'disabled' : ''}>Продать +${sell}</button>` +
          `<button class="act ghost" type="button" data-act="trade" data-r="${r}" data-n="${n}" data-sell="0" ${pl.res.gold < buy ? 'disabled' : ''}>Купить −${buy}</button>`;
      }
      h += `</div><p class="tip">Цены указаны в золоте. Каждый уровень рынка в ваших городах улучшает цены на ${Math.round(TRADE.marketBonus * 100)}% (сейчас +${Math.round(g.tradeBonus(pl) * 100)}%).</p>`;
    } else if (this.kTab === 'cities') {
      h += '<table class="t"><thead><tr><th>Город</th><th class="num">Ур.</th><th class="num">Жит.</th><th class="num">Гарн.</th><th></th></tr></thead><tbody>';
      for (const c of g.citiesOf(pl.id)) {
        h += `<tr class="click" data-act="selcity" data-id="${c.id}"><td>${escapeHtml(c.name)}${c.isCapital ? ' ★' : ''}</td><td class="num">${c.level}</td><td class="num">${fmtInt(c.pop)}</td><td class="num">${menCount(c.garrison)}</td><td>${c.siegeBy ? Icons.svg('swords') : c.construction ? Icons.svg('hammer') : ''}</td></tr>`;
      }
      h += '</tbody></table>';
    } else if (this.kTab === 'armies') {
      const list = g.armiesOf(pl.id);
      if (!list.length) h += '<p class="tip">Армий в поле нет. Выведите войско из гарнизона города.</p>';
      else {
        h += '<table class="t"><thead><tr><th>Армия</th><th class="num">Воинов</th><th>Состояние</th></tr></thead><tbody>';
        for (const a of list) h += `<tr class="click" data-act="selarmy" data-id="${a.id}"><td>${escapeHtml(a.name)}</td><td class="num">${menCount(a.units)}</td><td>${this.armyStatus(a)}</td></tr>`;
        h += '</tbody></table>';
      }
    } else {
      h += '<table class="t"><thead><tr><th>Держава</th><th class="num">Городов</th><th class="num">Сила</th></tr></thead><tbody>';
      for (const k of g.kingdoms) {
        if (k.bandit || k.isPlayer) continue;
        const known = g.citiesOf(k.id).some(c => g.explored[g.cityTile(c)]);
        h += `<tr><td><span style="display:inline-flex;gap:6px;align-items:center">${Icons.crest(k, 22)}${escapeHtml(k.name)}</span></td><td class="num">${k.alive ? g.citiesOf(k.id).length : 'пала'}</td><td class="num">${k.alive ? (known ? this.powerWord(AI.totalPower(g, k), AI.totalPower(g, pl)) : '?') : '—'}</td></tr>`;
      }
      h += `</tbody></table><p class="tip">${g.time < GRACE_TIME ? 'Перемирие: соперники не нападут на другие державы ещё ' + fmtTime(GRACE_TIME - g.time) + '.' : 'Перемирие закончилось — соперники воюют со всеми, в том числе друг с другом.'} Поражение — если соперник займёт ${Math.ceil(g.cities.length * LOSE_SHARE)} городов.</p>`;
    }
    return h;
  }
  powerWord(p, mine) {
    const r = p / Math.max(1, mine);
    return r > 1.6 ? 'много сильнее' : r > 1.15 ? 'сильнее' : r > 0.85 ? 'наравне' : r > 0.5 ? 'слабее' : 'много слабее';
  }

  armyStatus(a) {
    const g = this.g;
    if (a.state === 'battle') return 'в бою';
    if (a.state === 'siege') { const c = g.city(a.siegeCity); return 'осаждает ' + (c ? c.name : ''); }
    if (a.state === 'retreat') return 'отступает';
    if (a.state === 'move' && a.dest) {
      if (a.dest.kind === 'city') { const c = g.city(a.dest.id); return c ? (c.owner === a.owner ? 'идёт в ' : 'идёт на ') + c.name : 'в пути'; }
      if (a.dest.kind === 'army') return 'преследует';
      return 'в пути';
    }
    return 'стоит';
  }

  // живые значения панели обновляются каждый кадр без перерисовки кнопок
  updateLive() {
    const g = this.g, s = this.sel;
    if (!s) return;
    const body = $('panel-body');
    const c = s.kind === 'city' ? g.city(s.id) : null;
    const a = s.kind === 'army' ? g.army(s.id) : null;
    let inc = null;
    for (const el of body.querySelectorAll('[data-live]')) {
      const key = el.dataset.live;
      switch (key) {
        case 'pop': el.textContent = c ? fmtInt(c.pop) + ' / ' + fmtInt(CITY_LEVELS[c.level].popMax) : ''; break;
        case 'build': el.style.width = c && c.construction ? (c.construction.t / c.construction.total * 100).toFixed(1) + '%' : '0'; break;
        case 'queue': el.style.width = c && c.queue.length ? (c.queue[0].t / c.queue[0].total * 100).toFixed(1) + '%' : '0'; break;
        case 'wallhp': el.textContent = c && c.walls ? fmtInt(c.wallHp) + ' / ' + WALLS[c.walls].hp : ''; break;
        case 'wallbar': el.style.width = c && c.walls ? (c.wallHp / WALLS[c.walls].hp * 100).toFixed(1) + '%' : '0'; break;
        case 'garmen': el.textContent = c ? menCount(c.garrison) + ' чел.' : ''; break;
        case 'astatus': el.textContent = a ? this.armyStatus(a) : ''; break;
        case 'amen': el.textContent = a ? fmtInt(menCount(a.units)) : ''; break;
        case 'apower': el.textContent = a ? Math.round(unitPower(a.units)) : ''; break;
        case 'amorale': el.textContent = a ? Math.round(a.morale) + '%' : ''; break;
        case 'amoralebar': el.style.width = a ? a.morale.toFixed(0) + '%' : '0'; break;
        default:
          if (key.startsWith('inc-')) {
            if (!inc) inc = g.income(g.player);
            const [, part, r] = key.split('-');
            const v = part === 'total' ? inc.total[r] : inc.parts[part][r];
            el.textContent = Math.abs(v) < 0.5 ? '—' : fmtRate(v);
            el.className = 'num ' + (v < -0.5 ? 'neg' : v > 0.5 && part === 'total' ? 'pos' : '');
          }
      }
    }
  }

  // ---------- кадр ----------
  update(dt) {
    const g = this.g;
    if (!g) return;
    this.resT -= dt;
    if (this.resT <= 0) {
      this.resT = 0.3;
      const pl = g.player;
      const inc = g.income(pl).total;
      for (const el of $('resbar').children) {
        const r = el.dataset.r;
        el.children[1].textContent = fmtInt(pl.res[r]);
        const sm = el.children[2];
        sm.textContent = fmtRate(inc[r]);
        sm.className = inc[r] < -0.5 ? 'neg' : '';
        el.classList.toggle('low', pl.res[r] < 20 && inc[r] < 0);
      }
      $('date').textContent = g.dateText();
      $('grace').textContent = g.time < GRACE_TIME ? 'перемирие ' + fmtTime(GRACE_TIME - g.time) : '';
      // перерисовка панели, если изменилось что-то кроме живых чисел
      if (this.sel) this.renderPanel();
      this.checkCoach();
    }
    if (this.sel) this.updateLive();
    if (this.sel && this.sel.kind === 'army' && !g.army(this.sel.id)) this.select(null);
    if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) $('toast').className = ''; }
    const speedBtns = $('speed').children;
    for (const b of speedBtns) b.classList.toggle('on', +b.dataset.speed === this.app.speed);
  }

  // ---------- вести ----------
  onEvent(type, d) {
    if (type === 'event') this.feed(d);
    else if (type === 'captured' && d.to && d.to.isPlayer) { Sfx.play('victory'); this.coachEvent('capture'); }
    else if (type === 'captured' && d.from && d.from.isPlayer) Sfx.play('defeat');
    else if (type === 'built' && d.city.owner === this.g.player.id) Sfx.play('done');
    else if (type === 'battle') Sfx.play('clash');
    else if (type === 'siege' && d.army.owner === this.g.player.id) this.coachEvent('siege');
  }
  feed(ev, quiet) {
    const box = $('feed');
    const el = document.createElement('div');
    el.className = 'msg ' + ev.kind;
    el.textContent = ev.text;
    if (ev.x !== null && ev.x !== undefined) el.addEventListener('click', () => this.app.focus(ev.x, ev.y));
    box.prepend(el);
    while (box.children.length > 4) box.lastChild.remove();
    const life = ev.important ? 9000 : 6000;
    setTimeout(() => el.classList.add('fade'), quiet ? 2500 : life);
    setTimeout(() => el.remove(), (quiet ? 2500 : life) + 600);
    if (!quiet && ev.important && ev.kind === 'bad') Sfx.play('alarm');
  }
  toast(text, ok) {
    const t = $('toast');
    t.textContent = text;
    t.className = 'show' + (ok ? ' ok' : '');
    this.toastT = 2.2;
  }

  // ---------- обучение ----------
  startCoach() {
    let done = false;
    try { done = localStorage.getItem('kc.tutorial') === '1'; } catch (e) { done = false; }
    if (done) { $('coach').hidden = true; this.coach = null; return; }
    this.coach = { step: 0, flags: {} };
    this.showCoach();
  }
  coachSteps() {
    const g = this.g, cap = g.city(g.player.capital);
    return [
      { text: `Это ваша столица ${cap ? cap.name : ''}. Коснитесь её, чтобы открыть управление городом.`, done: f => f.selectCity },
      { text: 'Во вкладке «Хозяйство» постройте что-нибудь полезное: лесопилку, каменоломню или рынок. Выход зависит от местности вокруг.', done: f => f.build },
      { text: 'Во вкладке «Войска» наймите отряд — копейщиков или лучников. Войска нужны и для защиты, и для захвата.', done: f => f.recruit },
      { text: 'У столицы стоит ваша Дружина (щит с гербом). Коснитесь её, затем коснитесь ближайшего серого вольного города — начнётся осада.', done: f => f.siege || f.capture },
      { text: `Захватывайте города: для победы нужно ${Math.ceil(g.cities.length * WIN_SHARE)} из ${g.cities.length}. Пауза — кнопка вверху или пробел, 2× и 3× ускоряют время. Удачи, государь!`, done: null },
    ];
  }
  showCoach() {
    if (!this.coach) return;
    const steps = this.coachSteps();
    const s = steps[this.coach.step];
    if (!s) return this.endCoach();
    $('coach').hidden = false;
    $('coach-text').textContent = s.text;
    $('coach-ok').hidden = !!s.done;
  }
  coachEvent(name) {
    if (!this.coach) return;
    this.coach.flags[name] = true;
    this.checkCoach();
  }
  checkCoach() {
    if (!this.coach) return;
    const s = this.coachSteps()[this.coach.step];
    if (s && s.done && s.done(this.coach.flags)) this.nextCoach();
  }
  nextCoach() {
    if (!this.coach) return;
    this.coach.step++;
    this.showCoach();
  }
  endCoach() {
    this.coach = null;
    $('coach').hidden = true;
    try { localStorage.setItem('kc.tutorial', '1'); } catch (e) { /* хранилище недоступно */ }
  }

  // ---------- итоги ----------
  endHtml(g) {
    let h = '<table class="t"><thead><tr><th>Держава</th><th class="num">Городов</th><th class="num">Победы</th><th class="num">Поражения</th><th class="num">Взято</th><th class="num">Сражено</th><th class="num">Погибло</th></tr></thead><tbody>';
    for (const k of g.kingdoms) {
      if (k.bandit) continue;
      const st = k.stats;
      h += `<tr><td><span style="display:inline-flex;gap:6px;align-items:center">${Icons.crest(k, 22)}${escapeHtml(k.name)}${k.isPlayer ? ' (вы)' : ''}</span></td><td class="num">${g.citiesOf(k.id).length}</td><td class="num">${st.won}</td><td class="num">${st.lost}</td><td class="num">${st.taken}</td><td class="num">${st.killed}</td><td class="num">${st.fallen}</td></tr>`;
    }
    return h + '</tbody></table>';
  }
}
