'use strict';
// Дивизии и линии фронта (как в HOI4): шаблоны дивизий, армии из дивизий, фронт по границе и нарисованный
// фронт, оборона с окапыванием и наступление по секторам. Каждая армия в g.armies — дивизия (поля org, xp,
// entrench, tpl, front, group); бои и осады многодивизионные (js/game.js). Логика работает и в Node
// (tools/load.js); интерфейс, слой фронтов и инструменты ввода — в конце файла, только в браузере.

const DIV = {
  think: 0.5,         // раз в столько секунд — организованность, окапывание, приказы фронтов
  orgRest: 2.5,       // восстановление org в секунду: в покое,
  orgMarch: 1.0,      // на марше,
  orgSiege: 0.4,      // в осаде
  orgUnpaid: 1.5,     // убыль org в секунду, когда нет жалованья или еды
  orgFloor: 10,
  orgWin: 10,         // победителям после боя
  routOrg: 20,        // при org ниже — дивизия выходит из боя и отходит
  orgLossK: 150,      // потеря org за долю павших от численности при вступлении в бой
  orgLossSiege: 110,
  orgFatigue: 0.8,    // и в каждую секунду боя
  attackOrg: 40,      // на фронте с org ниже наступать не идут — встают в линию
  digTime: 40,        // секунд на полное окапывание
  digDef: 0.25,       // полное окапывание: защита +25%
  xpBattle: 0.35,     // опыт в секунду боя
  xpWin: 6,
  xpMax: 100,
  xpAtk: 0.25,        // полный опыт: урон +25%
  flankWide: 2.6,     // охват (радианы вокруг противника), с которого удар с нескольких сторон даёт полный бонус
  flankBonus: 0.25,
  join: 1.5,          // радиус, в котором соседние дивизии втягиваются в бой
  fallback: 2.5,      // на сколько клеток отходит разбитая дивизия
  retreatImmune: 8,
  maxMen: 150,        // предел размера своего шаблона
  minMen: 10,
  minMixed: 30,       // меньше — остаток гарнизона не выводится отдельной дивизией, а добавляется к последней
  queueMax: 24,       // очередь найма при обучении дивизии
  spacing: 1.25,      // разнос дивизий в строю армии
  frontGap: 0.7,      // на сколько клеток позади линии фронта стоят дивизии
  slotGap: 1.1,       // расстояние между соседними дивизиями вдоль линии; на короткой линии встают вторым рядом
  rowGap: 0.95,       // и вторым, третьим рядом — на столько глубже
  borderEvery: 3,     // раз в столько секунд перестраиваем фронт по границе (если земли сдвинулись)
  reach: 14,          // насколько глубоко за линией ищем цели наступления
  engage: 3.2,        // вражеская дивизия ближе — цель удара
  reorder: 2,         // не чаще, чем раз в столько секунд, фронт переотдаёт приказ дивизии
  playerNeed: 0.7,    // наступление игрока идёт на город, если сила сектора не меньше этой доли его обороны
  garrisonShare: 0.3, // доля воинов, остающихся гарнизоном во взятом городе
};

// Встроенные шаблоны дивизий: состав в воинах (у машин — штуки), значок — род войск.
const DIV_TEMPLATES = [
  { id: 'militia', name: 'Ополчение', div: 'дивизия ополчения', icon: 'militia', units: { militia: 80 } },
  { id: 'inf', name: 'Пехотная', div: 'пехотная дивизия', icon: 'spear', units: { spear: 50, sword: 30, archer: 20 } },
  { id: 'rifle', name: 'Стрелковая', div: 'стрелковая дивизия', icon: 'archer', units: { archer: 50, crossbow: 20, spear: 30 } },
  { id: 'horse', name: 'Конная', div: 'конная дивизия', icon: 'cavalry', units: { cavalry: 60, scout: 10 } },
  { id: 'knights', name: 'Рыцарская', div: 'рыцарская дивизия', icon: 'knight', units: { knight: 40, cavalry: 30, crossbow: 20 } },
  { id: 'siege', name: 'Осадная', div: 'осадная дивизия', icon: 'catapult', units: { ram: 2, catapult: 2, spear: 40, archer: 30 } },
];
// Цвета стягов армий.
const GROUP_COLORS = ['#d7a944', '#b8442f', '#4f86c6', '#5a9a3c', '#8a58b8', '#2f9a96', '#c8702c', '#8b8b8b'];
const ORD_WORDS = ['Первая', 'Вторая', 'Третья', 'Четвёртая', 'Пятая', 'Шестая', 'Седьмая', 'Восьмая', 'Девятая', 'Десятая'];

