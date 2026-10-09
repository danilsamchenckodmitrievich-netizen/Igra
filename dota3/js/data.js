'use strict';
// Константы и игровые данные: команды, крипы, башни, герои, предметы.

const WORLD_SIZE = 6000;
const RADIANT = 0, DIRE = 1, NEUTRAL = 2;
const TEAM_NAME = ['Свет', 'Тьма', 'Нейтралы'];
const TEAM_COLOR = ['#7fd46c', '#e5604c', '#d9b45e'];
const TEAM_DARK = ['#2c5f27', '#6e231c', '#5e4a22'];

// XP_TABLE[l - 1] — суммарный опыт, нужный для уровня l.
const XP_TABLE = [0, 230, 600, 1080, 1660, 2260, 2980, 3730, 4510, 5320, 6160, 7030, 7930, 9155,
  10405, 11680, 12980, 14305, 15805, 17395, 18995, 20845, 22945, 25295, 27895];
const MAX_LEVEL = 25;
const START_GOLD = 625;
const PASSIVE_GOLD = 1.6;
const WAVE_INTERVAL = 30;
const PREGAME = 20;
const CAMP_RESPAWN = 60;
const SHOP_RADIUS = 1150;
const COURIER_TIME = 12;
const FOUNTAIN_HEAL_RADIUS = 650;
const XP_RADIUS = 1300;

const DIFFICULTY = {
  easy:   { name: 'Лёгкая',  think: 0.55, gold: 0.8, xp: 0.85, cast: 0.45, lastHit: 0.65, retreat: 0.38, aggro: 0.75 },
  normal: { name: 'Обычная', think: 0.32, gold: 1.0, xp: 1.0,  cast: 0.8,  lastHit: 0.9,  retreat: 0.3,  aggro: 0.95 },
  hard:   { name: 'Сложная', think: 0.2,  gold: 1.3, xp: 1.15, cast: 1.0,  lastHit: 1.0,  retreat: 0.24, aggro: 1.15 },
};

const CREEP_TYPES = {
  melee:  { name: 'Мечник', hp: 550, damage: 21, dmgVar: 2, armor: 2, range: 30, interval: 1.0, speed: 300,
    radius: 17, vision: 750, gold: [34, 41], xp: 57, projectileSpeed: 0 },
  ranged: { name: 'Лучник', hp: 300, damage: 24, dmgVar: 2, armor: 0, range: 480, interval: 1.0, speed: 300,
    radius: 15, vision: 750, gold: [44, 52], xp: 69, projectileSpeed: 900 },
};

const TOWER_TIERS = {
  1: { hp: 1800, damage: 100, armor: 12 },
  2: { hp: 2100, damage: 120, armor: 14 },
  3: { hp: 2400, damage: 140, armor: 16 },
  4: { hp: 2400, damage: 140, armor: 16 },
};
const TOWER_RANGE = 650;

const NEUTRAL_TYPES = {
  kobold: { name: 'Кобольд', hp: 280, damage: 13, dmgVar: 2, armor: 0, range: 30, interval: 1.0, speed: 280, radius: 14,
    gold: [16, 20], xp: 28, color: '#c9a64b' },
  wolf:   { name: 'Волк', hp: 480, damage: 27, dmgVar: 3, armor: 1, range: 30, interval: 1.0, speed: 330, radius: 17,
    gold: [28, 34], xp: 62, color: '#8d939b' },
  ogre:   { name: 'Огр', hp: 950, damage: 42, dmgVar: 4, armor: 2, range: 35, interval: 1.3, speed: 280, radius: 24,
    gold: [44, 52], xp: 115, color: '#6f86a3' },
  shaman: { name: 'Шаман', hp: 420, damage: 30, dmgVar: 3, armor: 0, range: 400, interval: 1.4, speed: 280, radius: 16,
    gold: [30, 36], xp: 66, color: '#9b6fc9', projectileSpeed: 800 },
};
const BOSS = {
  name: 'Древний Голем', hp: 5500, hpPerMin: 120, damage: 72, dmgVar: 6, armor: 12, range: 45, interval: 1.25,
  speed: 280, radius: 44, gold: [250, 320], teamGold: 150, xp: 650, respawn: 300, color: '#8b97a6',
};
const AEGIS_TIME = 300;

