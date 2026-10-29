// 对局状态机：月令、暗出、结算、相克、摸牌权、弃牌、终局
import {
  BRANCH_TABLE,
  CARD_TABLE,
  DEFAULT_CONFIG,
  MONTH_CYCLE,
  MONTH_ELEMENT,
  OVERCOMES,
  STEM_TABLE,
  makeCard,
  mulberry32,
  nextMonth,
  pick,
  prevMonth,
} from './rules.js';
import { findCombos, validateAction } from './combos.js';

export const SIDE_NAME = { p: '你', a: '电脑' };

/**
 * 摸牌权矩阵（纯函数，便于单测）
 * kinds: { p: 'play'|'pass'|'timeout', a: ... }
 */
export function drawRightsFor(kinds, winner) {
  const rights = { p: 0, a: 0 };
  const pPlay = kinds.p === 'play';
  const aPlay = kinds.a === 'play';

  if (pPlay && aPlay) {
    if (winner === 'p') {
      rights.p = 2;
      rights.a = 1;
    } else if (winner === 'a') {
      rights.a = 2;
      rights.p = 1;
    }
    return rights;
  }

  if (pPlay || aPlay) {
    const played = pPlay ? 'p' : 'a';
    const other = played === 'p' ? 'a' : 'p';
    rights[played] = 2;
    if (kinds[other] === 'pass') rights[other] = 1;
    return rights;
  }

  if (kinds.p === 'pass' && kinds.a === 'pass') {
    rights.p = 1;
    rights.a = 1;
  } else if (kinds.p === 'pass') {
    rights.p = 1;
  } else if (kinds.a === 'pass') {
    rights.a = 1;
  }
  return rights;
}

function describeAction(parsed) {
  if (!parsed) return '未出牌';
  if (parsed.kind === 'play') return `${parsed.combo.label}·${parsed.combo.out} ${parsed.combo.score}分`;
  if (parsed.kind === 'pass') return '空过';
  return '超时';
}

export class Game {
  constructor({ seed = Date.now(), config = {}, startMonth = null, direction = null } = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
    this.seed = seed >>> 0;
    this.rng = mulberry32(this.seed);
    this.cardSeq = 0;

    this.round = 1;
    this.maxRounds = this.config.maxRounds;
    this.phase = 'select';
    this.direction = direction === 1 || direction === -1 ? direction : (this.rng() < 0.5 ? 1 : -1);
    this.month = MONTH_CYCLE.includes(startMonth) ? startMonth : pick(this.rng, MONTH_CYCLE);
    this.startMonth = this.month;
    this.players = {
      p: { id: 'p', name: '你', hand: [], total: 0 },
      a: { id: 'a', name: '电脑', hand: [], total: 0 },
    };
    this.log = [];
    this.history = [];
    this.lastResult = null;
    this.gameOver = false;
    this.swapUsed = { p: false, a: false };
    this.swapState = null;
    this.stats = {
      rounds: 0,
      plays: 0,
      passes: 0,
      timeouts: 0,
      combos: {},
      draws: { p: 0, a: 0 },
      discards: { p: 0, a: 0 },
    };

    this.deal();
    this.pushLog(
      `对局开始 · 首月令「${this.month}月」（${MONTH_ELEMENT[this.month]}旺）· ${this.direction > 0 ? '顺行' : '逆行'} · 共 ${this.maxRounds} 回合`,
      'system',
    );
  }

  get monthElement() {
    return MONTH_ELEMENT[this.month];
  }

  get nextMonthName() {
    return this.direction > 0 ? nextMonth(this.month) : prevMonth(this.month);
  }

  newCard(name) {
    this.cardSeq += 1;
    return makeCard(name, `c${this.cardSeq}`);
  }

  randomName(table) {
    return pick(this.rng, table).name;
  }

  drawRandomCard() {
    return this.newCard(this.randomName(CARD_TABLE));
  }

