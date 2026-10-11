'use strict';
// Общие помощники: математика, детерминированный генератор, шум, куча.

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const lerp = (a, b, t) => a + (b - a) * t;
const dist = (ax, ay, bx, by) => Math.hypot(bx - ax, by - ay);

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6D2B79F5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// Генератор с удобными методами; вся случайность игры идёт через него, чтобы сохранения были воспроизводимы.
class Rng {
  constructor(seed) { this.state = seed >>> 0; }
  next() {
    this.state = (this.state + 0x6D2B79F5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), 1 | t);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }
  range(a, b) { return a + this.next() * (b - a); }
  int(a, b) { return Math.floor(a + this.next() * (b - a + 1)); }
  pick(arr) { return arr[Math.floor(this.next() * arr.length)]; }
  chance(p) { return this.next() < p; }
  shuffle(arr) {
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(this.next() * (i + 1));
      const t = arr[i]; arr[i] = arr[j]; arr[j] = t;
    }
    return arr;
  }
}

function makeNoise(seed) {
  const rng = mulberry32(seed);
  const S = 128, vals = new Float32Array(S * S);
  for (let i = 0; i < vals.length; i++) vals[i] = rng();
  const v = (i, j) => vals[(j & 127) * S + (i & 127)];
  const sm = t => t * t * (3 - 2 * t);
  return function (x, y) {
    const xi = Math.floor(x), yi = Math.floor(y);
    const tx = sm(x - xi), ty = sm(y - yi);
    return lerp(lerp(v(xi, yi), v(xi + 1, yi), tx), lerp(v(xi, yi + 1), v(xi + 1, yi + 1), tx), ty);
  };
}
function fractal(noise, x, y, octaves) {
  let sum = 0, amp = 1, freq = 1, norm = 0;
  for (let o = 0; o < octaves; o++) {
    sum += noise(x * freq + o * 17.3, y * freq + o * 9.1) * amp;
    norm += amp; amp *= 0.5; freq *= 2.03;
  }
  return sum / norm;
}

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
      for (;;) {
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
function fmtInt(n) { return Math.floor(n).toLocaleString('ru-RU'); }
function fmtRate(n) {
  const r = Math.round(n);
  return (r > 0 ? '+' : r < 0 ? '−' : '±') + Math.abs(r);
}
function plural(n, one, few, many) {
  const a = Math.abs(n) % 100, b = a % 10;
  if (a > 10 && a < 20) return many;
  if (b > 1 && b < 5) return few;
  if (b === 1) return one;
  return many;
}
function bytesToB64(u8) {
  let s = '';
  for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000));
  return btoa(s);
}
function b64ToBytes(b64) {
  const s = atob(b64);
  const u8 = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u8[i] = s.charCodeAt(i);
  return u8;
}
function fmtTime(t) {
  const s = Math.max(0, Math.ceil(t));
  return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
}

// Модули игры (дивизии и фронты, общество, дипломатия, полководцы, флот, основание городов)
// живут в своих файлах и подключаются к Game через Mods: Mods.add({ name, init, update, serialize, restore, modify: { … } }).
// init(g, loaded) — после создания или загрузки партии; update(g, dt) — каждый шаг; serialize(g) → данные для сохранения;
// restore(g, data) — при загрузке (data может отсутствовать в старых сохранениях); modify.<имя>(g, значение, …) → новое значение.
const Mods = {
  list: [],
  add(m) { this.list.push(m); return m; },
  get(name) { for (const m of this.list) if (m.name === name) return m; return null; },
  call(fn, g, a, b, c) { for (const m of this.list) if (m[fn]) m[fn](g, a, b, c); },
  mod(key, g, v, a, b, c) {
    for (const m of this.list) if (m.modify && m.modify[key]) v = m.modify[key](g, v, a, b, c);
    return v;
  },
};
// Расширения интерфейса: вкладки панели державы, строки в шапке города, разделы города, обработчики data-act,
// слои отрисовки и инструменты ввода (рисование фронта, стройка стен).
const UIExt = { kingdomTabs: [], cityHeader: [], citySections: [], actions: {}, armyPanel: null };
const RenderExt = { map: [], screen: [] };
