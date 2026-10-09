'use strict';
// Синтезированные звуки (WebAudio): без файлов, работают и без сети.

const Sfx = (() => {
  let ac = null, master = null, noiseBuf = null, muted = false;
  const last = {};
  function init() {
    if (ac) return;
    try {
      ac = new (window.AudioContext || window.webkitAudioContext)();
      master = ac.createGain();
      master.gain.value = 0.3;
      master.connect(ac.destination);
      noiseBuf = ac.createBuffer(1, ac.sampleRate, ac.sampleRate);
      const d = noiseBuf.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    } catch (e) { ac = null; }
  }
  function resume() {
    init();
    if (ac && ac.state === 'suspended') ac.resume().catch(() => {});
  }
  function tone(f, dur, type, v, slide, delay) {
    const t0 = ac.currentTime + (delay || 0);
    const o = ac.createOscillator(), g = ac.createGain();
    o.type = type; o.frequency.setValueAtTime(f, t0);
    if (slide) o.frequency.exponentialRampToValueAtTime(slide, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(v, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g); g.connect(master);
    o.start(t0); o.stop(t0 + dur + 0.05);
  }
  function noise(dur, v, freq, q, delay) {
    const t0 = ac.currentTime + (delay || 0);
    const s = ac.createBufferSource(); s.buffer = noiseBuf;
    const f = ac.createBiquadFilter(); f.type = 'bandpass'; f.frequency.value = freq; f.Q.value = q;
    const g = ac.createGain();
    g.gain.setValueAtTime(v, t0); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    s.connect(f); f.connect(g); g.connect(master);
    s.start(t0); s.stop(t0 + dur + 0.05);
  }
  const defs = {
    click: () => tone(700, 0.05, 'triangle', 0.05),
    error: () => tone(160, 0.16, 'square', 0.05),
    build: () => { noise(0.05, 0.25, 1800, 2); noise(0.05, 0.25, 1600, 2, 0.16); noise(0.05, 0.25, 1700, 2, 0.32); },
    done: () => { tone(660, 0.18, 'triangle', 0.07); tone(880, 0.25, 'triangle', 0.06, null, 0.1); },
    recruit: () => { noise(0.08, 0.3, 140, 1); noise(0.08, 0.25, 140, 1, 0.14); tone(220, 0.15, 'triangle', 0.05, null, 0.05); },
    march: () => { noise(0.06, 0.18, 300, 1); noise(0.06, 0.18, 300, 1, 0.18); },
    horn: () => { tone(196, 0.7, 'sawtooth', 0.05); tone(294, 0.7, 'sawtooth', 0.035, null, 0.05); },
    clash: () => { noise(0.25, 0.3, 2500, 3); noise(0.2, 0.25, 3200, 4, 0.12); tone(1200, 0.12, 'square', 0.02, 600, 0.05); },
    coin: () => { tone(1320, 0.07, 'square', 0.03); tone(1760, 0.12, 'square', 0.03, null, 0.06); },
    alarm: () => { tone(440, 0.15, 'square', 0.04); tone(330, 0.2, 'square', 0.04, null, 0.18); },
    victory: () => [392, 523, 659, 784].forEach((f, i) => tone(f, 0.45, 'triangle', 0.08, null, i * 0.15)),
    defeat: () => [392, 330, 262, 196].forEach((f, i) => tone(f, 0.5, 'triangle', 0.07, null, i * 0.18)),
  };
  function play(name) {
    if (muted || !ac || ac.state !== 'running' || !defs[name]) return;
    const now = ac.currentTime;
    if (last[name] && now - last[name] < 0.08) return;
    last[name] = now;
    try { defs[name](); } catch (e) { /* звук не обязателен */ }
  }
  return { resume, play, get muted() { return muted; }, setMuted(v) { muted = !!v; } };
})();
