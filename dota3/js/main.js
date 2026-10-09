'use strict';
// Запуск: меню выбора героя, матч, пауза, итоги.

const MAP_SEED = 20261009;
const STEP = 1 / 60;

function loadPrefs() {
  try { return JSON.parse(localStorage.getItem('dota3.prefs') || '{}') || {}; } catch (e) { return {}; }
}
function savePrefs(p) {
  try { localStorage.setItem('dota3.prefs', JSON.stringify(p)); } catch (e) { /* хранилище недоступно */ }
}

const App = {
  mode: 'menu',
  game: null,

  init() {
    this.canvas = $('game');
    this.renderer = new Renderer(this.canvas);
    this.ui = new UI();
    this.input = new Input(this.canvas, this.renderer, this.ui);
    this.mm = $('minimap');
    this.mmCtx = this.mm.getContext('2d');
    const prefs = loadPrefs();
    this.sel = {
      heroId: HERO_BY_ID[prefs.heroId] ? prefs.heroId : 'thunder',
      team: prefs.team === 1 ? 1 : 0,
      difficulty: DIFFICULTY[prefs.difficulty] ? prefs.difficulty : 'normal',
    };
    if (prefs.muted && !Sfx.muted) Sfx.toggle();
    this.buildMenu();
    this.bindButtons();
    window.addEventListener('resize', () => this.onResize());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && this.mode === 'game' && this.game && !this.game.paused && this.game.winner < 0) this.togglePause();
    });
    this.onResize();
    this.startAttract();
    this.last = performance.now();
    this.acc = 0;
    this.mmT = 0;
    requestAnimationFrame(t => this.frame(t));
  },

  bindButtons() {
    $('start-btn').addEventListener('click', () => { Sfx.resume(); this.startGame(); });
    $('resume-btn').addEventListener('click', () => this.togglePause());
    $('quit-btn').addEventListener('click', () => this.toMenu());
    $('again-btn').addEventListener('click', () => this.startGame());
    $('end-menu-btn').addEventListener('click', () => this.toMenu());
    $('btn-menu').addEventListener('click', () => this.togglePause());
    $('btn-sound').addEventListener('click', () => this.toggleSound());
    this.syncSoundBtn();
  },

  toggleSound() {
    Sfx.resume();
    Sfx.toggle();
    this.syncSoundBtn();
    savePrefs({ ...this.sel, muted: Sfx.muted });
  },
  syncSoundBtn() {
    const b = $('btn-sound');
    b.classList.toggle('off', Sfx.muted);
    b.textContent = Sfx.muted ? 'Звук выкл.' : 'Звук';
  },

  // ---------- меню ----------
  buildMenu() {
    const grid = $('hero-grid');
    grid.innerHTML = '';
    for (const h of HEROES) {
      const b = document.createElement('button');
      b.type = 'button';
      b.className = 'hcard';
      b.dataset.id = h.id;
      b.setAttribute('role', 'option');
      b.innerHTML = `<canvas width="152" height="152"></canvas><span>${h.name}</span>`;
      b.querySelector('canvas').getContext('2d').drawImage(Icons.hero(h, 152), 0, 0);
      b.addEventListener('click', () => { this.sel.heroId = h.id; this.renderMenu(); Sfx.resume(); Sfx.play('click'); });
      grid.appendChild(b);
    }
    for (const b of $('team-seg').children) b.addEventListener('click', () => { this.sel.team = +b.dataset.v; this.renderMenu(); });
    for (const b of $('diff-seg').children) b.addEventListener('click', () => { this.sel.difficulty = b.dataset.v; this.renderMenu(); });
    this.renderMenu();
  },

  renderMenu() {
    for (const b of $('hero-grid').children) {
      const on = b.dataset.id === this.sel.heroId;
      b.classList.toggle('on', on);
      b.setAttribute('aria-selected', on ? 'true' : 'false');
    }
    for (const b of $('team-seg').children) b.classList.toggle('on', +b.dataset.v === this.sel.team);
    for (const b of $('diff-seg').children) b.classList.toggle('on', b.dataset.v === this.sel.difficulty);
    const h = HERO_BY_ID[this.sel.heroId];
    const abs = h.abilities.map((id, i) => {
      const a = ABILITIES[id];
      return `<div class="hd-ab"><canvas data-ab="${id}" width="76" height="76"></canvas><div><b>${ABILITY_KEYS[i]} · ${a.name}</b><i>${a.type === 'passive' ? 'Пассивная' : a.ult ? 'Ультимейт' : 'Активная'}</i></div></div>`;
    }).join('');
    const d = $('hero-detail');
    d.innerHTML = `<div class="hd-head"><h3>${h.name}</h3><small>${h.role}</small></div><p class="hd-bio">${h.bio}</p><div class="hd-abs">${abs}</div>`;
    for (const cv of d.querySelectorAll('canvas[data-ab]')) cv.getContext('2d').drawImage(Icons.ability(ABILITIES[cv.dataset.ab], 76), 0, 0);
    savePrefs({ ...this.sel, muted: Sfx.muted });
  },

  // ---------- режимы ----------
  startAttract() {
    this.mode = 'menu';
    const g = new Game({ spectator: true, difficulty: 'normal', seed: MAP_SEED });
    for (let i = 0; i < 60 * 25; i++) g.update(STEP);
    this.game = g;
    this.renderer.setGame(g);
    this.renderer.cam.zoom = window.innerWidth < 760 ? 0.6 : 0.8;
    this.attractT = 0;
    this.attractFocus = null;
    const mid = g.map.lanes.mid[1];
    this.renderer.cam.x = mid.x; this.renderer.cam.y = mid.y;
  },

  startGame() {
    $('menu').hidden = true;
    $('pause').hidden = true;
    $('end').hidden = true;
    const g = new Game({ heroId: this.sel.heroId, team: this.sel.team, difficulty: this.sel.difficulty, seed: MAP_SEED });
    this.game = g;
    this.mode = 'game';
    this.renderer.setGame(g);
    this.renderer.hover = null;
    this.input.setGame(g);
    this.ui.bind(g, this.input);
    g.onSound = (name, at) => this.playAt(name, at);
    g.on((type, d) => {
      if (type === 'gameover') setTimeout(() => { if (this.game === g) { this.mode = 'end'; this.ui.showEnd(g); } }, 2600);
    });
    this.renderer.cam.zoom = window.innerWidth < 760 ? 0.7 : 1;
    this.renderer.cam.x = g.player.x; this.renderer.cam.y = g.player.y;
    $('hud').hidden = false;
    this.acc = 0;
    this.ui.toast('Купите предметы в лавке (B) и идите на линию', true);
  },

  toMenu() {
    $('hud').hidden = true;
    $('pause').hidden = true;
    $('end').hidden = true;
    $('menu').hidden = false;
    this.ui.hideTip();
    this.startAttract();
  },

  togglePause() {
    const g = this.game;
    if (this.mode !== 'game' || !g || g.winner >= 0) return;
    g.paused = !g.paused;
    $('pause').hidden = !g.paused;
    if (g.paused) { this.ui.hideTip(); $('resume-btn').focus(); }
  },

  playAt(name, at) {
    if (!at) { Sfx.play(name); return; }
    const cam = this.renderer.cam;
    const d = dist(cam.x, cam.y, at.x, at.y);
    const v = clamp(1.15 - d / 1300, 0, 1);
    if (v > 0.05) Sfx.play(name, v);
  },

  onResize() {
    this.renderer.resize();
    const dpr = this.renderer.dpr;
    const size = Math.max(64, Math.round((this.mm.clientWidth || 200) * dpr));
    if (this.mm.width !== size) { this.mm.width = size; this.mm.height = size; }
  },

  updateAttract(dt) {
    const g = this.game, cam = this.renderer.cam;
    this.attractT -= dt;
    if (this.attractT <= 0 || !this.attractFocus || !this.attractFocus.alive) {
      this.attractT = 9;
      let best = null, bs = -1;
      for (const h of g.heroes) {
        if (!h.alive) continue;
        let n = 0;
        for (const o of g.heroes) if (o.alive && o.team !== h.team && dist(o.x, o.y, h.x, h.y) < 1200) n++;
        const s = n + Math.random();
        if (s > bs) { bs = s; best = h; }
      }
      this.attractFocus = best;
    }
    const f = this.attractFocus;
    if (f) {
      const k = Math.min(1, dt * 1.2);
      cam.x = lerp(cam.x, f.x, k); cam.y = lerp(cam.y, f.y, k);
    }
    this.renderer.clampCam();
    if (g.winner >= 0 && g.endT > 6) this.startAttract();
  },

  frame(t) {
    const dt = Math.min(0.1, Math.max(0, (t - this.last) / 1000));
    this.last = t;
    const g = this.game;
    if (g) {
      if (!g.paused) {
        this.acc += dt;
        let n = 0;
        const before = g.time;
        while (this.acc >= STEP && n < 4) { g.update(STEP); this.acc -= STEP; n++; }
        if (n >= 4) this.acc = 0;
        if (this.mode === 'game' && before < 0 && g.time >= 0) {
          Sfx.play('horn');
          this.ui.queueAnnounce('Битва началась!', '#f0cf7a');
        }
      }
      if (this.mode === 'menu') this.updateAttract(dt);
      else this.input.update(dt);
      this.renderer.render(dt);
      if (this.mode !== 'menu') {
        this.ui.update(dt);
        this.mmT -= dt;
        if (this.mmT <= 0) { this.mmT = 1 / 30; this.renderer.drawMinimap(this.mmCtx, this.mm.width); }
      }
    }
    requestAnimationFrame(tt => this.frame(tt));
  },
};

window.addEventListener('DOMContentLoaded', () => App.init());