  fillHand(side) {
    const hand = this.players[side].hand;
    for (let i = 0; i < this.config.initialStems; i += 1) {
      hand.push(this.newCard(this.randomName(STEM_TABLE)));
    }
    for (let i = 0; i < this.config.initialBranches; i += 1) {
      hand.push(this.newCard(this.randomName(BRANCH_TABLE)));
    }
  }

  deal() {
    for (const side of ['p', 'a']) this.fillHand(side);
  }

  pushLog(text, tone = 'system') {
    this.log.push({ round: this.round, text, tone });
    if (this.log.length > 240) this.log.shift();
  }

  handOf(side) {
    return this.players[side].hand;
  }

  legalActions(side) {
    return findCombos(this.players[side].hand, this.month).map((combo) => ({
      kind: 'play',
      comboType: combo.type,
      cardIds: combo.cards.map((c) => c.id),
      combo,
    }));
  }

  /** 双方同时暗出 → 结算本回合。任何一方动作非法都会直接抛错。 */
  resolveRound(actions) {
    if (this.phase !== 'select') throw new Error('当前阶段不能出牌');
    if (!actions || !actions.p || !actions.a) throw new Error('双方动作缺失');

    const parsed = {};
    for (const side of ['p', 'a']) {
      const action = actions[side];
      if (action.kind === 'play') {
        const check = validateAction(this.players[side].hand, action, this.month);
        if (!check.ok) {
          throw new Error(`非法出牌（${SIDE_NAME[side]}）：${check.reason}`);
        }
        parsed[side] = { kind: 'play', combo: check.combo };
      } else if (action.kind === 'pass' || action.kind === 'timeout') {
        parsed[side] = { kind: action.kind };
      } else {
        throw new Error('未知动作类型');
      }
    }

    const pPlay = parsed.p.kind === 'play';
    const aPlay = parsed.a.kind === 'play';

    // 出牌时的月令结算；先扣牌（仅使用已校验的组合实例）
    for (const side of ['p', 'a']) {
      if (parsed[side].kind !== 'play') continue;
      const ids = new Set(parsed[side].combo.cards.map((c) => c.id));
      this.players[side].hand = this.players[side].hand.filter((c) => !ids.has(c.id));
    }

    const baseScores = {
      p: pPlay ? parsed.p.combo.score : 0,
      a: aPlay ? parsed.a.combo.score : 0,
    };

    const restraint = { p: 0, a: 0 };
    if (pPlay && aPlay) {
      const pe = parsed.p.combo.out;
      const ae = parsed.a.combo.out;
      if (OVERCOMES[pe] === ae) {
        restraint.p += 1;
        restraint.a -= 1;
      }
      // 五行单循环中双向克制不可能同时成立；保留防御式判断
      if (OVERCOMES[ae] === pe) {
        restraint.a += 1;
        restraint.p -= 1;
      }
    }

    const roundScores = {
      p: baseScores.p + restraint.p,
      a: baseScores.a + restraint.a,
    };

    let winner = null;
    let diff = 0;
    if (pPlay && aPlay) {
      if (roundScores.p > roundScores.a) {
        winner = 'p';
        diff = roundScores.p - roundScores.a;
      } else if (roundScores.a > roundScores.p) {
        winner = 'a';
        diff = roundScores.a - roundScores.p;
      }
    } else if (pPlay) {
      winner = 'p';
      diff = roundScores.p;
    } else if (aPlay) {
      winner = 'a';
      diff = roundScores.a;
    }

    const totalBefore = { p: this.players.p.total, a: this.players.a.total };
    if (winner && diff > 0) this.players[winner].total += diff;
    const totalAfter = { p: this.players.p.total, a: this.players.a.total };

    const handCounts = {
      p: this.players.p.hand.length,
      a: this.players.a.hand.length,
    };
    const isFinalRound = this.round >= this.maxRounds;
    const endReason = isFinalRound ? 'round-limit' : null;
    // 手牌打空不再终局：下一摸牌阶段必须补满 8 张（4 天干 + 4 地支）
    const refill = {
      p: !isFinalRound && handCounts.p === 0,
      a: !isFinalRound && handCounts.a === 0,
    };

    const kinds = { p: parsed.p.kind, a: parsed.a.kind };
    const drawRights = drawRightsFor(kinds, winner);

    const publicAction = (parsedSide) => {
      if (parsedSide.kind === 'play') {
        return {
          kind: 'play',
          label: parsedSide.combo.label,
          out: parsedSide.combo.out,
          cardCount: parsedSide.combo.size,
          score: parsedSide.combo.score,
          monthBonus: parsedSide.combo.monthBonus || 0,
        };
      }
      return { kind: parsedSide.kind, label: parsedSide.kind === 'pass' ? '空过' : '超时' };
    };

    const revealOf = (parsedSide) => {
      if (parsedSide.kind !== 'play') return null;
      return {
        element: parsedSide.combo.out,
        score: parsedSide.combo.score,
        comboType: parsedSide.combo.type,
        comboLabel: parsedSide.combo.label,
        bonus: parsedSide.combo.bonus,
        monthBonus: parsedSide.combo.monthBonus || 0,
        cardCount: parsedSide.combo.size,
      };
    };

    const result = {
      round: this.round,
      month: this.month,
      monthElement: MONTH_ELEMENT[this.month],
      direction: this.direction,
      nextMonth: this.direction > 0 ? nextMonth(this.month) : prevMonth(this.month),
      actions: { p: publicAction(parsed.p), a: publicAction(parsed.a) },
      reveals: { p: revealOf(parsed.p), a: revealOf(parsed.a) },
      baseScores,
      restraint,
      roundScores,
      winner,
      diff,
      totalBefore,
      totalAfter,
      drawRights,
      handCounts,
      refill,
      maxRounds: this.maxRounds,
      gameOver: Boolean(endReason),
      endReason,
    };

    this.stats.rounds += 1;
    for (const side of ['p', 'a']) {
      if (parsed[side].kind === 'play') {
        this.stats.plays += 1;
        const type = parsed[side].combo.type;
        this.stats.combos[type] = (this.stats.combos[type] || 0) + 1;
      } else if (parsed[side].kind === 'pass') {
        this.stats.passes += 1;
      } else {
        this.stats.timeouts += 1;
      }
    }

    this.pushLog(
      `第${this.round}回合｜你 ${describeAction(parsed.p)}｜电脑 ${describeAction(parsed.a)}`,
      'system',
    );
    if (winner) {
      this.pushLog(
        `${SIDE_NAME[winner]} 拿下本回合 +${diff} 分 · 总分 ${totalAfter.p} : ${totalAfter.a}`,
        winner === 'p' ? 'you' : 'ai',
      );
    } else if (pPlay && aPlay) {
      this.pushLog('本回合平局，双方总分不变', 'system');
    } else {
      this.pushLog('双方均未出牌，本回合 0 分', 'system');
    }
    if (refill.p || refill.a) {
      const who = [refill.p ? '你' : '', refill.a ? '电脑' : ''].filter(Boolean).join('、');
      this.pushLog(`${who} 手牌打空，下个摸牌阶段必须补满 8 张（不终局）`, 'system');
    }
    if (endReason === 'round-limit') {
      this.pushLog(`${this.maxRounds} 回合已满，本回合结算后终局`, 'score');
    }

    this.lastResult = result;
    this.history.push(result);
    this.phase = 'reveal';
    return result;
  }

