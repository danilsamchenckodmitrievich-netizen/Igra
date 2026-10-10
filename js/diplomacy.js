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
  // плательщик сам перестаёт платить дань — получатель запомнит
  stopTribute(g, payer, other) {
    const r = this.rel(g, payer, other);
    if (!r || !r.trib || r.trib.from !== payer) return 'Дани нет';
    r.trib = null;
    this.remember(g, r, other, 'перестали платить дань', -20);
    this.bump(g);
    const k = g.kingdom(other), pl = g.player;
    if (pl && payer === pl.id && k) g.notify('Мы перестали платить дань державе «' + k.name + '»', 'war', g.city(k.capital));
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

// ---------- интерфейс (только в браузере): вкладка «Дипломатия», предложения, кнопка в планке, границы войны ----------
const DipView = typeof document === 'undefined' ? null : {
  open: null,       // раскрытая держава во вкладке
  terms: false,     // раскрыт выбор условий мира
  confirm: null,    // держава, войну которой ждёт подтверждения
  answers: {},      // id державы → { ok, text, until } — последний ответ на наши предложения
  ask: null,        // приказ, упёршийся в мир: { army, owner, target, until }
  syncT: 0,
  dom: null,
  runs: [], runsKey: '', runsB: null,

  icons() {
    if (typeof ICON_PATHS === 'undefined' || ICON_PATHS.dipally) return;
    // два сцепленных кольца — союз
    ICON_PATHS.dipally = 'M7.5 7a5 5 0 1 0 0 10a5 5 0 1 0 0-10zM7.5 9.2a2.8 2.8 0 1 1 0 5.6a2.8 2.8 0 1 1 0-5.6zM16.5 7a5 5 0 1 0 0 10a5 5 0 1 0 0-10zM16.5 9.2a2.8 2.8 0 1 1 0 5.6a2.8 2.8 0 1 1 0-5.6z';
  },
  attach(g) {
    if (g.opts.spectate) return;
    g.on((t, d) => {
      if (t === 'peaceBlock' && d.army.owner === g.player.id) this.showAsk(g, d);
    });
  },
  sfx(name) { if (typeof Sfx !== 'undefined') Sfx.play(name); },
  // вкладка «Дипломатия» панели державы
  openTab() {
    if (typeof App === 'undefined' || !App.ui) return;
    App.ui.kTab = 'dip';
    App.ui.select({ kind: 'kingdom' });
  },
  refreshPanel() {
    if (typeof App === 'undefined' || !App.ui || !App.ui.sel) return;
    App.ui.html = '';
    App.ui.renderPanel();
  },

  // ---------- вкладка ----------
  tabHtml(g, pl, ui) {
    this.icons();
    const D = Diplomacy;
    let h = '<div class="pane" data-key="pane-dip">';
    for (const o of g.dip.offers) if (o.to === pl.id) h += this.offerHtml(g, o);
    const rank = k => !k.alive ? 9 : { war: 0, ally: 1, peace: 2 }[D.state(g, pl.id, k.id)] || 3;
    const list = g.kingdoms.filter(k => D.regular(k) && !k.isPlayer).sort((a, b) => rank(a) - rank(b) || a.id - b.id);
    if (this.open === null) { const w = list.find(k => k.alive && D.state(g, pl.id, k.id) === 'war'); if (w) this.open = w.id; }
    h += '<div class="dp-list">';
    for (const k of list) h += this.cardHtml(g, pl, k, ui);
    h += '</div>';
    h += `<p class="tip">${g.time < GRACE_TIME ? 'Первые ' + fmtTime(GRACE_TIME) + ' — всеобщее перемирие. ' : ''}` +
      'Нападать можно только на тех, с кем война. Мнение держав зависит от договоров, соседства, обид и общих врагов; ИИ соглашается по счёту войны, силе и мнению. ' +
      `Поражение — если соперник займёт ${Math.ceil(g.cities.length * LOSE_SHARE)} городов; союзная победа — если все уцелевшие соперники ваши союзники и вместе вы держите ${Math.ceil(g.cities.length * WIN_SHARE)}.</p>`;
    return h + '</div>';
  },
  offerHtml(g, o, floating) {
    const k = g.kingdom(o.from);
    const bad = o.kind === 'demand' || o.kind === 'call' || (o.kind === 'peace' && o.terms && ((o.terms.kind === 'tribute' && o.terms.payer === o.to) || (o.terms.kind === 'city' && o.terms.giver === o.to)));
    const left = fmtTime(Math.max(0, o.until - g.time));
    let h = `<div class="box dp-offer${bad ? ' bad' : ''}" data-key="of-${o.id}"><div class="dp-ot">${Icons.crest(k, 28)}<span><b>${escapeHtml(k.name)}</b> ${escapeHtml(Diplomacy.offerText(g, o))}</span></div>`;
    h += `<div class="dp-acts"><button class="act" type="button" data-act="dip" data-op="yes" data-id="${o.id}">${Icons.svg('check')}Принять</button>` +
      `<button class="act ghost" type="button" data-act="dip" data-op="no" data-id="${o.id}">Отклонить</button>` +
      `<span class="dp-timer" title="Ответить нужно до истечения срока">${Icons.svg('hourglass')}<span class="dp-left">${floating ? '' : left}</span></span></div>`;
    if (o.kind === 'demand') h += '<p class="tip">Откажете — держава может объявить войну.</p>';
    else if (o.kind === 'call' && o.terms && o.terms.defensive) h += '<p class="tip">Откажете — союз будет расторгнут.</p>';
    return h + '</div>';
  },
  stateWord(g, r) {
    if (r.st === 'war') return ['war', 'Война'];
    if (r.st === 'ally') return ['ally', 'Союз'];
    return g.time < r.truce ? ['truce', 'Перемирие'] : ['peace', 'Мир'];
  },
  cardHtml(g, pl, k, ui) {
    const D = Diplomacy, r = D.rel(g, pl.id, k.id);
    const head = `${Icons.crest(k, 26)}<span class="nm">${escapeHtml(k.name)}</span>`;
    if (!k.alive || !r) return `<div class="dp-k dead" data-key="dk-${k.id}"><div class="dp-row">${head}<span class="dp-st">пала</span></div></div>`;
    const open = this.open === k.id;
    const [cls, word] = this.stateWord(g, r);
    const op = D.opinion(g, k.id, pl.id);
    const opc = op.v >= 10 ? 'pos' : op.v <= -10 ? 'neg' : '';
    let h = `<div class="dp-k ${r.st}${open ? ' open' : ''}" data-key="dk-${k.id}">`;
    h += `<button class="dp-row" type="button" data-act="dip" data-op="open" data-k="${k.id}" aria-expanded="${open}">${head}` +
      `<span class="dp-st ${cls}">${word}</span><span class="dp-op ${opc}" title="Мнение о нас">${fmtRate(op.v)}</span><i class="dp-chev"></i></button>`;
    if (!open) return h + '</div>';
    h += '<div class="dp-body">';
    // мнение и причины
    const parts = op.parts.slice().sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]));
    h += `<div class="dp-line"><span class="k">Мнение о нас</span><b class="dp-op ${opc}">${fmtRate(op.v)}</b></div>`;
    if (parts.length) h += '<div class="infl-parts">' + parts.map(([t, v]) => `<span class="ip${v < 0 ? ' neg' : ''}">${escapeHtml(t)} <b>${fmtRate(v)}</b></span>`).join('') + '</div>';
    // сила, города, союзы и войны
    const known = g.citiesOf(k.id).some(c => g.explored[g.cityTile(c)]);
    const pw = known ? ui.powerWord(AI.totalPower(g, k), AI.totalPower(g, pl)) : 'неизвестно';
    h += `<div class="dp-line"><span class="k">Войско</span><b>${pw}</b><span class="k">Городов</span><b>${g.citiesOf(k.id).length}</b></div>`;
    const names = st => D.others(g, k.id).filter(x => x.id !== pl.id && D.state(g, k.id, x.id) === st).map(x => escapeHtml(x.name)).join(', ');
    const wars = names('war'), allies = names('ally');
    if (wars) h += `<div class="dp-line"><span class="k">Воюет с</span><span>${wars}</span></div>`;
    if (allies) h += `<div class="dp-line"><span class="k">Союзники</span><span>${allies}</span></div>`;
    // договоры
    const chips = [];
    if (g.time < r.truce) chips.push(`${Icons.svg('flag')}перемирие ${fmtTime(r.truce - g.time)}`);
    if (r.trade) chips.push(`${Icons.svg('gold')}торговля +${D.tradeGold(g, r)} зол./мин`);
    if (r.nap > g.time) chips.push(`${Icons.svg('shield')}ненападение ${fmtTime(r.nap - g.time)}`);
    if (r.trib && r.trib.until > g.time) chips.push(`${Icons.svg('coin')}${r.trib.from === pl.id ? 'мы платим' : 'нам платят'} ${r.trib.gold} зол./мин · ${fmtTime(r.trib.until - g.time)}`);
    h += `<div class="dp-line"><span class="k">Договоры</span>${chips.length ? chips.map(c => `<span class="dp-chip">${c}</span>`).join('') : '<span class="muted">нет</span>'}</div>`;
    // счёт войны
    if (r.st === 'war') {
      const bal = D.balance(r, pl.id), s = D.side(r, pl.id);
      const word2 = bal > 15 ? 'мы побеждаем' : bal < -15 ? 'мы проигрываем' : 'равная борьба';
      h += `<div class="dp-score"><div class="dp-line"><span class="k">Счёт войны</span><b class="dp-op ${bal > 0 ? 'pos' : bal < 0 ? 'neg' : ''}">${fmtRate(bal)}</b><span class="muted">${word2} · ${fmtTime(g.time - r.since)}</span></div>` +
        `<div class="dp-bar"><i class="${bal >= 0 ? 'pos' : 'neg'}" style="left:${bal >= 0 ? 50 : 50 + bal / 2}%;width:${Math.abs(bal) / 2}%"></i><b></b></div>` +
        `<div class="dp-line muted">Взято городов ${r.wc[s]} : ${r.wc[1 - s]} · выиграно боёв ${r.wb[s]} : ${r.wb[1 - s]}</div></div>`;
    }
    const ans = this.answers[k.id];
    if (ans && ans.until > g.time) h += `<div class="dp-ans ${ans.ok ? 'ok' : 'no'}">${escapeHtml(ans.text)}</div>`;
    h += this.actsHtml(g, pl, k, r);
    return h + '</div></div>';
  },
  btn(op, k, label, cls, extra) {
    return `<button class="act ${cls || ''}" type="button" data-act="dip" data-op="${op}" data-k="${k.id}"${extra || ''}>${label}</button>`;
  },
  actsHtml(g, pl, k, r) {
    const D = Diplomacy;
    let h = '<div class="dp-acts">';
    if (r.st === 'war') {
      h += this.btn('terms', k, `${Icons.svg('scroll')}Предложить мир…`, this.terms ? '' : 'ghost');
      h += '</div>';
      if (this.terms) {
        const theirs = D.tributeGold(g, k), ours = D.tributeGold(g, pl);
        const cTake = D.borderCity(g, k.id, pl.id), cGive = D.borderCity(g, pl.id, k.id);
        h += '<div class="dp-terms">';
        h += this.btn('peace', k, 'Белый мир — без условий', 'ghost', ' data-v="white"');
        h += this.btn('peace', k, `Мир, они платят нам дань ${theirs} зол./мин`, 'ghost', ' data-v="theypay"');
        h += this.btn('peace', k, `Мир, мы платим дань ${ours} зол./мин`, 'ghost', ' data-v="wepay"');
        if (cTake) h += this.btn('peace', k, `Мир, они отдают нам ${escapeHtml(cTake.name)}`, 'ghost', ` data-v="theygive" data-c="${cTake.id}"`);
        if (cGive) h += this.btn('peace', k, `Мир, мы отдаём ${escapeHtml(cGive.name)}`, 'ghost', ` data-v="wegive" data-c="${cGive.id}"`);
        h += `<p class="tip">Дань — на ${fmtTime(DIPLO.tribute)}. После мира ${fmtTime(DIPLO.truce)} перемирия: войну объявить нельзя.</p></div>`;
      }
      return h;
    }
    // мир или союз
    if (this.confirm === k.id) {
      h += `<span class="dp-q">Объявить войну державе «${escapeHtml(k.name)}»?</span>` + this.btn('war', k, `${Icons.svg('swords')}Да, война!`, 'dp-red') + this.btn('nowar', k, 'Нет', 'ghost');
      return h + '</div>';
    }
    if (r.st === 'ally') h += this.btn('unally', k, 'Разорвать союз', 'ghost');
    else {
      const block = D.declareBlock(g, pl.id, k.id);
      h += block ? `<button class="act dp-red" type="button" disabled title="${escapeHtml(block)}">${Icons.svg('lock')}${escapeHtml(block)}</button>`
        : this.btn('war', k, `${Icons.svg('swords')}Объявить войну`, 'dp-red');
      h += this.btn('ally', k, `${Icons.svg('dipally')}Предложить союз`);
    }
    if (!r.trade) h += this.btn('trade', k, `${Icons.svg('gold')}Торговый договор`, 'ghost');
    if (r.st === 'peace' && r.nap <= g.time) h += this.btn('nap', k, `${Icons.svg('shield')}Ненападение`, 'ghost');
    if (r.trib && r.trib.until > g.time) {
      if (r.trib.from === pl.id) h += this.btn('stoppay', k, 'Перестать платить дань', 'ghost');
    } else {
      h += this.btn('demand', k, `Потребовать дань ${D.tributeGold(g, k)} зол./мин`, 'ghost');
      h += this.btn('pay', k, `Платить дань ${D.tributeGold(g, pl)} зол./мин`, 'ghost');
    }
    return h + '</div>';
  },

  // ---------- действия (data-act="dip") ----------
  act(d, ui) {
    const g = ui.g, pl = g.player, D = Diplomacy;
    if (d.op === 'yes' || d.op === 'no') return this.answerOffer(g, +d.id, d.op === 'yes', ui);
    const kid = +d.k, k = g.kingdom(kid);
    if (!k) return;
    switch (d.op) {
      case 'open': this.open = this.open === kid ? -1 : kid; this.terms = false; this.confirm = null; return;
      case 'terms': this.terms = !this.terms; this.confirm = null; return;
      case 'nowar': this.confirm = null; return;
      case 'war': {
        if (this.confirm !== kid) { this.confirm = kid; return; }
        this.confirm = null;
        const err = D.declareWar(g, pl.id, kid);
        if (err) return err;
        this.sfx('horn');
        return;
      }
      case 'unally': D.breakAlliance(g, pl.id, kid); this.sfx('click'); return;
      case 'stoppay': return D.stopTribute(g, pl.id, kid) || undefined;
      case 'peace': {
        const v = d.v;
        let t = { kind: 'white' };
        if (v === 'theypay') t = { kind: 'tribute', payer: kid, gold: D.tributeGold(g, k) };
        else if (v === 'wepay') t = { kind: 'tribute', payer: pl.id, gold: D.tributeGold(g, pl) };
        else if (v === 'theygive') t = { kind: 'city', giver: kid, city: +d.c };
        else if (v === 'wegive') t = { kind: 'city', giver: pl.id, city: +d.c };
        this.terms = false;
        return this.propose(g, pl, k, 'peace', t, ui);
      }
      case 'ally': case 'trade': case 'nap': case 'pay':
        return this.propose(g, pl, k, d.op, d.op === 'pay' ? { gold: D.tributeGold(g, pl) } : null, ui);
      case 'demand': return this.propose(g, pl, k, 'demand', { gold: D.tributeGold(g, k) }, ui);
    }
    return undefined;
  },
  propose(g, pl, k, kind, terms, ui) {
    const res = Diplomacy.propose(g, pl.id, k.id, kind, terms);
    if (res.ok) {
      this.answers[k.id] = { ok: true, text: k.name + ': «Согласны».', until: g.time + 30 };
      ui.toast(k.name + ' соглашается', true);
      this.sfx(kind === 'peace' || kind === 'ally' ? 'victory' : 'coin');
      return undefined;
    }
    const why = res.why || 'Отказ';
    this.answers[k.id] = { ok: false, text: why, until: g.time + 30 };
    return why;
  },
  answerOffer(g, id, yes, ui) {
    const o = g.dip.offers.find(x => x.id === id);
    const err = Diplomacy.answer(g, id, yes);
    if (err) return err;
    if (o && yes) { ui.toast('Договор заключён', true); this.sfx(o.kind === 'call' ? 'horn' : 'done'); }
    else this.sfx('click');
    return undefined;
  },

  // ---------- запрос войны после приказа ----------
  showAsk(g, d) {
    const k = g.kingdom(d.owner);
    if (!k || !this.ensureDom()) return;
    this.ask = { army: d.army.id, owner: d.owner, target: d.target, until: performance.now() + 9000 };
    const r = Diplomacy.rel(g, g.player.id, d.owner);
    const block = Diplomacy.declareBlock(g, g.player.id, d.owner);
    const name = `«${escapeHtml(k.name)}»`;
    let h = `<div class="dp-ot">${Icons.crest(k, 30)}<span>`;
    if (r && r.st === 'ally') h += `${name} — наш союзник. Разорвать союз и объявить войну?</span></div><div class="dp-acts"><button class="act dp-red" type="button" data-op="war">${Icons.svg('swords')}Разорвать союз и напасть</button>`;
    else if (block) h += `С державой ${name} мир. ${escapeHtml(block)} — пока воевать нельзя.</span></div><div class="dp-acts">`;
    else h += `С державой ${name} мир. Объявить войну?</span></div><div class="dp-acts"><button class="act dp-red" type="button" data-op="war">${Icons.svg('swords')}Объявить войну</button>`;
    h += `<button class="act ghost" type="button" data-op="cancel">${block && !(r && r.st === 'ally') ? 'Понятно' : 'Отмена'}</button></div>`;
    this.dom.ask.innerHTML = h;
    this.dom.ask.hidden = false;
  },
  askAct(op) {
    const ask = this.ask, g = typeof App !== 'undefined' ? App.game : null;
    this.ask = null;
    if (this.dom) this.dom.ask.hidden = true;
    if (op !== 'war' || !ask || !g || !g.dip) return;
    const pl = g.player, D = Diplomacy;
    if (D.state(g, pl.id, ask.owner) === 'ally') D.breakAlliance(g, pl.id, ask.owner);
    const err = D.declareWar(g, pl.id, ask.owner);
    if (err) { App.ui.toast(err); this.sfx('error'); return; }
    const a = g.army(ask.army);
    if (a && a.owner === pl.id) {
      const e2 = g.order(a, ask.target);
      if (!e2) {
        const t = ask.target, c = t.kind === 'city' ? g.city(t.id) : null, x = t.kind === 'army' ? g.army(t.id) : null;
        if (c) App.renderer.marker = { x: c.x + 0.5, y: c.y + 0.5, t: 0, attack: true };
        else if (x) App.renderer.marker = { x: x.x, y: x.y, t: 0, attack: true };
      }
    }
    this.sfx('horn');
    this.refreshPanel();
  },

  // ---------- плавающие элементы: кнопка в планке и карточки ----------
  ensureDom() {
    if (this.dom) return this.dom;
    const kb = document.getElementById('kingdom-btn'), left = document.getElementById('left'), hud = document.getElementById('hud');
    if (!kb || !left || !hud) return null;
    kb.insertAdjacentHTML('afterend', '<button id="dip-btn" type="button" title="Дипломатия: войны, мир, союзы" hidden></button>');
    left.insertAdjacentHTML('beforeend', '<div id="dip-offer" hidden></div>');
    hud.insertAdjacentHTML('beforeend', '<div id="dip-ask" hidden></div>');
    const dom = { btn: document.getElementById('dip-btn'), off: document.getElementById('dip-offer'), ask: document.getElementById('dip-ask'), offId: null, btnHtml: '' };
    dom.btn.addEventListener('click', () => { this.sfx('click'); this.openTab(); });
    dom.off.addEventListener('click', e => {
      const b = e.target.closest('[data-op]');
      if (!b) { this.openTab(); return; }
      const g = App.game, err = this.answerOffer(g, +b.dataset.id, b.dataset.op === 'yes', App.ui);
      if (err) { App.ui.toast(err); this.sfx('error'); }
      this.sync(1);
      this.refreshPanel();
    });
    dom.ask.addEventListener('click', e => { const b = e.target.closest('[data-op]'); if (b) this.askAct(b.dataset.op); });
    this.dom = dom;
    return dom;
  },
  // раз в четверть секунды: кнопка в планке, карточка предложения, срок запроса войны
  sync(dt) {
    this.syncT -= dt;
    if (this.syncT > 0) return;
    this.syncT = 0.25;
    const dom = this.ensureDom();
    if (!dom) return;
    const g = typeof App !== 'undefined' ? App.game : null;
    const on = !!(g && App.mode === 'game' && !g.opts.spectate && g.dip && g.winner === null);
    if (!on) {
      dom.btn.hidden = true; dom.off.hidden = true; dom.ask.hidden = true; this.ask = null; dom.offId = null;
      return;
    }
    this.icons();
    const pl = g.player, wars = Diplomacy.wars(g, pl.id);
    const offers = g.dip.offers.filter(o => o.to === pl.id);
    const bh = (wars ? Icons.svg('swords') + '<b>' + wars + '</b>' : Icons.svg('scroll')) + (offers.length ? '<i class="dot"></i>' : '');
    if (bh !== dom.btnHtml) {
      dom.btnHtml = bh;
      dom.btn.innerHTML = bh;
      dom.btn.className = wars ? 'war' : '';
      dom.btn.title = wars ? 'Войн: ' + wars + '. Дипломатия' : 'Дипломатия: мир со всеми';
    }
    dom.btn.hidden = false;
    // карточка предложения (на панели державы с вкладкой «Дипломатия» не нужна — там всё видно)
    const inTab = App.ui.sel && App.ui.sel.kind === 'kingdom' && App.ui.kTab === 'dip';
    const o = !inTab && offers[0];
    if (o) {
      if (dom.offId !== o.id) { dom.offId = o.id; dom.off.innerHTML = this.offerHtml(g, o, true); }
      const left = dom.off.querySelector('.dp-left');
      const t = fmtTime(Math.max(0, o.until - g.time));
      if (left && left.textContent !== t) left.textContent = t;
      dom.off.hidden = false;
    } else if (!dom.off.hidden) { dom.off.hidden = true; dom.offId = null; }
    if (this.ask && performance.now() > this.ask.until) { this.ask = null; dom.ask.hidden = true; }
  },

  // ---------- карта: граница войны и союза ----------
  // Участки границ из контуров владений Renderer: тип 1 — война с игроком, 2 — война соперников между собой,
  // 3 — союз с игроком. Пересобираются, только если сдвинулись границы или изменились отношения.
  borderRuns(g, R) {
    const B = R.borders, own = R.terrOwn;
    if (!B || !own || !g.dip) return [];
    const pid = g.player ? g.player.id : -1;
    const key = R.terrKey + '|' + g.dip.v + '|' + pid;
    if (key === this.runsKey && B === this.runsB) return this.runs;
    this.runsKey = key; this.runsB = B;
    const W = g.world.W, H = g.world.H, D = Diplomacy, runs = [];
    for (const [k, t] of B) {
      if (k < 0) continue;
      for (const ch of t.chains) {
        const P = ch.pts, N = ch.nrm, m = P.length / 2;
        let cur = null;
        const flush = () => { if (cur && cur.pts.length >= 6) runs.push(this.finishRun(cur)); cur = null; };
        for (let i = 0; i < m; i++) {
          const tx = Math.floor(P[i * 2] - N[i * 2] * 0.7), ty = Math.floor(P[i * 2 + 1] - N[i * 2 + 1] * 0.7);
          const o = tx >= 0 && ty >= 0 && tx < W && ty < H ? own[ty * W + tx] : -99;
          let type = 0;
          if (o >= 0 && o !== k && k < o) {
            const st = D.state(g, k, o);
            if (st === 'war') type = k === pid || o === pid ? 1 : 2;
            else if (st === 'ally' && (k === pid || o === pid)) type = 3;
          }
          if (type !== (cur ? cur.type : 0)) { flush(); if (type) cur = { type, pts: [] }; }
          if (cur) cur.pts.push(P[i * 2], P[i * 2 + 1]);
        }
        flush();
      }
    }
    this.runs = runs;
    return runs;
  },
  // рамка участка и места значков (скрещённые мечи или кольца) через каждые 10 клеток
  finishRun(r) {
    const p = r.pts, box = [Infinity, Infinity, -Infinity, -Infinity], marks = [];
    let len = 0;
    for (let i = 0; i < p.length; i += 2) {
      box[0] = Math.min(box[0], p[i]); box[1] = Math.min(box[1], p[i + 1]); box[2] = Math.max(box[2], p[i]); box[3] = Math.max(box[3], p[i + 1]);
      if (i) len += Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
    }
    if (r.type !== 2 && len >= 1.5) {
      const step = 10;
      let next = len < step ? len / 2 : step / 2, acc = 0;
      for (let i = 2; i < p.length; i += 2) {
        const d = Math.hypot(p[i] - p[i - 2], p[i + 1] - p[i - 1]);
        while (acc + d >= next) {
          const f = (next - acc) / d;
          marks.push([p[i - 2] + (p[i] - p[i - 2]) * f, p[i - 1] + (p[i + 1] - p[i - 1]) * f]);
          next += step;
        }
        acc += d;
      }
    }
    return { type: r.type, pts: p, box, marks };
  },
  drawMap(ctx, R, z, tl, br) {
    const g = R.g;
    if (!g || !g.dip) return;
    const runs = this.borderRuns(g, R);
    if (!runs.length) return;
    const x0 = tl.x - 1, y0 = tl.y - 1, x1 = br.x + 1, y1 = br.y + 1;
    const paths = [null, null, null];
    for (const r of runs) {
      const b = r.box;
      if (b[0] > x1 || b[2] < x0 || b[1] > y1 || b[3] < y0) continue;
      const p = paths[r.type - 1] || (paths[r.type - 1] = new Path2D());
      p.moveTo(r.pts[0], r.pts[1]);
      for (let i = 2; i < r.pts.length; i += 2) p.lineTo(r.pts[i], r.pts[i + 1]);
    }
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    if (paths[1]) {
      ctx.setLineDash([4 / z, 5 / z]);
      ctx.strokeStyle = 'rgba(150,28,18,0.6)'; ctx.lineWidth = 1.8 / z;
      ctx.stroke(paths[1]);
    }
    if (paths[0]) {
      ctx.setLineDash([]);
      ctx.strokeStyle = 'rgba(255,238,214,0.55)'; ctx.lineWidth = 5.5 / z;
      ctx.stroke(paths[0]);
      ctx.setLineDash([8 / z, 6 / z]);
      ctx.strokeStyle = '#b5231a'; ctx.lineWidth = 3.2 / z;
      ctx.stroke(paths[0]);
    }
    if (paths[2]) {
      ctx.setLineDash([0.01, 6 / z]);
      ctx.strokeStyle = '#e9b52f'; ctx.lineWidth = 3.4 / z;
      ctx.stroke(paths[2]);
    }
    ctx.setLineDash([]);
  },
  drawScreen(ctx, R, z, tl, br, dt) {
    this.sync(dt);
    const g = R.g;
    if (!g || !g.dip || (typeof App !== 'undefined' && App.mode !== 'game')) return;
    this.icons();
    const runs = this.borderRuns(g, R);
    const s = clamp(z * 0.45, 13, 20);
    for (const r of runs) {
      if (r.type === 2 || !r.marks.length) continue;
      const b = r.box;
      if (b[0] > br.x + 1 || b[2] < tl.x - 1 || b[1] > br.y + 1 || b[3] < tl.y - 1) continue;
      for (const m of r.marks) {
        if (m[0] < tl.x - 1 || m[0] > br.x + 1 || m[1] < tl.y - 1 || m[1] > br.y + 1 || !g.isExplored(m[0], m[1])) continue;
        this.badge(ctx, R.toScreen(m[0], m[1]), s, r.type === 1);
      }
    }
    // союзные города при крупном масштабе — с кольцами союза
    if (z < 14) return;
    const pid = g.player.id;
    for (const c of g.cities) {
      if (c.owner < 0 || c.owner === pid || c.x < tl.x - 2 || c.x > br.x + 1 || c.y < tl.y - 2 || c.y > br.y + 1) continue;
      if (Diplomacy.state(g, pid, c.owner) !== 'ally' || !g.isExplored(c.x + 0.5, c.y + 0.5)) continue;
      const rad = R.cityRadius ? R.cityRadius(c) : 0.8;
      this.badge(ctx, R.toScreen(c.x + 0.5 + rad * 0.95, c.y + 0.5 - rad * 0.95), s * 0.9, false);
    }
  },
  badge(ctx, p, s, war) {
    ctx.beginPath();
    ctx.arc(p.x, p.y, s / 2 + 1.5, 0, TAU);
    ctx.fillStyle = war ? '#8e1d12' : '#b98a1c';
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = '#f6ecd2';
    ctx.stroke();
    Icons.draw(ctx, war ? 'swords' : 'dipally', p.x, p.y, s * 0.72, '#fff3e0');
  },
};

