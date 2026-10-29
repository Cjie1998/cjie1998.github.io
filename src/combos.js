// 组合定义、合法性判定、全量枚举与颜色副色提示
import {
  ELEMENT_ORDER,
  MONTH_BRANCH_BONUS,
  MONTH_ELEMENT,
  fortuneOf,
  singleCardScore,
} from './rules.js';

export const COMBO_META = {
  sanhui: { label: '三会', bonus: 5, size: 3 },
  sanhe: { label: '三合', bonus: 4, size: 3 },
  liuhe: { label: '六合', bonus: 3, size: 2 },
  banhe: { label: '半合', bonus: 2, size: 2 },
  gonghe: { label: '拱合', bonus: 1, size: 2 },
  wuhe: { label: '天干五合', bonus: 3, size: 2 },
  single: { label: '单牌', bonus: 0, size: 1 },
};

const SANHUI = [
  { cards: ['寅', '卯', '辰'], out: '木' },
  { cards: ['巳', '午', '未'], out: '火' },
  { cards: ['申', '酉', '戌'], out: '金' },
  { cards: ['亥', '子', '丑'], out: '水' },
];

const SANHE = [
  { cards: ['申', '子', '辰'], out: '水' },
  { cards: ['亥', '卯', '未'], out: '木' },
  { cards: ['寅', '午', '戌'], out: '火' },
  { cards: ['巳', '酉', '丑'], out: '金' },
];

// 六合产出按常用合化表，策划书标注为待确认参数
const LIUHE = [
  { cards: ['子', '丑'], out: '土' },
  { cards: ['寅', '亥'], out: '木' },
  { cards: ['卯', '戌'], out: '火' },
  { cards: ['辰', '酉'], out: '金' },
  { cards: ['巳', '申'], out: '水' },
  { cards: ['午', '未'], out: '土' },
];

const BANHE = [
  { cards: ['申', '子'], out: '水' },
  { cards: ['子', '辰'], out: '水' },
  { cards: ['亥', '卯'], out: '木' },
  { cards: ['卯', '未'], out: '木' },
  { cards: ['寅', '午'], out: '火' },
  { cards: ['午', '戌'], out: '火' },
  { cards: ['巳', '酉'], out: '金' },
  { cards: ['酉', '丑'], out: '金' },
];

const GONGHE = [
  { cards: ['申', '辰'], out: '水' },
  { cards: ['亥', '未'], out: '木' },
  { cards: ['寅', '戌'], out: '火' },
  { cards: ['巳', '丑'], out: '金' },
];

const WUHE = [
  { cards: ['甲', '己'], out: '土' },
  { cards: ['乙', '庚'], out: '金' },
  { cards: ['丙', '辛'], out: '水' },
  { cards: ['丁', '壬'], out: '木' },
  { cards: ['戊', '癸'], out: '火' },
];

export const TRIPLE_DEFS = [
  ...SANHUI.map((d) => ({ ...d, type: 'sanhui', ...COMBO_META.sanhui })),
  ...SANHE.map((d) => ({ ...d, type: 'sanhe', ...COMBO_META.sanhe })),
];

export const PAIR_DEFS = [
  ...LIUHE.map((d) => ({ ...d, type: 'liuhe', ...COMBO_META.liuhe })),
  ...BANHE.map((d) => ({ ...d, type: 'banhe', ...COMBO_META.banhe })),
  ...GONGHE.map((d) => ({ ...d, type: 'gonghe', ...COMBO_META.gonghe })),
];

export const STEM_PAIR_DEFS = WUHE.map((d) => ({ ...d, type: 'wuhe', ...COMBO_META.wuhe }));

const keyOf = (names) => [...names].sort().join('');
const TRIPLE_BY_KEY = new Map(TRIPLE_DEFS.map((d) => [keyOf(d.cards), d]));
const PAIR_BY_KEY = new Map(PAIR_DEFS.map((d) => [keyOf(d.cards), d]));
const STEM_BY_KEY = new Map(STEM_PAIR_DEFS.map((d) => [keyOf(d.cards), d]));

/** 所有合局只在产出五行旺的月令成立：月令五行必须与产出五行相同 */
export function monthAllows(target, month) {
  return MONTH_ELEMENT[month] === target;
}

