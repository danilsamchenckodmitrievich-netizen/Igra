'use strict';
// Полководцы: именные командиры с навыками и опытом, гибель и плен (Mods.add).
// Полководец назначается к армии (элемент g.armies), даёт ей бонусы навыков, растёт в уровнях за бои и победы и рискует
// головой при разгроме: гибнет или попадает в плен (выкуп золотом). Состояние — g.hr, в сохранении — mods.heroes.
// Ядро Game трогается только поправками Mods.mod('attack' | 'defense' | 'siege' | 'vision' | 'upkeep') и 'armySpeed':
// победы, поражения и исчезновение армий модуль замечает сам (по состоянию армий и событию 'armyRemoved').
// Логика работает и в Node (tools/load.js); интерфейс и слой карты — в конце файла, только в браузере.
//
// API: Heroes.of(g, armyId) → полководец армии | null; Heroes.hire(g, k, cand); Heroes.assign(g, h, army); Heroes.unassign(g, h);
//      Heroes.payRansom(g, h); Heroes.limit(g, kid); Heroes.portrait(g, h, px) → svg; Heroes.summary(g) → цифры для проверок.
// Поля полководца: id, owner, name, face, skills[], level, xp, army (id | null), city (id | null), status ('ok' | 'jail'),
//      by (кто держит в плену), ransom, wins, battles, caps.

const HERO = {
  maxLevel: 5,
  xpLevels: [0, 25, 70, 140, 240], // опыт, с которого начинается 1-й, 2-й, … уровень, следующий порог — индекс level
  maxSkills: 4,
  baseCost: 160, costHero: 40, costLevel: 100, costSkill: 60, // найм: золото
  salary: 2, salaryLevel: 1.5,   // жалованье в минуту
  ransomBase: 80, ransomLevel: 60,
  candCount: 3, candEvery: 150,  // сколько кандидатов предлагают и как часто они меняются, с
  aiThink: 5, aiHireEvery: 90, aiDiscount: 0.35, // ИИ платит за найм и выкуп, сколько есть, если у него не меньше этой доли цены
  jailEscape: 0.025,             // вероятность побега из плена за минуту
  jailWait: 40,                  // ИИ не выкупает раньше, чем через столько секунд плена
  xpBattle: 0.3, xpWin: 10, xpKill: 0.12, xpCapture: 16, xpCaptureLevel: 5, xpLoss: 3, xpMax: 45,
  lvlAttack: 0.03,               // каждый уровень даёт урон армии +3%
  lvlDefense: 0.015,
  cavAtk: 0.25, siege: 0.5, speed: 0.12, guard: 0.2, dig: 0.6, inspire: 0.4, vision: 3, visionLevel: 0.5, upkeepCut: 0.2,
  deadBase: 0.03, deadLoss: 0.2, captBase: 0.07, captLoss: 0.3, // при проигранном бое: от потерь армии
  deadDestroyed: 0.38, captDestroyed: 0.42,                    // при полном разгроме армии
  scoutRange: 4, scoutEvery: 90,
};
const HERO_SKILLS = {
  siege: { name: 'Осадник', icon: 'ram', desc: 'Осадная сила армии +50%: стены рушатся быстрее.' },
  cavalry: { name: 'Кавалерист', icon: 'cavalry', desc: 'Урон конницы и рыцарей +25%.' },
  strat: { name: 'Стратег', icon: 'flag', desc: 'Армия идёт быстрее на 12%.' },
  guard: { name: 'Защитник', icon: 'shield', desc: 'Оборона +20%: армия несёт меньше потерь; окапывается быстрее.' },
  inspire: { name: 'Вдохновитель', icon: 'morale', desc: 'Боевой дух падает на 40% медленнее.' },
  scout: { name: 'Разведчик', icon: 'scout', desc: 'Обзор армии шире, а заметив врага поблизости, полководец предупредит.' },
  quarter: { name: 'Интендант', icon: 'food', desc: 'Содержание армии (золото и еда) дешевле на 20%.' },
};
const HERO_SKILL_IDS = Object.keys(HERO_SKILLS);
const HERO_RANKS = ['Десятник', 'Сотник', 'Воевода', 'Большой воевода', 'Великий полководец'];
const HERO_NAMES = [
  'Всеслав', 'Ратибор', 'Святополк', 'Мстислав', 'Добрыня', 'Ярополк', 'Святослав', 'Изяслав', 'Борислав', 'Радомир',
  'Велимир', 'Лютобор', 'Станимир', 'Бранимир', 'Гостомысл', 'Твердислав', 'Вышеслав', 'Милонег', 'Остромир', 'Богдан',
  'Збыслав', 'Любомир', 'Путята', 'Дубыня', 'Горислав', 'Влад', 'Тихомир', 'Ждан', 'Негослав', 'Любим', 'Яромир', 'Войслав',
];
const HERO_NICKS = [
  'Хромой', 'Удалой', 'Грозный', 'Храбрый', 'Мудрый', 'Тихий', 'Рыжий', 'Седой', 'Меченый', 'Железнорукий', 'Чёрный',
  'Белый', 'Быстрый', 'Суровый', 'Весёлый', 'Кривой', 'Лютый', 'Горбатый', 'Крепкий', 'Смелый', 'Ясный', 'Могучий',
  'Одноглазый', 'Молчун', 'Волк', 'Медведь', 'Сокол', 'Ворон', 'Щербатый', 'Невзор', 'Окаянный', 'Старый',
];
const HERO_SKIN = ['#ebc9a4', '#dcae84', '#c99468', '#f2d6b6'];
const HERO_HAIR = ['#3a2414', '#6b4524', '#a9a49a', '#8a3b1c', '#1c1410'];
const HERO_RING = ['#8c6a35', '#8c6a35', '#b2b8be', '#b2b8be', '#e6b93e'];

