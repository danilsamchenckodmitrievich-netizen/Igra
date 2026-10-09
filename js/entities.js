'use strict';
// Юниты, герои, бафы и расчёт урона.

let UID = 1;

function addBuff(u, key, dur, props, src) {
  if (!u.alive) return null;
  if (src && src.team !== u.team && u.s.magicImmune && !(props && props.pierce)) return null;
  let b = null;
  for (const x of u.buffs) if (x.key === key) { b = x; break; }
  if (b) {
    b.t = Math.max(b.t, dur);
    b.dur = Math.max(b.dur, dur);
    Object.assign(b, props);
    if (src) b.src = src;
  } else {
    b = Object.assign({ key, t: dur, dur, src: src || null, tick: 0 }, props);
    u.buffs.push(b);
  }
  u.recalc();
  if (b.stun && u.busy && u.busy.interruptible) {
    if (u.busy.cancel) u.busy.cancel();
    u.busy = null;
  }
  return b;
}
function findBuff(u, key) {
  for (const b of u.buffs) if (b.key === key) return b;
  return null;
}
function removeBuff(u, key) {
  const i = u.buffs.findIndex(b => b.key === key);
  if (i >= 0) { u.buffs.splice(i, 1); u.recalc(); }
}
function purgeDebuffs(u) {
  u.buffs = u.buffs.filter(b => !b.src || b.src.team === u.team);
  u.recalc();
}

function healUnit(g, u, amount, src, quiet) {
  if (!u.alive || amount <= 0) return 0;
  const before = u.hp;
  u.hp = Math.min(u.s.maxHp, u.hp + amount);
  const done = u.hp - before;
  if (!quiet && done >= 20 && g.isShown(u)) g.floater(u.x, u.y - u.radius - 18, '+' + Math.round(done), '#7dff8a', 15);
  return done;
}

function dealDamage(g, src, tgt, amount, type, opts) {
  opts = opts || {};
  if (!tgt.alive || amount <= 0) return 0;
  const ts = tgt.s;
  if (ts.invuln) return 0;
  if (type === 'magic' && ts.magicImmune) return 0;
  let d = amount;
  if (src && type === 'magic' && !opts.dot && src.s) d *= 1 + (src.s.spellAmp || 0);
  if (type === 'phys') d *= armorMult(ts.armor);
  else if (type === 'magic') d *= 1 - ts.magicResist;
  d *= (1 + ts.dmgAmp) * (1 - ts.dmgRed);
  if (ts.shield > 0) {
    for (const b of tgt.buffs) {
      if (!b.shield) continue;
      const take = Math.min(b.shield, d);
      b.shield -= take; d -= take;
      if (b.shield <= 0) b.t = 0;
      if (d <= 0) break;
    }
    tgt.recalc();
  }
  if (d <= 0) return 0;
  tgt.hp -= d;
  tgt.flash = 0.12;
  tgt.lastHurtT = g.time;
  if (src) {
    tgt.lastAttacker = src;
    if (src.kind === 'hero') {
      src.dmgDealt += d;
      if (tgt.kind === 'hero') {
        tgt.dmgBy.set(src.id, g.time);
        tgt.blinkLockT = 3;
        if (opts.attack) g.onHeroHarass(src, tgt);
      }
    }
    if (tgt.kind === 'neutral') g.aggroCamp(tgt, src);
  }
  g.onDamage(src, tgt, d, type, opts);
  if (opts.attack && !opts.reflect && src && src.alive && ts.thorns > 0 && !src.isBuilding) {
    dealDamage(g, tgt, src, amount * ts.thorns, 'phys', { reflect: true });
  }
  if (tgt.hp <= 0) g.killUnit(tgt, src);
  return d;
}

