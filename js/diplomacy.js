'use strict';
// Дипломатия: война и мир, союзы, дань, торговые договоры; решения ИИ (Mods.add).
// Отношения хранятся по парам держав в g.dip.rels: состояние (война / мир / союз), перемирие, договоры,
// счёт войны и память об обидах и услугах; из них выводится мнение (−100…100) с причинами.
// Разбойники, мятежники (k.rebel) и вольные города в отношения не входят и враждебны всем.

const DIPLO = {
  truce: 240,          // перемирие после заключения мира, с
  nap: 600,            // срок договора о ненападении, с
  tribute: 600,        // срок дани по договору, с
  offer: 45,           // сколько предложение ИИ ждёт ответа игрока, с
  offerGap: 100,       // одна держава ИИ шлёт игроку предложения не чаще раза в столько секунд
  calm: 90,            // первые полторы минуты ИИ не шлёт предложений
  think: 8,            // как часто держава ИИ занимается дипломатией, с
  maxWars: 2,          // ИИ не начинает новой войны, если уже ведёт столько
  memory: 600,         // за столько секунд забываются обиды и услуги
  warLust: 30,         // с какого желания войны ИИ её объявляет
  peaceWish: 8,        // с какого желания мира ИИ сам его предлагает
  allyOpinion: 35,     // с какого мнения ИИ соглашается на союз (с общим врагом — на 20 ниже)
  allyIdle: 480,       // союз без общего врага ИИ распускает через столько секунд
  trade: { base: 6, perCity: 2, max: 24 },   // торговый договор: золота в минуту каждой стороне
  tributeShare: 0.15,  // дань — доля налогов плательщика (5…60 золота в минуту)
  score: { city: 12, level: 4, capital: 12, battle: 3, kills: 40, battleMax: 6 },  // очки счёта войны
};