const CAMP_TYPES = {
  small: ['kobold', 'kobold', 'kobold'],
  medium: ['wolf', 'wolf'],
  large: ['ogre', 'shaman'],
};

// Герои. Значения роста указаны за уровень.
const HEROES = [
  {
    id: 'thunder', name: 'Громовой Клинок', role: 'Керри · ближний бой', color: '#62c6ff', color2: '#1b4f8f',
    weapon: 'sword', glyph: 'bolt',
    bio: 'Мечник, рождённый в грозу. Врывается в бой молнией и добивает врагов шквалом ударов.',
    hp: 620, hpGain: 86, mana: 260, manaGain: 28, hpRegen: 2.2, hpRegenGain: 0.12, manaRegen: 0.9, manaRegenGain: 0.05,
    damage: 52, damageGain: 3.4, armor: 3, armorGain: 0.38, range: 40, interval: 1.6, asGain: 2.2, speed: 310,
    projectileSpeed: 0, abilities: ['thunder_dash', 'thunder_whirl', 'thunder_crit', 'thunder_storm'],
    skillOrder: [1, 0, 2], build: ['salve', 'boots', 'gloves', 'broadsword', 'windboots', 'crit', 'bkb', 'bow', 'heart'],
  },
  {
    id: 'pyro', name: 'Пиромант', role: 'Маг · дальний бой', color: '#ff8a3d', color2: '#8f2e12',
    weapon: 'staff_fire', glyph: 'flame',
    bio: 'Повелитель огня. Сжигает целые волны крипов и обрушивает метеоры на героев.',
    hp: 480, hpGain: 62, mana: 400, manaGain: 55, hpRegen: 1.5, hpRegenGain: 0.08, manaRegen: 1.4, manaRegenGain: 0.09,
    damage: 44, damageGain: 2.4, armor: 1, armorGain: 0.2, range: 500, interval: 1.7, asGain: 1.2, speed: 295,
    projectileSpeed: 900, abilities: ['pyro_fireball', 'pyro_pillar', 'pyro_ember', 'pyro_meteor'],
    skillOrder: [0, 1, 2], build: ['salve', 'clarity', 'boots', 'void', 'belt', 'staff', 'blink', 'bkb', 'heart'],
  },
  {
    id: 'frost', name: 'Ледяная Ведьма', role: 'Контроль · дальний бой', color: '#a9e6ff', color2: '#2d5f86',
    weapon: 'staff_ice', glyph: 'snow',
    bio: 'Хранительница северных льдов. Замедляет врагов и укрывает союзников ледяным щитом.',
    hp: 500, hpGain: 66, mana: 380, manaGain: 50, hpRegen: 1.6, hpRegenGain: 0.09, manaRegen: 1.3, manaRegenGain: 0.08,
    damage: 40, damageGain: 2.2, armor: 2, armorGain: 0.25, range: 550, interval: 1.7, asGain: 1.2, speed: 300,
    projectileSpeed: 1000, abilities: ['frost_bolt', 'frost_shield', 'frost_chill', 'frost_winter'],
    skillOrder: [0, 1, 2], build: ['salve', 'clarity', 'boots', 'void', 'belt', 'staff', 'titan', 'heart'],
  },
  {
    id: 'titan', name: 'Каменный Титан', role: 'Танк · ближний бой', color: '#c79a62', color2: '#5b3d1e',
    weapon: 'hammer', glyph: 'mountain',
    bio: 'Ожившая скала. Оглушает врагов ударом о землю и прыгает в самую гущу боя.',
    hp: 700, hpGain: 96, mana: 260, manaGain: 28, hpRegen: 3.5, hpRegenGain: 0.2, manaRegen: 0.9, manaRegenGain: 0.05,
    damage: 55, damageGain: 3.0, armor: 4, armorGain: 0.32, range: 40, interval: 1.7, asGain: 1.4, speed: 295,
    projectileSpeed: 0, abilities: ['titan_slam', 'titan_skin', 'titan_thorns', 'titan_leap'],
    skillOrder: [0, 2, 1], build: ['salve', 'boots', 'ring', 'mail', 'belt', 'blink', 'titan', 'heart', 'bkb'],
  },
  {
    id: 'shadow', name: 'Теневой Охотник', role: 'Убийца · дальний бой', color: '#b48cff', color2: '#43206e',
    weapon: 'bow', glyph: 'eye',
    bio: 'Охотник из сумеречного леса. Исчезает в тенях и метит жертву для смертельной охоты.',
    hp: 520, hpGain: 72, mana: 300, manaGain: 34, hpRegen: 1.8, hpRegenGain: 0.1, manaRegen: 1.0, manaRegenGain: 0.06,
    damage: 48, damageGain: 3.1, armor: 2, armorGain: 0.42, range: 550, interval: 1.5, asGain: 2.4, speed: 305,
    projectileSpeed: 1100, abilities: ['shadow_poison', 'shadow_veil', 'shadow_instinct', 'shadow_mark'],
    skillOrder: [2, 0, 1], build: ['salve', 'boots', 'gloves', 'broadsword', 'windboots', 'bow', 'crit', 'bkb', 'heart'],
  },
  {
    id: 'priest', name: 'Жрица Рассвета', role: 'Поддержка · дальний бой', color: '#ffd86b', color2: '#8a6418',
    weapon: 'staff_sun', glyph: 'sun',
    bio: 'Служительница утреннего солнца. Лечит союзников, ослепляет врагов и спасает команду в бою.',
    hp: 510, hpGain: 66, mana: 420, manaGain: 55, hpRegen: 1.8, hpRegenGain: 0.1, manaRegen: 1.5, manaRegenGain: 0.1,
    damage: 42, damageGain: 2.2, armor: 2, armorGain: 0.25, range: 525, interval: 1.7, asGain: 1.2, speed: 300,
    projectileSpeed: 900, abilities: ['priest_light', 'priest_flash', 'priest_aura', 'priest_blessing'],
    skillOrder: [0, 1, 2], build: ['salve', 'clarity', 'boots', 'void', 'belt', 'staff', 'titan', 'heart'],
  },
];
const HERO_BY_ID = Object.fromEntries(HEROES.map(h => [h.id, h]));