  /** 揭示后继续：终局优先；否则换月令进入摸牌阶段。 */
  continueAfterReveal() {
    if (this.phase !== 'reveal') throw new Error('当前阶段不能继续');
    if (this.lastResult?.gameOver) {
      this.gameOver = true;
      this.phase = 'over';
      this.pushLog(
        `${this.maxRounds} 回合结束 · 最终比分 ${this.players.p.total} : ${this.players.a.total}`,
        'score',
      );
      return { over: true };
    }
    const from = this.month;
    this.month = this.direction > 0 ? nextMonth(this.month) : prevMonth(this.month);
    this.phase = 'draw';
    const dirText = this.direction > 0 ? '顺行' : '逆行';
    this.pushLog(
      `月令${dirText}：「${from}月」→「${this.month}月」· ${MONTH_ELEMENT[this.month]}旺（下月 ${this.nextMonthName}）`,
      'system',
    );
    this.beginDrawPhase();
    return { over: false, month: this.month };
  }

  /** 生成一个 4 天干 + 4 地支的公共牌池 */
  makeDrawPool() {
    const pool = [];
    for (let i = 0; i < 4; i += 1) pool.push(this.newCard(this.randomName(STEM_TABLE)));
    for (let i = 0; i < 4; i += 1) pool.push(this.newCard(this.randomName(BRANCH_TABLE)));
    return pool;
  }