const Heroes = {
  fresh(g) {
    return {
      list: [], fallen: [], cands: [], candT: 0, nextId: 1, t: 0, slowT: 0, aiT: 0, scoutT: 0,
      rng: new Rng((((g.opts && g.opts.seed) | 0) ^ 0x4e5d1c) >>> 0),
      byArmy: new Map(), aiHire: {}, seen: {}, pick: null,
      stats: { hired: 0, died: 0, captured: 0, ransomed: 0, escaped: 0, levels: 0, battles: 0, wins: 0 },
    };
  },
  st(g) { return g.hr || (g.hr = this.fresh(g)); },
  of(g, id) { const hr = g.hr; return hr ? hr.byArmy.get(id) || null : null; },
  rank(level) { return HERO_RANKS[Math.min(level, HERO_RANKS.length) - 1]; },
  has(h, skill) { return h.skills.indexOf(skill) >= 0; },
  mine(g, kid) { const out = []; for (const h of this.st(g).list) if (h.owner === kid) out.push(h); return out; },
  limit(g, kid) { return Math.min(8, 1 + Math.floor(g.citiesOf(kid).length / 3)); },
  ransomOf(h) { return HERO.ransomBase + HERO.ransomLevel * h.level; },
  hireCost(g, kid, c) {
    return HERO.baseCost + HERO.costHero * this.mine(g, kid).length + HERO.costLevel * (c.level - 1) + HERO.costSkill * (c.skills.length - 1);
  },
  note(g, owner, text, kind, at) { const pl = g.player; if (pl && pl.id === owner) g.notify(text, kind, at || null, true); },

  // ---------- создание ----------
  newName(g) {
    const rng = this.st(g).rng;
    for (let i = 0; i < 20; i++) {
      const name = rng.pick(HERO_NAMES) + ' ' + rng.pick(HERO_NICKS);
      if (!this.nameTaken(g, name)) return name;
    }
    return rng.pick(HERO_NAMES) + ' ' + rng.pick(HERO_NICKS);
  },
  nameTaken(g, name) {
    const hr = this.st(g);
    for (const h of hr.list) if (h.name === name) return true;
    for (const h of hr.cands) if (h.name === name) return true;
    return false;
  },
  // Новый навык: чаще то, что подходит составу армии.
  pickSkill(g, have, units) {
    const rng = this.st(g).rng, w = [];
    let tot = 0, cav = 0, all = 0, sg = 0;
    if (units) for (const u in units) { const n = units[u]; all += n; if (u === 'cavalry' || u === 'knight') cav += n; if (UNITS[u].siege >= 5) sg += n; }
    for (const id of HERO_SKILL_IDS) {
      let x = have.indexOf(id) >= 0 ? 0 : 1;
      if (id === 'cavalry' && all && cav / all > 0.3) x *= 3;
      if (id === 'siege' && sg) x *= 3;
      w.push(x); tot += x;
    }
    if (tot <= 0) return null;
    let r = rng.next() * tot;
    for (let i = 0; i < w.length; i++) { r -= w[i]; if (r < 0) return HERO_SKILL_IDS[i]; }
    return HERO_SKILL_IDS[0];
  },
  makeCand(g, level, units) {
    const hr = this.st(g), rng = hr.rng;
    const skills = [this.pickSkill(g, [], units)];
    if (rng.chance(0.25)) skills.push(this.pickSkill(g, skills, units));
    return { id: hr.nextId++, name: this.newName(g), face: rng.int(0, 1023), skills, level, xp: HERO.xpLevels[level - 1] || 0 };
  },
  refreshCands(g) {
    const hr = this.st(g);
    hr.cands = [];
    for (let i = 0; i < HERO.candCount; i++) hr.cands.push(this.makeCand(g, hr.rng.chance(0.3) ? 2 : 1));
    hr.candT = hr.t;
  },
  // Берёт полководца из кандидата c. Ошибка — строкой.
  hire(g, k, c, price) {
    const hr = this.st(g);
    if (this.mine(g, k.id).length >= this.limit(g, k.id)) return 'Лимит полководцев: ' + this.limit(g, k.id) + ' (растёт с числом городов)';
    const cost = price === undefined ? this.hireCost(g, k.id, c) : price;
    if (k.res.gold < cost) return 'Не хватает золота: ' + cost;
    k.res.gold -= cost;
    const h = { id: c.id, owner: k.id, name: c.name, face: c.face, skills: c.skills.slice(), level: c.level, xp: c.xp, army: null, city: null, status: 'ok', by: null, ransom: 0, wins: 0, battles: 0, caps: 0 };
    h.city = this.homeCity(g, k.id, null);
    hr.list.push(h);
    const i = hr.cands.indexOf(c);
    if (i >= 0) hr.cands.splice(i, 1);
    hr.stats.hired++;
    return null;
  },
  homeCity(g, owner, at) {
    let best = null, bd = Infinity;
    for (const c of g.cities) {
      if (c.owner !== owner) continue;
      const d = at ? dist(c.x, c.y, at.x, at.y) : (c.isCapital ? 0 : 1);
      if (d < bd) { bd = d; best = c; }
    }
    return best ? best.id : null;
  },

  // ---------- назначение ----------
  clearTrack(h) { h._bt = null; h._btl = null; h._pm = null; h._po = null; h._pe = null; },
  assign(g, h, a) {
    const hr = this.st(g);
    if (h.status !== 'ok' || h.owner !== a.owner) return 'Полководец не может возглавить эту армию';
    if (hr.byArmy.get(a.id) === h) return null;
    if (a.state === 'battle') return 'Армия в бою';
    const old = hr.byArmy.get(a.id);
    const prev = h.army != null ? g.army(h.army) : null;
    if (h.army != null) hr.byArmy.delete(h.army);
    if (old) {
      hr.byArmy.delete(a.id);
      old.army = null; old.city = this.homeCity(g, old.owner, a); this.clearTrack(old);
      if (prev && prev.state !== 'battle') { old.army = prev.id; old.city = null; hr.byArmy.set(prev.id, old); }
    }
    h.army = a.id; h.city = null; this.clearTrack(h);
    hr.byArmy.set(a.id, h);
    if (hr.pick === h.id) hr.pick = null;
    return null;
  },
  unassign(g, h) {
    const hr = this.st(g), a = h.army != null ? g.army(h.army) : null;
    if (h.army != null) hr.byArmy.delete(h.army);
    h.army = null; this.clearTrack(h);
    h.city = this.homeCity(g, h.owner, a);
  },
  payRansom(g, h) {
    const hr = this.st(g), k = g.kingdom(h.owner);
    if (h.status !== 'jail' || !k) return 'Полководец не в плену';
    const cost = h.ransom;
    if (k.res.gold < cost) return 'Не хватает золота: ' + cost;
    k.res.gold -= cost;
    this.free(g, h, cost, cost, 'выкуп');
    return null;
  },
  // Освобождает пленного: захватчик получает paid золота.
  free(g, h, cost, paid, how) {
    const hr = this.st(g), by = g.kingdom(h.by);
    if (by && !by.bandit && by.alive) by.res.gold += paid;
    const holder = h.by;
    h.status = 'ok'; h.by = null; h.ransom = 0;
    h.city = this.homeCity(g, h.owner, null);
    if (how === 'выкуп') hr.stats.ransomed++; else hr.stats.escaped++;
    if (how === 'выкуп') {
      this.note(g, h.owner, 'Полководец ' + h.name + ' выкуплен из плена за ' + paid + ' золота', 'good');
      if (holder !== h.owner) this.note(g, holder, 'Выкуп за ' + h.name + ' получен: +' + paid + ' золота', 'good');
    } else {
      this.note(g, h.owner, 'Полководец ' + h.name + ' бежал из плена!', 'good');
      if (holder !== h.owner) this.note(g, holder, 'Пленник ' + h.name + ' бежал', 'bad');
    }
  },

  // ---------- опыт и уровни ----------
  gain(g, h, xp, a) {
    h.xp += xp;
    while (h.level < HERO.maxLevel && h.xp >= HERO.xpLevels[h.level]) {
      h.level++;
      this.st(g).stats.levels++;
      let got = '';
      if (h.skills.length < HERO.maxSkills) {
        const s = this.pickSkill(g, h.skills, a ? a.units : null);
        if (s) { h.skills.push(s); got = ': ' + HERO_SKILLS[s].name; }
      }
      this.note(g, h.owner, h.name + ' получает ' + h.level + '-й уровень (' + this.rank(h.level).toLowerCase() + ')' + got, 'good', a);
    }
  },

  // ---------- бои ----------
  foeOf(g, btl, a, side) {
    if (btl.ownA !== undefined) return side === 'a' ? btl.ownB : btl.ownA;
    if (btl.kind === 'field') { const o = g.army(btl.a === a.id ? btl.b : btl.a); return o ? o.owner : null; }
    const c = g.city(btl.city);
    return c ? c.owner : null;
  },
  sideOf(btl, a) { return btl.sideA ? (btl.sideA.indexOf(a.id) >= 0 ? 'a' : 'b') : (btl.a === a.id ? 'a' : 'b'); },
  battleOf(g, a) {
    for (const b of g.battles) if (b.id === a.battleId) return b;
    return null;
  },
  // Каждый кадр, пока полководец при армии: опыт, итоги боёв, поправки боевого духа и окапывания.
  track(g, h, a, dt) {
    const hr = this.st(g);
    const inB = a.battleId != null && (a.state === 'battle' || a.state === 'siege');
    if (h._bt != null && (!inB || a.battleId !== h._bt)) this.battleEnd(g, h, a);
    if (inB) {
      if (h._bt == null) {
        const btl = this.battleOf(g, a);
        if (btl) {
          h._bt = btl.id; h._btl = btl; h._side = this.sideOf(btl, a); h._men0 = Math.max(1, menCount(a.units));
          h._foe = this.foeOf(g, btl, a, h._side);
          h.battles++; hr.stats.battles++;
        }
      }
      this.gain(g, h, HERO.xpBattle * dt, a);
    }
    // Вдохновитель: часть потери боевого духа возвращается
    if (this.has(h, 'inspire')) {
      if (h._pm != null && a.morale < h._pm) a.morale += (h._pm - a.morale) * HERO.inspire;
      h._pm = a.morale;
      if (typeof a.org === 'number') {
        if (h._po != null && a.org < h._po) a.org += (h._po - a.org) * HERO.inspire;
        h._po = a.org;
      }
    }
    // Защитник: окапывание идёт быстрее (если в игре есть окапывание)
    if (this.has(h, 'guard') && typeof a.entrench === 'number') {
      if (h._pe != null && a.entrench > h._pe && a.entrench < 1) a.entrench = Math.min(1, a.entrench + (a.entrench - h._pe) * HERO.dig);
      h._pe = a.entrench;
    }
  },
  battleEnd(g, h, a) {
    const btl = h._btl, hr = this.st(g);
    const side = h._side, foeLoss = btl ? (side === 'a' ? btl.lossB : btl.lossA) || 0 : 0;
    const men = menCount(a.units), foe = h._foe;
    const field = !btl || btl.kind !== 'siege';
    h._bt = null; h._btl = null;
    if (a.state === 'retreat') {
      // проиграли бой
      this.gain(g, h, HERO.xpLoss, a);
      const lossFrac = clamp(1 - men / Math.max(1, h._men0 || men), 0, 1);
      this.fate(g, h, a, lossFrac, foe, false);
    } else if (field && g.battles.indexOf(btl) < 0 && a.state !== 'battle') {
      // победа в поле
      h.wins++; hr.stats.wins++;
      this.gain(g, h, Math.min(HERO.xpMax, HERO.xpWin + foeLoss * HERO.xpKill), a);
    }
  },
  fate(g, h, a, lossFrac, foe, destroyed) {
    const hr = this.st(g), fk = foe != null ? g.kingdom(foe) : null;
    const canCapt = !!fk && !fk.bandit && fk.alive && foe !== h.owner;
    let pd, pc;
    if (destroyed) { pd = HERO.deadDestroyed; pc = canCapt ? HERO.captDestroyed : 0; }
    else { pd = HERO.deadBase + HERO.deadLoss * lossFrac; pc = canCapt ? HERO.captBase + HERO.captLoss * lossFrac : 0; }
    const r = hr.rng.next();
    if (r < pd) this.kill(g, h, a, foe);
    else if (r < pd + pc) this.jail(g, h, a, foe);
    else if (destroyed) {
      this.unassign(g, h);
      this.note(g, h.owner, h.name + ' уцелел в разгроме и вернулся к своим', 'info');
    }
  },
  kill(g, h, a, foe) {
    const hr = this.st(g), i = hr.list.indexOf(h);
    if (i >= 0) hr.list.splice(i, 1);
    if (h.army != null) hr.byArmy.delete(h.army);
    h.army = null;
    hr.stats.died++;
    hr.fallen.push({ name: h.name, level: h.level, owner: h.owner, t: Math.round(g.time) });
    if (hr.fallen.length > 8) hr.fallen.shift();
    this.note(g, h.owner, 'Полководец ' + h.name + ' (' + h.level + ' ур.) погиб в бою', 'bad', a);
    if (foe != null) this.note(g, foe, 'Враг потерял полководца: ' + h.name, 'good', a);
  },
  jail(g, h, a, foe) {
    const hr = this.st(g);
    if (h.army != null) hr.byArmy.delete(h.army);
    h.army = null; h.city = null; this.clearTrack(h);
    h.status = 'jail'; h.by = foe; h.ransom = this.ransomOf(h); h.jailT = hr.t;
    hr.stats.captured++;
    const fk = g.kingdom(foe);
    this.note(g, h.owner, 'Полководец ' + h.name + ' попал в плен: ' + (fk ? fk.name : 'враг') + '. Выкуп — ' + h.ransom + ' золота (вкладка «Полководцы»)', 'bad', a);
    this.note(g, foe, 'Взят в плен вражеский полководец ' + h.name + '. Выкуп — ' + h.ransom + ' золота', 'good', a);
  },
  // Армия исчезла из g.armies: разбита, вошла в город, влилась в другую или взяла город.
  armyGone(g, h, a) {
    const hr = this.st(g);
    hr.byArmy.delete(a.id);
    h.army = null;
    const men = menCount(a.units);
    const foe = h._foe !== undefined ? h._foe : null;
    const btlDone = h._btl;
    this.clearTrack(h);
    if (!men) {
      let f = foe;
      if (f == null) { // ищем ближайшего врага
        let bd = 3;
        for (const o of g.armies) if (o.owner !== a.owner && g.isHostile(a.owner, o.owner)) { const d = dist(o.x, o.y, a.x, a.y); if (d < bd) { bd = d; f = o.owner; } }
      }
      this.fate(g, h, a, 1, f, true);
      return;
    }
    const c = g.cityAt(a.x, a.y, 1.4);
    if (a.state === 'siege' && c && c.owner === a.owner) {
      // город взят: слава полководцу
      h.caps++;
      this.gain(g, h, HERO.xpCapture + HERO.xpCaptureLevel * c.level, a);
      h.city = c.id;
      return;
    }
    if (c && c.owner === a.owner && dist(c.x + 0.5, c.y + 0.5, a.x, a.y) < 1.2) { h.city = c.id; return; }
    // влилась в соседнюю армию: полководец переходит, если там нет своего
    let tgt = null, bd = 1.6;
    for (const o of g.armies) {
      if (o.owner !== a.owner || o === a) continue;
      const d = dist(o.x, o.y, a.x, a.y);
      if (d < bd) { bd = d; tgt = o; }
    }
    if (tgt) {
      const t = hr.byArmy.get(tgt.id);
      if (!t) { h.army = tgt.id; hr.byArmy.set(tgt.id, h); return; }
      // остаётся с более опытным: слабейший уходит в резерв
      if (t.level < h.level && tgt.state !== 'battle') {
        this.unassign(g, t);
        h.army = tgt.id; hr.byArmy.set(tgt.id, h);
        return;
      }
      h.city = this.homeCity(g, h.owner, a);
      return;
    }
    // армия рассеялась без города: полководец под угрозой
    if (btlDone) this.fate(g, h, a, 0.6, foe, false);
    else h.city = this.homeCity(g, h.owner, a);
    if (h.army == null && hr.list.indexOf(h) >= 0 && h.status === 'ok' && h.city == null) h.city = this.homeCity(g, h.owner, a);
  },

  // ---------- раз в секунду ----------
  slow(g, hr) {
    const k = g.kingdoms;
    // пленные и резерв
    for (let i = hr.list.length - 1; i >= 0; i--) {
      const h = hr.list[i], ok = g.kingdom(h.owner);
      if (!ok || !ok.alive) { // держава пала
        if (h.army != null) hr.byArmy.delete(h.army);
        hr.list.splice(i, 1);
        continue;
      }
      if (h.status === 'jail') {
        const by = g.kingdom(h.by);
        if (!by || !by.alive) { this.free(g, h, 0, 0, 'побег'); continue; }
        if (hr.rng.next() < HERO.jailEscape / 60) { this.free(g, h, 0, 0, 'побег'); continue; }
        // ИИ выкупает своих, платя сколько есть
        if (ok.ai && hr.t - h.jailT > HERO.jailWait) {
          const pay = Math.min(h.ransom, Math.floor(ok.res.gold - 10));
          if (pay >= h.ransom * HERO.aiDiscount) { ok.res.gold -= pay; this.free(g, h, h.ransom, pay, 'выкуп'); }
        }
        continue;
      }
      // резерв: город мог пасть
      if (h.army == null) {
        const c = h.city != null ? g.city(h.city) : null;
        if (!c || c.owner !== h.owner) h.city = this.homeCity(g, h.owner, c);
      }
    }
    // предложения наёмников для игрока
    if (!hr.cands.length || hr.t - hr.candT >= HERO.candEvery) this.refreshCands(g);
    // дозор разведчиков игрока
    hr.scoutT += 1;
    if (hr.scoutT >= 2) { hr.scoutT = 0; this.scouts(g, hr); }
  },
  scouts(g, hr) {
    const pl = g.player;
    if (!pl) return;
    for (const h of hr.list) {
      if (h.owner !== pl.id || h.army == null || !this.has(h, 'scout')) continue;
      const a = g.army(h.army);
      if (!a) continue;
      const R = g.armyVision(a) + HERO.scoutRange;
      for (const e of g.armies) {
        if (e.owner === pl.id || !g.isHostile(pl.id, e.owner)) continue;
        if (dist(e.x, e.y, a.x, a.y) > R) continue;
        if (hr.t - (hr.seen[e.id] || -999) < HERO.scoutEvery) continue;
        hr.seen[e.id] = hr.t;
        const ek = g.kingdom(e.owner);
        g.notify(h.name + ': замечена армия — ' + (ek ? ek.name.toLowerCase() : 'враг') + ' (' + menCount(e.units) + ' воинов)', 'war', e, false);
      }
    }
    for (const id in hr.seen) if (hr.t - hr.seen[id] > 400) delete hr.seen[id];
  },

  // ---------- ИИ ----------
  aiTurn(g, hr) {
    for (const k of g.kingdoms) {
      if (k.bandit || !k.alive || !k.ai) continue;
      const mine = this.mine(g, k.id);
      const free = mine.filter(h => h.status === 'ok' && h.army == null).sort((p, q) => q.level - p.level);
      const arms = g.armiesOf(k.id).filter(a => a.state !== 'battle' && menCount(a.units) >= 30).sort((p, q) => unitPower(q.units) - unitPower(p.units));
      const bare = arms.filter(a => !hr.byArmy.has(a.id));
      for (const h of free) { const a = bare.shift(); if (!a) break; this.assign(g, h, a); }
      // сильнейшая армия без полководца важнее слабой с ним
      if (bare.length) {
        let weak = null, wp = Infinity;
        for (const a of arms) { const h = hr.byArmy.get(a.id); if (h && h.owner === k.id) { const p = unitPower(a.units); if (p < wp) { wp = p; weak = h; } } }
        if (weak && unitPower(bare[0].units) > wp * 1.8) { this.unassign(g, weak); this.assign(g, weak, bare[0]); bare.shift(); }
      }
      // найм по сниженной цене: ИИ тратит почти всё золото на войска, цена ему даётся скидкой
      if (bare.length && mine.length < this.limit(g, k.id) && hr.t - (hr.aiHire[k.id] || -999) >= HERO.aiHireEvery) {
        const c = this.makeCand(g, 1, bare[0].units);
        const cost = this.hireCost(g, k.id, c);
        const pay = Math.min(cost, Math.floor(k.res.gold - 10));
        if (pay >= cost * HERO.aiDiscount && !this.hire(g, k, c, pay)) {
          hr.aiHire[k.id] = hr.t;
          const h = hr.list[hr.list.length - 1];
          this.assign(g, h, bare[0]);
        }
      }
    }
  },
  summary(g) {
    const hr = this.st(g), out = { alive: hr.list.length, jailed: 0, byLevel: [0, 0, 0, 0, 0, 0], assigned: hr.byArmy.size, fallen: hr.stats.died };
    for (const h of hr.list) { if (h.status === 'jail') out.jailed++; out.byLevel[h.level]++; }
    for (const s in hr.stats) out[s] = hr.stats[s];
    return out;
  },

  // ---------- поправки ядра ----------
  cavShare(units) {
    let c = 0, all = 0;
    for (const u in units) { const p = units[u] * UNITS[u].atk; all += p; if (u === 'cavalry' || u === 'knight') c += p; }
    return all > 0 ? c / all : 0;
  },
  armyUpkeep(a) {
    let gold = 0, food = 0;
    for (const u in a.units) {
      const d = UNITS[u];
      gold += d.upkeep * a.units[u] / d.squad;
      food += a.units[u] * (d.crew || 1) * (u === 'cavalry' || u === 'knight' || u === 'scout' ? 0.06 : 0.04);
    }
    return { gold, food };
  },
};