const Diplomacy = {
  // ---------- отношения ----------
  regular(k) { return !!k && !k.bandit && !k.rebel; },
  // держава, за которую решает человек (в прогонах PLAYER_AI игрок — тоже ИИ)
  human(k) { return !!k && k.isPlayer && !k.ai; },
  key(a, b) { return a < b ? a * 1048576 + b : b * 1048576 + a; },
  rel(g, a, b) { return g.dipIdx ? g.dipIdx.get(this.key(a, b)) || null : null; },
  state(g, a, b) { const r = this.rel(g, a, b); return r ? r.st : null; },
  side(r, kid) { return r.a === kid ? 0 : 1; },
  other(r, kid) { return r.a === kid ? r.b : r.a; },
  index(g) {
    g.dipIdx = new Map();
    for (const r of g.dip.rels) g.dipIdx.set(this.key(r.a, r.b), r);
  },
  // давняя приязнь или неприязнь пары: −15…15, из зерна мира (без общего генератора, чтобы не сбивать его)
  temper(g, a, b) {
    let h = (Math.imul((g.opts.seed | 0) + 0x9e37, 2654435761) ^ Math.imul(Math.min(a, b) * 97 + Math.max(a, b) * 7919, 2246822519)) >>> 0;
    h ^= h >>> 15; h = Math.imul(h, 2246822519) >>> 0; h ^= h >>> 13;
    return Math.round(((h >>> 0) / 4294967296 - 0.5) * 30);
  },
  makeRel(g, a, b, st, truce) {
    const r = {
      a: Math.min(a, b), b: Math.max(a, b), st, since: g.time, truce, nap: 0, trade: false, trib: null,
      ws: [0, 0], wc: [0, 0], wb: [0, 0], prog: 0, ended: 0, cw: g.time, base: this.temper(g, a, b), mem: [],
    };
    g.dip.rels.push(r);
    g.dipIdx.set(this.key(a, b), r);
    return r;
  },
  // отношения со всеми державами, в том числе появившимися посреди партии
  ensure(g) {
    const ks = g.kingdoms.filter(k => this.regular(k));
    for (let i = 0; i < ks.length; i++) {
      for (let j = i + 1; j < ks.length; j++) {
        if (!this.rel(g, ks[i].id, ks[j].id)) this.makeRel(g, ks[i].id, ks[j].id, 'peace', g.time + 60);
      }
    }
  },
  others(g, kid) { return g.kingdoms.filter(k => k.id !== kid && k.alive && this.regular(k)); },
  wars(g, kid) {
    let n = 0;
    for (const k of this.others(g, kid)) if (this.state(g, kid, k.id) === 'war') n++;
    return n;
  },
  allies(g, kid) { return this.others(g, kid).filter(k => this.state(g, kid, k.id) === 'ally'); },
  commonEnemy(g, a, b) {
    for (const x of this.others(g, a)) if (x.id !== b && this.state(g, a, x.id) === 'war' && this.state(g, b, x.id) === 'war') return x;
    return null;
  },
  canDeclare(g, a, b) {
    const r = this.rel(g, a, b);
    return !!r && r.st === 'peace' && g.time >= r.truce && g.time >= r.nap;
  },
  // почему нельзя объявить войну (для игрока); null — можно
  declareBlock(g, a, b) {
    const r = this.rel(g, a, b);
    if (!r) return 'Нельзя';
    if (r.st === 'war') return 'Уже идёт война';
    if (g.time < r.truce) return 'Перемирие ещё ' + fmtTime(r.truce - g.time);
    if (g.time < r.nap) return 'Договор о ненападении ещё ' + fmtTime(r.nap - g.time);
    return null;
  },
  bump(g) { g.dip.v = (g.dip.v || 0) + 1; },

  // ---------- сила, соседство, города ----------
  pow(g, k) {
    if (!g.dipPw || g.dipPw.t !== g.time) g.dipPw = { t: g.time, m: new Map() };
    let p = g.dipPw.m.get(k.id);
    if (p === undefined) { p = typeof AI !== 'undefined' ? AI.totalPower(g, k) : 1; g.dipPw.m.set(k.id, p); }
    return p;
  },
  ratio(g, a, b) { return this.pow(g, a) / Math.max(1, this.pow(g, b)); },
  cityCount(g, kid) {
    let n = 0;
    for (const c of g.cities) if (c.owner === kid) n++;
    return n;
  },
  // пары держав, чьи земли соприкасаются (по клеткам влияния); пересчёт, только если сдвинулись границы
  contacts(g) {
    const key = g.territoryVersion + ':' + g.ownershipVersion;
    if (g.dipNb && g.dipNb.key === key) return g.dipNb.set;
    const w = g.world, W = w.W, H = w.H, cof = w.cityOf;
    const own = new Map(g.cities.map(c => [c.id, c.owner]));
    const set = new Set();
    const touch = (ci, cj) => {
      const o = own.get(ci), p = own.get(cj);
      if (o === undefined || p === undefined || o < 0 || p < 0 || o === p) return;
      set.add(this.key(o, p));
    };
    for (let y = 0; y < H; y++) {
      for (let x = 0, i = y * W; x < W; x++, i++) {
        const ci = cof[i];
        if (ci < 0) continue;
        if (x + 1 < W && cof[i + 1] >= 0 && cof[i + 1] !== ci) touch(ci, cof[i + 1]);
        if (y + 1 < H && cof[i + W] >= 0 && cof[i + W] !== ci) touch(ci, cof[i + W]);
      }
    }
    g.dipNb = { key, set };
    return set;
  },
  neighbors(g, a, b) { return this.contacts(g).has(this.key(a, b)); },
  // ближайшее расстояние между городами двух держав
  gap(g, a, b) {
    let best = Infinity;
    for (const c of g.cities) {
      if (c.owner !== a) continue;
      for (const q of g.cities) if (q.owner === b) best = Math.min(best, dist(c.x, c.y, q.x, q.y));
    }
    return best;
  },
  tributeGold(g, payer) {
    let pop = 0;
    for (const c of g.cities) if (c.owner === payer.id) pop += c.pop;
    return clamp(Math.round(pop * ECON.tax * DIPLO.tributeShare), 5, 60);
  },
  tradeGold(g, r) {
    const T = DIPLO.trade;
    return Math.min(T.max, T.base + T.perCity * Math.min(this.cityCount(g, r.a), this.cityCount(g, r.b)));
  },
  // золото в минуту от договоров: торговля и дань (через доход столицы)
  goldFlow(g, kid) {
    if (!g.dip) return 0;
    let f = 0;
    for (const r of g.dip.rels) {
      if (r.a !== kid && r.b !== kid) continue;
      if (r.trade) f += this.tradeGold(g, r);
      if (r.trib && r.trib.until > g.time) f += r.trib.from === kid ? -r.trib.gold : r.trib.gold;
    }
    return f;
  },

  // ---------- мнение ----------
  // Мнение from о to: −100…100 и причины [[текст, вклад]].
  opinion(g, from, to) {
    const r = this.rel(g, from, to);
    const parts = [];
    if (!r) return { v: -100, parts };
    const add = (text, v) => { v = Math.round(v); if (v) parts.push([text, v]); };
    if (r.base) add(r.base > 0 ? 'старая дружба' : 'давние распри', r.base);
    if (r.st === 'war') add('война', -35);
    else if (r.st === 'ally') add('союз', 30);
    if (r.trade) add('торговля', 12);
    if (r.nap > g.time) add('ненападение', 8);
    if (r.trib && r.trib.until > g.time) add(r.trib.from === to ? 'платит нам дань' : 'берёт с нас дань', r.trib.from === to ? 15 : -20);
    if (r.st !== 'war' && this.neighbors(g, from, to)) add('спорные земли', -10);
    let common = false, foeOfFriend = false, friendOfFoe = false;
    for (const x of this.others(g, from)) {
      if (x.id === to) continue;
      const sf = this.state(g, from, x.id), st = this.state(g, to, x.id);
      if (sf === 'war' && st === 'war') common = true;
      if (sf === 'ally' && st === 'war') foeOfFriend = true;
      if (sf === 'war' && st === 'ally') friendOfFoe = true;
    }
    if (common) add('общий враг', 15);
    if (foeOfFriend) add('воюет с нашим союзником', -25);
    if (friendOfFoe) add('союзник нашего врага', -15);
    if (this.cityCount(g, to) >= g.cities.length * 0.33) add('набирает слишком много силы', -15);
    const mem = new Map();
    for (const m of r.mem) {
      if (m.by !== from) continue;
      const v = m.v * Math.max(0, 1 - (g.time - m.t) / DIPLO.memory);
      mem.set(m.r, (mem.get(m.r) || 0) + v);
    }
    for (const [t, v] of mem) add(t, clamp(v, -60, 60));
    let v = 0;
    for (const p of parts) v += p[1];
    return { v: clamp(v, -100, 100), parts };
  },
  remember(g, r, by, text, v) {
    r.mem.push({ by, r: text, v, t: g.time });
    if (r.mem.length > 16) r.mem.shift();
  },

  // ---------- счёт войны ----------
  // Перевес kid в войне: −100…100 (больше нуля — побеждает).
  balance(r, kid) {
    const s = this.side(r, kid);
    return clamp(Math.round(r.ws[s] - r.ws[1 - s]), -100, 100);
  },
  onCaptured(g, d) {
    if (!d.from || !d.to || !this.regular(d.from) || !this.regular(d.to)) return;
    const r = this.rel(g, d.from.id, d.to.id);
    if (!r || r.st !== 'war') return;
    const S = DIPLO.score, s = this.side(r, d.to.id);
    r.ws[s] += S.city + S.level * (d.city.level - 1) + (d.city.isCapital || d.city.id === d.from.capital ? S.capital : 0);
    r.wc[s]++;
    r.prog = g.time;
    this.remember(g, r, d.from.id, 'взяли наши города', -12);
    this.bump(g);
  },
  onBattle(g, d) {
    if (!d.winner || !d.loser) return;
    const wk = g.kingdom(d.winner.owner), lk = g.kingdom(d.loser.owner);
    if (!this.regular(wk) || !this.regular(lk)) return;
    const r = this.rel(g, wk.id, lk.id);
    if (!r || r.st !== 'war') return;
    const S = DIPLO.score, s = this.side(r, wk.id);
    const kills = d.btl.a === d.winner.id ? d.btl.lossB : d.btl.lossA;
    r.ws[s] += S.battle + Math.min(S.battleMax, kills / S.kills);
    r.wb[s]++;
    r.prog = g.time;
  },

  // ---------- война и мир ----------
  setState(g, r, st) {
    if (r.st === 'war' && st !== 'war') r.ended = g.time;
    r.st = st; r.since = g.time;
    if (st === 'war') { r.trade = false; r.trib = null; r.nap = 0; r.ws = [0, 0]; r.wc = [0, 0]; r.wb = [0, 0]; r.prog = g.time; }
    if (st === 'ally') r.cw = g.time;
    this.bump(g);
  },
  // Объявить войну: a — кто объявляет. join — вступает в войну союзника. Возвращает текст ошибки или null.
  declareWar(g, a, b, join) {
    const why = this.declareBlock(g, a, b);
    if (why) return why;
    const ka = g.kingdom(a), kb = g.kingdom(b), r = this.rel(g, a, b);
    if (!ka || !kb || !ka.alive || !kb.alive) return 'Держава пала';
    const wasAlly = r.st === 'ally';
    // союзники нападающего присоединяются, только если и сами недолюбливают врага (мнение — до объявления)
    const eager = join ? [] : this.allies(g, a).filter(x => x.id !== b && (this.human(x) || this.opinion(g, x.id, b).v < -10));
    this.setState(g, r, 'war');
    if (!join) this.remember(g, r, b, 'объявили нам войну', -30);
    if (wasAlly) this.remember(g, r, b, 'предали союз', -30);
    this.dropOffers(g, a, b);
    this.say(g, a, b, join ? 'join' : 'war');
    g.emit('diplomacy', { type: 'war', a, b, join: !!join });
    // союзники обороняющегося вступают в войну (без цепочек: вступивший союзников не зовёт)
    if (!join) {
      for (const x of this.allies(g, b)) if (x.id !== a) this.callToArms(g, x, kb, ka, true);
      for (const x of eager) this.callToArms(g, x, ka, kb, false);
    }
    return null;
  },
  callToArms(g, ally, friend, enemy, defensive) {
    const re = this.rel(g, ally.id, enemy.id);
    if (!re || re.st !== 'peace') return;   // уже воюет или в союзе с обоими — остаётся в стороне
    if (this.human(ally)) {
      if (!this.declareBlock(g, ally.id, enemy.id)) this.offer(g, friend.id, ally.id, 'call', { enemy: enemy.id, defensive }, true);
      return;
    }
    if (!this.canDeclare(g, ally.id, enemy.id)) return;
    if (this.declareWar(g, ally.id, enemy.id, true)) return;
    const rf = this.rel(g, ally.id, friend.id);
    if (rf) this.remember(g, rf, friend.id, 'помогли нам в войне', 15);
  },
  // Мир на условиях terms: { kind: 'white' } | { kind: 'tribute', payer, gold } | { kind: 'city', giver, city }.
  makePeace(g, a, b, terms) {
    const r = this.rel(g, a, b);
    if (!r || r.st !== 'war') return 'Войны нет';
    const t = terms || { kind: 'white' };
    this.setState(g, r, 'peace');
    r.truce = g.time + DIPLO.truce;
    this.stopHostilities(g, a, b);
    if (t.kind === 'tribute') r.trib = { from: t.payer, gold: t.gold, until: g.time + DIPLO.tribute };
    if (t.kind === 'city') this.cede(g, g.city(t.city), t.giver === a ? b : a);
    this.remember(g, r, a, 'заключили мир', 8);
    this.remember(g, r, b, 'заключили мир', 8);
    this.dropOffers(g, a, b, 'peace');
    this.say(g, a, b, 'peace', t);
    g.emit('diplomacy', { type: 'peace', a, b, terms: t });
    return null;
  },
  // Мир: бои и осады между сторонами прекращаются, походы друг на друга отменяются.
  stopHostilities(g, a, b) {
    const pair = (x, y) => (x === a && y === b) || (x === b && y === a);
    for (const btl of g.battles.slice()) {
      if (btl.kind === 'field') {
        const x = g.army(btl.a), y = g.army(btl.b);
        if (!x || !y || !pair(x.owner, y.owner)) continue;
        g.battles = g.battles.filter(o => o !== btl);
        for (const s of [x, y]) {
          const c = s.resumeSiege ? g.city(s.resumeSiege) : null;
          s.state = 'idle'; s.battleId = null; s.resumeSiege = null; s.path = null; s.dest = null; s.immuneUntil = g.time + 3;
          // осаду третьей державы, прерванную боем, продолжаем
          if (c && c.owner !== s.owner && g.isHostile(s.owner, c.owner)) g.startSiege(s, c);
        }
      } else {
        const x = g.army(btl.a), c = g.city(btl.city);
        if (!x || !c || !pair(x.owner, c.owner)) continue;
        g.endSiege(x, false);
        x.path = null; x.dest = null;
        c.raised = false;
      }
    }
    for (const x of g.armies) {
      if ((x.owner !== a && x.owner !== b) || x.state !== 'move' || !x.dest) continue;
      let o = null;
      if (x.dest.kind === 'city') { const c = g.city(x.dest.id); o = c ? c.owner : null; }
      else if (x.dest.kind === 'army') { const t = g.army(x.dest.id); o = t ? t.owner : null; }
      if (o !== null && pair(x.owner, o)) g.stop(x);
    }
    // войска ИИ, оставшиеся без дела в чужих землях, возвращаются в ближайший свой город
    for (const x of g.armies.slice()) {
      if ((x.owner !== a && x.owner !== b) || x.state !== 'idle') continue;
      const k = g.kingdom(x.owner);
      if (!k || !k.ai) continue;
      let best = null, bd = Infinity;
      for (const c of g.cities) {
        if (c.owner !== x.owner || c.siegeBy) continue;
        const d = dist(c.x, c.y, x.x, x.y);
        if (d < bd) { bd = d; best = c; }
      }
      if (best && bd > 3) g.order(x, { kind: 'city', id: best.id });
    }
  },
  // Передача города по мирному договору: гарнизон прежнего хозяина уходит домой, в городе — ополчение.
  cede(g, c, to) {
    if (!c) return;
    const from = c.owner, garrison = c.garrison;
    if (c.siegeBy) { const s = g.army(c.siegeBy); if (s) g.endSiege(s, false); c.siegeBy = null; }
    c.owner = to;
    c.garrison = {}; c.wounds = {};
    c.construction = null; c.queue = []; c.raised = false;
    if (menCount(garrison) > 0) {
      const army = g.makeArmy(from, c.x + 0.5, c.y + 0.5, garrison);
      army.name = g.armyName(from);
      g.retreat(army);
    }
    const n = Math.min(30, Math.floor(c.pop * 0.05 / 10) * 10);
    c.garrison = n > 0 ? { militia: n } : {};
    if (n > 0) c.pop -= n;
    const k = g.kingdom(to);
    if (k && k.stats) { k.stats.taken++; k.stats.maxCities = Math.max(k.stats.maxCities || 0, this.cityCount(g, to)); }
    const old = g.kingdom(from);
    if (old && old.stats) old.stats.lostCities++;
    g.ownershipVersion++;
    g.refreshTerritory(true);
    g.emit('ceded', { city: c, from: old, to: k });
    g.checkVictory();
  },
  formAlliance(g, a, b) {
    const r = this.rel(g, a, b);
    if (!r || r.st !== 'peace') return 'Нельзя';
    this.setState(g, r, 'ally');
    this.say(g, a, b, 'ally');
    g.emit('diplomacy', { type: 'ally', a, b });
    return null;
  },
  breakAlliance(g, a, b, quiet) {
    const r = this.rel(g, a, b);
    if (!r || r.st !== 'ally') return 'Союза нет';
    this.setState(g, r, 'peace');
    this.remember(g, r, b, 'разорвали союз', -20);
    if (!quiet) this.say(g, a, b, 'unally');
    g.emit('diplomacy', { type: 'unally', a, b });
    return null;
  },

  // ---------- предложения ----------
  // kind: peace (terms), ally, trade, nap, demand (to платит дань from), pay (from платит to), call (to вступает в войну from).
  // Если отвечает человек — предложение ждёт ответа (pending); иначе решает ИИ: { ok, why }.
  propose(g, from, to, kind, terms) {
    const kf = g.kingdom(from), kt = g.kingdom(to);
    if (!kf || !kt || !kf.alive || !kt.alive) return { ok: false, why: 'Держава пала' };
    const pre = this.preBlock(g, from, to, kind, terms);
    if (pre) return { ok: false, why: pre };
    if (this.human(kt)) return { ok: false, pending: !!this.offer(g, from, to, kind, terms) };
    const ev = this.evaluate(g, kt, kf, kind, terms);
    if (ev.ok) this.apply(g, from, to, kind, terms);
    else this.refused(g, from, to, kind);
    return ev;
  },
  // проверки, не зависящие от мнения отвечающего
  preBlock(g, from, to, kind, terms) {
    const r = this.rel(g, from, to);
    if (!r) return 'С ними нельзя договориться';
    const war = r.st === 'war';
    if (kind === 'peace') {
      if (!war) return 'Войны нет';
      const t = terms || { kind: 'white' };
      if (t.kind === 'city') {
        const c = g.city(t.city);
        if (!c || c.owner !== t.giver) return 'Город уже не их';
        if (c.isCapital) return 'Столицу не отдают';
      }
      return null;
    }
    if (kind === 'call') return war ? null : 'Нужна война';
    if (war) return 'Сначала заключите мир';
    if (kind === 'ally' && r.st === 'ally') return 'Вы уже союзники';
    if (kind === 'trade' && r.trade) return 'Торговый договор уже действует';
    if (kind === 'nap' && r.st === 'ally') return 'Союзники и так не нападают';
    if (kind === 'nap' && r.nap > g.time) return 'Договор о ненападении уже действует';
    if ((kind === 'demand' || kind === 'pay') && r.trib && r.trib.until > g.time) return 'Дань уже платится';
    return null;
  },
  apply(g, from, to, kind, terms) {
    const r = this.rel(g, from, to);
    if (kind === 'peace') return this.makePeace(g, from, to, terms);
    if (kind === 'ally') return this.formAlliance(g, from, to);
    if (kind === 'call') {
      const err = this.declareWar(g, to, terms.enemy, true);
      if (!err) this.remember(g, r, from, 'помогли нам в войне', 15);
      return err;
    }
    if (kind === 'trade') { r.trade = true; this.bump(g); }
    else if (kind === 'nap') { r.nap = g.time + DIPLO.nap; this.bump(g); }
    else if (kind === 'demand') r.trib = { from: to, gold: (terms && terms.gold) || this.tributeGold(g, g.kingdom(to)), until: g.time + DIPLO.tribute };
    else if (kind === 'pay') r.trib = { from, gold: (terms && terms.gold) || this.tributeGold(g, g.kingdom(from)), until: g.time + DIPLO.tribute };
    this.say(g, from, to, kind, terms);
    g.emit('diplomacy', { type: kind, a: from, b: to });
    return null;
  },
  // отказ запоминается; дерзкое требование дани злит
  refused(g, from, to, kind) {
    const r = this.rel(g, from, to);
    if (!r) return;
    if (kind === 'demand') this.remember(g, r, to, 'требовали дань', -15);
    else this.remember(g, r, from, 'отклонили наше предложение', -4);
  },
  // Предложение человеку: ждёт ответа DIPLO.offer секунд.
  offer(g, from, to, kind, terms, urgent) {
    const d = g.dip;
    if (d.offers.some(o => o.from === from && o.to === to && o.kind === kind)) return null;
    if (!urgent && !this.canOffer(g, from, to)) return null;
    const o = { id: d.nextOffer++, from, to, kind, terms: terms || null, until: g.time + DIPLO.offer };
    d.offers.push(o);
    d.cool[from] = g.time + DIPLO.offerGap;
    const kf = g.kingdom(from);
    const cap = g.city(kf.capital);
    const bad = kind === 'demand' || (kind === 'peace' && terms && ((terms.kind === 'tribute' && terms.payer === to) || (terms.kind === 'city' && terms.giver === to)));
    g.notify(kf.name + ' ' + this.offerText(g, o) + '. Ответ — во вкладке «Дипломатия».', bad ? 'bad' : kind === 'call' ? 'war' : 'good', cap, true);
    g.emit('diplomacy', { type: 'offer', offer: o });
    this.bump(g);
    return o;
  },
  canOffer(g, from, to) {
    const d = g.dip;
    if (g.time < DIPLO.calm || g.time < (d.cool[from] || 0)) return false;
    if (d.offers.filter(o => o.to === to).length >= 2) return false;
    return !d.offers.some(o => o.from === from && o.to === to);
  },
  dropOffers(g, a, b, kind) {
    g.dip.offers = g.dip.offers.filter(o => !(((o.from === a && o.to === b) || (o.from === b && o.to === a)) && (!kind || o.kind === kind)));
  },
  // Ответ человека на предложение (expired — истёк срок).
  answer(g, id, yes, expired) {
    const d = g.dip, o = d.offers.find(x => x.id === id);
    if (!o) return 'Предложение уже неактуально';
    d.offers = d.offers.filter(x => x !== o);
    this.bump(g);
    const kf = g.kingdom(o.from), r = this.rel(g, o.from, o.to);
    if (!kf || !kf.alive || !r) return 'Держава пала';
    if (yes) {
      const pre = this.preBlock(g, o.from, o.to, o.kind, o.terms);
      if (pre) return pre;
      return this.apply(g, o.from, o.to, o.kind, o.terms);
    }
    if (o.kind === 'call') {
      if (o.terms && o.terms.defensive && r.st === 'ally') {
        this.breakAlliance(g, o.to, o.from, true);
        this.remember(g, r, o.from, 'бросили союзника', -30);
        g.notify(kf.name + ': «Вы бросили нас в беде». Союз расторгнут.', 'bad', g.city(kf.capital), true);
      } else this.remember(g, r, o.from, 'не помогли в войне', -10);
      return null;
    }
    this.remember(g, r, o.from, 'отклонили наше предложение', -4);
    if (o.kind === 'demand') {
      // отказ в дани: сильная держава может ответить войной
      this.remember(g, r, o.from, 'отказали нам в дани', -15);
      if (this.canDeclare(g, o.from, o.to) && this.warDesire(g, kf, g.kingdom(o.to)) + 20 > DIPLO.warLust) this.declareWar(g, o.from, o.to);
      else g.notify(kf.name + (expired ? ' не дождалось ответа о дани и затаило обиду' : ' недовольно отказом платить дань'), 'bad', g.city(kf.capital));
    }
    return null;
  },

  // ---------- оценка ИИ ----------
  // Желание ИИ закончить войну с other (больше нуля — согласен на белый мир).
  peaceWish(g, ai, other, r) {
    const bal = this.balance(r, ai.id);
    const dur = (g.time - r.since) / 60;
    const ratio = this.ratio(g, ai, other);
    let v = -bal * 0.5 + Math.min(45, dur * 4) - (Math.min(ratio, 3) - 1) * 15 + this.opinion(g, ai.id, other.id).v * 0.15 - 10;
    if (dur < 1.5) v -= 20;
    // застой: давно ни взятых городов, ни выигранных боёв
    const idle = (g.time - Math.max(r.prog || 0, r.since)) / 60;
    if (idle > 3) v += Math.min(30, (idle - 3) * 5);
    v += (this.wars(g, ai.id) - 1) * 12;
    const cap = g.city(ai.capital);
    if (cap && cap.siegeBy) { const s = g.army(cap.siegeBy); if (s && s.owner === other.id) v += 15; }
    if (ai.unpaid || ai.starving) v += 10;
    return v;
  },
  // Цена условий мира для ai (больше нуля — выгодно).
  termsValue(g, ai, t) {
    if (!t || t.kind === 'white') return 0;
    if (t.kind === 'tribute') return t.payer === ai.id ? -(t.gold * 0.9 + 10) : t.gold * 0.8;
    if (t.kind === 'city') {
      const c = g.city(t.city);
      const val = c ? 16 + c.level * 7 + (c.isCapital ? 200 : 0) : 0;
      return t.giver === ai.id ? -val - 8 : val;
    }
    return 0;
  },
  // Желание ИИ k начать войну с x.
  warDesire(g, k, x) {
    const op = this.opinion(g, k.id, x.id).v;
    const ratio = this.ratio(g, k, x);
    let v = -op * 0.5 + (Math.min(ratio, 2.5) - 1) * 20;
    v += this.neighbors(g, k.id, x.id) ? 12 : -10 - Math.min(25, this.gap(g, k.id, x.id) / 3);
    v += (g.diff.aggression - 1) * 35;
    let free = 0;
    for (const c of g.cities) if (c.owner === -1) free++;
    v += Math.max(0, 20 - free * 2);
    // засиделись в мире: со старта или с конца последней войны
    let last = 0;
    for (const r of g.dip.rels) if ((r.a === k.id || r.b === k.id) && r.ended > last) last = r.ended;
    v += Math.min(25, (g.time - last) / 60 * 2.5);
    if (this.cityCount(g, x.id) >= g.cities.length * 0.3) v += 12;
    // враг занят другой войной — удобный случай; но игрока всей сворой не травим
    const busy = this.wars(g, x.id);
    if (this.human(x)) v -= busy * 10;
    else if (busy === 1) v += 6;
    const r = this.rel(g, k.id, x.id);
    if (r.trib && r.trib.until > g.time && r.trib.from === x.id) v -= 25;
    return v;
  },
  // Ответ ИИ ai на предложение other: { ok, why }.
  evaluate(g, ai, other, kind, terms) {
    const r = this.rel(g, ai.id, other.id);
    const yes = { ok: true, why: null };
    const no = why => ({ ok: false, why: 'Отказ: ' + why });
    const op = this.opinion(g, ai.id, other.id).v;
    const ratio = this.ratio(g, ai, other);
    if (kind === 'peace') {
      const t = terms || { kind: 'white' };
      const wish = this.peaceWish(g, ai, other, r), cost = this.termsValue(g, ai, t);
      if (wish + cost > 0) return yes;
      if (cost < 0 && wish > 0) return no('условия слишком тяжелы');
      if ((g.time - r.since) < 90) return no('война только началась');
      if (this.balance(r, ai.id) > 10) return no('мы побеждаем в этой войне');
      if (ratio > 1.25) return no('наше войско сильнее');
      return no('нам пока выгоднее воевать');
    }
    if (kind === 'ally') {
      const common = this.commonEnemy(g, ai.id, other.id);
      const need = DIPLO.allyOpinion - (common ? 20 : 0) + this.allies(g, ai.id).length * 15;
      for (const x of this.allies(g, ai.id)) if (this.state(g, other.id, x.id) === 'war') return no('вы воюете с нашим союзником');
      if (op < need) return no('мало доверия (мнение ' + fmtRate(op) + ', нужно ' + fmtRate(need) + ')');
      return yes;
    }
    if (kind === 'trade') return op >= -5 ? yes : no('мы не торгуем с недругами (мнение ' + fmtRate(op) + ')');
    if (kind === 'nap') {
      if (op < -25) return no('мы вам не доверяем');
      if (this.warDesire(g, ai, other) > DIPLO.warLust * 0.6) return no('у нас свои виды на ваши земли');
      return yes;
    }
    if (kind === 'demand') {
      if (ratio * 1.7 < 1 && op > -60) return yes;
      return no(ratio < 1 ? 'вы не настолько сильнее нас' : 'мы сильнее — дани не будет');
    }
    if (kind === 'pay') return yes;
    if (kind === 'call') return op >= 0 ? yes : no('это не наша война');
    return no('нам это не нужно');
  },

  // ---------- решения ИИ ----------
  aiThink(g, k) {
    const d = g.dip;
    if (!d || !this.regular(k) || !k.alive || this.human(k)) return;
    if (g.time < (d.next[k.id] || 0)) return;
    d.next[k.id] = g.time + DIPLO.think * g.rng.range(0.8, 1.25);
    const others = this.others(g, k.id);
    if (!others.length) return;
    // 1. мир: проигранные и затянувшиеся войны
    for (const x of others) {
      const r = this.rel(g, k.id, x.id);
      if (r.st === 'war' && this.peaceWish(g, k, x, r) > DIPLO.peaceWish && this.seekPeace(g, k, x, r)) return;
    }
    // 2. союзы: союзник стал недругом или общий враг давно повержен — союз распадается
    for (const x of this.allies(g, k.id)) {
      const r = this.rel(g, k.id, x.id);
      if (this.commonEnemy(g, k.id, x.id)) r.cw = g.time;
      if (this.opinion(g, k.id, x.id).v < -5 || (!this.human(x) && g.time - r.cw > DIPLO.allyIdle)) { this.breakAlliance(g, k.id, x.id); return; }
    }
    // 3. война
    if (g.time >= GRACE_TIME && this.wars(g, k.id) < DIPLO.maxWars) {
      let best = null, bv = DIPLO.warLust;
      for (const x of others) {
        if (!this.canDeclare(g, k.id, x.id) || this.ratio(g, k, x) < 0.8) continue;
        const v = this.warDesire(g, k, x);
        if (v > bv) { bv = v; best = x; }
      }
      if (best && g.rng.chance(0.6)) { this.declareWar(g, k.id, best.id); return; }
    }
    if (g.time < DIPLO.calm) return;
    const roll = g.rng.next();
    // 4. союз против общего врага
    if (roll < 0.35 && this.allies(g, k.id).length < 2) {
      for (const x of others) {
        const r = this.rel(g, k.id, x.id);
        if (r.st !== 'peace' || !this.commonEnemy(g, k.id, x.id)) continue;
        if (this.opinion(g, k.id, x.id).v < DIPLO.allyOpinion - 20) continue;
        if (this.tryPropose(g, k, x, 'ally')) return;
      }
    }
    // 5. торговля
    if (roll < 0.5) {
      const x = g.rng.pick(others), r = this.rel(g, k.id, x.id);
      if (r.st !== 'war' && !r.trade && this.opinion(g, k.id, x.id).v >= 5 && this.tryPropose(g, k, x, 'trade')) return;
    }
    // 6. ненападение с сильным соседом, пока идёт война
    if (roll > 0.7 && this.wars(g, k.id) > 0) {
      for (const x of others) {
        const r = this.rel(g, k.id, x.id);
        if (r.st !== 'peace' || r.nap > g.time || !this.neighbors(g, k.id, x.id) || this.ratio(g, x, k) < 0.7) continue;
        if (this.tryPropose(g, k, x, 'nap')) return;
      }
    }
    // 7. дань со слабого соседа
    if (roll > 0.85 && g.time >= GRACE_TIME && !this.wars(g, k.id)) {
      for (const x of others) {
        const r = this.rel(g, k.id, x.id);
        if (r.st !== 'peace' || (r.trib && r.trib.until > g.time) || !this.neighbors(g, k.id, x.id)) continue;
        if (this.ratio(g, k, x) < 1.8 || this.opinion(g, k.id, x.id).v >= 20) continue;
        if (this.tryPropose(g, k, x, 'demand', { gold: this.tributeGold(g, x) })) return;
      }
    }
  },
  tryPropose(g, k, x, kind, terms) {
    if (this.human(x) && !this.canOffer(g, k.id, x.id)) return false;
    const res = this.propose(g, k.id, x.id, kind, terms);
    return !!(res.ok || res.pending);
  },
  // ИИ ищет мир: свои варианты от выгодного себе к уступкам; соперник-ИИ принимает первый подходящий.
  seekPeace(g, k, x, r) {
    const bal = this.balance(r, k.id), wish = this.peaceWish(g, k, x, r);
    const opts = [];
    if (bal > 30) opts.push({ kind: 'tribute', payer: x.id, gold: this.tributeGold(g, x) });
    opts.push({ kind: 'white' });
    const weak = this.ratio(g, k, x);
    if (bal < -25 || weak < 0.5) opts.push({ kind: 'tribute', payer: k.id, gold: this.tributeGold(g, k) });
    if (bal < -45 || weak < 0.35) { const c = this.borderCity(g, k.id, x.id); if (c) opts.push({ kind: 'city', giver: k.id, city: c.id }); }
    const mine = opts.filter(t => wish + this.termsValue(g, k, t) > 0);
    if (!mine.length) return false;
    if (this.human(x)) return this.tryPropose(g, k, x, 'peace', mine[0]);
    for (const t of mine) {
      if (this.evaluate(g, x, k, 'peace', t).ok) { this.makePeace(g, k.id, x.id, t); return true; }
    }
    return false;
  },
  // Город kid, ближайший к землям other (не столица) — предмет уступки по миру.
  borderCity(g, kid, other) {
    let best = null, bd = Infinity;
    for (const c of g.cities) {
      if (c.owner !== kid || c.isCapital) continue;
      let d = Infinity;
      for (const q of g.cities) if (q.owner === other) d = Math.min(d, dist(c.x, c.y, q.x, q.y));
      const s = c.siegeBy && g.army(c.siegeBy) && g.army(c.siegeBy).owner === other ? -100 : 0;
      if (d + s < bd) { bd = d + s; best = c; }
    }
    return best;
  },

  // ---------- вести ----------
  say(g, a, b, what, terms) {
    const ka = g.kingdom(a), kb = g.kingdom(b), pl = g.player;
    if (!ka || !kb) return;
    const mine = pl && (a === pl.id || b === pl.id);
    const them = pl && a === pl.id ? kb : ka;
    const at = g.city(them.capital);
    const T = ka.name, U = kb.name;
    let text = '', kind = 'info', imp = mine;
    if (what === 'war') {
      if (pl && b === pl.id) { text = T + ' объявляет нам войну!'; kind = 'bad'; }
      else if (pl && a === pl.id) { text = 'Мы объявили войну: ' + U; kind = 'war'; }
      else { text = T + ' объявляет войну: ' + U; kind = 'war'; imp = this.state(g, pl.id, a) === 'ally' || this.state(g, pl.id, b) === 'ally'; }
    } else if (what === 'join') {
      if (pl && a === pl.id) { text = 'По союзному долгу мы вступили в войну против: ' + U; kind = 'war'; }
      else if (pl && b === pl.id) { text = T + ' вступает в войну против нас на стороне союзника!'; kind = 'bad'; }
      else { text = T + ' вступает в войну против: ' + U; kind = 'war'; }
    } else if (what === 'peace') {
      const tt = this.termsText(g, terms, pl ? pl.id : null);
      if (mine) { text = 'Мир с державой «' + them.name + '»' + (tt ? ': ' + tt : '') + '. Перемирие ' + fmtTime(DIPLO.truce); kind = 'good'; }
      else { text = T + ' и ' + U + ' заключают мир' + (tt ? ': ' + tt : ''); kind = 'info'; }
    } else if (what === 'ally') {
      text = mine ? 'Заключён союз с державой «' + them.name + '»' : T + ' и ' + U + ' заключают союз';
      kind = mine ? 'good' : 'info';
    } else if (what === 'unally') {
      text = mine ? 'Союз с державой «' + them.name + '» расторгнут' : T + ' разрывает союз: ' + U;
      kind = mine ? 'bad' : 'info';
    } else if (mine) {
      if (what === 'trade') { text = 'Торговый договор с державой «' + them.name + '»: обоим по ' + this.tradeGold(g, this.rel(g, a, b)) + ' золота в минуту'; kind = 'good'; }
      else if (what === 'nap') { text = 'Договор о ненападении с державой «' + them.name + '» на ' + fmtTime(DIPLO.nap); kind = 'good'; }
      else if (what === 'demand' || what === 'pay') {
        const r = this.rel(g, a, b), payMe = r.trib && r.trib.from !== pl.id;
        text = payMe ? them.name + ' платит нам дань: ' + r.trib.gold + ' золота в минуту' : 'Мы платим дань державе «' + them.name + '»: ' + (r.trib ? r.trib.gold : 0) + ' золота в минуту';
        kind = payMe ? 'good' : 'bad';
      }
    }
    if (text) g.notify(text, kind, at, imp);
  },
  termsText(g, t, pid) {
    if (!t || t.kind === 'white') return '';
    if (t.kind === 'tribute') {
      const p = g.kingdom(t.payer);
      return (t.payer === pid ? 'мы платим дань' : (p ? p.name : '') + ' платит дань') + ' ' + t.gold + ' зол./мин';
    }
    if (t.kind === 'city') {
      const c = g.city(t.city), giver = g.kingdom(t.giver);
      return (t.giver === pid ? 'мы отдаём ' : (giver ? giver.name : '') + ' отдаёт ') + (c ? c.name : 'город');
    }
    return '';
  },
  offerText(g, o) {
    const t = o.terms;
    if (o.kind === 'peace') {
      if (!t || t.kind === 'white') return 'предлагает белый мир';
      if (t.kind === 'tribute') return t.payer === o.from ? 'просит мира и готово платить дань ' + t.gold + ' зол./мин' : 'предлагает мир, если мы будем платить дань ' + t.gold + ' зол./мин';
      const c = g.city(t.city);
      return t.giver === o.from ? 'просит мира и отдаёт город ' + (c ? c.name : '') : 'предлагает мир в обмен на город ' + (c ? c.name : '');
    }
    if (o.kind === 'ally') return 'предлагает союз';
    if (o.kind === 'trade') return 'предлагает торговый договор';
    if (o.kind === 'nap') return 'предлагает договор о ненападении';
    if (o.kind === 'demand') return 'требует дань ' + ((t && t.gold) || this.tributeGold(g, g.kingdom(o.to))) + ' зол./мин, иначе грозит войной';
    if (o.kind === 'call') { const e = g.kingdom(t.enemy); return 'зовёт на войну против державы «' + (e ? e.name : '') + '»' + (t.defensive ? ' по союзному долгу' : ''); }
    return 'шлёт послов';
  },

  // ---------- шаг ----------
  tick(g) {
    const d = g.dip;
    this.ensure(g);
    for (const o of d.offers.slice()) {
      const kf = g.kingdom(o.from), kt = g.kingdom(o.to);
      if (!kf || !kt || !kf.alive || !kt.alive) { d.offers = d.offers.filter(x => x !== o); this.bump(g); continue; }
      if (g.time >= o.until) this.answer(g, o.id, false, true);
    }
    const pl = g.player;
    for (const r of d.rels) {
      if (r.trib && r.trib.until <= g.time) {
        if (pl && (r.a === pl.id || r.b === pl.id)) {
          const them = g.kingdom(this.other(r, pl.id));
          g.notify((r.trib.from === pl.id ? 'Мы больше не платим дань державе «' : 'Дань от державы «') + (them ? them.name : '') + (r.trib.from === pl.id ? '»' : '» закончилась'), 'info');
        }
        r.trib = null;
      }
      if (r.mem.length && Math.floor(g.time) % 10 === 0) r.mem = r.mem.filter(m => g.time - m.t < DIPLO.memory);
    }
  },
};