/**
 * 成局月令条件（v3.3 起统一）：
 * 三会、三合、六合、半合、拱合、天干五合，全部要求产出五行为「旺」。
 * 也就是想合出哪个五行，只能在那个五行当令的月份成局。
 */
export function comboMonthAllows(type, out, month) {
  if (type === 'single') return true;
  return monthAllows(out, month);
}

export function isMonthBranch(card, month) {
  return card.kind === 'branch' && card.name === month;
}

function comboFromDef(def, cards, month) {
  // 合局计分：每张牌固定 5 分（不再计各自牌面分），
  // 再按“产出五行”在当月的旺相休囚死加/减一次，最后加组合加成。
  const outputDelta = fortuneOf(def.out, month).delta;
  const score = 5 * cards.length + def.bonus + outputDelta;
  return {
    type: def.type,
    label: def.label,
    out: def.out,
    bonus: def.bonus,
    size: cards.length,
    cards,
    names: cards.map((c) => c.name),
    score,
    outputDelta,
    monthBonus: 0,
  };
}

function singleCombo(card, month) {
  // 月令支单牌固定 10（5 + 月令 5），不再叠旺相；组合中的月令支不额外加分
  const monthBonus = isMonthBranch(card, month) ? MONTH_BRANCH_BONUS : 0;
  return {
    type: 'single',
    label: '单牌',
    out: card.element,
    bonus: 0,
    size: 1,
    cards: [card],
    names: [card.name],
    score: singleCardScore(card, month),
    outputDelta: monthBonus ? 0 : fortuneOf(card.element, month).delta,
    monthBonus,
  };
}

/**
 * 分析一组选中的牌能否成局。
 * 返回 { ok: true, combo } 或 { ok: false, reason, code }
 */
export function analyzeSelection(cards, month) {
  if (!Array.isArray(cards) || cards.length === 0) {
    return { ok: false, reason: '请先选择手牌', code: 'EMPTY' };
  }
  if (cards.length > 3) {
    return { ok: false, reason: '一回合最多打出 3 张牌', code: 'TOO_MANY' };
  }
  const kinds = new Set(cards.map((c) => c.kind));
  if (kinds.size > 1) {
    return { ok: false, reason: '天干与地支不能混在同一个组合中', code: 'MIXED' };
  }
  const isStem = cards[0].kind === 'stem';

  if (cards.length === 1) {
    return { ok: true, combo: singleCombo(cards[0], month) };
  }

  const key = keyOf(cards.map((c) => c.name));

  if (cards.length === 2) {
    if (isStem) {
      const def = STEM_BY_KEY.get(key);
      if (!def) {
        return { ok: false, reason: '这两张天干不构成天干五合', code: 'NO_COMBO' };
      }
      if (!monthAllows(def.out, month)) {
        return {
          ok: false,
          reason: `${month}月${MONTH_ELEMENT[month]}旺，天干五合需合化出${def.out}且${def.out}旺`,
          code: 'WUHE_MONTH',
        };
      }
      return { ok: true, combo: comboFromDef(def, cards, month) };
    }
    const def = PAIR_BY_KEY.get(key);
    if (!def) {
      return { ok: false, reason: '这两张地支不能构成六合 / 半合 / 拱合', code: 'NO_COMBO' };
    }
    if (!comboMonthAllows(def.type, def.out, month)) {
      const f = fortuneOf(def.out, month);
      return {
        ok: false,
        reason: `${def.label}·${def.out}在${month}月为${f.state}，成局需该五行为旺（月令同${def.out}）`,
        code: 'COMBO_MONTH',
      };
    }
    return { ok: true, combo: comboFromDef(def, cards, month) };
  }

  // 3 张
  if (isStem) {
    return { ok: false, reason: '天干只有五合，需恰好 2 张；3 张天干不能成局', code: 'NO_COMBO' };
  }
  const def = TRIPLE_BY_KEY.get(key);
  if (!def) {
    return { ok: false, reason: '这三张地支不能构成三会或三合', code: 'NO_COMBO' };
  }
  if (!comboMonthAllows(def.type, def.out, month)) {
    const f = fortuneOf(def.out, month);
    return {
      ok: false,
      reason: `${def.label}·${def.out}在${month}月为${f.state}，成局需该五行为旺（月令同${def.out}）`,
      code: 'COMBO_MONTH',
    };
  }
  return { ok: true, combo: comboFromDef(def, cards, month) };
}

