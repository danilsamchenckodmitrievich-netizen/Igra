'use strict';
// Состояние матча и основной игровой цикл.

const LANES = ['top', 'mid', 'bot'];

class Game {
  constructor(cfg) {
    this.cfg = cfg;
    this.spectator = !!cfg.spectator;
    this.diff = DIFFICULTY[cfg.difficulty] || DIFFICULTY.normal;
    this.map = new GameMap(cfg.seed || 20261009);
    this.time = -PREGAME;
    this.units = []; this.heroes = []; this.buildings = []; this.towers = [];
    this.projectiles = []; this.skillshots = []; this.zones = []; this.timers = [];
    this.effects = []; this.particles = []; this.floaters = []; this.rubble = [];
    this.kills = [0, 0];
    this.nextWave = 0;
    this.winner = -1; this.endT = 0;
    this.firstBlood = false;
    this.player = null;
    this.playerTeam = this.spectator ? -1 : cfg.team;
    this.listeners = [];
    this.onSound = null;
    this.shakeAmt = 0;
    this.paused = false;
    this.centerOnPlayer = true;
    this.teamPlan = [null, null]; this.planT = 0;
    this.boss = null; this.bossAt = 0;
    this.superLanes = [{}, {}];
    this.visT = 0; this.frontT = 0;
    const L = this.map.lanes;
    this.lanePaths = [
      { top: L.top, mid: L.mid, bot: L.bot },
      { top: L.top.slice().reverse(), mid: L.mid.slice().reverse(), bot: L.bot.slice().reverse() },
    ];
    this.creepPaths = [{}, {}];
    this.creepCum = [{}, {}];
    for (const team of [RADIANT, DIRE]) {
      const enemyAnc = this.map.bases[1 - team].ancient;
      for (const lane of LANES) {
        const pts = this.lanePaths[team][lane].concat([{ x: enemyAnc.x, y: enemyAnc.y }]);
        const cum = [0];
        for (let i = 1; i < pts.length; i++) cum.push(cum[i - 1] + dist(pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y));
        this.creepPaths[team][lane] = pts;
        this.creepCum[team][lane] = cum;
      }
    }
    this.laneFront = [{ top: 0, mid: 0, bot: 0 }, { top: 0, mid: 0, bot: 0 }];
    this.setupBuildings();
    const f0 = this.map.bases[RADIANT].fountain;
    this.map.sealPockets(f0.x, f0.y);
    this.camps = this.map.camps.map(c => ({ x: c.x, y: c.y, type: c.type, units: [], nextSpawn: 60 }));
    this.setupHeroes();
    this.computeLaneFronts();
    for (const u of this.units) u.recalc();
    this.updateVisibility();
  }

  on(fn) { this.listeners.push(fn); }
  emit(type, data) { for (const l of this.listeners) l(type, data); }
  announce(text, color) { this.emit('announce', { text, color }); }
  sound(name, at) { if (this.onSound) this.onSound(name, at); }

  addUnit(u) { this.units.push(u); return u; }

  // ---------- постройки ----------
  setupBuildings() {
    this.towerGrid = [{ top: [], mid: [], bot: [] }, { top: [], mid: [], bot: [] }];
    this.t4 = [[], []];
    this.ancients = [];
    this.fountains = [];
    // Башни Тьмы — точное отражение башен Света, чтобы стороны были равны.
    const spots = {};
    for (const lane of LANES) {
      const pts = this.lanePaths[RADIANT][lane];
      const len = polylineLength(pts);
      const fr = lane === 'mid' ? [0.3, 0.2, 0.1] : [0.32, 0.2, 0.08];
      spots[lane] = fr.map(f => {
        const d = len * f;
        const p = pointAlong(pts, d), q = pointAlong(pts, d + 10);
        const dx = q.x - p.x, dy = q.y - p.y, l = Math.hypot(dx, dy) || 1;
        return { x: p.x - dy / l * 150, y: p.y + dx / l * 150 };
      });
    }
    const mirrorLane = { top: 'bot', mid: 'mid', bot: 'top' };
    for (const team of [RADIANT, DIRE]) {
      for (const lane of LANES) {
        for (let tier = 1; tier <= 3; tier++) {
          const p = team === RADIANT ? spots[lane][tier - 1] : this.map.mirror(spots[mirrorLane[lane]][tier - 1]);
          this.addTower(team, tier, lane, p.x, p.y);
        }
      }
      const anc = this.map.bases[team].ancient;
      const sg = team === RADIANT ? 1 : -1;
      this.addTower(team, 4, null, anc.x + 260 * sg, anc.y - 60 * sg);
      this.addTower(team, 4, null, anc.x + 60 * sg, anc.y - 260 * sg);
      const a = new Unit(this, {
        kind: 'ancient', team, x: anc.x, y: anc.y, radius: 80, hp: 4500, armor: 15, hpRegen: 3,
        isStatic: true, isBuilding: true, vision: 900, name: 'Древний',
      });
      this.map.blockCircle(anc.x, anc.y, 95, 1);
      this.addUnit(a); this.buildings.push(a); this.ancients[team] = a;
      const fp = this.map.bases[team].fountain;
      const f = new Unit(this, {
        kind: 'fountain', team, x: fp.x, y: fp.y, radius: 60, hp: 99999, damage: 170, dmgVar: 10, range: 700,
        interval: 0.5, isStatic: true, isBuilding: true, noCollide: true, vision: 1100, projectileSpeed: 1600,
        name: 'Фонтан',
      });
      f.protected = true;
      f.think = towerThink;
      this.addUnit(f); this.buildings.push(f); this.fountains[team] = f;
    }
    this.updateProtection();
  }