Mods.add({
  name: 'diplomacy',
  init(g, loaded) {
    if (!g.dip) {
      // новая партия: все в мире, перемирие до конца GRACE_TIME; старое сохранение без дипломатии — все воюют, как прежде
      g.dip = { v: 0, rels: [], offers: [], nextOffer: 1, next: {}, cool: {} };
      Diplomacy.index(g);
      const ks = g.kingdoms.filter(k => Diplomacy.regular(k));
      const old = loaded && g.time >= GRACE_TIME;
      for (let i = 0; i < ks.length; i++) for (let j = i + 1; j < ks.length; j++) Diplomacy.makeRel(g, ks[i].id, ks[j].id, old ? 'war' : 'peace', old ? 0 : GRACE_TIME);
    } else Diplomacy.index(g);
    g.dipSec = Math.floor(g.time);
    g.on((t, d) => {
      if (t === 'captured') Diplomacy.onCaptured(g, d);
      else if (t === 'battleEnd') Diplomacy.onBattle(g, d);
    });
    if (typeof DipView !== 'undefined' && DipView) DipView.attach(g);
  },
  update(g) {
    if (!g.dip) return;
    const s = Math.floor(g.time);
    if (s === g.dipSec) return;
    g.dipSec = s;
    Diplomacy.tick(g);
  },
  // ИИ занимается дипломатией из AI.think
  aiThink(g, k) { Diplomacy.aiThink(g, k); },
  serialize(g) { return g.dip; },
  restore(g, data) { g.dip = data ? JSON.parse(JSON.stringify(data)) : null; },
  modify: {
    // враждебны только державы в войне; разбойники, мятежники и вольные города — всем
    hostile(g, v, a, b) {
      if (!v || !g.dipIdx) return v;
      const r = g.dipIdx.get(a < b ? a * 1048576 + b : b * 1048576 + a);
      return r ? r.st === 'war' : v;
    },
    // торговля и дань идут через казну столицы
    cityIncome(g, inc, c, k) {
      if (c.isCapital && k && g.dip) { const f = Diplomacy.goldFlow(g, k.id); if (f) inc.gold += f; }
      return inc;
    },
    // ИИ не выбирает город, который уже осаждает союзник или держава, с которой мир; войну ведёт прицельно
    aiTarget(g, score, k, c) {
      if (c.siegeBy) { const s = g.army(c.siegeBy); if (s && s.owner !== k.id && !g.isHostile(k.id, s.owner)) return Infinity; }
      if (c.owner !== -1) score *= 0.75;
      return score;
    },
    // союзная победа: все уцелевшие соперники — союзники игрока, и союз держит большую часть мира
    alliedWin(g, v, pl, rivals) {
      if (v || !g.dip || !rivals.length) return v;
      for (const k of rivals) if (Diplomacy.state(g, pl.id, k.id) !== 'ally') return false;
      let n = 0;
      for (const c of g.cities) if (c.owner === pl.id || rivals.some(k => k.id === c.owner)) n++;
      return n >= Math.ceil(g.cities.length * WIN_SHARE);
    },
  },
});