// Попадание обычной атакой.
function attackHit(g, a, t, bonus) {
  if (!t.alive) return;
  if (t.s.evasion > 0 && Math.random() < t.s.evasion) {
    if (g.isShown(t)) g.floater(t.x, t.y - t.radius - 14, 'промах', '#c9c9c9', 13);
    return;
  }
  let dmg = a.s.damage + (a.s.dmgVar ? rand(-a.s.dmgVar, a.s.dmgVar) : 0) + (bonus || 0);
  let mult = 1;
  if (a.s.critP > 0 && Math.random() < a.s.critP) mult = Math.max(mult, a.s.critPMult);
  if (a.s.crit > 0 && Math.random() < a.s.crit) mult = Math.max(mult, 2.2);
  if (t.isBuilding && a.kind === 'hero') mult = Math.min(mult, 1.5);
  dmg *= mult;
  const dealt = dealDamage(g, a, t, dmg, 'phys', { attack: true, crit: mult > 1 });
  if (mult > 1 && dealt > 0 && g.isShown(t)) {
    g.floater(t.x, t.y - t.radius - 20, Math.round(dealt) + '!', '#ff5a4a', 20);
  }
  if (bonus && g.isShown(t)) g.fx('ring', { x: t.x, y: t.y, r0: 10, r1: 70, color: '#b48cff', width: 4, dur: 0.35 });
  if (a.kind === 'hero' && t.alive && !t.isBuilding) {
    for (const ab of a.abilities) if (ab.lv > 0 && ab.def.onHit) ab.def.onHit(g, a, t, ab.lv);
  }
}

class Unit {
  constructor(game, o) {
    this.game = game;
    this.id = UID++;
    this.kind = o.kind;
    this.team = o.team;
    this.name = o.name || '';
    this.x = o.x; this.y = o.y; this.z = 0;
    this.radius = o.radius || 16;
    this.base = {
      maxHp: o.hp, maxMana: o.mana || 0, damage: o.damage || 0, dmgVar: o.dmgVar || 0,
      armor: o.armor || 0, range: o.range || 0, interval: o.interval || 1, speed: o.speed || 0,
      hpRegen: o.hpRegen || 0, manaRegen: o.manaRegen || 0, magicResist: o.magicResist || 0,
    };
    this.hp = o.hp; this.mana = this.base.maxMana;
    this.projectileSpeed = o.projectileSpeed || 0;
    this.vision = o.vision || 800;
    this.goldBounty = o.gold || [0, 0];
    this.xpBounty = o.xp || 0;
    this.color = o.color || TEAM_COLOR[o.team];
    this.facing = o.team === DIRE ? Math.PI * 0.75 : -Math.PI * 0.25;
    this.alive = true;
    this.isStatic = !!o.isStatic;
    this.isBuilding = !!o.isBuilding;
    this.usePathing = !!o.usePathing;
    this.noCollide = !!o.noCollide;
    this.attackCd = 0; this.windup = 0; this.windupTotal = 0; this.windupTarget = null; this.attackAnim = 0;
    this.order = null;
    this.path = null; this.pathI = 0; this.pathGoalX = 0; this.pathGoalY = 0; this.repathT = 0;
    this.buffs = [];
    this.busy = null;
    this.casting = null;
    this.visibleTo = [false, false, true];
    this.flash = 0;
    this.moving = false;
    this.walkT = Math.random() * 10;
    this.autoAcquireT = 0;
    this.auraHp = 0; this.auraMp = 0;
    this.protected = false;
    this.lastAttacker = null;
    this.s = { maxHp: o.hp, maxMana: this.base.maxMana };
    this.recalc();
    this.hp = this.s.maxHp; this.mana = this.s.maxMana;
  }

  addOwnStats() {}