  addTower(team, tier, lane, x, y) {
    const st = TOWER_TIERS[tier];
    const u = new Unit(this, {
      kind: 'tower', team, x, y, radius: 40, hp: st.hp, damage: st.damage, dmgVar: 8, armor: st.armor,
      range: TOWER_RANGE, interval: 0.95, vision: 1000, isStatic: true, isBuilding: true, projectileSpeed: 1100,
      name: 'Башня ' + tier + ' ур.',
    });
    u.tier = tier; u.lane = lane;
    u.think = towerThink;
    this.map.blockCircle(x, y, 52, 1);
    this.addUnit(u); this.buildings.push(u); this.towers.push(u);
    if (lane) this.towerGrid[team][lane][tier] = u;
    else this.t4[team].push(u);
    return u;
  }

  updateProtection() {
    const alive = u => u && u.alive;
    for (const team of [RADIANT, DIRE]) {
      let t3dead = false;
      for (const lane of LANES) {
        const g = this.towerGrid[team][lane];
        if (g[2]) g[2].protected = alive(g[1]);
        if (g[3]) g[3].protected = alive(g[2]);
        if (!alive(g[3])) t3dead = true;
      }
      for (const t of this.t4[team]) t.protected = !t3dead;
      this.ancients[team].protected = this.t4[team].some(alive);
    }
    for (const b of this.buildings) b.recalc();
  }

  nearestAllyBuilding(team, x, y) {
    let best = null, bd = Infinity;
    for (const b of this.buildings) {
      if (!b.alive || b.team !== team) continue;
      const d = dist(b.x, b.y, x, y);
      if (d < bd) { bd = d; best = b; }
    }
    return best;
  }

  enemyTowerCovering(team, x, y) {
    for (const t of this.towers) {
      if (t.alive && t.team !== team && dist(t.x, t.y, x, y) <= TOWER_RANGE + t.radius + 40) return t;
    }
    return null;
  }

  // ---------- герои ----------
  setupHeroes() {
    const all = HEROES.map(h => h.id);
    const teams = [[], []];
    if (this.spectator) {
      teams[0] = shuffle(all.slice()).slice(0, 5);
      teams[1] = shuffle(all.slice()).slice(0, 5);
    } else {
      const pt = this.cfg.team;
      teams[pt] = [this.cfg.heroId].concat(shuffle(all.filter(id => id !== this.cfg.heroId)).slice(0, 4));
      teams[1 - pt] = shuffle(all.slice()).slice(0, 5);
    }
    const laneSlots = [['mid', 'bot', 'bot', 'top', 'top'], ['mid', 'top', 'top', 'bot', 'bot']];
    for (const team of [RADIANT, DIRE]) {
      teams[team].forEach((id, i) => {
        const f = this.map.bases[team].fountain;
        const a = i / 5 * TAU;
        const p = this.map.nearestFree(f.x + Math.cos(a) * 110, f.y + Math.sin(a) * 110);
        const isPlayer = !this.spectator && team === this.cfg.team && i === 0;
        const h = new Hero(this, HERO_BY_ID[id], team, p.x, p.y, { isPlayer });
        if (isPlayer) this.player = h;
        else {
          h.brain = new HeroBrain(this, h, laneSlots[team][i]);
          if (team !== this.playerTeam) { h.goldMult = this.diff.gold; h.xpMult = this.diff.xp; }
        }
        this.addUnit(h);
        this.heroes.push(h);
      });
    }
  }

  respawnHero(h) {
    const f = this.map.bases[h.team].fountain;
    const p = h.reviveAt || this.map.nearestFree(f.x + rand(-90, 90), f.y + rand(-90, 90));
    h.reviveAt = null;
    h.x = p.x; h.y = p.y; h.z = 0;
    h.alive = true;
    h.buffs.length = 0;
    h.recalc();
    h.hp = h.s.maxHp; h.mana = h.s.maxMana;
    h.order = null; h.path = null; h.windup = 0; h.casting = null; h.busy = null;
    if (h.isPlayer) this.centerOnPlayer = true;
    this.emit('respawn', h);
  }

