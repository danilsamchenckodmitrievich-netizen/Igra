'use strict';
// Основание новых городов и стены вдоль своих земель, построенные вручную (Mods.add).
// Обоз переселенцев идёт по карте и основывает деревню; стена — цепочка клеток своих земель с уровнем и прочностью:
// чужие армии её не проходят (обходят или ломают), свои ходят свободно. Логика работает и в Node (tools/load.js);
// интерфейс, инструменты ввода и отрисовка — в конце файла, только в браузере.
// Точки в ядре: World.findPath(…, owner) берёт штраф у world.pathPenalty, Game.setPath передаёт хозяина армии.

const FOUND = {
  pop: 150,                                   // жителей уходит с обозом
  cost: { gold: 200, food: 180, wood: 160 },
  minLevel: 2,                                // из города не ниже «Городка»
  keepPop: 250,                               // и в городе после ухода должно остаться не меньше
  minDist: 6,                                 // клеток до ближайшего города
  edge: 2,                                    // отступ от края карты
  speed: 0.8,                                 // клеток в секунду по равнине
  maxActive: 3,                               // обозов у державы одновременно
  guard: 10,                                  // ополченцев в новой деревне
  reach: 1.1,                                 // вражеская армия ближе — обоз перехвачен
  refund: 0.5,                                // доля цены при роспуске обоза
  aiFrom: 300,                                // ИИ начинает основывать города после этой секунды
  aiEvery: [150, 260],                        // и не чаще раза за такой срок
  aiMax: 4,                                   // городов, основанных ИИ за партию
  aiFar: [7, 16],                             // клеток от своего города до места
};
const WALL_LV = [
  null,
  { name: 'Частокол', cost: { gold: 2, wood: 12 }, time: 4, hp: 140 },
  { name: 'Каменная стена', cost: { gold: 6, stone: 26 }, time: 9, hp: 380 },
  { name: 'Крепостная стена', cost: { gold: 14, stone: 40, iron: 5 }, time: 16, hp: 850 },
];
const FWALL = {
  upgrade: 0.7,        // улучшение стоит такую долю цены нового уровня
  refund: 0.7,         // доля цены, возвращаемая при отмене недостроенного
  crew: 2,             // участков, которые строятся одновременно, + по одному на столько городов
  crewPer: 3, crewMax: 6,
  gateHp: 0.7,         // ворота (на дороге и реке) слабее стены
  gateTime: 1.3,
  pass: 30, passLv: 20,    // штраф шага через вражескую стену при поиске пути: обход выгоднее, если он короче
  strict: 400,         // для обозов стена почти непроходима
  siege: 1,            // урон стене в секунду = осадная сила армии × это + 0.02 за воина
  men: 0.02,
  repair: 0.5,         // прочность в секунду у целой стены, которую давно не били
  calm: 10,            // секунд без ударов до ремонта
  rubble: 240,         // сколько живут обломки
  aiFrom: 400, aiEvery: [50, 85], aiCap: 48, aiChunk: 12, aiNear: 17,
  aiReserve: { gold: 10, wood: 120, stone: 120, iron: 40, food: 0 },
};

// клетки по прямой, 4-связные (шаг только по вертикали или горизонтали): стена не пропускает «по диагонали»
function fdLine4(x0, y0, x1, y1, out) {
  const nx = Math.abs(x1 - x0), ny = Math.abs(y1 - y0), sx = x1 > x0 ? 1 : -1, sy = y1 > y0 ? 1 : -1;
  let x = x0, y = y0;
  out.push(y * 100000 + x);
  for (let ix = 0, iy = 0; ix < nx || iy < ny;) {
    const dec = (1 + 2 * ix) * ny - (1 + 2 * iy) * nx;
    if (dec === 0 && ix < nx && iy < ny) { x += sx; ix++; out.push(y * 100000 + x); y += sy; iy++; }
    else if (dec < 0 || iy >= ny) { x += sx; ix++; }
    else { y += sy; iy++; }
    out.push(y * 100000 + x);
  }
  return out;
}

