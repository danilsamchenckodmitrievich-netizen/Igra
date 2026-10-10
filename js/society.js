'use strict';
// Общество: довольство городов и мятежи, налоги, знания (технологии), погода, случайные события и наёмники (Mods.add).
// Логика работает и без браузера (tools/sim.js): состояние городов — в c.soc, держав — в k.soc, остальное — в g.soc.
// Интерфейс (шапка города, вкладки «Порядок» и «Знания», индикатор погоды) и отрисовка погоды — в блоке внизу, только в браузере.

const SOCIETY = {
  startHappy: 60,
  rate: 0.04,          // доля разрыва до цели, которую довольство проходит за секунду
  base: 50,
  fed: 5, starving: -25, unpaid: -6,
  siege: -20,
  enemies: 3,          // враги на землях: × √(воины / 10), не больше enemiesMax
  enemiesMax: 10,
  order: 15,           // гарнизон: до стольких очков, если воинов хватает на порядок
  orderShare: 0.06,    // нужно воинов: доля жителей, но не меньше orderMin
  orderMin: 40,
  taken: 30, takenFree: 20, takenTime: 300,   // недавний захват: минус, проходящий за takenTime секунд
  market: 3, capital: 6, townhall: 8,
  crowd: 2,            // теснота: за каждый уровень города выше третьего
  realmFrom: 6, realmMax: 10,   // большая держава: −1 за каждый город сверх realmFrom
  plague: -12,
  unrest: 30,          // ниже — волнения
  revolt: 22,          // ниже, если волнения длятся revoltAfter секунд, — мятеж
  revoltAfter: 60,
  calm: 240,           // после мятежа или его подавления столько секунд нового не будет
  noRevoltBefore: 300, // первые минуты партии мятежей нет
};
// Ставка налога: множитель податей с жителей и сдвиг довольства.
const TAX_RATES = [
  { id: 'low', name: 'Низкие', gold: 0.7, happy: 12 },
  { id: 'normal', name: 'Обычные', gold: 1, happy: 0 },
  { id: 'high', name: 'Высокие', gold: 1.35, happy: -14 },
];

// Знания: три ветви по три ступени. Изучаются по одному, оплачиваются золотом по ходу (rate — золота в минуту).
const TECH_BRANCHES = [['eco', 'Хозяйство'], ['war', 'Война'], ['state', 'Государство']];
const TECH_TIERS = [null, { time: 80, rate: 45 }, { time: 110, rate: 60 }, { time: 150, rate: 75 }];
const TECHS = {
  plough: { branch: 'eco', tier: 1, name: 'Тяжёлый плуг', icon: 'farm', need: [], desc: 'Фермы дают на 25% больше еды.' },
  mill: { branch: 'eco', tier: 2, name: 'Водяная мельница', icon: 'lumber', need: ['plough'], desc: 'Лесопилки +25% дерева; зимой поля теряют меньше урожая.' },
  mining: { branch: 'eco', tier: 2, name: 'Рудное дело', icon: 'mine', need: ['plough'], desc: 'Каменоломни и рудники дают на 30% больше.' },
  crafts: { branch: 'eco', tier: 3, name: 'Ремёсла', icon: 'factory', need: ['mill', 'mining'], desc: 'Мануфактуры и рынки приносят на 30% больше золота.' },
  drill: { branch: 'war', tier: 1, name: 'Строевая выучка', icon: 'flag', need: [], desc: 'Войска бьются на 10% сильнее, боевой дух восстанавливается вдвое быстрее.' },
  plate: { branch: 'war', tier: 2, name: 'Латы', icon: 'knight', need: ['drill'], desc: 'Рыцари и мечники на 20% сильнее в бою.' },
  crossbow: { branch: 'war', tier: 2, name: 'Арбалетное дело', icon: 'crossbow', need: ['drill'], desc: 'Лучники и арбалетчики бьют на 20% сильнее.' },
  trebuchet: { branch: 'war', tier: 3, name: 'Требушеты', icon: 'catapult', need: ['plate', 'crossbow'], desc: 'Осаждающие армии рушат стены в полтора раза быстрее.' },
  roads: { branch: 'state', tier: 1, name: 'Каменные мосты и дороги', icon: 'walls', need: [], desc: 'По дорогам армии идут на 25% быстрее.' },
  writing: { branch: 'state', tier: 2, name: 'Письменность', icon: 'scroll', need: ['roads'], desc: 'Знания изучаются на 30% быстрее.' },
  townhall: { branch: 'state', tier: 2, name: 'Ратуша', icon: 'level', need: ['roads'], desc: '+8 к довольству во всех городах.' },
  treasury: { branch: 'state', tier: 3, name: 'Казначейство', icon: 'coin', need: ['writing', 'townhall'], desc: 'Налоги с жителей приносят на 15% больше золота.' },
};
const TECH_IDS = Object.keys(TECHS);
const RESEARCH_MIN_GOLD = 30;   // при меньшей казне изучение стоит

