'use strict';
// Флот: порты, корабли, перевозка войск по воде и высадка (Mods.add).
// Корабли — объекты модуля (g.naval.ships), в g.armies их нет. Армия, севшая на борт, на время плавания
// выходит из g.armies (removeArmy) и едет грузом в корабле; при высадке возвращается через makeArmy.
// Логика не трогает document/window: интерфейс и отрисовка — в блоке «браузер» внизу файла.

const NAVAL = {
  minSea: 150,          // водоём меньше этого — озеро, порт на нём не нужен
  harborR: 3,           // порт ищет воду в этой окрестности города
  portGold: 24,         // золото в минуту за уровень порта (торговля)
  slots: 6,             // кораблей, что умещаются у причала
  fleetMax: 14,         // предел кораблей у державы
  queueMax: 4,          // очередь верфи
  aggro: 7,             // боевая ладья замечает врага на таком расстоянии (клеток)
  leash: 16,            // и не уходит от гавани дальше этого
  seaFactor: 0.6,       // морем предлагаем, если оно быстрее 60% пути по суше
  offerGain: 20,        // …и выигрыш не меньше стольких секунд
  ships: {
    transport: {
      name: 'Транспорт', short: 'Трансп.', icon: 'ship', need: 1, cap: 120, hp: 90, speed: 2.2, atk: 0, range: 0, vision: 5,
      cost: { gold: 110, wood: 170 }, time: 18, crew: 15, upkeep: 1.5,
      desc: 'Везёт армию до 120 воинов к любому берегу. Сам не сражается и уязвим для боевых ладей.',
    },
    galley: {
      name: 'Боевая ладья', short: 'Ладья', icon: 'ship', need: 2, cap: 0, hp: 150, speed: 2.5, atk: 11, range: 3.6, vision: 6.5,
      cost: { gold: 170, wood: 200, iron: 25 }, time: 26, crew: 30, upkeep: 3,
      desc: 'Топит чужие корабли и прикрывает свои транспорты. Для постройки нужна верфь (порт 2 ур.).',
    },
  },
};
const NAVAL_KINDS = Object.keys(NAVAL.ships);

// Порт — обычная постройка города, но только у моря; BUILDING_IDS нужен панели города.
BUILDINGS.port = {
  name: 'Порт', icon: 'anchor', max: 2, cost: { gold: 200, wood: 170, stone: 50 }, time: 26, minLevel: 2,
  desc: 'Пристань у моря: торговля приносит золото, а верфь строит корабли. 1 уровень — транспорты, 2 уровень — боевые ладьи.',
  yield: { gold: NAVAL.portGold },
  when: (g, c) => (Naval.harbor(g, c) ? null : 'Нужен выход к морю'),
};
BUILDING_IDS.push('port');

