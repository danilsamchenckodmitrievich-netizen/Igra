'use strict';
// Способности героев и активные эффекты предметов.

function enemiesInRadius(g, team, x, y, r, opts) {
  const out = [];
  for (const u of g.units) {
    if (!u.alive || u.team === team || u.s.invuln || u.kind === 'fountain') continue;
    if (u.isBuilding && !(opts && opts.buildings)) continue;
    if (opts && opts.heroesOnly && u.kind !== 'hero') continue;
    if (dist(x, y, u.x, u.y) <= r + u.radius) out.push(u);
  }
  return out;
}
function alliesInRadius(g, team, x, y, r, heroesOnly) {
  const out = [];
  for (const u of g.units) {
    if (!u.alive || u.team !== team || u.isBuilding || u.kind === 'fountain') continue;
    if (heroesOnly && u.kind !== 'hero') continue;
    if (dist(x, y, u.x, u.y) <= r + u.radius) out.push(u);
  }
  return out;
}
function enemiesAlongSegment(g, team, x0, y0, x1, y1, w) {
  const out = [];
  for (const u of g.units) {
    if (!u.alive || u.team === team || u.s.invuln || u.isBuilding || u.kind === 'fountain') continue;
    if (distToSegment(u.x, u.y, x0, y0, x1, y1) <= w + u.radius) out.push(u);
  }
  return out;
}
const magicDamageAll = (g, src, list, dmg) => { for (const u of list) dealDamage(g, src, u, dmg, 'magic'); };

// --- помощники ИИ для способностей ---
function aiHeroInRange(ctx, h, range) {
  let best = null, bs = Infinity;
  for (const e of ctx.enemyHeroes) {
    if (e.s.magicImmune) continue;
    const d = gapU(h, e);
    if (d > range) continue;
    const s = e.hp / e.s.maxHp * 100 + d / 20 + (e === ctx.focus ? -30 : 0);
    if (s < bs) { bs = s; best = e; }
  }
  return best;
}
function aiPredict(u, t) {
  if (!u.moving) return { x: u.x, y: u.y };
  return { x: u.x + Math.cos(u.facing) * u.s.speed * t, y: u.y + Math.sin(u.facing) * u.s.speed * t };
}
// Лучшая точка для площадной способности: центрируемся на враге с наибольшим числом соседей.
function aiBestAoe(g, h, ctx, range, radius, minHeroes, minCreeps) {
  let best = null, bestScore = 0;
  const cands = ctx.enemyHeroes.concat(ctx.enemyCreeps);
  for (const c of cands) {
    if (dist(h.x, h.y, c.x, c.y) > range + radius * 0.5) continue;
    let heroes = 0, creeps = 0;
    for (const e of ctx.enemyHeroes) if (dist(c.x, c.y, e.x, e.y) <= radius) heroes++;
    for (const e of ctx.enemyCreeps) if (dist(c.x, c.y, e.x, e.y) <= radius) creeps++;
    const ok = (minHeroes > 0 && heroes >= minHeroes) || (minCreeps > 0 && creeps >= minCreeps);
    if (!ok) continue;
    const score = heroes * 10 + creeps;
    if (score > bestScore) { bestScore = score; best = c; }
  }
  if (!best) return null;
  const p = best.kind === 'hero' ? aiPredict(best, 0.4) : { x: best.x, y: best.y };
  return { x: p.x, y: p.y };
}
function aiEscapePoint(g, h, len) {
  const f = g.map.bases[h.team].fountain;
  const d = dist(h.x, h.y, f.x, f.y) || 1;
  return { x: h.x + (f.x - h.x) / d * len, y: h.y + (f.y - h.y) / d * len };
}

