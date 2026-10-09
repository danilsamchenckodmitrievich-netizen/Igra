'use strict';
// Интерфейс поверх игры: панель героя, лавка, счёт, подсказки, сообщения.

const $ = id => document.getElementById(id);
const ABILITY_KEYS = ['Q', 'W', 'E', 'R'];

function copyCanvas(dst, src) {
  dst.width = src.width; dst.height = src.height;
  dst.getContext('2d').drawImage(src, 0, 0);
}
function fmtNum(n) { return Math.floor(n).toLocaleString('ru-RU'); }
function fmtStat(v, d) { return Number.isInteger(v) || !d ? String(Math.round(v)) : v.toFixed(d); }

class UI {
  constructor() {
    this.g = null;
    this.input = null;
    this.textT = 0;
    this.sbT = 0;
    this.shopSel = 'boots';
    this.tipEl = null;
    this.toastT = 0;
    this.announceQ = [];
    this.announceT = 0;
    this.itemKeys = [];
    this.abilityEls = [];
    this.slotEls = [];
    this.buildShop();
    this.bindStatic();
  }

  bindStatic() {
    $('shop-close').addEventListener('click', () => this.toggleShop(false));
    $('gold-btn').addEventListener('click', () => this.toggleShop());
    $('btn-score').addEventListener('click', () => this.toggleScore());
    $('portrait-wrap').addEventListener('click', () => { if (this.input) this.input.centerCamera(); });
    $('tb-center').addEventListener('click', () => { if (this.input) this.input.centerCamera(true); });
    $('tb-stop').addEventListener('click', () => { if (this.g && this.g.player) this.g.player.orderStop(); });
    $('tb-amove').addEventListener('click', () => { if (this.input) this.input.startAttackMove(); });
  }

  bind(g, input) {
    this.g = g;
    this.input = input;
    const h = g.player;
    $('killfeed').innerHTML = '';
    $('announce').className = '';
    this.announceQ = [];
    copyCanvas($('portrait'), Icons.hero(h.def, 176));
    $('hero-name').textContent = h.def.name;
    this.buildAbilities(h);
    this.buildItems();
    this.toggleShop(false);
    this.toggleScore(false);
    this.renderShop();
    g.on((type, d) => this.onEvent(type, d));
  }

  // ---------- способности ----------
  buildAbilities(h) {
    const wrap = $('abilities');
    wrap.innerHTML = '';
    this.abilityEls = h.abilities.map((ab, i) => {
      const el = document.createElement('div');
      el.className = 'ab';
      el.innerHTML = `<canvas></canvas><div class="cd"></div><span class="cdt"></span><span class="key">${ABILITY_KEYS[i]}</span>` +
        `<span class="mana"></span><div class="pips">${'<i></i>'.repeat(ab.def.maxLv)}</div><button class="lvlup" type="button" hidden aria-label="Изучить">+</button>`;
      copyCanvas(el.querySelector('canvas'), Icons.ability(ab.def, 112));
      el.addEventListener('click', e => {
        if (e.target.classList.contains('lvlup')) return;
        if (this.input) this.input.activateAbility(i);
      });
      const up = el.querySelector('.lvlup');
      up.addEventListener('click', e => {
        e.stopPropagation();
        if (this.g.player.levelAbility(i)) Sfx.play('click');
        this.showAbilityTip(i, el);
      });
      el.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') this.showAbilityTip(i, el); });
      el.addEventListener('pointerleave', () => this.hideTip());
      wrap.appendChild(el);
      return {
        el, cd: el.querySelector('.cd'), cdt: el.querySelector('.cdt'), mana: el.querySelector('.mana'),
        pips: [...el.querySelectorAll('.pips i')], up, state: '',
      };
    });
  }

