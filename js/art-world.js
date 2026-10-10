'use strict';
// Графика мира: подробные города, укрепления, деревья, горы и прочие детали карты.
// Рисует в offscreen canvas с кэшем; render.js вызывает отсюда готовые картинки.
// Местность запекается кусками (bakeTerrain), города — спрайтами по ключу состояния (citySprite).

const ART_INK = '#2a1b0d';

const WorldArt = {
  st: null,            // заготовки текущего мира: картинки суши и воды, глубины, реки, мосты, поляны у городов
  stamps: {},          // штампы деревьев и холмов для каждого разрешения кусков
  sprites: new Map(),  // спрайты городов: id → { key, ppt, spr, old, used }
  plans: new Map(),    // постоянная раскладка города: ворота, стороны для полей и промыслов
  budget: 0,           // сколько спрайтов городов ещё можно перерисовать в этом кадре

  // ---------- цвета и случайность ----------
  hash(i, salt) {
    let h = (i * 2654435761 + salt * 97531) >>> 0;
    h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13;
    return (h >>> 0) / 4294967296;
  },
  rgb(hex) { const n = parseInt(hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; },
  hex(r, g, b) {
    return '#' + ((1 << 24) | (clamp(Math.round(r), 0, 255) << 16) | (clamp(Math.round(g), 0, 255) << 8) | clamp(Math.round(b), 0, 255)).toString(16).slice(1);
  },
  shade(hex, f) { const c = this.rgb(hex); return this.hex(c[0] * f, c[1] * f, c[2] * f); },
  mix(a, b, t) { const p = this.rgb(a), q = this.rgb(b); return this.hex(lerp(p[0], q[0], t), lerp(p[1], q[1], t), lerp(p[2], q[2], t)); },
  alpha(hex, a) { const c = this.rgb(hex); return 'rgba(' + c[0] + ',' + c[1] + ',' + c[2] + ',' + a + ')'; },

  // ---------- заготовки мира ----------
  // Вызывается из Renderer.buildBaseImage при новой партии. Возвращает картинку суши (1 пиксель = 1 клетка).
  prepareWorld(r) {
    const g = r.g, w = g.world, W = w.W, H = w.H, n = W * H, ter = w.terrain;
    this.sprites.clear();
    this.plans.clear();
    const st = this.st = { w, lines: null };
    // глубина воды: шагов до ближайшей суши
    const depth = new Uint8Array(n), q = new Int32Array(n);
    let qh = 0, qt = 0;
    for (let i = 0; i < n; i++) {
      if (ter[i] > T.SHALLOW) q[qt++] = i; else depth[i] = 255;
    }
    while (qh < qt) {
      const k = q[qh++], x = k % W, y = (k - x) / W, d = depth[k] + 1;
      if (d > 30) continue;
      if (x > 0 && depth[k - 1] > d) { depth[k - 1] = d; q[qt++] = k - 1; }
      if (x < W - 1 && depth[k + 1] > d) { depth[k + 1] = d; q[qt++] = k + 1; }
      if (y > 0 && depth[k - W] > d) { depth[k - W] = d; q[qt++] = k - W; }
      if (y < H - 1 && depth[k + W] > d) { depth[k + W] = d; q[qt++] = k + W; }
    }
    st.depth = depth;
    // цвета суши: мягкие пятна шума и светотень рельефа с северо-запада
    const nz = makeNoise(w.seed + 101), nl = makeNoise(w.seed + 131);
    const col = new Float32Array(n * 3), has = new Uint8Array(n);
    const lush = this.rgb('#a7b86a'), dry = this.rgb('#c6bd7a');
    const e = w.elev;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, t = ter[i];
      if (t <= T.SHALLOW) continue;
      let c = this.rgb(TERRAIN_COLORS[t]);
      if (t === T.FOREST) c = this.rgb(this.mix(TERRAIN_COLORS[t], '#6d8a4a', 0.35));
      else if (t === T.SNOW) c = this.rgb(this.mix(TERRAIN_COLORS[t], TERRAIN_COLORS[T.MOUNTAIN], 0.4));
      if (t === T.PLAINS) {
        const m = fractal(nl, x / 11, y / 11, 2);
        const k = clamp((m - 0.35) * 2.2, 0, 1);
        c = [lerp(lush[0], dry[0], k), lerp(lush[1], dry[1], k), lerp(lush[2], dry[2], k)];
      }
      let f = 0.95 + 0.1 * fractal(nz, x / 7, y / 7, 2) + (this.hash(i, 1) - 0.5) * 0.025;
      const i1 = clamp(y - 1, 0, H - 1) * W + clamp(x - 1, 0, W - 1), i2 = clamp(y + 1, 0, H - 1) * W + clamp(x + 1, 0, W - 1);
      const lit = e[i2] - e[i1];
      f *= 1 + clamp(lit * (t >= T.HILLS ? 4 : 1.6), -0.09, 0.09);
      col[i * 3] = c[0] * f; col[i * 3 + 1] = c[1] * f; col[i * 3 + 2] = c[2] * f;
      has[i] = 1;
    }
    // цвет суши растекается на пару клеток в воду, чтобы у берега не проступала синева
    for (let it = 0; it < 2; it++) {
      const add = [];
      for (let i = 0; i < n; i++) {
        if (has[i]) continue;
        const x = i % W, y = (i - x) / W;
        let s0 = 0, s1 = 0, s2 = 0, m = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx, yy = y + dy;
          if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
          const j = yy * W + xx;
          if (has[j] !== 1) continue;
          s0 += col[j * 3]; s1 += col[j * 3 + 1]; s2 += col[j * 3 + 2]; m++;
        }
        if (m) { col[i * 3] = s0 / m; col[i * 3 + 1] = s1 / m; col[i * 3 + 2] = s2 / m; add.push(i); }
      }
      for (const i of add) has[i] = 1;
    }
    const mk = () => { const cv = document.createElement('canvas'); cv.width = W; cv.height = H; return cv; };
    const landCv = mk(), waterCv = mk();
    const lc = landCv.getContext('2d'), wc = waterCv.getContext('2d');
    const li = lc.createImageData(W, H), wi = wc.createImageData(W, H);
    const shoal = this.rgb('#7fb0b5'), mid = this.rgb('#5a91a3'), deep = this.rgb('#3d6f85');
    const sand = this.rgb(TERRAIN_COLORS[T.BEACH]);
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      if (has[i]) { li.data[o] = col[i * 3]; li.data[o + 1] = col[i * 3 + 1]; li.data[o + 2] = col[i * 3 + 2]; }
      else { li.data[o] = sand[0]; li.data[o + 1] = sand[1]; li.data[o + 2] = sand[2]; }
      li.data[o + 3] = 255;
      const d = Math.max(1, depth[i]);
      const x = i % W, y = (i - x) / W;
      const f = 0.97 + 0.06 * fractal(nz, x / 9 + 40, y / 9, 2);
      let c;
      if (d <= 3) { const k = (d - 1) / 2; c = [lerp(shoal[0], mid[0], k), lerp(shoal[1], mid[1], k), lerp(shoal[2], mid[2], k)]; }
      else { const k = clamp((d - 3) / 5, 0, 1); c = [lerp(mid[0], deep[0], k), lerp(mid[1], deep[1], k), lerp(mid[2], deep[2], k)]; }
      wi.data[o] = c[0] * f; wi.data[o + 1] = c[1] * f; wi.data[o + 2] = c[2] * f; wi.data[o + 3] = 255;
    }
    lc.putImageData(li, 0, 0);
    wc.putImageData(wi, 0, 0);
    st.landImg = landCv; st.waterImg = waterCv;
    // поляны вокруг городов: 1 — без деревьев и холмов, 2 — без гор
    const clear = new Uint8Array(n);
    for (const c of g.cities) {
      for (let dy = -2; dy <= 2; dy++) for (let dx = -2; dx <= 2; dx++) {
        const x = c.x + dx, y = c.y + dy;
        if (!w.inside(x, y)) continue;
        const d = Math.hypot(dx, dy), i = y * W + x;
        if (d <= 1.05) clear[i] = 2;
        else if (d <= 1.5 && !clear[i]) clear[i] = 1;
      }
    }
    st.clear = clear;
    st.conNoise = makeNoise(w.seed + 77);
    return landCv;
  },

  // Реки, дороги и мосты нужны в кусках; их линии готовы только после setGame, поэтому собираются при первом запекании.
  ensureLines(r) {
    const st = this.st;
    if (st.lines) return;
    const w = st.w, W = w.W, n = W * w.H;
    st.lines = true;
    // доля длины реки в каждой её клетке: у истока ручей, к устью река шире
    const rf = new Float32Array(n).fill(-1);
    for (const rv of w.rivers) {
      for (let k = 0; k < rv.length; k++) {
        const i = Math.floor(rv[k].y) * W + Math.floor(rv[k].x);
        rf[i] = Math.max(rf[i], k / Math.max(1, rv.length - 1));
      }
    }
    st.riverF = rf;
    st.rivers = r.riverLines.map(pts => this.flattenRiver(pts));
    st.roads = w.roads.map(pts => {
      const p = new Path2D();
      let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const q of pts) { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); }
      if (pts.length >= 2) {
        p.moveTo(pts[0].x, pts[0].y);
        for (let k = 1; k < pts.length - 1; k++) p.quadraticCurveTo(pts[k].x, pts[k].y, (pts[k].x + pts[k + 1].x) / 2, (pts[k].y + pts[k + 1].y) / 2);
        p.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
      }
      return { p, x0, y0, x1, y1 };
    });
    // мосты и броды: где дорога пересекает реку
    const seen = new Set();
    st.bridges = [];
    for (const pts of w.roads) {
      for (let k = 1; k < pts.length - 1; k++) {
        const i0 = Math.floor(pts[k].y) * W + Math.floor(pts[k].x);
        if (!w.river[i0]) continue;
        let k1 = k;
        while (k1 + 1 < pts.length - 1 && w.river[Math.floor(pts[k1 + 1].y) * W + Math.floor(pts[k1 + 1].x)]) k1++;
        const a = pts[k - 1], b = pts[k1 + 1];
        const m = pts[(k + k1) >> 1];
        const key = Math.floor(m.y) * W + Math.floor(m.x);
        let f = 0;
        for (let j = k; j <= k1; j++) f = Math.max(f, rf[Math.floor(pts[j].y) * W + Math.floor(pts[j].x)]);
        if (!seen.has(key)) {
          seen.add(key);
          const cx = (pts[k].x + pts[k1].x) / 2, cy = (pts[k].y + pts[k1].y) / 2;
          st.bridges.push({ x: cx, y: cy, ang: Math.atan2(b.y - a.y, b.x - a.x), len: Math.hypot(pts[k1].x - pts[k].x, pts[k1].y - pts[k].y) + 0.85, f });
        }
        k = k1;
      }
    }
  },
  riverWidth(f) { return 0.09 + 0.3 * f; },
  // Плавная линия реки (срезание углов Чайкина по клеточному руслу) с шириной в каждой точке и камышами по берегам.
  flattenRiver(pts) {
    const n = pts.length;
    if (n < 2) return { xs: [], ys: [], ws: [], reeds: [], x0: 0, y0: 0, x1: -1, y1: -1 };
    let q = pts.map((p, k) => [p.x, p.y, k / (n - 1)]);
    // сначала сглаживаем клеточные ступеньки русла, потом срезаем углы
    for (let it = 0; it < 2; it++) {
      const r = q.map(p => p.slice());
      for (let k = 1; k < q.length - 1; k++) {
        r[k][0] = q[k - 1][0] * 0.25 + q[k][0] * 0.5 + q[k + 1][0] * 0.25;
        r[k][1] = q[k - 1][1] * 0.25 + q[k][1] * 0.5 + q[k + 1][1] * 0.25;
      }
      q = r;
    }
    for (let it = 0; it < 3; it++) {
      const r = [q[0]];
      for (let k = 0; k < q.length - 1; k++) {
        const a = q[k], b = q[k + 1];
        r.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25, a[2] * 0.75 + b[2] * 0.25]);
        r.push([a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75, a[2] * 0.25 + b[2] * 0.75]);
      }
      r.push(q[q.length - 1]);
      q = r;
    }
    const xs = q.map(p => p[0]), ys = q.map(p => p[1]);
    const ws = q.map(p => this.riverWidth(p[2]));
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (let k = 0; k < xs.length; k++) { x0 = Math.min(x0, xs[k]); y0 = Math.min(y0, ys[k]); x1 = Math.max(x1, xs[k]); y1 = Math.max(y1, ys[k]); }
    // камыши и трава у воды
    const reeds = [];
    const w = this.st.w;
    for (let k = 4; k < xs.length - 4; k += 6) {
      const dx = xs[k + 1] - xs[k - 1], dy = ys[k + 1] - ys[k - 1], L = Math.hypot(dx, dy) || 1;
      const side = this.hash(k * 31 + Math.floor(xs[k] * 7), 5) < 0.5 ? 1 : -1;
      const off = ws[k] / 2 + 0.07;
      const rx = xs[k] - dy / L * off * side, ry = ys[k] + dx / L * off * side;
      const i = w.tileAt(rx, ry);
      if (i >= 0 && w.terrain[i] > T.BEACH && w.terrain[i] < T.MOUNTAIN && !w.road[i]) reeds.push(rx, ry);
    }
    return { xs, ys, ws, reeds, x0, y0, x1, y1 };
  },

  // ---------- штампы: деревья, кусты, холмики ----------
  stampsFor(tp) {
    let s = this.stamps[tp];
    if (s) return s;
    s = this.stamps[tp] = { leaf: [], fir: [], poplar: [], bush: [], mound: [] };
    for (let v = 0; v < 6; v++) s.leaf.push(this.makeStamp(tp, 0.62, 0.78, 0.31, 0.7, (c, px) => this.drawLeafTree(c, v, px)));
    for (let v = 0; v < 6; v++) s.fir.push(this.makeStamp(tp, 0.5, 0.82, 0.25, 0.76, (c, px) => this.drawFir(c, v, px)));
    for (let v = 0; v < 3; v++) s.poplar.push(this.makeStamp(tp, 0.36, 0.8, 0.18, 0.74, (c, px) => this.drawPoplar(c, v, px)));
    for (let v = 0; v < 4; v++) s.bush.push(this.makeStamp(tp, 0.36, 0.3, 0.18, 0.24, (c, px) => this.drawBush(c, v, px)));
    for (let v = 0; v < 8; v++) s.mound.push(this.makeStamp(tp, 1.2, 0.5, 0.6, 0.42, (c, px) => this.drawMound(c, v, px)));
    return s;
  },
  makeStamp(tp, w, h, ax, ay, fn) {
    const cv = document.createElement('canvas');
    cv.width = Math.ceil(w * tp); cv.height = Math.ceil(h * tp);
    const axp = Math.round(ax * tp), ayp = Math.round(ay * tp);
    const c = cv.getContext('2d');
    c.setTransform(tp, 0, 0, tp, axp, ayp);
    c.lineJoin = 'round'; c.lineCap = 'round';
    fn(c, 1 / tp);
    return { cv, w: cv.width / tp, h: cv.height / tp, ax: axp / tp, ay: ayp / tp };
  },
  // Крона из нескольких кругов: сначала толстый чернильный контур всех кругов, затем заливка — остаётся внешний контур.
  blobCrown(c, blobs, px, pal) {
    c.beginPath();
    for (const b of blobs) { c.moveTo(b[0] + b[2], b[1]); c.arc(b[0], b[1], b[2], 0, TAU); }
    c.lineWidth = px * 2.4; c.strokeStyle = 'rgba(42,27,13,0.85)'; c.stroke();
    c.fillStyle = pal[0]; c.fill();
    c.save(); c.clip();
    const b0 = blobs[0];
    c.fillStyle = pal[2];
    c.beginPath(); c.arc(b0[0] + b0[2] * 0.55, b0[1] + b0[2] * 0.7, b0[2] * 1.15, 0, TAU); c.fill();
    c.fillStyle = pal[1];
    c.beginPath(); c.arc(b0[0] - b0[2] * 0.45, b0[1] - b0[2] * 0.5, b0[2] * 0.62, 0, TAU); c.fill();
    c.restore();
  },
  drawLeafTree(c, v, px) {
    const R = mulberry32(1000 + v * 17);
    const r = 0.16 + 0.06 * R();
    const pal = [['#56803a', '#7aa34c', '#3a5d29'], ['#5e863b', '#86ab55', '#3f6229'], ['#6b8c3c', '#93b25a', '#4a6a2b']][v % 3];
    c.fillStyle = '#5a3e25';
    c.beginPath(); c.moveTo(-0.03, 0); c.lineTo(-0.018, -r * 1.1); c.lineTo(0.018, -r * 1.1); c.lineTo(0.03, 0); c.closePath(); c.fill();
    c.strokeStyle = 'rgba(42,27,13,0.8)'; c.lineWidth = px * 1.1; c.stroke();
    const cy = -r * 1.45;
    const blobs = [[0, cy, r * 0.78]];
    const nb = 5 + Math.floor(R() * 2);
    for (let k = 0; k < nb; k++) {
      const a = k / nb * TAU + R() * 0.6;
      blobs.push([Math.cos(a) * r * 0.55, cy + Math.sin(a) * r * 0.45, r * (0.4 + R() * 0.16)]);
    }
    this.blobCrown(c, blobs, px, pal);
    // листва: пара тёмных дужек
    c.strokeStyle = this.alpha(pal[2], 0.8); c.lineWidth = px * 1;
    c.beginPath();
    for (let k = 0; k < 3; k++) {
      const x = (R() - 0.3) * r, y = cy + (R() - 0.2) * r * 0.8;
      c.moveTo(x - r * 0.15, y); c.quadraticCurveTo(x, y + r * 0.13, x + r * 0.15, y);
    }
    c.stroke();
  },
  drawFir(c, v, px) {
    const R = mulberry32(2000 + v * 13);
    const h = 0.5 + 0.14 * R(), wd = 0.16 + 0.05 * R();
    const pal = [['#3f6a4b', '#5c8a62', '#2a4a38'], ['#3a6447', '#57855c', '#264434'], ['#46704c', '#679166', '#2f5039']][v % 3];
    c.fillStyle = '#4e3620'; c.fillRect(-0.018, -0.1, 0.036, 0.1);
    const tiers = [];
    for (let k = 0; k < 3; k++) {
      const yb = -0.07 - k * h * 0.25, yt = yb - h * (0.46 - k * 0.04), ww = wd * (1 - k * 0.24);
      tiers.push([yb, yt, ww]);
    }
    const tierPath = () => {
      c.beginPath();
      for (const t of tiers) {
        c.moveTo(-t[2], t[0]); c.lineTo(0, t[1]); c.lineTo(t[2], t[0]);
        c.quadraticCurveTo(0, t[0] + 0.05, -t[2], t[0]);
      }
    };
    tierPath();
    c.lineWidth = px * 2.4; c.strokeStyle = 'rgba(42,27,13,0.85)'; c.stroke();
    c.fillStyle = pal[0]; c.fill();
    c.save(); c.clip();
    c.fillStyle = pal[2];
    c.beginPath(); c.moveTo(0.004, -h * 1.2); c.lineTo(wd * 1.2, 0.05); c.lineTo(wd * 0.15, 0.05); c.closePath(); c.fill();
    c.fillStyle = pal[1];
    for (const t of tiers) { c.beginPath(); c.moveTo(-t[2] * 0.95, t[0]); c.lineTo(-0.01, t[1] + 0.02); c.lineTo(-t[2] * 0.45, t[0]); c.closePath(); c.fill(); }
    c.restore();
  },
  drawPoplar(c, v, px) {
    const R = mulberry32(3000 + v * 11);
    const h = 0.5 + 0.1 * R(), rw = 0.09 + 0.02 * R();
    const birch = v === 2;
    c.fillStyle = birch ? '#e4dccb' : '#5a3e25';
    c.fillRect(-0.016, -0.14, 0.032, 0.14);
    c.strokeStyle = 'rgba(42,27,13,0.8)'; c.lineWidth = px * 1; c.strokeRect(-0.016, -0.14, 0.032, 0.14);
    const pal = birch ? ['#8aa651', '#a9c06a', '#617f37'] : ['#6f9440', '#90b25a', '#4c6c2d'];
    const cy = -0.1 - h * 0.5;
    const blobs = [[0, cy, rw], [0, cy - h * 0.22, rw * 0.85], [0, cy + h * 0.18, rw * 0.9], [rw * 0.3, cy - h * 0.05, rw * 0.8], [-rw * 0.3, cy + h * 0.06, rw * 0.8]];
    this.blobCrown(c, blobs, px, pal);
  },
  drawBush(c, v, px) {
    const R = mulberry32(4000 + v * 7);
    const r = 0.08 + 0.025 * R();
    const pal = [['#5f853c', '#80a650', '#40602a'], ['#6c8a3e', '#8fae58', '#4a682c']][v % 2];
    const blobs = [[0, -r * 0.9, r]];
    for (let k = 0; k < 3; k++) blobs.push([(k - 1) * r * 0.8, -r * (0.6 + R() * 0.3), r * (0.6 + R() * 0.2)]);
    this.blobCrown(c, blobs, px, pal);
  },
  // Холм: мягкий купол, освещённый слева, со штриховкой-гашюрами на теневом склоне. Варианты от бугорка до большого холма.
  drawMound(c, v, px) {
    const R = mulberry32(5000 + v * 19);
    const wd = 0.24 + v * 0.04 + 0.04 * R(), h = wd * (0.42 + 0.14 * R());
    const sk = (R() - 0.5) * wd * 0.4;
    const crest = () => {
      c.moveTo(-wd, 0);
      c.bezierCurveTo(-wd * 0.6, -h * 0.55, -wd * 0.35 + sk, -h, sk, -h);
      c.bezierCurveTo(wd * 0.35 + sk, -h, wd * 0.62, -h * 0.5, wd, 0);
    };
    c.beginPath(); crest(); c.closePath();
    c.fillStyle = '#c4ac77'; c.fill();
    c.save(); c.clip();
    c.fillStyle = 'rgba(120,92,50,0.38)';
    c.beginPath(); c.moveTo(sk + wd * 0.05, -h * 1.2); c.bezierCurveTo(sk + wd * 0.25, -h * 0.6, wd * 0.05, -h * 0.2, -wd * 0.2, 0.05); c.lineTo(wd * 1.2, 0.05); c.lineTo(wd * 1.2, -h * 1.2); c.closePath(); c.fill();
    c.fillStyle = 'rgba(255,246,214,0.28)';
    c.beginPath(); c.moveTo(-wd, 0.02); c.bezierCurveTo(-wd * 0.6, -h * 0.55, -wd * 0.35 + sk, -h, sk - wd * 0.05, -h); c.bezierCurveTo(-wd * 0.3, -h * 0.6, -wd * 0.5, -h * 0.2, -wd * 0.55, 0.02); c.closePath(); c.fill();
    // штрихи-гашюры по теневому склону
    c.strokeStyle = 'rgba(70,50,25,0.42)'; c.lineWidth = px * 1.1;
    c.beginPath();
    const nh = 2 + Math.round(wd * 8);
    for (let k = 0; k < nh; k++) {
      const t = (k + 0.6) / (nh + 0.4);
      const x = sk + t * (wd - sk), y = -h * (1 - t * t * 0.9);
      c.moveTo(x, y + h * 0.1); c.lineTo(x + wd * 0.05, y + h * 0.1 + Math.min(h * 0.55, (h + y) * 0.8));
    }
    c.stroke();
    c.restore();
    c.beginPath(); crest();
    c.strokeStyle = 'rgba(42,27,13,0.75)'; c.lineWidth = px * 1.4; c.stroke();
  },
  blit(c, s, x, y, tp) {
    c.drawImage(s.cv, Math.round(x * tp) / tp - s.ax, Math.round(y * tp) / tp - s.ay, s.w, s.h);
  },

  // ---------- бумага ----------
  paperPattern(c) {
    if (!this.paperCv) {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 256;
      const p = cv.getContext('2d');
      const R = mulberry32(777);
      for (let k = 0; k < 1400; k++) {
        const dark = R() < 0.6;
        p.fillStyle = dark ? 'rgba(70,48,22,' + (0.05 + R() * 0.07) + ')' : 'rgba(255,248,225,' + (0.05 + R() * 0.08) + ')';
        const s = 0.6 + R() * 1.6;
        p.fillRect(R() * 256, R() * 256, s, s);
      }
      p.lineCap = 'round';
      for (let k = 0; k < 70; k++) {
        const x = R() * 256, y = R() * 256, a = R() * TAU, L = 3 + R() * 9;
        p.strokeStyle = 'rgba(90,62,30,' + (0.04 + R() * 0.05) + ')';
        p.lineWidth = 0.6;
        p.beginPath(); p.moveTo(x, y); p.quadraticCurveTo(x + Math.cos(a + 0.6) * L * 0.5, y + Math.sin(a + 0.6) * L * 0.5, x + Math.cos(a) * L, y + Math.sin(a) * L); p.stroke();
      }
      this.paperCv = cv;
    }
    return c.createPattern(this.paperCv, 'repeat');
  },

  // ---------- запекание куска местности ----------
  bakeTerrain(r, cx, cy, tp) {
    const g = r.g, w = g.world, W = w.W, H = w.H, ter = w.terrain, st = this.st;
    this.ensureLines(r);
    const S = CH * tp, px = 1 / tp;
    const cv = document.createElement('canvas');
    cv.width = cv.height = S;
    const c = cv.getContext('2d');
    const X0 = cx * CH, Y0 = cy * CH, X1 = X0 + CH, Y1 = Y0 + CH;
    c.setTransform(tp, 0, 0, tp, -X0 * tp, -Y0 * tp);
    c.imageSmoothingEnabled = true;
    c.lineCap = 'round'; c.lineJoin = 'round';
    // есть ли рядом вода и суша
    const M = 3;
    let nLand = 0, nWater = 0;
    for (let y = Math.max(0, Y0 - M); y < Math.min(H, Y1 + M); y++) for (let x = Math.max(0, X0 - M); x < Math.min(W, X1 + M); x++) {
      if (ter[y * W + x] > T.SHALLOW) nLand++; else nWater++;
    }
    let coast = null;
    if (nWater) {
      c.drawImage(st.waterImg, 0, 0, W, H);
      this.drawSea(c, r, X0, Y0, X1, Y1, px);
      if (nLand) {
        coast = r.contour((x, y) => x >= X0 - M && y >= Y0 - M && x < X1 + M && y < Y1 + M && w.inside(x, y) && ter[y * W + x] > T.SHALLOW, X0 - M, Y0 - M, X1 + M, Y1 + M);
        this.drawRipples(c, coast, st.waterImg, px);
        c.save();
        c.clip(coast, 'evenodd');
        c.drawImage(st.landImg, 0, 0, W, H);
        c.restore();
      }
    } else c.drawImage(st.landImg, 0, 0, W, H);
    // бумажная фактура
    c.save();
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.fillStyle = this.paperPattern(c);
    c.fillRect(0, 0, S, S);
    c.restore();
    if (nLand) this.drawGround(c, w, X0, Y0, X1, Y1, px);
    this.drawRivers(c, X0, Y0, X1, Y1, px);
    this.drawRoads(c, X0, Y0, X1, Y1, px);
    if (coast) {
      c.strokeStyle = 'rgba(248,238,206,0.5)'; c.lineWidth = 0.17; c.stroke(coast);
      c.strokeStyle = 'rgba(52,38,22,0.8)'; c.lineWidth = Math.max(px * 1.3, 0.04); c.stroke(coast);
    }
    this.drawBridges(c, X0, Y0, X1, Y1, px);
    this.drawObjects(c, w, X0, Y0, X1, Y1, tp);
    return cv;
  },

  // Морские барашки в открытой воде.
  drawSea(c, r, X0, Y0, X1, Y1, px) {
    const w = this.st.w, W = w.W, depth = this.st.depth;
    c.beginPath();
    let any = false;
    for (let y = Math.max(0, Y0 - 1); y < Math.min(w.H, Y1 + 1); y++) for (let x = Math.max(0, X0 - 1); x < Math.min(W, X1 + 1); x++) {
      const i = y * W + x;
      if (depth[i] < 3) continue;
      if (this.hash(i, 3) > 0.1) continue;
      const ox = x + this.hash(i, 4) * 0.4, oy = y + 0.35 + this.hash(i, 5) * 0.4, s = 0.13 + this.hash(i, 6) * 0.05;
      c.moveTo(ox, oy);
      c.bezierCurveTo(ox + s * 0.4, oy - s * 0.32, ox + s * 0.6, oy - s * 0.32, ox + s, oy);
      c.bezierCurveTo(ox + s * 1.4, oy + s * 0.32, ox + s * 1.6, oy + s * 0.32, ox + s * 2, oy);
      c.bezierCurveTo(ox + s * 2.4, oy - s * 0.32, ox + s * 2.6, oy - s * 0.32, ox + s * 3, oy);
      any = true;
    }
    if (!any) return;
    c.strokeStyle = 'rgba(214,234,234,0.5)'; c.lineWidth = Math.max(px * 1.2, 0.03); c.stroke();
  },
  // Линии вдоль берега, как на старых картах: обводим берег всё уже и стираем середину цветом воды.
  drawRipples(c, coast, waterImg, px) {
    const pat = c.createPattern(waterImg, 'no-repeat');
    const lw = Math.max(px * 1.2, 0.03);
    const rings = [[0.78, 0.22], [0.5, 0.36], [0.27, 0.5]];
    for (const ring of rings) {
      c.strokeStyle = 'rgba(232,244,238,' + ring[1] + ')';
      c.lineWidth = ring[0] * 2 + lw; c.stroke(coast);
      c.strokeStyle = pat;
      c.lineWidth = ring[0] * 2 - lw; c.stroke(coast);
    }
    c.strokeStyle = 'rgba(236,246,238,0.35)';
    c.lineWidth = 0.26; c.stroke(coast);
  },
  // Трава, цветы, песок, камыши — мелочь одним путём на вид.
  drawGround(c, w, X0, Y0, X1, Y1, px) {
    const W = w.W, ter = w.terrain, st = this.st, h = this.hash.bind(this);
    const tufts = new Path2D(), sand = new Path2D(), pebbles = new Path2D();
    const flowers = [new Path2D(), new Path2D(), new Path2D(), new Path2D()];
    const tuft = (p, x, y, s) => {
      p.moveTo(x - 0.07 * s, y); p.lineTo(x - 0.1 * s, y - 0.1 * s);
      p.moveTo(x, y); p.lineTo(x - 0.01 * s, y - 0.14 * s);
      p.moveTo(x + 0.07 * s, y); p.lineTo(x + 0.11 * s, y - 0.09 * s);
    };
    for (let y = Math.max(0, Y0 - 1); y < Math.min(w.H, Y1 + 1); y++) for (let x = Math.max(0, X0 - 1); x < Math.min(W, X1 + 1); x++) {
      const i = y * W + x, t = ter[i];
      if (t <= T.SHALLOW || st.clear[i] || w.road[i]) continue;
      if (t === T.PLAINS || t === T.HILLS) {
        const nT = h(i, 30) < (t === T.PLAINS ? 0.42 : 0.3) ? 1 + (h(i, 33) < 0.35 ? 1 : 0) : 0;
        for (let k = 0; k < nT; k++) tuft(tufts, x + 0.15 + h(i, 31 + k * 7) * 0.7, y + 0.3 + h(i, 32 + k * 7) * 0.6, 0.8 + h(i, 34 + k) * 0.5);
        if (t === T.PLAINS && h(i, 40) < 0.08) {
          const fp = flowers[Math.floor(h(i, 41) * 4)];
          const fx = x + 0.2 + h(i, 42) * 0.5, fy = y + 0.25 + h(i, 43) * 0.5;
          for (let k = 0; k < 5; k++) {
            const ax = fx + (h(i, 50 + k) - 0.5) * 0.4, ay = fy + (h(i, 60 + k) - 0.5) * 0.3, rr = 0.022 + h(i, 70 + k) * 0.012;
            fp.moveTo(ax + rr, ay); fp.arc(ax, ay, rr, 0, TAU);
          }
        }
      } else if (t === T.BEACH) {
        for (let k = 0; k < 7; k++) {
          const sx = x + h(i, 80 + k), sy = y + h(i, 90 + k), rr = 0.012 + h(i, 100 + k) * 0.01;
          sand.moveTo(sx + rr, sy); sand.arc(sx, sy, rr, 0, TAU);
        }
        if (h(i, 110) < 0.12) {
          const sx = x + 0.2 + h(i, 111) * 0.6, sy = y + 0.2 + h(i, 112) * 0.6;
          pebbles.moveTo(sx + 0.06, sy); pebbles.ellipse(sx, sy, 0.06, 0.04, 0, 0, TAU);
          pebbles.moveTo(sx + 0.13, sy + 0.05); pebbles.ellipse(sx + 0.09, sy + 0.05, 0.04, 0.028, 0, 0, TAU);
        }
      }
    }
    // камыши у рек
    const reeds = new Path2D();
    for (const rv of st.rivers) {
      if (rv.x1 < X0 - 1 || rv.x0 > X1 + 1 || rv.y1 < Y0 - 1 || rv.y0 > Y1 + 1) continue;
      for (let k = 0; k < rv.reeds.length; k += 2) {
        const x = rv.reeds[k], y = rv.reeds[k + 1];
        if (x < X0 - 1 || x > X1 + 1 || y < Y0 - 1 || y > Y1 + 1) continue;
        reeds.moveTo(x - 0.05, y + 0.02); reeds.lineTo(x - 0.08, y - 0.12);
        reeds.moveTo(x, y + 0.02); reeds.lineTo(x, y - 0.16);
        reeds.moveTo(x + 0.05, y + 0.02); reeds.lineTo(x + 0.09, y - 0.11);
      }
    }
    c.lineWidth = Math.max(px * 1.1, 0.03);
    c.strokeStyle = 'rgba(78,96,40,0.6)'; c.stroke(tufts);
    c.strokeStyle = 'rgba(60,84,46,0.85)'; c.stroke(reeds);
    c.fillStyle = 'rgba(120,92,48,0.28)'; c.fill(sand);
    c.fillStyle = '#a59c8a'; c.fill(pebbles);
    c.strokeStyle = 'rgba(42,27,13,0.6)'; c.lineWidth = px; c.stroke(pebbles);
    const fc = ['#f3eedf', '#e9c94a', '#c8553d', '#8a92c8'];
    for (let k = 0; k < 4; k++) { c.fillStyle = fc[k]; c.fill(flowers[k]); }
  },
  drawRivers(c, X0, Y0, X1, Y1, px) {
    const st = this.st;
    const list = st.rivers.filter(rv => !(rv.x1 < X0 - 1 || rv.x0 > X1 + 1 || rv.y1 < Y0 - 1 || rv.y0 > Y1 + 1));
    if (!list.length) return;
    const pass = (add, mul, color) => {
      c.strokeStyle = color;
      for (const rv of list) {
        const xs = rv.xs, ys = rv.ys, n = xs.length;
        let curW = -1, open = false;
        for (let k = 0; k < n - 1; k++) {
          const out = Math.max(xs[k], xs[k + 1]) < X0 - 1 || Math.min(xs[k], xs[k + 1]) > X1 + 1 || Math.max(ys[k], ys[k + 1]) < Y0 - 1 || Math.min(ys[k], ys[k + 1]) > Y1 + 1;
          if (out) { if (open) { c.stroke(); open = false; } continue; }
          const lw = Math.round((rv.ws[k] * mul + add) * 50) / 50;
          if (!open || lw !== curW) {
            if (open) c.stroke();
            c.lineWidth = Math.max(lw, px); curW = lw;
            c.beginPath(); c.moveTo(xs[k], ys[k]); open = true;
          }
          c.lineTo(xs[k + 1], ys[k + 1]);
        }
        if (open) c.stroke();
      }
    };
    pass(0.07, 1, 'rgba(50,70,66,0.8)');
    pass(0, 1, '#6aa3b7');
    pass(-0.04, 0.45, 'rgba(160,204,216,0.55)');
  },
  drawRoads(c, X0, Y0, X1, Y1, px) {
    const list = this.st.roads.filter(rd => !(rd.x1 < X0 - 1 || rd.x0 > X1 + 1 || rd.y1 < Y0 - 1 || rd.y0 > Y1 + 1));
    if (!list.length) return;
    c.strokeStyle = 'rgba(92,64,34,0.82)'; c.lineWidth = 0.2;
    for (const rd of list) c.stroke(rd.p);
    c.strokeStyle = '#cdb07b'; c.lineWidth = 0.13;
    for (const rd of list) c.stroke(rd.p);
    c.setLineDash([0.16, 0.14]);
    c.strokeStyle = 'rgba(132,96,52,0.45)'; c.lineWidth = Math.max(px, 0.025);
    for (const rd of list) c.stroke(rd.p);
    c.setLineDash([]);
  },
  drawBridges(c, X0, Y0, X1, Y1, px) {
    for (const b of this.st.bridges) {
      if (b.x < X0 - 1.5 || b.x > X1 + 1.5 || b.y < Y0 - 1.5 || b.y > Y1 + 1.5) continue;
      c.save();
      c.translate(b.x, b.y); c.rotate(b.ang);
      const L = b.len, hw = 0.11;
      if (b.f < 0.28) {
        // брод: светлая отмель и камни поперёк течения
        c.fillStyle = 'rgba(196,224,226,0.75)';
        c.beginPath(); c.ellipse(0, 0, 0.32, 0.16, 0, 0, TAU); c.fill();
        c.fillStyle = '#a49c8c'; c.strokeStyle = 'rgba(42,27,13,0.7)'; c.lineWidth = px;
        for (let k = 0; k < 4; k++) {
          c.beginPath(); c.ellipse(-0.18 + k * 0.12, (k % 2 ? 0.04 : -0.03), 0.045, 0.035, 0, 0, TAU); c.fill(); c.stroke();
        }
      } else if (b.f < 0.6) {
        // деревянный мост
        c.fillStyle = 'rgba(30,40,40,0.3)'; c.fillRect(-L / 2 + 0.03, -hw + 0.05, L, hw * 2);
        c.fillStyle = '#9c7547'; c.fillRect(-L / 2, -hw, L, hw * 2);
        c.strokeStyle = 'rgba(60,40,20,0.55)'; c.lineWidth = px;
        c.beginPath();
        for (let x = -L / 2 + 0.06; x < L / 2; x += 0.07) { c.moveTo(x, -hw); c.lineTo(x, hw); }
        c.stroke();
        c.strokeStyle = '#5b3e22'; c.lineWidth = Math.max(px * 1.6, 0.035);
        c.beginPath(); c.moveTo(-L / 2, -hw); c.lineTo(L / 2, -hw); c.moveTo(-L / 2, hw); c.lineTo(L / 2, hw); c.stroke();
        c.fillStyle = '#4a321b';
        for (const sx of [-L / 2, L / 2]) for (const sy of [-hw, hw]) c.fillRect(sx - 0.025, sy - 0.025, 0.05, 0.05);
      } else {
        // каменный мост с парапетами
        c.fillStyle = 'rgba(30,40,40,0.32)'; c.fillRect(-L / 2 + 0.03, -hw - 0.02 + 0.06, L, hw * 2 + 0.04);
        c.fillStyle = '#c9bea8'; c.fillRect(-L / 2, -hw, L, hw * 2);
        c.fillStyle = '#8f8573';
        c.fillRect(-L / 2, -hw - 0.035, L, 0.045); c.fillRect(-L / 2, hw - 0.01, L, 0.045);
        c.strokeStyle = 'rgba(42,27,13,0.75)'; c.lineWidth = px * 1.2;
        c.strokeRect(-L / 2, -hw - 0.035, L, hw * 2 + 0.07);
        c.beginPath(); c.moveTo(-L / 2, -hw + 0.01); c.lineTo(L / 2, -hw + 0.01); c.moveTo(-L / 2, hw - 0.01); c.lineTo(L / 2, hw - 0.01); c.stroke();
      }
      c.restore();
    }
  },

  // Деревья, холмы, горы: собираем всё, что может залезть в кусок, и рисуем сверху вниз.
  drawObjects(c, w, X0, Y0, X1, Y1, tp) {
    const W = w.W, ter = w.terrain, st = this.st, h = this.hash.bind(this), px = 1 / tp;
    const S = this.stampsFor(tp);
    const objs = [];
    const shadows = new Path2D();
    const isMt = (x, y) => w.inside(x, y) && ter[y * W + x] >= T.MOUNTAIN;
    const tree = (set, x, y, k) => {
      objs.push({ y, x, s: set[Math.floor(k * set.length)] });
      shadows.moveTo(x + 0.25, y - 0.02); shadows.ellipse(x + 0.08, y - 0.02, 0.17, 0.06, 0, 0, TAU);
    };
    for (let y = Math.max(0, Y0 - 1); y < Math.min(w.H, Y1 + 2); y++) for (let x = Math.max(0, X0 - 2); x < Math.min(W, X1 + 2); x++) {
      const i = y * W + x, t = ter[i], cl = st.clear[i];
      if (t <= T.SHALLOW) continue;
      if (t === T.FOREST) {
        if (cl || w.river[i]) continue;
        // редеет к опушке
        let edge = 0;
        if (x > 0 && ter[i - 1] !== T.FOREST) edge++;
        if (x < W - 1 && ter[i + 1] !== T.FOREST) edge++;
        if (y > 0 && ter[i - W] !== T.FOREST) edge++;
        if (y < w.H - 1 && ter[i + W] !== T.FOREST) edge++;
        // хвойные и лиственные рощи пятнами
        const con = clamp(0.3 + 1.7 * (fractal(st.conNoise, x / 7, y / 7, 2) - 0.5), 0.04, 0.94);
        for (let k = 0; k < 6; k++) {
          if (h(i, 120 + k) < 0.05 + edge * 0.13) continue;
          const tx = x + 0.2 + (k % 3) * 0.3 + (h(i, 130 + k) - 0.5) * 0.22, ty = y + 0.36 + (k >= 3 ? 0.46 : 0) + (k % 2) * 0.08 + (h(i, 140 + k) - 0.5) * 0.16;
          const v = h(i, 150 + k);
          tree(v < con ? S.fir : h(i, 160 + k) < 0.1 ? S.poplar : S.leaf, tx, ty, h(i, 170 + k));
        }
      } else if (t === T.HILLS) {
        if (cl || w.road[i]) continue;
        const n = 1 + Math.floor(h(i, 200) * 2.4);
        for (let k = 0; k < n; k++) {
          const mx = x + 0.5 + (h(i, 201 + k) - 0.5) * 0.8, my = y + 0.45 + h(i, 203 + k) * 0.5;
          const big = n === 1 ? 0.5 : 0;
          objs.push({ y: my, x: mx, s: S.mound[Math.min(S.mound.length - 1, Math.floor((big + h(i, 205 + k) * 0.7) * S.mound.length))] });
        }
        if (h(i, 207) < 0.22) tree(S.fir, x + 0.2 + h(i, 208) * 0.6, y + 0.85 + h(i, 210) * 0.1, h(i, 209));
      } else if (t === T.MOUNTAIN || t === T.SNOW) {
        if (cl === 2 || w.road[i]) {
          if (cl !== 2) objs.push({ y: y + 0.7, x: x + 0.3, s: S.mound[Math.floor(h(i, 205) * 4)] });
          continue;
        }
        let nb = 0;
        for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) if ((dx || dy) && isMt(x + dx, y + dy)) nb++;
        const snow = t === T.SNOW;
        // в глубине хребта — крупные вершины, по краям — помельче, плюс предгорья
        const big = nb >= 6 && h(i, 101) < 0.34;
        const hh = big ? (snow ? 1.55 : 1.22) + h(i, 106) * 0.4 : (snow ? 1.0 : 0.66) + h(i, 106) * 0.3 + nb * 0.025;
        const mx = x + 0.5 + (h(i, 100) - 0.5) * 0.62, base = y + 0.55 + h(i, 107) * 0.5;
        if (big || h(i, 108) > 0.16) objs.push({ y: base, x: mx, peak: { h: hh, wd: hh * (0.56 + h(i, 102) * 0.22), snow: snow || hh > 1.18, cap: snow ? 0.5 : 0.32, seed: i } });
        if (nb < 8 && h(i, 103) < 0.6) {
          const sh = 0.32 + h(i, 104) * 0.26;
          objs.push({ y: y + 0.9 + h(i, 109) * 0.12, x: x + 0.15 + h(i, 105) * 0.7, peak: { h: sh, wd: sh * 0.8, snow: false, seed: i * 7 + 3 } });
        }
      } else if (t === T.PLAINS || t === T.BEACH) {
        if (cl || w.road[i] || w.river[i]) continue;
        const v = h(i, 220);
        if (t === T.PLAINS && v < 0.035) tree(S.leaf, x + 0.25 + h(i, 221) * 0.5, y + 0.4 + h(i, 222) * 0.45, h(i, 223));
        else if (t === T.PLAINS && v < 0.05) tree(S.poplar, x + 0.25 + h(i, 221) * 0.5, y + 0.4 + h(i, 222) * 0.45, h(i, 223));
        else if (v < (t === T.PLAINS ? 0.11 : 0.05)) objs.push({ y: y + 0.3 + h(i, 225) * 0.6, x: x + 0.2 + h(i, 224) * 0.6, s: S.bush[Math.floor(h(i, 226) * S.bush.length)] });
      }
    }
    c.fillStyle = 'rgba(40,46,20,0.2)';
    c.fill(shadows);
    objs.sort((a, b) => a.y - b.y || a.x - b.x);
    for (const o of objs) {
      if (o.peak) this.drawPeak(c, o.x, o.y, o.peak, px);
      else this.blit(c, o.s, o.x, o.y, tp);
    }
  },
  // Гора: освещённый левый склон, теневой правый со штриховкой, гребень, снежная шапка.
  drawPeak(c, mx, base, o, px) {
    const R = mulberry32(o.seed * 7919 + 13);
    const h = o.h, wd = o.wd;
    const ax = mx + (R() - 0.5) * wd * 0.35, ay = base - h;
    const L = mx - wd, Rr = mx + wd;
    const lsx = mx - wd * (0.5 + R() * 0.12), lsy = base - h * (0.38 + R() * 0.18);
    const rsx = mx + wd * (0.45 + R() * 0.12), rsy = base - h * (0.36 + R() * 0.16);
    const r1x = ax + wd * (0.08 + R() * 0.1), r1y = base - h * (0.5 + R() * 0.12);
    const r2x = mx + wd * (0.12 + R() * 0.15);
    const rock = o.snow ? ['#cfc8b6', '#958c7a'] : ['#c2b294', '#8b7a60'];
    c.fillStyle = rock[0];
    c.beginPath(); c.moveTo(L, base); c.lineTo(lsx, lsy); c.lineTo(ax, ay); c.lineTo(r1x, r1y); c.lineTo(r2x, base); c.closePath(); c.fill();
    c.fillStyle = rock[1];
    c.beginPath(); c.moveTo(ax, ay); c.lineTo(rsx, rsy); c.lineTo(Rr, base); c.lineTo(r2x, base); c.lineTo(r1x, r1y); c.closePath(); c.fill();
    // штриховка теневого склона
    c.strokeStyle = 'rgba(42,27,13,0.32)'; c.lineWidth = px * 1.1;
    c.beginPath();
    for (let k = 1; k <= 4; k++) {
      const t = k / 5;
      const sx = lerp(r1x, r2x, t * 0.9) + 0.02, sy = lerp(r1y, base, t * 0.9);
      const ex = lerp(sx, Rr, 0.45), ey = lerp(sy, base, 0.35);
      c.moveTo(sx, sy); c.lineTo(ex, ey);
    }
    c.stroke();
    if (o.snow) {
      const k1 = o.cap + R() * 0.1, k2 = o.cap - 0.04 + R() * 0.1;
      const lx = lerp(ax, lsx, k1 * 1.6), ly = lerp(ay, lsy, k1 * 1.6);
      const rx = lerp(ax, rsx, k2 * 1.6), ry = lerp(ay, rsy, k2 * 1.6);
      const ridx = lerp(ax, r1x, 0.75), ridy = lerp(ay, r1y, 0.75);
      c.fillStyle = '#f5f2ea';
      c.beginPath(); c.moveTo(ax, ay); c.lineTo(lx, ly);
      c.lineTo(lerp(lx, ridx, 0.35), lerp(ly, ridy, 0.35) - h * 0.06); c.lineTo(lerp(lx, ridx, 0.65), lerp(ly, ridy, 0.65) + h * 0.03);
      c.lineTo(ridx, ridy); c.closePath(); c.fill();
      c.fillStyle = '#c4ccd2';
      c.beginPath(); c.moveTo(ax, ay); c.lineTo(ridx, ridy);
      c.lineTo(lerp(ridx, rx, 0.5), lerp(ridy, ry, 0.5) - h * 0.05); c.lineTo(rx, ry); c.closePath(); c.fill();
    }
    c.strokeStyle = 'rgba(42,27,13,0.5)'; c.lineWidth = px * 1.1;
    c.beginPath(); c.moveTo(ax, ay); c.lineTo(r1x, r1y); c.lineTo(r2x, base - h * 0.05); c.stroke();
    c.strokeStyle = 'rgba(42,27,13,0.88)'; c.lineWidth = px * 1.5;
    c.beginPath(); c.moveTo(L, base); c.lineTo(lsx, lsy); c.lineTo(ax, ay); c.lineTo(rsx, rsy); c.lineTo(Rr, base); c.stroke();
  },
};
