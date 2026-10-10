'use strict';
// Игровые данные «Железной короны»: ресурсы, местность, здания, войска, державы.

const SEASON_LEN = 60;             // секунд игрового времени на сезон
const START_YEAR = 1212;
const SEASONS = ['Весна', 'Лето', 'Осень', 'Зима'];
const GRACE_TIME = 240;            // первые 4 минуты ИИ не нападает на другие державы
const WIN_SHARE = 0.55;             // доля всех городов для победы
const LOSE_SHARE = 0.7;            // если соперник владеет такой долей — поражение
const AUTOSAVE_EVERY = 30;

const RES = [
  { id: 'gold', name: 'Золото', gen: 'золота', color: '#e8bf47' },
  { id: 'food', name: 'Еда', gen: 'еды', color: '#9ccf5e' },
  { id: 'wood', name: 'Дерево', gen: 'дерева', color: '#c08a4f' },
  { id: 'stone', name: 'Камень', gen: 'камня', color: '#b0b2b6' },
  { id: 'iron', name: 'Железо', gen: 'железа', color: '#8fa9c2' },
];
const RES_IDS = RES.map(r => r.id);
const RES_BY_ID = Object.fromEntries(RES.map(r => [r.id, r]));

// Местность. cost — множитель времени прохода клетки, def — бонус защиты в полевом бою.
const T = { DEEP: 0, SHALLOW: 1, BEACH: 2, PLAINS: 3, FOREST: 4, HILLS: 5, MOUNTAIN: 6, SNOW: 7 };
const TERRAIN = [
  { name: 'Море', cost: Infinity, def: 0 },
  { name: 'Мелководье', cost: Infinity, def: 0 },
  { name: 'Побережье', cost: 1.15, def: 0 },
  { name: 'Равнина', cost: 1, def: 0 },
  { name: 'Лес', cost: 1.6, def: 0.2 },
  { name: 'Холмы', cost: 2, def: 0.3 },
  { name: 'Горы', cost: 3.6, def: 0.5 },
  { name: 'Вершины', cost: 5.5, def: 0.6 },
];
const RIVER_COST = 1.2;   // добавка за брод
const ROAD_MULT = 0.45;   // дорога ускоряет движение

const CITY_LEVELS = [
  null,
  { name: 'Деревня', popMax: 400, slots: 3, radius: 4, up: { gold: 220, wood: 160, stone: 120 }, time: 40 },
  { name: 'Городок', popMax: 800, slots: 5, radius: 5, up: { gold: 450, wood: 260, stone: 300 }, time: 60 },
  { name: 'Город', popMax: 1400, slots: 7, radius: 6, up: { gold: 900, wood: 420, stone: 650, iron: 80 }, time: 80 },
  { name: 'Крупный город', popMax: 2200, slots: 9, radius: 6, up: { gold: 1600, wood: 600, stone: 1100, iron: 200 }, time: 110 },
  { name: 'Великий город', popMax: 3200, slots: 10, radius: 7, up: null, time: 0 },
];
const MAX_CITY_LEVEL = 5;

// Влияние города: дальность в клетках, на которую город держит землю вокруг себя.
// Сила = база по уровню + население + гарнизон + свои армии рядом − вражеские армии рядом.
const INFLUENCE = {
  base: [0, 2.75, 3.35, 3.7, 4.1, 4.5],
  pop: 0.7,          // × √(жители / 400)
  garrison: 0.42,    // × √(воины / 10), не больше garrisonMax
  garrisonMax: 2.4,
  army: 0.4,         // своя армия: × √(воины / 10) × (1 − расстояние / armyR)
  armyR: 6, armyMax: 2.5,
  enemy: 0.55,       // чужая армия: так же, но в пределах enemyR
  enemyR: 4, enemyMax: 3.5,
  siege: 1.8,        // осада режет влияние сверх давления самой армии
  min: 1.5, max: 9,
  recheck: 2,        // раз в столько секунд проверяем, не пора ли перекроить земли
  threshold: 0.2,    // перекраиваем, если чья-то сила изменилась хотя бы на столько клеток
  // цена шага влияния: местность мешает слабее, чем армиям; дорога помогает, брод мешает
  terrain: 0.1, road: 0.85, river: 0.15,
  wobble: 1.3,       // разброс цены шага по шуму (доля)
  grain: 0.5,        // и случайная неровность от клетки к клетке (доля)
  edge: 10,          // разброс края владений по шуму (клеток)
};

