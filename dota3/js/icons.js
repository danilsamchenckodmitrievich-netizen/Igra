'use strict';
// Процедурные иконки: способности, предметы, портреты героев.

const Icons = (() => {
  const cache = new Map();

  function path(ctx, pts, close) {
    ctx.beginPath();
    ctx.moveTo(pts[0], pts[1]);
    for (let i = 2; i < pts.length; i += 2) ctx.lineTo(pts[i], pts[i + 1]);
    if (close) ctx.closePath();
  }

  // Рисует глиф в квадрате [-50, 50]; ctx уже сдвинут и отмасштабирован.
  const G = {
    bolt(c) { path(c, [12, -46, -24, 6, -2, 6, -14, 46, 26, -10, 2, -10, 18, -46], true); c.fill(); },
    spiral(c) {
      c.beginPath();
      for (let i = 0; i <= 80; i++) {
        const t = i / 80, a = t * Math.PI * 4.2, r = 4 + t * 40;
        const x = Math.cos(a) * r, y = Math.sin(a) * r;
        if (i) c.lineTo(x, y); else c.moveTo(x, y);
      }
      c.stroke();
    },
    star(c) {
      c.beginPath();
      for (let i = 0; i < 16; i++) {
        const a = i / 16 * TAU - Math.PI / 2, r = i % 2 ? 16 : 46;
        c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      c.closePath(); c.fill();
    },
    blades(c) {
      for (const s of [1, -1]) {
        c.save(); c.scale(s, 1);
        path(c, [-34, 38, 30, -34]); c.stroke();
        path(c, [-38, 24, -22, 40]); c.stroke();
        path(c, [30, -34, 38, -42]); c.stroke();
        c.restore();
      }
    },
    orb(c) {
      c.beginPath(); c.arc(8, -8, 24, 0, TAU); c.fill();
      c.lineWidth = 7;
      path(c, [-8, 10, -40, 40]); c.stroke();
      path(c, [8, 16, -18, 44]); c.stroke();
      path(c, [-14, -4, -44, 18]); c.stroke();
    },
    pillar(c) {
      c.beginPath();
      c.moveTo(-18, 40);
      c.bezierCurveTo(-30, 0, -10, -10, -12, -44);
      c.bezierCurveTo(6, -20, 22, -26, 16, -46);
      c.bezierCurveTo(34, -10, 28, 10, 18, 40);
      c.closePath(); c.fill();
      c.beginPath(); c.ellipse(0, 40, 40, 8, 0, 0, TAU); c.stroke();
    },
    flame(c) {
      c.beginPath();
      c.moveTo(0, 46);
      c.bezierCurveTo(-40, 40, -34, 0, -10, -18);
      c.bezierCurveTo(-8, -2, 0, 0, 2, -46);
      c.bezierCurveTo(30, -20, 44, 20, 0, 46);
      c.closePath(); c.fill();
    },
    meteor(c) {
      c.beginPath(); c.arc(16, -16, 22, 0, TAU); c.fill();
      c.lineWidth = 8;
      path(c, [0, 2, -40, 42]); c.stroke();
      path(c, [-4, -16, -34, 14]); c.stroke();
      path(c, [16, 8, -12, 38]); c.stroke();
    },
    arrow(c) {
      path(c, [-40, 40, 34, -34]); c.stroke();
      path(c, [40, -40, 12, -34, 34, -12], true); c.fill();
      path(c, [-40, 40, -40, 22]); c.stroke();
      path(c, [-40, 40, -22, 40]); c.stroke();
    },
    shield(c) {
      c.beginPath();
      c.moveTo(0, -44); c.lineTo(36, -30); c.lineTo(32, 10);
      c.quadraticCurveTo(24, 34, 0, 46); c.quadraticCurveTo(-24, 34, -32, 10);
      c.lineTo(-36, -30); c.closePath(); c.fill();
    },
    snow(c) {
      for (let i = 0; i < 6; i++) {
        c.save(); c.rotate(i * Math.PI / 3);
        path(c, [0, 0, 0, -44]); c.stroke();
        path(c, [0, -26, -12, -38]); c.stroke();
        path(c, [0, -26, 12, -38]); c.stroke();
        c.restore();
      }
    },
    storm(c) {
      c.beginPath();
      c.arc(-16, -8, 18, 0, TAU); c.arc(8, -16, 22, 0, TAU); c.arc(26, -2, 16, 0, TAU);
      c.rect(-30, -4, 58, 16); c.fill();
      for (let i = 0; i < 4; i++) { path(c, [-26 + i * 16, 22, -32 + i * 16, 40]); c.stroke(); }
    },
    quake(c) {
      path(c, [-46, 20, 46, 20]); c.stroke();
      path(c, [0, 20, -8, 30, 4, 38, -4, 48]); c.stroke();
      path(c, [-24, 20, -32, 34]); c.stroke();
      path(c, [24, 20, 30, 34]); c.stroke();
      for (const a of [-2.4, -1.9, -1.57, -1.25, -0.75]) {
        path(c, [Math.cos(a) * 16, 6 + Math.sin(a) * 16, Math.cos(a) * 42, 6 + Math.sin(a) * 42]); c.stroke();
      }
    },
    armor(c) {
      c.beginPath();
      c.moveTo(-20, -40); c.lineTo(-40, -28); c.lineTo(-34, 4); c.lineTo(-24, 0); c.lineTo(-24, 40);
      c.lineTo(24, 40); c.lineTo(24, 0); c.lineTo(34, 4); c.lineTo(40, -28); c.lineTo(20, -40);
      c.quadraticCurveTo(0, -26, -20, -40); c.closePath(); c.fill();
    },
    spikes(c) {
      for (let i = 0; i < 5; i++) { const x = -40 + i * 20; path(c, [x - 9, 40, x, -30 + (i % 2) * 20, x + 9, 40], true); c.fill(); }
    },
    mountain(c) {
      path(c, [-46, 40, -12, -24, 6, 6, 18, -14, 46, 40], true); c.fill();
    },
    drop(c) {
      c.beginPath(); c.moveTo(0, -46);
      c.bezierCurveTo(16, -20, 34, 4, 30, 18); c.arc(0, 18, 30, 0, Math.PI); c.bezierCurveTo(-34, 4, -16, -20, 0, -46);
      c.fill();
    },
    eye(c) {
      c.beginPath(); c.moveTo(-46, 0); c.quadraticCurveTo(0, -40, 46, 0); c.quadraticCurveTo(0, 40, -46, 0); c.stroke();
      c.beginPath(); c.arc(0, 0, 14, 0, TAU); c.fill();
    },
    claws(c) {
      for (let i = -1; i <= 1; i++) {
        c.beginPath(); c.moveTo(-30 + i * 18, 40); c.quadraticCurveTo(-6 + i * 18, 0, 26 + i * 18, -40); c.stroke();
      }
    },
    target(c) {
      c.beginPath(); c.arc(0, 0, 30, 0, TAU); c.stroke();
      c.beginPath(); c.arc(0, 0, 10, 0, TAU); c.fill();
      for (const [a, b, x, y] of [[0, -46, 0, -22], [0, 46, 0, 22], [-46, 0, -22, 0], [46, 0, 22, 0]]) { path(c, [a, b, x, y]); c.stroke(); }
    },
    sun(c) {
      c.beginPath(); c.arc(0, 0, 18, 0, TAU); c.fill();
      for (let i = 0; i < 8; i++) {
        const a = i / 8 * TAU;
        path(c, [Math.cos(a) * 28, Math.sin(a) * 28, Math.cos(a) * 44, Math.sin(a) * 44]); c.stroke();
      }
    },
    burst(c) {
      c.beginPath();
      for (let i = 0; i < 24; i++) {
        const a = i / 24 * TAU, r = i % 2 ? 14 : (i % 4 ? 34 : 48);
        c.lineTo(Math.cos(a) * r, Math.sin(a) * r);
      }
      c.closePath(); c.fill();
    },
    halo(c) {
      c.beginPath(); c.ellipse(0, -30, 30, 9, 0, 0, TAU); c.stroke();
      c.beginPath(); c.arc(0, 0, 13, 0, TAU); c.fill();
      c.beginPath(); c.moveTo(-24, 46); c.quadraticCurveTo(0, 6, 24, 46); c.fill();
    },
    wings(c) {
      for (const s of [1, -1]) {
        c.save(); c.scale(s, 1);
        for (let i = 0; i < 3; i++) {
          c.beginPath(); c.moveTo(6, 10 - i * 4); c.quadraticCurveTo(30 + i * 4, -36 + i * 16, 46, -40 + i * 26); c.stroke();
        }
        c.restore();
      }
      c.beginPath(); c.arc(0, 14, 10, 0, TAU); c.fill();
    },
    potion(c) {
      c.beginPath(); c.arc(0, 14, 28, 0, TAU); c.fill();
      c.fillRect(-9, -36, 18, 26);
      c.fillRect(-14, -44, 28, 10);
    },
    scroll(c) {
      c.fillRect(-28, -30, 56, 60);
      c.beginPath(); c.arc(-28, -30, 10, 0, TAU); c.arc(28, -30, 10, 0, TAU); c.fill();
      c.beginPath(); c.arc(-28, 30, 10, 0, TAU); c.arc(28, 30, 10, 0, TAU); c.fill();
    },
    boots(c) {
      path(c, [-22, -44, 10, -44, 10, 14, 44, 22, 44, 42, -22, 42], true); c.fill();
    },
    ring(c) {
      c.beginPath(); c.arc(0, 10, 28, 0, TAU); c.stroke();
      path(c, [0, -46, 16, -26, 0, -14, -16, -26], true); c.fill();
    },
    gem(c) {
      path(c, [0, -44, 34, -12, 0, 44, -34, -12], true); c.fill();
    },
    glove(c) {
      c.fillRect(-26, -6, 52, 46);
      for (let i = 0; i < 4; i++) c.fillRect(-26 + i * 14, -42, 10, 40);
      c.save(); c.rotate(-0.6); c.fillRect(-46, 6, 26, 12); c.restore();
    },
    mail(c) {
      path(c, [-20, -40, -46, -24, -36, 0, -26, -6, -26, 42, 26, 42, 26, -6, 36, 0, 46, -24, 20, -40], true); c.fill();
    },
    belt(c) {
      c.fillRect(-46, -12, 92, 24);
      c.lineWidth = 7;
      c.strokeRect(-14, -20, 28, 40);
      c.fillStyle = 'rgba(10,12,16,0.85)';
      c.fillRect(-10, -16, 20, 32);
    },
    sword(c) {
      path(c, [0, -46, 9, -34, 9, 20, -9, 20, -9, -34], true); c.fill();
      c.fillRect(-24, 20, 48, 8);
      c.fillRect(-5, 28, 10, 18);
    },
    dagger(c) {
      c.save(); c.rotate(Math.PI / 4);
      path(c, [0, -44, 9, -24, 9, 8, -9, 8, -9, -24], true); c.fill();
      c.fillRect(-20, 8, 40, 7); c.fillRect(-5, 15, 10, 22);
      c.restore();
      path(c, [-44, -10, -26, -10]); c.stroke();
      path(c, [-40, 6, -24, 6]); c.stroke();
    },
    staff(c) {
      path(c, [-36, 44, 20, -18]); c.stroke();
      c.beginPath(); c.arc(26, -26, 16, 0, TAU); c.fill();
    },
    blade(c) {
      c.beginPath(); c.moveTo(-30, 34); c.quadraticCurveTo(-10, -30, 40, -44); c.quadraticCurveTo(10, -14, -18, 40); c.closePath(); c.fill();
      c.fillRect(-40, 28, 26, 8);
    },
    bow(c) {
      c.beginPath(); c.arc(-30, 0, 46, -1.1, 1.1); c.stroke();
      c.lineWidth = 3;
      path(c, [-9, -41, -9, 41]); c.stroke();
      c.lineWidth = 6;
      path(c, [-30, 0, 44, 0]); c.stroke();
      path(c, [46, 0, 34, -8, 34, 8], true); c.fill();
    },
    heart(c) {
      c.beginPath(); c.moveTo(0, 42);
      c.bezierCurveTo(-60, 0, -30, -50, 0, -18); c.bezierCurveTo(30, -50, 60, 0, 0, 42); c.fill();
    },
  };

  function glyph(ctx, name, cx, cy, size, color) {
    const f = G[name];
    if (!f) return;
    ctx.save();
    ctx.translate(cx, cy);
    ctx.scale(size / 100, size / 100);
    ctx.fillStyle = color; ctx.strokeStyle = color;
    ctx.lineWidth = 8; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    f(ctx);
    ctx.restore();
  }

  function tile(key, size, draw) {
    const k = key + '@' + size;
    if (cache.has(k)) return cache.get(k);
    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    draw(cv.getContext('2d'), size);
    cache.set(k, cv);
    return cv;
  }

  function ability(def, size) {
    return tile('ab:' + def.id, size, (c, s) => {
      const g = c.createRadialGradient(s * 0.35, s * 0.3, s * 0.05, s * 0.5, s * 0.5, s * 0.75);
      g.addColorStop(0, def.icon.c2);
      g.addColorStop(1, '#0b0d12');
      c.fillStyle = g; c.fillRect(0, 0, s, s);
      c.shadowColor = def.icon.c1; c.shadowBlur = s * 0.12;
      glyph(c, def.icon.g, s / 2, s / 2, s * 0.62, def.icon.c1);
    });
  }

  function item(def, size) {
    return tile('it:' + def.id, size, (c, s) => {
      const g = c.createLinearGradient(0, 0, 0, s);
      g.addColorStop(0, '#2a2f38'); g.addColorStop(1, '#14171d');
      c.fillStyle = g; c.fillRect(0, 0, s, s);
      c.shadowColor = def.color; c.shadowBlur = s * 0.1;
      glyph(c, def.glyph, s / 2, s / 2, s * 0.6, def.color);
    });
  }

  function hero(def, size) {
    return tile('hero:' + def.id, size, (c, s) => {
      const g = c.createRadialGradient(s * 0.5, s * 0.35, s * 0.05, s * 0.5, s * 0.5, s * 0.72);
      g.addColorStop(0, def.color2); g.addColorStop(1, '#090b10');
      c.fillStyle = g; c.fillRect(0, 0, s, s);
      c.shadowColor = def.color; c.shadowBlur = s * 0.15;
      glyph(c, def.glyph, s / 2, s / 2, s * 0.58, def.color);
    });
  }

  return { glyph, ability, item, hero };
})();