// Погода: области (фронты), плывущие по ветру. speed — множитель скорости армий в самом сердце области,
// vision — обзора, farm — урожая ферм, ranged — силы стрелков, happy — довольства.
const WEATHER = {
  rain: { name: 'Дождь', speed: 0.85, r: [10, 16], life: [40, 70], drift: 1, tip: 'армии идут медленнее' },
  storm: { name: 'Ливень', speed: 0.7, ranged: 0.75, r: [7, 11], life: [25, 45], drift: 1.4, tip: 'армии вязнут, луки и арбалеты бьют хуже' },
  fog: { name: 'Туман', speed: 0.95, vision: 0.5, r: [9, 15], life: [35, 60], drift: 0.4, tip: 'обзор вдвое меньше' },
  snow: { name: 'Снегопад', speed: 0.8, r: [12, 18], life: [40, 70], drift: 0.8, tip: 'армии идут медленнее' },
  drought: { name: 'Засуха', farm: 0.5, happy: -5, r: [13, 19], life: [90, 130], drift: 0.08, tip: 'фермы дают вдвое меньше, горожане тревожатся' },
};
// Вероятности погоды по сезонам (весна, лето, осень, зима); clear — новая область не появляется.
const WEATHER_SEASONS = [
  { clear: 3, rain: 3, storm: 1, fog: 2 },
  { clear: 5, rain: 1, storm: 1.5, drought: 1.2, fog: 0.3 },
  { clear: 2.5, rain: 3, storm: 1, fog: 3 },
  { clear: 2, snow: 4, fog: 1.5 },
];

