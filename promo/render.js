// Записывает рекламный ролик: открывает игру в Chromium, ведёт её покадрово через promo/director.js
// и передаёт кадры в ffmpeg. Музыку под события ролика делает promo/music.py.
//
//   node promo/render.js                    — весь ролик в promo/out/video.mp4 и события в promo/out/events.json
//   node promo/render.js --stills 1,5,9     — только кадры на этих секундах (PNG в promo/out/)
//   node promo/render.js --seed 20240       — другой мир
'use strict';
const fs = require('fs'), path = require('path'), { spawn } = require('child_process');
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }

const args = process.argv.slice(2);
const opt = (name, def) => { const i = args.indexOf('--' + name); return i >= 0 ? args[i + 1] : def; };
const ROOT = path.resolve(__dirname, '..');
const OUT = path.join(__dirname, 'out');
const SEED = +opt('seed', 31377);
const stills = opt('stills', null);
fs.mkdirSync(OUT, { recursive: true });

// Ровное время и повторяемая случайность: кадры зависят только от номера кадра.
const INIT = `(() => {
  const q = [];
  window.requestAnimationFrame = cb => { q.push(cb); return q.length; };
  window.cancelAnimationFrame = () => {};
  window.__tick = ms => { const cbs = q.splice(0); for (const cb of cbs) cb(ms); };
  let s = 0x9e3779b9;
  Math.random = () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  try { localStorage.clear(); localStorage.setItem('kc.tutorial', '1'); } catch (e) {}
})();`;

(async () => {
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: 540, height: 960 }, deviceScaleFactor: 2, hasTouch: true, isMobile: true });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  await page.addInitScript(INIT);
  await page.goto('file://' + path.join(ROOT, 'index.html'));
  await page.waitForFunction(() => typeof App !== 'undefined' && App.renderer && App.game);
  await page.evaluate(() => document.fonts.ready);
  await page.addStyleTag({ path: path.join(__dirname, 'overlay.css') });
  await page.addScriptTag({ path: path.join(__dirname, 'director.js') });
  const info = await page.evaluate(seed => Promo.setup(seed), SEED);
  console.log('мир', JSON.stringify(info));
  await page.waitForTimeout(300);
  const total = await page.evaluate(() => Promo.frames);
  const FPS = await page.evaluate(() => Promo.FPS);

  const want = stills ? new Set(stills.split(',').map(s => Math.round(+s * FPS))) : null;
  const last = want ? Math.max(...want) : total - 1;
  let ff = null;
  if (!want) {
    ff = spawn('ffmpeg', ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS), '-c:v', 'mjpeg', '-i', '-',
      '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', path.join(OUT, 'video.mp4')], { stdio: ['pipe', 'inherit', 'inherit'] });
  }
  const t0 = Date.now();
  const log = [];
  for (let i = 0; i <= last; i++) {
    const r = await page.evaluate(n => Promo.frame(n), i);
    if (i % 30 === 0) log.push(`${(i / FPS).toFixed(1)}s ${r.scene} бои:${r.battles}`);
    if (want) {
      if (want.has(i)) await page.screenshot({ path: path.join(OUT, `still-${(i / FPS).toFixed(1)}.png`) });
      continue;
    }
    const buf = await page.screenshot({ type: 'jpeg', quality: 94 });
    if (!ff.stdin.write(buf)) await new Promise(res => ff.stdin.once('drain', res));
    if (i % 90 === 0) process.stdout.write(`кадр ${i}/${total} (${((Date.now() - t0) / 1000).toFixed(0)} с)\n`);
  }
  if (process.env.DEBUG) console.log(JSON.stringify(await page.evaluate(() => Promo.debug())));
  const events = await page.evaluate(() => Promo.events);
  fs.writeFileSync(path.join(OUT, 'events.json'), JSON.stringify({ fps: FPS, duration: total / FPS, events }, null, 1));
  console.log(log.join('\n'));
  await browser.close();
  if (ff) { ff.stdin.end(); await new Promise(res => ff.on('close', res)); }
  console.log(errors.length ? 'ошибки:\n' + errors.join('\n') : 'без ошибок');
})();
