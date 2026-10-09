'use strict';
// Векторные иконки 24×24: одни и те же пути рисуются в DOM (SVG) и на холсте (Path2D).

const ICON_PATHS = {
  // ресурсы
  gold: 'M12 2.5a9.5 9.5 0 1 0 0 19a9.5 9.5 0 1 0 0-19zM12 5.5a6.5 6.5 0 1 1 0 13a6.5 6.5 0 1 1 0-13zM12 8l3 4l-3 4l-3-4z',
  food: 'M11 22h2V9h-2zM12 2l2.2 3.2L12 8.4L9.8 5.2zM7.5 6.5l2.6 2.4l-.6 3.6l-2.6-2.4zM16.5 6.5l-2.6 2.4l.6 3.6l2.6-2.4zM7.5 12l2.6 2.4l-.6 3.6l-2.6-2.4zM16.5 12l-2.6 2.4l.6 3.6l2.6-2.4z',
  wood: 'M2 8.5h14.5a4.5 4.5 0 0 1 0 9H2zM16.5 10.5a2.5 2.5 0 1 0 0 5a2.5 2.5 0 1 0 0-5zM4 11h8v1H4zM4 14h6v1H4z',
  stone: 'M2.5 19.5l2.5-8l5.5-5l6 2.5l4.5 6l-1.5 4.5zM8 13l3-3l3 1.5l-1 3z',
  iron: 'M2.5 18l3.2-7h12.6l3.2 7zM6.8 9.5L9 5.5h6l2.2 4z',
  // здания
  farm: 'M11 22h2V9h-2zM12 2l2.2 3.2L12 8.4L9.8 5.2zM7.5 6.5l2.6 2.4l-.6 3.6l-2.6-2.4zM16.5 6.5l-2.6 2.4l.6 3.6l2.6-2.4zM7.5 12l2.6 2.4l-.6 3.6l-2.6-2.4zM16.5 12l-2.6 2.4l.6 3.6l2.6-2.4z',
  lumber: 'M4.5 21.5L3 20l9.5-9.5l1.5 1.5zM11 4.5c4.5-1.5 9 2.5 8.5 7.5l-3.2-1.6l-2.7-2.7z',
  quarry: 'M3 9c5-5.5 13-5.5 18 0l-3.5-1.3h-4.2l-.6.8l-.6-.8H7.9zM11 8h2v14h-2z',
  mine: 'M2 8.5h20l-2.5 8.5h-15zM5 19.5a2 2 0 1 0 4 0a2 2 0 1 0-4 0zM15 19.5a2 2 0 1 0 4 0a2 2 0 1 0-4 0zM8 6l3-3l3 2l-1 2.5H8.5z',
  market: 'M2.5 10.5L5.5 4h13l3 6.5zM4.5 11.5h15v9h-15zM8 13.5h8v5H8z',
  factory: 'M2 21V11l5 3v-3l5 3v-3l5 3V4h3.5v17zM5 17h2v2H5zM10 17h2v2h-2zM15 17h2v2h-2z',
  barracks: 'M4.5 14.5a7.5 7.5 0 0 1 15 0V20h-4.5v-4.5h-6V20H4.5zM11 3h2v4h-2z',
  range: 'M6 2.5c9.5 2 9.5 17 0 19c5-4.5 5-14.5 0-19zM5.2 2.5h1v19h-1zM3.5 11.4h15v1.2h-15zM21 12l-3.5-2.4v4.8z',
  stable: 'M6 21.5l1.2-7.5l-3-2.2l4-7.8l3.2.8l4.4 3.4l3.4 4.6l-2 2.2l-3.2-2.2l-1 3.2l1.1 5.5zM10 7.5a1 1 0 1 0 0.01 0z',
  workshop: 'M2.5 18.5h19v2.5h-19zM5 18.5l3.2-6.5h2.2l-3.2 6.5zM8.2 12.8L19.5 4l1.3 1.4l-11.2 8.9zM17 3a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0z',
  walls: 'M2.5 21.5V9h3.2v3h3V9h3.6v3h3V9h3.6v3h2.6V9h.5v12.5zM10 21.5v-4a2 2 0 0 1 4 0v4z',
  towers: 'M7 21.5V9.5H5V3.5h3v2.2h2.2V3.5h3.6v2.2H16V3.5h3v6h-2v12zM10 21.5v-3.5a2 2 0 0 1 4 0v3.5zM11 10h2v3h-2z',
  level: 'M2 21.5V10h3v2.2h2V10h3V4.5h4V10h3v2.2h2V10h3v11.5zM10 21.5v-4a2 2 0 0 1 4 0v4zM11.2 1.5h1.6v3h-1.6zM12.8 1.5l3.2 1l-3.2 1z',
  // войска
  militia: 'M11 9.5h2V22h-2zM6.5 2.5h1.4v6c0 1.2.9 2 2 2h4.2c1.1 0 2-.8 2-2v-6h1.4v6c0 2-1.6 3.6-3.6 3.6h-3.8c-2 0-3.6-1.6-3.6-3.6zM11.3 2.5h1.4v8.5h-1.4z',
  scout: 'M1.5 12c3-5 7-7.5 10.5-7.5s7.5 2.5 10.5 7.5c-3 5-7 7.5-10.5 7.5S4.5 17 1.5 12zM12 7.5a4.5 4.5 0 1 0 0 9a4.5 4.5 0 1 0 0-9zM12 10a2 2 0 1 0 0 4a2 2 0 1 0 0-4z',
  spear: 'M11.2 8.5h1.6V22h-1.6zM12 1l3.2 7.5H8.8z',
  sword: 'M10.8 1.5h2.4V15h-2.4zM6.5 14.5h11v2.2h-11zM10.8 16.7h2.4v3.6h-2.4zM9.7 20.3h4.6v2.2H9.7z',
  archer: 'M6 2.5c9.5 2 9.5 17 0 19c5-4.5 5-14.5 0-19zM5.2 2.5h1v19h-1zM3.5 11.4h15v1.2h-15zM21 12l-3.5-2.4v4.8z',
  crossbow: 'M2.5 6c6 3.5 13 3.5 19 0v2.4c-6 3.5-13 3.5-19 0zM10.8 7.5h2.4v13h-2.4zM9 19.5h6v2.5H9zM11.2 1.5h1.6v6h-1.6z',
  cavalry: 'M6 21.5l1.2-7.5l-3-2.2l4-7.8l3.2.8l4.4 3.4l3.4 4.6l-2 2.2l-3.2-2.2l-1 3.2l1.1 5.5zM10 7.5a1 1 0 1 0 0.01 0z',
  knight: 'M5.5 21.5v-9a6.5 6.5 0 0 1 13 0v9zM7.5 12.5h9v2h-9zM11.2 16h1.6v4h-1.6zM12 1.5c3.5.8 5 3.5 3.5 6l-3.5-1.5z',
  ram: 'M1.5 9.5h16.5l4 2.5l-4 2.5H1.5zM3 16.5a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0zM12 16.5a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0zM4 7h1.5v2.5H4zM13 7h1.5v2.5H13z',
  catapult: 'M2.5 18.5h19v2.5h-19zM5 18.5l3.2-6.5h2.2l-3.2 6.5zM8.2 12.8L19.5 4l1.3 1.4l-11.2 8.9zM17 3a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0z',
  // гербы
  star: 'M12 1.5l3.1 6.7l7.3.8l-5.5 4.9l1.6 7.2L12 17.4l-6.5 3.7l1.6-7.2L1.6 9l7.3-.8z',
  tree: 'M12 1.5l7.5 9.5h-4.2l5.2 6.5h-17l5.2-6.5H4.5zM10.8 17.5h2.4v5h-2.4z',
  crown: 'M2.5 17.5l-1-11l5.2 4.3L12 3.5l5.3 7.3l5.2-4.3l-1 11zM2.5 18.8h19v2.7h-19z',
  cross: 'M9.8 1.5h4.4v6.3h6.3v4.4h-6.3v10.3H9.8V12.2H3.5V7.8h6.3z',
  tower: 'M7 21.5V9.5H5V3.5h3v2.2h2.2V3.5h3.6v2.2H16V3.5h3v6h-2v12zM10 21.5v-3.5a2 2 0 0 1 4 0v3.5z',
  skull: 'M12 2a8.5 8.5 0 0 0-8.5 8.5c0 3 1.2 5.2 3.3 6.5v4.5h10.4V17c2.1-1.3 3.3-3.5 3.3-6.5A8.5 8.5 0 0 0 12 2zM7.5 9.5a2.2 2.2 0 1 0 4.4 0a2.2 2.2 0 1 0-4.4 0zM12.1 9.5a2.2 2.2 0 1 0 4.4 0a2.2 2.2 0 1 0-4.4 0zM10.8 14h2.4l-1.2 2.2z',
  // интерфейс
  people: 'M4.5 7a3 3 0 1 0 6 0a3 3 0 1 0-6 0zM1.5 20.5c0-4.5 2.7-7 6-7s6 2.5 6 7zM14 8.5a2.5 2.5 0 1 0 5 0a2.5 2.5 0 1 0-5 0zM13.8 20.5c.3-2.7-.4-4.7-1.6-5.9c1-.7 2.3-1.1 4.3-1.1c3 0 5.5 2 5.5 7z',
  swords: 'M3.5 2.5h2.6L18.8 15.2l-2.6 2.6L3.5 5.1zM20.5 2.5h-2.6L5.2 15.2l2.6 2.6L20.5 5.1zM2.5 18.6l3-3l3 3l-3 3zM21.5 18.6l-3-3l-3 3l3 3z',
  shield: 'M12 1.5l8.5 3.2v6.3c0 5.3-3.7 9.6-8.5 11.5c-4.8-1.9-8.5-6.2-8.5-11.5V4.7z',
  hammer: 'M2.5 19.5l9.8-9.8l2 2l-9.8 9.8zM11.5 4.5l5.5-2l4.5 4.5l-2 5.5l-3-3l-1.8 1.8l-3-3l1.8-1.8z',
  hourglass: 'M5 2h14v2.5c0 3-2.5 5.5-4.5 7.5c2 2 4.5 4.5 4.5 7.5V22H5v-2.5c0-3 2.5-5.5 4.5-7.5C7.5 10 5 7.5 5 4.5zM8 19.5h8c0-1.5-2-3.5-4-5c-2 1.5-4 3.5-4 5z',
  morale: 'M4 21.5V2.5h1.8v1h11.7l-2.5 4.2l2.5 4.3H5.8v9.5z',
  close: 'M5.6 4.2L12 10.6l6.4-6.4l1.4 1.4L13.4 12l6.4 6.4l-1.4 1.4L12 13.4l-6.4 6.4l-1.4-1.4L10.6 12L4.2 5.6z',
  pause: 'M6 4h4v16H6zM14 4h4v16h-4z',
  play: 'M7 3.5l13 8.5l-13 8.5z',
  menu: 'M3 5h18v2.6H3zM3 10.7h18v2.6H3zM3 16.4h18V19H3z',
  scroll: 'M5 3.5h12a3 3 0 0 1 3 3V18a2.5 2.5 0 0 1-2.5 2.5H6.5A2.5 2.5 0 0 1 4 18V5.5a2 2 0 0 1 1-2zM7 7.5h9v1.5H7zM7 11h9v1.5H7zM7 14.5h6V16H7z',
  flag: 'M4 21.5V2.5h1.8v1h11.7l-2.5 4.2l2.5 4.3H5.8v9.5z',
  target: 'M12 2a10 10 0 1 0 0 20a10 10 0 1 0 0-20zM12 5a7 7 0 1 1 0 14a7 7 0 1 1 0-14zM12 8.5a3.5 3.5 0 1 0 0 7a3.5 3.5 0 1 0 0-7z',
};