const Society = {
  // ---------- состояние ----------
  city(c) {
    return c.soc || (c.soc = { happy: SOCIETY.startHappy, unrest: 0, takenAt: null, takenPen: 0, plague: 0, immune: 0, boost: 0, calm: 0, warned: false });
  },
  realm(k) { return k.soc || (k.soc = { tax: 1, done: {}, cur: null, part: {} }); },
  has(g, kid, tech) {
    const k = g.kingdom(kid);
    return !!(k && k.soc && k.soc.done[tech]);
  },
  fresh(g) {
    return {
      rng: new Rng(((g.opts.seed | 0) * 2654435761 ^ 0x51ed27) >>> 0), tickT: 0, nid: 1,
      fronts: [], wind: 0, spawnT: 5, aiEventT: 120, offers: [], rebels: null, mercs: null,
    };
  },
  // Особые «державы» без городов: мятежники (враждебны всем) и вольные наёмники (не враждуют ни с кем).
  ensureKingdoms(g) {
    const S = g.soc;
    const mk = (flag, name, color, dark, sigil) => {
      let k = g.kingdoms.find(x => x[flag]);
      if (!k) {
        k = { id: g.newId(), name, color, dark, sigil, isPlayer: false, alive: true, bandit: true, res: { gold: 0, food: 0, wood: 0, stone: 0, iron: 0 }, stats: {} };
        k[flag] = true;
        g.kingdoms.push(k);
        g.kingdomById.set(k.id, k);
      }
      return k.id;
    };
    S.rebels = mk('rebel', 'Мятежники', '#6e2f26', '#2a110d', 'militia');
    S.mercs = mk('merc', 'Вольные наёмники', '#9a7b4f', '#4a3a22', 'coin');
  },

  // ---------- довольство ----------
  // Целевое довольство города (0…100); если передан parts — туда ложатся причины [подпись, очки].
  mood(g, c, parts) {
    const H = SOCIETY, k = g.kingdom(c.owner), s = this.city(c);
    if (!k || k.bandit) return s.happy;
    const ks = this.realm(k);
    let t = H.base;
    const add = (name, v) => { t += v; if (parts && Math.abs(v) >= 0.5) parts.push([name, v]); };
    add('налоги', TAX_RATES[ks.tax].happy);
    if (k.starving) add('голод', H.starving); else add('сытость', H.fed);
    if (k.unpaid) add('казна пуста', H.unpaid);
    if (c.siegeBy) add('осада', H.siege);
    // враги на землях города
    const w = g.world;
    let foe = 0;
    for (const a of g.armies) {
      if (a.owner === c.owner || Math.abs(a.x - c.x) > 12 || Math.abs(a.y - c.y) > 12) continue;
      const i = w.tileAt(a.x, a.y);
      if (i >= 0 && w.cityOf[i] === c.id && g.isHostile(a.owner, c.owner)) foe += menCount(a.units);
    }
    if (foe) add('враги на землях', -Math.min(H.enemiesMax, H.enemies * Math.sqrt(foe / 10)));
    const men = menCount(c.garrison), need = Math.max(H.orderMin, c.pop * H.orderShare);
    add('гарнизон', H.order * Math.min(1, men / need));
    if (s.takenAt !== null && g.time - s.takenAt < H.takenTime) add('недавний захват', -s.takenPen * (1 - (g.time - s.takenAt) / H.takenTime));
    if (c.buildings.market) add('рынок', H.market * c.buildings.market);
    if (c.isCapital) add('столица', H.capital);
    if (ks.done.townhall) add('ратуша', H.townhall);
    if (c.level > 3) add('теснота', -H.crowd * (c.level - 3));
    const n = this.realmSize(g, k);
    if (n > H.realmFrom) add('большая держава', -Math.min(H.realmMax, n - H.realmFrom));
    if (s.plague > 0) add('мор', H.plague);
    const wx = this.wx(g, c.x + 0.5, c.y + 0.5);
    if (wx && WEATHER[wx.kind].happy) add(WEATHER[wx.kind].name.toLowerCase(), WEATHER[wx.kind].happy * wx.f);
    if (Math.abs(s.boost) >= 0.5) add(s.boost > 0 ? 'праздники' : 'беды', s.boost);
    return clamp(t, 0, 100);
  },
  realmSize(g, k) {
    const S = g.soc;
    if (S.sizeT !== g.time) { S.sizeT = g.time; S.size = {}; for (const c of g.cities) if (c.owner !== -1) S.size[c.owner] = (S.size[c.owner] || 0) + 1; }
    return S.size[k.id] || 0;
  },
  // Множители дохода и роста от довольства.
  incomeMult(h) { return h >= 50 ? 1 + (h - 50) / 500 : 0.5 + h / 100; },
  growthMult(h) { return h >= 70 ? 1.15 : h >= 40 ? 1 : Math.max(0, h / 40); },
  state(c) {
    const s = this.city(c);
    if (s.plague > 0) return 'мор';
    if (s.happy < SOCIETY.unrest) return 'волнения';
    if (s.happy < 45) return 'недовольство';
    return s.happy >= 70 ? 'довольны' : 'спокойно';
  },

  // Секундный такт: довольство, волнения и мятежи, мор, изучение знаний, наёмники.
  tick(g) {
    const S = g.soc, H = SOCIETY, pl = g.player;
    for (const k of g.kingdoms) {
      if (k.bandit || !k.alive) continue;
      const ks = this.realm(k);
      if (ks.cur) this.research(g, k, ks);
      // выучка: боевой дух возвращается вдвое быстрее
      if (ks.done.drill) for (const a of g.armies) if (a.owner === k.id && a.state !== 'battle' && a.state !== 'siege') a.morale = Math.min(100, a.morale + 0.8);
    }
    for (const c of g.cities) {
      const s = this.city(c);
      if (s.boost) s.boost = Math.abs(s.boost) < 0.2 ? 0 : s.boost * 0.985;
      if (s.plague > 0) this.plagueTick(g, c, s);
      const k = g.kingdom(c.owner);
      if (!k || k.bandit) continue;
      const target = this.mood(g, c);
      s.happy = clamp(s.happy + (target - s.happy) * H.rate, 0, 100);
      if (s.happy < H.unrest) {
        s.unrest++;
        if (!s.warned) {
          s.warned = true;
          if (k === pl) g.notify('Волнения в ' + c.name + ': горожане недовольны. Снизьте налоги или усильте гарнизон, иначе вспыхнет мятеж.', 'bad', c, true);
        }
        if (s.unrest >= H.revoltAfter && s.happy < H.revolt && g.time > H.noRevoltBefore && g.time >= s.calm && !c.siegeBy) this.revolt(g, c, k);
      } else {
        s.unrest = Math.max(0, s.unrest - 2);
        if (s.happy > H.unrest + 8) s.warned = false;
      }
    }
    // мятежники, упустившие свой город, расходятся по домам
    for (const a of g.armies.slice()) if (a.isRebel && a.state !== 'siege' && a.state !== 'battle') g.removeArmy(a);
    // наёмники ждут ответа
    for (const o of S.offers.slice()) {
      const a = g.army(o.army), c = g.city(o.city);
      if (!a || !c) { this.dropOffer(g, o); continue; }
      if (g.time >= o.until || c.owner === -1) this.dismiss(g, o);
    }
  },

  // ---------- мятеж ----------
  revolt(g, c, k) {
    const S = g.soc, s = this.city(c), w = g.world;
    const share = 0.08 + 0.06 * clamp((SOCIETY.revolt - s.happy) / SOCIETY.revolt, 0, 1);
    const men = clamp(Math.round(c.pop * share / 10) * 10, 20, 300);
    const units = { militia: Math.max(10, Math.round(men * 0.7 / 10) * 10) };
    if (men - units.militia >= 10) units.spear = Math.round((men - units.militia) / 10) * 10;
    if (c.pop > 1200) units.archer = 10;
    c.pop = Math.max(50, c.pop - menCount(units));
    let spot = w.nearestPassable(c.x + 1, c.y);
    if (spot < 0) spot = g.cityTile(c);
    const a = g.makeArmy(S.rebels, spot % w.W + 0.5, Math.floor(spot / w.W) + 0.5, units);
    a.isRebel = true; a.name = 'Мятежники'; a.rebelCity = c.id;
    // горожане не встают на защиту, а ворота уже в руках мятежников
    c.raised = true;
    c.wallHp = 0;
    s.unrest = 0; s.calm = g.time + SOCIETY.calm;
    g.startSiege(a, c);
    if (k.isPlayer) g.notify('Мятеж в ' + c.name + '! ' + menCount(units) + ' горожан взялись за оружие и открыли ворота. Если гарнизон падёт, город отложится.', 'bad', c, true);
    else if (g.explored[g.cityTile(c)]) g.notify('Мятеж в ' + c.name + ' (' + k.name + ')', 'info', c);
    g.emit('revolt', { city: c, army: a });
  },
  // Мятежники взяли город: он отпадает и становится вольным, мятежники — его гарнизоном.
  secede(g, c, a) {
    const old = g.kingdom(c.owner), wasCapital = c.isCapital, s = this.city(c);
    c.owner = -1;
    c.isCapital = false;
    c.siegeBy = null; c.raised = false;
    c.construction = null; c.queue = [];
    c.garrison = { ...a.units }; c.wounds = {};
    c.wallHp = 0;
    s.happy = 50; s.unrest = 0; s.warned = false;
    a.siegeCity = null; a.battleId = null; a.won = true;
    g.removeArmy(a);
    g.refreshTerritory(true);
    g.ownershipVersion++;
    if (old && old.stats) old.stats.lostCities = (old.stats.lostCities || 0) + 1;
    if (old && old.isPlayer) g.notify(c.name + ' отложился: мятежники провозгласили вольный город.', 'bad', c, true);
    else if (g.explored[g.cityTile(c)]) g.notify(c.name + ' отложился от державы «' + (old ? old.name : '') + '» и стал вольным городом', 'info', c);
    g.emit('seceded', { city: c, from: old });
    if (old) {
      if (wasCapital) g.moveCapital(old);
      g.checkElimination(old);
    }
    g.checkVictory();
  },

  // ---------- мор ----------
  startPlague(g, c, from) {
    const s = this.city(c);
    if (s.plague > 0 || s.immune > g.time) return false;
    s.plague = 50 + this.rng(g).range(0, 20);
    const pl = g.player;
    if (c.owner === pl.id) g.notify(from ? 'Мор перекинулся из ' + from.name + ' в ' + c.name + '!' : 'В ' + c.name + ' мор! Жители умирают, недовольство растёт; болезнь может перекинуться на соседние города.', 'bad', c, true);
    else if (g.isVisible(c.x + 0.5, c.y + 0.5)) g.notify('Мор в ' + c.name, 'info', c);
    return true;
  },
  plagueTick(g, c, s) {
    c.pop = Math.max(60, c.pop - c.pop * 0.0025);
    s.plague = Math.max(0, s.plague - 1);
    if (s.plague === 0) { s.immune = g.time + 240; return; }
    const rng = this.rng(g);
    if (!rng.chance(0.015)) return;
    const near = g.cities.filter(o => o !== c && Math.abs(o.x - c.x) < 14 && Math.abs(o.y - c.y) < 14 && dist(o.x, o.y, c.x, c.y) < 14);
    if (near.length) this.startPlague(g, rng.pick(near), c);
  },

  // ---------- знания ----------
  techCost(id) { const t = TECH_TIERS[TECHS[id].tier]; return { time: t.time, rate: t.rate, gold: Math.round(t.rate * t.time / 60) }; },
  techSpeed(k) { return k.soc && k.soc.done.writing ? 1.3 : 1; },
  techState(k, id) {
    const ks = this.realm(k);
    if (ks.done[id]) return 'done';
    if (ks.cur === id) return 'cur';
    return TECHS[id].need.every(n => ks.done[n]) ? 'avail' : 'locked';
  },
  startResearch(g, k, id) {
    if (!TECHS[id]) return 'Нет такого знания';
    const st = this.techState(k, id);
    if (st === 'done') return 'Уже изучено';
    if (st === 'locked') return 'Сначала изучите: ' + TECHS[id].need.filter(n => !k.soc.done[n]).map(n => TECHS[n].name).join(', ');
    k.soc.cur = id;
    return null;
  },
  stopResearch(g, k) { this.realm(k).cur = null; },
  // золото в минуту, которое сейчас уходит на изучение (0 — не изучаем или казна пуста)
  researchDrain(k) {
    const ks = k.soc;
    if (!ks || !ks.cur || k.res.gold < RESEARCH_MIN_GOLD) return 0;
    return TECH_TIERS[TECHS[ks.cur].tier].rate;
  },
  research(g, k, ks) {
    if (k.res.gold < RESEARCH_MIN_GOLD) return;
    const id = ks.cur, need = TECH_TIERS[TECHS[id].tier].time;
    ks.part[id] = (ks.part[id] || 0) + this.techSpeed(k);
    if (ks.part[id] < need) return;
    delete ks.part[id];
    ks.done[id] = true;
    ks.cur = null;
    if (k.isPlayer) g.notify('Изучено знание «' + TECHS[id].name + '»: ' + TECHS[id].desc.charAt(0).toLowerCase() + TECHS[id].desc.slice(1), 'good', null, true);
    g.emit('researched', { kingdom: k, tech: id });
  },

  // ---------- погода ----------
  rng(g) { return g.soc.rng; },
  fade(f) { return Math.max(0, Math.min(1, f.age / 8, (f.life - f.age) / 8)); },
  // Погода в точке: { kind, f } (сила 0…1) — самая сильная область; один и тот же объект, брать сразу.
  wx(g, x, y) {
    const fr = g.soc.fronts;
    let best = null, bf = 0.15;
    for (let i = 0; i < fr.length; i++) {
      const f = fr[i], dx = x - f.x, dy = y - f.y, r = f.r;
      if (dx > r || dx < -r || dy > r || dy < -r) continue;
      const q = (dx * dx + dy * dy) / (r * r);
      if (q >= 1) continue;
      const v = Math.min(1, (1 - q) * 1.6) * this.fade(f);
      if (v > bf) { bf = v; best = f; }
    }
    if (!best) return null;
    WX_HERE.kind = best.kind; WX_HERE.f = bf; WX_HERE.front = best;
    return WX_HERE;
  },
  // Множитель от погоды для свойства prop (speed, vision, farm, ranged): самая сильная из накрывших областей.
  wxMult(g, x, y, prop) {
    const fr = g.soc.fronts;
    let m = 1;
    for (let i = 0; i < fr.length; i++) {
      const f = fr[i], W = WEATHER[f.kind];
      if (W[prop] === undefined) continue;
      const dx = x - f.x, dy = y - f.y, r = f.r;
      if (dx > r || dx < -r || dy > r || dy < -r) continue;
      const q = (dx * dx + dy * dy) / (r * r);
      if (q >= 1) continue;
      const v = Math.min(1, (1 - q) * 1.6) * this.fade(f);
      m = Math.min(m, 1 - (1 - W[prop]) * v);
    }
    return m;
  },
  weatherStep(g, dt) {
    const S = g.soc, w = g.world, rng = S.rng;
    S.wind += (rng.next() - 0.5) * 0.03 * dt;
    const vx = Math.cos(S.wind) * 0.12, vy = Math.sin(S.wind) * 0.12;
    for (let i = S.fronts.length - 1; i >= 0; i--) {
      const f = S.fronts[i], W = WEATHER[f.kind];
      f.age += dt;
      if (f.age >= f.life) { S.fronts.splice(i, 1); continue; }
      f.x += vx * W.drift * dt; f.y += vy * W.drift * dt;
    }
    S.spawnT -= dt;
    if (S.spawnT > 0) return;
    S.spawnT = 8 + rng.range(0, 10);
    const max = Math.max(2, Math.round(w.W * w.H / 2600));
    if (S.fronts.length >= max) return;
    const weights = WEATHER_SEASONS[g.seasonIndex()];
    let sum = 0;
    for (const k in weights) sum += weights[k];
    let r = rng.next() * sum, kind = 'clear';
    for (const k in weights) { r -= weights[k]; if (r <= 0) { kind = k; break; } }
    if (kind === 'clear') return;
    for (let tries = 0; tries < 20; tries++) {
      const x = rng.int(4, w.W - 5), y = rng.int(4, w.H - 5);
      if (w.terrain[w.idx(x, y)] <= T.SHALLOW) continue;
      this.addFront(g, kind, x + 0.5, y + 0.5);
      return;
    }
  },
  addFront(g, kind, x, y) {
    const S = g.soc, W = WEATHER[kind], rng = S.rng;
    const f = { id: S.nid++, kind, x, y, r: rng.range(W.r[0], W.r[1]), age: 0, life: rng.range(W.life[0], W.life[1]) };
    S.fronts.push(f);
    return f;
  },

  // ---------- события ----------
  // Случайное событие в городе игрока (вызывается ядром вместо простых событий).
  playerEvent(g) {
    const pl = g.player, rng = this.rng(g);
    g.eventT = 80 + rng.range(0, 70);
    const cs = g.citiesOf(pl.id);
    if (!cs.length) return;
    this.cityEvent(g, rng.pick(cs), pl);
  },
  // События в городах соперников: свой таймер, вести — только о том, что видно.
  aiEvents(g, dt) {
    const S = g.soc;
    S.aiEventT -= dt;
    if (S.aiEventT > 0) return;
    S.aiEventT = 90 + S.rng.range(0, 80);
    const cs = g.cities.filter(c => { const k = g.kingdom(c.owner); return k && !k.bandit && !k.isPlayer && k.alive; });
    if (cs.length) this.cityEvent(g, S.rng.pick(cs));
  },
  cityEvent(g, c) {
    const k = g.kingdom(c.owner), rng = this.rng(g), s = this.city(c), mine = k.isPlayer;
    const season = g.seasonIndex();
    const list = [
      ['harvest', season === 3 ? 4 : 12], ['fair', 12], ['plague', 9], ['fire', 10],
      ['drought', season === 1 ? 14 : season === 3 ? 0 : 5], ['mercs', 16], ['settlers', 8], ['ore', 7],
    ];
    let sum = 0;
    for (const e of list) sum += e[1];
    let r = rng.next() * sum, ev = list[0][0];
    for (const e of list) { r -= e[1]; if (r <= 0) { ev = e[0]; break; } }
    const say = (text, kind) => { if (mine) g.notify(text, kind, c, kind === 'bad'); };
    if (ev === 'harvest') {
      const n = 100 + 50 * (c.buildings.farm || 0);
      k.res.food += n; s.boost += 5;
      say('Богатый урожай в ' + c.name + ': +' + n + ' еды', 'good');
    } else if (ev === 'fair') {
      const n = 90 + 50 * (c.buildings.market || 0);
      k.res.gold += n; s.boost += 8;
      say('Ярмарка в ' + c.name + ' собрала купцов со всей округи: +' + n + ' золота, горожане довольны', 'good');
    } else if (ev === 'plague') {
      if (!this.startPlague(g, c, null)) { k.res.gold += 60; say('Лекари ' + c.name + ' справились с хворью. Казна получила 60 золота пожертвований.', 'good'); }
    } else if (ev === 'fire') {
      const n = Math.floor(Math.min(k.res.wood, 60 + c.pop * 0.08));
      k.res.wood -= n; s.boost -= 6;
      let what = '';
      if (rng.chance(0.25)) {
        const before = { ...c.buildings };
        g.damageBuilding(c);
        for (const b in before) if ((c.buildings[b] || 0) < before[b]) what = BUILDINGS[b].name.toLowerCase();
      }
      say('Пожар в ' + c.name + ': сгорело ' + n + ' дерева' + (what ? ', огонь повредил постройку: ' + what : ''), 'bad');
    } else if (ev === 'drought' && season !== 3) {
      this.addFront(g, 'drought', c.x + 0.5, c.y + 0.5);
      say('Засуха в окрестностях ' + c.name + ': урожай упадёт вдвое, пока не пройдёт.', 'bad');
    } else if (ev === 'mercs') {
      if (!this.offerMercs(g, c)) { k.res.gold += 50; say('Проезжие купцы заплатили пошлину в ' + c.name + ': +50 золота', 'good'); }
    } else if (ev === 'settlers') {
      c.pop = Math.min(CITY_LEVELS[c.level].popMax, c.pop + 60);
      say('В ' + c.name + ' пришли переселенцы: +60 жителей', 'good');
    } else {
      k.res.iron += 60;
      say('Рудокопы ' + c.name + ' нашли жилу: +60 железа', 'good');
    }
  },

  // ---------- наёмники ----------
  mercUnits(g) {
    const rng = this.rng(g), t = g.time;
    const u = { spear: 20, archer: 10 };
    if (t > 400) u[rng.chance(0.5) ? 'sword' : 'crossbow'] = 10;
    if (t > 800) u[rng.chance(0.5) ? 'cavalry' : 'knight'] = 10;
    if (t > 1200) u.spear += 10;
    return u;
  },
  offerMercs(g, c) {
    const S = g.soc, w = g.world;
    if (S.offers.some(o => o.city === c.id) || S.offers.length >= 4) return false;
    let spot = w.nearestPassable(c.x + 2, c.y + 1);
    if (spot < 0 || spot === g.cityTile(c)) return false;
    const units = this.mercUnits(g);
    const a = g.makeArmy(S.mercs, spot % w.W + 0.5, Math.floor(spot / w.W) + 0.5, units);
    a.isMerc = true; a.name = 'Наёмники';
    const price = Math.round(unitPower(units) * 0.95 / 10) * 10;
    const o = { id: S.nid++, city: c.id, army: a.id, price, until: g.time + 50 };
    S.offers.push(o);
    const k = g.kingdom(c.owner);
    if (k && k.isPlayer) g.notify('К ' + c.name + ' пришли наёмники: ' + menCount(units) + ' воинов. Нанять за ' + price + ' золота можно в панели города.', 'war', c, true);
    return true;
  },
  offerAt(g, c) { for (const o of g.soc.offers) if (o.city === c.id) return o; return null; },
  dropOffer(g, o) {
    const S = g.soc, i = S.offers.indexOf(o);
    if (i >= 0) S.offers.splice(i, 1);
  },
  // Нанять: отряд становится армией державы. Возвращает текст ошибки или армию.
  hire(g, o, k) {
    const a = g.army(o.army), c = g.city(o.city);
    if (!a || !c) { this.dropOffer(g, o); return 'Наёмники уже ушли'; }
    if (c.owner !== k.id) return 'Наёмники ждут у чужого города';
    if (k.res.gold < o.price) return 'Не хватает золота: нужно ' + o.price;
    k.res.gold -= o.price;
    const units = { ...a.units }, x = a.x, y = a.y;
    this.dropOffer(g, o);
    g.removeArmy(a);
    const b = g.makeArmy(k.id, x, y, units);
    b.name = 'Наёмники';
    b.morale = 90;
    if (k.isPlayer) g.notify('Наёмники поступили на службу', 'good', b);
    return b;
  },
  // Не наняли: половина уходит, остальные идут грабить округу.
  dismiss(g, o) {
    const a = g.army(o.army), c = g.city(o.city);
    this.dropOffer(g, o);
    if (!a) return;
    const k = c ? g.kingdom(c.owner) : null;
    const x = a.x, y = a.y, units = { ...a.units };
    g.removeArmy(a);
    if (!this.rng(g).chance(0.5) || !c) {
      if (k && k.isPlayer) g.notify('Наёмники ушли от ' + c.name + ' искать другого нанимателя', 'info', c);
      return;
    }
    const b = g.makeArmy(g.bandits.id, x, y, units);
    b.isBandit = true; b.name = 'Наёмники-грабители'; b.born = g.time;
    g.banditTarget(b);
    if (k && k.isPlayer) g.notify('Ненанятые наёмники пошли грабить окрестности ' + c.name + '!', 'bad', c, true);
  },

  // ---------- решения ИИ ----------
  ai(g, k, ctx) {
    const ks = this.realm(k), cs = ctx.cities;
    // налоги по довольству
    let sum = 0, min = 100;
    for (const c of cs) { const h = this.city(c).happy; sum += h; if (h < min) min = h; }
    const avg = sum / cs.length;
    if (min < 34 || avg < 48) ks.tax = 0;
    else if (ks.tax === 0) { if (min >= 42 && avg >= 56) ks.tax = 1; }
    else if (ks.tax === 1) { if (min >= 50 && avg >= 66 && !k.starving) ks.tax = 2; }
    else if (min < 42 || avg < 58) ks.tax = 1;
    // знания: по своему порядку, пока в казне водится золото
    if (!ks.cur && g.time > 90 && ctx.inc.gold > 40) {
      const pref = AI_TECH_ORDER[(k.preset || 0) % AI_TECH_ORDER.length];
      for (const id of pref) if (this.techState(k, id) === 'avail') { ks.cur = id; break; }
    }
    // волнения: войско в неспокойный город, а если его нет рядом — ополчение
    for (const c of cs) {
      if (this.city(c).happy >= SOCIETY.unrest + 4 || c.siegeBy) continue;
      let best = null, bd = 22;
      for (const a of g.armies) {
        if (a.owner !== k.id || a.state !== 'idle' || a.ai === 'defend') continue;
        const d = dist(a.x, a.y, c.x, c.y);
        if (d < bd) { bd = d; best = a; }
      }
      if (best) { g.order(best, { kind: 'city', id: c.id }); break; }
      if (c.queue.length < 2 && k.res.gold > 80) g.recruit(c, 'militia');
    }
    // наёмники у своих городов: нанять, если есть золото и нужда в войске, иначе отказать сразу
    for (const o of g.soc.offers.slice()) {
      const c = g.city(o.city);
      if (!c || c.owner !== k.id) continue;
      const need = ctx.threats.length > 0 || AI.totalPower(g, k) < AI.wantedPower(g, k) * 0.8;
      if (need && k.res.gold >= o.price + 60) this.hire(g, o, k);
      else this.dismiss(g, o);
    }
  },
  // Лишний гарнизон для неспокойного города (в единицах силы для AI.minGarrison).
  aiGarrison(g, c) {
    const h = this.city(c).happy;
    return h < 45 ? (45 - h) * 8 : 0;
  },
};
const WX_HERE = { kind: null, f: 0, front: null };
// Порядок изучения знаний ИИ: у каждой державы свой характер.
const AI_TECH_ORDER = [
  ['plough', 'drill', 'roads', 'mining', 'townhall', 'crossbow', 'mill', 'writing', 'plate', 'treasury', 'crafts', 'trebuchet'],
  ['drill', 'plough', 'plate', 'roads', 'crossbow', 'townhall', 'mining', 'trebuchet', 'writing', 'mill', 'treasury', 'crafts'],
  ['roads', 'plough', 'townhall', 'writing', 'drill', 'treasury', 'mining', 'mill', 'crossbow', 'crafts', 'plate', 'trebuchet'],
];
INFLUENCE.labels.mood = 'довольство';