  recalc() {
    const a = this._acc || (this._acc = {});
    const b = this.base;
    a.maxHp = b.maxHp; a.maxMana = b.maxMana; a.damage = b.damage; a.armor = b.armor; a.as = 0;
    a.speed = b.speed; a.boots = 0; a.hpRegen = b.hpRegen; a.manaRegen = b.manaRegen; a.spellAmp = 0;
    a.evasion = 0; a.crit = 0; a.critP = 0; a.critPMult = 1; a.magicResist = b.magicResist; a.range = b.range;
    a.msPct = 0; a.thorns = 0; a.interval = b.interval;
    this.addOwnStats(a);
    a.hpRegen += this.auraHp; a.manaRegen += this.auraMp;
    let slow = 0, dmgAmp = 0, dmgRed = 0, shield = 0;
    let stunned = false, silenced = false, rooted = false, invuln = false, magicImmune = false, invis = false, revealed = false;
    for (const bf of this.buffs) {
      if (bf.armor) a.armor += bf.armor;
      if (bf.as) a.as += bf.as;
      if (bf.damage) a.damage += bf.damage;
      if (bf.msPct) a.msPct += bf.msPct;
      if (bf.slow) slow = Math.max(slow, bf.slow);
      if (bf.hpRegen) a.hpRegen += bf.hpRegen;
      if (bf.manaRegen) a.manaRegen += bf.manaRegen;
      if (bf.dmgAmp) dmgAmp += bf.dmgAmp;
      if (bf.dmgRed) dmgRed = Math.max(dmgRed, bf.dmgRed);
      if (bf.shield) shield += bf.shield;
      if (bf.stun) stunned = true;
      if (bf.silence) silenced = true;
      if (bf.root) rooted = true;
      if (bf.invuln) invuln = true;
      if (bf.magicImmune) magicImmune = true;
      if (bf.invis) invis = true;
      if (bf.reveal) revealed = true;
    }
    if (this.protected) invuln = true;
    const s = this.s;
    if (s.maxHp > 0 && a.maxHp !== s.maxHp) this.hp = this.hp * a.maxHp / s.maxHp;
    if (s.maxMana > 0 && a.maxMana !== s.maxMana) this.mana = this.mana * a.maxMana / s.maxMana;
    s.maxHp = a.maxHp; s.maxMana = a.maxMana;
    if (this.hp > s.maxHp) this.hp = s.maxHp;
    if (this.mana > s.maxMana) this.mana = s.maxMana;
    s.damage = a.damage; s.dmgVar = b.dmgVar; s.armor = a.armor;
    s.as = clamp(a.as, -80, 400);
    s.interval = Math.max(0.3, a.interval / (1 + s.as / 100));
    s.range = a.range;
    s.hpRegen = a.hpRegen; s.manaRegen = a.manaRegen; s.spellAmp = a.spellAmp;
    s.evasion = Math.min(0.6, a.evasion); s.crit = a.crit; s.critP = a.critP; s.critPMult = a.critPMult;
    s.magicResist = a.magicResist; s.thorns = a.thorns;
    s.speed = (b.speed <= 0 || stunned || rooted) ? 0 : clamp((a.speed + a.boots) * (1 + a.msPct) * (1 - slow), 100, 550);
    s.slow = slow; s.dmgAmp = dmgAmp; s.dmgRed = dmgRed; s.shield = shield;
    s.stunned = stunned; s.silenced = silenced; s.rooted = rooted; s.invuln = invuln;
    s.magicImmune = magicImmune; s.invis = invis; s.revealed = revealed;
  }

  canAttack(t) {
    if (!t || !t.alive || t.team === this.team || t.s.invuln || t.kind === 'fountain') return false;
    return this.team === NEUTRAL || t.visibleTo[this.team];
  }

  findTarget(range, opts) {
    const g = this.game;
    let best = null, bd = Infinity;
    for (const u of g.units) {
      if (!this.canAttack(u)) continue;
      if (opts && opts.noNeutral && u.kind === 'neutral') continue;
      if (opts && opts.noBuilding && u.isBuilding) continue;
      if (opts && opts.noHero && u.kind === 'hero') continue;
      if (opts && opts.onlyBuilding && !u.isBuilding) continue;
      const d = gapU(this, u);
      if (d > range) continue;
      const score = d + (opts && opts.preferHero && u.kind === 'hero' ? -200 : 0);
      if (score < bd) { bd = score; best = u; }
    }
    return best;
  }