const ABILITIES = {
  // ======== Громовой Клинок ========
  thunder_dash: {
    name: 'Рывок молнии', type: 'point', range: 650, clamp: true, cd: [12, 11, 10, 9], mana: [90, 100, 110, 120], maxLv: 4,
    icon: { g: 'bolt', c1: '#7fd8ff', c2: '#174a8a' }, castPoint: 0.1,
    desc: 'Превращается в молнию и проносится к точке, нанося магический урон всем врагам на пути.',
    stats: [['Урон', [75, 150, 225, 300]], ['Дальность', [650]]],
    cast(g, h, lv, t) {
      const end = g.map.nearestFree(t.x, t.y);
      const hits = enemiesAlongSegment(g, h.team, h.x, h.y, end.x, end.y, 110);
      magicDamageAll(g, h, hits, [75, 150, 225, 300][lv - 1]);
      g.fx('beam', { x1: h.x, y1: h.y, x2: end.x, y2: end.y, color: '#8fe3ff', width: 16, dur: 0.4 });
      g.dash(h, end.x, end.y, 2200, '#8fe3ff');
      g.sound('zap', h);
    },
    ai(g, h, lv, ctx, escaping) {
      if (escaping) {
        if (!ctx.enemyHeroes.length) return null;
        return aiEscapePoint(g, h, 650);
      }
      const t = ctx.focus;
      if (t && dist(h.x, h.y, t.x, t.y) < 650 && dist(h.x, h.y, t.x, t.y) > 180) return { x: t.x, y: t.y };
      return null;
    },
  },
  thunder_whirl: {
    name: 'Вихрь', type: 'none', radius: 260, cd: [10, 9, 8, 7], mana: [80, 90, 100, 110], maxLv: 4,
    icon: { g: 'spiral', c1: '#cfefff', c2: '#2a5f9e' }, castPoint: 0.05,
    desc: 'Раскручивает клинок, нанося физический урон врагам вокруг и замедляя их на 25% на 2 сек.',
    stats: [['Урон', [80, 130, 180, 230]], ['Радиус', [260]]],
    cast(g, h, lv) {
      const hits = enemiesInRadius(g, h.team, h.x, h.y, 260);
      for (const u of hits) {
        dealDamage(g, h, u, [80, 130, 180, 230][lv - 1], 'phys');
        addBuff(u, 'whirl', 2, { slow: 0.25 }, h);
      }
      g.fx('spin', { x: h.x, y: h.y, r: 260, color: '#bfeaff', dur: 0.45, follow: h });
      g.sound('swoosh', h);
    },
    ai(g, h, lv, ctx) {
      let heroes = 0, creeps = 0;
      for (const e of ctx.enemyHeroes) if (dist(h.x, h.y, e.x, e.y) < 250) heroes++;
      for (const e of ctx.enemyCreeps) if (dist(h.x, h.y, e.x, e.y) < 250) creeps++;
      if (heroes >= 1 || (creeps >= 3 && ctx.manaPct > 0.55)) return { x: h.x, y: h.y };
      return null;
    },
  },
  thunder_crit: {
    name: 'Громовой удар', type: 'passive', cd: 0, mana: 0, maxLv: 4,
    icon: { g: 'star', c1: '#ffe27a', c2: '#2b5e9a' },
    desc: 'С вероятностью 20% атака наносит критический урон.',
    stats: [['Множитель', [160, 180, 200, 220], '%']],
    passiveStats(a, lv) { a.critP = 0.2; a.critPMult = [1.6, 1.8, 2.0, 2.2][lv - 1]; },
  },
  thunder_storm: {
    name: 'Буря клинков', type: 'unit', range: 450, cd: [100, 85, 70], mana: [200, 275, 350], maxLv: 3, ult: true,
    icon: { g: 'blades', c1: '#e8f7ff', c2: '#1d3f7a' }, castPoint: 0.15,
    desc: 'Становится неуязвимым и молнией перескакивает между врагами рядом с целью, нанося удары с бонусным уроном.',
    stats: [['Удары', [3, 5, 7]], ['Бонус к удару', [90, 120, 150]]],
    cast(g, h, lv, t) {
      let hits = [3, 5, 7][lv - 1];
      let first = t.unit;
      let timer = 0;
      addBuff(h, 'storm', 10, { invuln: true }, h);
      g.sound('zap', h);
      h.busy = {
        noCollide: true, kind: 'storm',
        update: dt => {
          timer -= dt;
          if (timer > 0) return false;
          let tgt = null;
          if (first && first.alive && !first.s.invuln) tgt = first;
          first = null;
          if (!tgt) {
            const near = enemiesInRadius(g, h.team, h.x, h.y, 600).filter(u => u.visibleTo[h.team]);
            const heroes = near.filter(u => u.kind === 'hero');
            const pool = heroes.length ? heroes : near;
            tgt = pool.length ? choice(pool) : null;
          }
          if (!tgt || hits <= 0) { removeBuff(h, 'storm'); return true; }
          const a = Math.random() * TAU;
          const p = g.map.nearestFree(tgt.x + Math.cos(a) * (tgt.radius + h.radius + 6), tgt.y + Math.sin(a) * (tgt.radius + h.radius + 6));
          g.fx('beam', { x1: h.x, y1: h.y, x2: p.x, y2: p.y, color: '#bfeaff', width: 10, dur: 0.3 });
          h.x = p.x; h.y = p.y;
          h.facing = angleTo(h, tgt);
          h.attackAnim = 1;
          dealDamage(g, h, tgt, h.s.damage + [90, 120, 150][lv - 1], 'phys');
          g.fx('slash', { x: h.x, y: h.y, a: h.facing, r: 60, color: '#e8f7ff', dur: 0.2 });
          g.burst(tgt.x, tgt.y, '#bfeaff', 10, 160, 0.4, 3, true);
          g.sound('hit', h);
          hits--;
          timer = 0.3;
          return false;
        },
      };
    },
    ai(g, h, lv, ctx) {
      const t = aiHeroInRange(ctx, h, 450);
      if (!t) return null;
      if (t.hp / t.s.maxHp < 0.65 || ctx.enemyHeroes.length >= 2) return { unit: t };
      return null;
    },
  },

  // ======== Пиромант ========
  pyro_fireball: {
    name: 'Огненный шар', type: 'point', range: 950, clamp: true, cd: [9, 8, 7, 6], mana: [100, 115, 130, 145], maxLv: 4,
    icon: { g: 'orb', c1: '#ffd36b', c2: '#9a2a0c' }, castPoint: 0.25, radius: 200,
    desc: 'Выпускает огненный шар, который взрывается при попадании во врага или в конце пути, поражая всех вокруг.',
    stats: [['Урон', [90, 160, 230, 300]], ['Радиус взрыва', [200]]],
    cast(g, h, lv, t) {
      const a = Math.atan2(t.y - h.y, t.x - h.x);
      const dmg = [90, 160, 230, 300][lv - 1];
      const explode = (x, y) => {
        magicDamageAll(g, h, enemiesInRadius(g, h.team, x, y, 200), dmg);
        g.fx('ring', { x, y, r0: 20, r1: 200, color: '#ffae4a', width: 10, dur: 0.4 });
        g.fx('circle', { x, y, r: 180, color: 'rgba(255,140,40,0.35)', dur: 0.35 });
        g.burst(x, y, '#ff9a3a', 26, 260, 0.6, 4, true);
        g.sound('boom', { x, y });
      };
      g.skillshot(h, a, 1100, 950, 55, { color: '#ffb347', size: 16, trail: '#ff6a1a' }, u => { explode(u.x, u.y); return true; }, explode);
      g.sound('fire', h);
    },
    ai(g, h, lv, ctx) {
      const t = aiHeroInRange(ctx, h, 900);
      if (t) { const p = aiPredict(t, dist(h.x, h.y, t.x, t.y) / 1100); return p; }
      if (ctx.manaPct > 0.6 && !ctx.enemyHeroes.length) return aiBestAoe(g, h, ctx, 800, 200, 0, 4);
      return null;
    },
  },
  pyro_pillar: {
    name: 'Огненный столп', type: 'point', range: 700, cd: [12, 11, 10, 9], mana: [100, 110, 120, 130], maxLv: 4,
    icon: { g: 'pillar', c1: '#ffdf8a', c2: '#a8360f' }, castPoint: 0.3, radius: 220,
    desc: 'Через 0.6 сек. из земли вырывается столп пламени, нанося урон и оглушая врагов.',
    stats: [['Урон', [80, 140, 200, 260]], ['Оглушение', [1.4, 1.7, 2.0, 2.3], ' с']],
    cast(g, h, lv, t) {
      g.fx('warn', { x: t.x, y: t.y, r: 220, color: '#ff8a3d', dur: 0.6 });
      g.later(0.6, () => {
        for (const u of enemiesInRadius(g, h.team, t.x, t.y, 220)) {
          dealDamage(g, h, u, [80, 140, 200, 260][lv - 1], 'magic');
          addBuff(u, 'stun', [1.4, 1.7, 2.0, 2.3][lv - 1], { stun: true }, h);
        }
        g.fx('pillar', { x: t.x, y: t.y, r: 220, color: '#ff8a3d', dur: 0.7 });
        g.burst(t.x, t.y, '#ffcc66', 30, 220, 0.8, 4, true);
        g.sound('boom', t);
      });
    },
    ai(g, h, lv, ctx) {
      const t = aiHeroInRange(ctx, h, 720);
      if (t && !t.s.stunned) return aiPredict(t, 0.45);
      if (ctx.manaPct > 0.75 && !ctx.enemyHeroes.length) return aiBestAoe(g, h, ctx, 700, 220, 0, 4);
      return null;
    },
  },
  pyro_ember: {
    name: 'Тлеющее пламя', type: 'passive', cd: 0, mana: 0, maxLv: 4,
    icon: { g: 'flame', c1: '#ffcf5a', c2: '#8a240c' },
    desc: 'Атаки поджигают цель на 3 сек., нанося магический урон каждую секунду.',
    stats: [['Урон в сек.', [8, 14, 20, 26]]],
    onHit(g, h, t, lv) { addBuff(t, 'ember' + h.id, 3, { dps: [8, 14, 20, 26][lv - 1], dmgType: 'magic', burn: true }, h); },
  },
  pyro_meteor: {
    name: 'Метеорит', type: 'point', range: 900, cd: [90, 80, 70], mana: [250, 350, 450], maxLv: 3, ult: true,
    icon: { g: 'meteor', c1: '#ffe08a', c2: '#7a1a08' }, castPoint: 0.35, radius: 320,
    desc: 'Призывает метеорит. Через 1.3 сек. он падает, нанося огромный урон и оглушая врагов на 1 сек.',
    stats: [['Урон', [280, 420, 560]], ['Радиус', [320]]],
    cast(g, h, lv, t) {
      g.fx('warn', { x: t.x, y: t.y, r: 320, color: '#ff5a2a', dur: 1.3 });
      g.fx('meteor', { x: t.x, y: t.y, dur: 1.3 });
      g.later(1.3, () => {
        for (const u of enemiesInRadius(g, h.team, t.x, t.y, 320)) {
          dealDamage(g, h, u, [280, 420, 560][lv - 1], 'magic');
          addBuff(u, 'stun', 1, { stun: true }, h);
        }
        g.fx('ring', { x: t.x, y: t.y, r0: 40, r1: 360, color: '#ff7a2a', width: 16, dur: 0.6 });
        g.fx('circle', { x: t.x, y: t.y, r: 320, color: 'rgba(255,90,30,0.4)', dur: 0.6 });
        g.burst(t.x, t.y, '#ff8a3a', 60, 420, 1.0, 5, true);
        g.burst(t.x, t.y, '#5a4a40', 30, 200, 1.4, 6, false);
        g.shake(14);
        g.sound('bigboom', t);
      });
    },
    ai(g, h, lv, ctx) {
      const p = aiBestAoe(g, h, ctx, 900, 300, 2, 0);
      if (p) return p;
      const t = aiHeroInRange(ctx, h, 900);
      if (t && (t.s.stunned || t.s.slow > 0.25 || t.hp / t.s.maxHp < 0.5)) return { x: t.x, y: t.y };
      return null;
    },
  },

  // ======== Ледяная Ведьма ========
  frost_bolt: {
    name: 'Ледяная стрела', type: 'unit', range: 700, cd: [8, 7, 6, 5], mana: [90, 100, 110, 120], maxLv: 4,
    icon: { g: 'arrow', c1: '#dff6ff', c2: '#2d6ea8' }, castPoint: 0.25,
    desc: 'Выпускает ледяную стрелу, которая наносит магический урон и замедляет цель на 3 сек.',
    stats: [['Урон', [70, 130, 190, 250]], ['Замедление', [30, 35, 40, 45], '%']],
    cast(g, h, lv, t) {
      g.homing(h, t.unit, 1000, { color: '#bfefff', size: 9, trail: '#7fd6ff' }, u => {
        dealDamage(g, h, u, [70, 130, 190, 250][lv - 1], 'magic');
        addBuff(u, 'frostbolt', 3, { slow: [0.3, 0.35, 0.4, 0.45][lv - 1], chill: true }, h);
        g.burst(u.x, u.y, '#cdf3ff', 14, 160, 0.5, 3, true);
      });
      g.sound('ice', h);
    },
    ai(g, h, lv, ctx) {
      const t = aiHeroInRange(ctx, h, 720);
      return t ? { unit: t } : null;
    },
  },
  frost_shield: {
    name: 'Ледяной щит', type: 'unit', target: 'ally', range: 650, cd: [14, 12, 10, 8], mana: [90, 100, 110, 120], maxLv: 4,
    icon: { g: 'shield', c1: '#e6fbff', c2: '#3a7fb5' }, castPoint: 0.2,
    desc: 'Окутывает союзника ледяным щитом на 10 сек.: он поглощает урон и даёт дополнительную броню.',
    stats: [['Поглощение', [100, 180, 260, 340]], ['Броня', [3, 4, 5, 6]]],
    cast(g, h, lv, t) {
      addBuff(t.unit, 'iceshield', 10, { shield: [100, 180, 260, 340][lv - 1], armor: [3, 4, 5, 6][lv - 1], iceShield: true }, h);
      g.burst(t.unit.x, t.unit.y, '#dff6ff', 16, 120, 0.5, 3, true);
      g.sound('ice', t.unit);
    },
    ai(g, h, lv, ctx) {
      let best = null, bp = 0.7;
      for (const a of ctx.allyHeroes) {
        if (dist(h.x, h.y, a.x, a.y) > 650 || findBuff(a, 'iceshield')) continue;
        const p = a.hp / a.s.maxHp;
        if (p < bp && (ctx.enemyHeroes.length || g.time - (a.lastHurtT || -99) < 2)) { bp = p; best = a; }
      }
      return best ? { unit: best } : null;
    },
  },
  frost_chill: {
    name: 'Морозное касание', type: 'passive', cd: 0, mana: 0, maxLv: 4,
    icon: { g: 'snow', c1: '#f0fcff', c2: '#3d79a8' },
    desc: 'Атаки замораживают цель, замедляя её на 1.5 сек.',
    stats: [['Замедление', [15, 20, 25, 30], '%']],
    onHit(g, h, t, lv) { addBuff(t, 'chill', 1.5, { slow: [0.15, 0.2, 0.25, 0.3][lv - 1], chill: true }, h); },
  },
  frost_winter: {
    name: 'Вечная зима', type: 'point', range: 700, cd: [100, 85, 70], mana: [250, 325, 400], maxLv: 3, ult: true,
    icon: { g: 'storm', c1: '#ffffff', c2: '#2a5a8a' }, castPoint: 0.3, radius: 450,
    desc: 'Призывает снежную бурю на 4 сек. Враги внутри получают магический урон и замедляются на 50%.',
    stats: [['Урон в сек.', [60, 90, 120]], ['Радиус', [450]]],
    cast(g, h, lv, t) {
      const dmg = [30, 45, 60][lv - 1];
      g.zone({
        x: t.x, y: t.y, r: 450, team: h.team, src: h, dur: 4, interval: 0.5, kind: 'blizzard',
        onTick: z => {
          for (const u of enemiesInRadius(g, h.team, z.x, z.y, z.r)) {
            dealDamage(g, h, u, dmg, 'magic');
            addBuff(u, 'winter', 0.7, { slow: 0.5, chill: true }, h);
          }
        },
      });
      g.sound('ice', t);
    },
    ai(g, h, lv, ctx) {
      const p = aiBestAoe(g, h, ctx, 700, 400, 2, 0);
      if (p) return p;
      const t = aiHeroInRange(ctx, h, 700);
      if (t && t.hp / t.s.maxHp < 0.45) return { x: t.x, y: t.y };
      return null;
    },
  },

  // ======== Каменный Титан ========
  titan_slam: {
    name: 'Удар о землю', type: 'none', radius: 300, cd: [13, 12, 11, 10], mana: [100, 110, 120, 130], maxLv: 4,
    icon: { g: 'quake', c1: '#ffd9a0', c2: '#6b4420' }, castPoint: 0.3,
    desc: 'Бьёт по земле, нанося магический урон и оглушая всех врагов вокруг.',
    stats: [['Урон', [80, 130, 180, 230]], ['Оглушение', [1.2, 1.4, 1.6, 1.8], ' с']],
    cast(g, h, lv) {
      for (const u of enemiesInRadius(g, h.team, h.x, h.y, 300)) {
        dealDamage(g, h, u, [80, 130, 180, 230][lv - 1], 'magic');
        addBuff(u, 'stun', [1.2, 1.4, 1.6, 1.8][lv - 1], { stun: true }, h);
      }
      g.fx('ring', { x: h.x, y: h.y, r0: 30, r1: 300, color: '#e0b070', width: 14, dur: 0.45 });
      g.fx('cracks', { x: h.x, y: h.y, r: 300, dur: 1.2 });
      g.burst(h.x, h.y, '#8a6a48', 30, 260, 0.8, 5, false);
      g.shake(8);
      g.sound('boom', h);
    },
    ai(g, h, lv, ctx) {
      let heroes = 0, creeps = 0;
      for (const e of ctx.enemyHeroes) if (dist(h.x, h.y, e.x, e.y) < 280 && !e.s.stunned) heroes++;
      for (const e of ctx.enemyCreeps) if (dist(h.x, h.y, e.x, e.y) < 280) creeps++;
      if (heroes >= 1 || (creeps >= 4 && ctx.manaPct > 0.6)) return { x: h.x, y: h.y };
      return null;
    },
  },
  titan_skin: {
    name: 'Каменная кожа', type: 'none', cd: [18, 16, 14, 12], mana: [60, 60, 60, 60], maxLv: 4,
    icon: { g: 'armor', c1: '#d8c0a0', c2: '#5a3a1c' }, castPoint: 0,
    desc: 'Покрывается камнем на 6 сек., получая дополнительную броню и восстановление здоровья.',
    stats: [['Броня', [8, 12, 16, 20]], ['Восст. здоровья', [10, 15, 20, 25]]],
    cast(g, h, lv) {
      addBuff(h, 'skin', 6, { armor: [8, 12, 16, 20][lv - 1], hpRegen: [10, 15, 20, 25][lv - 1], stoneSkin: true }, h);
      g.burst(h.x, h.y, '#b89a70', 14, 120, 0.5, 4, false);
      g.sound('stone', h);
    },
    ai(g, h, lv, ctx) {
      if ((ctx.enemyHeroes.length && ctx.hpPct < 0.8) || (ctx.towerTarget && ctx.hpPct < 0.7)) return { x: h.x, y: h.y };
      return null;
    },
  },
  titan_thorns: {
    name: 'Шипы', type: 'passive', cd: 0, mana: 0, maxLv: 4,
    icon: { g: 'spikes', c1: '#e9c48c', c2: '#5c3b1a' },
    desc: 'Возвращает атакующим часть полученного от атак урона.',
    stats: [['Возврат', [15, 20, 25, 30], '%']],
    passiveStats(a, lv) { a.thorns = [0.15, 0.2, 0.25, 0.3][lv - 1]; },
  },
  titan_leap: {
    name: 'Падение горы', type: 'point', range: 750, clamp: true, cd: [90, 80, 70], mana: [200, 250, 300], maxLv: 3, ult: true,
    icon: { g: 'mountain', c1: '#ffe0b0', c2: '#5a3a1a' }, castPoint: 0.2, radius: 350,
    desc: 'Взмывает в воздух и обрушивается на землю, нанося магический урон и оглушая врагов в области.',
    stats: [['Урон', [200, 300, 400]], ['Оглушение', [1.5, 2.0, 2.5], ' с']],
    cast(g, h, lv, t) {
      const end = g.map.nearestFree(t.x, t.y);
      g.fx('warn', { x: end.x, y: end.y, r: 350, color: '#e0a060', dur: 0.65 });
      g.leap(h, end.x, end.y, 0.65, 160, () => {
        for (const u of enemiesInRadius(g, h.team, h.x, h.y, 350)) {
          dealDamage(g, h, u, [200, 300, 400][lv - 1], 'magic');
          addBuff(u, 'stun', [1.5, 2.0, 2.5][lv - 1], { stun: true }, h);
        }
        g.fx('ring', { x: h.x, y: h.y, r0: 40, r1: 380, color: '#f0c080', width: 18, dur: 0.6 });
        g.fx('cracks', { x: h.x, y: h.y, r: 350, dur: 1.6 });
        g.burst(h.x, h.y, '#8a6a48', 50, 340, 1.0, 6, false);
        g.shake(16);
        g.sound('bigboom', h);
      });
    },
    ai(g, h, lv, ctx) {
      const p = aiBestAoe(g, h, ctx, 750, 320, 2, 0);
      if (p) return p;
      const t = ctx.focus;
      if (t && dist(h.x, h.y, t.x, t.y) < 750 && !t.s.stunned) return aiPredict(t, 0.6);
      return null;
    },
  },

  // ======== Теневой Охотник ========
  shadow_poison: {
    name: 'Ядовитая стрела', type: 'unit', range: 800, cd: [10, 9, 8, 7], mana: [80, 90, 100, 110], maxLv: 4,
    icon: { g: 'drop', c1: '#b6ff7a', c2: '#3a5e1a' }, castPoint: 0.2,
    desc: 'Стрела с ядом: мгновенный урон, затем урон каждую секунду в течение 5 сек. и замедление на 20%.',
    stats: [['Урон', [40, 60, 80, 100]], ['Урон в сек.', [20, 30, 40, 50]]],
    cast(g, h, lv, t) {
      g.homing(h, t.unit, 1200, { color: '#a6ff6a', size: 8, trail: '#5ab83a' }, u => {
        dealDamage(g, h, u, [40, 60, 80, 100][lv - 1], 'magic');
        addBuff(u, 'poison', 5, { dps: [20, 30, 40, 50][lv - 1], dmgType: 'magic', slow: 0.2, poison: true }, h);
      });
      g.sound('shoot', h);
    },
    ai(g, h, lv, ctx) {
      const t = aiHeroInRange(ctx, h, 820);
      return t ? { unit: t } : null;
    },
  },
  shadow_veil: {
    name: 'Шаг в тень', type: 'none', cd: [20, 18, 16, 14], mana: [75, 75, 75, 75], maxLv: 4, keepInvis: true,
    icon: { g: 'eye', c1: '#d6c2ff', c2: '#2c1650' }, castPoint: 0,
    desc: 'Становится невидимым на 15 сек. и получает +20% к скорости. Следующая атака наносит бонусный урон и снимает невидимость.',
    stats: [['Бонус к атаке', [50, 100, 150, 200]]],
    cast(g, h, lv) {
      addBuff(h, 'veil', 15, { invis: true, msPct: 0.2, bonus: [50, 100, 150, 200][lv - 1] }, h);
      g.burst(h.x, h.y, '#6a4aa8', 20, 120, 0.6, 5, false);
      g.sound('veil', h);
    },
    ai(g, h, lv, ctx, escaping) {
      if (findBuff(h, 'veil')) return null;
      if (escaping && ctx.enemyHeroes.length) return { x: h.x, y: h.y };
      const t = ctx.focus;
      if (t && !escaping && dist(h.x, h.y, t.x, t.y) > 700 && t.hp / t.s.maxHp < 0.5) return { x: h.x, y: h.y };
      return null;
    },
  },
  shadow_instinct: {
    name: 'Инстинкт охотника', type: 'passive', cd: 0, mana: 0, maxLv: 4,
    icon: { g: 'claws', c1: '#e2d2ff', c2: '#40206a' },
    desc: 'Увеличивает скорость атаки.',
    stats: [['Скорость атаки', [10, 20, 30, 40], '%']],
    passiveStats(a, lv) { a.as += [10, 20, 30, 40][lv - 1]; },
  },
  shadow_mark: {
    name: 'Метка смерти', type: 'unit', range: 800, cd: [80, 70, 60], mana: [150, 200, 250], maxLv: 3, ult: true,
    icon: { g: 'target', c1: '#ff9a9a', c2: '#4a1020' }, castPoint: 0.2,
    desc: 'Метит врага на 8 сек.: он получает больше урона от всех источников и виден врагам.',
    stats: [['Доп. урон', [20, 30, 40], '%']],
    cast(g, h, lv, t) {
      addBuff(t.unit, 'mark', 8, { dmgAmp: [0.2, 0.3, 0.4][lv - 1], reveal: true, marked: true }, h);
      g.fx('ring', { x: t.unit.x, y: t.unit.y, r0: 80, r1: 20, color: '#ff5a6a', width: 5, dur: 0.5 });
      g.sound('mark', t.unit);
    },
    ai(g, h, lv, ctx) {
      const t = aiHeroInRange(ctx, h, 800);
      if (t && t.hp / t.s.maxHp > 0.25 && !findBuff(t, 'mark')) return { unit: t };
      return null;
    },
  },

  // ======== Жрица Рассвета ========
  priest_light: {
    name: 'Святой свет', type: 'unit', target: 'any', range: 700, cd: [9, 8, 7, 6], mana: [100, 115, 130, 145], maxLv: 4,
    icon: { g: 'sun', c1: '#fff3b0', c2: '#9a6a10' }, castPoint: 0.25, blockedByImmune: true,
    desc: 'Луч света исцеляет союзника или наносит магический урон врагу.',
    stats: [['Лечение', [100, 170, 240, 310]], ['Урон', [80, 140, 200, 260]]],
    cast(g, h, lv, t) {
      const u = t.unit;
      g.fx('beam', { x1: h.x, y1: h.y, x2: u.x, y2: u.y, color: '#ffe680', width: 10, dur: 0.35 });
      if (u.team === h.team) healUnit(g, u, [100, 170, 240, 310][lv - 1], h);
      else dealDamage(g, h, u, [80, 140, 200, 260][lv - 1], 'magic');
      g.burst(u.x, u.y, '#fff0a0', 16, 140, 0.6, 3, true);
      g.sound('holy', u);
    },
    ai(g, h, lv, ctx) {
      let best = null, bp = 0.6;
      for (const a of ctx.allyHeroes) {
        if (dist(h.x, h.y, a.x, a.y) > 720) continue;
        const p = a.hp / a.s.maxHp;
        if (p < bp) { bp = p; best = a; }
      }
      if (best) return { unit: best };
      if (ctx.manaPct > 0.45) {
        const t = aiHeroInRange(ctx, h, 700);
        if (t) return { unit: t };
      }
      return null;
    },
  },
  priest_flash: {
    name: 'Ослепляющая вспышка', type: 'point', range: 700, cd: [14, 13, 12, 11], mana: [100, 100, 100, 100], maxLv: 4,
    icon: { g: 'burst', c1: '#ffffff', c2: '#a87a1a' }, castPoint: 0.25, radius: 250,
    desc: 'Вспышка света наносит магический урон и накладывает безмолвие: враги не могут применять способности.',
    stats: [['Урон', [60, 100, 140, 180]], ['Безмолвие', [2, 2.5, 3, 3.5], ' с']],
    cast(g, h, lv, t) {
      for (const u of enemiesInRadius(g, h.team, t.x, t.y, 250)) {
        dealDamage(g, h, u, [60, 100, 140, 180][lv - 1], 'magic');
        addBuff(u, 'silence', [2, 2.5, 3, 3.5][lv - 1], { silence: true }, h);
      }
      g.fx('circle', { x: t.x, y: t.y, r: 250, color: 'rgba(255,248,210,0.55)', dur: 0.4 });
      g.fx('ring', { x: t.x, y: t.y, r0: 30, r1: 260, color: '#fff6c0', width: 8, dur: 0.35 });
      g.sound('holy', t);
    },
    ai(g, h, lv, ctx) {
      const p = aiBestAoe(g, h, ctx, 700, 230, 1, 0);
      return p;
    },
  },
  priest_aura: {
    name: 'Аура благодати', type: 'passive', cd: 0, mana: 0, maxLv: 4, radius: 900,
    icon: { g: 'halo', c1: '#fff1a8', c2: '#8a6418' },
    desc: 'Союзники в радиусе 900 восстанавливают здоровье и ману быстрее.',
    stats: [['Здоровье в сек.', [1, 2, 3, 4]], ['Мана в сек.', [0.5, 1, 1.5, 2]]],
  },
  priest_blessing: {
    name: 'Небесное благословение', type: 'none', cd: [120, 105, 90], mana: [200, 300, 400], maxLv: 3, ult: true, radius: 1200,
    icon: { g: 'wings', c1: '#fffbe0', c2: '#9a7414' }, castPoint: 0.3,
    desc: 'Исцеляет всех союзных героев в радиусе 1200 и на 4 сек. снижает получаемый ими урон на 40%.',
    stats: [['Лечение', [250, 400, 550]]],
    cast(g, h, lv) {
      for (const a of alliesInRadius(g, h.team, h.x, h.y, 1200, true)) {
        healUnit(g, a, [250, 400, 550][lv - 1], h);
        addBuff(a, 'bless', 4, { dmgRed: 0.4, blessed: true }, h);
        g.fx('ring', { x: a.x, y: a.y, r0: 10, r1: 90, color: '#fff2a0', width: 6, dur: 0.6 });
        g.burst(a.x, a.y, '#fff2a0', 18, 140, 0.8, 3, true);
      }
      g.fx('ring', { x: h.x, y: h.y, r0: 60, r1: 1200, color: 'rgba(255,240,170,0.7)', width: 10, dur: 0.8 });
      g.sound('holy', h);
    },
    ai(g, h, lv, ctx) {
      let low = 0, crit = false;
      for (const a of ctx.allyHeroes) {
        if (dist(h.x, h.y, a.x, a.y) > 1200) continue;
        const p = a.hp / a.s.maxHp;
        if (p < 0.45) low++;
        if (p < 0.25 && ctx.enemyHeroes.length) crit = true;
      }
      return (low >= 2 || crit) ? { x: h.x, y: h.y } : null;
    },
  },
};
for (const id in ABILITIES) ABILITIES[id].id = id;

