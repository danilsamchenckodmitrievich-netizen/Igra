// Сценарий в браузере: меню → новая игра → город → стройка → найм → приказ армии → промотка → отдаление.
// VW, VH — размер окна; TOUCH=1 — телефон; PRE — приставка имён снимков; снимки в tools/out/.
let chromium;
try { ({ chromium } = require('playwright')); } catch (e) { ({ chromium } = require('/opt/node22/lib/node_modules/playwright')); }
const OUT = require('path').join(__dirname, 'out');
require('fs').mkdirSync(OUT, { recursive: true });
(async () => {
  const vw = +(process.env.VW || 1280), vh = +(process.env.VH || 800), touch = !!process.env.TOUCH;
  const pre = process.env.PRE || 'd';
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ viewport: { width: vw, height: vh }, hasTouch: touch, isMobile: touch, deviceScaleFactor: touch ? 2 : 1 });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push('pageerror: ' + e.message + '\n' + (e.stack || '').split('\n').slice(0, 4).join('\n')));
  page.on('console', m => { if (m.type() === 'error' || m.type() === 'warning') errors.push('console: ' + m.text()); });
  await page.goto('file://' + require('path').resolve(__dirname, '..', 'index.html'));
  await page.waitForTimeout(2500);
  // в вертикальном положении телефона сначала просят повернуть экран
  if (await page.evaluate(() => !document.getElementById('rotate').hidden)) await page.click('#rotate-ok');
  await page.screenshot({ path: require('path').join(OUT, `${pre}1-menu.png`) });
  await page.click('#new-btn');
  await page.waitForTimeout(300);
  await page.screenshot({ path: require('path').join(OUT, `${pre}2-new.png`) });
  await page.click('#start-btn');
  await page.waitForTimeout(1500);
  await page.screenshot({ path: require('path').join(OUT, `${pre}3-start.png`) });
  // открыть столицу
  const cap = await page.evaluate(() => { const g = App.game, c = g.city(g.player.capital); const p = App.renderer.toScreen(c.x + 0.5, c.y + 0.5); return p; });
  if (touch) await page.touchscreen.tap(cap.x, cap.y); else await page.mouse.click(cap.x, cap.y);
  await page.waitForTimeout(500);
  await page.screenshot({ path: require('path').join(OUT, `${pre}4-city.png`) });
  // построить лесопилку
  const built = await page.evaluate(() => { const b = document.querySelector('[data-act="build"][data-id="lumber"]'); if (!b || b.disabled) return 'disabled'; b.click(); return App.game.city(App.game.player.capital).construction ? 'ok' : 'none'; });
  await page.evaluate(() => document.querySelector('[data-act="tab"][data-v="army"]').click());
  await page.waitForTimeout(300);
  await page.screenshot({ path: require('path').join(OUT, `${pre}5-army-tab.png`) });
  const rec = await page.evaluate(() => { const b = document.querySelector('[data-act="recruit"][data-id="spear"]'); if (!b || b.disabled) return 'disabled'; b.click(); return App.game.city(App.game.player.capital).queue.length; });
  // выбрать дружину и отправить к ближайшему вольному городу
  const info = await page.evaluate(() => {
    const g = App.game, pl = g.player; const a = g.armiesOf(pl.id)[0];
    let best = null, bd = 1e9; for (const c of g.cities) { if (c.owner !== -1) continue; const d = Math.hypot(c.x - a.x, c.y - a.y); if (d < bd) { bd = d; best = c; } }
    App.ui.select(null);
    const p = App.renderer.toScreen(a.x, a.y);
    return { ax: p.x, ay: p.y - App.renderer.armySize() * 0.55, target: best.id, tx: best.x + 0.5, ty: best.y + 0.5, d: bd };
  });
  await page.waitForTimeout(100);
  if (touch) await page.touchscreen.tap(info.ax, info.ay); else await page.mouse.click(info.ax, info.ay);
  await page.waitForTimeout(200);
  const selA = await page.evaluate(() => App.ui.sel);
  await page.evaluate(i => App.focus((i.tx + App.game.armies[0].x) / 2, (i.ty + App.game.armies[0].y) / 2), info);
  await page.waitForTimeout(150);
  const tp = await page.evaluate(i => App.renderer.toScreen(i.tx, i.ty), info);
  if (touch) await page.touchscreen.tap(tp.x, tp.y); else await page.mouse.click(tp.x, tp.y);
  await page.waitForTimeout(400);
  const ord = await page.evaluate(() => { const a = App.game.armiesOf(App.game.player.id)[0]; return a ? { state: a.state, dest: a.dest } : null; });
  await page.screenshot({ path: require('path').join(OUT, `${pre}6-order.png`) });
  // промотать время
  const st = await page.evaluate(() => { const g = App.game; for (let i = 0; i < 1800; i++) g.update(0.1); return { t: g.time, cities: g.citiesOf(g.player.id).length, armies: g.armies.length, res: g.player.res }; });
  await page.waitForTimeout(600);
  await page.screenshot({ path: require('path').join(OUT, `${pre}7-later.png`) });
  await page.evaluate(() => App.ui.select({ kind: 'kingdom' }));
  await page.waitForTimeout(300);
  await page.screenshot({ path: require('path').join(OUT, `${pre}8-kingdom.png`) });
  // зум наружу
  await page.evaluate(() => { App.renderer.cam.z = App.renderer.minZoom(); App.ui.select(null); });
  await page.waitForTimeout(500);
  await page.screenshot({ path: require('path').join(OUT, `${pre}9-zoomout.png`) });
  const perf = await page.evaluate(() => { const r = App.renderer; r.cam.z = 30; const t0 = performance.now(); for (let i = 0; i < 30; i++) r.render(1 / 60); return ((performance.now() - t0) / 30).toFixed(2); });
  console.log(JSON.stringify({ built, rec, selA, ord, st, perfMs: perf }));
  console.log(errors.length ? errors.slice(0, 15).join('\n') : 'no errors');
  await browser.close();
})();