  update(dt) {
    if (!this.alive) return;
    const s = this.s, g = this.game;
    if (this.flash > 0) this.flash -= dt;
    if (this.attackAnim > 0) this.attackAnim = Math.max(0, this.attackAnim - dt * 3.2);
    if (this.attackCd > 0) this.attackCd -= dt;
    if (this.hp < s.maxHp) this.hp = Math.min(s.maxHp, this.hp + s.hpRegen * dt);
    if (this.mana < s.maxMana) this.mana = Math.min(s.maxMana, this.mana + s.manaRegen * dt);
    for (let i = this.buffs.length - 1; i >= 0; i--) {
      const b = this.buffs[i];
      if (!b) continue;
      b.t -= dt;
      if (b.dps || b.heal || b.manaHeal) {
        b.tick += dt;
        while (b.tick >= 0.5) {
          b.tick -= 0.5;
          if (b.dps) dealDamage(g, b.src, this, b.dps * 0.5, b.dmgType || 'magic', { dot: true });
          if (!this.alive) return;
          if (b.heal) healUnit(g, this, b.heal * 0.5, null, true);
          if (b.manaHeal) this.mana = Math.min(s.maxMana, this.mana + b.manaHeal * 0.5);
        }
      }
      if (b.t <= 0) this.buffs.splice(i, 1);
    }
    this.moving = false;
    if (this.busy) {
      if (this.busy.update(dt)) this.busy = null;
      return;
    }
    if (s.stunned) {
      this.windup = 0; this.windupTarget = null; this.casting = null;
      return;
    }
    if (this.casting) { this.updateCasting(dt); return; }
    if (this.windup > 0) {
      this.windup -= dt;
      if (this.windupTarget && this.canAttack(this.windupTarget)) this.facing = angleTo(this, this.windupTarget);
      if (this.windup <= 0) this.finishAttack();
      return;
    }
    if (this.think) this.think(dt);
    this.updateOrder(dt);
  }

  updateOrder(dt) {
    const o = this.order;
    if (!o) { this.idle(dt); return; }
    switch (o.type) {
      case 'move':
        if (this.moveTo(o.x, o.y, dt, o.stop || 6)) this.order = null;
        break;
      case 'attack':
        if (!this.canAttack(o.target) || (o.auto && dist(this.x, this.y, o.ox, o.oy) > 350)) {
          this.order = null;
          this.autoAcquireT = 0;
          this.idle(dt);
        } else this.attackUnit(o.target, dt);
        break;
      case 'amove': {
        if (!o.cur || !this.canAttack(o.cur) || distU(this, o.cur) > this.vision) {
          o.cur = this.findTarget(Math.max(this.s.range + 200, 500), { preferHero: false });
        }
        if (o.cur) this.attackUnit(o.cur, dt);
        else if (this.moveTo(o.x, o.y, dt, 20)) this.order = null;
        break;
      }
      case 'lane':
        this.walkLane(dt);
        break;
      case 'cast':
        this.updateCastOrder(o, dt);
        break;
      default:
        this.order = null;
    }
  }

  idle(dt) {
    if (this.kind !== 'hero') return;
    this.autoAcquireT -= dt;
    if (this.autoAcquireT > 0) return;
    this.autoAcquireT = 0.25;
    const t = this.findTarget(this.s.range + 110, { noNeutral: true });
    if (t) this.order = { type: 'attack', target: t, auto: true, ox: this.x, oy: this.y };
  }

  attackUnit(t, dt) {
    const gap = gapU(this, t);
    if (gap <= this.s.range) {
      this.facing = angleTo(this, t);
      this.path = null;
      if (this.attackCd <= 0) this.startAttack(t);
    } else if (this.isStatic) {
      this.order = null;
    } else {
      this.moveTo(t.x, t.y, dt, 0);
    }
  }

  startAttack(t) {
    this.windupTarget = t;
    this.windupTotal = clamp(this.s.interval * 0.3, 0.1, 0.35);
    this.windup = this.windupTotal;
    this.facing = angleTo(this, t);
  }

  finishAttack() {
    const t = this.windupTarget;
    this.windupTarget = null;
    this.windup = 0;
    if (!t || !this.canAttack(t) || gapU(this, t) > this.s.range + 120) return;
    this.attackCd = Math.max(0.05, this.s.interval - this.windupTotal);
    this.attackAnim = 1;
    const bonus = this.takeAttackBonus ? this.takeAttackBonus() : 0;
    const g = this.game;
    if (this.projectileSpeed > 0) g.spawnAttackProjectile(this, t, bonus);
    else {
      attackHit(g, this, t, bonus);
      if (g.isShown(this)) g.fx('slash', { x: this.x, y: this.y, a: this.facing, r: this.radius + 26, color: this.kind === 'hero' ? this.color : '#ffffff', dur: 0.18 });
    }
    if (g.isShown(this) && this.kind !== 'tower') g.sound(this.projectileSpeed ? 'shoot' : 'hit', this);
  }

