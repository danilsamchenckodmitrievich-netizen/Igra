'use strict';
// Карта: линии, река, лес, лагеря, сетка проходимости и поиск пути.

class GameMap {
  constructor(seed) {
    this.size = WORLD_SIZE;
    this.cell = 50;
    this.gw = Math.ceil(this.size / this.cell);
    this.grid = new Uint8Array(this.gw * this.gw);
    this.seed = seed;
    this.rng = mulberry32(seed);
    this.buildLayout();
    this.generateTrees();
    this.buildGrid();
    // буферы для A*
    const n = this.gw * this.gw;
    this.gScore = new Float32Array(n);
    this.came = new Int32Array(n);
    this.stamp = new Uint32Array(n);
    this.closed = new Uint32Array(n);
    this.searchId = 0;
    this.heap = new MinHeap();
  }

  mirror(p) { return { x: this.size - p.x, y: this.size - p.y }; }

  buildLayout() {
    const P = arr => arr.map(([x, y]) => ({ x, y }));
    const top = P([[800, 4400], [500, 3000], [500, 1000], [700, 700], [1000, 500], [3000, 500], [4400, 800]]);
    const mid = P([[1300, 4700], [3000, 3000], [4700, 1300]]);
    const bot = top.map(p => this.mirror(p)).reverse();
    // Линии в направлении от базы Света к базе Тьмы.
    this.lanes = { top, mid, bot };
    this.laneNames = { top: 'Верхняя', mid: 'Центральная', bot: 'Нижняя' };
    this.river = P([[-80, -80], [600, 650], [1500, 1400], [2300, 2500], [3000, 3000], [3700, 3500], [4500, 4600], [5400, 5350], [6080, 6080]]);
    this.bases = [
      { ancient: { x: 900, y: 5100 }, fountain: { x: 330, y: 5670 } },
      { ancient: { x: 5100, y: 900 }, fountain: { x: 5670, y: 330 } },
    ];
    const campsR = [
      { x: 2000, y: 3000, type: 'medium' },
      { x: 3300, y: 4100, type: 'large' },
      { x: 2500, y: 4850, type: 'small' },
      { x: 1300, y: 2200, type: 'small' },
    ];
    this.camps = campsR.concat(campsR.map(c => ({ ...this.mirror(c), type: c.type })));
    this.bossPit = { x: 1900, y: 1950 };
    const pathsR = [
      P([[1200, 4300], [1600, 3600], [2000, 3000], [2350, 2450]]),
      P([[2000, 3000], [1300, 2200], [500, 1900]]),
      P([[1300, 2200], [1200, 1250]]),
      P([[2000, 3000], [2700, 3300]]),
      P([[2900, 3100], [3300, 4100], [3900, 3800]]),
      P([[3300, 4100], [2500, 4850], [2400, 5400]]),
      P([[2500, 4850], [1500, 4800]]),
      P([[3300, 4100], [4300, 5450]]),
    ];
    this.paths = pathsR.concat(pathsR.map(p => p.map(q => this.mirror(q))));
  }