  // ---------- крипы и нейтралы ----------
  spawnWave() {
    const mult = 1 + Math.floor(Math.max(0, this.time) / 300) * 0.08;
    for (const team of [RADIANT, DIRE]) {
      for (const lane of LANES) {
        const pts = this.lanePaths[team][lane];
        const sup = !!this.superLanes[team][lane];
        const m = mult * (sup ? 1.5 : 1);
        const list = ['melee', 'melee', 'melee', 'ranged'];
        if (this.time >= 900) list.splice(3, 0, 'melee');
        const p0 = pts[0], p1 = pts[1];
        const d = dist(p0.x, p0.y, p1.x, p1.y);
        const dx = (p1.x - p0.x) / d, dy = (p1.y - p0.y) / d;
        list.forEach((tp, i) => {
          const back = i * 42, side = (i % 2 ? 1 : -1) * 28;
          const p = this.map.nearestFree(p0.x - dx * back - dy * side, p0.y - dy * back + dx * side);
          this.spawnCreep(team, lane, tp, p.x, p.y, m, sup);
        });
      }
    }
  }

  spawnCreep(team, lane, tp, x, y, m, sup) {
    const st = CREEP_TYPES[tp];
    const u = new Unit(this, {
      kind: 'creep', team, x, y, radius: st.radius * (sup ? 1.15 : 1), hp: st.hp * m, damage: st.damage * m,
      dmgVar: st.dmgVar, armor: st.armor, range: st.range, interval: st.interval, speed: st.speed, vision: st.vision,
      gold: st.gold, xp: st.xp, projectileSpeed: st.projectileSpeed, name: st.name, hpRegen: 0.5,
    });
    u.ctype = tp; u.lane = lane; u.superCreep = sup;
    u.lanePts = this.creepPaths[team][lane];
    u.laneCum = this.creepCum[team][lane];
    u.laneI = 1; u.laneOff = rand(-25, 25);
    u.think = creepThink; u.thinkT = Math.random() * 0.3;
    u.order = { type: 'lane' };
    this.addUnit(u);
    return u;
  }

  spawnCamp(camp) {
    const types = CAMP_TYPES[camp.type];
    const mult = 1 + Math.max(0, this.time) / 600 * 0.2;
    types.forEach((tp, i) => {
      const st = NEUTRAL_TYPES[tp];
      const a = i / types.length * TAU + 0.6;
      const r = types.length > 1 ? 48 : 0;
      const x = camp.x + Math.cos(a) * r, y = camp.y + Math.sin(a) * r;
      const u = new Unit(this, {
        kind: 'neutral', team: NEUTRAL, x, y, radius: st.radius, hp: st.hp * mult, damage: st.damage * mult,
        dmgVar: st.dmgVar, armor: st.armor, range: st.range, interval: st.interval, speed: st.speed, vision: 600,
        gold: st.gold, xp: st.xp, projectileSpeed: st.projectileSpeed || 0, color: st.color, name: st.name, hpRegen: 1,
      });
      u.ntype = tp; u.home = { x, y }; u.camp = camp;
      u.think = neutralThink; u.aggro = null; u.aggroT = -99;
      u.facing = Math.atan2(camp.y - y, camp.x - x) + Math.PI;
      this.addUnit(u);
      camp.units.push(u);
    });
  }

  aggroCamp(n, src) {
    if (!src || src.team === NEUTRAL) return;
    if (n.isBoss) { n.aggro = src; n.aggroT = this.time; return; }
    if (!n.camp) return;
    for (const u of n.camp.units) if (u.alive) { u.aggro = src; u.aggroT = this.time; }
  }

  spawnBoss() {
    const p = this.map.bossPit, b = BOSS;
    const mins = Math.max(0, this.time) / 60;
    const u = new Unit(this, {
      kind: 'neutral', team: NEUTRAL, x: p.x, y: p.y, radius: b.radius, hp: b.hp + b.hpPerMin * mins,
      damage: b.damage + mins * 2, dmgVar: b.dmgVar, armor: b.armor, range: b.range, interval: b.interval, speed: b.speed,
      vision: 700, gold: b.gold, xp: b.xp, color: b.color, name: b.name, hpRegen: 8, magicResist: 0.3,
    });
    u.ntype = 'golem'; u.isBoss = true; u.home = { x: p.x, y: p.y };
    u.think = bossThink; u.aggro = null; u.aggroT = -99; u.slamT = 3;
    u.facing = Math.PI * 0.25;
    this.addUnit(u);
    this.boss = u;
  }

  onHeroHarass(src, victim) {
    if (src.team === victim.team || victim.team === NEUTRAL) return;
    for (const b of this.towers) {
      if (b.alive && b.team === victim.team && gapU(b, src) <= b.s.range) { b.forceTarget = src; b.forceUntil = this.time + 2.5; }
    }
    for (const u of this.units) {
      if (!u.alive || u.kind !== 'creep' || u.team !== victim.team) continue;
      if (dist(u.x, u.y, src.x, src.y) > 500) continue;
      const cur = u.order && u.order.target;
      if (!cur || cur.kind !== 'hero') { u.forceTarget = src; u.forceUntil = this.time + 2.2; u.thinkT = 0; }
    }
  }

