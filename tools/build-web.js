// Собирает игру в один HTML-файл: стили, шрифты (data:), иконка и скрипты внутри.
// Такой файл можно скачать и открыть двойным щелчком на ПК — интернет не нужен.
//   node tools/build-web.js [выходной.html]          — полный документ (по умолчанию zheleznaya-korona.html)
//   node tools/build-web.js out.html --fragment       — без <html>/<head>, для публикации страницей
'use strict';
const fs = require('fs'), path = require('path');
const root = path.resolve(__dirname, '..') + '/';
const args = process.argv.slice(2);
const out = path.resolve(args.find(a => !a.startsWith('--')) || 'zheleznaya-korona.html');
const fragment = args.includes('--fragment');

const html = fs.readFileSync(root + 'index.html', 'utf8');
const body = html.split('<!-- @@BODY_START@@ -->')[1].split('<!-- @@BODY_END@@ -->')[0];
const inlined = body.replace(/<script src="(js\/[^"]+)"><\/script>/g, (m, f) => {
  const js = fs.readFileSync(root + f, 'utf8');
  if (/<\/script/i.test(js)) throw new Error('в ' + f + ' встречается </script>');
  return '<script>\n' + js + '\n</script>';
});
let fonts = fs.readFileSync(root + 'fonts/fonts.css', 'utf8');
fonts = fonts.replace(/url\((?:\.\.\/fonts\/|\.\/)?([^)'"]+\.woff2)\)/g, (m, f) => 'url(data:font/woff2;base64,' + fs.readFileSync(root + 'fonts/' + f).toString('base64') + ')');
const css = fs.readFileSync(root + 'css/game.css', 'utf8');
const icon = 'data:image/png;base64,' + fs.readFileSync(root + 'icon.png').toString('base64');
const style = '<style>\n' + fonts + '\n' + css + '\n</style>\n';
// иконка в разметке (заставка, подсказки) тоже ссылается на icon.png
const page = inlined.replace(/src="icon\.png"/g, `src="${icon}"`).trim();

let doc;
if (fragment) doc = '<title>Железная корона</title>\n' + style + page + '\n';
else {
  doc = '<!doctype html>\n<html lang="ru">\n<head>\n<meta charset="utf-8">\n' +
    '<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no, viewport-fit=cover">\n' +
    '<meta name="theme-color" content="#2a1d11">\n<title>Железная корона</title>\n' +
    `<link rel="icon" href="${icon}">\n` + style + '</head>\n<body>\n' + page + '\n</body>\n</html>\n';
}
if (/url\((?!data:)[^)]*\.woff2/.test(doc)) throw new Error('шрифт остался внешней ссылкой');
fs.writeFileSync(out, doc);
console.log('собрано', out, Math.round(fs.statSync(out).size / 1024) + ' КБ');
