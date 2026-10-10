'use strict';
// Фигурки войск и анимация сражений: строй армии, походный шаг, рукопашная, стрелы, осадные машины.
// Спрайты рисуются один раз в offscreen canvas и берутся из кэша.

const UnitArt = (() => {
  const FORMATION_Z = 22;     // с этого увеличения (пикселей на клетку) армия рисуется строем фигурок
  const FIG_H = 0.7;          // рост фигурки в долях Renderer.armySize()
  const INK = '#2a1b0d';
  const PAL = {
    skin: '#e3b98f', skinD: '#b88b63',
    steel: '#c4c8cc', steelD: '#7c8287', steelL: '#eef0f2',
    mail: '#9c9fa2', mailD: '#6d7174',
    leather: '#8b5a31', leatherD: '#5a391c',
    wood: '#a2723f', woodD: '#6c4725', woodL: '#c99d66',
    linen: '#dccb9f', hose: '#5d4834', boot: '#3e2a17',
    straw: '#dcbb62', strawD: '#a98835',
    horse: '#8d5c36', horseD: '#5e3b20', mane: '#2f2014',
    pony: '#b08452', grey: '#bdb6aa',
    hide: '#8f7b5c', hideD: '#6a5a40', rope: '#d9c79a', stone: '#9c968c', light: '#f3e7c6', gold: '#d6a63c',
  };
  // рост человечка в пикселях устройства, под которые рисуется кэш; промежуточные размеры чуть ужимаются
  const BUCKETS = [14, 18, 22, 27, 33, 40, 48, 58, 70, 84];
  let LW = 0.024;             // тонкая чернильная линия в долях роста

  // ---------- цвет и мелочи ----------
  function tone(hex, f) {
    const n = parseInt(hex.slice(1), 16);
    let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255;
    if (f <= 1) { r *= f; g *= f; b *= f; } else { const k = f - 1; r += (255 - r) * k; g += (255 - g) * k; b += (255 - b) * k; }
    return '#' + ((1 << 24) | (Math.round(r) << 16) | (Math.round(g) << 8) | Math.round(b)).toString(16).slice(1);
  }
  function mixHex(a, b, t) {
    const p = parseInt(a.slice(1), 16), q = parseInt(b.slice(1), 16);
    const ch = s => Math.round(((p >> s) & 255) * (1 - t) + ((q >> s) & 255) * t);
    return '#' + ((1 << 24) | (ch(16) << 16) | (ch(8) << 8) | ch(0)).toString(16).slice(1);
  }
  function hash(n) {
    let h = (n * 2654435761) >>> 0;
    h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13;
    return (h >>> 0) / 4294967296;
  }
  const smooth = t => (t <= 0 ? 0 : t >= 1 ? 1 : t * t * (3 - 2 * t));

  // ---------- примитивы (координаты в долях роста, ступни в (0,0), лицом вправо) ----------
  function path(c, pts, close) {
    c.beginPath(); c.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) c.lineTo(pts[i], pts[i + 1]);
    if (close !== false) c.closePath();
  }
  function poly(c, pts, fill, noStroke) {
    path(c, pts);
    c.fillStyle = fill; c.fill();
    if (!noStroke) { c.strokeStyle = INK; c.lineWidth = LW; c.stroke(); }
  }
  // палка с чернильным контуром: конечность, древко
  function bar(c, x0, y0, x1, y1, w, col) {
    c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1);
    c.strokeStyle = INK; c.lineWidth = w + LW * 2; c.stroke();
    c.strokeStyle = col; c.lineWidth = w; c.stroke();
  }
  function limb(c, x0, y0, x1, y1, x2, y2, w, col) {
    c.beginPath(); c.moveTo(x0, y0); c.lineTo(x1, y1); c.lineTo(x2, y2);
    c.strokeStyle = INK; c.lineWidth = w + LW * 2; c.stroke();
    c.strokeStyle = col; c.lineWidth = w; c.stroke();
  }
  function disc(c, x, y, r, col) {
    c.beginPath(); c.arc(x, y, r, 0, TAU);
    c.fillStyle = col; c.fill(); c.strokeStyle = INK; c.lineWidth = LW; c.stroke();
  }
  function oval(c, x, y, rx, ry, rot, col, noStroke) {
    c.beginPath(); c.ellipse(x, y, rx, ry, rot, 0, TAU);
    c.fillStyle = col; c.fill();
    if (!noStroke) { c.strokeStyle = INK; c.lineWidth = LW; c.stroke(); }
  }
  // средний сустав двухзвенной конечности; side выбирает, куда сгибается
  function joint(ax, ay, bx, by, l1, l2, side) {
    const dx = bx - ax, dy = by - ay, D = Math.hypot(dx, dy) || 1e-4;
    const d = Math.min(D, l1 + l2 - 1e-4);
    const a = (l1 * l1 - l2 * l2 + d * d) / (2 * d);
    const h = Math.sqrt(Math.max(0, l1 * l1 - a * a));
    const ux = dx / D, uy = dy / D;
    return [ax + ux * a - uy * h * side, ay + uy * a + ux * h * side];
  }

  // ---------- снаряжение ----------
  const GEAR = {
    militia: { torso: 'peasant', head: 'straw', legs: 'hose', weapon: 'fork', two: true },
    scout: { torso: 'cloak', head: 'cowl', legs: 'hose', weapon: 'javelin', mount: 'pony' },
    spear: { torso: 'gambeson', head: 'kettle', legs: 'hose', weapon: 'spear', shield: 'round' },
    sword: { torso: 'mail', head: 'nasal', legs: 'mail', weapon: 'sword', shield: 'heater' },
    archer: { torso: 'tunic', head: 'hood', legs: 'hose', weapon: 'bow', back: 'quiver' },
    crossbow: { torso: 'gambeson', head: 'kettle', legs: 'hose', weapon: 'xbow', back: 'pavise' },
    cavalry: { torso: 'mail', head: 'nasal', legs: 'mail', weapon: 'sword', shield: 'round', mount: 'horse' },
    knight: { torso: 'plate', head: 'great', legs: 'plate', weapon: 'lance', shield: 'heater', mount: 'destrier' },
    ram: { machine: 'ram' },
    catapult: { machine: 'catapult' },
    crew: { torso: 'peasant', head: 'cap', legs: 'hose', weapon: null },
  };
  const ROLE = { militia: 'inf', spear: 'inf', sword: 'inf', archer: 'ranged', crossbow: 'ranged', scout: 'cav', cavalry: 'cav', knight: 'cav', ram: 'siege', catapult: 'siege' };
  // знаменосец: тот же воин, но в ближней руке древко стяга
  const bearers = {};
  function gearOf(uid) {
    if (GEAR[uid]) return GEAR[uid];
    if (!bearers[uid]) {
      const base = GEAR[uid.slice(2)] || GEAR.militia;
      bearers[uid] = Object.assign({}, base, { weapon: 'pole', two: false, back: base.back === 'pavise' ? null : base.back });
    }
    return bearers[uid];
  }
  // пеший вид для павших всадников и обслуги машин
  const fallenGear = {};
  function footGear(uid, G) {
    if (G.machine) return GEAR.crew;
    if (!fallenGear[uid]) fallenGear[uid] = Object.assign({}, G, { mount: null, weapon: null, two: false });
    return fallenGear[uid];
  }

  function dress(G, kc, kd) {
    const d = { body: kc, sleeve: kc, legs: PAL.hose, boot: PAL.boot, hand: PAL.skin };
    if (G.torso === 'peasant') { d.body = d.sleeve = mixHex(PAL.linen, kc, 0.55); d.legs = tone(PAL.hose, 1.1); }
    else if (G.torso === 'mail') { d.sleeve = PAL.mail; d.legs = PAL.mail; d.hand = PAL.leather; }
    else if (G.torso === 'plate') { d.sleeve = PAL.steel; d.legs = PAL.steel; d.hand = PAL.steel; d.boot = PAL.steelD; }
    else if (G.torso === 'cloak') { d.sleeve = kd; d.legs = tone(kd, 0.9); }
    else if (G.torso === 'gambeson') d.legs = tone(kd, 0.95);
    else if (G.torso === 'tunic') d.legs = PAL.hose;
    d.sleeveF = tone(d.sleeve, 0.8);
    d.legsF = tone(d.legs, 0.78);
    return d;
  }

  // ---------- позы пешего воина (руки и оружие — относительно середины плеч) ----------
  function footPose(G, pose, f) {
    const P = { fx: -0.05, fy: 0, nx: 0.05, ny: 0, lean: 0, dy: 0, hn: [0.1, 0.3], hf: [-0.02, 0.3] };
    let s = 0;
    if (pose === 'walk' || pose === 'run') {
      const run = pose === 'run', ph = f * Math.PI / 2;
      s = Math.sin(ph) * (run ? 0.17 : 0.12);
      P.fx = -0.03 + s; P.nx = 0.03 - s;
      const lift = run ? 0.09 : 0.055;
      P.fy = Math.max(0, Math.cos(ph)) * lift; P.ny = Math.max(0, -Math.cos(ph)) * lift;
      P.dy = (f % 2 === 0 ? -0.02 : 0.006) * (run ? 1.4 : 1);
      P.lean = run ? 0.08 : 0.02;
    } else if (pose === 'attack') {
      P.fx = -0.11; P.nx = 0.1;
      P.lean = [-0.035, 0.07, 0.03][f];
      P.dy = [0, 0.025, 0.012][f];
    }
    armPose(G, pose, f, P, s);
    return P;
  }
  // руки и оружие; общая для пеших и всадников
  function armPose(G, pose, f, P, s) {
    const atk = pose === 'attack', run = pose === 'run';
    const sw = s * 0.5;
    P.hn = [0.06 - sw, 0.3]; P.hf = [-0.02 + sw, 0.3];
    switch (G.weapon) {
      case 'fork': case 'spear': {
        const long = G.weapon === 'spear' ? 0.13 : 0;
        if (atk) {
          const k = [[-0.03, -0.4, 0.5], [0.2, -0.16, 0.8], [0.1, -0.28, 0.66]][f];
          P.hn = [k[0], 0.17]; P.wa = [k[1], 0.22]; P.wb = [k[2] + long, 0.08 + f * 0.02];
          if (G.two) P.hf = [k[0] + 0.2, 0.14];
        } else if (run) {
          P.hn = [0.08, 0.24]; P.wa = [0.3, 0.38]; P.wb = [-0.42 - long * 0.7, -0.42 - long * 0.5];
          if (G.two) P.hf = [-0.04, 0.17];
        } else {
          const tilt = pose === 'walk' ? 0.05 : 0.02;
          P.hn = [0.14, 0.19]; P.wa = [0.11, 0.68]; P.wb = [0.17 + tilt + long * 0.15, -0.62 - long * 1.1];
          if (G.two) P.hf = [0.12 + sw * 0.4, 0.34];
        }
        if (G.shield) P.hf = atk ? [0.17, 0.17] : run ? [-0.06, 0.24] : [0.12, 0.22];
        break;
      }
      case 'javelin': {
        if (atk) {
          const k = [[-0.06, -0.12, -0.32, -0.04, 0.28, -0.24], [0.22, 0.02, -0.06, 0.06, 0.6, -0.08], [0.15, 0.12, -0.12, 0.2, 0.45, 0.02]][f];
          P.hn = [k[0], k[1]]; P.wa = [k[2], k[3]]; P.wb = [k[4], k[5]];
        } else if (run) { P.hn = [0.06, 0.25]; P.wa = [0.22, 0.36]; P.wb = [-0.34, -0.12]; }
        else { P.hn = [0.13, 0.2]; P.wa = [0.11, 0.48]; P.wb = [0.19, -0.42]; }
        P.hf = [0.12, 0.26];
        break;
      }
      case 'lance': {
        if (atk) {
          const k = [[0.04, -0.32, 0.1, 0.95, -0.2], [0.1, -0.14, 0.14, 1.18, 0.04], [0.06, -0.24, 0.12, 1.02, -0.08]][f];
          P.hn = [k[0], 0.14]; P.wa = [k[1], k[2]]; P.wb = [k[3], k[4]];
        } else if (run) { P.hn = [0.1, 0.18]; P.wa = [0.28, 0.32]; P.wb = [-0.75, -0.62]; }
        else { P.hn = [0.13, 0.17]; P.wa = [0.1, 0.42]; P.wb = [0.24, -1.05]; }
        P.hf = atk ? [0.16, 0.16] : [0.12, 0.2];
        break;
      }
      case 'sword': {
        if (atk) {
          const k = [[-0.02, -0.11, -0.3, -0.32], [0.23, 0.13, 0.5, 0.33], [0.18, 0.06, 0.53, 0.0]][f];
          P.hn = [k[0], k[1]]; P.wb = [k[2], k[3]];
        } else if (run) { P.hn = [0.08, 0.27]; P.wb = [-0.2, 0.33]; }
        else { P.hn = [0.14, 0.22]; P.wb = [0.25, -0.12]; }
        P.hf = atk ? [0.17, 0.16] : run ? [-0.06, 0.24] : [0.12, 0.21];
        break;
      }
      case 'bow': {
        P.bt = 0.15; P.draw = false; P.arrow = false;
        if (atk) {
          if (f === 0) { P.hf = [0.3, 0.02]; P.hn = [-0.02, 0.0]; P.bt = 0.08; P.draw = true; P.arrow = true; }
          else if (f === 1) { P.hf = [0.3, 0.02]; P.hn = [-0.1, 0.05]; P.bt = 0.08; }
          else { P.hf = [0.2, 0.16]; P.hn = [-0.12, -0.07]; P.bt = 0.45; }
        } else if (run) { P.hf = [0.0, 0.25]; P.hn = [0.08, 0.27]; P.bt = -0.7; }
        else { P.hf = [0.15, 0.22]; P.hn = [0.05 - sw, 0.31]; P.bt = 0.12; }
        break;
      }
      case 'xbow': {
        P.loaded = true;
        if (atk) {
          const k = [[-0.02, 0.06, 0.36, 0.04], [-0.02, 0.03, 0.35, -0.04], [0.06, 0.15, 0.2, 0.5]][f];
          P.xa = [k[0], k[1]]; P.xb = [k[2], k[3]]; P.loaded = f === 0;
          P.hn = f === 2 ? [0.04, 0.12] : [0.04, 0.07]; P.hf = f === 2 ? [0.16, 0.36] : [0.24, 0.06];
        } else if (run) { P.xa = [-0.04, 0.27]; P.xb = [0.2, 0.46]; P.hn = [0.02, 0.29]; P.hf = [0.14, 0.4]; }
        else { P.xa = [0.0, 0.22]; P.xb = [0.3, 0.38]; P.hn = [0.05, 0.25]; P.hf = [0.2, 0.32]; }
        break;
      }
      case 'pole': {
        P.hn = run ? [0.1, 0.2] : [0.14, 0.09];
        if (G.shield) P.hf = run ? [-0.06, 0.24] : [0.12, 0.22];
        break;
      }
      default:
        P.hn = [0.06 - sw, 0.31];
    }
  }

  // ---------- части тела ----------
  function leg(c, hx, hy, fx, fy, col, boot) {
    const k = joint(hx, hy, fx, fy, 0.225, 0.225, -1);
    limb(c, hx, hy, k[0], k[1], fx, fy - 0.02, 0.075, col);
    oval(c, fx + 0.025, fy - 0.014, 0.05, 0.026, 0, boot);
  }
  function seatLeg(c, hx, hy, col, boot) {
    limb(c, hx, hy, hx + 0.15, hy + 0.06, hx + 0.1, hy + 0.27, 0.075, col);
    oval(c, hx + 0.125, hy + 0.27, 0.05, 0.026, 0, boot);
  }
  function arm(c, sx, sy, hx, hy, col, hand) {
    const e = joint(sx, sy, hx, hy, 0.16, 0.16, 1);
    limb(c, sx, sy, e[0], e[1], hx, hy, 0.068, col);
    disc(c, hx, hy, 0.032, hand);
  }

  function torso(c, G, tx, ty, hx, hy, d, kc, kd, seated) {
    const sk = seated ? 0.08 : 0.15;
    const skirt = [hx - 0.105, hy - 0.02, hx + 0.105, hy - 0.02, hx + 0.13, hy + sk, hx - 0.125, hy + sk];
    const body = [tx - 0.115, ty, tx + 0.115, ty, hx + 0.1, hy, hx - 0.1, hy];
    const backHalf = [tx - 0.115, ty, tx - 0.025, ty, hx - 0.03, hy, hx - 0.1, hy];
    if (G.torso === 'cloak') {
      poly(c, body, kc);
      poly(c, [tx - 0.13, ty - 0.01, tx + 0.04, ty, hx + 0.02, hy + sk + 0.02, hx - 0.17, hy + sk + 0.03], kd);
      poly(c, [tx - 0.13, ty - 0.01, tx - 0.05, ty, hx - 0.07, hy + sk + 0.02, hx - 0.17, hy + sk + 0.03], tone(kd, 0.8), true);
      disc(c, tx + 0.05, ty + 0.03, 0.022, PAL.gold);
      return;
    }
    const under = G.torso === 'mail' ? PAL.mail : G.torso === 'plate' ? PAL.steel : d.body;
    poly(c, skirt, G.torso === 'mail' || G.torso === 'plate' ? under : d.body);
    poly(c, body, under);
    if (G.torso === 'mail' || G.torso === 'plate') {
      // сюрко цвета державы поверх кольчуги или лат
      poly(c, [tx - 0.08, ty + 0.015, tx + 0.085, ty + 0.015, hx + 0.08, hy, hx + 0.1, hy + sk - 0.01, hx - 0.095, hy + sk - 0.01, hx - 0.08, hy], kc);
      poly(c, [tx - 0.08, ty + 0.015, tx - 0.02, ty + 0.015, hx - 0.025, hy, hx - 0.03, hy + sk - 0.01, hx - 0.095, hy + sk - 0.01, hx - 0.08, hy], tone(kc, 0.82), true);
      bar(c, hx - 0.09, hy - 0.005, hx + 0.09, hy - 0.005, 0.022, PAL.leatherD);
      if (G.torso === 'plate') { disc(c, tx + 0.08, ty + 0.03, 0.05, PAL.steel); }
      else { c.strokeStyle = PAL.light; c.lineWidth = 0.022; c.beginPath(); c.moveTo((tx + hx) / 2 + 0.03, ty + 0.06); c.lineTo((tx + hx) / 2 + 0.03, hy + 0.06); c.stroke(); }
      return;
    }
    poly(c, backHalf, tone(d.body, 0.84), true);
    if (G.torso === 'gambeson') {
      c.strokeStyle = tone(kd, 1.05); c.lineWidth = 0.014;
      c.beginPath();
      for (const t of [0.35, 0.65]) { c.moveTo(tx - 0.115 + 0.23 * t, ty + 0.02); c.lineTo(hx - 0.1 + 0.2 * t, hy + sk - 0.02); }
      c.stroke();
    }
    if (G.torso === 'tunic') bar(c, tx - 0.1, ty + 0.01, hx + 0.09, hy - 0.02, 0.022, PAL.leather);
    bar(c, hx - 0.1, hy - 0.01, hx + 0.1, hy - 0.01, 0.024, G.torso === 'peasant' ? PAL.rope : PAL.leatherD);
  }

  function head(c, G, x, y, kc, kd) {
    const face = (fx, fy) => {
      oval(c, fx, fy, 0.064, 0.072, 0, PAL.skin);
      c.fillStyle = INK; c.beginPath(); c.arc(fx + 0.022, fy - 0.012, 0.013, 0, TAU); c.fill();
    };
    switch (G.head) {
      case 'straw':
        disc(c, x, y, 0.095, PAL.skin);
        c.fillStyle = INK; c.beginPath(); c.arc(x + 0.05, y - 0.005, 0.013, 0, TAU); c.fill();
        oval(c, x - 0.01, y - 0.045, 0.175, 0.045, 0, PAL.straw);
        c.beginPath(); c.ellipse(x - 0.012, y - 0.06, 0.085, 0.075, 0, Math.PI, TAU); c.closePath();
        c.fillStyle = PAL.straw; c.fill(); c.strokeStyle = INK; c.lineWidth = LW; c.stroke();
        bar(c, x - 0.09, y - 0.065, x + 0.07, y - 0.065, 0.018, kc);
        break;
      case 'hood': case 'cowl': {
        const big = G.head === 'cowl' ? 1.12 : 1;
        const col = G.head === 'cowl' ? kd : tone(kd, 1.12);
        poly(c, [x - 0.15 * big, y + 0.1, x + 0.12, y + 0.1, x + 0.1, y + 0.2, x - 0.14 * big, y + 0.21], col);
        poly(c, [x - 0.06, y - 0.07, x - 0.21 * big, y + 0.04, x - 0.08, y + 0.05], tone(col, 0.85));
        disc(c, x - 0.01, y - 0.005, 0.112 * big, col);
        face(x + 0.035, y + 0.012);
        break;
      }
      case 'kettle':
        disc(c, x, y, 0.095, PAL.skin);
        c.fillStyle = INK; c.beginPath(); c.arc(x + 0.05, y + 0.005, 0.013, 0, TAU); c.fill();
        c.beginPath(); c.arc(x, y - 0.02, 0.097, Math.PI, TAU); c.closePath();
        c.fillStyle = PAL.steel; c.fill(); c.strokeStyle = INK; c.lineWidth = LW; c.stroke();
        oval(c, x, y - 0.022, 0.16, 0.04, 0, PAL.steelD);
        c.strokeStyle = PAL.steelL; c.lineWidth = 0.018;
        c.beginPath(); c.arc(x, y - 0.02, 0.065, Math.PI * 1.15, Math.PI * 1.45); c.stroke();
        break;
      case 'nasal':
        disc(c, x - 0.005, y + 0.005, 0.108, PAL.mail);
        face(x + 0.035, y + 0.018);
        c.beginPath(); c.moveTo(x - 0.105, y - 0.02); c.quadraticCurveTo(x - 0.06, y - 0.17, x + 0.01, y - 0.19);
        c.quadraticCurveTo(x + 0.07, y - 0.15, x + 0.105, y - 0.02); c.closePath();
        c.fillStyle = PAL.steel; c.fill(); c.strokeStyle = INK; c.lineWidth = LW; c.stroke();
        bar(c, x + 0.065, y - 0.03, x + 0.07, y + 0.05, 0.02, PAL.steelD);
        c.strokeStyle = PAL.steelL; c.lineWidth = 0.016;
        c.beginPath(); c.moveTo(x - 0.06, y - 0.06); c.quadraticCurveTo(x - 0.03, y - 0.14, x + 0.0, y - 0.155); c.stroke();
        break;
      case 'great':
        // намёт цвета державы за шлемом и плюмаж
        poly(c, [x - 0.06, y - 0.12, x - 0.2, y + 0.02, x - 0.15, y + 0.12, x - 0.07, y + 0.04], tone(kc, 0.85));
        oval(c, x - 0.01, y - 0.15, 0.075, 0.045, -0.3, kc);
        c.beginPath();
        c.moveTo(x - 0.1, y - 0.11); c.lineTo(x - 0.1, y + 0.1); c.quadraticCurveTo(x, y + 0.13, x + 0.105, y + 0.1);
        c.lineTo(x + 0.105, y - 0.11); c.quadraticCurveTo(x, y - 0.15, x - 0.1, y - 0.11); c.closePath();
        c.fillStyle = PAL.steel; c.fill(); c.strokeStyle = INK; c.lineWidth = LW; c.stroke();
        c.fillStyle = tone(PAL.steel, 0.82); c.fillRect(x - 0.1, y - 0.11, 0.06, 0.21);
        bar(c, x + 0.005, y - 0.025, x + 0.1, y - 0.025, 0.02, INK);
        bar(c, x + 0.07, y - 0.1, x + 0.07, y + 0.09, 0.016, PAL.gold);
        break;
      case 'cap':
        disc(c, x, y, 0.095, PAL.skin);
        c.fillStyle = INK; c.beginPath(); c.arc(x + 0.05, y, 0.013, 0, TAU); c.fill();
        c.beginPath(); c.moveTo(x - 0.1, y - 0.02); c.quadraticCurveTo(x - 0.06, y - 0.13, x + 0.04, y - 0.12);
        c.quadraticCurveTo(x + 0.1, y - 0.08, x + 0.095, y - 0.03); c.closePath();
        c.fillStyle = kc; c.fill(); c.strokeStyle = INK; c.lineWidth = LW; c.stroke();
        break;
    }
  }

  function shield(c, type, x, y, kc, kd) {
    if (type === 'round') {
      oval(c, x, y, 0.112, 0.14, 0, kc);
      c.beginPath(); c.ellipse(x, y, 0.112, 0.14, 0, Math.PI * 0.5, Math.PI * 1.5); c.closePath();
      c.fillStyle = tone(kc, 0.8); c.fill();
      c.strokeStyle = kd; c.lineWidth = 0.02;
      c.beginPath(); c.ellipse(x, y, 0.082, 0.108, 0, 0, TAU); c.stroke();
      c.strokeStyle = INK; c.lineWidth = LW;
      c.beginPath(); c.ellipse(x, y, 0.112, 0.14, 0, 0, TAU); c.stroke();
      disc(c, x + 0.01, y, 0.034, PAL.steel);
      return;
    }
    // треугольный (геральдический) щит со стропилом
    const sh = () => {
      c.beginPath();
      c.moveTo(x - 0.115, y - 0.155); c.lineTo(x + 0.115, y - 0.155); c.lineTo(x + 0.112, y + 0.02);
      c.quadraticCurveTo(x + 0.09, y + 0.14, x, y + 0.2); c.quadraticCurveTo(x - 0.09, y + 0.14, x - 0.112, y + 0.02);
      c.closePath();
    };
    sh(); c.fillStyle = kc; c.fill();
    c.save(); sh(); c.clip();
    c.fillStyle = PAL.light;
    path(c, [x - 0.13, y + 0.07, x, y - 0.06, x + 0.13, y + 0.07, x + 0.13, y + 0.14, x, y + 0.01, x - 0.13, y + 0.14]); c.fill();
    c.fillStyle = 'rgba(30,15,5,0.2)'; c.fillRect(x - 0.13, y - 0.17, 0.12, 0.4);
    c.restore();
    sh(); c.strokeStyle = INK; c.lineWidth = LW * 1.2; c.stroke();
  }

  function quiver(c, x, y) {
    c.save(); c.translate(x, y); c.rotate(0.38);
    bar(c, -0.03, -0.1, 0.06, -0.12, 0.016, PAL.light);
    bar(c, 0.0, -0.11, 0.02, -0.15, 0.016, PAL.light);
    poly(c, [-0.045, -0.08, 0.045, -0.08, 0.04, 0.17, -0.04, 0.17], PAL.leather);
    c.restore();
  }
  function pavise(c, x, y, kc, kd) {
    poly(c, [x - 0.11, y - 0.02, x - 0.05, y - 0.08, x + 0.05, y - 0.08, x + 0.11, y - 0.02, x + 0.1, y + 0.34, x - 0.1, y + 0.34], kc);
    poly(c, [x - 0.03, y - 0.075, x + 0.03, y - 0.075, x + 0.03, y + 0.34, x - 0.03, y + 0.34], kd, true);
  }

  function polearm(c, G, P, tx, ty, kc, kd) {
    const ax = tx + P.wa[0], ay = ty + P.wa[1], bx = tx + P.wb[0], by = ty + P.wb[1];
    const L = Math.hypot(bx - ax, by - ay) || 1, ux = (bx - ax) / L, uy = (by - ay) / L, px = -uy, py = ux;
    const w = G.weapon === 'lance' ? 0.042 : 0.032;
    if (G.weapon === 'lance') {
      // вымпел у острия
      const qx = bx - ux * 0.16, qy = by - uy * 0.16;
      poly(c, [qx, qy, qx - ux * 0.22 + px * 0.0, qy - uy * 0.22, qx - ux * 0.04 - px * 0.16 - ux * 0.12, qy - uy * 0.04 - py * 0.16 - uy * 0.12], kc);
    }
    bar(c, ax, ay, bx, by, w, G.weapon === 'lance' ? PAL.woodL : PAL.wood);
    if (G.weapon === 'fork') {
      const cx = bx - ux * 0.11, cy = by - uy * 0.11;
      bar(c, cx + px * 0.065, cy + py * 0.065, cx - px * 0.065, cy - py * 0.065, 0.024, PAL.woodD);
      for (const o of [-0.06, 0, 0.06]) bar(c, cx + px * o, cy + py * o, bx + px * o * 1.15 + ux * 0.03, by + py * o * 1.15 + uy * 0.03, 0.017, PAL.steelD);
    } else {
      const len = G.weapon === 'spear' ? 0.15 : G.weapon === 'lance' ? 0.14 : 0.1;
      const wd = G.weapon === 'lance' ? 0.03 : 0.036;
      const bx2 = bx + ux * len, by2 = by + uy * len;
      poly(c, [bx - ux * 0.02, by - uy * 0.02, bx + ux * len * 0.35 + px * wd, by + uy * len * 0.35 + py * wd, bx2, by2, bx + ux * len * 0.35 - px * wd, by + uy * len * 0.35 - py * wd], PAL.steelL);
    }
  }
  function sword(c, P, tx, ty) {
    const hx = tx + P.hn[0], hy = ty + P.hn[1], bx = tx + P.wb[0], by = ty + P.wb[1];
    const L = Math.hypot(bx - hx, by - hy) || 1, ux = (bx - hx) / L, uy = (by - hy) / L, px = -uy, py = ux;
    bar(c, hx - ux * 0.06, hy - uy * 0.06, hx, hy, 0.03, PAL.leatherD);
    disc(c, hx - ux * 0.07, hy - uy * 0.07, 0.022, PAL.gold);
    c.beginPath(); c.moveTo(hx + ux * 0.04 + px * 0.03, hy + uy * 0.04 + py * 0.03); c.lineTo(bx - px * 0.012, by - py * 0.012);
    c.lineTo(bx + ux * 0.03, by + uy * 0.03); c.lineTo(hx + ux * 0.04 - px * 0.03, hy + uy * 0.04 - py * 0.03); c.closePath();
    c.fillStyle = PAL.steelL; c.fill(); c.strokeStyle = INK; c.lineWidth = LW * 0.7; c.stroke();
    bar(c, hx + ux * 0.035 + px * 0.06, hy + uy * 0.035 + py * 0.06, hx + ux * 0.035 - px * 0.06, hy + uy * 0.035 - py * 0.06, 0.026, PAL.gold);
  }
  function bow(c, P, tx, ty) {
    const gx = tx + P.hf[0], gy = ty + P.hf[1], t = P.bt;
    const vx = Math.sin(t), vy = -Math.cos(t), nx = Math.cos(t), ny = Math.sin(t);
    const ax = gx + vx * 0.31 - nx * 0.03, ay = gy + vy * 0.31 - ny * 0.03;
    const bx = gx - vx * 0.31 - nx * 0.03, by = gy - vy * 0.31 - ny * 0.03;
    const sx = tx + P.hn[0], sy = ty + P.hn[1];
    c.strokeStyle = PAL.rope; c.lineWidth = 0.012;
    c.beginPath(); c.moveTo(ax, ay);
    if (P.draw) c.lineTo(sx, sy);
    c.lineTo(bx, by); c.stroke();
    c.beginPath(); c.moveTo(ax, ay); c.quadraticCurveTo(gx + nx * 0.14, gy + ny * 0.14, bx, by);
    c.strokeStyle = INK; c.lineWidth = 0.05; c.stroke();
    c.strokeStyle = PAL.wood; c.lineWidth = 0.03; c.stroke();
    if (P.arrow) {
      const ex = gx + nx * 0.14, ey = gy + ny * 0.14;
      bar(c, sx, sy, ex, ey, 0.014, PAL.woodL);
      poly(c, [ex + nx * 0.05, ey + ny * 0.05, ex - ny * 0.02, ey + nx * 0.02, ex + ny * 0.02, ey - nx * 0.02], PAL.steelD);
    }
  }
  function crossbow(c, P, tx, ty) {
    const ax = tx + P.xa[0], ay = ty + P.xa[1], bx = tx + P.xb[0], by = ty + P.xb[1];
    const L = Math.hypot(bx - ax, by - ay) || 1, ux = (bx - ax) / L, uy = (by - ay) / L, px = -uy, py = ux;
    bar(c, ax, ay, bx, by, 0.045, PAL.wood);
    const nx = bx - ux * (P.loaded ? 0.2 : 0.05), ny = by - uy * (P.loaded ? 0.2 : 0.05);
    c.strokeStyle = PAL.rope; c.lineWidth = 0.012;
    c.beginPath(); c.moveTo(bx + px * 0.13 - ux * 0.02, by + py * 0.13 - uy * 0.02); c.lineTo(nx, ny); c.lineTo(bx - px * 0.13 - ux * 0.02, by - py * 0.13 - uy * 0.02); c.stroke();
    c.beginPath(); c.moveTo(bx + px * 0.13 - ux * 0.02, by + py * 0.13 - uy * 0.02);
    c.quadraticCurveTo(bx + ux * 0.06, by + uy * 0.06, bx - px * 0.13 - ux * 0.02, by - py * 0.13 - uy * 0.02);
    c.strokeStyle = INK; c.lineWidth = 0.045; c.stroke();
    c.strokeStyle = PAL.steelD; c.lineWidth = 0.026; c.stroke();
    if (P.loaded) bar(c, nx, ny, bx + ux * 0.06, by + uy * 0.06, 0.014, PAL.steelL);
  }

  // Человек целиком. P.seated — верхом (дальняя нога скрыта конём).
  function man(c, G, P, kc, kd) {
    const lean = P.lean || 0, dy = P.dy || 0;
    const hx = P.hx || 0, hy = (P.seated ? P.hy : -0.44) + dy;
    const tx = hx + lean, ty = hy - 0.29;
    const d = dress(G, kc, kd);
    if (G.back === 'quiver') quiver(c, tx - 0.1, ty + 0.06);
    if (G.back === 'pavise') pavise(c, tx - 0.13, ty + 0.1, kc, kd);
    if (G.torso === 'cloak') poly(c, [tx - 0.06, ty, tx - 0.19, ty + 0.1, hx - 0.26, hy + (P.seated ? 0.08 : 0.17), hx - 0.06, hy + 0.12], tone(kd, 0.75));
    if (!P.seated) leg(c, hx - 0.035, hy, P.fx, -P.fy, d.legsF, d.boot);
    const hfx = tx + P.hf[0], hfy = ty + P.hf[1];
    if (!G.shield) arm(c, tx - 0.065, ty + 0.035, hfx, hfy, d.sleeveF, d.hand);
    if (P.seated) seatLeg(c, hx + 0.02, hy, d.legs, d.boot);
    else leg(c, hx + 0.035, hy, P.nx, -P.ny, d.legs, d.boot);
    torso(c, G, tx, ty, hx, hy, d, kc, kd, P.seated);
    head(c, G, tx + 0.025, ty - 0.115, kc, kd);
    if (G.weapon === 'bow') bow(c, P, tx, ty);
    if (G.shield) shield(c, G.shield, hfx + 0.02, hfy + 0.02, kc, kd);
    if (G.weapon === 'fork' || G.weapon === 'spear' || G.weapon === 'javelin' || G.weapon === 'lance') polearm(c, G, P, tx, ty, kc, kd);
    else if (G.weapon === 'xbow') crossbow(c, P, tx, ty);
    if (G.weapon === 'sword') sword(c, P, tx, ty);
    arm(c, tx + 0.06, ty + 0.04, tx + P.hn[0], ty + P.hn[1], d.sleeve, d.hand);
  }

  // ---------- конь ----------
  const HORSE = {
    horse: { m: 1, col: PAL.horse, mane: PAL.mane },
    pony: { m: 0.86, col: PAL.pony, mane: '#4a3018' },
    destrier: { m: 1.06, col: PAL.grey, mane: '#5d564c', barded: true },
  };
  function horsePose(pose, f) {
    // ноги: ближняя передняя, дальняя передняя, ближняя задняя, дальняя задняя — [угол, подъём]
    const H = { legs: [[0.04, 0], [-0.02, 0], [-0.03, 0], [0.04, 0]], dy: 0, rot: 0, head: 0 };
    if (pose === 'walk' || pose === 'run') {
      const run = pose === 'run', ph = f * Math.PI / 2, A = run ? 0.5 : 0.34, lift = run ? 0.14 : 0.09;
      const off = [0, Math.PI, Math.PI, 0];
      for (let i = 0; i < 4; i++) {
        const p = ph + off[i] + (run && i >= 2 ? 0.6 : 0);
        H.legs[i] = [A * Math.sin(p), Math.max(0, Math.cos(p)) * lift];
      }
      H.dy = -Math.abs(Math.cos(ph)) * (run ? 0.03 : 0.015);
      H.head = run ? 0.06 : Math.sin(ph * 2) * 0.02;
    } else if (pose === 'attack') {
      if (f === 0) { H.legs = [[0.55, 0.2], [0.35, 0.16], [-0.12, 0], [0.05, 0]]; H.rot = -0.13; H.head = -0.05; }
      else if (f === 1) { H.legs = [[0.48, 0.04], [0.3, 0.02], [-0.42, 0.02], [-0.3, 0]]; H.rot = 0.03; H.head = 0.06; }
      else { H.legs = [[0.15, 0], [0.0, 0], [-0.1, 0], [0.1, 0]]; }
    }
    return H;
  }
  function horseLeg(c, tx, ty, a, lift, col, front) {
    const fx = tx + Math.sin(a) * 0.55, fy = ty + Math.cos(a) * 0.55 - lift;
    const k = joint(tx, ty, fx, fy, 0.27, 0.27, front ? -1 : 1);
    c.beginPath(); c.moveTo(tx, ty); c.lineTo(k[0], k[1]);
    c.strokeStyle = INK; c.lineWidth = 0.1 + LW * 2; c.stroke();
    c.strokeStyle = col; c.lineWidth = 0.1; c.stroke();
    limb(c, k[0], k[1], k[0], k[1], fx, fy - 0.03, 0.055, col);
    poly(c, [fx - 0.035, fy - 0.045, fx + 0.04, fy - 0.045, fx + 0.05, fy, fx - 0.04, fy], PAL.mane);
  }
  function horse(c, M, H, kc, kd) {
    const dy = H.dy, col = M.col, far = tone(col, 0.75);
    const L = H.legs;
    horseLeg(c, 0.17, -0.55 + dy, L[1][0], L[1][1], far, true);
    horseLeg(c, -0.31, -0.55 + dy, L[3][0], L[3][1], far, false);
    // хвост
    c.beginPath(); c.moveTo(-0.38, -0.68 + dy); c.quadraticCurveTo(-0.52, -0.6 + dy, -0.47, -0.36 + dy);
    c.strokeStyle = INK; c.lineWidth = 0.09; c.stroke(); c.strokeStyle = M.mane; c.lineWidth = 0.065; c.stroke();
    // туловище: бочка, грудь, круп одним силуэтом
    const hd = H.head;
    const body = () => {
      c.beginPath();
      c.ellipse(-0.02, -0.6 + dy, 0.3, 0.15, 0, 0, TAU);
      c.moveTo(0.36, -0.6 + dy); c.arc(0.22, -0.6 + dy, 0.14, 0, TAU);
      c.moveTo(-0.11, -0.61 + dy); c.arc(-0.26, -0.61 + dy, 0.15, 0, TAU);
      // шея
      c.moveTo(0.14, -0.66 + dy); c.lineTo(0.32, -0.5 + dy); c.lineTo(0.5, -0.82 + dy + hd); c.lineTo(0.37, -0.96 + dy + hd); c.closePath();
    };
    body(); c.strokeStyle = INK; c.lineWidth = LW * 2.2; c.stroke();
    body(); c.fillStyle = col; c.fill();
    // тень на брюхе
    c.beginPath(); c.ellipse(-0.02, -0.53 + dy, 0.27, 0.07, 0, 0, Math.PI); c.fillStyle = 'rgba(40,20,5,0.18)'; c.fill();
    // голова
    oval(c, 0.52, -0.86 + dy + hd, 0.125, 0.062, 0.55, col);
    poly(c, [0.38, -0.94 + dy + hd, 0.4, -1.04 + dy + hd, 0.45, -0.95 + dy + hd], col);
    // грива
    poly(c, [0.13, -0.7 + dy, 0.35, -0.98 + dy + hd, 0.41, -0.95 + dy + hd, 0.2, -0.67 + dy], M.mane);
    c.fillStyle = INK; c.beginPath(); c.arc(0.5, -0.9 + dy + hd, 0.016, 0, TAU); c.fill();
    // ближние ноги
    horseLeg(c, 0.23, -0.55 + dy, L[0][0], L[0][1], col, true);
    horseLeg(c, -0.25, -0.55 + dy, L[2][0], L[2][1], col, false);
    // уздечка
    c.strokeStyle = PAL.leatherD; c.lineWidth = 0.016;
    c.beginPath(); c.moveTo(0.58, -0.84 + dy + hd); c.lineTo(0.12, -0.9 + dy); c.stroke();
    if (M.barded) {
      // попона цвета державы с тёмной каймой
      const cap = () => {
        c.beginPath();
        c.moveTo(0.18, -0.77 + dy); c.quadraticCurveTo(0.33, -0.76 + dy, 0.37, -0.6 + dy); c.lineTo(0.38, -0.33 + dy);
        for (let i = 0; i < 6; i++) { const x0 = 0.38 - i * 0.135; c.quadraticCurveTo(x0 - 0.067, -0.27 + dy, x0 - 0.135, -0.33 + dy); }
        c.lineTo(-0.43, -0.6 + dy); c.quadraticCurveTo(-0.41, -0.79 + dy, -0.24, -0.78 + dy); c.closePath();
      };
      cap(); c.fillStyle = kc; c.fill();
      c.save(); cap(); c.clip();
      c.fillStyle = kd; c.fillRect(-0.6, -0.42 + dy, 1.2, 0.2);
      c.fillStyle = 'rgba(30,15,5,0.18)'; c.fillRect(-0.6, -0.8 + dy, 0.25, 0.6);
      c.restore();
      cap(); c.strokeStyle = INK; c.lineWidth = LW * 1.2; c.stroke();
      disc(c, -0.04, -0.58 + dy, 0.055, PAL.light);
      // накрытая шея и налобник
      poly(c, [0.15, -0.72 + dy, 0.33, -0.6 + dy, 0.48, -0.83 + dy + hd, 0.38, -0.94 + dy + hd], kc);
      oval(c, 0.53, -0.86 + dy + hd, 0.1, 0.045, 0.55, PAL.steel);
    } else {
      // чепрак цвета державы
      poly(c, [-0.17, -0.75 + dy, 0.1, -0.75 + dy, 0.08, -0.53 + dy, -0.15, -0.53 + dy], kc);
      bar(c, -0.15, -0.54 + dy, 0.08, -0.54 + dy, 0.024, kd);
    }
    oval(c, -0.03, -0.75 + dy, 0.13, 0.035, 0, PAL.leatherD);
  }

  function rider(c, G, pose, f, kc, kd) {
    const M = HORSE[G.mount], H = horsePose(pose, f);
    c.save();
    if (H.rot) { c.translate(-0.28 * M.m, 0); c.rotate(H.rot); c.translate(0.28 * M.m, 0); }
    c.save(); c.scale(M.m, M.m); horse(c, M, H, kc, kd); c.restore();
    const P = { seated: true, hx: -0.03 * M.m, hy: (-0.79 + H.dy) * M.m, lean: pose === 'run' ? 0.06 : pose === 'attack' ? [-0.02, 0.07, 0.03][f] : 0, dy: 0 };
    armPose(G, pose, f, P, 0);
    man(c, G, P, kc, kd);
    c.restore();
  }

  // ---------- осадные машины ----------
  function wheel(c, x, y, r, a, col) {
    disc(c, x, y, r, col);
    c.strokeStyle = PAL.woodD; c.lineWidth = 0.022;
    c.beginPath();
    for (let i = 0; i < 3; i++) { const t = a + i * Math.PI / 3; c.moveTo(x + Math.cos(t) * r * 0.85, y + Math.sin(t) * r * 0.85); c.lineTo(x - Math.cos(t) * r * 0.85, y - Math.sin(t) * r * 0.85); }
    c.stroke();
    disc(c, x, y, r * 0.25, PAL.steelD);
  }
  function pennant(c, x, y, h, kc, kd) {
    bar(c, x, y, x, y - h, 0.026, PAL.woodD);
    poly(c, [x, y - h, x + 0.26, y - h + 0.06, x, y - h + 0.13], kc);
    bar(c, x, y - h + 0.005, x, y - h + 0.125, 0.02, kd);
  }
  function ram(c, pose, f, kc, kd) {
    const walk = pose === 'walk' || pose === 'run';
    const ang = walk ? f * 0.5 : 0.3;
    const push = pose === 'attack' ? [-0.08, 0.16, 0.04][f] : 0;
    wheel(c, -0.48, -0.17, 0.12, ang, tone(PAL.wood, 0.75));
    wheel(c, 0.3, -0.17, 0.12, ang + 0.5, tone(PAL.wood, 0.75));
    // ноги расчёта под навесом
    for (let i = 0; i < 3; i++) {
      const x = -0.32 + i * 0.25, s = walk ? Math.sin(f * Math.PI / 2 + i) * 0.06 : 0;
      bar(c, x, -0.32, x + s, -0.03, 0.05, tone(kd, 0.9));
      bar(c, x + 0.04, -0.32, x + 0.04 - s, -0.03, 0.05, kd);
    }
    // бревно с железной головой
    bar(c, -0.5 + push, -0.4, 0.62 + push, -0.4, 0.1, PAL.woodD);
    poly(c, [0.6 + push, -0.47, 0.75 + push, -0.45, 0.78 + push, -0.4, 0.75 + push, -0.35, 0.6 + push, -0.33], PAL.steelD);
    bar(c, -0.62, -0.25, 0.52, -0.25, 0.07, PAL.woodD);
    // навес из шкур: бок и скат крыши
    poly(c, [-0.64, -0.27, 0.56, -0.27, 0.48, -0.6, -0.56, -0.6], PAL.hide);
    c.strokeStyle = PAL.hideD; c.lineWidth = 0.016; c.beginPath();
    for (let i = 1; i < 5; i++) { const x = -0.6 + i * 0.22; c.moveTo(x, -0.28); c.lineTo(x - 0.02, -0.59); }
    c.stroke();
    poly(c, [-0.56, -0.6, 0.48, -0.6, 0.38, -0.76, -0.64, -0.76], tone(PAL.hide, 1.12));
    bar(c, -0.64, -0.765, 0.38, -0.765, 0.03, PAL.woodD);
    shield(c, 'round', -0.04, -0.44, kc, kd);
    pennant(c, -0.5, -0.77, 0.38, kc, kd);
    wheel(c, -0.42, -0.13, 0.13, ang, PAL.wood);
    wheel(c, 0.36, -0.13, 0.13, ang + 0.5, PAL.wood);
  }
  function catapult(c, pose, f, kc, kd) {
    const walk = pose === 'walk' || pose === 'run';
    const ang = walk ? f * 0.5 : 0.3;
    // рычаг: взведён (назад-вниз), выстрел (вверх-вперёд), перезарядка (посередине)
    const arms = { cocked: -2.75, shot: -1.25, mid: -2.2 };
    const st = pose === 'attack' ? ['cocked', 'shot', 'mid'][f] : 'cocked';
    const a = arms[st];
    const px = -0.02, py = -0.34;
    wheel(c, -0.44, -0.16, 0.11, ang, tone(PAL.wood, 0.75));
    wheel(c, 0.3, -0.16, 0.11, ang + 0.5, tone(PAL.wood, 0.75));
    // дальняя стойка
    bar(c, -0.08, -0.24, 0.06, -0.66, 0.05, PAL.woodD);
    // рама
    bar(c, -0.62, -0.24, 0.5, -0.24, 0.075, PAL.wood);
    // ворот
    disc(c, -0.44, -0.33, 0.07, PAL.woodD);
    c.strokeStyle = PAL.rope; c.lineWidth = 0.016; c.beginPath(); c.moveTo(-0.44, -0.33); c.lineTo(px + Math.cos(a) * 0.35, py + Math.sin(a) * 0.35); c.stroke();
    // рычаг с ковшом
    const ex = px + Math.cos(a) * 0.82, ey = py + Math.sin(a) * 0.82;
    bar(c, px - Math.cos(a) * 0.08, py - Math.sin(a) * 0.08, ex, ey, 0.055, PAL.woodL);
    const bx = ex + Math.cos(a) * 0.04, by = ey + Math.sin(a) * 0.04;
    c.beginPath(); c.arc(bx, by, 0.075, a + Math.PI * 0.5, a + Math.PI * 1.5, st === 'shot'); c.closePath();
    c.fillStyle = PAL.woodD; c.fill(); c.strokeStyle = INK; c.lineWidth = LW; c.stroke();
    if (st === 'cocked') disc(c, bx + Math.cos(a + Math.PI / 2) * -0.02, by - 0.05, 0.055, PAL.stone);
    // ближняя стойка, упор и ось
    bar(c, 0.16, -0.24, 0.06, -0.66, 0.05, PAL.wood);
    bar(c, -0.04, -0.66, 0.14, -0.66, 0.05, PAL.woodD);
    disc(c, px, py, 0.04, PAL.steelD);
    shield(c, 'heater', 0.33, -0.36, kc, kd);
    pennant(c, 0.06, -0.68, 0.32, kc, kd);
    wheel(c, -0.38, -0.12, 0.12, ang, PAL.wood);
    wheel(c, 0.36, -0.12, 0.12, ang + 0.5, PAL.wood);
  }

  // Любой воин в любой позе (лицом вправо, ступни в начале координат).
  function figure(c, uid, pose, f, kc, kd) {
    const G = gearOf(uid);
    if (pose === 'dead' || pose === 'fall') {
      const fg = footGear(uid, G);
      c.save();
      if (pose === 'dead') { c.translate(0.42, -0.07); c.scale(1, 0.62); c.rotate(-Math.PI / 2 + 0.06); }
      else { c.translate(0.12, 0); c.rotate(-0.75); }
      man(c, fg, footPose(fg, 'stand', 0), kc, kd);
      c.restore();
      return;
    }
    if (G.machine === 'ram') ram(c, pose, f, kc, kd);
    else if (G.machine === 'catapult') catapult(c, pose, f, kc, kd);
    else if (G.mount) rider(c, G, pose, f, kc, kd);
    else man(c, G, footPose(G, pose, f), kc, kd);
  }

  // ---------- кэш спрайтов ----------
  const BOX = {   // рамка спрайта в долях роста: x0, y0, x1, y1
    foot: [-0.62, -1.78, 1.16, 0.1],
    mount: [-0.8, -2.42, 1.48, 0.1],
    machine: [-0.8, -1.25, 0.92, 0.1],
    fall: [-0.72, -0.98, 0.62, 0.16],
    dead: [-0.74, -0.36, 0.62, 0.16],
  };
  const SHADOW = { foot: 0.2, mount: 0.46, machine: 0.62, fall: 0.3, dead: 0.42 };
  const cache = new Map();
  let cachePx = 0;
  // два черновых холста: фигура и силуэт для контура; живут в памяти процессора, силуэт читаем
  const scratch = [];
  function scratchCanvas(w, h, which) {
    let cv = scratch[which];
    if (!cv) { cv = scratch[which] = document.createElement('canvas'); cv.getContext('2d', { willReadFrequently: true }); }
    if (cv.width < w || cv.height < h) { cv.width = Math.max(cv.width, w); cv.height = Math.max(cv.height, h); }
    const c = cv.getContext('2d');
    c.setTransform(1, 0, 0, 1, 0, 0);
    c.globalCompositeOperation = 'source-over';
    c.globalAlpha = 1;
    c.clearRect(0, 0, w + 4, h + 4);
    return cv;
  }
  function boxOf(uid, pose) {
    if (pose === 'dead' || pose === 'fall') return pose;
    const G = gearOf(uid);
    return G.machine ? 'machine' : G.mount ? 'mount' : 'foot';
  }
  // Готовый спрайт: тень, чернильный контур по силуэту, мягкий свет сверху.
  // draw(c) рисует в долях роста; px — сколько пикселей в единице.
  function bake(kind, px, dir, draw) {
    const b = BOX[kind];
    const o = Math.max(1, Math.min(2.6, px * 0.042));
    const pad = Math.ceil(o) + 2;
    const W = Math.ceil((b[2] - b[0]) * px) + pad * 2, H = Math.ceil((b[3] - b[1]) * px) + pad * 2;
    let ax = -b[0] * px + pad;
    const ay = -b[1] * px + pad;
    if (dir < 0) ax = W - ax;
    const fig = scratchCanvas(W, H, 0), fc = fig.getContext('2d');
    LW = Math.max(0.024, 0.75 / px);
    fc.save();
    fc.translate(ax, ay); fc.scale(px * dir, px);
    fc.lineCap = 'round'; fc.lineJoin = 'round';
    draw(fc);
    fc.restore();
    // свет сверху, тень снизу
    fc.globalCompositeOperation = 'source-atop';
    const gr = fc.createLinearGradient(0, ay + b[1] * px, 0, ay);
    gr.addColorStop(0, 'rgba(255,246,220,0.16)'); gr.addColorStop(0.55, 'rgba(255,246,220,0)'); gr.addColorStop(1, 'rgba(40,20,5,0.2)');
    fc.fillStyle = gr; fc.fillRect(0, 0, W, H);
    fc.globalCompositeOperation = 'source-over';
    // силуэт для контура
    const sil = scratchCanvas(W, H, 1), sc = sil.getContext('2d');
    for (let i = 0; i < 8; i++) { const t = i / 8 * TAU; sc.drawImage(fig, 0, 0, W, H, Math.cos(t) * o, Math.sin(t) * o, W, H); }
    sc.globalCompositeOperation = 'source-in';
    sc.fillStyle = INK; sc.fillRect(0, 0, W, H);
    // рамка взята с запасом на самую размашистую позу; храним только занятую часть (силуэт с тенью),
    // так памяти в 2–3 раза меньше
    const shx = ax + (kind === 'dead' ? -0.1 : 0.02) * px * dir, shy = ay - 0.01 * px, srx = SHADOW[kind] * px, sry = srx * 0.3;
    const bb = opaqueBox(sc, W, H);
    const x0 = Math.max(0, Math.min(bb[0], Math.floor(shx - srx))), y0 = Math.max(0, Math.min(bb[1], Math.floor(shy - sry)));
    const x1 = Math.min(W, Math.max(bb[0] + bb[2], Math.ceil(shx + srx))), y1 = Math.min(H, Math.max(bb[1] + bb[3], Math.ceil(shy + sry)));
    const cv = document.createElement('canvas');
    cv.width = x1 - x0; cv.height = y1 - y0;
    const c = cv.getContext('2d'), w = x1 - x0, h = y1 - y0;
    c.fillStyle = 'rgba(35,22,8,0.3)';
    c.beginPath(); c.ellipse(shx - x0, shy - y0, srx, sry, 0, 0, TAU); c.fill();
    c.drawImage(sil, x0, y0, w, h, 0, 0, w, h);
    c.drawImage(fig, x0, y0, w, h, 0, 0, w, h);
    return { cv, ax: ax - x0, ay: ay - y0 };
  }
  // прямоугольник непрозрачных пикселей: x, y, ширина, высота
  function opaqueBox(c, W, H) {
    let d;
    try { d = c.getImageData(0, 0, W, H).data; } catch (e) { return [0, 0, W, H]; }
    let x0 = W, x1 = -1, y0 = H, y1 = -1;
    for (let y = 0; y < H; y++) {
      const row = y * W * 4;
      let l = -1, rr = -1;
      for (let x = 0; x < W; x++) if (d[row + x * 4 + 3] > 6) { l = x; break; }
      if (l < 0) continue;
      for (let x = W - 1; x >= l; x--) if (d[row + x * 4 + 3] > 6) { rr = x; break; }
      if (l < x0) x0 = l;
      if (rr > x1) x1 = rr;
      if (y < y0) y0 = y;
      y1 = y;
    }
    if (x1 < 0) return [0, 0, 1, 1];
    return [x0, y0, x1 - x0 + 1, y1 - y0 + 1];
  }
  // Кэш с вытеснением давно не нужных: при попадании запись переезжает в конец (см. sprite).
  function remember(key, s) {
    cache.set(key, s);
    cachePx += s.cv.width * s.cv.height;
    // не больше ~8 млн пикселей: выбрасываем дольше всех не нужные
    if (cachePx > 8e6) {
      for (const [k, v] of cache) {
        cache.delete(k); cachePx -= v.cv.width * v.cv.height;
        if (cachePx < 6e6) break;
      }
    }
    return s;
  }
  function bucket(devPx) {
    for (let i = 0; i < BUCKETS.length; i++) if (BUCKETS[i] >= devPx * 0.92) return BUCKETS[i];
    return BUCKETS[BUCKETS.length - 1];
  }
  // Запекание стоит около полумиллисекунды, поэтому в кадре строя (lazy) запекаем не больше BAKE_BUDGET
  // новых спрайтов, а остальным отдаём готовый похожий: другой кадр той же позы, соседний размер или стойку.
  // Совсем новых (похожего нет) запекаем до BAKE_MAX, дальше фигурка появится в следующих кадрах.
  const BAKE_BUDGET = 3, BAKE_MAX = 10;
  let bakeFrame = -1, bakes = 0;
  function similar(uid, kc, pose, f, side, px) {
    const i = BUCKETS.indexOf(px), near = [px, BUCKETS[i - 1], BUCKETS[i + 1]];
    for (const q of near) {
      if (!q) continue;
      const base = uid + kc + pose;
      for (let k = 0; k < 4; k++) { const s = cache.get(base + ((f + k) & 3) + side + q); if (s && (k || q !== px)) return s; }
      const s = cache.get(uid + kc + 'stand0' + side + q);
      if (s) return s;
    }
    return null;
  }
  function sprite(uid, kc, kd, pose, f, dir, px, lazy) {
    const side = dir > 0 ? 'r' : 'l', key = uid + kc + pose + f + side + px;
    const s = cache.get(key);
    if (s) { cache.delete(key); cache.set(key, s); return s; }
    if (lazy) {
      if (bakeFrame !== clk.frame) { bakeFrame = clk.frame; bakes = 0; }
      if (bakes >= BAKE_BUDGET) {
        const alt = similar(uid, kc, pose, f, side, px);
        if (alt) return alt;
        if (bakes >= BAKE_MAX) return null;
      }
      bakes++;
    }
    const b = bake(boxOf(uid, pose), px, dir, c => figure(c, uid, pose, f, kc, kd));
    b.px = px;
    return remember(key, b);
  }

  // ---------- стяг ----------
  const BANNER_FRAMES = 6;
  function drawBanner(c, kc, kd, sigil, f, back, lowered) {
    const ph = f / BANNER_FRAMES * TAU;
    let topX = 0, topY = -1.55;
    if (lowered) { topX = back * 0.92; topY = -0.88; }
    bar(c, 0, 0, topX, topY, 0.036, PAL.wood);
    disc(c, topX, topY - 0.03, 0.035, PAL.gold);
    const N = 8, pts = [];
    if (!lowered) {
      const len = 0.64, hgt = 0.42;
      for (let i = 0; i <= N; i++) {
        const s = i / N, w = Math.sin(s * 5.2 - ph) * 0.05 * s;
        pts.push([topX + back * s * len * (1 - 0.04 * Math.abs(Math.sin(ph + s * 3))), topY + 0.02 + w, topY + 0.02 + hgt - s * 0.04 + w]);
      }
    } else {
      // висит с опущенного древка
      const dx = -back * 0.92, dyy = 0.88, L = Math.hypot(dx, dyy), ux = dx / L, uy = dyy / L;
      for (let i = 0; i <= N; i++) {
        const s = i / N, sway = Math.sin(ph + s * 2) * 0.03 * s;
        const ax = topX + ux * 0.04 + ux * s * 0.36, ay = topY + uy * 0.04 + uy * s * 0.36;
        pts.push([ax + sway, ay, ay + 0.4 - s * 0.05]);
      }
    }
    const tail = pts[N];
    c.beginPath();
    c.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i <= N; i++) c.lineTo(pts[i][0], pts[i][1]);
    if (!lowered) c.lineTo(tail[0] - back * 0.12, (tail[1] + tail[2]) / 2);
    else c.lineTo(tail[0], (tail[1] + tail[2]) / 2 + 0.06);
    for (let i = N; i >= 0; i--) c.lineTo(pts[i][0], pts[i][2]);
    c.closePath();
    c.fillStyle = kc; c.fill();
    // складки
    c.save(); c.clip();
    for (let i = 0; i < N; i++) {
      const s = (i + 0.5) / N;
      const sh = lowered ? Math.sin(ph + s * 2 + 1) : Math.cos(s * 5.2 - ph);
      if (sh > 0.2) continue;
      c.fillStyle = 'rgba(30,15,5,' + (0.08 + (0.2 - sh) * 0.1).toFixed(3) + ')';
      c.fillRect(Math.min(pts[i][0], pts[i + 1][0]), Math.min(pts[i][1], pts[i + 1][1]) - 0.1, Math.abs(pts[i + 1][0] - pts[i][0]) + 0.004, 0.7);
    }
    c.fillStyle = kd;
    c.fillRect(Math.min(pts[0][0], pts[1][0]) - 0.01, pts[0][1] - 0.1, Math.abs(pts[1][0] - pts[0][0]) * 0.8 + 0.01, 0.7);
    c.restore();
    c.strokeStyle = INK; c.lineWidth = LW * 1.2; c.stroke();
    const p = Icons.path(sigil);
    if (p) {
      const m = Math.round(N * 0.48), sz = lowered ? 0.22 : 0.27;
      const cx = pts[m][0] + (lowered ? 0 : -back * 0.02), cy = (pts[m][1] + pts[m][2]) / 2;
      c.save(); c.translate(cx - sz / 2, cy - sz / 2); c.scale(sz / 24, sz / 24);
      c.fillStyle = PAL.light; c.fill(p, 'evenodd');
      c.restore();
    }
  }
  function bannerSprite(kc, kd, sigil, f, dir, px, lowered) {
    const key = 'B' + kc + sigil + f + (dir > 0 ? 'r' : 'l') + px + (lowered ? 'd' : '');
    const s = cache.get(key);
    if (s) { cache.delete(key); cache.set(key, s); return s; }
    // стяг развевается назад относительно движения; знак не зеркалим
    return remember(key, bakeBanner(px, c => drawBanner(c, kc, kd, sigil, f, -dir, lowered)));
  }
  function bakeBanner(px, draw) {
    const x0 = -1.05, x1 = 1.05, y0 = -1.72, y1 = 0.06, pad = 3;
    const W = Math.ceil((x1 - x0) * px) + pad * 2, H = Math.ceil((y1 - y0) * px) + pad * 2;
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const c = cv.getContext('2d');
    const ax = -x0 * px + pad, ay = -y0 * px + pad;
    LW = Math.max(0.024, 0.75 / px);
    c.translate(ax, ay); c.scale(px, px);
    c.lineCap = 'round'; c.lineJoin = 'round';
    draw(c);
    return { cv, ax, ay };
  }

  // ---------- жетон и плашка (дальний план) ----------
  function token(k, S, sel, dpr) {
    const key = 'T' + k.color + k.sigil + S.toFixed(1) + (sel ? 's' : '') + dpr;
    const s = cache.get(key);
    if (s) return s;
    const pad = 4, W = Math.ceil((S + pad * 2) * dpr), H = Math.ceil((S * 1.05 + pad * 2) * dpr);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const c = cv.getContext('2d');
    c.scale(dpr, dpr);
    c.translate(pad, pad);
    c.save(); c.scale(S / 24, S / 24);
    const sh = Icons.path('shield');
    c.save(); c.translate(0.8, 1.2); c.fillStyle = 'rgba(25,14,5,0.35)'; c.fill(sh); c.restore();
    const gr = c.createLinearGradient(0, 1.5, 0, 22.5);
    gr.addColorStop(0, tone(k.color, 1.18)); gr.addColorStop(0.6, k.color); gr.addColorStop(1, tone(k.color, 0.78));
    c.fillStyle = gr; c.fill(sh);
    c.save(); c.clip(sh); c.lineWidth = 3; c.strokeStyle = k.dark; c.stroke(sh); c.restore();
    c.lineWidth = 1.6; c.strokeStyle = sel ? '#ffe28a' : INK; c.stroke(sh);
    c.restore();
    const p = Icons.path(k.sigil);
    if (p) { c.save(); c.translate(S / 2 - S * 0.25, S / 2 - S * 0.28); c.scale(S * 0.5 / 24, S * 0.5 / 24); c.fillStyle = PAL.light; c.fill(p, 'evenodd'); c.restore(); }
    return remember(key, { cv, ax: pad * dpr, ay: pad * dpr, w: W / dpr, h: H / dpr });
  }
  function plate(txt, bad, dpr) {
    const key = 'P' + txt + (bad ? '!' : '') + dpr;
    const s = cache.get(key);
    if (s) return s;
    const font = '700 11px "PT Sans Narrow", "Arial Narrow", sans-serif';
    const m = scratchCanvas(4, 4, 0).getContext('2d');
    m.font = font;
    const tw = Math.ceil(m.measureText(txt).width) + 8, th = 14;
    const cv = document.createElement('canvas'); cv.width = Math.ceil(tw * dpr); cv.height = Math.ceil(th * dpr);
    const c = cv.getContext('2d');
    c.scale(dpr, dpr);
    c.fillStyle = 'rgba(25,15,8,0.86)';
    c.beginPath(); c.moveTo(7, 0); c.arcTo(tw, 0, tw, th, 7); c.arcTo(tw, th, 0, th, 7); c.arcTo(0, th, 0, 0, 7); c.arcTo(0, 0, tw, 0, 7); c.closePath(); c.fill();
    c.font = font; c.textAlign = 'center';
    c.fillStyle = bad ? '#ffb0a0' : '#fff3d6';
    c.fillText(txt, tw / 2, 11);
    return remember(key, { cv, w: tw, h: th });
  }

  // ---------- состав строя ----------
  function figureCount(men) { return men < 25 ? 3 : men < 50 ? 4 : men < 90 ? 5 : men < 140 ? 6 : men < 220 ? 7 : men < 350 ? 8 : 9; }
  // сколько фигурок какого рода: пропорционально числу воинов, каждый род хотя бы одной
  function allot(units) {
    const out = {}, people = [];
    let men = 0, rest;
    for (const u in units) { if (UNITS[u] && units[u] > 0) men += units[u] * (UNITS[u].crew || 1); }
    rest = figureCount(men);
    for (const u in units) {
      if (!UNITS[u] || units[u] <= 0) continue;
      if (ROLE[u] === 'siege') { const k = Math.min(units[u], units[u] >= 3 ? 2 : 1); out[u] = k; rest -= k; }
      else people.push({ u, m: units[u] * (UNITS[u].crew || 1) });
    }
    if (people.length) {
      rest = Math.max(rest, 2);
      people.sort((p, q) => q.m - p.m);
      const use = people.slice(0, rest), sum = use.reduce((s, t) => s + t.m, 0), rem = [];
      let given = 0;
      for (const t of use) {
        const exact = 1 + (rest - use.length) * t.m / sum, k = Math.floor(exact);
        out[t.u] = k; given += k; rem.push([exact - k, t.u]);
      }
      rem.sort((p, q) => q[0] - p[0]);
      for (let i = 0; given < rest; i++, given++) out[rem[i % rem.length][1]]++;
    }
    return out;
  }
  const LAT = 0.36;   // шаг рядов по вертикали экрана, в ростах
  // Строй лицом вправо: fx — вперёд, fy — вниз по экрану (ближе к зрителю), в ростах фигурки.
  function buildLayout(units, siege) {
    const al = allot(units), figs = [];
    const take = list => { const r = []; for (const u of list) for (let i = 0; i < (al[u] || 0); i++) r.push(u); return r; };
    const inf = take(['spear', 'sword', 'militia']), rng = take(['crossbow', 'archer']);
    const cav = take(['knight', 'cavalry', 'scout']), mach = take(['ram', 'catapult']);
    let x = 0, maxLat = 0;
    // шеренги в шахматном порядке: соседний ряд сдвинут на полшага назад, чтобы фигурки не заслоняли друг друга
    const block = (list, dx, lat, front) => {
      const rows = list.length >= 7 ? 3 : list.length >= 2 ? 2 : 1;
      let i = 0, col = 0;
      while (i < list.length) {
        const n = Math.min(rows, list.length - i);
        const lats = n === 1 ? [0] : n === 2 ? [-0.5, 0.5] : [-1, 0, 1];
        lats.forEach((l, row) => {
          figs.push({ u: list[i++], fx: x - (row % 2) * dx * 0.5, fy: l * lat, front: front && col === 0 });
          maxLat = Math.max(maxLat, Math.abs(l));
        });
        x -= dx; col++;
      }
    };
    const rams = mach.filter(u => u === 'ram'), cats = mach.filter(u => u !== 'ram');
    if (siege && rams.length) { figs.push({ u: 'ram', fx: 0.62, fy: 0.08, front: true }); rams.shift(); }
    const foot = inf.length + rng.length;
    let bearer = null;
    if (inf.length) { block(inf, 0.56, LAT, true); bearer = { u: 'b:' + inf[0], fx: x + 0.26, fy: -0.18 }; }
    if (rng.length) { if (inf.length) x -= 0.08; block(rng, 0.56, LAT, !inf.length); if (!bearer) bearer = { u: 'b:' + rng[0], fx: x + 0.26, fy: -0.18 }; }
    if (cav.length) {
      if (foot && siege) {
        // под стенами конница ждёт в стороне, за пехотой, и не заслоняет таран
        const side = (maxLat + 1.1) * LAT;
        cav.forEach((u, i) => figs.push({ u, fx: -0.35 - i * 0.85, fy: -side - 0.04 }));
      } else if (foot) {
        // конница по флангам, чуть впереди пехоты
        const side = (maxLat + 1.1) * LAT;
        cav.forEach((u, i) => figs.push({ u, fx: 0.2 - Math.floor(i / 2) * 0.85, fy: i % 2 ? -side - 0.04 : side, front: true }));
      } else {
        block(cav, 0.85, LAT * 1.2, true);
        bearer = { u: 'b:' + cav[0], fx: x + 0.42, fy: -0.16 };
      }
    }
    const back = rams.concat(cats);
    if (back.length) {
      x -= back.length > 1 || foot ? 0.55 : 0.3;
      if (back.length === 1) figs.push({ u: back[0], fx: x, fy: 0.02 });
      else { figs.push({ u: back[0], fx: x + 0.1, fy: -0.42 }); figs.push({ u: back[1], fx: x - 0.1, fy: 0.42 }); }
    }
    if (!bearer) bearer = { u: 'b:militia', fx: x - 0.75, fy: -0.1 };
    bearer.bearer = true;
    figs.push(bearer);
    figs.sort((p, q) => p.fy - q.fy || p.fx - q.fx);
    let x0 = Infinity, x1 = -Infinity, y0 = Infinity, y1 = -Infinity;
    for (const e of figs) {
      const k = e.u.charAt(1) === ':' ? boxOf(e.u.slice(2), 'stand') : boxOf(e.u, 'stand');
      const hw = k === 'machine' ? 0.62 : k === 'mount' ? 0.5 : 0.17;
      x0 = Math.min(x0, e.fx - hw); x1 = Math.max(x1, e.fx + hw);
      y0 = Math.min(y0, e.fy); y1 = Math.max(y1, e.fy);
      e.kind = k;
      e.role = ROLE[e.u] || 'inf';
      e.seed = figs.indexOf(e);
    }
    figs.forEach((e, i) => { e.i = i; });
    return { figs, x0, x1, y0, y1, front: x1 };
  }
  const layouts = new Map();
  function layoutOf(a, siege) {
    let key = siege ? 's' : '';
    for (const u of UNIT_IDS) if (a.units[u]) key += u.charAt(0) + u.charAt(2) + a.units[u];
    let L = layouts.get(a.id);
    if (!L || L.key !== key) {
      L = buildLayout(a.units, siege);
      L.key = key;
      layouts.set(a.id, L);
    }
    return L;
  }

  // ---------- часы анимации и память о движении ----------
  const clk = { T: 0, wave: 0, dt: 0, last: -1, gt: -1, live: -9, frame: -1, run: false, prune: 0 };
  const motion = new Map();    // армия → { x, y, at, dir }
  const beats = new Map();     // фигурка в бою → номер последнего удара/выстрела
  const losses = new Map();    // сражение → потери, уже показанные павшими
  function clock(r) {
    if (clk.frame === r.frame) return;
    clk.frame = r.frame;
    const now = r.time, dt = clk.last < 0 ? 0 : clamp(now - clk.last, 0, 0.1);
    clk.last = now;
    const g = r.g;
    if (g.time !== clk.gt) { clk.gt = g.time; clk.live = now; }
    clk.run = now - clk.live < 0.3;
    clk.dt = clk.run ? dt : 0;
    clk.T += clk.dt;
    clk.wave += dt;
    clk.now = now;
    if (++clk.prune > 240) {
      clk.prune = 0;
      for (const id of motion.keys()) if (!g.army(id)) { motion.delete(id); layouts.delete(id); }
      for (const k of beats.keys()) if (!g.army(Math.floor(k / 64))) beats.delete(k);
      for (const id of losses.keys()) if (!g.battles.some(b => b.id === id)) losses.delete(id);
    }
  }
  function moveOf(a) {
    let m = motion.get(a.id);
    if (!m) { m = { x: a.x, y: a.y, at: -9, dir: hash(a.id) < 0.5 ? 1 : -1 }; motion.set(a.id, m); }
    if (a.x !== m.x || a.y !== m.y) { m.x = a.x; m.y = a.y; m.at = clk.now; }
    if (a.path && a.pathI < a.path.length) {
      const p = a.path[Math.min(a.pathI + 2, a.path.length - 1)];
      const dx = p.x - a.x;
      if (Math.abs(dx) > 0.15) m.dir = dx > 0 ? 1 : -1;
    }
    return m;
  }
  // событие цикла (удар, выстрел): true один раз за период
  function beat(a, i, T, period, at) {
    const key = a.id * 64 + i, n = Math.floor(T / period - at);
    const prev = beats.get(key);
    beats.set(key, n);
    return prev !== undefined && n !== prev;
  }

  // ---------- строй на экране ----------
  function figXY(F, e) {
    return { x: F.bx + F.face * (e.fx - F.shift) * F.h, y: F.by + e.fy * F.h };
  }
  function randomFig(F, pred) {
    const list = pred ? F.L.figs.filter(pred) : F.L.figs;
    return list.length ? list[Math.floor(Math.random() * list.length)] : null;
  }
  function toW(r, x, y) { return r.toWorld(x, y); }

  // поза и смещение фигурки в данный момент
  function act(r, F, e, i) {
    const a = F.a, T = clk.T + hash(a.id * 13 + i) * 7, ph = hash(a.id * 31 + i);
    const out = { pose: 'stand', f: 0, ox: 0, oy: 0 };
    const mode = F.mode;
    if (mode === 'walk' || mode === 'run') {
      out.pose = mode;
      out.f = Math.floor(clk.T * (mode === 'run' ? 11 : 7) + ph * 4) & 3;
      if (mode === 'run') { out.ox = (hash(a.id + i * 7) - 0.5) * 0.3; out.oy = (hash(a.id * 3 + i) - 0.5) * 0.22; }
      return out;
    }
    if (mode !== 'field' && mode !== 'siege') return out;
    const field = mode === 'field';
    const c = F.city;
    const role = e.bearer ? 'bearer' : e.role;
    if (role === 'inf') {
      const assault = field || (c && (c.walls === 0 || c.wallHp <= 0));
      const period = (e.front ? 0.85 : 1.25) + ph * 0.35;
      if (!assault && ((T * 0.3 + ph) % 1) < 0.65) return out;
      if (!e.front && field && ((T * 0.4 + ph) % 1) < 0.4) return out;
      const l = (T / period) % 1;
      out.pose = 'attack'; out.f = l < 0.45 ? 0 : l < 0.62 ? 1 : 2;
      if (beat(a, i, T, period, 0.45) && e.front && Math.random() < 0.6) {
        const p = figXY(F, e);
        const w = toW(r, p.x + F.face * 0.32 * F.h, p.y - 0.45 * F.h);
        for (let k = 0; k < 3; k++) r.spawn('spark', w.x, w.y);
      }
    } else if (role === 'ranged' || e.u === 'catapult') {
      const cat = e.u === 'catapult';
      const period = cat ? 3.4 + ph : 1.6 + ph * 0.6;
      const rel = cat ? 0.62 : 0.55;
      const l = (T / period) % 1;
      out.pose = 'attack'; out.f = l < rel ? 0 : l < rel + (cat ? 0.12 : 0.2) ? 1 : 2;
      if (beat(a, i, T, period, rel)) shoot(r, F, e, cat ? 'stone' : e.u === 'crossbow' ? 'bolt' : 'arrow');
    } else if (e.u === 'ram') {
      if (field) return out;
      const period = 1.5;
      const l = (T / period) % 1;
      out.pose = 'attack'; out.f = l < 0.5 ? 0 : l < 0.66 ? 1 : 2;
      if (beat(a, i, T, period, 0.5)) {
        const p = figXY(F, e);
        const w = toW(r, p.x + F.face * 0.8 * F.h, p.y - 0.4 * F.h);
        for (let k = 0; k < 4; k++) r.spawn('debris', w.x, w.y);
        r.spawn('dust', w.x, w.y + 0.1);
        for (let k = 0; k < 2; k++) r.spawn('spark', w.x, w.y);
      }
    } else if (role === 'cav') {
      if (!field) { if (((T * 0.25 + ph) % 1) < 0.5) { out.pose = 'walk'; out.f = Math.floor(clk.T * 5 + ph * 4) & 3; } return out; }
      const period = 2.6 + ph * 0.8;
      const l = (T / period) % 1;
      // разгон, удар, отход назад для нового наскока
      const run = 0.42;
      if (l < 0.32) { out.pose = 'run'; out.f = Math.floor(clk.T * 10) & 3; out.ox = smooth(l / 0.32) * run; }
      else if (l < 0.55) { out.pose = 'attack'; out.f = l < 0.38 ? 0 : l < 0.47 ? 1 : 2; out.ox = run; }
      else { out.pose = 'walk'; out.f = Math.floor(clk.T * 6) & 3; out.ox = (1 - smooth((l - 0.55) / 0.45)) * run; }
      if (beat(a, i, T, period, 0.42) && Math.random() < 0.7) {
        const p = figXY(F, e);
        const w = toW(r, p.x + F.face * (run + 0.6) * F.h, p.y - 0.75 * F.h);
        for (let k = 0; k < 3; k++) r.spawn('spark', w.x, w.y);
        r.spawn('dust', w.x, w.y + 0.3);
      }
    }
    return out;
  }

  // выстрел: стрела, болт или камень по дуге
  function shoot(r, F, e, kind) {
    const p = figXY(F, e), z = r.cam.z;
    const from = toW(r, p.x + F.face * (kind === 'stone' ? -0.2 : 0.35) * F.h, p.y - (kind === 'stone' ? 0.9 : 0.72) * F.h);
    let tx, ty;
    if (F.enemy) {
      const t = randomFig(F.enemy, q => !q.bearer) || F.enemy.L.figs[0];
      const q = figXY(F.enemy, t);
      const w = toW(r, q.x + (Math.random() - 0.5) * 0.3 * F.h, q.y - (Math.random() * 0.5) * F.h);
      tx = w.x; ty = w.y;
    } else if (F.city) {
      const c = F.city, R = r.cityRadius(c), cx = c.x + 0.5, cy = c.y + 0.5;
      const ang = Math.random() * TAU, rr = Math.sqrt(Math.random()) * R * 0.75;
      tx = cx + Math.cos(ang) * rr; ty = cy + Math.sin(ang) * rr * 0.8;
    } else return;
    const d = Math.hypot(tx - from.x, ty - from.y);
    const px = d * z;
    if (kind === 'stone') r.spawn('stone', from.x, from.y, { tx, ty, dur: 0.9 + d * 0.25, arc: 0.6 + d * 0.35 });
    else if (kind === 'bolt') r.spawn('bolt', from.x, from.y, { tx, ty, dur: 0.18 + px / 900, arc: 0.08 + d * 0.08 });
    else r.spawn('arrow', from.x, from.y, { tx, ty, dur: 0.3 + px / 600, arc: 0.2 + d * 0.3 });
  }

  // павшие: когда у сражения растут потери, на передней линии остаются лежать фигурки
  function fallen(r, F, side, b) {
    let L = losses.get(b.id);
    if (!L) { L = { a: b.lossA, b: b.lossB, ta: 0, tb: 0 }; losses.set(b.id, L); return; }
    const loss = side === 'a' ? b.lossA : b.lossB, seen = L[side], st = side === 'a' ? b.startA : b.startB || 120;
    const step = Math.max(1, (st || 40) / 40), wall = b.kind === 'siege' && side === 'b';
    if (loss - seen < step || clk.now - L['t' + side] < (wall ? 0.9 : 0.35)) return;
    L[side] = loss; L['t' + side] = clk.now;
    if (wall) {
      // защитник падает со стены
      if (!F.def || !F.def.length) return;
      const d = F.def[Math.floor(Math.random() * F.def.length)];
      const w = toW(r, d.x + d.face * (0.2 + Math.random() * 0.3) * F.h, d.y + 0.12 * F.h);
      r.spawn('fallen', w.x, w.y, { uid: d.u, kc: d.kc, kd: d.kd, dir: d.face });
      return;
    }
    const e = randomFig(F, q => !q.bearer && (q.front || q.role === 'inf' || q.role === 'cav'));
    if (!e) return;
    const p = figXY(F, e), k = F.k;
    const w = toW(r, p.x + F.face * (0.15 + Math.random() * 0.3) * F.h, p.y + (Math.random() - 0.3) * 0.2 * F.h);
    r.spawn('fallen', w.x, w.y, { uid: ROLE[e.u] === 'siege' ? 'crew' : e.u, kc: k.color, kd: k.dark, dir: F.face });
  }

  function drawFormation(r, ctx, F, sel) {
    const k = F.k, h = F.h, dpr = r.dpr;
    const px = bucket(h * dpr), sc = h / px;
    const L = F.L;
    if (sel) {
      const cx = F.bx + F.face * ((L.x0 + L.x1) / 2 - F.shift) * h, cy = F.by + (L.y0 + L.y1) / 2 * h + 0.03 * h;
      ctx.strokeStyle = '#ffe28a'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.ellipse(cx, cy, (L.x1 - L.x0) / 2 * h + 0.28 * h, (L.y1 - L.y0) / 2 * h + 0.3 * h, 0, 0, TAU); ctx.stroke();
    }
    const lowered = F.mode === 'run';
    for (let i = 0; i < L.figs.length; i++) {
      const e = L.figs[i];
      const st = act(r, F, e, i);
      const p = figXY(F, e);
      const x = p.x + F.face * st.ox * h, y = p.y + st.oy * h;
      const s = sprite(e.u, k.color, k.dark, st.pose, st.f, F.face, px, true);
      if (s) { const q = h / s.px; ctx.drawImage(s.cv, x - s.ax * q, y - s.ay * q, s.cv.width * q, s.cv.height * q); }
      if (e.bearer) {
        const mounted = e.kind === 'mount';
        const P = mounted ? null : footPose(gearOf(e.u), st.pose, st.f);
        const lean = P ? P.lean : st.pose === 'run' ? 0.06 : 0;
        const dy = P ? P.dy : 0;
        const bx = x + F.face * (0.155 + lean) * h, by = y + ((mounted ? -0.66 : lowered ? -0.42 : -0.2) + dy) * h;
        const bf = Math.floor(clk.wave * 9 + e.seed * 2 + F.a.id) % BANNER_FRAMES;
        const bs = bannerSprite(k.color, k.dark, k.sigil, bf, F.face, px, lowered);
        ctx.drawImage(bs.cv, bx - bs.ax * sc, by - bs.ay * sc, bs.cv.width * sc, bs.cv.height * sc);
      }
    }
  }

  // где и как стоит армия: опорная точка, направление, режим
  function frameOf(r, a, S, h) {
    const g = r.g, z = r.cam.z;
    const F = { a, k: g.kingdom(a.owner), h, face: 1, mode: 'stand', shift: 0, enemy: null, city: null, battle: null };
    const m = moveOf(a);
    F.face = m.dir;
    if (a.state === 'siege' && a.siegeCity) {
      const c = g.city(a.siegeCity);
      if (c) {
        const C = r.toScreen(c.x + 0.5, c.y + 0.5), R = r.cityRadius(c) * z;
        const side = a.x >= c.x + 0.5 ? 1 : -1;
        F.face = -side; m.dir = F.face;
        F.L = layoutOf(a, true);
        F.mode = 'siege'; F.city = c;
        F.bx = C.x + side * (R + 0.12 * h);
        F.by = C.y + clamp((a.y - c.y - 0.5) * z * 0.6, -R * 0.45, R * 0.45) + 0.25 * h;
        F.shift = F.L.front;
        F.battle = g.battles.find(b => b.kind === 'siege' && b.a === a.id) || null;
        F.def = defenders(r, F, C, R, side);
        return F;
      }
    }
    F.L = layoutOf(a, false);
    let p = r.toScreen(a.x, a.y);
    if (a.state === 'move' || a.state === 'retreat') {
      if (a.state === 'retreat') F.mode = 'run';
      else if (clk.now - m.at < 0.4) F.mode = 'walk';
    } else {
      // стоящая у города армия не закрывает сам город
      const c = g.cityAt(a.x, a.y, 0.9);
      if (c) p = r.toScreen(c.x + 0.5 + r.cityRadius(c) + 0.55, c.y + 0.75);
    }
    if (F.mode === 'run' && !clk.run) F.mode = 'stand';
    F.bx = p.x; F.by = p.y;
    F.shift = (F.L.x0 + F.L.x1) / 2;
    return F;
  }
  // полевой бой: два строя лицом друг к другу по линии между армиями
  function fieldFrames(r, b, S, h) {
    const g = r.g, A = g.army(b.a), B = g.army(b.b);
    if (!A || !B) return null;
    const C = r.toScreen(b.x, b.y), z = r.cam.z;
    const aLeft = A.x < B.x || (A.x === B.x && A.id < B.id);
    const out = [];
    for (const [a, side] of [[A, aLeft ? -1 : 1], [B, aLeft ? 1 : -1]]) {
      const F = { a, k: g.kingdom(a.owner), h, face: -side, mode: 'field', enemy: null, city: null, battle: b };
      F.L = layoutOf(a, false);
      F.bx = C.x + side * 0.24 * h;
      F.by = C.y + clamp((a.y - b.y) * z * 0.5, -0.32 * h, 0.32 * h) + 0.15 * h;
      F.shift = F.L.front;
      moveOf(a).dir = F.face;
      out.push(F);
    }
    out[0].enemy = out[1]; out[1].enemy = out[0];
    return out;
  }

  // Все видимые армии строем. list отсортирован по y; в r.drawnArmies пишутся области для выбора касанием.
  function drawArmies(r, ctx, list) {
    const g = r.g, S = r.armySize(), h = S * FIG_H;
    clock(r);
    const frames = [], seenBattle = new Set();
    for (const a of list) {
      if (a.state === 'battle' && a.battleId) {
        const b = g.battles.find(x => x.id === a.battleId);
        if (b && b.kind === 'field') {
          if (seenBattle.has(b.id)) continue;
          seenBattle.add(b.id);
          const two = fieldFrames(r, b, S, h);
          if (two) {
            const vis = new Set(list.filter(x => x.id === b.a || x.id === b.b));
            for (const F of two) { F.hidden = !vis.has(F.a); frames.push(F); }
            continue;
          }
        }
      }
      frames.push(frameOf(r, a, S, h));
    }
    // разводим стоящие рядом строи, чтобы не слипались
    const placed = [];
    for (const F of frames) {
      const w = (F.L.x1 - F.L.x0) * h;
      const cx = () => F.bx + F.face * ((F.L.x0 + F.L.x1) / 2 - F.shift) * h;
      if (F.mode === 'stand' || F.mode === 'walk' || F.mode === 'run') {
        for (const q of placed) {
          if (Math.abs(q.x - cx()) < (q.w + w) / 2 * 0.85 && Math.abs(q.y - F.by) < h * 0.8) F.bx = q.x + (q.w + w) / 2 + 3 - F.face * ((F.L.x0 + F.L.x1) / 2 - F.shift) * h;
        }
      }
      placed.push({ x: cx(), y: F.by, w });
      F.cx = cx();
    }
    frames.sort((p, q) => p.by - q.by);
    const plates = [];
    const selId = r.selected && r.selected.kind === 'army' ? r.selected.id : -1;
    for (const F of frames) {
      if (F.hidden) continue;
      if (F.battle && F.battle.kind === 'field') fallen(r, F, F.battle.a === F.a.id ? 'a' : 'b', F.battle);
      else if (F.battle && F.battle.kind === 'siege') { fallen(r, F, 'a', F.battle); fallen(r, F, 'b', F.battle); wallArrows(r, F); }
      if (F.def && F.def.length) drawDefenders(r, ctx, F);
      if (F.mode === 'walk' && (F.a.units.cavalry || 0) + (F.a.units.knight || 0) > 0 && Math.random() < clk.dt * 2) {
        const w = toW(r, F.cx - F.face * (F.L.x1 - F.L.x0) * 0.4 * h, F.by + 0.05 * h);
        r.spawn('dust', w.x, w.y);
      }
      drawFormation(r, ctx, F, F.a.id === selId);
      const L = F.L, w = (L.x1 - L.x0) * h;
      r.drawnArmies.push({ a: F.a, x: F.cx, y: F.by - S * 0.55, r: Math.max(S * 0.62, w / 2 + 2) });
      plates.push({ F, x: F.cx, y: F.by + L.y1 * h + 0.14 * h + 2 });
    }
    // плашки с числом воинов поверх всех строев
    for (const q of plates) {
      const pl = plate(fmtMen(menCount(q.F.a.units)), q.F.mode === 'run', r.dpr);
      ctx.drawImage(pl.cv, q.x - pl.w / 2, q.y, pl.w, pl.h);
    }
    prewarm(frames, bucket(h * r.dpr));
  }
  function fmtMen(n) { return n >= 1000 ? (n / 1000).toFixed(1) + 'к' : String(n); }

  // В кадрах без запекания заранее готовим позы, которые видимым строям скоро понадобятся:
  // шаг для стоящих, схватку и падение для сражающихся. Список обновляется раз в секунду.
  const wish = { list: [], i: 0, at: -9 };
  function prewarm(frames, px) {
    if (bakeFrame === clk.frame && bakes > 0) return;
    if (clk.now - wish.at > 1 || wish.px !== px) {
      wish.list = []; wish.i = 0; wish.at = clk.now; wish.px = px;
      const seen = new Set();
      for (const F of frames) {
        if (F.hidden) continue;
        const fight = F.mode === 'field' || F.mode === 'siege';
        for (const e of F.L.figs) {
          const id = e.u + F.k.color + F.face;
          if (seen.has(id)) continue;
          seen.add(id);
          const poses = fight ? (e.kind === 'mount' ? [['attack', 3], ['run', 4], ['walk', 4]] : [['attack', 3]]) : F.mode === 'run' ? [['run', 4]] : [['walk', 4]];
          for (const [pose, n] of poses) for (let f = 0; f < n; f++) wish.list.push([e.u, F.k, pose, f, F.face]);
          if (fight && !e.bearer) { wish.list.push([e.u, F.k, 'fall', 0, F.face], [e.u, F.k, 'dead', 0, F.face]); }
        }
        if (wish.list.length > 300) break;
      }
    }
    const side = r => (r > 0 ? 'r' : 'l');
    while (wish.i < wish.list.length) {
      const w = wish.list[wish.i++];
      const uid = (w[2] === 'fall' || w[2] === 'dead') && ROLE[w[0]] === 'siege' ? 'crew' : w[0];
      if (cache.has(uid + w[1].color + w[2] + w[3] + side(w[4]) + px)) continue;
      sprite(uid, w[1].color, w[1].dark, w[2], w[3], w[4], px);
      return;
    }
  }

  // Защитники на стене со стороны осаждающих: стрелки гарнизона цвета хозяина города.
  // Пока стены целы — до трёх фигурок на гребне; в пролом они уходят со стены.
  function defenders(r, F, C, R, side) {
    const c = F.city, gar = c.garrison || {};
    if (!(c.walls > 0 && c.wallHp > 0)) return [];
    let men = 0;
    for (const u in gar) men += gar[u] || 0;
    if (men <= 0) return [];
    const u = (gar.crossbow || 0) > (gar.archer || 0) ? 'crossbow' : (gar.archer || 0) > 0 ? 'archer' : (gar.spear || 0) > 0 ? 'spear' : 'militia';
    const k = r.g.kingdom(c.owner);
    const kc = k ? k.color : NEUTRAL_COLOR, kd = k ? k.dark : tone(NEUTRAL_COLOR, 0.6);
    const n = Math.min(3, 1 + (c.towers || 0) + (men >= 60 ? 1 : 0));
    const out = [], base = side > 0 ? 0 : Math.PI;
    for (let i = 0; i < n; i++) {
      const ang = base + (i - (n - 1) / 2) * 0.62 * side;
      out.push({ x: C.x + Math.cos(ang) * R * 0.9, y: C.y + Math.sin(ang) * R * 0.9 + 0.1 * F.h, u, kc, kd, face: side, i });
    }
    return out;
  }
  function drawDefenders(r, ctx, F) {
    const h = F.h * 0.82, px = bucket(h * r.dpr);
    for (const d of F.def) {
      const T = clk.T + d.i * 0.53, ranged = d.u === 'archer' || d.u === 'crossbow';
      const l = (T / 1.7) % 1;
      const pose = ranged ? 'attack' : (T * 0.4 + d.i * 0.3) % 1 < 0.5 ? 'attack' : 'stand';
      const f = ranged ? (l < 0.55 ? 0 : l < 0.75 ? 1 : 2) : Math.floor(T * 2.5) % 3;
      const s = sprite(d.u, d.kc, d.kd, pose, f, d.face, px, true);
      if (s) { const q = h / s.px; ctx.drawImage(s.cv, d.x - s.ax * q, d.y - s.ay * q, s.cv.width * q, s.cv.height * q); }
    }
  }

  // со стен осаждённого города летят стрелы в осаждающих: от защитников на стене или из башен
  function wallArrows(r, F) {
    const c = F.city;
    if (!c || !clk.dt) return;
    const g = c.garrison || {};
    const rate = (c.walls > 0 && c.wallHp > 0 ? 0.7 : 0.15) + (c.towers || 0) * 0.7 + ((g.archer || 0) + (g.crossbow || 0) > 0 ? 0.9 : 0) + (c.owner !== -1 ? 0.2 : 0);
    if (Math.random() > rate * clk.dt) return;
    const R = r.cityRadius(c), cx = c.x + 0.5, cy = c.y + 0.5;
    const t = randomFig(F, q => !q.bearer && q.role !== 'siege') || F.L.figs[0];
    const q = figXY(F, t);
    const to = toW(r, q.x + (Math.random() - 0.5) * 0.4 * F.h, q.y - Math.random() * 0.5 * F.h);
    let fx, fy;
    if (F.def && F.def.length && Math.random() < 0.75) {
      const d = F.def[Math.floor(Math.random() * F.def.length)];
      const w = toW(r, d.x + d.face * 0.25 * F.h, d.y - 0.6 * F.h);
      fx = w.x; fy = w.y;
    } else {
      const ang = Math.atan2(to.y - cy, to.x - cx) + (Math.random() - 0.5) * 1.1;
      fx = cx + Math.cos(ang) * R; fy = cy + Math.sin(ang) * R - 0.12;
    }
    const d = Math.hypot(to.x - fx, to.y - fy);
    r.spawn('arrow', fx, fy, { tx: to.x, ty: to.y, dur: 0.3 + d * r.cam.z / 600, arc: 0.18 + d * 0.25 });
  }

  // лежащие павшие (частицы 'fallen'): рисуются под строем, тают к концу жизни
  function drawFallen(r, ctx) {
    const h = r.armySize() * FIG_H, px = bucket(h * r.dpr);
    for (const p of r.particles) {
      if (p.type !== 'fallen') continue;
      const s = r.toScreen(p.x, p.y);
      const pose = p.t < 0.22 ? 'fall' : 'dead';
      const spr = sprite(p.uid, p.kc, p.kd, pose, 0, p.dir, px, true);
      if (!spr) continue;
      const k = p.t / p.dur, q = h / spr.px;
      ctx.globalAlpha = k < 0.7 ? 1 : 1 - (k - 0.7) / 0.3;
      ctx.drawImage(spr.cv, s.x - spr.ax * q, s.y - spr.ay * q, spr.cv.width * q, spr.cv.height * q);
    }
    ctx.globalAlpha = 1;
  }

  // ---------- портреты для меню ----------
  const portraits = new Map();
  function portraitCanvas(uid, color, px) {
    const kc = color && typeof color === 'object' ? color.color : color || NEUTRAL_COLOR;
    const kd = color && typeof color === 'object' && color.dark ? color.dark : tone(kc, 0.55);
    const G = gearOf(uid), kind = boxOf(uid, 'stand');
    // во весь квадрат: пеший крупнее, конь и машины — по ширине
    const unit = kind === 'foot' ? px / 1.32 : kind === 'mount' ? px / 1.72 : px / 1.62;
    const pose = G.weapon === 'bow' || G.weapon === 'xbow' ? 'attack' : 'stand';
    const s = bake(kind, unit, 1, c => figure(c, uid, pose, 0, kc, kd));
    const cv = document.createElement('canvas'); cv.width = cv.height = px;
    const c = cv.getContext('2d');
    const cx = kind === 'foot' ? px * 0.46 : px * 0.5, by = px * (kind === 'foot' ? 0.93 : 0.9);
    c.drawImage(s.cv, cx - s.ax, by - s.ay);
    return cv;
  }
  function portraitURL(uid, color, px) {
    px = Math.round(px || 64);
    const key = uid + '|' + (color && typeof color === 'object' ? color.color + color.dark : color) + '|' + px;
    let u = portraits.get(key);
    if (!u) {
      try { u = portraitCanvas(uid, color, px).toDataURL('image/png'); } catch (e) { u = ''; }
      portraits.set(key, u);
    }
    return u;
  }

  // Одна фигурка в произвольном месте (для заставок и интерфейса). x, y — ступни, h — рост в css-пикселях.
  function drawFigure(ctx, uid, k, x, y, h, dir, pose, f, dpr) {
    const dev = h * (dpr || 1);
    const px = dev > BUCKETS[BUCKETS.length - 1] ? Math.round(dev) : bucket(dev), sc = h / px;
    const s = sprite(uid, k.color, k.dark, pose || 'stand', f || 0, dir || 1, px);
    ctx.drawImage(s.cv, x - s.ax * sc, y - s.ay * sc, s.cv.width * sc, s.cv.height * sc);
  }

  return {
    FORMATION_Z, clock, drawArmies, drawFallen, token, plate, portraitURL, portraitCanvas, drawFigure, sprite, bucket,
    layoutOf, allot, tone,
    get cacheSize() { return cache.size; },
  };
})();