Mods.add({
  name: 'heroes',
  init(g, loaded) {
    const hr = Heroes.st(g);
    if (!loaded) Heroes.refreshCands(g);
    g.on((type, d) => {
      if (type !== 'armyRemoved') return;
      const h = hr.byArmy.get(d.id);
      if (h) Heroes.armyGone(g, h, d);
    });
    if (typeof HeroesUI !== 'undefined') HeroesUI.install();
  },
  update(g, dt) {
    const hr = g.hr;
    if (!hr) return;
    hr.t += dt;
    for (let i = 0; i < hr.list.length; i++) {
      const h = hr.list[i];
      if (h.status !== 'ok' || h.army == null) continue;
      const a = g.army(h.army);
      if (!a) { hr.byArmy.delete(h.army); h.army = null; h.city = Heroes.homeCity(g, h.owner, null); continue; }
      Heroes.track(g, h, a, dt);
    }
    hr.slowT += dt;
    if (hr.slowT >= 1) { hr.slowT -= 1; Heroes.slow(g, hr); }
    hr.aiT += dt;
    if (hr.aiT >= HERO.aiThink) { hr.aiT = 0; Heroes.aiTurn(g, hr); }
  },
  serialize(g) {
    const hr = Heroes.st(g);
    const strip = h => { const o = {}; for (const k in h) if (k.charAt(0) !== '_') o[k] = h[k]; o.skills = h.skills.slice(); return o; };
    return {
      v: 1, list: hr.list.map(strip), fallen: hr.fallen.map(f => ({ ...f })), cands: hr.cands.map(strip), candT: hr.candT, nextId: hr.nextId, t: hr.t,
      rng: hr.rng.state, aiHire: { ...hr.aiHire }, stats: { ...hr.stats },
    };
  },
  restore(g, data) {
    const hr = g.hr = Heroes.fresh(g);
    if (!data) return;
    hr.list = (data.list || []).map(h => ({ ...h, skills: h.skills.slice() }));
    hr.fallen = data.fallen || [];
    hr.cands = (data.cands || []).map(h => ({ ...h, skills: h.skills.slice() }));
    hr.candT = data.candT || 0; hr.nextId = data.nextId || 1; hr.t = data.t || 0;
    if (data.rng !== undefined) hr.rng.state = data.rng >>> 0;
    hr.aiHire = data.aiHire || {};
    hr.stats = { ...hr.stats, ...(data.stats || {}) };
    for (const h of hr.list) {
      if (h.army != null) { if (g.army(h.army)) hr.byArmy.set(h.army, h); else { h.army = null; h.city = Heroes.homeCity(g, h.owner, null); } }
    }
  },
  modify: {
    // урон армии: уровень и конница
    attack(g, m, a) {
      const h = Heroes.of(g, a.id);
      if (!h) return m;
      m *= 1 + HERO.lvlAttack * h.level;
      if (Heroes.has(h, 'cavalry')) m *= 1 + HERO.cavAtk * Heroes.cavShare(a.units);
      return m;
    },
    // множитель получаемого урона (меньше — лучше)
    defense(g, m, a) {
      const h = Heroes.of(g, a.id);
      if (!h) return m;
      m /= 1 + HERO.lvlDefense * h.level;
      if (Heroes.has(h, 'guard')) m /= 1 + HERO.guard;
      return m;
    },
    siege(g, p, a) {
      const h = Heroes.of(g, a.id);
      return h && Heroes.has(h, 'siege') ? p * (1 + HERO.siege) : p;
    },
    armySpeed(g, s, a) {
      const h = Heroes.of(g, a.id);
      return h && Heroes.has(h, 'strat') ? s * (1 + HERO.speed) : s;
    },
    vision(g, v, a) {
      const h = Heroes.of(g, a.id);
      return h && Heroes.has(h, 'scout') ? v + HERO.vision + HERO.visionLevel * (h.level - 1) : v;
    },
    // жалованье полководцам и скидка интенданта на содержание армий
    upkeep(g, up, k) {
      const hr = g.hr;
      if (!hr || !hr.list.length) return up;
      for (const h of hr.list) {
        if (h.owner !== k.id || h.status !== 'ok') continue;
        up.gold -= HERO.salary + HERO.salaryLevel * h.level;
        if (h.army != null && Heroes.has(h, 'quarter')) {
          const a = g.army(h.army);
          if (a) { const u = Heroes.armyUpkeep(a); up.gold += u.gold * HERO.upkeepCut; up.food += u.food * HERO.upkeepCut; }
        }
      }
      return up;
    },
  },
});

