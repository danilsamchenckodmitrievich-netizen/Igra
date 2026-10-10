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
  heart: 'M12 21.2C6.8 17.6 2 13.8 2 8.7C2 5.6 4.4 3.3 7.3 3.3c2 0 3.6 1 4.7 2.6c1.1-1.6 2.7-2.6 4.7-2.6c2.9 0 5.3 2.3 5.3 5.4c0 5.1-4.8 8.9-10 12.5z',
  lock: 'M6.5 10.5V8a5.5 5.5 0 0 1 11 0v2.5h1.5v11H5v-11zM9.2 10.5h5.6V8a2.8 2.8 0 0 0-5.6 0z',
  up: 'M12 2.5l8 8.5h-5v10.5H9V11H4z',
  check: 'M9.4 15.6L4.9 11.1L2.8 13.2l6.6 6.6L21.2 8l-2.1-2.1z',
  plus: 'M10.4 3h3.2v7.4H21v3.2h-7.4V21h-3.2v-7.4H3v-3.2h7.4z',
  coin: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18zM12 6.5a5.5 5.5 0 1 1 0 11a5.5 5.5 0 1 1 0-11z',
  influence: 'M12 9a3 3 0 1 0 0 6a3 3 0 1 0 0-6zM12 1.5a10.5 10.5 0 1 0 0 21a10.5 10.5 0 1 0 0-21zM12 4a8 8 0 1 1 0 16a8 8 0 1 1 0-16zM11 .5h2v4h-2zM11 19.5h2v4h-2zM.5 11h4v2h-4zM19.5 11h4v2h-4z',
};