  moveTo(tx, ty, dt, stop) {
    const d = dist(this.x, this.y, tx, ty);
    if (d <= stop + 2) { this.path = null; return true; }
    const sp = this.s.speed;
    if (sp <= 0) return false;
    let wx = tx, wy = ty;
    const map = this.game.map;
    if (this.usePathing) {
      this.repathT -= dt;
      if (d > 40 && !map.los(this.x, this.y, tx, ty)) {
        if (!this.path || this.repathT <= 0 || dist(this.pathGoalX, this.pathGoalY, tx, ty) > 80) {
          this.path = map.findPath(this.x, this.y, tx, ty);
          this.pathI = 0; this.pathGoalX = tx; this.pathGoalY = ty;
          this.repathT = 0.7 + Math.random() * 0.5;
        }
        if (this.path && this.path.length) {
          while (this.pathI < this.path.length - 1 && dist(this.x, this.y, this.path[this.pathI].x, this.path[this.pathI].y) < 14) this.pathI++;
          const p = this.path[this.pathI];
          if (this.pathI === this.path.length - 1 && dist(this.x, this.y, p.x, p.y) < 8) { this.path = null; return true; }
          wx = p.x; wy = p.y;
        }
      } else this.path = null;
    }
    const dd = dist(this.x, this.y, wx, wy);
    if (dd < 0.01) return true;
    const step = Math.min(sp * dt, dd);
    const moved = this.tryMove(this.x + (wx - this.x) / dd * step, this.y + (wy - this.y) / dd * step);
    this.facing = Math.atan2(wy - this.y, wx - this.x);
    if (moved) { this.moving = true; this.walkT += dt * sp / 40; }
    return false;
  }

  tryMove(nx, ny) {
    const map = this.game.map;
    if (!map.blocked(nx, ny) || map.blocked(this.x, this.y)) { this.x = nx; this.y = ny; return true; }
    if (!map.blocked(nx, this.y)) { this.x = nx; return true; }
    if (!map.blocked(this.x, ny)) { this.y = ny; return true; }
    return false;
  }

  walkLane(dt) {
    const pts = this.lanePts;
    if (!pts) { this.order = null; return; }
    const p = pts[this.laneI];
    if (!p) { this.order = null; return; }
    if (dist(this.x, this.y, p.x, p.y) < 90 && this.laneI < pts.length - 1) this.laneI++;
    this.moveTo(p.x + this.laneOff, p.y - this.laneOff, dt, 0);
  }

  // --- Применение способностей и предметов ---
  castInfo() { return null; }

  updateCastOrder(o, dt) {
    const info = this.castInfo(o);
    const why = info ? this.castBlock(o, info) : 'none';
    if (why) { this.order = o.prev || null; if (this.onCastFail) this.onCastFail(why); return; }
    if (info.type === 'unit') {
      const t = o.target;
      const enemy = t && t.team !== this.team;
      if (!t || !t.alive || (enemy && (!t.visibleTo[this.team] || t.s.invuln)) || (enemy && info.magic !== false && t.s.magicImmune && info.def.blockedByImmune !== false)) {
        this.order = o.prev || null; return;
      }
      if (gapU(this, t) <= info.range + 12) this.beginCast(o, info, t.x, t.y);
      else this.moveTo(t.x, t.y, dt, 0);
    } else if (info.type === 'point') {
      const d = dist(this.x, this.y, o.x, o.y);
      if (info.clamp || d <= info.range + 4) this.beginCast(o, info, o.x, o.y);
      else this.moveTo(o.x, o.y, dt, info.range - 4);
    } else {
      this.beginCast(o, info, this.x + Math.cos(this.facing), this.y + Math.sin(this.facing));
    }
  }

  beginCast(o, info, fx, fy) {
    if (fx !== this.x || fy !== this.y) this.facing = Math.atan2(fy - this.y, fx - this.x);
    this.casting = { o, info, t: info.castPoint };
    this.path = null;
    if (this.casting.t <= 0) this.updateCasting(0);
  }

