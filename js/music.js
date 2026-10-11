'use strict';
// Фоновая музыка по обстановке: мир, тревога, битва/осада, тихая тема меню и короткие заставки.
// Всё синтезируется на WebAudio (без сэмплов), лады дорийский, эолийский и фригийский.
// Планировщик нот работает с упреждением по таймеру (не по кадрам): кадр музыку не замечает.
//
// API (для main.js и других частей):
//   Music.resume()                  — запуск после первого касания или клавиши (слушатели ставятся сами)
//   Music.update(g, dt, mode, paused) — каждый кадр: сама раз в 0.4 с выбирает настроение по App.game
//   Music.watch(g)                  — подписка на события партии (город взят или потерян — короткая заставка)
//   Music.stinger('win' | 'lose' | 'capture' | 'lost') — заставка поверх музыки
//   Music.enabled / Music.setEnabled(v, gesture?) — выключатель музыки (отдельно от Sfx; при Sfx.muted музыка тоже молчит)
//   Music.mood, Music.log           — текущее настроение и журнал смен [время, настроение]
//   Music.render(mood, seconds)     — проверка без динамиков: рендер в OfflineAudioContext → Promise<{rms, peak, win}>
//   Настроения: 'menu' (тихая тема), 'peace', 'alarm' (враг у границ или объявлена война), 'battle' (бой или осада).