  generateTrees() {
    const S = this.size, rng = this.rng;
    const noise = makeNoise(this.seed + 7);
    const trees = [];
    const lanes = [this.lanes.top, this.lanes.mid, this.lanes.bot];
    const step = 82;
    const ok = (x, y) => {
      for (const l of lanes) if (distToPolyline(x, y, l) < 235) return false;
      if (distToPolyline(x, y, this.river) < 205) return false;
      for (const p of this.paths) if (distToPolyline(x, y, p) < 115) return false;
      for (const b of this.bases) {
        if (dist(x, y, b.ancient.x, b.ancient.y) < 980) return false;
        if (dist(x, y, b.fountain.x, b.fountain.y) < 820) return false;
      }
      for (const c of this.camps) if (dist(x, y, c.x, c.y) < 270) return false;
      if (dist(x, y, this.bossPit.x, this.bossPit.y) < 340) return false;
      const bm = this.mirror(this.bossPit);
      if (dist(x, y, bm.x, bm.y) < 340) return false;
      return true;
    };
    for (let gy = 0; gy <= S; gy += step) {
      for (let gx = 0; gx <= S; gx += step) {
        const x = gx + (rng() - 0.5) * step * 0.85;
        const y = gy + (rng() - 0.5) * step * 0.85;
        const r = 27 + rng() * 17;
        const roll = rng();
        // генерируем половину Света, вторую половину отражаем — карта симметрична
        if (y <= x) continue;
        if (x < -20 || y < -20 || x > S + 20 || y > S + 20) continue;
        const edge = Math.min(x, y, S - x, S - y);
        let place = false;
        if (edge < 150) place = ok(x, y) || edge < 60;
        else if (ok(x, y)) {
          const n = noise(x / 650, y / 650);
          place = roll < (n - 0.33) * 3.2;
        }
        if (!place) continue;
        trees.push({ x, y, r, v: Math.floor(rng() * 4) });
        trees.push({ x: S - x, y: S - y, r, v: Math.floor(rng() * 4) });
      }
    }
    this.trees = trees;
  }

  buildGrid() {
    const gw = this.gw, g = this.grid;
    for (const t of this.trees) this.blockCircle(t.x, t.y, t.r + 6, 1);
    // границы мира
    for (let i = 0; i < gw; i++) {
      g[i] = 1; g[(gw - 1) * gw + i] = 1; g[i * gw] = 1; g[i * gw + gw - 1] = 1;
    }
  }

  blockCircle(x, y, r, val) {
    const c = this.cell, gw = this.gw;
    const x0 = Math.max(0, Math.floor((x - r) / c)), x1 = Math.min(gw - 1, Math.floor((x + r) / c));
    const y0 = Math.max(0, Math.floor((y - r) / c)), y1 = Math.min(gw - 1, Math.floor((y + r) / c));
    for (let j = y0; j <= y1; j++) {
      for (let i = x0; i <= x1; i++) {
        const cx = (i + 0.5) * c, cy = (j + 0.5) * c;
        if (distSq(cx, cy, x, y) <= r * r) this.grid[j * gw + i] = val;
      }
    }
  }

  // Закрываем недостижимые карманы, чтобы поиск пути не тратил время впустую.
  sealPockets(fromX, fromY) {
    const gw = this.gw, g = this.grid, n = gw * gw;
    const seen = new Uint8Array(n);
    const start = this.cellIndex(fromX, fromY);
    const q = [start];
    seen[start] = 1;
    while (q.length) {
      const k = q.pop();
      const i = k % gw, j = (k - i) / gw;
      const nb = [[1, 0], [-1, 0], [0, 1], [0, -1]];
      for (const [dx, dy] of nb) {
        const ni = i + dx, nj = j + dy;
        if (ni < 0 || nj < 0 || ni >= gw || nj >= gw) continue;
        const nk = nj * gw + ni;
        if (seen[nk] || g[nk]) continue;
        seen[nk] = 1;
        q.push(nk);
      }
    }
    for (let k = 0; k < n; k++) if (!g[k] && !seen[k]) g[k] = 2;
  }

  cellIndex(x, y) {
    const gw = this.gw;
    const i = clamp(Math.floor(x / this.cell), 0, gw - 1);
    const j = clamp(Math.floor(y / this.cell), 0, gw - 1);
    return j * gw + i;
  }
  blocked(x, y) {
    if (x < 0 || y < 0 || x >= this.size || y >= this.size) return true;
    return this.grid[this.cellIndex(x, y)] !== 0;
  }
  cellCenter(k) {
    const i = k % this.gw, j = (k - i) / this.gw;
    return { x: (i + 0.5) * this.cell, y: (j + 0.5) * this.cell };
  }

  los(x0, y0, x1, y1) {
    const d = dist(x0, y0, x1, y1);
    const steps = Math.ceil(d / (this.cell * 0.4));
    for (let s = 1; s <= steps; s++) {
      const t = s / steps;
      if (this.blocked(x0 + (x1 - x0) * t, y0 + (y1 - y0) * t)) return false;
    }
    return true;
  }

