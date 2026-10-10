// Прогон партии без браузера: node tools/sim.js <минут> <seed> [size] [difficulty]; PLAYER_AI=1 — игроком тоже правит ИИ.
const load = require('./load');
process.env.EXPORTS = 'Game, AI, unitPower, menCount, MAP_SIZES';
const X = load();
const minutes = +(process.argv[2] || 20), seed = +(process.argv[3] || 777), size = process.argv[4] || 'medium', diff = process.argv[5] || 'normal';
const g = new X.Game({ seed, size, rivals: 4, difficulty: diff, kingdom: 0 });
let caps = 0, battles = 0, sieges = 0, events = [], dip = {};
g.on((t, d) => {
  if (t === 'captured') { caps++; events.push(`${(g.time/60).toFixed(1)}m ${d.to.name} взяло ${d.city.name}${d.from ? ' у ' + d.from.name : ''}`); }
  if (t === 'battle') battles++;
  if (t === 'siege') sieges++;
  if (t === 'eliminated') events.push(`${(g.time/60).toFixed(1)}m ПАЛО: ${d.name}`);
  // дипломатия: войны, мир, союзы
  if (t === 'diplomacy' && ['war', 'peace', 'ally', 'unally'].includes(d.type)) {
    dip[d.type] = (dip[d.type] || 0) + 1;
    const n = id => g.kingdom(id).name;
    const what = { war: d.join ? 'вступает в войну с' : 'объявляет войну', peace: 'мир с', ally: 'союз с', unally: 'разрывает союз с' }[d.type];
    events.push(`${(g.time/60).toFixed(1)}m ${n(d.a)} ${what} ${n(d.b)}${d.terms && d.terms.kind !== 'white' ? ' (' + d.terms.kind + ')' : ''}`);
  }
});
if (process.env.PLAYER_AI) { const pl = g.player; pl.ai = { nextThink: 0, target: null }; }
const t0 = Date.now();
const total = minutes * 60;
let nextReport = 0;
while (g.time < total && g.winner === null) {
  g.update(0.1);
  if (process.env.PLAYER_AI) { const pl = g.player; pl.ai.nextThink -= 0.1; if (pl.ai.nextThink <= 0 && pl.alive) { pl.ai.nextThink = 4; X.AI.think(g, pl); } }
  if (g.time >= nextReport) {
    nextReport += 180;
    console.log(`--- ${(g.time / 60).toFixed(1)} мин (${g.dateText()}) армий ${g.armies.length} боёв ${g.battles.length}`);
    for (const k of g.kingdoms) {
      if (k.bandit) continue;
      const cs = g.citiesOf(k.id);
      const inc = g.income(k).total;
      const pw = X.AI.totalPower(g, k) | 0;
      console.log(`  ${k.isPlayer ? '*' : ' '}${k.name.padEnd(22)} гор ${String(cs.length).padStart(2)} нас ${cs.reduce((s, c) => s + c.pop, 0) | 0} сила ${pw} ` +
        `зол ${k.res.gold | 0}(${inc.gold | 0}) еда ${k.res.food | 0}(${inc.food | 0}) дер ${k.res.wood | 0}(${inc.wood | 0}) кам ${k.res.stone | 0}(${inc.stone | 0}) жел ${k.res.iron | 0}(${inc.iron | 0})${k.alive ? '' : ' [пало]'}`);
    }
  }
}
console.log(events.join('\n'));
console.log('gameover/winner', g.winner);
console.log('дипломатия:', JSON.stringify(dip), 'войн сейчас', g.dip ? g.dip.rels.filter(r => r.st === 'war').length : '-', 'союзов', g.dip ? g.dip.rels.filter(r => r.st === 'ally').length : '-');
console.log(`итог: ${(g.time / 60).toFixed(1)} мин, захватов ${caps}, осад ${sieges}, ${((Date.now() - t0) / 1000).toFixed(1)} с; победитель ${g.winner}`);
const neutral = g.cities.filter(c => c.owner === -1).length;
console.log('вольных городов осталось', neutral, 'из', g.cities.length);
