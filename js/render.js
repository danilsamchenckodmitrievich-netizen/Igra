'use strict';
// Отрисовка мира, тумана войны, полосок здоровья и миникарты.

const HP_COLORS = { self: '#57f06a', ally: '#5fcf52', enemy: '#e2453a', neutral: '#e0b040' };

class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.cam = { x: 900, y: 5000, zoom: 1 };
    this.fog = document.createElement('canvas');
    this.fctx = this.fog.getContext('2d');
    this.time = 0;
    this.g = null;
    this.input = null;
    this.hover = null;
    this.grass = this.makeGrass();
    this.treeSprites = this.makeTreeSprites();
    this.mm = null;
    this.resize();
  }

  setGame(g) {
    this.g = g;
    this.mmBase = null;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.dpr = dpr;
    this.w = this.canvas.clientWidth || window.innerWidth;
    this.h = this.canvas.clientHeight || window.innerHeight;
    this.canvas.width = Math.round(this.w * dpr);
    this.canvas.height = Math.round(this.h * dpr);
    this.fog.width = Math.ceil(this.w / 4);
    this.fog.height = Math.ceil(this.h / 4);
  }

  toWorld(sx, sy) {
    const z = this.cam.zoom;
    return { x: (sx - this.w / 2) / z + this.cam.x, y: (sy - this.h / 2) / z + this.cam.y };
  }
  toScreen(x, y) {
    const z = this.cam.zoom;
    return { x: (x - this.cam.x) * z + this.w / 2, y: (y - this.cam.y) * z + this.h / 2 };
  }
  clampCam() {
    const S = WORLD_SIZE, z = this.cam.zoom;
    const hw = this.w / 2 / z, hh = this.h / 2 / z;
    this.cam.x = clamp(this.cam.x, Math.min(hw - 200, S / 2), Math.max(S - hw + 200, S / 2));
    this.cam.y = clamp(this.cam.y, Math.min(hh - 200, S / 2), Math.max(S - hh + 260, S / 2));
  }

  // ---------- текстуры ----------
  makeGrass() {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 256;
    const c = cv.getContext('2d');
    c.fillStyle = '#3f5d30';
    c.fillRect(0, 0, 256, 256);
    const rng = mulberry32(42);
    const cols = ['#3a5729', '#46683a', '#4d6f3e', '#38552c', '#52743f'];
    for (let i = 0; i < 520; i++) {
      c.fillStyle = cols[Math.floor(rng() * cols.length)];
      c.globalAlpha = 0.35 + rng() * 0.3;
      const x = rng() * 256, y = rng() * 256, r = 3 + rng() * 14;
      for (const [ox, oy] of [[0, 0], [256, 0], [-256, 0], [0, 256], [0, -256]]) {
        c.beginPath(); c.ellipse(x + ox, y + oy, r, r * (0.5 + rng() * 0.5), rng() * 3, 0, TAU); c.fill();
      }
    }
    c.globalAlpha = 0.5;
    c.strokeStyle = '#5b7d45';
    c.lineWidth = 1;
    for (let i = 0; i < 260; i++) {
      const x = rng() * 256, y = rng() * 256;
      c.beginPath(); c.moveTo(x, y); c.lineTo(x + rng() * 4 - 2, y - 3 - rng() * 4); c.stroke();
    }
    c.globalAlpha = 1;
    return this.ctx.createPattern(cv, 'repeat');
  }

  makeTreeSprites() {
    const palettes = [
      ['#2f5a2a', '#4f8a3e', '#1c3a1a'], ['#335f2b', '#5b9444', '#1d3b1c'], ['#2a5230', '#47804a', '#16301a'],
      ['#3d3349', '#62506e', '#211a2a'], ['#463a32', '#6e5a48', '#241c18'], ['#33393f', '#55606a', '#1a1e22'],
    ];
    const rng = mulberry32(7);
    return palettes.map(([base, light, dark]) => {
      const cv = document.createElement('canvas');
      cv.width = cv.height = 128;
      const c = cv.getContext('2d');
      c.fillStyle = 'rgba(0,0,0,0.38)';
      c.beginPath(); c.ellipse(72, 76, 44, 38, 0, 0, TAU); c.fill();
      const blobs = [];
      for (let k = 0; k < 6; k++) {
        const a = k / 6 * TAU + rng(), r = 16 + rng() * 10;
        blobs.push([64 + Math.cos(a) * r, 60 + Math.sin(a) * r, 22 + rng() * 6]);
      }
      blobs.push([62, 58, 26]);
      for (const [x, y, r] of blobs) {
        const g = c.createRadialGradient(x - r * 0.35, y - r * 0.4, r * 0.1, x, y, r);
        g.addColorStop(0, light); g.addColorStop(0.55, base); g.addColorStop(1, dark);
        c.fillStyle = g;
        c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
      }
      return cv;
    });
  }

  // ---------- кадр ----------
  render(dt) {
    const g = this.g, ctx = this.ctx, cam = this.cam, dpr = this.dpr;
    if (!g) return;
    this.time += dt;
    const z = cam.zoom;
    let sx = 0, sy = 0;
    if (g.shakeAmt > 0.3) { sx = rand(-1, 1) * g.shakeAmt; sy = rand(-1, 1) * g.shakeAmt; }
    ctx.setTransform(dpr * z, 0, 0, dpr * z, dpr * (this.w / 2 - (cam.x + sx) * z), dpr * (this.h / 2 - (cam.y + sy) * z));
    const vb = {
      x0: cam.x - this.w / 2 / z - 120, y0: cam.y - this.h / 2 / z - 120,
      x1: cam.x + this.w / 2 / z + 120, y1: cam.y + this.h / 2 / z + 160,
    };
    this.vb = vb;
    this.drawGround(ctx, vb);
    this.drawRubble(ctx);
    this.drawEffects(ctx, true);
    this.drawZones(ctx);
    this.drawTrees(ctx, vb);
    this.drawRanges(ctx);
    this.drawUnits(ctx, vb);
    this.drawProjectiles(ctx);
    this.drawEffects(ctx, false);
    this.drawParticles(ctx, vb);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.drawFog(ctx);
    this.drawBars(ctx);
    this.drawFloaters(ctx);
    this.drawTargeting(ctx);
  }

  strokePoly(ctx, pts, w, color, dash, offset) {
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i].x, pts[i].y);
    ctx.lineWidth = w;
    ctx.strokeStyle = color;
    if (dash) { ctx.setLineDash(dash); ctx.lineDashOffset = offset || 0; }
    ctx.stroke();
    if (dash) ctx.setLineDash([]);
  }

  drawGround(ctx, vb) {
    const g = this.g, map = g.map, S = WORLD_SIZE;
    ctx.fillStyle = '#0f150f';
    ctx.fillRect(vb.x0, vb.y0, vb.x1 - vb.x0, vb.y1 - vb.y0);
    ctx.fillStyle = this.grass;
    const x0 = Math.max(0, vb.x0), y0 = Math.max(0, vb.y0);
    ctx.fillRect(x0, y0, Math.min(S, vb.x1) - x0, Math.min(S, vb.y1) - y0);
    ctx.fillStyle = 'rgba(70,24,46,0.2)';
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(S, 0); ctx.lineTo(S, S); ctx.closePath(); ctx.fill();
    ctx.fillStyle = 'rgba(150,190,90,0.05)';
    ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, S); ctx.lineTo(S, S); ctx.closePath(); ctx.fill();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    for (const c of map.camps) {
      const gr = ctx.createRadialGradient(c.x, c.y, 40, c.x, c.y, 230);
      gr.addColorStop(0, 'rgba(98,82,54,0.6)'); gr.addColorStop(1, 'rgba(98,82,54,0)');
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.arc(c.x, c.y, 230, 0, TAU); ctx.fill();
    }
    for (const p of map.paths) {
      this.strokePoly(ctx, p, 120, 'rgba(70,60,40,0.28)');
      this.strokePoly(ctx, p, 70, 'rgba(118,100,68,0.32)');
    }
    // река
    this.strokePoly(ctx, map.river, 430, '#2c4636');
    this.strokePoly(ctx, map.river, 350, '#245a70');
    this.strokePoly(ctx, map.river, 230, '#2a6f8a');
    this.strokePoly(ctx, map.river, 300, 'rgba(190,235,255,0.09)', [36, 110], -this.time * 26);
    this.strokePoly(ctx, map.river, 180, 'rgba(190,235,255,0.07)', [20, 140], -this.time * 40);
    // линии
    for (const l of [map.lanes.top, map.lanes.mid, map.lanes.bot]) {
      this.strokePoly(ctx, l, 300, 'rgba(62,50,32,0.55)');
      this.strokePoly(ctx, l, 248, '#7a6646');
      this.strokePoly(ctx, l, 150, 'rgba(160,138,96,0.28)');
    }
    // логово Голема — каменная площадка в реке
    {
      const bp = map.bossPit;
      ctx.fillStyle = 'rgba(70,76,84,0.92)';
      this.octagon(ctx, bp.x, bp.y, 190); ctx.fill();
      ctx.fillStyle = this.paving || (this.paving = this.makePaving());
      this.octagon(ctx, bp.x, bp.y, 174); ctx.fill();
      ctx.strokeStyle = 'rgba(200,180,110,0.55)'; ctx.lineWidth = 6;
      this.octagon(ctx, bp.x, bp.y, 190); ctx.stroke();
      ctx.strokeStyle = 'rgba(20,22,26,0.45)'; ctx.lineWidth = 4;
      this.octagon(ctx, bp.x, bp.y, 100); ctx.stroke();
    }
    // базы
    map.bases.forEach((b, team) => {
      const a = b.ancient, f = b.fountain;
      this.strokePoly(ctx, [a, f], 230, 'rgba(66,70,76,0.95)');
      this.strokePoly(ctx, [a, f], 190, this.paving || (this.paving = this.makePaving()));
      ctx.fillStyle = 'rgba(58,62,68,0.95)';
      this.octagon(ctx, a.x, a.y, 560); ctx.fill();
      ctx.fillStyle = this.paving;
      this.octagon(ctx, a.x, a.y, 540); ctx.fill();
      ctx.strokeStyle = TEAM_DARK[team]; ctx.lineWidth = 12;
      this.octagon(ctx, a.x, a.y, 560); ctx.stroke();
      ctx.strokeStyle = 'rgba(20,22,26,0.55)'; ctx.lineWidth = 6;
      this.octagon(ctx, a.x, a.y, 330); ctx.stroke();
      ctx.fillStyle = 'rgba(58,62,68,0.95)';
      ctx.beginPath(); ctx.arc(f.x, f.y, 300, 0, TAU); ctx.fill();
      ctx.fillStyle = this.paving;
      ctx.beginPath(); ctx.arc(f.x, f.y, 284, 0, TAU); ctx.fill();
      ctx.strokeStyle = TEAM_DARK[team]; ctx.lineWidth = 10;
      ctx.beginPath(); ctx.arc(f.x, f.y, 300, 0, TAU); ctx.stroke();
      ctx.strokeStyle = 'rgba(20,22,26,0.5)'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(f.x, f.y, 150, 0, TAU); ctx.stroke();
    });
  }

  makePaving() {
    const cv = document.createElement('canvas');
    cv.width = cv.height = 128;
    const c = cv.getContext('2d');
    const rng = mulberry32(99);
    c.fillStyle = '#4a4e55';
    c.fillRect(0, 0, 128, 128);
    for (let row = 0; row < 4; row++) {
      for (let col = 0; col < 3; col++) {
        const off = row % 2 ? 21 : 0;
        const x = col * 42 + off, y = row * 32;
        const v = 70 + Math.floor(rng() * 22);
        c.fillStyle = `rgb(${v},${v + 3},${v + 8})`;
        for (const dx of [0, -128]) c.fillRect(x + dx + 2, y + 2, 38, 28);
      }
    }
    c.fillStyle = 'rgba(0,0,0,0.08)';
    for (let i = 0; i < 160; i++) c.fillRect(rng() * 128, rng() * 128, 2, 2);
    return this.ctx.createPattern(cv, 'repeat');
  }

  octagon(ctx, x, y, r) {
    ctx.beginPath();
    for (let i = 0; i < 8; i++) {
      const a = i / 8 * TAU + Math.PI / 8;
      ctx.lineTo(x + Math.cos(a) * r, y + Math.sin(a) * r);
    }
    ctx.closePath();
  }

  drawRubble(ctx) {
    for (const r of this.g.rubble) {
      ctx.fillStyle = 'rgba(40,40,44,0.7)';
      ctx.beginPath(); ctx.arc(r.x, r.y, r.r * 1.1, 0, TAU); ctx.fill();
      ctx.fillStyle = '#5a5d63';
      for (let i = 0; i < 6; i++) {
        const a = i * 1.7 + r.x, d = 10 + (i * 7) % 24;
        ctx.fillRect(r.x + Math.cos(a) * d - 5, r.y + Math.sin(a) * d - 4, 10, 8);
      }
    }
  }

  drawTrees(ctx, vb) {
    const trees = this.g.map.trees, sp = this.treeSprites;
    for (const t of trees) {
      if (t.x < vb.x0 - 60 || t.x > vb.x1 + 60 || t.y < vb.y0 - 60 || t.y > vb.y1 + 60) continue;
      const dire = t.y < t.x;
      const img = sp[(dire ? 3 : 0) + (t.v % 3)];
      const s = t.r * 2.9;
      ctx.drawImage(img, t.x - s / 2, t.y - s / 2, s, s);
    }
  }

  drawRanges(ctx) {
    const g = this.g, p = g.player;
    if (!p || !p.alive) return;
    for (const t of g.towers) {
      if (!t.alive || t.team === p.team) continue;
      const d = dist(p.x, p.y, t.x, t.y);
      if (d > TOWER_RANGE + 260) continue;
      const k = clamp(1 - (d - TOWER_RANGE) / 260, 0, 1);
      ctx.strokeStyle = `rgba(255,80,60,${0.15 + 0.45 * k})`;
      ctx.lineWidth = 4;
      ctx.setLineDash([18, 14]);
      ctx.beginPath(); ctx.arc(t.x, t.y, TOWER_RANGE + t.radius, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  visible(u) {
    const g = this.g;
    if (g.spectator || u.team === g.playerTeam || u.isBuilding) return true;
    return u.visibleTo[g.playerTeam];
  }

  drawUnits(ctx, vb) {
    const g = this.g;
    const list = [];
    for (const u of g.units) {
      if (!u.alive) continue;
      if (u.x < vb.x0 - 150 || u.x > vb.x1 + 150 || u.y < vb.y0 - 150 || u.y > vb.y1 + 200) continue;
      if (!this.visible(u)) continue;
      list.push(u);
    }
    list.sort((a, b) => a.y - b.y);
    this.drawn = list;
    const hv = this.hover;
    for (const u of list) {
      if (u === hv) {
        ctx.strokeStyle = u.team === g.playerTeam ? 'rgba(120,255,140,0.9)' : u.team === NEUTRAL ? 'rgba(255,210,90,0.9)' : 'rgba(255,90,70,0.95)';
        ctx.lineWidth = 3;
        ctx.beginPath(); ctx.ellipse(u.x, u.y + 2, u.radius + 8, (u.radius + 8) * 0.85, 0, 0, TAU); ctx.stroke();
      }
      switch (u.kind) {
        case 'hero': this.drawHero(ctx, u); break;
        case 'creep': this.drawCreep(ctx, u); break;
        case 'neutral': this.drawNeutral(ctx, u); break;
        case 'tower': this.drawTower(ctx, u); break;
        case 'ancient': this.drawAncient(ctx, u); break;
        case 'fountain': this.drawFountain(ctx, u); break;
      }
    }
  }

  shadow(ctx, x, y, r, k) {
    ctx.fillStyle = 'rgba(0,0,0,0.33)';
    ctx.beginPath(); ctx.ellipse(x + 3, y + r * 0.45, r * k, r * 0.55 * k, 0, 0, TAU); ctx.fill();
  }

  drawHero(ctx, h) {
    const r = h.radius, x = h.x, y = h.y - h.z;
    const def = h.def;
    this.shadow(ctx, h.x, h.y, r, 1 - h.z / 400);
    if (h === this.g.player) {
      ctx.strokeStyle = 'rgba(255,214,90,0.85)';
      ctx.lineWidth = 3;
      ctx.beginPath(); ctx.ellipse(h.x, h.y + 4, r + 11, (r + 11) * 0.88, 0, 0, TAU); ctx.stroke();
    }
    ctx.globalAlpha = h.s.invis ? 0.42 : 1;
    const storm = h.busy && h.busy.kind === 'storm';
    if (storm) { ctx.shadowColor = '#bfeaff'; ctx.shadowBlur = 24; }
    ctx.fillStyle = TEAM_COLOR[h.team];
    ctx.beginPath(); ctx.arc(x, y, r + 4, 0, TAU); ctx.fill();
    ctx.shadowBlur = 0;
    ctx.fillStyle = '#0c0f14';
    ctx.beginPath(); ctx.arc(x, y, r + 1.5, 0, TAU); ctx.fill();
    const gr = ctx.createRadialGradient(x - r * 0.3, y - r * 0.35, r * 0.1, x, y, r);
    gr.addColorStop(0, def.color); gr.addColorStop(1, def.color2);
    ctx.fillStyle = gr;
    ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    this.drawWeapon(ctx, h, x, y, r);
    Icons.glyph(ctx, def.glyph, x, y, r * 1.05, 'rgba(255,255,255,0.88)');
    if (h.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${Math.min(0.5, h.flash * 4)})`;
      ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
    }
    ctx.globalAlpha = 1;
    this.drawStatus(ctx, h, x, y, r);
  }

  drawWeapon(ctx, h, x, y, r) {
    const w = h.def.weapon;
    const melee = h.def.range < 100;
    const k = h.attackAnim;
    const swing = melee ? (k > 0 ? Math.sin(k * Math.PI) * 1.3 - 0.4 : -0.4) : (k > 0 ? -k * 0.25 : 0);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(h.facing + swing);
    ctx.lineCap = 'round';
    if (w === 'sword') {
      ctx.strokeStyle = '#1a1f26'; ctx.lineWidth = 8;
      ctx.beginPath(); ctx.moveTo(r - 4, 0); ctx.lineTo(r + 30, 0); ctx.stroke();
      ctx.strokeStyle = '#e4f3ff'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(r - 2, 0); ctx.lineTo(r + 30, 0); ctx.stroke();
      ctx.strokeStyle = '#7fd8ff'; ctx.lineWidth = 4;
      ctx.beginPath(); ctx.moveTo(r - 4, -8); ctx.lineTo(r - 4, 8); ctx.stroke();
    } else if (w === 'hammer') {
      ctx.strokeStyle = '#4a3420'; ctx.lineWidth = 6;
      ctx.beginPath(); ctx.moveTo(r - 8, 0); ctx.lineTo(r + 24, 0); ctx.stroke();
      ctx.fillStyle = '#8f8a82'; ctx.strokeStyle = '#2a2a2a'; ctx.lineWidth = 2;
      ctx.fillRect(r + 16, -12, 16, 24); ctx.strokeRect(r + 16, -12, 16, 24);
    } else if (w === 'bow') {
      ctx.strokeStyle = '#2a1840'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.arc(r - 6, 0, 18, -1.25, 1.25); ctx.stroke();
      ctx.strokeStyle = '#d6c2ff'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.arc(r - 6, 0, 18, -1.25, 1.25); ctx.stroke();
      ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.moveTo(r + 0.6, -17); ctx.lineTo(r - 2 - k * 8, 0); ctx.lineTo(r + 0.6, 17); ctx.stroke();
    } else {
      const orb = w === 'staff_fire' ? '#ffb347' : w === 'staff_ice' ? '#c8f2ff' : '#fff1a0';
      ctx.strokeStyle = '#3a2a1a'; ctx.lineWidth = 5;
      ctx.beginPath(); ctx.moveTo(-r * 0.2, r * 0.75); ctx.lineTo(r + 16, r * 0.45); ctx.stroke();
      ctx.shadowColor = orb; ctx.shadowBlur = 14 + k * 20;
      ctx.fillStyle = orb;
      ctx.beginPath(); ctx.arc(r + 18, r * 0.42, 6 + k * 3, 0, TAU); ctx.fill();
      ctx.shadowBlur = 0;
    }
    ctx.restore();
  }

  drawStatus(ctx, u, x, y, r) {
    let stun = false, shield = false, chill = false, burn = false, poison = false, silence = false, mark = false;
    let bless = false, skin = false, bkb = false;
    for (const b of u.buffs) {
      if (b.stun) stun = true;
      if (b.iceShield) shield = true;
      if (b.chill) chill = true;
      if (b.burn) burn = true;
      if (b.poison) poison = true;
      if (b.silence) silence = true;
      if (b.marked) mark = true;
      if (b.blessed) bless = true;
      if (b.stoneSkin) skin = true;
      if (b.bkb) bkb = true;
    }
    const t = this.time;
    if (skin) { ctx.strokeStyle = 'rgba(170,140,100,0.95)'; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(x, y, r + 5, 0, TAU); ctx.stroke(); }
    if (chill) { ctx.strokeStyle = 'rgba(150,220,255,0.75)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, r + 3, 0, TAU); ctx.stroke(); }
    if (burn) { ctx.strokeStyle = `rgba(255,140,40,${0.45 + 0.3 * Math.sin(t * 20)})`; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, r + 2, 0, TAU); ctx.stroke(); }
    if (poison) { ctx.strokeStyle = 'rgba(140,255,90,0.7)'; ctx.lineWidth = 3; ctx.setLineDash([6, 6]); ctx.beginPath(); ctx.arc(x, y, r + 6, t, t + TAU); ctx.stroke(); ctx.setLineDash([]); }
    if (shield) {
      ctx.fillStyle = 'rgba(190,240,255,0.18)'; ctx.strokeStyle = 'rgba(210,248,255,0.85)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(x, y, r + 10, 0, TAU); ctx.fill(); ctx.stroke();
    }
    if (bless) { ctx.strokeStyle = 'rgba(255,236,150,0.9)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, r + 12 + Math.sin(t * 6) * 2, 0, TAU); ctx.stroke(); }
    if (bkb) { ctx.shadowColor = '#ffd84a'; ctx.shadowBlur = 18; ctx.strokeStyle = 'rgba(255,216,74,0.9)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, r + 7, 0, TAU); ctx.stroke(); ctx.shadowBlur = 0; }
    if (mark) {
      ctx.save(); ctx.translate(x, y); ctx.rotate(t * 1.5);
      ctx.strokeStyle = 'rgba(255,70,90,0.9)'; ctx.lineWidth = 2.5;
      ctx.beginPath(); ctx.arc(0, 0, r + 16, 0, TAU); ctx.stroke();
      for (let i = 0; i < 4; i++) { ctx.rotate(Math.PI / 2); ctx.beginPath(); ctx.moveTo(r + 8, 0); ctx.lineTo(r + 24, 0); ctx.stroke(); }
      ctx.restore();
    }
    if (silence) {
      ctx.fillStyle = 'rgba(200,120,255,0.95)';
      ctx.beginPath(); ctx.arc(x + r * 0.9, y - r - 6, 7, 0, TAU); ctx.fill();
      ctx.strokeStyle = '#1a0a24'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(x + r * 0.9 - 4, y - r - 10); ctx.lineTo(x + r * 0.9 + 4, y - r - 2); ctx.stroke();
    }
    if (stun) {
      for (let i = 0; i < 3; i++) {
        const a = t * 5 + i * TAU / 3;
        Icons.glyph(ctx, 'star', x + Math.cos(a) * r * 0.8, y - r - 10 + Math.sin(a) * 5, 12, '#ffe36a');
      }
    }
  }

  drawCreep(ctx, c) {
    const r = c.radius, x = c.x, y = c.y;
    const col = TEAM_COLOR[c.team], dark = TEAM_DARK[c.team];
    this.shadow(ctx, x, y, r, 1);
    const bob = c.moving ? Math.sin(c.walkT * 2) * 1.5 : 0;
    ctx.save();
    ctx.translate(x, y + bob);
    ctx.rotate(c.facing);
    if (c.superCreep) { ctx.shadowColor = '#ffd86b'; ctx.shadowBlur = 12; }
    const gr = ctx.createRadialGradient(-r * 0.3, -r * 0.3, 1, 0, 0, r);
    gr.addColorStop(0, col); gr.addColorStop(1, dark);
    ctx.fillStyle = gr;
    ctx.strokeStyle = '#0d0f12'; ctx.lineWidth = 2;
    if (c.ctype === 'ranged') {
      ctx.beginPath(); ctx.moveTo(r, 0); ctx.lineTo(0, r * 0.9); ctx.lineTo(-r, 0); ctx.lineTo(0, -r * 0.9); ctx.closePath();
      ctx.fill(); ctx.stroke();
      ctx.shadowBlur = 0;
      ctx.fillStyle = c.team === RADIANT ? '#e8ffd0' : '#ffd8c8';
      ctx.beginPath(); ctx.arc(r * 0.9, 0, 3.5 + c.attackAnim * 2, 0, TAU); ctx.fill();
    } else {
      ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.shadowBlur = 0;
      const sw = c.attackAnim > 0 ? Math.sin(c.attackAnim * Math.PI) * 1.2 - 0.5 : -0.5;
      ctx.rotate(sw);
      ctx.strokeStyle = '#d8dde4'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(r - 2, 2); ctx.lineTo(r + 13, 2); ctx.stroke();
    }
    if (c.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${Math.min(0.5, c.flash * 4)})`;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
    }
    ctx.restore();
    if (c.buffs.length) this.drawStatus(ctx, c, x, y, r);
  }

  drawNeutral(ctx, n) {
    const r = n.radius, x = n.x, y = n.y;
    this.shadow(ctx, x, y, r, 1);
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(n.facing);
    ctx.fillStyle = n.color; ctx.strokeStyle = '#141414'; ctx.lineWidth = 2;
    if (n.ntype === 'wolf') {
      ctx.beginPath(); ctx.ellipse(0, 0, r * 1.25, r * 0.8, 0, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.beginPath(); ctx.ellipse(r * 1.1, 0, r * 0.55, r * 0.4, 0, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#5c6066';
      ctx.beginPath(); ctx.moveTo(r * 0.8, -r * 0.3); ctx.lineTo(r * 0.7, -r * 0.8); ctx.lineTo(r * 1.0, -r * 0.4); ctx.fill();
      ctx.beginPath(); ctx.moveTo(r * 0.8, r * 0.3); ctx.lineTo(r * 0.7, r * 0.8); ctx.lineTo(r * 1.0, r * 0.4); ctx.fill();
    } else if (n.ntype === 'golem') {
      const sw = n.attackAnim > 0 ? Math.sin(n.attackAnim * Math.PI) * 0.6 : 0;
      ctx.fillStyle = '#5d6672';
      for (const s of [1, -1]) {
        ctx.save(); ctx.rotate(s * (0.9 - sw * s));
        ctx.beginPath(); ctx.arc(r * 0.95, 0, r * 0.42, 0, TAU); ctx.fill(); ctx.stroke();
        ctx.restore();
      }
      const gr = ctx.createRadialGradient(-r * 0.3, -r * 0.3, 2, 0, 0, r);
      gr.addColorStop(0, '#aab4c0'); gr.addColorStop(1, '#4a525d');
      ctx.fillStyle = gr;
      ctx.beginPath();
      for (let i = 0; i < 9; i++) {
        const a = i / 9 * TAU, rr = r * (0.88 + ((i * 37) % 7) / 50);
        ctx.lineTo(Math.cos(a) * rr, Math.sin(a) * rr);
      }
      ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.strokeStyle = 'rgba(30,34,40,0.6)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.moveTo(-r * 0.5, -r * 0.2); ctx.lineTo(0, r * 0.1); ctx.lineTo(-r * 0.2, r * 0.6); ctx.stroke();
      ctx.shadowColor = '#7fe0ff'; ctx.shadowBlur = 14;
      ctx.fillStyle = '#9ff0ff';
      ctx.beginPath(); ctx.arc(r * 0.55, -r * 0.25, 4, 0, TAU); ctx.arc(r * 0.55, r * 0.25, 4, 0, TAU); ctx.fill();
      ctx.shadowBlur = 0;
    } else {
      ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill(); ctx.stroke();
      if (n.ntype === 'kobold') {
        ctx.fillStyle = '#8a6a2a';
        ctx.beginPath(); ctx.moveTo(0, -r); ctx.lineTo(-r * 0.4, -r * 1.6); ctx.lineTo(r * 0.3, -r * 0.8); ctx.fill();
        ctx.beginPath(); ctx.moveTo(0, r); ctx.lineTo(-r * 0.4, r * 1.6); ctx.lineTo(r * 0.3, r * 0.8); ctx.fill();
      } else if (n.ntype === 'ogre') {
        ctx.fillStyle = '#f0ead8';
        ctx.beginPath(); ctx.moveTo(r * 0.8, -6); ctx.lineTo(r + 8, -10); ctx.lineTo(r * 0.85, -2); ctx.fill();
        ctx.beginPath(); ctx.moveTo(r * 0.8, 6); ctx.lineTo(r + 8, 10); ctx.lineTo(r * 0.85, 2); ctx.fill();
        const sw = n.attackAnim > 0 ? Math.sin(n.attackAnim * Math.PI) * 1.2 : 0;
        ctx.rotate(sw);
        ctx.strokeStyle = '#4a3420'; ctx.lineWidth = 6;
        ctx.beginPath(); ctx.moveTo(0, r * 0.7); ctx.lineTo(r + 14, r * 0.7); ctx.stroke();
      } else if (n.ntype === 'shaman') {
        ctx.strokeStyle = '#3a2a1a'; ctx.lineWidth = 3;
        ctx.beginPath(); ctx.moveTo(0, r * 0.7); ctx.lineTo(r + 10, r * 0.5); ctx.stroke();
        ctx.fillStyle = '#e2b8ff'; ctx.shadowColor = '#c08aff'; ctx.shadowBlur = 10;
        ctx.beginPath(); ctx.arc(r + 11, r * 0.5, 4, 0, TAU); ctx.fill();
        ctx.shadowBlur = 0;
      }
    }
    if (n.ntype !== 'golem') {
      ctx.fillStyle = '#ffde6a';
      ctx.beginPath(); ctx.arc(r * 0.45, -r * 0.3, 2, 0, TAU); ctx.arc(r * 0.45, r * 0.3, 2, 0, TAU); ctx.fill();
    }
    if (n.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${Math.min(0.5, n.flash * 4)})`;
      ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.fill();
    }
    ctx.restore();
    if (n.buffs.length) this.drawStatus(ctx, n, x, y, r);
  }

  drawTower(ctx, t) {
    const x = t.x, y = t.y, r = t.radius;
    const col = TEAM_COLOR[t.team];
    ctx.fillStyle = 'rgba(0,0,0,0.38)';
    ctx.beginPath(); ctx.ellipse(x + 6, y + 14, r * 1.2, r * 0.7, 0, 0, TAU); ctx.fill();
    ctx.save(); ctx.translate(x, y); ctx.rotate(Math.PI / 4);
    ctx.fillStyle = '#585c63'; ctx.strokeStyle = '#25282d'; ctx.lineWidth = 3;
    ctx.fillRect(-r * 0.9, -r * 0.9, r * 1.8, r * 1.8); ctx.strokeRect(-r * 0.9, -r * 0.9, r * 1.8, r * 1.8);
    ctx.restore();
    const gr = ctx.createRadialGradient(x - 8, y - 10, 2, x, y, r * 0.8);
    gr.addColorStop(0, '#9aa0a8'); gr.addColorStop(1, '#4c5057');
    ctx.fillStyle = gr;
    ctx.beginPath(); ctx.arc(x, y - 6, r * 0.72, 0, TAU); ctx.fill();
    ctx.strokeStyle = '#2a2d31'; ctx.lineWidth = 2; ctx.stroke();
    const glow = t.attackAnim;
    ctx.shadowColor = col; ctx.shadowBlur = 12 + glow * 26;
    const cg = ctx.createLinearGradient(x, y - 60, x, y - 8);
    cg.addColorStop(0, '#ffffff'); cg.addColorStop(0.4, col); cg.addColorStop(1, TEAM_DARK[t.team]);
    ctx.fillStyle = cg;
    ctx.beginPath(); ctx.moveTo(x, y - 62); ctx.lineTo(x + 13, y - 32); ctx.lineTo(x, y - 10); ctx.lineTo(x - 13, y - 32); ctx.closePath(); ctx.fill();
    ctx.shadowBlur = 0;
    if (t.protected) {
      ctx.strokeStyle = 'rgba(160,200,255,0.35)'; ctx.lineWidth = 2; ctx.setLineDash([6, 6]);
      ctx.beginPath(); ctx.arc(x, y - 10, r + 10, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    }
    if (t.flash > 0) {
      ctx.fillStyle = `rgba(255,255,255,${Math.min(0.35, t.flash * 3)})`;
      ctx.beginPath(); ctx.arc(x, y - 6, r * 0.72, 0, TAU); ctx.fill();
    }
  }

  drawAncient(ctx, a) {
    const x = a.x, y = a.y, col = TEAM_COLOR[a.team];
    ctx.fillStyle = 'rgba(0,0,0,0.4)';
    ctx.beginPath(); ctx.ellipse(x + 10, y + 24, 100, 60, 0, 0, TAU); ctx.fill();
    ctx.fillStyle = '#4e5259'; ctx.strokeStyle = '#22252a'; ctx.lineWidth = 4;
    this.octagon(ctx, x, y, 96); ctx.fill(); ctx.stroke();
    ctx.fillStyle = '#6a6f77';
    this.octagon(ctx, x, y, 66); ctx.fill();
    const pulse = 0.5 + 0.5 * Math.sin(this.time * 2.2);
    ctx.shadowColor = col; ctx.shadowBlur = 30 + pulse * 30;
    for (const [dx, h, w] of [[-34, 70, 18], [34, 70, 18], [0, 130, 30]]) {
      const gr = ctx.createLinearGradient(x + dx, y - h, x + dx, y);
      gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.35, col); gr.addColorStop(1, TEAM_DARK[a.team]);
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.moveTo(x + dx, y - h); ctx.lineTo(x + dx + w, y - h * 0.45); ctx.lineTo(x + dx, y + 6); ctx.lineTo(x + dx - w, y - h * 0.45); ctx.closePath(); ctx.fill();
    }
    ctx.shadowBlur = 0;
    if (a.protected) {
      ctx.strokeStyle = `rgba(160,200,255,${0.25 + pulse * 0.2})`; ctx.lineWidth = 3; ctx.setLineDash([10, 8]);
      ctx.beginPath(); ctx.arc(x, y - 20, 120, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
    }
  }

  drawFountain(ctx, f) {
    const x = f.x, y = f.y, col = TEAM_COLOR[f.team];
    ctx.fillStyle = '#3e4248'; ctx.strokeStyle = '#1e2024'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.arc(x, y, 76, 0, TAU); ctx.fill(); ctx.stroke();
    const gr = ctx.createRadialGradient(x, y, 4, x, y, 60);
    gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.3, col); gr.addColorStop(1, TEAM_DARK[f.team]);
    ctx.fillStyle = gr;
    ctx.beginPath(); ctx.arc(x, y, 58, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 2;
    for (let i = 0; i < 3; i++) {
      const k = (this.time * 0.6 + i / 3) % 1;
      ctx.globalAlpha = 1 - k;
      ctx.beginPath(); ctx.arc(x, y, 10 + k * 50, 0, TAU); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  drawProjectiles(ctx) {
    const g = this.g;
    ctx.globalCompositeOperation = 'lighter';
    for (const p of g.projectiles) {
      const s = p.size;
      ctx.fillStyle = p.color;
      ctx.globalAlpha = 0.35;
      ctx.beginPath(); ctx.arc(p.x, p.y, s * 2.1, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
      ctx.beginPath(); ctx.arc(p.x, p.y, s, 0, TAU); ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath(); ctx.arc(p.x, p.y, s * 0.45, 0, TAU); ctx.fill();
    }
    for (const s of g.skillshots) {
      const sz = s.opts.size;
      const gr = ctx.createRadialGradient(s.x, s.y, 1, s.x, s.y, sz * 2.4);
      gr.addColorStop(0, '#ffffff'); gr.addColorStop(0.3, s.opts.color); gr.addColorStop(1, 'rgba(0,0,0,0)');
      ctx.fillStyle = gr;
      ctx.beginPath(); ctx.arc(s.x, s.y, sz * 2.4, 0, TAU); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
  }

  drawZones(ctx) {
    for (const z of this.g.zones) {
      const k = z.t / z.dur;
      const a = Math.min(1, z.t * 4) * (k > 0.85 ? (1 - k) / 0.15 : 1);
      ctx.fillStyle = `rgba(200,232,255,${0.16 * a})`;
      ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, TAU); ctx.fill();
      ctx.strokeStyle = `rgba(230,246,255,${0.6 * a})`; ctx.lineWidth = 4;
      ctx.setLineDash([30, 20]); ctx.lineDashOffset = -this.time * 60;
      ctx.beginPath(); ctx.arc(z.x, z.y, z.r, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
    }
  }

  drawEffects(ctx, ground) {
    const g = this.g;
    for (const e of g.effects) {
      const isGround = e.type === 'warn' || e.type === 'cracks' || e.type === 'corpse' || e.type === 'tp' || e.type === 'mark';
      if (isGround !== ground) continue;
      if (!g.spectator && e.team !== undefined && e.team !== g.playerTeam) continue;
      const k = clamp(e.t / e.dur, 0, 1);
      switch (e.type) {
        case 'ring': {
          const r = lerp(e.r0, e.r1, 1 - (1 - k) * (1 - k));
          ctx.strokeStyle = e.color; ctx.globalAlpha = 1 - k; ctx.lineWidth = e.width * (1 - k * 0.6);
          ctx.beginPath(); ctx.arc(e.x, e.y, Math.max(1, r), 0, TAU); ctx.stroke();
          ctx.globalAlpha = 1;
          break;
        }
        case 'circle':
          ctx.fillStyle = e.color; ctx.globalAlpha = 1 - k;
          ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, TAU); ctx.fill();
          ctx.globalAlpha = 1;
          break;
        case 'beam':
          ctx.globalCompositeOperation = 'lighter';
          ctx.strokeStyle = e.color; ctx.globalAlpha = 1 - k; ctx.lineWidth = e.width * (1 - k);
          ctx.beginPath(); ctx.moveTo(e.x1, e.y1); ctx.lineTo(e.x2, e.y2); ctx.stroke();
          ctx.strokeStyle = '#ffffff'; ctx.lineWidth = e.width * 0.3 * (1 - k);
          ctx.stroke();
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = 'source-over';
          break;
        case 'warn':
          ctx.fillStyle = e.color; ctx.globalAlpha = 0.12 + 0.18 * k;
          ctx.beginPath(); ctx.arc(e.x, e.y, e.r * k, 0, TAU); ctx.fill();
          ctx.globalAlpha = 0.7; ctx.strokeStyle = e.color; ctx.lineWidth = 3;
          ctx.beginPath(); ctx.arc(e.x, e.y, e.r, 0, TAU); ctx.stroke();
          ctx.globalAlpha = 1;
          break;
        case 'pillar': {
          ctx.globalCompositeOperation = 'lighter';
          const h = 260 * (1 - k * 0.5);
          const gr = ctx.createLinearGradient(e.x, e.y - h, e.x, e.y);
          gr.addColorStop(0, 'rgba(255,200,80,0)'); gr.addColorStop(0.5, 'rgba(255,150,50,0.7)'); gr.addColorStop(1, 'rgba(255,240,180,0.9)');
          ctx.globalAlpha = 1 - k;
          ctx.fillStyle = gr;
          ctx.beginPath(); ctx.ellipse(e.x, e.y - h / 2, e.r * 0.55 * (1 - k * 0.5), h / 2, 0, 0, TAU); ctx.fill();
          ctx.globalAlpha = 1;
          ctx.globalCompositeOperation = 'source-over';
          break;
        }
        case 'meteor': {
          const sx = e.x - 500, sy = e.y - 900;
          const mx = lerp(sx, e.x, k * k), my = lerp(sy, e.y, k * k);
          ctx.globalCompositeOperation = 'lighter';
          const gr = ctx.createLinearGradient(mx, my, mx - 150, my - 270);
          gr.addColorStop(0, 'rgba(255,200,90,0.9)'); gr.addColorStop(1, 'rgba(255,80,20,0)');
          ctx.strokeStyle = gr; ctx.lineWidth = 34 * (0.5 + k);
          ctx.beginPath(); ctx.moveTo(mx, my); ctx.lineTo(mx - 150, my - 270); ctx.stroke();
          ctx.globalCompositeOperation = 'source-over';
          ctx.fillStyle = '#4a3020';
          ctx.beginPath(); ctx.arc(mx, my, 26 * (0.5 + k), 0, TAU); ctx.fill();
          ctx.fillStyle = '#ffb060';
          ctx.beginPath(); ctx.arc(mx - 4, my - 4, 14 * (0.5 + k), 0, TAU); ctx.fill();
          break;
        }
        case 'slash':
          ctx.strokeStyle = e.color; ctx.globalAlpha = (1 - k) * 0.85; ctx.lineWidth = 4;
          ctx.beginPath(); ctx.arc(e.x, e.y, e.r, e.a - 0.9 + k * 0.6, e.a + 0.5 + k * 0.6); ctx.stroke();
          ctx.globalAlpha = 1;
          break;
        case 'spin':
          ctx.strokeStyle = e.color; ctx.globalAlpha = 1 - k; ctx.lineWidth = 8;
          for (let i = 0; i < 3; i++) {
            const a = k * TAU * 1.5 + i * TAU / 3;
            ctx.beginPath(); ctx.arc(e.x, e.y, e.r * (0.5 + k * 0.5), a, a + 1.2); ctx.stroke();
          }
          ctx.globalAlpha = 1;
          break;
        case 'cracks': {
          ctx.strokeStyle = 'rgba(30,20,10,0.75)'; ctx.globalAlpha = 1 - k; ctx.lineWidth = 4;
          const rng = mulberry32(Math.floor(e.x * 7 + e.y));
          for (let i = 0; i < 9; i++) {
            let a = rng() * TAU, x = e.x, y = e.y;
            ctx.beginPath(); ctx.moveTo(x, y);
            for (let s = 0; s < 4; s++) { a += (rng() - 0.5) * 0.8; x += Math.cos(a) * e.r / 4.5; y += Math.sin(a) * e.r / 4.5; ctx.lineTo(x, y); }
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
          break;
        }
        case 'tp': {
          ctx.strokeStyle = e.color; ctx.lineWidth = 4; ctx.globalAlpha = 0.85;
          for (let i = 0; i < 3; i++) {
            const a = this.time * 3 + i * TAU / 3;
            ctx.beginPath(); ctx.arc(e.x, e.y, 70, a, a + 1.4); ctx.stroke();
          }
          ctx.globalAlpha = 0.25 + 0.2 * k; ctx.fillStyle = e.color;
          ctx.beginPath(); ctx.arc(e.x, e.y, 70 * k, 0, TAU); ctx.fill();
          ctx.globalAlpha = 1;
          break;
        }
        case 'corpse':
          ctx.fillStyle = e.color; ctx.globalAlpha = (1 - k) * 0.5;
          ctx.beginPath(); ctx.ellipse(e.x, e.y, e.r * (1 + k * 0.4), e.r * 0.6 * (1 + k * 0.4), 0, 0, TAU); ctx.fill();
          ctx.globalAlpha = 1;
          break;
        case 'mark': {
          const s = 1 - k;
          ctx.strokeStyle = e.color; ctx.lineWidth = 3; ctx.globalAlpha = s;
          for (let i = 0; i < 4; i++) {
            const a = i * Math.PI / 2 + Math.PI / 4;
            const r0 = 6 + 18 * s;
            ctx.beginPath();
            ctx.moveTo(e.x + Math.cos(a) * r0, e.y + Math.sin(a) * r0);
            ctx.lineTo(e.x + Math.cos(a) * (r0 + 10), e.y + Math.sin(a) * (r0 + 10));
            ctx.stroke();
          }
          ctx.globalAlpha = 1;
          break;
        }
      }
    }
  }

  drawParticles(ctx, vb) {
    const ps = this.g.particles;
    ctx.globalCompositeOperation = 'lighter';
    for (const p of ps) {
      if (!p.glow) continue;
      if (p.x < vb.x0 || p.x > vb.x1 || p.y < vb.y0 || p.y > vb.y1) continue;
      ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.size, 0, TAU); ctx.fill();
    }
    ctx.globalCompositeOperation = 'source-over';
    for (const p of ps) {
      if (p.glow) continue;
      if (p.x < vb.x0 || p.x > vb.x1 || p.y < vb.y0 || p.y > vb.y1) continue;
      ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
      ctx.fillStyle = p.color;
      ctx.fillRect(p.x - p.size / 2, p.y - p.size / 2, p.size, p.size);
    }
    ctx.globalAlpha = 1;
  }

  drawFog(ctx) {
    const g = this.g;
    if (g.spectator) return;
    const f = this.fog, fc = this.fctx;
    const sc = f.width / this.w;
    fc.globalCompositeOperation = 'source-over';
    fc.clearRect(0, 0, f.width, f.height);
    fc.fillStyle = 'rgba(6,9,16,0.6)';
    fc.fillRect(0, 0, f.width, f.height);
    fc.globalCompositeOperation = 'destination-out';
    const z = this.cam.zoom;
    for (const u of g.units) {
      if (!u.alive || u.team !== g.playerTeam) continue;
      const p = this.toScreen(u.x, u.y);
      const r = u.vision * z * sc;
      const x = p.x * sc, y = p.y * sc;
      if (x + r < 0 || y + r < 0 || x - r > f.width || y - r > f.height) continue;
      const gr = fc.createRadialGradient(x, y, r * 0.72, x, y, r);
      gr.addColorStop(0, 'rgba(0,0,0,1)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      fc.fillStyle = gr;
      fc.beginPath(); fc.arc(x, y, r, 0, TAU); fc.fill();
    }
    ctx.drawImage(f, 0, 0, this.w, this.h);
  }

  drawBars(ctx) {
    const g = this.g;
    const list = this.drawn || [];
    ctx.textAlign = 'center';
    for (const u of list) {
      if (!u.alive || u.kind === 'fountain') continue;
      const p = this.toScreen(u.x, u.y - (u.z || 0));
      const z = this.cam.zoom;
      let rel;
      if (u.team === NEUTRAL) rel = 'neutral';
      else if (u === g.player) rel = 'self';
      else if (g.spectator ? u.team === RADIANT : u.team === g.playerTeam) rel = 'ally';
      else rel = 'enemy';
      const pct = clamp(u.hp / u.s.maxHp, 0, 1);
      if (u.kind === 'hero') {
        const w = 66, y = p.y - (u.radius + 30) * z - 8;
        const x = p.x - w / 2;
        ctx.fillStyle = 'rgba(0,0,0,0.75)';
        ctx.fillRect(x - 1, y - 1, w + 2, 13);
        ctx.fillStyle = HP_COLORS[rel];
        ctx.fillRect(x, y, w * pct, 7);
        ctx.fillStyle = 'rgba(0,0,0,0.5)';
        const step = 250 / u.s.maxHp * w;
        if (step > 3) for (let sx = x + step; sx < x + w * pct; sx += step) ctx.fillRect(sx, y, 1, 7);
        ctx.fillStyle = '#4a8cff';
        ctx.fillRect(x, y + 8, w * clamp(u.mana / (u.s.maxMana || 1), 0, 1), 3);
        ctx.fillStyle = 'rgba(0,0,0,0.85)';
        ctx.fillRect(x - 18, y - 1, 16, 13);
        ctx.fillStyle = '#ffe9a8';
        ctx.font = '700 10px "Fira Sans Condensed", system-ui, sans-serif';
        ctx.fillText(u.level, x - 10, y + 9);
        ctx.font = '600 11px "Fira Sans Condensed", system-ui, sans-serif';
        ctx.fillStyle = 'rgba(0,0,0,0.8)';
        ctx.fillText(u.name, p.x + 1, y - 4);
        ctx.fillStyle = u.team === RADIANT ? '#c8f5be' : '#ffc8c0';
        ctx.fillText(u.name, p.x, y - 5);
        if (u.busy && u.busy.kind === 'channel') {
          const k = 1 - u.busy.left / u.busy.total;
          ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillRect(x, y + 14, w, 4);
          ctx.fillStyle = '#9fe8ff'; ctx.fillRect(x, y + 14, w * k, 4);
        }
      } else if (u.isBuilding) {
        const w = u.kind === 'ancient' ? 130 : 80, h = u.kind === 'ancient' ? 9 : 7;
        const y = p.y - (u.kind === 'ancient' ? 150 : 80) * z;
        ctx.fillStyle = 'rgba(0,0,0,0.75)';
        ctx.fillRect(p.x - w / 2 - 1, y - 1, w + 2, h + 2);
        ctx.fillStyle = HP_COLORS[rel === 'self' ? 'ally' : rel];
        ctx.fillRect(p.x - w / 2, y, w * pct, h);
      } else if (u.isBoss) {
        const w = 100, y = p.y - (u.radius + 26) * z;
        ctx.fillStyle = 'rgba(0,0,0,0.75)';
        ctx.fillRect(p.x - w / 2 - 1, y - 1, w + 2, 9);
        ctx.fillStyle = HP_COLORS.neutral;
        ctx.fillRect(p.x - w / 2, y, w * pct, 7);
        ctx.font = '600 11px "Fira Sans Condensed", system-ui, sans-serif';
        ctx.fillStyle = 'rgba(0,0,0,0.8)';
        ctx.fillText(u.name, p.x + 1, y - 4);
        ctx.fillStyle = '#ffe9a8';
        ctx.fillText(u.name, p.x, y - 5);
      } else if (pct < 0.999 || u === this.hover) {
        const w = u.kind === 'neutral' && u.radius > 20 ? 44 : 34;
        const y = p.y - (u.radius + 12) * z - 4;
        ctx.fillStyle = 'rgba(0,0,0,0.7)';
        ctx.fillRect(p.x - w / 2 - 1, y - 1, w + 2, 6);
        ctx.fillStyle = HP_COLORS[rel === 'self' ? 'ally' : rel];
        ctx.fillRect(p.x - w / 2, y, w * pct, 4);
      }
    }
  }

  drawFloaters(ctx) {
    const g = this.g;
    ctx.textAlign = 'center';
    ctx.lineJoin = 'round';
    for (const f of g.floaters) {
      const p = this.toScreen(f.x, f.y);
      const k = f.t / f.dur;
      ctx.globalAlpha = 1 - k * k;
      const s = f.size * (k < 0.12 ? 0.7 + k * 2.5 : 1);
      ctx.font = `800 ${s.toFixed(1)}px "Fira Sans Condensed", system-ui, sans-serif`;
      ctx.strokeStyle = 'rgba(0,0,0,0.85)'; ctx.lineWidth = 3;
      ctx.strokeText(f.text, p.x, p.y);
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, p.x, p.y);
    }
    ctx.globalAlpha = 1;
  }

  drawTargeting(ctx) {
    const inp = this.input, g = this.g;
    if (!inp || !g.player) return;
    const pl = g.player;
    const z = this.cam.zoom;
    const tg = inp.targeting;
    if (inp.moveMark) {
      const m = inp.moveMark;
      const k = m.t / 0.6;
      if (k < 1) {
        const p = this.toScreen(m.x, m.y);
        ctx.strokeStyle = m.attack ? `rgba(255,90,70,${1 - k})` : `rgba(120,255,140,${1 - k})`;
        ctx.lineWidth = 2.5;
        ctx.beginPath(); ctx.ellipse(p.x, p.y, (16 - k * 10) * z, (10 - k * 6) * z, 0, 0, TAU); ctx.stroke();
      }
    }
    if (!tg || !pl.alive) return;
    const pp = this.toScreen(pl.x, pl.y);
    const m = this.toWorld(inp.mx, inp.my);
    if (tg.range && tg.range < 5000) {
      ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 2; ctx.setLineDash([8, 8]);
      ctx.beginPath(); ctx.arc(pp.x, pp.y, (tg.range + (tg.type === 'unit' ? pl.radius : 0)) * z, 0, TAU); ctx.stroke();
      ctx.setLineDash([]);
    }
    if (tg.type === 'point') {
      let x = m.x, y = m.y;
      const d = dist(pl.x, pl.y, x, y);
      if (tg.clamp && d > tg.range) { x = pl.x + (x - pl.x) / d * tg.range; y = pl.y + (y - pl.y) / d * tg.range; }
      const s = this.toScreen(x, y);
      if (tg.radius) {
        ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.arc(s.x, s.y, tg.radius * z, 0, TAU); ctx.fill(); ctx.stroke();
      } else {
        ctx.strokeStyle = 'rgba(255,255,255,0.8)'; ctx.lineWidth = 2;
        ctx.beginPath(); ctx.moveTo(pp.x, pp.y); ctx.lineTo(s.x, s.y); ctx.stroke();
        ctx.beginPath(); ctx.arc(s.x, s.y, 10, 0, TAU); ctx.stroke();
      }
    } else if (tg.type === 'none' && tg.radius) {
      ctx.fillStyle = 'rgba(255,255,255,0.1)'; ctx.strokeStyle = 'rgba(255,255,255,0.7)'; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.arc(pp.x, pp.y, tg.radius * z, 0, TAU); ctx.fill(); ctx.stroke();
    }
  }

  // ---------- миникарта ----------
  buildMinimapBase(size) {
    const g = this.g, map = g.map, S = WORLD_SIZE;
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const c = cv.getContext('2d');
    const k = size / S;
    c.fillStyle = '#34502a'; c.fillRect(0, 0, size, size);
    c.fillStyle = 'rgba(70,24,46,0.3)';
    c.beginPath(); c.moveTo(0, 0); c.lineTo(size, 0); c.lineTo(size, size); c.closePath(); c.fill();
    c.scale(k, k);
    c.lineCap = 'round'; c.lineJoin = 'round';
    this.strokePoly(c, map.river, 340, '#2a6f8a');
    for (const l of [map.lanes.top, map.lanes.mid, map.lanes.bot]) this.strokePoly(c, l, 200, '#8a7350');
    c.fillStyle = 'rgba(15,32,14,0.85)';
    for (const t of map.trees) { c.beginPath(); c.arc(t.x, t.y, t.r * 1.15, 0, TAU); c.fill(); }
    map.bases.forEach((b, team) => {
      c.fillStyle = TEAM_DARK[team];
      this.octagon(c, b.ancient.x, b.ancient.y, 640); c.fill();
    });
    return cv;
  }

  drawMinimap(mc, size) {
    const g = this.g;
    if (!g) return;
    if (!this.mmBase || this.mmBase.width !== size) this.mmBase = this.buildMinimapBase(size);
    const k = size / WORLD_SIZE;
    mc.setTransform(1, 0, 0, 1, 0, 0);
    mc.drawImage(this.mmBase, 0, 0);
    if (!g.spectator) {
      if (!this.mmFog || this.mmFog.width !== size) {
        this.mmFog = document.createElement('canvas');
        this.mmFog.width = this.mmFog.height = size;
      }
      const fc = this.mmFog.getContext('2d');
      fc.globalCompositeOperation = 'source-over';
      fc.clearRect(0, 0, size, size);
      fc.fillStyle = 'rgba(4,6,12,0.55)';
      fc.fillRect(0, 0, size, size);
      fc.globalCompositeOperation = 'destination-out';
      fc.fillStyle = '#000';
      for (const u of g.units) {
        if (!u.alive || u.team !== g.playerTeam) continue;
        fc.beginPath(); fc.arc(u.x * k, u.y * k, u.vision * k, 0, TAU); fc.fill();
      }
      mc.drawImage(this.mmFog, 0, 0);
    }
    const dot = Math.max(2, size / 110);
    for (const u of g.units) {
      if (!u.alive || u.kind === 'hero') continue;
      if (!this.visible(u)) continue;
      const x = u.x * k, y = u.y * k;
      if (u.isBuilding) {
        const s = u.kind === 'ancient' ? dot * 3.2 : u.kind === 'fountain' ? dot * 2.2 : dot * 2;
        mc.fillStyle = '#0a0a0a';
        mc.fillRect(x - s / 2 - 1, y - s / 2 - 1, s + 2, s + 2);
        mc.fillStyle = TEAM_COLOR[u.team];
        mc.fillRect(x - s / 2, y - s / 2, s, s);
      } else if (u.isBoss) {
        const s = dot * 2.4;
        mc.fillStyle = '#0a0a0a';
        mc.beginPath(); mc.moveTo(x, y - s - 1); mc.lineTo(x + s + 1, y); mc.lineTo(x, y + s + 1); mc.lineTo(x - s - 1, y); mc.fill();
        mc.fillStyle = '#ffe27a';
        mc.beginPath(); mc.moveTo(x, y - s); mc.lineTo(x + s, y); mc.lineTo(x, y + s); mc.lineTo(x - s, y); mc.fill();
      } else {
        mc.fillStyle = u.team === NEUTRAL ? '#e6c35a' : TEAM_COLOR[u.team];
        mc.fillRect(x - dot / 2, y - dot / 2, dot, dot);
      }
    }
    for (const h of g.heroes) {
      if (!h.alive || !this.visible(h)) continue;
      const x = h.x * k, y = h.y * k, r = dot * 1.9;
      mc.fillStyle = h === g.player ? '#ffffff' : TEAM_COLOR[h.team];
      mc.beginPath(); mc.arc(x, y, r + 1.5, 0, TAU); mc.fill();
      mc.fillStyle = h.def.color;
      mc.beginPath(); mc.arc(x, y, r, 0, TAU); mc.fill();
    }
    const z = this.cam.zoom;
    mc.strokeStyle = 'rgba(255,255,255,0.85)';
    mc.lineWidth = 1.5;
    mc.strokeRect((this.cam.x - this.w / 2 / z) * k, (this.cam.y - this.h / 2 / z) * k, this.w / z * k, this.h / z * k);
  }
}
