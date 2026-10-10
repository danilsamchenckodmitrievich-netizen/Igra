// Загружает модули игры в изолированный контекст Node (без браузера) для симуляций и проверок.
// EXPORTS='Game, AI' node … — какие глобальные имена вернуть.
'use strict';
const fs = require('fs'), path = require('path'), vm = require('vm');
// Без списка файлов берёт логику игры из index.html: все js/… до отметки @@LOGIC_END@@.
function logicFiles() {
  const html = fs.readFileSync(path.resolve(__dirname, '..', 'index.html'), 'utf8').split('@@LOGIC_END@@')[0];
  return [...html.matchAll(/<script src="js\/([^"]+)"><\/script>/g)].map(m => m[1]);
}
module.exports = function load(files) {
  if (!files) files = logicFiles();
  const dir = path.resolve(__dirname, '..', 'js') + '/';
  let src = files.map(f => fs.readFileSync(dir + f, 'utf8')).join('\n;\n');
  src += '\n;globalThis.__x = { ' + (process.env.EXPORTS || 'World, MAP_SIZES, T') + ' };';
  const ctx = { console, Math, Date, btoa: s => Buffer.from(s, 'binary').toString('base64'), atob: s => Buffer.from(s, 'base64').toString('binary') };
  vm.createContext(ctx);
  vm.runInContext(src, ctx, { filename: 'game.js' });
  return ctx.__x;
};
