'use strict';
// Поведение крипов, башен, нейтралов и ботов-героев.

function creepThink(dt) {
  const g = this.game;
  const o = this.order;
  if (o && o.type === 'attack' && !this.canAttack(o.target)) { this.order = null; this.thinkT = 0; }
  this.thinkT -= dt;
  if (this.thinkT > 0) return;
  this.thinkT = 0.28 + Math.random() * 0.12;
  const ft = this.forceTarget;
  if (ft && g.time < this.forceUntil && this.canAttack(ft) && distU(this, ft) < 900) {
    if (!o || o.target !== ft) this.order = { type: 'attack', target: ft };
    return;
  }
  this.forceTarget = null;
  const off = projectOnPolyline(this.lanePts, this.x, this.y).off;
  const cur = o && o.type === 'attack' ? o.target : null;
  if (cur && this.canAttack(cur) && !cur.isBuilding && gapU(this, cur) < 600 && (cur.kind !== 'hero' || off < 420)) {
    if (cur.kind !== 'hero') return;
    const alt = this.findTarget(420, { noNeutral: true, noBuilding: true, noHero: true });
    if (!alt) return;
  }
  let t = this.findTarget(520, { noNeutral: true, noBuilding: true, noHero: true });
  if (!t && off < 420) t = this.findTarget(480, { noNeutral: true, noBuilding: true });
  if (!t) t = this.findTarget(650, { onlyBuilding: true });
  if (t) {
    if (t !== cur) this.order = { type: 'attack', target: t };
    return;
  }
  if (!o || o.type !== 'lane') {
    const along = projectOnPolyline(this.lanePts, this.x, this.y).along;
    let i = 1;
    while (i < this.lanePts.length - 1 && this.laneCum[i] < along + 40) i++;
    this.laneI = i;
    this.order = { type: 'lane' };
  }
}

function towerThink() {
  const g = this.game;
  const o = this.order;
  let t = o && o.type === 'attack' ? o.target : null;
  if (t && (!this.canAttack(t) || gapU(this, t) > this.s.range)) t = null;
  const ft = this.forceTarget;
  if (ft && g.time < this.forceUntil && this.canAttack(ft) && gapU(this, ft) <= this.s.range) t = ft;
  if (!t) t = this.findTarget(this.s.range, { noNeutral: true });
  if (!t) this.order = null;
  else if (!o || o.target !== t) this.order = { type: 'attack', target: t };
}

function neutralThink() {
  const g = this.game, home = this.home;
  const t = this.aggro;
  const dHome = dist(this.x, this.y, home.x, home.y);
  if (t && this.canAttack(t) && dHome < 700 && g.time - this.aggroT < 6) {
    if (!this.order || this.order.target !== t) this.order = { type: 'attack', target: t };
    return;
  }
  this.aggro = null;
  if (dHome > 24) {
    if (!this.order || this.order.type !== 'move') this.order = { type: 'move', x: home.x, y: home.y, stop: 10 };
    this.returning = true;
  } else if (this.returning) {
    this.returning = false;
    this.hp = this.s.maxHp;
    this.order = null;
  }
}

function bossThink(dt) {
  const g = this.game, home = this.home;
  this.slamT -= dt;
  const t = this.aggro;
  const dHome = dist(this.x, this.y, home.x, home.y);
  if (t && this.canAttack(t) && dHome < 650 && g.time - this.aggroT < 7) {
    if (!this.order || this.order.target !== t) this.order = { type: 'attack', target: t };
    if (this.slamT <= 0 && enemiesInRadius(g, NEUTRAL, this.x, this.y, 270).some(u => u.team !== NEUTRAL)) {
      this.slamT = 7;
      for (const u of enemiesInRadius(g, NEUTRAL, this.x, this.y, 270)) {
        dealDamage(g, this, u, 110, 'phys');
        addBuff(u, 'golemslam', 2, { slow: 0.35, chill: true }, this);
      }
      g.fx('ring', { x: this.x, y: this.y, r0: 30, r1: 280, color: '#c0c8d4', width: 14, dur: 0.5 });
      g.fx('cracks', { x: this.x, y: this.y, r: 270, dur: 1.2 });
      g.burst(this.x, this.y, '#7a7f88', 24, 240, 0.8, 5, false);
      if (g.isShown(this)) g.shake(6);
      g.sound('boom', this);
    }
    return;
  }
  this.aggro = null;
  if (dHome > 24) {
    if (!this.order || this.order.type !== 'move') this.order = { type: 'move', x: home.x, y: home.y, stop: 10 };
    this.returning = true;
  } else if (this.returning) {
    this.returning = false;
    this.hp = this.s.maxHp;
    this.order = null;
  }
}

function heroPower(u) {
  return (u.hp / u.s.maxHp) * (u.level + 4) * (1 + u.netWorth / 9000);
}