  abilityTip(h, i) {
    const ab = h.abilities[i], def = ab.def;
    const lv = ab.lv;
    let meta;
    if (def.type === 'passive') meta = 'Пассивная';
    else {
      const cd = LV(def.cd, Math.max(1, lv)), mana = LV(def.mana, Math.max(1, lv));
      meta = `Перезарядка ${cd} с · <span class="mana">Мана ${mana}</span>`;
    }
    const stats = (def.stats || []).map(([label, vals, suf]) => {
      const parts = vals.map((v, k) => `<b class="${vals.length > 1 && k === lv - 1 ? 'cur' : ''}">${v}${suf || ''}</b>`);
      return `<div>${label}: ${parts.join(' / ')}</div>`;
    }).join('');
    let foot = '';
    if (h.canLevel(i)) foot = `<div class="tt-foot">Shift+${ABILITY_KEYS[i]} или «+» — изучить</div>`;
    else if (def.ult && lv < def.maxLv) foot = `<div class="tt-foot">Следующий уровень с ${6 * (lv + 1)} уровня героя</div>`;
    return `<div class="tt-title">${def.name}<span class="tt-key">${ABILITY_KEYS[i]}</span></div>` +
      `<div class="tt-meta">Уровень ${lv}/${def.maxLv} · ${meta}</div><p>${def.desc}</p><div class="tt-stats">${stats}</div>${foot}`;
  }
  showAbilityTip(i, el) {
    if (!this.g || !this.g.player) return;
    this.showTip(this.abilityTip(this.g.player, i), el);
  }

  // ---------- предметы ----------
  buildItems() {
    const wrap = $('items');
    wrap.innerHTML = '';
    this.slotEls = [];
    for (let i = 0; i < 6; i++) {
      const el = document.createElement('div');
      el.className = 'slot';
      el.innerHTML = `<canvas></canvas><div class="cd"></div><span class="cdt"></span><span class="key">${i + 1}</span><span class="ch"></span>`;
      el.addEventListener('click', () => { if (this.input) this.input.activateItem(i); });
      el.addEventListener('contextmenu', e => {
        e.preventDefault();
        this.trySell(i);
      });
      el.addEventListener('pointerenter', e => { if (e.pointerType === 'mouse') this.showItemTip(i, el); });
      el.addEventListener('pointerleave', () => this.hideTip());
      wrap.appendChild(el);
      this.slotEls.push({ el, cv: el.querySelector('canvas'), cd: el.querySelector('.cd'), cdt: el.querySelector('.cdt'), ch: el.querySelector('.ch'), id: null });
    }
  }
  trySell(i) {
    const h = this.g && this.g.player;
    if (!h || !h.items[i]) return;
    if (!h.inShop()) { this.toast('Продавать можно только на базе'); return; }
    const name = ITEMS[h.items[i].id].name;
    if (ITEMS[h.items[i].id].noSell) { this.toast('Этот предмет нельзя продать'); return; }
    if (h.sellItem(i)) { Sfx.play('buy'); this.toast('Продано: ' + name, true); this.hideTip(); }
  }
  itemTip(id, h, slot) {
    const def = ITEMS[id];
    let foot = '';
    if (slot !== undefined && h) {
      const it = h.items[slot];
      const back = Math.floor(def.cost * (def.consumable ? it.charges : 1) * 0.5);
      const left = it.id === 'aegis' && h.aegisUntil ? ` Осталось ${fmtTime(h.aegisUntil - h.game.time)}.` : '';
      foot = def.noSell ? `<div class="tt-foot">Нельзя продать.${left}</div>` :
        `<div class="tt-foot">${def.active ? 'Клик или ' + (slot + 1) + ' — применить. ' : ''}ПКМ на базе — продать за ${back}</div>`;
    }
    return `<div class="tt-title">${def.name}<span class="tt-key">${fmtNum(def.cost)}</span></div><p>${def.desc}</p>${foot}`;
  }
  showItemTip(i, el) {
    const h = this.g && this.g.player;
    if (!h || !h.items[i]) return;
    this.showTip(this.itemTip(h.items[i].id, h, i), el);
  }