  updateCasting(dt) {
    const c = this.casting;
    c.t -= dt;
    if (c.t > 0) return;
    this.casting = null;
    const o = c.o;
    const info = this.castInfo(o);
    if (!info || this.castBlock(o, info)) { this.order = o.prev || null; return; }
    this.order = o.prev || null;
    this.executeCast(o, info);
  }
}

class Hero extends Unit {
  constructor(game, def, team, x, y, opts) {
    super(game, {
      kind: 'hero', team, x, y, radius: 24, hp: def.hp, mana: def.mana, damage: def.damage, dmgVar: 3,
      armor: def.armor, range: def.range, interval: def.interval, speed: def.speed, hpRegen: def.hpRegen,
      manaRegen: def.manaRegen, projectileSpeed: def.projectileSpeed, vision: 1150, magicResist: 0.25,
      usePathing: true, color: def.color, name: def.name,
    });
    this.def = def;
    this.level = 1; this.xp = 0; this.gold = START_GOLD; this.skillPoints = 1;
    this.abilities = def.abilities.map(id => ({ id, def: ABILITIES[id], lv: 0, cd: 0 }));
    this.items = [null, null, null, null, null, null];
    this.kills = 0; this.deaths = 0; this.assists = 0; this.lastHits = 0; this.streak = 0;
    this.dmgDealt = 0;
    this.respawnT = 0;
    this.isPlayer = !!(opts && opts.isPlayer);
    this.brain = null;
    this.dmgBy = new Map();
    this.blinkLockT = 0;
    this.deliveries = [];
    this.goldMult = 1; this.xpMult = 1;
    this.recalc();
    this.hp = this.s.maxHp; this.mana = this.s.maxMana;
  }

  addOwnStats(a) {
    const d = this.def;
    if (!d) return;
    const L = this.level - 1;
    a.maxHp = d.hp + d.hpGain * L;
    a.maxMana = d.mana + d.manaGain * L;
    a.damage = d.damage + d.damageGain * L;
    a.armor = d.armor + d.armorGain * L;
    a.as += d.asGain * L;
    a.hpRegen = d.hpRegen + d.hpRegenGain * L;
    a.manaRegen = d.manaRegen + d.manaRegenGain * L;
    let evadeKeep = 1;
    for (const it of this.items) {
      if (!it) continue;
      const st = ITEMS[it.id].stats;
      if (!st) continue;
      if (st.hp) a.maxHp += st.hp;
      if (st.mana) a.maxMana += st.mana;
      if (st.damage) a.damage += st.damage;
      if (st.armor) a.armor += st.armor;
      if (st.attackSpeed) a.as += st.attackSpeed;
      if (st.hpRegen) a.hpRegen += st.hpRegen;
      if (st.manaRegen) a.manaRegen += st.manaRegen;
      if (st.spellAmp) a.spellAmp += st.spellAmp;
      if (st.evasion) evadeKeep *= 1 - st.evasion;
      if (st.crit) a.crit = Math.max(a.crit, st.crit);
      if (st.boots) a.boots = Math.max(a.boots, st.boots);
    }
    a.evasion = 1 - evadeKeep;
    for (const ab of this.abilities) if (ab.lv > 0 && ab.def.passiveStats) ab.def.passiveStats(a, ab.lv);
  }

  get netWorth() {
    let w = this.gold;
    for (const it of this.items) if (it) w += ITEMS[it.id].cost * (it.charges || 1);
    return w;
  }

  update(dt) {
    if (this.deliveries.length) this.updateDeliveries(dt);
    if (!this.alive) {
      this.respawnT -= dt;
      if (this.respawnT <= 0 && this.game.winner < 0) this.game.respawnHero(this);
      return;
    }
    for (const ab of this.abilities) if (ab.cd > 0) ab.cd = Math.max(0, ab.cd - dt);
    for (const it of this.items) if (it && it.cd > 0) it.cd = Math.max(0, it.cd - dt);
    if (this.blinkLockT > 0) this.blinkLockT -= dt;
    if (this.aegisUntil && this.game.time > this.aegisUntil) { this.aegisUntil = 0; this.removeItem('aegis'); }
    super.update(dt);
  }

