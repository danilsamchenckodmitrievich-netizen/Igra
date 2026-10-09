'use strict';
// Генерация мира: рельеф, реки, места городов, дороги, территории, поиск пути.

class World {
  constructor(seed, sizeKey) {
    const sz = MAP_SIZES[sizeKey] || MAP_SIZES.medium;
    this.seed = seed;
    this.sizeKey = sizeKey;
    this.W = sz.W; this.H = sz.H;
    const n = this.W * this.H;
    this.terrain = new Uint8Array(n);
    this.elev = new Float32Array(n);
    this.river = new Uint8Array(n);
    this.road = new Uint8Array(n);
    this.cityOf = new Int16Array(n).fill(-1);
    this.main = new Uint8Array(n);   // 1 — материк, куда можно дойти пешком
    this.rivers = [];
    this.roads = [];
    this.sites = [];
    this.rng = new Rng(seed ^ 0x5bd1e995);
    // буферы поиска пути
    this.gScore = new Float32Array(n);
    this.came = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.searchId = 0;
    this.heap = new MinHeap();
    this.generate(sz.cities);
  }

  idx(x, y) { return y * this.W + x; }
  inside(x, y) { return x >= 0 && y >= 0 && x < this.W && y < this.H; }
  isWater(i) { return this.terrain[i] <= T.SHALLOW; }
  passable(i) { return this.terrain[i] > T.SHALLOW; }
  tileAt(x, y) {
    const tx = Math.floor(x), ty = Math.floor(y);
    return this.inside(tx, ty) ? this.idx(tx, ty) : -1;
  }

  // Множитель времени прохода клетки.
  moveCost(i) {
    const t = this.terrain[i];
    let c = TERRAIN[t].cost;
    if (this.road[i]) return Math.max(ROAD_MULT, c * ROAD_MULT);
    if (this.river[i]) c += RIVER_COST;
    return c;
  }

