'use strict';
// Мышь, клавиатура, касания и миникарта.

class Input {
  constructor(canvas, renderer, ui) {
    this.canvas = canvas;
    this.r = renderer;
    this.ui = ui;
    this.g = null;
    this.mx = window.innerWidth / 2;
    this.my = window.innerHeight / 2;
    this.overCanvas = false;
    this.keys = new Set();
    this.targeting = null;
    this.moveMark = null;
    this.camLock = true;
    this.touches = new Map();
    this.pinch = null;
    this.mmDrag = false;
    renderer.input = this;
    this.bind();
  }

  setGame(g) {
    this.g = g;
    this.targeting = null;
    this.camLock = true;
    this.moveMark = null;
    this.keys.clear();
  }

  active() {
    const g = this.g;
    return !!(g && g.player && App.mode === 'game' && !g.paused && g.winner < 0);
  }

  bind() {
    const cv = this.canvas;
    cv.addEventListener('contextmenu', e => e.preventDefault());
    cv.addEventListener('pointerdown', e => this.onDown(e));
    window.addEventListener('pointermove', e => this.onMove(e));
    window.addEventListener('pointerup', e => this.onUp(e));
    window.addEventListener('pointercancel', e => this.onUp(e, true));
    cv.addEventListener('wheel', e => {
      e.preventDefault();
      if (App.mode !== 'game') return;
      const cam = this.r.cam;
      cam.zoom = clamp(cam.zoom * Math.exp(-e.deltaY * 0.0012), 0.5, 1.5);
    }, { passive: false });
    document.addEventListener('pointerleave', () => { this.overCanvas = false; });
    window.addEventListener('keydown', e => this.onKey(e));
    window.addEventListener('keyup', e => {
      this.keys.delete(e.code);
      if (e.code === 'Tab' && this.g) { e.preventDefault(); this.ui.toggleScore(false); }
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      if (this.g) this.ui.toggleScore(false);
    });
    const mm = document.getElementById('minimap');
    mm.addEventListener('contextmenu', e => e.preventDefault());
    mm.addEventListener('pointerdown', e => {
      e.preventDefault();
      Sfx.resume();
      if (!this.active()) return;
      const w = this.mmToWorld(e, mm);
      if (e.button === 2) { this.order(w.x, w.y, true); return; }
      if (this.targeting && this.targeting.type === 'point') { this.confirm(w.x, w.y); return; }
      this.camLock = false;
      this.r.cam.x = w.x; this.r.cam.y = w.y;
      this.mmDrag = true;
      try { mm.setPointerCapture(e.pointerId); } catch (err) { /* необязательно */ }
    });
    mm.addEventListener('pointermove', e => {
      if (!this.mmDrag) return;
      const w = this.mmToWorld(e, mm);
      this.r.cam.x = w.x; this.r.cam.y = w.y;
    });
    mm.addEventListener('pointerup', () => { this.mmDrag = false; });
  }

  mmToWorld(e, mm) {
    const rc = mm.getBoundingClientRect();
    return {
      x: clamp((e.clientX - rc.left) / rc.width, 0, 1) * WORLD_SIZE,
      y: clamp((e.clientY - rc.top) / rc.height, 0, 1) * WORLD_SIZE,
    };
  }

  onDown(e) {
    Sfx.resume();
    this.mx = e.clientX; this.my = e.clientY;
    if (!this.active()) return;
    if (e.pointerType === 'mouse') {
      const w = this.r.toWorld(e.clientX, e.clientY);
      if (e.button === 2) {
        if (this.targeting) { this.targeting = null; return; }
        this.order(w.x, w.y);
      } else if (e.button === 0) {
        if (this.targeting) this.confirm(w.x, w.y);
        else this.order(w.x, w.y);
      }
      return;
    }
    try { this.canvas.setPointerCapture(e.pointerId); } catch (err) { /* необязательно */ }
    this.touches.set(e.pointerId, { x: e.clientX, y: e.clientY, sx: e.clientX, sy: e.clientY, moved: false });
    if (this.touches.size === 2) {
      const [a, b] = [...this.touches.values()];
      this.pinch = { d: dist(a.x, a.y, b.x, b.y) || 1, zoom: this.r.cam.zoom };
    }
  }

  onMove(e) {
    this.mx = e.clientX; this.my = e.clientY;
    if (e.pointerType === 'mouse') { this.overCanvas = e.target === this.canvas; return; }
    const t = this.touches.get(e.pointerId);
    if (!t || !this.active()) return;
    const dx = e.clientX - t.x, dy = e.clientY - t.y;
    t.x = e.clientX; t.y = e.clientY;
    if (this.pinch && this.touches.size >= 2) {
      const [a, b] = [...this.touches.values()];
      const d = dist(a.x, a.y, b.x, b.y) || 1;
      this.r.cam.zoom = clamp(this.pinch.zoom * d / this.pinch.d, 0.5, 1.5);
      for (const p of this.touches.values()) p.moved = true;
      return;
    }
    if (!t.moved && dist(t.x, t.y, t.sx, t.sy) > 14) t.moved = true;
    if (t.moved) {
      this.camLock = false;
      this.r.cam.x -= dx / this.r.cam.zoom;
      this.r.cam.y -= dy / this.r.cam.zoom;
    }
  }