const Naval = (() => {
  const SPECS = NAVAL.ships;
  const SQ2 = Math.SQRT2;
  const N4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
  const PERP = [0, -0.3, 0.3];
  const nav = g => g.naval || (g.naval = { ships: [], yards: {}, jobs: [], need: {}, aiT: 0, cT: 0, homeT: 0, busy: false });
  const shipOf = (N, id) => { for (const s of N.ships) if (s.id === id) return s; return null; };
  const humanOwner = (g, o) => { const k = g.kingdom(o); return !!(k && k.isPlayer && !g.opts.spectate); };
  // Сообщение игроку, если дело касается его державы.
  const say = (g, owner, text, kind, at, important) => { if (humanOwner(g, owner)) g.notify(text, kind || 'info', at, important); };
  const men = n => n + ' ' + plural(n, 'воин', 'воина', 'воинов');

  // ---------- вода и суша ----------
  // Связные части воды и суши (по 4 соседям — как ходят и корабли, и армии), берег. Кэш живёт на мире.
  function info(w) {
    if (w._nv) return w._nv;
    const W = w.W, H = w.H, n = W * H, ter = w.terrain;
    const wc = new Int32Array(n).fill(-1), lc = new Int32Array(n).fill(-1), wsz = [], lsz = [], st = [];
    const label = (comp, sizes, water) => {
      for (let s = 0; s < n; s++) {
        if (comp[s] >= 0 || (ter[s] <= T.SHALLOW) !== water) continue;
        const id = sizes.length;
        let cnt = 0;
        comp[s] = id; st.length = 0; st.push(s);
        const add = j => { if (comp[j] < 0 && (ter[j] <= T.SHALLOW) === water) { comp[j] = id; st.push(j); } };
        while (st.length) {
          const k = st.pop(); cnt++;
          const x = k % W;
          if (x > 0) add(k - 1);
          if (x < W - 1) add(k + 1);
          if (k >= W) add(k - W);
          if (k < n - W) add(k + W);
        }
        sizes.push(cnt);
      }
    };
    label(wc, wsz, true);
    label(lc, lsz, false);
    const coast = new Uint8Array(n);
    for (let i = 0; i < n; i++) {
      if (wc[i] < 0) continue;
      const x = i % W, y = (i - x) / W;
      for (let dy = -1; dy <= 1 && !coast[i]; dy++) for (let dx = -1; dx <= 1; dx++) {
        const nx = x + dx, ny = y + dy;
        if (nx >= 0 && ny >= 0 && nx < W && ny < H && ter[ny * W + nx] > T.SHALLOW) { coast[i] = 1; break; }
      }
    }
    return (w._nv = {
      W, H, n, wc, lc, wsz, lsz, coast, harbor: new Map(),
      gs: new Float32Array(n), came: new Int32Array(n), stamp: new Uint32Array(n), closed: new Uint32Array(n), sid: 0, heap: new MinHeap(),
    });
  }
  const bigSea = (s, i) => s.wc[i] >= 0 && s.wsz[s.wc[i]] >= NAVAL.minSea;

  // Гавань города: клетка морской воды поблизости и места у причала. null — города у моря нет.
  function harborOf(g, c) {
    const w = g.world, s = info(w);
    if (s.harbor.has(c.id)) return s.harbor.get(c.id);
    let best = null, bd = Infinity;
    const R = NAVAL.harborR;
    for (let dy = -R; dy <= R; dy++) for (let dx = -R; dx <= R; dx++) {
      const x = c.x + dx, y = c.y + dy;
      if (!w.inside(x, y)) continue;
      const i = w.idx(x, y);
      if (!bigSea(s, i)) continue;
      const d = dx * dx + dy * dy + (w.terrain[i] === T.SHALLOW ? 0 : 0.5);
      if (d < bd) { bd = d; best = i; }
    }
    let h = null;
    if (best !== null) {
      const bx = best % s.W, by = (best - bx) / s.W, wx = bx + 0.5, wy = by + 0.5;
      const ang = Math.atan2(wy - (c.y + 0.5), wx - (c.x + 0.5));
      // корабль у причала стоит вдоль берега
      let sa = ang + Math.PI / 2;
      if (Math.cos(sa) < 0) sa += Math.PI;
      const slots = [];
      for (const [along, out] of [[0, 0], [0.95, 0.35], [-0.95, 0.35], [1.9, 0.7], [-1.9, 0.7], [0, 1.2]]) {
        const x = wx - Math.sin(ang) * along + Math.cos(ang) * out, y = wy + Math.cos(ang) * along + Math.sin(ang) * out;
        const i = w.tileAt(x, y);
        if (i >= 0 && s.wc[i] === s.wc[best]) slots.push({ x, y, ang: sa });
      }
      if (!slots.length) slots.push({ x: wx, y: wy, ang: sa });
      h = { wx, wy, tx: bx, ty: by, comp: s.wc[best], ang, slots };
    }
    s.harbor.set(c.id, h);
    return h;
  }

  // Прямая видимость по воде с запасом от берега.
  function clearLine(w, x0, y0, x1, y1) {
    const dx = x1 - x0, dy = y1 - y0, L = Math.hypot(dx, dy);
    if (L < 1e-6) return true;
    const ux = dx / L, uy = dy / L, n = Math.ceil(L / 0.2);
    for (let i = 0; i <= n; i++) {
      const t = Math.min(L, i * 0.2), px = x0 + ux * t, py = y0 + uy * t;
      for (let k = 0; k < 3; k++) {
        const j = w.tileAt(px - uy * PERP[k], py + ux * PERP[k]);
        if (j < 0 || w.terrain[j] > T.SHALLOW) return false;
      }
    }
    return true;
  }
  function smooth(w, pts) {
    if (pts.length < 3) return pts;
    const out = [pts[0]];
    let i = 0;
    while (i < pts.length - 1) {
      let j = i + 1;
      while (j + 1 < pts.length && clearLine(w, pts[i].x, pts[i].y, pts[j + 1].x, pts[j + 1].y)) j++;
      out.push(pts[j]); i = j;
    }
    return out;
  }
  // A* по клеткам воды (x0,y0 → x1,y1 — клетки). Дальше от берега дешевле, мелководье чуть дороже.
  function waterPath(g, x0, y0, x1, y1) {
    const w = g.world, s = info(w), W = s.W, H = s.H, wc = s.wc;
    const a = y0 * W + x0, b = y1 * W + x1;
    if (wc[a] < 0 || wc[a] !== wc[b]) return null;
    if (a === b) return [{ x: x0 + 0.5, y: y0 + 0.5 }];
    const id = ++s.sid, gs = s.gs, came = s.came, stamp = s.stamp, closed = s.closed, heap = s.heap, ter = w.terrain, coast = s.coast, comp = wc[a];
    heap.clear();
    const h = k => { const x = k % W, y = (k - x) / W, dx = Math.abs(x - x1), dy = Math.abs(y - y1); return dx + dy + (SQ2 - 2) * Math.min(dx, dy); };
    const tc = k => 1 + (ter[k] === T.SHALLOW ? 0.2 : 0) + (coast[k] ? 0.45 : 0);
    stamp[a] = id; gs[a] = 0; came[a] = -1; heap.push(a, h(a));
    let found = false;
    while (heap.size) {
      const k = heap.pop();
      if (closed[k] === id) continue;
      closed[k] = id;
      if (k === b) { found = true; break; }
      const x = k % W, y = (k - x) / W, ck = tc(k);
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (closed[j] === id || wc[j] !== comp) continue;
        if (dx && dy && (wc[y * W + nx] !== comp || wc[ny * W + x] !== comp)) continue;
        const ng = gs[k] + (ck + tc(j)) * 0.5 * (dx && dy ? SQ2 : 1);
        if (stamp[j] !== id || ng < gs[j]) { stamp[j] = id; gs[j] = ng; came[j] = k; heap.push(j, ng + h(j)); }
      }
    }
    if (!found) return null;
    const pts = [];
    for (let k = b; k !== -1; k = came[k]) pts.push({ x: k % W + 0.5, y: Math.floor(k / W) + 0.5 });
    pts.reverse();
    return smooth(w, pts);
  }

  // Где высаживаться у точки (tx, ty): клетка воды (wx, wy) и соседняя клетка суши (sx, sy) той же земли, что и цель.
  // o.lcomp — искать сушу именно этой связной части, o.wcomp — воду именно этого моря.
  function findLanding(g, tx, ty, o) {
    o = o || {};
    const w = g.world, s = info(w), W = s.W, H = s.H;
    const ti = w.tileAt(tx, ty);
    if (ti < 0) return null;
    const x0 = ti % W, y0 = (ti - x0) / W;
    let lcomp = o.lcomp !== undefined ? o.lcomp : s.lc[ti];
    if (lcomp < 0) {
      let bd = Infinity;
      for (let dy = -6; dy <= 6; dy++) for (let dx = -6; dx <= 6; dx++) {
        const x = x0 + dx, y = y0 + dy;
        if (x < 0 || y < 0 || x >= W || y >= H || s.lc[y * W + x] < 0) continue;
        const d = dx * dx + dy * dy;
        if (d < bd) { bd = d; lcomp = s.lc[y * W + x]; }
      }
      if (lcomp < 0) return null;
    }
    let best = null, bs = Infinity, found = -1;
    for (let r = 0; r <= 18; r++) {
      if (best && r > found + 1) break;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const x = x0 + dx, y = y0 + dy;
        if (x < 0 || y < 0 || x >= W || y >= H) continue;
        const wi = y * W + x;
        if (!bigSea(s, wi) || (o.wcomp !== undefined && s.wc[wi] !== o.wcomp)) continue;
        for (let k = 0; k < 4; k++) {
          const lx = x + N4[k][0], ly = y + N4[k][1];
          if (lx < 0 || ly < 0 || lx >= W || ly >= H) continue;
          const li = ly * W + lx;
          if (s.lc[li] !== lcomp) continue;
          const t = w.terrain[li];
          const d = Math.hypot(lx + 0.5 - tx, ly + 0.5 - ty) + (t === T.SNOW ? 3 : t === T.MOUNTAIN ? 1.5 : t === T.HILLS ? 0.5 : 0);
          if (d < bs) { bs = d; found = r; best = { wx: x, wy: y, sx: lx, sy: ly, comp: s.wc[wi] }; }
        }
      }
    }
    return best;
  }

  // ---------- корабли ----------
  function addShip(g, N, owner, kind, city) {
    const sh = {
      id: g.newId(), owner, kind, x: 0, y: 0, ang: 0, hp: SPECS[kind].hp, home: city.id, dock: null, slot: 0, st: 'dock',
      path: null, pi: 0, dest: null, act: null, cargo: null, mission: null, job: null, manual: false, idleT: 0,
    };
    N.ships.push(sh);
    dockShip(g, N, sh, city);
    return sh;
  }
  function dockShip(g, N, sh, c) {
    const h = harborOf(g, c);
    if (!h) return false;
    const used = {};
    for (const o of N.ships) if (o !== sh && o.dock === c.id) used[o.slot] = true;
    let k = 0;
    while (used[k]) k++;
    const p = h.slots[k % h.slots.length];
    sh.dock = c.id; sh.home = c.id; sh.slot = k; sh.x = p.x; sh.y = p.y; sh.ang = p.ang;
    sh.st = 'dock'; sh.path = null; sh.dest = null; sh.act = null; sh.manual = false; sh.idleT = 0; sh.tr = null;
    return true;
  }
  function removeShip(g, N, sh) {
    const i = N.ships.indexOf(sh);
    if (i >= 0) N.ships.splice(i, 1);
    for (let j = N.jobs.length - 1; j >= 0; j--) if (N.jobs[j].ship === sh.id) N.jobs.splice(j, 1);
    if (typeof Naval !== 'undefined' && Naval.sel === sh.id) Naval.sel = null;
  }
  // Курс корабля к точке воды (x, y); null или текст ошибки.
  function sailTo(g, sh, x, y, act) {
    const w = g.world, s = info(w);
    const si = w.tileAt(sh.x, sh.y), ti = w.tileAt(x, y);
    if (si < 0 || ti < 0 || !w.isWater(ti)) return 'Корабли ходят только по воде';
    if (s.wc[si] < 0 || s.wc[si] !== s.wc[ti]) return 'Туда не доплыть';
    const sx = si % s.W, sy = (si - sx) / s.W, tx = ti % s.W, ty = (ti - tx) / s.W;
    const pts = waterPath(g, sx, sy, tx, ty);
    if (!pts) return 'Туда не доплыть';
    const path = pts.slice();
    path[0] = { x: sh.x, y: sh.y };
    if (path.length === 1) path.push({ x, y }); else path[path.length - 1] = { x, y };
    sh.path = path; sh.pi = 1; sh.dest = { x, y }; sh.st = 'sail'; sh.dock = null; sh.act = act || null; sh.idleT = 0;
    return null;
  }
  function sendHome(g, sh) {
    const c = g.city(sh.home);
    const h = c && c.owner === sh.owner ? harborOf(g, c) : null;
    if (!h) return false;
    if (sailTo(g, sh, h.wx, h.wy, 'dock')) return false;
    sh.manual = false;
    return true;
  }
  function stopShip(sh) {
    if (sh.st === 'sail') { sh.st = 'idle'; sh.path = null; sh.dest = null; sh.act = null; }
    sh.manual = true;
  }

  function stepShip(g, N, sh, dt) {
    if (sh.st !== 'sail' || !sh.path) return;
    let budget = SPECS[sh.kind].speed * dt, tang = sh.ang;
    const x0 = sh.x, y0 = sh.y;
    while (budget > 1e-9 && sh.pi < sh.path.length) {
      const p = sh.path[sh.pi], dx = p.x - sh.x, dy = p.y - sh.y, d = Math.hypot(dx, dy);
      if (d > 0.001) tang = Math.atan2(dy, dx);
      if (d <= budget) { sh.x = p.x; sh.y = p.y; budget -= d; sh.pi++; }
      else { sh.x += dx / d * budget; sh.y += dy / d * budget; budget = 0; }
    }
    let da = tang - sh.ang;
    while (da > Math.PI) da -= TAU;
    while (da < -Math.PI) da += TAU;
    sh.ang += da * Math.min(1, dt * 5);
    // след на воде (только для рисования, в сохранение не идёт)
    if (dist(x0, y0, sh.x, sh.y) > 0) {
      const tr = sh.tr || (sh.tr = []);
      const last = tr[tr.length - 1];
      if (!last || dist(last.x, last.y, sh.x, sh.y) > 0.22) { tr.push({ x: sh.x, y: sh.y, t: g.time }); if (tr.length > 16) tr.shift(); }
    }
    if (sh.pi >= sh.path.length) arrive(g, N, sh);
  }
  function arrive(g, N, sh) {
    const act = sh.act;
    sh.path = null; sh.dest = null; sh.st = 'idle'; sh.act = null; sh.idleT = 0;
    if (sh.mission) { landShip(g, N, sh); return; }
    if (act === 'dock') {
      const c = g.city(sh.home);
      if (c && c.owner === sh.owner) dockShip(g, N, sh, c);
    }
  }

  // ---------- верфь ----------
  function queueInfo(g, c, kind) {
    const sp = SPECS[kind], lv = c.buildings.port || 0;
    const N = nav(g);
    const y = N.yards[c.id];
    const time = sp.time * (1 - 0.15 * Math.max(0, lv - 1));
    let block = null;
    const k = g.kingdom(c.owner);
    if (!k || !k.alive) block = 'Город вам не принадлежит';
    else if (lv < 1) block = 'Нужен порт';
    else if (lv < sp.need) block = 'Нужна верфь: порт ' + sp.need + ' ур.';
    else if (c.siegeBy) block = 'Город в осаде';
    else if (y && y.q.length >= NAVAL.queueMax) block = 'Очередь верфи полна';
    else if (N.ships.filter(s => s.owner === c.owner).length + (y ? y.q.length : 0) >= NAVAL.fleetMax) block = 'Слишком большой флот';
    else if (c.pop - sp.crew < 60) block = 'Мало жителей';
    return { cost: sp.cost, time, pop: sp.crew, block };
  }
  function queueBlock(g, c, kind) {
    const i = queueInfo(g, c, kind);
    if (i.block) return i.block;
    const k = g.kingdom(c.owner);
    if (!g.canAfford(k, i.cost)) return 'Не хватает: ' + g.missing(k, i.cost).join(', ');
    return null;
  }
  // Заказать корабль на верфи города; null или текст ошибки.
  function queueShip(g, c, kind) {
    const why = queueBlock(g, c, kind);
    if (why) return why;
    const i = queueInfo(g, c, kind), N = nav(g);
    g.pay(g.kingdom(c.owner), i.cost);
    c.pop -= i.pop;
    const y = N.yards[c.id] || (N.yards[c.id] = { owner: c.owner, q: [] });
    y.q.push({ kind, t: 0, total: i.time });
    return null;
  }
  function cancelQueue(g, c, idx) {
    const N = nav(g), y = N.yards[c.id];
    if (!y || !y.q[idx]) return;
    const q = y.q.splice(idx, 1)[0];
    g.refund(g.kingdom(c.owner), SPECS[q.kind].cost, 0.75);
    if (!y.q.length) delete N.yards[c.id];
  }
  function tickYards(g, N, dt) {
    for (const cid in N.yards) {
      const y = N.yards[cid], c = g.city(+cid);
      if (!c || c.owner !== y.owner || !(c.buildings.port > 0) || !y.q.length) { delete N.yards[cid]; continue; }
      if (c.siegeBy) continue;
      const q = y.q[0];
      q.t += dt;
      if (q.t < q.total) continue;
      y.q.shift();
      if (!y.q.length) delete N.yards[cid];
      const sh = addShip(g, N, c.owner, q.kind, c);
      say(g, c.owner, c.name + ': ' + SPECS[q.kind].name.toLowerCase() + ' спущен на воду', 'good', c);
      g.emit('shipBuilt', { city: c, ship: sh });
    }
  }

  // ---------- перевозка ----------
  const targetPoint = (g, target) => {
    if (target.kind === 'city') { const c = g.city(target.id); return c ? { x: c.x + 0.5, y: c.y + 0.5 } : null; }
    if (target.kind === 'army') { const t = g.army(target.id); return t ? { x: t.x, y: t.y } : null; }
    return { x: target.x, y: target.y };
  };
  const cloneTarget = t => (t.kind === 'ground' ? { kind: 'ground', x: t.x, y: t.y } : { kind: t.kind, id: t.id });
  // Время хода по ломаной с учётом местности.
  function pathTime(g, a, pts) {
    const w = g.world, spd = g.armySpeed(a) || 1;
    let t = 0;
    for (let i = 1; i < pts.length; i++) {
      const j = w.tileAt(pts[i].x, pts[i].y);
      t += dist(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y) * (j >= 0 && w.passable(j) ? w.moveCost(j) : 1) / spd;
    }
    return t;
  }
  // Где армия сядет на корабль: точка на суше P (куда идёт армия) и клетка воды Wp (где ждёт корабль).
  function pickupFor(g, sh, aLand, wcomp) {
    const w = g.world, s = info(w);
    if (sh.dock) {
      const c = g.city(sh.dock);
      if (c && c.owner === sh.owner && s.lc[w.idx(c.x, c.y)] === aLand) return { P: { x: c.x + 0.5, y: c.y + 0.5 }, Wp: { x: sh.x, y: sh.y } };
      return null;
    }
    const sn = findLanding(g, sh.x, sh.y, { lcomp: aLand, wcomp });
    return sn ? { P: { x: sn.sx + 0.5, y: sn.sy + 0.5 }, Wp: { x: sn.wx + 0.5, y: sn.wy + 0.5 } } : null;
  }
  // План перевозки армии a к цели: лучший свободный транспорт, место посадки и высадки, оценка времени.
  // Ошибка — объект { code, msg }; успех — объект с полем ship.
  function planSea(g, a, target, only) {
    const N = nav(g), w = g.world, s = info(w);
    const pt = targetPoint(g, target);
    if (!pt) return { code: 'gone', msg: 'Цель исчезла' };
    const ai = w.tileAt(a.x, a.y), aLand = ai >= 0 ? s.lc[ai] : -1;
    if (aLand < 0) return { code: 'noland', msg: 'Армия не на суше' };
    const L = findLanding(g, pt.x, pt.y);
    if (!L) return { code: 'nolanding', msg: 'Туда не пройти: у цели нет берега для высадки' };
    let list = only ? [only] : N.ships.filter(sh => sh.owner === a.owner && sh.kind === 'transport' && sh.hp > 0 && !sh.cargo && !sh.job && !sh.mission && s.wc[w.tileAt(sh.x, sh.y)] === L.comp);
    if (!list.length) {
      const ports = g.cities.filter(c => c.owner === a.owner && c.buildings.port > 0).length;
      const any = N.ships.some(sh => sh.owner === a.owner && sh.kind === 'transport' && sh.hp > 0);
      if (!ports) return { code: 'noport', msg: 'По суше туда не пройти. Постройте порт и транспорт, чтобы плыть морем' };
      if (!any) return { code: 'noship', msg: 'По суше туда не пройти. Закажите транспорт на верфи порта' };
      return { code: 'busy', msg: 'Все транспорты заняты или не могут доплыть до этого берега' };
    }
    list = list.slice().sort((p, q) => dist(p.x, p.y, a.x, a.y) - dist(q.x, q.y, a.x, a.y)).slice(0, 4);
    const lend = w.findPath(L.sx + 0.5, L.sy + 0.5, pt.x, pt.y);
    const restT = lend ? pathTime(g, a, lend) : 0;
    if (!lend && dist(L.sx + 0.5, L.sy + 0.5, pt.x, pt.y) > 2.5) return { code: 'noway', msg: 'От берега до цели пешком не дойти' };
    let best = null;
    for (const sh of list) {
      const pk = pickupFor(g, sh, aLand, L.comp);
      if (!pk) continue;
      const walk = w.findPath(a.x, a.y, pk.P.x, pk.P.y);
      if (!walk) continue;
      const sp = SPECS[sh.kind].speed;
      const walkT = pathTime(g, a, walk), preT = dist(sh.x, sh.y, pk.Wp.x, pk.Wp.y) * 1.2 / sp;
      const sailT = dist(pk.Wp.x, pk.Wp.y, L.wx + 0.5, L.wy + 0.5) * 1.2 / sp;
      const total = Math.max(walkT, preT) + sailT + restT;
      if (!best || total < best.total) best = { ship: sh, P: pk.P, Wp: pk.Wp, L, pt, walkT, sailT, restT, total };
    }
    return best || { code: 'busy', msg: 'Транспорт не может принять армию: порт и армия на разных берегах' };
  }
  // Запустить перевозку по плану: армия идёт к кораблю, корабль подходит к причалу.
  function startJob(g, a, target, p) {
    const N = nav(g), sh = p.ship;
    const job = { id: g.newId(), owner: a.owner, army: a.id, ship: sh.id, P: p.P, Wp: p.Wp, target: target ? cloneTarget(target) : null, land: p.L };
    if (dist(a.x, a.y, p.P.x, p.P.y) > 1.2) {
      N.busy = true;
      const err = g.order(a, { kind: 'ground', x: p.P.x, y: p.P.y, sea: job.id });
      N.busy = false;
      if (err) return err;
    } else g.stop(a);
    N.jobs.push(job);
    sh.job = job.id; sh.manual = false;
    if (sh.st !== 'sail' && dist(sh.x, sh.y, p.Wp.x, p.Wp.y) > 0.5) sailTo(g, sh, p.Wp.x, p.Wp.y);
    const c = g.cityAt(p.P.x, p.P.y, 1.3);
    say(g, a.owner, a.name + (c ? ' идёт в ' + c.name : ' идёт к берегу') + ' на погрузку', 'info', p.P);
    tickJob(g, N, job);
    return null;
  }
  // Приказ армии идти морем; null или текст ошибки.
  function seaOrder(g, a, target) {
    const p = planSea(g, a, target);
    if (p.code) return p.msg;
    return startJob(g, a, target, p);
  }
  // Часть армии, что уместится в корабль на cap воинов.
  function splitFor(g, a, cap) {
    if (typeof g.splitArmy !== 'function') return null;
    const take = {};
    let left = cap;
    for (const u of UNIT_ORDER) {
      const n = a.units[u] || 0;
      if (!n) continue;
      const per = UNITS[u].squad * (UNITS[u].crew || 1);
      const sq = Math.min(Math.floor(n / UNITS[u].squad), Math.floor(left / per));
      if (sq > 0) { take[u] = sq * UNITS[u].squad; left -= sq * per; }
    }
    return menCount(take) ? g.splitArmy(a, take) : null;
  }
  // Погрузка: армия уходит из g.armies и едет грузом.
  function board(g, N, sh, a, mission) {
    const cap = SPECS[sh.kind].cap;
    let b = a;
    if (menCount(a.units) > cap) {
      b = splitFor(g, a, cap);
      if (!b) return 'Армия не поместилась на корабль';
      say(g, a.owner, 'На корабль село ' + men(menCount(b.units)) + ', остальные ждут в порту', 'info', a);
    }
    sh.cargo = { name: b.name, units: { ...b.units }, morale: b.morale, wounds: { ...b.wounds }, id: b.id };
    g.removeArmy(b);
    sh.job = null;
    sh.mission = mission || null;
    sh.manual = !mission;
    g.emit('embarked', { ship: sh, army: sh.cargo });
    return null;
  }
  // Высадка: груз становится армией на берегу. Если у миссии есть цель, армия сразу идёт к ней.
  function landShip(g, N, sh, spot) {
    const m = sh.mission, snap = sh.cargo;
    sh.mission = null;
    if (!snap) return null;
    const L = (m && m.land) || spot;
    if (!L) return 'Здесь нет берега';
    const a = g.makeArmy(sh.owner, L.sx + 0.5, L.sy + 0.5, snap.units);
    a.name = snap.name || a.name;
    a.morale = Math.max(35, (snap.morale || 100) - 8);
    a.wounds = snap.wounds || {};
    sh.cargo = null;
    const c = g.cityAt(L.sx + 0.5, L.sy + 0.5, 4);
    say(g, sh.owner, a.name + ' высаживается' + (c ? ' у ' + c.name : ' на берег'), 'war', a, true);
    if (m && m.target) {
      N.busy = true;
      const err = g.order(a, m.target);
      N.busy = false;
      if (err) say(g, sh.owner, a.name + ': ' + err, 'bad', a);
    }
    if (Naval.sel === sh.id && Naval.ui && typeof App !== 'undefined' && App.game === g) { Naval.select(null); App.ui.select({ kind: 'army', id: a.id }); }
    g.emit('landed', { ship: sh, army: a });
    if (!sh.manual) sendHome(g, sh);
    return null;
  }
  // Высадить груз у ближайшего берега (по просьбе игрока).
  function unload(g, sh) {
    if (!sh.cargo) return 'На борту никого нет';
    const N = nav(g);
    const L = findLanding(g, sh.x, sh.y);
    if (!L) return 'Поблизости нет берега';
    sh.mission = { land: L, target: null };
    sh.manual = true;
    if (dist(sh.x, sh.y, L.wx + 0.5, L.wy + 0.5) < 0.6) return landShip(g, N, sh);
    const err = sailTo(g, sh, L.wx + 0.5, L.wy + 0.5);
    if (err) sh.mission = null;
    return err;
  }
  // Приказ кораблю плыть в точку (x, y): вода — плывём, берег — подходим и высаживаем груз (если он есть).
  function shipCommand(g, sh, x, y) {
    const N = nav(g), w = g.world, i = w.tileAt(x, y);
    if (i < 0) return 'Туда нельзя';
    if (sh.job) return 'Корабль ждёт армию';
    sh.mission = null;
    sh.manual = true;
    if (w.isWater(i)) return sailTo(g, sh, x, y);
    let target = { kind: 'ground', x, y };
    const c = g.cityAt(x, y, 1.1);
    if (c) target = { kind: 'city', id: c.id };
    const L = findLanding(g, x, y);
    if (!L) return 'Туда не причалить';
    if (sh.cargo) {
      sh.mission = { land: L, target };
      if (dist(sh.x, sh.y, L.wx + 0.5, L.wy + 0.5) < 0.6) return landShip(g, N, sh);
    }
    const err = sailTo(g, sh, L.wx + 0.5, L.wy + 0.5);
    if (err) sh.mission = null;
    return err;
  }
  // Армия идёт к своему кораблю и садится; потом им управляет игрок.
  function boardOrder(g, a, sh) {
    if (sh.cargo || sh.job || sh.mission) return 'Корабль занят';
    const w = g.world, s = info(w), ai = w.tileAt(a.x, a.y), si = w.tileAt(sh.x, sh.y);
    const pk = ai >= 0 && si >= 0 && s.lc[ai] >= 0 ? pickupFor(g, sh, s.lc[ai], s.wc[si]) : null;
    if (!pk || !w.findPath(a.x, a.y, pk.P.x, pk.P.y)) return 'Туда не добраться: корабль у другого берега';
    return startJob(g, a, null, { ship: sh, P: pk.P, Wp: pk.Wp, L: null });
  }

  function tickJob(g, N, j) {
    const sh = shipOf(N, j.ship), a = g.army(j.army);
    let drop = !sh || !a;
    if (!drop) {
      const near = dist(a.x, a.y, j.P.x, j.P.y) <= 1.5;
      if (a.state === 'retreat') drop = true;
      else if (!near && a.state !== 'battle' && !(a.dest && a.dest.sea === j.id)) drop = true;   // приказ сменили
      else if (near && a.state !== 'battle') {
        if (sh.st !== 'sail' && dist(sh.x, sh.y, j.Wp.x, j.Wp.y) <= 0.8) {
          const mission = j.target ? { land: j.land, target: j.target } : null;
          const err = board(g, N, sh, a, mission);
          if (err) say(g, a.owner, err, 'bad', a);
          else if (mission) {
            const e2 = sailTo(g, sh, j.land.wx + 0.5, j.land.wy + 0.5);
            if (e2) { sh.mission = null; landShip(g, N, sh, { sx: Math.floor(a.x), sy: Math.floor(a.y) }); }
            else {
              say(g, a.owner, 'Транспорт отплывает', 'info', sh);
              escort(g, N, sh, j.land);
            }
          } else if (humanOwner(g, a.owner)) {
            Naval.select(sh.id);
            g.notify('Армия на борту. Коснитесь воды или берега, чтобы плыть', 'info', sh);
          }
          drop = true;
        } else if (sh.st !== 'sail') sailTo(g, sh, j.Wp.x, j.Wp.y);
      }
    }
    if (drop) {
      const i = N.jobs.indexOf(j);
      if (i >= 0) N.jobs.splice(i, 1);
      if (sh && sh.job === j.id) sh.job = null;
    }
  }
  // Боевые ладьи рядом идут тем же курсом, прикрывая высадку.
  function escort(g, N, tr, L) {
    for (const o of N.ships) {
      if (o.kind !== 'galley' || o.owner !== tr.owner || o.manual || o.st === 'sail' || o.cargo || o.hp <= 0) continue;
      if (dist(o.x, o.y, tr.x, tr.y) > 10) continue;
      sailTo(g, o, L.wx + 0.5 + (o.id % 3 - 1) * 0.3, L.wy + 0.5, 'escort');
    }
  }

  // ---------- бой кораблей ----------
  function sink(g, N, sh, by) {
    removeShip(g, N, sh);
    const killer = by ? by.owner : null;
    if (sh.cargo) {
      const n = menCount(sh.cargo.units);
      if (killer !== null) g.creditKills(killer, sh.owner, n);
      say(g, sh.owner, SPECS[sh.kind].name + ' потоплен вместе с армией: погибло ' + men(n), 'bad', sh, true);
      if (by) say(g, killer, 'Мы потопили транспорт с армией: ' + men(n), 'good', sh);
    } else {
      say(g, sh.owner, SPECS[sh.kind].name + ' потоплен', 'bad', sh, true);
      if (by) say(g, killer, 'Мы потопили ' + SPECS[sh.kind].name.toLowerCase(), 'good', sh);
    }
    g.fx.push({ type: 'sunk', x: sh.x, y: sh.y, t: 0, dur: 2.6, ang: sh.ang, kind: sh.kind, owner: sh.owner });
    g.fxBoom(sh.x, sh.y);
    g.emit('shipSunk', { ship: sh, by });
  }
  function combat(g, N) {
    const dead = [];
    for (const a of N.ships) {
      const sp = SPECS[a.kind];
      if (!sp.atk || a.hp <= 0) continue;
      let tgt = null, bd = sp.range;
      for (const b of N.ships) {
        if (b === a || b.hp <= 0 || !g.isHostile(a.owner, b.owner)) continue;
        const d = dist(a.x, a.y, b.x, b.y);
        if (d < bd) { bd = d; tgt = b; }
      }
      if (!tgt) { a.shoot = null; continue; }
      tgt.hp -= sp.atk * BATTLE_TICK * (tgt.kind === 'galley' ? 1 : 1.4);
      tgt.hurt = g.time;
      a.shoot = { id: tgt.id, t: g.time };
      if (tgt.hp <= 0 && !dead.some(d => d[0] === tgt)) dead.push([tgt, a]);
      else if (tgt.hp > 0 && g.time - (tgt.warnT || -99) > 20) { tgt.warnT = g.time; say(g, tgt.owner, 'Вражеские корабли атакуют ' + SPECS[tgt.kind].name.toLowerCase(), 'bad', tgt, true); }
    }
    for (const [t, by] of dead) sink(g, N, t, by);
  }
  // Свободная боевая ладья сама идёт на врага у своей гавани и потом возвращается.
  function patrol(g, N, sh) {
    if (sh.kind !== 'galley' || sh.hp <= 0 || sh.cargo || sh.job) return;
    if (sh.st === 'sail' && sh.act !== 'chase') return;
    if (sh.manual && sh.st !== 'sail') return;
    const sp = SPECS.galley, c = g.city(sh.home), h = c && harborOf(g, c);
    let tgt = null, bd = NAVAL.aggro;
    for (const o of N.ships) {
      if (o.hp <= 0 || !g.isHostile(sh.owner, o.owner)) continue;
      const d = dist(sh.x, sh.y, o.x, o.y);
      if (d < bd) { bd = d; tgt = o; }
    }
    if (tgt && h && dist(tgt.x, tgt.y, h.wx, h.wy) <= NAVAL.leash) {
      if (bd > sp.range * 0.75 && g.time - (sh.chaseT || -9) > 1.5) { sh.chaseT = g.time; sailTo(g, sh, tgt.x, tgt.y, 'chase'); }
      return;
    }
    if (sh.act === 'chase') { sh.act = null; sh.st = 'idle'; sh.path = null; }
  }

  // ---------- ИИ ----------
  function aiPlan(g, N, k, need) {
    const target = g.city(need.city);
    if (!target || target.owner === k.id || g.time - need.t > 120) { delete N.need[k.id]; return; }
    const L = findLanding(g, target.x + 0.5, target.y + 0.5);
    if (!L) { delete N.need[k.id]; return; }
    const w = g.world, s = info(w);
    const army = g.army(need.army) || g.armiesOf(k.id).filter(a => a.state === 'idle')[0];
    if (!army) return;
    const ai = w.tileAt(army.x, army.y), aLand = ai >= 0 ? s.lc[ai] : -1;
    const mine = g.citiesOf(k.id).filter(c => !c.siegeBy);
    const cands = [];
    for (const c of mine) {
      const h = harborOf(g, c);
      if (h && h.comp === L.comp && s.lc[w.idx(c.x, c.y)] === aLand) cands.push({ c, d: dist(c.x, c.y, army.x, army.y) + dist(c.x, c.y, target.x, target.y) * 0.3 });
    }
    if (!cands.length) { delete N.need[k.id]; return; }
    cands.sort((p, q) => p.d - q.d);
    const ports = cands.filter(o => o.c.buildings.port > 0);
    if (!ports.length) {
      for (const o of cands) {
        if (o.c.construction || o.c.level < BUILDINGS.port.minLevel) continue;
        const info2 = g.buildInfo(o.c, 'building', 'port');
        if (!info2 || info2.block || !g.canAfford(k, info2.cost)) continue;
        g.startBuild(o.c, 'building', 'port');
        break;
      }
      return;
    }
    const mineShips = N.ships.filter(sh => sh.owner === k.id && sh.hp > 0);
    const queued = kind => { let n = 0; for (const o of ports) { const y = N.yards[o.c.id]; if (y) n += y.q.filter(q => q.kind === kind).length; } return n; };
    const trs = mineShips.filter(sh => sh.kind === 'transport').length + queued('transport');
    if (trs < (menCount(army.units) > SPECS.transport.cap ? 2 : 1)) {
      for (const o of ports) if (queueShip(g, o.c, 'transport') === null) return;
      return;
    }
    // пара кораблей: боевая ладья для прикрытия, если у кого-то из врагов есть флот или порт
    const foes = N.ships.some(sh => sh.kind === 'galley' && g.isHostile(k.id, sh.owner)) || (target.owner !== -1 && target.buildings.port > 0);
    const gal = mineShips.filter(sh => sh.kind === 'galley').length + queued('galley');
    if (foes && gal < 1) {
      for (const o of ports) {
        if (o.c.buildings.port >= 2) { if (queueShip(g, o.c, 'galley') === null) return; }
        else if (!o.c.construction) {
          const i2 = g.buildInfo(o.c, 'building', 'port');
          if (i2 && !i2.block && g.canAfford(k, i2.cost)) { g.startBuild(o.c, 'building', 'port'); return; }
        }
      }
    }
  }

  // ---------- модуль ----------
  function serializeShip(sh) {
    return {
      id: sh.id, owner: sh.owner, kind: sh.kind, x: sh.x, y: sh.y, ang: sh.ang, hp: sh.hp, home: sh.home, dock: sh.dock, slot: sh.slot,
      st: sh.st, path: sh.path ? sh.path.map(p => ({ x: p.x, y: p.y })) : null, pi: sh.pi, dest: sh.dest ? { x: sh.dest.x, y: sh.dest.y } : null,
      act: sh.act, cargo: sh.cargo ? JSON.parse(JSON.stringify(sh.cargo)) : null, mission: sh.mission ? JSON.parse(JSON.stringify(sh.mission)) : null,
      job: sh.job, manual: sh.manual, idleT: sh.idleT,
    };
  }
  const mod = {
    name: 'naval',
    init(g) {
      nav(g);
      g.on((type, d) => {
        // захваченный город забирает корабли у причала
        if (type !== 'captured') return;
        const N = nav(g);
        delete N.yards[d.city.id];
        for (const sh of N.ships) {
          if (sh.dock !== d.city.id || sh.owner === d.city.owner) continue;
          say(g, sh.owner, 'Мы потеряли ' + SPECS[sh.kind].name.toLowerCase() + ' в порту ' + d.city.name, 'bad', d.city);
          sh.owner = d.city.owner; sh.home = d.city.id; sh.job = null; sh.cargo = null; sh.mission = null;
          say(g, sh.owner, 'В порту ' + d.city.name + ' захвачен ' + SPECS[sh.kind].name.toLowerCase(), 'good', d.city);
        }
      });
      if (typeof document !== 'undefined' && Naval.ui) Naval.ui.setup(g);
    },
    update(g, dt) {
      const N = nav(g);
      if (!N.ships.length && !N.jobs.length && !Object.keys(N.yards).length && !Object.keys(N.need).length) return;
      tickYards(g, N, dt);
      for (const sh of N.ships.slice()) {
        stepShip(g, N, sh, dt);
        if (sh.st === 'idle' && !sh.manual && !sh.mission) sh.idleT += dt;
      }
      for (const j of N.jobs.slice()) tickJob(g, N, j);
      N.cT += dt;
      while (N.cT >= BATTLE_TICK) { N.cT -= BATTLE_TICK; combat(g, N); }
      N.homeT += dt;
      if (N.homeT >= 1.5) {
        N.homeT = 0;
        for (const sh of N.ships.slice()) {
          const k = g.kingdom(sh.owner);
          if (!k || !k.alive) { removeShip(g, N, sh); continue; }
          patrol(g, N, sh);
          const c = g.city(sh.home);
          if (!c || c.owner !== sh.owner || !harborOf(g, c)) {
            // порт потерян: новый дом — ближайший порт державы
            let best = null, bd = Infinity;
            for (const o of g.citiesOf(sh.owner)) {
              if (!harborOf(g, o)) continue;
              const d = dist(o.x, o.y, sh.x, sh.y) - (o.buildings.port > 0 ? 8 : 0);
              if (d < bd) { bd = d; best = o; }
            }
            if (best) { sh.home = best.id; if (sh.dock) sh.dock = null; }
            else if (!sh.cargo && !sh.mission) { say(g, sh.owner, 'Без порта корабль не удержать: экипаж разошёлся', 'bad', sh); removeShip(g, N, sh); }
            continue;
          }
          // свободный корабль возвращается в гавань
          if (sh.st === 'idle' && !sh.manual && !sh.mission && !sh.job && sh.idleT > 12) {
            const h = harborOf(g, c);
            if (dist(sh.x, sh.y, h.wx, h.wy) > 2.2) sendHome(g, sh); else dockShip(g, N, sh, c);
          }
        }
      }
      N.aiT += dt;
      if (N.aiT >= 3) {
        N.aiT = 0;
        for (const k of g.kingdoms) {
          if (!k.alive || k.bandit || !k.ai || !N.need[k.id]) continue;
          aiPlan(g, N, k, N.need[k.id]);
        }
      }
    },
    serialize(g) {
      const N = nav(g);
      return {
        ships: N.ships.map(serializeShip),
        yards: JSON.parse(JSON.stringify(N.yards)),
        jobs: JSON.parse(JSON.stringify(N.jobs)),
        need: JSON.parse(JSON.stringify(N.need)),
      };
    },
    restore(g, data) {
      const N = g.naval = { ships: [], yards: {}, jobs: [], need: {}, aiT: 0, cT: 0, homeT: 0, busy: false };
      if (!data) return;
      N.ships = (data.ships || []).filter(sh => SPECS[sh.kind]);
      N.yards = data.yards || {};
      N.jobs = data.jobs || [];
      N.need = data.need || {};
    },
    vision(g, mark) {
      const N = g.naval, pl = g.player;
      if (!N || !pl) return;
      for (const sh of N.ships) if (sh.owner === pl.id) mark(sh.x, sh.y, SPECS[sh.kind].vision);
    },
    modify: {
      // порт приносит золото от торговли, корабли стоят содержания в городе-доме
      cityIncome(g, inc, c) {
        const lv = c.buildings.port || 0;
        if (lv > 0) inc.gold += NAVAL.portGold * lv * (c.siegeBy ? 0.3 : 1);
        const N = g.naval;
        if (N) for (const sh of N.ships) if (sh.home === c.id) inc.gold -= SPECS[sh.kind].upkeep;
        return inc;
      },
      // по суше не пройти: пробуем море (игроку — с объяснением, ИИ — заявка на порт и транспорт)
      orderFail(g, v, a, target) {
        const N = nav(g);
        if (N.busy || a.isBandit) return v;
        const k = g.kingdom(a.owner);
        if (!k || k.bandit) return v;
        const ai = !!k.ai;
        if (ai) {
          const c = target.kind === 'city' ? g.city(target.id) : null;
          if (!c || c.owner === a.owner) return v;
        }
        const p = planSea(g, a, target);
        if (!p.code) { const err = startJob(g, a, target, p); return err === null ? null : (ai ? v : err); }
        if (ai) { if (p.code === 'noport' || p.code === 'noship') N.need[a.owner] = { city: target.id, t: g.time, army: a.id }; return v; }
        return p.msg;
      },
    },
    // приказ принят и путь по суше есть — но, может, морем заметно быстрее (предложение игроку)
    orderDone(g, a, target) { if (Naval.ui && !nav(g).busy) Naval.ui.offer(g, a, target); },
  };
  Mods.add(mod);

  // Оценка: быстрее ли морем, чем по найденному сухопутному пути армии a (после g.order). null — нет смысла.
  function offerFor(g, a, target) {
    const N = nav(g), k = g.kingdom(a.owner);
    if (!k || !k.isPlayer || k.ai || !a.path || a.dest && a.dest.sea) return null;
    if (!N.ships.some(sh => sh.owner === a.owner && sh.kind === 'transport' && !sh.cargo && !sh.job && !sh.mission)) return null;
    const pts = [{ x: a.x, y: a.y }].concat(a.path.slice(a.pathI));
    const landT = pathTime(g, a, pts);
    if (landT < 40) return null;
    const p = planSea(g, a, target);
    if (p.code) return null;
    if (p.total < landT * NAVAL.seaFactor && landT - p.total >= NAVAL.offerGain) return { landT, seaT: p.total, plan: p };
    return null;
  }

  return {
    SPECS, sel: null, ui: null,
    state: nav, info, harbor: harborOf, waterPath, findLanding, sailTo, sendHome, stopShip, dockShip, addShip, removeShip,
    queueInfo, queueBlock, queue: queueShip, cancelQueue, planSea, seaOrder, startJob, boardOrder, shipCommand, unload, landShip, offerFor, pathTime,
    shipOf: (g, id) => shipOf(nav(g), id),
    shipsOf: (g, owner) => nav(g).ships.filter(s => s.owner === owner),
    // перестроить кэш воды и суши (после правки рельефа)
    reset(g) { delete g.world._nv; },
    select(id) { Naval.sel = id; if (Naval.ui && Naval.ui.onSelect) Naval.ui.onSelect(id); },
  };
})();