  // ---------- главный цикл ----------
  update(dt) {
    if (this.paused) return;
    dt = Math.min(dt, 0.05);
    this.updateFx(dt);
    if (this.winner >= 0) { this.endT += dt; return; }
    this.time += dt;
    if (this.time >= this.nextWave) { this.spawnWave(); this.nextWave += WAVE_INTERVAL; }
    if (!this.boss && this.time >= this.bossAt) this.spawnBoss();
    for (const c of this.camps) {
      if (this.time >= c.nextSpawn) {
        c.nextSpawn += CAMP_RESPAWN;
        if (c.units.every(u => !u.alive)) { c.units = []; this.spawnCamp(c); }
      }
    }
    if (this.time > 0) for (const h of this.heroes) h.gold += PASSIVE_GOLD * dt * h.goldMult;
    if (this.time > 840) {
      this.planT -= dt;
      if (this.planT <= 0) { this.planT = 90; this.makePlans(); }
    }
    this.computeAuras();
    for (const u of this.units) if (u.alive) u.recalc();
    this.visT -= dt;
    if (this.visT <= 0) { this.visT = 0.1; this.updateVisibility(); }
    this.frontT -= dt;
    if (this.frontT <= 0) { this.frontT = 0.5; this.computeLaneFronts(); }
    // Порядок обхода чередуется, чтобы ни одна сторона не ходила всегда первой.
    this.flip = !this.flip;
    const hs = this.heroes, nh = hs.length;
    for (let k = 0; k < nh; k++) { const h = hs[this.flip ? k : nh - 1 - k]; if (h.brain) h.brain.update(dt); }
    const us = this.units, n = us.length;
    for (let k = 0; k < n; k++) us[this.flip ? k : n - 1 - k].update(dt);
    this.updateProjectiles(dt);
    this.updateSkillshots(dt);
    this.updateZones(dt);
    this.updateTimers(dt);
    this.separate();
    this.fountainHeal(dt);
    let dead = false;
    for (const u of this.units) if (!u.alive && u.kind !== 'hero') { dead = true; break; }
    if (dead) this.units = this.units.filter(u => u.alive || u.kind === 'hero');
  }

  computeAuras() {
    for (const u of this.units) { u.auraHp = 0; u.auraMp = 0; }
    for (const h of this.heroes) {
      if (!h.alive) continue;
      const ab = h.abilities.find(a => a.id === 'priest_aura');
      if (!ab || !ab.lv) continue;
      const hp = [1, 2, 3, 4][ab.lv - 1], mp = [0.5, 1, 1.5, 2][ab.lv - 1];
      for (const u of this.units) {
        if (!u.alive || u.team !== h.team || u.isBuilding) continue;
        if (distSq(u.x, u.y, h.x, h.y) > 900 * 900) continue;
        u.auraHp = Math.max(u.auraHp, hp); u.auraMp = Math.max(u.auraMp, mp);
      }
    }
  }

  updateVisibility() {
    const viewers = [[], []];
    for (const u of this.units) if (u.alive && u.team < 2) viewers[u.team].push(u);
    for (const u of this.units) {
      for (let t = 0; t < 2; t++) {
        if (u.team === t) { u.visibleTo[t] = true; continue; }
        if (!u.alive) { u.visibleTo[t] = false; continue; }
        if (u.s.revealed || u.isBuilding) { u.visibleTo[t] = true; continue; }
        if (u.s.invis) { u.visibleTo[t] = false; continue; }
        let vis = false;
        for (const v of viewers[t]) {
          const r = v.vision + u.radius;
          const dx = v.x - u.x, dy = v.y - u.y;
          if (dx > r || dx < -r || dy > r || dy < -r) continue;
          if (dx * dx + dy * dy < r * r) { vis = true; break; }
        }
        u.visibleTo[t] = vis;
      }
    }
  }

  computeLaneFronts() {
    for (const team of [RADIANT, DIRE]) {
      for (const lane of LANES) {
        const path = this.lanePaths[team][lane];
        let best = -1;
        for (const u of this.units) {
          if (!u.alive || u.kind !== 'creep' || u.team !== team || u.lane !== lane) continue;
          const a = projectOnPolyline(path, u.x, u.y).along;
          if (a > best) best = a;
        }
        if (best < 0) {
          best = 0;
          const grid = this.towerGrid[team][lane];
          for (let tier = 1; tier <= 3; tier++) {
            const t = grid[tier];
            if (t && t.alive) best = Math.max(best, projectOnPolyline(path, t.x, t.y).along + 150);
          }
        }
        this.laneFront[team][lane] = best;
      }
    }
  }

