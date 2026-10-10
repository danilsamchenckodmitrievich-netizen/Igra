'use strict';
// Состояние партии и симуляция: экономика, стройка, найм, армии, сражения, осады, туман, события.

const STEP = 0.1;           // шаг симуляции в игровых секундах
const BATTLE_TICK = 0.25;

function addUnits(dst, src, mult) {
  for (const k in src) {
    const v = (dst[k] || 0) + src[k] * (mult || 1);
    if (v > 0) dst[k] = v; else delete dst[k];
  }
  return dst;
}
function menCount(units) {
  let n = 0;
  for (const k in units) n += units[k] * (UNITS[k].crew || 1);
  return n;
}
function unitPower(units) {
  let p = 0;
  for (const k in units) {
    const u = UNITS[k];
    p += units[k] * Math.sqrt(u.hp * u.atk * (1 + u.def / 5));
  }
  return p;
}
function siegePower(units) {
  let p = 0;
  for (const k in units) p += units[k] * UNITS[k].siege;
  return p;
}
function scaleCost(cost, mult) {
  const out = {};
  for (const k in cost) out[k] = Math.round(cost[k] * mult);
  return out;
}

class Game {
  constructor(opts, save) {
    this.opts = opts;
    this.listeners = [];
    this.diff = DIFFICULTY[opts.difficulty] || DIFFICULTY.normal;
    this.world = new World(opts.seed, opts.size);
    const W = this.world.W, H = this.world.H;
    this.explored = new Uint8Array(W * H);
    this.visible = new Uint8Array(W * H);
    this.visT = 0; this.econT = 0; this.battleT = 0; this.aiT = 0; this.saveT = 0; this.inflT = 0;
    this.territoryVersion = 0;
    this.ownershipVersion = 0;
    this.fx = [];
    if (save) this.restore(save);
    else this.setup();
    Mods.call('init', this, !!save);
    this.refreshTerritory(true);
    this.updateVisibility();
  }

  on(fn) { this.listeners.push(fn); }
  emit(type, data) { for (const l of this.listeners) l(type, data); }
  notify(text, kind, at, important) {
    const ev = { t: this.time, text, kind: kind || 'info', x: at ? at.x : null, y: at ? at.y : null, important: !!important };
    this.events.push(ev);
    if (this.events.length > 60) this.events.shift();
    this.emit('event', ev);
  }

  get player() { return this.kingdoms.find(k => k.isPlayer); }
  kingdom(id) { return this.kingdomById.get(id); }
  city(id) { return this.cityById.get(id); }
  army(id) { return this.armyById.get(id); }
  newId() { return this.nextId++; }
  reindex() {
    this.kingdomById = new Map(this.kingdoms.map(k => [k.id, k]));
    this.cityById = new Map(this.cities.map(c => [c.id, c]));
    this.armyById = new Map(this.armies.map(a => [a.id, a]));
  }

  // ---------- новая партия ----------
  setup() {
    const o = this.opts, w = this.world;
    this.rng = new Rng((o.seed * 7919) ^ 0x2545f491);
    const rng = this.rng;
    this.time = 0;
    this.nextId = 1;
    this.events = [];
    this.battles = [];
    this.armies = [];
    this.winner = null;
    this.banditT = 150 + rng.range(0, 60);
    this.eventT = 100 + rng.range(0, 60);
    // державы
    const presets = KINGDOM_PRESETS.map((p, i) => i);
    const pIdx = clamp(o.kingdom | 0, 0, KINGDOM_PRESETS.length - 1);
    const rivals = rng.shuffle(presets.filter(i => i !== pIdx)).slice(0, clamp(o.rivals || 3, 1, 5));
    const order = [pIdx, ...rivals];
    this.kingdoms = order.map((pi, n) => {
      const p = KINGDOM_PRESETS[pi];
      return {
        id: this.newId(), preset: pi, name: n === 0 && o.name ? o.name : p.name, color: p.color, dark: p.dark, sigil: p.sigil,
        isPlayer: n === 0, alive: true, bandit: false, capital: null,
        res: { gold: 450, food: 320, wood: 260, stone: 160, iron: 60 },
        unpaid: false, starving: false,
        stats: { won: 0, lost: 0, taken: 0, lostCities: 0, killed: 0, fallen: 0, maxCities: 0 },
        ai: n === 0 && !o.spectate ? null : { mode: 'grow', target: null, nextThink: rng.range(0, 3), plan: null },
      };
    });
    this.bandits = {
      id: this.newId(), name: 'Разбойники', color: BANDIT_COLOR, dark: '#141110', sigil: 'skull', isPlayer: false,
      alive: true, bandit: true, res: { gold: 0, food: 0, wood: 0, stone: 0, iron: 0 }, stats: {},
    };
    this.kingdoms.push(this.bandits);
    // города
    const names = rng.shuffle(CITY_NAMES.slice());
    this.cities = w.sites.map((s, i) => ({
      id: this.newId(), name: names[i % names.length] + (i >= names.length ? ' ' + (1 + Math.floor(i / names.length)) : ''),
      x: s.x, y: s.y, owner: -1, level: 1, pop: 200, buildings: {}, walls: 0, wallHp: 0, towers: 0,
      construction: null, queue: [], garrison: {}, wounds: {}, isCapital: false, siegeBy: null, raised: false,
    }));
    // столицы — как можно дальше друг от друга
    const K = this.kingdoms.filter(k => !k.bandit);
    const caps = [];
    const sites = this.cities.slice();
    caps.push(rng.pick(sites));
    while (caps.length < K.length) {
      let best = null, bd = -1;
      for (const c of sites) {
        if (caps.includes(c)) continue;
        const d = Math.min(...caps.map(q => dist(q.x, q.y, c.x, c.y)));
        if (d > bd) { bd = d; best = c; }
      }
      caps.push(best);
    }
    rng.shuffle(caps);
    K.forEach((k, i) => {
      const c = caps[i];
      c.owner = k.id; c.isCapital = true; k.capital = c.id;
      c.level = 3; c.pop = 900;
      c.buildings = { farm: 1, lumber: 1, barracks: 1 };
      c.walls = 1; c.wallHp = WALLS[1].hp; c.towers = 1;
      c.garrison = { militia: 30, spear: 20, archer: 20 };
      // второй город — ближайшее свободное поселение
      let near = null, nd = Infinity;
      for (const q of this.cities) {
        if (q.owner !== -1) continue;
        const d = dist(q.x, q.y, c.x, c.y);
        if (d < nd) { nd = d; near = q; }
      }
      if (near) {
        near.owner = k.id; near.level = 1; near.pop = 260;
        near.buildings = { farm: 1 };
        near.garrison = { militia: 20 };
      }
    });
    // вольные города
    for (const c of this.cities) {
      if (c.owner !== -1) continue;
      const lv = rng.chance(0.15) ? 3 : rng.chance(0.4) ? 2 : 1;
      c.level = lv;
      c.pop = Math.round(CITY_LEVELS[lv].popMax * rng.range(0.45, 0.7));
      c.buildings = lv >= 2 ? { farm: 1, market: lv - 1 } : { farm: 1 };
      c.walls = lv >= 3 ? 2 : lv === 2 && rng.chance(0.6) ? 1 : 0;
      c.wallHp = c.walls ? WALLS[c.walls].hp : 0;
      c.towers = lv >= 3 ? 1 : 0;
      c.garrison = { militia: 20 + lv * rng.int(10, 20) };
      if (lv >= 2) c.garrison.spear = rng.int(1, 3) * 10;
      if (lv >= 2 && rng.chance(0.6)) c.garrison.archer = rng.int(1, 2) * 10;
      if (lv >= 3) c.garrison.sword = 10;
    }
    this.reindex();
    // стартовые дружины
    for (const k of K) {
      const cap = this.city(k.capital);
      let spot = this.world.nearestPassable(cap.x + 2, cap.y + 1);
      if (spot < 0) spot = this.cityTile(cap);
      const army = this.makeArmy(k.id, spot % this.world.W + 0.5, Math.floor(spot / this.world.W) + 0.5, { spear: 20, archer: 10, scout: 5 });
      army.name = 'Дружина';
    }
    for (const k of K) k.stats.maxCities = this.citiesOf(k.id).length;
    this.notify('Вы правите державой «' + this.player.name + '». Стройте хозяйство, собирайте войско и расширяйте границы.', 'good', this.city(this.player.capital), true);
  }

  // ---------- сохранение ----------
  serialize() {
    const mods = {};
    for (const m of Mods.list) if (m.serialize) mods[m.name] = m.serialize(this);
    return {
      v: 1, opts: this.opts, mods, time: this.time, nextId: this.nextId, rng: this.rng.state,
      banditT: this.banditT, eventT: this.eventT, winner: this.winner,
      kingdoms: this.kingdoms.map(k => ({ ...k })),
      cities: this.cities.map(c => { const o = { ...c }; delete o.tiles; return o; }),
      armies: this.armies.map(a => ({ ...a })),
      battles: this.battles.map(b => ({ ...b })),
      events: this.events.slice(-30),
      explored: bytesToB64(this.explored),
    };
  }
  restore(s) {
    this.time = s.time; this.nextId = s.nextId;
    this.rng = new Rng(0); this.rng.state = s.rng >>> 0;
    this.banditT = s.banditT; this.eventT = s.eventT; this.winner = s.winner;
    this.kingdoms = s.kingdoms;
    this.bandits = this.kingdoms.find(k => k.bandit);
    this.cities = s.cities; this.armies = s.armies; this.battles = s.battles; this.events = s.events || [];
    const ex = b64ToBytes(s.explored);
    if (ex.length === this.explored.length) this.explored.set(ex);
    this.reindex();
    for (const m of Mods.list) if (m.restore) m.restore(this, (s.mods || {})[m.name]);
  }