function autoLevel(h) {
  let guard = 6;
  while (h.skillPoints > 0 && guard--) {
    if (h.canLevel(3)) { h.levelAbility(3); continue; }
    let done = false;
    for (const i of h.def.skillOrder) if (h.abilities[i].lv === 0 && h.canLevel(i)) { h.levelAbility(i); done = true; break; }
    if (!done) for (const i of h.def.skillOrder) if (h.canLevel(i)) { h.levelAbility(i); done = true; break; }
    if (!done) break;
  }
}

class HeroBrain {
  constructor(g, h, lane) {
    this.g = g; this.h = h; this.lane = lane;
    this.diff = g.playerTeam === h.team ? DIFFICULTY.normal : g.diff;
    this.thinkT = Math.random() * 0.4;
    this.state = 'lane';
    this.buildI = 0;
    this.focus = null;
    this.offX = rand(-80, 80); this.offY = rand(-80, 80);
    this.ctx = { enemyHeroes: [], allyHeroes: [], enemyCreeps: [], allyCreeps: [] };
  }

  update(dt) {
    this.thinkT -= dt;
    if (this.thinkT > 0) return;
    this.thinkT = this.diff.think * rand(0.8, 1.25);
    const h = this.h;
    if (!h.alive) { this.state = 'lane'; this.focus = null; return; }
    autoLevel(h);
    this.think();
  }

  scan() {
    const g = this.g, h = this.h, c = this.ctx;
    c.enemyHeroes.length = 0; c.allyHeroes.length = 0; c.enemyCreeps.length = 0; c.allyCreeps.length = 0;
    let ap = 0, ep = 0;
    for (const u of g.heroes) {
      if (!u.alive) continue;
      const d = dist(h.x, h.y, u.x, u.y);
      if (u.team === h.team) {
        if (d < 1300) { c.allyHeroes.push(u); ap += heroPower(u); }
      } else if (d < 1400 && u.visibleTo[h.team] && !u.s.invuln) {
        c.enemyHeroes.push(u); ep += heroPower(u);
      }
    }
    for (const u of g.units) {
      if (!u.alive || u.kind !== 'creep') continue;
      if (dist(h.x, h.y, u.x, u.y) > 950) continue;
      if (u.team === h.team) c.allyCreeps.push(u);
      else if (u.visibleTo[h.team]) c.enemyCreeps.push(u);
    }
    c.allyPower = ap; c.enemyPower = ep;
    c.hpPct = h.hp / h.s.maxHp;
    c.manaPct = h.s.maxMana ? h.mana / h.s.maxMana : 1;
    c.focus = this.focus && this.focus.alive ? this.focus : null;
    let tw = null, td = 1150;
    for (const b of g.buildings) {
      if (!b.alive || b.team === h.team || b.kind === 'fountain') continue;
      const d = dist(h.x, h.y, b.x, b.y);
      if (d < td && b.kind === 'tower') { td = d; tw = b; }
    }
    c.enemyTower = tw;
    c.towerTarget = !!(tw && tw.order && tw.order.target === h);
    return c;
  }

  nearEnemies(c, r) {
    const h = this.h;
    return c.enemyHeroes.some(e => dist(h.x, h.y, e.x, e.y) < r);
  }

  think() {
    const g = this.g, h = this.h;
    if (h.busy || h.casting) return;
    if (h.order && h.order.type === 'cast') {
      if (g.time - h.order.t0 < 2.5) return;
      h.order = null;
    }
    const f = g.map.bases[h.team].fountain;
    const dF = dist(h.x, h.y, f.x, f.y);
    this.shop();
    const c = this.scan();
    if (this.useItems(c, dF)) return;

    if (this.state === 'retreat') {
      if (dF < 450 && ((c.hpPct > 0.92 && c.manaPct > 0.55) || c.hpPct > 0.99)) {
        this.state = 'lane';
      } else {
        if (c.enemyHeroes.length && this.tryCast(c, true)) return;
        if (dF > 3000 && !this.nearEnemies(c, 1000) && this.useTp(f.x, f.y)) return;
        if (dF < 250) { if (h.order) h.orderStop(); return; }
        h.orderMove(f.x, f.y);
        return;
      }
    }
    const danger = c.enemyHeroes.length > 0 && c.enemyPower > c.allyPower * 1.5;
    if (c.hpPct < this.diff.retreat || (c.hpPct < 0.45 && danger) || (c.towerTarget && c.hpPct < 0.45)) {
      this.state = 'retreat';
      this.focus = null;
      if (c.enemyHeroes.length && this.tryCast(c, true)) return;
      h.orderMove(f.x, f.y);
      return;
    }
    if (dF < 900 && c.hpPct > 0.85) {
      const fp = this.frontPoint();
      if (dist(h.x, h.y, fp.x, fp.y) > 3300 && this.useTp(fp.x, fp.y)) return;
    }
    const tgt = this.pickTarget(c);
    if (tgt) {
      this.focus = tgt; c.focus = tgt;
      if (this.tryCast(c, false)) return;
      h.orderAttack(tgt);
      return;
    }
    this.focus = null; c.focus = null;
    if (c.enemyCreeps.length >= 3 && c.manaPct > 0.6 && !c.enemyHeroes.length && this.tryCast(c, false)) return;
    this.laneLogic(c);
  }