  onUp(e, cancel) {
    if (e.pointerType === 'mouse') return;
    const t = this.touches.get(e.pointerId);
    if (!t) return;
    this.touches.delete(e.pointerId);
    if (this.touches.size < 2) this.pinch = null;
    if (cancel || t.moved || !this.active()) return;
    const w = this.r.toWorld(t.x, t.y);
    if (this.targeting) this.confirm(w.x, w.y);
    else this.order(w.x, w.y);
  }

  onKey(e) {
    const g = this.g;
    if (!g || App.mode !== 'game') return;
    const k = e.code;
    if (k === 'Tab') { e.preventDefault(); this.ui.toggleScore(true); return; }
    if (k === 'Escape') {
      e.preventDefault();
      if (this.targeting) this.targeting = null;
      else if (this.ui.shopOpen) this.ui.toggleShop(false);
      else App.togglePause();
      return;
    }
    if (k === 'KeyP' || k === 'F10') { e.preventDefault(); App.togglePause(); return; }
    if (k === 'KeyM') { App.toggleSound(); return; }
    if (!this.active()) return;
    if (k.startsWith('Arrow')) { e.preventDefault(); this.keys.add(k); return; }
    const ab = { KeyQ: 0, KeyW: 1, KeyE: 2, KeyR: 3 }[k];
    if (ab !== undefined) {
      if (e.ctrlKey || e.metaKey) return;
      e.preventDefault();
      if (e.shiftKey || e.altKey) {
        if (g.player.levelAbility(ab)) Sfx.play('click');
        else this.ui.toast('Сейчас нельзя изучить эту способность');
      } else this.activateAbility(ab);
      return;
    }
    if (/^Digit[1-6]$/.test(k)) { this.activateItem(+k.slice(5) - 1); return; }
    if (/^Numpad[1-6]$/.test(k)) { this.activateItem(+k.slice(6) - 1); return; }
    switch (k) {
      case 'KeyA': this.startAttackMove(); break;
      case 'KeyS': case 'KeyH': g.player.orderStop(); this.targeting = null; break;
      case 'KeyB': case 'F4': e.preventDefault(); this.ui.toggleShop(); break;
      case 'Space': e.preventDefault(); this.centerCamera(true); break;
      case 'KeyY': this.camLock = !this.camLock; this.ui.toast(this.camLock ? 'Камера следует за героем' : 'Камера свободна', true); break;
      case 'F1': e.preventDefault(); this.centerCamera(true); break;
    }
  }

  centerCamera(lock) {
    const p = this.g && this.g.player;
    if (!p) return;
    this.r.cam.x = p.x; this.r.cam.y = p.y;
    if (lock) this.camLock = true;
  }

  startAttackMove() {
    if (!this.active()) return;
    this.targeting = { source: 'amove', type: 'point', range: 0 };
  }

  activateAbility(i) {
    if (!this.active()) return;
    const h = this.g.player;
    if (!h.alive) return;
    const ab = h.abilities[i];
    if (!ab) return;
    if (ab.lv === 0) {
      this.ui.toast(h.canLevel(i) ? 'Сначала изучите: Shift+' + ABILITY_KEYS[i] + ' или «+»' : 'Способность ещё не изучена');
      Sfx.play('error');
      return;
    }
    const def = ab.def;
    if (def.type === 'passive') { this.ui.toast('Это пассивная способность'); return; }
    const o = { item: false, slot: i };
    const why = h.castBlock(o, h.castInfo(o));
    if (why) { this.ui.toast(why); Sfx.play('error'); return; }
    if (def.type === 'none') { h.cancelChannel(); h.orderCast(i, { x: h.x, y: h.y }, false); this.targeting = null; return; }
    const tg = this.targeting;
    if (tg && tg.source === 'ability' && tg.slot === i && def.target === 'ally') {
      h.orderCast(i, { unit: h }, false);
      this.targeting = null;
      return;
    }
    this.targeting = {
      source: 'ability', slot: i, type: def.type, range: LV(def.range, ab.lv), radius: def.radius || 0,
      clamp: !!def.clamp, team: def.target || 'enemy',
    };
  }

  activateItem(i) {
    if (!this.active()) return;
    const h = this.g.player;
    if (!h.alive) return;
    const it = h.items[i];
    if (!it) return;
    const def = ITEMS[it.id];
    if (!def.active) { this.ui.toast('У предмета нет активного свойства'); return; }
    const act = ITEM_ACTIVES[def.active];
    const o = { item: true, slot: i };
    const why = h.castBlock(o, h.castInfo(o));
    if (why) { this.ui.toast(why); Sfx.play('error'); return; }
    if (act.type === 'none') { h.orderCast(i, { x: h.x, y: h.y }, true); this.targeting = null; return; }
    this.targeting = { source: 'item', slot: i, type: act.type, range: act.range, clamp: !!act.clamp, radius: 0, team: 'any' };
    if (def.id === 'tp') this.ui.toast('Выберите точку на карте или миникарте', true);
  }