// Экономика (всё в минуту игрового времени).
const ECON = {
  tax: 0.075,           // золота с жителя
  eat: 0.04,            // еды на жителя
  growth: 0.06,         // прирост населения при сытости
  starve: 0.05,         // убыль при голоде
  baseFood: 14, baseWood: 10, baseStone: 4,
  winterFood: 0.5,      // зимой поля дают половину
  resCap: 20000,
};

// Здания в слотах города. yield — выход за уровень, terrain — что из окрестностей важно.
const BUILDINGS = {
  farm: {
    name: 'Ферма', icon: 'wheat', max: 3, cost: { gold: 60, wood: 50 }, time: 18,
    desc: 'Даёт еду. Чем больше равнин и рек вокруг города, тем выше урожай. Зимой урожай вдвое меньше.',
    yield: { food: 30 }, terrain: { [T.PLAINS]: 1, [T.BEACH]: 0.5, river: 2 }, ideal: 26,
  },
  lumber: {
    name: 'Лесопилка', icon: 'saw', max: 3, cost: { gold: 50, wood: 20 }, time: 16,
    desc: 'Даёт дерево. Нужны леса в округе города.',
    yield: { wood: 30 }, terrain: { [T.FOREST]: 1, [T.HILLS]: 0.2 }, ideal: 16,
  },
  quarry: {
    name: 'Каменоломня', icon: 'pick', max: 3, cost: { gold: 80, wood: 50 }, time: 20,
    desc: 'Даёт камень. Нужны холмы и горы в округе.',
    yield: { stone: 20 }, terrain: { [T.HILLS]: 1, [T.MOUNTAIN]: 1.4, [T.SNOW]: 1, [T.BEACH]: 0.3 }, ideal: 12,
  },
  mine: {
    name: 'Рудник', icon: 'ore', max: 3, cost: { gold: 120, wood: 70, stone: 40 }, time: 24,
    desc: 'Даёт железо для мечников, рыцарей и мануфактуры. Нужны горы.',
    yield: { iron: 14 }, terrain: { [T.MOUNTAIN]: 1, [T.SNOW]: 1, [T.HILLS]: 0.7 }, ideal: 8,
  },
  market: {
    name: 'Рынок', icon: 'coins', max: 3, cost: { gold: 150, wood: 90, stone: 50 }, time: 24,
    desc: 'Приносит золото, на 10% за уровень увеличивает налоги с горожан и улучшает цены торговли.',
    yield: { gold: 30 }, taxBonus: 0.1,
  },
  factory: {
    name: 'Мануфактура', icon: 'gear', max: 3, cost: { gold: 260, wood: 140, stone: 120, iron: 30 }, time: 32, minLevel: 2,
    desc: 'Фабрика: перерабатывает дерево и железо в товары и продаёт их за золото. Стоит, если сырья не хватает.',
    convert: { input: { wood: 12, iron: 2 }, output: { gold: 70 } },
  },
  barracks: {
    name: 'Казармы', icon: 'helm', max: 2, cost: { gold: 120, wood: 120 }, time: 22,
    desc: '1 уровень — копейщики, 2 уровень — мечники. Ускоряет найм пехоты.',
  },
  range: {
    name: 'Стрельбище', icon: 'bow', max: 2, cost: { gold: 130, wood: 150 }, time: 22,
    desc: '1 уровень — лучники, 2 уровень — арбалетчики.',
  },
  stable: {
    name: 'Конюшня', icon: 'horse', max: 2, cost: { gold: 220, wood: 140, stone: 60 }, time: 28, minLevel: 2,
    desc: '1 уровень — конница, 2 уровень — рыцари.',
  },
  workshop: {
    name: 'Осадная мастерская', icon: 'catapult', max: 2, cost: { gold: 260, wood: 220, stone: 120 }, time: 30, minLevel: 2,
    desc: '1 уровень — тараны, 2 уровень — катапульты. Без них взять каменные стены очень трудно.',
  },
};
const BUILDING_IDS = Object.keys(BUILDINGS);
const LEVEL_COST_MULT = 1.75;
const LEVEL_TIME_MULT = 1.35;

// Торговля: цена продажи единицы ресурса в золоте; покупка дороже.
const TRADE = { food: 0.22, wood: 0.28, stone: 0.32, iron: 0.85, buyMult: 2.3, marketBonus: 0.04, maxBonus: 0.4 };

