'use strict';
// Отрисовка карты в стиле пергамента. Местность заранее рисуется кусками и кешируется.

const TP = 32;     // пикселей на клетку в запечённом куске
const CH = 16;     // клеток в куске
const TERRAIN_COLORS = ['#3b6d82', '#5c93a3', '#dcc58e', '#b5bb73', '#93a75f', '#bda877', '#a6997f', '#e4e1d8'];

function tileHash(i, salt) {
  let h = (i * 2654435761 + salt * 97531) >>> 0;
  h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13;
  return (h >>> 0) / 4294967296;
}
function shade(hex, f) {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp(Math.round(((n >> 16) & 255) * f), 0, 255);
  const g = clamp(Math.round(((n >> 8) & 255) * f), 0, 255);
  const b = clamp(Math.round((n & 255) * f), 0, 255);
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}
function hexA(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cam = { x: 40, y: 40, z: 30 };
    this.chunks = new Map();
    this.time = 0;
    this.particles = [];
    this.selected = null;
    this.plateCache = new Map();
    this.hl = null;          // Set id дивизий, выбранных рамкой или армией целиком (подсветка плашек)
    this.hover = null;
    this.marker = null;
    this.resize();
  }

  setGame(g) {
    this.g = g;
    this.chunks.clear();
    const w = g.world;
    this.baseImg = this.buildBaseImage();
    this.riverLines = w.rivers.map((r, k) => this.meander(r, k));
    this.coast = this.contour((x, y) => w.inside(x, y) && w.terrain[w.idx(x, y)] > T.SHALLOW, 0, 0, w.W, w.H);
    this.layers = {};
    for (const name of ['territory', 'fog', 'snow', 'autumn']) {
      const cv = document.createElement('canvas');
      cv.width = w.W; cv.height = w.H;
      this.layers[name] = cv;
    }
    this.buildSeasonMasks();
    this.terrKey = '';
    this.fogKey = -1;
    this.mmBase = null;
    this.particles.length = 0;
    this.glide = null;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.w = this.canvas.clientWidth || window.innerWidth;
    this.h = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
  }

  toScreen(x, y) {
    const c = this.cam;
    return { x: (x - c.x) * c.z + this.w / 2, y: (y - c.y) * c.z + this.h / 2 };
  }
  toWorld(sx, sy) {
    const c = this.cam;
    return { x: (sx - this.w / 2) / c.z + c.x, y: (sy - this.h / 2) / c.z + c.y };
  }
  // плавно подвести камеру к точке (например, чтобы выбранный город не прятался под панелью)
  glideTo(x, y) { this.glide = { x, y, t: 0.35 }; }
  clampCam() {
    const w = this.g.world, c = this.cam;
    c.z = clamp(c.z, this.minZoom(), 72);
    const hw = this.w / 2 / c.z, hh = this.h / 2 / c.z;
    c.x = w.W <= hw * 2 ? w.W / 2 : clamp(c.x, hw - 2, w.W - hw + 2);
    c.y = w.H <= hh * 2 ? w.H / 2 : clamp(c.y, hh - 2, w.H - hh + 2);
  }
  minZoom() {
    const w = this.g.world;
    return Math.max(6, Math.min(this.w / w.W, this.h / w.H) * 0.95);
  }

  // ---------- запекание местности ----------
  terrainColor(t, i) {
    return shade(TERRAIN_COLORS[t], 0.97 + tileHash(i, 1) * 0.06);
  }

  // Картинка суши 1 пиксель = 1 клетка (при увеличении сглаживается в мягкую заливку); заодно WorldArt
  // готовит картинку воды с глубинами и прочие заготовки мира.
  buildBaseImage() {
    return WorldArt.prepareWorld(this);
  }

  // Изолиния двоичного поля по центрам клеток (марширующие квадраты). Отрезки сшиваются в цепочки
  // и скругляются срезанием углов (Чайкин), чтобы берега и границы были плавными, без ступенек.
  contour(inside, x0, y0, x1, y1) {
    const segs = [];
    for (let y = y0 - 1; y < y1; y++) {
      for (let x = x0 - 1; x < x1; x++) {
        const a = inside(x, y) ? 1 : 0, b = inside(x + 1, y) ? 1 : 0;
        const c = inside(x + 1, y + 1) ? 1 : 0, d = inside(x, y + 1) ? 1 : 0;
        const code = a * 8 + b * 4 + c * 2 + d;
        if (code === 0 || code === 15) continue;
        // точки на серединах рёбер, в удвоенных целых координатах
        const X = 2 * x + 1, Y = 2 * y + 1;
        const T_ = [X + 1, Y], R_ = [X + 2, Y + 1], B_ = [X + 1, Y + 2], L_ = [X, Y + 1];
        const seg = (u, v) => segs.push(u, v);
        switch (code) {
          case 1: case 14: seg(L_, B_); break;
          case 2: case 13: seg(B_, R_); break;
          case 3: case 12: seg(L_, R_); break;
          case 4: case 11: seg(T_, R_); break;
          case 5: seg(L_, T_); seg(B_, R_); break;
          case 6: case 9: seg(T_, B_); break;
          case 7: case 8: seg(L_, T_); break;
          case 10: seg(T_, R_); seg(L_, B_); break;
        }
      }
    }
    // сшивание: у каждой точки не больше двух отрезков
    const key = q => q[0] * 65536 + q[1];
    const at = new Map();
    const ns = segs.length / 2;
    for (let i = 0; i < segs.length; i++) {
      const k = key(segs[i]);
      const l = at.get(k);
      if (l) l.push(i); else at.set(k, [i]);
    }
    const used = new Uint8Array(ns);
    const p = new Path2D();
    const next = (pt, from) => {
      for (const j of at.get(key(pt))) {
        const s2 = j >> 1;
        if (s2 !== from && !used[s2]) return j;
      }
      return -1;
    };
    for (let s0 = 0; s0 < ns; s0++) {
      if (used[s0]) continue;
      used[s0] = 1;
      const pts = [segs[2 * s0], segs[2 * s0 + 1]];
      // вперёд от второго конца
      let cur = s0, j;
      while ((j = next(pts[pts.length - 1], cur)) >= 0) {
        cur = j >> 1; used[cur] = 1;
        pts.push(segs[j ^ 1]);
      }
      // назад от первого конца (если цепочка не замкнулась)
      const closed = key(pts[0]) === key(pts[pts.length - 1]);
      if (!closed) {
        cur = s0;
        while ((j = next(pts[0], cur)) >= 0) {
          cur = j >> 1; used[cur] = 1;
          pts.unshift(segs[j ^ 1]);
        }
      }
      this.smoothPath(p, pts, closed);
    }
    return p;
  }
  smoothPath(p, pts, closed) {
    let q = pts.map(v => [v[0] / 2, v[1] / 2]);
    if (closed) q.pop();
    for (let it = 0; it < 2 && q.length > 2; it++) {
      const r = [], n = q.length;
      if (!closed) r.push(q[0]);
      for (let i = 0; i < (closed ? n : n - 1); i++) {
        const a = q[i], b = q[(i + 1) % n];
        r.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
      }
      if (!closed) r.push(q[n - 1]);
      q = r;
    }
    p.moveTo(q[0][0], q[0][1]);
    for (let i = 1; i < q.length; i++) p.lineTo(q[i][0], q[i][1]);
    if (closed) p.closePath();
  }

  // Кусок местности CH×CH клеток при tp пикселях на клетку: вода, суша, реки, дороги, леса, горы (js/art-world.js).
  bakeChunk(cx, cy, tp) {
    return WorldArt.bakeTerrain(this, cx, cy, tp || TP);
  }

  // Реки текут по клеткам и выходят прямыми; для рисунка слегка изгибаем их поперёк течения (в пределах клетки).
  meander(pts, seed) {
    const n = pts.length;
    const h = k => tileHash(seed * 977 + k, 77) - 0.5;
    const nz = t => { const i = Math.floor(t), f = t - i, s = f * f * (3 - 2 * f); return h(i) * (1 - s) + h(i + 1) * s; };
    return pts.map((p, k) => {
      if (k === 0 || k === n - 1) return p;
      const a = pts[k - 1], b = pts[k + 1];
      const dx = b.x - a.x, dy = b.y - a.y, L = Math.hypot(dx, dy) || 1;
      const amp = 0.64 * nz(k * 0.45);
      return { x: p.x - dy / L * amp, y: p.y + dx / L * amp };
    });
  }
  smoothLine(c, pts, width, color) {
    if (pts.length < 2) return;
    c.strokeStyle = color;
    c.lineWidth = width;
    c.beginPath();
    c.moveTo(pts[0].x, pts[0].y);
    for (let k = 1; k < pts.length - 1; k++) {
      const mx = (pts[k].x + pts[k + 1].x) / 2, my = (pts[k].y + pts[k + 1].y) / 2;
      c.quadraticCurveTo(pts[k].x, pts[k].y, mx, my);
    }
    const last = pts[pts.length - 1];
    c.lineTo(last.x, last.y);
    c.stroke();
  }

  // Два разрешения кусков: 32 px на клетку издалека и 64 px вблизи на плотных экранах.
  // Пока нужный кусок не запечён, показываем кусок другого разрешения, если он есть.
  getChunk(cx, cy, budget) {
    const tp = this.cam.z * this.dpr > 44 ? TP * 2 : TP;
    const key = cx + ',' + cy + ',' + tp;
    let ch = this.chunks.get(key);
    if (ch) { ch.used = this.frame; return ch.cv; }
    if (budget.n <= 0) {
      const alt = this.chunks.get(cx + ',' + cy + ',' + (tp === TP ? TP * 2 : TP));
      if (alt) { alt.used = this.frame; return alt.cv; }
      return null;
    }
    budget.n--;
    ch = { cv: this.bakeChunk(cx, cy, tp), used: this.frame, cost: tp === TP ? 1 : 4 };
    this.chunks.set(key, ch);
    // память: кусок 64 px весит как четыре по 32 px
    let total = 0;
    for (const v of this.chunks.values()) total += v.cost || 1;
    while (total > 72) {
      let oldK = null, oldT = Infinity;
      for (const [k, v] of this.chunks) if (v.used < oldT && v.used < this.frame) { oldT = v.used; oldK = k; }
      if (oldK === null) break;
      total -= this.chunks.get(oldK).cost || 1;
      this.chunks.delete(oldK);
    }
    return ch.cv;
  }

  // ---------- слои низкого разрешения ----------
  buildSeasonMasks() {
    const w = this.g.world;
    for (const [name, rgb, a] of [['snow', [245, 248, 255], 150], ['autumn', [205, 120, 40], 60]]) {
      const cv = this.layers[name];
      const c = cv.getContext('2d');
      const img = c.createImageData(w.W, w.H);
      for (let i = 0; i < w.W * w.H; i++) {
        if (w.terrain[i] <= T.SHALLOW) continue;
        img.data[i * 4] = rgb[0]; img.data[i * 4 + 1] = rgb[1]; img.data[i * 4 + 2] = rgb[2]; img.data[i * 4 + 3] = a;
      }
      c.putImageData(img, 0, 0);
    }
  }

  kingdomOfTile(i) {
    const cid = this.g.world.cityOf[i];
    if (cid < 0) return null;
    const c = this.g.city(cid);
    return c ? c.owner : null;
  }

  // Слой земель (1 пиксель = 1 клетка, при увеличении сглаживается): цвет державы, насыщенный у города
  // и гаснущий к краю по силе влияния world.infl; у самой границы — полоса погуще, чтобы край читался.
  // Вольные земли бледнее. Плюс изолинии владений каждой державы для контуров (drawBorders): их и
  // миникарту пересобираем, только если сдвинулись границы держав, а не одних городов внутри державы.
  rebuildTerritory() {
    const g = this.g, w = g.world, W = w.W, H = w.H, n = W * H;
    const NONE = -99;
    const cv = this.layers.territory, c = cv.getContext('2d');
    const img = c.createImageData(W, H), px = img.data;
    if (!this.terrOwn || this.terrOwn.length !== n || this.terrW !== W) { this.terrOwn = new Int32Array(n); this.terrW = W; this.borders = null; }
    const own = this.terrOwn, infl = w.infl;
    const kOf = new Map(g.cities.map(q => [q.id, q.owner]));
    let same = !!this.borders;
    for (let i = 0; i < n; i++) {
      const cid = w.cityOf[i];
      const ko = cid < 0 ? undefined : kOf.get(cid);
      const k = ko === undefined ? NONE : ko;
      if (own[i] !== k) { own[i] = k; same = false; }
    }
    // цвет и прозрачность по силе влияния (таблица на 64 ступени): держава и вольный город
    if (!this.terrAlpha) {
      const A = this.terrAlpha = new Uint8Array(130);
      for (let q = 0; q <= 64; q++) {
        const f = Math.pow(q / 64, 1.2);
        A[q] = Math.round((0.1 + 0.42 * f) * 255);
        A[65 + q] = Math.round((0.05 + 0.2 * f) * 255);
      }
    }
    const A = this.terrAlpha, rimK = Math.round(0.2 * 255), rimF = Math.round(0.09 * 255);
    const colors = new Map(g.kingdoms.map(k => [k.id, parseInt(k.color.slice(1), 16)]));
    colors.set(-1, parseInt(NEUTRAL_COLOR.slice(1), 16));
    for (let i = 0; i < n; i++) {
      const k = own[i];
      if (k === NONE) continue;
      const x = i % W;
      const rim = (x > 0 && own[i - 1] !== k) || (x < W - 1 && own[i + 1] !== k) || (i >= W && own[i - W] !== k) || (i + W < n && own[i + W] !== k);
      const q = infl ? Math.round(infl[i] * 64) : 64;
      const a = k === -1 ? Math.max(A[65 + q], rim ? rimF : 0) : Math.max(A[q], rim ? rimK : 0);
      const col = colors.get(k), o = i * 4;
      px[o] = (col >> 16) & 255; px[o + 1] = (col >> 8) & 255; px[o + 2] = col & 255; px[o + 3] = a;
    }
    c.putImageData(img, 0, 0);
    if (same) return;
    this.borders = this.territoryPaths(own, W, H, NONE);
    this.mmBase = null;
  }

  // Изолинии владений всех держав за один проход марширующих квадратов (как contour, но сразу для всех).
  // Отрезки в удвоенных координатах сшиваются в цепочки, а цепочки готовятся к отрисовке (borderChain).
  // Итог: Map держава → { box, chains }.
  territoryPaths(own, W, H, NONE) {
    const segs = new Map();
    const at = (x, y) => (x < 0 || y < 0 || x >= W || y >= H ? NONE : own[y * W + x]);
    const ks = [0, 0, 0, 0];
    for (let y = -1; y < H; y++) {
      for (let x = -1; x < W; x++) {
        const a = at(x, y), b = at(x + 1, y), c = at(x + 1, y + 1), d = at(x, y + 1);
        if (a === b && b === c && c === d) continue;
        ks[0] = a; ks[1] = b; ks[2] = c; ks[3] = d;
        const X = 2 * x + 1, Y = 2 * y + 1;
        for (let m = 0; m < 4; m++) {
          const k = ks[m];
          if (k === NONE || ks.indexOf(k) !== m) continue;
          const code = (a === k ? 8 : 0) + (b === k ? 4 : 0) + (c === k ? 2 : 0) + (d === k ? 1 : 0);
          let s = segs.get(k);
          if (!s) segs.set(k, (s = []));
          // точки на серединах рёбер: верх (X+1,Y), право (X+2,Y+1), низ (X+1,Y+2), лево (X,Y+1)
          switch (code) {
            case 1: case 14: s.push(X, Y + 1, X + 1, Y + 2); break;
            case 2: case 13: s.push(X + 1, Y + 2, X + 2, Y + 1); break;
            case 3: case 12: s.push(X, Y + 1, X + 2, Y + 1); break;
            case 4: case 11: s.push(X + 1, Y, X + 2, Y + 1); break;
            case 5: s.push(X, Y + 1, X + 1, Y, X + 1, Y + 2, X + 2, Y + 1); break;
            case 6: case 9: s.push(X + 1, Y, X + 1, Y + 2); break;
            case 7: case 8: s.push(X, Y + 1, X + 1, Y); break;
            case 10: s.push(X + 1, Y, X + 2, Y + 1, X, Y + 1, X + 1, Y + 2); break;
          }
        }
      }
    }
    const out = new Map();
    const key = (px, py) => (py + 4) * 65536 + px + 4;
    for (const [k, s] of segs) {
      const ns = s.length / 4;
      // у каждой точки не больше двух отрезков: ends[2t], ends[2t+1] — концы (номер отрезка × 2 + конец)
      const slot = new Map();
      const ends = new Int32Array(ns * 4).fill(-1);
      for (let e = 0; e < ns * 2; e++) {
        const kk = key(s[e * 2], s[e * 2 + 1]);
        let t = slot.get(kk);
        if (t === undefined) { t = slot.size; slot.set(kk, t); }
        if (ends[t * 2] < 0) ends[t * 2] = e; else ends[t * 2 + 1] = e;
      }
      const used = new Uint8Array(ns);
      const other = e => {
        const t = slot.get(key(s[e * 2], s[e * 2 + 1]));
        const f = ends[t * 2] === e ? ends[t * 2 + 1] : ends[t * 2];
        return f >= 0 && !used[f >> 1] ? f : -1;
      };
      const chains = [], box = [Infinity, Infinity, -Infinity, -Infinity];
      for (let s0 = 0; s0 < ns; s0++) {
        if (used[s0]) continue;
        used[s0] = 1;
        const pts = [[s[s0 * 4], s[s0 * 4 + 1]], [s[s0 * 4 + 2], s[s0 * 4 + 3]]];
        let e = s0 * 2 + 1, f;
        while ((f = other(e)) >= 0) {
          used[f >> 1] = 1;
          e = f ^ 1;
          pts.push([s[e * 2], s[e * 2 + 1]]);
        }
        const closed = pts.length > 2 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1];
        if (!closed) {
          e = s0 * 2;
          while ((f = other(e)) >= 0) {
            used[f >> 1] = 1;
            e = f ^ 1;
            pts.unshift([s[e * 2], s[e * 2 + 1]]);
          }
        }
        // с какой стороны цепочки свои земли: шаг в полклетки вбок от середины первого отрезка
        const p0 = pts[0], p1 = pts[1];
        const dx = p1[0] - p0[0], dy = p1[1] - p0[1], l = Math.sqrt(dx * dx + dy * dy);
        const side = at(Math.floor((p0[0] + p1[0]) / 4 + dy / l * 0.5), Math.floor((p0[1] + p1[1]) / 4 - dx / l * 0.5)) === k ? 1 : -1;
        const ch = this.borderChain(pts, closed, side);
        chains.push(ch);
        box[0] = Math.min(box[0], ch.box[0]); box[1] = Math.min(box[1], ch.box[1]);
        box[2] = Math.max(box[2], ch.box[2]); box[3] = Math.max(box[3], ch.box[3]);
      }
      out.set(k, { box, chains });
    }
    return out;
  }

  // Цепочка границы для отрисовки: сглаженные (как smoothPath) точки в клетках, у каждой — нормаль
  // внутрь своих земель (по ней кладётся кайма) и рамки кусков по K точек, чтобы рисовать только видимое.
  // Замкнутая цепочка повторяет первую точку в конце.
  borderChain(pts, closed, side) {
    const K = 24;
    let q = pts.map(v => [v[0] / 2, v[1] / 2]);
    if (closed) q.pop();
    for (let it = 0; it < 2 && q.length > 2; it++) {
      const r = [], n = q.length;
      if (!closed) r.push(q[0]);
      for (let i = 0; i < (closed ? n : n - 1); i++) {
        const a = q[i], b = q[(i + 1) % n];
        r.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75]);
      }
      if (!closed) r.push(q[n - 1]);
      q = r;
    }
    const n = q.length, m = closed ? n + 1 : n;
    const P = new Float32Array(m * 2), N = new Float32Array(m * 2);
    for (let i = 0; i < m; i++) {
      const a = q[i % n];
      const pv = closed ? q[(i + n - 1) % n] : q[Math.max(0, i - 1)];
      const nx = closed ? q[(i + 1) % n] : q[Math.min(n - 1, i + 1)];
      const tx = nx[0] - pv[0], ty = nx[1] - pv[1], l = Math.sqrt(tx * tx + ty * ty) || 1;
      P[i * 2] = a[0]; P[i * 2 + 1] = a[1];
      N[i * 2] = side * ty / l; N[i * 2 + 1] = -side * tx / l;
    }
    const np = Math.max(1, Math.ceil((m - 1) / K));
    const B = new Float32Array(np * 4), box = [Infinity, Infinity, -Infinity, -Infinity];
    for (let pc = 0; pc < np; pc++) {
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (let i = pc * K, e = Math.min(m - 1, i + K); i <= e; i++) {
        const x = P[i * 2], y = P[i * 2 + 1];
        if (x < x0) x0 = x; if (x > x1) x1 = x;
        if (y < y0) y0 = y; if (y > y1) y1 = y;
      }
      B[pc * 4] = x0; B[pc * 4 + 1] = y0; B[pc * 4 + 2] = x1; B[pc * 4 + 3] = y1;
      box[0] = Math.min(box[0], x0); box[1] = Math.min(box[1], y0); box[2] = Math.max(box[2], x1); box[3] = Math.max(box[3], y1);
    }
    return { pts: P, nrm: N, boxes: B, box, piece: K };
  }

  // Вершины цепочки в путь p: только куски в рамке [x0,y0]–[x1,y1] (whole — всю цепочку целиком),
  // каждая точка сдвинута на d клеток по нормали внутрь, при мелком масштабе берётся каждая s-я точка.
  // Соседние видимые куски идут одной линией, без стыков.
  emitBorder(p, ch, d, s, x0, y0, x1, y1, whole) {
    const P = ch.pts, N = ch.nrm, B = ch.boxes, K = ch.piece, last = P.length / 2 - 1;
    let open = false;
    for (let pc = 0, a = 0; a < last; pc++, a += K) {
      const b = Math.min(a + K, last), o = pc * 4;
      if (!whole && (B[o] > x1 || B[o + 2] < x0 || B[o + 1] > y1 || B[o + 3] < y0)) { open = false; continue; }
      for (let i = open ? Math.min(a + s, b) : a; ; i = Math.min(i + s, b)) {
        const x = P[i * 2] + N[i * 2] * d, y = P[i * 2 + 1] + N[i * 2 + 1] * d;
        if (open) p.lineTo(x, y); else { p.moveTo(x, y); open = true; }
        if (i === b) break;
      }
    }
  }

  rebuildFog() {
    const g = this.g, w = g.world, W = w.W, H = w.H, n = W * H;
    if (!this.fogU || this.fogU.length !== n) { this.fogU = new Float32Array(n); this.fogD = new Float32Array(n); this.fogT = new Float32Array(n); }
    const U = this.fogU, D = this.fogD;
    for (let i = 0; i < n; i++) {
      U[i] = g.explored[i] ? 0 : 1;
      D[i] = g.explored[i] && !g.visible[i] ? 1 : 0;
    }
    this.blur(U, W, H); this.blur(U, W, H);
    this.blur(D, W, H);
    const c = this.layers.fog.getContext('2d');
    const img = c.createImageData(W, H);
    const d = img.data;
    for (let i = 0; i < n; i++) {
      const u = U[i], dk = D[i] * 0.3 * (1 - u);
      const a = u + dk;
      if (a <= 0.003) continue;
      d[i * 4] = (222 * u + 40 * dk) / a; d[i * 4 + 1] = (204 * u + 30 * dk) / a; d[i * 4 + 2] = (160 * u + 20 * dk) / a;
      d[i * 4 + 3] = Math.min(255, a * 255);
    }
    c.putImageData(img, 0, 0);
  }
  // размытие 3×3 для мягкого края тумана
  blur(f, W, H) {
    const t = this.fogT;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      let s = 0, k = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= H) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= W) continue;
          s += f[yy * W + xx]; k++;
        }
      }
      t[y * W + x] = s / k;
    }
    f.set(t);
  }

  // ---------- кадр ----------
  render(dt) {
    const g = this.g, ctx = this.ctx, cam = this.cam, dpr = this.dpr;
    if (!g) return;
    this.time += dt;
    this.frame = (this.frame || 0) + 1;
    if (this.glide) {
      const gl = this.glide, k = Math.min(1, dt * 12);
      cam.x += (gl.x - cam.x) * k; cam.y += (gl.y - cam.y) * k;
      this.clampCam();
      gl.t -= dt;
      if (gl.t <= 0) this.glide = null;
    }
    const terrKey = g.territoryVersion + ':' + g.ownershipVersion + ':' + g.cities.length;
    if (terrKey !== this.terrKey) { this.terrKey = terrKey; this.rebuildTerritory(); }
    const fogKey = Math.floor(g.time * 2) + ':' + (g.exploredVersion || 0);
    if (fogKey !== this.fogKey) { this.fogKey = fogKey; this.rebuildFog(); }
    const z = cam.z;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.fillStyle = '#2f5b6f';
    ctx.fillRect(0, 0, this.w, this.h);
    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * (this.w / 2 - cam.x * z), dpr * (this.h / 2 - cam.y * z));
    const w = g.world;
    const tl = this.toWorld(0, 0), br = this.toWorld(this.w, this.h);
    const cx0 = Math.max(0, Math.floor(tl.x / CH)), cx1 = Math.min(Math.ceil(w.W / CH) - 1, Math.floor(br.x / CH));
    const cy0 = Math.max(0, Math.floor(tl.y / CH)), cy1 = Math.min(Math.ceil(w.H / CH) - 1, Math.floor(br.y / CH));
    const budget = { n: this.frame < 3 ? 99 : 3 };
    ctx.imageSmoothingEnabled = true;
    for (let cy = cy0; cy <= cy1; cy++) for (let cx = cx0; cx <= cx1; cx++) {
      const cv = this.getChunk(cx, cy, budget);
      if (cv) ctx.drawImage(cv, cx * CH, cy * CH, CH + 1 / TP, CH + 1 / TP);
      else { ctx.fillStyle = '#c9b98e'; ctx.fillRect(cx * CH, cy * CH, CH, CH); }
    }
    // сезон
    const season = g.seasonIndex();
    if (season === 3) { ctx.globalAlpha = 0.9; ctx.drawImage(this.layers.snow, 0, 0, w.W, w.H); ctx.globalAlpha = 1; }
    else if (season === 2) ctx.drawImage(this.layers.autumn, 0, 0, w.W, w.H);
    // территории и границы
    ctx.drawImage(this.layers.territory, 0, 0, w.W, w.H);
    this.drawBorders(ctx, z);
    for (const f of RenderExt.map) f(ctx, this, z, tl, br);
    this.drawPaths(ctx, z);
    this.drawCities(ctx, z, tl, br);
    // туман
    ctx.drawImage(this.layers.fog, 0, 0, w.W, w.H);
    this.drawBattles(ctx, z);
    // экранные слои
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawCityLabels(ctx, z, tl, br);
    this.drawArmies(ctx, z, tl, br);
    for (const f of RenderExt.screen) f(ctx, this, z, tl, br, dt);
    this.drawMarker(ctx, dt);
    this.drawParticles(ctx, dt);
    if (season === 3) this.drawSnowfall(ctx, dt);
  }

  // Границы: у каждой державы цветная кайма вдоль края с внутренней стороны (линия, сдвинутая по нормали
  // внутрь, без дорогого clip), поверх — общая чернильная линия. На стыке двух держав видны обе каймы,
  // разделённые чернилом. Вольные — пунктир. Пути собираются каждый кадр только из видимых кусков.
  drawBorders(ctx, z) {
    const B = this.borders;
    if (!B) return;
    const tl = this.toWorld(0, 0), br = this.toWorld(this.w, this.h);
    const ink = Math.max(1.5 / z, 0.035), band = Math.max(3 / z, 0.05);
    const pad = band + ink;
    const x0 = tl.x - pad, y0 = tl.y - pad, x1 = br.x + pad, y1 = br.y + pad;
    const inView = b => !(b[0] > x1 || b[2] < x0 || b[1] > y1 || b[3] < y0);
    const s = z < 12 ? 2 : 1;
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const free = B.get(-1);
    if (free && inView(free.box)) {
      // пунктир (штрих постоянной длины на экране) по каждой цепочке целиком, чтобы штрихи не ползли
      // при сдвиге карты
      const p = new Path2D();
      for (const ch of free.chains) if (inView(ch.box)) this.emitBorder(p, ch, 0, s, x0, y0, x1, y1, true);
      ctx.setLineDash([6 / z, 5 / z]);
      ctx.strokeStyle = 'rgba(80,70,55,0.5)';
      ctx.lineWidth = 1.2 / z;
      ctx.stroke(p);
      ctx.setLineDash([]);
    }
    const line = new Path2D(), d = band / 2 + ink * 0.3;
    for (const [k, t] of B) {
      if (k === -1 || !inView(t.box)) continue;
      const kg = this.g.kingdom(k);
      if (!kg) continue;
      const p = new Path2D();
      for (const ch of t.chains) {
        if (!inView(ch.box)) continue;
        this.emitBorder(p, ch, d, s, x0, y0, x1, y1, false);
        this.emitBorder(line, ch, 0, s, x0, y0, x1, y1, false);
      }
      ctx.strokeStyle = hexA(kg.color, 0.8);
      ctx.lineWidth = band;
      ctx.stroke(p);
    }
    ctx.strokeStyle = 'rgba(42,27,13,0.8)';
    ctx.lineWidth = ink;
    ctx.stroke(line);
  }

  drawPaths(ctx, z) {
    const g = this.g, pl = g.player;
    for (const a of g.armies) {
      if (a.owner !== pl.id || !a.path || a.pathI >= a.path.length) continue;
      const sel = this.selected && this.selected.kind === 'army' && this.selected.id === a.id;
      ctx.strokeStyle = sel ? 'rgba(255,240,190,0.95)' : 'rgba(255,240,190,0.45)';
      ctx.lineWidth = (sel ? 3 : 2) / z;
      ctx.setLineDash([6 / z, 5 / z]);
      ctx.lineDashOffset = -this.time * 20 / z;
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      for (let k = a.pathI; k < a.path.length; k++) ctx.lineTo(a.path[k].x, a.path[k].y);
      ctx.stroke();
      ctx.setLineDash([]);
      const end = a.path[a.path.length - 1];
      if (sel) {
        ctx.strokeStyle = '#ffe9a8'; ctx.lineWidth = 2.5 / z;
        ctx.beginPath(); ctx.arc(end.x, end.y, 0.35, 0, TAU); ctx.stroke();
      }
    }
  }

  cityRadius(c) { return 0.5 + c.level * 0.12; }

  drawCities(ctx, z, tl, br) {
    const g = this.g, list = [];
    for (const c of g.cities) {
      const x = c.x + 0.5, y = c.y + 0.5;
      if (x < tl.x - 3 || x > br.x + 3 || y < tl.y - 3 || y > br.y + 3) continue;
      if (!g.explored[g.cityTile(c)]) continue;
      list.push(c);
    }
    list.sort((p, q) => p.y - q.y || p.x - q.x);
    WorldArt.beginCities(this);
    for (const c of list) this.drawCity(ctx, c, c.x + 0.5, c.y + 0.5);
  }

  // Город — готовый спрайт из WorldArt (дома, стены, башни, окрестности); поверх — живой стяг владельца.
  drawCity(ctx, c, x, y) {
    const g = this.g, z = this.cam.z;
    const k = g.kingdom(c.owner);
    const col = k ? k.color : NEUTRAL_COLOR;
    const s = WorldArt.citySprite(this, c, z * this.dpr);
    ctx.drawImage(s.cv, x + s.x0, y + s.y0, s.w, s.h);
    // стяг
    const f = s.flag, sc = f.s * (z < 14 ? 1.3 : 1);
    const px = x + f.x, py = y + f.y, L = 0.36 * sc, fw = 0.34 * sc, fh = 0.22 * sc;
    ctx.strokeStyle = '#3a2a18'; ctx.lineWidth = Math.max(0.03, 1.4 / z);
    ctx.beginPath(); ctx.moveTo(px, py); ctx.lineTo(px, py - L - fh); ctx.stroke();
    const wave = Math.sin(this.time * 3 + c.id) * 0.03 * sc;
    const fy = py - L - fh;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(px, fy); ctx.quadraticCurveTo(px + fw * 0.5, fy - wave, px + fw, fy + wave);
    ctx.lineTo(px + fw * 0.82, fy + fh * 0.5); ctx.lineTo(px + fw, fy + fh + wave);
    ctx.quadraticCurveTo(px + fw * 0.5, fy + fh - wave, px, fy + fh);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(42,27,13,0.85)'; ctx.lineWidth = Math.max(0.018, 1 / z); ctx.stroke();
    if (k && z >= 14) Icons.draw(ctx, k.sigil, px + fw * 0.42, fy + fh * 0.5, fh * 0.85, '#f6ecd2');
    // осада: дым и огонь
    const R = this.cityRadius(c);
    if (c.siegeBy && Math.random() < 0.3) this.spawn('smoke', x + (Math.random() - 0.5) * R, y - R * 0.3);
    if (c.siegeBy && c.wallHp <= 0 && Math.random() < 0.2) this.spawn('fire', x + (Math.random() - 0.5) * R, y + (Math.random() - 0.5) * R * 0.6);
  }

  // Вблизи сами строи и схватку рисует drawArmies (art-units.js); здесь — павшие под строем и пыль.
  // Вдали сражение отмечено скрещёнными мечами.
  drawBattles(ctx, z) {
    const g = this.g;
    UnitArt.clock(this);
    const near = z >= UnitArt.FORMATION_Z;
    if (near) {
      ctx.save();
      ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
      UnitArt.drawFallen(this, ctx);
      ctx.restore();
    }
    for (const b of g.battles) {
      if (!g.isVisible(b.x, b.y)) continue;
      if (near) {
        if (b.kind === 'field' && Math.random() < 0.12) this.spawn('dust', b.x + (Math.random() - 0.5) * 0.8, b.y + 0.15 + (Math.random() - 0.5) * 0.2);
        continue;
      }
      // участники сражения: нити от места боя к каждой дивизии своего цвета
      const sides = [b.sideA, b.sideB];
      if (b.kind === 'field' && sides[0] && sides[0].length + sides[1].length > 2) {
        ctx.lineWidth = 2 / z;
        for (let si = 0; si < 2; si++) for (const id of sides[si]) {
          const m = g.army(id);
          if (!m) continue;
          const km = g.kingdom(m.owner);
          ctx.strokeStyle = km ? km.color : '#fff'; ctx.globalAlpha = 0.75;
          ctx.beginPath(); ctx.moveTo(b.x, b.y); ctx.lineTo(m.x, m.y); ctx.stroke();
        }
        ctx.globalAlpha = 1;
      }
      const p = 1 + Math.sin(this.time * 8) * 0.08;
      ctx.save();
      ctx.translate(b.x, b.y - (b.kind === 'siege' ? 0.9 : 0.6));
      ctx.scale(p, p);
      ctx.fillStyle = 'rgba(25,15,8,0.65)';
      ctx.beginPath(); ctx.arc(0, 0, 0.36, 0, TAU); ctx.fill();
      Icons.draw(ctx, 'swords', 0, 0, 0.5, '#ffe2a8');
      const members = b.kind === 'field' && b.sideA ? b.sideA.length + b.sideB.length : b.sideA ? b.sideA.length : 0;
      if (members > 2 || (b.kind === 'siege' && members > 1)) {
        ctx.fillStyle = '#c9552f'; ctx.beginPath(); ctx.arc(0.3, 0.26, 0.17, 0, TAU); ctx.fill();
        ctx.fillStyle = '#fff'; ctx.font = '700 0.24px sans-serif'; ctx.textAlign = 'center';
        ctx.fillText(String(members), 0.3, 0.34);
      }
      ctx.restore();
      if (Math.random() < 0.35) this.spawn('dust', b.x + (Math.random() - 0.5) * 1.2, b.y + (Math.random() - 0.5) * 0.8);
    }
    for (const f of g.fx) {
      if (f.type === 'boom' && f.t < 0.05 && g.isVisible(f.x, f.y)) for (let i = 0; i < 14; i++) this.spawn('debris', f.x, f.y);
    }
  }

  drawCityLabels(ctx, z, tl, br) {
    const g = this.g;
    if (z < 11) return;
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    const small = z < 20;
    for (const c of g.cities) {
      const x = c.x + 0.5, y = c.y + 0.5;
      if (x < tl.x - 3 || x > br.x + 3 || y < tl.y - 3 || y > br.y + 3) continue;
      if (!g.explored[g.cityTile(c)]) continue;
      const s = this.toScreen(x, y + this.cityRadius(c) * 0.8 + 0.22);
      const k = g.kingdom(c.owner);
      const name = c.name;
      ctx.font = `700 ${small ? 11 : 13}px "PT Sans Narrow", "Arial Narrow", sans-serif`;
      const tw = ctx.measureText(name).width;
      const sel = this.selected && this.selected.kind === 'city' && this.selected.id === c.id;
      ctx.fillStyle = sel ? 'rgba(255,236,170,0.95)' : 'rgba(244,232,204,0.88)';
      ctx.strokeStyle = k ? k.color : NEUTRAL_COLOR;
      ctx.lineWidth = sel ? 2.5 : 1.5;
      const bw = tw + 14, bh = small ? 15 : 18;
      this.roundRect(ctx, s.x - bw / 2, s.y + 2, bw, bh, 4);
      ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#2a1c0e';
      ctx.fillText(name, s.x, s.y + (small ? 13.5 : 15.5));
      if (!small) {
        const info = (c.level > 1 ? CITY_LEVELS[c.level].name : CITY_LEVELS[1].name) + ' · ' + fmtInt(c.pop);
        ctx.font = '400 11px "PT Sans Narrow", "Arial Narrow", sans-serif';
        ctx.strokeStyle = 'rgba(244,232,204,0.9)'; ctx.lineWidth = 3;
        ctx.strokeText(info, s.x, s.y + 33);
        ctx.fillStyle = '#3a2a18';
        ctx.fillText(info, s.x, s.y + 33);
      }
      if (c.construction && k && k.isPlayer) {
        const hp = this.toScreen(x - this.cityRadius(c) * 0.8, y - this.cityRadius(c) * 0.9);
        ctx.fillStyle = 'rgba(40,25,10,0.8)';
        ctx.beginPath(); ctx.arc(hp.x, hp.y, 10, 0, TAU); ctx.fill();
        Icons.draw(ctx, 'hammer', hp.x, hp.y, 13, '#ffd77a');
        const f = c.construction.t / c.construction.total;
        ctx.strokeStyle = '#ffd77a'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(hp.x, hp.y, 10, -Math.PI / 2, -Math.PI / 2 + f * TAU); ctx.stroke();
      }
      if (c.walls > 0 && c.wallHp < WALLS[c.walls].hp && g.explored[g.cityTile(c)]) {
        const wb = this.toScreen(x, y - this.cityRadius(c) * 0.8 - 1.05);
        const f = c.wallHp / WALLS[c.walls].hp;
        ctx.fillStyle = 'rgba(30,20,10,0.75)'; ctx.fillRect(wb.x - 20, wb.y - 3, 40, 5);
        ctx.fillStyle = f > 0 ? '#c9c2b2' : '#b33'; ctx.fillRect(wb.x - 19, wb.y - 2, 38 * f, 3);
      }
    }
  }

  armyVisible(a) {
    const g = this.g;
    if (a.owner === g.player.id) return true;
    return g.isVisible(a.x, a.y);
  }

  // Размер армии на экране. Вдали это жетон-щит, вблизи — строй фигурок ростом 0.7 этого размера.
  armySize() { return clamp(this.cam.z * 0.85, 20, 44); }

  drawArmies(ctx, z, tl, br) {
    const g = this.g;
    const S = this.armySize();
    const list = g.armies.filter(a => this.armyVisible(a) && a.x > tl.x - 2 && a.x < br.x + 2 && a.y > tl.y - 2 && a.y < br.y + 2);
    list.sort((p, q) => p.y - q.y);
    this.drawnArmies = [];
    // вблизи — строй фигурок с походным шагом и схваткой, над ним плашка дивизии
    if (z >= UnitArt.FORMATION_Z) {
      const undo = this.pairBattles(list);
      try { UnitArt.drawArmies(this, ctx, list); } finally { undo(); }
      for (const d of this.drawnArmies) this.drawPlate(ctx, d.a, d.x, d.y - Math.max(d.r, S * 0.62) - S * 0.42, S, true);
      return;
    }
    const placed = [];
    for (const a of list) {
      let ax = a.x, ay = a.y;
      // стоящая у города армия не закрывает сам город
      if (a.state !== 'move' && a.state !== 'retreat') {
        const c = g.cityAt(a.x, a.y, 0.9);
        if (c) { ax = c.x + 0.5 + this.cityRadius(c) + 0.55; ay = c.y + 0.75; }
      }
      const p = this.toScreen(ax, ay);
      const W = this.plateSize(S).W;
      for (const q of placed) if (Math.abs(q.x - p.x) < W * 0.9 && Math.abs(q.y - p.y) < S * 0.5) p.y = q.y - S * 0.52;
      placed.push({ x: p.x, y: p.y });
      const bob = a.state === 'move' || a.state === 'retreat' ? Math.abs(Math.sin(this.time * 7 + a.id)) * 2.5 : 0;
      const x = p.x, y = p.y - S * 0.45 - bob;
      this.drawnArmies.push({ a, x, y, r: W * 0.5 });
      ctx.fillStyle = 'rgba(30,18,8,0.3)';
      ctx.beginPath(); ctx.ellipse(p.x, p.y, S * 0.5, S * 0.14, 0, 0, TAU); ctx.fill();
      this.drawPlate(ctx, a, x, y, S, false);
    }
  }

  // Плашка дивизии, как в HOI4: значок шаблона на цвете державы, число воинов, полоски численности и организованности.
  // Основа (корпус, значок, рамка) и числа лежат в кэше спрайтов; каждый кадр рисуются только полоски.
  plateSize(S) { return { W: Math.max(54, Math.round(S * 1.9)), H: Math.max(22, Math.round(S * 0.74)) }; }
  plateBase(k, icon, gcol, flag, W, H) {
    const dpr = this.dpr, key = k.color + k.dark + icon + (gcol || '-') + flag + W + 'x' + H + '@' + dpr;
    let e = this.plateCache.get(key);
    if (e) return e;
    if (this.plateCache.size > 360) this.plateCache.clear();
    const pad = 4, cv = document.createElement('canvas');
    cv.width = Math.ceil((W + pad * 2) * dpr); cv.height = Math.ceil((H + pad * 2) * dpr);
    const c = cv.getContext('2d');
    c.scale(dpr, dpr); c.translate(pad, pad);
    c.fillStyle = 'rgba(20,12,5,0.35)';
    this.roundRect(c, 1, 2, W, H, 4); c.fill();
    c.fillStyle = 'rgba(28,17,8,0.93)';
    this.roundRect(c, 0, 0, W, H, 4); c.fill();
    c.save();
    this.roundRect(c, 0, 0, W, H, 4); c.clip();
    c.fillStyle = k.color; c.fillRect(0, 0, H, H);
    c.fillStyle = 'rgba(0,0,0,0.22)'; c.fillRect(H - 3, 0, 3, H);
    if (gcol) { c.fillStyle = gcol; c.fillRect(H, 0, W - H, 2.5); }
    c.restore();
    Icons.draw(c, icon, H / 2, H / 2, H * 0.66, '#fff6dc');
    // рамка: выбранная — золотая, выделенная рамкой — светлая пунктирная, обычная — цвета державы
    c.lineWidth = flag === 1 ? 2.5 : 1.5;
    c.strokeStyle = flag === 1 ? '#ffe28a' : flag === 2 ? '#fff3c8' : k.dark;
    if (flag === 2) c.setLineDash([4, 3]);
    this.roundRect(c, 0, 0, W, H, 4); c.stroke();
    e = { cv, pad, w: cv.width / dpr, h: cv.height / dpr };
    this.plateCache.set(key, e);
    return e;
  }
  plateNum(txt, color, px) {
    const dpr = this.dpr, key = 'n' + txt + color + px + '@' + dpr;
    let e = this.plateCache.get(key);
    if (e) return e;
    const font = '700 ' + px + 'px "PT Sans Narrow", "Arial Narrow", sans-serif';
    const m = this.ctx;
    m.save(); m.font = font; const tw = Math.ceil(m.measureText(txt).width) + 2; m.restore();
    const cv = document.createElement('canvas');
    cv.width = Math.ceil(tw * dpr); cv.height = Math.ceil((px + 3) * dpr);
    const c = cv.getContext('2d');
    c.scale(dpr, dpr); c.font = font; c.textAlign = 'right'; c.fillStyle = color;
    c.fillText(txt, tw - 1, px);
    e = { cv, w: tw, h: px + 3 };
    this.plateCache.set(key, e);
    return e;
  }
  drawPlate(ctx, a, cx, cy, S, near) {
    const g = this.g, k = g.kingdom(a.owner), t = Fronts.tpl(g, a.owner, a.tpl);
    const { W, H } = this.plateSize(S), x = Math.round(cx - W / 2), y = Math.round(cy - H / 2), dpr = this.dpr;
    const sel = this.selected && this.selected.kind === 'army' && this.selected.id === a.id;
    const flag = sel ? 1 : this.hl && this.hl.has(a.id) ? 2 : 0;
    const men = menCount(a.units), full = Math.max(men, t ? menCount(t.units) : men);
    const org = (a.org === undefined ? 100 : a.org) / 100;
    const grp = a.group !== null && a.group !== undefined ? Fronts.group(g, a.group) : null;
    const e = this.plateBase(k, Fronts.icon(g, a), grp ? grp.color : null, flag, W, H);
    ctx.drawImage(e.cv, x - e.pad, y - e.pad + 1, e.w, e.h);
    const fpx = Math.round(Math.max(10, H * 0.42));
    const ns = this.plateNum(men >= 1000 ? (men / 1000).toFixed(1) + 'к' : String(men), a.state === 'retreat' ? '#ffb0a0' : '#fff3d6', fpx);
    ctx.drawImage(ns.cv, x + W - 3 - ns.w + 1, y + 3 + (grp ? 1 : 0), ns.w, ns.h);
    const bx = x + H + 3, bw = W - H - 7, bh = Math.max(3, Math.round(H * 0.14)), by = y + H - bh * 2 - 4;
    ctx.fillStyle = 'rgba(255,255,255,0.16)';
    ctx.fillRect(bx, by, bw, bh); ctx.fillRect(bx, by + bh + 1, bw, bh);
    ctx.fillStyle = '#e9c264'; ctx.fillRect(bx, by, Math.round(bw * Math.min(1, men / full)), bh);
    ctx.fillStyle = org > 0.6 ? '#79b743' : org > 0.3 ? '#e0a63a' : '#d4492b';
    ctx.fillRect(bx, by + bh + 1, Math.round(bw * org), bh);
    // состояние
    const st = a.state;
    if (st === 'siege') Icons.draw(ctx, 'target', x + W, y, 13, '#ffcf7a');
    else if (st === 'retreat') Icons.draw(ctx, 'flag', x + W, y, 13, '#ffffff');
    else if (st === 'battle') Icons.draw(ctx, 'swords', x + W, y, 13, '#ff9a7a');
    else if ((a.entrench || 0) > 0.5) Icons.draw(ctx, 'shield', x + W, y, 11, '#cfe2a8');
  }

  // Многодивизионные бои вблизи: art-units.js рисует схватку двух ведущих дивизий; остальные участники
  // на время кадра разбиваются на пары с ближайшим противником и подаются как отдельные сражения.
  // Возвращает функцию, которая всё возвращает как было.
  pairBattles(list) {
    const g = this.g, saved = [], added = [], vis = new Set(list);
    for (const b of g.battles) {
      if (b.kind !== 'field' || !b.sideA || b.sideA.length + b.sideB.length <= 2) continue;
      const A = [], B = [];
      for (const id of b.sideA) { const m = g.army(id); if (m && m.id !== b.a && vis.has(m)) A.push(m); }
      for (const id of b.sideB) { const m = g.army(id); if (m && m.id !== b.b && vis.has(m)) B.push(m); }
      const freeB = B.slice();
      for (const m of A) {
        let bi = -1, bd = Infinity;
        for (let i = 0; i < freeB.length; i++) { const d = dist(m.x, m.y, freeB[i].x, freeB[i].y); if (d < bd) { bd = d; bi = i; } }
        if (bi < 0) continue;
        const e = freeB.splice(bi, 1)[0];
        const v = {
          id: -m.id - 1, kind: 'field', a: m.id, b: e.id, sideA: [m.id], sideB: [e.id], x: (m.x + e.x) / 2, y: (m.y + e.y) / 2, t: b.t,
          startA: (b.men && b.men[m.id]) || menCount(m.units), startB: (b.men && b.men[e.id]) || menCount(e.units),
          lossA: (b.loss && b.loss[m.id]) || 0, lossB: (b.loss && b.loss[e.id]) || 0,
        };
        saved.push([m, m.battleId], [e, e.battleId]);
        m.battleId = e.battleId = v.id;
        g.battles.push(v); added.push(v);
        m._paired = e._paired = true;
      }
      // без пары — стоят строем рядом с местом боя
      for (const m of A.concat(B)) if (!m._paired) { saved.push([m, m.battleId]); m.battleId = null; }
      for (const m of A.concat(B)) m._paired = false;
    }
    return () => {
      for (const [m, id] of saved) m.battleId = id;
      for (const v of added) { const i = g.battles.lastIndexOf(v); if (i >= 0) g.battles.splice(i, 1); }
    };
  }

  drawMarker(ctx, dt) {
    const m = this.marker;
    if (!m) return;
    m.t += dt;
    if (m.t > 0.8) { this.marker = null; return; }
    const p = this.toScreen(m.x, m.y);
    const k = m.t / 0.8;
    ctx.strokeStyle = m.attack ? `rgba(255,90,60,${1 - k})` : `rgba(255,240,180,${1 - k})`;
    ctx.lineWidth = 3;
    ctx.beginPath(); ctx.ellipse(p.x, p.y, 16 - k * 8, 7 - k * 3, 0, 0, TAU); ctx.stroke();
  }

  // Частицы в мировых координатах. o — дополнительно: для снарядов (arrow, bolt, stone) цель tx, ty,
  // время полёта dur и высота дуги arc в клетках; для павших (fallen) — род войск и цвета державы.
  spawn(type, x, y, o) {
    if (this.particles.length > (type === 'fallen' ? 760 : 700)) return;
    const p = { type, x, y, t: 0, vx: (Math.random() - 0.5) * 0.4, vy: -0.3 - Math.random() * 0.4, dur: 1 };
    if (type === 'dust') { p.dur = 0.9; p.vy = -0.1 - Math.random() * 0.2; }
    else if (type === 'smoke') p.dur = 2.2;
    else if (type === 'fire') { p.dur = 0.7; p.vy = -0.6; }
    else if (type === 'debris') { p.dur = 0.9; const a = Math.random() * TAU, v = 0.8 + Math.random() * 1.5; p.vx = Math.cos(a) * v; p.vy = Math.sin(a) * v - 0.6; }
    else if (type === 'spark') { p.dur = 0.2 + Math.random() * 0.12; const a = Math.random() * TAU, v = 1.4 + Math.random() * 1.6; p.vx = Math.cos(a) * v; p.vy = Math.sin(a) * v * 0.7 - 0.5; }
    else if (type === 'arrow' || type === 'bolt' || type === 'stone') {
      p.vx = p.vy = 0; p.x0 = x; p.y0 = y;
      p.tx = o ? o.tx : x; p.ty = o ? o.ty : y; p.dur = o && o.dur ? o.dur : 0.6; p.arc = o && o.arc ? o.arc : 0.3;
    } else if (type === 'fallen') {
      p.vx = p.vy = 0; p.dur = 4.5;
      p.uid = o.uid; p.kc = o.kc; p.kd = o.kd; p.dir = o.dir || 1;
    }
    this.particles.push(p);
  }
  drawParticles(ctx, dt) {
    const z = this.cam.z, P = this.particles;
    const shafts = [], fletch = [];
    const al = Math.min(10, Math.max(4, z * 0.2));
    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i];
      p.t += dt;
      if (p.t >= p.dur) {
        // камень падает: обломки и пыль
        if (p.type === 'stone') {
          for (let k = 0; k < 6; k++) this.spawn('debris', p.tx, p.ty);
          this.spawn('smoke', p.tx, p.ty - 0.1); this.spawn('dust', p.tx, p.ty);
        }
        P.splice(i, 1); continue;
      }
      if (p.type === 'fallen') continue;   // лежат под строем, их рисует drawBattles
      const k = p.t / p.dur;
      if (p.type === 'arrow' || p.type === 'bolt' || p.type === 'stone') {
        const gx = p.x0 + (p.tx - p.x0) * k, gy = p.y0 + (p.ty - p.y0) * k;
        const s = this.toScreen(gx, gy - p.arc * 4 * k * (1 - k));
        if (p.type === 'stone') {
          const r = Math.min(4.5, Math.max(2, z * 0.07)), g = this.toScreen(gx, gy);
          ctx.globalAlpha = 0.25; ctx.fillStyle = '#1e140a';
          ctx.beginPath(); ctx.ellipse(g.x, g.y, r, r * 0.45, 0, 0, TAU); ctx.fill();
          ctx.globalAlpha = 1; ctx.fillStyle = '#8f897e'; ctx.strokeStyle = '#2a1b0d'; ctx.lineWidth = 1;
          ctx.beginPath(); ctx.arc(s.x, s.y, r, 0, TAU); ctx.fill(); ctx.stroke();
        } else {
          // направление полёта по касательной к дуге
          const dx = (p.tx - p.x0), dy = (p.ty - p.y0) - p.arc * 4 * (1 - 2 * k);
          const L = Math.hypot(dx, dy) || 1, len = p.type === 'bolt' ? al * 0.7 : al;
          const ux = dx / L * len / 2, uy = dy / L * len / 2;
          shafts.push(s.x - ux, s.y - uy, s.x + ux, s.y + uy);
          fletch.push(s.x - ux, s.y - uy, s.x - ux * 0.45, s.y - uy * 0.45);
        }
        continue;
      }
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.type === 'debris') p.vy += 2.5 * dt;
      const s = this.toScreen(p.x, p.y);
      if (p.type === 'dust') { ctx.globalAlpha = 0.5 * (1 - k); ctx.fillStyle = '#967850'; ctx.beginPath(); ctx.arc(s.x, s.y, (0.12 + k * 0.25) * Math.min(z, 36), 0, TAU); ctx.fill(); }
      else if (p.type === 'smoke') { ctx.globalAlpha = 0.45 * (1 - k); ctx.fillStyle = '#46413c'; ctx.beginPath(); ctx.arc(s.x, s.y, (0.15 + k * 0.4) * z, 0, TAU); ctx.fill(); }
      else if (p.type === 'fire') { ctx.globalAlpha = 0.9 * (1 - k); ctx.fillStyle = k < 0.5 ? '#ffe04a' : '#ff9a28'; ctx.beginPath(); ctx.arc(s.x, s.y, (0.08 + (1 - k) * 0.1) * z, 0, TAU); ctx.fill(); }
      else if (p.type === 'debris') { ctx.globalAlpha = 1 - k; ctx.fillStyle = '#5a4b3c'; ctx.fillRect(s.x - 2, s.y - 2, 4, 4); }
      else if (p.type === 'spark') {
        ctx.globalAlpha = 1 - k; ctx.strokeStyle = k < 0.4 ? '#fffbe6' : '#ffd25a'; ctx.lineWidth = 1.5;
        ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x - p.vx * z * 0.035, s.y - p.vy * z * 0.035); ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;
    // стрелы и болты одним росчерком: древко и светлое оперение
    if (shafts.length) {
      ctx.lineCap = 'round';
      ctx.strokeStyle = '#2f2010'; ctx.lineWidth = 1.3;
      ctx.beginPath();
      for (let i = 0; i < shafts.length; i += 4) { ctx.moveTo(shafts[i], shafts[i + 1]); ctx.lineTo(shafts[i + 2], shafts[i + 3]); }
      ctx.stroke();
      ctx.strokeStyle = '#f3e7c6'; ctx.lineWidth = 1.6;
      ctx.beginPath();
      for (let i = 0; i < fletch.length; i += 4) { ctx.moveTo(fletch[i], fletch[i + 1]); ctx.lineTo(fletch[i + 2], fletch[i + 3]); }
      ctx.stroke();
    }
  }
  drawSnowfall(ctx, dt) {
    if (!this.snow) this.snow = Array.from({ length: 70 }, () => ({ x: Math.random(), y: Math.random(), s: 1 + Math.random() * 2, v: 0.04 + Math.random() * 0.06 }));
    ctx.fillStyle = 'rgba(255,255,255,0.75)';
    for (const f of this.snow) {
      f.y += f.v * dt; f.x += Math.sin(this.time + f.s * 3) * 0.004 * dt * 10;
      if (f.y > 1) { f.y = 0; f.x = Math.random(); }
      ctx.beginPath(); ctx.arc(f.x * this.w, f.y * this.h, f.s, 0, TAU); ctx.fill();
    }
  }

  roundRect(ctx, x, y, w, h, r) {
    ctx.beginPath();
    ctx.moveTo(x + r, y);
    ctx.arcTo(x + w, y, x + w, y + h, r);
    ctx.arcTo(x + w, y + h, x, y + h, r);
    ctx.arcTo(x, y + h, x, y, r);
    ctx.arcTo(x, y, x + w, y, r);
    ctx.closePath();
  }

  // ---------- выбор под пальцем ----------
  pick(sx, sy) {
    const g = this.g;
    if (this.drawnArmies) {
      let best = null, bd = Infinity;
      for (const d of this.drawnArmies) {
        const dd = Math.hypot(sx - d.x, sy - d.y);
        if (dd < d.r + 6 && dd < bd) { bd = dd; best = d.a; }
      }
      if (best) return { kind: 'army', id: best.id, obj: best };
    }
    const w = this.toWorld(sx, sy);
    let best = null, bd = Infinity;
    for (const c of g.cities) {
      if (!g.explored[g.cityTile(c)]) continue;
      const d = dist(w.x, w.y, c.x + 0.5, c.y + 0.5);
      const r = Math.max(this.cityRadius(c) + 0.25, 18 / this.cam.z);
      if (d < r && d < bd) { bd = d; best = c; }
    }
    if (best) return { kind: 'city', id: best.id, obj: best };
    return { kind: 'ground', x: w.x, y: w.y };
  }

  // ---------- миникарта ----------
  buildMinimapBase() {
    const g = this.g, w = g.world;
    const cv = document.createElement('canvas');
    cv.width = w.W; cv.height = w.H;
    const c = cv.getContext('2d');
    const img = c.createImageData(w.W, w.H);
    for (let i = 0; i < w.W * w.H; i++) {
      const n = parseInt(TERRAIN_COLORS[w.terrain[i]].slice(1), 16);
      img.data[i * 4] = (n >> 16) & 255; img.data[i * 4 + 1] = (n >> 8) & 255; img.data[i * 4 + 2] = n & 255; img.data[i * 4 + 3] = 255;
      if (w.road[i]) { img.data[i * 4] = 140; img.data[i * 4 + 1] = 105; img.data[i * 4 + 2] = 60; }
    }
    c.putImageData(img, 0, 0);
    c.drawImage(this.layers.territory, 0, 0);
    c.globalAlpha = 1;
    return cv;
  }
  drawMinimap(mc, W, H) {
    const g = this.g;
    if (!g) return;
    if (!this.mmBase) this.mmBase = this.buildMinimapBase();
    const w = g.world;
    const sx = W / w.W, sy = H / w.H;
    mc.setTransform(1, 0, 0, 1, 0, 0);
    mc.imageSmoothingEnabled = true;
    mc.drawImage(this.mmBase, 0, 0, W, H);
    mc.drawImage(this.layers.fog, 0, 0, W, H);
    for (const c of g.cities) {
      if (!g.explored[g.cityTile(c)]) continue;
      const k = g.kingdom(c.owner);
      const s = c.isCapital ? 7 : 5;
      mc.fillStyle = '#1a120a';
      mc.fillRect((c.x + 0.5) * sx - s / 2 - 1, (c.y + 0.5) * sy - s / 2 - 1, s + 2, s + 2);
      mc.fillStyle = k ? k.color : NEUTRAL_COLOR;
      mc.fillRect((c.x + 0.5) * sx - s / 2, (c.y + 0.5) * sy - s / 2, s, s);
    }
    for (const a of g.armies) {
      if (!this.armyVisible(a)) continue;
      const k = g.kingdom(a.owner);
      mc.fillStyle = '#fff6dd';
      mc.beginPath(); mc.arc(a.x * sx, a.y * sy, 3.2, 0, TAU); mc.fill();
      mc.fillStyle = k.color;
      mc.beginPath(); mc.arc(a.x * sx, a.y * sy, 2.2, 0, TAU); mc.fill();
    }
    const tl = this.toWorld(0, 0), br = this.toWorld(this.w, this.h);
    mc.strokeStyle = 'rgba(255,248,220,0.95)';
    mc.lineWidth = 1.5;
    mc.strokeRect(tl.x * sx, tl.y * sy, (br.x - tl.x) * sx, (br.y - tl.y) * sy);
  }
}