  /**
   * 摸牌计划：
   * - 有赢家：赢家先选 0–2 张（也可以不摸），输家随后可选 0–1 张
   * - 双空过：双方各可选 0–1 张，按你→电脑顺序
   * - 超时方无摸牌权
   * - 手牌打空者不参与牌池，改为补满 8 张
   */
  buildDrawPlan() {
    const refill = this.lastResult.refill || { p: false, a: false };
    const rights = this.lastResult.drawRights || { p: 0, a: 0 };
    const winner = this.lastResult.winner;
    const cap = {
      p: refill.p ? 0 : rights.p || 0,
      a: refill.a ? 0 : rights.a || 0,
    };
    const steps = [];
    const add = (side) => {
      if (cap[side] <= 0) return;
      steps.push({
        side,
        min: 0,
        max: cap[side],
      });
    };
    if (winner) {
      add(winner);
      add(winner === 'p' ? 'a' : 'p');
    } else {
      add('p');
      add('a');
    }
    return { refill, rights, winner, steps };
  }

  /** 打开弃1摸1暗池：暂移除原牌，生成 4 天干 + 4 地支供盲选 */
  beginSwap(side, cardId) {
    if (this.phase !== 'select') throw new Error('当前阶段不能换牌');
    if (this.swapUsed[side]) throw new Error('本回合已经换过牌');
    if (this.swapState) throw new Error('换牌池已经打开');
    const hand = this.players[side].hand;
    const card = hand.find((c) => c.id === cardId);
    if (!card) throw new Error('换牌不在手牌中');
    const cards = [
      ...Array.from({ length: 4 }, () => this.newCard(this.randomName(STEM_TABLE))),
      ...Array.from({ length: 4 }, () => this.newCard(this.randomName(BRANCH_TABLE))),
    ];
    this.players[side].hand = hand.filter((c) => c.id !== cardId);
    this.swapState = { side, original: card, cards };
    return { cards, originalCard: card };
  }

  /** 从暗池选中 1 张；其余 7 张丢弃 */
  claimSwap(side, cardId) {
    const state = this.swapState;
    if (!state || state.side !== side) throw new Error('没有可用的换牌池');
    const card = state.cards.find((c) => c.id === cardId);
    if (!card) throw new Error('换牌池中没有这张牌');
    this.players[side].hand.push(card);
    this.swapUsed[side] = true;
    this.swapState = null;
    this.stats.discards[side] += 1;
    this.stats.draws[side] += 1;
    this.pushLog(`换牌｜${SIDE_NAME[side]} 弃 1 张并重新摸 1 张`, side === 'p' ? 'you' : 'ai');
    return card;
  }

  /** 取消换牌：原牌退回手牌，不消耗本回合换牌次数 */
  cancelSwap(side) {
    const state = this.swapState;
    if (!state || state.side !== side) throw new Error('没有可取消的换牌池');
    this.players[side].hand.push(state.original);
    this.swapState = null;
    return state.original;
  }

  /** 每回合一次的弃 1 摸 1（不消耗出牌权） */
  swapHand(side, cardId) {
    if (this.phase !== 'select') throw new Error('当前阶段不能换牌');
    if (this.swapUsed[side]) throw new Error('本回合已经换过牌');
    const hand = this.players[side].hand;
    const card = hand.find((c) => c.id === cardId);
    if (!card) throw new Error('换牌不在手牌中');
    this.players[side].hand = hand.filter((c) => c.id !== cardId);
    const next = this.drawRandomCard();
    this.players[side].hand.push(next);
    this.swapUsed[side] = true;
    this.stats.discards[side] += 1;
    this.stats.draws[side] += 1;
    this.pushLog(`换牌｜${SIDE_NAME[side]} 弃 1 张并重新摸 1 张`, side === 'p' ? 'you' : 'ai');
    return next;
  }