// Укрепления не занимают слотов.
const WALLS = [
  null,
  { name: 'Частокол', cost: { gold: 40, wood: 140 }, time: 20, hp: 600, bonus: 0.3, minLevel: 1 },
  { name: 'Каменные стены', cost: { gold: 160, stone: 360 }, time: 40, hp: 1600, bonus: 0.6, minLevel: 2 },
  { name: 'Крепость', cost: { gold: 420, stone: 820, iron: 80 }, time: 70, hp: 3200, bonus: 0.9, minLevel: 3 },
];
const TOWERS = [
  null,
  { name: 'Деревянные башни', cost: { gold: 80, wood: 120, stone: 60 }, time: 20, dps: 7 },
  { name: 'Каменные башни', cost: { gold: 170, stone: 320 }, time: 34, dps: 16 },
  { name: 'Бастионы', cost: { gold: 320, stone: 560, iron: 60 }, time: 50, dps: 30 },
];

// Войска. Цена и найм — за один отряд (squad человек; у машин — 1 машина).
const UNITS = {
  militia: {
    name: 'Ополчение', short: 'Ополч.', icon: 'pitchfork', squad: 10, cost: { gold: 25, food: 20 }, time: 6, need: null,
    hp: 10, atk: 2.2, def: 1, ranged: false, speed: 0.85, upkeep: 0.8, siege: 0.05,
    desc: 'Дешёвые крестьяне с вилами. Слабы, но набираются в любом городе.',
  },
  scout: {
    name: 'Разведчики', short: 'Разв.', icon: 'eye', squad: 5, cost: { gold: 30, food: 10 }, time: 5, need: null,
    hp: 7, atk: 1, def: 1, ranged: false, speed: 1.9, upkeep: 0.6, siege: 0, vision: 10,
    desc: 'Быстрые всадники для разведки: видят вдвое дальше, но почти не сражаются.',
  },
  spear: {
    name: 'Копейщики', short: 'Копья', icon: 'spear', squad: 10, cost: { gold: 40, food: 20, wood: 25 }, time: 8, need: ['barracks', 1],
    hp: 12, atk: 3, def: 3, ranged: false, speed: 0.85, upkeep: 1.4, siege: 0.05,
    bonus: { cavalry: 2.2, knight: 2.0 },
    desc: 'Стена копий: вдвое опаснее для конницы и рыцарей.',
  },
  sword: {
    name: 'Мечники', short: 'Мечи', icon: 'sword', squad: 10, cost: { gold: 70, food: 25, iron: 30 }, time: 10, need: ['barracks', 2],
    hp: 16, atk: 5, def: 4.5, ranged: false, speed: 0.8, upkeep: 2.4, siege: 0.08,
    bonus: { spear: 1.5, militia: 1.4 },
    desc: 'Тяжёлая пехота: крепкая, хорошо рубит копейщиков и ополчение.',
  },
  archer: {
    name: 'Лучники', short: 'Луки', icon: 'bow', squad: 10, cost: { gold: 50, food: 20, wood: 35 }, time: 8, need: ['range', 1],
    hp: 9, atk: 3.6, def: 1, ranged: true, speed: 0.85, upkeep: 1.4, siege: 0.02,
    bonus: { spear: 1.3, militia: 1.3, sword: 1.15 },
    desc: 'Стреляют первыми и сильнее всего защищают стены. Боятся конницы.',
  },
  crossbow: {
    name: 'Арбалетчики', short: 'Арбал.', icon: 'crossbow', squad: 10, cost: { gold: 85, food: 20, wood: 25, iron: 25 }, time: 10, need: ['range', 2],
    hp: 11, atk: 5.5, def: 2, ranged: true, speed: 0.8, upkeep: 2.4, siege: 0.03,
    bonus: { knight: 1.7, cavalry: 1.4, sword: 1.3 },
    desc: 'Болты пробивают латы: опасны для рыцарей и мечников.',
  },
  cavalry: {
    name: 'Конница', short: 'Конн.', icon: 'horse', squad: 10, cost: { gold: 100, food: 40, iron: 10 }, time: 12, need: ['stable', 1],
    hp: 18, atk: 5, def: 2, ranged: false, speed: 1.45, upkeep: 3.2, siege: 0.02,
    bonus: { archer: 2.0, crossbow: 1.8, ram: 2.5, catapult: 2.5 },
    desc: 'Быстрые всадники: топчут стрелков и осадные машины, но гибнут на копьях.',
  },
  knight: {
    name: 'Рыцари', short: 'Рыцари', icon: 'knight', squad: 10, cost: { gold: 180, food: 40, iron: 50 }, time: 16, need: ['stable', 2],
    hp: 30, atk: 9, def: 7, ranged: false, speed: 1.25, upkeep: 6, siege: 0.04,
    bonus: { archer: 1.6, militia: 1.5, sword: 1.2 },
    desc: 'Закованная в латы элита. Дорого, но сокрушительно.',
  },
  ram: {
    name: 'Таран', short: 'Таран', icon: 'ram', squad: 1, crew: 4, cost: { gold: 80, wood: 120 }, time: 14, need: ['workshop', 1],
    hp: 70, atk: 0.4, def: 5, ranged: false, speed: 0.55, upkeep: 2, siege: 12,
    desc: 'Бьёт ворота: быстро рушит стены, но беззащитен в поле.',
  },
  catapult: {
    name: 'Катапульта', short: 'Катап.', icon: 'catapult', squad: 1, crew: 6, cost: { gold: 160, wood: 160, stone: 60 }, time: 20, need: ['workshop', 2],
    hp: 45, atk: 7, def: 1, ranged: true, speed: 0.5, upkeep: 4, siege: 26,
    desc: 'Мечет камни через стены: рушит укрепления и бьёт по защитникам.',
  },
};
const UNIT_IDS = Object.keys(UNITS);
const UNIT_ORDER = ['militia', 'spear', 'sword', 'archer', 'crossbow', 'cavalry', 'knight', 'ram', 'catapult', 'scout'];