const Icons = (() => {
  const cache = new Map();
  function path(name) {
    if (!ICON_PATHS[name]) return null;
    if (!cache.has(name)) cache.set(name, new Path2D(ICON_PATHS[name]));
    return cache.get(name);
  }
  // Иконка на холсте, центр в (x, y), размер s пикселей.
  function draw(ctx, name, x, y, s, color) {
    const p = path(name);
    if (!p) return;
    ctx.save();
    ctx.translate(x - s / 2, y - s / 2);
    ctx.scale(s / 24, s / 24);
    ctx.fillStyle = color;
    ctx.fill(p, 'evenodd');
    ctx.restore();
  }
  function svg(name, cls) {
    const d = ICON_PATHS[name];
    if (!d) return '';
    return `<svg class="ico ${cls || ''}" viewBox="0 0 24 24" aria-hidden="true"><path d="${d}" fill="currentColor" fill-rule="evenodd"/></svg>`;
  }
  // Щит с гербом державы (для интерфейса).
  function crest(k, size) {
    const s = size || 28;
    const sig = ICON_PATHS[k.sigil] || ICON_PATHS.star;
    return `<svg class="crest" width="${s}" height="${s}" viewBox="0 0 24 24" aria-hidden="true">` +
      `<path d="${ICON_PATHS.shield}" fill="${k.color}" stroke="#1a120a" stroke-width="1.2"/>` +
      `<g transform="translate(6.2 5.6) scale(0.48)"><path d="${sig}" fill="#f6ecd2" fill-rule="evenodd"/></g></svg>`;
  }
  return { draw, svg, crest, path };
})();
