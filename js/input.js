'use strict';
// Управление: касания (сдвиг, щипок, касание), мышь (перетаскивание, колесо, клики), клавиатура, миникарта.

class Input {
  constructor(app) {
    this.app = app;
    this.canvas = app.canvas;
    this.pointers = new Map();
    this.pinch = null;
    this.keys = new Set();
    this.bind();
  }

  get r() { return this.app.renderer; }

  bind() {
    const cv = this.canvas;
    cv.addEventListener('contextmenu', e => e.preventDefault());
    cv.addEventListener('pointerdown', e => this.down(e));
    window.addEventListener('pointermove', e => this.move(e));
    window.addEventListener('pointerup', e => this.up(e));
    window.addEventListener('pointercancel', e => this.up(e, true));
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      if (!this.app.playing()) return;
      this.zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
    }, { passive: false });
    window.addEventListener('keydown', e => this.key(e));
    window.addEventListener('keyup', e => this.keys.delete(e.code));
    window.addEventListener('blur', () => this.keys.clear());
    const mm = document.getElementById('minimap');
    let mmDrag = false;
    const mmPos = e => {
      const rc = mm.getBoundingClientRect();
      const w = this.app.game.world;
      return { x: clamp((e.clientX - rc.left) / rc.width, 0, 1) * w.W, y: clamp((e.clientY - rc.top) / rc.height, 0, 1) * w.H };
    };
    mm.addEventListener('contextmenu', e => e.preventDefault());
    mm.addEventListener('pointerdown', e => {
      e.preventDefault();
      if (!this.app.playing()) return;
      Sfx.resume();
      const p = mmPos(e);
      const a = this.app.ui.selectedDivs();
      if (e.button === 2 && a.length) { this.orderTo(a, { kind: 'ground', x: p.x, y: p.y }); return; }
      this.app.focus(p.x, p.y);
      mmDrag = true;
      try { mm.setPointerCapture(e.pointerId); } catch (err) { /* не обязательно */ }
    });
    mm.addEventListener('pointermove', e => { if (mmDrag) { const p = mmPos(e); this.app.focus(p.x, p.y); } });
    mm.addEventListener('pointerup', () => { mmDrag = false; });
  }

  zoomAt(sx, sy, f) {
    const r = this.r, cam = r.cam;
    r.glide = null;
    const before = r.toWorld(sx, sy);
    cam.z = clamp(cam.z * f, r.minZoom(), 72);
    const after = r.toWorld(sx, sy);
    cam.x += before.x - after.x;
    cam.y += before.y - after.y;
    r.clampCam();
  }

  // Инструмент модуля (рисование фронта, стройка стен) забирает себе касания одним пальцем;
  // двумя пальцами карта по-прежнему двигается и масштабируется. tool: { down, move, up, cancel } в координатах мира.
  setTool(t) {
    if (this.tool && this.tool !== t && this.tool.cancel) this.tool.cancel(this);
    this.tool = t || null;
    this.canvas.classList.toggle('tool', !!this.tool);
  }

  down(e) {
    Sfx.resume();
    if (!this.app.playing()) return;
    this.r.glide = null;
    try { this.canvas.setPointerCapture(e.pointerId); } catch (err) { /* не обязательно */ }
    const pt = { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false, button: e.button, type: e.pointerType };
    this.pointers.set(e.pointerId, pt);
    pt.shift = !!e.shiftKey;
    // Shift+перетаскивание мышью — рамка выделения дивизий без кнопки в панели
    if (!this.tool && this.pointers.size === 1 && e.shiftKey && e.pointerType === 'mouse' && e.button === 0 && UIExt.shiftTool) this.setTool(UIExt.shiftTool(this.app.ui));
    if (this.tool && this.pointers.size === 1 && e.button !== 2) {
      pt.tool = true;
      if (this.tool.down) this.tool.down(this.r.toWorld(e.clientX, e.clientY), e, this);
      return;
    }
    if (this.pointers.size === 2) {
      for (const q of this.pointers.values()) if (q.tool) { q.tool = false; if (this.tool && this.tool.cancel) this.tool.cancel(this, true); }
      const [a, b] = [...this.pointers.values()];
      this.pinch = { d: Math.hypot(a.x - b.x, a.y - b.y) || 1, cx: (a.x + b.x) / 2, cy: (a.y + b.y) / 2 };
      for (const p of this.pointers.values()) p.moved = true;
    }
  }

  move(e) {
    const p = this.pointers.get(e.pointerId);
    if (!p || !this.app.playing()) return;
    if (p.tool && this.tool) {
      p.x = e.clientX; p.y = e.clientY;
      if (this.tool.move) this.tool.move(this.r.toWorld(e.clientX, e.clientY), e, this);
      return;
    }
    const dx = e.clientX - p.x, dy = e.clientY - p.y;
    p.x = e.clientX; p.y = e.clientY;
    const r = this.r;
    if (this.pinch && this.pointers.size >= 2) {
      const [a, b] = [...this.pointers.values()];
      const d = Math.hypot(a.x - b.x, a.y - b.y) || 1;
      const cx = (a.x + b.x) / 2, cy = (a.y + b.y) / 2;
      this.zoomAt(cx, cy, d / this.pinch.d);
      r.cam.x -= (cx - this.pinch.cx) / r.cam.z;
      r.cam.y -= (cy - this.pinch.cy) / r.cam.z;
      this.pinch.d = d; this.pinch.cx = cx; this.pinch.cy = cy;
      r.clampCam();
      return;
    }
    if (!p.moved && Math.hypot(p.x - p.sx, p.y - p.sy) > (p.type === 'mouse' ? 4 : 10)) p.moved = true;
    if (p.moved) {
      r.cam.x -= dx / r.cam.z;
      r.cam.y -= dy / r.cam.z;
      r.clampCam();
    }
  }

  up(e, cancel) {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    if (this.pointers.size < 2) this.pinch = null;
    if (p.tool && this.tool) {
      if (this.tool.up) this.tool.up(this.r.toWorld(e.clientX, e.clientY), e, this, !!cancel);
      return;
    }
    if (cancel || p.moved || !this.app.playing()) return;
    this.tap(p.x, p.y, p.button === 2);
  }

  tap(sx, sy, alt) {
    const app = this.app, g = app.game, ui = app.ui;
    const hit = this.r.pick(sx, sy);
    const sel = ui.selectedDivs(), a = sel[0];
    if (a) {
      if (hit.kind === 'army') {
        const t = hit.obj;
        if (t.owner === g.player.id) {
          const inSel = sel.indexOf(t) >= 0;
          if (alt && !inSel) { this.orderTo(sel, hit); return; }
          ui.select(sel.length === 1 && t.id === a.id ? null : { kind: 'army', id: t.id });
          Sfx.play('click');
          return;
        }
      }
      this.orderTo(sel, hit);
      return;
    }
    if (alt) { ui.select(null); return; }
    if (hit.kind === 'ground') { ui.select(null); return; }
    ui.select({ kind: hit.kind, id: hit.id });
    Sfx.play('click');
  }

  // Приказ одной дивизии или нескольким (armies — массив): несколько идут строем.
  orderTo(armies, hit) {
    const g = this.app.game, ui = this.app.ui;
    const list = Array.isArray(armies) ? armies : [armies], a = list[0];
    let target, attack = false, x, y;
    if (hit.kind === 'army') {
      const t = hit.obj;
      target = { kind: 'army', id: t.id };
      attack = t.owner !== a.owner;
      x = t.x; y = t.y;
    } else if (hit.kind === 'city') {
      const c = hit.obj;
      target = { kind: 'city', id: c.id };
      attack = c.owner !== a.owner;
      x = c.x + 0.5; y = c.y + 0.5;
    } else {
      const i = g.world.tileAt(hit.x, hit.y);
      if (i < 0 || !g.world.passable(i)) { ui.toast('Туда не пройти: там вода'); Sfx.play('error'); return; }
      target = { kind: 'ground', x: hit.x, y: hit.y };
      x = hit.x; y = hit.y;
    }
    let err;
    if (list.length > 1) err = Fronts.orderMany(g, list, target);
    else { a.front = null; err = g.order(a, target); }
    if (err) { ui.toast(err); Sfx.play('error'); return; }
    this.r.marker = { x, y, t: 0, attack };
    Sfx.play(attack ? 'horn' : 'march');
    ui.html = '';
    ui.renderPanel();
  }

  key(e) {
    const app = this.app;
    if (!app.game || app.mode !== 'game') return;
    const k = e.code;
    if (k === 'Escape' && this.tool) { this.setTool(null); return; }
    if (k === 'Escape') {
      e.preventDefault();
      if (app.ui.sel) app.ui.select(null);
      else app.togglePause();
      return;
    }
    if (!app.playing()) return;
    if (k === 'Space') { e.preventDefault(); app.setSpeed(app.speed === 0 ? app.lastSpeed || 1 : 0); return; }
    if (k === 'Digit1' || k === 'Digit2' || k === 'Digit3') { app.setSpeed(+k.slice(5)); return; }
    if (k === 'Equal' || k === 'NumpadAdd') { this.zoomAt(this.r.w / 2, this.r.h / 2, 1.2); return; }
    if (k === 'Minus' || k === 'NumpadSubtract') { this.zoomAt(this.r.w / 2, this.r.h / 2, 1 / 1.2); return; }
    if (k === 'KeyH') { const c = app.game.city(app.game.player.capital); if (c) app.focus(c.x + 0.5, c.y + 0.5); return; }
    if (/^(Arrow|Key[WASD])/.test(k)) { this.keys.add(k); e.preventDefault(); }
  }

  update(dt) {
    let dx = 0, dy = 0;
    if (this.keys.has('ArrowLeft') || this.keys.has('KeyA')) dx--;
    if (this.keys.has('ArrowRight') || this.keys.has('KeyD')) dx++;
    if (this.keys.has('ArrowUp') || this.keys.has('KeyW')) dy--;
    if (this.keys.has('ArrowDown') || this.keys.has('KeyS')) dy++;
    if (dx || dy) {
      const r = this.r;
      r.glide = null;
      r.cam.x += dx * 700 / r.cam.z * dt;
      r.cam.y += dy * 700 / r.cam.z * dt;
      r.clampCam();
    }
  }
}