const COMBAT = {
  k: 0.32,              // общий темп боя
  volley: 4,            // секунд, пока стрелки бьют до сближения
  routMorale: 22,
  routFrac: 0.15,
  armyVision: 5,
  contact: 0.9,         // клеток до столкновения армий
  siegeReach: 1.3,
};

const KINGDOM_PRESETS = [
  { name: 'Северное королевство', adj: 'северяне', color: '#3d6fc4', dark: '#1d3970', sigil: 'star' },
  { name: 'Червлёное княжество', adj: 'червлёные', color: '#c3402f', dark: '#6b1d14', sigil: 'sword' },
  { name: 'Лесное графство', adj: 'лесные', color: '#3a8a3a', dark: '#1b4a1b', sigil: 'tree' },
  { name: 'Золотая марка', adj: 'золотые', color: '#d3a224', dark: '#6d5108', sigil: 'crown' },
  { name: 'Сумеречный орден', adj: 'сумеречные', color: '#7b4fb6', dark: '#3c2264', sigil: 'cross' },
  { name: 'Каменный союз', adj: 'каменные', color: '#3f8c8f', dark: '#1a4547', sigil: 'tower' },
];
const NEUTRAL_COLOR = '#8a7f6a';
const BANDIT_COLOR = '#3a3330';

const CITY_NAMES = [
  'Велеград', 'Ольховец', 'Белозерье', 'Каменец', 'Вышгород', 'Дубрава', 'Рябинов', 'Ярополь', 'Звенигорье',
  'Остролесье', 'Медвежий Брод', 'Серебряный Ключ', 'Вороний Холм', 'Тихоречье', 'Златоборье', 'Соколиный Яр',
  'Кремнёв', 'Чернолесье', 'Ясногорье', 'Волчий Лог', 'Бережки', 'Ковыльное', 'Туманец', 'Студёнец', 'Гремячье',
  'Лебедянь', 'Светлояр', 'Красный Бор', 'Горностаево', 'Липовец', 'Сосновый Дол', 'Ржавый Камень', 'Полынь',
  'Овражье', 'Кленовец', 'Глубокий Ручей', 'Еловец', 'Орлиное Гнездо', 'Мглистый Порт', 'Седые Пороги', 'Ветрогорск',
  'Ключевой Город', 'Зарецк', 'Боровое', 'Яблонец', 'Курганье', 'Высокий Мост', 'Тёмная Гать', 'Синеозёрск',
  'Малиновец', 'Рогатый Мыс', 'Дымное', 'Крутояр', 'Буйный Брод', 'Ледяной Порог', 'Ковальск', 'Морошково',
  'Лунная Пристань', 'Старый Вал', 'Гусиный Луг', 'Пепелище', 'Хмелевец', 'Солнцеград', 'Рудный Холм',
];

const DIFFICULTY = {
  easy: { name: 'Мирная', income: 0.8, aggression: 0.6, think: 6, armyMult: 0.8 },
  normal: { name: 'Обычная', income: 1.0, aggression: 1.0, think: 4, armyMult: 1.0 },
  hard: { name: 'Жестокая', income: 1.3, aggression: 1.35, think: 2.5, armyMult: 1.15 },
};

const MAP_SIZES = {
  small: { name: 'Малая', W: 96, H: 66, cities: 20 },
  medium: { name: 'Средняя', W: 128, H: 88, cities: 30 },
  large: { name: 'Большая', W: 160, H: 110, cities: 42 },
};