// ====================== интерфейс и карта (только в браузере) ======================
if (typeof document !== 'undefined') {
  var HeroesUI = {
    done: false,
    css: '.hr-card{display:flex;gap:9px;align-items:flex-start;padding:8px;margin:6px 0;border:1px solid var(--line);border-radius:6px;background:rgba(255,250,235,.55)}' +
      '.hr-card.jail{opacity:.82;background:rgba(166,58,40,.08)}.hr-card.cand{background:rgba(215,169,68,.12)}' +
      '.hr-pt{flex:none;display:block}.hr-main{flex:1;min-width:0}' +
      '.hr-name{font-family:var(--font-head);font-size:18px;line-height:1.1}' +
      '.hr-meta{color:var(--ink-soft);font-size:14px;margin:1px 0 3px}' +
      '.hr-sk{display:inline-flex;align-items:center;gap:3px;padding:1px 7px 1px 5px;margin:2px 4px 2px 0;border:1px solid var(--line);border-radius:10px;font-size:13px;background:rgba(215,169,68,.2)}' +
      '.hr-sk .ico{width:14px;height:14px}.hr-xp{height:6px;margin:3px 0 4px}.hr-xp i{display:block;height:100%;background:linear-gradient(90deg,#b8862b,#e9c264);border-radius:3px}' +
      '.hr-xp{background:rgba(60,40,20,.18);border-radius:3px;overflow:hidden}' +
      '.hr-btns{display:flex;flex-wrap:wrap;gap:6px;margin-top:5px}.hr-btns .act{padding:6px 10px}' +
      '.hr-army{display:flex;gap:8px;align-items:center;margin:8px 0;padding:6px 8px;border:1px solid var(--line);border-radius:6px;background:rgba(215,169,68,.14)}' +
      '.hr-army .hr-name{font-size:16px}.hr-pick .act{display:block;width:100%;text-align:left;margin:4px 0}',
    install() {
      if (this.done) return;
      this.done = true;
      const st = document.createElement('style');
      st.textContent = this.css;
      document.head.appendChild(st);
      // блок «кто командует» в панели армии: вставляется поверх UI.armyHtml без правок ui.js
      if (typeof UI !== 'undefined' && UI.prototype.armyHtml && !UI.prototype.armyHtml.hr) {
        const orig = UI.prototype.armyHtml;
        const wrap = function (a) {
          let h = orig.call(this, a);
          let blk = '';
          try { blk = HeroesUI.armyBlock(this.g, a); } catch (e) { blk = ''; }
          if (!blk) return h;
          const i = h.indexOf('<div class="row2"');
          return i >= 0 ? h.slice(0, i) + blk + h.slice(i) : h + blk;
        };
        wrap.hr = true;
        UI.prototype.armyHtml = wrap;
      }
    },
    skills(h) {
      return h.skills.map(s => `<span class="hr-sk" title="${escapeHtml(HERO_SKILLS[s].desc)}">${Icons.svg(HERO_SKILLS[s].icon)}${HERO_SKILLS[s].name}</span>`).join('');
    },
    xpBar(h) {
      if (h.level >= HERO.maxLevel) return `<div class="hr-xp" title="Высший уровень"><i style="width:100%"></i></div>`;
      const lo = HERO.xpLevels[h.level - 1], hi = HERO.xpLevels[h.level];
      return `<div class="hr-xp" title="Опыт ${Math.floor(h.xp)} из ${hi}"><i style="width:${clamp((h.xp - lo) / (hi - lo), 0, 1) * 100}%"></i></div>`;
    },
    portrait(g, h, px) { return Heroes.portrait(g, h, px); },
    // шапка армии: кто командует, либо кого назначить
    armyBlock(g, a) {
      const pl = g.player, k = g.kingdom(a.owner);
      const h = Heroes.of(g, a.id);
      const mine = pl && a.owner === pl.id;
      if (h) {
        if (!mine && !g.isVisible(a.x, a.y)) return '';
        return `<div class="hr-army">${Heroes.portrait(g, h, 40)}<div class="hr-main"><div class="hr-name">${escapeHtml(h.name)}</div>` +
          `<div class="hr-meta">${Heroes.rank(h.level)} · ${h.level} ур.</div>${this.skills(h)}</div>` +
          (mine ? `<button class="act ghost" type="button" data-act="hero-off" data-id="${h.id}">Отозвать</button>` : '') + '</div>';
      }
      if (!mine) return '';
      const free = Heroes.mine(g, pl.id).filter(x => x.status === 'ok' && x.army == null);
      if (!free.length) return `<div class="hr-army"><div class="hr-main"><div class="hr-meta">Полководца нет. Наймите его во вкладке «Полководцы» державы.</div></div></div>`;
      return '<div class="hr-army" style="display:block"><div class="hr-meta">Назначить полководца:</div><div class="hr-btns">' +
        free.slice(0, 4).map(x => `<button class="act ghost" type="button" data-act="hero-give" data-id="${x.id}">${escapeHtml(x.name)} · ${x.level} ур.</button>`).join('') + '</div></div>';
    },
    // карточка полководца игрока
    card(g, pl, h) {
      const hr = Heroes.st(g);
      let h2 = `<div class="hr-card${h.status === 'jail' ? ' jail' : ''}">${Heroes.portrait(g, h, 54)}<div class="hr-main">` +
        `<div class="hr-name">${escapeHtml(h.name)}</div><div class="hr-meta">${Heroes.rank(h.level)} · ${h.level} ур. · побед ${h.wins}</div>${this.xpBar(h)}${this.skills(h)}`;
      if (h.status === 'jail') {
        const by = g.kingdom(h.by);
        h2 += `<div class="hr-meta">В плену: ${escapeHtml(by ? by.name : 'у врага')}. Выкуп — ${h.ransom} зол.</div>` +
          `<div class="hr-btns"><button class="act" type="button" data-act="hero-ransom" data-id="${h.id}" ${pl.res.gold < h.ransom ? 'disabled' : ''}>Выкупить за ${h.ransom}</button></div>`;
      } else {
        const a = h.army != null ? g.army(h.army) : null;
        if (a) {
          h2 += `<div class="hr-meta">Командует: ${escapeHtml(a.name || 'армия')} · ${menCount(a.units)} воинов</div>` +
            `<div class="hr-btns"><button class="act ghost" type="button" data-act="selarmy" data-id="${a.id}">К армии</button>` +
            `<button class="act ghost" type="button" data-act="hero-pick" data-id="${h.id}">Другая армия</button>` +
            `<button class="act ghost" type="button" data-act="hero-off" data-id="${h.id}">Отозвать</button></div>`;
        } else {
          const c = h.city != null ? g.city(h.city) : null;
          h2 += `<div class="hr-meta">В резерве${c ? ': ' + escapeHtml(c.name) : ''}</div>` +
            `<div class="hr-btns"><button class="act" type="button" data-act="hero-pick" data-id="${h.id}">Назначить</button></div>`;
        }
      }
      return h2 + '</div></div>';
    },
    tab(g, pl) {
      const hr = Heroes.st(g);
      const mine = Heroes.mine(g, pl.id), lim = Heroes.limit(g, pl.id);
      let sal = 0;
      for (const h of mine) if (h.status === 'ok') sal += HERO.salary + HERO.salaryLevel * h.level;
      let h = `<div class="row2" style="display:flex;justify-content:space-between;font-size:14px;margin-top:6px"><span>Полководцев: <b>${mine.length}</b> из ${lim}</span><span title="Жалованье в минуту">${Icons.svg('gold')} −${Math.round(sal)} в мин.</span></div>`;
      // выбор армии для назначения
      const pk = hr.pick != null ? mine.find(x => x.id === hr.pick) : null;
      if (pk) {
        const arms = g.armiesOf(pl.id);
        h += `<div class="hr-card cand hr-pick" style="display:block"><div class="hr-meta" style="margin:0 0 4px"><b>${escapeHtml(pk.name)}</b> — выберите армию:</div>`;
        if (!arms.length) h += '<div class="tip">Армий в поле нет. Выведите войско из гарнизона города.</div>';
        for (const a of arms) {
          const cur = Heroes.of(g, a.id);
          h += `<button class="act ghost" type="button" data-act="hero-to" data-id="${pk.id}" data-army="${a.id}" ${a.state === 'battle' ? 'disabled' : ''}>${escapeHtml(a.name || 'Армия')} · ${menCount(a.units)} воинов${cur && cur !== pk ? ' (сменит ' + escapeHtml(cur.name) + ')' : ''}</button>`;
        }
        h += '<button class="act ghost" type="button" data-act="hero-pick" data-id="' + pk.id + '">Отмена</button></div>';
      }
      if (!mine.length) h += '<p class="tip">У вас нет полководцев. Нанятый полководец ведёт армию: даёт ей бонусы навыков, набирается опыта в боях и растёт в уровнях. Но при разгроме он может погибнуть или попасть в плен.</p>';
      for (const x of mine) h += this.card(g, pl, x);
      // кого держим в плену мы
      const held = hr.list.filter(x => x.status === 'jail' && x.by === pl.id);
      if (held.length) {
        h += '<h3 style="margin:10px 0 2px;font-family:var(--font-head);font-weight:400;font-size:18px">Пленные полководцы</h3>';
        for (const x of held) {
          const ok = g.kingdom(x.owner);
          h += `<div class="hr-card jail">${Heroes.portrait(g, x, 40)}<div class="hr-main"><div class="hr-name">${escapeHtml(x.name)}</div><div class="hr-meta">${escapeHtml(ok ? ok.name : '')} · ${x.level} ур. · выкуп ${x.ransom} зол.</div>${this.skills(x)}</div></div>`;
        }
        h += '<p class="tip">Держава может выкупить своего полководца; иначе он рано или поздно сбежит.</p>';
      }
      // наём
      const full = mine.length >= lim;
      h += '<h3 style="margin:10px 0 2px;font-family:var(--font-head);font-weight:400;font-size:18px">Нанять полководца</h3>';
      for (const c of hr.cands) {
        const cost = Heroes.hireCost(g, pl.id, c);
        h += `<div class="hr-card cand">${Heroes.portrait(g, c, 46)}<div class="hr-main"><div class="hr-name">${escapeHtml(c.name)}</div>` +
          `<div class="hr-meta">${Heroes.rank(c.level)} · ${c.level} ур.</div>${this.skills(c)}` +
          `<div class="hr-btns"><button class="act" type="button" data-act="hero-hire" data-id="${c.id}" ${full || pl.res.gold < cost ? 'disabled' : ''}>Нанять · ${cost} ${Icons.svg('gold')}</button></div></div></div>`;
      }
      h += `<p class="tip">${full ? 'Лимит достигнут: он растёт с числом городов (один на каждые три города). ' : ''}Наёмники меняются каждые ${Math.round(HERO.candEvery / 60 * 10) / 10} мин.</p>`;
      if (hr.fallen.length) {
        const mineF = hr.fallen.filter(f => f.owner === pl.id).slice(-3);
        if (mineF.length) h += '<p class="tip">Павшие: ' + mineF.map(f => escapeHtml(f.name) + ' (' + f.level + ' ур.)').join(', ') + '.</p>';
      }
      return h;
    },
  };

  Heroes.portrait = function (g, h, px) {
    const k = g.kingdom(h.owner) || { color: '#8a7f6a', dark: '#3a3330' };
    const f = h.face | 0;
    const skin = HERO_SKIN[f & 3], hair = HERO_HAIR[(f >> 2) % 5], beard = ((f >> 5) & 3) !== 0, helm = ((f >> 7) & 3) !== 0, tall = (f >> 9) & 1;
    const ring = HERO_RING[Math.min(h.level, 5) - 1];
    let s = `<svg class="hr-pt" width="${px}" height="${px}" viewBox="0 0 48 48" aria-hidden="true">`;
    s += `<circle cx="24" cy="24" r="23" fill="${k.color}"/>`;
    s += `<path d="M8 40.5Q10 32 24 31Q38 32 40 40.5A23 23 0 0 1 8 40.5Z" fill="${k.dark}"/><path d="M21 31.5L24 36L27 31.5Z" fill="#f3ead2"/>`;
    s += `<rect x="20" y="25" width="8" height="8" fill="${skin}"/><rect x="20" y="29" width="8" height="4" fill="rgba(0,0,0,.18)"/>`;
    if (beard) s += `<path d="M15.8 21Q16 33 24 34.5Q32 33 32.2 21Q28 27 24 27Q20 27 15.8 21Z" fill="${hair}"/>`;
    s += `<ellipse cx="24" cy="21" rx="8.3" ry="${tall ? 10.4 : 9.6}" fill="${skin}"/>`;
    if (beard) s += `<path d="M18 25.5Q24 29 30 25.5Q24 27 18 25.5Z" fill="${hair}"/>`;
    if (helm) {
      s += `<path d="M14.6 20Q13.6 6 24 5Q34.4 6 33.4 20L31 18.6Q24 12.5 17 18.6Z" fill="#aeb4ba" stroke="#5d6368" stroke-width=".8"/>`;
      s += `<rect x="23.2" y="12" width="1.6" height="9" fill="#9aa0a6"/>`;
      s += `<path d="M24 5Q30 1 35 7Q30 5 26 7Z" fill="${k.color}" stroke="#1a120a" stroke-width=".6"/>`;
    } else {
      s += `<path d="M15.6 18Q15 8 24 7.5Q33 8 32.4 18Q30 12 24 12Q18 12 15.6 18Z" fill="${hair}"/>`;
      s += `<path d="M15.2 13.5L18.5 10.8L21 13L24 9.6L27 13L29.5 10.8L32.8 13.5L32.2 15.4L15.8 15.4Z" fill="#e6b93e" stroke="#7a5a12" stroke-width=".6"/>`;
    }
    s += `<circle cx="20.6" cy="21" r="1.05" fill="#2a1b0d"/><circle cx="27.4" cy="21" r="1.05" fill="#2a1b0d"/>`;
    if (f & 512) s += `<path d="M26 17.5L29.5 24" stroke="#8a2f22" stroke-width=".9" fill="none"/>`;
    s += `<circle cx="24" cy="24" r="22.2" fill="none" stroke="${ring}" stroke-width="2.4"/><circle cx="24" cy="24" r="23.4" fill="none" stroke="#1a120a" stroke-width="1"/></svg>`;
    return s;
  };

  // действия кнопок
  const heroAct = fn => (d, ui, city, army) => fn(ui.g, d, ui, army);
  UIExt.actions['hero-hire'] = heroAct((g, d) => {
    const hr = Heroes.st(g), c = hr.cands.find(x => x.id === +d.id);
    if (!c) return 'Наёмник ушёл';
    const err = Heroes.hire(g, g.player, c);
    if (!err && typeof Sfx !== 'undefined') Sfx.play('coin');
    return err || undefined;
  });
  UIExt.actions['hero-pick'] = heroAct((g, d) => { const hr = Heroes.st(g); hr.pick = hr.pick === +d.id ? null : +d.id; });
  UIExt.actions['hero-to'] = heroAct((g, d) => {
    const hr = Heroes.st(g), h = hr.list.find(x => x.id === +d.id), a = g.army(+d.army);
    if (!h || !a) return 'Не удалось назначить';
    const err = Heroes.assign(g, h, a);
    if (!err && typeof Sfx !== 'undefined') Sfx.play('horn');
    return err || undefined;
  });
  UIExt.actions['hero-give'] = heroAct((g, d, ui, army) => {
    const hr = Heroes.st(g), h = hr.list.find(x => x.id === +d.id);
    if (!h || !army) return 'Не удалось назначить';
    const err = Heroes.assign(g, h, army);
    if (!err && typeof Sfx !== 'undefined') Sfx.play('horn');
    return err || undefined;
  });
  UIExt.actions['hero-off'] = heroAct((g, d) => {
    const hr = Heroes.st(g), h = hr.list.find(x => x.id === +d.id);
    if (h && h.status === 'ok') Heroes.unassign(g, h);
  });
  UIExt.actions['hero-ransom'] = heroAct((g, d) => {
    const hr = Heroes.st(g), h = hr.list.find(x => x.id === +d.id);
    if (!h) return 'Полководца нет';
    const err = Heroes.payRansom(g, h);
    if (!err && typeof Sfx !== 'undefined') Sfx.play('coin');
    return err || undefined;
  });
  UIExt.kingdomTabs.push({ id: 'heroes', title: 'Полководцы', html: (g, pl) => HeroesUI.tab(g, pl) });

  // флажок над строем армии с полководцем (после армий, до подписей)
  RenderExt.screen.push((ctx, r, z, tl, br) => {
    const g = r.g, hr = g && g.hr;
    if (!hr || !hr.byArmy.size || !r.drawnArmies) return;
    const S = r.armySize(), u = clamp(S / 34, 0.8, 1.25);
    const near = typeof UnitArt !== 'undefined' && z >= UnitArt.FORMATION_Z;
    for (const d of r.drawnArmies) {
      const h = hr.byArmy.get(d.a.id);
      if (!h) continue;
      const k = g.kingdom(h.owner);
      if (!k) continue;
      // вблизи — сам полководец на коне (если у художников он есть)
      if (near && typeof UnitArt.commander === 'function') {
        const mv = d.a.state === 'move' || d.a.state === 'retreat';
        UnitArt.commander(ctx, d.x - d.r - S * 0.1, d.y + S * 0.55, S * 0.72, k, Math.floor(r.time * 8) + d.a.id, mv ? 'walk' : 'stand', 1);
        continue;
      }
      const x = d.x + d.r * 0.62, y = d.y - d.r * 0.2;
      // древко с трепещущим вымпелом цвета державы; у основания — золотой значок с уровнем
      const H = 24 * u, sway = Math.sin(r.time * 4 + d.a.id) * 1.6 * u;
      ctx.save();
      ctx.translate(x, y);
      ctx.lineJoin = 'round';
      ctx.strokeStyle = '#2a1b0d'; ctx.lineWidth = 2.4 * u;
      ctx.beginPath(); ctx.moveTo(0, 0); ctx.lineTo(0, -H); ctx.stroke();
      ctx.fillStyle = k.color; ctx.strokeStyle = '#1a120a'; ctx.lineWidth = 1.2;
      ctx.beginPath();
      ctx.moveTo(0, -H); ctx.lineTo(16 * u, -H + 2 * u + sway); ctx.lineTo(12 * u, -H + 6.5 * u + sway * 0.6);
      ctx.lineTo(16 * u, -H + 11 * u + sway * 0.3); ctx.lineTo(0, -H + 12.5 * u); ctx.closePath();
      ctx.fill(); ctx.stroke();
      if (typeof Icons !== 'undefined') Icons.draw(ctx, 'star', 6.4 * u, -H + 6.2 * u, 7 * u, '#f3d58a');
      ctx.fillStyle = HERO_RING[Math.min(h.level, 5) - 1]; ctx.strokeStyle = '#1a120a'; ctx.lineWidth = 1.3;
      ctx.beginPath(); ctx.arc(0, 0, 6.6 * u, 0, TAU); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#2a1b0d'; ctx.font = 'bold ' + Math.round(9.5 * u) + 'px sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(String(h.level), 0, 0.6);
      ctx.restore();
    }
  });
}
