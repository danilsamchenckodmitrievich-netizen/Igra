// Полководцы в симуляции: node tools/herostat.js <минут> <seed> [size] [difficulty] — партия без браузера и итоги по полководцам.
// PLAYER_AI=1 — игроком тоже правит ИИ (и ему нанимают полководцев).
const load = require('./load');
process.env.EXPORTS = 'Game, AI, unitPower, menCount, Heroes';
const X = load();
const minutes = +(process.argv[2] || 20), seed = +(process.argv[3] || 777), size = process.argv[4] || 'medium', diff = process.argv[5] || 'normal';
const g = new X.Game({ seed, size, rivals: 4, difficulty: diff, kingdom: 0 });
if (process.env.PLAYER_AI) g.player.ai = { nextThink: 0, target: null };
const log = [];
g.on((t, d) => { if (t === 'event' && /олководец|плен|уровень|разведч|Разведч/.test(d.text)) log.push((g.time / 60).toFixed(1) + 'м ' + d.text); });
const t0 = Date.now();
while (g.time < minutes * 60 && g.winner === null) {
  g.update(0.1);
  if (process.env.PLAYER_AI) { const pl = g.player; pl.ai.nextThink -= 0.1; if (pl.ai.nextThink <= 0 && pl.alive) { pl.ai.nextThink = 4; X.AI.think(g, pl); } }
}
console.log('время', ((Date.now() - t0) / 1000).toFixed(1), 'с; итоги:', JSON.stringify(X.Heroes.summary(g)));
for (const h of g.hr.list) console.log(' ', g.kingdom(h.owner).name.padEnd(22), h.name.padEnd(22), 'ур', h.level, 'оп', Math.round(h.xp), 'навыки', h.skills.join(','), h.status, h.army != null ? 'армия ' + h.army : 'резерв', 'побед', h.wins, 'боёв', h.battles);
console.log(log.slice(0, 40).join('\n'));
