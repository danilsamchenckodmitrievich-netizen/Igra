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
    this.hover = null;
    this.marker = null;
    this.resize();
  }

  setGame(g) {
    this.g = g;
    this.chunks.clear();
    const w = g.world;
    this.baseImg = this.buildBaseImage();
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

  // Цвета клеток в картинке 1 пиксель = 1 клетка; при увеличении сглаживаются в мягкую заливку.
  buildBaseImage() {
    const w = this.g.world;
    const cv = document.createElement('canvas');
    cv.width = w.W; cv.height = w.H;
    const c = cv.getContext('2d');
    const img = c.createImageData(w.W, w.H);
    for (let i = 0; i < w.W * w.H; i++) {
      const n = parseInt(this.terrainColor(w.terrain[i], i).slice(1), 16);
      img.data[i * 4] = (n >> 16) & 255; img.data[i * 4 + 1] = (n >> 8) & 255; img.data[i * 4 + 2] = n & 255; img.data[i * 4 + 3] = 255;
    }
    c.putImageData(img, 0, 0);
    return cv;
  }

  // Изолиния двоичного поля по центрам клеток (марширующие квадраты) — гладкие берега и границы.
  contour(inside, x0, y0, x1, y1) {
    const p = new Path2D();
    for (let y = y0 - 1; y < y1; y++) {
      for (let x = x0 - 1; x < x1; x++) {
        const a = inside(x, y) ? 1 : 0, b = inside(x + 1, y) ? 1 : 0;
        const c = inside(x + 1, y + 1) ? 1 : 0, d = inside(x, y + 1) ? 1 : 0;
        const code = a * 8 + b * 4 + c * 2 + d;
        if (code === 0 || code === 15) continue;
        const cx = x + 0.5, cy = y + 0.5;
        const T_ = [cx + 0.5, cy], R_ = [cx + 1, cy + 0.5], B_ = [cx + 0.5, cy + 1], L_ = [cx, cy + 0.5];
        const seg = (u, v) => { p.moveTo(u[0], u[1]); p.lineTo(v[0], v[1]); };
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
    return p;
  }

  bakeChunk(cx, cy) {
    const g = this.g, w = g.world, W = w.W;
    const cv = document.createElement('canvas');
    cv.width = cv.height = CH * TP;
    const c = cv.getContext('2d');
    c.scale(TP, TP);
    c.translate(-cx * CH, -cy * CH);
    const x0 = Math.max(0, cx * CH - 1), x1 = Math.min(W - 1, cx * CH + CH);
    const y0 = Math.max(0, cy * CH - 1), y1 = Math.min(w.H - 1, cy * CH + CH + 1);
    // мягкая заливка местности
    c.imageSmoothingEnabled = true;
    c.drawImage(this.baseImg, 0, 0, W, w.H);
    // береговая линия
    c.lineCap = 'round'; c.lineJoin = 'round';
    c.strokeStyle = 'rgba(245,236,205,0.55)'; c.lineWidth = 0.22;
    c.stroke(this.coast);
    c.strokeStyle = 'rgba(70,52,30,0.75)'; c.lineWidth = 0.07;
    c.stroke(this.coast);
    // волны и бумажная фактура
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * W + x;
      const t = w.terrain[i];
      if (t === T.DEEP && tileHash(i, 3) < 0.22) {
        c.strokeStyle = 'rgba(220,235,240,0.35)';
        c.lineWidth = 0.05;
        const ox = x + 0.25 + tileHash(i, 4) * 0.4, oy = y + 0.4 + tileHash(i, 5) * 0.3;
        c.beginPath();
        c.arc(ox, oy, 0.14, Math.PI * 1.1, Math.PI * 1.9);
        c.arc(ox + 0.27, oy, 0.14, Math.PI * 1.1, Math.PI * 1.9);
        c.stroke();
      }
      c.fillStyle = 'rgba(60,40,20,0.06)';
      for (let k = 0; k < 3; k++) c.fillRect(x + tileHash(i, 10 + k), y + tileHash(i, 20 + k), 0.06, 0.06);
    }
    // реки
    c.lineCap = 'round'; c.lineJoin = 'round';
    for (const r of w.rivers) this.smoothLine(c, r, 0.46, '#4c7d93');
    for (const r of w.rivers) this.smoothLine(c, r, 0.3, '#7ab3c8');
    // дороги
    c.setLineDash([0.32, 0.2]);
    for (const r of w.roads) this.smoothLine(c, r, 0.16, 'rgba(110,78,40,0.85)');
    c.setLineDash([]);
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * W + x;
      if (w.road[i] && w.river[i]) {
        c.fillStyle = '#8a643a';
        c.fillRect(x + 0.25, y + 0.3, 0.5, 0.4);
        c.strokeStyle = '#4e3418'; c.lineWidth = 0.04;
        c.strokeRect(x + 0.25, y + 0.3, 0.5, 0.4);
      }
    }
    // объекты местности сверху вниз, чтобы нижние перекрывали верхние
    for (let y = y0; y <= y1; y++) for (let x = x0; x <= x1; x++) {
      const i = y * W + x;
      const t = w.terrain[i];
      if (w.road[i] && t !== T.MOUNTAIN && t !== T.SNOW) continue;
      if (t === T.FOREST) this.drawTrees(c, x, y, i);
      else if (t === T.HILLS) this.drawHill(c, x, y, i);
      else if (t === T.MOUNTAIN || t === T.SNOW) this.drawMountain(c, x, y, i, t === T.SNOW);
      else if (t === T.PLAINS && tileHash(i, 30) < 0.14) this.drawTuft(c, x, y, i);
    }
    return cv;
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

  drawTrees(c, x, y, i) {
    const n = 2 + (tileHash(i, 40) < 0.5 ? 1 : 0);
    for (let k = 0; k < n; k++) {
      const tx = x + 0.2 + tileHash(i, 41 + k) * 0.6, ty = y + 0.25 + tileHash(i, 51 + k) * 0.55;
      const r = 0.17 + tileHash(i, 61 + k) * 0.08;
      c.fillStyle = 'rgba(40,50,20,0.25)';
      c.beginPath(); c.ellipse(tx + 0.05, ty + r * 0.9, r, r * 0.45, 0, 0, TAU); c.fill();
      c.fillStyle = '#5a4128';
      c.fillRect(tx - 0.025, ty, 0.05, r * 0.9);
      c.fillStyle = '#3f6a2f';
      c.beginPath(); c.arc(tx, ty - r * 0.2, r, 0, TAU); c.fill();
      c.fillStyle = '#5d8a45';
      c.beginPath(); c.arc(tx - r * 0.3, ty - r * 0.45, r * 0.5, 0, TAU); c.fill();
      c.strokeStyle = 'rgba(30,40,15,0.6)'; c.lineWidth = 0.025;
      c.beginPath(); c.arc(tx, ty - r * 0.2, r, 0, TAU); c.stroke();
    }
  }
  drawHill(c, x, y, i) {
    const n = tileHash(i, 70) < 0.5 ? 1 : 2;
    for (let k = 0; k < n; k++) {
      const hx = x + 0.2 + tileHash(i, 71 + k) * 0.6, hy = y + 0.65 + tileHash(i, 81 + k) * 0.25;
      const r = 0.3 + tileHash(i, 91 + k) * 0.12;
      c.fillStyle = '#a58d5c';
      c.beginPath(); c.ellipse(hx, hy, r, r * 0.75, 0, Math.PI, 0); c.closePath(); c.fill();
      c.fillStyle = 'rgba(70,50,25,0.35)';
      c.beginPath(); c.ellipse(hx, hy, r, r * 0.75, 0, Math.PI * 1.5, 0); c.lineTo(hx, hy); c.closePath(); c.fill();
      c.strokeStyle = 'rgba(70,50,25,0.75)'; c.lineWidth = 0.035;
      c.beginPath(); c.ellipse(hx, hy, r, r * 0.75, 0, Math.PI, 0); c.stroke();
    }
  }
  drawMountain(c, x, y, i, snow) {
    const mx = x + 0.5 + (tileHash(i, 100) - 0.5) * 0.3;
    const base = y + 0.95;
    const h = (snow ? 1.25 : 0.95) + tileHash(i, 101) * 0.3;
    const wdt = 0.62 + tileHash(i, 102) * 0.2;
    c.fillStyle = 'rgba(50,40,25,0.25)';
    c.beginPath(); c.ellipse(mx + 0.1, base, wdt, 0.15, 0, 0, TAU); c.fill();
    c.fillStyle = '#b9ac93';
    c.beginPath(); c.moveTo(mx - wdt, base); c.lineTo(mx, base - h); c.lineTo(mx + wdt, base); c.closePath(); c.fill();
    c.fillStyle = '#857762';
    c.beginPath(); c.moveTo(mx, base - h); c.lineTo(mx + wdt, base); c.lineTo(mx + 0.05, base); c.closePath(); c.fill();
    if (snow || h > 1.15) {
      c.fillStyle = '#f4f2ec';
      c.beginPath(); c.moveTo(mx - wdt * 0.36, base - h * 0.64); c.lineTo(mx, base - h); c.lineTo(mx + wdt * 0.36, base - h * 0.64);
      c.lineTo(mx + 0.08, base - h * 0.72); c.lineTo(mx - 0.08, base - h * 0.6); c.closePath(); c.fill();
    }
    c.strokeStyle = '#4e4436'; c.lineWidth = 0.04;
    c.beginPath(); c.moveTo(mx - wdt, base); c.lineTo(mx, base - h); c.lineTo(mx + wdt, base); c.stroke();
  }
  drawTuft(c, x, y, i) {
    const tx = x + 0.2 + tileHash(i, 31) * 0.6, ty = y + 0.3 + tileHash(i, 32) * 0.5;
    c.strokeStyle = 'rgba(80,95,40,0.55)'; c.lineWidth = 0.035;
    c.beginPath();
    c.moveTo(tx - 0.1, ty); c.lineTo(tx - 0.13, ty - 0.14);
    c.moveTo(tx, ty); c.lineTo(tx, ty - 0.18);
    c.moveTo(tx + 0.1, ty); c.lineTo(tx + 0.14, ty - 0.13);
    c.stroke();
  }

  getChunk(cx, cy, budget) {
    const key = cx + ',' + cy;
    let ch = this.chunks.get(key);
    if (ch) { ch.used = this.frame; return ch.cv; }
    if (budget.n <= 0) return null;
    budget.n--;
    ch = { cv: this.bakeChunk(cx, cy), used: this.frame };
    this.chunks.set(key, ch);
    if (this.chunks.size > 70) {
      let oldK = null, oldT = Infinity;
      for (const [k, v] of this.chunks) if (v.used < oldT) { oldT = v.used; oldK = k; }
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

  rebuildTerritory() {
    const g = this.g, w = g.world, W = w.W, H = w.H;
    const cv = this.layers.territory, c = cv.getContext('2d');
    const img = c.createImageData(W, H);
    const colors = new Map(g.kingdoms.map(k => [k.id, parseInt(k.color.slice(1), 16)]));
    const own = new Int32Array(W * H);
    for (let i = 0; i < W * H; i++) {
      const k = this.kingdomOfTile(i);
      own[i] = k === null ? -99 : k;
      if (k === null) continue;
      const col = k === -1 ? 0x8a7f6a : colors.get(k);
      img.data[i * 4] = (col >> 16) & 255; img.data[i * 4 + 1] = (col >> 8) & 255; img.data[i * 4 + 2] = col & 255;
      img.data[i * 4 + 3] = k === -1 ? 30 : 62;
    }
    c.putImageData(img, 0, 0);
    // границы: изолиния владений каждой державы
    const paths = new Map();
    const ids = new Set();
    for (let i = 0; i < W * H; i++) if (own[i] !== -99) ids.add(own[i]);
    for (const k of ids) paths.set(k, this.contour((x, y) => x >= 0 && y >= 0 && x < W && y < H && own[y * W + x] === k, 0, 0, W, H));
    this.borders = paths;
    this.mmBase = null;
  }

  rebuildFog() {
    const g = this.g, w = g.world, W = w.W, H = w.H, n = W * H;
    if (!this.fogU) { this.fogU = new Float32Array(n); this.fogD = new Float32Array(n); this.fogT = new Float32Array(n); }
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
    this.drawPaths(ctx, z);
    this.drawCities(ctx, z, tl, br);
    // туман
    ctx.drawImage(this.layers.fog, 0, 0, w.W, w.H);
    this.drawBattles(ctx, z);
    // экранные слои
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawCityLabels(ctx, z, tl, br);
    this.drawArmies(ctx, z, tl, br);
    this.drawMarker(ctx, dt);
    this.drawParticles(ctx, dt);
    if (season === 3) this.drawSnowfall(ctx, dt);
  }

  drawBorders(ctx, z) {
    if (!this.borders) return;
    ctx.lineCap = 'round';
    for (const [k, p] of this.borders) {
      if (k === -1) {
        ctx.setLineDash([0.25, 0.2]);
        ctx.strokeStyle = 'rgba(80,70,55,0.55)';
        ctx.lineWidth = 1.2 / z;
        ctx.stroke(p);
        ctx.setLineDash([]);
        continue;
      }
      const kg = this.g.kingdom(k);
      if (!kg) continue;
      ctx.strokeStyle = 'rgba(30,20,10,0.55)';
      ctx.lineWidth = Math.max(3.2 / z, 0.07);
      ctx.stroke(p);
      ctx.strokeStyle = kg.color;
      ctx.lineWidth = Math.max(1.8 / z, 0.04);
      ctx.stroke(p);
    }
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
    const g = this.g;
    for (const c of g.cities) {
      const x = c.x + 0.5, y = c.y + 0.5;
      if (x < tl.x - 3 || x > br.x + 3 || y < tl.y - 3 || y > br.y + 3) continue;
      if (!g.explored[g.cityTile(c)]) continue;
      this.drawCity(ctx, c, x, y);
    }
  }

  drawCity(ctx, c, x, y) {
    const g = this.g;
    const R = this.cityRadius(c);
    const k = g.kingdom(c.owner);
    const col = k ? k.color : NEUTRAL_COLOR;
    ctx.fillStyle = 'rgba(40,25,10,0.3)';
    ctx.beginPath(); ctx.ellipse(x + 0.08, y + 0.12, R * 1.08, R * 0.9, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#cdb88b';
    ctx.beginPath(); ctx.arc(x, y, R, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(80,55,25,0.6)'; ctx.lineWidth = 0.035;
    ctx.stroke();
    // дома
    const n = Math.min(14, 3 + c.level * 2);
    for (let h = 0; h < n; h++) {
      const a = tileHash(c.id, 200 + h) * TAU, r = Math.sqrt(tileHash(c.id, 300 + h)) * R * 0.72;
      const hx = x + Math.cos(a) * r, hy = y + Math.sin(a) * r * 0.85;
      if (c.isCapital && Math.hypot(hx - x, hy - y) < 0.22) continue;
      const s = 0.14 + tileHash(c.id, 400 + h) * 0.06;
      ctx.fillStyle = '#e9dcc0';
      ctx.fillRect(hx - s / 2, hy - s * 0.3, s, s * 0.7);
      ctx.fillStyle = tileHash(c.id, 500 + h) < 0.5 ? '#9a4630' : '#7a4a2a';
      ctx.beginPath(); ctx.moveTo(hx - s * 0.62, hy - s * 0.25); ctx.lineTo(hx, hy - s * 0.85); ctx.lineTo(hx + s * 0.62, hy - s * 0.25); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = 'rgba(50,30,15,0.7)'; ctx.lineWidth = 0.02;
      ctx.strokeRect(hx - s / 2, hy - s * 0.3, s, s * 0.7);
    }
    // стены и башни
    if (c.walls > 0) {
      const max = WALLS[c.walls].hp;
      const broken = c.wallHp <= 0, damaged = c.wallHp < max * 0.5;
      const stone = c.walls >= 2;
      ctx.strokeStyle = 'rgba(30,20,10,0.8)';
      ctx.lineWidth = 0.09 + c.walls * 0.04;
      if (broken) ctx.setLineDash([0.22, 0.28]); else if (damaged) ctx.setLineDash([0.6, 0.12]);
      ctx.beginPath(); ctx.arc(x, y, R * 1.02, 0, TAU); ctx.stroke();
      ctx.strokeStyle = stone ? (c.walls === 3 ? '#b4b0a6' : '#9b968c') : '#86603a';
      ctx.lineWidth = 0.05 + c.walls * 0.04;
      ctx.stroke();
      ctx.setLineDash([]);
      if (c.towers > 0) {
        const nt = 2 + c.towers * 2;
        for (let t = 0; t < nt; t++) {
          const a = t / nt * TAU + 0.4;
          const tx = x + Math.cos(a) * R * 1.02, ty = y + Math.sin(a) * R * 1.02;
          ctx.fillStyle = stone ? '#a9a49a' : '#8e6a42';
          ctx.beginPath(); ctx.arc(tx, ty, 0.07 + c.towers * 0.025, 0, TAU); ctx.fill();
          ctx.strokeStyle = '#2d241a'; ctx.lineWidth = 0.025; ctx.stroke();
        }
      }
    }
    // замок столицы
    if (c.isCapital) {
      ctx.fillStyle = '#bdb6a6';
      ctx.fillRect(x - 0.17, y - 0.3, 0.34, 0.38);
      ctx.fillStyle = '#8f887a';
      for (let t = 0; t < 3; t++) ctx.fillRect(x - 0.17 + t * 0.13, y - 0.38, 0.08, 0.09);
      ctx.strokeStyle = '#2d241a'; ctx.lineWidth = 0.025; ctx.strokeRect(x - 0.17, y - 0.3, 0.34, 0.38);
    }
    // знамя
    const px = x + R * 0.55, py = y - R * 0.5;
    ctx.strokeStyle = '#3a2a18'; ctx.lineWidth = 0.035;
    ctx.beginPath(); ctx.moveTo(px, py + 0.1); ctx.lineTo(px, py - 0.62); ctx.stroke();
    const wave = Math.sin(this.time * 3 + c.id) * 0.03;
    ctx.fillStyle = col;
    ctx.beginPath();
    ctx.moveTo(px, py - 0.62); ctx.lineTo(px + 0.42, py - 0.6 + wave); ctx.lineTo(px + 0.36, py - 0.46); ctx.lineTo(px + 0.42, py - 0.32 + wave); ctx.lineTo(px, py - 0.34);
    ctx.closePath(); ctx.fill();
    ctx.strokeStyle = 'rgba(20,12,5,0.7)'; ctx.lineWidth = 0.02; ctx.stroke();
    if (k) Icons.draw(ctx, k.sigil, px + 0.17, py - 0.48, 0.2, '#f6ecd2');
    // осада: дым и огонь
    if (c.siegeBy && Math.random() < 0.3) this.spawn('smoke', x + (Math.random() - 0.5) * R, y - R * 0.3);
    if (c.siegeBy && c.wallHp <= 0 && Math.random() < 0.2) this.spawn('fire', x + (Math.random() - 0.5) * R, y + (Math.random() - 0.5) * R * 0.6);
  }

  drawBattles(ctx, z) {
    const g = this.g;
    for (const b of g.battles) {
      if (!g.isVisible(b.x, b.y)) continue;
      const p = 1 + Math.sin(this.time * 8) * 0.08;
      ctx.save();
      ctx.translate(b.x, b.y - (b.kind === 'siege' ? 0.9 : 0.6));
      ctx.scale(p, p);
      ctx.fillStyle = 'rgba(25,15,8,0.65)';
      ctx.beginPath(); ctx.arc(0, 0, 0.36, 0, TAU); ctx.fill();
      Icons.draw(ctx, 'swords', 0, 0, 0.5, '#ffe2a8');
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
      const s = this.toScreen(x, y + this.cityRadius(c) + 0.15);
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
        const wb = this.toScreen(x, y - this.cityRadius(c) - 0.3);
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

  armySize() { return clamp(this.cam.z * 0.85, 20, 34); }

  drawArmies(ctx, z, tl, br) {
    const g = this.g;
    const S = this.armySize();
    const list = g.armies.filter(a => this.armyVisible(a) && a.x > tl.x - 2 && a.x < br.x + 2 && a.y > tl.y - 2 && a.y < br.y + 2);
    list.sort((p, q) => p.y - q.y);
    this.drawnArmies = [];
    const placed = [];
    for (const a of list) {
      const k = g.kingdom(a.owner);
      let ax = a.x, ay = a.y;
      // стоящая у города армия не закрывает сам город
      if (a.state !== 'move' && a.state !== 'retreat') {
        const c = g.cityAt(a.x, a.y, 0.9);
        if (c) { ax = c.x + 0.5 + this.cityRadius(c) + 0.55; ay = c.y + 0.75; }
      }
      const p = this.toScreen(ax, ay);
      for (const q of placed) if (Math.abs(q.x - p.x) < S * 0.7 && Math.abs(q.y - p.y) < S * 0.7) p.x = q.x + S * 0.85;
      placed.push({ x: p.x, y: p.y });
      const bob = a.state === 'move' || a.state === 'retreat' ? Math.abs(Math.sin(this.time * 7 + a.id)) * 2.5 : 0;
      const x = p.x, y = p.y - S * 0.55 - bob;
      const sel = this.selected && this.selected.kind === 'army' && this.selected.id === a.id;
      this.drawnArmies.push({ a, x, y, r: S * 0.62 });
      ctx.fillStyle = 'rgba(30,18,8,0.35)';
      ctx.beginPath(); ctx.ellipse(p.x, p.y, S * 0.42, S * 0.15, 0, 0, TAU); ctx.fill();
      if (sel) {
        ctx.strokeStyle = '#ffe28a'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.ellipse(p.x, p.y, S * 0.6, S * 0.24, 0, 0, TAU); ctx.stroke();
      }
      ctx.save();
      ctx.translate(x - S / 2, y - S / 2);
      ctx.scale(S / 24, S / 24);
      const shield = Icons.path('shield');
      ctx.fillStyle = k.color;
      ctx.fill(shield);
      ctx.lineWidth = 1.6;
      ctx.strokeStyle = sel ? '#ffe28a' : '#1a120a';
      ctx.stroke(shield);
      ctx.restore();
      Icons.draw(ctx, k.sigil, x, y - S * 0.03, S * 0.5, '#f6ecd2');
      // число воинов
      const men = menCount(a.units);
      const txt = men >= 1000 ? (men / 1000).toFixed(1) + 'к' : String(men);
      ctx.font = '700 11px "PT Sans Narrow", "Arial Narrow", sans-serif';
      const tw = ctx.measureText(txt).width + 8;
      ctx.fillStyle = 'rgba(25,15,8,0.85)';
      this.roundRect(ctx, x - tw / 2, y + S * 0.42, tw, 14, 7); ctx.fill();
      ctx.fillStyle = a.state === 'retreat' ? '#ffb0a0' : '#fff3d6';
      ctx.textAlign = 'center';
      ctx.fillText(txt, x, y + S * 0.42 + 11);
      if (a.state === 'siege') Icons.draw(ctx, 'target', x + S * 0.5, y - S * 0.45, 12, '#ffcf7a');
      if (a.state === 'retreat') Icons.draw(ctx, 'flag', x + S * 0.5, y - S * 0.45, 12, '#ffffff');
    }
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

  // частицы в мировых координатах
  spawn(type, x, y) {
    if (this.particles.length > 400) return;
    const p = { type, x, y, t: 0, vx: (Math.random() - 0.5) * 0.4, vy: -0.3 - Math.random() * 0.4 };
    if (type === 'dust') { p.dur = 0.9; p.vy = -0.1 - Math.random() * 0.2; }
    else if (type === 'smoke') p.dur = 2.2;
    else if (type === 'fire') { p.dur = 0.7; p.vy = -0.6; }
    else if (type === 'debris') { p.dur = 0.9; const a = Math.random() * TAU, v = 0.8 + Math.random() * 1.5; p.vx = Math.cos(a) * v; p.vy = Math.sin(a) * v - 0.6; }
    this.particles.push(p);
  }
  drawParticles(ctx, dt) {
    const z = this.cam.z;
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.t += dt;
      if (p.t >= p.dur) { this.particles.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.type === 'debris') p.vy += 2.5 * dt;
      const s = this.toScreen(p.x, p.y);
      const k = p.t / p.dur;
      if (p.type === 'dust') { ctx.fillStyle = `rgba(150,120,80,${0.5 * (1 - k)})`; ctx.beginPath(); ctx.arc(s.x, s.y, (0.12 + k * 0.25) * z, 0, TAU); ctx.fill(); }
      else if (p.type === 'smoke') { ctx.fillStyle = `rgba(70,65,60,${0.45 * (1 - k)})`; ctx.beginPath(); ctx.arc(s.x, s.y, (0.15 + k * 0.4) * z, 0, TAU); ctx.fill(); }
      else if (p.type === 'fire') { ctx.fillStyle = `rgba(255,${150 + 80 * (1 - k) | 0},40,${0.9 * (1 - k)})`; ctx.beginPath(); ctx.arc(s.x, s.y, (0.08 + (1 - k) * 0.1) * z, 0, TAU); ctx.fill(); }
      else if (p.type === 'debris') { ctx.fillStyle = `rgba(90,75,60,${1 - k})`; ctx.fillRect(s.x - 2, s.y - 2, 4, 4); }
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