const Founding = {
  strict: false,

  // ---------- состояние ----------
  fresh() {
    // walls: клетка → { o хозяин, l стоит уровень, t строится до уровня, p доля стройки, hp, gate }
    return { walls: new Map(), rubble: new Map(), settlers: [], aiT: {}, made: {}, ver: 0, terrV: -1, slow: 0, standing: 0,
      rt: new Map(), safe: new Map(), rep: new Map(), hurt: new Map(), msgT: -99, sm: null, sorted: null };
  },
  fd(g) { return g.fd || (g.fd = this.attach(g, this.fresh())); },
  // подключить состояние к партии: типизированные массивы для быстрой проверки и штраф пути
  attach(g, fd) {
    g.fd = fd;
    const w = g.world, n = w.W * w.H;
    w.wallLv = new Uint8Array(n);
    w.wallOwn = new Int16Array(n);
    fd.standing = 0;
    for (const [i, r] of fd.walls) if (r.l > 0) { w.wallLv[i] = r.l; w.wallOwn[i] = r.o; fd.standing++; }
    this.hook(g);
    return fd;
  },
  // штраф шага по вражеской стене; без стен поиск пути работает как раньше
  hook(g) {
    const w = g.world, fd = g.fd, lv = w.wallLv, own = w.wallOwn, F = this;
    if (!fd.standing) { w.pathPenalty = null; return; }
    w.pathPenalty = (i, owner) => {
      const l = lv[i];
      if (!l) return 0;
      const o = own[i];
      if (o === owner || !g.isHostile(o, owner)) return 0;
      return F.strict ? FWALL.strict : FWALL.pass + FWALL.passLv * l;
    };
  },
  serialize(g) {
    const fd = g.fd;
    if (!fd) return null;
    return {
      w: [...fd.walls].map(([i, r]) => [i, r.o, r.l, r.t, r.p, r.hp, r.gate ? 1 : 0]),
      r: [...fd.rubble],
      s: fd.settlers.map(s => ({ id: s.id, owner: s.owner, from: s.from, x: s.x, y: s.y, st: s.st, tx: s.tx, ty: s.ty, pop: s.pop })),
      ai: fd.aiT, made: fd.made,
    };
  },
  restore(g, d) {
    const fd = this.fresh();
    if (d) {
      for (const a of d.w || []) fd.walls.set(a[0], { o: a[1], l: a[2], t: a[3], p: a[4], hp: a[5], gate: !!a[6] });
      for (const a of d.r || []) fd.rubble.set(a[0], a[1]);
      fd.settlers = (d.s || []).map(s => ({ ...s }));
      fd.aiT = d.ai || {}; fd.made = d.made || {};
    }
    fd.ver = 1;
    this.attach(g, fd);
  },
  init(g, loaded) {
    const fd = this.fd(g);
    if (!loaded) fd.ver++;
    this.cancelTools(g);
  },

  // ---------- цены ----------
  full(level) { return { ...WALL_LV[level].cost }; },
  // цена участка: новый — полная; улучшение стоит дешевле; уже оплаченный уровень не берётся второй раз
  price(rec, level) {
    if (!rec) return this.full(level);
    if (rec.l > 0) return rec.t >= level ? null : scaleCost(this.full(level), FWALL.upgrade);
    if (rec.t >= level) return null;
    const a = this.full(level), b = this.full(rec.t), out = {};
    for (const r in a) { const v = a[r] - (b[r] || 0); if (v > 0) out[r] = v; }
    return out;
  },
  wallMax(rec, lvl) { return Math.round(WALL_LV[lvl || rec.t || rec.l].hp * (rec.gate ? FWALL.gateHp : 1)); },

  // ---------- стены: клетки, план, стройка ----------
  // Почему на клетке нельзя ставить стену державы owner; null — можно.
  cellBlock(g, owner, i) {
    const w = g.world;
    if (i < 0 || i >= w.W * w.H) return 'За краем карты';
    if (!w.passable(i)) return 'Стены ставят только на суше';
    const cid = w.cityOf[i];
    const c = cid >= 0 ? g.city(cid) : null;
    if (!c || c.owner !== owner) return 'Стены строят только на своих землях';
    for (const q of g.cities) if (q.x === i % w.W && q.y === (i - i % w.W) / w.W) return 'Здесь стоит город';
    return null;
  },
  // Ворота — там, где стена пересекает дорогу или реку; вдоль дороги ворот нет (кроме концов).
  isGate(g, i, set) {
    const w = g.world;
    if (!(w.road[i] || w.river[i])) return false;
    const fd = g.fd, n = w.W * w.H;
    let c = 0;
    for (const j of [i - 1, i + 1, i - w.W, i + w.W]) if (j >= 0 && j < n && (w.road[j] || w.river[j]) && ((set && set.has(j)) || fd.walls.has(j))) c++;
    return c <= 1;
  },
  // Сколько и чего стоит ряд клеток на уровне level.
  wallPlan(g, owner, cells, level) {
    const fd = this.fd(g), items = [], cost = {}, set = new Set(cells);
    let time = 0, nNew = 0, nUp = 0;
    for (const i of cells) {
      if (this.cellBlock(g, owner, i)) continue;
      const rec = fd.walls.get(i);
      if (rec && rec.o !== owner) continue;
      const p = this.price(rec, level);
      if (!p) continue;
      const gate = rec ? rec.gate : this.isGate(g, i, set);
      items.push({ i, gate });
      for (const r in p) cost[r] = (cost[r] || 0) + p[r];
      time += WALL_LV[level].time * (gate ? FWALL.gateTime : 1);
      if (rec && rec.l > 0) nUp++; else nNew++;
    }
    const crew = this.crewOf(g, owner);
    return { items, cost, n: items.length, nNew, nUp, time: time / crew };
  },
  crewOf(g, o) { return Math.min(FWALL.crewMax, FWALL.crew + Math.floor(g.citiesOf(o).length / FWALL.crewPer)); },
  // Заказать стройку: платит сразу, участки достраиваются по очереди.
  buildWalls(g, owner, cells, level) {
    const fd = this.fd(g), k = g.kingdom(owner);
    if (!k || !k.alive) return 'Держава не может строить';
    const plan = this.wallPlan(g, owner, cells, level);
    if (!plan.n) return 'Нечего строить';
    if (!g.canAfford(k, plan.cost)) return 'Не хватает: ' + g.missing(k, plan.cost).join(', ');
    g.pay(k, plan.cost);
    for (const it of plan.items) {
      const rec = fd.walls.get(it.i);
      if (rec) { rec.t = level; rec.p = 0; }
      else { fd.walls.set(it.i, { o: owner, l: 0, t: level, p: 0, hp: 0, gate: it.gate }); fd.ver++; }
      fd.rubble.delete(it.i);
    }
    return null;
  },
  // Отменить недостроенное: часть цены возвращается.
  cancelWalls(g, owner) {
    const fd = this.fd(g), k = g.kingdom(owner);
    const back = {};
    let n = 0;
    for (const [i, rec] of [...fd.walls]) {
      if (rec.o !== owner || rec.t <= rec.l) continue;
      const p = rec.l > 0 ? scaleCost(this.full(rec.t), FWALL.upgrade) : this.full(rec.t);
      for (const r in p) back[r] = (back[r] || 0) + p[r];
      n++;
      if (rec.l > 0) { rec.t = rec.l; rec.p = 0; } else { fd.walls.delete(i); fd.ver++; }
    }
    if (n && k) g.refund(k, back, FWALL.refund);
    return n;
  },
  pending(g, owner) {
    let n = 0;
    for (const rec of this.fd(g).walls.values()) if (rec.o === owner && rec.t > rec.l) n++;
    return n;
  },
  stats(g, owner) {
    const st = { lv: [0, 0, 0, 0], pending: 0, hp: 0, max: 0, gates: 0 };
    for (const rec of this.fd(g).walls.values()) {
      if (rec.o !== owner) continue;
      if (rec.l > 0) { st.lv[rec.l]++; st.hp += rec.hp; st.max += this.wallMax(rec, rec.l); if (rec.gate) st.gates++; }
      if (rec.t > rec.l) st.pending++;
    }
    return st;
  },
  hostileWall(g, i, owner) {
    const w = g.world;
    return !!w.wallLv[i] && w.wallOwn[i] !== owner && g.isHostile(w.wallOwn[i], owner);
  },

  // ---------- такт ----------
  update(g, dt) {
    const fd = g.fd;
    if (!fd) return;
    if (g.territoryVersion !== fd.terrV) { fd.terrV = g.territoryVersion; this.syncOwners(g); }
    if (fd.walls.size) { this.build(g, dt); if (fd.standing) this.enforce(g, dt); }
    if (fd.settlers.length) this.moveSettlers(g, dt);
    fd.slow += dt;
    if (fd.slow >= 2) { fd.slow = 0; this.slowTick(g); }
  },
  slowTick(g) {
    const fd = g.fd, w = g.world;
    // обломки, стены павших держав, ремонт
    for (const [i, t] of [...fd.rubble]) if (g.time - t > FWALL.rubble) fd.rubble.delete(i);
    for (const [i, rec] of [...fd.walls]) {
      const k = g.kingdom(rec.o);
      if (!k || !k.alive) { this.remove(g, i); continue; }
      if (rec.l > 0 && rec.hp < this.wallMax(rec, rec.l) && g.time - (fd.hurt.get(i) || -99) > FWALL.calm) {
        rec.hp = Math.min(this.wallMax(rec, rec.l), rec.hp + FWALL.repair * 2);
      }
    }
    if (fd.safe.size > g.armies.length + 12) {
      const live = new Set(g.armies.map(a => a.id));
      for (const id of [...fd.safe.keys()]) if (!live.has(id)) { fd.safe.delete(id); fd.rep.delete(id); }
    }
    for (const s of fd.settlers.slice()) {
      const k = g.kingdom(s.owner);
      if (!k || !k.alive) this.dropSettler(g, s);
    }
    this.aiTick(g);
  },
  // земля сменила хозяина (город захвачен): стена достаётся новому владельцу земли, недостроенное пропадает
  syncOwners(g) {
    const fd = g.fd, w = g.world;
    for (const [i, rec] of [...fd.walls]) {
      const cid = w.cityOf[i];
      if (cid < 0) continue;
      const c = g.city(cid);
      if (!c || c.owner === -1 || c.owner === rec.o) continue;
      const nk = g.kingdom(c.owner);
      if (!nk || !nk.alive || nk.bandit) continue;
      if (rec.l > 0) { rec.o = c.owner; w.wallOwn[i] = c.owner; }
      else this.remove(g, i);
    }
  },
  remove(g, i) {
    const fd = g.fd, w = g.world, rec = fd.walls.get(i);
    if (!rec) return;
    if (rec.l > 0) { w.wallLv[i] = 0; w.wallOwn[i] = 0; fd.standing--; this.hook(g); }
    fd.walls.delete(i);
    fd.ver++;
  },

  // Стройка: у каждой державы одновременно несколько участков по порядку заказа.
  build(g, dt) {
    const fd = g.fd, w = g.world;
    let used = null, crews = null;
    for (const [i, rec] of fd.walls) {
      if (rec.t <= rec.l) continue;
      if (!used) { used = {}; crews = {}; }
      const o = rec.o;
      if (crews[o] === undefined) { crews[o] = this.crewOf(g, o); used[o] = 0; }
      if (used[o] >= crews[o]) continue;
      used[o]++;
      rec.p += dt / (WALL_LV[rec.t].time * (rec.gate ? FWALL.gateTime : 1));
      if (rec.p < 1) continue;
      // враг стоит на клетке — стену не достроить
      if (this.enemyOn(g, i, o)) { rec.p = 0.99; continue; }
      const first = rec.l === 0;
      rec.l = rec.t; rec.p = 0; rec.hp = this.wallMax(rec, rec.l);
      w.wallLv[i] = rec.l; w.wallOwn[i] = o;
      if (first) { fd.standing++; this.hook(g); }
      if (!this.pending(g, o)) this.done(g, o, i);
    }
  },
  done(g, o, i) {
    const pl = g.player;
    if (pl && pl.id === o) {
      const w = g.world;
      g.notify('Строители закончили стену', 'good', { x: i % w.W + 0.5, y: Math.floor(i / w.W) + 0.5 });
    }
  },
  enemyOn(g, i, o) {
    const w = g.world;
    for (const a of g.armies) if (a.owner !== o && w.tileAt(a.x, a.y) === i && g.isHostile(o, a.owner)) return true;
    return false;
  },

  // Чужая армия не входит в клетку целой стены: возвращаем на прошлую позицию и бьём стену осадной силой.
  enforce(g, dt) {
    const fd = g.fd, w = g.world, lv = w.wallLv, safe = fd.safe;
    for (const a of g.armies) {
      let s = safe.get(a.id);
      if (a.state !== 'battle' && a.state !== 'siege') {
        const t = w.tileAt(a.x, a.y);
        if (t >= 0 && lv[t] && s && this.hostileWall(g, t, a.owner)) {
          const st = w.tileAt(s.x, s.y);
          if (!(st >= 0 && lv[st] && this.hostileWall(g, st, a.owner))) {
            a.x = s.x; a.y = s.y; if (a.path) a.pathI = s.pi;
            this.pound(g, a, t, dt);
            s.pi = a.pathI;
            continue;
          }
        }
      }
      if (!s) { s = { x: a.x, y: a.y, pi: a.pathI }; safe.set(a.id, s); }
      s.x = a.x; s.y = a.y; s.pi = a.pathI;
    }
  },
  pound(g, a, i, dt) {
    const fd = g.fd, rec = fd.walls.get(i);
    if (!rec || rec.l <= 0) return;
    rec.hp -= (siegePower(a.units) * FWALL.siege + menCount(a.units) * FWALL.men) * dt;
    if (g.time - (fd.hurt.get(i) || -99) > 0.7 && typeof g.fxHit === 'function') g.fxHit(a.x + (a.x < i % g.world.W + 0.5 ? 0.5 : -0.5), a.y, 3);
    fd.hurt.set(i, g.time);
    // путь мог быть проложен до постройки стены: пробуем обход, иначе ломаем
    if (a.dest && g.time - (fd.rep.get(a.id) || -99) > 4) {
      fd.rep.set(a.id, g.time);
      this.repath(g, a);
    }
    if (rec.hp <= 0) this.destroy(g, i);
  },
  repath(g, a) {
    const d = a.dest;
    let tx, ty;
    if (d.kind === 'city') { const c = g.city(d.id); if (!c) return; tx = c.x + 0.5; ty = c.y + 0.5; }
    else if (d.kind === 'army') { const t = g.army(d.id); if (!t) return; tx = t.x; ty = t.y; }
    else if (typeof d.x === 'number') { tx = d.x; ty = d.y; }
    else return;
    g.setPath(a, tx, ty);
  },
  destroy(g, i) {
    const fd = g.fd, w = g.world, rec = fd.walls.get(i);
    if (!rec) return;
    const owner = rec.o, x = i % w.W + 0.5, y = Math.floor(i / w.W) + 0.5;
    fd.rubble.set(i, g.time);
    this.remove(g, i);
    if (typeof g.fxBoom === 'function') g.fxBoom(x, y);
    const pl = g.player;
    if (pl && pl.id === owner && g.time - fd.msgT > 15) { fd.msgT = g.time; g.notify('Враг ломает нашу стену!', 'bad', { x, y }, true); }
  },

  // ---------- переселенцы ----------
  settlersOf(g, owner) { return g.fd.settlers.filter(s => s.owner === owner); },
  equipBlock(g, c) {
    const k = g.kingdom(c.owner);
    if (!k || !k.alive) return 'Город вам не принадлежит';
    if (c.siegeBy) return 'Город в осаде';
    if (c.level < FOUND.minLevel) return 'Нужен город не ниже уровня «' + CITY_LEVELS[FOUND.minLevel].name + '»';
    if (c.pop < FOUND.pop + FOUND.keepPop) return 'В городе мало жителей: должно остаться ' + FOUND.keepPop;
    if (this.settlersOf(g, c.owner).length >= FOUND.maxActive) return 'Обозов уже ' + FOUND.maxActive + ': дождитесь основания городов';
    if (!g.canAfford(k, FOUND.cost)) return 'Не хватает: ' + g.missing(k, FOUND.cost).join(', ');
    return null;
  },
  // Снарядить обоз в городе: платит золото, еду, дерево и жителей. Возвращает обоз или текст ошибки.
  equip(g, c) {
    const err = this.equipBlock(g, c);
    if (err) return err;
    const k = g.kingdom(c.owner);
    g.pay(k, FOUND.cost);
    c.pop -= FOUND.pop;
    const s = { id: g.newId(), owner: c.owner, from: c.id, x: c.x + 0.5, y: c.y + 0.5, st: 'wait', tx: -1, ty: -1, pop: FOUND.pop };
    g.fd.settlers.push(s);
    if (k.isPlayer) g.notify('Переселенцы города «' + c.name + '» готовы к походу: укажите место для нового города', 'good', c);
    return s;
  },
  // Почему на клетке нельзя основать город; null — можно. player — только разведанные клетки.
  siteBlock(g, x, y, owner, player) {
    const w = g.world;
    if (!w.inside(x, y) || x < FOUND.edge || y < FOUND.edge || x >= w.W - FOUND.edge || y >= w.H - FOUND.edge) return 'Слишком близко к краю карты';
    const i = w.idx(x, y), t = w.terrain[i];
    if (t !== T.PLAINS && t !== T.BEACH && t !== T.FOREST && t !== T.HILLS) return 'Нужна равнина, лес, холмы или побережье';
    if (w.river[i]) return 'На реке города не строят';
    if (!w.main[i]) return 'Туда не дойти пешком';
    if (player && !g.explored[i]) return 'Эта местность не разведана';
    for (const c of g.cities) if (dist(c.x, c.y, x, y) < FOUND.minDist) return 'Слишком близко к городу ' + c.name + ': нужно ' + FOUND.minDist + ' клеток';
    const cid = w.cityOf[i], c = cid >= 0 ? g.city(cid) : null;
    if (c && c.owner !== -1 && c.owner !== owner) return 'Это земли другой державы';
    if (g.fd.walls.has(i)) return 'Здесь стена';
    return null;
  },
  // Карта допустимых клеток (кэш до смены земель, городов, стен и разведки).
  siteMap(g, owner, player) {
    const fd = g.fd, w = g.world, W = w.W, H = w.H;
    const key = g.territoryVersion + ':' + g.cities.length + ':' + fd.ver + ':' + (player ? g.exploredVersion || 0 : -1) + ':' + owner;
    if (fd.sm && fd.sm.key === key) return fd.sm;
    const a = new Uint8Array(W * H), e = FOUND.edge;
    for (let y = e; y < H - e; y++) for (let x = e; x < W - e; x++) {
      const i = y * W + x, t = w.terrain[i];
      if ((t === T.PLAINS || t === T.BEACH || t === T.FOREST || t === T.HILLS) && !w.river[i] && w.main[i]) a[i] = 1;
    }
    const R = FOUND.minDist;
    for (const c of g.cities) {
      for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
        const x = c.x + dx, y = c.y + dy;
        if (dx * dx + dy * dy < R * R && x >= 0 && y >= 0 && x < W && y < H) a[y * W + x] = 0;
      }
    }
    for (let i = 0; i < a.length; i++) {
      if (!a[i]) continue;
      const cid = w.cityOf[i];
      if (cid >= 0) { const c = g.city(cid); if (c && c.owner !== -1 && c.owner !== owner) { a[i] = 0; continue; } }
      if (player && !g.explored[i]) a[i] = 0;
    }
    for (const i of fd.walls.keys()) a[i] = 0;
    return (fd.sm = { key, a, cv: null });
  },
  // Отправить обоз на клетку (x, y). Возвращает текст ошибки или null.
  send(g, s, x, y) {
    const k = g.kingdom(s.owner);
    const err = this.siteBlock(g, x, y, s.owner, !!(k && k.isPlayer && !g.opts.spectate));
    if (err) return err;
    s.tx = x; s.ty = y;
    if (!this.route(g, s)) { s.tx = -1; s.ty = -1; return 'Туда не пройти'; }
    s.st = 'go';
    return null;
  },
  route(g, s) {
    const w = g.world, fd = g.fd;
    this.strict = true;
    let p = null;
    try { p = w.findPath(s.x, s.y, s.tx + 0.5, s.ty + 0.5, s.owner); } finally { this.strict = false; }
    if (!p) return false;
    for (const q of p) {
      const ti = w.tileAt(q.x, q.y);
      if (ti >= 0 && this.hostileWall(g, ti, s.owner)) return false;
    }
    p[0] = { x: s.x, y: s.y };
    fd.rt.set(s.id, { path: p, i: 1, dir: 1 });
    return true;
  },
  halt(g, s, msg) {
    s.st = 'wait';
    g.fd.rt.delete(s.id);
    const k = g.kingdom(s.owner);
    if (k && k.isPlayer) g.notify(msg + '. Укажите другое место.', 'bad', s, true);
  },
  moveSettlers(g, dt) {
    const w = g.world, fd = g.fd;
    for (const s of fd.settlers.slice()) {
      if (s.st !== 'go') continue;
      let rt = fd.rt.get(s.id);
      if (!rt) {
        if (!this.route(g, s)) { this.halt(g, s, 'Обозу не найти дорогу'); continue; }
        rt = fd.rt.get(s.id);
      }
      if (this.intercepted(g, s)) continue;
      let budget = FOUND.speed * dt * (g.isWinter() ? 0.8 : 1);
      while (budget > 0 && rt.i < rt.path.length) {
        const p = rt.path[rt.i];
        const ti = w.tileAt(p.x, p.y);
        if (ti >= 0 && this.hostileWall(g, ti, s.owner)) {
          // путь преградили стеной: пробуем обход
          if (!this.route(g, s)) this.halt(g, s, 'Путь обозу преградила вражеская стена');
          rt = fd.rt.get(s.id);
          break;
        }
        const t = w.tileAt(s.x, s.y);
        const cost = t >= 0 && w.passable(t) ? w.moveCost(t) : 1;
        const d = dist(s.x, s.y, p.x, p.y);
        const step = budget / cost;
        if (d > 0.001) rt.dir = p.x > s.x + 0.001 ? 1 : p.x < s.x - 0.001 ? -1 : rt.dir;
        if (step >= d) { s.x = p.x; s.y = p.y; budget -= d * cost; rt.i++; }
        else { s.x += (p.x - s.x) / d * step; s.y += (p.y - s.y) / d * step; budget = 0; }
      }
      if (rt && s.st === 'go' && rt.i >= rt.path.length) this.arrive(g, s);
    }
  },
  intercepted(g, s) {
    for (const a of g.armies) {
      if (a.owner === s.owner || Math.abs(a.x - s.x) > FOUND.reach || Math.abs(a.y - s.y) > FOUND.reach) continue;
      if (!g.isHostile(s.owner, a.owner) || dist(a.x, a.y, s.x, s.y) > FOUND.reach) continue;
      const pl = g.player;
      if (pl && pl.id === s.owner) g.notify('Обоз переселенцев перехвачен: ' + (g.kingdom(a.owner) ? g.kingdom(a.owner).name : 'враг') + '!', 'bad', s, true);
      else if (pl && a.owner === pl.id) g.notify('Наши воины перехватили обоз переселенцев', 'good', s);
      this.dropSettler(g, s);
      return true;
    }
    return false;
  },
  dropSettler(g, s) {
    const fd = g.fd, i = fd.settlers.indexOf(s);
    if (i >= 0) fd.settlers.splice(i, 1);
    fd.rt.delete(s.id);
    g.emit('settlersGone', s);
  },
  // Распустить обоз: люди возвращаются в город, половина запасов тоже.
  disband(g, s) {
    const k = g.kingdom(s.owner);
    let c = g.city(s.from);
    if (!c || c.owner !== s.owner) c = g.citiesOf(s.owner)[0];
    if (c) c.pop += s.pop;
    if (k) g.refund(k, FOUND.cost, FOUND.refund);
    this.dropSettler(g, s);
  },
  arrive(g, s) {
    const fd = g.fd, w = g.world;
    fd.rt.delete(s.id);
    let x = s.tx, y = s.ty;
    if (this.siteBlock(g, x, y, s.owner, false)) {
      // место заняли: ближайшее подходящее рядом
      let best = null, bd = 99;
      const m = this.siteMap(g, s.owner, false).a;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const qx = x + dx, qy = y + dy;
        if (!w.inside(qx, qy) || !m[w.idx(qx, qy)]) continue;
        const d = Math.hypot(dx, dy);
        if (d < bd) { bd = d; best = { x: qx, y: qy }; }
      }
      if (!best) { this.halt(g, s, 'Место для города занято'); return; }
      x = best.x; y = best.y;
    }
    this.found(g, s, x, y);
  },
  cityName(g) {
    const used = new Set(g.cities.map(c => c.name));
    const free = CITY_NAMES.filter(n => !used.has(n));
    if (free.length) return free[Math.floor(g.rng.next() * free.length)];
    for (let n = 2; n < 99; n++) for (const b of CITY_NAMES) if (!used.has(b + ' ' + n)) return b + ' ' + n;
    return 'Новоселье';
  },
  // Основать деревню: обычный город державы со всеми полями, как при создании мира.
  found(g, s, x, y) {
    const k = g.kingdom(s.owner);
    const c = {
      id: g.newId(), name: this.cityName(g), x, y, owner: s.owner, level: 1, pop: s.pop, buildings: {}, walls: 0, wallHp: 0, towers: 0,
      construction: null, queue: [], garrison: { militia: FOUND.guard }, wounds: {}, isCapital: false, siegeBy: null, raised: false, founded: g.time,
    };
    g.cities.push(c);
    this.dropSettler(g, s);
    g.reindex();
    g.refreshTerritory(true);
    g.ownershipVersion++;
    if (k && k.stats) k.stats.maxCities = Math.max(k.stats.maxCities || 0, g.citiesOf(k.id).length);
    if (this.fd(g).walls.has(g.world.idx(x, y))) this.remove(g, g.world.idx(x, y));
    Mods.call('cityFounded', g, c);
    const pl = g.player;
    if (pl && pl.id === s.owner) g.notify('Основан новый город: ' + c.name + '!', 'good', c, true);
    else if (g.explored[g.cityTile(c)]) g.notify(k.name + ' основывает город ' + c.name, 'info', c);
    g.emit('founded', { city: c, kingdom: k });
    return c;
  },

  // ---------- ИИ ----------
  aiTick(g) {
    const fd = g.fd;
    for (const k of g.kingdoms) {
      if (!k.alive || k.bandit || !k.ai) continue;
      const st = fd.aiT[k.id] || (fd.aiT[k.id] = { f: FOUND.aiFrom + g.rng.range(0, 120), w: FWALL.aiFrom + g.rng.range(0, 60) });
      for (const s of this.settlersOf(g, k.id)) if (s.st === 'wait') { if (!this.aiSend(g, k, s)) this.disband(g, s); }
      if (g.time >= st.f) st.f = g.time + (this.aiFound(g, k) ? g.rng.range(FOUND.aiEvery[0], FOUND.aiEvery[1]) : 4);
      if (g.time >= st.w) st.w = g.time + (this.aiWall(g, k) ? g.rng.range(FWALL.aiEvery[0], FWALL.aiEvery[1]) : 6);
    }
  },
  // Лучшая клетка для города рядом с городами державы; null — негде.
  aiSite(g, k, from) {
    const w = g.world, W = w.W, H = w.H, m = this.siteMap(g, k.id, false).a, ter = w.terrain;
    const foes = g.cities.filter(c => c.owner !== -1 && c.owner !== k.id && g.isHostile(k.id, c.owner));
    let best = null, bs = -1e9;
    const x0 = Math.max(2, from.x - FOUND.aiFar[1]), x1 = Math.min(W - 3, from.x + FOUND.aiFar[1]);
    const y0 = Math.max(2, from.y - FOUND.aiFar[1]), y1 = Math.min(H - 3, from.y + FOUND.aiFar[1]);
    for (let y = y0; y <= y1; y += 2) {
      for (let x = x0 + (y & 1); x <= x1; x += 2) {
        const i = y * W + x;
        if (!m[i]) continue;
        const d = dist(x, y, from.x, from.y);
        if (d < FOUND.aiFar[0] || d > FOUND.aiFar[1]) continue;
        let sc = -d * 0.7;
        for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
          const j = (y + dy) * W + x + dx, t = ter[j];
          if (t === T.PLAINS) sc += 1;
          else if (t === T.FOREST || t === T.HILLS) sc += 0.6;
          else if (t === T.MOUNTAIN) sc += 0.2;
          if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) { if (w.river[j]) sc += 3; if (t <= T.SHALLOW) sc += 2; }
        }
        let risky = false;
        for (const f of foes) if (dist(f.x, f.y, x, y) < 10) { risky = true; break; }
        if (risky) continue;
        if (sc > bs) { bs = sc; best = { x, y }; }
      }
    }
    return best;
  },
  aiSend(g, k, s) {
    const from = g.city(s.from) && g.city(s.from).owner === k.id ? g.city(s.from) : g.citiesOf(k.id)[0];
    if (!from) return false;
    const site = this.aiSite(g, k, { x: Math.round(s.x), y: Math.round(s.y) });
    return !!site && this.send(g, s, site.x, site.y) === null;
  },
  // true — попытка сделана (успешно или некуда), false — не хватило запасов: проверим скоро снова
  aiFound(g, k) {
    const fd = g.fd;
    if ((fd.made[k.id] || 0) >= FOUND.aiMax || this.settlersOf(g, k.id).length) return true;
    const R = FOUND.cost;
    if (k.res.gold < R.gold + 20 || k.res.food < R.food + 60 || k.res.wood < R.wood + 40) return false;
    // из спокойного города, где достаточно людей
    const cs = g.citiesOf(k.id).filter(c => c.level >= FOUND.minLevel && !c.siegeBy && c.pop >= FOUND.pop + 400 && !this.menaced(g, c));
    const st = fd.aiT[k.id];
    if (!cs.length) { st.no = g.time; return true; }
    cs.sort((a, b) => b.pop - a.pop);
    const from = cs[0], site = this.aiSite(g, k, from);
    if (!site) { st.no = g.time; return true; }
    const s = this.equip(g, from);
    if (typeof s === 'string') return true;
    if (this.send(g, s, site.x, site.y) === null) fd.made[k.id] = (fd.made[k.id] || 0) + 1;
    else this.disband(g, s);
    return true;
  },
  // ИИ копит золото на обоз: ai.js тогда не тратит последнее на мелочи (как при нехватке войска)
  aiSaves(g, k) {
    const fd = g.fd, st = fd && fd.aiT[k.id];
    return !!st && g.time >= st.f - 70 && g.time - (st.no || -999) > 400 && (fd.made[k.id] || 0) < FOUND.aiMax && k.res.gold < FOUND.cost.gold + 20 && !this.settlersOf(g, k.id).length;
  },
  menaced(g, c) {
    for (const a of g.armies) if (a.owner !== c.owner && g.isHostile(c.owner, a.owner) && dist(a.x, a.y, c.x, c.y) < 10) return true;
    return false;
  },
  // Дуга стены перед городом c в сторону врага e: клетки своих земель на расстоянии r.
  wallArc(g, k, c, e, r) {
    const w = g.world, W = w.W, cx = c.x + 0.5, cy = c.y + 0.5, ang = Math.atan2(e.y - c.y, e.x - c.x);
    const pts = [];
    const n = Math.ceil(r * 2.4);
    let last = null;
    for (let j = 0; j <= n; j++) {
      const a = ang - 0.95 + 1.9 * j / n;
      const x = Math.floor(cx + Math.cos(a) * r), y = Math.floor(cy + Math.sin(a) * r);
      if (!w.inside(x, y)) continue;
      if (last) fdLine4(last.x, last.y, x, y, pts); else pts.push(y * 100000 + x);
      last = { x, y };
    }
    const out = [], seen = new Set();
    for (const v of pts) {
      const x = v % 100000, y = (v - x) / 100000;
      if (!w.inside(x, y)) continue;
      const i = w.idx(x, y);
      if (seen.has(i)) continue;
      seen.add(i);
      if (!this.cellBlock(g, k.id, i)) out.push(i);
    }
    return out;
  },
  // true — решение принято (построили или стена не нужна), false — не хватило запасов: проверим скоро снова
  aiWall(g, k) {
    const fd = g.fd;
    const cs = g.citiesOf(k.id);
    if (cs.length < 2) return true;
    // город, ближе всего стоящий к вражескому
    let from = null, foe = null, bd = FWALL.aiNear;
    for (const c of cs) {
      if (c.level < 2 && !c.isCapital) continue;
      for (const e of g.cities) {
        if (e.owner === -1 || e.owner === k.id || !g.isHostile(k.id, e.owner)) continue;
        const d = dist(c.x, c.y, e.x, e.y);
        if (d < bd) { bd = d; from = c; foe = e; }
      }
    }
    if (!from) return true;
    let have = 0;
    for (const rec of fd.walls.values()) if (rec.o === k.id) have++;
    if (have >= FWALL.aiCap) return true;
    const reach = g.cityInfluence(from).reach;
    let cells = [];
    for (let r = clamp(Math.floor(reach - 0.8), 3, 7); r >= 3; r--) {
      const arc = this.wallArc(g, k, from, foe, r);
      if (arc.length > cells.length) cells = arc;
      if (arc.length >= r * 1.6) break;
    }
    if (cells.length < 3) return true;
    const stone = k.res.stone, iron = k.res.iron;
    const level = stone > 900 && iron > 220 && g.time > 900 ? 3 : stone > 520 ? 2 : 1;
    let short = false;
    for (let lv = level; lv >= 1; lv--) {
      const todo = cells.filter(i => { const r = fd.walls.get(i); return !r || (r.t < lv && r.l < lv); }).slice(0, FWALL.aiChunk);
      if (!todo.length) continue;
      const plan = this.wallPlan(g, k.id, todo, lv);
      if (!plan.n) continue;
      let ok = true;
      for (const r in plan.cost) if ((k.res[r] || 0) - plan.cost[r] < (FWALL.aiReserve[r] || 0)) ok = false;
      if (ok) { this.buildWalls(g, k.id, todo, lv); return true; }
      short = true;
    }
    return !short;
  },

  // ---------- интерфейс (заменяется в браузере ниже) ----------
  cancelTools() {},
};