// ===== браузер: интерфейс и отрисовка (в Node не выполняется) =====
if (typeof document !== 'undefined') {
  (() => {
    const SPECS = NAVAL.ships;
    const $q = id => document.getElementById(id);
    const ui = Naval.ui = {};
    let ready = false, card = null, offerEl = null, offerState = null, drawn = [], cardHtml = '', tool = null;
    const portraits = new Map();

    const CSS = `
#nv-card { position: absolute; left: calc(env(safe-area-inset-left, 0px) + 170px); bottom: calc(env(safe-area-inset-bottom, 0px) + 8px); z-index: 6;
  width: min(330px, calc(100vw - 190px)); background: var(--paper); border: 2px solid var(--wood-line); border-radius: 10px; padding: 8px 10px;
  box-shadow: 0 6px 20px rgba(0,0,0,.5); color: var(--ink); font-size: 14px; }
#nv-card[hidden], #nv-offer[hidden] { display: none; }
#nv-card .nv-h { display: flex; gap: 8px; align-items: center; }
#nv-card .nv-h b { font-family: var(--font-head); font-size: 17px; display: block; line-height: 1.1; }
#nv-card .nv-h span { color: var(--ink-soft); font-size: 13px; }
#nv-card .nv-x { margin-left: auto; width: 30px; height: 30px; border-radius: 50%; border: 1px solid var(--line); background: var(--paper-2, #eadcb6); color: var(--ink); display: grid; place-items: center; padding: 0; }
#nv-card .progress { margin: 6px 0 2px; height: 8px; }
#nv-card .nv-row { display: flex; flex-wrap: wrap; gap: 4px 10px; align-items: center; margin: 4px 0; color: var(--ink-soft); }
#nv-card .nv-btns { display: flex; flex-wrap: wrap; gap: 6px; margin-top: 6px; }
#nv-card .nv-btns .act { flex: 1 1 auto; min-height: 34px; padding: 5px 10px; }
#nv-card .nv-btns .act.on { background: var(--gold); color: var(--ink); }
#nv-offer { position: absolute; left: 50%; bottom: calc(env(safe-area-inset-bottom, 0px) + 14px); transform: translateX(-50%); z-index: 7;
  background: rgba(43,30,18,.95); color: #f3e3bd; border: 1px solid var(--wood-line); border-radius: 10px; padding: 8px 12px; display: flex; gap: 10px; align-items: center;
  max-width: 94vw; box-shadow: 0 6px 20px rgba(0,0,0,.5); font-size: 15px; }
#nv-offer .act { min-height: 34px; padding: 5px 12px; }
.nv-list { display: grid; gap: 6px; }
.nv-ship { display: grid; grid-template-columns: 44px minmax(0,1fr) auto; gap: 8px; align-items: center; }
.nv-ship .progress { margin-top: 3px; height: 7px; }
.nv-ship .act { min-height: 34px; padding: 4px 10px; }
@media (max-width: 640px) { #nv-card { left: calc(env(safe-area-inset-left, 0px) + 8px); width: calc(100vw - 16px); bottom: calc(env(safe-area-inset-bottom, 0px) + 60px); } }
@media (max-height: 520px) and (min-width: 641px) { #nv-card { left: calc(env(safe-area-inset-left, 0px) + 150px); padding: 6px 8px; } }
`;
    // Иллюстрация порта для карточки постройки и значки: добавляются в наборы иконок на лету.
    function installArt() {
      if (typeof ICON_PATHS !== 'undefined') {
        ICON_PATHS.anchor = ICON_PATHS.anchor || 'M12 2.1a2.4 2.4 0 1 0 0 4.8a2.4 2.4 0 0 0 0-4.8zM12 3.4a1.1 1.1 0 1 1 0 2.2a1.1 1.1 0 0 1 0-2.2zM11.1 6.6h1.8V19.5h-1.8zM8 8.4h8v1.7H8zM3.5 12.5l1.9-.9c.7 3.7 3.3 6.1 6.6 6.1s5.9-2.4 6.6-6.1l1.9.9C19.7 17.6 16.4 21 12 21s-7.7-3.4-8.5-8.5z';
        ICON_PATHS.ship = ICON_PATHS.ship || 'M3 15.5h18l-2.6 4.5H5.6zM11 3.5v10.5H5.2zM12.6 5l6 9H12.6z';
      }
      if (typeof ART !== 'undefined' && !ART.port) {
        ART.port = ART_GROUND +
          '<path d="M3 37q21-9.5 42 0q-2 7-21 7t-21-7z" fill="#6fa6b8"/><path d="M8 38.5q16 3.2 32 0" fill="none" stroke="#a9d0da" stroke-width=".9"/>' +
          '<rect x="8" y="29.5" width="31" height="4.2" rx="1" fill="#b98a55"/><path d="M8 31.6h31" stroke="#8a6232" stroke-width=".8" fill="none"/>' +
          '<rect x="10" y="33.5" width="2.2" height="6.5" fill="#6b4424"/><rect x="21" y="33.5" width="2.2" height="6.5" fill="#6b4424"/><rect x="34" y="33.5" width="2.2" height="6.5" fill="#6b4424"/>' +
          '<path d="M13 34.5q10 5.5 21 0l-2.4 4.2q-8.2 2.6-16.2 0z" fill="#7a5230"/><rect x="23.1" y="13" width="1.7" height="22" fill="#6b4424"/>' +
          '<path d="M25 14.5q9 6.2 8 15.5H25z" fill="currentColor"/><path d="M23.2 13l-5.5 1.6l5.5 1.6z" fill="currentColor"/>' +
          '<rect x="28.5" y="24" width="6.5" height="5.6" fill="#c99d66"/><path d="M28.5 26.6h6.5M31.7 24v5.6" stroke="#8a6232" stroke-width=".7" fill="none"/>' +
          '<rect x="10.5" y="25" width="5.5" height="4.5" fill="#a2723f"/>';
        const sp = document.getElementById('art-sprite');
        if (sp) sp.insertAdjacentHTML('beforeend', `<symbol id="art-port" viewBox="0 0 48 48"><g stroke="${ART_INK}" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round">${ART.port}</g></symbol>`);
      }
      // порт — в раздел торговли, а не военного дела
      if (typeof BUILD_GROUPS !== 'undefined') {
        for (const gr of BUILD_GROUPS) { const i = gr[1].indexOf('port'); if (i >= 0) gr[1].splice(i, 1); }
        const trade = BUILD_GROUPS.find(gr => gr[1].includes('market'));
        if (trade) trade[1].push('port');
      }
    }

    ui.setup = function (g) {
      if (ready) return;
      ready = true;
      installArt();
      const st = document.createElement('style');
      st.textContent = CSS;
      document.head.appendChild(st);
      const hud = $q('hud') || document.body;
      card = document.createElement('div');
      card.id = 'nv-card'; card.hidden = true;
      hud.appendChild(card);
      card.addEventListener('click', e => { const b = e.target.closest('[data-nv]'); if (b && !b.disabled) ui.cardAct(b.dataset.nv); });
      offerEl = document.createElement('div');
      offerEl.id = 'nv-offer'; offerEl.hidden = true;
      hud.appendChild(offerEl);
      offerEl.addEventListener('click', e => {
        const b = e.target.closest('[data-nv]');
        if (!b) return;
        const o = offerState;
        offerEl.hidden = true; offerState = null;
        if (b.dataset.nv !== 'sea' || !o) return;
        const G = App.game, a = G.army(o.army);
        if (!a) return;
        const err = Naval.seaOrder(G, a, o.target);
        if (err) { App.ui.toast(err); if (typeof Sfx !== 'undefined') Sfx.play('error'); }
        else if (typeof Sfx !== 'undefined') Sfx.play('march');
        App.ui.html = ''; App.ui.renderPanel();
      });
      // касания по кораблям: оболочка над Input.tap (input.js не меняем)
      if (typeof Input !== 'undefined' && !Input.prototype.__nv) {
        const orig = Input.prototype.tap;
        Input.prototype.__nv = true;
        Input.prototype.tap = function (sx, sy, alt) { if (!ui.tap(this, sx, sy, alt)) orig.call(this, sx, sy, alt); };
      }
    };

    // ---------- предложение «морем быстрее» ----------
    ui.offer = function (g, a, target) {
      if (!ready || a.owner !== g.player.id || g.opts.spectate) return;
      let o = null;
      try { o = Naval.offerFor(g, a, target); } catch (e) { o = null; }
      if (!o) { if (offerState && offerState.army === a.id) { offerEl.hidden = true; offerState = null; } return; }
      offerState = { army: a.id, target: { ...target }, t: g.time };
      offerEl.innerHTML = `<span>${Icons.svg('ship')} Морем быстрее: ≈${fmtDur(o.seaT)} вместо ≈${fmtDur(o.landT)}</span>` +
        '<button type="button" class="act" data-nv="sea">Морем</button><button type="button" class="act ghost" data-nv="land">Пешком</button>';
      offerEl.hidden = false;
    };

    // ---------- касания ----------
    function pickShip(sx, sy) {
      let best = null, bd = Infinity;
      for (const d of drawn) {
        const dd = Math.hypot(sx - d.x, sy - d.y);
        if (dd < d.r + 8 && dd < bd) { bd = dd; best = d.sh; }
      }
      return best;
    }
    ui.tap = function (input, sx, sy, alt) {
      const app = input.app, g = app.game;
      if (!g || !app.playing() || !ready) return false;
      const pl = g.player, hit = pickShip(sx, sy);
      const a = app.ui.selectedArmy();
      const cur = Naval.sel ? Naval.shipOf(g, Naval.sel) : null;
      if (hit) {
        if (hit.owner === pl.id) {
          if (a && !alt) {
            const err = Naval.boardOrder(g, a, hit);
            if (err) { app.ui.toast(err); if (typeof Sfx !== 'undefined') Sfx.play('error'); } else if (typeof Sfx !== 'undefined') Sfx.play('march');
            return true;
          }
          Naval.select(hit.id);
          return true;
        }
        // чужой корабль: своя ладья идёт в атаку, иначе просто подпись
        if (cur && cur.kind === 'galley' && cur.owner === pl.id) {
          const err = Naval.shipCommand(g, cur, hit.x, hit.y);
          if (err) app.ui.toast(err); else if (typeof Sfx !== 'undefined') Sfx.play('horn');
          return true;
        }
        app.ui.toast(SPECS[hit.kind].name + ' · ' + g.kingdom(hit.owner).name);
        return true;
      }
      if (cur && cur.owner === pl.id) {
        const w = app.renderer.toWorld(sx, sy), i = g.world.tileAt(w.x, w.y);
        if (i >= 0 && (g.world.isWater(i) || cur.cargo)) { ui.command(cur, w.x, w.y); return true; }
        Naval.select(null);
      }
      return false;
    };
    ui.command = function (sh, x, y) {
      const g = App.game;
      const err = Naval.shipCommand(g, sh, x, y);
      if (err) { App.ui.toast(err); if (typeof Sfx !== 'undefined') Sfx.play('error'); }
      else {
        App.renderer.marker = { x, y, t: 0, attack: false };
        if (typeof Sfx !== 'undefined') Sfx.play('march');
      }
    };

    // ---------- выбор и карточка корабля ----------
    ui.onSelect = function (id) {
      if (id !== null && id !== undefined && App.ui) { App.ui.select(null); Naval.sel = id; }
      if (id === null || id === undefined) ui.endTool();
      cardHtml = '';
    };
    ui.startTool = function () {
      const sh = Naval.sel ? Naval.shipOf(App.game, Naval.sel) : null;
      if (!sh) return;
      tool = {
        up(w, e, input, cancelled) { if (!cancelled) ui.command(sh, w.x, w.y); ui.endTool(); },
        cancel() { tool = null; ui.hint(false); },
      };
      App.input.setTool(tool);
      ui.hint(true);
    };
    ui.endTool = function () { if (tool) { const t = tool; tool = null; if (App.input.tool === t) App.input.setTool(null); } ui.hint(false); };
    ui.hint = function (on) {
      const h = $q('hint');
      if (!h) return;
      if (on) { h.textContent = 'Коснитесь воды — плыть, берега — причалить и высадить войска'; h.hidden = false; }
      else if (App.ui) App.ui.updateHint();
    };
    ui.cardAct = function (act) {
      const g = App.game, sh = Naval.sel ? Naval.shipOf(g, Naval.sel) : null;
      if (act === 'close') { Naval.select(null); return; }
      if (!sh) return;
      let err = null;
      if (act === 'sail') { if (tool) ui.endTool(); else ui.startTool(); }
      else if (act === 'home') { sh.mission = null; sh.manual = false; if (!Naval.sendHome(g, sh)) err = 'Нет порта, куда вернуться'; }
      else if (act === 'stop') { sh.mission = null; Naval.stopShip(sh); }
      else if (act === 'land') err = Naval.unload(g, sh);
      if (err) { App.ui.toast(err); if (typeof Sfx !== 'undefined') Sfx.play('error'); }
      cardHtml = '';
    };
    function shipStatus(g, sh) {
      if (sh.job) return 'ждёт армию';
      if (sh.mission) return 'идёт к высадке';
      if (sh.st === 'sail') return sh.act === 'dock' ? 'идёт в порт' : sh.act === 'chase' ? 'преследует врага' : 'в пути';
      if (sh.st === 'dock') { const c = g.city(sh.dock); return 'в порту' + (c ? ' ' + c.name : ''); }
      return 'стоит на якоре';
    }
    function portrait(g, kind, owner, px) {
      const k = g.kingdom(owner) || g.player;
      const key = kind + '|' + k.color + '|' + px;
      let url = portraits.get(key);
      if (url === undefined) {
        url = null;
        try {
          if (typeof UnitArt !== 'undefined' && UnitArt && typeof UnitArt.ship === 'function') {
            const dpr = Math.min(2, window.devicePixelRatio || 1), cv = document.createElement('canvas');
            cv.width = cv.height = Math.round(px * dpr);
            const c = cv.getContext('2d');
            c.scale(dpr, dpr);
            const size = px / 3.7;
            UnitArt.ship(c, px / 2, px * 0.76, size, k, kind === 'galley' ? 'war' : 'transport', 0, 0);
            url = cv.toDataURL();
          }
        } catch (e) { url = null; }
        portraits.set(key, url);
      }
      if (url) return `<img class="portrait" src="${url}" width="${px}" height="${px}" alt="" draggable="false">`;
      const k2 = k.color || '#888';
      return `<span class="portrait glyph" style="width:${px}px;height:${px}px;background-color:${k2}">${Icons.svg('ship')}</span>`;
    }
    function cardFor(g, sh) {
      const sp = SPECS[sh.kind], k = g.kingdom(sh.owner), mine = sh.owner === g.player.id;
      const pct = Math.max(0, Math.min(100, sh.hp / sp.hp * 100));
      let h = `<div class="nv-h">${portrait(g, sh.kind, sh.owner, 44)}<div><b>${sp.name}</b><span>${escapeHtml(shipStatus(g, sh))}</span></div>` +
        `<button type="button" class="nv-x" data-nv="close" aria-label="Закрыть">${Icons.svg('close')}</button></div>`;
      h += `<div class="progress hp"><i style="width:${pct.toFixed(0)}%"></i></div><div class="nv-row"><span>${Icons.svg('heart')} ${Math.ceil(sh.hp)} из ${sp.hp}</span>`;
      if (sp.cap) h += `<span>${Icons.svg('people')} ${sh.cargo ? men(menCount(sh.cargo.units)) : 'пуст · вместит ' + sp.cap}</span>`;
      if (sp.atk) h += `<span>${Icons.svg('swords')} бьёт на ${sp.range} кл.</span>`;
      h += '</div>';
      if (sh.cargo) h += App.ui.unitsHtml(sh.cargo.units);
      if (mine) {
        h += '<div class="nv-btns">' +
          `<button type="button" class="act${tool ? ' on' : ''}" data-nv="sail">${Icons.svg('target')}${tool ? 'Отмена' : 'Плыть сюда'}</button>` +
          (sh.cargo ? `<button type="button" class="act" data-nv="land">${Icons.svg('flag')}Высадить</button>` : '') +
          '<button type="button" class="act ghost" data-nv="home">В порт</button><button type="button" class="act ghost" data-nv="stop">Стоп</button></div>';
      }
      return h;
      function men(n) { return n + ' ' + plural(n, 'воин', 'воина', 'воинов'); }
    }
    function updateCard(g) {
      if (!card) return;
      const sh = Naval.sel ? Naval.shipOf(g, Naval.sel) : null;
      if (sh && App.ui.sel) { Naval.sel = null; }
      if (!sh || !Naval.sel) { if (!card.hidden) { card.hidden = true; ui.endTool(); } cardHtml = ''; if (Naval.sel && !sh) Naval.sel = null; return; }
      const h = cardFor(g, sh);
      if (h !== cardHtml) { card.innerHTML = h; cardHtml = h; }
      if (card.hidden) card.hidden = false;
    }

    // ---------- панель города: вкладка «Порт» ----------
    function shipRow(g, sh) {
      const sp = SPECS[sh.kind], pct = Math.max(0, Math.min(100, sh.hp / sp.hp * 100));
      return `<div class="nv-ship" data-key="nvs-${sh.id}">${portrait(g, sh.kind, sh.owner, 44)}<div><b>${sp.name}</b> <span class="muted">${escapeHtml(shipStatus(g, sh))}${sh.cargo ? ' · ' + menCount(sh.cargo.units) + ' воинов' : ''}</span>` +
        `<div class="progress hp"><i style="width:${pct.toFixed(0)}%"></i></div></div><button type="button" class="act ghost" data-act="nv-sel" data-id="${sh.id}">Выбрать</button></div>`;
    }
    function shipCard(g, c, pl, ui2, kind) {
      const sp = SPECS[kind], info = Naval.queueInfo(g, c, kind), block = Naval.queueBlock(g, c, kind);
      const num = v => String(v).replace('.', ',');
      let h = `<div class="bcard ucard${info.block ? ' locked' : ''}" data-key="nvc-${kind}">`;
      h += `<div class="bc-head"><div class="art-f pf">${portrait(g, kind, pl.id, 52)}</div><div class="bc-t"><h4 title="${escapeHtml(sp.desc)}">${sp.name}</h4>` +
        `<span class="muted">${sp.cap ? 'везёт до ' + sp.cap + ' воинов' : 'боевой корабль'} · ход ${num(sp.speed)} кл/с</span></div></div>`;
      h += `<div class="ustats"><span title="Прочность">${Icons.svg('heart')}<b>${sp.hp}</b></span>` + (sp.atk ? `<span title="Урон в секунду">${Icons.svg('swords')}<b>${sp.atk}</b></span>` : '') +
        `<span title="Содержание в минуту">${Icons.svg('gold')}<b>−${num(sp.upkeep)}</b></span></div>`;
      h += `<div class="cost">${ui2.costHtml(pl, info.cost, info.time, info.pop)}</div>`;
      if (block) {
        let why = escapeHtml(block), cls = 'lock', ic = 'lock';
        if (!info.block && ui2.lacking(pl, info.cost).length) { why = ui2.lackText(pl, info.cost); cls = 'lack'; }
        h += `<button class="act build ${cls}" type="button" data-act="nv-build" data-id="${kind}" disabled title="${escapeHtml(block)}">${Icons.svg(ic)}<span>${why}</span></button>`;
      } else h += `<button class="act build" type="button" data-act="nv-build" data-id="${kind}">${Icons.svg('plus')}<span>Заказать</span></button>`;
      return h + '</div>';
    }
    UIExt.citySections.push({
      id: 'port', title: 'Порт', icon: 'anchor',
      when: (g, c) => c.owner === g.player.id && (c.buildings.port || 0) > 0,
      html(g, c, ui2) {
        const pl = g.player, N = Naval.state(g);
        if (!(c.buildings.port > 0)) return '<div class="pane" data-key="pane-port"><p class="tip">В этом городе нет порта. Постройте его на вкладке «Хозяйство».</p></div>';
        const docked = N.ships.filter(s => s.dock === c.id);
        let h = '<div class="pane" data-key="pane-port">';
        h += `<div class="box" data-key="nv-fleet"><div class="box-h"><h4>${Icons.svg('anchor')} Гавань</h4><span class="muted">порт ${c.buildings.port} ур. · у причала ${docked.length}</span></div>`;
        h += docked.length ? '<div class="nv-list">' + docked.map(s => shipRow(g, s)).join('') + '</div>' : '<p class="tip">У причала пусто. Закажите транспорт — он повезёт армии через море.</p>';
        h += '</div>';
        const y = N.yards[c.id];
        if (y && y.q.length) {
          const q = y.q[0], sp = SPECS[q.kind];
          h += `<div class="box queue" data-key="nv-queue"><div class="box-h"><h4>${Icons.svg('hourglass')} Верфь</h4><span class="muted">${y.q.length} в очереди</span></div>` +
            `<div class="q-now">${portrait(g, q.kind, pl.id, 44)}<div class="q-main"><div class="q-t"><b>${sp.name}</b><span class="muted">${Icons.svg('hourglass')}${c.siegeBy ? 'стоит: осада' : fmtTime(q.total - q.t)}</span></div>` +
            `<div class="progress anim"><i style="width:${Math.min(100, q.t / q.total * 100).toFixed(1)}%"></i></div></div></div>`;
          if (y.q.length > 1) h += '<div class="q-next"><span class="muted">Дальше</span>' + y.q.slice(1).map(x => `<span class="q-slot" title="${SPECS[x.kind].name}">${portrait(g, x.kind, pl.id, 30)}</span>`).join('') + '</div>';
          h += '<div class="btnrow"><button type="button" class="act ghost" data-act="nv-cancelq" data-i="0">Отменить заказ<small> (вернётся 75%)</small></button></div></div>';
        }
        h += '<h5 class="sec">Верфь</h5><div class="bcards">' + NAVAL_KINDS.map(k => shipCard(g, c, pl, ui2, k)).join('') + '</div>';
        h += '<p class="tip">Армия сама идёт к порту и плывёт, если по суше не пройти. Если море быстрее, игре предложит его при приказе. Или коснитесь своего корабля, выбрав армию — она сядет на борт, а потом укажите, куда плыть. Боевые ладьи прикрывают транспорты и топят чужие корабли.</p>';
        return h + '</div>';
      },
    });
    UIExt.actions['nv-build'] = (d, ui2, city) => {
      if (!city) return;
      const err = Naval.queue(App.game, city, d.id);
      if (!err && typeof Sfx !== 'undefined') Sfx.play('build');
      return err;
    };
    UIExt.actions['nv-cancelq'] = (d, ui2, city) => { if (city) Naval.cancelQueue(App.game, city, +d.i || 0); };
    UIExt.actions['nv-sel'] = (d) => {
      const sh = Naval.shipOf(App.game, +d.id);
      if (!sh) return;
      App.focus(sh.x, sh.y);
      Naval.select(sh.id);
      return 'nopanel';
    };
    // вкладка державы «Флот»
    UIExt.kingdomTabs.push({
      id: 'fleet', title: 'Флот',
      html(g, pl, ui2) {
        const ports = g.citiesOf(pl.id).filter(c => c.buildings.port > 0), ships = Naval.shipsOf(g, pl.id);
        if (!ports.length && !ships.length) return '<p class="tip">Флота нет. Постройте порт в городе у моря: корабли возят армии через воду и топят чужие.</p>';
        let h = '<table class="t"><thead><tr><th>Порт</th><th class="num">Ур.</th><th class="num">Кораблей</th></tr></thead><tbody>';
        for (const c of ports) h += `<tr class="click" data-act="selcity" data-id="${c.id}"><td>${escapeHtml(c.name)}</td><td class="num">${c.buildings.port}</td><td class="num">${ships.filter(s => s.dock === c.id).length}</td></tr>`;
        h += '</tbody></table>';
        if (ships.length) {
          h += '<table class="t" style="margin-top:8px"><thead><tr><th>Корабль</th><th class="num">Прочн.</th><th>Состояние</th></tr></thead><tbody>';
          for (const s of ships) h += `<tr class="click" data-act="nv-sel" data-id="${s.id}"><td>${SPECS[s.kind].name}</td><td class="num">${Math.ceil(s.hp)}</td><td>${escapeHtml(shipStatus(g, s))}${s.cargo ? ' · ' + menCount(s.cargo.units) + ' воинов' : ''}</td></tr>`;
          h += '</tbody></table>';
        }
        return h + '<p class="tip">Корабли стоят золота в минуту. Потопленный транспорт уносит с собой всю армию на борту.</p>';
      },
    });

    // ---------- отрисовка ----------
    // След на воде и причалы — слой карты (под туманом).
    RenderExt.map.push((ctx, r, z, tl, br) => {
      const g = r.g, N = g.naval;
      if (!N) return;
      // причалы
      for (const c of g.cities) {
        if (!(c.buildings.port > 0) || !g.explored[g.cityTile(c)]) continue;
        const h = Naval.harbor(g, c);
        if (!h) continue;
        const px = c.x + 0.5 + (h.wx - c.x - 0.5) * 0.62, py = c.y + 0.5 + (h.wy - c.y - 0.5) * 0.62;
        if (px < tl.x - 3 || px > br.x + 3 || py < tl.y - 3 || py > br.y + 3) continue;
        const k = g.kingdom(c.owner);
        if (typeof WorldArt !== 'undefined' && WorldArt && typeof WorldArt.port === 'function') WorldArt.port(ctx, px, py, 0.55, k, h.ang);
        else {
          ctx.save(); ctx.translate(px, py); ctx.rotate(h.ang);
          ctx.fillStyle = '#a2723f'; ctx.strokeStyle = '#2a1b0d'; ctx.lineWidth = 0.04;
          ctx.fillRect(-0.3, -0.12, 1.0, 0.24); ctx.strokeRect(-0.3, -0.12, 1.0, 0.24);
          ctx.restore();
        }
      }
      // кильватер
      ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (const sh of N.ships) {
        const tr = sh.tr;
        if (!tr || tr.length < 2 || sh.st !== 'sail') continue;
        if (sh.x < tl.x - 4 || sh.x > br.x + 4 || sh.y < tl.y - 4 || sh.y > br.y + 4) continue;
        if (sh.owner !== g.player.id && !g.isVisible(sh.x, sh.y) && !g.opts.spectate) continue;
        for (let i = 1; i < tr.length; i++) {
          const age = g.time - tr[i].t;
          if (age > 3) continue;
          ctx.strokeStyle = 'rgba(255,255,255,' + (0.5 * (1 - age / 3)).toFixed(3) + ')';
          ctx.lineWidth = 0.1 + 0.2 * (age / 3);
          ctx.beginPath(); ctx.moveTo(tr[i - 1].x, tr[i - 1].y); ctx.lineTo(tr[i].x, tr[i].y); ctx.stroke();
        }
      }
    });

    function fallbackShip(ctx, x, y, s, k, kind, ang, frame) {
      const dir = Math.cos(ang) < 0 ? -1 : 1, bob = Math.sin(frame * 0.3) * s * 0.04;
      ctx.save(); ctx.translate(x, y + bob); ctx.scale(dir, 1);
      ctx.fillStyle = 'rgba(30,60,90,0.35)'; ctx.beginPath(); ctx.ellipse(0, 0, s * 1.7, s * 0.3, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = '#7a5230'; ctx.strokeStyle = '#2a1b0d'; ctx.lineWidth = 1.2;
      ctx.beginPath(); ctx.moveTo(-s * 1.5, -s * 0.5); ctx.lineTo(s * 1.5, -s * 0.5); ctx.lineTo(s * 1.0, 0); ctx.lineTo(-s * 1.1, 0); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -s * 0.5); ctx.lineTo(0, -s * 2.4); ctx.stroke();
      ctx.fillStyle = k.color;
      ctx.beginPath(); ctx.moveTo(0.1 * s, -s * 2.3); ctx.lineTo(s * 1.0, -s * 0.9); ctx.lineTo(0.1 * s, -s * 0.9); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    // Корабли, выбранный курс, шкала прочности, подпись груза — экранный слой.
    RenderExt.screen.push((ctx, r, z, tl, br, dt) => {
      const g = r.g, N = g.naval;
      drawn = [];
      updateCard(g);
      if (!N) return;
      const pl = g.player, S = Math.max(7, r.armySize() * 0.7 * (z < 16 ? z / 16 : 1)), frame = Math.floor(r.time * 8);
      const list = N.ships.filter(sh => sh.x > tl.x - 3 && sh.x < br.x + 3 && sh.y > tl.y - 3 && sh.y < br.y + 3 && (sh.owner === pl.id || g.opts.spectate || g.isVisible(sh.x, sh.y)));
      list.sort((a, b) => a.y - b.y);
      // выбранный корабль: курс пунктиром
      const cur = Naval.sel ? Naval.shipOf(g, Naval.sel) : null;
      if (cur && cur.path && cur.st === 'sail') {
        ctx.save(); ctx.setLineDash([6, 6]); ctx.strokeStyle = 'rgba(255,240,190,0.85)'; ctx.lineWidth = 2;
        ctx.beginPath();
        let p = r.toScreen(cur.x, cur.y); ctx.moveTo(p.x, p.y);
        for (let i = cur.pi; i < cur.path.length; i++) { p = r.toScreen(cur.path[i].x, cur.path[i].y); ctx.lineTo(p.x, p.y); }
        ctx.stroke(); ctx.restore();
        ctx.fillStyle = '#ffe28a'; ctx.beginPath(); ctx.arc(p.x, p.y, 4, 0, TAU); ctx.fill();
      }
      for (const sh of list) {
        const k = g.kingdom(sh.owner), p = r.toScreen(sh.x, sh.y), war = sh.kind === 'galley';
        const hurt = g.time - (sh.hurt || -9) < 0.4;
        if (sh === cur) {
          ctx.strokeStyle = '#ffe28a'; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.ellipse(p.x, p.y, S * 1.9, S * 0.65, 0, 0, TAU); ctx.stroke();
        }
        if (hurt) ctx.globalAlpha = 0.65 + 0.35 * Math.sin(r.time * 40);
        if (typeof UnitArt !== 'undefined' && UnitArt && typeof UnitArt.ship === 'function') UnitArt.ship(ctx, p.x, p.y, S, k, war ? 'war' : 'transport', sh.ang, frame + sh.id);
        else fallbackShip(ctx, p.x, p.y, S, k, sh.kind, sh.ang, frame + sh.id);
        ctx.globalAlpha = 1;
        drawn.push({ sh, x: p.x, y: p.y - S * 0.8, r: S * 1.7 });
        // выстрелы ладьи
        if (sh.shoot && g.time - sh.shoot.t < 0.3 && sh._shot !== sh.shoot.t) {
          sh._shot = sh.shoot.t;
          const tg = Naval.shipOf(g, sh.shoot.id);
          if (tg) {
            r.spawn('stone', sh.x, sh.y - 0.25, { tx: tg.x + (Math.random() - 0.5) * 0.5, ty: tg.y - 0.2, dur: 0.45, arc: 0.7 });
            if (Math.random() < 0.5) r.spawn('smoke', sh.x, sh.y - 0.4);
          }
        }
        if (hurt && Math.random() < 0.3) r.spawn('spark', sh.x + (Math.random() - 0.5) * 0.8, sh.y - 0.3);
        // прочность и груз
        const full = sh.hp >= SPECS[sh.kind].hp - 0.5;
        if (!full || sh === cur || sh.cargo) {
          const w = S * 1.5, yy = p.y - S * 2.2;
          if (!full) {
            ctx.fillStyle = 'rgba(30,18,8,0.7)'; ctx.fillRect(p.x - w / 2 - 1, yy - 1, w + 2, 6);
            ctx.fillStyle = sh.hp / SPECS[sh.kind].hp > 0.4 ? '#7fb24a' : '#c9552f'; ctx.fillRect(p.x - w / 2, yy, w * Math.max(0, sh.hp / SPECS[sh.kind].hp), 4);
          }
          if (sh.cargo) {
            const n = menCount(sh.cargo.units), txt = n >= 1000 ? (n / 1000).toFixed(1) + 'к' : String(n);
            if (typeof UnitArt !== 'undefined' && UnitArt && typeof UnitArt.plate === 'function') {
              const pt = UnitArt.plate(txt, false, r.dpr);
              ctx.drawImage(pt.cv, p.x - pt.w / 2, yy - pt.h - 1, pt.w, pt.h);
            } else {
              ctx.font = '700 12px sans-serif'; ctx.textAlign = 'center'; ctx.fillStyle = '#fff'; ctx.strokeStyle = '#2a1b0d'; ctx.lineWidth = 3;
              ctx.strokeText(txt, p.x, yy - 4); ctx.fillText(txt, p.x, yy - 4);
            }
          }
        }
      }
      // тонущие корабли
      for (const f of g.fx) {
        if (f.type !== 'sunk' || !g.isVisible(f.x, f.y) && !g.opts.spectate) continue;
        const k = g.kingdom(f.owner), p = r.toScreen(f.x, f.y), q = f.t / f.dur;
        ctx.save(); ctx.globalAlpha = Math.max(0, 1 - q);
        ctx.translate(p.x, p.y + q * S * 0.9); ctx.rotate((Math.cos(f.ang) < 0 ? -1 : 1) * q * 0.9); ctx.translate(-p.x, -p.y);
        if (typeof UnitArt !== 'undefined' && UnitArt && typeof UnitArt.ship === 'function') UnitArt.ship(ctx, p.x, p.y, S, k, f.kind === 'galley' ? 'war' : 'transport', f.ang, 0);
        else fallbackShip(ctx, p.x, p.y, S, k, f.kind, f.ang, 0);
        ctx.restore();
      }
      // предложение морем гаснет через несколько секунд или когда приказ армии сменился
      if (offerState && !offerEl.hidden) {
        const a = g.army(offerState.army);
        if (!a || g.time - offerState.t > 12 || !a.dest) { offerEl.hidden = true; offerState = null; }
      }
    });
  })();
}