// Предметы. stats суммируются, кроме boots — берётся лучший.
const ITEMS = {
  salve:      { name: 'Целебное зелье', cost: 100, glyph: 'potion', color: '#e0524d', consumable: true, maxCharges: 5,
    active: 'salve', desc: 'Восстанавливает 400 здоровья за 8 сек.' },
  clarity:    { name: 'Зелье ясности', cost: 60, glyph: 'potion', color: '#4c8df0', consumable: true, maxCharges: 5,
    active: 'clarity', desc: 'Восстанавливает 160 маны за 10 сек.' },
  tp:         { name: 'Свиток телепорта', cost: 90, glyph: 'scroll', color: '#6bc6d9', consumable: true, maxCharges: 3,
    active: 'tp', desc: 'Через 3 сек. переносит к союзному строению, ближайшему к выбранной точке. Оглушение прерывает чтение.' },
  boots:      { name: 'Сапоги скорости', cost: 450, glyph: 'boots', color: '#b9824a', stats: { boots: 45 },
    desc: 'Скорость передвижения +45. Не складывается с другими сапогами.' },
  ring:       { name: 'Кольцо здоровья', cost: 350, glyph: 'ring', color: '#6ed27a', stats: { hpRegen: 4 },
    desc: 'Восстановление здоровья +4 в сек.' },
  void:       { name: 'Камень пустоты', cost: 400, glyph: 'gem', color: '#7a8cff', stats: { manaRegen: 2 },
    desc: 'Восстановление маны +2 в сек.' },
  gloves:     { name: 'Перчатки ловкости', cost: 450, glyph: 'glove', color: '#e6b84d', stats: { attackSpeed: 20 },
    desc: 'Скорость атаки +20%.' },
  mail:       { name: 'Кольчуга', cost: 550, glyph: 'mail', color: '#a5adb8', stats: { armor: 5 },
    desc: 'Броня +5.' },
  belt:       { name: 'Пояс жизни', cost: 900, glyph: 'belt', color: '#d9534f', stats: { hp: 250 },
    desc: 'Здоровье +250.' },
  broadsword: { name: 'Широкий меч', cost: 1000, glyph: 'sword', color: '#cfd6de', stats: { damage: 20 },
    desc: 'Урон +20.' },
  windboots:  { name: 'Сапоги ветра', cost: 1600, glyph: 'boots', color: '#7fe0d2', stats: { boots: 70, attackSpeed: 20 },
    desc: 'Скорость передвижения +70, скорость атаки +20%. Заменяют обычные сапоги.' },
  blink:      { name: 'Кинжал рывка', cost: 2250, glyph: 'dagger', color: '#9fe8ff', active: 'blink',
    desc: 'Мгновенно переносит на расстояние до 1100. Перезарядка 12 сек. Не работает 3 сек. после урона от героя.' },
  staff:      { name: 'Посох чародея', cost: 2500, glyph: 'staff', color: '#b07cff', stats: { spellAmp: 0.2, mana: 300, manaRegen: 2 },
    desc: 'Урон способностей +20%, мана +300, восстановление маны +2.' },
  bkb:        { name: 'Щит бессмертия', cost: 3200, glyph: 'shield', color: '#f2c94c', stats: { damage: 10, hp: 200 }, active: 'bkb',
    desc: 'Урон +10, здоровье +200. Активно: невосприимчивость к магии на 6 сек. Перезарядка 60 сек.' },
  titan:      { name: 'Броня титана', cost: 3500, glyph: 'armor', color: '#8fa3b8', stats: { armor: 12, hp: 350, hpRegen: 5 },
    desc: 'Броня +12, здоровье +350, восстановление здоровья +5.' },
  crit:       { name: 'Клинок палача', cost: 4000, glyph: 'blade', color: '#ff6b6b', stats: { damage: 50, crit: 0.25 },
    desc: 'Урон +50. 25% шанс нанести критический удар ×2.2.' },
  bow:        { name: 'Лук бури', cost: 4200, glyph: 'bow', color: '#7ad3ff', stats: { damage: 30, attackSpeed: 45, evasion: 0.15 },
    desc: 'Урон +30, скорость атаки +45%, уклонение 15%.' },
  heart:      { name: 'Сердце древних', cost: 5000, glyph: 'heart', color: '#ff4f6d', stats: { hp: 900, hpRegen: 15 },
    desc: 'Здоровье +900, восстановление здоровья +15.' },
};
for (const id in ITEMS) ITEMS[id].id = id;

ITEMS.aegis = { id: 'aegis', name: 'Эгида бессмертия', cost: 0, glyph: 'shield', color: '#ffe27a', noSell: true,
  desc: 'Трофей Древнего Голема. Если герой погибнет, через 4 сек. он воскреснет на том же месте. Исчезает через 5 мин.' };

const SHOP_CATEGORIES = [
  { name: 'Расходники', items: ['salve', 'clarity', 'tp'] },
  { name: 'Основа', items: ['boots', 'ring', 'void', 'gloves', 'mail', 'belt', 'broadsword'] },
  { name: 'Улучшения', items: ['windboots', 'blink', 'staff', 'bkb'] },
  { name: 'Артефакты', items: ['titan', 'crit', 'bow', 'heart'] },
];

const STREAK_NAMES = {
  3: 'Серия убийств!', 4: 'Доминирование!', 5: 'Мега-убийство!', 6: 'Неудержим!',
  7: 'Безумие!', 8: 'Чудовищно!', 9: 'Божественно!', 10: 'За гранью божественного!',
};