const Fronts = {
  fresh() {
    return { tpls: {}, tplN: 0, groups: [], grpN: {}, divN: {}, lineN: {}, fronts: [], t: 0, bt: 0, ct: 0, rt: new Map(), og: null, ogKey: '', pace: {} };
  },
  state(g) { return g.fr || (g.fr = this.fresh()); },
  ordWord(n) { return ORD_WORDS[n - 1] || n + '-я'; },

  // ---------- шаблоны ----------
  templates(g, kid) {
    const own = this.state(g).tpls[kid];
    return own && own.length ? DIV_TEMPLATES.concat(own) : DIV_TEMPLATES;
  },
  tpl(g, kid, id) {
    if (!id) return null;
    for (const t of DIV_TEMPLATES) if (t.id === id) return t;
    const own = this.state(g).tpls[kid];
    if (own) for (const t of own) if (t.id === id) return t;
    return null;
  },
  isCustom(id) { return !!id && id.charAt(0) === 'c' && /^c\d+$/.test(id); },
  fits(units, need) { for (const u in need) if ((units[u] || 0) < need[u]) return false; return true; },
  lacking(units, need) {
    const out = {};
    for (const u in need) { const n = need[u] - (units[u] || 0); if (n > 0) out[u] = n; }
    return out;
  },
  // Главный род войск дивизии (по числу воинов, машины весомее) — его значком она обозначена на карте.
  mainUnit(units) {
    let best = 'militia', bm = -1;
    for (const u of UNIT_ORDER) {
      const n = units[u] || 0;
      if (!n) continue;
      const m = n * (UNITS[u].crew || 1) * (UNITS[u].squad === 1 ? 3 : 1);
      if (m > bm) { bm = m; best = u; }
    }
    return best;
  },
  icon(g, a) {
    const t = this.tpl(g, a.owner, a.tpl);
    return t ? t.icon : this.mainUnit(a.units);
  },
  tplName(g, a) {
    const t = this.tpl(g, a.owner, a.tpl);
    return t ? t.name : 'Сводная';
  },
  // Какому шаблону соответствует состав: те же роды войск, каждого от половины до полутора по шаблону.
  guessTpl(g, kid, units) {
    let best = null, bs = Infinity;
    for (const t of this.templates(g, kid)) {
      let ok = true, s = 0;
      for (const u in units) if (units[u] > 0 && !t.units[u]) { ok = false; break; }
      if (!ok) continue;
      for (const u in t.units) {
        const r = (units[u] || 0) / t.units[u];
        if (r < 0.5 || r > 1.5) { ok = false; break; }
        s += Math.abs(1 - r);
      }
      if (ok && s < bs) { bs = s; best = t.id; }
    }
    return best;
  },
  // Свой шаблон: { id?, name, units }; предел — DIV.maxMen воинов.
  saveTemplate(g, kid, data) {
    const st = this.state(g);
    const units = {};
    for (const u in data.units) if (UNITS[u] && data.units[u] > 0) units[u] = Math.round(data.units[u]);
    const men = menCount(units);
    if (men < DIV.minMen) return 'В шаблоне слишком мало воинов';
    if (men > DIV.maxMen) return 'Не больше ' + DIV.maxMen + ' воинов в дивизии';
    const list = st.tpls[kid] || (st.tpls[kid] = []);
    let t = data.id ? list.find(x => x.id === data.id) : null;
    if (!t) { t = { id: 'c' + (++st.tplN), name: '', icon: 'militia', units: {} }; list.push(t); }
    t.name = String(data.name || '').trim().slice(0, 24) || 'Шаблон ' + st.tplN;
    t.units = units;
    t.icon = this.mainUnit(units);
    return t;
  },
  deleteTemplate(g, kid, id) {
    const list = this.state(g).tpls[kid];
    if (!list) return;
    const i = list.findIndex(t => t.id === id);
    if (i >= 0) list.splice(i, 1);
  },

  // ---------- дивизии ----------
  divName(g, owner, tplId) {
    const st = this.state(g);
    const n = st.divN[owner] = (st.divN[owner] || 0) + 1;
    const t = this.tpl(g, owner, tplId);
    if (!t) return n + '-я сводная дивизия';
    return t.div ? n + '-я ' + t.div : n + '-я дивизия «' + t.name + '»';
  },
  // Сформировать дивизию по шаблону из гарнизона.
  form(g, c, tplId) {
    const t = this.tpl(g, c.owner, tplId);
    if (!t) return 'Нет такого шаблона';
    if (!this.fits(c.garrison, t.units)) return 'В гарнизоне не хватает воинов';
    return g.formArmy(c, t.units, t.id) || 'В гарнизоне не хватает воинов';
  },
  // «Вывести всех»: дивизии по лучшим подходящим шаблонам, остаток — сводной дивизией.
  formAll(g, c) {
    const out = [];
    const tpls = this.templates(g, c.owner).slice().sort((p, q) => unitPower(q.units) - unitPower(p.units));
    for (let guard = 0; guard < 12; guard++) {
      const t = tpls.find(x => this.fits(c.garrison, x.units));
      if (!t) break;
      const a = g.formArmy(c, t.units, t.id);
      if (!a) break;
      out.push(a);
    }
    const rest = menCount(c.garrison);
    if (rest > 0) {
      if (rest >= DIV.minMixed || !out.length) {
        const a = g.formArmy(c, { ...c.garrison });
        if (a) out.push(a);
      } else {
        const last = out[out.length - 1], take = { ...c.garrison };
        addUnits(c.garrison, take, -1);
        c.wounds = {};
        addUnits(last.units, take);
        last.tpl = this.guessTpl(g, last.owner, last.units) || last.tpl;
      }
    }
    // дивизии встают у города веером, а не в одну точку
    out.forEach((a, i) => {
      if (i === 0) return;
      const ang = i * 2.4, tx = c.x + 0.5 + Math.cos(ang) * 0.9, ty = c.y + 0.5 + Math.sin(ang) * 0.9;
      const ti = g.world.tileAt(tx, ty);
      if (ti >= 0 && g.world.passable(ti)) { a.x = tx; a.y = ty; }
    });
    return out;
  },
  // План обучения дивизии в городе: каких отрядов не хватает (с учётом гарнизона, очереди найма
  // и прежних заказов), сколько это стоит и что мешает.
  trainPlan(g, c, tplId) {
    const t = this.tpl(g, c.owner, tplId), k = g.kingdom(c.owner);
    const out = { list: [], cost: {}, pop: 0, time: 0, block: null };
    if (!t || !k) { out.block = 'Нет такого шаблона'; return out; }
    const have = { ...c.garrison };
    for (const q of c.queue) have[q.unit] = (have[q.unit] || 0) + UNITS[q.unit].squad;
    for (const id of c.divQueue || []) { const o = this.tpl(g, c.owner, id); if (o) addUnits(have, o.units, -1); }
    const miss = this.lacking(have, t.units);
    for (const u of UNIT_ORDER) {
      if (!miss[u]) continue;
      const info = g.recruitInfo(c, u);
      if (info.block && info.block !== 'Мало жителей') { out.block = info.block; continue; }
      const n = Math.ceil(miss[u] / UNITS[u].squad);
      for (let i = 0; i < n; i++) {
        out.list.push(u);
        for (const r in info.cost) out.cost[r] = (out.cost[r] || 0) + info.cost[r];
        out.pop += info.pop;
        out.time += info.time;
      }
    }
    if (!out.block && c.queue.length + out.list.length > DIV.queueMax) out.block = 'Очередь найма переполнена';
    if (!out.block && out.list.length && c.pop - out.pop < 60) out.block = 'Мало жителей';
    return out;
  },
  // Обучить дивизию: недостающие отряды встают в очередь найма, по готовности дивизия формируется сама.
  train(g, c, tplId) {
    const k = g.kingdom(c.owner);
    if (!k || !k.alive) return 'Город вам не принадлежит';
    if (c.siegeBy) return 'Город в осаде';
    const p = this.trainPlan(g, c, tplId);
    if (p.block) return p.block;
    if (!g.canAfford(k, p.cost)) return 'Не хватает: ' + g.missing(k, p.cost).join(', ');
    g.pay(k, p.cost);
    c.pop -= p.pop;
    for (const u of p.list) c.queue.push({ unit: u, t: 0, total: g.recruitTime(c, u) });
    (c.divQueue || (c.divQueue = [])).push(tplId);
    return null;
  },
  // Готовые заказы на дивизии формируются сами, как только в гарнизоне хватает воинов.
  tickTraining(g) {
    const pl = g.player;
    for (const c of g.cities) {
      const q = c.divQueue;
      if (!q || !q.length || c.siegeBy) continue;
      const t = this.tpl(g, c.owner, q[0]);
      if (!t || c.owner < 0) { q.shift(); continue; }
      if (this.fits(c.garrison, t.units)) {
        q.shift();
        const a = g.formArmy(c, t.units, t.id);
        if (a && pl && c.owner === pl.id) g.notify('В городе ' + c.name + ' сформирована ' + a.name, 'good', c);
        if (a) g.emit('divFormed', { city: c, army: a });
      } else if (!c.queue.length) {
        q.shift();
        if (pl && c.owner === pl.id) g.notify(c.name + ': на дивизию «' + t.name + '» не хватило воинов — гарнизон ушёл в поле', 'bad', c);
      }
    }
  },
  // Отряд, который дивизия оставляет гарнизоном во взятом городе.
  detachment(units) {
    const total = menCount(units), want = Math.max(10, Math.round(total * DIV.garrisonShare / 10) * 10);
    const out = {};
    let got = 0;
    for (const u of ['militia', 'spear', 'archer', 'sword', 'crossbow', 'scout', 'cavalry', 'knight']) {
      if (got >= want) break;
      const have = units[u] || 0;
      if (!have) continue;
      const sq = UNITS[u].squad;
      const n = Math.min(have, Math.ceil((want - got) / sq) * sq);
      if (n > 0) { out[u] = n; got += n; }
    }
    return out;
  },
  power(a) { return unitPower(a.units) * (0.55 + (a.org === undefined ? 100 : a.org) / 220); },

  // ---------- армии (группы дивизий) ----------
  groupsOf(g, kid) { return this.state(g).groups.filter(x => x.owner === kid); },
  group(g, id) {
    if (id === null || id === undefined) return null;
    for (const x of this.state(g).groups) if (x.id === id) return x;
    return null;
  },
  members(g, gid) { return g.armies.filter(a => a.group === gid); },
  makeGroup(g, owner, divs, name) {
    const st = this.state(g);
    const n = st.grpN[owner] = (st.grpN[owner] || 0) + 1;
    const grp = { id: g.newId(), owner, n, name: name || this.ordWord(n) + ' армия', color: GROUP_COLORS[(n - 1) % GROUP_COLORS.length] };
    st.groups.push(grp);
    for (const d of divs) d.group = grp.id;
    return grp;
  },
  disband(g, gid) {
    const st = this.state(g);
    for (const a of g.armies) if (a.group === gid) { a.group = null; a.march = false; }
    st.groups = st.groups.filter(x => x.id !== gid);
  },
  // Приказ нескольким дивизиям: в точку — строем (линия поперёк движения, с разносом), на город или
  // на врага — все вместе. Ручной приказ снимает дивизии с фронта.
  orderMany(g, divs, target) {
    const list = divs.filter(a => a.state !== 'battle' && a.state !== 'retreat');
    if (!list.length) return divs.length ? 'Дивизии в бою или отходят' : 'Нет дивизий';
    for (const a of list) a.front = null;
    const march = list.length > 1;
    if (target.kind !== 'ground' || list.length === 1) {
      let err = null, ok = 0;
      for (const a of list) { const e = g.order(a, target); if (e) err = e; else { ok++; a.march = march && a.group !== null && a.group !== undefined; } }
      return ok ? null : err;
    }
    let cx = 0, cy = 0;
    for (const a of list) { cx += a.x; cy += a.y; }
    cx /= list.length; cy /= list.length;
    let dx = target.x - cx, dy = target.y - cy;
    const L = Math.hypot(dx, dy);
    if (L < 0.5) { dx = 1; dy = 0; } else { dx /= L; dy /= L; }
    const px = -dy, py = dx, per = Math.min(5, list.length);
    list.sort((p, q) => ((p.x - cx) * px + (p.y - cy) * py) - ((q.x - cx) * px + (q.y - cy) * py));
    let ok = 0, err = null;
    const w = g.world;
    list.forEach((a, i) => {
      const row = Math.floor(i / per), col = i % per, inRow = Math.min(per, list.length - row * per);
      const off = (col - (inRow - 1) / 2) * DIV.spacing, back = row * DIV.spacing;
      let tx = target.x + px * off - dx * back, ty = target.y + py * off - dy * back;
      const ti = w.tileAt(tx, ty);
      if (ti < 0 || !w.passable(ti) || !w.main[ti]) {
        const j = w.nearestPassable(tx, ty);
        if (j >= 0 && dist(j % w.W + 0.5, Math.floor(j / w.W) + 0.5, tx, ty) < 2.5) { tx = j % w.W + 0.5; ty = Math.floor(j / w.W) + 0.5; }
        else { tx = target.x; ty = target.y; }
      }
      const e = g.order(a, { kind: 'ground', x: tx, y: ty });
      if (e) err = e; else { ok++; a.march = a.group !== null && a.group !== undefined; }
    });
    return ok ? null : err;
  },

  // ---------- фронты ----------
  frontsOf(g, kid) { return this.state(g).fronts.filter(f => f.owner === kid); },
  front(g, id) {
    if (id === null || id === undefined) return null;
    for (const f of this.state(g).fronts) if (f.id === id) return f;
    return null;
  },
  enemyName(g, id) {
    if (id === -1) return 'вольные города';
    const k = g.kingdom(id);
    return k ? k.name : '?';
  },
  // Фронт по общей границе своих земель и земель противника (enemy: держава или −1 — вольные города).
  makeBorderFront(g, owner, enemy, divs, ai) {
    const st = this.state(g);
    const f = { id: g.newId(), owner, kind: 'border', enemy, mode: 'hold', name: 'Фронт: ' + this.enemyName(g, enemy), pts: null, ai: !!ai };
    st.fronts.push(f);
    if (divs) this.assign(g, f, divs);
    this.tickFront(g, f, true);
    return f;
  },
  // Нарисованная линия фронта: pts — точки в клетках.
  makeLineFront(g, owner, pts, divs) {
    let len = 0;
    for (let i = 1; i < pts.length; i++) len += dist(pts[i - 1][0], pts[i - 1][1], pts[i][0], pts[i][1]);
    if (pts.length < 2 || len < 1.5) return 'Линия фронта слишком короткая';
    const st = this.state(g);
    const n = st.lineN[owner] = (st.lineN[owner] || 0) + 1;
    const f = { id: g.newId(), owner, kind: 'line', enemy: null, mode: 'hold', name: 'Линия фронта №' + n, pts: pts.map(p => [Math.round(p[0] * 100) / 100, Math.round(p[1] * 100) / 100]), ai: false };
    st.fronts.push(f);
    if (divs) this.assign(g, f, divs);
    this.tickFront(g, f, true);
    return f;
  },
  assign(g, f, divs) {
    for (const a of divs) {
      if (a.owner !== f.owner) continue;
      a.front = f.id; a.fT = -99; a.march = false;
    }
  },
  removeFront(g, f) {
    const st = this.state(g);
    for (const a of g.armies) if (a.front === f.id) a.front = null;
    st.fronts = st.fronts.filter(x => x !== f);
    st.rt.delete(f.id);
  },
  setMode(g, f, mode) {
    f.mode = mode === 'attack' ? 'attack' : 'hold';
    f.askT = undefined;
    for (const a of g.armies) if (a.front === f.id) a.fT = -99;
  },
  frontDivs(g, f) { return g.armies.filter(a => a.front === f.id); },
  runtime(g, f) {
    const st = this.state(g);
    let rt = st.rt.get(f.id);
    if (!rt) { rt = { key: '', lines: [], slots: new Map(), arrows: [] }; st.rt.set(f.id, rt); }
    return rt;
  },

  // Владелец каждой клетки (держава; −1 — вольный город; −2 — ничья земля). Пересчёт при смене земель.
  ownerGrid(g) {
    const st = this.state(g), key = g.territoryVersion + ':' + g.ownershipVersion;
    if (st.og && st.ogKey === key) return st.og;
    const w = g.world, n = w.W * w.H;
    const og = st.og && st.og.length === n ? st.og : new Int16Array(n);
    const own = new Map();
    for (const c of g.cities) own.set(c.id, c.owner);
    for (let i = 0; i < n; i++) {
      const cid = w.cityOf[i];
      const o = cid < 0 ? undefined : own.get(cid);
      og[i] = o === undefined ? -2 : o;
    }
    st.og = og; st.ogKey = key;
    return og;
  },
  // С кем у державы есть общая граница (для меню «фронт по границе»).
  neighbors(g, kid) {
    const og = this.ownerGrid(g), w = g.world, W = w.W, H = w.H, out = new Set();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (og[i] !== kid) continue;
      if (x + 1 < W && og[i + 1] !== kid && og[i + 1] !== -2) out.add(og[i + 1]);
      if (x > 0 && og[i - 1] !== kid && og[i - 1] !== -2) out.add(og[i - 1]);
      if (y + 1 < H && og[i + W] !== kid && og[i + W] !== -2) out.add(og[i + W]);
      if (y > 0 && og[i - W] !== kid && og[i - W] !== -2) out.add(og[i - W]);
    }
    return [...out];
  },
  // Точки границы: середины рёбер между своими клетками и клетками противника, с нормалью к своим.
  // Если земли не соприкасаются, берётся узкая ничья полоса (до трёх клеток суши).
  borderPoints(g, own, enemy) {
    const og = this.ownerGrid(g), w = g.world, W = w.W, H = w.H, pts = [];
    const D = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (og[y * W + x] !== own) continue;
      for (const [dx, dy] of D) {
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        if (og[ny * W + nx] === enemy) pts.push({ x: x + 0.5 + dx * 0.5, y: y + 0.5 + dy * 0.5, nx: -dx, ny: -dy });
      }
    }
    if (pts.length >= 3) return pts;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      if (og[y * W + x] !== own) continue;
      for (const [dx, dy] of D) {
        for (let d = 2; d <= 4; d++) {
          const nx = x + dx * d, ny = y + dy * d;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) break;
          const j = ny * W + nx, mid = (y + dy * (d - 1)) * W + x + dx * (d - 1);
          if (og[mid] !== -2 || !w.passable(mid)) break;
          if (og[j] === enemy) { pts.push({ x: x + 0.5 + dx * d / 2, y: y + 0.5 + dy * d / 2, nx: -dx, ny: -dy }); break; }
        }
      }
    }
    return pts;
  },
  // Точки границы → цепочки (жадным обходом соседей в обе стороны).
  chainPoints(pts) {
    const n = pts.length;
    if (n < 3) return [];
    const cell = new Map(), key = (x, y) => (x + 2) * 4096 + y + 2;
    pts.forEach((p, i) => { const k = key(Math.floor(p.x), Math.floor(p.y)); const l = cell.get(k); if (l) l.push(i); else cell.set(k, [i]); });
    const near = (p, r, fn) => {
      for (let gx = Math.floor(p.x - r); gx <= Math.floor(p.x + r); gx++) for (let gy = Math.floor(p.y - r); gy <= Math.floor(p.y + r); gy++) {
        const l = cell.get(key(gx, gy));
        if (l) for (const j of l) fn(j);
      }
    };
    const used = new Uint8Array(n), deg = new Int16Array(n);
    for (let i = 0; i < n; i++) near(pts[i], 1.05, j => { if (j !== i && Math.hypot(pts[j].x - pts[i].x, pts[j].y - pts[i].y) <= 1.05) deg[i]++; });
    const order = [];
    for (let i = 0; i < n; i++) order.push(i);
    order.sort((p, q) => deg[p] - deg[q] || p - q);
    const walk = (s, dirx, diry) => {
      const out = [];
      let cur = s;
      for (;;) {
        const pc = pts[cur];
        let best = -1, bs = Infinity;
        near(pc, 1.6, j => {
          if (used[j]) return;
          const dx = pts[j].x - pc.x, dy = pts[j].y - pc.y, d = Math.hypot(dx, dy);
          if (d > 1.6 || d < 1e-6) return;
          const sc = d - (dirx || diry ? 0.45 * (dx * dirx + dy * diry) / d : 0);
          if (sc < bs) { bs = sc; best = j; }
        });
        if (best < 0) break;
        used[best] = 1;
        const pb = pts[best];
        near(pb, 0.45, j => { if (!used[j] && Math.hypot(pts[j].x - pb.x, pts[j].y - pb.y) < 0.45) used[j] = 1; });
        const L = Math.hypot(pb.x - pc.x, pb.y - pc.y) || 1;
        dirx = (pb.x - pc.x) / L; diry = (pb.y - pc.y) / L;
        out.push(best);
        cur = best;
      }
      return out;
    };
    const chains = [];
    for (const s of order) {
      if (used[s]) continue;
      used[s] = 1;
      const fwd = walk(s, 0, 0);
      let back = [];
      if (fwd.length) {
        const p0 = pts[s], p1 = pts[fwd[0]], L = Math.hypot(p1.x - p0.x, p1.y - p0.y) || 1;
        back = walk(s, (p0.x - p1.x) / L, (p0.y - p1.y) / L);
      }
      const ids = back.reverse().concat([s], fwd);
      if (ids.length >= 3) chains.push(ids.map(i => pts[i]));
    }
    return chains;
  },
  // Цепочка → линия фронта: сглаженные и равномерно (через ~0,8 клетки) расставленные точки с нормалью
  // к своей стороне. side(px, py, nx, ny) → +1/−1 — голос, с какой стороны свои (для нарисованной линии).
  shapeLine(raw, voteFn) {
    let p = raw.map(q => ({ x: q.x, y: q.y }));
    for (let it = 0; it < 3 && p.length > 2; it++) {
      p = p.map((v, i) => (i === 0 || i === p.length - 1 ? v : { x: (p[i - 1].x + v.x * 2 + p[i + 1].x) / 4, y: (p[i - 1].y + v.y * 2 + p[i + 1].y) / 4 }));
    }
    let total = 0;
    for (let i = 1; i < p.length; i++) total += Math.hypot(p[i].x - p[i - 1].x, p[i].y - p[i - 1].y);
    if (total < 1.2) return null;
    const step = 0.8, n = Math.max(2, Math.round(total / step) + 1), out = [];
    let seg = 1, acc = 0;
    for (let k = 0; k < n; k++) {
      const s = total * k / (n - 1);
      while (seg < p.length - 1 && acc + Math.hypot(p[seg].x - p[seg - 1].x, p[seg].y - p[seg - 1].y) < s) { acc += Math.hypot(p[seg].x - p[seg - 1].x, p[seg].y - p[seg - 1].y); seg++; }
      const a = p[seg - 1], b = p[seg], L = Math.hypot(b.x - a.x, b.y - a.y) || 1, t = clamp((s - acc) / L, 0, 1);
      out.push({ x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, nx: 0, ny: 0, s });
    }
    for (let i = 0; i < out.length; i++) {
      const a = out[Math.max(0, i - 1)], b = out[Math.min(out.length - 1, i + 1)];
      const tx = b.x - a.x, ty = b.y - a.y, L = Math.hypot(tx, ty) || 1;
      out[i].nx = -ty / L; out[i].ny = tx / L;
    }
    // с какой стороны свои: голос исходных нормалей (граница) или проверка земель (нарисованная линия)
    let vote = 0;
    if (voteFn) for (const q of out) vote += voteFn(q.x, q.y, q.nx, q.ny);
    else {
      for (let i = 0; i < raw.length; i++) {
        const a = raw[Math.max(0, i - 1)], b = raw[Math.min(raw.length - 1, i + 1)];
        vote += -(b.y - a.y) * raw[i].nx + (b.x - a.x) * raw[i].ny;
      }
    }
    if (vote < 0) for (const q of out) { q.nx = -q.nx; q.ny = -q.ny; }
    return { pts: out, len: total };
  },
  borderLines(g, own, enemy) {
    const chains = this.chainPoints(this.borderPoints(g, own, enemy));
    const out = [];
    for (const ch of chains) { const l = this.shapeLine(ch); if (l) out.push(l); }
    return out;
  },
  lineFromPts(g, own, pts) {
    const og = this.ownerGrid(g), w = g.world;
    const at = (x, y) => { const i = w.tileAt(x, y); return i < 0 ? -3 : og[i]; };
    const cap = g.city((g.kingdom(own) || {}).capital);
    const l = this.shapeLine(pts.map(p => ({ x: p[0], y: p[1] })), (x, y, nx, ny) => {
      let v = 0;
      for (const d of [1, 2.2]) {
        if (at(x + nx * d, y + ny * d) === own) v++;
        if (at(x - nx * d, y - ny * d) === own) v--;
      }
      if (!v && cap) v = (cap.x + 0.5 - x) * nx + (cap.y + 0.5 - y) * ny > 0 ? 0.5 : -0.5;
      return v;
    });
    return l ? [l] : [];
  },
  // Ближайшая точка линий фронта: расстояние, параметр вдоль всех линий и сторона (> 0 — своя).
  nearestOn(lines, x, y) {
    let best = null, bd = Infinity, off = 0;
    for (const l of lines) {
      for (const q of l.pts) {
        const d = (q.x - x) * (q.x - x) + (q.y - y) * (q.y - y);
        if (d < bd) { bd = d; best = { q, s: off + q.s }; }
      }
      off += l.len;
    }
    if (!best) return null;
    const q = best.q;
    return { d: Math.sqrt(bd), s: best.s, side: (x - q.x) * q.nx + (y - q.y) * q.ny, q };
  },
  // n мест вдоль линий фронта, поровну по длине; каждое — чуть позади линии, на своей стороне.
  // Если линия коротка для одного ряда, часть дивизий встаёт вторым и третьим рядом глубже.
  slotsOn(g, lines, n) {
    let total = 0;
    for (const l of lines) total += l.len;
    const w = g.world, out = [];
    const perRow = Math.max(1, Math.min(n, Math.floor(total / DIV.slotGap) + 1));
    for (let i = 0; i < n; i++) {
      const row = Math.floor(i / perRow), col = i % perRow, inRow = Math.min(perRow, n - row * perRow);
      let s = (col + 0.5) * total / inRow, li = 0;
      while (li < lines.length - 1 && s > lines[li].len) { s -= lines[li].len; li++; }
      const P = lines[li].pts;
      let k = 1;
      while (k < P.length - 1 && P[k].s < s) k++;
      const a = P[k - 1], b = P[k], t = clamp((s - a.s) / Math.max(1e-6, b.s - a.s), 0, 1);
      const lx = a.x + (b.x - a.x) * t, ly = a.y + (b.y - a.y) * t;
      let nx = a.nx + (b.nx - a.nx) * t, ny = a.ny + (b.ny - a.ny) * t;
      const nl = Math.hypot(nx, ny) || 1;
      nx /= nl; ny /= nl;
      const depth = DIV.frontGap + row * DIV.rowGap;
      let x = lx + nx * depth, y = ly + ny * depth;
      // в воду и в горы без прохода не ставим: отступаем вглубь своих земель
      for (let d = depth; d < depth + 2.3; d += 0.5) {
        const ti = w.tileAt(lx + nx * d, ly + ny * d);
        if (ti >= 0 && w.passable(ti) && w.main[ti]) { x = lx + nx * d; y = ly + ny * d; break; }
      }
      out.push({ x, y, lx, ly, nx, ny });
    }
    return out;
  },

  // ---------- обновление ----------
  update(g, dt) {
    const st = this.state(g);
    st.t += dt;
    if (st.t < DIV.think - 1e-6) return;
    const step = st.t;
    st.t = 0;
    this.tickDivisions(g, step);
    st.bt += step;
    const remap = st.bt >= DIV.borderEvery - 1e-6;
    if (remap) st.bt = 0;
    for (const f of st.fronts.slice()) this.tickFront(g, f, remap);
    st.ct += step;
    if (st.ct >= 1 - 1e-6) { st.ct = 0; this.tickTraining(g); this.cleanup(g); }
  },
  // Организованность восстанавливается в покое, окапывание растёт, пока дивизия стоит.
  tickDivisions(g, dt) {
    const st = this.state(g), pace = {};
    const winter = g.isWinter();
    for (const a of g.armies) {
      const k = g.kingdom(a.owner), unpaid = k && (k.unpaid || k.starving);
      let regen = 0;
      if (a.state === 'battle') regen = 0;
      else if (a.state === 'siege') { regen = DIV.orgSiege; a.entrench = 0; }
      else if (a.state === 'move' || a.state === 'retreat') { regen = DIV.orgMarch; a.entrench = 0; }
      else { regen = DIV.orgRest; a.entrench = Math.min(1, (a.entrench || 0) + dt / DIV.digTime); }
      if (!unpaid && a.org < 100) a.org = Math.min(100, a.org + regen * dt);
      if (a.state !== 'move') a.march = false;
      // армия на марше идёт со скоростью самой медленной своей дивизии
      if (a.march && a.group !== null && a.group !== undefined) {
        let s = Infinity;
        for (const u in a.units) s = Math.min(s, UNITS[u].speed);
        if (!isFinite(s)) s = 1;
        if (winter) s *= 0.8;
        if (unpaid) s *= 0.85;
        if (!(pace[a.group] <= s)) pace[a.group] = s;
      }
    }
    st.pace = pace;
  },
  cleanup(g) {
    const st = this.state(g);
    const alive = new Set();
    for (const a of g.armies) {
      // бой или осада закончились без участия дивизии (мир, роспуск): она свободна
      if ((a.state === 'battle' || a.state === 'siege') && (a.battleId === null || a.battleId === undefined || !g.battleOf(a))) {
        if (a.state === 'siege') g.leaveSiege(a);
        a.state = 'idle'; a.battleId = null; a.dest = null; a.path = null;
      }
      if (a.group !== null && a.group !== undefined) alive.add(a.group);
      if (a.front !== null && a.front !== undefined && !this.front(g, a.front)) a.front = null;
    }
    st.groups = st.groups.filter(x => alive.has(x.id));
    for (const a of g.armies) if (a.group !== null && a.group !== undefined && !this.group(g, a.group)) a.group = null;
  },

  tickFront(g, f, remap) {
    const k = g.kingdom(f.owner);
    if (!k || !k.alive) { this.removeFront(g, f); return; }
    if (f.kind === 'border' && f.enemy !== -1) {
      const e = g.kingdom(f.enemy);
      if (!e || !e.alive) {
        if (k.isPlayer) g.notify(f.name + ': противник повержен, фронт распущен', 'good', null);
        this.removeFront(g, f);
        return;
      }
    }
    const rt = this.runtime(g, f);
    if (f.kind === 'border') {
      const key = g.territoryVersion + ':' + g.ownershipVersion + ':' + f.enemy;
      if (key !== rt.key && (remap || !rt.key)) { rt.key = key; rt.lines = this.borderLines(g, f.owner, f.enemy); }
    } else if (!rt.key) { rt.key = 'line'; rt.lines = this.lineFromPts(g, f.owner, f.pts); }
    rt.slots.clear();
    rt.arrows.length = 0;
    const divs = this.frontDivs(g, f);
    if (!divs.length) return;
    if (rt.lines.length) {
      // места раздаём заново, только если сменился состав фронта или сама линия: иначе дивизии метались бы
      const sig = rt.key + '|' + divs.map(a => a.id).join(',');
      if (sig !== rt.sig) {
        rt.sig = sig;
        const slots = this.slotsOn(g, rt.lines, divs.length);
        const ord = divs.map(a => { const q = this.nearestOn(rt.lines, a.x, a.y); return { a, s: q ? q.s : 0 }; }).sort((p, q) => p.s - q.s || p.a.id - q.a.id);
        rt.assign = new Map();
        ord.forEach((o, i) => rt.assign.set(o.a.id, slots[i]));
      }
      for (const a of divs) rt.slots.set(a.id, rt.assign.get(a.id));
    }
    let atk = f.mode === 'attack';
    if (atk && f.kind === 'border' && f.enemy >= 0 && !g.isHostile(f.owner, f.enemy)) {
      // с противником мир: наступать нельзя, пока не объявлена война — игроку предлагаем объявить её (один раз), ИИ держит линию
      atk = false;
      if (k.isPlayer && f.askT === undefined) {
        f.askT = g.time;
        let cc = null, bd = Infinity;
        for (const c of g.cities) if (c.owner === f.enemy) { const d = dist(c.x, c.y, divs[0].x, divs[0].y); if (d < bd) { bd = d; cc = c; } }
        if (cc) g.emit('peaceBlock', { army: divs[0], owner: f.enemy, target: { kind: 'city', id: cc.id } });
      } else if (!k.isPlayer) f.mode = 'hold';
    }
    if (atk) this.attack(g, f, rt, divs);
    else for (const a of divs) { const s = rt.slots.get(a.id); if (s) this.goHold(g, a, s); }
  },
  // Встать на своё место на линии и держать оборону (окапываться).
  goHold(g, a, s) {
    if (a.state === 'battle' || a.state === 'retreat') return;
    const near = a.dest && a.dest.kind === 'ground' && dist(a.dest.x, a.dest.y, s.x, s.y) < 0.6;
    if (dist(a.x, a.y, s.x, s.y) < 0.5) {
      if (a.state === 'siege') g.endSiege(a, false);
      if (a.state === 'move' && !near) g.stop(a);
      return;
    }
    if (a.state === 'move' && near) return;
    if (g.time - (a.fT === undefined ? -99 : a.fT) < DIV.reorder) return;
    a.fT = g.time;
    if (a.state === 'siege') g.endSiege(a, false);
    g.order(a, { kind: 'ground', x: s.x, y: s.y });
  },
  // Наступление: каждая дивизия идёт в своём секторе к ближайшей цели — вражеской дивизии у линии или
  // городу противника (осада). Если сектору не хватает сил на город, слабые сектора сосредотачиваются
  // на одной посильной цели; если сил нет совсем — держат линию.
  attack(g, f, rt, divs) {
    const lines = rt.lines, isAI = !!f.ai, pl = g.player, mine = pl && f.owner === pl.id;
    const enemyCity = c => c.owner !== f.owner && (f.kind === 'border' ? c.owner === f.enemy : g.isHostile(f.owner, c.owner));
    let cities = [];
    for (const c of g.cities) {
      if (!enemyCity(c)) continue;
      if (lines.length) {
        const q = this.nearestOn(lines, c.x + 0.5, c.y + 0.5);
        if (!q || q.d > DIV.reach || (f.kind === 'line' && q.side > 0.8)) continue;
      }
      cities.push(c);
    }
    if (!cities.length && f.kind === 'border') for (const c of g.cities) if (enemyCity(c)) cities.push(c);
    // ИИ бьёт в выбранную им цель, даже если она дальше досягаемости от линии
    if (isAI) {
      const ak = g.kingdom(f.owner), tg = ak && ak.ai && ak.ai.target !== null && ak.ai.target !== undefined ? g.city(ak.ai.target) : null;
      if (tg && enemyCity(tg)) cities = [tg];
    }
    const need = c => {
      const def = AI.cityDefense(g, c);
      if (!isAI) return def * DIV.playerNeed;
      return def * (c.walls >= 2 && c.wallHp > 0 ? 1.8 : 1.35) / g.diff.aggression;
    };
    const free = [], byCity = new Map();
    const pick = (a, c) => { let e = byCity.get(c); if (!e) byCity.set(c, e = { c, divs: [], power: 0, siege: 0 }); e.divs.push(a); e.power += this.power(a); e.siege += siegePower(a.units); };
    for (const a of divs) {
      if (a.state === 'battle' || a.state === 'retreat') continue;
      const s = rt.slots.get(a.id) || { x: a.x, y: a.y };
      if (a.org < DIV.attackOrg && a.state !== 'siege') { if (rt.slots.get(a.id)) this.goHold(g, a, s); continue; }
      // вражеская дивизия рядом — бьём её (прежнюю цель не бросаем, пока она близко)
      let foe = null, fd = DIV.engage;
      if (a.dest && a.dest.kind === 'army') {
        const e = g.army(a.dest.id);
        if (e && e.owner !== f.owner && e.state !== 'retreat' && dist(e.x, e.y, a.x, a.y) < DIV.engage * 1.5) { foe = e; fd = 0; }
      }
      if (!foe) for (const e of g.armies) {
        if (e.owner === f.owner || e.state === 'retreat' || !g.isHostile(f.owner, e.owner)) continue;
        if (Math.abs(e.x - a.x) > fd || Math.abs(e.y - a.y) > fd) continue;
        const d = dist(e.x, e.y, a.x, a.y);
        if (d < fd) { fd = d; foe = e; }
      }
      if (foe && a.state !== 'siege') {
        if (!(a.dest && a.dest.kind === 'army' && a.dest.id === foe.id) && g.time - (a.fT === undefined ? -99 : a.fT) >= DIV.reorder * 0.5) {
          a.fT = g.time;
          g.order(a, { kind: 'army', id: foe.id });
        }
        if (mine) rt.arrows.push({ x0: s.x, y0: s.y, x1: foe.x, y1: foe.y, foe: true });
        continue;
      }
      // город: тот, что уже осаждаем или к которому идём, иначе ближайший к своему участку
      let cur = null;
      if (a.state === 'siege') cur = g.city(a.siegeCity);
      else if (a.dest && a.dest.kind === 'city') cur = g.city(a.dest.id);
      if (cur && cities.indexOf(cur) < 0) cur = null;
      if (!cur) {
        let bd = Infinity;
        for (const c of cities) {
          const d = dist(c.x + 0.5, c.y + 0.5, s.x, s.y) + dist(c.x + 0.5, c.y + 0.5, a.x, a.y) * 0.3;
          if (d < bd) { bd = d; cur = c; }
        }
      }
      if (cur) pick(a, cur); else free.push(a);
    }
    const go = (list, c) => {
      for (const a of list) {
        const s = rt.slots.get(a.id) || { x: a.x, y: a.y };
        if (mine) rt.arrows.push({ x0: s.x, y0: s.y, x1: c.x + 0.5, y1: c.y + 0.5 });
        if (a.state === 'siege' && a.siegeCity === c.id) continue;
        if (a.state === 'move' && a.dest && a.dest.kind === 'city' && a.dest.id === c.id) continue;
        if (g.time - (a.fT === undefined ? -99 : a.fT) < DIV.reorder) continue;
        a.fT = g.time;
        g.order(a, { kind: 'city', id: c.id });
      }
    };
    const pooled = [];
    for (const e of byCity.values()) {
      const besieged = e.divs.some(a => a.state === 'siege');
      if (besieged || e.power >= need(e.c)) go(e.divs, e.c); else for (const a of e.divs) pooled.push(a);
    }
    if (pooled.length) {
      let power = 0, cx = 0, cy = 0;
      for (const a of pooled) { power += this.power(a); cx += a.x; cy += a.y; }
      cx /= pooled.length; cy /= pooled.length;
      // к слабым секторам присоединяются силы тех, кто уже идёт на эту цель
      let best = null, bd = Infinity;
      for (const c of cities) {
        const e = byCity.get(c), have = power + (e && e.power >= need(c) ? 0 : 0);
        if (have < need(c)) continue;
        const d = dist(c.x + 0.5, c.y + 0.5, cx, cy);
        if (d < bd) { bd = d; best = c; }
      }
      if (best) go(pooled, best);
      else for (const a of pooled) free.push(a);
    }
    for (const a of free) { const s = rt.slots.get(a.id); if (s) this.goHold(g, a, s); }
  },

  // ---------- сохранение ----------
  serialize(g) {
    const st = this.state(g);
    return {
      tpls: st.tpls, tplN: st.tplN, groups: st.groups, grpN: st.grpN, divN: st.divN, lineN: st.lineN,
      fronts: st.fronts.map(f => ({ id: f.id, owner: f.owner, kind: f.kind, enemy: f.enemy, mode: f.mode, name: f.name, pts: f.pts, ai: f.ai })),
      t: st.t, bt: st.bt, ct: st.ct,
    };
  },
  restore(g, data) {
    const st = g.fr = this.fresh();
    if (data) {
      for (const k of ['tpls', 'tplN', 'groups', 'grpN', 'divN', 'lineN', 't', 'bt', 'ct']) if (data[k] !== undefined) st[k] = data[k];
      st.fronts = (data.fronts || []).map(f => ({ ...f }));
    }
    // старые сохранения: армии становятся дивизиями, бои — многодивизионными
    for (const a of g.armies) {
      if (a.org === undefined) { a.org = a.morale !== undefined ? a.morale : 100; delete a.morale; }
      if (a.xp === undefined) a.xp = 0;
      if (a.entrench === undefined) a.entrench = 0;
      if (a.tpl === undefined) a.tpl = this.guessTpl(g, a.owner, a.units);
      if (a.front === undefined) a.front = null;
      if (a.group === undefined) a.group = null;
    }
    for (const b of g.battles) {
      if (b.sideA) continue;
      b.sideA = [b.a]; b.men = {}; b.loss = {};
      if (b.kind === 'field') {
        b.sideB = [b.b];
        const A = g.army(b.a), B = g.army(b.b);
        b.ownA = A ? A.owner : null; b.ownB = B ? B.owner : null;
        if (A) b.men[A.id] = b.startA; if (B) b.men[B.id] = b.startB;
      } else if (g.army(b.a)) b.men[b.a] = b.startA;
    }
  },
};

Mods.add({
  name: 'fronts',
  init(g, loaded) { if (!loaded || !g.fr) Fronts.state(g); },
  update(g, dt) { Fronts.update(g, dt); },
  serialize(g) { return Fronts.serialize(g); },
  restore(g, data) { Fronts.restore(g, data); },
  modify: {
    // армия на марше держит шаг самой медленной своей дивизии
    armySpeed(g, s, a) {
      if (!a.march || a.group === null || a.group === undefined || !g.fr) return s;
      const p = g.fr.pace[a.group];
      return p && p < s ? p : s;
    },
  },
});
