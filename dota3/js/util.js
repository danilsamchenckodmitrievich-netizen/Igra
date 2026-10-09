'use strict';
// Общие математические помощники.

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;

function dist(ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  return Math.sqrt(dx * dx + dy * dy);
}
function distSq(ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  return dx * dx + dy * dy;
}
const distU = (a, b) => dist(a.x, a.y, b.x, b.y);
// Расстояние между краями двух юнитов.
const gapU = (a, b) => distU(a, b) - a.radius - b.radius;
const angleTo = (a, b) => Math.atan2(b.y - a.y, b.x - a.x);

const rand = (a, b) => a + Math.random() * (b - a);
const randInt = (a, b) => Math.floor(a + Math.random() * (b - a + 1));
const choice = arr => arr[Math.floor(Math.random() * arr.length)];
function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
  }
  return arr;
}

// Детерминированный генератор для карты.
function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeNoise(seed) {
  const rng = mulberry32(seed);
  const S = 64, vals = new Float32Array(S * S);
  for (let i = 0; i < vals.length; i++) vals[i] = rng();
  const v = (i, j) => vals[(j & 63) * S + (i & 63)];
  const sm = t => t * t * (3 - 2 * t);
  function n(x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const tx = sm(x - xi), ty = sm(y - yi);
    return lerp(lerp(v(xi, yi), v(xi + 1, yi), tx), lerp(v(xi, yi + 1), v(xi + 1, yi + 1), tx), ty);
  }
  return (x, y) => n(x, y) * 0.65 + n(x * 2.3 + 17, y * 2.3 + 9) * 0.35;
}

function distToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay;
  const l2 = dx * dx + dy * dy;
  let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
  t = clamp(t, 0, 1);
  return dist(px, py, ax + dx * t, ay + dy * t);
}
function distToPolyline(px, py, pts) {
  let best = Infinity;
  for (let i = 0; i < pts.length - 1; i++) {
    const d = distToSegment(px, py, pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
    if (d < best) best = d;
  }
  return best;
}
function polylineLength(pts) {
  let l = 0;
  for (let i = 0; i < pts.length - 1; i++) l += dist(pts[i].x, pts[i].y, pts[i + 1].x, pts[i + 1].y);
  return l;
}
function pointAlong(pts, d) {
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const l = dist(a.x, a.y, b.x, b.y);
    if (d <= l) return { x: lerp(a.x, b.x, d / l), y: lerp(a.y, b.y, d / l) };
    d -= l;
  }
  const last = pts[pts.length - 1];
  return { x: last.x, y: last.y };
}
// Насколько далеко вдоль ломаной находится проекция точки.
function projectOnPolyline(pts, px, py) {
  let best = Infinity, bestAlong = 0, acc = 0;
  for (let i = 0; i < pts.length - 1; i++) {
    const a = pts[i], b = pts[i + 1];
    const dx = b.x - a.x, dy = b.y - a.y;
    const l2 = dx * dx + dy * dy, l = Math.sqrt(l2);
    const t = clamp(((px - a.x) * dx + (py - a.y) * dy) / l2, 0, 1);
    const d = dist(px, py, a.x + dx * t, a.y + dy * t);
    if (d < best) { best = d; bestAlong = acc + l * t; }
    acc += l;
  }
  return { along: bestAlong, off: best };
}

function fmtTime(t) {
  const neg = t < 0;
  const s = neg ? Math.ceil(-t) : Math.floor(t);
  return (neg ? '-' : '') + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

function armorMult(a) {
  return 1 - (0.06 * a) / (1 + 0.06 * Math.abs(a));
}

// Значение способности для уровня: массив по уровням или число.
const LV = (v, lv) => (Array.isArray(v) ? v[clamp(lv, 1, v.length) - 1] : v);

class MinHeap {
  constructor() { this.items = []; this.pri = []; }
  get size() { return this.items.length; }
  clear() { this.items.length = 0; this.pri.length = 0; }
  push(item, p) {
    const it = this.items, pr = this.pri;
    let i = it.length;
    it.push(item); pr.push(p);
    while (i > 0) {
      const par = (i - 1) >> 1;
      if (pr[par] <= p) break;
      it[i] = it[par]; pr[i] = pr[par];
      i = par;
    }
    it[i] = item; pr[i] = p;
  }
  pop() {
    const it = this.items, pr = this.pri;
    const top = it[0];
    const lastI = it.pop(), lastP = pr.pop();
    const n = it.length;
    if (n > 0) {
      let i = 0;
      while (true) {
        let c = 2 * i + 1;
        if (c >= n) break;
        if (c + 1 < n && pr[c + 1] < pr[c]) c++;
        if (pr[c] >= lastP) break;
        it[i] = it[c]; pr[i] = pr[c];
        i = c;
      }
      it[i] = lastI; pr[i] = lastP;
    }
    return top;
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
