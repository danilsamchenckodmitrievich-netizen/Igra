'use strict';
// Интерфейс: верхняя планка, панели городов, армий и державы, вести, обучение.

const $ = id => document.getElementById(id);
// Какие войска открывает каждый уровень военной постройки: { barracks: ['spear', 'sword'], … }.
const UNLOCKS = {};
for (const u of UNIT_ORDER) { const n = UNITS[u].need; if (n) (UNLOCKS[n[0]] = UNLOCKS[n[0]] || [])[n[1] - 1] = u; }
// Разделы вкладки «Хозяйство»; постройки, не попавшие в список, уходят в последний раздел.
const BUILD_GROUPS = [
  ['Добыча', ['farm', 'lumber', 'quarry', 'mine']],
  ['Торговля и ремесло', ['market', 'factory']],
  ['Военное дело', ['barracks', 'range', 'stable', 'workshop']],
];
for (const bid of BUILDING_IDS) if (!BUILD_GROUPS.some(gr => gr[1].includes(bid))) BUILD_GROUPS[BUILD_GROUPS.length - 1][1].push(bid);
const ROMAN = ['', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII'];
// Составляющие влияния города: подпись и возможные имена полей в ответе g.cityInfluence.
const INFL_PARTS = [
  ['город', ['base', 'city', 'level']],
  ['население', ['pop', 'population', 'people']],
  ['гарнизон', ['garrison']],
  ['армии рядом', ['armies', 'army', 'allies', 'friendly', 'friends', 'own']],
  ['враги рядом', ['enemies', 'enemy', 'hostile', 'foes', 'threat']],
];

// Длительность в секундах игрового времени: «24 с» или «1:50».
function fmtDur(t) { const s = Math.round(t); return s < 60 ? s + ' с' : fmtTime(s); }
// Короткое дробное число со знаком: «+1,5», «−12».
function fmtSigned(v) {
  const a = Math.abs(v), s = a >= 10 || Math.round(a) === a ? String(Math.round(a)) : a.toFixed(1).replace('.', ',');
  return (v < 0 ? '−' : '+') + s;
}

// Бережное обновление панели: в живой DOM переносятся только отличия нового HTML. Совпадающие узлы
// (в том числе кнопка под пальцем) остаются прежними, поэтому нажатие не теряется и ничего не мигает.
// Крупные блоки помечены data-key: блок с другим ключом заменяется целиком (и проигрывает анимацию появления).
function sameNode(a, b) {
  if (a.nodeType !== b.nodeType || a.nodeName !== b.nodeName) return false;
  return a.nodeType !== 1 || a.getAttribute('data-key') === b.getAttribute('data-key');
}
function morphChildren(from, to) {
  let a = from.firstChild, b = to.firstChild;
  while (b) {
    const nb = b.nextSibling;
    if (a && !sameNode(a, b)) {
      // блок исчез: если совпадение найдётся чуть дальше, лишнее удаляем
      let f = a.nextSibling, n = 0;
      while (f && n < 3 && !sameNode(f, b)) { f = f.nextSibling; n++; }
      if (f && n < 3) while (a !== f) { const x = a.nextSibling; from.removeChild(a); a = x; }
    }
    if (a && sameNode(a, b)) { morphNode(a, b); a = a.nextSibling; }
    else from.insertBefore(b, a);
    b = nb;
  }
  while (a) { const x = a.nextSibling; from.removeChild(a); a = x; }
}
function morphNode(a, b) {
  if (a.nodeType !== 1) { if (a.nodeValue !== b.nodeValue) a.nodeValue = b.nodeValue; return; }
  // у живых значений (data-live) текст и ширину ведёт updateLive — их не трогаем
  const live = a.hasAttribute('data-live');
  for (let i = a.attributes.length - 1; i >= 0; i--) {
    const n = a.attributes[i].name;
    if (!b.hasAttribute(n) && !(live && n === 'style')) a.removeAttribute(n);
  }
  for (let i = 0; i < b.attributes.length; i++) {
    const at = b.attributes[i];
    if (live && at.name === 'style') continue;
    if (a.getAttribute(at.name) === at.value) continue;
    if (at.namespaceURI) a.setAttributeNS(at.namespaceURI, at.name, at.value); else a.setAttribute(at.name, at.value);
  }
  if (!live) morphChildren(a, b);
}

// Базовая дальность влияния города по уровню (без жителей и войск) — для таблицы «сейчас → дальше».
function inflBase(level) {
  const v = typeof INFLUENCE !== 'undefined' ? INFLUENCE.base[level] : CITY_LEVELS[level].radius;
  return String(Math.round(v * 10) / 10).replace('.', ',');
}

class UI {
  constructor(app) {
    this.app = app;
    this.g = null;
    this.sel = null;
    this.cityTab = 'eco';
    this.kTab = 'treasury';
    this.form = {};
    this.formFor = null;
    this.formOpen = false;
    this.inflOpen = false;
    this.flash = null;
    this.portraits = new Map();
    this.scratch = document.createElement('div');
    this.html = '';
    this.resT = 0;
    this.toastT = 0;
    this.coach = null;
    this.buildStatic();
  }

  buildStatic() {
    document.body.insertAdjacentHTML('beforeend', Icons.artSprite());
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
    $('panel-body').addEventListener('scroll', () => this.markStuck(), { passive: true });
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
    const prev = this.sel;
    this.sel = sel;
    this.html = '';
    this.formFor = null;
    this.form = {};
    // другой город или армия — панель открывается с начала
    if (!prev || !sel || prev.kind !== sel.kind || prev.id !== sel.id) { $('panel-body').scrollTop = 0; this.formOpen = false; }
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
    let err = null, tabbed = false;
    switch (d.act) {
      case 'tab': tabbed = this.cityTab !== d.v; this.cityTab = d.v; break;
      case 'ktab': tabbed = this.kTab !== d.v; this.kTab = d.v; break;
      case 'infl': this.inflOpen = !this.inflOpen; break;
      case 'formopen': this.formOpen = !this.formOpen; break;
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
    // новая вкладка начинается сразу под закреплёнными ярлычками, а не посреди прокрутки
    if (tabbed) {
      const body = $('panel-body'), tabs = body.querySelector('.tabs');
      const above = tabs && tabs.previousElementSibling;
      const top = above ? above.offsetTop + above.offsetHeight : 0;
      if (body.scrollTop > top) body.scrollTop = top;
      if (d.act === 'tab') Sfx.play('click');
    }
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
    const panel = $('panel');
    panel.hidden = false;
    panel.classList.toggle('compact', s.kind === 'army');
    // карточки в две колонки, когда панель достаточно широка
    panel.classList.toggle('two', panel.clientWidth >= 340);
    if (html !== this.html) {
      const sc = this.scratch;
      sc.innerHTML = html;
      morphChildren($('panel-body'), sc);
      sc.textContent = '';
      this.html = html;
      this.markStuck();
    }
    this.updateLive();
  }
  // Ярлычки прилипли к верху панели: освобождаем место под кнопку закрытия.
  markStuck() {
    const body = $('panel-body'), tabs = body.querySelector('.tabs');
    const above = tabs && tabs.previousElementSibling;
    const stuck = !!above && body.scrollTop > above.offsetTop + above.offsetHeight + 4;
    const panel = $('panel');
    if (panel.classList.contains('stuck') !== stuck) panel.classList.toggle('stuck', stuck);
  }

  // Стоимость чипами: значок ресурса и число; красным — чего не хватает.
  costHtml(k, cost, time, pop) {
    let h = '';
    for (const r in cost) {
      const lack = (k.res[r] || 0) < cost[r];
      h += `<span class="c${lack ? ' lack' : ''}" title="${RES_BY_ID[r].name}${lack ? ' — не хватает' : ''}"><span class="ri r-${r}">${Icons.svg(r)}</span>${fmtInt(cost[r])}</span>`;
    }
    if (pop) h += `<span class="c t" title="Жители, которые уйдут в войско">${Icons.svg('people')}${pop}</span>`;
    if (time) h += `<span class="c t" title="Время">${Icons.svg('hourglass')}${fmtDur(time)}</span>`;
    return h;
  }
  lacking(k, cost) {
    const out = [];
    for (const r in cost) if ((k.res[r] || 0) < cost[r]) out.push({ r, n: cost[r] });
    return out;
  }
  // Подпись кнопки при нехватке: сколько ещё нужно (число живое — без перерисовки панели).
  lackText(k, cost) {
    const l = this.lacking(k, cost);
    if (l.length === 1) return `Нужно ещё <span data-live="need" data-r="${l[0].r}" data-n="${l[0].n}"></span> ${RES_BY_ID[l[0].r].gen}`;
    return 'Не хватает: ' + l.map(x => RES_BY_ID[x.r].gen).join(', ');
  }
  // Ряд точек: уровни постройки, стены и башни, занятые места.
  dots(cls, n, max, building) {
    let h = `<span class="${cls}">`;
    for (let i = 0; i < max; i++) h += `<i class="${i < n ? 'on' : i === n && building ? 'next' : ''}"></i>`;
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
  // Портрет бойца: рисунок из UnitArt, если он есть, иначе знак рода войск на щите цвета державы.
  portrait(uid, k, px) {
    if (typeof UnitArt !== 'undefined' && UnitArt && typeof UnitArt.portraitURL === 'function') {
      const key = uid + '|' + k.color + '|' + px;
      let url = this.portraits.get(key);
      if (!url) {
        try { url = UnitArt.portraitURL(uid, k.color, Math.round(px * Math.min(3, window.devicePixelRatio || 1))); } catch (e) { url = null; }
        if (url) this.portraits.set(key, url);
      }
      if (url) return `<img class="portrait" src="${url}" width="${px}" height="${px}" alt="" draggable="false">`;
    }
    return `<span class="portrait glyph" style="width:${px}px;height:${px}px;background-color:${k.color}">${Icons.svg(uid)}</span>`;
  }
  isFlash(c, key) {
    const f = this.flash;
    return !!(f && f.city === c.id && f.key === key && performance.now() < f.until);
  }

  // ---------- город ----------
  cityHtml(c) {
    const g = this.g, k = g.kingdom(c.owner), pl = g.player;
    const mine = k && k.isPlayer;
    let h = this.cityHead(c, k, mine);
    if (c.siegeBy) {
      h += `<div class="box siege" data-key="siege"><h4>${Icons.svg('swords')} Город в осаде</h4><div class="row2"><span>Стены</span><span data-live="wallhp"></span></div><div class="progress hp"><i data-live="wallbar"></i></div>` +
        (mine ? '<p class="tip">Пока идёт осада, стройка и найм стоят, а доходы падают.</p>' : '') + '</div>';
    }
    if (!mine) return h + `<div class="pane" data-key="pane-foreign">${this.foreignCityHtml(c)}</div>`;
    const cons = c.construction;
    const tabs = [
      ['eco', 'Хозяйство', 'hammer', cons && cons.kind === 'building' ? '<i class="dot" title="Идёт стройка"></i>' : ''],
      ['def', 'Оборона', 'walls', cons && cons.kind !== 'building' ? '<i class="dot" title="Идёт стройка"></i>' : ''],
      ['army', 'Войска', 'swords', c.queue.length ? `<span class="badge" title="В очереди найма">${c.queue.length}</span>` : ''],
    ];
    h += '<div class="tabs ctabs" data-key="tabs" role="tablist">' + tabs.map(([v, n, ic, extra]) =>
      `<button type="button" role="tab" aria-selected="${this.cityTab === v}" data-act="tab" data-v="${v}" class="${this.cityTab === v ? 'on' : ''}">${Icons.svg(ic)}<span class="tl">${n}</span>${extra}</button>`).join('') + '</div>';
    if (cons) h += this.bannerHtml(c, pl);
    if (this.cityTab === 'eco') h += this.ecoHtml(c, pl);
    else if (this.cityTab === 'def') h += this.defHtml(c, pl);
    else h += this.armyTabHtml(c, pl);
    return h;
  }

  // Шапка: герб, имя, уровень, жители, укрепления, места, доход и влияние.
  cityHead(c, k, mine) {
    const g = this.g, L = CITY_LEVELS[c.level];
    let h = '<div class="ch" data-key="head">';
    h += `<div class="ch-top">${this.crestFor(c.owner, 44)}<div class="ch-t"><h2>${escapeHtml(c.name)}</h2><div class="sub">` +
      `<span class="lvl" title="Уровень города: ${c.level} из ${MAX_CITY_LEVEL}">${ROMAN[c.level]}</span><span>${L.name}</span>` +
      (c.isCapital ? `<span class="cap">${Icons.svg('crown')}столица</span>` : '') +
      `<span class="kn"${k ? ` style="color:${k.dark}"` : ''}>${k ? escapeHtml(k.name) : 'вольный город'}</span></div></div></div>`;
    h += `<div class="ch-row"><div class="ch-pop" title="Жители и предел для этого уровня города">${Icons.svg('people')}<b data-live="pop"></b><span class="bar"><i data-live="popbar"></i></span></div>` +
      `<span class="chip" title="${c.walls ? 'Стены: ' + WALLS[c.walls].name : 'Стен нет'}">${Icons.svg('walls')}${this.dots('pips', c.walls, WALLS.length - 1)}</span>` +
      `<span class="chip" title="${c.towers ? 'Башни: ' + TOWERS[c.towers].name : 'Башен нет'}">${Icons.svg('towers')}${this.dots('pips', c.towers, TOWERS.length - 1)}</span>`;
    if (mine) {
      const used = g.usedSlots(c);
      h += `<span class="chip${used >= L.slots ? ' full' : ''}" title="Места под здания: занято ${used} из ${L.slots}">${Icons.svg('hammer')}${this.dots('slots', used, L.slots)}<b>${used}/${L.slots}</b></span>`;
    }
    h += '</div>';
    const inf = this.influence(c);
    if (mine || inf) {
      h += '<div class="ch-row ch-inc">';
      if (mine) {
        const inc = g.cityIncome(c, k);
        h += '<span class="lbl">Доход/мин</span>';
        for (const r of RES_IDS) {
          const v = Math.round(inc[r]);
          if (v) h += `<span class="rate${v < 0 ? ' neg' : ''}" title="${RES_BY_ID[r].name}: ${fmtRate(v)} в минуту"><span class="ri r-${r}">${Icons.svg(r)}</span>${fmtRate(v)}</span>`;
        }
      }
      if (inf) {
        h += `<button type="button" class="chip infl${this.inflOpen ? ' on' : ''}" data-act="infl" aria-expanded="${this.inflOpen}" title="Влияние: сколько земли держит город">` +
          `${Icons.svg('influence')}<span>Влияние</span><b>${inf.tiles}</b><small>кл.</small><i class="chev"></i></button>`;
      }
      h += '</div>';
      if (inf && this.inflOpen) h += this.inflHtml(inf);
    }
    return h + '</div>';
  }

  // Влияние города от g.cityInfluence (если игра его считает): { tiles, radius, parts: [[подпись, вклад]] }.
  influence(c) {
    const g = this.g;
    if (typeof g.cityInfluence !== 'function') return null;
    let r;
    try { r = g.cityInfluence(c); } catch (e) { return null; }
    if (r === null || r === undefined || r === false) return null;
    let tiles = null, radius = null;
    const parts = [];
    if (typeof r === 'number') parts.push(['сила', r]);
    else if (typeof r === 'object') {
      for (const key of ['tiles', 'cells', 'area', 'count', 'size']) if (typeof r[key] === 'number') { tiles = Math.round(r[key]); break; }
      if (typeof r.radius === 'number') radius = r.radius;
      const src = r.parts || r.breakdown || r.terms || r.factors || r;
      if (Array.isArray(src)) {
        for (const p of src) {
          if (!p) continue;
          const v = typeof p.value === 'number' ? p.value : p.v;
          if (typeof v === 'number') parts.push([String(p.name || p.label || p.key || ''), v]);
        }
      } else if (typeof src === 'object') {
        for (const [name, keys] of INFL_PARTS) for (const key of keys) if (typeof src[key] === 'number') { parts.push([name, src[key]]); break; }
      }
    }
    if (tiles === null) { tiles = 0; const t = c.tiles || {}; for (let i = 0; i < TERRAIN.length; i++) tiles += t[i] || 0; }
    return { tiles, radius, parts };
  }
  inflHtml(inf) {
    let h = `<div class="infl-d"><div class="infl-t">${Icons.svg('influence')}<b>Влияние: ${fmtInt(inf.tiles)} ${plural(inf.tiles, 'клетка', 'клетки', 'клеток')}</b>` +
      (inf.radius !== null ? `<span class="muted">радиус ${fmtSigned(inf.radius).slice(1)}</span>` : '') + '</div>';
    if (inf.parts.length) h += '<div class="infl-parts">' + inf.parts.map(([n, v]) => `<span class="ip${v < 0 ? ' neg' : ''}">${escapeHtml(n)} <b>${fmtSigned(v)}</b></span>`).join('') + '</div>';
    return h + '<p class="tip">Земли города растут с его уровнем, населением и гарнизоном; свои армии рядом их укрепляют, вражеские — теснят.</p></div>';
  }

  // Баннер текущей стройки над вкладками.
  bannerHtml(c, pl) {
    const b = c.construction;
    const art = b.kind === 'building' ? b.id : b.kind === 'walls' ? (b.to >= 2 ? 'walls' : 'palisade') : b.kind;
    const what = b.kind === 'level' ? 'Уровень города: ' + b.name : b.name + (b.kind === 'building' ? ' · ' + b.to + ' ур.' : '');
    return `<div class="cbanner${c.siegeBy ? ' paused' : ''}" data-key="banner"><div class="art-f">${Icons.art(art, pl.color)}</div>` +
      `<div class="cb-main"><div class="cb-k">${c.siegeBy ? 'Стройка стоит: осада' : 'Идёт стройка'}</div>` +
      `<div class="cb-t"><b>${escapeHtml(what)}</b><span class="cb-time">${Icons.svg('hourglass')}<span data-live="buildleft"></span></span></div>` +
      '<div class="progress anim"><i data-live="build"></i></div></div>' +
      '<button class="act ghost cb-cancel" type="button" data-act="cancel" title="Отменить стройку: вернётся 75% затрат">Отменить<small>(вернётся 75%)</small></button></div>';
  }

  // ---------- вкладка «Хозяйство» ----------
  ecoHtml(c, pl) {
    let h = '<div class="pane" data-key="pane-eco">';
    for (const [title, ids] of BUILD_GROUPS) {
      h += `<h5 class="sec">${title}</h5><div class="bcards">`;
      for (const bid of ids) h += this.buildCard(c, pl, bid);
      h += '</div>';
    }
    return h + '</div>';
  }
  buildCard(c, pl, bid) {
    const b = BUILDINGS[bid], lv = c.buildings[bid] || 0;
    const info = this.g.buildInfo(c, 'building', bid);
    const cons = !!(c.construction && c.construction.kind === 'building' && c.construction.id === bid);
    const key = 'b-' + bid;
    let h = `<div class="bcard${cons ? ' busy' : !info ? ' max' : ''}${this.isFlash(c, key) ? ' flash' : ''}" data-key="${key}">`;
    h += `<div class="bc-head"><div class="art-f">${Icons.art(bid, pl.color)}${this.terrainBadge(c, bid)}</div>` +
      `<div class="bc-t"><h4 title="${escapeHtml(b.desc)}">${b.name}</h4>${this.dots('lv', lv, b.max, cons)}</div></div>`;
    h += `<div class="eff">${this.buildEff(c, bid, lv, cons ? lv + 1 : info ? info.to : 0)}</div>`;
    h += this.buildFoot(c, pl, 'building', bid, info, cons, lv ? 'Улучшить' : 'Построить');
    return h + '</div>';
  }
  // Низ карточки: ход стройки, предел или стоимость с кнопкой.
  buildFoot(c, pl, kind, id, info, cons, label) {
    if (cons) return `<div class="bc-prog"><div class="progress anim"><i data-live="build"></i></div><span class="bc-left">${Icons.svg('hourglass')}<span data-live="buildleft"></span></span></div>`;
    if (!info) return `<div class="bc-max">${Icons.svg('check')}Высший уровень</div>`;
    return `<div class="cost">${this.costHtml(pl, info.cost, info.time)}</div>` + this.buildBtn(c, pl, kind, id, info, label);
  }
  // Кнопка стройки; если нельзя — на ней понятная причина.
  buildBtn(c, pl, kind, id, info, label) {
    const block = this.g.buildBlock(c, kind, id);
    const attrs = `type="button" data-act="build" data-kind="${kind}"${id ? ` data-id="${id}"` : ''}`;
    if (!block) return `<button class="act build" ${attrs}>${Icons.svg('up')}<span>${label}</span></button>`;
    let why, ic = 'lock', cls = 'lock', extra = '';
    if (info.block) {
      why = info.block.split(':')[0];
      if (/мест/.test(info.block) && CITY_LEVELS[c.level].up) extra = '<button class="link" type="button" data-act="tab" data-v="def">Повысить уровень города ›</button>';
    } else if (c.siegeBy) { why = 'Город в осаде'; ic = 'swords'; }
    else if (c.construction) { why = 'Идёт другая стройка'; ic = 'hourglass'; cls = 'wait'; }
    else if (this.lacking(pl, info.cost).length) { why = this.lackText(pl, info.cost); cls = 'lack'; }
    else why = escapeHtml(block);
    return `<button class="act build ${cls}" ${attrs} disabled title="${escapeHtml(block)}">${Icons.svg(ic)}<span>${why}</span></button>${extra}`;
  }
  // Значок богатства округи на иллюстрации: во сколько раз местность меняет выход.
  terrainBadge(c, bid) {
    if (!BUILDINGS[bid].terrain) return '';
    const tf = this.g.terrainFactor(c, bid), v = tf.toFixed(1).replace('.', ',');
    const cls = tf < 0.55 ? 'bad' : tf > 1.15 ? 'good' : '';
    const word = tf < 0.55 ? 'бедная' : tf > 1.15 ? 'богатая' : 'обычная';
    return `<span class="tb ${cls}" title="Местность вокруг города ${word}: выход ×${v}">×${v}</span>`;
  }
  // Действие здания на уровне lv: { v, u, x, xv } — основное число, единица и добавка.
  bEffect(c, bid, lv) {
    const b = BUILDINGS[bid];
    if (bid === 'market') return { v: '+' + b.yield.gold * lv, u: 'золота/мин', x: 'налоги', xv: '+' + Math.round(b.taxBonus * 100 * lv) + '%' };
    if (b.yield) { const r = Object.keys(b.yield)[0]; return { v: '+' + Math.round(b.yield[r] * lv * this.g.terrainFactor(c, bid)), u: RES_BY_ID[r].gen + '/мин' }; }
    if (b.convert) { const cv = b.convert; return { v: '+' + cv.output.gold * lv, u: 'золота/мин', x: 'сырьё', xv: `−${cv.input.wood * lv} дер., −${cv.input.iron * lv} жел.` }; }
    return null;
  }
  // Строка «сейчас → после улучшения».
  buildEff(c, bid, lv, to) {
    if (UNLOCKS[bid]) {
      const us = UNLOCKS[bid], have = us.slice(0, lv).filter(Boolean), nx = to ? us[to - 1] : null;
      let h = have.length ? '' : '<span class="k">Откроет</span>';
      h += have.map(u => this.unitTag(u)).join('');
      if (nx) h += (have.length ? '<i class="arr">→</i>' : '') + this.unitTag(nx, true);
      return h;
    }
    const now = lv ? this.bEffect(c, bid, lv) : null, nx = to ? this.bEffect(c, bid, to) : null;
    const e = nx || now;
    if (!e) return '';
    const pair = (a, b) => a && b ? `<span class="now">${a}</span><i class="arr">→</i><b>${b}</b>` : `<b>${b || a}</b>`;
    let h = (now ? '' : '<span class="k">Даст</span>') + pair(now && now.v, nx && nx.v) + ` <span class="u">${e.u}</span>`;
    if (e.x) h += `<span class="eff2">${e.x} ${pair(now && now.xv, nx && nx.xv)}</span>`;
    return h;
  }
  unitTag(u, isNew) { return `<span class="utag${isNew ? ' new' : ''}" title="${UNITS[u].name}">${Icons.svg(u)}${UNITS[u].name.toLowerCase()}</span>`; }

  // ---------- вкладка «Оборона» ----------
  defHtml(c, pl) {
    let h = '<div class="pane" data-key="pane-def"><div class="dcards">';
    for (const kind of ['level', 'walls', 'towers']) h += this.defCard(c, pl, kind);
    h += '</div><p class="tip">При осаде горожане берутся за оружие. Пока целы стены и в гарнизоне есть воины, город не взять. Повреждённые стены чинятся сами.</p>';
    return h + '</div>';
  }
  defCard(c, pl, kind) {
    const info = this.g.buildInfo(c, kind);
    const cons = !!(c.construction && c.construction.kind === kind);
    const pct = v => '+' + Math.round(v * 100) + '%';
    let art, title, cur, lv, max, rows;
    if (kind === 'level') {
      const L = CITY_LEVELS[c.level], N = CITY_LEVELS[c.level + 1];
      art = 'level'; title = 'Уровень города'; cur = L.name; lv = c.level; max = MAX_CITY_LEVEL;
      rows = [['Жителей до', fmtInt(L.popMax), N && fmtInt(N.popMax)], ['Мест под здания', L.slots, N && N.slots], ['Влияние, клеток', inflBase(c.level), N && inflBase(c.level + 1)]];
    } else if (kind === 'walls') {
      const w0 = WALLS[c.walls], w1 = WALLS[c.walls + 1];
      art = (w1 ? c.walls + 1 : c.walls) >= 2 ? 'walls' : 'palisade'; title = 'Стены'; cur = w0 ? w0.name : 'Стен нет'; lv = c.walls; max = WALLS.length - 1;
      rows = [['Прочность', w0 ? fmtInt(w0.hp) : '—', w1 && fmtInt(w1.hp)], ['Защита гарнизона', w0 ? pct(w0.bonus) : '—', w1 && pct(w1.bonus)]];
    } else {
      const t0 = TOWERS[c.towers], t1 = TOWERS[c.towers + 1];
      art = 'towers'; title = 'Башни'; cur = t0 ? t0.name : 'Башен нет'; lv = c.towers; max = TOWERS.length - 1;
      rows = [['Урон по осаждающим', t0 ? t0.dps + ' в с' : '—', t1 && t1.dps + ' в с']];
    }
    const key = 'd-' + kind;
    let h = `<div class="bcard dcard${cons ? ' busy' : !info ? ' max' : ''}${this.isFlash(c, key) ? ' flash' : ''}" data-key="${key}">`;
    h += `<div class="art-f">${Icons.art(art, pl.color)}</div><div class="dc-main">`;
    h += `<div class="bc-t"><h4>${title}</h4>${this.dots('lv', lv, max, cons)}</div>`;
    h += `<div class="dc-cur">${cur}${info ? `<i class="arr">→</i><b>${info.name}</b>` : ''}</div>`;
    h += '<table class="cmp"><tbody>' + rows.map(([n, a, b]) => b
      ? `<tr><td class="k">${n}</td><td class="now">${a}</td><td class="arr">→</td><td class="nx${String(a) === String(b) ? ' same' : ''}">${b}</td></tr>`
      : `<tr><td class="k">${n}</td><td class="now"></td><td class="arr"></td><td class="nx same">${a}</td></tr>`).join('') + '</tbody></table>';
    if (kind === 'walls' && c.walls) h += '<div class="hpline"><span>Стены сейчас</span><span data-live="wallhp"></span></div><div class="progress hp"><i data-live="wallbar"></i></div>';
    h += `</div><div class="dc-foot">${this.buildFoot(c, pl, kind, null, info, cons, 'Улучшить')}</div>`;
    return h + '</div>';
  }

  // ---------- вкладка «Войска» ----------
  armyTabHtml(c, pl) {
    let h = '<div class="pane" data-key="pane-army">';
    if (c.queue.length) h += this.queueHtml(c, pl);
    h += this.garrisonHtml(c);
    h += '<h5 class="sec">Найм отрядов</h5><div class="bcards">';
    for (const uid of UNIT_ORDER) h += this.unitCard(c, pl, uid);
    return h + '</div></div>';
  }
  queueHtml(c, pl) {
    const q = c.queue[0], u = UNITS[q.unit];
    let h = `<div class="box queue" data-key="queue"><div class="box-h"><h4>${Icons.svg('hourglass')} Очередь найма</h4><span class="muted">${c.queue.length} из 8 · всего <span data-live="qtotal"></span></span></div>`;
    h += `<div class="q-now">${this.portrait(q.unit, pl, 44)}<div class="q-main"><div class="q-t"><b>${u.name}</b>` +
      (c.siegeBy ? '<span class="muted">стоит: осада</span>' : `<span class="muted">${Icons.svg('hourglass')}<span data-live="qleft"></span></span>`) +
      '</div><div class="progress anim"><i data-live="queue"></i></div></div></div>';
    if (c.queue.length > 1) h += '<div class="q-next"><span class="muted">Дальше</span>' + c.queue.slice(1).map(x => `<span class="q-slot" title="${UNITS[x.unit].name}">${this.portrait(x.unit, pl, 30)}</span>`).join('') + '</div>';
    return h + '</div>';
  }
  garrisonHtml(c) {
    let h = `<div class="box garr" data-key="garr"><div class="box-h"><h4>${Icons.svg('shield')} Гарнизон</h4><span class="muted" data-live="garmen"></span></div>`;
    h += this.unitsHtml(c.garrison);
    const keys = UNIT_ORDER.filter(u => c.garrison[u] > 0);
    if (keys.length) {
      if (this.formFor !== 'city' + c.id) { this.formFor = 'city' + c.id; this.form = {}; }
      if (this.formOpen) {
        h += '<div class="steps">';
        for (const u of keys) {
          const n = this.form[u] !== undefined ? this.form[u] : c.garrison[u];
          h += `<div class="step"><span>${Icons.svg(u)} ${UNITS[u].name}</span><button type="button" data-act="step" data-u="${u}" data-v="none">0</button><button type="button" data-act="step" data-u="${u}" data-v="-1">−</button><span class="n">${n}</span><button type="button" data-act="step" data-u="${u}" data-v="1">+</button></div>`;
        }
        h += '</div><div class="btnrow"><button class="act" type="button" data-act="form" data-v="sel">Вывести выбранных</button><button class="act ghost" type="button" data-act="form" data-v="all">Вывести всех</button>' +
          `<button class="act ghost icon" type="button" data-act="formopen" title="Свернуть выбор" aria-label="Свернуть выбор">${Icons.svg('close')}</button></div>`;
      } else {
        h += `<div class="btnrow"><button class="act" type="button" data-act="form" data-v="all">${Icons.svg('flag')}Вывести всех</button><button class="act ghost" type="button" data-act="formopen">Выбрать отряды…</button></div>`;
      }
    }
    return h + '</div>';
  }
  unitCard(c, pl, uid) {
    const g = this.g, u = UNITS[uid], info = g.recruitInfo(c, uid), block = g.recruitBlock(c, uid);
    const locked = !!(u.need && (c.buildings[u.need[0]] || 0) < u.need[1]);
    const inQ = c.queue.filter(q => q.unit === uid).length;
    const num = v => String(v).replace('.', ',');
    let sub = u.squad > 1 ? u.squad + ' бойцов' : '1 машина';
    if (u.ranged) sub += ' · стрелки';
    if (u.speed >= 1.4) sub += ' · быстрые';
    let h = `<div class="bcard ucard${locked ? ' locked' : ''}" data-key="u-${uid}">`;
    h += `<div class="bc-head"><div class="art-f pf">${this.portrait(uid, pl, 52)}${inQ ? `<span class="qb" title="В очереди найма">×${inQ}</span>` : ''}</div>` +
      `<div class="bc-t"><h4 title="${escapeHtml(u.desc)}">${u.name}</h4><span class="muted">${sub}</span></div></div>`;
    h += `<div class="ustats"><span title="Атака">${Icons.svg('swords')}<b>${num(u.atk)}</b></span><span title="Защита">${Icons.svg('shield')}<b>${num(u.def)}</b></span>` +
      `<span title="Здоровье бойца">${Icons.svg('heart')}<b>${num(u.hp)}</b></span>${u.siege >= 1 ? `<span title="Урон стенам">${Icons.svg('walls')}<b>${num(u.siege)}</b></span>` : ''}</div>`;
    h += `<div class="vs">${this.strongHtml(u)}</div>`;
    h += `<div class="cost">${this.costHtml(pl, info.cost, info.time, info.pop)}</div>`;
    let why = null, cls = 'lock', ic = 'lock';
    if (block) {
      if (info.block) why = info.block;
      else if (c.queue.length >= 8) { why = 'Очередь полна'; cls = 'wait'; ic = 'hourglass'; }
      else if (this.lacking(pl, info.cost).length) { why = this.lackText(pl, info.cost); cls = 'lack'; }
      else why = escapeHtml(block);
    }
    h += why
      ? `<button class="act build ${cls}" type="button" data-act="recruit" data-id="${uid}" disabled title="${escapeHtml(block)}">${Icons.svg(ic)}<span>${why}</span></button>`
      : `<button class="act build" type="button" data-act="recruit" data-id="${uid}">${Icons.svg('plus')}<span>Нанять</span></button>`;
    return h + '</div>';
  }
  // Против кого силён род войск.
  strongHtml(u) {
    const vs = Object.keys(u.bonus || {});
    if (vs.length) return '<span class="k">Силён против</span>' + vs.map(t => `<span class="vsu" title="${UNITS[t].name}: урон ×${String(u.bonus[t]).replace('.', ',')}">${Icons.svg(t)}</span>`).join('');
    if (u.siege >= 1) return `<span class="k">Силён против</span><span class="vsu" title="Рушит стены">${Icons.svg('walls')}</span><span class="k">стен</span>`;
    if (u.vision) return '<span class="k">Видит вдвое дальше других</span>';
    return '<span class="k">Дёшево, нанимается везде</span>';
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
    h += '<div class="tabs">' + tabs.map(([v, n]) => `<button type="button" data-act="ktab" data-v="${v}" class="${this.kTab === v ? 'on' : ''}">${n}</button>`).join('') + '</div>';
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

  // живые значения панели обновляются каждый кадр без перерисовки кнопок; DOM трогаем, только если число изменилось
  updateLive() {
    const g = this.g, s = this.sel;
    if (!s) return;
    const body = $('panel-body');
    const c = s.kind === 'city' ? g.city(s.id) : null;
    const a = s.kind === 'army' ? g.army(s.id) : null;
    const text = (el, v) => { v = String(v); if (el.textContent !== v) el.textContent = v; };
    const width = (el, f) => { const v = (f > 0 ? Math.min(100, f * 100).toFixed(1) : '0') + '%'; if (el.style.width !== v) el.style.width = v; };
    let inc = null;
    for (const el of body.querySelectorAll('[data-live]')) {
      const key = el.dataset.live;
      switch (key) {
        case 'pop': text(el, c ? fmtInt(c.pop) + ' / ' + fmtInt(CITY_LEVELS[c.level].popMax) : ''); break;
        case 'popbar': width(el, c ? c.pop / CITY_LEVELS[c.level].popMax : 0); break;
        case 'build': width(el, c && c.construction ? c.construction.t / c.construction.total : 0); break;
        case 'buildleft': text(el, c && c.construction ? fmtTime(c.construction.total - c.construction.t) : ''); break;
        case 'queue': width(el, c && c.queue.length ? c.queue[0].t / c.queue[0].total : 0); break;
        case 'qleft': text(el, c && c.queue.length ? fmtTime(c.queue[0].total - c.queue[0].t) : ''); break;
        case 'qtotal': { let t = 0; if (c) for (const q of c.queue) t += q.total - q.t; text(el, fmtTime(t)); break; }
        case 'need': text(el, fmtInt(Math.max(1, Math.ceil(+el.dataset.n - (g.player.res[el.dataset.r] || 0))))); break;
        case 'wallhp': text(el, c && c.walls ? fmtInt(c.wallHp) + ' / ' + fmtInt(WALLS[c.walls].hp) : ''); break;
        case 'wallbar': width(el, c && c.walls ? c.wallHp / WALLS[c.walls].hp : 0); break;
        case 'garmen': text(el, c ? menCount(c.garrison) + ' чел.' : ''); break;
        case 'astatus': text(el, a ? this.armyStatus(a) : ''); break;
        case 'amen': text(el, a ? fmtInt(menCount(a.units)) : ''); break;
        case 'apower': text(el, a ? Math.round(unitPower(a.units)) : ''); break;
        case 'amorale': text(el, a ? Math.round(a.morale) + '%' : ''); break;
        case 'amoralebar': width(el, a ? a.morale / 100 : 0); break;
        default:
          if (key.startsWith('inc-')) {
            if (!inc) inc = g.income(g.player);
            const [, part, r] = key.split('-');
            const v = part === 'total' ? inc.total[r] : inc.parts[part][r];
            text(el, Math.abs(v) < 0.5 ? '—' : fmtRate(v));
            const cls = 'num ' + (v < -0.5 ? 'neg' : v > 0.5 && part === 'total' ? 'pos' : '');
            if (el.className !== cls) el.className = cls;
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
    else if (type === 'built' && d.city.owner === this.g.player.id) {
      Sfx.play('done');
      // готовая постройка коротко вспыхивает в меню города
      const b = d.build;
      this.flash = { city: d.city.id, key: b.kind === 'building' ? 'b-' + b.id : 'd-' + b.kind, until: performance.now() + 1500 };
    }
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
