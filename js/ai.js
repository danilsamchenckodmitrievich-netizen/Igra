'use strict';
// ИИ соперничающих держав: хозяйство, найм, оборона, захват вольных и вражеских городов.

const AI = {
  update(g, dt) {
    for (const k of g.kingdoms) {
      if ((k.isPlayer && !g.opts.spectate) || k.bandit || !k.alive) continue;
      k.ai.nextThink -= dt;
      if (k.ai.nextThink > 0) continue;
      k.ai.nextThink = g.diff.think * g.rng.range(0.8, 1.2);
      this.think(g, k);
    }
  },

  think(g, k) {
    const cities = g.citiesOf(k.id);
    if (!cities.length) return;
    const inc = g.income(k).total;
    const ctx = { cities, inc, threats: this.threats(g, k, cities) };
    this.economy(g, k, ctx);
    this.recruit(g, k, ctx);
    this.military(g, k, ctx);
  },

  // Оценка силы обороны города.
  cityDefense(g, c) {
    let p = unitPower(c.garrison);
    if (c.owner !== -1) p += Math.floor(c.pop * 0.05) * 5;
    if (c.walls > 0) p *= 1 + WALLS[c.walls].bonus * (c.wallHp > 0 ? 1 : 0.3) + (c.wallHp > 0 ? c.wallHp / 900 : 0);
    if (c.towers) p += TOWERS[c.towers].dps * 14;
    return p;
  },

  threats(g, k, cities) {
    const out = [];
    for (const a of g.armies) {
      if (a.owner === k.id) continue;
      let near = null, nd = 12;
      for (const c of cities) {
        const d = dist(a.x, a.y, c.x + 0.5, c.y + 0.5);
        const aimed = a.dest && a.dest.kind === 'city' && a.dest.id === c.id;
        if ((aimed && d < 22) || d < nd) { if (!near || d < nd) { nd = d; near = c; } }
      }
      if (near) out.push({ army: a, city: near, power: unitPower(a.units), d: nd });
    }
    return out;
  },

  // ---------- хозяйство ----------
  trade(g, k, ctx) {
    for (const r of ['wood', 'stone', 'food']) {
      const keep = r === 'food' ? 500 : 450;
      if (k.res[r] > keep + 200) g.trade(k, r, Math.floor(k.res[r] - keep), true);
    }
    if (k.res.iron < 60 && ctx.inc.iron < 4 && k.res.gold > 450 && g.time > 300) g.trade(k, 'iron', 60, false);
  },

  economy(g, k, ctx) {
    const { inc } = ctx;
    this.trade(g, k, ctx);
    const armyPower = this.totalPower(g, k);
    const wantArmy = this.wantedPower(g, k);
    const saving = armyPower < wantArmy * 0.6 && g.time > 120;
    for (const c of ctx.cities) {
      if (c.construction || c.siegeBy) continue;
      const choice = this.pickBuild(g, k, c, inc, ctx);
      if (!choice) continue;
      const info = g.buildInfo(c, choice.kind, choice.id);
      if (!info || info.block) continue;
      // при нехватке войска оставляем золото на найм
      if (saving && choice.prio < 8 && k.res.gold - (info.cost.gold || 0) < 150) continue;
      if (g.startBuild(c, choice.kind, choice.id) === null) inc.gold -= 0;
    }
  },

  pickBuild(g, k, c, inc, ctx) {
    const opts = [];
    const add = (kind, id, prio) => {
      const info = g.buildInfo(c, kind, id);
      if (!info || info.block) return;
      opts.push({ kind, id, prio, info });
    };
    const lv = id => c.buildings[id] || 0;
    const tf = id => g.terrainFactor(c, id);
    const frontier = ctx.threats.some(t => t.city === c) || g.cities.some(o => o.owner !== k.id && o.owner !== -1 && dist(o.x, o.y, c.x, c.y) < 16);
    if (inc.food < 15) add('building', 'farm', 10 + (lv('farm') ? 0 : 2));
    else if (inc.food < 35) add('building', 'farm', 5);
    if ((inc.wood < 30 || k.res.wood < 80) && tf('lumber') > 0.3) add('building', 'lumber', 8);
    if (inc.stone < 14 && tf('quarry') > 0.35) add('building', 'quarry', 5);
    if (inc.iron < 10 && tf('mine') > 0.3 && g.time > 60) add('building', 'mine', 6);
    if (c.isCapital || c.level >= 3) {
      add('building', 'barracks', lv('barracks') ? 4 : 9);
      add('building', 'range', lv('range') ? 3 : 7);
      if (g.time > 240) add('building', 'stable', 4);
      if (g.time > 360) add('building', 'workshop', 4);
    }
    add('building', 'market', 4);
    if (inc.wood > 25 && inc.iron > 10 && g.time > 300) add('building', 'factory', 4);
    if (this.usedAll(g, c)) add('level', null, 6 + (c.isCapital ? 2 : 0));
    else if (c.level < 3 && g.time > 300) add('level', null, 3);
    if (frontier || c.isCapital) {
      add('walls', null, frontier ? 8 : 4);
      add('towers', null, frontier ? 6 : 3);
    }
    if (!opts.length) return null;
    // самое важное из доступного по деньгам; дорогое откладываем
    opts.sort((a, b) => b.prio - a.prio);
    for (const o of opts) if (g.canAfford(k, o.info.cost)) return o;
    return null;
  },
  usedAll(g, c) { return g.usedSlots(c) >= CITY_LEVELS[c.level].slots; },

  // ---------- войско ----------
  totalPower(g, k) {
    let p = 0;
    for (const a of g.armies) if (a.owner === k.id) p += unitPower(a.units);
    for (const c of g.cities) if (c.owner === k.id) p += unitPower(c.garrison);
    return p;
  },
  wantedPower(g, k) {
    const cities = g.citiesOf(k.id).length;
    return (350 + g.time * 0.9 + cities * 120) * g.diff.aggression * g.diff.armyMult;
  },

  recruit(g, k, ctx) {
    const want = this.wantedPower(g, k) * (ctx.threats.length ? 1.4 : 1);
    if (this.totalPower(g, k) >= want) return;
    if (ctx.inc.food < -4 || ctx.inc.gold < -6) return;
    const cities = ctx.cities.filter(c => !c.siegeBy && c.queue.length < 2).sort((a, b) => (b.isCapital - a.isCapital) || b.level - a.level);
    for (const c of cities) {
      const uid = this.pickUnit(g, k, c);
      if (!uid) continue;
      if (g.recruitBlock(c, uid)) continue;
      const cost = UNITS[uid].cost;
      if ((k.res.gold - (cost.gold || 0)) < 40) continue;
      g.recruit(c, uid);
    }
  },

  pickUnit(g, k, c) {
    const B = id => c.buildings[id] || 0;
    const w = [];
    if (B('barracks') >= 1) w.push(['spear', 3]);
    if (B('barracks') >= 2) w.push(['sword', 3]);
    if (B('range') >= 1) w.push(['archer', 2.5]);
    if (B('range') >= 2) w.push(['crossbow', 2]);
    if (B('stable') >= 1) w.push(['cavalry', 1.6]);
    if (B('stable') >= 2) w.push(['knight', 1.6]);
    const target = k.ai.target ? g.city(k.ai.target) : null;
    if (B('workshop') >= 1 && target && target.walls >= 1) w.push([B('workshop') >= 2 ? 'catapult' : 'ram', 2.5]);
    if (!w.length) w.push(['militia', 1]);
    const ok = w.filter(([u]) => !g.recruitBlock(c, u));
    if (!ok.length) return null;
    let sum = 0;
    for (const [, x] of ok) sum += x;
    let r = g.rng.next() * sum;
    for (const [u, x] of ok) { r -= x; if (r <= 0) return u; }
    return ok[0][0];
  },

  minGarrison(g, k, c, ctx) {
    const threat = ctx.threats.filter(t => t.city === c).reduce((s, t) => s + t.power, 0);
    return (c.isCapital ? 260 : 110) + c.level * 30 + threat * 0.4;
  },

  military(g, k, ctx) {
    const armies = g.armiesOf(k.id);
    // 1. Оборона: идём на того, кто осаждает или идёт к нашему городу
    for (const t of ctx.threats) {
      if (t.d > 10 && !(t.army.state === 'siege')) continue;
      if (t.army.isBandit && t.power < 120) continue;
      const free = armies.filter(a => a.state === 'idle' || (a.state === 'move' && a.ai !== 'defend'));
      let best = null, bd = Infinity;
      for (const a of free) {
        const d = dist(a.x, a.y, t.army.x, t.army.y);
        if (unitPower(a.units) >= t.power * 0.9 && d < bd && d < 30) { bd = d; best = a; }
      }
      if (best) {
        if (!g.order(best, { kind: 'army', id: t.army.id })) best.ai = 'defend';
      }
    }
    // 2. Сбор лишних войск из гарнизонов в полевую армию
    for (const c of ctx.cities) {
      if (c.siegeBy) continue;
      const extra = unitPower(c.garrison) - this.minGarrison(g, k, c, ctx);
      if (extra < 120) continue;
      const take = {};
      let got = 0;
      for (const u of ['knight', 'cavalry', 'sword', 'crossbow', 'catapult', 'ram', 'spear', 'archer', 'militia']) {
        const n = c.garrison[u] || 0;
        if (!n) continue;
        const sq = UNITS[u].squad;
        const per = unitPower({ [u]: sq });
        const squads = Math.min(Math.floor(n / sq), Math.floor((extra - got) / per));
        if (squads > 0) { take[u] = squads * sq; got += squads * per; }
        if (got >= extra) break;
      }
      if (menCount(take) < 10) continue;
      const a = g.formArmy(c, take);
      if (a) {
        a.name = 'Войско ' + (k.name.split(' ').pop());
        // сливаем с ближайшей свободной армией
        const host = armies.find(o => o.state === 'idle' && dist(o.x, o.y, a.x, a.y) < 1.5);
        if (host) g.mergeInto(host, a);
        else armies.push(a);
      }
    }
    // 3. Объединяем праздные армии в одну главную
    const idle = g.armiesOf(k.id).filter(a => a.state === 'idle' && a.ai !== 'defend');
    if (idle.length >= 2) {
      idle.sort((a, b) => unitPower(b.units) - unitPower(a.units));
      const main = idle[0];
      for (const a of idle.slice(1)) {
        if (dist(a.x, a.y, main.x, main.y) < 1.2) g.mergeInto(main, a);
        else if (a.state === 'idle') g.order(a, { kind: 'army', id: main.id });
      }
    }
    for (const a of g.armiesOf(k.id)) if (a.ai === 'defend' && a.state === 'idle') a.ai = null;
    // 4. Наступление
    const main = g.armiesOf(k.id).filter(a => a.state === 'idle' && a.ai !== 'defend').sort((a, b) => unitPower(b.units) - unitPower(a.units))[0];
    if (!main) return;
    const power = unitPower(main.units);
    const siege = siegePower(main.units);
    let best = null, bs = Infinity;
    for (const c of g.cities) {
      if (c.owner === k.id) continue;
      const isKingdom = c.owner !== -1;
      if (isKingdom && g.time < GRACE_TIME) continue;
      const ok = g.kingdom(c.owner);
      if (isKingdom && (!ok || !ok.alive)) continue;
      const def = this.cityDefense(g, c);
      const wallsHard = c.walls >= 2 && c.wallHp > 0 && siege < 10;
      const need = def * (wallsHard ? 2.2 : 1.35) / g.diff.aggression;
      if (power < need) continue;
      const d = dist(c.x, c.y, main.x, main.y);
      let score = d * 1.5 + def / 40;
      if (isKingdom && ok.isPlayer) score *= 1.15 / g.diff.aggression;
      if (c.isCapital) score *= 0.85;
      if (score < bs) { bs = score; best = c; }
    }
    if (best) {
      k.ai.target = best.id;
      g.order(main, { kind: 'city', id: best.id });
      if (best.owner !== -1 && g.kingdom(best.owner).isPlayer) {
        main.ai = 'attack';
        if (g.isVisible(main.x, main.y)) g.notify(k.name + ' двинуло войско на ' + best.name + '!', 'bad', best, true);
      }
    }
  },
};