  // ---------- подсказка ----------
  showTip(html, el) {
    const tip = $('tooltip');
    tip.innerHTML = html;
    tip.hidden = false;
    const r = el.getBoundingClientRect();
    const tw = tip.offsetWidth, th = tip.offsetHeight;
    let x = r.left + r.width / 2 - tw / 2;
    let y = r.top - th - 12;
    x = clamp(x, 8, window.innerWidth - tw - 8);
    if (y < 8) y = r.bottom + 10;
    tip.style.left = x + 'px';
    tip.style.top = y + 'px';
    this.tipEl = el;
  }
  hideTip() {
    $('tooltip').hidden = true;
    this.tipEl = null;
  }

  // ---------- лавка ----------
  buildShop() {
    const list = $('shop-list');
    list.innerHTML = '';
    this.shopEls = {};
    for (const cat of SHOP_CATEGORIES) {
      const sec = document.createElement('div');
      sec.className = 'shop-cat';
      sec.innerHTML = `<h3>${cat.name}</h3><div class="shop-grid"></div>`;
      const grid = sec.querySelector('.shop-grid');
      for (const id of cat.items) {
        const def = ITEMS[id];
        const b = document.createElement('button');
        b.type = 'button';
        b.className = 'shop-item';
        b.title = def.name;
        b.innerHTML = `<canvas></canvas><span>${fmtNum(def.cost)}</span>`;
        copyCanvas(b.querySelector('canvas'), Icons.item(def, 84));
        b.addEventListener('click', () => { this.shopSel = id; this.renderShop(); });
        b.addEventListener('dblclick', () => this.buy(id));
        b.addEventListener('contextmenu', e => { e.preventDefault(); this.buy(id); });
        grid.appendChild(b);
        this.shopEls[id] = b;
      }
      list.appendChild(sec);
    }
  }
  buy(id) {
    const h = this.g && this.g.player;
    if (!h) return;
    const inShop = h.inShop();
    const why = h.buyItem(id);
    if (why) { this.toast(why); Sfx.play('error'); return; }
    Sfx.play('buy');
    this.toast(inShop ? 'Куплено: ' + ITEMS[id].name : 'Курьер доставит через ' + COURIER_TIME + ' с', true);
    this.renderShop();
  }
  renderShop() {
    const h = this.g && this.g.player;
    const gold = h ? h.gold : 0;
    for (const id in this.shopEls) {
      const b = this.shopEls[id];
      b.classList.toggle('poor', gold < ITEMS[id].cost);
      b.classList.toggle('sel', id === this.shopSel);
    }
    const def = ITEMS[this.shopSel];
    const d = $('shop-detail');
    if (!def) { d.innerHTML = ''; return; }
    const why = h ? h.canBuy(this.shopSel) : '';
    d.innerHTML = `<h4>${def.name}</h4><p>${def.desc}</p><div class="row"><button class="buy" type="button" ${why ? 'disabled' : ''}>Купить</button>` +
      `<span class="price">${fmtNum(def.cost)} золота</span></div>${why ? `<div class="shop-hint">${why}</div>` : '<div class="shop-hint">Двойной клик или ПКМ по предмету — быстрая покупка</div>'}`;
    d.querySelector('.buy').addEventListener('click', () => this.buy(this.shopSel));
  }
  toggleShop(force) {
    const el = $('shop');
    const show = force === undefined ? el.hidden : force;
    el.hidden = !show;
    if (show) this.renderShop();
  }
  get shopOpen() { return !$('shop').hidden; }