  generate(cityTarget) {
    const W = this.W, H = this.H, rng = this.rng;
    const nE = makeNoise(this.seed + 11), nM = makeNoise(this.seed + 23), nW = makeNoise(this.seed + 37);
    const elev = this.elev, ter = this.terrain;
    // Рельеф: фрактальный шум, искажённый вторым шумом, минус спад к краям — получается материк с заливами.
    for (let y = 0; y < H; y++) {
      for (let x = 0; x < W; x++) {
        const wx = x + (fractal(nW, x / 20, y / 20, 2) - 0.5) * 14;
        const wy = y + (fractal(nW, x / 20 + 50, y / 20 + 50, 2) - 0.5) * 14;
        let e = fractal(nE, wx / 26, wy / 26, 5);
        const dx = (x / (W - 1) - 0.5) * 2, dy = (y / (H - 1) - 0.5) * 2;
        const edge = Math.max(Math.abs(dx), Math.abs(dy));
        const fall = Math.pow(edge, 3.2) * 0.75 + (dx * dx + dy * dy) * 0.12;
        elev[this.idx(x, y)] = e - fall;
      }
    }
    const sorted = Array.from(elev).sort((a, b) => a - b);
    const q = p => sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))];
    const sea = q(0.36);
    const land = sorted.filter(v => v > sea);
    const lq = p => land[Math.min(land.length - 1, Math.floor(p * land.length))];
    const hills = lq(0.76), mount = lq(0.9), snow = lq(0.975);
    const moist = new Float32Array(W * H);
    for (let i = 0; i < W * H; i++) {
      const x = i % W, y = (i - x) / W;
      moist[i] = fractal(nM, x / 16, y / 16, 4);
    }
    const landMoist = [];
    for (let i = 0; i < W * H; i++) if (elev[i] > sea && elev[i] < hills) landMoist.push(moist[i]);
    landMoist.sort((a, b) => a - b);
    const forestCut = landMoist[Math.floor(landMoist.length * 0.58)] || 0.5;
    for (let i = 0; i < W * H; i++) {
      const e = elev[i];
      if (e <= sea) ter[i] = T.DEEP;
      else if (e >= snow) ter[i] = T.SNOW;
      else if (e >= mount) ter[i] = T.MOUNTAIN;
      else if (e >= hills) ter[i] = T.HILLS;
      else ter[i] = moist[i] > forestCut ? T.FOREST : T.PLAINS;
    }
    // мелководье и побережье
    const near = (i, r, pred) => {
      const x = i % W, y = (i - x) / W;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        const nx = x + dx, ny = y + dy;
        if (this.inside(nx, ny) && pred(this.idx(nx, ny))) return true;
      }
      return false;
    };
    const isLandRaw = i => ter[i] > T.SHALLOW;
    const isSeaRaw = i => ter[i] <= T.SHALLOW;
    const shallow = [], beach = [];
    for (let i = 0; i < W * H; i++) {
      if (ter[i] === T.DEEP && near(i, 2, isLandRaw)) shallow.push(i);
      else if ((ter[i] === T.PLAINS || ter[i] === T.FOREST) && near(i, 1, isSeaRaw)) beach.push(i);
    }
    for (const i of shallow) ter[i] = T.SHALLOW;
    for (const i of beach) ter[i] = T.BEACH;
    // края карты — всегда море
    for (let x = 0; x < W; x++) { ter[x] = T.DEEP; ter[(H - 1) * W + x] = T.DEEP; }
    for (let y = 0; y < H; y++) { ter[y * W] = T.DEEP; ter[y * W + W - 1] = T.DEEP; }

    this.findMainland();
    this.makeRivers();
    this.placeSites(cityTarget);
    this.makeRoads();
  }

  findMainland() {
    const W = this.W, n = W * this.H;
    const comp = new Int32Array(n).fill(-1);
    let best = -1, bestSize = 0, id = 0;
    for (let s = 0; s < n; s++) {
      if (comp[s] >= 0 || !this.passable(s)) continue;
      const stack = [s]; comp[s] = id; let size = 0;
      while (stack.length) {
        const k = stack.pop(); size++;
        const x = k % W, y = (k - x) / W;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (!this.inside(nx, ny)) continue;
          const j = this.idx(nx, ny);
          if (comp[j] >= 0 || !this.passable(j)) continue;
          comp[j] = id; stack.push(j);
        }
      }
      if (size > bestSize) { bestSize = size; best = id; }
      id++;
    }
    for (let i = 0; i < n; i++) this.main[i] = comp[i] === best ? 1 : 0;
    this.mainArea = bestSize;
  }

  makeRivers() {
    const W = this.W, H = this.H, rng = this.rng, ter = this.terrain, elev = this.elev;
    const want = Math.round(W * H / 1000);
    const sources = [];
    for (let i = 0; i < W * H; i++) if (this.main[i] && (ter[i] === T.MOUNTAIN || ter[i] === T.HILLS)) sources.push(i);
    rng.shuffle(sources);
    let made = 0;
    for (const s of sources) {
      if (made >= want) break;
      if (this.river[s]) continue;
      let cur = s;
      const path = [cur];
      const seen = new Set([cur]);
      let ok = false;
      for (let step = 0; step < 220; step++) {
        const x = cur % W, y = (cur - x) / W;
        let best = -1, be = Infinity;
        for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
          const nx = x + dx, ny = y + dy;
          if (!this.inside(nx, ny)) continue;
          const j = this.idx(nx, ny);
          if (seen.has(j)) continue;
          const e = elev[j] + rng.next() * 0.012;
          if (e < be) { be = e; best = j; }
        }
        if (best < 0 || be > elev[cur] + 0.03) break;
        cur = best;
        seen.add(cur);
        path.push(cur);
        if (this.isWater(cur) || this.river[cur]) { ok = true; break; }
      }
      if (!ok || path.length < 9) continue;
      for (const k of path) if (!this.isWater(k)) this.river[k] = 1;
      this.rivers.push(path.map(k => ({ x: k % W + 0.5, y: Math.floor(k / W) + 0.5 })));
      made++;
    }
  }

  placeSites(target) {
    const W = this.W, H = this.H, rng = this.rng, ter = this.terrain;
    const cands = [];
    for (let y = 3; y < H - 3; y++) {
      for (let x = 3; x < W - 3; x++) {
        const i = this.idx(x, y);
        if (!this.main[i] || this.river[i]) continue;
        const t = ter[i];
        if (t !== T.PLAINS && t !== T.BEACH && t !== T.FOREST && t !== T.HILLS) continue;
        let score = 0, waterAdj = false, riverAdj = false;
        for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
          const j = this.idx(x + dx, y + dy);
          const tt = ter[j];
          if (tt === T.PLAINS) score += 1;
          else if (tt === T.FOREST || tt === T.HILLS) score += 0.6;
          else if (tt === T.MOUNTAIN) score += 0.3;
          if (Math.abs(dx) <= 1 && Math.abs(dy) <= 1) {
            if (this.isWater(j)) waterAdj = true;
            if (this.river[j]) riverAdj = true;
          }
        }
        if (riverAdj) score += 8;
        if (waterAdj) score += 5;
        cands.push({ x, y, score: score + rng.next() * 10 });
      }
    }
    cands.sort((a, b) => b.score - a.score);
    let minD = Math.sqrt(this.mainArea / target) * 0.8;
    let sites = [];
    for (let attempt = 0; attempt < 6 && sites.length < target; attempt++) {
      sites = [];
      for (const c of cands) {
        if (sites.length >= target) break;
        if (sites.every(s => dist(s.x, s.y, c.x, c.y) >= minD)) sites.push({ x: c.x, y: c.y });
      }
      if (sites.length < target) minD *= 0.88;
    }
    this.minD = minD;
    this.sites = sites;
  }

  // Стоимость прокладки дороги: обходим горы, реже пересекаем реки, переиспользуем готовые дороги.
  roadCost(i) {
    if (this.road[i]) return 0.3;
    const t = this.terrain[i];
    let c = [0, 0, 1.3, 1, 2.2, 2.8, 9, 14][t];
    if (this.river[i]) c += 5;
    return c;
  }

  makeRoads() {
    const sites = this.sites, n = sites.length;
    const edges = [];
    for (let a = 0; a < n; a++) for (let b = a + 1; b < n; b++) {
      edges.push({ a, b, d: dist(sites[a].x, sites[a].y, sites[b].x, sites[b].y) });
    }
    edges.sort((p, q) => p.d - q.d);
    // остовное дерево (Краскал) + ближайшие соседи
    const parent = sites.map((_, i) => i);
    const find = i => (parent[i] === i ? i : (parent[i] = find(parent[i])));
    const chosen = new Set();
    for (const e of edges) {
      const ra = find(e.a), rb = find(e.b);
      if (ra !== rb) { parent[ra] = rb; chosen.add(e); }
    }
    const deg = new Array(n).fill(0);
    for (const e of chosen) { deg[e.a]++; deg[e.b]++; }
    for (const e of edges) {
      if (chosen.has(e) || e.d > this.minD * 1.9) continue;
      if (deg[e.a] < 3 && deg[e.b] < 3) { chosen.add(e); deg[e.a]++; deg[e.b]++; }
    }
    const list = [...chosen].sort((p, q) => p.d - q.d);
    for (const e of list) {
      const A = sites[e.a], B = sites[e.b];
      const path = this.astar(this.idx(A.x, A.y), this.idx(B.x, B.y), i => this.roadCost(i), 0.3, 40000);
      if (!path) continue;
      for (const k of path) this.road[k] = 1;
      this.roads.push(path.map(k => ({ x: k % this.W + 0.5, y: Math.floor(k / this.W) + 0.5 })));
    }
  }

  // A* по клеткам (8 направлений, без срезания углов через воду).
  astar(s, goal, costFn, minCost, limit) {
    const W = this.W, H = this.H;
    if (s === goal) return [s];
    const id = ++this.searchId;
    const g = this.gScore, came = this.came, stamp = this.stamp, closed = this.closed, heap = this.heap;
    heap.clear();
    const gx = goal % W, gy = (goal - gx) / W;
    const h = k => {
      const x = k % W, y = (k - x) / W;
      const dx = Math.abs(x - gx), dy = Math.abs(y - gy);
      return ((dx + dy) + (Math.SQRT2 - 2) * Math.min(dx, dy)) * minCost;
    };
    stamp[s] = id; g[s] = 0; came[s] = -1;
    heap.push(s, h(s));
    let found = false, exp = 0;
    while (heap.size) {
      const k = heap.pop();
      if (closed[k] === id) continue;
      closed[k] = id;
      if (k === goal) { found = true; break; }
      if (++exp > limit) break;
      const x = k % W, y = (k - x) / W;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (!dx && !dy) continue;
          const nx = x + dx, ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
          const j = ny * W + nx;
          if (closed[j] === id || !this.passable(j)) continue;
          if (dx && dy && (!this.passable(y * W + nx) || !this.passable(ny * W + x))) continue;
          const c = (costFn(k) + costFn(j)) * 0.5 * (dx && dy ? Math.SQRT2 : 1);
          const ng = g[k] + c;
          if (stamp[j] !== id || ng < g[j]) {
            stamp[j] = id; g[j] = ng; came[j] = k;
            heap.push(j, ng + h(j));
          }
        }
      }
    }
    if (!found) return null;
    const out = [];
    for (let k = goal; k !== -1; k = came[k]) out.push(k);
    return out.reverse();
  }

  nearestPassable(x, y) {
    const tx = clamp(Math.floor(x), 0, this.W - 1), ty = clamp(Math.floor(y), 0, this.H - 1);
    const i0 = this.idx(tx, ty);
    if (this.passable(i0) && this.main[i0]) return i0;
    for (let r = 1; r < 30; r++) {
      let best = -1, bd = Infinity;
      for (let dy = -r; dy <= r; dy++) for (let dx = -r; dx <= r; dx++) {
        if (Math.max(Math.abs(dx), Math.abs(dy)) !== r) continue;
        const nx = tx + dx, ny = ty + dy;
        if (!this.inside(nx, ny)) continue;
        const j = this.idx(nx, ny);
        if (!this.passable(j) || !this.main[j]) continue;
        const d = dx * dx + dy * dy;
        if (d < bd) { bd = d; best = j; }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  // Путь армии в клетках; возвращает массив точек-центров клеток.
  findPath(sx, sy, tx, ty) {
    const s = this.nearestPassable(sx, sy), t = this.nearestPassable(tx, ty);
    if (s < 0 || t < 0) return null;
    const path = this.astar(s, t, i => this.moveCost(i), ROAD_MULT, 60000);
    if (!path) return null;
    const W = this.W;
    return path.map(k => ({ x: k % W + 0.5, y: Math.floor(k / W) + 0.5 }));
  }

  // Территории: каждая клетка принадлежит ближайшему (по стоимости пути) городу в пределах его радиуса.
  computeTerritory(cities) {
    const W = this.W, n = W * this.H;
    const best = new Float32Array(n).fill(Infinity);
    const owner = this.cityOf;
    owner.fill(-1);
    const heap = new MinHeap();
    for (const c of cities) {
      const i = this.idx(c.x, c.y);
      best[i] = 0; owner[i] = c.id;
      heap.push(i, 0);
    }
    const byId = new Map(cities.map(c => [c.id, c]));
    while (heap.size) {
      const k = heap.pop();
      const c = byId.get(owner[k]);
      const x = k % W, y = (k - x) / W;
      const r = CITY_LEVELS[c.level].radius;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1], [1, 1], [1, -1], [-1, 1], [-1, -1]]) {
        const nx = x + dx, ny = y + dy;
        if (!this.inside(nx, ny)) continue;
        const j = this.idx(nx, ny);
        if (!this.passable(j)) continue;
        if (dist(nx, ny, c.x, c.y) > r + 0.5) continue;
        const ng = best[k] + this.moveCost(j) * (dx && dy ? 1.41 : 1);
        if (ng < best[j]) { best[j] = ng; owner[j] = c.id; heap.push(j, ng); }
      }
    }
    // береговые воды у городов тоже рисуем своими (для красоты границ)
    for (const c of cities) c.tiles = { river: 0 };
    for (let i = 0; i < n; i++) {
      const id = owner[i];
      if (id < 0) continue;
      const c = byId.get(id);
      const t = this.terrain[i];
      c.tiles[t] = (c.tiles[t] || 0) + 1;
      if (this.river[i]) c.tiles.river++;
    }
  }
}