  addGold(n) { this.gold += n; }

  addXp(n) {
    if (this.level >= MAX_LEVEL) return;
    this.xp += n;
    let leveled = false;
    while (this.level < MAX_LEVEL && this.xp >= XP_TABLE[this.level]) {
      this.level++;
      this.skillPoints++;
      leveled = true;
    }
    if (leveled) {
      this.recalc();
      this.game.onLevelUp(this);
    }
  }

  canLevel(i) {
    const ab = this.abilities[i];
    if (!ab || this.skillPoints <= 0) return false;
    const def = ab.def;
    if (ab.lv >= def.maxLv) return false;
    if (def.ult) return this.level >= 6 * (ab.lv + 1);
    return ab.lv < Math.ceil(this.level / 2);
  }
  levelAbility(i) {
    if (!this.canLevel(i)) return false;
    this.abilities[i].lv++;
    this.skillPoints--;
    this.recalc();
    return true;
  }

  // --- предметы ---
  freeSlot() { return this.items.indexOf(null); }
  removeItem(id) {
    const i = this.itemSlot(id);
    if (i >= 0) { this.items[i] = null; this.recalc(); }
  }
  hasItem(id) { return this.items.some(it => it && it.id === id); }
  itemSlot(id) { return this.items.findIndex(it => it && it.id === id); }
  inShop() {
    const f = this.game.map.bases[this.team].fountain;
    return !this.alive || dist(this.x, this.y, f.x, f.y) <= SHOP_RADIUS;
  }
  canBuy(id) {
    const def = ITEMS[id];
    if (!def) return 'нет предмета';
    if (this.gold < def.cost) return 'Недостаточно золота';
    if (this.inShop() && def.consumable) {
      const s = this.itemSlot(id);
      if (s >= 0 && this.items[s].charges < def.maxCharges) return null;
    }
    const free = this.items.filter(it => !it).length - this.deliveries.length;
    if (free <= 0 && !(id === 'windboots' && this.hasItem('boots') && this.inShop())) return 'Инвентарь полон';
    return null;
  }
  buyItem(id) {
    const why = this.canBuy(id);
    if (why) return why;
    const def = ITEMS[id];
    this.gold -= def.cost;
    if (!this.inShop()) {
      this.deliveries.push({ id, t: COURIER_TIME });
      return null;
    }
    this.giveItem(id);
    return null;
  }
  // Кладёт предмет в инвентарь; false, если некуда.
  giveItem(id) {
    const def = ITEMS[id];
    if (id === 'windboots' && this.hasItem('boots')) this.sellItem(this.itemSlot('boots'), true);
    if (def.consumable) {
      const s = this.itemSlot(id);
      if (s >= 0 && this.items[s].charges < def.maxCharges) { this.items[s].charges++; return true; }
    }
    const slot = this.freeSlot();
    if (slot < 0) return false;
    this.items[slot] = { id, charges: def.consumable ? 1 : 0, cd: 0 };
    this.recalc();
    return true;
  }
  updateDeliveries(dt) {
    for (let i = this.deliveries.length - 1; i >= 0; i--) {
      const d = this.deliveries[i];
      d.t -= dt;
      if (d.t <= 0 && this.giveItem(d.id)) {
        this.deliveries.splice(i, 1);
        if (this.isPlayer) this.game.emit('delivered', d.id);
      }
    }
  }
  sellItem(slot, silent) {
    const it = this.items[slot];
    if (!it || ITEMS[it.id].noSell) return false;
    if (!silent && !this.inShop()) return false;
    const def = ITEMS[it.id];
    this.gold += Math.floor(def.cost * (def.consumable ? it.charges : 1) * 0.5);
    this.items[slot] = null;
    this.recalc();
    return true;
  }
  swapItems(a, b) {
    const t = this.items[a]; this.items[a] = this.items[b]; this.items[b] = t;
  }

