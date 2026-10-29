// 规则数据层：牌表、五行生克、月令、旺相休囚死、分值、随机数
// 本文件不依赖 DOM，可在浏览器与 Node 中直接运行。

export const ELEMENT_ORDER = ['木', '火', '土', '金', '水'];

// 五行专属颜色（主色 / 文字色 / 描边色）
export const ELEMENT_COLORS = {
  金: { bg: '#e3dcc9', ink: '#231f18', edge: '#fff8e6', name: '白' },
  木: { bg: '#3f8a58', ink: '#f1f8ee', edge: '#7fc394', name: '绿' },
  水: { bg: '#1b2733', ink: '#dce9f6', edge: '#6f93b5', name: '黑' },
  火: { bg: '#b23a2e', ink: '#ffede7', edge: '#e07a63', name: '红' },
  土: { bg: '#c39527', ink: '#2a210c', edge: '#f0d37a', name: '黄' },
};

export const STEM_TABLE = [
  { name: '甲', element: '木' },
  { name: '乙', element: '木' },
  { name: '丙', element: '火' },
  { name: '丁', element: '火' },
  { name: '戊', element: '土' },
  { name: '己', element: '土' },
  { name: '庚', element: '金' },
  { name: '辛', element: '金' },
  { name: '壬', element: '水' },
  { name: '癸', element: '水' },
];

export const BRANCH_TABLE = [
  { name: '子', element: '水' },
  { name: '丑', element: '土' },
  { name: '寅', element: '木' },
  { name: '卯', element: '木' },
  { name: '辰', element: '土' },
  { name: '巳', element: '火' },
  { name: '午', element: '火' },
  { name: '未', element: '土' },
  { name: '申', element: '金' },
  { name: '酉', element: '金' },
  { name: '戌', element: '土' },
  { name: '亥', element: '水' },
];

export const CARD_TABLE = [
  ...STEM_TABLE.map((c) => ({ ...c, kind: 'stem' })),
  ...BRANCH_TABLE.map((c) => ({ ...c, kind: 'branch' })),
];

export const CARD_BY_NAME = new Map(CARD_TABLE.map((c) => [c.name, c]));

export const MONTH_CYCLE = ['寅', '卯', '辰', '巳', '午', '未', '申', '酉', '戌', '亥', '子', '丑'];

export const MONTH_ELEMENT = {
  寅: '木', 卯: '木',
  巳: '火', 午: '火',
  申: '金', 酉: '金',
  亥: '水', 子: '水',
  辰: '土', 戌: '土', 丑: '土', 未: '土',
};

// 五行相生：木→火→土→金→水→木
export const GENERATES = { 木: '火', 火: '土', 土: '金', 金: '水', 水: '木' };
// 五行相克：木克土、土克水、水克火、火克金、金克木
export const OVERCOMES = { 木: '土', 土: '水', 水: '火', 火: '金', 金: '木' };

export const FORTUNE_STATES = ['旺', '相', '休', '囚', '死'];

/**
 * 某五行在指定月令下的旺相休囚死
 * 当令者旺；令生我者相；我生令者休；我克令者囚；令克我者死。
 */
export function fortuneOf(element, month) {
  const monthElement = MONTH_ELEMENT[month];
  if (!monthElement) throw new Error(`未知月令: ${month}`);
  if (element === monthElement) return { state: '旺', delta: 2 };
  if (GENERATES[monthElement] === element) return { state: '相', delta: 1 };
  if (GENERATES[element] === monthElement) return { state: '休', delta: 0 };
  if (OVERCOMES[element] === monthElement) return { state: '囚', delta: -1 };
  return { state: '死', delta: -2 };
}

export function nextMonth(month) {
  const i = MONTH_CYCLE.indexOf(month);
  return MONTH_CYCLE[(i + 1) % MONTH_CYCLE.length];
}

export function prevMonth(month) {
  const i = MONTH_CYCLE.indexOf(month);
  return MONTH_CYCLE[(i - 1 + MONTH_CYCLE.length) % MONTH_CYCLE.length];
}

/** direction: 1 顺行（寅→卯…），-1 逆行（寅→丑…） */
export function monthInfo(month, direction = 1) {
  const next = direction >= 0 ? nextMonth(month) : prevMonth(month);
  return {
    month,
    element: MONTH_ELEMENT[month],
    next,
    nextElement: MONTH_ELEMENT[next],
    direction: direction >= 0 ? 1 : -1,
    fortunes: ELEMENT_ORDER.map((element) => ({ element, ...fortuneOf(element, month) })),
  };
}

export const MONTH_BRANCH_BONUS = 5;

/** 单牌基础分 = 5 + 2 × 旺相休囚死修正（单牌修正翻倍） */
export function baseScore(cardOrElement, month) {
  const element = typeof cardOrElement === 'string' ? cardOrElement : cardOrElement.element;
  return 5 + 2 * fortuneOf(element, month).delta;
}

/** 单牌实际分：月令支固定 5 + 5 = 10，不再叠旺相；其他牌 5 + 2×修正 */
export function singleCardScore(card, month) {
  if (card.kind === 'branch' && card.name === month) {
    return 5 + MONTH_BRANCH_BONUS;
  }
  return baseScore(card, month);
}

export function cardScore(card, month) {
  return baseScore(card, month);
}

let cardSeq = 0;
export function makeCard(name, id) {
  const proto = CARD_BY_NAME.get(name);
  if (!proto) throw new Error(`未知牌: ${name}`);
  cardSeq += 1;
  return {
    id: id || `card-${cardSeq}`,
    name: proto.name,
    kind: proto.kind,
    element: proto.element,
  };
}

/** mulberry32：轻量确定性随机数，便于固定种子复现对局 */
export function mulberry32(seed) {
  let a = (seed >>> 0) || 1;
  return function rng() {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function pick(rng, list) {
  return list[Math.floor(rng() * list.length)];
}

export const DEFAULT_CONFIG = {
  handLimit: Number.POSITIVE_INFINITY,
  initialStems: 4,
  initialBranches: 4,
  maxComboSize: 3,
  maxRounds: 12,
};