const Music = (() => {
  const LOOK = 1.2, TICK = 180;       // упреждение планировщика (с) и период его таймера (мс)
  const MASTER = 0.15;                // общая громкость музыки: тише звуков Sfx (RMS мира ≈ 0.011, битвы ≈ 0.019)
  const MOODS = ['menu', 'peace', 'alarm', 'battle'];
  const BUS = { menu: 0.43, peace: 0.64, alarm: 0.76, battle: 0.65 };   // выравнивание громкости настроений
  const SEND = { menu: 0.55, peace: 0.4, alarm: 0.5, battle: 0.28 };   // доля эха
  const FADE = 0.85;                  // постоянная времени перехода: ≈2.5 с до 95%
  const HOLD = { battle: 12, alarm: 18 };   // сколько секунд настроение держится после исчезновения причины
  const NEAR = 5;                     // враг ближе стольких клеток к нашему городу — тревога
  const DOR = [0, 2, 3, 5, 7, 9, 10], AEO = [0, 2, 3, 5, 7, 8, 10], PHR = [0, 1, 3, 5, 7, 8, 10];
  const mtof = m => 440 * Math.pow(2, (m - 69) / 12);
  // ступень лада d (может быть отрицательной и больше 7) в ноту MIDI
  function deg(tonic, scale, d) { const o = Math.floor(d / 7); return tonic + scale[d - o * 7] + 12 * o; }
  const clip01 = v => v < 0 ? 0 : v > 1 ? 1 : v;

  function createEngine(ac) {
    const sr = ac.sampleRate;
    const master = ac.createGain(); master.gain.value = 0; master.connect(ac.destination);
    const mix = ac.createGain(); mix.connect(master);          // настроения (приглушаются под заставки)
    const stg = ac.createGain(); stg.connect(master);          // заставки
    // шум для дыхания флейты, ударов и тарелок
    const nbuf = ac.createBuffer(1, sr, sr), nd = nbuf.getChannelData(0);
    for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
    // эхо большого зала: затухающий шум
    const len = Math.floor(sr * 2.2), ir = ac.createBuffer(2, len, sr);
    for (let ch = 0; ch < 2; ch++) {
      const d = ir.getChannelData(ch);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 2.6) * (i < sr * 0.012 ? i / (sr * 0.012) : 1);
    }
    const rev = ac.createConvolver(); rev.buffer = ir;
    const revIn = ac.createGain(); revIn.gain.value = 0.8; revIn.connect(rev); rev.connect(mix);
    function bus(to, send) {
      const b = ac.createGain(); b.gain.value = 0; b.connect(to);
      const s = ac.createGain(); s.gain.value = send; b.connect(s); s.connect(revIn);
      return b;
    }
    const buses = {};
    for (const m of MOODS) buses[m] = bus(mix, SEND[m]);
    const sb = bus(stg, 0.45); sb.gain.value = 1;

    // ---------- инструменты (dst — шина, t — время старта, m — нота MIDI, v — громкость) ----------
    function conn(chain) { for (let i = 0; i + 1 < chain.length; i++) chain[i].connect(chain[i + 1]); }
    function lowpass(f, q) { const n = ac.createBiquadFilter(); n.type = 'lowpass'; n.frequency.value = f; n.Q.value = q || 0.7; return n; }
    function amp(param, t, a, peak, hold, rel) {
      param.setValueAtTime(0.0001, t);
      param.linearRampToValueAtTime(peak, t + a);
      param.setValueAtTime(peak, t + a + hold);
      param.exponentialRampToValueAtTime(0.0001, t + a + hold + rel);
    }
    function osc(type, f, t, t1, det) {
      const o = ac.createOscillator(); o.type = type; o.frequency.value = f; if (det) o.detune.value = det;
      o.start(t); o.stop(t1); return o;
    }
    function noiseSrc(t, t1) { const s = ac.createBufferSource(); s.buffer = nbuf; s.loop = true; s.start(t, Math.random() * 0.5); s.stop(t1); return s; }

    // лютня: щипок пилы с падающим фильтром
    function pluck(dst, t, m, v, dur) {
      const f = mtof(m), o = osc('sawtooth', f, t, t + dur + 0.05), o2 = osc('triangle', f * 2, t, t + dur + 0.05);
      const g2 = ac.createGain(); g2.gain.value = 0.35;
      const lp = lowpass(Math.min(f * 6, 4200), 0.9), g = ac.createGain();
      lp.frequency.setValueAtTime(Math.min(f * 6, 4200), t); lp.frequency.exponentialRampToValueAtTime(Math.max(f * 1.3, 260), t + 0.4);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.006); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(lp); o2.connect(g2); g2.connect(lp); conn([lp, g, dst]);
    }
    // флейта: синус с вибрато и дыханием
    function flute(dst, t, m, dur, v) {
      const f = mtof(m), t1 = t + dur + 0.4, o = osc('sine', f, t, t1), o2 = osc('triangle', f * 2, t, t1);
      const g2 = ac.createGain(); g2.gain.value = 0.12;
      const lfo = osc('sine', 5.1, t, t1), lg = ac.createGain();
      lg.gain.setValueAtTime(0, t); lg.gain.linearRampToValueAtTime(f * 0.007, t + Math.min(0.5, dur));
      lfo.connect(lg); lg.connect(o.frequency); lg.connect(o2.frequency);
      const g = ac.createGain(); amp(g.gain, t, 0.07, v, Math.max(0.05, dur - 0.1), 0.3);
      o.connect(g); o2.connect(g2); g2.connect(g); g.connect(dst);
      const n = noiseSrc(t, t1), bp = ac.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = f * 2; bp.Q.value = 2.5;
      const ng = ac.createGain(); amp(ng.gain, t, 0.05, v * 0.28, Math.max(0.05, dur - 0.1), 0.25);
      conn([n, bp, ng, dst]);
    }
    // струнные: две расстроенные пилы, медленная атака; trem — дрожание смычка
    function pad(dst, t, notes, dur, v, cut, trem) {
      const t1 = t + dur + 1.6;
      for (const m of notes) {
        const f = mtof(m), g = ac.createGain(), lp = lowpass(cut || 1000, 0.5);
        amp(g.gain, t, 1.3, v, Math.max(0.1, dur - 1.3), 1.5);
        osc('sawtooth', f, t, t1, -7).connect(lp); osc('sawtooth', f, t, t1, 7).connect(lp);
        conn([lp, g, dst]);
        if (trem) { const l = osc('sine', trem, t, t1), lg = ac.createGain(); lg.gain.value = v * 0.5; l.connect(lg); lg.connect(g.gain); }
      }
    }
    // бурдон: низкий гул с фильтром
    function drone(dst, t, m, dur, v) {
      const f = mtof(m), t1 = t + dur + 2.2, g = ac.createGain(), lp = lowpass(320, 0.6);
      amp(g.gain, t, 2, v, Math.max(0.1, dur - 2), 2);
      osc('sawtooth', f, t, t1, -5).connect(lp); osc('sawtooth', f, t, t1, 5).connect(lp); osc('sine', f, t, t1).connect(lp);
      conn([lp, g, dst]);
    }
    // барабан: синус с падением высоты и щелчком кожи
    function drum(dst, t, v, f0, f1, dec) {
      const o = osc('sine', f0, t, t + dec + 0.1), g = ac.createGain();
      o.frequency.setValueAtTime(f0, t); o.frequency.exponentialRampToValueAtTime(f1, t + dec * 0.7);
      g.gain.setValueAtTime(v, t); g.gain.exponentialRampToValueAtTime(0.0001, t + dec);
      o.connect(g); g.connect(dst);
      const n = noiseSrc(t, t + 0.06), bp = ac.createBiquadFilter(), ng = ac.createGain();
      bp.type = 'bandpass'; bp.frequency.value = Math.max(300, f0 * 4); bp.Q.value = 1;
      ng.gain.setValueAtTime(v * 0.5, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      conn([n, bp, ng, dst]);
    }
    function snare(dst, t, v) {
      const n = noiseSrc(t, t + 0.2), bp = ac.createBiquadFilter(), ng = ac.createGain();
      bp.type = 'bandpass'; bp.frequency.value = 2100; bp.Q.value = 0.7;
      ng.gain.setValueAtTime(v, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.16);
      conn([n, bp, ng, dst]);
      drum(dst, t, v * 0.5, 230, 150, 0.1);
    }
    function shaker(dst, t, v) {
      const n = noiseSrc(t, t + 0.08), hp = ac.createBiquadFilter(), ng = ac.createGain();
      hp.type = 'highpass'; hp.frequency.value = 5200;
      ng.gain.setValueAtTime(v, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 0.05);
      conn([n, hp, ng, dst]);
    }
    function crash(dst, t, v) {
      const n = noiseSrc(t, t + 1.8), hp = ac.createBiquadFilter(), ng = ac.createGain();
      hp.type = 'highpass'; hp.frequency.value = 3200;
      ng.gain.setValueAtTime(v, t); ng.gain.exponentialRampToValueAtTime(0.0001, t + 1.6);
      conn([n, hp, ng, dst]);
    }
    // медь: две пилы, фильтр раскрывается на атаке
    function brass(dst, t, m, dur, v) {
      const f = mtof(m), t1 = t + dur + 0.3, lp = lowpass(500, 1.2), g = ac.createGain();
      lp.frequency.setValueAtTime(450, t); lp.frequency.linearRampToValueAtTime(Math.min(f * 5, 2600), t + 0.09);
      lp.frequency.linearRampToValueAtTime(Math.min(f * 3, 1700), t + Math.max(0.2, dur));
      amp(g.gain, t, 0.045, v, Math.max(0.02, dur - 0.05), 0.2);
      osc('sawtooth', f, t, t1, -9).connect(lp); osc('sawtooth', f, t, t1, 9).connect(lp); osc('square', f, t, t1).connect(lp);
      conn([lp, g, dst]);
    }
    // дальний рог: мягкая медь с медленной атакой
    function horn(dst, t, m, dur, v) {
      const f = mtof(m), t1 = t + dur + 1, lp = lowpass(f * 2.6, 1), g = ac.createGain();
      amp(g.gain, t, 0.35, v, Math.max(0.05, dur - 0.35), 0.7);
      osc('sawtooth', f, t, t1, -6).connect(lp); osc('sawtooth', f, t, t1, 6).connect(lp); osc('square', f * 0.5, t, t1).connect(lp);
      conn([lp, g, dst]);
    }
    // низкий щипок: контрабас и виолончель
    function bass(dst, t, m, v, dur) {
      const f = mtof(m), o = osc('sawtooth', f, t, t + dur + 0.05), lp = lowpass(f * 5, 0.9), g = ac.createGain();
      lp.frequency.setValueAtTime(f * 5, t); lp.frequency.exponentialRampToValueAtTime(f * 1.5, t + dur);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(v, t + 0.012); g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      osc('sine', f, t, t + dur + 0.05).connect(lp);
      conn([o, lp, g, dst]);
    }

    // ---------- сочинение: каждая шкала отдаёт ноты по одной доле (beat) ----------
    // мир и меню: бурдон, струнные, лютня, флейта; конфиг задаёт лад, темп и густоту
    const FLUTE_RHY = [
      [[0, 2], [2, 1], [3, 1], [4, 3], [7, 1]], [[0, 3], [3, 1], [4, 2], [6, 2]], [[0, 1], [1, 1], [2, 2], [4, 4]],
      [[0, 4], [4, 2], [6, 1.5]], [[1, 1.5], [2.5, 1.5], [4, 4]], [[0, 2], [2, 2], [4, 2], [6, 2]], [[0, 1.5], [1.5, 0.5], [2, 2], [4, 3]],
    ];
    const LUTE_PAT = [[0, 2, 3, 2, 1, 2, 3, 2], [0, -1, 2, -1, 3, 2, 1, -1], [0, 1, 2, 3, 2, 1, 2, 1], [0, -1, 1, 2, -1, 2, 3, -1], [3, 2, 1, 2, 0, 2, 1, 2]];
    function peaceGen(cfg) {
      return {
        beat: 60 / cfg.bpm,
        play(s, bi, t, dst) {
          const beat = this.beat, bar = bi >> 2, b = bi & 3, sc = cfg.scale;
          if (!s.rnd) { s.rnd = mulberry32((Math.random() * 1e9) | 0); s.pi = -1; }
          const R = s.rnd;
          if (b === 0) {
            if (bar % 4 === 0) {
              let n = Math.floor(R() * cfg.progs.length);
              if (n === s.pi) n = (n + 1) % cfg.progs.length;
              s.pi = n; s.prog = cfg.progs[n];
              drone(dst, t, cfg.tonic - 24, beat * 16, cfg.drone);
              drone(dst, t, cfg.tonic - 17, beat * 16, cfg.drone * 0.5);
            }
            s.root = s.prog[bar % 4];
            const r = s.root;
            if (cfg.pad && bar % 2 === 0) pad(dst, t, [deg(cfg.tonic - 12, sc, r), deg(cfg.tonic - 12, sc, r + 4), deg(cfg.tonic, sc, r + 2)], beat * 8, cfg.pad, 1100);
            s.pat = LUTE_PAT[Math.floor(R() * LUTE_PAT.length)];
            // флейта: фраза на два такта, не каждый раз
            if (cfg.flute && bar % 2 === 0 && R() < cfg.flute && bar > 0) {
              const tm = FLUTE_RHY[Math.floor(R() * FLUTE_RHY.length)], notes = [];
              const next = s.prog[(bar + 1) % 4];
              const tones = rr => [rr, rr + 2, rr + 4].map(x => ((x % 7) + 7) % 7);
              let d = [2, 4, 5, 7, 9][Math.floor(R() * 5)];   // ступень от D5: диапазон 0…9
              for (let i = 0; i < tm.length; i++) {
                if (i > 0) { d += [-2, -1, -1, 1, 1, 2][Math.floor(R() * 6)]; if (d > 9) d -= 2; if (d < 0) d += 2; }
                if (i === tm.length - 1 || tm[i][0] === 0 || tm[i][0] === 4) {
                  const cr = tm[i][0] >= 4 ? next : r, ts = tones(cr);
                  for (let k = 0; k < 4; k++) { const dd = d + (k % 2 ? -((k + 1) >> 1) : (k >> 1)); if (ts.indexOf(((dd % 7) + 7) % 7) >= 0) { d = dd; break; } }
                }
                notes.push({ s: tm[i][0], d: tm[i][1], m: deg(cfg.tonic + 12, sc, d) });
              }
              s.phr = { at: bi, notes };
            }
          }
          // лютня: восьмые доли по рисунку такта
          const r = s.root, ct = [r, r + 2, r + 4, r + 7];
          for (let h = 0; h < 2; h++) {
            const k = s.pat[b * 2 + h];
            if (k < 0 || R() > cfg.lute) continue;
            pluck(dst, t + h * beat * 0.5 + (R() - 0.5) * 0.014, deg(cfg.tonic - 12, sc, ct[k]), (b === 0 && h === 0 ? 0.12 : 0.075) * (0.85 + R() * 0.3), beat * 1.9);
          }
          if (s.phr) {
            const rel = bi - s.phr.at;
            for (const n of s.phr.notes) if (n.s >= rel && n.s < rel + 1) flute(dst, t + (n.s - rel) * beat, n.m, n.d * beat * 0.92, 0.16);
            if (rel > 8) s.phr = null;
          }
        },
      };
    }
    const GEN = {
      peace: peaceGen({ tonic: 62, scale: DOR, bpm: 74, progs: [[0, 6, 3, 0], [0, 3, 6, 4], [0, 2, 6, 3], [0, 4, 3, 0]], drone: 0.06, pad: 0.03, lute: 0.92, flute: 0.75 }),
      menu: peaceGen({ tonic: 57, scale: AEO, bpm: 58, progs: [[0, 5, 2, 6], [0, 6, 5, 6], [0, 3, 5, 4]], drone: 0.05, pad: 0.026, lute: 0.7, flute: 0.5 }),
      // тревога: фригийский D, сердцебиение барабана, гудящий кластер струн, низкая остинато и дальний рог
      alarm: {
        beat: 60 / 92,
        play(s, bi, t, dst) {
          const beat = this.beat, bar = bi >> 2, b = bi & 3;
          if (!s.rnd) s.rnd = mulberry32((Math.random() * 1e9) | 0);
          const R = s.rnd;
          if (b === 0 && bar % 4 === 0) {
            drone(dst, t, 38, beat * 16, 0.07); drone(dst, t, 45, beat * 16, 0.035); drone(dst, t, 51, beat * 16, 0.02);
          }
          if (b === 0 && bar % 2 === 1) pad(dst, t, [74, 75, 81], beat * 8, 0.022, 1500, 5.5);
          if (b === 0) drum(dst, t, 0.55, 95, 48, 0.5);
          if (b === 2) drum(dst, t, 0.38, 95, 48, 0.45);
          if (b === 3) drum(dst, t + beat * 0.5, 0.2, 90, 50, 0.3);
          const pat = [0, 0, 2, 0, 0, 0, 1, 0];
          for (let h = 0; h < 2; h++) {
            const k = pat[b * 2 + h];
            bass(dst, t + h * beat * 0.5, deg(38, PHR, k), (b === 0 && h === 0 ? 0.2 : 0.12), beat * 0.45);
          }
          if (bar % 4 === 1 && b === 0) { horn(dst, t, 57, beat * 2.2, 0.1); horn(dst, t + beat * 2, 63, beat * 1, 0.09); horn(dst, t + beat * 3, 62, beat * 2.5, 0.1); }
          if (bar % 4 === 3 && b === 2) { flute(dst, t, 86, beat * 1.5, 0.05); flute(dst, t + beat * 1.5, 87, beat * 1.2, 0.05); }
        },
      },
      // битва: боевые барабаны, медь, быстрый бас; такт — шестнадцатые доли
      battle: {
        beat: 60 / 134,
        play(s, bi, t, dst) {
          const beat = this.beat, bar = bi >> 2, b = bi & 3, st = beat / 4;
          if (!s.rnd) { s.rnd = mulberry32((Math.random() * 1e9) | 0); s.pi = 0; }
          const R = s.rnd;
          if (b === 0 && bar % 4 === 0) s.pi = Math.floor(R() * 2);
          const prog = s.pi ? [[2, 0], [0, 1], [10, 1], [9, 1]] : [[2, 0], [10, 1], [0, 1], [9, 1]];
          const c = prog[bar % 4], root = 48 + c[0], third = root + (c[1] ? 4 : 3), fifth = root + 7;
          const fill = bar % 4 === 3;
          if (b === 0) {
            pad(dst, t, [root - 12, fifth - 12, third], beat * 4, 0.02, 1500);
            if (bar % 4 === 0 && bar > 0) crash(dst, t, 0.12);
          }
          for (let k = 0; k < 4; k++) {
            const step = b * 4 + k, tt = t + k * st;
            if ('x..x..x.x..x..x.'.charAt(step) === 'x') drum(dst, tt, step === 0 ? 0.8 : 0.6, 110, 52, 0.38);
            if (fill && step >= 12) snare(dst, tt, 0.18 + (step - 12) * 0.06);
            else if (step === 4 || step === 12) snare(dst, tt, 0.26);
            if (k % 2 === 0) shaker(dst, tt, 0.07);
          }
          // медь: галоп на восьмых, длинные ноты с аккордом
          const riff = bar % 2 ? [[0, 2], [2, 1], [3, 1], [4, 2], [6, 1], [7, 1]] : [[0, 1], [1, 1], [2, 2], [4, 1], [5, 1], [6, 2]];
          for (const e of riff) {
            if (e[0] >> 1 !== b) continue;
            const tt = t + (e[0] & 1) * beat * 0.5, long = e[1] > 1;
            const m = bar % 2 ? (e[0] === 3 ? fifth : e[0] === 7 ? root + 12 : root) : (e[0] === 2 ? fifth : e[0] === 6 ? root + 12 : root);
            brass(dst, tt, m, e[1] * beat * 0.5 * 0.9, long ? 0.13 : 0.1);
            if (long) { brass(dst, tt, third, e[1] * beat * 0.5 * 0.9, 0.05); brass(dst, tt, fifth, e[1] * beat * 0.5 * 0.9, 0.05); }
          }
          if (fill && b === 3) [root + 12, third + 12, fifth + 12, root + 24].forEach((m, i) => brass(dst, t + i * st, m, st * 1.6, 0.1));
          for (let h = 0; h < 2; h++) bass(dst, t + h * beat * 0.5, root - 12, h === 0 && b % 2 === 0 ? 0.22 : 0.14, beat * 0.4);
        },
      },
    };

    // ---------- заставки ----------
    const STING = {
      win(t) {   // победа: фанфара мажор D, литавры и звон лютни
        [62, 66, 69, 74].forEach((m, i) => brass(sb, t + i * 0.16, m, 0.18, 0.12));
        [62, 66, 69, 74].forEach((m, i) => brass(sb, t + 0.7, m + (i === 3 ? 0 : 0), 2.4, 0.07));
        brass(sb, t + 0.7, 78, 2.4, 0.08);
        for (let i = 0; i < 6; i++) drum(sb, t + i * 0.1, 0.25 + i * 0.07, 110, 60, 0.3);
        drum(sb, t + 0.7, 0.7, 100, 50, 0.7);
        [74, 78, 81, 86, 81, 78, 74, 78].forEach((m, i) => pluck(sb, t + 0.9 + i * 0.2, m, 0.08, 1.4));
        pad(sb, t + 0.6, [50, 57, 62, 66], 3, 0.04, 1500);
      },
      lose(t) {  // поражение: нисходящий минор, низкие струнные и глухой барабан
        [69, 65, 64, 62].forEach((m, i) => flute(sb, t + i * 0.95, m, 0.9, 0.11));
        pad(sb, t, [38, 45, 53], 4.5, 0.06, 700);
        pad(sb, t + 2.8, [38, 41, 45], 3, 0.05, 700);
        drum(sb, t + 3.8, 0.7, 80, 40, 1.2); drum(sb, t + 4.5, 0.5, 70, 38, 1.4);
      },
      capture(t) {   // город взят: короткая ликующая медь
        [62, 69, 74].forEach((m, i) => brass(sb, t + i * 0.2, m, i === 2 ? 1.4 : 0.2, 0.13));
        brass(sb, t + 0.4, 66, 1.4, 0.06); brass(sb, t + 0.4, 78, 1.4, 0.05);
        drum(sb, t, 0.5, 105, 55, 0.4); drum(sb, t + 0.2, 0.5, 105, 55, 0.4); drum(sb, t + 0.4, 0.8, 100, 50, 0.7);
        pluck(sb, t + 0.5, 74, 0.1, 1.2); pluck(sb, t + 0.7, 78, 0.08, 1.2); pluck(sb, t + 0.9, 81, 0.08, 1.2);
      },
      lost(t) {   // город потерян: два низких звука рога
        horn(sb, t, 50, 1.1, 0.14); horn(sb, t + 1.3, 48, 1.8, 0.14);
        drum(sb, t, 0.6, 85, 42, 0.9); drum(sb, t + 1.3, 0.5, 80, 40, 1.1);
        pad(sb, t, [38, 45, 50], 3, 0.04, 600);
      },
    };
    const DUCK = { win: 6, lose: 7, capture: 3.2, lost: 3.5 };

    // ---------- управление ----------
    const T = {}; for (const m of MOODS) T[m] = { on: false, nextT: 0, bi: 0 };
    function setMood(m, instant) {
      const now = ac.currentTime;
      for (const k of MOODS) {
        const on = k === m, b = buses[k], v = on ? BUS[k] : 0;
        if (on && !T[k].on) { T[k].on = true; T[k].nextT = now + 0.08; T[k].bi = 0; T[k].rnd = null; T[k].phr = null; }
        else if (!on) T[k].on = false;
        b.gain.cancelScheduledValues(now);
        if (instant) b.gain.setValueAtTime(v, now);
        else { b.gain.setValueAtTime(b.gain.value, now); b.gain.setTargetAtTime(v, now, FADE); }
      }
    }
    function pump(until) {
      const now = ac.currentTime;
      for (const k of MOODS) {
        const s = T[k]; if (!s.on) continue;
        const gen = GEN[k];
        if (s.nextT < now - 0.05) s.nextT = now + 0.05;
        for (let n = 0; s.nextT < until && n < 64; n++) { gen.play(s, s.bi, s.nextT, buses[k]); s.bi++; s.nextT += gen.beat; }
      }
    }
    function stinger(name) {
      const f = STING[name]; if (!f) return;
      const now = ac.currentTime, d = DUCK[name];
      mix.gain.cancelScheduledValues(now);
      mix.gain.setValueAtTime(mix.gain.value, now);
      mix.gain.setTargetAtTime(0.3, now, 0.15);
      mix.gain.setTargetAtTime(1, now + d, 0.9);
      f(now + 0.06);
    }
    return { ac, master, setMood, pump, stinger };
  }

  // ---------- состояние снаружи ----------
  let ctx = null, E = null, timer = 0, enabled = true, want = 'menu', cur = '', paused = false, acc = 0, vol = -1;
  const log = [];
  const seen = { 1: -1e9, 2: -1e9 };
  let wars = null;

  function effective() { return enabled && !(typeof Sfx !== 'undefined' && Sfx.muted); }
  function volume() {
    if (!E) return;
    const v = effective() ? MASTER * (paused ? 0.4 : 1) : 0;
    if (v === vol) return;
    vol = v;
    E.master.gain.setTargetAtTime(v, ctx.currentTime, 0.25);
  }
  function pump() { if (E && ctx.state === 'running') E.pump(ctx.currentTime + LOOK); }
  function apply() {
    if (!E || cur === want) return;
    cur = want;
    log.push([Math.round(performance.now()) / 1000, want]);
    if (log.length > 60) log.shift();
    E.setMood(want, false);
    pump();
  }
  function resume() {
    if (!E) {
      try {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (!AC) return false;
        ctx = new AC();
        E = createEngine(ctx);
      } catch (e) { E = null; ctx = null; return false; }
    }
    if (ctx.state === 'suspended' && effective()) ctx.resume().catch(() => {});
    if (!timer) timer = setInterval(pump, TICK);
    vol = -1; volume(); apply();
    return ctx.state === 'running';
  }

  // Обстановка: 2 — бой или осада с нашим участием, 1 — видимый враг на наших землях или у границ, 0 — мир.
  function danger(g) {
    const pl = g.player;
    if (!pl || !pl.alive) return 0;
    for (const b of g.battles) {
      const a = g.army(b.a);
      if (a && a.owner === pl.id) return 2;
      if (b.kind === 'siege') { const c = g.city(b.city); if (c && c.owner === pl.id) return 2; }
      else { const o = g.army(b.b); if (o && o.owner === pl.id) return 2; }
    }
    const mine = g.citiesOf(pl.id), w = g.world;
    let lvl = 0;
    for (const a of g.armies) {
      if (a.owner === pl.id || !g.isHostile(pl.id, a.owner)) continue;
      const x = Math.floor(a.x), y = Math.floor(a.y);
      if (x < 0 || y < 0 || x >= w.W || y >= w.H) continue;
      const i = y * w.W + x;
      if (!g.visible[i]) continue;
      const own = g.city(w.cityOf[i]);
      if (own && own.owner === pl.id) return 1;
      for (const c of mine) if (Math.abs(c.x - a.x) <= NEAR && Math.abs(c.y - a.y) <= NEAR) lvl = 1;
      if (lvl) return 1;
    }
    return 0;
  }
  // Новая война: если есть дипломатия и появился враг-держава, на полминуты — тревога.
  function warNews(g, now) {
    if (!Mods.get('diplomacy')) { wars = null; return; }
    const pl = g.player, cur2 = {};
    let fresh = false;
    for (const k of g.kingdoms) {
      if (k.bandit || !k.alive || k.id === pl.id || !g.isHostile(pl.id, k.id)) continue;
      cur2[k.id] = 1;
      if (wars && !wars[k.id]) fresh = true;
    }
    wars = cur2;
    if (fresh) seen[1] = now + 12;
  }
  function choose(g) {
    const now = performance.now() / 1000, d = danger(g);
    warNews(g, now);
    if (d >= 1) seen[1] = now;
    if (d >= 2) seen[2] = now;
    if (now - seen[2] < HOLD.battle) return 'battle';
    if (now - seen[1] < HOLD.alarm) return 'alarm';
    return 'peace';
  }
  function update(g, dt, mode, isPaused) {
    acc += dt;
    if (acc < 0.4) return;
    acc = 0;
    paused = !!isPaused;
    want = mode === 'game' && g && g.winner === null ? choose(g) : 'menu';
    if (mode !== 'game') wars = null;
    apply(); volume();
  }
  function watch(g) {
    wars = null; seen[1] = seen[2] = -1e9;
    g.on((type, d) => {
      if (type !== 'captured') return;
      if (d.to && d.to.isPlayer) stinger('capture');
      else if (d.from && d.from.isPlayer) stinger('lost');
    });
  }
  function stinger(name) {
    if (!E || ctx.state !== 'running' || !effective()) return;
    try { E.stinger(name); } catch (e) { /* музыка не обязательна */ }
  }
  function setEnabled(v, gesture) {
    enabled = !!v;
    if (!E) { if (enabled && gesture) resume(); return; }
    if (enabled && ctx.state === 'suspended') ctx.resume().catch(() => {});
    volume();
  }

  // Проверка без динамиков: рендер настроения в буфер и громкость по секундам.
  function render(mood, secs) {
    const OAC = window.OfflineAudioContext || window.webkitOfflineAudioContext, rate = 22050;
    const oc = new OAC(2, Math.ceil(secs * rate), rate), e = createEngine(oc);
    e.master.gain.value = MASTER;
    e.setMood(mood, true);
    e.pump(secs);
    return oc.startRendering().then(buf => {
      const d = buf.getChannelData(0), win = [];
      let sum = 0, peak = 0;
      for (let i = 0; i < d.length; i++) { const v = d[i]; sum += v * v; if (Math.abs(v) > peak) peak = Math.abs(v); }
      for (let w = 0; w < Math.floor(secs); w++) {
        let s2 = 0; for (let i = w * rate; i < (w + 1) * rate && i < d.length; i++) s2 += d[i] * d[i];
        win.push(+Math.sqrt(s2 / rate).toFixed(4));
      }
      return { rms: +Math.sqrt(sum / d.length).toFixed(4), peak: +peak.toFixed(3), win };
    });
  }

  if (typeof document !== 'undefined') {
    // музыка стартует только после первого касания, клика или клавиши
    const first = () => {
      if (!enabled && !E) return;
      if (resume()) { for (const ev of ['pointerdown', 'touchend', 'keydown', 'click']) document.removeEventListener(ev, first, true); }
    };
    for (const ev of ['pointerdown', 'touchend', 'keydown', 'click']) document.addEventListener(ev, first, true);
    document.addEventListener('visibilitychange', () => {
      if (!ctx) return;
      if (document.hidden) ctx.suspend().catch(() => {});
      else if (effective()) ctx.resume().catch(() => {});
    });
  }

  return {
    resume, update, watch, stinger, setEnabled, render, log,
    get enabled() { return enabled; },
    get mood() { return cur; },
    get running() { return !!ctx && ctx.state === 'running'; },
  };
})();