  // --- приказы ---
  cancelChannel() {
    if (this.busy && this.busy.interruptible) {
      if (this.busy.cancel) this.busy.cancel();
      this.busy = null;
    }
  }
  orderMove(x, y) {
    this.order = { type: 'move', x, y };
    this.windup = 0; this.windupTarget = null; this.casting = null;
  }
  orderAttack(t) {
    this.casting = null;
    if (this.order && this.order.type === 'attack' && this.order.target === t && !this.order.auto) return;
    this.order = { type: 'attack', target: t };
  }
  orderAttackMove(x, y) {
    this.casting = null;
    this.order = { type: 'amove', x, y, cur: null };
  }
  orderStop() {
    this.order = null; this.windup = 0; this.windupTarget = null; this.path = null; this.casting = null;
    this.autoAcquireT = 0.8;
  }
  orderCast(slot, tgt, isItem) {
    const cur = this.order;
    const prev = cur && (cur.type === 'attack' || cur.type === 'amove') && !cur.auto ? cur : (cur && cur.type === 'cast' ? cur.prev : null);
    this.casting = null;
    this.order = {
      type: 'cast', slot, item: !!isItem, target: tgt.unit || null,
      x: tgt.unit ? tgt.unit.x : tgt.x, y: tgt.unit ? tgt.unit.y : tgt.y, prev, t0: this.game.time,
    };
  }

  castInfo(o) {
    if (o.item) {
      const it = this.items[o.slot];
      if (!it) return null;
      const act = ITEM_ACTIVES[ITEMS[it.id].active];
      if (!act) return null;
      return { def: act, lv: 1, type: act.type, range: act.range || 0, clamp: !!act.clamp, castPoint: act.castPoint || 0, it };
    }
    const ab = this.abilities[o.slot];
    if (!ab || ab.lv === 0) return null;
    const def = ab.def;
    return { def, lv: ab.lv, type: def.type, range: LV(def.range, ab.lv) || 0, clamp: !!def.clamp, castPoint: def.castPoint ?? 0.2, ab };
  }

  // Причина, по которой нельзя применить, или null.
  castBlock(o, info) {
    if (!this.alive) return 'dead';
    if (this.s.stunned) return 'Вы оглушены';
    if (o.item) {
      const it = info.it;
      if (it.cd > 0) return 'Предмет перезаряжается';
      if (info.def.canUse) { const w = info.def.canUse(this); if (w) return w; }
      return null;
    }
    const ab = info.ab;
    if (info.type === 'passive') return 'Пассивная способность';
    if (this.s.silenced) return 'Безмолвие';
    if (ab.cd > 0) return 'Способность перезаряжается';
    if (this.mana < LV(ab.def.mana, ab.lv)) return 'Недостаточно маны';
    return null;
  }

  executeCast(o, info) {
    const g = this.game;
    let tgt;
    if (info.type === 'unit') tgt = { unit: o.target, x: o.target.x, y: o.target.y };
    else if (info.type === 'point') {
      let x = o.x, y = o.y;
      const d = dist(this.x, this.y, x, y);
      if (info.clamp && d > info.range) {
        x = this.x + (x - this.x) / d * info.range;
        y = this.y + (y - this.y) / d * info.range;
      }
      tgt = { x, y };
    } else tgt = { x: this.x, y: this.y };
    if (o.item) {
      const it = info.it;
      it.cd = info.def.cd || 0;
      if (ITEMS[it.id].consumable) {
        it.charges--;
        if (it.charges <= 0) this.items[o.slot] = null;
      }
      info.def.cast(g, this, 1, tgt);
      if (info.def.breaksInvis !== false) this.breakInvis();
    } else {
      const ab = info.ab;
      this.mana -= LV(ab.def.mana, ab.lv);
      ab.cd = LV(ab.def.cd, ab.lv);
      if (ab.def.keepInvis !== true) this.breakInvis();
      ab.def.cast(g, this, ab.lv, tgt);
      g.onCast(this, ab);
    }
  }

  breakInvis() {
    if (findBuff(this, 'veil')) removeBuff(this, 'veil');
  }
  takeAttackBonus() {
    const b = findBuff(this, 'veil');
    if (!b) return 0;
    const bonus = b.bonus || 0;
    removeBuff(this, 'veil');
    return bonus;
  }
}