// Иллюстрации построек 48×48 для меню города: плоские заливки, мягкая светотень, чернильный контур.
// currentColor — цвет державы (флаги, кровли башен, навесы). Рисуются один раз в скрытом наборе <symbol>.
const ART_INK = '#2a1b0d';
const ART_SH = 'fill="#2a1b0d" fill-opacity=".17" stroke="none"';
const ART_HI = 'fill="#fff8e6" fill-opacity=".38" stroke="none"';
const ART_GROUND = '<ellipse cx="24" cy="40.5" rx="21.5" ry="5.6" fill="#b5bb73"/><path d="M8 43.6q16 4.2 32 0" fill="none" stroke="#8d9450" stroke-width=".9"/>';
// Деревянная жердь с чернильным контуром: сначала толстая тёмная линия, поверх — дерево.
const artPole = (d, w, col) => `<path d="${d}" fill="none" stroke="${ART_INK}" stroke-width="${w + 1.8}"/><path d="${d}" fill="none" stroke="${col || '#9a6a38'}" stroke-width="${w}"/>`;
const ART = {
  farm: ART_GROUND +
    '<rect x="7" y="23" width="21" height="16.5" fill="#efe2c0"/>' +
    '<path d="M7 31H28M12.5 23v16.5M22.5 23v16.5M7 23l5.5 8M28 23l-5.5 8" fill="none" stroke="#7a5230" stroke-width="1.2"/>' +
    `<rect x="22.5" y="23" width="5.5" height="16.5" ${ART_SH}/>` +
    '<path d="M14.5 39.5v-5.8q3-2.8 6 0v5.8z" fill="#7a5230"/>' +
    '<path d="M4 25.2L17.5 10.5L31 25.2q-13.5 2.6-27 0z" fill="#d9b05a"/>' +
    `<path d="M17.5 10.5L31 25.2q-6.8 1.3-13.5 1.6z" ${ART_SH}/>` +
    '<path d="M10 20.5l2.2 2.4M14.5 15.8l2.2 2.6M20 16.5l2.2 2.4M24.5 21l2.2 2.4M17.5 21.5l1.6 2.6" fill="none" stroke="#9c7a30" stroke-width="1"/>' +
    '<path d="M33 40l3.6-9.2l-3.6-8.6q5.3-4.4 10.6 0l-3.6 8.6l3.6 9.2z" fill="#e2b955"/>' +
    '<path d="M38.3 20.8V40M35.6 23.5l1.7 6.5M41 23.5l-1.7 6.5M35.5 39.2l1.8-6.6M41.1 39.2l-1.8-6.6" fill="none" stroke="#a9853a" stroke-width=".9"/>' +
    '<rect x="35.4" y="29.6" width="5.8" height="2.6" fill="#8a5a2e" stroke-width="1"/>' +
    `<path d="M33.2 23q2.5-2.2 5-2.6l-.4 3z" ${ART_HI}/>`,
  lumber: ART_GROUND +
    '<rect x="9.6" y="31" width="3" height="9" fill="#7a5230"/>' +
    '<path d="M11.1 14.5L20.5 32.5H1.7z" fill="#5d8a45"/><path d="M11.1 9L19 23.5H3.2z" fill="#5d8a45"/><path d="M11.1 3.5L16.8 14.5H5.4z" fill="#6c9a50"/>' +
    `<path d="M11.1 14.5L20.5 32.5H11.1zM11.1 9L19 23.5H11.1zM11.1 3.5L16.8 14.5H11.1z" ${ART_SH}/>` +
    '<circle cx="26.5" cy="35.5" r="5" fill="#a8743f"/><circle cx="36.8" cy="35.5" r="5" fill="#a8743f"/><circle cx="31.6" cy="26.8" r="5" fill="#a8743f"/>' +
    '<g fill="#ecd09a" stroke="none"><circle cx="26.5" cy="35.5" r="3.7"/><circle cx="36.8" cy="35.5" r="3.7"/><circle cx="31.6" cy="26.8" r="3.7"/></g>' +
    '<g fill="none" stroke="#c49a5c" stroke-width=".9"><circle cx="26.5" cy="35.5" r="2"/><circle cx="36.8" cy="35.5" r="2"/><circle cx="31.6" cy="26.8" r="2"/></g>' +
    artPole('M45 40.5L41.4 22.5', 1.8) +
    '<path d="M38.2 20.4l5.6-1.6l.9 5.6l-4.6.3z" fill="#a9b6bf"/>' +
    `<path d="M38.2 20.4l5.6-1.6l.3 1.8l-5.4 1.4z" ${ART_HI}/>`,
  quarry: '<ellipse cx="24" cy="40.5" rx="21.5" ry="5.6" fill="#cdbd92"/>' +
    '<path d="M3.5 40.5L5.5 24L12 15.5L20 13.5L26 9L33.5 12.5L40.5 19.5L44.5 40.5z" fill="#b2ab9c"/>' +
    `<path d="M26 9L33.5 12.5L40.5 19.5L44.5 40.5H33L30.5 22z" ${ART_SH}/>` +
    `<path d="M5.5 24L12 15.5L20 13.5L16.5 22.5z" ${ART_HI}/>` +
    '<path d="M13 26.5H31M10 32.5H33" fill="none" stroke="#7d776b" stroke-width="1.1"/>' +
    '<path d="M7 33.5h10.5v7H7z" fill="#e2dccb"/><path d="M7 33.5l3-3h10.5l-3 3z" fill="#f4f0e4"/><path d="M17.5 33.5l3-3v7l-3 3z" fill="#b9b3a6"/>' +
    artPole('M29.5 42L37.5 25.5', 1.8) +
    '<path d="M31 24.6q6.5-4.6 14.5.2q-7.2-2-14 2.5z" fill="#8a96a0"/>',
  mine: ART_GROUND +
    '<path d="M2.5 40.5Q5 19.5 24 15Q43 19.5 45.5 40.5z" fill="#a89070"/>' +
    `<path d="M24 15Q43 19.5 45.5 40.5H33Q34 25 24 15z" ${ART_SH}/>` +
    `<path d="M5 33Q8 21 20 16.5Q11 23 9 33z" ${ART_HI}/>` +
    '<path d="M6.5 35.5l2-2.4l2.6.8l.4 2.2zM38.5 27.5l1.6-1.8l2 .6l.2 1.8z" fill="#8f877a" stroke-width="1"/>' +
    '<path d="M16 40.5V28.5Q24 21 32 28.5v12z" fill="#2f2418"/>' +
    '<rect x="14" y="26" width="3" height="14.5" fill="#9a6a38"/><rect x="31" y="26" width="3" height="14.5" fill="#9a6a38"/>' +
    '<rect x="12.5" y="23.4" width="23" height="3.6" rx=".6" fill="#a8743f"/>' +
    '<path d="M20.5 40.5L18 45.5M27.5 40.5L30 45.5M18.8 43.5h10.4" fill="none" stroke="#5c534a" stroke-width="1.1"/>' +
    '<path d="M17 33.5h14l-2 6.5H19z" fill="#6f7d88"/>' +
    '<path d="M17.8 33.5q1-3.6 3.6-2.8q1.6-2.8 4.2-1q2.4-1.2 4.4 3.8z" fill="#8fa9c2" stroke-width="1"/>' +
    `<path d="M21.4 30.7q1.6-2.8 4.2-1l-.6 1.6z" ${ART_HI}/>` +
    '<circle cx="20.6" cy="41" r="1.9" fill="#3a3530"/><circle cx="27.4" cy="41" r="1.9" fill="#3a3530"/>',
  market: ART_GROUND +
    artPole('M9 18V40M39 18V40', 1.6) +
    '<rect x="6" y="29" width="36" height="11" fill="#b07a44"/>' +
    '<path d="M6 33.2H42M6 36.8H42" fill="none" stroke="#7a5230" stroke-width=".9"/>' +
    `<rect x="6" y="29" width="36" height="3" ${ART_SH}/>` +
    '<rect x="4.8" y="27.2" width="38.4" height="3" rx=".6" fill="#c99560"/>' +
    '<path d="M9.5 27.5q-1-5.5 2-6.4h4q3 .9 2 6.4z" fill="#dcc48e"/><path d="M11.5 21.1q2-2.2 4 0" fill="none" stroke-width="1"/>' +
    '<circle cx="22" cy="25.4" r="2" fill="#b5523b" stroke-width="1"/><circle cx="25.8" cy="25.4" r="2" fill="#a8463a" stroke-width="1"/><circle cx="23.9" cy="22.4" r="2" fill="#c0603f" stroke-width="1"/>' +
    '<g fill="#e8bf47" stroke-width="1"><ellipse cx="34" cy="26.4" rx="3.4" ry="1.3"/><ellipse cx="34" cy="24.6" rx="3.4" ry="1.3"/><ellipse cx="34" cy="22.8" rx="3.4" ry="1.3"/></g>' +
    '<path d="M4.5 18L8.5 8.5h31l4 9.5z" fill="#f2e5c4"/>' +
    '<path d="M8.5 8.5h5.2L11 18H4.5zM18.8 8.5H24V18h-6.5zM29.2 8.5h5.1l2.7 9.5h-6.5z" fill="currentColor" stroke="none"/>' +
    '<path d="M4.5 18L8.5 8.5h31l4 9.5z" fill="none"/>' +
    '<path d="M4.5 18a3.25 2.8 0 0 0 6.5 0z M17.5 18a3.25 2.8 0 0 0 6.5 0z M30.5 18a3.25 2.8 0 0 0 6.5 0z" fill="currentColor"/>' +
    '<path d="M11 18a3.25 2.8 0 0 0 6.5 0z M24 18a3.25 2.8 0 0 0 6.5 0z M37 18a3.25 2.8 0 0 0 6.5 0z" fill="#f2e5c4"/>' +
    `<path d="M8.5 8.5h31l1 2.4H7.5z" ${ART_HI}/>`,
  factory: ART_GROUND +
    '<path d="M2 41.5q4-2.6 8-1.2t8 0v3.6q-8 2.6-15.5-.4z" fill="#7ab3c8"/>' +
    '<rect x="16" y="21" width="26" height="19" fill="#e9dcc0"/>' +
    '<rect x="16" y="33.5" width="26" height="6.5" fill="#b9b3a6"/>' +
    '<path d="M21 33.5v6.5M28 33.5v6.5M35 33.5v6.5" fill="none" stroke="#8f897d" stroke-width=".8"/>' +
    `<rect x="34.5" y="21" width="7.5" height="19" ${ART_SH}/>` +
    '<rect x="35" y="8" width="4.2" height="9" fill="#a9a49a"/>' +
    '<path d="M13.5 22L29 11L44.5 22z" fill="#9a4630"/>' +
    `<path d="M29 11L44.5 22H29z" ${ART_SH}/>` +
    '<path d="M35.2 7.6a2.4 2.4 0 0 1 1.6-4.2a2.6 2.6 0 0 1 4.6-.6a2 2 0 0 1 2 3.4a2.2 2.2 0 0 1-3 1.6q-2.6 1.4-5.2-.2z" fill="#ece6d6" stroke="#6a5236" stroke-width=".9"/>' +
    '<path d="M25.5 40v-6q3-3 6 0v6z" fill="#7a5230"/>' +
    '<rect x="20" y="24.5" width="3.6" height="4.2" fill="#4a3826" stroke-width="1"/><rect x="35.8" y="24.5" width="3.6" height="4.2" fill="#4a3826" stroke-width="1"/>' +
    '<circle cx="11.5" cy="31" r="9.2" fill="#a8743f"/><circle cx="11.5" cy="31" r="6.4" fill="#c99560"/>' +
    '<path d="M11.5 21.8V40.2M2.3 31H20.7M5 24.5l13 13M18 24.5l-13 13" fill="none" stroke="#7a5230" stroke-width="1.1"/>' +
    '<circle cx="11.5" cy="31" r="2.1" fill="#7a5230"/>' +
    `<path d="M11.5 24.6a6.4 6.4 0 0 0-6 4.2l1.6.5a4.7 4.7 0 0 1 4.4-3z" ${ART_HI}/>`,
  barracks: ART_GROUND +
    '<rect x="4.5" y="24" width="30" height="15.8" fill="#dccaa2"/>' +
    '<path d="M4.5 31.5h30" fill="none" stroke="#8a5a2e" stroke-width="1.1"/>' +
    `<rect x="28" y="24" width="6.5" height="15.8" ${ART_SH}/>` +
    '<path d="M2 25.2L8.5 15h22l6.5 10.2z" fill="#9a4630"/>' +
    '<path d="M5.6 20.2h27.8" fill="none" stroke="#6e2f1f" stroke-width=".9"/>' +
    `<path d="M30.5 15L37 25.2h-6.5z" ${ART_SH}/>` +
    `<path d="M8.5 15h22l-1 1.8H7.4z" ${ART_HI}/>` +
    '<path d="M16 39.8V32.3q3.5-3.6 7 0v7.5z" fill="#6b4424"/>' +
    '<rect x="8" y="27" width="4" height="4" fill="#4a3826" stroke-width="1"/><rect x="26.5" y="27" width="4" height="4" fill="#4a3826" stroke-width="1"/>' +
    '<path d="M19.5 15V3.5" fill="none" stroke-width="1.3"/><path d="M19.5 3.8h8.5l-2.2 2.5l2.2 2.5h-8.5z" fill="currentColor"/>' +
    artPole('M38.5 40.5L40 17.5M42.5 40.5L44 18.5', 1.4) +
    '<path d="M40.3 12.5l1.6 5.4l-3.2-.3zM44.3 13.5l1.4 5.3l-3.1-.2z" fill="#a9b6bf" stroke-width="1"/>' +
    '<path d="M36.4 29.5h9.2v4.6q0 4.6-4.6 6.8q-4.6-2.2-4.6-6.8z" fill="currentColor"/>' +
    '<path d="M41 31v8M38 33.8h6" fill="none" stroke="#f2e5c4" stroke-width="1.3"/>',
  range: ART_GROUND +
    artPole('M22 30V41.5M15.5 31.5l-5 10M28.5 31.5l5 10', 1.6) +
    '<circle cx="22" cy="22.5" r="13" fill="#d9b05a"/>' +
    '<circle cx="22" cy="22.5" r="11.6" fill="none" stroke="#a9853a" stroke-width=".8" stroke-dasharray="1.4 1.8"/>' +
    '<circle cx="22" cy="22.5" r="9.6" fill="#f2ead0" stroke-width="1"/>' +
    '<circle cx="22" cy="22.5" r="6.8" fill="#b5523b" stroke-width="1"/>' +
    '<circle cx="22" cy="22.5" r="4.1" fill="#f2ead0" stroke-width="1"/>' +
    '<circle cx="22" cy="22.5" r="1.8" fill="#d7a944" stroke-width="1"/>' +
    `<path d="M13.5 15.5a12 12 0 0 1 9-5l.2 1.8a10.5 10.5 0 0 0-7.8 4.2z" ${ART_HI}/>` +
    '<path d="M23 21.5l10.5-7.2M19.5 25.5l7.5 7" fill="none" stroke="#7a5230" stroke-width="1.3"/>' +
    '<path d="M31.8 13.4l3.8-1.6l-.6 3.8zM26 33l2.2 3.4l1.4-3.8z" fill="#f2e5c4" stroke-width=".9"/>' +
    artPole('M38.5 8.5Q47.5 24.5 38.5 40.5', 1.8) +
    '<path d="M38.5 8.5V40.5" fill="none" stroke="#efe2c0" stroke-width=".8"/>',
  stable: ART_GROUND +
    '<rect x="5.5" y="22" width="27.5" height="17.8" fill="#b98a55"/>' +
    '<path d="M5.5 26.5H33M5.5 31H33M5.5 35.5H33" fill="none" stroke="#8a5a2e" stroke-width=".8"/>' +
    `<rect x="27" y="22" width="6" height="17.8" ${ART_SH}/>` +
    '<path d="M3 23L10.5 13h17.5L35.5 23z" fill="#6b4a34"/>' +
    `<path d="M28 13L35.5 23H28z" ${ART_SH}/>` +
    `<path d="M10.5 13h17.5l-1 1.8H9.2z" ${ART_HI}/>` +
    '<path d="M17 20.3v-2a2.3 2.3 0 0 1 4.6 0v2" fill="none" stroke="#2a1b0d" stroke-width="3"/><path d="M17 20.3v-2a2.3 2.3 0 0 1 4.6 0v2" fill="none" stroke="#c4ccd2" stroke-width="1.3"/>' +
    '<rect x="12.5" y="26" width="13" height="13.8" fill="#2f2418"/>' +
    '<rect x="12.5" y="32.3" width="13" height="7.5" fill="#8a5a2e"/>' +
    '<path d="M12.5 32.3l13 7.5M25.5 32.3l-13 7.5" fill="none" stroke="#5c3a1e" stroke-width="1"/>' +
    '<path d="M23.5 31.8q-.4-4.6-4.6-5.2q-3.6-.3-6.2 2.4l-3.4 3.2q-1.3 1.7.1 3.1q1.3.9 3 .2l4.2-2q3.1.6 4.7-.8z" fill="#8a5a2e"/>' +
    '<path d="M18.6 26.9l.8-3.4l1.6 3.6z" fill="#8a5a2e" stroke-width="1"/>' +
    '<path d="M23.1 29.4q-1-2.6-3.8-3" fill="none" stroke="#3a2616" stroke-width="1.8"/>' +
    '<path d="M10.6 33.2l3.6-3.3" fill="none" stroke="#f2e5c4" stroke-width="1.1"/>' +
    '<circle cx="15.8" cy="29.2" r=".85" fill="#2a1b0d" stroke="none"/>' +
    '<rect x="34" y="32" width="11.5" height="8" rx="1.6" fill="#e2b955"/>' +
    '<path d="M37.8 32v8M41.8 32v8" fill="none" stroke="#8a5a2e" stroke-width="1.1"/>' +
    '<path d="M35 34.5h2M39 36.5h2M43 35h1.6" fill="none" stroke="#b08a3a" stroke-width=".8"/>',
  workshop: ART_GROUND +
    '<circle cx="40.5" cy="38" r="3" fill="#b2ab9c" stroke-width="1"/><circle cx="44.5" cy="39.6" r="2.3" fill="#a39c8d" stroke-width="1"/><circle cx="42.6" cy="34.4" r="2.3" fill="#c0b9aa" stroke-width="1"/>' +
    '<rect x="4.5" y="31" width="30" height="4.2" fill="#8a5a2e"/>' +
    artPole('M14.5 31L20 21L25.5 31', 2.2) +
    artPole('M8 30.5L36 9.5', 2.4, '#b07a44') +
    '<circle cx="20" cy="21.2" r="1.9" fill="#7a5230"/>' +
    '<path d="M33.5 9q2.2 5 6.6.4z" fill="#7a5230"/>' +
    '<circle cx="36.9" cy="7.2" r="2.7" fill="#b2ab9c"/>' +
    '<circle cx="10" cy="37.6" r="4.3" fill="#a8743f"/><circle cx="29" cy="37.6" r="4.3" fill="#a8743f"/>' +
    '<path d="M10 33.3v8.6M5.7 37.6h8.6M29 33.3v8.6M24.7 37.6h8.6" fill="none" stroke="#7a5230" stroke-width="1"/>' +
    '<circle cx="10" cy="37.6" r="1.2" fill="#5c3a1e" stroke="none"/><circle cx="29" cy="37.6" r="1.2" fill="#5c3a1e" stroke="none"/>',
  level: ART_GROUND +
    '<rect x="4.5" y="28" width="11.5" height="11.8" fill="#e9dcc0"/>' +
    '<path d="M3 29.2L10.2 21L17.4 29.2z" fill="#9a4630"/>' +
    '<rect x="31.5" y="29" width="12" height="10.8" fill="#e9dcc0"/>' +
    '<path d="M30 30.2L37.5 22.5L45 30.2z" fill="#7a4a2a"/>' +
    '<rect x="7.4" y="32" width="2.8" height="3.2" fill="#4a3826" stroke-width=".9"/><rect x="38" y="33" width="2.8" height="3.2" fill="#4a3826" stroke-width=".9"/>' +
    '<rect x="17" y="16" width="14" height="23.8" fill="#c9c2b2"/>' +
    '<path d="M17 22h14M17 28h14M17 34h14M21.5 16v6M26 22v6M21 28v6" fill="none" stroke="#8f897d" stroke-width=".8"/>' +
    `<rect x="25.6" y="16" width="5.4" height="23.8" ${ART_SH}/>` +
    '<path d="M15 17.2L24 4.6L33 17.2z" fill="currentColor"/>' +
    `<path d="M24 4.6L33 17.2H24z" ${ART_SH}/>` +
    '<path d="M24 4.8V.9" fill="none" stroke-width="1.2"/><path d="M24 1l5.2 1.4L24 3.8z" fill="#f2e5c4" stroke-width="1"/>' +
    '<path d="M21 39.8v-5.6q3-3.2 6 0v5.6z" fill="#4a3220"/>' +
    '<rect x="22.6" y="23" width="2.8" height="4" fill="#3a2a1a" stroke-width=".9"/>',
  walls: ART_GROUND +
    '<rect x="2.5" y="22" width="43" height="17.8" fill="#c9c2b2"/>' +
    '<path d="M2.5 18h4.2v4H2.5zM9.6 18h4.2v4H9.6zM34.2 18h4.2v4h-4.2zM41.3 18h4.2v4h-4.2z" fill="#c9c2b2"/>' +
    '<path d="M2.5 28H17M31 28h14.5M2.5 34H17M31 34h14.5M8 22v6M12.5 28v6M7 34v5.8M36.5 22v6M40.5 28v6M37.5 34v5.8" fill="none" stroke="#8f897d" stroke-width=".8"/>' +
    `<rect x="2.5" y="35" width="43" height="4.8" ${ART_SH}/>` +
    '<rect x="16.5" y="14.5" width="15" height="25.3" fill="#d6cfbf"/>' +
    '<path d="M16.5 10.5h3.8v4h-3.8zM22.1 10.5h3.8v4h-3.8zM27.7 10.5h3.8v4h-3.8z" fill="#d6cfbf"/>' +
    `<rect x="27" y="14.5" width="4.5" height="25.3" ${ART_SH}/>` +
    '<path d="M19.4 39.8V29.6Q24 23.6 28.6 29.6v10.2z" fill="#6b4424"/>' +
    '<path d="M21.2 39.8V27.6M24 39.8V25.8M26.8 39.8V27.6M19.4 31.6h9.2M19.4 35.6h9.2" fill="none" stroke="#3a2616" stroke-width=".9"/>' +
    '<path d="M24 10.5V3.2" fill="none" stroke-width="1.2"/><path d="M24 3.4l6 1.6l-6 1.6z" fill="currentColor"/>',
  towers: ART_GROUND +
    '<rect x="2.5" y="27.5" width="13" height="12.3" fill="#bdb6a6"/><rect x="32.5" y="27.5" width="13" height="12.3" fill="#bdb6a6"/>' +
    '<path d="M2.5 24.5h3.6v3H2.5zM8.6 24.5h3.6v3H8.6zM35.8 24.5h3.6v3h-3.6zM41.9 24.5h3.6v3h-3.6z" fill="#bdb6a6"/>' +
    `<rect x="2.5" y="35.5" width="43" height="4.3" ${ART_SH}/>` +
    '<path d="M15 40V17h18v23q-9 1.8-18 0z" fill="#c9c2b2"/>' +
    '<path d="M15 23h18M15 29h18M15 35h18M20 17v6M26.5 23v6M19.5 29v6M27 35v5" fill="none" stroke="#8f897d" stroke-width=".8"/>' +
    `<path d="M27.6 17H33v23q-2.6.6-5.4.8z" ${ART_SH}/>` +
    '<rect x="13" y="13.6" width="22" height="4.2" fill="#b2ab9c"/>' +
    '<path d="M11.4 14.2L24 2.4L36.6 14.2z" fill="currentColor"/>' +
    `<path d="M24 2.4L36.6 14.2H24z" ${ART_SH}/>` +
    `<path d="M24 2.4L14.5 11.5l2 .3z" ${ART_HI}/>` +
    '<rect x="22.9" y="20.5" width="2.2" height="5.2" fill="#2f2418" stroke="none"/>' +
    '<path d="M21 40.6v-5.4q3-3.2 6 0v5.4z" fill="#6b4424"/>',
};
// Частокол: ряд заострённых брёвен разной высоты.
ART.palisade = ART_GROUND + (() => {
  let h = '';
  for (let i = 0; i < 9; i++) {
    const x = 3.2 + i * 4.6, top = 15.5 + ((i * 7) % 4) * 0.9;
    h += `<path d="M${x} 40V${top + 4.5}L${x + 2.3} ${top}L${x + 4.6} ${top + 4.5}V40z" fill="${i % 2 ? '#a8743f' : '#b98a55'}"/>`;
  }
  return h + '<rect x="2.5" y="24.5" width="43" height="2.6" fill="#7a5230"/><rect x="2.5" y="33" width="43" height="2.6" fill="#7a5230"/>' +
    `<rect x="2.5" y="35.6" width="43" height="4.4" ${ART_SH}/>`;
})();

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
  // Скрытый набор иллюстраций; вставляется в документ один раз, дальше на него ссылаются <use>.
  function artSprite() {
    let h = '<svg id="art-sprite" xmlns="http://www.w3.org/2000/svg" aria-hidden="true" style="position:absolute;width:0;height:0;overflow:hidden">';
    for (const name in ART) h += `<symbol id="art-${name}" viewBox="0 0 48 48"><g stroke="${ART_INK}" stroke-width="1.3" stroke-linejoin="round" stroke-linecap="round">${ART[name]}</g></symbol>`;
    return h + '</svg>';
  }
  // Иллюстрация постройки; color — цвет державы для флагов и кровель.
  function art(name, color, cls) {
    if (!ART[name]) return '';
    return `<svg class="art ${cls || ''}" viewBox="0 0 48 48" aria-hidden="true"${color ? ` style="color:${color}"` : ''}><use href="#art-${name}" xlink:href="#art-${name}"/></svg>`;
  }
  return { draw, svg, crest, path, art, artSprite };
})();