  pickTarget(c) {
    const g = this.g, h = this.h;
    if (!c.enemyHeroes.length) return null;
    const myPct = c.hpPct;
    const strong = c.allyPower * this.diff.aggro >= c.enemyPower * 0.9;
    let best = null, bs = Infinity;
    for (const e of c.enemyHeroes) {
      const d = dist(h.x, h.y, e.x, e.y);
      const ePct = e.hp / e.s.maxHp;
      const reach = h.s.range + h.radius + e.radius;
      if (g.enemyTowerCovering(h.team, e.x, e.y) && !(ePct < 0.2 && myPct > 0.6) && !(c.allyPower > c.enemyPower * 2.2 && myPct > 0.6)) continue;
      const killable = ePct < 0.3 && myPct > 0.35;
      let ok;
      if (strong) ok = d < (h.level < 4 ? reach + 250 : 900);
      else ok = killable && d < 800;
      if (!ok) continue;
      const s = ePct * 100 + d / 15 + (e === this.focus ? -25 : 0);
      if (s < bs) { bs = s; best = e; }
    }
    return best;
  }

  tryCast(c, escaping) {
    const h = this.h;
    if (h.s.silenced) return false;
    for (const i of [3, 0, 1, 2]) {
      const ab = h.abilities[i];
      if (!ab.lv || ab.def.type === 'passive' || ab.cd > 0 || !ab.def.ai) continue;
      if (h.mana < LV(ab.def.mana, ab.lv)) continue;
      if (Math.random() > this.diff.cast) continue;
      const tgt = ab.def.ai(this.g, h, ab.lv, c, escaping);
      if (tgt) { h.orderCast(i, tgt, false); return true; }
    }
    return false;
  }

  useTp(x, y) {
    const h = this.h, g = this.g;
    const s = h.itemSlot('tp');
    if (s < 0 || h.items[s].cd > 0) return false;
    const dest = g.nearestAllyBuilding(h.team, x, y);
    if (!dest || dist(dest.x, dest.y, h.x, h.y) < 2200) return false;
    h.orderCast(s, { x, y }, true);
    return true;
  }

  useItems(c, dF) {
    const h = this.h, g = this.g;
    const ready = id => { const s = h.itemSlot(id); return s >= 0 && h.items[s].cd <= 0 ? s : -1; };
    let s = ready('salve');
    if (s >= 0 && c.hpPct < 0.5 && dF > 1500 && !findBuff(h, 'salve') && !this.nearEnemies(c, 700)) {
      h.orderCast(s, { x: h.x, y: h.y }, true); return true;
    }
    s = ready('clarity');
    if (s >= 0 && c.manaPct < 0.35 && dF > 1500 && !findBuff(h, 'clarity') && !this.nearEnemies(c, 700)) {
      h.orderCast(s, { x: h.x, y: h.y }, true); return true;
    }
    s = ready('bkb');
    if (s >= 0 && this.focus && c.enemyHeroes.length >= 2 && !h.s.magicImmune) {
      h.orderCast(s, { x: h.x, y: h.y }, true); return true;
    }
    s = ready('blink');
    if (s >= 0 && h.blinkLockT <= 0) {
      if (this.state === 'retreat' && this.nearEnemies(c, 650)) {
        h.orderCast(s, aiEscapePoint(g, h, 1100), true); return true;
      }
      const f = this.focus;
      if (f && f.alive && (h.def.id === 'titan' || h.def.id === 'thunder')) {
        const d = dist(h.x, h.y, f.x, f.y);
        const ab = h.abilities[h.def.id === 'titan' ? 0 : 1];
        if (d > 450 && d < 1100 && ab.lv && ab.cd <= 0 && h.mana >= LV(ab.def.mana, ab.lv)) {
          h.orderCast(s, { x: f.x, y: f.y }, true); return true;
        }
      }
    }
    return false;
  }

  currentLane() {
    const plan = this.g.teamPlan[this.h.team];
    return this.g.time > 900 && plan ? plan : this.lane;
  }

  frontPoint() {
    const g = this.g, h = this.h;
    const lane = this.currentLane();
    const along = g.laneFront[h.team][lane];
    const pts = g.lanePaths[h.team][lane];
    const back = h.s.range > 200 ? 300 : 170;
    const p = pointAlong(pts, Math.max(0, along - back));
    return g.map.nearestFree(p.x + this.offX, p.y + this.offY);
  }