  // ---------- таблица счёта ----------
  toggleScore(force) {
    const el = $('scoreboard');
    const show = force === undefined ? el.hidden : force;
    el.hidden = !show;
    if (show) this.renderScore(el);
  }
  scoreTable(g, highlight) {
    let html = '';
    for (const team of [RADIANT, DIRE]) {
      html += `<div class="sb-team t${team}"><h3>${TEAM_NAME[team]} · ${g.kills[team]}</h3><table class="sb"><thead><tr>` +
        '<th>Герой</th><th>Ур.</th><th>У/С/П</th><th>Добито</th><th>Ценность</th><th>Предметы</th></tr></thead><tbody>';
      for (const h of g.heroes) {
        if (h.team !== team) continue;
        const items = h.items.filter(Boolean).map(it => `<canvas data-item="${it.id}" width="44" height="44"></canvas>`).join('');
        const status = h.alive ? '' : ` <span class="dead">${Math.ceil(h.respawnT)} с</span>`;
        html += `<tr class="${h === highlight ? 'me' : ''}"><td><span class="sb-hero"><canvas data-hero="${h.def.id}" width="48" height="48"></canvas>${escapeHtml(h.def.name)}${h.isPlayer ? ' (вы)' : ''}${status}</span></td>` +
          `<td>${h.level}</td><td>${h.kills}/${h.deaths}/${h.assists}</td><td>${h.lastHits}</td><td>${fmtNum(h.netWorth)}</td><td><span class="sb-items">${items}</span></td></tr>`;
      }
      html += '</tbody></table></div>';
    }
    return html;
  }
  paintScoreCanvases(root) {
    for (const cv of root.querySelectorAll('canvas[data-item]')) cv.getContext('2d').drawImage(Icons.item(ITEMS[cv.dataset.item], 44), 0, 0);
    for (const cv of root.querySelectorAll('canvas[data-hero]')) cv.getContext('2d').drawImage(Icons.hero(HERO_BY_ID[cv.dataset.hero], 48), 0, 0);
  }
  renderScore(el) {
    if (!this.g) return;
    el.innerHTML = this.scoreTable(this.g, this.g.player);
    this.paintScoreCanvases(el);
  }

  // ---------- события ----------
  onEvent(type, d) {
    const g = this.g;
    if (type === 'kill') {
      const k = d.killer, v = d.victim;
      const kName = k ? (k.kind === 'hero' ? k.name : k.kind === 'tower' ? 'Башня' : k.kind === 'fountain' ? 'Фонтан' : k.team === NEUTRAL ? 'Нейтралы' : 'Крипы') : 'Неизвестно';
      const kTeam = k ? k.team : 1 - v.team;
      this.feed(`<b class="t${kTeam}">${escapeHtml(kName)}</b><i>убивает</i><b class="t${v.team}">${escapeHtml(v.name)}</b>`);
      if (v === g.player) this.queueAnnounce('Вы погибли', '#ff6a5a');
      else if (k === g.player) Sfx.play('coin');
    } else if (type === 'announce') {
      this.queueAnnounce(d.text, d.color);
    } else if (type === 'tower') {
      this.feed(`<b class="t${d.team}">${TEAM_NAME[d.team]}</b><i>разрушает</i><b class="t${d.tower.team}">${escapeHtml(d.tower.name)}</b>`);
    } else if (type === 'levelup') {
      this.queueAnnounce('Уровень ' + d.level, '#ffd86b');
    } else if (type === 'delivered') {
      this.toast('Курьер доставил: ' + ITEMS[d].name, true);
    }
  }
  feed(html) {
    const kf = $('killfeed');
    const el = document.createElement('div');
    el.className = 'kf';
    el.innerHTML = html;
    kf.prepend(el);
    while (kf.children.length > 5) kf.lastChild.remove();
    setTimeout(() => el.classList.add('fade'), 7000);
    setTimeout(() => el.remove(), 7700);
  }
  queueAnnounce(text, color) {
    this.announceQ.push({ text, color });
    if (this.announceQ.length > 3) this.announceQ.shift();
  }
  toast(msg, ok) {
    const t = $('toast');
    t.textContent = msg;
    t.className = 'show' + (ok ? ' ok' : '');
    this.toastT = 1.8;
  }

