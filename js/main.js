'use strict';
// Запуск: меню, новая игра, сохранения, пауза, итоги, игровой цикл, фоновая партия в меню.

const SAVE_KEY = 'kc.save.v1';
const PREFS_KEY = 'kc.prefs';
const PORTRAIT_KEY = 'kc.portrait';

function store(key, val) {
  try { if (val === null) localStorage.removeItem(key); else localStorage.setItem(key, JSON.stringify(val)); return true; } catch (e) { return false; }
}
function restore(key) {
  try { const v = localStorage.getItem(key); return v ? JSON.parse(v) : null; } catch (e) { return null; }
}

const App = {
  mode: 'menu',
  speed: 1,
  lastSpeed: 1,
  game: null,

  init() {
    this.canvas = $('map');
    this.renderer = new Renderer(this.canvas);
    this.ui = new UI(this);
    this.input = new Input(this);
    this.mm = $('minimap');
    this.mmCtx = this.mm.getContext('2d');
    const p = restore(PREFS_KEY) || {};
    this.opts = {
      kingdom: clamp(p.kingdom | 0, 0, KINGDOM_PRESETS.length - 1),
      rivals: clamp(p.rivals || 3, 2, 5),
      size: MAP_SIZES[p.size] ? p.size : 'medium',
      difficulty: DIFFICULTY[p.difficulty] ? p.difficulty : 'normal',
      seed: 0,
    };
    Sfx.setMuted(!!p.muted);
    Music.setEnabled(p.music !== false);
    this.bindMenus();
    window.addEventListener('resize', () => this.onResize());
    $('rotate-ok').addEventListener('click', () => {
      try { localStorage.setItem(PORTRAIT_KEY, '1'); } catch (e) { /* хранилище недоступно */ }
      this.checkOrientation();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.mode === 'game') { this.save(); if (this.speed > 0) this.togglePause(); }
    });
    this.onResize();
    this.showMenu();
    this.last = performance.now();
    this.acc = 0;
    this.mmT = 0;
    requestAnimationFrame(t => this.frame(t));
    console.info('korona-ready');
  },

  savePrefs() { store(PREFS_KEY, { ...this.opts, seed: undefined, muted: Sfx.muted, music: Music.enabled }); },

  // ---------- меню ----------
  bindMenus() {
    $('new-btn').addEventListener('click', () => { Sfx.resume(); this.showNewGame(); });
    $('continue-btn').addEventListener('click', () => { Sfx.resume(); this.continueGame(); });
    $('help-btn').addEventListener('click', () => this.showHelp('menu'));
    $('help2-btn').addEventListener('click', () => this.showHelp('pause'));
    $('help-close').addEventListener('click', () => { $('help').hidden = true; $(this.helpFrom).hidden = false; });
    $('back-btn').addEventListener('click', () => this.showMenu());
    $('reroll-btn').addEventListener('click', () => { this.opts.seed = this.randomSeed(); this.renderNewGame(); });
    $('start-btn').addEventListener('click', () => { Sfx.resume(); this.newGame(); });
    $('resume-btn').addEventListener('click', () => this.togglePause());
    $('save-btn').addEventListener('click', () => { if (this.save()) { $('save-info').textContent = 'Сохранено: ' + this.game.dateText(); Sfx.play('done'); } });
    $('sound-btn').addEventListener('click', () => { Sfx.setMuted(!Sfx.muted); this.syncSound(); this.savePrefs(); });
    $('music-btn').addEventListener('click', () => { Music.setEnabled(!Music.enabled, true); this.syncSound(); this.savePrefs(); });
    $('quit-btn').addEventListener('click', () => { this.save(); this.showMenu(); });
    $('menu-btn').addEventListener('click', () => this.togglePause());
    $('end-menu').addEventListener('click', () => this.showMenu());
    $('end-new').addEventListener('click', () => this.showNewGame());
    for (const b of $('speed').children) b.addEventListener('click', () => { Sfx.resume(); this.setSpeed(+b.dataset.speed); });
    const segs = [['rivals-seg', 'rivals', v => +v], ['size-seg', 'size', v => v], ['diff-seg', 'difficulty', v => v]];
    for (const [id, key, conv] of segs) {
      for (const b of $(id).children) b.addEventListener('click', () => { this.opts[key] = conv(b.dataset.v); this.renderNewGame(); });
    }
    const kp = $('kingdom-pick');
    kp.innerHTML = KINGDOM_PRESETS.map((k, i) => `<button type="button" data-i="${i}">${Icons.crest(k, 34)}<span>${k.name}</span></button>`).join('');
    for (const b of kp.children) b.addEventListener('click', () => { this.opts.kingdom = +b.dataset.i; this.renderNewGame(); });
    this.syncSound();
  },
  syncSound() {
    $('sound-btn').textContent = Sfx.muted ? 'Звук: выкл.' : 'Звук: вкл.';
    $('music-btn').textContent = Music.enabled ? 'Музыка: вкл.' : 'Музыка: выкл.';
  },
  randomSeed() { return 1 + Math.floor(Math.random() * 999999); },

  screens() { return ['menu', 'newgame', 'pause', 'help', 'end']; },
  hideScreens() { for (const s of this.screens()) $(s).hidden = true; },

  showMenu() {
    this.hideScreens();
    $('hud').hidden = true;
    $('menu').hidden = false;
    const s = restore(SAVE_KEY);
    const btn = $('continue-btn');
    if (s && s.v === 1 && s.winner === null) {
      btn.hidden = false;
      const k = s.kingdoms.find(x => x.isPlayer);
      const year = START_YEAR + Math.floor(s.time / (SEASON_LEN * 4));
      $('continue-info').textContent = (k ? k.name : '') + ' · ' + SEASONS[Math.floor(s.time / SEASON_LEN) % 4].toLowerCase() + ' ' + year + ' г.';
    } else btn.hidden = true;
    this.startAttract();
  },
  showNewGame() {
    this.hideScreens();
    $('newgame').hidden = false;
    if (!this.opts.seed) this.opts.seed = this.randomSeed();
    this.renderNewGame();
  },
  renderNewGame() {
    for (const b of $('kingdom-pick').children) b.classList.toggle('on', +b.dataset.i === this.opts.kingdom);
    for (const b of $('rivals-seg').children) b.classList.toggle('on', +b.dataset.v === this.opts.rivals);
    for (const b of $('size-seg').children) b.classList.toggle('on', b.dataset.v === this.opts.size);
    for (const b of $('diff-seg').children) b.classList.toggle('on', b.dataset.v === this.opts.difficulty);
    $('seed-text').textContent = '№ ' + this.opts.seed;
    this.savePrefs();
  },
  showHelp(from) {
    this.helpFrom = from;
    this.hideScreens();
    $('help').hidden = false;
  },

  // ---------- партии ----------
  startAttract() {
    this.mode = 'menu';
    const g = new Game({ seed: this.randomSeed(), size: 'small', rivals: 4, difficulty: 'normal', kingdom: 0, spectate: true });
    for (let i = 0; i < 1200; i++) g.update(STEP);
    this.game = g;
    this.renderer.setGame(g);
    this.renderer.selected = null;
    this.renderer.cam.z = Math.max(this.renderer.minZoom() * 1.6, 18);
    const c = g.cities[0];
    this.renderer.cam.x = c.x; this.renderer.cam.y = c.y;
    this.attractT = 0;
  },
  newGame() {
    const o = { ...this.opts };
    if (!o.seed) o.seed = this.randomSeed();
    this.opts.seed = 0;
    let g;
    try { g = new Game(o); } catch (e) { this.ui.toast('Не удалось создать мир: ' + e.message); return; }
    this.begin(g);
  },
  continueGame() {
    const s = restore(SAVE_KEY);
    if (!s) return;
    let g;
    try { g = new Game(s.opts, s); } catch (e) { this.ui.toast('Сохранение повреждено'); store(SAVE_KEY, null); this.showMenu(); return; }
    this.begin(g);
  },
  begin(g) {
    this.game = g;
    this.mode = 'game';
    this.hideScreens();
    $('hud').hidden = false;
    this.renderer.setGame(g);
    this.ui.bind(g);
    Music.watch(g);
    g.on((type, d) => { if (type === 'gameover') setTimeout(() => this.showEnd(d), 1500); });
    const phone = Math.min(this.renderer.w, this.renderer.h) < 520;
    this.renderer.cam.z = phone ? 26 : 32;
    const cap = g.city(g.player.capital) || g.citiesOf(g.player.id)[0];
    if (cap) this.focus(cap.x + 0.5, cap.y + 0.5);
    this.setSpeed(1);
    this.saveT = 0;
    this.acc = 0;
    this.save();
  },
  playing() { return this.mode === 'game' && !!this.game; },
  setSpeed(s) {
    if (s > 0) this.lastSpeed = s;
    this.speed = s;
  },
  togglePause() {
    if (this.mode !== 'game') return;
    const p = $('pause');
    if (p.hidden) {
      this.pausedSpeed = this.speed;
      this.speed = 0;
      $('save-info').textContent = '';
      p.hidden = false;
    } else {
      p.hidden = true;
      this.speed = this.pausedSpeed || 1;
    }
  },
  focus(x, y) {
    this.renderer.glide = null;
    this.renderer.cam.x = x; this.renderer.cam.y = y;
    this.renderer.clampCam();
  },
  save() {
    const g = this.game;
    if (this.mode !== 'game' || !g || g.opts.spectate) return false;
    if (g.winner !== null) { store(SAVE_KEY, null); return false; }
    if (!store(SAVE_KEY, g.serialize())) { this.ui.toast('Не удалось сохранить игру'); return false; }
    return true;
  },
  showEnd(d) {
    if (this.mode !== 'game') return;
    const g = this.game;
    store(SAVE_KEY, null);
    this.speed = 0;
    this.hideScreens();
    $('end').hidden = false;
    const t = $('end-title');
    t.textContent = d.win ? 'Победа!' : 'Поражение';
    t.className = d.win ? 'win' : 'lose';
    const years = Math.floor(g.time / (SEASON_LEN * 4));
    let sub;
    if (d.win) sub = d.reason === 'conquest' ? 'Все соперники повержены. Ваша держава правит миром.' : 'Ваша держава владеет большинством городов мира.';
    else if (d.reason === 'fallen') sub = 'Пал последний город вашей державы.';
    else sub = (d.by ? d.by.name : 'Соперник') + ' объединило под своей рукой почти весь мир.';
    $('end-sub').textContent = sub + ' Правление длилось ' + (years ? years + ' ' + plural(years, 'год', 'года', 'лет') + ' и ' : '') + (Math.floor(g.time / SEASON_LEN) % 4 + 1) + ' ' + plural(Math.floor(g.time / SEASON_LEN) % 4 + 1, 'сезон', 'сезона', 'сезонов') + '.';
    $('end-table').innerHTML = this.ui.endHtml(g);
    Sfx.play(d.win ? 'victory' : 'defeat');
    Music.stinger(d.win ? 'win' : 'lose');
  },
  // кнопка «Назад» на Android
  back() {
    if (!$('help').hidden) { $('help-close').click(); return true; }
    if (this.mode === 'game') {
      if (!$('end').hidden) { this.showMenu(); return true; }
      if (this.input.tool) { this.input.setTool(null); return true; }
      if (this.ui.sel) { this.ui.select(null); return true; }
      this.togglePause();
      return true;
    }
    if (!$('newgame').hidden) { this.showMenu(); return true; }
    return false;
  },

  // Игра рассчитана на горизонтальный экран: на телефоне в вертикальном положении просим повернуть его.
  checkOrientation() {
    const touch = 'ontouchstart' in window || navigator.maxTouchPoints > 0;
    const portrait = window.innerHeight > window.innerWidth && window.innerWidth < 700;
    let agreed = false;
    try { agreed = localStorage.getItem(PORTRAIT_KEY) === '1'; } catch (e) { agreed = false; }
    $('rotate').hidden = !(touch && portrait) || agreed;
  },
  onResize() {
    this.checkOrientation();
    this.renderer.resize();
    if (this.game) this.renderer.clampCam();
  },
  // Размер холста миникарты берётся из вёрстки; пока она скрыта (меню, свёрнута на телефоне), не рисуем.
  sizeMinimap() {
    const cw = this.mm.clientWidth, ch = this.mm.clientHeight;
    if (!cw || !ch) return false;
    const dpr = this.renderer.dpr;
    const W = Math.round(cw * dpr), H = Math.round(ch * dpr);
    if (this.mm.width !== W || this.mm.height !== H) { this.mm.width = W; this.mm.height = H; }
    return true;
  },

  simulate(gdt) {
    this.acc += gdt;
    let n = 0;
    while (this.acc >= STEP && n < 80) { this.game.update(STEP); this.acc -= STEP; n++; }
    if (n >= 80) this.acc = 0;
  },

  updateAttract(dt) {
    const g = this.game, cam = this.renderer.cam;
    this.attractT -= dt;
    if (this.attractT <= 0) {
      this.attractT = 10;
      const b = g.battles[0];
      const pick = b || g.armies[Math.floor(Math.random() * Math.max(1, g.armies.length))] || g.cities[Math.floor(Math.random() * g.cities.length)];
      this.attractGoal = pick ? { x: pick.x + (pick.level ? 0.5 : 0), y: pick.y + (pick.level ? 0.5 : 0) } : null;
    }
    if (this.attractGoal) {
      const k = Math.min(1, dt * 0.4);
      cam.x = lerp(cam.x, this.attractGoal.x, k);
      cam.y = lerp(cam.y, this.attractGoal.y, k);
    }
    this.renderer.clampCam();
    if (g.winner !== null || g.time > 2400) this.startAttract();
  },

  frame(t) {
    const dt = Math.min(0.1, Math.max(0, (t - this.last) / 1000));
    this.last = t;
    this.frames = (this.frames || 0) + 1;
    if (this.frames === 120) console.info('korona-frames-ok');
    const g = this.game;
    if (g) {
      Music.update(g, dt, this.mode, this.speed === 0);
      if (this.mode === 'menu') {
        this.simulate(dt * 2);
        this.updateAttract(dt);
      } else {
        if (this.speed > 0 && g.winner === null) this.simulate(dt * this.speed);
        else g.updateFx(dt);
        this.input.update(dt);
        this.ui.update(dt);
        this.mmT -= dt;
        if (this.mmT <= 0) { this.mmT = 1 / 12; if (this.sizeMinimap()) this.renderer.drawMinimap(this.mmCtx, this.mm.width, this.mm.height); }
        if (this.speed > 0) {
          this.saveT += dt * this.speed;
          if (this.saveT >= AUTOSAVE_EVERY) { this.saveT = 0; this.save(); }
        }
      }
      this.renderer.render(dt);
    }
    requestAnimationFrame(tt => this.frame(tt));
  },
};

window.addEventListener('DOMContentLoaded', () => App.init());