  makePlans() {
    for (const team of [RADIANT, DIRE]) {
      const enemy = 1 - team;
      let best = 'mid', bs = Infinity;
      for (const lane of LANES) {
        let alive = 0;
        for (let tier = 1; tier <= 3; tier++) { const t = this.towerGrid[enemy][lane][tier]; if (t && t.alive) alive++; }
        const s = alive * 10 - this.laneFront[team][lane] / 1000 + (lane === 'mid' ? -0.5 : 0);
        if (s < bs) { bs = s; best = lane; }
      }
      this.teamPlan[team] = best;
    }
  }

  separate() {
    const us = this.units, n = us.length, map = this.map;
    for (let i = 0; i < n; i++) {
      const a = us[i];
      if (!a.alive || a.noCollide || (a.busy && a.busy.noCollide)) continue;
      for (let j = i + 1; j < n; j++) {
        const b = us[j];
        if (!b.alive || b.noCollide || (b.busy && b.busy.noCollide)) continue;
        if (a.isStatic && b.isStatic) continue;
        const r = (a.radius + b.radius) * 0.82;
        let dx = b.x - a.x, dy = b.y - a.y;
        if (dx > r || dx < -r || dy > r || dy < -r) continue;
        let d2 = dx * dx + dy * dy;
        if (d2 >= r * r) continue;
        let d = Math.sqrt(d2);
        if (d < 0.01) { dx = Math.random() - 0.5; dy = Math.random() - 0.5; d = Math.hypot(dx, dy); }
        const nx = dx / d, ny = dy / d;
        const push = (r - d);
        if (a.isStatic) this.nudge(b, nx * push, ny * push, map);
        else if (b.isStatic) this.nudge(a, -nx * push, -ny * push, map);
        else {
          const wa = b.kind === 'hero' && a.kind !== 'hero' ? 0.75 : a.kind === 'hero' && b.kind !== 'hero' ? 0.25 : 0.5;
          this.nudge(a, -nx * push * wa, -ny * push * wa, map);
          this.nudge(b, nx * push * (1 - wa), ny * push * (1 - wa), map);
        }
      }
    }
  }
  nudge(u, dx, dy, map) {
    const nx = u.x + dx, ny = u.y + dy;
    if (!map.blocked(nx, ny)) { u.x = nx; u.y = ny; }
    else if (!map.blocked(nx, u.y)) u.x = nx;
    else if (!map.blocked(u.x, ny)) u.y = ny;
  }

  fountainHeal(dt) {
    for (const u of this.units) {
      if (!u.alive || u.isBuilding || u.team > 1) continue;
      const f = this.map.bases[u.team].fountain;
      if (distSq(u.x, u.y, f.x, f.y) > FOUNTAIN_HEAL_RADIUS * FOUNTAIN_HEAL_RADIUS) continue;
      u.hp = Math.min(u.s.maxHp, u.hp + (u.s.maxHp * 0.05 + 12) * dt);
      u.mana = Math.min(u.s.maxMana, u.mana + (u.s.maxMana * 0.05 + 6) * dt);
    }
  }

  // ---------- смерть ----------
  killUnit(u, killer) {
    if (!u.alive) return;
    if (u.kind === 'hero' && u.hasItem('aegis')) { this.aegisSave(u); return; }
    u.alive = false; u.hp = 0;
    u.order = null; u.casting = null; u.windup = 0; u.windupTarget = null; u.z = 0;
    if (u.busy && u.busy.cancel) u.busy.cancel();
    u.busy = null;
    u.buffs.length = 0;
    const kh = killer && killer.kind === 'hero' ? killer : null;
    if (this.isShown(u)) {
      const col = u.kind === 'hero' ? u.color : u.team === NEUTRAL ? (u.color || '#c9a64b') : TEAM_COLOR[u.team];
      this.burst(u.x, u.y, col, u.kind === 'hero' ? 30 : 12, u.kind === 'hero' ? 220 : 140, 0.7, u.kind === 'hero' ? 5 : 3, false);
      this.fx('corpse', { x: u.x, y: u.y, r: u.radius, color: col, dur: 1.2, facing: u.facing });
    }
    if (u.kind === 'creep' || u.kind === 'neutral') {
      if (kh && kh.team !== u.team) {
        const gold = Math.round(randInt(u.goldBounty[0], u.goldBounty[1]) * kh.goldMult);
        kh.addGold(gold);
        kh.lastHits++;
        if (kh === this.player) {
          this.floater(u.x, u.y - 24, '+' + gold, '#ffd24a', 16);
          this.sound('coin', u);
        }
      }
      const xpTeam = u.kind === 'neutral' ? (killer ? killer.team : -1) : 1 - u.team;
      if (xpTeam === RADIANT || xpTeam === DIRE) this.giveXp(xpTeam, u.x, u.y, u.xpBounty);
      if (u.isBoss) this.bossDied(u, killer, kh, xpTeam);
    } else if (u.kind === 'hero') this.heroDied(u, killer, kh);
    else if (u.kind === 'tower') this.towerDied(u, kh);
    else if (u.kind === 'ancient') this.ancientDied(u);
  }

