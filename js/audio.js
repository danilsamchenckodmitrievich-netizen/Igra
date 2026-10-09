'use strict';
// Короткие синтезированные звуки через WebAudio.

const Sfx = (() => {
  let ac = null, master = null, noiseBuf = null;
  let muted = false;
  let vol = 1;
  const last = {};

  function init() {
    if (ac) return;
    try {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      master = ac.createGain();
      master.gain.value = 0.32;
      master.connect(ac.destination);
      noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) {
      ac = null;
    }
  }
  function resume() {
    init();
    if (ac && ac.state === 'suspended') ac.resume().catch(() => {});
  }

  function tone(freq, dur, type, v, slideTo, delay) {
    const t0 = ac.currentTime + (delay || 0);
    const o = ac.createOscillator();
    const g = ac.createGain();
    o.type = type;
    o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(Math.max(0.0002, v * vol), t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }
  function noise(dur, v, freq, q, delay) {
    const t0 = ac.currentTime + (delay || 0);
    const s = ac.createBufferSource();
    s.buffer = noiseBuf;
    const f = ac.createBiquadFilter();
    f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = ac.createGain();
    g.gain.setValueAtTime(Math.max(0.0002, v * vol), t0);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t0); s.stop(t0 + dur + 0.05);
  }

  const defs = {
    hit: () => noise(0.07, 0.22, 1600, 1.2),
    shoot: () => tone(880, 0.08, 'triangle', 0.06, 480),
    zap: () => { tone(1400, 0.18, 'sawtooth', 0.08, 180); noise(0.15, 0.14, 4200, 2); },
    swoosh: () => noise(0.28, 0.28, 800, 0.7),
    fire: () => { noise(0.3, 0.22, 650, 0.8); tone(240, 0.3, 'sawtooth', 0.05, 110); },
    boom: () => { noise(0.5, 0.45, 320, 0.7); tone(95, 0.4, 'sine', 0.3, 40); },
    bigboom: () => { noise(1.1, 0.65, 200, 0.6); tone(62, 0.9, 'sine', 0.42, 24); },
    ice: () => { tone(1900, 0.2, 'sine', 0.07, 2700); tone(2500, 0.25, 'sine', 0.05, 1600, 0.05); },
    stone: () => { noise(0.25, 0.3, 380, 1); tone(140, 0.2, 'square', 0.05, 90); },
    veil: () => tone(520, 0.45, 'sine', 0.08, 140),
    mark: () => tone(300, 0.35, 'sawtooth', 0.07, 620),
    holy: () => { tone(660, 0.45, 'sine', 0.07); tone(990, 0.5, 'sine', 0.05, null, 0.08); },
    potion: () => tone(420, 0.22, 'sine', 0.08, 820),
    tp: () => tone(300, 1.2, 'sine', 0.05, 900),
    blink: () => tone(1500, 0.15, 'sine', 0.08, 420),
    coin: () => { tone(1320, 0.07, 'square', 0.035); tone(1760, 0.12, 'square', 0.035, null, 0.06); },
    level: () => { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.2, 'triangle', 0.08, null, i * 0.07)); },
    death: () => tone(240, 0.7, 'sawtooth', 0.07, 70),
    collapse: () => { noise(1.3, 0.5, 240, 0.5); tone(70, 1.0, 'sine', 0.25, 30); },
    click: () => tone(760, 0.04, 'square', 0.03),
    error: () => tone(170, 0.14, 'square', 0.05),
    buy: () => { tone(990, 0.06, 'triangle', 0.06); tone(1480, 0.1, 'triangle', 0.06, null, 0.05); },
    horn: () => { tone(196, 1.6, 'sawtooth', 0.06); tone(294, 1.6, 'sawtooth', 0.04); },
    victory: () => { [392, 523, 659, 784].forEach((f, i) => tone(f, 0.5, 'triangle', 0.09, null, i * 0.16)); },
    defeat: () => { [392, 330, 262, 196].forEach((f, i) => tone(f, 0.6, 'triangle', 0.08, null, i * 0.2)); },
  };

  function play(name, v) {
    if (muted || !ac || ac.state !== 'running' || !defs[name]) return;
    const now = ac.currentTime;
    if (last[name] && now - last[name] < 0.06) return;
    last[name] = now;
    vol = v === undefined ? 1 : v;
    try { defs[name](); } catch (e) { /* звук не обязателен */ }
  }

  return {
    resume, play,
    get muted() { return muted; },
    toggle() { muted = !muted; return muted; },
  };
})();