Mods.add({
  name: 'society',
  init(g, loaded) {
    if (!g.soc) g.soc = Society.fresh(g);
    Society.ensureKingdoms(g);
    for (const c of g.cities) Society.city(c);
    for (const k of g.kingdoms) if (!k.bandit) Society.realm(k);
    g.on((t, d) => {
      if (t === 'captured' && d.city) {
        const s = Society.city(d.city);
        s.takenAt = g.time; s.takenPen = d.from && !d.from.bandit ? SOCIETY.taken : SOCIETY.takenFree;
        s.happy = Math.min(s.happy, 40); s.unrest = 0; s.warned = false; s.calm = g.time + 60;
        const o = Society.offerAt(g, d.city);
        if (o) Society.dismiss(g, o);
      } else if (t === 'armyRemoved' && d.isRebel && !d.won) {
        // мятежников разбили или они разбежались: город успокаивается
        const c = g.city(d.rebelCity);
        if (c && c.owner !== -1) {
          const s = Society.city(c);
          s.boost += 15; s.unrest = 0; s.calm = g.time + SOCIETY.calm;
          if (g.kingdom(c.owner).isPlayer) g.notify('Мятеж в ' + c.name + ' подавлен', 'good', c, true);
        }
      }
    });
  },
  update(g, dt) {
    const S = g.soc;
    Society.weatherStep(g, dt);
    S.tickT += dt;
    while (S.tickT >= 1) { S.tickT -= 1; Society.tick(g); }
    Society.aiEvents(g, dt);
    // требушеты: осадные армии рушат стены быстрее
    for (const b of g.battles) {
      if (b.kind !== 'siege') continue;
      const a = g.army(b.a), c = g.city(b.city);
      if (a && c && c.wallHp > 0 && Society.has(g, a.owner, 'trebuchet')) c.wallHp = Math.max(0, c.wallHp - siegePower(a.units) * 0.5 * dt);
    }
  },
  serialize(g) {
    const S = g.soc;
    return { rng: S.rng.state, tickT: S.tickT, nid: S.nid, fronts: S.fronts, wind: S.wind, spawnT: S.spawnT, aiEventT: S.aiEventT, offers: S.offers, rebels: S.rebels, mercs: S.mercs };
  },
  restore(g, d) {
    const S = Society.fresh(g);
    if (d) {
      for (const k in d) if (k !== 'rng') S[k] = d[k];
      S.rng.state = d.rng >>> 0;
    }
    g.soc = S;
  },
  modify: {
    // наёмники ни с кем не враждуют, пока ждут нанимателя
    hostile(g, v, a, b) {
      const S = g.soc;
      return v && !(S && (a === S.mercs || b === S.mercs));
    },
    influence(g, reach, c, parts) {
      if (c.owner === -1 || !c.soc) return reach;
      const h = c.soc.happy;
      const v = h < 40 ? -(40 - h) / 40 * 1.2 : h > 75 ? (h - 75) / 25 * 0.4 : 0;
      if (v) parts.mood = v;
      return reach + v;
    },
    cityIncome(g, out, c, k) {
      if (!k || !k.soc || !c.soc) return out;
      const ks = k.soc, L = c.buildings, siege = c.siegeBy ? 0.3 : 1, winter = g.isWinter();
      // подати с жителей по ставке налога (и казначейству)
      const tax = c.pop * ECON.tax * (1 + BUILDINGS.market.taxBonus * (L.market || 0)) * siege;
      out.gold += tax * (TAX_RATES[ks.tax].gold * (ks.done.treasury ? 1.15 : 1) - 1);
      // знания хозяйства и засуха
      const y = (id, r) => (L[id] ? BUILDINGS[id].yield[r] * L[id] * g.terrainFactor(c, id) * siege : 0);
      const farm = y('farm', 'food');
      if (farm) {
        const now = winter ? ECON.winterFood : 1;
        const drought = Society.wxMult(g, c.x + 0.5, c.y + 0.5, 'farm');
        const want = (winter ? (ks.done.mill ? 0.7 : ECON.winterFood) : 1) * (ks.done.plough ? 1.25 : 1) * drought;
        out.food += farm * (want - now);
      }
      if (ks.done.mill) out.wood += y('lumber', 'wood') * 0.25;
      if (ks.done.mining) { out.stone += y('quarry', 'stone') * 0.3; out.iron += y('mine', 'iron') * 0.3; }
      if (ks.done.crafts) out.gold += y('market', 'gold') * 0.3;
      if (c.soc.plague > 0) out.gold *= 0.8;
      // довольство: недовольные работают хуже
      const m = Society.incomeMult(c.soc.happy);
      if (m !== 1) for (const r in out) if (out[r] > 0) out[r] *= m;
      return out;
    },
    income(g, total, k, parts) {
      if (!k.soc) return total;
      if (k.soc.done.crafts && parts.factory.gold > 0) { const v = parts.factory.gold * 0.3; parts.factory.gold += v; total.gold += v; }
      const r = Society.researchDrain(k);
      if (r) { parts.research = { gold: -r }; total.gold -= r; }
      return total;
    },
    growth(g, rate, c) {
      if (c.owner === -1 || !c.soc) return rate;
      return c.soc.plague > 0 ? 0 : rate * Society.growthMult(c.soc.happy);
    },
    armySpeed(g, s, a) {
      s *= Society.wxMult(g, a.x, a.y, 'speed');
      if (Society.has(g, a.owner, 'roads')) { const i = g.world.tileAt(a.x, a.y); if (i >= 0 && g.world.road[i]) s *= 1.25; }
      return s;
    },
    vision(g, r, o) {
      const x = o.units ? o.x : o.x + 0.5, y = o.units ? o.y : o.y + 0.5;
      return r * Society.wxMult(g, x, y, 'vision');
    },
    // сила армии в бою: выучка, латы, арбалеты; ливень мешает стрелкам
    attack(g, m, a) {
      const k = g.kingdom(a.owner), ks = k && k.soc;
      const storm = Society.wxMult(g, a.x, a.y, 'ranged');
      if (!(ks && (ks.done.drill || ks.done.plate || ks.done.crossbow)) && storm === 1) return m;
      let heavy = 0, ranged = 0, all = 0;
      for (const u in a.units) {
        const p = unitPower({ [u]: a.units[u] });
        all += p;
        if (u === 'sword' || u === 'knight') heavy += p;
        else if (u === 'archer' || u === 'crossbow') ranged += p;
      }
      if (!all) return m;
      heavy /= all; ranged /= all;
      if (ks && ks.done.drill) m *= 1.1;
      if (ks && ks.done.plate) m *= 1 + 0.2 * heavy;
      if (ks && ks.done.crossbow) m *= 1 + 0.2 * ranged;
      return m * (1 - (1 - storm) * ranged);
    },
    capture(g, done, c, a) {
      if (done || !a.isRebel) return done;
      Society.secede(g, c, a);
      return true;
    },
    randomEvent(g, done) {
      if (done) return done;
      Society.playerEvent(g);
      return true;
    },
    aiGarrison(g, v, c) { return v + Society.aiGarrison(g, c); },
  },
});