  // ---------- запросы ----------
  citiesOf(kid) { return this.cities.filter(c => c.owner === kid); }
  armiesOf(kid) { return this.armies.filter(a => a.owner === kid); }
  // враждебны ли две державы (id); дипломатия может заключить мир или союз
  isHostile(a, b) { return Mods.mod('hostile', this, a !== b, a, b); }
  cityTile(c) { return this.world.idx(c.x, c.y); }
  cityAt(x, y, r) {
    let best = null, bd = r || 1.2;
    for (const c of this.cities) {
      const d = dist(c.x + 0.5, c.y + 0.5, x, y);
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }
  seasonIndex() { return Math.floor(this.time / SEASON_LEN) % 4; }
  isWinter() { return this.seasonIndex() === 3; }
  year() { return START_YEAR + Math.floor(this.time / (SEASON_LEN * 4)); }
  dateText() { return SEASONS[this.seasonIndex()] + ' ' + this.year() + ' г.'; }

  canAfford(k, cost) { for (const r in cost) if ((k.res[r] || 0) < cost[r]) return false; return true; }
  pay(k, cost) { for (const r in cost) k.res[r] -= cost[r]; }
  refund(k, cost, f) { for (const r in cost) k.res[r] += Math.floor(cost[r] * f); }
  missing(k, cost) {
    const out = [];
    for (const r in cost) if ((k.res[r] || 0) < cost[r]) out.push(RES_BY_ID[r].gen);
    return out;
  }

  // ---------- влияние и земли ----------
  // Сила влияния города — на сколько клеток он держит землю. Вклады в клетках (enemies ≤ 0),
  // reach = их сумма в пределах INFLUENCE.min…max. Вольные города: только база (чуть выше) и гарнизон.
  cityInfluence(c) {
    const I = INFLUENCE, free = c.owner === -1;
    const out = { reach: 0, base: (I.base[c.level] || I.base[1]) + (free ? I.freeBase[c.level] || 0 : 0), pop: 0, garrison: 0, armies: 0, enemies: 0 };
    out.garrison = Math.min(I.garrisonMax, I.garrison * Math.sqrt(menCount(c.garrison) / 10));
    if (!free) {
      out.pop = I.pop * Math.sqrt(Math.max(0, c.pop) / 400);
      const cx = c.x + 0.5, cy = c.y + 0.5;
      let own = 0, foe = 0;
      for (const a of this.armies) {
        const dx = a.x - cx, dy = a.y - cy;
        if (Math.abs(dx) > I.armyR || Math.abs(dy) > I.armyR) continue;
        const d = Math.sqrt(dx * dx + dy * dy);
        const s = Math.sqrt(menCount(a.units) / 10);
        if (a.owner === c.owner) { if (d < I.armyR) own += I.army * s * (1 - d / I.armyR); }
        else if (d < I.enemyR) foe += I.enemy * s * (1 - d / I.enemyR);
      }
      if (c.siegeBy) foe += I.siege;
      out.armies = Math.min(I.armyMax, own);
      out.enemies = -Math.min(I.enemyMax, foe);
    }
    out.reach = clamp(Mods.mod('influence', this, out.base + out.pop + out.garrison + out.armies + out.enemies, c, out), I.min, I.max);
    return out;
  }
  // Перекроить земли, если чья-то сила заметно изменилась или город сменил хозяина (force — сразу).
  // Сами земли выводятся из состояния и не сохраняются.
  refreshTerritory(force) {
    const reach = new Map();
    let changed = force || !this.inflUsed;
    for (const c of this.cities) {
      const r = this.cityInfluence(c).reach;
      reach.set(c.id, r);
      if (changed) continue;
      const u = this.inflUsed.get(c.id);
      if (!u || u.owner !== c.owner || Math.abs(u.reach - r) >= INFLUENCE.threshold) changed = true;
    }
    if (!changed) return false;
    this.world.computeTerritory(this.cities, reach);
    this.inflUsed = new Map(this.cities.map(c => [c.id, { reach: reach.get(c.id), owner: c.owner }]));
    this.territoryVersion++;
    return true;
  }

  // Множитель выхода здания от окрестностей города.
  terrainFactor(c, bid) {
    const b = BUILDINGS[bid];
    if (!b.terrain) return 1;
    let n = 0;
    const tiles = c.tiles || {};
    for (const key in b.terrain) n += (key === 'river' ? tiles.river || 0 : tiles[key] || 0) * b.terrain[key];
    return clamp(n / b.ideal, 0.25, 1.5);
  }

  buildingCost(bid, toLevel) { return scaleCost(BUILDINGS[bid].cost, Math.pow(LEVEL_COST_MULT, toLevel - 1)); }
  buildingTime(bid, toLevel) { return BUILDINGS[bid].time * Math.pow(LEVEL_TIME_MULT, toLevel - 1); }
  usedSlots(c) { return Object.keys(c.buildings).filter(b => c.buildings[b] > 0).length; }

  // Почему нельзя строить; null — можно.
  buildBlock(c, kind, id) {
    const k = this.kingdom(c.owner);
    if (!k || !k.alive) return 'Город вам не принадлежит';
    if (c.construction) return 'В городе уже идёт стройка';
    if (c.siegeBy) return 'Город в осаде';
    const info = this.buildInfo(c, kind, id);
    if (!info) return 'Достигнут предел';
    if (info.block) return info.block;
    if (!this.canAfford(k, info.cost)) return 'Не хватает: ' + this.missing(k, info.cost).join(', ');
    return null;
  }
  // Цена, время и следующий уровень постройки.
  buildInfo(c, kind, id) {
    if (kind === 'building') {
      const b = BUILDINGS[id];
      const cur = c.buildings[id] || 0;
      if (cur >= b.max) return null;
      const to = cur + 1;
      let block = null;
      if (cur === 0 && this.usedSlots(c) >= CITY_LEVELS[c.level].slots) block = 'Нет свободных мест: повысьте уровень города';
      if (b.minLevel && c.level < b.minLevel) block = 'Нужен ' + CITY_LEVELS[b.minLevel].name.toLowerCase() + ' или больше';
      return { to, cost: this.buildingCost(id, to), time: this.buildingTime(id, to), block, name: b.name };
    }
    if (kind === 'walls') {
      const to = c.walls + 1;
      const w = WALLS[to];
      if (!w) return null;
      return { to, cost: w.cost, time: w.time, block: c.level < w.minLevel ? 'Нужен ' + CITY_LEVELS[w.minLevel].name.toLowerCase() : null, name: w.name };
    }
    if (kind === 'towers') {
      const to = c.towers + 1;
      const tw = TOWERS[to];
      if (!tw) return null;
      return { to, cost: tw.cost, time: tw.time, block: c.walls < to ? 'Сначала укрепите стены' : null, name: tw.name };
    }
    if (kind === 'level') {
      const L = CITY_LEVELS[c.level];
      if (!L.up) return null;
      return { to: c.level + 1, cost: L.up, time: L.time, block: null, name: CITY_LEVELS[c.level + 1].name };
    }
    return null;
  }

  startBuild(c, kind, id) {
    const why = this.buildBlock(c, kind, id);
    if (why) return why;
    const k = this.kingdom(c.owner);
    const info = this.buildInfo(c, kind, id);
    this.pay(k, info.cost);
    c.construction = { kind, id: id || null, to: info.to, t: 0, total: info.time, cost: info.cost, name: info.name };
    return null;
  }
  cancelBuild(c) {
    if (!c.construction) return;
    const k = this.kingdom(c.owner);
    if (k) this.refund(k, c.construction.cost, 0.75);
    c.construction = null;
  }

  recruitInfo(c, uid) {
    const u = UNITS[uid];
    let block = null;
    if (u.need) {
      const [b, lv] = u.need;
      if ((c.buildings[b] || 0) < lv) block = 'Нужно: ' + BUILDINGS[b].name.toLowerCase() + (lv > 1 ? ' ' + lv + ' ур.' : '');
    }
    const pop = u.squad * (u.crew || 1);
    if (!block && c.pop - pop < 60) block = 'Мало жителей';
    return { cost: u.cost, time: this.recruitTime(c, uid), pop, block };
  }
  recruitTime(c, uid) {
    const u = UNITS[uid];
    let t = u.time;
    const b = u.need ? c.buildings[u.need[0]] || 0 : c.buildings.barracks || 0;
    return t * (1 - 0.12 * Math.max(0, b - 1));
  }
  recruitBlock(c, uid) {
    const k = this.kingdom(c.owner);
    if (!k || !k.alive) return 'Город вам не принадлежит';
    if (c.queue.length >= 8) return 'Очередь найма заполнена';
    const info = this.recruitInfo(c, uid);
    if (info.block) return info.block;
    if (!this.canAfford(k, info.cost)) return 'Не хватает: ' + this.missing(k, info.cost).join(', ');
    return null;
  }
  recruit(c, uid) {
    const why = this.recruitBlock(c, uid);
    if (why) return why;
    const k = this.kingdom(c.owner);
    const info = this.recruitInfo(c, uid);
    this.pay(k, info.cost);
    c.pop -= info.pop;
    c.queue.push({ unit: uid, t: 0, total: info.time });
    return null;
  }

  // ---------- торговля ----------
  tradeBonus(k) {
    let m = 0;
    for (const c of this.cities) if (c.owner === k.id) m += c.buildings.market || 0;
    return Math.min(TRADE.maxBonus, m * TRADE.marketBonus);
  }
  tradePrice(k, r, sell) {
    const b = this.tradeBonus(k);
    return sell ? TRADE[r] * (1 + b) : TRADE[r] * TRADE.buyMult * (1 - b * 0.5);
  }
  trade(k, r, amount, sell) {
    if (!TRADE[r] || amount <= 0) return 'Нельзя';
    const price = this.tradePrice(k, r, sell);
    if (sell) {
      if (k.res[r] < amount) return 'Не хватает ' + RES_BY_ID[r].gen;
      k.res[r] -= amount;
      k.res.gold += Math.floor(amount * price);
    } else {
      const cost = Math.ceil(amount * price);
      if (k.res.gold < cost) return 'Не хватает золота';
      k.res.gold -= cost;
      k.res[r] += amount;
    }
    return null;
  }

  // ---------- доходы ----------
  cityIncome(c, k) {
    const out = { gold: 0, food: 0, wood: 0, stone: 0, iron: 0 };
    const winter = this.isWinter();
    const L = c.buildings;
    out.gold += c.pop * ECON.tax * (1 + BUILDINGS.market.taxBonus * (L.market || 0));
    out.food += ECON.baseFood * (winter ? ECON.winterFood : 1) - c.pop * ECON.eat;
    out.wood += ECON.baseWood;
    out.stone += ECON.baseStone;
    for (const bid of ['farm', 'lumber', 'quarry', 'mine', 'market']) {
      const lv = L[bid] || 0;
      if (!lv) continue;
      const b = BUILDINGS[bid];
      const f = this.terrainFactor(c, bid) * (bid === 'farm' && winter ? ECON.winterFood : 1);
      for (const r in b.yield) out[r] += b.yield[r] * lv * f;
    }
    if (c.siegeBy) { out.gold *= 0.3; out.wood *= 0.3; out.stone *= 0.3; out.iron *= 0.3; if (out.food > 0) out.food *= 0.3; }
    return Mods.mod('cityIncome', this, out, c, k);
  }
  // Полный расчёт доходов державы за минуту с разбивкой.
  income(k) {
    const total = { gold: 0, food: 0, wood: 0, stone: 0, iron: 0 };
    const parts = { cities: { ...total }, upkeep: { ...total }, factory: { ...total } };
    const mult = k.isPlayer ? 1 : this.diff.income;
    let factoryLv = 0;
    for (const c of this.cities) {
      if (c.owner !== k.id) continue;
      const inc = this.cityIncome(c, k);
      for (const r in inc) {
        const v = inc[r] > 0 ? inc[r] * mult : inc[r];
        total[r] += v; parts.cities[r] += v;
      }
      if (!c.siegeBy) factoryLv += c.buildings.factory || 0;
      for (const u in c.garrison) {
        const def = UNITS[u];
        const squads = c.garrison[u] / def.squad;
        parts.upkeep.gold -= def.upkeep * squads * 0.4;
        parts.upkeep.food -= c.garrison[u] * (def.crew || 1) * 0.03;
      }
    }
    for (const a of this.armies) {
      if (a.owner !== k.id) continue;
      for (const u in a.units) {
        const def = UNITS[u];
        parts.upkeep.gold -= def.upkeep * a.units[u] / def.squad;
        parts.upkeep.food -= a.units[u] * (def.crew || 1) * (u === 'cavalry' || u === 'knight' || u === 'scout' ? 0.06 : 0.04);
      }
    }
    for (const r in parts.upkeep) total[r] += parts.upkeep[r];
    if (factoryLv) {
      const conv = BUILDINGS.factory.convert;
      // мануфактуры работают, пока есть сырьё на складе
      let f = 1;
      for (const r in conv.input) {
        const need = conv.input[r] * factoryLv;
        if (k.res[r] < need / 6 && total[r] < need) f = Math.min(f, Math.max(0, (k.res[r] / (need / 6))));
      }
      for (const r in conv.input) { parts.factory[r] -= conv.input[r] * factoryLv * f; total[r] -= conv.input[r] * factoryLv * f; }
      for (const r in conv.output) { const v = conv.output[r] * factoryLv * f * mult; parts.factory[r] += v; total[r] += v; }
      parts.factoryWork = f;
    }
    return { total, parts };
  }

  // ---------- армии (дивизии) ----------
  // Каждая армия в g.armies — дивизия: org — организованность (боевая устойчивость), xp — опыт,
  // entrench — окапывание 0..1, tpl — шаблон, front — фронт, group — армия из дивизий (js/fronts.js).
  makeArmy(owner, x, y, units) {
    const a = {
      id: this.newId(), owner, x, y, units: { ...units }, wounds: {}, path: null, pathI: 0, dest: null,
      state: 'idle', org: 100, xp: 0, entrench: 0, tpl: null, front: null, group: null,
      battleId: null, name: '', immuneUntil: 0, lastRepath: 0, siegeCity: null,
    };
    this.armies.push(a);
    this.armyById.set(a.id, a);
    return a;
  }
  removeArmy(a) {
    // выбывший участник не должен оставлять за собой висящих осад и сражений
    if (a.state === 'siege' && a.siegeCity) this.leaveSiege(a);
    else if (a.battleId) this.leaveBattle(a);
    const i = this.armies.indexOf(a);
    if (i >= 0) this.armies.splice(i, 1);
    this.armyById.delete(a.id);
    this.emit('armyRemoved', a);
  }
  armySpeed(a) {
    let s = Infinity;
    for (const u in a.units) s = Math.min(s, UNITS[u].speed);
    if (!isFinite(s)) s = 1;
    if (this.isWinter()) s *= 0.8;
    const k = this.kingdom(a.owner);
    if (k && (k.unpaid || k.starving)) s *= 0.85;
    return Mods.mod('armySpeed', this, s, a);
  }
  armyVision(a) {
    return a.units.scout ? UNITS.scout.vision : COMBAT.armyVision;
  }

  // Вывести войска из гарнизона в поле: получается дивизия (шаблон tplId или угаданный по составу).
  formArmy(c, units, tplId) {
    const take = {};
    for (const u in units) {
      const n = Math.min(units[u], c.garrison[u] || 0);
      if (n > 0) take[u] = n;
    }
    if (!menCount(take)) return null;
    addUnits(c.garrison, take, -1);
    for (const u in take) if (!c.garrison[u]) delete c.wounds[u];
    const a = this.makeArmy(c.owner, c.x + 0.5, c.y + 0.5, take);
    a.tpl = tplId || Fronts.guessTpl(this, c.owner, take);
    a.name = Fronts.divName(this, c.owner, a.tpl);
    return a;
  }
  // Имя армии (группы дивизий): «Первая армия», «Вторая армия»…
  armyName(owner) {
    return Fronts.ordWord(Fronts.groupsOf(this, owner).length + 1) + ' армия';
  }
  splitArmy(a, units) {
    if (a.state === 'battle') return null;
    const take = {};
    for (const u in units) {
      const n = Math.min(units[u], a.units[u] || 0);
      if (n > 0) take[u] = n;
    }
    if (!menCount(take) || menCount(take) >= menCount(a.units)) return null;
    addUnits(a.units, take, -1);
    const b = this.makeArmy(a.owner, a.x + 0.35, a.y + 0.35, take);
    b.tpl = Fronts.guessTpl(this, a.owner, take);
    a.tpl = Fronts.guessTpl(this, a.owner, a.units);
    b.name = Fronts.divName(this, a.owner, b.tpl);
    b.org = a.org; b.xp = a.xp; b.group = a.group; b.front = a.front;
    return b;
  }
  // Слить дивизию b в a (вручную: дивизии сами больше не сливаются).
  mergeInto(a, b) {
    const ma = menCount(a.units), mb = menCount(b.units);
    addUnits(a.units, b.units);
    a.org = Math.min(100, (a.org * ma + b.org * mb) / Math.max(1, ma + mb));
    a.xp = ((a.xp || 0) * ma + (b.xp || 0) * mb) / Math.max(1, ma + mb);
    a.tpl = Fronts.guessTpl(this, a.owner, a.units);
    this.removeArmy(b);
  }
  garrisonArmy(a, c) {
    addUnits(c.garrison, a.units);
    this.removeArmy(a);
  }

  setPath(a, x, y) {
    const p = this.world.findPath(a.x, a.y, x, y);
    if (!p) return false;
    p[0] = { x: a.x, y: a.y };
    a.path = p; a.pathI = 1;
    return true;
  }
  // Приказ: идти в точку / к городу / на армию.
  order(a, target) {
    if (!a || a.state === 'battle') return 'Дивизия в бою';
    if (a.state === 'retreat') return 'Дивизия отходит';
    let tx, ty;
    if (target.kind === 'city') { const c = this.city(target.id); tx = c.x + 0.5; ty = c.y + 0.5; }
    else if (target.kind === 'army') { const t = this.army(target.id); if (!t) return 'Цель исчезла'; tx = t.x; ty = t.y; }
    else { tx = target.x; ty = target.y; }
    // та же осада — не прерываем
    if (a.state === 'siege' && target.kind === 'city' && a.siegeCity === target.id) return null;
    if (a.state === 'siege') this.endSiege(a, false);
    if (!this.setPath(a, tx, ty)) return 'Туда не пройти';
    a.dest = { ...target };
    a.state = 'move';
    a.lastRepath = this.time;
    // в свой город дивизия входит гарнизоном, только если её туда и послали
    a.enter = target.kind === 'city' && this.city(target.id).owner === a.owner;
    return null;
  }
  stop(a) {
    if (a.state === 'siege') this.endSiege(a, false);
    if (a.state === 'move') a.state = 'idle';
    a.path = null; a.dest = null; a.march = false;
  }

  updateArmies(dt) {
    const w = this.world;
    for (const a of this.armies.slice()) {
      if (!this.armyById.has(a.id)) continue;
      if (a.state === 'battle') continue;
      if (a.state === 'siege') continue;
      // погоня: путь к движущейся цели пересчитываем
      if (a.dest && a.dest.kind === 'army') {
        const t = this.army(a.dest.id);
        if (!t) { a.dest = null; a.path = null; if (a.state === 'move') a.state = 'idle'; continue; }
        if (this.time - a.lastRepath > 1.5) {
          a.lastRepath = this.time;
          this.setPath(a, t.x, t.y);
        }
        // к своей дивизии — просто подходим и встаём рядом
        if (t.owner === a.owner && dist(a.x, a.y, t.x, t.y) < 0.9) { a.path = null; a.dest = null; a.state = 'idle'; continue; }
      }
      if (a.path) {
        let budget = this.armySpeed(a) * dt * (a.state === 'retreat' ? 1.15 : 1);
        while (budget > 0 && a.path && a.pathI < a.path.length) {
          const p = a.path[a.pathI];
          const tile = w.tileAt(a.x, a.y);
          const cost = tile >= 0 && w.passable(tile) ? w.moveCost(tile) : 1;
          const d = dist(a.x, a.y, p.x, p.y);
          const step = budget / cost;
          if (step >= d) { a.x = p.x; a.y = p.y; budget -= d * cost; a.pathI++; }
          else { a.x += (p.x - a.x) / d * step; a.y += (p.y - a.y) / d * step; budget = 0; }
          // осада начинается у стен
          if (a.dest && a.dest.kind === 'city' && a.state !== 'retreat') {
            const c = this.city(a.dest.id);
            if (c && c.owner !== a.owner && dist(a.x, a.y, c.x + 0.5, c.y + 0.5) <= COMBAT.siegeReach) { this.arriveCity(a, c); break; }
          }
        }
        if (a.path && a.pathI >= a.path.length) {
          a.path = null;
          this.arrive(a);
        }
      }
    }
  }

  arrive(a) {
    const d = a.dest;
    if (a.state === 'retreat') { a.state = 'idle'; a.dest = null; }
    else a.state = 'idle';
    a.march = false;
    if (!d) return;
    if (d.kind === 'city') {
      const c = this.city(d.id);
      if (c) this.arriveCity(a, c);
    }
    if (this.armyById.has(a.id) && a.state === 'idle') a.dest = null;
  }

  arriveCity(a, c) {
    a.path = null;
    if (c.owner === a.owner) {
      if (a.isBandit) return;
      if (a.state === 'retreat' || a.enter) this.garrisonArmy(a, c);
      else { a.state = 'idle'; a.dest = null; }
      return;
    }
    // отступавшие к уже потерянному городу ищут другое убежище, а не идут на штурм
    if (a.state === 'retreat') { this.retreat(a); return; }
    this.startSiege(a, c);
  }

  // ---------- сражения ----------
  // Полевой бой многодивизионный: у сражения две стороны (sideA/sideB — id дивизий, ownA/ownB — державы);
  // a и b — ведущие дивизии сторон (для отрисовки и совместимости). men/loss — численность при вступлении
  // и потери каждого участника.
  battleOf(a) {
    if (!a || !a.battleId) return null;
    for (const b of this.battles) if (b.id === a.battleId) return b;
    return null;
  }
  sideArmies(btl, side) {
    const ids = side === 'a' ? btl.sideA : btl.sideB, out = [];
    for (const id of ids) {
      const x = this.army(id);
      if (x && x.battleId === btl.id && (x.state === 'battle' || x.state === 'siege')) out.push(x);
    }
    return out;
  }
  // На чью сторону встанет держава owner в этом бою (или null — ни на чью).
  sideFor(btl, owner) {
    if (owner === btl.ownA) return 'a';
    if (owner === btl.ownB) return 'b';
    const hA = this.isHostile(owner, btl.ownA), hB = this.isHostile(owner, btl.ownB);
    if (hA && !hB) return 'b';
    if (hB && !hA) return 'a';
    return null;
  }
  startField(a, b) {
    const btl = {
      id: this.newId(), kind: 'field', a: a.id, b: b.id, sideA: [], sideB: [], ownA: a.owner, ownB: b.owner,
      t: 0, x: (a.x + b.x) / 2, y: (a.y + b.y) / 2, startA: 0, startB: 0, lossA: 0, lossB: 0, men: {}, loss: {},
      defender: a.state === 'move' && b.state !== 'move' ? 'b' : b.state === 'move' && a.state !== 'move' ? 'a' : null,
    };
    this.battles.push(btl);
    this.joinBattle(btl, a, 'a');
    this.joinBattle(btl, b, 'b');
    this.pullIn(btl);
    const pl = this.player;
    if (pl && (btl.ownA === pl.id || btl.ownB === pl.id)) {
      const mine = btl.ownA === pl.id ? a : b, foe = mine === a ? b : a;
      this.notify(mine.name + ' вступает в бой: ' + this.kingdom(foe.owner).name, 'war', btl, true);
      this.emit('battle', btl);
    }
  }
  joinBattle(btl, x, side) {
    if (x.state === 'siege') { x.resumeSiege = x.siegeCity; this.leaveSiege(x); }
    x.prevState = x.state === 'move' ? 'move' : 'idle';
    x.state = 'battle'; x.battleId = btl.id; x.march = false;
    (side === 'a' ? btl.sideA : btl.sideB).push(x.id);
    const m = menCount(x.units);
    btl.men[x.id] = m; btl.loss[x.id] = 0;
    if (side === 'a') btl.startA += m; else btl.startB += m;
  }
  // В бой втягиваются соседние дивизии обеих сторон (в радиусе DIV.join от любого участника).
  pullIn(btl) {
    const R = DIV.join, ids = btl.sideA.concat(btl.sideB);
    for (const d of this.armies) {
      if (d.state === 'battle' || d.state === 'retreat' || d.immuneUntil > this.time) continue;
      if (Math.abs(d.x - btl.x) > R + 3 || Math.abs(d.y - btl.y) > R + 3) continue;
      let near = false;
      for (const id of ids) {
        const p = this.army(id);
        if (p && Math.abs(p.x - d.x) <= R && Math.abs(p.y - d.y) <= R && dist(p.x, p.y, d.x, d.y) <= R) { near = true; break; }
      }
      if (!near) continue;
      const side = this.sideFor(btl, d.owner);
      if (side) this.joinBattle(btl, d, side);
    }
  }
  // Убрать дивизию из сторон боя (ведущая заменяется следующей).
  dropFromBattle(btl, d) {
    btl.sideA = btl.sideA.filter(id => id !== d.id);
    btl.sideB = btl.sideB.filter(id => id !== d.id);
    if (btl.a === d.id && btl.sideA.length) btl.a = btl.sideA[0];
    if (btl.b === d.id && btl.sideB.length) btl.b = btl.sideB[0];
    d.battleId = null;
  }
  // Дивизия покидает бой вне хода сражения (удалена, ушла): если сторона опустела, бой заканчивается сразу.
  leaveBattle(d) {
    const btl = this.battleOf(d);
    d.battleId = null;
    if (!btl) return;
    if (btl.kind === 'siege') { this.leaveSiege(d); return; }
    this.dropFromBattle(btl, d);
    if (!btl.sideA.length || !btl.sideB.length) this.finishField(btl, btl.sideA.length ? 'a' : btl.sideB.length ? 'b' : null);
  }

  // Урон, который отряды src наносят отрядам dst за тик.
  damage(src, dst, opt) {
    const out = {};
    let dstHp = 0;
    for (const j in dst) dstHp += dst[j] * UNITS[j].hp;
    if (dstHp <= 0) return out;
    for (const i in src) {
      const u = UNITS[i];
      const n = src[i];
      let phase = 1;
      if (opt.volley) phase = u.ranged ? 1 : 0.25;
      else phase = u.ranged ? 0.75 : 1;
      let base = n * u.atk * phase * opt.mult;
      if (opt.walls) base *= u.ranged ? 0.6 : opt.wallsUp ? 0.35 : 1;
      for (const j in dst) {
        const share = dst[j] * UNITS[j].hp / dstHp;
        const bonus = (u.bonus && u.bonus[j]) || 1;
        const dj = UNITS[j];
        out[j] = (out[j] || 0) + base * share * bonus * 6 / (6 + dj.def * 1.5);
      }
    }
    for (const j in out) out[j] *= COMBAT.k * opt.dt;
    return out;
  }
  applyDamage(units, wounds, dmg, mult) {
    let killed = 0;
    for (const j in dmg) {
      if (!units[j]) continue;
      const hp = UNITS[j].hp;
      wounds[j] = (wounds[j] || 0) + dmg[j] * mult;
      const k = Math.min(units[j], Math.floor(wounds[j] / hp));
      if (k > 0) {
        units[j] -= k; wounds[j] -= k * hp;
        killed += k * (UNITS[j].crew || 1);
        if (units[j] <= 0) { delete units[j]; delete wounds[j]; }
      }
    }
    return killed;
  }
  // Множитель урона дивизии: организованность, опыт, жалованье.
  moraleMult(a) {
    const k = this.kingdom(a.owner);
    let m = (0.55 + (a.org === undefined ? 100 : a.org) / 220) * (1 + (a.xp || 0) / DIV.xpMax * DIV.xpAtk);
    if (k && (k.unpaid || k.starving)) m *= 0.85;
    return m;
  }
  terrainDef(x, y) {
    const i = this.world.tileAt(x, y);
    return i >= 0 ? TERRAIN[this.world.terrain[i]].def : 0;
  }
  // Удар с нескольких сторон: чем шире охват противника, тем сильнее атакующие.
  flankMult(S, E) {
    if (S.length < 2 || !E.length) return 1;
    let cx = 0, cy = 0;
    for (const e of E) { cx += e.x; cy += e.y; }
    cx /= E.length; cy /= E.length;
    const ang = S.map(s => Math.atan2(s.y - cy, s.x - cx)).sort((p, q) => p - q);
    let gap = ang[0] + TAU - ang[ang.length - 1];
    for (let i = 1; i < ang.length; i++) gap = Math.max(gap, ang[i] - ang[i - 1]);
    const spread = TAU - gap;
    return spread > DIV.flankWide ? 1 + DIV.flankBonus : spread > DIV.flankWide * 0.6 ? 1 + DIV.flankBonus * 0.5 : 1;
  }
  // Суммарный состав стороны.
  poolOf(list) {
    const p = {};
    for (const d of list) for (const u in d.units) p[u] = (p[u] || 0) + d.units[u];
    return p;
  }
  // Доля урона dmg по общему составу pool приходится на дивизию e по её доле в каждом роде войск.
  hitDivision(btl, e, dmg, pool, def, dt, k) {
    const part = {};
    for (const j in dmg) if (e.units[j] && pool[j]) part[j] = dmg[j] * e.units[j] / pool[j];
    const killed = this.applyDamage(e.units, e.wounds, part, 1 / (1 + def));
    btl.loss[e.id] = (btl.loss[e.id] || 0) + killed;
    e.org = Math.max(0, e.org - killed / Math.max(1, btl.men[e.id] || 1) * (k || DIV.orgLossK) - DIV.orgFatigue * dt);
    return killed;
  }
  // Защита дивизии: местность (если она обороняется) и окапывание.
  divDefense(d, defending) {
    return (defending ? this.terrainDef(d.x, d.y) : 0) + (d.entrench || 0) * DIV.digDef;
  }

  updateBattles(dt) {
    for (const btl of this.battles.slice()) {
      if (this.battles.indexOf(btl) < 0) continue;
      btl.t += dt;
      if (btl.kind === 'field') this.tickField(btl, dt);
      else this.tickSiege(btl, dt);
    }
  }

  tickField(btl, dt) {
    this.pullIn(btl);
    let A = this.sideArmies(btl, 'a'), B = this.sideArmies(btl, 'b');
    btl.sideA = A.map(x => x.id); btl.sideB = B.map(x => x.id);
    if (!A.length || !B.length) { this.finishField(btl, A.length ? 'a' : B.length ? 'b' : null); return; }
    btl.a = A[0].id; btl.b = B[0].id;
    const volley = btl.t < COMBAT.volley;
    const poolA = this.poolOf(A), poolB = this.poolOf(B);
    const flA = this.flankMult(A, B), flB = this.flankMult(B, A);
    btl.flankA = flA; btl.flankB = flB;
    const toA = {}, toB = {};
    for (const d of A) addUnits(toB, this.damage(d.units, poolB, { volley, mult: this.moraleMult(d) * flA, dt }));
    for (const d of B) addUnits(toA, this.damage(d.units, poolA, { volley, mult: this.moraleMult(d) * flB, dt }));
    let ka = 0, kb = 0;
    for (const e of B) kb += this.hitDivision(btl, e, toB, poolB, this.divDefense(e, btl.defender === 'b'), dt);
    for (const e of A) ka += this.hitDivision(btl, e, toA, poolA, this.divDefense(e, btl.defender === 'a'), dt);
    btl.lossA += ka; btl.lossB += kb;
    this.creditKills(btl.ownA, btl.ownB, kb);
    this.creditKills(btl.ownB, btl.ownA, ka);
    if (ka || kb) this.fxHit(btl.x, btl.y, ka + kb);
    // опыт; разбитые и обескровленные дивизии выходят из боя и отходят к своим
    for (const d of A.concat(B)) {
      d.xp = Math.min(DIV.xpMax, (d.xp || 0) + DIV.xpBattle * dt);
      const men = menCount(d.units);
      if (!men) { this.dropFromBattle(btl, d); this.removeArmy(d); continue; }
      if (d.org < DIV.routOrg || men < (btl.men[d.id] || men) * COMBAT.routFrac) {
        this.dropFromBattle(btl, d);
        this.withdraw(d, btl);
      }
    }
    if (!btl.sideA.length || !btl.sideB.length) this.finishField(btl, btl.sideA.length ? 'a' : btl.sideB.length ? 'b' : null);
  }

  creditKills(killerOwner, victimOwner, n) {
    if (!n) return;
    const k = this.kingdom(killerOwner), v = this.kingdom(victimOwner);
    if (k && k.stats) k.stats.killed = (k.stats.killed || 0) + n;
    if (v && v.stats) v.stats.fallen = (v.stats.fallen || 0) + n;
  }

  finishField(btl, winner) {
    if (this.battles.indexOf(btl) < 0) return;
    this.battles = this.battles.filter(x => x !== btl);
    const W = winner ? this.sideArmies(btl, winner) : [];
    const L = winner ? this.sideArmies(btl, winner === 'a' ? 'b' : 'a') : this.sideArmies(btl, 'a').concat(this.sideArmies(btl, 'b'));
    const wOwn = winner === 'a' ? btl.ownA : winner === 'b' ? btl.ownB : null;
    const lOwn = winner === 'a' ? btl.ownB : winner === 'b' ? btl.ownA : null;
    const wk = this.kingdom(wOwn), lk = this.kingdom(lOwn);
    const pl = this.player;
    if (wk && wk.stats) wk.stats.won++;
    if (lk && lk.stats) lk.stats.lost++;
    if (lk && lk.bandit && wk && !wk.bandit) {
      const loot = 120 + Math.round((winner === 'a' ? btl.startB : btl.startA) * 1.5);
      wk.res.gold += loot;
      if (wk.isPlayer) this.notify('Разбойники разбиты. Добыча: ' + loot + ' золота', 'good', btl);
    }
    for (const win of W) {
      win.state = 'idle'; win.battleId = null;
      win.org = Math.min(100, win.org + DIV.orgWin);
      win.xp = Math.min(DIV.xpMax, (win.xp || 0) + DIV.xpWin);
      // продолжаем прежний приказ
      if (win.resumeSiege) {
        const c = this.city(win.resumeSiege);
        win.resumeSiege = null;
        if (c && c.owner !== win.owner) this.startSiege(win, c);
      } else if (win.dest && win.dest.kind !== 'army') {
        const err = this.order(win, win.dest);
        if (err) { win.dest = null; win.state = 'idle'; }
      } else { win.dest = null; win.path = null; }
    }
    // без победителя (обе стороны ушли) оставшиеся просто встают
    for (const d of L) {
      d.battleId = null; d.resumeSiege = null;
      if (winner) this.withdraw(d, btl); else { d.state = 'idle'; d.path = null; d.dest = null; }
    }
    if (pl && wk && lk && (wOwn === pl.id || lOwn === pl.id)) {
      const mine = wOwn === pl.id;
      const ours = (winner === 'a') === mine ? btl.lossA : btl.lossB, theirs = (winner === 'a') === mine ? btl.lossB : btl.lossA;
      this.notify(mine ? `Победа! Враг потерял ${theirs}, мы — ${ours}` : `Поражение. Мы потеряли ${ours} воинов`, mine ? 'good' : 'bad', btl, true);
    }
    this.emit('battleEnd', { btl, winner: W[0] || null, loser: L[0] || null });
  }

  // Отход: разбитая дивизия выходит из боя и отступает на несколько клеток к своим (не обязательно до города).
  withdraw(d, btl) {
    d.battleId = null; d.resumeSiege = null; d.entrench = 0; d.path = null; d.march = false;
    const k = this.kingdom(d.owner);
    if (d.isBandit || !k || k.bandit) { this.removeArmy(d); return; }
    d.state = 'retreat';
    d.immuneUntil = this.time + DIV.retreatImmune;
    // от врагов…
    let ex = btl ? btl.x : d.x, ey = btl ? btl.y : d.y, n = 0, sx = 0, sy = 0;
    if (btl) {
      const mine = btl.kind === 'siege' ? null : this.sideFor(btl, d.owner);
      const foes = mine ? this.sideArmies(btl, mine === 'a' ? 'b' : 'a') : [];
      for (const f of foes) { sx += f.x; sy += f.y; n++; }
      if (n) { ex = sx / n; ey = sy / n; }
    }
    let ax = d.x - ex, ay = d.y - ey, al = Math.hypot(ax, ay);
    if (al > 0.01) { ax /= al; ay /= al; } else { ax = 0; ay = 0; }
    // …и к ближайшему своему городу
    let best = null, bd = Infinity;
    for (const c of this.cities) {
      if (c.owner !== d.owner || c.siegeBy) continue;
      const dd = dist(c.x + 0.5, c.y + 0.5, d.x, d.y);
      if (dd < bd) { bd = dd; best = c; }
    }
    if (best && bd > 0.5) { ax = ax * 0.6 + (best.x + 0.5 - d.x) / bd * 0.4; ay = ay * 0.6 + (best.y + 0.5 - d.y) / bd * 0.4; }
    al = Math.hypot(ax, ay);
    if (al > 0.01) {
      ax /= al; ay /= al;
      for (const rot of [0, 0.6, -0.6, 1.2, -1.2]) {
        const c = Math.cos(rot), s = Math.sin(rot);
        const L = best ? Math.min(DIV.fallback, Math.max(1, bd - 1)) : DIV.fallback;
        const tx = d.x + (ax * c - ay * s) * L, ty = d.y + (ax * s + ay * c) * L;
        const i = this.world.tileAt(tx, ty);
        if (i < 0 || !this.world.passable(i) || !this.world.main[i]) continue;
        if (this.setPath(d, tx, ty)) { d.dest = { kind: 'ground', x: tx, y: ty }; return; }
      }
    }
    this.retreat(d);
  }

  // Полное отступление к ближайшему своему городу (когда отойти к своим некуда).
  retreat(a) {
    a.state = 'retreat';
    a.immuneUntil = this.time + 10;
    a.org = Math.max(a.org, 10);
    const k = this.kingdom(a.owner);
    if (a.isBandit || !k || k.bandit) {
      // разбойники рассеиваются
      this.removeArmy(a);
      return;
    }
    let best = null, bd = Infinity;
    for (const c of this.cities) {
      if (c.owner !== a.owner || c.siegeBy) continue;
      const d = dist(c.x, c.y, a.x, a.y);
      if (d < bd) { bd = d; best = c; }
    }
    if (!best) { this.removeArmy(a); return; }
    if (!this.setPath(a, best.x + 0.5, best.y + 0.5)) { this.removeArmy(a); return; }
    a.dest = { kind: 'city', id: best.id };
  }

  // ---------- осады ----------
  // В осаде могут участвовать несколько дивизий (sideA); a — ведущая, её id в c.siegeBy.
  siegeOf(c) {
    for (const b of this.battles) if (b.kind === 'siege' && b.city === c.id) return b;
    return null;
  }
  startSiege(a, c) {
    if (c.siegeBy && c.siegeBy !== a.id) {
      const other = this.army(c.siegeBy);
      if (other && this.isHostile(other.owner, a.owner)) {
        if (other.state !== 'battle') { this.startField(a, other); return; }
      } else if (other) {
        const btl = this.siegeOf(c);
        if (btl) { this.joinSiege(btl, a, c); return; }
      }
    }
    a.state = 'siege'; a.siegeCity = c.id; a.dest = { kind: 'city', id: c.id }; a.path = null; a.march = false;
    c.siegeBy = a.id;
    c.siegeT = 0;
    const btl = {
      id: this.newId(), kind: 'siege', a: a.id, sideA: [a.id], city: c.id, t: 0, x: c.x + 0.5, y: c.y + 0.5,
      startA: menCount(a.units), lossA: 0, lossB: 0, men: { [a.id]: menCount(a.units) }, loss: { [a.id]: 0 },
    };
    a.battleId = btl.id;
    this.battles.push(btl);
    // горожане берутся за оружие один раз за осаду
    if (!c.raised && c.owner !== -1) {
      const n = Math.floor(c.pop * 0.05 / 10) * 10;
      if (n > 0) { c.garrison.militia = (c.garrison.militia || 0) + n; c.pop -= n; }
      c.raised = true;
    }
    const pl = this.player;
    if (pl && c.owner === pl.id) this.notify('Враг осаждает ' + c.name + '!', 'bad', c, true);
    else if (pl && a.owner === pl.id) this.notify(a.name + ' осаждает ' + c.name, 'war', c);
    this.emit('siege', { army: a, city: c });
  }
  // Ещё одна дивизия встаёт под стены: со своей стороны города, чуть в стороне от соседей.
  joinSiege(btl, a, c) {
    a.state = 'siege'; a.siegeCity = c.id; a.dest = { kind: 'city', id: c.id }; a.path = null; a.march = false;
    a.battleId = btl.id;
    btl.sideA.push(a.id);
    const m = menCount(a.units);
    btl.men[a.id] = m; btl.loss[a.id] = 0; btl.startA += m;
    const cx = c.x + 0.5, cy = c.y + 0.5;
    let ang = Math.atan2(a.y - cy, a.x - cx);
    for (let tries = 0; tries < 6; tries++) {
      let clash = false;
      for (const id of btl.sideA) {
        const o = this.army(id);
        if (o && o !== a && dist(o.x, o.y, cx + Math.cos(ang) * 1.1, cy + Math.sin(ang) * 1.1) < 0.7) { clash = true; break; }
      }
      if (!clash) break;
      ang += (tries % 2 ? -1 : 1) * (0.7 + tries * 0.35);
    }
    const tx = cx + Math.cos(ang) * 1.1, ty = cy + Math.sin(ang) * 1.1, i = this.world.tileAt(tx, ty);
    if (i >= 0 && this.world.passable(i)) { a.x = tx; a.y = ty; }
  }
  // Дивизия уходит из осады; последняя снимает осаду совсем.
  leaveSiege(a) {
    const c = this.city(a.siegeCity);
    for (const btl of this.battles) {
      if (btl.kind !== 'siege' || (btl.a !== a.id && btl.sideA.indexOf(a.id) < 0)) continue;
      btl.sideA = btl.sideA.filter(id => id !== a.id);
      if (btl.a === a.id && btl.sideA.length) btl.a = btl.sideA[0];
      if (!btl.sideA.length) {
        this.battles = this.battles.filter(b => b !== btl);
        if (c && c.siegeBy === a.id) c.siegeBy = null;
      } else if (c && c.siegeBy === a.id) c.siegeBy = btl.a;
      break;
    }
    if (c && c.siegeBy === a.id) c.siegeBy = null;
    a.siegeCity = null;
    a.battleId = null;
  }
  pauseSiege(a) { this.leaveSiege(a); }
  endSiege(a, keepState) {
    this.leaveSiege(a);
    if (!keepState) a.state = 'idle';
  }

  tickSiege(btl, dt) {
    const c = this.city(btl.city);
    const parts = [];
    if (c) for (const id of btl.sideA) {
      const x = this.army(id);
      if (x && x.state === 'siege' && x.siegeCity === c.id && x.owner !== c.owner) parts.push(x);
    }
    if (!c || !parts.length) {
      this.battles = this.battles.filter(x => x !== btl);
      if (c && c.siegeBy === btl.a) c.siegeBy = null;
      for (const id of btl.sideA) {
        const x = this.army(id);
        if (x && x.state === 'siege' && x.siegeCity === btl.city) { x.state = 'idle'; x.siegeCity = null; x.battleId = null; x.dest = null; }
      }
      return;
    }
    btl.sideA = parts.map(x => x.id);
    btl.a = parts[0].id;
    c.siegeBy = btl.a;
    c.siegeT = (c.siegeT || 0) + dt;
    const wallsUp = c.walls > 0 && c.wallHp > 0;
    const pool = this.poolOf(parts);
    // стены
    if (wallsUp) {
      c.wallHp = Math.max(0, c.wallHp - (siegePower(pool) + menCount(pool) * 0.02) * dt);
      if (c.wallHp <= 0) {
        const pl = this.player;
        if (pl && (c.owner === pl.id || parts[0].owner === pl.id)) this.notify('Стены города ' + c.name + ' пробиты!', c.owner === pl.id ? 'bad' : 'war', c);
        this.fxBoom(c.x + 0.5, c.y + 0.5);
      }
    }
    const volley = btl.t < COMBAT.volley;
    const bonus = wallsUp ? WALLS[c.walls].bonus : 0;
    // башни бьют по осаждающим
    const towerDps = c.towers ? TOWERS[c.towers].dps * (wallsUp ? 1 : 0.5) : 0;
    const toA = {};
    if (towerDps > 0) {
      let hpSum = 0;
      for (const j in pool) hpSum += pool[j] * UNITS[j].hp;
      for (const j in pool) toA[j] = towerDps * dt * (pool[j] * UNITS[j].hp / Math.max(1, hpSum)) * 6 / (6 + UNITS[j].def * 1.5);
    }
    let lossA = 0, lossB = 0;
    if (menCount(c.garrison) > 0) {
      const gMult = (c.owner === -1 ? 0.9 : 1) * (1 + (wallsUp ? 0.3 : 0));
      addUnits(toA, this.damage(c.garrison, pool, { volley, mult: gMult, dt }));
      const toG = {};
      for (const d of parts) addUnits(toG, this.damage(d.units, c.garrison, { volley, mult: this.moraleMult(d), dt, walls: wallsUp, wallsUp }));
      lossB += this.applyDamage(c.garrison, c.wounds, toG, 1 / (1 + bonus));
    }
    for (const d of parts) lossA += this.hitDivision(btl, d, toA, pool, 0, 0, DIV.orgLossSiege);
    btl.lossA += lossA; btl.lossB += lossB;
    this.creditKills(c.owner, parts[0].owner, lossA);
    this.creditKills(parts[0].owner, c.owner, lossB);
    if (lossA || lossB) this.fxHit(c.x + 0.5, c.y + 0.5, lossA + lossB);
    // опыт; обескровленные и разбитые дивизии отходят от стен
    let last = parts[0];
    for (const d of parts) {
      d.xp = Math.min(DIV.xpMax, (d.xp || 0) + DIV.xpBattle * 0.5 * dt);
      const men = menCount(d.units);
      if (!men) { last = d; this.leaveSiege(d); this.removeArmy(d); continue; }
      if (d.org < DIV.routOrg || men < (btl.men[d.id] || men) * COMBAT.routFrac) {
        last = d;
        this.leaveSiege(d);
        this.withdraw(d, null);
      }
    }
    if (this.battles.indexOf(btl) < 0 || !btl.sideA.length) {
      this.battles = this.battles.filter(x => x !== btl);
      if (c.siegeBy && !this.army(c.siegeBy)) c.siegeBy = null;
      if (!c.siegeBy) this.siegeRepelled(c, last, btl);
      return;
    }
    if (menCount(c.garrison) === 0 && (c.walls === 0 || c.wallHp <= 0)) {
      this.battles = this.battles.filter(x => x !== btl);
      this.capture(c, this.army(btl.a), btl);
    }
  }

  siegeRepelled(c, a, btl) {
    c.raised = false;
    const pl = this.player;
    const ck = this.kingdom(c.owner);
    if (ck && ck.stats) ck.stats.won++;
    const ak = this.kingdom(a.owner);
    if (ak && ak.stats) ak.stats.lost++;
    if (pl && c.owner === pl.id) this.notify(c.name + ' отбил осаду!', 'good', c, true);
    else if (pl && a.owner === pl.id) this.notify('Осада ' + c.name + ' провалилась', 'bad', c, true);
  }

  // Город взят. Одиночная дивизия входит в город целиком (как раньше); дивизия фронта или армии, а также
  // при осаде несколькими дивизиями — оставляет в городе гарнизон из части воинов и остаётся в поле.
  capture(c, a, btl) {
    const old = this.kingdom(c.owner);
    const ak = this.kingdom(a.owner);
    c.siegeBy = null;
    c.raised = false;
    a.siegeCity = null; a.battleId = null;
    const others = [];
    if (btl) for (const id of btl.sideA) { const o = this.army(id); if (o && o !== a && o.siegeCity === c.id) others.push(o); }
    for (const o of others) { o.state = 'idle'; o.siegeCity = null; o.battleId = null; o.dest = null; o.path = null; }
    const pl = this.player;
    if (a.isBandit || (ak && ak.bandit)) {
      // разбойники грабят и уходят
      if (old && !old.bandit) {
        const loot = Math.min(400, Math.floor(old.res.gold * 0.3));
        old.res.gold -= loot;
        if (old.isPlayer) this.notify('Разбойники разграбили ' + c.name + ' и унесли ' + loot + ' золота', 'bad', c, true);
      }
      this.damageBuilding(c);
      c.pop = Math.floor(c.pop * 0.85);
      a.state = 'idle';
      a.raided = (a.raided || 0) + 1;
      a.leaveAt = this.time;
      return;
    }
    c.owner = a.owner;
    c.pop = Math.floor(c.pop * 0.75);
    c.construction = null;
    c.queue = [];
    c.divQueue = [];
    c.wallHp = 0;
    const stay = a.front !== null && a.front !== undefined || a.group !== null && a.group !== undefined || others.length > 0;
    if (stay && menCount(a.units) >= 30) {
      // в городе остаётся отряд, дивизия идёт дальше
      const det = Fronts.detachment(a.units);
      addUnits(a.units, det, -1);
      c.garrison = det;
      c.wounds = {};
      a.state = 'idle'; a.dest = null; a.path = null;
      a.tpl = Fronts.guessTpl(this, a.owner, a.units);
    } else {
      c.garrison = { ...a.units };
      c.wounds = { ...a.wounds };
      this.removeArmy(a);
    }
    this.damageBuilding(c);
    const wasCapital = c.isCapital;
    c.isCapital = false;
    this.refreshTerritory(true);
    // добыча
    let loot = 120 + c.level * 60;
    if (old && !old.bandit) loot += Math.min(300, Math.floor(old.res.gold * 0.15));
    if (old && !old.bandit) old.res.gold = Math.max(0, old.res.gold - Math.min(300, Math.floor(old.res.gold * 0.15)));
    ak.res.gold += loot;
    ak.stats.taken++;
    if (old && old.stats) old.stats.lostCities++;
    ak.stats.maxCities = Math.max(ak.stats.maxCities, this.citiesOf(ak.id).length);
    this.ownershipVersion++;
    if (ak.isPlayer) this.notify('Мы взяли ' + c.name + '! Добыча: ' + loot + ' золота', 'good', c, true);
    else if (old && old.isPlayer) this.notify('Мы потеряли ' + c.name + '. Город взяли: ' + ak.name, 'bad', c, true);
    else if (this.explored[this.cityTile(c)]) this.notify(ak.name + ' захватывает ' + c.name, 'info', c);
    this.emit('captured', { city: c, from: old, to: ak });
    if (old) {
      if (wasCapital) this.moveCapital(old);
      this.checkElimination(old);
    }
    this.checkVictory();
  }

  damageBuilding(c) {
    const built = Object.keys(c.buildings).filter(b => c.buildings[b] > 0);
    if (!built.length) return;
    const b = this.rng.pick(built);
    c.buildings[b]--;
    if (c.buildings[b] <= 0) delete c.buildings[b];
  }

  moveCapital(k) {
    const cs = this.citiesOf(k.id);
    if (!cs.length) { k.capital = null; return; }
    cs.sort((p, q) => q.level - p.level || q.pop - p.pop);
    cs[0].isCapital = true;
    k.capital = cs[0].id;
    if (k.isPlayer) this.notify('Столица перенесена в ' + cs[0].name, 'bad', cs[0], true);
  }

  checkElimination(k) {
    if (!k.alive || k.bandit) return;
    if (this.citiesOf(k.id).length > 0) return;
    k.alive = false;
    for (const a of this.armiesOf(k.id)) this.removeArmy(a);
    this.notify(k.isPlayer ? 'Ваша держава пала.' : k.name + ' прекращает существование!', k.isPlayer ? 'bad' : 'good', null, true);
    this.emit('eliminated', k);
  }

  checkVictory() {
    if (this.winner !== null) return;
    const pl = this.player;
    if (!pl.alive) { this.winner = -1; this.emit('gameover', { win: false, reason: 'fallen' }); return; }
    const rivals = this.kingdoms.filter(k => !k.isPlayer && !k.bandit && k.alive);
    const total = this.cities.length;
    if (!rivals.length || this.citiesOf(pl.id).length >= Math.ceil(total * WIN_SHARE)) {
      this.winner = pl.id;
      this.emit('gameover', { win: true, reason: rivals.length ? 'share' : 'conquest' });
      return;
    }
    for (const k of rivals) {
      if (this.citiesOf(k.id).length >= Math.ceil(total * LOSE_SHARE)) {
        this.winner = k.id;
        this.emit('gameover', { win: false, reason: 'share', by: k });
        return;
      }
    }
  }

  // ---------- главный цикл ----------
  update(dt) {
    if (this.winner !== null) { this.updateFx(dt); return; }
    this.time += dt;
    this.updateArmies(dt);
    this.checkContacts();
    this.battleT += dt;
    while (this.battleT >= BATTLE_TICK) { this.battleT -= BATTLE_TICK; this.updateBattles(BATTLE_TICK); }
    this.econT += dt;
    while (this.econT >= 1) { this.econT -= 1; this.tickEconomy(1); }
    this.visT += dt;
    if (this.visT >= 0.5) { this.visT = 0; this.updateVisibility(); }
    this.inflT += dt;
    if (this.inflT >= INFLUENCE.recheck) { this.inflT = 0; this.refreshTerritory(false); }
    this.updateBandits(dt);
    this.updateEvents(dt);
    if (typeof AI !== 'undefined') {
      this.aiT += dt;
      if (this.aiT >= 0.5) { AI.update(this, this.aiT); this.aiT = 0; }
    }
    Mods.call('update', this, dt);
    this.updateFx(dt);
  }

  // Соприкосновение враждебных дивизий: новый бой или вступление в уже идущий.
  checkContacts() {
    const arr = this.armies;
    for (let i = 0; i < arr.length; i++) {
      const a = arr[i];
      if (a.state === 'battle' || a.immuneUntil > this.time) continue;
      for (let j = i + 1; j < arr.length; j++) {
        const b = arr[j];
        if (Math.abs(a.x - b.x) > COMBAT.contact || Math.abs(a.y - b.y) > COMBAT.contact) continue;
        if (a.owner === b.owner || b.immuneUntil > this.time || !this.isHostile(a.owner, b.owner)) continue;
        if (dist(a.x, a.y, b.x, b.y) > COMBAT.contact) continue;
        // разбойники не трогают друг друга
        if (a.isBandit && b.isBandit) continue;
        if (b.state === 'battle') {
          const btl = this.battleOf(b), side = btl && btl.kind === 'field' ? this.sideFor(btl, a.owner) : null;
          if (!side) continue;
          this.joinBattle(btl, a, side);
        } else this.startField(a, b);
        break;
      }
    }
  }

  tickEconomy(dt) {
    for (const k of this.kingdoms) {
      if (!k.alive || k.bandit) continue;
      const inc = this.income(k).total;
      for (const r of RES_IDS) {
        k.res[r] += inc[r] / 60 * dt;
        if (k.res[r] > ECON.resCap) k.res[r] = ECON.resCap;
      }
      const wasUnpaid = k.unpaid, wasStarving = k.starving;
      k.unpaid = k.res.gold < 0;
      k.starving = k.res.food < 0;
      if (k.res.gold < 0) k.res.gold = 0;
      if (k.res.food < 0) k.res.food = 0;
      for (const r of ['wood', 'stone', 'iron']) if (k.res[r] < 0) k.res[r] = 0;
      if (k.isPlayer) {
        if (k.unpaid && !wasUnpaid) this.notify('Казна пуста! Войскам не платят: падает боевой дух, солдаты дезертируют.', 'bad', null, true);
        if (k.starving && !wasStarving) this.notify('Голод! Население убывает, войска разбегаются. Стройте фермы.', 'bad', null, true);
      }
      if (k.unpaid || k.starving) {
        for (const a of this.armies.slice()) {
          if (a.owner !== k.id) continue;
          a.org = Math.max(DIV.orgFloor, a.org - DIV.orgUnpaid * dt);
          for (const u in a.units) {
            if (this.rng.chance(0.02 * dt)) {
              a.units[u] = Math.max(0, a.units[u] - Math.ceil(a.units[u] * 0.04));
              if (!a.units[u]) delete a.units[u];
            }
          }
          if (!menCount(a.units) && a.state !== 'battle') this.removeArmy(a);
        }
      }
      k.stats.maxCities = Math.max(k.stats.maxCities || 0, this.citiesOf(k.id).length);
    }
    for (const c of this.cities) this.tickCity(c, dt);
  }

  tickCity(c, dt) {
    const k = this.kingdom(c.owner);
    const L = CITY_LEVELS[c.level];
    // население
    if (k && k.starving) c.pop = Math.max(50, c.pop - c.pop * ECON.starve * dt / 60);
    else if (c.pop < L.popMax && !c.siegeBy) c.pop = Math.min(L.popMax, c.pop + (c.pop * ECON.growth + 10) * (1 - c.pop / L.popMax * 0.6) * dt / 60);
    // ремонт стен
    if (c.walls > 0 && !c.siegeBy && c.wallHp < WALLS[c.walls].hp) c.wallHp = Math.min(WALLS[c.walls].hp, c.wallHp + WALLS[c.walls].hp * 0.012 * dt);
    // вольные города понемногу восполняют гарнизон
    if (c.owner === -1 && !c.siegeBy && menCount(c.garrison) < 30 + c.level * 25 && this.rng.chance(0.03 * dt)) addUnits(c.garrison, { militia: 10 });
    if (c.siegeBy) return;
    if (!k || k.bandit) return;
    // стройка
    if (c.construction) {
      const b = c.construction;
      b.t += dt;
      if (b.t >= b.total) this.finishConstruction(c, k);
    }
    // найм
    if (c.queue.length) {
      const q = c.queue[0];
      q.t += dt;
      if (q.t >= q.total) {
        c.queue.shift();
        const u = UNITS[q.unit];
        addUnits(c.garrison, { [q.unit]: u.squad });
        if (k.isPlayer && !c.queue.length) this.notify('В городе ' + c.name + ' готов отряд: ' + u.name.toLowerCase(), 'info', c);
        this.emit('recruited', { city: c, unit: q.unit });
      }
    }
  }

  finishConstruction(c, k) {
    const b = c.construction;
    c.construction = null;
    if (b.kind === 'building') c.buildings[b.id] = b.to;
    else if (b.kind === 'walls') { c.walls = b.to; c.wallHp = WALLS[b.to].hp; }
    else if (b.kind === 'towers') c.towers = b.to;
    else if (b.kind === 'level') {
      c.level = b.to;
      this.refreshTerritory(true);
    }
    if (k.isPlayer) this.notify(c.name + ': ' + b.name.toLowerCase() + (b.kind === 'level' ? '' : ' (' + b.to + ' ур.)') + ' — готово', 'good', c);
    this.emit('built', { city: c, build: b });
  }

  // ---------- видимость ----------
  updateVisibility() {
    const w = this.world, W = w.W, H = w.H;
    const vis = this.visible;
    vis.fill(0);
    const pl = this.player;
    if (!pl) return;
    if (this.opts.spectate) { vis.fill(1); this.explored.fill(1); return; }
    const mark = (cx, cy, r) => {
      const x0 = Math.max(0, Math.floor(cx - r)), x1 = Math.min(W - 1, Math.ceil(cx + r));
      const y0 = Math.max(0, Math.floor(cy - r)), y1 = Math.min(H - 1, Math.ceil(cy + r));
      const r2 = r * r;
      for (let y = y0; y <= y1; y++) {
        const dy = y + 0.5 - cy;
        for (let x = x0; x <= x1; x++) {
          const dx = x + 0.5 - cx;
          if (dx * dx + dy * dy <= r2) vis[y * W + x] = 1;
        }
      }
    };
    for (const c of this.cities) if (c.owner === pl.id) mark(c.x + 0.5, c.y + 0.5, 6 + c.level);
    for (const a of this.armies) if (a.owner === pl.id) mark(a.x, a.y, this.armyVision(a));
    let changed = false;
    for (let i = 0; i < vis.length; i++) if (vis[i] && !this.explored[i]) { this.explored[i] = 1; changed = true; }
    if (changed) this.exploredVersion = (this.exploredVersion || 0) + 1;
  }
  isVisible(x, y) {
    const i = this.world.tileAt(x, y);
    return i >= 0 && this.visible[i] === 1;
  }
  isExplored(x, y) {
    const i = this.world.tileAt(x, y);
    return i >= 0 && this.explored[i] === 1;
  }

  // ---------- разбойники и события ----------
  updateBandits(dt) {
    this.banditT -= dt;
    // уход разбойников после набега или по времени
    for (const a of this.armies.slice()) {
      if (!a.isBandit || a.state === 'battle') continue;
      if ((a.leaveAt && this.time - a.leaveAt > 20) || this.time - a.born > 330) { this.removeArmy(a); continue; }
      if (a.state === 'idle' && !a.leaveAt) this.banditTarget(a);
    }
    if (this.banditT > 0) return;
    this.banditT = 170 + this.rng.range(0, 80);
    if (this.armies.filter(a => a.isBandit).length >= 3) return;
    const w = this.world;
    for (let tries = 0; tries < 60; tries++) {
      const x = this.rng.int(2, w.W - 3), y = this.rng.int(2, w.H - 3);
      const i = w.idx(x, y);
      if (!w.main[i] || !w.passable(i) || w.terrain[i] === T.MOUNTAIN || w.terrain[i] === T.SNOW) continue;
      if (this.cities.some(c => dist(c.x, c.y, x, y) < 7)) continue;
      if (this.armies.some(a => !a.isBandit && dist(a.x, a.y, x, y) < 5)) continue;
      const m = Math.min(4, 1 + this.time / 600);
      const units = { militia: Math.round(20 * m / 10) * 10 + 10, archer: Math.round(8 * m / 10) * 10 };
      if (this.time > 600) units.cavalry = 10;
      if (!units.archer) delete units.archer;
      const a = this.makeArmy(this.bandits.id, x + 0.5, y + 0.5, units);
      a.isBandit = true; a.name = 'Разбойники'; a.born = this.time;
      this.banditTarget(a);
      if (this.visible[i]) this.notify('В лесах объявилась шайка разбойников', 'bad', a);
      break;
    }
  }
  banditTarget(a) {
    let best = null, bs = Infinity;
    for (const c of this.cities) {
      if (c.owner === -1 || c.isCapital) continue;
      const d = dist(c.x, c.y, a.x, a.y);
      const s = d + menCount(c.garrison) * 0.15;
      if (d < 26 && s < bs) { bs = s; best = c; }
    }
    if (best) this.order(a, { kind: 'city', id: best.id });
    else a.leaveAt = this.time;
  }

  updateEvents(dt) {
    this.eventT -= dt;
    if (this.eventT > 0) return;
    this.eventT = 110 + this.rng.range(0, 90);
    const pl = this.player;
    const cs = this.citiesOf(pl.id);
    if (!cs.length) return;
    const c = this.rng.pick(cs);
    const roll = this.rng.int(0, 5);
    if (roll === 0) { pl.res.food += 150; this.notify('Богатый урожай в ' + c.name + ': +150 еды', 'good', c); }
    else if (roll === 1) { pl.res.gold += 120; this.notify('Ярмарка в ' + c.name + ': +120 золота', 'good', c); }
    else if (roll === 2) { pl.res.iron += 60; this.notify('Рудокопы нашли жилу: +60 железа', 'good', c); }
    else if (roll === 3) { const n = Math.floor(c.pop * 0.1); c.pop -= n; this.notify('Мор в ' + c.name + ': умерло ' + n + ' жителей', 'bad', c); }
    else if (roll === 4) { const n = Math.min(pl.res.wood, 80); pl.res.wood -= n; this.notify('Пожар на складах ' + c.name + ': сгорело ' + Math.floor(n) + ' дерева', 'bad', c); }
    else { c.pop = Math.min(CITY_LEVELS[c.level].popMax, c.pop + 60); this.notify('В ' + c.name + ' пришли переселенцы: +60 жителей', 'good', c); }
  }

  // ---------- эффекты ----------
  fxHit(x, y, n) {
    if (this.fx.length > 200) return;
    this.fx.push({ type: 'hit', x: x + (Math.random() - 0.5) * 0.8, y: y + (Math.random() - 0.5) * 0.6, t: 0, dur: 0.9, n });
  }
  fxBoom(x, y) { this.fx.push({ type: 'boom', x, y, t: 0, dur: 1.2 }); }
  updateFx(dt) {
    for (let i = this.fx.length - 1; i >= 0; i--) {
      this.fx[i].t += dt;
      if (this.fx[i].t >= this.fx[i].dur) this.fx.splice(i, 1);
    }
  }
}