Mods.add({
  name: 'founding',
  init: (g, loaded) => Founding.init(g, loaded),
  update: (g, dt) => Founding.update(g, dt),
  serialize: g => Founding.serialize(g),
  restore: (g, d) => Founding.restore(g, d),
});

// ============================ браузер: инструменты, панели, отрисовка ============================
if (typeof document !== 'undefined') (function () {
  const $id = id => document.getElementById(id);
  const ui = Founding.ui = { mode: null, tool: null, level: 1, cells: new Set(), stroke: null, cand: null, sid: 0, toastT: 0, bar: null };

  const css = document.createElement('style');
  css.textContent =
    '#fd-bar{position:absolute;left:50%;transform:translateX(-50%);bottom:calc(env(safe-area-inset-bottom,0px) + 10px);z-index:6;width:max-content;' +
    'display:flex;flex-direction:column;gap:6px;max-width:min(520px,calc(100vw - 330px));padding:8px 10px;border-radius:10px;' +
    'background:rgba(43,30,18,.95);color:#f3e3bd;border:1px solid var(--wood-line);box-shadow:0 6px 20px rgba(0,0,0,.45);font-size:15px;line-height:1.25}' +
    '#fd-bar[hidden]{display:none}' +
    '#fd-bar .fd-t{font-family:var(--font-head);font-size:17px}#fd-bar .fd-h{color:#d9c796;font-size:13px}#fd-bar .fd-e{color:#ffb39e;font-weight:700}' +
    '#fd-bar .fd-r{display:flex;flex-wrap:wrap;gap:6px;align-items:center}' +
    '#fd-bar .fd-lv{flex:1 1 0;min-width:96px;padding:5px 8px;border-radius:8px;border:1px solid var(--wood-line);background:rgba(255,255,255,.07);color:#f3e3bd;font-weight:700;font-size:14px;text-align:center}' +
    '#fd-bar .fd-lv.on{background:var(--gold);color:#2a1b0d;border-color:#8a6420}' +
    '#fd-bar .fd-c{display:inline-flex;align-items:center;gap:3px;padding:2px 7px;border-radius:7px;background:rgba(255,255,255,.1);font-weight:700;font-variant-numeric:tabular-nums}' +
    '#fd-bar .fd-c.lack{background:rgba(190,60,40,.35);color:#ffc9bb}#fd-bar .fd-c .ri{display:inline-flex}#fd-bar .fd-c svg{width:16px;height:16px}' +
    '#fd-bar .act{min-height:38px;padding:6px 12px}#fd-bar .fd-sp{flex:1}' +
    '.fd-list{display:flex;flex-direction:column;gap:6px}.fd-it{display:flex;flex-wrap:wrap;gap:6px;align-items:center;justify-content:space-between;font-size:14px}' +
    '#map.tool{cursor:crosshair}';
  document.head.appendChild(css);

  function bar() {
    if (ui.bar) return ui.bar;
    const el = document.createElement('div');
    el.id = 'fd-bar'; el.hidden = true;
    const hud = $id('hud') || document.body;
    hud.appendChild(el);
    el.addEventListener('click', e => {
      const b = e.target.closest('[data-fd]');
      if (!b || b.disabled) return;
      barAct(b.dataset.fd, b.dataset);
    });
    return (ui.bar = el);
  }
  const G = () => (typeof App !== 'undefined' ? App.game : null);
  const toast = (t, ok) => { try { App.ui.toast(t, ok); } catch (e) { /* интерфейс ещё не готов */ } };
  const costChips = (k, cost) => {
    let h = '';
    for (const r of RES_IDS) {
      if (!cost[r]) continue;
      h += '<span class="fd-c' + ((k.res[r] || 0) < cost[r] ? ' lack' : '') + '" title="' + RES_BY_ID[r].name + '"><span class="ri">' + Icons.svg(r) + '</span>' + fmtInt(cost[r]) + '</span>';
    }
    return h;
  };

  // ---------- панель инструмента ----------
  function drawBar() {
    const g = G(), el = bar();
    if (!g || !ui.mode) { el.hidden = true; return; }
    const pl = g.player;
    let h = '';
    if (ui.mode === 'site') {
      const s = g.fd.settlers.find(q => q.id === ui.sid);
      h += '<div class="fd-t">Куда отправить переселенцев?</div>';
      if (!ui.cand) h += '<div class="fd-h">Коснитесь подсвеченной клетки: город встанет не ближе ' + FOUND.minDist + ' клеток к другим и не на чужих землях. Двумя пальцами карту можно двигать.</div>';
      else if (ui.cand.err) h += '<div class="fd-e">' + escapeHtml(ui.cand.err) + '</div>';
      else {
        let eta = '';
        if (s) { const d = dist(s.x, s.y, ui.cand.x + 0.5, ui.cand.y + 0.5); eta = ' · путь около ' + fmtTime(d / FOUND.speed * 1.2); }
        h += '<div class="fd-h">Основать город здесь' + eta + '?</div>';
      }
      h += '<div class="fd-r"><button class="act" type="button" data-fd="go"' + (ui.cand && !ui.cand.err ? '' : ' disabled') + '>Идти сюда</button><span class="fd-sp"></span>' +
        '<button class="act ghost" type="button" data-fd="cancel">Отмена</button></div>';
    } else if (ui.mode === 'wall') {
      const cells = [...ui.cells];
      const plan = Founding.wallPlan(g, pl.id, cells, ui.level);
      h += '<div class="fd-t">Стена вдоль своих земель</div><div class="fd-r">';
      for (let l = 1; l <= 3; l++) h += '<button class="fd-lv' + (ui.level === l ? ' on' : '') + '" type="button" data-fd="lv" data-l="' + l + '">' + WALL_LV[l].name + '</button>';
      h += '</div>';
      if (!plan.n) h += '<div class="fd-h">Ведите пальцем (мышью) по своей земле: стена прокладывается по клеткам. Двумя пальцами карту можно двигать.</div>';
      else {
        h += '<div class="fd-r">' + costChips(pl, plan.cost) + '<span class="fd-h">' + plan.n + ' ' + plural(plan.n, 'участок', 'участка', 'участков') +
          (plan.nUp ? ' (улучшение ' + plan.nUp + ')' : '') + ' · около ' + fmtTime(plan.time) + '</span></div>';
      }
      const can = plan.n && g.canAfford(pl, plan.cost);
      h += '<div class="fd-r"><button class="act" type="button" data-fd="ok"' + (can ? '' : ' disabled') + '>Построить</button>' +
        '<button class="act ghost" type="button" data-fd="reset"' + (ui.cells.size ? '' : ' disabled') + '>Сбросить</button><span class="fd-sp"></span>' +
        '<button class="act ghost" type="button" data-fd="cancel">Отмена</button></div>';
    }
    if (el.dataset.h !== h) { el.innerHTML = h; el.dataset.h = h; }
    el.hidden = false;
  }
  function barAct(a, d) {
    const g = G();
    if (!g) return;
    if (a === 'cancel') { App.input.setTool(null); return; }
    if (ui.mode === 'site') {
      if (a === 'go' && ui.cand && !ui.cand.err) {
        const s = g.fd.settlers.find(q => q.id === ui.sid);
        if (!s) { App.input.setTool(null); return; }
        const err = Founding.send(g, s, ui.cand.x, ui.cand.y);
        if (err) { ui.cand.err = err; drawBar(); toast(err); return; }
        App.input.setTool(null);
        toast('Обоз выступил в путь', true);
      }
    } else if (ui.mode === 'wall') {
      if (a === 'lv') { ui.level = +d.l; drawBar(); }
      else if (a === 'reset') { ui.cells.clear(); drawBar(); }
      else if (a === 'ok') {
        const err = Founding.buildWalls(g, g.player.id, [...ui.cells], ui.level);
        if (err) { toast(err); return; }
        App.input.setTool(null);
        toast('Стройка стены началась', true);
      }
    }
  }
  Founding.cancelTools = function (g) {
    if (ui.mode) { try { App.input.setTool(null); } catch (e) { /* ввода ещё нет */ } }
    ui.mode = null; ui.cells.clear(); ui.cand = null; ui.tool = null;
    if (ui.bar) ui.bar.hidden = true;
  };
  function endTool() {
    ui.mode = null; ui.cells.clear(); ui.cand = null; ui.stroke = null; ui.tool = null;
    if (ui.bar) ui.bar.hidden = true;
  }

  // ---------- инструмент «Указать место» ----------
  function siteTouch(w) {
    const g = G();
    if (!g) return;
    const x = Math.floor(w.x), y = Math.floor(w.y);
    const s = g.fd.settlers.find(q => q.id === ui.sid);
    if (!s) return;
    ui.cand = { x, y, err: Founding.siteBlock(g, x, y, s.owner, true) };
    drawBar();
  }
  Founding.pickSite = function (g, s) {
    if (!App.input) return;
    App.input.setTool(null);
    ui.mode = 'site'; ui.sid = s.id; ui.cand = s.st === 'go' ? { x: s.tx, y: s.ty, err: null } : null;
    ui.tool = {
      down: w => siteTouch(w), move: w => siteTouch(w), up: () => {},
      cancel: (input, gesture) => { if (!gesture) endTool(); },
    };
    App.input.setTool(ui.tool);
    App.ui.select(null);
    App.focus(s.x, s.y);
    drawBar();
  };

  // ---------- инструмент «Строить стену» ----------
  function wallTouch(w, first) {
    const g = G();
    if (!g) return;
    const m = g.world, x = Math.floor(w.x), y = Math.floor(w.y);
    if (!m.inside(x, y)) return;
    const i = m.idx(x, y);
    if (ui.stroke && ui.stroke.i === i) return;
    const pid = g.player.id;
    const pts = ui.stroke ? fdLine4(ui.stroke.x, ui.stroke.y, x, y, []) : [y * 100000 + x];
    let bad = null;
    for (const v of pts) {
      const px = v % 100000, py = (v - px) / 100000;
      if (!m.inside(px, py)) continue;
      const j = m.idx(px, py), err = Founding.cellBlock(g, pid, j);
      if (err) { bad = err; continue; }
      ui.cells.add(j);
    }
    ui.stroke = { x, y, i };
    if (bad && first) toast(bad);
    drawBar();
  }
  Founding.wallTool = function (g) {
    if (!App.input) return;
    App.input.setTool(null);
    ui.mode = 'wall'; ui.cells.clear(); ui.stroke = null;
    ui.tool = {
      down: w => wallTouch(w, true), move: w => wallTouch(w, false), up: () => { ui.stroke = null; },
      cancel: (input, gesture) => { ui.stroke = null; if (!gesture) endTool(); },
    };
    App.input.setTool(ui.tool);
    App.ui.select(null);
    drawBar();
  };

  // ---------- панели ----------
  const fmtEta = s => {
    const rt = G() && G().fd.rt.get(s.id);
    if (s.st !== 'go' || !rt) return '';
    let left = 0, px = s.x, py = s.y;
    for (let i = rt.i; i < rt.path.length; i++) { left += dist(px, py, rt.path[i].x, rt.path[i].y); px = rt.path[i].x; py = rt.path[i].y; }
    return fmtTime(left / FOUND.speed * 1.15);
  };
  function settlersHtml(g, pl) {
    const list = g.fd.settlers.filter(s => s.owner === pl.id);
    if (!list.length) return '';
    let h = '<div class="box"><h4>' + Icons.svg('people') + ' Обозы переселенцев</h4><div class="fd-list">';
    for (const s of list) {
      const from = g.city(s.from);
      const state = s.st === 'go' ? 'в пути, осталось ' + fmtEta(s) : 'ждёт приказа';
      h += '<div class="fd-it"><span>' + (from ? escapeHtml(from.name) : 'Обоз') + ': ' + state + '</span><span class="btnrow" style="margin:0">' +
        '<button class="act ghost" type="button" data-act="jump" data-x="' + s.x.toFixed(1) + '" data-y="' + s.y.toFixed(1) + '">Показать</button>' +
        '<button class="act" type="button" data-act="fd-place" data-id="' + s.id + '">' + (s.st === 'go' ? 'Другое место' : 'Указать место') + '</button>' +
        '<button class="act ghost" type="button" data-act="fd-disband" data-id="' + s.id + '">Распустить</button></span></div>';
    }
    return h + '</div></div>';
  }
  function wallsBox(g, pl) {
    const st = Founding.stats(g, pl.id), n = st.lv[1] + st.lv[2] + st.lv[3];
    let h = '<div class="box"><h4>' + Icons.svg('walls') + ' Стены вдоль границ</h4>';
    h += '<p class="tip" style="margin-top:0">Проведите стену по своим землям: чужие армии не пройдут сквозь целую стену, а свои ходят свободно. ' +
      'Если обхода нет, враг останавливается и ломает её. На дорогах и реках стена с воротами.</p>';
    if (n || st.pending) {
      h += '<div class="row2"><span>Участков</span><span>' + WALL_LV.slice(1).map((l, i) => st.lv[i + 1] ? l.name.split(' ')[0].toLowerCase() + ' ' + st.lv[i + 1] : '').filter(Boolean).join(', ') + (st.pending ? ' · строится ' + st.pending : '') + '</span></div>';
      if (st.max) h += '<div class="row2"><span>Прочность</span><span>' + Math.round(st.hp / st.max * 100) + '%</span></div>';
    }
    h += '<div class="btnrow"><button class="act" type="button" data-act="fd-wall">Строить стену</button>' +
      (st.pending ? '<button class="act ghost" type="button" data-act="fd-wallcancel">Отменить недостроенное</button>' : '') + '</div></div>';
    return h;
  }
  UIExt.citySections.push({
    id: 'found', title: 'Поселенцы', icon: 'people',
    when: (g, c) => g.fd && c.owner === g.player.id && c.level >= FOUND.minLevel,
    html(g, c, u) {
      const pl = g.player, block = Founding.equipBlock(g, c);
      let h = '<div class="box"><h4>' + Icons.svg('flag') + ' Основать новый город</h4>' +
        '<p class="tip" style="margin-top:0">Обоз переселенцев выйдет из города и пойдёт к месту, которое вы укажете: новая деревня встанет не ближе ' + FOUND.minDist +
        ' клеток к другим городам и не на чужих землях. Дорогу могут перехватить враги.</p>' +
        '<div class="cost">' + u.costHtml(pl, FOUND.cost, 0, FOUND.pop) + '</div>' +
        '<div class="btnrow"><button class="act build" type="button" data-act="fd-equip"' + (block ? ' disabled' : '') + '>' + Icons.svg('people') + 'Снарядить переселенцев</button></div>' +
        (block ? '<p class="tip">' + escapeHtml(block) + '</p>' : '') + '</div>';
      return h + settlersHtml(g, pl) + wallsBox(g, pl);
    },
  });
  UIExt.cityHeader.push((g, c, mine) => {
    if (!mine || !g.fd) return '';
    const w = g.fd.settlers.filter(s => s.owner === c.owner && s.st === 'wait' && s.from === c.id);
    if (!w.length) return '';
    return '<div class="ch-row"><span class="chip">' + Icons.svg('people') + 'Переселенцы ждут приказа</span>' +
      '<button class="act" type="button" data-act="fd-place" data-id="' + w[0].id + '">Указать место</button></div>';
  });
  UIExt.kingdomTabs.push({
    id: 'walls', title: 'Стены',
    html(g, pl) {
      return wallsBox(g, pl) + (settlersHtml(g, pl) || '<p class="tip">Переселенцев можно снарядить в любом городе не ниже уровня «' + CITY_LEVELS[FOUND.minLevel].name + '»: вкладка «Поселенцы».</p>');
    },
  });
  const find = (g, d) => g.fd.settlers.find(s => s.id === +d.id && s.owner === g.player.id);
  UIExt.actions['fd-equip'] = (d, u, city) => {
    const g = u.g;
    if (!city) return;
    const s = Founding.equip(g, city);
    if (typeof s === 'string') return s;
    Founding.pickSite(g, s);
    return 'nopanel';
  };
  UIExt.actions['fd-place'] = (d, u) => {
    const s = find(u.g, d);
    if (!s) return 'Обоз уже не существует';
    Founding.pickSite(u.g, s);
    return 'nopanel';
  };
  UIExt.actions['fd-disband'] = (d, u) => {
    const s = find(u.g, d);
    if (s) Founding.disband(u.g, s);
  };
  UIExt.actions['fd-wall'] = (d, u) => { Founding.wallTool(u.g); return 'nopanel'; };
  UIExt.actions['fd-wallcancel'] = (d, u) => {
    const n = Founding.cancelWalls(u.g, u.g.player.id);
    if (!n) return 'Недостроенного нет';
  };

  // ---------- отрисовка ----------
  const AL = 0.0001;
  // Стена как цепь клеток: куски между центрами соседних клеток, сверху вниз. lvOf(i) — показываемый уровень клетки.
  function simpleWall(ctx, x0, y0, x1, y1, l) {
    const h = l === 1 ? 0.3 : l === 2 ? 0.44 : 0.58;
    const dx = x1 - x0, dy = y1 - y0, len = Math.hypot(dx, dy) || 1;
    ctx.fillStyle = 'rgba(30,18,8,.25)';
    ctx.beginPath(); ctx.moveTo(x0, y0 + 0.02); ctx.lineTo(x1, y1 + 0.02); ctx.lineTo(x1 + 0.1, y1 + 0.1); ctx.lineTo(x0 + 0.1, y0 + 0.1); ctx.closePath(); ctx.fill();
    ctx.lineJoin = 'round'; ctx.lineWidth = 0.025; ctx.strokeStyle = 'rgba(30,18,8,.85)';
    if (l === 1) {
      const n = Math.max(2, Math.round(len / 0.13));
      for (let i = 0; i <= n; i++) {
        const x = x0 + dx * i / n, y = y0 + dy * i / n;
        ctx.fillStyle = i % 2 ? '#a2723f' : '#8b5f31';
        ctx.beginPath(); ctx.moveTo(x - 0.045, y); ctx.lineTo(x - 0.045, y - h); ctx.lineTo(x, y - h - 0.08); ctx.lineTo(x + 0.045, y - h); ctx.lineTo(x + 0.045, y); ctx.closePath(); ctx.fill(); ctx.stroke();
      }
      return;
    }
    ctx.fillStyle = l === 2 ? '#aaa493' : '#7f8187';
    ctx.beginPath(); ctx.moveTo(x0, y0); ctx.lineTo(x1, y1); ctx.lineTo(x1, y1 - h); ctx.lineTo(x0, y0 - h); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.strokeStyle = l === 2 ? '#cfc8b6' : '#a9abb0'; ctx.lineWidth = 0.1; ctx.lineCap = 'butt';
    ctx.beginPath(); ctx.moveTo(x0, y0 - h); ctx.lineTo(x1, y1 - h); ctx.stroke();
    // зубцы
    const n = Math.max(2, Math.round(len / 0.24));
    ctx.fillStyle = l === 2 ? '#bdb7a6' : '#92949a'; ctx.strokeStyle = 'rgba(30,18,8,.8)'; ctx.lineWidth = 0.022;
    for (let i = 0; i <= n; i++) {
      const x = x0 + dx * i / n, y = y0 + dy * i / n - h;
      ctx.fillRect(x - 0.05, y - 0.13, 0.1, 0.1); ctx.strokeRect(x - 0.05, y - 0.13, 0.1, 0.1);
    }
  }
  function drawSet(ctx, W, cells, lvOf, kOf, dmgOf) {
    const art = typeof WorldArt !== 'undefined' && typeof WorldArt.borderWall === 'function' ? WorldArt : null;
    const seg = (x0, y0, x1, y1, l, k, dm) => { if (art) art.borderWall(ctx, x0, y0, x1, y1, l, k, dm); else simpleWall(ctx, x0, y0, x1, y1, l); };
    for (const i of cells) {
      const l = lvOf(i);
      if (!l) continue;
      const x = i % W, y = (i - x) / W, cx = x + 0.5, cy = y + 0.5, k = kOf(i), dm = dmgOf(i);
      let linked = false;
      const e = x < W - 1 ? lvOf(i + 1) : 0, s = lvOf(i + W);
      if (e) { seg(cx, cy, cx + 1, cy, Math.min(l, e), k, dm); linked = true; }
      if (s) { seg(cx, cy, cx, cy + 1, Math.min(l, s), k, dm); linked = true; }
      if (!linked && !(x > 0 && lvOf(i - 1)) && !(i >= W && lvOf(i - W))) seg(cx - 0.42, cy, cx + 0.42, cy, l, k, dm);
    }
  }
  function drawGate(ctx, cx, cy, l) {
    ctx.fillStyle = l === 1 ? '#7a5632' : '#8d8a82';
    ctx.fillRect(cx - 0.27, cy - 0.5, 0.54, 0.62);
    ctx.fillStyle = l === 1 ? '#53381c' : '#5d5a54';
    ctx.fillRect(cx - 0.27, cy - 0.5, 0.54, 0.09);
    ctx.fillStyle = '#1a120a';
    ctx.beginPath(); ctx.moveTo(cx - 0.15, cy + 0.12); ctx.lineTo(cx - 0.15, cy - 0.17); ctx.arc(cx, cy - 0.17, 0.15, Math.PI, 0); ctx.lineTo(cx + 0.15, cy + 0.12); ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(30,18,8,.8)'; ctx.lineWidth = 0.03; ctx.strokeRect(cx - 0.27, cy - 0.5, 0.54, 0.62);
  }
  // Леса вокруг недостроенного участка: стойки, перекладины и растущая стена.
  function drawScaffold(ctx, cx, cy, p, lvl, k) {
    const art = typeof WorldArt !== 'undefined' && typeof WorldArt.borderWall === 'function' ? WorldArt : null;
    ctx.fillStyle = 'rgba(95,70,40,.32)';
    ctx.beginPath(); ctx.ellipse(cx, cy + 0.05, 0.52, 0.3, 0, 0, TAU); ctx.fill();
    if (p > 0.04) {
      ctx.save();
      ctx.beginPath(); ctx.rect(cx - 0.7, cy + 0.2 - (0.25 + 0.95 * p), 1.4, 1.3); ctx.clip();
      if (art) art.borderWall(ctx, cx - 0.5, cy, cx + 0.5, cy, lvl, k, 0); else simpleWall(ctx, cx - 0.5, cy, cx + 0.5, cy, lvl);
      ctx.restore();
    }
    const h = 0.32 + 0.4 * p;
    ctx.lineCap = 'butt';
    ctx.strokeStyle = 'rgba(30,18,8,.9)'; ctx.lineWidth = 0.1;
    ctx.beginPath(); ctx.moveTo(cx - 0.46, cy + 0.14); ctx.lineTo(cx - 0.46, cy + 0.14 - h); ctx.moveTo(cx + 0.46, cy + 0.14); ctx.lineTo(cx + 0.46, cy + 0.14 - h);
    ctx.moveTo(cx - 0.46, cy + 0.14 - h * 0.55); ctx.lineTo(cx + 0.46, cy + 0.14 - h * 0.55); ctx.stroke();
    ctx.strokeStyle = '#c99d66'; ctx.lineWidth = 0.055;
    ctx.beginPath(); ctx.moveTo(cx - 0.46, cy + 0.14); ctx.lineTo(cx - 0.46, cy + 0.14 - h); ctx.moveTo(cx + 0.46, cy + 0.14); ctx.lineTo(cx + 0.46, cy + 0.14 - h);
    ctx.moveTo(cx - 0.46, cy + 0.14 - h * 0.55); ctx.lineTo(cx + 0.46, cy + 0.14 - h * 0.55);
    ctx.moveTo(cx - 0.46, cy + 0.14); ctx.lineTo(cx + 0.46, cy + 0.14 - h * 0.55); ctx.stroke();
  }
  function drawRubble(ctx, cx, cy, i) {
    const hs = n => { let v = Math.imul(i * 31 + n * 97, 0x9e3779b1) >>> 0; return (v >>> 8 & 255) / 255; };
    for (let n = 0; n < 6; n++) {
      const x = cx + (hs(n) - 0.5) * 0.8, y = cy + (hs(n + 9) - 0.4) * 0.45, r = 0.07 + hs(n + 4) * 0.1;
      ctx.fillStyle = n % 2 ? '#8e877a' : '#6f6a60';
      ctx.beginPath(); ctx.moveTo(x - r, y + r * 0.5); ctx.lineTo(x - r * 0.3, y - r); ctx.lineTo(x + r, y - r * 0.2); ctx.lineTo(x + r * 0.6, y + r * 0.6); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(30,18,8,.55)'; ctx.lineWidth = 0.02; ctx.stroke();
    }
  }
  // Подсветка допустимых клеток одним спрайтом на всю карту.
  function overlay(map, rgba) {
    if (map.cv && map.rgba === rgba) return map.cv;
    const w = G().world, cv = document.createElement('canvas');
    cv.width = w.W; cv.height = w.H;
    const c = cv.getContext('2d'), img = c.createImageData(w.W, w.H);
    const col = rgba;
    for (let i = 0; i < map.a.length; i++) if (map.a[i]) { img.data[i * 4] = col[0]; img.data[i * 4 + 1] = col[1]; img.data[i * 4 + 2] = col[2]; img.data[i * 4 + 3] = col[3]; }
    c.putImageData(img, 0, 0);
    map.cv = cv; map.rgba = rgba;
    return cv;
  }
  function ownMap(g, pid) {
    const fd = g.fd, w = g.world, key = 'own:' + g.territoryVersion + ':' + g.cities.length + ':' + g.ownershipVersion;
    if (fd.om && fd.om.key === key) return fd.om;
    const a = new Uint8Array(w.W * w.H);
    for (let i = 0; i < a.length; i++) {
      const cid = w.cityOf[i];
      if (cid < 0 || !w.passable(i)) continue;
      const c = g.city(cid);
      if (c && c.owner === pid) a[i] = 1;
    }
    return (fd.om = { key, a, cv: null });
  }

  // Кэш стоящих стен. Стена в кадре — десятки кусков по 4 операции рисования, и на холсте это упирается в предел
  // отложенной растеризации (кадр уходит за бюджет). Поэтому стены участка 8×8 клеток один раз рисуются в свой холст
  // (только по габариту стен, в ступени разрешения спрайтов) и дальше кладутся одним drawImage.
  const WC = { n: 8, budget: 8e6, fd: null, map: new Map(), px: 0, frame: 0, chunks: null, chunksVer: -1 };
  const dmgBucket = q => { const d = 1 - q.hp / Founding.wallMax(q, q.l); return d >= 0.75 ? 0.9 : d >= 0.35 ? 0.5 : 0; };
  function chunkLists(fd, W) {
    if (WC.chunks && WC.chunksVer === fd.ver) return WC.chunks;
    const m = new Map(), N = WC.n;
    for (const i of fd.sorted) { const y = Math.floor(i / W), k = Math.floor(y / N) * 4096 + Math.floor((i - y * W) / N); const a = m.get(k); if (a) a.push(i); else m.set(k, [i]); }
    WC.chunksVer = fd.ver;
    return (WC.chunks = m);
  }
  // Нарисовать стоящие стены клетками [x0..x1]×[y0..y1]; false — не уместились в бюджет памяти, рисуем напрямую.
  function drawChunks(ctx, g, fd, W, x0, x1, y0, y1) {
    const m = ctx.getTransform ? ctx.getTransform() : null, sc = m ? Math.hypot(m.a, m.b) : 48;
    const P = sc <= 30 ? 24 : sc <= 60 ? 48 : 96, N = WC.n;
    if (WC.fd !== fd) { WC.fd = fd; WC.map.clear(); WC.px = 0; WC.chunks = null; }
    const lists = chunkLists(fd, W);
    const fr = ++WC.frame;
    if (fr % 300 === 0) for (const [k, e] of WC.map) if (e.used < fr - 300) { WC.px -= e.cv.width * e.cv.height; WC.map.delete(k); }
    const lvOf = i => { const q = fd.walls.get(i); return q ? q.l : 0; };
    const kOf = i => g.kingdom(fd.walls.get(i).o), dmOf = i => dmgBucket(fd.walls.get(i));
    const direct = [];
    for (let by = Math.floor(y0 / N); by <= Math.floor(y1 / N); by++) for (let bx = Math.floor(x0 / N); bx <= Math.floor(x1 / N); bx++) {
      const key = by * 4096 + bx, list = lists.get(key);
      if (!list) continue;
      let sig = list.length, mnx = 1e9, mny = 1e9, mxx = -1, mxy = -1;
      for (const i of list) {
        const q = fd.walls.get(i);
        if (!q || q.l <= 0) continue;
        const y = Math.floor(i / W), x = i - y * W;
        if (x < mnx) mnx = x; if (x > mxx) mxx = x; if (y < mny) mny = y; if (y > mxy) mxy = y;
        sig = (Math.imul(sig, 31) + i * 7 + q.l * 3 + (dmgBucket(q) * 10 | 0) + (q.gate ? 11 : 0) + q.o * 131) | 0;
      }
      if (mxx < 0) continue;
      let e = WC.map.get(key);
      if (!e || e.sig !== sig || e.P !== P) {
        const ox = mnx - 1, oy = mny - 1, cw = mxx - mnx + 3, ch = mxy - mny + 3, need = cw * ch * P * P;
        if (e) { WC.px -= e.cv.width * e.cv.height; WC.map.delete(key); }
        if (WC.px + need > WC.budget) {
          for (const [k2, e2] of WC.map) { if (e2.used >= fr - 1) continue; WC.px -= e2.cv.width * e2.cv.height; WC.map.delete(k2); if (WC.px + need <= WC.budget) break; }
        }
        if (WC.px + need > WC.budget) { direct.push(list); continue; }
        const cv = e ? e.cv : document.createElement('canvas');
        cv.width = cw * P; cv.height = ch * P;
        const c = cv.getContext('2d');
        c.setTransform(P, 0, 0, P, -ox * P, -oy * P);
        c.imageSmoothingEnabled = true;
        // куски в кэш должны попасть настоящими, а не запасной линией: лимит запекания на кадр на время отключаем
        const bk = typeof WorldArt !== 'undefined' ? WorldArt.wallBake : null, keep = bk ? bk.n : 0;
        if (bk) bk.n = -1e6;
        drawSet(c, W, list, lvOf, kOf, dmOf);
        for (const i of list) { const q = fd.walls.get(i); if (q.l > 0 && q.gate) drawGate(c, i % W + 0.5, Math.floor(i / W) + 0.5, q.l); }
        if (bk) bk.n = keep;
        WC.px += cv.width * cv.height;
        e = { cv, sig, P, ox, oy, cw, ch, used: fr };
        WC.map.set(key, e);
      }
      e.used = fr;
      ctx.drawImage(e.cv, e.ox, e.oy, e.cw, e.ch);
    }
    // не поместившиеся участки — по-старому, кусками (снизу вверх порядок сохраняется в drawSet)
    for (const list of direct) {
      drawSet(ctx, W, list, lvOf, kOf, dmOf);
      for (const i of list) { const q = fd.walls.get(i); if (q.l > 0 && q.gate) drawGate(ctx, i % W + 0.5, Math.floor(i / W) + 0.5, q.l); }
    }
  }

  RenderExt.map.push((ctx, r, z, tl, br) => {
    const g = r.g;
    if (!g || !g.fd) return;
    const fd = g.fd, w = g.world, W = w.W;
    const x0 = Math.max(0, Math.floor(tl.x) - 1), x1 = Math.min(W - 1, Math.ceil(br.x) + 1);
    const y0 = Math.max(0, Math.floor(tl.y) - 1), y1 = Math.min(w.H - 1, Math.ceil(br.y) + 1);
    ctx.imageSmoothingEnabled = false;
    // подсказки инструментов
    if (ui.mode === 'site') {
      const s = fd.settlers.find(q => q.id === ui.sid);
      if (s) ctx.drawImage(overlay(Founding.siteMap(g, s.owner, true), [90, 200, 70, 118]), 0, 0, W, w.H);
    } else if (ui.mode === 'wall') {
      ctx.drawImage(overlay(ownMap(g, g.player.id), [255, 224, 140, 46]), 0, 0, W, w.H);
    }
    ctx.imageSmoothingEnabled = true;
    // стены, леса, обломки (сверху вниз)
    if (fd.walls.size || fd.rubble.size) {
      if (!fd.sorted || fd.sortedVer !== fd.ver) { fd.sorted = [...fd.walls.keys()].sort((a, b) => a - b); fd.sortedVer = fd.ver; }
      if (fd.walls.size) {
        drawChunks(ctx, g, fd, W, x0, x1, y0, y1);
        // леса недостроенных участков (меняются каждый кадр) — поверх, вживую
        for (const [i, q] of fd.walls) {
          if (q.t <= q.l) continue;
          const x = i % W, y = (i - x) / W;
          if (x >= x0 && x <= x1 && y >= y0 && y <= y1) drawScaffold(ctx, x + 0.5, y + 0.5, q.p, q.t, g.kingdom(q.o));
        }
      }
      for (const [i] of fd.rubble) {
        const y = Math.floor(i / W), x = i - y * W;
        if (x >= x0 && x <= x1 && y >= y0 && y <= y1 && !fd.walls.has(i)) drawRubble(ctx, x + 0.5, y + 0.5, i);
      }
    }
    // задуманная стена: прозрачный образ нужного уровня
    if (ui.mode === 'wall' && ui.cells.size) {
      const cells = [...ui.cells].filter(i => { const y = Math.floor(i / W), x = i - y * W; return x >= x0 && x <= x1 && y >= y0 && y <= y1; }).sort((a, b) => a - b);
      ctx.fillStyle = 'rgba(255,214,102,.5)'; ctx.strokeStyle = 'rgba(120,80,10,.9)'; ctx.lineWidth = 0.05;
      ctx.beginPath();
      for (const i of cells) { const x = i % W, y = (i - x) / W; ctx.rect(x + 0.08, y + 0.08, 0.84, 0.84); }
      ctx.fill(); ctx.stroke();
      ctx.globalAlpha = 0.72;
      const pk = g.player;
      drawSet(ctx, W, cells, i => ui.cells.has(i) ? ui.level : 0, () => pk, () => 0);
      ctx.globalAlpha = 1;
    }
    // путь обозов игрока
    const pl = g.player;
    for (const s of fd.settlers) {
      if (!pl || s.owner !== pl.id || s.tx < 0) continue;
      const rt = fd.rt.get(s.id);
      ctx.strokeStyle = pl.color; ctx.lineWidth = 0.1; ctx.setLineDash([0.3, 0.25]); ctx.lineCap = 'round';
      ctx.beginPath(); ctx.moveTo(s.x, s.y);
      if (rt) for (let i = rt.i; i < rt.path.length; i++) ctx.lineTo(rt.path[i].x, rt.path[i].y); else ctx.lineTo(s.tx + 0.5, s.ty + 0.5);
      ctx.stroke(); ctx.setLineDash([]);
      ctx.fillStyle = 'rgba(30,18,8,.55)'; ctx.beginPath(); ctx.ellipse(s.tx + 0.5, s.ty + 0.55, 0.38, 0.17, 0, 0, TAU); ctx.fill();
    }
  });

  RenderExt.screen.push((ctx, r, z, tl, br, dt) => {
    const g = r.g;
    if (!g || !g.fd) return;
    const fd = g.fd, pl = g.player;
    const S = r.armySize() * 0.85, frame = Math.floor(r.time * 6);
    for (const s of fd.settlers) {
      if (!(pl && s.owner === pl.id) && !g.isVisible(s.x, s.y)) continue;
      if (s.x < tl.x - 2 || s.x > br.x + 2 || s.y < tl.y - 2 || s.y > br.y + 2) continue;
      const k = g.kingdom(s.owner), rt = fd.rt.get(s.id);
      let ax = s.x, ay = s.y;
      if (s.st === 'wait') { const c = g.cityAt(s.x, s.y, 0.9); if (c) { ax = c.x + 0.5 - r.cityRadius(c) - 0.5; ay = c.y + 0.8; } }
      const p = r.toScreen(ax, ay);
      ctx.fillStyle = 'rgba(30,18,8,.35)';
      ctx.beginPath(); ctx.ellipse(p.x, p.y, S * 0.62, S * 0.16, 0, 0, TAU); ctx.fill();
      const dir = rt ? rt.dir : 1;
      if (typeof UnitArt !== 'undefined' && typeof UnitArt.wagon === 'function') UnitArt.wagon(ctx, p.x, p.y, S * 0.75, k, s.st === 'go' ? frame : 0, dir);
      else drawCart(ctx, p.x, p.y, S, k, dir, s.st === 'go' ? frame : 0);
      if (typeof UnitArt !== 'undefined' && UnitArt.plate) {
        const pt = UnitArt.plate('Переселенцы', false, r.dpr);
        ctx.drawImage(pt.cv, p.x - pt.w / 2, p.y + 3, pt.w, pt.h);
      }
    }
    // кандидат места
    if (ui.mode === 'site' && ui.cand) {
      const p = r.toScreen(ui.cand.x + 0.5, ui.cand.y + 0.5), ok = !ui.cand.err, R = Math.max(12, r.cam.z * 0.7);
      ctx.strokeStyle = ok ? '#c8f08a' : '#ff8d73'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(p.x, p.y, R, R * 0.5, 0, 0, TAU); ctx.stroke();
      Icons.draw(ctx, 'flag', p.x, p.y - R * 0.7, Math.max(20, R * 1.2), ok ? '#c8f08a' : '#ff8d73');
    }
  });
  // простая повозка, если нет UnitArt.wagon
  function drawCart(ctx, x, y, S, k, dir, frame) {
    const u = S / 30;
    ctx.save(); ctx.translate(x, y); ctx.scale(dir * u, u);
    ctx.fillStyle = '#7a5632'; ctx.strokeStyle = '#2a1b0d'; ctx.lineWidth = 1.2;
    ctx.fillRect(-14, -16, 22, 10); ctx.strokeRect(-14, -16, 22, 10);
    ctx.fillStyle = '#e4d6a8'; ctx.beginPath(); ctx.moveTo(-14, -16); ctx.quadraticCurveTo(-3, -30, 8, -16); ctx.closePath(); ctx.fill(); ctx.stroke();
    ctx.fillStyle = k ? k.color : '#888'; ctx.fillRect(-13, -14, 20, 3);
    ctx.fillStyle = '#9a6a3a'; ctx.beginPath(); ctx.ellipse(16, -10, 7, 4, 0, 0, TAU); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#4a3220'; ctx.fillRect(18, -17, 4, 6);
    for (const wx of [-9, 3]) {
      ctx.fillStyle = '#5a3a1c'; ctx.beginPath(); ctx.arc(wx, -4, 5, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(wx, -4); ctx.lineTo(wx + Math.cos(frame) * 5, -4 + Math.sin(frame) * 5); ctx.stroke();
    }
    ctx.restore();
  }

  // панель инструмента живёт, пока он включён: пересчёт цены при изменении запасов
  setInterval(() => { if (ui.mode) drawBar(); }, 400);
})();