  // ---------- кадр ----------
  update(dt) {
    const g = this.g;
    if (!g) return;
    const h = g.player;
    if (this.toastT > 0) { this.toastT -= dt; if (this.toastT <= 0) $('toast').className = ''; }
    this.announceT -= dt;
    if (this.announceT <= 0) {
      const an = $('announce');
      if (this.announceQ.length) {
        const a = this.announceQ.shift();
        an.textContent = a.text;
        an.style.color = a.color || '';
        an.className = 'show';
        this.announceT = 2.4;
      } else if (an.className) {
        an.className = '';
      }
    }
    this.updateAbilities(h);
    this.updateItems(h);
    this.textT -= dt;
    if (this.textT <= 0) {
      this.textT = 0.12;
      this.updateText(h);
    }
    if (!$('scoreboard').hidden) {
      this.sbT -= dt;
      if (this.sbT <= 0) { this.sbT = 1; this.renderScore($('scoreboard')); }
    }
  }

  updateText(h) {
    const g = this.g, s = h.s;
    $('score-r').textContent = g.kills[RADIANT];
    $('score-d').textContent = g.kills[DIRE];
    $('clock').textContent = fmtTime(g.time);
    $('clock-sub').textContent = g.time < 0 ? 'до горна' : 'волна через ' + Math.max(0, Math.ceil(g.nextWave - g.time));
    $('lvl').textContent = h.level;
    const cur = XP_TABLE[h.level - 1], next = XP_TABLE[h.level];
    $('xpbar').firstChild.style.width = (h.level >= MAX_LEVEL ? 100 : clamp((h.xp - cur) / (next - cur) * 100, 0, 100)) + '%';
    const hp = $('bar-hp'), mp = $('bar-mp');
    hp.children[0].style.width = clamp(h.hp / s.maxHp * 100, 0, 100) + '%';
    hp.children[1].textContent = `${Math.ceil(h.hp)} / ${Math.round(s.maxHp)}`;
    hp.children[2].textContent = '+' + s.hpRegen.toFixed(1);
    mp.children[0].style.width = clamp(h.mana / (s.maxMana || 1) * 100, 0, 100) + '%';
    mp.children[1].textContent = `${Math.floor(h.mana)} / ${Math.round(s.maxMana)}`;
    mp.children[2].textContent = '+' + s.manaRegen.toFixed(1);
    $('st-dmg').textContent = Math.round(s.damage - s.dmgVar) + '–' + Math.round(s.damage + s.dmgVar);
    $('st-arm').textContent = s.armor.toFixed(1);
    $('st-as').textContent = (1 / s.interval).toFixed(2);
    $('st-ms').textContent = Math.round(s.speed || (h.def.speed));
    $('gold').textContent = fmtNum(h.gold);
    const sp = $('skill-hint');
    sp.hidden = h.skillPoints <= 0 || !h.abilities.some((a, i) => h.canLevel(i));
    $('skill-pts').textContent = h.skillPoints;
    const rs = $('respawn');
    rs.hidden = h.alive || g.winner >= 0;
    if (!h.alive) $('respawn-t').textContent = Math.max(1, Math.ceil(h.respawnT));
    const cr = $('courier');
    if (h.deliveries.length) {
      cr.hidden = false;
      const t = Math.max(0, Math.ceil(Math.min(...h.deliveries.map(d => d.t))));
      cr.innerHTML = t > 0 ? `Курьер в пути: <b>${t} с</b>` : 'Курьер ждёт свободный слот';
    } else cr.hidden = true;
    if (this.shopOpen) {
      $('shop-gold').textContent = fmtNum(h.gold);
      const st = $('shop-status');
      if (h.inShop()) { st.textContent = 'Вы на базе: покупки сразу попадают в инвентарь.'; st.className = ''; }
      else { st.textContent = 'Вы вне базы: курьер доставит покупку за ' + COURIER_TIME + ' с.'; st.className = 'courier'; }
      const key = Math.floor(h.gold) + ':' + h.items.map(i => i ? i.id + i.charges : '-').join(',') + h.deliveries.length + h.inShop();
      if (key !== this.shopKey) { this.shopKey = key; this.renderShop(); }
    }
    if (this.tipEl && this.tipEl.classList.contains('ab')) {
      const i = this.abilityEls.findIndex(a => a.el === this.tipEl);
      if (i >= 0) $('tooltip').innerHTML = this.abilityTip(h, i);
    }
  }

