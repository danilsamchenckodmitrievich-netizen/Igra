'use strict';
// Графика мира: подробные города, укрепления, деревья, горы и прочие детали карты.
// Рисует в offscreen canvas с кэшем; render.js вызывает отсюда готовые картинки.
// Местность запекается кусками (bakeTerrain), города — спрайтами по ключу состояния (citySprite).

const WA_INK = '#2a1b0d';

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
    // поляны вокруг городов (место для полей и промыслов): 1 — без деревьев и холмов, 2 — без гор
    const clear = new Uint8Array(n);
    for (const c of g.cities) {
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const x = c.x + dx, y = c.y + dy;
        if (!w.inside(x, y)) continue;
        const d = Math.hypot(dx, dy), i = y * W + x;
        if (d <= 1.05) clear[i] = 2;
        else if (d <= 2.25 && !clear[i]) clear[i] = 1;
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

  // ---------- города ----------
  // Постоянная раскладка города: ворота к ближайшей дороге, стороны для полей, лесопилки, каменоломни, рудника и стройки.
  cityPlan(c) {
    let p = this.plans.get(c.id);
    if (p) return p;
    const w = this.st.w, W = w.W, ter = w.terrain;
    let gate = Math.PI / 2, bd = 1e9;
    for (let dy = -4; dy <= 4; dy++) for (let dx = -4; dx <= 4; dx++) {
      const d = Math.hypot(dx, dy), x = c.x + dx, y = c.y + dy;
      if (d < 1 || d > 4.2 || !w.inside(x, y) || !w.road[y * W + x]) continue;
      if (d < bd) { bd = d; gate = Math.atan2(dy, dx); }
    }
    // оценка восьми сторон по местности вокруг
    const sc = [];
    for (let k = 0; k < 8; k++) {
      const a = k / 8 * TAU, s = { a, plain: 0, forest: 0, rock: 0, water: 0 };
      for (let d = 1.5; d <= 3; d += 0.75) for (let e = -0.35; e <= 0.36; e += 0.35) {
        const x = Math.floor(c.x + 0.5 + Math.cos(a + e) * d), y = Math.floor(c.y + 0.5 + Math.sin(a + e) * d);
        if (!w.inside(x, y)) { s.water++; continue; }
        const t = ter[y * W + x];
        if (t <= T.SHALLOW) s.water++;
        else if (t === T.FOREST) s.forest++;
        else if (t >= T.HILLS) s.rock += t === T.HILLS ? 1 : 1.5;
        else s.plain++;
      }
      sc.push(s);
    }
    const near = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
    const taken = [];
    const pick = f => {
      let best = null, bv = -1e9;
      for (const s of sc) {
        if (near(s.a, gate) < 0.6 || taken.some(a => near(a, s.a) < 0.7)) continue;
        // снизу под городом подпись — туда промыслы ставим неохотно
        const v = f(s) - s.water * 3 - (Math.sin(s.a) > 0.9 ? 0.8 : 0) + this.hash(c.id * 8 + Math.round(s.a * 2), 9) * 0.5;
        if (v > bv) { bv = v; best = s.a; }
      }
      if (best === null) best = gate + Math.PI;
      taken.push(best);
      return best;
    };
    p = { gate };
    p.farm = pick(s => s.plain * 1.2 - s.forest * 0.3);
    p.lumber = pick(s => s.forest * 1.5);
    p.quarry = pick(s => s.rock * 1.4);
    p.mine = pick(s => s.rock * 1.4);
    p.crane = pick(() => 0);
    this.plans.set(c.id, p);
    return p;
  },

  // Перед рисованием городов в кадре: бюджет перерисовок и уборка давно не видных спрайтов.
  beginCities(r) {
    this.budget = r.frame < 3 ? 99 : 2;
    if (r.frame % 300 === 0) {
      for (const [id, rec] of this.sprites) if (rec.used < r.frame - 900) this.sprites.delete(id);
    }
  },
  // Спрайт города по ключу состояния. Пока бюджет кадра исчерпан, показываем прежний спрайт.
  citySprite(r, c, dppt) {
    const ppt = dppt <= 40 ? 32 : dppt <= 80 ? 64 : 128;
    const k = r.g.kingdom(c.owner), col = k ? k.color : NEUTRAL_COLOR;
    let dmg = 0;
    if (c.walls > 0) {
      const f = c.wallHp / WALLS[c.walls].hp;
      dmg = f <= 0 ? 3 : f < 0.4 ? 2 : f < 0.75 ? 1 : 0;
    }
    const b = c.buildings || {};
    const key = ppt + '|' + c.level + '|' + c.walls + '|' + c.towers + '|' + (c.isCapital ? 1 : 0) + '|' + col + '|' + dmg + '|' +
      (c.siegeBy ? 1 : 0) + '|' + (c.construction ? 1 : 0) + '|' + (b.farm || 0) + (b.lumber || 0) + (b.quarry || 0) + (b.mine || 0) + (b.market ? 1 : 0);
    let rec = this.sprites.get(c.id);
    if (rec) {
      rec.used = r.frame;
      if (rec.key === key || this.budget <= 0) return rec.spr;
    }
    this.budget--;
    const spr = this.renderCity(r, c, ppt, col, dmg);
    if (!rec) { rec = {}; this.sprites.set(c.id, rec); }
    rec.key = key; rec.spr = spr; rec.used = r.frame;
    return spr;
  },

  renderCity(r, c, tp, col, dmg) {
    const R = r.cityRadius(c), K = 0.8;
    const X = R + 1.5, top = R * K + 1.45, bot = R * K + 1.2;
    const cv = document.createElement('canvas');
    cv.width = Math.ceil(2 * X * tp); cv.height = Math.ceil((top + bot) * tp);
    const g = cv.getContext('2d');
    g.setTransform(tp, 0, 0, tp, X * tp, top * tp);
    g.lineJoin = 'round'; g.lineCap = 'round';
    const px = 1 / tp;
    const o = {
      c: g, R, K, px, lw: Math.max(px * 1.15, 0.014), city: c, plan: this.cityPlan(c), col, dmg,
      rnd: mulberry32(c.id * 7919 + 17), flag: null, back: [], front: [],
    };
    this.drawOutskirts(o);
    this.drawTownGround(o);
    this.layoutTown(o);
    // всё, что за серединой стены, рисуем раньше домов; что перед ней — позже
    this.drawWallHalf(o, false);
    o.back.sort((a, b) => a.y - b.y);
    for (const it of o.back) it.fn();
    o.front.sort((a, b) => a.y - b.y);
    for (const it of o.front) it.fn();
    this.drawWallHalf(o, true);
    if (o.late) for (const it of o.late.sort((a, b) => a.y - b.y)) it.fn();
    if (c.siegeBy) this.drawSiegeFire(o);
    if (!o.flag) o.flag = { x: R * 0.35, y: -R * K * 0.2, s: 0.8 };
    return { cv, x0: -X, y0: -top, w: cv.width / tp, h: cv.height / tp, flag: o.flag };
  },
  ringPt(o, a, rr) { return [Math.cos(a) * rr, Math.sin(a) * rr * o.K]; },
  angNear(a, b) { return Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b))); },
  ink(o, a) { o.c.strokeStyle = 'rgba(42,27,13,' + (a || 0.85) + ')'; o.c.lineWidth = o.lw; o.c.stroke(); },
  poly(o, pts, fill, inkA) {
    const c = o.c;
    c.beginPath(); c.moveTo(pts[0], pts[1]);
    for (let k = 2; k < pts.length; k += 2) c.lineTo(pts[k], pts[k + 1]);
    c.closePath();
    if (fill) { c.fillStyle = fill; c.fill(); }
    if (inkA !== 0) this.ink(o, inkA);
  },

  // Утоптанная земля под городом, улица к воротам, площадь.
  drawTownGround(o) {
    const c = o.c, R = o.R, K = o.K, city = o.city;
    const gr = c.createRadialGradient(0, 0, R * 0.2, 0, 0, R * 1.18);
    gr.addColorStop(0, 'rgba(204,182,132,0.95)'); gr.addColorStop(0.75, 'rgba(198,176,124,0.8)'); gr.addColorStop(1, 'rgba(190,170,120,0)');
    c.save(); c.scale(1, K);
    c.fillStyle = gr; c.beginPath(); c.arc(0, 0, R * 1.18, 0, TAU); c.fill();
    c.restore();
    // улица от середины к воротам и дальше к дороге
    const ga = o.plan.gate, e = this.ringPt(o, ga, R + 0.3);
    c.strokeStyle = 'rgba(110,80,44,0.45)'; c.lineWidth = 0.1;
    c.beginPath(); c.moveTo(0, 0); c.lineTo(e[0], e[1]); c.stroke();
    c.strokeStyle = '#d6c08f'; c.lineWidth = 0.065; c.stroke();
    if (city.level >= 3) {
      const pr = R * 0.26;
      c.save(); c.scale(1, K);
      c.beginPath(); c.arc(0, 0, pr, 0, TAU);
      c.fillStyle = '#ddd0b0'; c.fill();
      c.strokeStyle = 'rgba(42,27,13,0.4)'; c.lineWidth = o.lw; c.stroke();
      c.restore();
      if (!city.buildings.market) {
        // колодец посреди площади
        o.front.push({ y: 0, fn: () => {
          c.fillStyle = '#9d9483'; c.beginPath(); c.ellipse(0, 0, 0.045, 0.03, 0, 0, TAU); c.fill(); this.ink(o, 0.8);
          c.fillStyle = '#3c5560'; c.beginPath(); c.ellipse(0, -0.004, 0.026, 0.016, 0, 0, TAU); c.fill();
        } });
      }
    }
  },

  // Раскладка застройки: замок, церковь, дома, огороды, лавки, стройка; всё складывается в списки по y.
  layoutTown(o) {
    const city = o.city, R = o.R, K = o.K, lv = city.level, rnd = o.rnd;
    const spots = [];
    const free = (x, y, r) => {
      for (const s of spots) if (Math.hypot(s.x - x, (s.y - y) * 1.25) < s.r + r) return false;
      return true;
    };
    const reserve = (x, y, r) => spots.push({ x, y, r });
    const ga = o.plan.gate;
    // улица к воротам остаётся свободной
    for (let t = 0.15; t < 1.1; t += 0.14) reserve(Math.cos(ga) * R * t, Math.sin(ga) * R * K * t, 0.05);
    if (lv >= 3) reserve(0, 0, R * 0.26);
    const castle = city.isCapital || lv >= 4;
    if (castle) {
      const kx = -R * 0.12, ky = -R * K * 0.42;
      reserve(kx + 0.06, ky - 0.04, lv >= 4 ? 0.3 : 0.2);
      this.push(o, ky, () => this.drawCastle(o, kx, ky, lv >= 4, city.isCapital));
    }
    if (lv >= 2) {
      const big = lv >= 4;
      const chx = castle ? R * 0.42 : -R * 0.3, chy = castle ? -R * K * 0.05 : -R * K * 0.12;
      reserve(chx + 0.08, chy - 0.04, big ? 0.24 : 0.17);
      this.push(o, chy, () => this.drawChurch(o, chx, chy, big));
    }
    if (city.buildings.market) {
      const n = 1 + Math.min(2, city.buildings.market);
      for (let k = 0; k < n; k++) {
        const a = -2.2 + k * 1.3, sx = Math.cos(a) * R * (lv >= 3 ? 0.16 : 0.3), sy = Math.sin(a) * R * K * (lv >= 3 ? 0.16 : 0.3) + 0.03;
        reserve(sx, sy, 0.06);
        this.push(o, sy, () => this.drawStall(o, sx, sy, k));
      }
    }
    // дома
    const nH = [0, 6, 10, 16, 23, 30][lv];
    const thatchP = [0, 1, 0.6, 0.15, 0.05, 0][lv];
    const wMin = lv <= 1 ? 0.15 : lv === 2 ? 0.14 : 0.12, wVar = lv <= 2 ? 0.05 : 0.045;
    const rr = city.walls > 0 ? R * 0.84 : R * 0.95;
    let placed = 0;
    for (let t = 0; t < nH * 14 && placed < nH; t++) {
      const a = rnd() * TAU, d = Math.sqrt(rnd()) * rr;
      const x = Math.cos(a) * d, y = Math.sin(a) * d * K + 0.04;
      const wd = wMin + rnd() * wVar;
      if (!free(x, y - wd * 0.2, wd * 0.62)) continue;
      reserve(x, y - wd * 0.2, wd * 0.62);
      placed++;
      const long = rnd() < 0.55;
      const pal = rnd() < thatchP ? 0 : lv >= 3 && rnd() < 0.18 ? 3 : 1 + (rnd() < 0.5 ? 1 : 0);
      const spec = { w: long ? wd : wd * 0.72, d: long ? wd * 0.55 : wd * 0.85, hw: wd * (0.36 + rnd() * 0.1), hr: wd * (0.42 + rnd() * 0.12), long, pal, chim: rnd() < 0.6, plaster: Math.floor(rnd() * 3), timber: lv >= 2 && rnd() < 0.35 };
      this.push(o, y, () => this.drawHouse(o, x, y, spec));
      // огороды у деревенских домов
      if (lv <= 2 && rnd() < (lv === 1 ? 0.7 : 0.35)) {
        const gx = x + (rnd() < 0.5 ? -1 : 1) * wd * 0.95, gy = y + 0.06;
        if (free(gx, gy, 0.07)) { reserve(gx, gy, 0.07); this.push(o, gy - 0.1, () => this.drawGarden(o, gx, gy)); }
      }
    }
    if (city.construction) {
      const a = o.plan.crane, p = this.ringPt(o, a, R + (city.walls ? 0.32 : 0.1));
      this.push(o, p[1], () => this.drawCrane(o, p[0], p[1]), true);
    }
  },
  // В список «за стеной» или «перед стеной» по положению; late — поверх всего.
  push(o, y, fn, late) {
    if (late) { (o.late || (o.late = [])).push({ y, fn }); return; }
    (y < 0 ? o.back : o.front).push({ y, fn });
  },

  // Дом в три четверти: глубина уходит вправо-вверх. long — конёк вдоль фасада, иначе — щипцом к нам.
  roofPal: [
    ['#d9bb6b', '#b8973f', '#8d7130'],
    ['#c86e48', '#a24f33', '#7b3a25'],
    ['#b85a3e', '#8f412b', '#6a3020'],
    ['#8e97a5', '#6c7482', '#4f5663'],
  ],
  plasterPal: ['#ece2c8', '#e5d5b2', '#dccaa4'],
  drawHouse(o, x, y, s) {
    const c = o.c, w = s.w, hw = s.hw, hr = s.hr;
    const dx = s.d * 0.55, dy = -s.d * 0.5;
    const x0 = x - w / 2, x1 = x + w / 2, ya = y - hw, xm = x;
    const rf = this.roofPal[s.pal], pl = this.plasterPal[s.plaster], side = this.shade(pl, 0.74);
    // тень вправо-вниз
    c.fillStyle = 'rgba(52,36,16,0.26)';
    c.beginPath(); c.moveTo(x0 + 0.02, y + 0.01); c.lineTo(x1 + 0.06, y + 0.025); c.lineTo(x1 + dx + 0.06, y + dy + 0.025); c.lineTo(x1 + dx, y + dy); c.closePath(); c.fill();
    if (s.long) {
      const rx0 = x0 + dx / 2, rx1 = x1 + dx / 2, ry = ya + dy / 2 - hr;
      this.poly(o, [x1, y, x1 + dx, y + dy, x1 + dx, ya + dy, rx1, ry, x1, ya], side);
      this.poly(o, [x0, y, x1, y, x1, ya, x0, ya], pl);
      if (s.timber) { c.beginPath(); c.moveTo(x0 + w * 0.33, y); c.lineTo(x0 + w * 0.33, ya); c.moveTo(x0 + w * 0.66, y); c.lineTo(x0 + w * 0.66, ya); c.moveTo(x0, ya + hw * 0.45); c.lineTo(x1, ya + hw * 0.45); this.ink(o, 0.45); }
      this.poly(o, [x0 - 0.008, ya + 0.006, x1 + 0.006, ya + 0.006, rx1, ry, rx0, ry], rf[0]);
      c.fillStyle = this.alpha(rf[2], 0.35);
      c.beginPath(); c.moveTo(x0 - 0.008, ya + 0.006); c.lineTo(x1 + 0.006, ya + 0.006); c.lineTo(x1 + 0.006, ya - hr * 0.15); c.lineTo(x0 - 0.008, ya - hr * 0.15); c.fill();
      if (s.pal === 0) { c.beginPath(); for (let k = 1; k < 4; k++) { const t = k / 4; c.moveTo(lerp(x0, rx0, t), lerp(ya, ry, t)); c.lineTo(lerp(x1, rx1, t), lerp(ya, ry, t)); } this.ink(o, 0.22); }
      c.beginPath(); c.moveTo(rx0, ry); c.lineTo(rx1, ry); c.strokeStyle = this.alpha(rf[2], 0.9); c.lineWidth = o.lw * 1.4; c.stroke();
      if (s.chim) this.chimney(o, lerp(x0, rx0, 0.5) + w * 0.72, lerp(ya, ry, 0.55), w);
      this.door(o, x0 + w * 0.42, y, w);
    } else {
      const ry = ya - hr;
      this.poly(o, [xm, ry, xm + dx, ry + dy, x0 + dx, ya + dy, x0, ya], rf[0]);
      this.poly(o, [x1, y, x1 + dx, y + dy, x1 + dx, ya + dy, x1, ya], side);
      this.poly(o, [xm, ry, xm + dx, ry + dy, x1 + dx + 0.006, ya + dy + 0.004, x1 + 0.006, ya + 0.004], rf[1]);
      if (s.pal === 0) { c.beginPath(); for (let k = 1; k < 3; k++) { const t = k / 3; c.moveTo(lerp(xm, x1, t), lerp(ry, ya, t)); c.lineTo(lerp(xm + dx, x1 + dx, t), lerp(ry + dy, ya + dy, t)); } this.ink(o, 0.22); }
      this.poly(o, [x0, y, x1, y, x1, ya, xm, ry, x0, ya], pl);
      if (s.timber) { c.beginPath(); c.moveTo(x0, ya); c.lineTo(x1, ya); c.moveTo(xm, ry); c.lineTo(xm, y - hw * 0.5); this.ink(o, 0.45); }
      if (s.chim) this.chimney(o, lerp(xm, x1, 0.45) + dx * 0.6, lerp(ry, ya, 0.45) + dy * 0.6, w);
      this.door(o, xm, y, w);
    }
  },
  chimney(o, x, y, w) {
    const cw = Math.max(0.022, w * 0.13), ch = w * 0.3;
    this.poly(o, [x - cw / 2, y, x + cw / 2, y, x + cw / 2, y - ch, x - cw / 2, y - ch], '#8a5a44');
    o.c.fillStyle = '#5c3a2a'; o.c.fillRect(x - cw / 2, y - ch - 0.008, cw, 0.012);
  },
  door(o, x, y, w) {
    if (o.px > 0.02) return;
    o.c.fillStyle = 'rgba(60,38,20,0.85)';
    o.c.fillRect(x - w * 0.07, y - w * 0.2, w * 0.14, w * 0.2);
  },
  drawGarden(o, x, y) {
    const c = o.c, w = 0.15, h = 0.09;
    c.fillStyle = '#8f7a4c'; c.fillRect(x - w / 2, y - h, w, h);
    c.strokeStyle = '#6f9a45'; c.lineWidth = Math.max(o.lw, 0.016);
    c.beginPath();
    for (let k = 0; k < 4; k++) { const yy = y - h + h * (k + 0.5) / 4; c.moveTo(x - w / 2 + 0.012, yy); c.lineTo(x + w / 2 - 0.012, yy); }
    c.stroke();
    c.strokeStyle = 'rgba(96,66,34,0.85)'; c.lineWidth = o.lw;
    c.strokeRect(x - w / 2, y - h, w, h);
  },
  drawStall(o, x, y, k) {
    const c = o.c, w = 0.11;
    const stripes = ['#c8553d', '#4a6fa5', '#d9b44a'][k % 3];
    c.fillStyle = 'rgba(52,36,16,0.25)'; c.fillRect(x - w / 2 + 0.02, y - 0.005, w, 0.02);
    this.poly(o, [x - w / 2, y, x + w / 2, y, x + w / 2, y - 0.04, x - w / 2, y - 0.04], '#a77c4a');
    // полосатый навес
    const ay = y - 0.075;
    this.poly(o, [x - w / 2 - 0.01, ay + 0.03, x + w / 2 + 0.01, ay + 0.03, x + w / 2 - 0.01, ay - 0.02, x - w / 2 + 0.01, ay - 0.02], '#f1e6cc');
    c.fillStyle = stripes;
    for (let s = 0; s < 4; s += 2) {
      const a0 = s / 4, a1 = (s + 1) / 4;
      c.beginPath();
      c.moveTo(lerp(x - w / 2 - 0.01, x + w / 2 + 0.01, a0), ay + 0.03); c.lineTo(lerp(x - w / 2 - 0.01, x + w / 2 + 0.01, a1), ay + 0.03);
      c.lineTo(lerp(x - w / 2 + 0.01, x + w / 2 - 0.01, a1), ay - 0.02); c.lineTo(lerp(x - w / 2 + 0.01, x + w / 2 - 0.01, a0), ay - 0.02); c.fill();
    }
    this.poly(o, [x - w / 2 - 0.01, ay + 0.03, x + w / 2 + 0.01, ay + 0.03, x + w / 2 - 0.01, ay - 0.02, x - w / 2 + 0.01, ay - 0.02], null);
  },

  // Каменный ящик в три четверти (для замка и башни церкви): фасад, правый бок, верх.
  box(o, x, y, w, d, h, pal) {
    const dx = d * 0.55, dy = -d * 0.5, x0 = x - w / 2, x1 = x + w / 2, yt = y - h;
    o.c.fillStyle = 'rgba(52,36,16,0.26)';
    o.c.beginPath(); o.c.moveTo(x0 + 0.03, y + 0.015); o.c.lineTo(x1 + 0.09, y + 0.03); o.c.lineTo(x1 + dx + 0.09, y + dy + 0.03); o.c.lineTo(x1 + dx, y + dy); o.c.closePath(); o.c.fill();
    this.poly(o, [x1, y, x1 + dx, y + dy, x1 + dx, yt + dy, x1, yt], pal[1]);
    this.poly(o, [x0, y, x1, y, x1, yt, x0, yt], pal[0]);
    this.poly(o, [x0, yt, x1, yt, x1 + dx, yt + dy, x0 + dx, yt + dy], pal[2]);
    return { x0, x1, yt, dx, dy };
  },
  merlons(o, xa, ya, xb, yb, n, pal) {
    const c = o.c;
    for (let k = 0; k < n; k++) {
      const t0 = (k + 0.15) / n, t1 = (k + 0.6) / n;
      const ax = lerp(xa, xb, t0), ay = lerp(ya, yb, t0), bx = lerp(xa, xb, t1), by = lerp(ya, yb, t1), mh = 0.035;
      this.poly(o, [ax, ay, bx, by, bx, by - mh, ax, ay - mh], pal);
    }
    c.beginPath();
  },
  stonePal: ['#d3c9b3', '#a39883', '#e3dac6'],
  fortPal: ['#c4b9a2', '#958a75', '#d8cfba'],
  // Донжон; у крупных городов — с круглыми башнями по бокам. Столица — выше, со стягом.
  drawCastle(o, x, y, big, cap) {
    const pal = this.stonePal, h = cap ? 0.5 : 0.4, w = big ? 0.3 : 0.24;
    if (big) {
      // куртина и две круглые башни за донжоном
      this.box(o, x + 0.02, y - 0.05, w + 0.26, 0.08, 0.16, this.fortPal);
      this.roundTower(o, x - w / 2 - 0.12, y - 0.04, 0.065, 0.3, 'slate', false);
      this.roundTower(o, x + w / 2 + 0.17, y - 0.08, 0.065, 0.28, 'slate', false);
    }
    const b = this.box(o, x, y, w, 0.2, h, pal);
    // окна-бойницы
    o.c.fillStyle = 'rgba(42,27,13,0.8)';
    for (let k = 0; k < 2; k++) for (let j = 0; j < 2; j++) o.c.fillRect(x - w * 0.22 + k * w * 0.4, y - h * (0.4 + j * 0.3), 0.018, 0.04);
    // ворота донжона
    o.c.beginPath(); o.c.moveTo(x - 0.035, y); o.c.lineTo(x - 0.035, y - 0.06); o.c.arc(x, y - 0.06, 0.035, Math.PI, 0); o.c.lineTo(x + 0.035, y); o.c.fillStyle = '#3e2a18'; o.c.fill();
    this.merlons(o, b.x0, b.yt, b.x1, b.yt, 5, pal[0]);
    this.merlons(o, b.x1, b.yt, b.x1 + b.dx, b.yt + b.dy, 3, pal[1]);
    o.flag = { x: x + b.dx * 0.5, y: b.yt + b.dy * 0.5, s: cap ? 1.25 : 1 };
  },
  drawChurch(o, x, y, big) {
    const nave = { w: big ? 0.36 : 0.26, d: big ? 0.18 : 0.13, hw: big ? 0.15 : 0.11, hr: big ? 0.13 : 0.1, long: true, pal: big ? 3 : 2, chim: false, plaster: 0, timber: false };
    this.drawHouse(o, x + 0.04, y, nave);
    // колокольня со шпилем у фасада
    const tw = big ? 0.11 : 0.085, th = big ? 0.36 : 0.27, sh = big ? 0.34 : 0.24;
    const towers = big ? [x - nave.w / 2 + 0.06, x + nave.w / 2 + 0.02] : [x - nave.w / 2 + 0.06];
    for (const tx of towers) {
      const b = this.box(o, tx, y + 0.02, tw, tw, th, ['#e6dcc4', '#b3a68b', '#d8ccb0']);
      const ax = tx + b.dx * 0.5, ay = b.yt + b.dy * 0.5 - sh;
      const rf = this.roofPal[big ? 3 : 2];
      this.poly(o, [b.x0, b.yt, b.x1, b.yt, ax, ay], rf[0]);
      this.poly(o, [b.x1, b.yt, b.x1 + b.dx, b.yt + b.dy, ax, ay], rf[2]);
      o.c.fillStyle = 'rgba(42,27,13,0.8)';
      o.c.beginPath(); o.c.arc(tx, b.yt + th * 0.3, tw * 0.17, 0, TAU); o.c.fill();
      o.c.beginPath(); o.c.moveTo(ax, ay); o.c.lineTo(ax, ay - 0.06); o.c.moveTo(ax - 0.02, ay - 0.04); o.c.lineTo(ax + 0.02, ay - 0.04); this.ink(o, 0.9);
    }
  },

  // Башни на стене: деревянная вышка, каменная с конусной крышей, бастион.
  roundTower(o, x, y, r, h, roof, ruined) {
    const c = o.c, ry = r * 0.55, yt = y - h;
    c.fillStyle = 'rgba(52,36,16,0.26)'; c.beginPath(); c.ellipse(x + r * 0.7, y + 0.01, r * 1.3, ry, 0, 0, TAU); c.fill();
    const pal = this.stonePal;
    c.beginPath(); c.moveTo(x - r, yt); c.lineTo(x - r, y); c.ellipse(x, y, r, ry, 0, Math.PI, 0, true); c.lineTo(x + r, yt); c.closePath();
    c.fillStyle = pal[0]; c.fill();
    c.save(); c.clip(); c.fillStyle = this.alpha(pal[1], 0.9); c.fillRect(x + r * 0.15, yt - 1, r * 2, h + 2); c.restore();
    this.ink(o);
    if (ruined) {
      this.poly(o, [x - r, yt, x - r * 0.4, yt - 0.03, x, yt + 0.02, x + r * 0.5, yt - 0.02, x + r, yt + 0.01, x + r, yt + 0.04, x - r, yt + 0.04], '#8f8573');
      return;
    }
    c.fillStyle = pal[2]; c.beginPath(); c.ellipse(x, yt, r, ry, 0, 0, TAU); c.fill(); this.ink(o);
    if (roof === 'flat') {
      // бастион: зубцы по кругу и стяг
      for (let k = 0; k < 7; k++) {
        const a = Math.PI * (0.05 + k / 6 * 0.9), mx = x + Math.cos(a) * r * 0.92, my = yt + Math.sin(a) * ry * 0.92;
        this.poly(o, [mx - 0.014, my, mx + 0.014, my, mx + 0.014, my - 0.035, mx - 0.014, my - 0.035], k > 3 ? pal[1] : pal[0]);
      }
      c.fillStyle = 'rgba(42,27,13,0.45)'; c.beginPath(); c.ellipse(x, yt - 0.004, r * 0.6, ry * 0.55, 0, 0, TAU); c.fill();
      this.pennant(o, x, yt - 0.01, 0.16);
      return;
    }
    const rf = this.roofPal[roof === 'slate' ? 3 : 2], rh = r * 2.6;
    c.beginPath(); c.moveTo(x - r * 1.15, yt + 0.004); c.lineTo(x, yt - rh); c.lineTo(x + r * 1.15, yt + 0.004); c.ellipse(x, yt + 0.004, r * 1.15, ry * 1.1, 0, 0, Math.PI); c.closePath();
    c.fillStyle = rf[0]; c.fill();
    c.save(); c.clip(); c.fillStyle = rf[2]; c.beginPath(); c.moveTo(x, yt - rh); c.lineTo(x + r * 1.3, yt + ry * 1.3); c.lineTo(x + r * 0.15, yt + ry * 1.3); c.closePath(); c.fill(); c.restore();
    this.ink(o);
    this.pennant(o, x, yt - rh, 0.09);
  },
  pennant(o, x, y, L) {
    const c = o.c;
    c.beginPath(); c.moveTo(x, y); c.lineTo(x, y - L); this.ink(o, 0.9);
    this.poly(o, [x, y - L, x + L * 0.55, y - L * 0.82, x, y - L * 0.64], o.col, 0.8);
  },
  watchTower(o, x, y, ruined) {
    const c = o.c, h = ruined ? 0.12 : 0.3, w = 0.11;
    c.fillStyle = 'rgba(52,36,16,0.22)'; c.beginPath(); c.ellipse(x + 0.05, y + 0.01, 0.09, 0.03, 0, 0, TAU); c.fill();
    c.beginPath();
    c.moveTo(x - w * 0.45, y); c.lineTo(x - w * 0.35, y - h); c.moveTo(x + w * 0.45, y); c.lineTo(x + w * 0.35, y - h);
    c.moveTo(x - w * 0.42, y - h * 0.3); c.lineTo(x + w * 0.38, y - h * 0.75); c.moveTo(x + w * 0.42, y - h * 0.3); c.lineTo(x - w * 0.38, y - h * 0.75);
    c.strokeStyle = '#6e4a28'; c.lineWidth = Math.max(o.lw * 1.6, 0.018); c.stroke();
    if (ruined) return;
    this.poly(o, [x - w * 0.55, y - h, x + w * 0.55, y - h, x + w * 0.55, y - h - 0.06, x - w * 0.55, y - h - 0.06], '#9a6d3e');
    const rf = this.roofPal[0];
    this.poly(o, [x - w * 0.65, y - h - 0.055, x + w * 0.65, y - h - 0.055, x, y - h - 0.17], rf[0]);
    this.poly(o, [x, y - h - 0.17, x + w * 0.65, y - h - 0.055, x + w * 0.15, y - h - 0.055], rf[2], 0);
  },

  // Половина кольца стен (задняя или передняя) с башнями, воротами, проломами и обломками.
  drawWallHalf(o, front) {
    const city = o.city, c = o.c, R = o.R, K = o.K, wl = city.walls, tw = city.towers;
    if (!wl && !tw) return;
    const ga = o.plan.gate, gap = Math.max(0.2, 0.15 / R);
    // проломы: чем ниже прочность, тем больше
    const nb = [0, 1, 2, 4][o.dmg];
    if (!o.breaches) {
      o.breaches = [];
      const rb = mulberry32(city.id * 131 + 7);
      for (let k = 0; k < nb; k++) {
        let a = 0;
        for (let t = 0; t < 8; t++) { a = rb() * TAU; if (this.angNear(a, ga) > 0.6 && o.breaches.every(b => this.angNear(a, b) > 0.5)) break; }
        o.breaches.push(a);
      }
    }
    const bw = Math.max(0.16, 0.12 / R);
    const inGap = a => this.angNear(a, ga) < gap || o.breaches.some(b => this.angNear(a, b) < bw);
    const isFront = a => Math.sin(a) >= 0;
    const N = 64, items = [];
    if (wl === 1) {
      // частокол из кольев
      const n = Math.round(TAU * R / 0.042);
      const pts = [];
      for (let k = 0; k < n; k++) {
        const a = (k + 0.5) / n * TAU;
        if (isFront(a) !== front || inGap(a)) continue;
        const p = this.ringPt(o, a, R), h = 0.12 + this.hash(city.id * 977 + k, 11) * 0.03;
        pts.push([p[0], p[1], h, a]);
      }
      pts.sort((p, q) => p[1] - q[1]);
      // перекладина
      c.beginPath();
      let open = false;
      for (let k = 0; k <= N; k++) {
        const a = k / N * TAU;
        if (isFront(a) !== front || inGap(a)) { open = false; continue; }
        const p = this.ringPt(o, a, R);
        if (!open) { c.moveTo(p[0], p[1] - 0.06); open = true; } else c.lineTo(p[0], p[1] - 0.06);
      }
      c.strokeStyle = '#5a3d20'; c.lineWidth = Math.max(o.lw * 1.4, 0.016); c.stroke();
      for (const p of pts) {
        const sw = 0.019, lit = Math.cos(p[3]) < 0.2;
        this.poly(o, [p[0] - sw, p[1], p[0] + sw, p[1], p[0] + sw, p[1] - p[2], p[0], p[1] - p[2] - 0.03, p[0] - sw, p[1] - p[2]], lit ? '#a77a48' : '#8a6238', 0.7);
      }
    } else if (wl >= 2) {
      const hw = wl === 3 ? 0.21 : 0.15, th = wl === 3 ? 0.075 : 0.05;
      const base = wl === 3 ? '#b9ae97' : '#c8bea8';
      const segs = [];
      for (let k = 0; k < N; k++) {
        const a0 = k / N * TAU, a1 = (k + 1) / N * TAU, am = (a0 + a1) / 2;
        if (isFront(am) !== front || inGap(am)) continue;
        segs.push([a0, a1, am]);
      }
      segs.sort((p, q) => Math.sin(p[2]) - Math.sin(q[2]));
      for (const s of segs) {
        const p0 = this.ringPt(o, s[0], R), p1 = this.ringPt(o, s[1], R);
        const f = front ? 0.86 + 0.16 * Math.max(0, -Math.cos(s[2])) : 0.74 + 0.1 * Math.max(0, Math.cos(s[2]));
        c.fillStyle = this.shade(base, f);
        c.beginPath(); c.moveTo(p0[0], p0[1]); c.lineTo(p1[0], p1[1]); c.lineTo(p1[0], p1[1] - hw); c.lineTo(p0[0], p0[1] - hw); c.closePath(); c.fill();
        c.strokeStyle = c.fillStyle; c.lineWidth = o.px; c.stroke();
      }
      // кладка, ход по стене, зубцы и контуры по непрерывным кускам
      const runs = [];
      let cur = null;
      for (let k = 0; k <= N * 2; k++) {
        const a = k / (N * 2) * TAU;
        if (isFront(a) !== front || inGap(a)) { cur = null; continue; }
        if (!cur) { cur = []; runs.push(cur); }
        cur.push(a);
      }
      const line = (run, rr, dy) => {
        c.beginPath();
        run.forEach((a, k) => { const p = this.ringPt(o, a, rr); if (k) c.lineTo(p[0], p[1] + dy); else c.moveTo(p[0], p[1] + dy); });
      };
      for (const run of runs) {
        if (run.length < 2) continue;
        line(run, R, -hw * 0.5); c.strokeStyle = 'rgba(80,64,44,0.35)'; c.lineWidth = o.lw; c.stroke();
        line(run, R, -hw); c.strokeStyle = this.shade(base, 1.1); c.lineWidth = th; c.stroke();
        c.setLineDash([0.035, 0.03]);
        line(run, R + (front ? th * 0.4 : -th * 0.4), -hw - 0.022); c.strokeStyle = 'rgba(42,27,13,0.85)'; c.lineWidth = 0.05; c.stroke();
        c.strokeStyle = this.shade(base, front ? 1.02 : 0.9); c.lineWidth = 0.05 - o.lw * 2; c.stroke();
        c.setLineDash([]);
        line(run, R, 0); this.ink(o);
        line(run, R, -hw); c.lineWidth = th + o.lw * 2; c.strokeStyle = 'rgba(42,27,13,0.5)'; c.globalCompositeOperation = 'destination-over'; c.stroke(); c.globalCompositeOperation = 'source-over';
      }
    }
    // обломки в проломах
    for (const b of o.breaches) {
      if (isFront(b) !== front) continue;
      const p = this.ringPt(o, b, R), rb = mulberry32(Math.floor(b * 1000));
      for (let k = 0; k < 6; k++) {
        const x = p[0] + (rb() - 0.5) * 0.22, y = p[1] + (rb() - 0.5) * 0.08, s = 0.022 + rb() * 0.025;
        if (wl === 1) { c.beginPath(); c.moveTo(x - s * 1.6, y); c.lineTo(x + s * 1.6, y - s * 0.6); c.strokeStyle = '#7a5530'; c.lineWidth = 0.025; c.stroke(); }
        else { c.beginPath(); c.ellipse(x, y, s * 1.2, s * 0.8, rb(), 0, TAU); c.fillStyle = rb() < 0.5 ? '#b3a993' : '#958b77'; c.fill(); this.ink(o, 0.7); }
      }
    }
    // ворота
    const gp = this.ringPt(o, ga, R);
    if (isFront(ga) === front) {
      const sx = Math.sin(ga), gx = gp[0], gy = gp[1];
      if (wl === 1 || (!wl && tw)) {
        for (const s of [-1, 1]) {
          const p = this.ringPt(o, ga + s * gap, R);
          this.poly(o, [p[0] - 0.025, p[1], p[0] + 0.025, p[1], p[0] + 0.025, p[1] - 0.2, p[0] - 0.025, p[1] - 0.2], '#8a6238');
        }
      } else if (wl >= 2) {
        const hw = wl === 3 ? 0.27 : 0.2;
        for (const s of [-1, 1]) {
          const p = this.ringPt(o, ga + s * (gap + 0.04), R);
          const b = this.box(o, p[0], p[1] + 0.02, 0.1, 0.09, hw, this.stonePal);
          this.merlons(o, b.x0, b.yt, b.x1, b.yt, 2, this.stonePal[0]);
        }
        if (sx > 0.2) {
          c.beginPath(); c.moveTo(gx - 0.045, gy + 0.01); c.lineTo(gx - 0.045, gy - 0.07); c.arc(gx, gy - 0.07, 0.045, Math.PI, 0); c.lineTo(gx + 0.045, gy + 0.01);
          c.fillStyle = '#3e2a18'; c.fill();
        }
      }
    }
    // башни по кольцу
    if (tw) {
      const nt = [0, 4, 5, 6][tw] + (R > 0.9 ? 2 : R > 0.75 ? 1 : 0);
      const list = [];
      for (let k = 0; k < nt; k++) {
        const a = ga + (k + 0.5) / nt * TAU;
        if (isFront(a) !== front) continue;
        list.push(a);
      }
      list.sort((p, q) => Math.sin(p) - Math.sin(q));
      for (const a of list) {
        const p = this.ringPt(o, a, R);
        const ruined = o.dmg >= 3 || (o.dmg === 2 && this.hash(city.id * 13 + Math.round(a * 10), 21) < 0.4);
        if (tw === 1) this.watchTower(o, p[0], p[1] + 0.02, ruined);
        else if (tw === 2) this.roundTower(o, p[0], p[1] + 0.02, wl === 3 ? 0.085 : 0.075, (wl >= 2 ? 0.27 : 0.22) + (wl === 3 ? 0.05 : 0), wl === 3 ? 'slate' : 'tile', ruined);
        else this.roundTower(o, p[0], p[1] + 0.03, 0.12, wl === 3 ? 0.28 : 0.24, 'flat', ruined);
      }
    }
  },

  // Окрестности: поля, лесопилка, каменоломня, рудник — по уровням построек.
  drawOutskirts(o) {
    const b = o.city.buildings, R = o.R, c = o.c;
    const at = (a, d) => this.ringPt(o, a, d);
    if (b.farm) {
      const n = Math.min(3, b.farm), D = R + 0.62;
      for (let k = 0; k < n; k++) {
        const a = o.plan.farm + (k - (n - 1) / 2) * (0.62 / D), p = at(a, D + (k % 2) * 0.12);
        this.drawField(o, p[0], p[1], o.city.id * 3 + k);
      }
    }
    if (b.lumber) {
      const D = R + 0.48, a = o.plan.lumber, n = Math.min(3, b.lumber);
      for (let k = 0; k < 4; k++) {
        const p = at(a + (this.hash(o.city.id * 9 + k, 31) - 0.5) * 0.9, D + 0.25 + this.hash(o.city.id * 9 + k, 32) * 0.3);
        c.fillStyle = '#b48d5c'; c.beginPath(); c.ellipse(p[0], p[1], 0.03, 0.018, 0, 0, TAU); c.fill(); this.ink(o, 0.7);
      }
      for (let k = 0; k < n; k++) {
        const p = at(a + (k - (n - 1) / 2) * (0.42 / D), D);
        this.drawLogs(o, p[0], p[1], 2 + Math.min(1, k));
      }
    }
    if (b.quarry) {
      const p = at(o.plan.quarry, R + 0.6);
      this.drawQuarry(o, p[0], p[1], b.quarry);
    }
    if (b.mine) {
      const p = at(o.plan.mine, R + 0.6);
      this.drawMine(o, p[0], p[1], b.mine);
    }
  },
  drawField(o, x, y, seed) {
    const c = o.c, R = mulberry32(seed * 37 + 5);
    const w = 0.42 + R() * 0.12, h = 0.24 + R() * 0.06, rot = (R() - 0.5) * 0.5;
    const pals = [['#dcc271', '#c9ad58'], ['#a9b860', '#93a24f'], ['#b8946a', '#9e7b51']];
    const pal = pals[Math.floor(R() * 3)];
    c.save(); c.translate(x, y); c.rotate(rot); c.transform(1, 0, -0.25, 1, 0, 0);
    const n = 6;
    for (let k = 0; k < n; k++) { c.fillStyle = pal[k % 2]; c.fillRect(-w / 2 + k * w / n, -h / 2, w / n + o.px, h); }
    c.strokeStyle = this.alpha(this.shade(pal[1], 0.7), 0.6); c.lineWidth = o.lw;
    c.beginPath(); for (let k = 1; k < n; k++) { c.moveTo(-w / 2 + k * w / n, -h / 2); c.lineTo(-w / 2 + k * w / n, h / 2); } c.stroke();
    c.beginPath(); c.rect(-w / 2, -h / 2, w, h);
    c.strokeStyle = 'rgba(80,96,40,0.75)'; c.lineWidth = Math.max(o.lw * 1.6, 0.02); c.stroke();
    this.ink(o, 0.5);
    c.restore();
  },
  drawLogs(o, x, y, rows) {
    const c = o.c, r = 0.026;
    c.fillStyle = 'rgba(52,36,16,0.25)'; c.beginPath(); c.ellipse(x + 0.04, y + 0.01, 0.12, 0.03, 0, 0, TAU); c.fill();
    // брёвна сбоку: длинные коричневые тела, торцы светлыми кругами
    for (let row = 0; row < rows; row++) {
      const n = rows - row + 1, yy = y - row * r * 1.7;
      for (let k = 0; k < n; k++) {
        const xx = x + (k - (n - 1) / 2) * r * 2;
        c.fillStyle = '#8a6238'; c.fillRect(xx, yy - r, 0.12, r * 2);
        c.beginPath(); c.rect(xx, yy - r, 0.12, r * 2); this.ink(o, 0.5);
        c.beginPath(); c.arc(xx, yy, r, 0, TAU); c.fillStyle = '#ddbf8c'; c.fill(); this.ink(o, 0.85);
        c.beginPath(); c.arc(xx, yy, r * 0.45, 0, TAU); c.strokeStyle = 'rgba(120,80,40,0.6)'; c.lineWidth = o.lw * 0.8; c.stroke();
      }
    }
  },
  drawQuarry(o, x, y, lv) {
    const c = o.c, s = 0.8 + lv * 0.12;
    // выемка в склоне ступенями
    const shape = (k) => {
      const f = s * (1 - k * 0.28);
      c.beginPath();
      c.moveTo(x - 0.22 * f, y + 0.02); c.quadraticCurveTo(x - 0.24 * f, y - 0.16 * f, x - 0.02, y - 0.17 * f);
      c.quadraticCurveTo(x + 0.22 * f, y - 0.16 * f, x + 0.22 * f, y + 0.02); c.closePath();
    };
    shape(0); c.fillStyle = '#c9bc9c'; c.fill(); this.ink(o, 0.8);
    shape(1); c.fillStyle = '#b0a384'; c.fill(); this.ink(o, 0.45);
    shape(2); c.fillStyle = '#968a6e'; c.fill(); this.ink(o, 0.45);
    // тёсаные блоки
    for (let k = 0; k < 1 + lv; k++) {
      const bx = x + 0.2 * s + (k % 2) * 0.06, by = y + 0.04 - Math.floor(k / 2) * 0.035;
      this.poly(o, [bx, by, bx + 0.055, by, bx + 0.055, by - 0.035, bx, by - 0.035], '#ddd3bd', 0.8);
    }
  },
  drawMine(o, x, y, lv) {
    const c = o.c, w = 0.24 + lv * 0.03;
    // склон-бугор с входом в штольню
    c.beginPath(); c.moveTo(x - w, y + 0.02); c.bezierCurveTo(x - w * 0.6, y - 0.2, x + w * 0.3, y - 0.24, x + w, y + 0.02); c.closePath();
    c.fillStyle = '#a99677'; c.fill();
    c.save(); c.clip(); c.fillStyle = 'rgba(80,60,36,0.35)'; c.beginPath(); c.moveTo(x + w * 0.05, y - 0.3); c.lineTo(x + w * 1.2, y - 0.3); c.lineTo(x + w * 1.2, y + 0.05); c.lineTo(x - w * 0.1, y + 0.05); c.fill(); c.restore();
    this.ink(o, 0.8);
    const ex = x - w * 0.15, ey = y + 0.01;
    c.beginPath(); c.moveTo(ex - 0.045, ey); c.lineTo(ex - 0.045, ey - 0.06); c.arc(ex, ey - 0.06, 0.045, Math.PI, 0); c.lineTo(ex + 0.045, ey); c.closePath();
    c.fillStyle = '#2c2016'; c.fill();
    c.beginPath(); c.moveTo(ex - 0.05, ey); c.lineTo(ex - 0.05, ey - 0.1); c.lineTo(ex + 0.05, ey - 0.1); c.lineTo(ex + 0.05, ey);
    c.strokeStyle = '#7a5530'; c.lineWidth = Math.max(o.lw * 2, 0.022); c.stroke();
    // рельсы и куча руды
    c.beginPath(); c.moveTo(ex - 0.02, ey); c.lineTo(ex - 0.06, ey + 0.1); c.moveTo(ex + 0.02, ey); c.lineTo(ex + 0.04, ey + 0.1); this.ink(o, 0.7);
    for (let k = 0; k < 3 + lv; k++) {
      const hx = x + w * 0.55 + (this.hash(k, 41) - 0.5) * 0.1, hy = y + 0.05 - this.hash(k, 42) * 0.04, rr = 0.022 + this.hash(k, 43) * 0.012;
      c.beginPath(); c.arc(hx, hy, rr, 0, TAU); c.fillStyle = k % 2 ? '#5d5a58' : '#77706a'; c.fill(); this.ink(o, 0.7);
    }
  },
  // Стройка: леса вокруг недостроенного дома и подъёмный кран с колесом.
  drawCrane(o, x, y) {
    const c = o.c, wood = '#b08a55';
    this.poly(o, [x - 0.1, y, x + 0.06, y, x + 0.06, y - 0.08, x - 0.1, y - 0.08], '#d6cab0', 0.7);
    c.beginPath();
    for (const sx of [-0.12, -0.02, 0.08]) { c.moveTo(x + sx, y + 0.01); c.lineTo(x + sx, y - 0.17); }
    for (const sy of [-0.06, -0.12]) { c.moveTo(x - 0.13, y + sy); c.lineTo(x + 0.09, y + sy); }
    c.moveTo(x - 0.12, y); c.lineTo(x - 0.02, y - 0.12);
    c.strokeStyle = wood; c.lineWidth = Math.max(o.lw * 1.4, 0.016); c.stroke();
    // кран
    const bx = x + 0.17;
    c.beginPath(); c.moveTo(bx - 0.06, y + 0.01); c.lineTo(bx, y - 0.34); c.lineTo(bx + 0.05, y + 0.01);
    c.moveTo(bx, y - 0.32); c.lineTo(bx - 0.2, y - 0.4);
    c.strokeStyle = '#6e4a28'; c.lineWidth = Math.max(o.lw * 2, 0.022); c.stroke();
    c.beginPath(); c.moveTo(bx - 0.19, y - 0.39); c.lineTo(bx - 0.19, y - 0.2); this.ink(o, 0.8);
    this.poly(o, [bx - 0.215, y - 0.2, bx - 0.165, y - 0.2, bx - 0.165, y - 0.165, bx - 0.215, y - 0.165], '#ddd3bd', 0.8);
    c.beginPath(); c.arc(bx + 0.02, y - 0.05, 0.05, 0, TAU); c.strokeStyle = '#6e4a28'; c.lineWidth = Math.max(o.lw * 1.6, 0.018); c.stroke();
    c.beginPath(); c.moveTo(bx - 0.03, y - 0.05); c.lineTo(bx + 0.07, y - 0.05); c.moveTo(bx + 0.02, y - 0.1); c.lineTo(bx + 0.02, y); c.lineWidth = o.lw; c.stroke();
  },
  // Осада: горящие крыши и столбы дыма над городом.
  drawSiegeFire(o) {
    const c = o.c, R = o.R, K = o.K, rb = mulberry32(o.city.id * 71 + 3);
    const n = 2 + (o.dmg >= 2 ? 1 : 0);
    for (let k = 0; k < n; k++) {
      const x = (rb() - 0.5) * R * 1.1, y = (rb() - 0.6) * R * K * 0.9;
      for (let j = 0; j < 4; j++) {
        const sx = x + 0.04 * j + (rb() - 0.5) * 0.05, sy = y - 0.12 - j * 0.11, sr = 0.06 + j * 0.03;
        c.fillStyle = 'rgba(70,62,56,' + (0.5 - j * 0.09) + ')';
        c.beginPath(); c.arc(sx, sy, sr, 0, TAU); c.fill();
      }
      c.fillStyle = '#e8902e';
      c.beginPath(); c.moveTo(x - 0.05, y); c.quadraticCurveTo(x - 0.045, y - 0.07, x - 0.02, y - 0.1); c.quadraticCurveTo(x - 0.005, y - 0.05, x + 0.01, y - 0.13);
      c.quadraticCurveTo(x + 0.03, y - 0.06, x + 0.05, y); c.closePath(); c.fill();
      c.fillStyle = '#f7d36a';
      c.beginPath(); c.moveTo(x - 0.025, y); c.quadraticCurveTo(x - 0.01, y - 0.05, x + 0.01, y - 0.075); c.quadraticCurveTo(x + 0.02, y - 0.03, x + 0.03, y); c.closePath(); c.fill();
    }
  },
};