  bossDied(u, killer, kh, team) {
    this.boss = null;
    this.bossAt = this.time + BOSS.respawn;
    this.burst(u.x, u.y, '#c0c8d4', 50, 300, 1.2, 6, false);
    this.fx('ring', { x: u.x, y: u.y, r0: 30, r1: 360, color: '#ffe27a', width: 14, dur: 0.8 });
    if (team !== RADIANT && team !== DIRE) return;
    for (const h of this.heroes) if (h.team === team) h.addGold(Math.round(BOSS.teamGold * h.goldMult));
    const holder = kh && kh.team === team ? kh : this.heroes.find(h => h.team === team && h.alive && dist(h.x, h.y, u.x, u.y) < 1500);
    if (holder) {
      holder.removeItem('aegis');
      if (!holder.giveItem('aegis')) holder.deliveries.push({ id: 'aegis', t: 0 });
      holder.aegisUntil = this.time + AEGIS_TIME;
    }
    this.announce(TEAM_NAME[team] + ' побеждает Древнего Голема' + (holder ? ' · Эгида у героя ' + holder.name : ''), TEAM_COLOR[team]);
    this.emit('boss', { team, holder });
    this.sound('collapse', u);
  }

  giveXp(team, x, y, amount) {
    const hs = this.heroes.filter(h => h.alive && h.team === team && dist(h.x, h.y, x, y) <= XP_RADIUS);
    if (!hs.length) return;
    for (const h of hs) h.addXp(amount / hs.length * h.xpMult);
  }

  aegisSave(h) {
    h.removeItem('aegis');
    h.alive = false; h.hp = 0;
    h.order = null; h.casting = null; h.windup = 0; h.windupTarget = null; h.z = 0;
    if (h.busy && h.busy.cancel) h.busy.cancel();
    h.busy = null;
    h.buffs.length = 0;
    h.respawnT = 4;
    h.reviveAt = { x: h.x, y: h.y };
    h.dmgBy.clear();
    this.fx('tp', { x: h.x, y: h.y, dur: 4, color: '#ffe27a' });
    this.announce(h.name + ' воскресает благодаря Эгиде', '#ffe27a');
    this.sound('holy', h);
  }

  heroDied(v, killer, kh) {
    v.deaths++;
    const prevStreak = v.streak;
    v.streak = 0;
    v.respawnT = 4 + v.level * 2.2;
    v.gold -= Math.min(Math.floor(v.gold), 20 * v.level);
    const enemyTeam = 1 - v.team;
    const assisters = this.heroes.filter(h => h.team === enemyTeam && h !== kh && v.dmgBy.has(h.id) && this.time - v.dmgBy.get(h.id) < 12);
    if (kh && kh.team !== v.team) {
      kh.kills++; kh.streak++;
      const gold = Math.round((150 + 9 * v.level + Math.max(0, prevStreak - 2) * 60) * kh.goldMult);
      kh.addGold(gold);
      if (kh === this.player) this.floater(v.x, v.y - 30, '+' + gold, '#ffd24a', 20);
      if (!this.firstBlood) {
        this.firstBlood = true;
        kh.addGold(150);
        this.announce('Первая кровь!', '#ff5a4a');
      } else if (kh.streak >= 3) {
        this.announce(kh.name + ': ' + STREAK_NAMES[Math.min(kh.streak, 10)], TEAM_COLOR[kh.team]);
      }
      if (prevStreak >= 3) this.announce(kh.name + ' прерывает серию ' + v.name, TEAM_COLOR[kh.team]);
    }
    this.kills[enemyTeam]++;
    for (const a of assisters) {
      a.assists++;
      a.addGold(Math.round((60 + 6 * v.level) / assisters.length * a.goldMult));
    }
    this.giveXp(enemyTeam, v.x, v.y, 80 + 20 * v.level + v.xp * 0.06);
    this.emit('kill', { killer: kh || killer, victim: v, assisters });
    v.dmgBy.clear();
    this.sound('death', v);
  }

  towerDied(t, kh) {
    const team = 1 - t.team;
    for (const h of this.heroes) if (h.team === team) h.addGold(Math.round(110 * h.goldMult));
    if (kh && kh.team === team) kh.addGold(Math.round(140 * kh.goldMult));
    this.giveXp(team, t.x, t.y, 300);
    this.map.blockCircle(t.x, t.y, 52, 0);
    for (const tr of this.map.trees) if (dist(tr.x, tr.y, t.x, t.y) < 160) this.map.blockCircle(tr.x, tr.y, tr.r + 6, 1);
    this.rubble.push({ x: t.x, y: t.y, r: t.radius, team: t.team });
    if (t.tier === 3 && t.lane) this.superLanes[team][t.lane] = true;
    this.updateProtection();
    this.burst(t.x, t.y, '#8a8070', 40, 260, 1.2, 6, false);
    this.burst(t.x, t.y, TEAM_COLOR[t.team], 30, 300, 0.8, 4, true);
    this.fx('ring', { x: t.x, y: t.y, r0: 30, r1: 240, color: TEAM_COLOR[t.team], width: 10, dur: 0.6 });
    if (this.isShown(t)) this.shake(10);
    const where = t.lane ? ' (' + this.map.laneNames[t.lane].toLowerCase() + ' линия)' : ' у Древнего';
    this.announce(TEAM_NAME[team] + ' разрушает башню' + where, TEAM_COLOR[team]);
    this.emit('tower', { tower: t, team });
    this.sound('collapse', t);
  }