  moveNear(p, tol) {
    const h = this.h;
    if (dist(h.x, h.y, p.x, p.y) > tol) h.orderMove(p.x, p.y);
    else if (h.order && h.order.type !== 'move') h.orderStop();
  }

  laneLogic(c) {
    const h = this.h;
    const front = this.frontPoint();
    const tw = c.enemyTower;
    let tanked = false;
    if (tw) {
      let n = 0;
      for (const cr of c.allyCreeps) if (dist(cr.x, cr.y, tw.x, tw.y) < TOWER_RANGE + 20) n++;
      tanked = n >= 2 && !(tw.order && tw.order.target && tw.order.target.kind === 'hero');
      const inRange = gapU(h, tw) <= TOWER_RANGE + 60;
      if (inRange && (c.towerTarget || !tanked)) {
        const d = dist(h.x, h.y, tw.x, tw.y) || 1;
        h.orderMove(h.x + (h.x - tw.x) / d * 380, h.y + (h.y - tw.y) / d * 380);
        return;
      }
    }
    const safe = u => !tw || tanked || dist(u.x, u.y, tw.x, tw.y) > TOWER_RANGE + 60;
    if (c.enemyCreeps.length) {
      let lh = null, low = null;
      for (const cr of c.enemyCreeps) {
        if (!safe(cr)) continue;
        const dmg = h.s.damage * armorMult(cr.s.armor);
        if (cr.hp <= dmg * 1.05 && (!lh || cr.hp < lh.hp)) lh = cr;
        if (!low || cr.hp < low.hp) low = cr;
      }
      if (lh && Math.random() < this.diff.lastHit) { h.orderAttack(lh); return; }
      const pushing = !c.enemyHeroes.length || c.allyPower > c.enemyPower * 1.3 || h.level >= 10;
      if (low && pushing) { h.orderAttack(low); return; }
      if (low && low.hp < h.s.damage * 2.2 && gapU(h, low) <= h.s.range + 60) {
        this.moveNear({ x: h.x, y: h.y }, 999);
        return;
      }
      this.moveNear(front, 130);
      return;
    }
    if (tw && tanked && !tw.s.invuln) { h.orderAttack(tw); return; }
    const b = this.siegeTarget(c);
    if (b) { h.orderAttack(b); return; }
    this.moveNear(front, 130);
  }

  siegeTarget(c) {
    const g = this.g, h = this.h;
    let best = null, bd = 950;
    for (const b of g.buildings) {
      if (!b.alive || b.team === h.team || b.kind === 'fountain' || b.s.invuln) continue;
      const d = dist(h.x, h.y, b.x, b.y);
      if (d > bd) continue;
      let n = 0;
      for (const cr of c.allyCreeps) if (dist(cr.x, cr.y, b.x, b.y) < TOWER_RANGE + 40) n++;
      const free = b.kind === 'ancient' || !(b.order && b.order.target);
      if (n >= 2 || (free && c.allyHeroes.length >= 2)) { bd = d; best = b; }
    }
    return best;
  }

  shop() {
    const h = this.h, g = this.g;
    if (g.time > 120 && !h.hasItem('tp') && h.gold >= ITEMS.tp.cost && this.ensureSlot(ITEMS.tp.cost, 'tp')) h.buyItem('tp');
    const build = h.def.build;
    let guard = 10;
    while (this.buildI < build.length && guard--) {
      const id = build[this.buildI];
      const def = ITEMS[id];
      if (!def.consumable && h.hasItem(id)) { this.buildI++; continue; }
      if (h.gold < def.cost) break;
      if (!this.ensureSlot(def.cost, id)) break;
      if (h.buyItem(id)) break;
      this.buildI++;
    }
    if (g.time < 600 && h.gold > 350 && !h.hasItem('salve') && this.buildI > 1 && !h.deliveries.length) h.buyItem('salve');
  }

  ensureSlot(cost, id) {
    const h = this.h;
    if (h.items.filter(it => !it).length > h.deliveries.length) return true;
    if (!h.inShop()) return false;
    if (id === 'windboots' && h.hasItem('boots')) return true;
    const def = ITEMS[id];
    if (def && def.consumable) {
      const s = h.itemSlot(id);
      if (s >= 0 && h.items[s].charges < def.maxCharges) return true;
    }
    let worst = -1, wc = Infinity;
    h.items.forEach((it, i) => {
      if (!it || it.id === 'tp' || ITEMS[it.id].noSell) return;
      const d = ITEMS[it.id];
      const c = d.cost * (d.consumable ? it.charges : 1);
      if (c < wc) { wc = c; worst = i; }
    });
    if (worst >= 0 && wc < cost) { h.sellItem(worst); return true; }
    return false;
  }
}