  unitAt(wx, wy, filter) {
    const g = this.g;
    const list = this.r.drawn || [];
    const pad = 14 / this.r.cam.zoom;
    let best = null, bd = Infinity;
    for (const u of list) {
      if (!u.alive || u.kind === 'fountain') continue;
      if (filter && !filter(u)) continue;
      if (!g.spectator && u.team !== g.playerTeam && !u.isBuilding && !u.visibleTo[g.playerTeam]) continue;
      const d = dist(wx, wy, u.x, u.y - (u.z || 0)) - u.radius - (u.isBuilding ? 20 : 0);
      if (d > pad) continue;
      const score = d - (u.kind === 'hero' ? 12 : 0);
      if (score < bd) { bd = score; best = u; }
    }
    return best;
  }

  order(wx, wy, fromMinimap) {
    const h = this.g.player;
    if (!h || !h.alive) return;
    h.cancelChannel();
    const u = fromMinimap ? null : this.unitAt(wx, wy);
    if (u && u !== h && u.team !== h.team && h.canAttack(u)) {
      h.orderAttack(u);
      this.mark(u.x, u.y, true);
    } else if (u && u.team !== h.team && u.s.invuln) {
      this.ui.toast(u.isBuilding ? 'Строение защищено — сначала разрушьте предыдущую башню' : 'Цель неуязвима');
      Sfx.play('error');
    } else {
      const x = clamp(wx, 30, WORLD_SIZE - 30), y = clamp(wy, 30, WORLD_SIZE - 30);
      h.orderMove(x, y);
      this.mark(x, y, false);
    }
  }

  mark(x, y, attack) { this.moveMark = { x, y, attack, t: 0 }; }

  confirm(wx, wy) {
    const tg = this.targeting, h = this.g.player;
    if (!h || !h.alive) { this.targeting = null; return; }
    if (tg.source === 'amove') {
      h.cancelChannel();
      h.orderAttackMove(wx, wy);
      this.mark(wx, wy, true);
      this.targeting = null;
      return;
    }
    if (tg.type === 'point') {
      h.cancelChannel();
      h.orderCast(tg.slot, { x: wx, y: wy }, tg.source === 'item');
      this.targeting = null;
      return;
    }
    if (tg.type === 'unit') {
      const want = tg.team;
      const u = this.unitAt(wx, wy, c => !c.isBuilding && (want === 'any' || (want === 'ally' ? c.team === h.team : c.team !== h.team)));
      if (!u) {
        this.ui.toast(want === 'ally' ? 'Выберите союзника' : want === 'any' ? 'Выберите героя или крипа' : 'Выберите врага');
        Sfx.play('error');
        return;
      }
      h.cancelChannel();
      h.orderCast(tg.slot, { unit: u }, tg.source === 'item');
      this.targeting = null;
    }
  }

  update(dt) {
    const g = this.g, r = this.r, cam = r.cam;
    if (!g) return;
    if (this.moveMark) { this.moveMark.t += dt; if (this.moveMark.t > 0.6) this.moveMark = null; }
    const p = g.player;
    if (this.targeting && (!p || !p.alive)) this.targeting = null;
    const w = r.toWorld(this.mx, this.my);
    r.hover = this.overCanvas ? this.unitAt(w.x, w.y) : null;
    let cursor = 'default';
    if (this.targeting) cursor = 'crosshair';
    else if (r.hover && p && r.hover.team !== p.team) cursor = 'pointer';
    if (this.canvas.style.cursor !== cursor) this.canvas.style.cursor = cursor;
    if (g.centerOnPlayer && p) { cam.x = p.x; cam.y = p.y; g.centerOnPlayer = false; }
    let dx = 0, dy = 0;
    if (this.keys.has('ArrowLeft')) dx -= 1;
    if (this.keys.has('ArrowRight')) dx += 1;
    if (this.keys.has('ArrowUp')) dy -= 1;
    if (this.keys.has('ArrowDown')) dy += 1;
    if (this.overCanvas && !this.mmDrag) {
      const e = 6;
      if (this.mx <= e) dx = -1; else if (this.mx >= r.w - e) dx = 1;
      if (this.my <= e) dy = -1; else if (this.my >= r.h - e) dy = 1;
    }
    if (dx || dy) {
      this.camLock = false;
      const sp = 1500 / cam.zoom * dt;
      cam.x += dx * sp; cam.y += dy * sp;
    } else if (this.camLock && p && p.alive && !this.mmDrag) {
      const k = Math.min(1, dt * 7);
      cam.x = lerp(cam.x, p.x, k);
      cam.y = lerp(cam.y, p.y, k);
    }
    r.clampCam();
  }
}