  ancientDied(a) {
    this.winner = 1 - a.team;
    this.burst(a.x, a.y, TEAM_COLOR[a.team], 120, 500, 2.0, 7, true);
    this.burst(a.x, a.y, '#9a9080', 80, 300, 2.5, 8, false);
    this.fx('ring', { x: a.x, y: a.y, r0: 50, r1: 700, color: TEAM_COLOR[a.team], width: 24, dur: 1.4 });
    this.shake(24);
    this.sound('collapse', a);
    this.emit('gameover', { winner: this.winner });
  }

  onDamage(src, tgt, d, type, opts) {
    if (this.player && src === this.player && type === 'magic' && !opts.dot && d >= 1 && this.isShown(tgt)) {
      this.floater(tgt.x + rand(-10, 10), tgt.y - tgt.radius - 16, String(Math.round(d)), '#8fc8ff', 15);
    }
  }
  onLevelUp(h) {
    if (this.isShown(h)) this.fx('ring', { x: h.x, y: h.y, r0: 10, r1: 90, color: '#ffd86b', width: 5, dur: 0.7, follow: h });
    if (h === this.player) {
      this.sound('level', h);
      this.emit('levelup', h);
    }
  }
  onCast(h, ab) { this.emit('cast', { hero: h, ability: ab }); }

  isShown(o) {
    if (this.spectator || !o.visibleTo) return true;
    return o.visibleTo[this.playerTeam];
  }

