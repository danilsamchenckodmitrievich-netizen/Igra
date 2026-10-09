'use strict';
// Режиссёр рекламного ролика. Подключается к странице игры (index.html) и покадрово ведёт
// настоящую партию: камера, стройка, стены, полевая битва, осада, рост державы, титры.
// Время ролика задаёт promo/render.js: Promo.frame(i) рисует кадр номер i при 30 кадрах в секунду.

(function () {
  const FPS = 30;
  const clamp01 = t => (t < 0 ? 0 : t > 1 ? 1 : t);
  const smooth = t => { t = clamp01(t); return t * t * (3 - 2 * t); };
  const outCubic = t => 1 - Math.pow(1 - clamp01(t), 3);
  const outBack = t => { t = clamp01(t); const c = 1.6; return 1 + (c + 1) * Math.pow(t - 1, 3) + c * Math.pow(t - 1, 2); };
  const mix = (a, b, t) => a + (b - a) * t;
  const el = id => document.getElementById(id);

  // Сцены: начало и конец в секундах ролика.
  const SCENES = [
    { key: 'title', t0: 0.0, t1: 3.6 },
    { key: 'world', t0: 3.6, t1: 7.0 },
    { key: 'eco', t0: 7.0, t1: 11.2 },
    { key: 'def', t0: 11.2, t1: 15.0 },
    { key: 'battle', t0: 15.0, t1: 20.4 },
    { key: 'siege', t0: 20.4, t1: 25.0 },
    { key: 'grow', t0: 25.0, t1: 28.2 },
    { key: 'end', t0: 28.2, t1: 32.0 },
  ];
  const DURATION = 32.0;

  const CAPTIONS = {
    world: ['Открытый мир', 'Правь своей державой'],
    eco: ['Хозяйство', 'Строй рудники, рынки и мануфактуры'],
    def: ['Оборона', 'Возводи стены и башни'],
    battle: ['Войско', 'Собирай армии и бейся в поле'],
    siege: ['Осада', 'Ломай стены и бери города'],
    grow: ['Завоевания', 'Раздвинь границы до края карты'],
  };

  const P = window.Promo = { FPS, DURATION, frames: Math.round(DURATION * FPS), events: [] };
  let g, R, cap, scene = null, sceneT = 0, appT = 0;
  const S = {}; // данные сцен

  function event(type, extra) { P.events.push(Object.assign({ t: +(P.time || 0).toFixed(3), type }, extra || {})); }

  // ---------- подготовка партии ----------
  P.setup = function (seed) {
    try { localStorage.setItem('kc.tutorial', '1'); } catch (e) { /* не важно */ }
    Sfx.setMuted(true);
    g = new Game({ seed, size: 'medium', rivals: 4, difficulty: 'normal', kingdom: 0 });
    // восемь минут жизни мира: ИИ правит всеми, в том числе державой игрока
    g.opts.spectate = true;
    const pl = g.player;
    pl.ai = pl.ai || { nextThink: 0, target: null };
    for (let i = 0; i < 4800; i++) g.update(STEP);
    g.opts.spectate = false;
    App.begin(g);
    R = App.renderer;
    // весь мир открыт: в ролике нет тумана
    g.updateVisibility = function () { this.explored.fill(1); this.visible.fill(1); this.exploredVersion = (this.exploredVersion || 0) + 1; };
    g.updateVisibility();
    R.rebuildFog = function () { const c = this.layers.fog.getContext('2d'); c.clearRect(0, 0, this.layers.fog.width, this.layers.fog.height); };
    // лето, пока сцены поставлены вручную; смена сезонов вернётся в ускоренной сцене
    S.season = g.seasonIndex.bind(g);
    g.seasonIndex = () => 1;
    S.aiUpdate = AI.update;
    S.banditUpdate = g.updateBandits;
    S.eventsUpdate = g.updateEvents;
    g.updateEvents = () => {};
    cap = g.city(pl.capital) || g.citiesOf(pl.id)[0];
    App.setSpeed(1);
    document.body.classList.add('promo', 'promo-nohud');
    App.ui.select(null);
    buildOverlay();
    return { seed, capital: cap && cap.name, cities: g.citiesOf(pl.id).length, kingdoms: g.kingdoms.filter(k => k.alive && !k.bandit).length };
  };

  function buildOverlay() {
    const o = document.createElement('div');
    o.id = 'promo';
    let n = 0;
    const letters = ['Железная', 'корона'].map(w => '<span class="w">' + w.split('').map(ch => `<span style="--i:${n++}">${ch}</span>`).join('') + '</span>').join('');
    o.innerHTML = `
      <div id="pr-shade" class="pr-layer"></div>
      <div id="pr-title" class="pr-layer"><img id="pr-crest" src="icon.png" alt=""><h1 id="pr-logo">${letters}</h1><p id="pr-sub">Средневековая стратегия</p></div>
      <div id="pr-cap"><span id="pr-kick"></span><b id="pr-line"></b><i id="pr-rule"></i></div>
      <div id="pr-end" class="pr-layer">
        <div class="pr-card">
          <img src="icon.png" alt="">
          <h2 class="pr-name">Железная корона</h2>
          <p class="pr-what">Стратегия для Android и браузера</p>
          <div class="pr-btn">Скачай бесплатно</div>
          <p class="pr-small">Без рекламы и доната</p>
        </div>
      </div>
      <div id="pr-flash" class="pr-layer"></div>
      <div id="pr-black" class="pr-layer"></div>`;
    document.getElementById('app').appendChild(o);
  }

  // ---------- вспомогательное ----------
  function setCam(x, y, z) { const c = R.cam; c.x = x; c.y = y; c.z = z; R.glide = null; }
  // камера так, чтобы точка (x, y) оказалась на экране в (sx, sy)
  function camAt(x, y, z, sx, sy) { setCam(x + (R.w / 2 - sx) / z, y + (R.h / 2 - sy) / z, z); }
  function clearArmiesNear(x, y, r, keep) {
    for (const a of g.armies.slice()) {
      if (keep && keep.includes(a)) continue;
      if (Math.hypot(a.x - x, a.y - y) < r) {
        if (a.battleId) { g.battles = g.battles.filter(b => b.a !== a.id && b.b !== a.id); }
        const c = a.siegeCity && g.city(a.siegeCity); if (c && c.siegeBy === a.id) c.siegeBy = null;
        g.removeArmy(a);
      }
    }
    g.battles = g.battles.filter(b => (b.kind === 'siege' ? g.army(b.a) : g.army(b.a) && g.army(b.b)));
  }
  // Ближайшая к (x, y) клетка равнины; open — сколько клеток вокруг тоже должны быть равниной или лесом.
  function plains(x, y, r, open) {
    const w = g.world;
    let best = null, bd = Infinity;
    const ok = i => w.passable(i) && !w.river[i] && (w.terrain[i] === T.PLAINS || w.terrain[i] === T.FOREST);
    for (let yy = Math.floor(y - r); yy <= y + r; yy++) for (let xx = Math.floor(x - r); xx <= x + r; xx++) {
      if (!w.inside(xx, yy)) continue;
      const i = w.idx(xx, yy);
      if (!ok(i) || w.terrain[i] !== T.PLAINS) continue;
      if (g.cities.some(c => Math.hypot(c.x - xx, c.y - yy) < 3)) continue;
      let bad = 0;
      if (open) for (let dy = -open; dy <= open; dy++) for (let dx = -open - 1; dx <= open + 1; dx++) {
        if (!w.inside(xx + dx, yy + dy) || !ok(w.idx(xx + dx, yy + dy))) bad++;
      }
      const d = Math.hypot(xx - x, yy - y) + bad * 3;
      if (d < bd) { bd = d; best = { x: xx + 0.5, y: yy + 0.5 }; }
    }
    return best;
  }
  function rich(k) { Object.assign(k.res, { gold: 9000, food: 6000, wood: 6000, stone: 6000, iron: 3000 }); }
  function click(sel) { const b = document.querySelector(sel); if (b && !b.disabled) { b.click(); return true; } return false; }
  function fxCount() { return g.fx.length; }

  // ---------- сцены ----------
  const enter = {
    title() {
      S.t0cam = { x: cap.x + 0.5, y: cap.y + 0.5 };
      App.setSpeed(1);
    },
    world() {},
    eco() {
      document.body.classList.remove('promo-nohud');
      rich(g.player);
      clearArmiesNear(cap.x, cap.y, 14);
      cap.construction = null;
      App.ui.cityTab = 'eco';
      App.ui.select({ kind: 'city', id: cap.id });
      R.glide = null;
      S.builds = 0; S.nextClick = 0.35;
      App.setSpeed(1);
    },
    def() {
      rich(g.player);
      cap.construction = null;
      App.ui.cityTab = 'def';
      App.ui.renderPanel();
      S.nextClick = 0.3; S.defStep = 0;
      App.setSpeed(1);
    },
    battle() {
      App.ui.select(null);
      AI.update = () => {};
      g.updateBandits = () => {};
      const pl = g.player;
      // поле между столицей и ближайшим чужим городом
      let foeCity = null, fd = Infinity;
      for (const c of g.cities) {
        if (c.owner === pl.id || c.owner < 0) continue;
        const k = g.kingdom(c.owner); if (!k || k.bandit) continue;
        const d = Math.hypot(c.x - cap.x, c.y - cap.y);
        if (d < fd) { fd = d; foeCity = c; }
      }
      S.foe = foeCity ? foeCity.owner : g.kingdoms.find(k => !k.isPlayer && !k.bandit).id;
      const mx = foeCity ? mix(cap.x, foeCity.x, 0.45) : cap.x + 6, my = foeCity ? mix(cap.y, foeCity.y, 0.45) : cap.y;
      const L = plains(mx, my, 12, 3) || plains(cap.x, cap.y, 16, 2) || { x: cap.x + 4, y: cap.y };
      clearArmiesNear(L.x, L.y, 16);
      const w = g.world;
      const spot = (dx) => { for (let s = 0; s < 6; s++) { const x = L.x + dx * (1 + s * 0.15), y = L.y; if (w.passable(w.idx(Math.floor(x), Math.floor(y)))) return { x, y }; } return { x: L.x + dx, y: L.y }; };
      const pa = spot(-2.6), pb = spot(2.6);
      S.blue = g.makeArmy(pl.id, pa.x, pa.y, { knight: 50, sword: 70, archer: 60, spear: 40 });
      S.blue.name = 'Королевская рать';
      S.red = g.makeArmy(S.foe, pb.x, pb.y, { spear: 40, sword: 40, cavalry: 30, archer: 30, militia: 30 });
      S.red.name = g.armyName(S.foe);
      S.L = L;
      S.ordered = false;
      R.selected = { kind: 'army', id: S.blue.id };
      App.setSpeed(0);
    },
    siege() {
      R.selected = null;
      const pl = g.player;
      for (const x of [S.blue, S.red]) if (x && g.army(x.id)) { g.battles = g.battles.filter(b => b.a !== x.id && b.b !== x.id); g.removeArmy(x); }
      // ближайший к столице чужой город (лучше не столица соперника)
      let best = null, bd = Infinity;
      for (const c of g.cities) {
        if (c.owner === pl.id || c.owner < 0) continue;
        const k = g.kingdom(c.owner); if (!k || k.bandit) continue;
        const d = Math.hypot(c.x - cap.x, c.y - cap.y) + (c.isCapital ? 12 : 0) + (c.level < 2 ? 10 : 0);
        if (d < bd) { bd = d; best = c; }
      }
      if (!best) best = g.cities.find(c => c.owner !== pl.id);
      S.city = best;
      clearArmiesNear(best.x, best.y, 14);
      for (const b of g.battles.slice()) if (b.kind === 'siege' && b.city === best.id) g.battles = g.battles.filter(x => x !== b);
      best.siegeBy = null;
      best.walls = best.level >= 3 ? 3 : 2; best.wallHp = WALLS[best.walls].hp; best.towers = 1;
      best.garrison = { spear: 30, archer: 25, sword: 15 }; best.wounds = {};
      best.raised = false;
      // осаждающие подходят со стороны столицы
      const dx = cap.x - best.x, dy = cap.y - best.y, L = Math.hypot(dx, dy) || 1;
      const w = g.world;
      let ax = best.x + 0.5 + dx / L * 3.2, ay = best.y + 0.5 + dy / L * 3.2;
      if (!w.passable(w.idx(Math.floor(ax), Math.floor(ay)))) { const p = plains(ax, ay, 4); if (p) { ax = p.x; ay = p.y; } }
      S.siegeArmy = g.makeArmy(pl.id, ax, ay, { catapult: 6, ram: 4, sword: 120, knight: 60, archer: 60, crossbow: 40 });
      S.siegeArmy.name = 'Осадное войско';
      S.ordered = false; S.breach = false; S.captured = false;
      $('feed').innerHTML = '';
      document.body.classList.add('promo-feed');
      App.setSpeed(0);
    },
    grow() {
      document.body.classList.remove('promo-feed');
      AI.update = S.aiUpdate;
      g.updateBandits = S.banditUpdate;
      g.seasonIndex = S.season;
      g.opts.spectate = true;
      S.growFrom = { x: R.cam.x, y: R.cam.y, z: R.cam.z };
      S.year0 = g.year();
    },
    end() {
      document.body.classList.add('promo-nohud');
      g.opts.spectate = true;
      App.setSpeed(1);
      S.endFrom = { x: R.cam.x, y: R.cam.y, z: R.cam.z };
    },
  };

  const update = {
    title(t) {
      const k = smooth(t / 3.6);
      camAt(S.t0cam.x + mix(-3, 1.5, k), S.t0cam.y + mix(-1.5, 0.5, k), mix(30, 19, k), R.w / 2, R.h * 0.5);
      App.setSpeed(1);
    },
    world(t) {
      const k = smooth(t / 3.0);
      const w = g.world;
      const z1 = Math.min(R.w / w.W, R.h / w.H) * 1.08;
      const x = mix(S.t0cam.x + 1.5, w.W / 2, k), y = mix(S.t0cam.y + 0.5, w.H / 2 + 6, k);
      setCam(x, y, Math.exp(mix(Math.log(19), Math.log(z1), k)));
      App.setSpeed(2);
    },
    eco(t) {
      const z = mix(30, 32, smooth(t / 4.2));
      camAt(cap.x + 0.5, cap.y + 0.5, z, R.w / 2, R.h * 0.33);
      const c = cap;
      if (!c.construction && t >= S.nextClick && S.builds < 3) {
        const order = ['factory', 'market', 'mine', 'quarry', 'lumber', 'farm', 'barracks', 'range', 'stable', 'workshop'];
        for (const id of order) {
          if (g.buildInfo(c, 'building', id) && !g.buildBlock(c, 'building', id) && click(`[data-act="build"][data-kind="building"][data-id="${id}"]`)) { S.builds++; event('click'); break; }
        }
        S.nextClick = t + 1.25;
      }
      // стройка идёт ровно секунду
      if (c.construction) App.setSpeed(Math.min(200, c.construction.total / 0.9));
      else App.setSpeed(1);
    },
    def(t) {
      const z = mix(32, 48, smooth(t / 3.8));
      camAt(cap.x + 0.5, cap.y + 0.5, z, R.w / 2, R.h * 0.3);
      const c = cap;
      if (!c.construction && t >= S.nextClick && S.defStep < 2) {
        for (const kind of ['walls', 'towers', 'level']) {
          if (g.buildInfo(c, kind) && !g.buildBlock(c, kind) && click(`[data-act="build"][data-kind="${kind}"]`)) { S.defStep++; event('click'); break; }
        }
        S.nextClick = t + 1.5;
      }
      if (c.construction) App.setSpeed(Math.min(200, c.construction.total / 1.1));
      else App.setSpeed(1);
    },
    battle(t) {
      const a = S.blue, b = S.red;
      if (!S.ordered && t > 0.25) {
        g.order(a, { kind: 'army', id: b.id });
        g.order(b, { kind: 'army', id: a.id });
        S.ordered = true;
      }
      App.setSpeed(t < 1.4 ? 1.6 : 2.4);
      const fa = g.army(a.id), fb = g.army(b.id);
      const px = fa && fb ? (fa.x + fb.x) / 2 : S.L.x, py = fa && fb ? (fa.y + fb.y) / 2 : S.L.y;
      S.bx = S.bx === undefined ? px : mix(S.bx, px, 0.08);
      S.by = S.by === undefined ? py : mix(S.by, py, 0.08);
      camAt(S.bx, S.by, mix(44, 56, smooth(t / 5.4)), R.w / 2, R.h * 0.56);
      for (const b of g.battles) {
        if (b.kind !== 'field' || (b.a !== a.id && b.b !== a.id)) continue;
        if (!S.fightT) { S.fightT = t; event('clash'); }
        for (let k = 0; k < 2; k++) R.spawn('dust', b.x + (Math.random() - 0.5) * 1.6, b.y + (Math.random() - 0.5) * 0.9);
        if (Math.random() < 0.25) R.spawn('debris', b.x + (Math.random() - 0.5) * 0.8, b.y);
      }
      if (S.fightT && !S.routT && (!g.army(b.id) || g.army(b.id).state === 'retreat')) { S.routT = t; event('rout'); }
    },
    siege(t) {
      const a = S.siegeArmy, c = S.city;
      if (!S.ordered && t > 0.2) { g.order(a, { kind: 'city', id: c.id }); S.ordered = true; }
      if (!S.breach && c.walls > 0 && c.wallHp <= 0) { S.breach = true; event('breach'); }
      if (!S.captured && c.owner === g.player.id) { S.captured = true; S.capT = t; event('capture'); }
      App.setSpeed(S.captured ? 1 : t < 0.8 ? 2 : S.breach ? 1.8 : 5.5);
      camAt(c.x + 0.5, c.y + 0.5, mix(52, 64, smooth(t / 4.6)), R.w / 2, R.h * 0.52);
      if (S.breach && !S.captured) for (let k = 0; k < 2; k++) R.spawn(Math.random() < 0.5 ? 'smoke' : 'fire', c.x + 0.5 + (Math.random() - 0.5) * 0.9, c.y + 0.3 + (Math.random() - 0.5) * 0.6);
    },
    grow(t) {
      const w = g.world;
      const z1 = Math.max(R.h / (w.H - 4), 11.2);
      const half = R.w / 2 / z1;
      const k = smooth(t / 1.0);
      const pan = smooth((t - 0.2) / 3.0);
      const tx = mix(half + 1, w.W - half - 1, pan), ty = w.H / 2 + 1;
      setCam(mix(S.growFrom.x, tx, k), mix(S.growFrom.y, ty, k), Math.exp(mix(Math.log(S.growFrom.z), Math.log(z1), k)));
      App.setSpeed(t < 0.5 ? 2 : Math.min(240, 20 + (t - 0.5) * 260));
    },
    end(t) {
      App.setSpeed(1);
      const f = S.endFrom;
      setCam(f.x, f.y, f.z * (1 + 0.04 * t));
    },
  };

  // ---------- титры ----------
  function overlay(T) {
    const sh = el('pr-shade'), title = el('pr-title'), cap_ = el('pr-cap'), end = el('pr-end'), black = el('pr-black'), flash = el('pr-flash');
    // затемнение карты под заставкой и финалом
    let shade = 0;
    if (T < 3.6) shade = mix(1, 0.55, smooth(T / 0.9)) * (1 - smooth((T - 3.1) / 0.5)) ;
    if (T >= 28.2) shade = 0.6 * smooth((T - 28.2) / 0.6);
    sh.style.opacity = shade.toFixed(3);
    // заставка
    title.style.display = T < 3.7 ? 'flex' : 'none';
    if (T < 3.7) {
      const crest = el('pr-crest');
      const k = outBack((T - 0.25) / 0.45);
      crest.style.opacity = clamp01((T - 0.25) / 0.15).toFixed(3);
      crest.style.transform = `scale(${mix(2.4, 1, k).toFixed(3)})`;
      for (const s of el('pr-logo').querySelectorAll('.w span')) {
        const i = +s.style.getPropertyValue('--i');
        const q = outCubic((T - 0.75 - i * 0.045) / 0.35);
        s.style.opacity = q.toFixed(3);
        s.style.transform = `translateY(${mix(26, 0, q).toFixed(1)}px)`;
        s.style.filter = `blur(${mix(6, 0, q).toFixed(1)}px)`;
      }
      const sq = outCubic((T - 1.7) / 0.5);
      el('pr-sub').style.opacity = sq.toFixed(3);
      el('pr-sub').style.transform = `translateY(${mix(14, 0, sq).toFixed(1)}px)`;
      const out = smooth((T - 3.15) / 0.45);
      title.style.opacity = (1 - out).toFixed(3);
      title.style.transform = `scale(${mix(1, 1.08, out).toFixed(3)})`;
    }
    // подписи сцен
    const sc = SCENES.find(s => T >= s.t0 && T < s.t1);
    const txt = sc && CAPTIONS[sc.key];
    if (txt) {
      const lt = T - sc.t0, dur = sc.t1 - sc.t0;
      if (el('pr-kick').textContent !== txt[0]) { el('pr-kick').textContent = txt[0]; el('pr-line').textContent = txt[1]; }
      const inK = outCubic((lt - 0.15) / 0.45), outK = smooth((lt - (dur - 0.35)) / 0.3);
      const keepToNext = sc.key === 'eco' || sc.key === 'siege'; // следующая сцена продолжает кадр
      const o = inK * (keepToNext ? 1 - outK : 1 - outK);
      cap_.style.opacity = o.toFixed(3);
      el('pr-kick').style.transform = `translateX(${mix(-30, 0, inK).toFixed(1)}px)`;
      el('pr-line').style.transform = `translateY(${mix(18, 0, inK).toFixed(1)}px)`;
      el('pr-rule').style.transform = `scaleX(${outCubic((lt - 0.3) / 0.6).toFixed(3)})`;
      cap_.style.display = 'flex';
    } else cap_.style.display = 'none';
    // финальная карточка
    end.style.display = T >= 28.2 ? 'flex' : 'none';
    if (T >= 28.2) {
      const lt = T - 28.2;
      const card = end.firstElementChild;
      const k = outBack(lt / 0.6);
      card.style.opacity = clamp01(lt / 0.25).toFixed(3);
      card.style.transform = `translateY(${mix(140, 0, k).toFixed(1)}px)`;
      const btn = card.querySelector('.pr-btn');
      const pulse = lt > 1.2 ? 1 + 0.045 * Math.sin((lt - 1.2) * 5.2) : outBack((lt - 0.7) / 0.4);
      btn.style.transform = `scale(${pulse.toFixed(3)})`;
      btn.style.opacity = clamp01((lt - 0.7) / 0.2).toFixed(3);
      card.querySelector('.pr-small').style.opacity = clamp01((lt - 1.0) / 0.4).toFixed(3);
    }
    // склейки через затемнение
    let b = 0;
    for (const cut of [7.0, 15.0, 20.4]) b = Math.max(b, 1 - Math.abs(T - cut) / 0.16);
    if (T < 0.25) b = Math.max(b, 1 - T / 0.25);
    black.style.opacity = clamp01(b).toFixed(3);
    // вспышка при захвате города
    let f = 0;
    if (S.capT !== undefined && sc && sc.key === 'siege') f = Math.max(0, 1 - (T - (20.4 + S.capT)) / 0.35) * 0.75;
    if (T >= 0.66 && T < 1.0) f = Math.max(f, (1 - (T - 0.66) / 0.34) * 0.35);
    flash.style.opacity = f.toFixed(3);
  }

  P.debug = function () {
    const c = S.city, a = S.siegeArmy && g.army(S.siegeArmy.id);
    return c && { city: c.name, level: c.level, owner: c.owner, walls: c.walls, wallHp: Math.round(c.wallHp), garrison: c.garrison, army: a && { state: a.state, units: a.units, morale: Math.round(a.morale) } };
  };

  // ---------- кадр ----------
  P.frame = function (i) {
    const T = i / FPS;
    P.time = T;
    const sc = SCENES.find(s => T >= s.t0 && T < s.t1) || SCENES[SCENES.length - 1];
    if (sc !== scene) {
      scene = sc;
      enter[sc.key]();
      event('scene', { key: sc.key });
    }
    sceneT = T - sc.t0;
    const fx0 = fxCount();
    update[sc.key](sceneT);
    // один шаг игрового цикла с ровным шагом времени
    appT += 1000 / FPS;
    App.last = appT - 1000 / FPS;
    window.__tick(appT);
    overlay(T);
    return { scene: sc.key, battles: g.battles.length, fx: fxCount() - fx0 };
  };
})();