if (DipView) {
  UIExt.kingdomTabs.push({ id: 'dip', title: 'Дипломатия', html: (g, pl, ui) => DipView.tabHtml(g, pl, ui) });
  UIExt.actions.dip = (d, ui) => DipView.act(d, ui);
  RenderExt.map.push((ctx, R, z, tl, br) => DipView.drawMap(ctx, R, z, tl, br));
  RenderExt.screen.push((ctx, R, z, tl, br, dt) => DipView.drawScreen(ctx, R, z, tl, br, dt));
  document.head.insertAdjacentHTML('beforeend', '<style id="dip-css">' + [
    // старая вкладка «Соперники» устарела: её заменяет «Дипломатия»
    '#panel-body .tabs button[data-act="ktab"][data-v="rivals"]{display:none}',
    '.dp-list{display:flex;flex-direction:column;gap:6px;margin-top:2px}',
    '.dp-k{border:1px solid var(--line);border-radius:10px;background:rgba(255,250,235,.6);overflow:hidden}',
    '.dp-k.war{border-color:rgba(166,58,40,.6);background:rgba(166,58,40,.07)}',
    '.dp-k.ally{border-color:#c8962e;background:rgba(215,169,68,.14)}',
    '.dp-k.dead{opacity:.55}',
    '.dp-row{display:flex;align-items:center;gap:8px;width:100%;background:none;border:0;padding:6px 10px;min-height:44px;text-align:left}',
    '.dp-row .nm{flex:1;min-width:0;font-weight:700;font-size:15px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}',
    '.dp-st{flex:none;font-size:12px;font-weight:700;padding:2px 7px;border-radius:10px;text-transform:uppercase;letter-spacing:.04em;background:rgba(120,90,50,.15);color:var(--ink-soft)}',
    '.dp-st.war{background:#a63a28;color:#fff1e0}',
    '.dp-st.peace{background:rgba(79,122,44,.16);color:#3c5e20}',
    '.dp-st.truce{background:rgba(79,122,44,.1);color:#3c5e20;border:1px dashed rgba(79,122,44,.5)}',
    '.dp-st.ally{background:#d7a944;color:#2a1b0d}',
    '.dp-op{flex:none;font-weight:700;font-variant-numeric:tabular-nums;min-width:30px;text-align:right}',
    '.dp-op.neg{color:var(--red)}.dp-op.pos{color:var(--green)}',
    '.dp-chev{flex:none;width:8px;height:8px;border-right:2px solid var(--ink-soft);border-bottom:2px solid var(--ink-soft);transform:rotate(45deg);margin:0 4px 4px 2px}',
    '.dp-k.open .dp-chev{transform:rotate(-135deg);margin:4px 4px 0 2px}',
    '.dp-body{padding:0 10px 10px;font-size:14px}',
    '.dp-line{display:flex;flex-wrap:wrap;align-items:baseline;gap:4px 8px;margin-top:6px}',
    '.dp-line .k{color:var(--ink-soft);font-size:13px}',
    '.dp-chip{display:inline-flex;align-items:center;gap:3px;padding:1px 8px;border-radius:12px;background:rgba(120,90,50,.12);font-size:13px}',
    '.dp-score{margin-top:4px}',
    '.dp-bar{position:relative;height:10px;margin-top:5px;border-radius:5px;background:rgba(60,40,20,.15);border:1px solid rgba(60,40,20,.3);overflow:hidden}',
    '.dp-bar i{position:absolute;top:0;bottom:0}.dp-bar i.pos{background:#6b9a3c}.dp-bar i.neg{background:#b4482f}',
    '.dp-bar b{position:absolute;left:50%;top:0;bottom:0;width:2px;margin-left:-1px;background:#2a1b0d}',
    '.dp-acts{display:flex;flex-wrap:wrap;align-items:center;gap:6px;margin-top:8px}',
    '.dp-acts .act{flex:1 1 auto;min-height:38px;padding:6px 10px;font-size:14px}',
    '.dp-acts .act .ico{margin-right:4px}',
    '.dp-q{flex-basis:100%;font-weight:700;color:#7a2a18}',
    '.act.dp-red{background:linear-gradient(#d0644c,#9c3420);color:#fff3e6;border-color:#5e1a0e;box-shadow:inset 0 1px 0 rgba(255,220,200,.4),0 2px 0 #5e1a0e}',
    '.act.dp-red:disabled{background:rgba(166,58,40,.07);color:#8a2a18;border-color:rgba(166,58,40,.5);box-shadow:none}',
    '.dp-terms{display:flex;flex-direction:column;gap:5px;margin-top:8px;padding:8px;border-radius:8px;background:rgba(255,250,235,.7);border:1px dashed var(--line)}',
    '.dp-terms .act{text-align:left;white-space:normal;min-height:36px;font-size:14px}',
    '.dp-terms .tip{margin-top:2px}',
    '.dp-ans{margin-top:8px;padding:6px 9px;border-radius:8px;font-size:14px;font-weight:700}',
    '.dp-ans.no{background:rgba(166,58,40,.1);color:#7a2a18}.dp-ans.ok{background:rgba(79,122,44,.14);color:#2f4d18}',
    '.dp-offer{border-color:#c8962e;background:linear-gradient(180deg,#fff6db,#f5e5bb)}',
    '.dp-offer.bad{border-color:rgba(166,58,40,.6);background:linear-gradient(180deg,#fbe9dc,#f1d6c0)}',
    '.dp-ot{display:flex;gap:8px;align-items:center;font-size:14px;line-height:1.25}',
    '.dp-offer .dp-acts{margin-top:6px}.dp-offer .dp-acts .act{flex:1 1 0}',
    '.dp-timer{flex:none;display:inline-flex;align-items:center;gap:2px;color:var(--ink-soft);font-size:13px;font-variant-numeric:tabular-nums}',
    '.dp-offer .tip{margin-top:4px}',
    '#dip-offer{margin:0;padding:7px 9px;border-width:2px;box-shadow:0 6px 20px rgba(0,0,0,.45);cursor:pointer}',
    '#dip-offer .dp-offer{margin:0;padding:0;border:0;background:none}',
    '#dip-offer .act{min-height:36px;padding:5px 8px}',
    '#dip-offer .tip{font-size:12px}',
    '#dip-offer{background:linear-gradient(180deg,#fff6db,#f5e5bb);border:2px solid #c8962e;border-radius:10px}',
    '#dip-ask{position:absolute;left:50%;top:calc(var(--top) + 52px);transform:translateX(-50%);width:420px;max-width:92vw;background:var(--paper);border:2px solid #a63a28;border-radius:10px;padding:9px 12px;box-shadow:0 8px 26px rgba(0,0,0,.5);z-index:5}',
    '#dip-btn{display:flex;align-items:center;gap:4px;flex:none;background:rgba(0,0,0,.25);border:1px solid var(--wood-line);border-radius:7px;color:#f3e3bd;padding:3px 8px;min-height:32px;font-weight:700}',
    '#dip-btn.war{background:rgba(150,36,22,.9);border-color:#e0806a;color:#fff1e0}',
    '#dip-btn .dot{width:8px;height:8px;border-radius:50%;background:var(--gold-hi);box-shadow:0 0 0 2px rgba(243,213,138,.4)}',
    '#dip-btn .ico{width:18px;height:18px}',
  ].join('') + '</style>');
}
