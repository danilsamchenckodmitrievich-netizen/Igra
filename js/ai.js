'use strict';
// ИИ соперничающих держав: хозяйство, найм, дивизии и армии, оборона, фронт и наступление на вольные и вражеские города.

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
    // общество (js/society.js): ставка налога, изучение знаний, войска в неспокойные города, наёмники
    if (typeof Society !== 'undefined') Society.ai(g, k, ctx);
    this.economy(g, k, ctx);
    this.recruit(g, k, ctx);
    Mods.call('aiThink', g, k, ctx);   // дипломатия и прочие модули
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
      if (a.owner === k.id || !g.isHostile(k.id, a.owner)) continue;
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
    // чаще докупаем недостающее до лучшего шаблона дивизии, который может собрать этот город
    const want = this.wantTemplate(g, k, c);
    if (want && g.rng.chance(0.6)) {
      const lack = Fronts.lacking(c.garrison, want.units);
      for (const u of UNIT_ORDER) if (lack[u] && !g.recruitBlock(c, u)) return u;
    }
    const ok = w.filter(([u]) => !g.recruitBlock(c, u));
    if (!ok.length) return null;
    let sum = 0;
    for (const [, x] of ok) sum += x;
    let r = g.rng.next() * sum;
    for (const [u, x] of ok) { r -= x; if (r <= 0) return u; }
    return ok[0][0];
  },

  wantTemplate(g, k, c) {
    const target = k.ai.target ? g.city(k.ai.target) : null;
    let best = null, bp = 0;
    for (const t of DIV_TEMPLATES) {
      if (t.id === 'siege' && !(target && target.walls >= 2)) continue;
      let ok = true;
      for (const u in t.units) { const n = UNITS[u].need; if (n && (c.buildings[n[0]] || 0) < n[1]) { ok = false; break; } }
      if (!ok) continue;
      const p = unitPower(t.units);
      if (p > bp) { bp = p; best = t; }
    }
    return best;
  },

  minGarrison(g, k, c, ctx) {
    const threat = ctx.threats.filter(t => t.city === c).reduce((s, t) => s + t.power, 0);
    return (c.isCapital ? 260 : 110) + c.level * 30 + threat * 0.4 + Mods.mod('aiGarrison', g, 0, c);
  },

  // Войско: дивизии по шаблонам из лишних воинов гарнизонов, армия из полевых дивизий, оборона городов
  // и фронт по границе с выбранным врагом (вольные города или держава) — наступление, если хватает сил.
  military(g, k, ctx) {
    this.defend(g, k, ctx);
    this.formDivisions(g, k, ctx);
    for (const a of g.armiesOf(k.id)) if ((a.ai === 'defend' || a.ai === 'refit') && a.state === 'idle') a.ai = null;
    this.war(g, k, ctx);
  },

  // 1. Оборона: на тех, кто осаждает или идёт к нашему городу, — ближайшие свободные дивизии, пока хватает сил.
  defend(g, k, ctx) {
    const divs = g.armiesOf(k.id), used = new Set();
    for (const t of ctx.threats) {
      if (t.d > 10 && t.army.state !== 'siege') continue;
      if (t.army.isBandit && t.power < 120) continue;
      let have = 0;
      for (const a of divs) if (a.dest && a.dest.kind === 'army' && a.dest.id === t.army.id) have += unitPower(a.units);
      if (have >= t.power * 0.9) continue;
      const free = divs.filter(a => !used.has(a) && (a.state === 'idle' || a.state === 'move') && a.ai !== 'defend' && a.org >= DIV.attackOrg &&
        dist(a.x, a.y, t.army.x, t.army.y) < 30);
      free.sort((p, q) => dist(p.x, p.y, t.army.x, t.army.y) - dist(q.x, q.y, t.army.x, t.army.y));
      const team = [];
      let p = have;
      for (const a of free) { team.push(a); p += unitPower(a.units); if (p >= t.power * 0.9) break; }
      if (p < t.power * 0.9) continue;
      for (const a of team) {
        if (!g.order(a, { kind: 'army', id: t.army.id })) { a.ai = 'defend'; a.front = null; used.add(a); }
      }
    }
  },

  // 2. Лишние воины гарнизонов уходят в поле дивизиями: по шаблону, если состав подходит, иначе сводной;
  // немного лишних — пополнением в небольшую дивизию, стоящую у города. Обескровленные дивизии
  // возвращаются в ближайший город гарнизоном, соседние малые — сливаются.
  formDivisions(g, k, ctx) {
    for (const c of ctx.cities) {
      if (c.siegeBy) continue;
      let extra = unitPower(c.garrison) - this.minGarrison(g, k, c, ctx);
      for (let guard = 0; guard < 3 && extra >= 120; guard++) {
        let best = null, bp = 0;
        for (const t of DIV_TEMPLATES) {
          if (!Fronts.fits(c.garrison, t.units)) continue;
          const p = unitPower(t.units);
          if (p <= extra * 1.15 && p > bp) { bp = p; best = t; }
        }
        let a = null;
        if (best) { a = g.formArmy(c, best.units, best.id); extra -= bp; }
        else {
          const take = {};
          let got = 0;
          for (const u of ['knight', 'cavalry', 'sword', 'crossbow', 'catapult', 'ram', 'spear', 'archer', 'militia']) {
            const n = c.garrison[u] || 0;
            if (!n) continue;
            const sq = UNITS[u].squad;
            const per = unitPower({ [u]: sq });
            const squads = Math.min(Math.floor(n / sq), Math.floor((Math.min(extra, 900) - got) / per));
            if (squads > 0) { take[u] = squads * sq; got += squads * per; }
            if (got >= extra) break;
          }
          extra = 0;
          const men = menCount(take);
          if (men < 10) break;
          const host = g.armiesOf(k.id).find(o => o.state === 'idle' && menCount(o.units) + men <= 130 && dist(o.x, o.y, c.x + 0.5, c.y + 0.5) < 2.5);
          if (host) {
            addUnits(c.garrison, take, -1);
            for (const u in take) if (!c.garrison[u]) delete c.wounds[u];
            addUnits(host.units, take);
            host.tpl = Fronts.guessTpl(g, k.id, host.units);
            break;
          }
          if (men >= 30) a = g.formArmy(c, take);
        }
        if (!a) break;
      }
    }
    const divs = g.armiesOf(k.id);
    for (const a of divs) {
      if (a.state !== 'idle' || !g.armyById.has(a.id)) continue;
      const men = menCount(a.units);
      if (men < 25) {
        let home = null, hd = 14;
        for (const c of ctx.cities) { const d = dist(c.x + 0.5, c.y + 0.5, a.x, a.y); if (!c.siegeBy && d < hd) { hd = d; home = c; } }
        if (home && !g.order(a, { kind: 'city', id: home.id })) { a.front = null; a.ai = 'refit'; }
        continue;
      }
      if (men >= 70) continue;
      const mate = divs.find(o => o !== a && o.state === 'idle' && g.armyById.has(o.id) && menCount(o.units) + men <= 130 && dist(o.x, o.y, a.x, a.y) < 1.5);
      if (mate) g.mergeInto(mate, a);
    }
  },

  // 3–4. Армия и фронт: цель — посильный город (вольный, после перемирия — и державы); фронт по границе
  // с его хозяином, все полевые дивизии на фронте; хватает сил — наступление, нет — оборона.
  war(g, k, ctx) {
    const field = g.armiesOf(k.id).filter(a => a.ai !== 'defend' && a.ai !== 'refit');
    if (!field.length) return;
    let grp = Fronts.groupsOf(g, k.id)[0];
    const loose = field.filter(a => a.group === null || a.group === undefined);
    if (loose.length) {
      if (!grp) grp = Fronts.makeGroup(g, k.id, loose, 'Войско: ' + k.name.split(' ').pop());
      else for (const a of loose) a.group = grp.id;
    }
    let power = 0, siege = 0, cx = 0, cy = 0;
    for (const a of field) { power += unitPower(a.units); siege += siegePower(a.units); cx += a.x; cy += a.y; }
    cx /= field.length; cy /= field.length;
    const need = c => {
      const def = this.cityDefense(g, c);
      const wallsHard = c.walls >= 2 && c.wallHp > 0 && siege < 10;
      return def * (wallsHard ? 2.2 : 1.35) / g.diff.aggression;
    };
    const valid = c => {
      if (!c || c.owner === k.id) return false;
      if (c.owner !== -1) {
        if (g.time < GRACE_TIME || !g.isHostile(k.id, c.owner)) return false;
        const ok = g.kingdom(c.owner);
        if (!ok || !ok.alive) return false;
      }
      return true;
    };
    let best = null;
    const prev = k.ai.target ? g.city(k.ai.target) : null;
    if (prev && k.ai.warUntil > g.time && valid(prev) && power >= need(prev) * 0.8) best = prev;
    if (!best) {
      let bs = Infinity;
      for (const c of g.cities) {
        if (!valid(c) || power < need(c)) continue;
        const ok = g.kingdom(c.owner);
        let score = dist(c.x, c.y, cx, cy) * 1.5 + this.cityDefense(g, c) / 40;
        if (ok && ok.isPlayer) score *= 1.15 / g.diff.aggression;
        if (c.isCapital) score *= 0.85;
        score = Mods.mod('aiTarget', g, score, k, c);
        if (score < bs) { bs = score; best = c; }
      }
      if (best) k.ai.warUntil = g.time + 45;
    }
    let f = Fronts.frontsOf(g, k.id)[0];
    if (!best) {
      if (f) { Fronts.assign(g, f, field.filter(a => a.front !== f.id)); if (f.mode !== 'hold') Fronts.setMode(g, f, 'hold'); }
      return;
    }
    const newTarget = k.ai.target !== best.id;
    k.ai.target = best.id;
    if (!f || f.enemy !== best.owner) {
      if (f) Fronts.removeFront(g, f);
      f = Fronts.makeBorderFront(g, k.id, best.owner, null, true);
    }
    Fronts.assign(g, f, field.filter(a => a.front !== f.id));
    const was = f.mode;
    if (f.mode !== 'attack') Fronts.setMode(g, f, 'attack');
    const ok = g.kingdom(best.owner);
    if (ok && ok.isPlayer && (was !== 'attack' || newTarget) && field.some(a => g.isVisible(a.x, a.y))) {
      g.notify(k.name + ' двинуло войско на ' + best.name + '!', 'bad', best, true);
    }
  },
};
