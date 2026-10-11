// Прогон партии с проливом, разрезающим материк (острова): ИИ должен построить порты, суда и перевезти войска.
//   node tools/navalsim.js [минут] [seed] [size] [difficulty]      STRAIT=h — горизонтальный пролив (по умолчанию вертикальный)
// Заодно проверяет сохранение посреди плавания (SAVE=0 — не проверять).
'use strict';
const load = require('./load');
process.env.EXPORTS = 'Game, AI, Naval, NAVAL, menCount, T';
const X = load();
const minutes = +(process.argv[2] || 20), seed = +(process.argv[3] || 777), size = process.argv[4] || 'medium', diff = process.argv[5] || 'normal';
const g = new X.Game({ seed, size, rivals: 4, difficulty: diff, kingdom: 0 });
const w = g.world;

// Пролив: полоса воды шириной 3 клетки там, где до городов дальше всего.
function carve(horizontal) {
  const L = horizontal ? w.H : w.W, M = horizontal ? w.W : w.H;
  let best = -1, bs = -1;
  for (let c = Math.floor(L * 0.3); c < Math.floor(L * 0.7); c++) {
    let near = Infinity, left = 0, right = 0;
    for (const q of g.cities) {
      const p = horizontal ? q.y : q.x;
      near = Math.min(near, Math.abs(p - c));
      if (p < c) left++; else right++;
    }
    const s = Math.min(left, right) * 10 + near;
    if (near >= 3 && s > bs) { bs = s; best = c; }
  }
  for (let m = 0; m < M; m++) for (let d = -2; d <= 2; d++) {
    const x = horizontal ? m : best + d, y = horizontal ? best + d : m;
    if (!w.inside(x, y)) continue;
    const i = w.idx(x, y);
    if (Math.abs(d) <= 1) { w.terrain[i] = X.T.DEEP; w.main[i] = 0; } else if (w.terrain[i] > X.T.SHALLOW) { w.terrain[i] = X.T.BEACH; }
    w.river[i] = 0; w.road[i] = 0;
  }
  for (const q of g.cities) q.side = (horizontal ? q.y : q.x) < best ? 0 : 1;
  X.Naval.reset(g);
  w.prepareInfluence();
  g.refreshTerritory(true);
  return best;
}
const cut = carve(process.env.STRAIT === 'h');
console.log('пролив на', cut, 'городов по берегам', g.cities.filter(c => c.side === 0).length, '/', g.cities.filter(c => c.side === 1).length);

const stat = { built: 0, embarked: 0, landed: 0, sunk: 0, caps: 0, crossCaps: 0 };
const log = [];
g.on((t, d) => {
  if (t === 'shipBuilt') { stat.built++; log.push(`${(g.time / 60).toFixed(1)}m построен ${d.ship.kind} в ${d.city.name}`); }
  if (t === 'embarked') { stat.embarked++; log.push(`${(g.time / 60).toFixed(1)}m посадка ${X.menCount(d.army.units)} воинов`); }
  if (t === 'landed') { stat.landed++; log.push(`${(g.time / 60).toFixed(1)}m высадка ${d.army.name}`); }
  if (t === 'shipSunk') { stat.sunk++; log.push(`${(g.time / 60).toFixed(1)}m потоплен ${d.ship.kind}${d.ship.cargo ? ' с армией' : ''}`); }
  if (t === 'captured') {
    stat.caps++;
    const cap = d.to.capital ? g.city(d.to.capital) : null;
    if (cap && cap.side !== d.city.side) { stat.crossCaps++; log.push(`${(g.time / 60).toFixed(1)}m ${d.to.name} взяло ${d.city.name} за проливом`); }
  }
});
const pl = g.player; pl.ai = { nextThink: 0, target: null };
const total = minutes * 60, t0 = Date.now();
let saved = false, nextReport = 0, maxMs = 0;
while (g.time < total && g.winner === null) {
  const s0 = Date.now();
  g.update(0.1);
  maxMs = Math.max(maxMs, Date.now() - s0);
  pl.ai.nextThink -= 0.1;
  if (pl.ai.nextThink <= 0 && pl.alive) { pl.ai.nextThink = 4; X.AI.think(g, pl); }
  if (g.time >= nextReport) {
    nextReport += 180;
    const N = g.naval;
    console.log(`--- ${(g.time / 60).toFixed(1)} мин: кораблей ${N.ships.length} (груз ${N.ships.filter(s => s.cargo).length}), заказов ${N.jobs.length}, портов ${g.cities.filter(c => c.buildings.port).length}, боёв ${g.battles.length}`);
  }
  // сохранение посреди плавания: груз и курс должны пережить загрузку
  if (!saved && process.env.SAVE !== '0' && g.naval.ships.some(s => s.cargo && s.st === 'sail')) {
    saved = true;
    const s1 = JSON.stringify(g.serialize());
    const g2 = new X.Game(JSON.parse(s1).opts, JSON.parse(s1));
    const s2 = JSON.stringify(g2.serialize());
    const sh = g.naval.ships.find(s => s.cargo);
    const sh2 = g2.naval.ships.find(s => s.id === sh.id);
    console.log('сохранение в плавании: roundtrip identical:', s1 === s2, 'груз', sh2 && sh2.cargo ? X.menCount(sh2.cargo.units) : 'ПОТЕРЯН', 'курс', !!(sh2 && sh2.path));
    for (let i = 0; i < 600; i++) g2.update(0.1);
    console.log('  после загрузки 60 с: ok, кораблей', g2.naval.ships.length, 'армий', g2.armies.length);
  }
}
{
  const bad = [];
  for (const sh of g.naval.ships) {
    if (sh.cargo && g.army(sh.cargo.id)) bad.push('cargo army also on map ' + sh.id);
    if (sh.dock && !g.city(sh.dock)) bad.push('dangling dock ' + sh.id);
    if (sh.job && !g.naval.jobs.some(j => j.id === sh.job)) bad.push('dangling job ' + sh.id);
  }
  for (const j of g.naval.jobs) if (!g.army(j.army) || !g.naval.ships.some(s => s.id === j.ship)) bad.push('stale job ' + j.id);
  console.log('инварианты флота:', bad.length ? bad.join('; ') : 'ok');
}
console.log(log.slice(0, 40).join('\n'));
console.log('итог:', JSON.stringify(stat), `${(g.time / 60).toFixed(1)} мин, ${((Date.now() - t0) / 1000).toFixed(1)} с, самый долгий шаг ${maxMs} мс`);
for (const k of g.kingdoms) if (!k.bandit) console.log(' ', k.name.padEnd(22), 'городов', g.citiesOf(k.id).length, 'кораблей', g.naval.ships.filter(s => s.owner === k.id).length, k.alive ? '' : '[пало]');