// Активные эффекты предметов.
const ITEM_ACTIVES = {
  salve: {
    type: 'none', cd: 0.5, breaksInvis: false,
    cast(g, h) { addBuff(h, 'salve', 8, { heal: 50, salve: true }, h); g.sound('potion', h); },
  },
  clarity: {
    type: 'none', cd: 0.5, breaksInvis: false,
    cast(g, h) { addBuff(h, 'clarity', 10, { manaHeal: 16, clarity: true }, h); g.sound('potion', h); },
  },
  tp: {
    type: 'point', range: 99999, cd: 0,
    cast(g, h, lv, t) {
      const dest = g.nearestAllyBuilding(h.team, t.x, t.y);
      if (!dest) return;
      const d = dist(dest.x, dest.y, t.x, t.y) || 1;
      const off = Math.min(dest.radius + 120, d);
      const p = g.map.nearestFree(dest.x + (t.x - dest.x) / d * off, dest.y + (t.y - dest.y) / d * off);
      let time = 3;
      g.fx('tp', { x: h.x, y: h.y, dur: 3, color: TEAM_COLOR[h.team], follow: h });
      g.fx('tp', { x: p.x, y: p.y, dur: 3, color: TEAM_COLOR[h.team] });
      g.sound('tp', h);
      h.busy = {
        interruptible: true, kind: 'channel', total: 3,
        get left() { return time; },
        update: dt => {
          time -= dt;
          if (time > 0) return false;
          h.x = p.x; h.y = p.y; h.path = null; h.order = null;
          g.burst(p.x, p.y, TEAM_COLOR[h.team], 24, 200, 0.6, 4, true);
          g.sound('blink', h);
          if (h.isPlayer) g.centerOnPlayer = true;
          return true;
        },
        cancel() { g.removeFx(e => e.type === 'tp' && (e.follow === h || (e.x === p.x && e.y === p.y))); },
      };
    },
  },
  blink: {
    type: 'point', range: 1100, clamp: true, cd: 12, castPoint: 0,
    canUse(h) { return h.blinkLockT > 0 ? 'Кинжал недоступен после урона от героя' : null; },
    cast(g, h, lv, t) {
      const p = g.map.nearestFree(t.x, t.y);
      g.burst(h.x, h.y, '#9fe8ff', 18, 160, 0.4, 3, true);
      h.x = p.x; h.y = p.y; h.path = null;
      g.burst(h.x, h.y, '#9fe8ff', 18, 160, 0.4, 3, true);
      g.sound('blink', h);
    },
  },
  bkb: {
    type: 'none', cd: 60, castPoint: 0,
    cast(g, h) {
      purgeDebuffs(h);
      addBuff(h, 'bkb', 6, { magicImmune: true, bkb: true }, h);
      g.sound('stone', h);
    },
  },
};
