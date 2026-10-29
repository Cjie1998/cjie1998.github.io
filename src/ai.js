// AI 对手：全量动作枚举 + 启发式估值；不读取玩家手牌，也不使用颜色提示
import { singleCardScore } from './rules.js';
import { findCombos, handPotential } from './combos.js';

function noise(game, amount) {
  return (game.rng() * 2 - 1) * amount;
}

/**
 * 选择本回合动作（返回可直接提交给 Game.resolveRound 的动作）
 * 只读取 player 自己的手牌、当前/下月月令与公开规则。
 */
export function chooseAction(game, player = 'a') {
  const hand = game.players[player].hand;
  const next = game.nextMonthName;
  const actions = game.legalActions(player);

  const passValue = 5.6 + handPotential(hand, next) * 0.55 + hand.length * 0.12 + noise(game, 1.0);

  let bestAction = { kind: 'pass' };
  let bestValue = passValue;

  for (const action of actions) {
    const combo = action.combo;
    const used = new Set(action.cardIds);
    const remaining = hand.filter((c) => !used.has(c.id));
    const afterPotential = handPotential(remaining, next);
    const efficiency = combo.score / combo.size;
    const finishBonus = remaining.length === 0 ? 1.5 : 0;

    let value =
      combo.score +
      efficiency * 0.35 +
      afterPotential * 0.5 +
      (combo.size - 1) * 0.55 +
      finishBonus +
      noise(game, 1.1);

    if (combo.size === 1) value -= 0.2;

    if (value > bestValue) {
      bestValue = value;
      bestAction = {
        kind: 'play',
        comboType: combo.type,
        cardIds: action.cardIds,
      };
    }
  }

  return bestAction;
}

function combinations(list, k) {
  if (k <= 0) return [[]];
  const out = [];
  const walk = (start, picked) => {
    if (picked.length === k) {
      out.push(picked.slice());
      return;
    }
    for (let i = start; i < list.length; i += 1) {
      picked.push(list[i]);
      walk(i + 1, picked);
      picked.pop();
    }
  };
  walk(0, []);
  return out;
}

/**
 * 从公共牌池中挑 count 张：枚举组合，选“加入手牌后潜在组合价值 + 单牌分”最高的一组。
 * 不读取玩家手牌，只使用自己的手牌与公开牌池。
 */
export function choosePoolPicks(game, player = 'a', count = 1, pool = game.drawPool) {
  if (count <= 0) return [];
  const hand = game.players[player].hand;
  const month = game.month;
  const k = Math.min(count, pool.length);
  let best = [];
  let bestValue = -Infinity;

  for (const combo of combinations(pool, k)) {
    const nextHand = [...hand, ...combo];
    const potential = handPotential(nextHand, month);
    const rawScore = combo.reduce((sum, card) => sum + singleCardScore(card, month), 0);
    const value = potential * 3 + rawScore * 0.6 + noise(game, 0.15);
    if (value > bestValue) {
      bestValue = value;
      best = combo;
    }
  }
  return best;
}

/** 弃掉「当前分值 + 组合连接度」最低的牌 */
export function chooseDiscard(game, player = 'a') {
  const hand = game.players[player].hand;
  const need = hand.length - game.config.handLimit;
  if (need <= 0) return [];

  const combos = findCombos(hand, game.month).filter((c) => c.size > 1);
  const connections = new Map();
  for (const combo of combos) {
    for (const card of combo.cards) {
      connections.set(card.id, (connections.get(card.id) || 0) + 1);
    }
  }

  const ranked = hand
    .map((card) => ({
      card,
      value: singleCardScore(card, game.month) * 1.1 + (connections.get(card.id) || 0) * 1.5,
    }))
    .sort((x, y) => x.value - y.value || x.card.id.localeCompare(y.card.id));

  return ranked.slice(0, need).map((entry) => entry.card.id);
}