  // ---------- снаряды и эффекты ----------
  spawnAttackProjectile(a, t, bonus) {
    let color;
    if (a.kind === 'hero') color = a.color;
    else if (a.kind === 'tower' || a.kind === 'fountain') color = a.team === RADIANT ? '#c9ffb0' : '#ffb0a0';
    else if (a.kind === 'neutral') color = '#d0a0ff';
    else color = a.team === RADIANT ? '#d8ffb0' : '#ffc0a0';
    const big = a.isBuilding;
    this.projectiles.push({
      x: a.x + Math.cos(a.facing) * a.radius * 0.6, y: a.y + Math.sin(a.facing) * a.radius * 0.6 - (big ? 50 : 0),
      target: t, speed: a.projectileSpeed, color, size: big ? 8 : a.kind === 'hero' ? 6 : 4,
      trail: a.kind === 'hero' || big ? color : null, a: a.facing,
      onHit: () => attackHit(this, a, t, bonus),
    });
  }
  homing(src, target, speed, opts, onHit) {
    this.projectiles.push({
      x: src.x, y: src.y, target, speed, color: opts.color, size: opts.size, trail: opts.trail, a: src.facing, spell: true,
      onHit: () => onHit(target),
    });
  }
  updateProjectiles(dt) {
    const ps = this.projectiles;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      const t = p.target;
      if (!t.alive) { ps.splice(i, 1); continue; }
      const ty = t.y - (t.z || 0);
      const d = dist(p.x, p.y, t.x, ty);
      const step = p.speed * dt;
      if (d <= step + t.radius * 0.4) { ps.splice(i, 1); p.onHit(); continue; }
      p.x += (t.x - p.x) / d * step;
      p.y += (ty - p.y) / d * step;
      p.a = Math.atan2(ty - p.y, t.x - p.x);
      if (p.trail && Math.random() < 0.7) this.particle(p.x, p.y, rand(-20, 20), rand(-20, 20), 0.3, p.size * 0.7, p.trail, true);
    }
  }
  skillshot(src, angle, speed, range, radius, opts, onHitUnit, onEnd) {
    this.skillshots.push({
      x: src.x, y: src.y, vx: Math.cos(angle) * speed, vy: Math.sin(angle) * speed, speed, left: range, radius,
      team: src.team, src, opts, onHitUnit, onEnd, hit: new Set(), a: angle,
    });
  }
  updateSkillshots(dt) {
    const ss = this.skillshots;
    for (let i = ss.length - 1; i >= 0; i--) {
      const s = ss[i];
      s.x += s.vx * dt; s.y += s.vy * dt; s.left -= s.speed * dt;
      let stop = false;
      for (const u of this.units) {
        if (!u.alive || u.team === s.team || u.isBuilding || u.s.invuln || s.hit.has(u)) continue;
        if (dist(s.x, s.y, u.x, u.y) <= s.radius + u.radius) {
          s.hit.add(u);
          if (s.onHitUnit(u)) { stop = true; break; }
        }
      }
      if (stop) { ss.splice(i, 1); continue; }
      if (s.left <= 0) { ss.splice(i, 1); if (s.onEnd) s.onEnd(s.x, s.y); continue; }
      if (s.opts.trail) for (let k = 0; k < 2; k++) this.particle(s.x, s.y, rand(-40, 40) - s.vx * 0.1, rand(-40, 40) - s.vy * 0.1, 0.45, rand(4, 8), s.opts.trail, true);
    }
  }
  zone(z) {
    z.t = 0; z.tickT = 0;
    this.zones.push(z);
  }
  updateZones(dt) {
    for (let i = this.zones.length - 1; i >= 0; i--) {
      const z = this.zones[i];
      z.t += dt; z.tickT += dt;
      while (z.tickT >= z.interval) { z.tickT -= z.interval; z.onTick(z); }
      if (z.kind === 'blizzard') {
        for (let k = 0; k < 4; k++) {
          const a = Math.random() * TAU, r = Math.sqrt(Math.random()) * z.r;
          this.particle(z.x + Math.cos(a) * r, z.y + Math.sin(a) * r - 40, rand(-30, 10), rand(60, 120), 0.6, rand(2, 4), '#ffffff', false);
        }
      }
      if (z.t >= z.dur) this.zones.splice(i, 1);
    }
  }
  later(t, fn) { this.timers.push({ t, fn }); }
  updateTimers(dt) {
    const ts = this.timers;
    for (let i = ts.length - 1; i >= 0; i--) {
      ts[i].t -= dt;
      if (ts[i].t <= 0) { const f = ts[i].fn; ts.splice(i, 1); f(); }
    }
  }

  dash(u, x, y, speed, color) {
    const sx = u.x, sy = u.y;
    const total = dist(sx, sy, x, y) / speed;
    let t = 0;
    u.order = null; u.path = null;
    u.busy = {
      noCollide: true, kind: 'dash',
      update: dt => {
        t += dt;
        const k = total > 0 ? Math.min(1, t / total) : 1;
        u.x = lerp(sx, x, k); u.y = lerp(sy, y, k);
        u.facing = Math.atan2(y - sy, x - sx);
        if (color) this.particle(u.x, u.y, rand(-30, 30), rand(-30, 30), 0.4, rand(3, 6), color, true);
        return k >= 1;
      },
    };
  }
  leap(u, x, y, dur, height, onLand) {
    const sx = u.x, sy = u.y;
    let t = 0;
    u.order = null; u.path = null;
    u.busy = {
      noCollide: true, kind: 'leap',
      update: dt => {
        t += dt;
        const k = Math.min(1, t / dur);
        u.x = lerp(sx, x, k); u.y = lerp(sy, y, k);
        u.z = Math.sin(Math.PI * k) * height;
        u.facing = Math.atan2(y - sy, x - sx);
        if (k >= 1) { u.z = 0; onLand(); return true; }
        return false;
      },
      cancel() { u.z = 0; },
    };
  }

  fx(type, props) {
    const e = Object.assign({ type, t: 0, dur: 0.5 }, props);
    this.effects.push(e);
    return e;
  }
  removeFx(pred) { this.effects = this.effects.filter(e => !pred(e)); }
  shake(a) { this.shakeAmt = Math.max(this.shakeAmt, a); }
  particle(x, y, vx, vy, life, size, color, glow) {
    if (this.particles.length > 2200) return;
    this.particles.push({ x, y, vx, vy, life, max: life, size, color, glow });
  }
  burst(x, y, color, n, speed, life, size, glow) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * TAU, v = speed * rand(0.25, 1);
      this.particle(x, y, Math.cos(a) * v, Math.sin(a) * v, life * rand(0.6, 1), size * rand(0.6, 1.3), color, glow);
    }
  }
  floater(x, y, text, color, size) {
    this.floaters.push({ x, y, text, color, size: size || 14, t: 0, dur: 1.1 });
  }
  updateFx(dt) {
    const es = this.effects;
    for (let i = es.length - 1; i >= 0; i--) {
      const e = es[i];
      e.t += dt;
      if (e.follow) { if (e.follow.alive) { e.x = e.follow.x; e.y = e.follow.y; } else e.t = e.dur; }
      if (e.t >= e.dur) es.splice(i, 1);
    }
    const ps = this.particles;
    for (let i = ps.length - 1; i >= 0; i--) {
      const p = ps[i];
      p.life -= dt;
      if (p.life <= 0) { ps[i] = ps[ps.length - 1]; ps.pop(); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      p.vx *= 0.94; p.vy *= 0.94;
    }
    const fs = this.floaters;
    for (let i = fs.length - 1; i >= 0; i--) {
      const f = fs[i];
      f.t += dt; f.y -= 34 * dt;
      if (f.t >= f.dur) fs.splice(i, 1);
    }
    if (this.shakeAmt > 0) this.shakeAmt = Math.max(0, this.shakeAmt - dt * 40);
  }
}