  nearestFreeCell(k) {
    const gw = this.gw, g = this.grid;
    if (!g[k]) return k;
    const ci = k % gw, cj = (k - ci) / gw;
    for (let r = 1; r < 20; r++) {
      let best = -1, bd = Infinity;
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          const i = ci + di, j = cj + dj;
          if (i < 0 || j < 0 || i >= gw || j >= gw) continue;
          const kk = j * gw + i;
          if (g[kk]) continue;
          const dd = di * di + dj * dj;
          if (dd < bd) { bd = dd; best = kk; }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }

  nearestFree(x, y) {
    if (!this.blocked(x, y)) return { x, y };
    const k = this.nearestFreeCell(this.cellIndex(x, y));
    return k >= 0 ? this.cellCenter(k) : { x, y };
  }

  // A* по сетке с октильной эвристикой; возвращает сглаженный список точек.
  findPath(sx, sy, tx, ty) {
    const gw = this.gw, g = this.grid;
    let s = this.nearestFreeCell(this.cellIndex(sx, sy));
    let goal = this.cellIndex(tx, ty);
    let gx = tx, gy = ty;
    if (g[goal]) {
      goal = this.nearestFreeCell(goal);
      if (goal < 0) return null;
      const c = this.cellCenter(goal); gx = c.x; gy = c.y;
    }
    if (s < 0) return null;
    if (s === goal) return [{ x: gx, y: gy }];
    const id = ++this.searchId;
    const gS = this.gScore, came = this.came, stamp = this.stamp, closed = this.closed, heap = this.heap;
    heap.clear();
    const gi = goal % gw, gj = (goal - gi) / gw;
    const h = k => {
      const i = k % gw, j = (k - i) / gw;
      const dx = Math.abs(i - gi), dy = Math.abs(j - gj);
      return (dx + dy) + (Math.SQRT2 - 2) * Math.min(dx, dy);
    };
    stamp[s] = id; gS[s] = 0; came[s] = -1;
    heap.push(s, h(s));
    let found = false, expansions = 0;
    const DIRS = [[1, 0, 1], [-1, 0, 1], [0, 1, 1], [0, -1, 1], [1, 1, Math.SQRT2], [1, -1, Math.SQRT2], [-1, 1, Math.SQRT2], [-1, -1, Math.SQRT2]];
    while (heap.size) {
      const k = heap.pop();
      if (closed[k] === id) continue;
      closed[k] = id;
      if (k === goal) { found = true; break; }
      if (++expansions > 9000) break;
      const i = k % gw, j = (k - i) / gw;
      for (const [dx, dy, cost] of DIRS) {
        const ni = i + dx, nj = j + dy;
        if (ni < 0 || nj < 0 || ni >= gw || nj >= gw) continue;
        const nk = nj * gw + ni;
        if (g[nk] || closed[nk] === id) continue;
        if (dx && dy && (g[j * gw + ni] || g[nj * gw + i])) continue; // без срезания углов
        const ng = gS[k] + cost;
        if (stamp[nk] !== id || ng < gS[nk]) {
          stamp[nk] = id; gS[nk] = ng; came[nk] = k;
          heap.push(nk, ng + h(nk));
        }
      }
    }
    if (!found) return null;
    const cells = [];
    for (let k = goal; k !== -1; k = came[k]) cells.push(k);
    cells.reverse();
    const pts = cells.map(k => this.cellCenter(k));
    pts[pts.length - 1] = { x: gx, y: gy };
    // сглаживание «натягиванием нити»
    const out = [];
    let ax = sx, ay = sy;
    for (let i = 1; i < pts.length; i++) {
      if (!this.los(ax, ay, pts[i].x, pts[i].y)) {
        const p = pts[i - 1];
        out.push(p);
        ax = p.x; ay = p.y;
      }
    }
    out.push(pts[pts.length - 1]);
    return out;
  }
}
