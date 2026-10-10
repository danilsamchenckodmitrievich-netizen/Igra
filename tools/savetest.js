// Сохранение и загрузка: состояние после restore() совпадает, партия продолжается, инварианты держатся.
const load = require('./load');
process.env.EXPORTS = 'Game, AI, unitPower, menCount';
const X = load();
const g = new X.Game({ seed: 4242, size: 'medium', rivals: 4, difficulty: 'normal', kingdom: 2 });
const pl = g.player; pl.ai = { nextThink: 0, target: null };
for (let i = 0; i < 6000; i++) { g.update(0.1); pl.ai.nextThink -= 0.1; if (pl.ai.nextThink <= 0) { pl.ai.nextThink = 4; X.AI.think(g, pl); } }
const s1 = JSON.stringify(g.serialize());
console.log('save size KB', (s1.length / 1024).toFixed(1), 'armies', g.armies.length, 'battles', g.battles.length);
const g2 = new X.Game(JSON.parse(s1).opts, JSON.parse(s1));
const s2 = JSON.stringify(g2.serialize());
console.log('roundtrip identical:', s1 === s2);
// продолжаем обе партии с одинаковым ИИ игрока и сравниваем
pl.ai.nextThink = 0; g2.player.ai = { nextThink: 0, target: null };
let err = null;
try {
  for (let i = 0; i < 3000; i++) {
    g2.update(0.1);
    g2.player.ai.nextThink -= 0.1; if (g2.player.ai.nextThink <= 0) { g2.player.ai.nextThink = 4; X.AI.think(g2, g2.player); }
  }
} catch (e) { err = e.stack; }
console.log('continue after load:', err || 'ok', 'time', g2.time.toFixed(0), 'cities', g2.kingdoms.map(k => k.bandit ? '' : g2.citiesOf(k.id).length).join(','));
// инварианты
const bad = [];
for (const a of g2.armies) {
  if (a.state === 'battle' && !g2.battles.some(b => b.a === a.id || b.b === a.id)) bad.push('battle-without-btl ' + a.id);
  if (a.state === 'siege' && !g2.battles.some(b => b.kind === 'siege' && b.a === a.id)) bad.push('siege-without-btl ' + a.id);
  if (a.state === 'move' && !a.path) bad.push('move-without-path ' + a.id);
}
for (const c of g2.cities) if (c.siegeBy && !g2.army(c.siegeBy)) bad.push('dangling siegeBy ' + c.name);
for (const b of g2.battles) { if (!g2.army(b.a)) bad.push('btl missing a'); if (b.kind === 'field' && !g2.army(b.b)) bad.push('btl missing b'); }
console.log('invariants:', bad.length ? bad.join('; ') : 'ok');