  /** 进入摸牌阶段：翻出公共牌池并决定挑牌顺序 */
  beginDrawPhase() {
    const plan = this.buildDrawPlan();
    this.lastResult.drawPlan = plan;
    this.drawPool = plan.steps.length > 0 ? this.makeDrawPool() : [];
    this.drawRefreshed = { p: false, a: false };
    this.lastResult.draws = null;
    this.phase = 'draw';
    if (plan.steps.length > 0) {
      this.pushLog(
        `牌池翻出：4 天干 + 4 地支｜${plan.steps
          .map((s) => `${SIDE_NAME[s.side]} 可选 ${s.min}–${s.max} 张`)
          .join('｜')}`,
        'system',
      );
    }
  }

  availableDraw(side) {
    return this.lastResult?.drawRights?.[side] ?? 0;
  }

  mustRefill(side) {
    return Boolean(this.lastResult?.refill?.[side]);
  }

  /**
   * 结算摸牌：choices[side] 是玩家从公共牌池中选中的 cardId 数组。
   * 打空者不选牌，直接补满 8 张；赢家可选 0–2 张，输家可选 0–1 张。
   */
  applyDraw(choices = {}) {
    if (this.phase !== 'draw') throw new Error('当前阶段不能摸牌');
    const plan = this.lastResult.drawPlan;
    if (!plan) throw new Error('摸牌阶段未初始化');

    const poolMap = new Map(this.drawPool.map((c) => [c.id, c]));
    const picked = { p: [], a: [] };
    const allIds = new Set();

    for (const side of ['p', 'a']) {
      const ids = choices[side] ?? [];
      if (!Array.isArray(ids)) throw new Error('摸牌选择必须是 cardId 数组');
      if (plan.refill[side]) {
        if (ids.length > 0) throw new Error('手牌打空者补满 8 张，不需要从牌池选牌');
        if (this.players[side].hand.length !== 0) throw new Error('补牌玩家手牌不为空');
        continue;
      }
      const step = plan.steps.find((s) => s.side === side);
      if (!step) {
        if (ids.length > 0) throw new Error(`${SIDE_NAME[side]} 本回合无摸牌权`);
        continue;
      }
      if (ids.length < step.min || ids.length > step.max) {
        throw new Error(`${SIDE_NAME[side]} 本回合需从牌池选 ${step.min}–${step.max} 张`);
      }
      if (new Set(ids).size !== ids.length) throw new Error('同一张牌不能重复选择');
      for (const id of ids) {
        const card = poolMap.get(id);
        if (!card) throw new Error('所选牌不在牌池中');
        if (allIds.has(id)) throw new Error('双方不能选择同一张牌');
        allIds.add(id);
        picked[side].push(card);
      }
    }

    const counts = { p: 0, a: 0 };
    const drawn = { p: [], a: [] };
    for (const side of ['p', 'a']) {
      if (plan.refill[side]) {
        const before = this.players[side].hand.length;
        this.fillHand(side);
        drawn[side] = this.players[side].hand.slice(before);
        counts[side] = drawn[side].length;
      } else {
        for (const card of picked[side]) {
          this.players[side].hand.push(card);
          drawn[side].push(card);
        }
        counts[side] = picked[side].length;
      }
      this.stats.draws[side] += counts[side];
    }
    this.drawPool = this.drawPool.filter((c) => !allIds.has(c.id));
    this.lastResult.draws = { ...counts };

    const parts = [];
    for (const side of ['p', 'a']) {
      const name = SIDE_NAME[side];
      if (plan.refill[side]) {
        parts.push(`${name} 手牌打空，补满 ${counts[side]} 张`);
      } else if (plan.steps.length > 0) {
        const stems = picked[side].filter((card) => card.kind === 'stem').length;
        const branches = picked[side].length - stems;
        parts.push(`${name} 从池中拿 ${counts[side]} 张（${stems} 天干 / ${branches} 地支）`);
      }
    }
    const drawLog = parts.length
      ? `摸牌｜${parts.join('｜')}（手牌 ${this.players.p.hand.length} : ${this.players.a.hand.length}）`
      : '摸牌｜本回合双方均无摸牌权';
    this.pushLog(drawLog, 'system');

    const overLimit = ['p', 'a'].some((side) => this.needsDiscard(side));
    if (overLimit) {
      this.phase = 'discard';
    } else {
      this.beginNextRound();
    }
    return { drawn, counts, refill: plan.refill, phase: this.phase };
  }