function cartesian(lists) {
  let out = [[]];
  for (const list of lists) {
    const next = [];
    for (const prefix of out) {
      for (const item of list) next.push([...prefix, item]);
    }
    out = next;
  }
  return out;
}

function buildFromDef(def, byName, month) {
  const lists = def.cards.map((name) => byName.get(name) || []);
  if (lists.some((list) => list.length === 0)) return [];
  return cartesian(lists).map((cards) => comboFromDef(def, cards, month));
}

/**
 * 枚举手牌中所有潜在合法组合（含单牌）。
 * 同名牌按实例处理，结果按 cardId 集合去重。
 */
export function findCombos(hand, month) {
  const byName = new Map();
  for (const card of hand) {
    if (!byName.has(card.name)) byName.set(card.name, []);
    byName.get(card.name).push(card);
  }

  const result = new Map();
  const add = (combo) => {
    const id = `${combo.type}:${combo.cards.map((c) => c.id).sort().join(',')}`;
    if (!result.has(id)) result.set(id, combo);
  };

  for (const card of hand) add(singleCombo(card, month));

  for (const def of TRIPLE_DEFS) {
    if (!comboMonthAllows(def.type, def.out, month)) continue;
    for (const combo of buildFromDef(def, byName, month)) add(combo);
  }
  for (const def of PAIR_DEFS) {
    if (!comboMonthAllows(def.type, def.out, month)) continue;
    for (const combo of buildFromDef(def, byName, month)) add(combo);
  }
  for (const def of STEM_PAIR_DEFS) {
    if (!monthAllows(def.out, month)) continue;
    for (const combo of buildFromDef(def, byName, month)) add(combo);
  }

  return [...result.values()].sort(
    (a, b) => b.size - a.size || b.bonus - a.bonus || b.score - a.score,
  );
}

/** 校验玩家提交的出牌动作 */
export function validateAction(hand, action, month) {
  if (!action || action.kind !== 'play') {
    return { ok: false, reason: '不是出牌动作', code: 'NOT_PLAY' };
  }
  const ids = action.cardIds || [];
  if (new Set(ids).size !== ids.length) {
    return { ok: false, reason: '同一张牌不能重复选择', code: 'DUP' };
  }
  const cards = [];
  for (const id of ids) {
    const card = hand.find((c) => c.id === id);
    if (!card) return { ok: false, reason: '手牌中没有这张牌', code: 'NOT_IN_HAND' };
    cards.push(card);
  }
  const analysis = analyzeSelection(cards, month);
  if (!analysis.ok) return analysis;
  if (action.comboType && action.comboType !== analysis.combo.type) {
    return { ok: false, reason: '声明的组合类型与所选牌不符', code: 'TYPE_MISMATCH' };
  }
  return analysis;
}

/**
 * 颜色提示：对每张手牌收集所有潜在组合的合化五行。
 * 返回 { [cardId]: { colors: ['土'], details: [{out,label,others}] } }
 */
export function colorHints(hand, month) {
  const combos = findCombos(hand, month).filter((c) => c.size > 1);
  const map = new Map();

  for (const combo of combos) {
    for (const card of combo.cards) {
      if (combo.out === card.element) continue;
      if (!map.has(card.id)) map.set(card.id, { colors: new Set(), details: [] });
      const entry = map.get(card.id);
      entry.colors.add(combo.out);
      const others = combo.cards.filter((c) => c.id !== card.id).map((c) => c.name).sort();
      const sig = `${combo.out}|${combo.label}|${others.join('')}`;
      if (!entry.details.some((d) => d.sig === sig)) {
        entry.details.push({ sig, out: combo.out, label: combo.label, others });
      }
    }
  }

  const out = {};
  for (const card of hand) {
    const entry = map.get(card.id);
    const colors = entry
      ? ELEMENT_ORDER.filter((e) => entry.colors.has(e))
      : [];
    out[card.id] = {
      colors,
      details: entry ? entry.details : [],
    };
  }
  return out;
}

/** 手牌潜在组合的粗略价值，供 AI 使用 */
export function handPotential(hand, month) {
  let value = 0;
  for (const combo of findCombos(hand, month)) {
    if (combo.size === 1) continue;
    value += 0.12 + combo.bonus * 0.035 + combo.size * 0.02;
  }
  return value;
}