  updateAbilities(h) {
    const tg = this.input && this.input.targeting;
    h.abilities.forEach((ab, i) => {
      const e = this.abilityEls[i];
      if (!e) return;
      const def = ab.def;
      const passive = def.type === 'passive';
      const maxCd = ab.lv ? LV(def.cd, ab.lv) : 0;
      const cdPct = ab.cd > 0 && maxCd ? ab.cd / maxCd : 0;
      e.cd.style.height = (cdPct * 100).toFixed(1) + '%';
      const cdText = ab.cd > 0 ? (ab.cd < 1 ? ab.cd.toFixed(1) : String(Math.ceil(ab.cd))) : '';
      if (e.cdt.textContent !== cdText) e.cdt.textContent = cdText;
      const manaText = passive || !ab.lv ? '' : String(LV(def.mana, ab.lv));
      if (e.mana.textContent !== manaText) e.mana.textContent = manaText;
      const nomana = !passive && ab.lv > 0 && h.mana < LV(def.mana, ab.lv);
      const canUp = h.canLevel(i);
      const cls = ['ab'];
      if (ab.lv === 0) cls.push('unlearned');
      if (passive) cls.push('passive');
      if (nomana) cls.push('nomana');
      if (tg && tg.source === 'ability' && tg.slot === i) cls.push('active');
      if (!passive && ab.lv && ab.cd <= 0 && !nomana) cls.push('ready');
      if (h.s.silenced && !passive) cls.push('blocked');
      const state = cls.join(' ') + '|' + canUp + '|' + ab.lv;
      if (state !== e.state) {
        e.state = state;
        e.el.className = cls.join(' ');
        e.up.hidden = !canUp;
        e.pips.forEach((p, k) => p.classList.toggle('on', k < ab.lv));
      }
    });
  }

  updateItems(h) {
    for (let i = 0; i < 6; i++) {
      const e = this.slotEls[i];
      const it = h.items[i];
      const id = it ? it.id : null;
      if (id !== e.id) {
        e.id = id;
        const c = e.cv.getContext('2d');
        e.cv.width = e.cv.height = 92;
        c.clearRect(0, 0, 92, 92);
        if (id) c.drawImage(Icons.item(ITEMS[id], 92), 0, 0);
        e.el.classList.toggle('full', !!id);
      }
      const ch = it && ITEMS[it.id].consumable ? String(it.charges) : '';
      if (e.ch.textContent !== ch) e.ch.textContent = ch;
      const act = it && ITEMS[it.id].active ? ITEM_ACTIVES[ITEMS[it.id].active] : null;
      const maxCd = act ? act.cd : 0;
      const pct = it && it.cd > 0 && maxCd ? it.cd / maxCd : 0;
      e.cd.style.height = (pct * 100).toFixed(1) + '%';
      const t = it && it.cd > 1 ? String(Math.ceil(it.cd)) : '';
      if (e.cdt.textContent !== t) e.cdt.textContent = t;
    }
  }

  showEnd(g) {
    const win = g.spectator ? true : g.winner === g.playerTeam;
    const title = $('end-title');
    title.textContent = g.spectator ? 'Победа: ' + TEAM_NAME[g.winner] : win ? 'Победа' : 'Поражение';
    title.className = win ? 'win' : 'lose';
    $('end-sub').textContent = `${TEAM_NAME[g.winner]} разрушает Древнего за ${fmtTime(g.time)}. Счёт ${g.kills[0]} : ${g.kills[1]}.`;
    const tbl = $('end-table');
    tbl.innerHTML = this.scoreTable(g, g.player);
    this.paintScoreCanvases(tbl);
    $('end').hidden = false;
    Sfx.play(win ? 'victory' : 'defeat');
  }
}