  /**
   * 刷新牌池：消耗 5 总分，按 kinds（每张 'stem' / 'branch'）生成一组新牌。
   * 新牌加入本阶段的总牌目录，旧牌不删除：另一个玩家可能仍在使用原池。
   * 由 UI 维护每个玩家自己的池视图。
   */
  refreshDrawPool(side, kinds) {
    if (this.phase !== 'draw') throw new Error('当前阶段不能刷新牌池');
    if (!this.drawRefreshed) this.drawRefreshed = { p: false, a: false };
    if (this.drawRefreshed[side]) throw new Error('本回合已经刷新过牌池');
    if (!this.lastResult.drawPlan?.steps.some((s) => s.side === side)) {
      throw new Error('该玩家本回合没有牌池操作');
    }
    if (this.players[side].total < 5) throw new Error('总分不足 5 分，无法刷新牌池');
    if (!Array.isArray(kinds) || kinds.some((kind) => kind !== 'stem' && kind !== 'branch')) {
      throw new Error('kinds 必须是 stem/branch 数组');
    }

    this.players[side].total -= 5;
    const cards = kinds.map((kind) =>
      this.newCard(this.randomName(kind === 'stem' ? STEM_TABLE : BRANCH_TABLE)),
    );
    this.drawPool.push(...cards);
    this.drawRefreshed[side] = true;
    this.pushLog(
      `刷新牌池｜${SIDE_NAME[side]} 消耗 5 总分，刷新 ${cards.length} 张（总分 ${this.players[side].total}）`,
      side === 'p' ? 'you' : 'ai',
    );
    return { cards, total: this.players[side].total, count: cards.length };
  }

  needsDiscard(side) {
    return this.players[side].hand.length > this.config.handLimit;
  }

  /** 玩家自行选择弃牌；必须恰好弃到上限。 */
  discard(side, cardIds) {
    if (this.phase !== 'discard') throw new Error('当前阶段不能弃牌');
    const hand = this.players[side].hand;
    const need = hand.length - this.config.handLimit;
    if (need <= 0) throw new Error('该玩家无需弃牌');
    if (!Array.isArray(cardIds) || cardIds.length !== need) {
      throw new Error(`需要弃置 ${need} 张牌`);
    }
    if (new Set(cardIds).size !== cardIds.length) throw new Error('弃牌不能重复');
    const ids = new Set(cardIds);
    if (![...ids].every((id) => hand.some((c) => c.id === id))) {
      throw new Error('弃牌不在手牌中');
    }

    this.players[side].hand = hand.filter((c) => !ids.has(c.id));
    this.stats.discards[side] += need;
    this.pushLog(`弃牌｜${SIDE_NAME[side]} 弃置 ${need} 张（内容保密）`, side === 'p' ? 'you' : 'ai');

    if (!['p', 'a'].some((s) => this.needsDiscard(s))) {
      this.beginNextRound();
    }
  }

  beginNextRound() {
    this.round += 1;
    this.swapUsed = { p: false, a: false };
    this.swapState = null;
    this.phase = 'select';
    this.pushLog(
      `第 ${this.round}/${this.maxRounds} 回合开始 · ${this.month}月（${MONTH_ELEMENT[this.month]}旺）`,
      'system',
    );
  }
}
