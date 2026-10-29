// UI 装配：暗出、倒计时、揭示、摸牌、弃牌、颜色提示
import { Game } from './engine.js';
import { chooseAction, chooseDiscard, choosePoolPicks } from './ai.js';
import { analyzeSelection, colorHints, isMonthBranch } from './combos.js';
import {
  ELEMENT_COLORS,
  ELEMENT_ORDER,
  MONTH_BRANCH_BONUS,
  MONTH_CYCLE,
  MONTH_ELEMENT,
  BRANCH_TABLE,
  CARD_BY_NAME,
  STEM_TABLE,
  fortuneOf,
  mulberry32,
  monthInfo,
  nextMonth,
  prevMonth,
  singleCardScore,
} from './rules.js';

const $ = (id) => document.getElementById(id);
const PHASE_RADIUS = 34;
const RING_LENGTH = 2 * Math.PI * PHASE_RADIUS;
const DRAW_SECONDS = 60;

const S = {
  game: null,
  timerSeconds: 60,
  interval: null,
  deadline: 0,
  selected: new Set(),
  discardSelected: new Set(),
  poolSelected: new Set(),
  newCards: new Set(),
  draw: null,
  hints: {},
  busy: false,
  revealed: true,
  revealTimeout: null,
  toastTimeout: null,
  rulesPausedRemain: null,
  fxTimer: null,
  fxUnlockTimer: null,
  battleLocked: false,
  autoTimer: null,
  autoDrawTimer: null,
  aiAction: null,
  pendingCombo: null,
  playCards: [],
  playError: null,
  handDrag: null,
  suppressHandClick: false,
  swapCards: null,
  swapOriginal: null,
  swapPausedRemain: null,
  revealFxKey: null,
  flipDone: true,
  flipTimer: null,
  launchSeed: null,
  starting: false,
  spin: null,
  tutorialStep: 0,
  tutorialTimer: null,
  inspectMonth: '寅',
  inspectName: '甲',
  pendingSpinSeed: null,
  scoreDelta: null,
};

// ---------- 初始化 ----------

function randomSeed() {
  return Math.floor(Math.random() * 900000000) + 1;
}

function readUrl() {
  const params = new URLSearchParams(location.search);
  const seed = Number(params.get('seed'));
  const timerRaw = params.get('timer');
  const timer = timerRaw === null ? 60 : Number(timerRaw);
  return {
    seed: Number.isFinite(seed) && seed > 0 ? Math.floor(seed) : randomSeed(),
    timer: [0, 15, 30, 60].includes(timer) ? timer : 60,
  };
}

function updateUrl() {
  const url = new URL(location.href);
  url.searchParams.set('seed', String(S.game.seed));
  if (S.timerSeconds === 60) url.searchParams.delete('timer');
  else url.searchParams.set('timer', String(S.timerSeconds));
  history.replaceState(null, '', url);
}

function newGame(seed = randomSeed(), options = {}) {
  stopTimer();
  clearFx();
  closeSwapDialog();
  S.swapCards = null;
  S.swapOriginal = null;
  S.swapPausedRemain = null;
  S.revealFxKey = null;
  S.scoreDelta = null;
  clearTimeout(S.flipTimer);
  S.flipTimer = null;
  S.flipDone = true;
  clearTimeout(S.autoTimer);
  clearTimeout(S.autoDrawTimer);
  S.autoTimer = null;
  S.autoDrawTimer = null;
  clearTimeout(S.revealTimeout);
  $('overlay').hidden = true;

  S.game = new Game({
    seed,
    startMonth: options.startMonth ?? null,
    direction: options.direction ?? null,
  });
  S.aiAction = chooseAction(S.game, 'a');
  S.pendingCombo = null;
  S.playCards = [];
  S.playError = null;
  S.selected.clear();
  S.discardSelected.clear();
  S.poolSelected.clear();
  S.newCards.clear();
  S.draw = null;
  S.busy = false;
  S.revealed = true;
  S.hints = {};
  S.rulesPausedRemain = null;
  S.battleLocked = false;
  clearTimeout(S.fxUnlockTimer);

  clearBattleFx();
  renderAll();
  startTimer();
  updateUrl();
  toast(`新对局 · 种子 ${S.game.seed}`);
  clearTimeout(S.tutorialTimer);
  S.tutorialTimer = null;
}

// ---------- 总渲染 ----------

function renderAll() {
  const g = S.game;
  const poolIds = new Set(S.playCards.map((card) => card.id));
  S.hints = colorHints(g.players.p.hand.filter((card) => !poolIds.has(card.id)), g.month);
  renderMonth();
  renderScores();
  renderOpponent();
  renderHand();
  renderDuel();
  renderSummary();
  renderPhase();
  renderFortune();
  renderActions();
}

function renderMonth() {
  const g = S.game;
  const info = monthInfo(g.month, g.direction);
  const col = ELEMENT_COLORS[info.element];
  const nextFortune = fortuneOf(info.nextElement, info.next);
  const dirText = g.direction > 0 ? '顺行' : '逆行';
  $('stage-mark').textContent = g.month;
  $('month-card').innerHTML = `
    <div class="month-glyph" style="--el:${col.bg};--edge:${col.edge};--ink:${col.ink}">${g.month}</div>
    <div class="month-meta">
      <b>${g.month}月 · ${info.element}旺</b>
      <small>${dirText} · 下月 ${info.next}月 · ${info.nextElement}${nextFortune.state}</small>
    </div>`;
  renderMonthWheel();
}

function renderMonthWheel() {
  const g = S.game;
  const sequence = [];
  let cursor = g.startMonth;
  for (let i = 0; i < 12; i += 1) {
    sequence.push(cursor);
    cursor = g.direction > 0 ? nextMonth(cursor) : prevMonth(cursor);
  }
  const seqIndex = new Map(sequence.map((month, index) => [month, index]));
  const currentIndex = seqIndex.get(g.month) ?? 0;
  const currentNatural = MONTH_CYCLE.indexOf(g.month);
  const handAngle = currentNatural * 30;

  const nodes = MONTH_CYCLE.map((month, index) => {
    const seq = seqIndex.get(month);
    const state = seq < currentIndex ? 'passed' : seq === currentIndex ? 'current' : 'future';
    const label = state === 'passed' ? '已过' : state === 'current' ? '当前' : '未至';
    return `<span class="wheel-node ${state}" style="--a:${index * 30}deg" title="${month}月 · ${label}">${month}</span>`;
  }).join('');

  $('month-wheel').innerHTML = `
    <div class="wheel-ring">${nodes}</div>
    <div class="wheel-hand" style="--hand-angle:${handAngle}deg"></div>
    <div class="wheel-center"><b>${g.month}</b><span>${MONTH_ELEMENT[g.month]}旺</span></div>`;
  const turnText = g.phase === 'draw' ? '换月' : `第 ${g.round}/12 回合`;
  $('wheel-caption').textContent = `${turnText} · ${g.direction > 0 ? '顺行' : '逆行'} · 已过 ${currentIndex} 个`;
}

function renderScores() {
  const g = S.game;
  const hidden = g.phase === 'reveal'
    && g.lastResult?.totalBefore
    && (!S.revealed || (!S.flipDone && g.lastResult.actions.a.kind === 'play'));
  const p = hidden ? g.lastResult.totalBefore.p : g.players.p.total;
  const a = hidden ? g.lastResult.totalBefore.a : g.players.a.total;
  const dirText = g.direction > 0 ? '顺行' : '逆行';
  const delta = S.scoreDelta;
  const gainP = delta?.side === 'p' ? `<span class="score-gain">+${delta.diff}</span>` : '';
  const gainA = delta?.side === 'a' ? `<span class="score-gain">+${delta.diff}</span>` : '';
  $('scoreboard').innerHTML = `
    <div class="score-side" data-side="p"><span class="score-label">你</span><b class="${p > a ? 'lead' : ''}">${p}</b>${gainP}</div>
    <span class="score-colon">:</span>
    <div class="score-side" data-side="a"><b class="${a > p ? 'lead' : ''}">${a}</b>${gainA}<span class="score-label">电脑</span></div>
    <span class="round-tag">第 ${g.round}/${g.maxRounds} 回合 · ${dirText}</span>`;
}

function renderOpponent() {
  const pending = S.game.phase === 'draw' ? (S.draw?.aiPicks.length || 0) : 0;
  const n = S.game.players.a.hand.length + pending;
  $('ai-count').textContent = `${n} 张 · 推算`;
  $('ai-count').title = '对手手牌张数可由「初始 8 + 摸牌数 − 出牌数 − 弃牌数」推算';
  $('ai-hand').innerHTML = n
    ? Array.from({ length: n }, () => '<span class="card-back" aria-hidden="true"></span>').join('')
    : '<span class="empty-note">已打空</span>';
}

function stateText(fortune) {
  if (fortune.delta === 0) return fortune.state;
  return `${fortune.state}${fortune.delta > 0 ? '+' : ''}${fortune.delta}`;
}

function cardHTML(card, options = {}) {
  const g = S.game;
  const pool = options.pool === true;
  const f = fortuneOf(card.element, g.month);
  const col = ELEMENT_COLORS[card.element];
  const hint = S.hints[card.id] || { colors: [], details: [] };
  const inDiscardMode = !pool && g.phase === 'discard';
  const monthCard = isMonthBranch(card, g.month);
  // 牌面显示单牌实际分数：月令支固定 10，其他 5 + 2×旺相
  const score = singleCardScore(card, g.month);

  const classes = ['card'];
  if (pool) {
    if (S.poolSelected.has(card.id)) classes.push('is-selected');
  } else if (inDiscardMode && S.discardSelected.has(card.id)) classes.push('is-discard-selected');
  else if (!inDiscardMode && S.selected.has(card.id)) classes.push('is-selected');
  if (!pool && S.newCards.has(card.id)) classes.push('is-new');
  if (monthCard) classes.push('is-month');

  const subs = hint.colors
    .map((element) => {
      const sub = ELEMENT_COLORS[element];
      return `<i class="sub" style="--sub:${sub.bg};--sub-ink:${sub.ink}" title="可合化为「${element}」">${element}</i>`;
    })
    .join('');

  const kindLabel = `${card.kind === 'stem' ? '天干' : '地支'} · ${card.name}`;
  const titleLines = [
    `${card.name} · ${card.kind === 'stem' ? '天干' : '地支'} · ${card.element} · ${stateText(f)} · 单牌 ${score} 分${monthCard ? '（含月令支 +5）' : ''}`,
  ];
  for (const detail of hint.details) {
    titleLines.push(`${detail.label} → ${detail.out}（配 ${detail.others.join('、')}）`);
  }

  if (hint.colors.length) titleLines.push(`副色：${hint.colors.join('、')}`);
  const title = titleLines.join('\n');

  return `<button type="button" class="${classes.join(' ')}" data-id="${card.id}"
      style="--el:${col.bg};--ink:${col.ink};--edge:${col.edge}"
      title="${title}" aria-label="${card.name}，${card.element}，单牌 ${score} 分">
    <span class="card-kind">${kindLabel}</span>
    ${monthCard ? '<span class="card-month" title="月令支：作为单牌打出 +5 分">令+5</span>' : ''}
    <span class="card-score">${score}</span>
    <span class="card-char" aria-hidden="true">${card.name}</span>
    <span class="card-subs">${subs}</span>
    <span class="card-foot">
      <span class="card-el">${card.element}</span>
      <span class="card-state">${stateText(f)}</span>
    </span>
  </button>`;
}

function elementSlotHTML(kind, element, cards) {
  const col = ELEMENT_COLORS[element];
  const cardsHTML = cards.length
    ? cards.map(cardHTML).join('')
    : '<span class="slot-empty">空</span>';
  return `<div class="element-slot${cards.length ? '' : ' is-empty'}" data-element="${element}" data-kind="${kind}" style="--el:${col.bg};--el-ink:${col.ink}">
    <div class="element-slot-head">
      <i class="el-dot"></i><span>${element}</span><b>${cards.length}</b>
    </div>
    <div class="slot-cards">${cardsHTML}</div>
  </div>`;
}

function elementRowHTML(label, kind, cards) {
  const slots = ELEMENT_ORDER
    .map((element) => elementSlotHTML(kind, element, cards.filter((card) => card.element === element)))
    .join('');
  return `<div class="element-row" data-kind="${kind}">
    <div class="element-row-head"><span>${label}</span><small>${cards.length}</small></div>
    <div class="element-slots">${slots}</div>
  </div>`;
}

function renderHand() {
  const all = S.game.players.p.hand;
  const pool = S.playCards;
  const poolIds = new Set(pool.map((card) => card.id));
  const hand = all.filter((card) => !poolIds.has(card.id));
  const stems = hand.filter((c) => c.kind === 'stem');
  const branches = hand.filter((c) => c.kind === 'branch');
  const poolNote = pool.length ? ` · 出牌池 ${pool.length} 张` : '';
  $('p-count').textContent = `${all.length} 张 · 天干 ${stems.length} / 地支 ${branches.length}${poolNote}`;

  // 重绘时保留每个五行槽内部的滚动位置
  const prevScroll = [...document.querySelectorAll('#p-hand .slot-cards')].map((el) => el.scrollLeft);
  $('p-hand').innerHTML = hand.length
    ? `${elementRowHTML('天干', 'stem', stems)}${elementRowHTML('地支', 'branch', branches)}`
    : pool.length
      ? `<span class="hand-empty">出牌池有 ${pool.length} 张牌，等待出牌</span>`
      : '<span class="hand-empty">手牌已打空</span>';
  [...document.querySelectorAll('#p-hand .slot-cards')].forEach((el, i) => {
    if (prevScroll[i]) el.scrollLeft = prevScroll[i];
  });
}


function previewCardHTML(combo) {
  const col = ELEMENT_COLORS[combo.out];
  const sizeText = combo.size > 1 ? ` · ${combo.size}张` : '';
  return `<div class="outcome preview-card" style="--el:${col.bg};--ink:${col.ink};--edge:${col.edge}">
    <span class="outcome-el">${combo.out}</span>
    <span class="outcome-label">${combo.label}${sizeText}</span>
    <span class="outcome-score">${combo.score}<small>分</small></span>
  </div>`;
}

function outcomeHTML(action, reveal, revealed, extraClass = '') {
  if (action.kind !== 'play') {
    return `<div class="outcome empty">
      <span class="outcome-el">—</span>
      <span class="outcome-label">${action.label}</span>
      <span class="outcome-note">未产出五行牌</span>
    </div>`;
  }
  if (!revealed) {
    return `<div class="outcome empty">
      <span class="outcome-el">?</span>
      <span class="outcome-label">揭示中</span>
    </div>`;
  }
  const col = ELEMENT_COLORS[reveal.element];
  return `<div class="outcome reveal-in ${extraClass}" style="--el:${col.bg};--ink:${col.ink};--edge:${col.edge}">
    <span class="outcome-el">${reveal.element}</span>
    <span class="outcome-label">${reveal.comboLabel}</span>
    <span class="outcome-score">${reveal.score}<small>分</small></span>
  </div>`;
}

function aiFlipHTML(action, reveal) {
  return `<div class="ai-flip"><div class="ai-flip-inner">
    <div class="ai-flip-back card-back tall" aria-hidden="true"></div>
    <div class="ai-flip-front">${outcomeHTML(action, reveal, true, 'ai-front')}</div>
  </div></div>`;
}

function playPoolHTML() {
  const pool = S.playCards;
  const combo = S.pendingCombo;
  if (!pool.length) {
    return `<div class="play-pool is-empty" data-play-pool>
      <span class="play-pool-empty">拖牌到这里</span>
      <small>1–3 张 · 能合自动合成</small>
    </div>`;
  }
  const minis = pool.map((card) => `<i class="pool-mini" data-el="${card.element}">${card.name}</i>`).join('');
  return `<div class="play-pool is-filled" data-play-pool>
    <div class="pool-minis">${minis}</div>
    ${combo
      ? `<span class="pool-join">→</span>${previewCardHTML(combo)}`
      : '<span class="pool-invalid">不能成局</span>'}
  </div>`;
}

function renderDuel() {
  const g = S.game;
  if (g.phase === 'draw') {
    $('duel').hidden = true;
    $('draw-pool').hidden = false;
    renderDrawPool();
    return;
  }
  $('duel').hidden = false;
  $('draw-pool').hidden = true;
  if (g.phase === 'select' || !g.lastResult) {
    const aiPlay = S.aiAction?.kind === 'play';
    $('duel').innerHTML = `
      <div class="duel-slot play-pool-slot" data-side="p">
        <span class="duel-name">你 · 出牌池</span>
        ${playPoolHTML()}
      </div>
      <span class="vs">VS</span>
      <div class="duel-slot" data-side="a">
        <span class="duel-name ai">电脑</span>
        ${aiPlay ? '<span class="card-back tall duel-hidden" aria-label="电脑已出牌，牌面隐藏"></span>' : '<span class="duel-wait">空过</span>'}
      </div>`;
    return;
  }
  const r = g.lastResult;
  if (!S.revealed) {
    const playerCard = outcomeHTML(r.actions.p, r.reveals.p, true, 'player-slam');
    const aiSide = r.actions.a.kind === 'play'
      ? '<div class="ai-await"><span class="card-back tall duel-hidden"></span><span class="ai-await-label">对方暗牌</span></div>'
      : outcomeHTML(r.actions.a, r.reveals.a, true);
    $('duel').innerHTML = `
      <div class="duel-slot" data-side="p"><span class="duel-name">你</span>${playerCard}</div>
      <span class="vs">VS</span>
      <div class="duel-slot" data-side="a"><span class="duel-name ai">电脑</span>${aiSide}</div>`;
    return;
  }
  const aiCard = r.actions.a.kind === 'play'
    ? aiFlipHTML(r.actions.a, r.reveals.a)
    : outcomeHTML(r.actions.a, r.reveals.a, true);
  $('duel').innerHTML = `
    <div class="duel-slot" data-side="p"><span class="duel-name">你</span>${outcomeHTML(r.actions.p, r.reveals.p, true)}</div>
    <span class="vs">VS</span>
    <div class="duel-slot" data-side="a"><span class="duel-name ai">电脑</span>${aiCard}</div>`;
  if (S.revealed) {
    const key = `${g.round}:${r.actions.p.kind}:${r.actions.a.kind}:${r.reveals.p?.score ?? '-'}:${r.reveals.a?.score ?? '-'}`;
    if (S.revealFxKey !== key) {
      S.revealFxKey = key;
      $('duel').classList.remove('is-revealing');
      void $('duel').offsetWidth;
      $('duel').classList.add('is-revealing');
      setTimeout(() => $('duel').classList.remove('is-revealing'), 900);
    }
  }
}

const reduceMotion = () => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

function fxLayer() {
  let layer = document.querySelector('.fx-layer');
  if (!layer) {
    layer = document.createElement('div');
    layer.className = 'fx-layer';
    document.body.append(layer);
  }
  return layer;
}

function clearFx() {
  document.querySelectorAll('.fx-layer').forEach((node) => node.remove());
  document.querySelectorAll('.duel.is-casting').forEach((node) => node.classList.remove('is-casting'));
}

function fxSpark(x, y, color, count = 12) {
  if (reduceMotion()) return;
  const layer = fxLayer();
  for (let i = 0; i < count; i += 1) {
    const spark = document.createElement('i');
    spark.className = 'fx-spark';
    const angle = (Math.PI * 2 * i) / count + Math.random() * 0.35;
    const dist = 26 + Math.random() * 58;
    spark.style.left = `${x}px`;
    spark.style.top = `${y}px`;
    spark.style.background = color;
    spark.style.color = color;
    spark.animate(
      [
        { transform: 'translate(-50%, -50%) scale(1)', opacity: 0.95 },
        {
          transform: `translate(calc(-50% + ${Math.cos(angle) * dist}px), calc(-50% + ${Math.sin(angle) * dist}px)) scale(0.15)`,
          opacity: 0,
        },
      ],
      { duration: 520 + Math.random() * 260, easing: 'cubic-bezier(.16,.8,.3,1)', fill: 'forwards' },
    ).onfinish = () => spark.remove();
    layer.append(spark);
  }
}

function fxRing(x, y, color) {
  if (reduceMotion()) return;
  const ring = document.createElement('i');
  ring.className = 'fx-ring';
  ring.style.left = `${x}px`;
  ring.style.top = `${y}px`;
  ring.style.borderColor = color;
  ring.animate(
    [
      { transform: 'translate(-50%, -50%) scale(.2)', opacity: 0.9 },
      { transform: 'translate(-50%, -50%) scale(2.8)', opacity: 0 },
    ],
    { duration: 720, easing: 'cubic-bezier(.16,.8,.3,1)', fill: 'forwards' },
  ).onfinish = () => ring.remove();
  fxLayer().append(ring);
}

function captureCardVisuals(cards) {
  return cards.map((card) => {
    const el = document.querySelector(`#p-hand .card[data-id="${card.id}"]`);
    if (!el) return null;
    const r = el.getBoundingClientRect();
    return { rect: r, card };
  }).filter(Boolean);
}

/** 转化/合成：选中的牌收束到中央，炸出五行光效，预览牌落定 */
function playForgeFx(visuals, target, combo) {
  if (!target) return;
  const col = ELEMENT_COLORS[combo.out];
  target.classList.add('is-forged');
  setTimeout(() => target.classList.remove('is-forged'), 900);
  if (!visuals.length || reduceMotion()) return;
  const layer = fxLayer();
  const tr = target.getBoundingClientRect();
  const cx = tr.left + tr.width / 2;
  const cy = tr.top + tr.height / 2;

  visuals.forEach(({ rect, card }, index) => {
    const shard = document.createElement('div');
    shard.className = 'fx-forge-card';
    shard.textContent = card.name;
    shard.style.left = `${rect.left}px`;
    shard.style.top = `${rect.top}px`;
    shard.style.width = `${rect.width}px`;
    shard.style.height = `${rect.height}px`;
    shard.style.background = `linear-gradient(160deg, rgba(255,255,255,.18), rgba(0,0,0,.2)), ${ELEMENT_COLORS[card.element].bg}`;
    shard.style.color = ELEMENT_COLORS[card.element].ink;
    shard.style.borderColor = ELEMENT_COLORS[card.element].edge;
    layer.append(shard);
    const dx = cx - (rect.left + rect.width / 2);
    const dy = cy - (rect.top + rect.height / 2);
    shard.animate(
      [
        { transform: 'translate(0,0) scale(1) rotate(0deg)', opacity: 0.95 },
        {
          transform: `translate(${dx}px, ${dy}px) scale(.28) rotate(${index % 2 ? 9 : -9}deg)`,
          opacity: 0,
        },
      ],
      {
        duration: 560,
        delay: index * 55,
        easing: 'cubic-bezier(.2,.72,.2,1)',
        fill: 'forwards',
      },
    ).onfinish = () => shard.remove();
  });

  fxRing(cx, cy, col.edge);
  fxSpark(cx, cy, col.edge, 16);
  target.animate(
    [
      { transform: 'scale(.76) rotate(-3deg)', filter: 'brightness(2.1)' },
      { transform: 'scale(1.06) rotate(1deg)', filter: 'brightness(1.15)', offset: 0.62 },
      { transform: 'scale(1) rotate(0deg)', filter: 'brightness(1)' },
    ],
    { duration: 660, easing: 'cubic-bezier(.18,.8,.22,1)', fill: 'both' },
  );
}

/** 出牌：预览牌向前射出，拖尾扫过对战槽 */
function playCastFx(preview, combo) {
  if (!preview || reduceMotion()) return;
  const col = ELEMENT_COLORS[combo.out];
  const r = preview.getBoundingClientRect();
  const layer = fxLayer();

  const cast = document.createElement('div');
  cast.className = 'fx-cast-card';
  cast.style.left = `${r.left}px`;
  cast.style.top = `${r.top}px`;
  cast.style.width = `${r.width}px`;
  cast.style.height = `${r.height}px`;
  cast.style.background = `linear-gradient(160deg, rgba(255,255,255,.2), rgba(0,0,0,.18)), ${col.bg}`;
  cast.style.color = col.ink;
  cast.style.borderColor = col.edge;
  cast.innerHTML = `<b>${combo.out}</b><span>${combo.label}</span><em>${combo.score}</em>`;
  layer.append(cast);
  cast.animate(
    [
      { transform: 'translate(0,0) scale(1) rotate(0deg)', opacity: 1 },
      { transform: 'translate(0, 10px) scale(.94) rotate(-1deg)', opacity: 0 },
    ],
    { duration: 360, easing: 'cubic-bezier(.2,.8,.2,1)', fill: 'forwards' },
  ).onfinish = () => cast.remove();

  const px = r.left + r.width / 2;
  const py = r.top + r.height / 2;
  fxRing(px, py, col.edge);
  fxSpark(px, py, col.edge, 8);

  // 视线转向对手暗牌，等待它翻面
  const aiBack = document.querySelector('.duel-slot[data-side="a"] .card-back');
  if (aiBack) {
    const ar = aiBack.getBoundingClientRect();
    const ax = ar.left + ar.width / 2;
    const ay = ar.top + ar.height / 2;
    fxRing(ax, ay, '#8bb6d8');
    fxSpark(ax, ay, '#8bb6d8', 7);
    $('duel').classList.add('is-focus-a');
    setTimeout(() => $('duel').classList.remove('is-focus-a'), 760);
  }
}

function clearBattleFx() {
  clearTimeout(S.fxTimer);
  S.fxTimer = null;
  if (S.scoreDelta) {
    S.scoreDelta = null;
    renderScores();
  }
  document.querySelectorAll('.damage-float, .impact-burst, .score-gain').forEach((node) => node.remove());
  document.querySelectorAll('.duel-slot').forEach((node) => {
    node.classList.remove('is-winner', 'is-loser', 'is-tie');
  });
  document.querySelectorAll('.score-side').forEach((node) => {
    node.classList.remove('is-hit', 'is-win');
  });
  document.querySelectorAll('.table').forEach((node) => node.classList.remove('battle-shake'));
  $('battle-flash').classList.remove('show');
}

function addDamage(slot, text, plus = false) {
  if (!slot) return;
  const span = document.createElement('span');
  span.className = `damage-float${plus ? ' plus' : ''}`;
  span.textContent = text;
  slot.append(span);
}

/** 回合胜利战斗反馈：胜方撞击、败方受击、飘分差、分数脉冲 */
function runBattleEffect(result) {
  if (!result || S.game.lastResult !== result || S.game.phase !== 'reveal') return;
  if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  clearBattleFx();
  const duel = $('duel');
  const slots = {
    p: duel.querySelector('[data-side="p"]'),
    a: duel.querySelector('[data-side="a"]'),
  };
  const scores = {
    p: document.querySelector('.score-side[data-side="p"]'),
    a: document.querySelector('.score-side[data-side="a"]'),
  };

  if (result.winner) {
    const winner = result.winner;
    slots[winner].classList.add('is-winner');
    S.scoreDelta = { side: winner, diff: result.diff };
    renderScores();
    document.querySelector(`.score-side[data-side="${winner}"]`)?.classList.add('is-win');
    const wr = slots[winner].getBoundingClientRect();
    fxRing(wr.left + wr.width / 2, wr.top + wr.height / 2, '#f1d795');
    fxSpark(wr.left + wr.width / 2, wr.top + wr.height / 2, '#f1d795', 14);
    S.fxTimer = setTimeout(clearBattleFx, 1500);
    return;
  }

  if (result.actions.p.kind === 'play' && result.actions.a.kind === 'play') {
    slots.p.classList.add('is-tie');
    slots.a.classList.add('is-tie');
    const tie = document.createElement('span');
    tie.className = 'damage-float tie';
    tie.textContent = '平局';
    duel.append(tie);
    S.fxTimer = setTimeout(clearBattleFx, 1300);
  }
}

function renderDrawPool() {
  const box = $('draw-pool');
  const d = S.draw;
  if (!d) {
    box.innerHTML = '';
    return;
  }
  const step = d.humanStep;
  const selected = S.poolSelected.size;
  const noPool = d.plan.steps.length === 0;
  const refilling = d.plan.refill.p || d.plan.refill.a;

  if (noPool) {
    box.innerHTML = `
      <div class="draw-pool-head">
        <span class="pool-title">${refilling ? '补牌阶段' : '摸牌阶段'}</span>
        <span>${refilling ? '手牌打空 · 直接补满 8 张' : '本回合无人可摸牌'}</span>
      </div>
      <div class="pool-empty">${refilling ? '不经过牌池，直接补满 4 天干 + 4 地支' : '双方都没有摸牌权'}</div>`;
    return;
  }

  const faceUp = Boolean(step);
  const aiTaken = d.aiPicks.length;
  const aiStems = d.aiPicks.filter((card) => card.kind === 'stem').length;
  const aiBranches = aiTaken - aiStems;
  const aiNote = aiTaken ? `电脑已先拿 ${aiTaken} 张（${aiStems} 天干 / ${aiBranches} 地支） · ` : '';
  let hint;
  if (step) {
    hint = `${aiNote}${step.min === step.max ? `必须挑 ${step.max} 张` : `可选 0–${step.max} 张`}`;
  } else if (d.needsContinue) {
    hint = '电脑已从牌池挑完';
  } else {
    hint = '等待挑牌…';
  }

  const slots = d.slots;
  const row = (kind) => {
    const label = kind === 'stem' ? '天干' : '地支';
    const cells = slots
      .filter((slot) => slot.card.kind === kind)
      .map((slot) => {
        if (slot.takenBy) {
          return `<div class="pool-slot is-empty" data-kind="${kind}">
            <span class="slot-kind">${label}</span>
            <span class="slot-taken">${slot.takenBy === 'p' ? '你' : '电脑'}已取</span>
          </div>`;
        }
        if (!faceUp) {
          return `<div class="pool-slot is-hidden" data-kind="${kind}">
            <span class="slot-kind">${label}</span>
            <span class="pool-back">?</span>
          </div>`;
        }
        return `<div class="pool-slot">${cardHTML(slot.card, { pool: true })}</div>`;
      })
      .join('');
    return `<div class="pool-row"><span class="pool-row-label">${label}</span><div class="pool-slots">${cells}</div></div>`;
  };

  box.innerHTML = `
    <div class="draw-pool-head">
      <span class="pool-title">公共牌池</span>
      <span>${hint} · 剩余 ${d.pool.length} 张${step ? ` · 已选 ${selected}` : ''}</span>
    </div>
    <div class="pool-grid">${row('stem')}${row('branch')}</div>
    ${!step && !d.needsContinue ? '<div class="pool-empty">等待电脑挑牌…</div>' : ''}`;
}

/** 进入摸牌阶段：翻出公共牌池，按摸牌计划先让 AI 挑，轮到玩家时停下 */
function enterDrawPhase() {
  const g = S.game;
  const plan = g.lastResult.drawPlan;
  const view = { slots: g.drawPool.map((card) => ({ card, takenBy: null })) };
  S.draw = {
    pool: view.slots.map((slot) => slot.card),
    slots: view.slots,
    aiSlots: view.slots,
    plan,
    stepIndex: 0,
    humanPicks: [],
    aiPicks: [],
    humanStep: null,
    humanActed: false,
    needsContinue: false,
  };
  S.poolSelected.clear();
  advanceDraw();
  if (S.draw?.humanStep) {
    startDrawTimer();
  } else {
    setIdleTimer();
    scheduleAutoDraw();
  }
  renderAll();
}

function advanceDraw() {
  const g = S.game;
  const d = S.draw;
  if (!d) return;
  while (d.stepIndex < d.plan.steps.length) {
    const step = d.plan.steps[d.stepIndex];
    if (step.side === 'p') {
      d.humanStep = step;
      d.needsContinue = false;
      return;
    }
    const aiSlots = d.aiSlots || d.slots;
    const available = aiSlots.filter((slot) => !slot.takenBy).map((slot) => slot.card);
    const picks = choosePoolPicks(g, 'a', step.max, available);
    d.aiPicks.push(...picks);
    for (const card of picks) {
      const slot = aiSlots.find((entry) => entry.card.id === card.id);
      if (slot) slot.takenBy = 'a';
    }
    d.pool = d.slots.filter((slot) => !slot.takenBy).map((slot) => slot.card);
    d.stepIndex += 1;
  }
  d.humanStep = null;
  if (d.humanActed) {
    finishPoolDraw();
  } else {
    d.needsContinue = true;
  }
}

function confirmPool(skip = false) {
  const d = S.draw;
  if (!d || !d.humanStep) return;
  const step = d.humanStep;
  if (skip && step.min > 0) return;
  const cards = skip ? [] : d.pool.filter((card) => S.poolSelected.has(card.id));
  if (cards.length < step.min || cards.length > step.max) {
    toast(`需要选择 ${step.min === step.max ? step.min : `0–${step.max}`} 张`);
    return;
  }
  d.humanPicks = cards;
  const ids = new Set(cards.map((card) => card.id));
  for (const card of cards) {
    const slot = d.slots.find((entry) => entry.card.id === card.id);
    if (slot) slot.takenBy = 'p';
  }
  d.pool = d.slots.filter((slot) => !slot.takenBy).map((slot) => slot.card);
  d.stepIndex += 1;
  d.humanStep = null;
  d.humanActed = true;
  S.poolSelected.clear();
  stopTimer();
  advanceDraw();
  if (S.draw) {
    if (S.draw.humanStep) startDrawTimer();
    else setIdleTimer();
    renderAll();
  }
}

function continueDraw() {
  if (!S.draw?.needsContinue) return;
  clearTimeout(S.autoDrawTimer);
  S.autoDrawTimer = null;
  stopTimer();
  finishPoolDraw();
}

function finishPoolDraw() {
  const g = S.game;
  const d = S.draw;
  if (!g || g.phase !== 'draw' || !d) return;
  clearTimeout(S.autoDrawTimer);
  S.autoDrawTimer = null;
  stopTimer();
  let result;
  try {
    result = g.applyDraw({
      p: d.humanPicks.map((card) => card.id),
      a: d.aiPicks.map((card) => card.id),
    });
  } catch (err) {
    toast(err.message);
    return;
  }
  S.newCards = new Set(result.drawn.p.map((card) => card.id));
  S.draw = null;
  S.poolSelected.clear();

  // 电脑摸牌后超上限，自动弃到 10 张
  if (g.phase === 'discard' && g.needsDiscard('a')) {
    try {
      g.discard('a', chooseDiscard(g, 'a'));
    } catch (err) {
      toast(`电脑弃牌异常：${err.message}`);
    }
  }

  if (g.phase === 'select') {
    enterSelect();
    const pText = result.refill?.p ? `补满 ${result.counts.p} 张` : `+${result.counts.p} 张`;
    const aText = result.refill?.a ? `补满 ${result.counts.a} 张` : `+${result.counts.a} 张`;
    toast(`摸牌：你 ${pText}，电脑 ${aText}`);
    return;
  }

  if (g.phase === 'discard') setIdleTimer();
  renderAll();
  if (g.phase === 'discard') {
    const need = g.players.p.hand.length - g.config.handLimit;
    if (need > 0) toast(`手牌超限，需弃 ${need} 张`);
  }
}

function sideLine(r, side, name) {
  const action = r.actions[side];
  if (action.kind !== 'play') {
    return `${name}：${action.label}，本回合 <b>0</b> 分`;
  }
  const rev = r.reveals[side];
  const restraint = r.restraint[side];
  const restText = restraint
    ? `，相克 <b>${restraint > 0 ? '+' : ''}${restraint}</b>`
    : '';
  const monthText = rev.monthBonus ? `（月令支 +${MONTH_BRANCH_BONUS}）` : '';
  return `${name}：${rev.comboLabel}·${rev.element} 五行 <b>${rev.score}</b> 分${monthText}${restText} → 本回合 <b>${r.roundScores[side]}</b> 分`;
}

function renderSummary() {
  const g = S.game;
  const box = $('round-summary');

  if (g.phase === 'select') {
    box.innerHTML = '<span class="hint">拖 1–3 张手牌到出牌池：单张自动转化，多张能合自动合成；点击「出牌」确认，点「清空」退回手牌。</span>';
    return;
  }
  const r = g.lastResult;
  if (!r) {
    box.innerHTML = '';
    return;
  }
  if (g.phase === 'reveal' && (!S.revealed || (!S.flipDone && r.actions.a.kind === 'play'))) {
    box.innerHTML = '<span class="hint">对方暗牌翻面中…</span>';
    return;
  }

  let verdict = '';
  let cls = '';
  if (r.actions.p.kind !== 'play' && r.actions.a.kind !== 'play') {
    verdict = '双方均未出牌 · 本回合 0 分';
  } else if (r.winner === 'p') {
    verdict = `你赢下本回合 · 总分 +${r.diff}`;
    cls = 'win';
  } else if (r.winner === 'a') {
    verdict = `电脑赢下本回合 · 总分 +${r.diff}`;
    cls = 'lose';
  } else {
    verdict = '本回合平局 · 双方总分不变';
  }

  const dr = r.drawRights;
  let rightsText;
  if (g.phase === 'draw' && r.drawPlan) {
    const plan = r.drawPlan;
    if (plan.steps.length === 0) rightsText = '本回合无牌池';
    else rightsText = '摸牌：共享牌池（4 天干 + 4 地支），按顺序挑牌';
    if (plan.refill?.p || plan.refill?.a) {
      const who = [plan.refill.p ? '你' : '', plan.refill.a ? '电脑' : ''].filter(Boolean).join('、');
      rightsText = `${who} 手牌打空 · 必须补满 8 张`;
    }
  } else if (dr.p === 0 && dr.a === 0) {
    rightsText = '本回合双方均不可摸牌';
  } else {
    rightsText = `摸牌权：你 0–${dr.p} 张 · 电脑 0–${dr.a} 张`;
  }

  let phaseHint = '';
  if (g.phase === 'draw') phaseHint = `月令已换至 <b>${g.month}月 · ${MONTH_ELEMENT[g.month]}旺</b>，摸牌按新月令计分。`;
  else if (g.phase === 'discard') phaseHint = '手牌超过上限，请选择弃牌。';
  else if (g.phase === 'over' || r.gameOver) phaseHint = `${g.maxRounds} 回合已满，对局结束。`;

  box.innerHTML = `
    <span class="verdict ${cls}">${verdict}${r.gameOver && g.phase !== 'over' ? ' · 最终回合' : ''}</span>
    <span class="detail">${sideLine(r, 'p', '你')}</span>
    <span class="detail">${sideLine(r, 'a', '电脑')}</span>
    <span class="hint">${rightsText} · 总分 ${r.totalAfter.p} : ${r.totalAfter.a}${phaseHint ? ` · ${phaseHint}` : ''}</span>`;
}

function renderPhaseClock() {
  const g = S.game;
  const clock = $('phase-clock');
  const show = g.phase === 'select' || g.phase === 'draw';
  clock.hidden = !show;
  if (show) $('phase-label').textContent = g.phase === 'select' ? '出牌' : '摸牌';
}

function renderPhase() {
  const g = S.game;
  document.querySelector('.center-stage').classList.toggle('is-draw', g.phase === 'draw');
  renderPhaseClock();
  let text = '';
  let subtle = false;
  switch (g.phase) {
    case 'select':
      text = `暗出阶段 · 第 ${g.round}/${g.maxRounds} 回合 · ${g.month}月${MONTH_ELEMENT[g.month]}旺`;
      break;
    case 'reveal':
      text = S.revealed ? '同时揭示 · 本回合结算' : '同时揭示 · 亮牌中';
      subtle = !S.revealed;
      break;
    case 'draw':
      text = '摸牌阶段 · 月令已换';
      break;
    case 'discard':
      text = '弃牌阶段 · 手牌超限';
      break;
    case 'over':
      text = '对局结束';
      break;
    default:
      text = g.phase;
  }
  const banner = $('phase-banner');
  banner.textContent = text;
  banner.classList.toggle('subtle', subtle);
}

function renderFortune() {
  const g = S.game;
  const info = monthInfo(g.month, g.direction);
  $('fortune-list').innerHTML = info.fortunes
    .map((f) => {
      const col = ELEMENT_COLORS[f.element];
      return `<div class="fortune-item ${f.state === '旺' ? 'is-wang' : ''}">
        <span class="fortune-el" style="--el:${col.bg};--el-ink:${col.ink}">${f.element}</span>
        <span class="fortune-state">${f.state}</span>
        <span class="fortune-delta">${f.delta > 0 ? '+' : ''}${f.delta} · ${5 + 2 * f.delta}分</span>
      </div>`;
    })
    .join('');
  $('month-next').textContent = `${g.direction > 0 ? '顺行' : '逆行'} · 下月 ${info.next} · ${info.nextElement}${fortuneOf(info.nextElement, info.next).state}`;
}

function selectedCards() {
  const hand = S.game.players.p.hand;
  return hand.filter((c) => S.selected.has(c.id));
}

function renderSelection(sel, analysis) {
  const g = S.game;
  const info = $('selection-info');
  const pool = S.playCards;
  if (pool.length) {
    const combo = S.pendingCombo;
    const names = pool.map((c) => c.name).join(' · ');
    if (combo) {
      info.innerHTML = `
        <span class="line"><b>${names}</b><span class="ok">出牌池已自动${combo.size > 1 ? '合成' : '转化'}</span><span>${combo.label} · 产出 <b>${combo.out}</b> · ${combo.score} 分</span></span>
        <span class="line">点击「出牌」确认；点「清空」把牌退回手牌重新选。</span>`;
    } else {
      info.innerHTML = `
        <span class="line"><b>${names}</b><span class="warn">${S.playError || '这组牌不能成局'}</span></span>
        <span class="line">点「清空」重新拖牌，或补一张试试。</span>`;
    }
    return;
  }
  if (sel.length) {
    const selectedAnalysis = analyzeSelection(sel, g.month);
    const names = sel.map((c) => c.name).join(' ');
    if (selectedAnalysis.ok) {
      const combo = selectedAnalysis.combo;
      const breakdown = combo.size > 1
        ? `5 × ${combo.size} + 加成 ${combo.bonus} + ${combo.out}${fortuneOf(combo.out, g.month).state}${fortuneOf(combo.out, g.month).delta >= 0 ? '+' : ''}${fortuneOf(combo.out, g.month).delta}`
        : combo.monthBonus
          ? `单牌 ${combo.score - combo.monthBonus} 分 + 月令支 +${MONTH_BRANCH_BONUS} = ${combo.score} 分`
          : `单牌 ${combo.score} 分（旺相修正 ×2）`;
      info.innerHTML = `
        <span class="line"><b>${names}</b><span class="combo-name">${combo.label}${combo.size > 1 ? ` · ${combo.out}` : ''}</span><span class="ok">${combo.size > 1 ? `加成 +${combo.bonus}` : combo.monthBonus ? `月令支 +${MONTH_BRANCH_BONUS}` : '灵活单出'}</span><span>本回合 <b>${combo.score}</b> 分</span></span>
        <span class="line">${breakdown} · 产出五行牌：<b>${combo.out}</b>；拖入出牌池出牌，点击手牌仅用于弃1摸1。</span>`;
    } else {
      info.innerHTML = `<span class="line"><b>${names}</b><span class="warn">${selectedAnalysis.reason}</span></span>`;
    }
    return;
  }
  info.innerHTML = '<span class="line">拖 1–3 张手牌到「出牌池」：单张自动转化，多张能合会自动合成五行牌。点击手牌只用于弃1摸1。</span>';
}

function renderActions() {
  const g = S.game;
  const actions = $('actions');
  const phase = g.phase;

  if (phase === 'select') {
    const sel = selectedCards();
    const analysis = null;
    renderSelection(sel, analysis);
    const c = S.pendingCombo;
    const canSwap = sel.length === 1 && !g.swapUsed.p && !S.busy;
    const hasPool = S.playCards.length > 0;
    actions.innerHTML = `
      <button class="btn ghost" data-act="clear" ${hasPool || sel.length ? '' : 'disabled'}>清空</button>
      <button class="btn ghost" data-act="pass" ${S.busy ? 'disabled' : ''}>空过 <span class="kbd">P</span></button>
      <button class="btn ghost" data-act="swap" ${canSwap ? '' : 'disabled'}>弃1摸1</button>
      <button class="btn primary" data-act="play" ${c && !S.busy ? '' : 'disabled'}>出牌${c ? ` · ${c.out} ${c.score}分` : ''} <span class="kbd">↵</span></button>`;
    return;
  }

  if (phase === 'draw') {
    // 摸牌阶段由 enterDrawPhase / confirmPool 单独控制 15 秒倒计时
  } else {
    setIdleTimer();
  }
  if (phase === 'reveal') {
    if (!S.revealed) {
      $('selection-info').innerHTML = '<span class="line">双方同时亮出五行牌，只公开五行、分数与组合类型…</span>';
      actions.innerHTML = '<button class="btn" disabled>揭示中…</button>';
    } else if (S.battleLocked) {
      $('selection-info').innerHTML = '<span class="line">五行牌交击，本回合分差正在结算…</span>';
      actions.innerHTML = '<button class="btn" disabled>战斗结算中…</button>';
    } else if (g.lastResult?.gameOver) {
      $('selection-info').innerHTML = `<span class="line">第 ${g.maxRounds} 回合结算完毕，即将显示最终比分。</span>`;
      actions.innerHTML = '<button class="btn" disabled>自动进入终局…</button>';
    } else {
      $('selection-info').innerHTML = '<span class="line">本回合已结算，即将自动换月令并进入摸牌。</span>';
      actions.innerHTML = '<button class="btn" disabled>自动进入摸牌…</button>';
    }
    return;
  }

  if (phase === 'draw') {
    const d = S.draw;
    const monthLine = `月令已换为 <b>${g.month}月 · ${MONTH_ELEMENT[g.month]}旺</b>，新牌按新月令计分。摸牌限时 <b>${DRAW_SECONDS} 秒</b>。`;

    if (!d) {
      $('selection-info').innerHTML = `<span class="line">${monthLine}</span><span class="line">正在翻出公共牌池…</span>`;
      actions.innerHTML = '<button class="btn" disabled>准备牌池…</button>';
      return;
    }

    if (d.humanStep) {
      const step = d.humanStep;
      const selected = S.poolSelected.size;
      const canConfirm = selected >= Math.max(1, step.min) && selected <= step.max;
      let stepText;
      const aiTaken = d.aiPicks.length;
      const aiStems = d.aiPicks.filter((card) => card.kind === 'stem').length;
      const aiBranches = aiTaken - aiStems;
      const refillNote = d.plan.refill.a ? '电脑手牌打空，将补满 8 张；' : '';
      if (step.min === 2) {
        stepText = `${refillNote}你是赢家，可选 <b>0–2 张</b>，也可以不摸。`;
      } else if (aiTaken > 0) {
        stepText = `电脑已先拿 <b>${aiTaken} 张</b>（${aiStems} 天干 / ${aiBranches} 地支）；你可从剩余牌池选 <b>0–1 张</b>，也可以不摸。`;
      } else {
        stepText = '你可从牌池中选 <b>0–1 张</b>，也可以不摸。';
      }
      $('selection-info').innerHTML = `
        <span class="line">${monthLine}</span>
        <span class="line">${stepText} 已选 <b>${selected}</b> 张。</span>`;
      const canRefresh = !g.drawRefreshed?.p && g.players.p.total >= 5;
      actions.innerHTML = `
        <button class="btn ghost" data-act="pool-clear" ${selected ? '' : 'disabled'}>清空</button>
        ${step.min === 0 ? '<button class="btn ghost" data-act="pool-skip">不摸</button>' : ''}
        <button class="btn ghost" data-act="refresh-pool" ${canRefresh ? '' : 'disabled'} title="${g.players.p.total < 5 ? '总分不足 5 分' : '消耗 5 总分刷新牌池'}">刷新池 -5分</button>
        <button class="btn primary" data-act="pool-confirm" ${canConfirm ? '' : 'disabled'}>确认拿 ${selected} 张</button>`;
      return;
    }

    if (d.needsContinue) {
      let reason;
      if (d.plan.refill.p && d.plan.refill.a) reason = '双方手牌打空，将各补满 8 张。';
      else if (d.plan.refill.p) reason = '你的手牌已打空，将强制补满 8 张。';
      else if (d.plan.refill.a) reason = '电脑手牌已打空，将强制补满 8 张。';
      else if (d.plan.steps.length === 0) reason = '本回合双方都没有摸牌权。';
      else reason = '电脑已从牌池挑完。';
      $('selection-info').innerHTML = `
        <span class="line">${monthLine}</span>
        <span class="line">${reason}</span>`;
      actions.innerHTML = '<button class="btn" disabled>自动进入下一回合…</button>';
      return;
    }

    $('selection-info').innerHTML = `<span class="line">${monthLine}</span><span class="line">等待电脑从牌池挑牌…</span>`;
    actions.innerHTML = '<button class="btn" disabled>等待中…</button>';
    return;
  }

  if (phase === 'discard') {
    const hand = g.players.p.hand;
    const need = hand.length - g.config.handLimit;
    const chosen = S.discardSelected.size;
    $('selection-info').innerHTML = `
      <span class="line">手牌 <b>${hand.length}</b> 张，超过上限，请弃置 <b>${need}</b> 张。已选 <b>${chosen}</b> 张。</span>
      <span class="line">弃牌张数对对手公开，具体弃掉哪张保密。</span>`;
    actions.innerHTML = `
      <button class="btn ghost" data-act="clear-discard" ${chosen ? '' : 'disabled'}>清空</button>
      <button class="btn primary" data-act="discard" ${chosen === need ? '' : 'disabled'}>确认弃牌</button>`;
    return;
  }

  if (phase === 'over') {
    const p = g.players.p.total;
    const a = g.players.a.total;
    $('selection-info').innerHTML = `<span class="line">对局结束 · 最终比分 <b>${p} : ${a}</b></span>`;
    actions.innerHTML = '<button class="btn primary" data-act="again">再来一局</button>';
  }
}

function setRing(fraction) {
  const ring = $('phase-ring');
  ring.style.strokeDasharray = String(RING_LENGTH);
  ring.style.strokeDashoffset = String(RING_LENGTH * (1 - fraction));
}

function updateTimer(remainMs, totalMs) {
  setRing(Math.max(0, Math.min(1, remainMs / totalMs)));
  $('phase-clock').classList.toggle('is-warning', remainMs <= 5000);
}

function startTimer(initialRemainMs = null) {
  stopTimer();
  $('phase-clock').classList.remove('is-warning');
  const total = S.timerSeconds * 1000;
  if (!S.timerSeconds) {
    setRing(1);
    return;
  }
  const duration = Math.max(0, Math.min(total, initialRemainMs ?? total));
  S.deadline = performance.now() + duration;
  const tick = () => {
    const remain = S.deadline - performance.now();
    updateTimer(Math.max(0, remain), total);
    if (remain <= 0) {
      stopTimer();
      handleTimeout();
    }
  };
  tick();
  S.interval = setInterval(tick, 100);
}

function startDrawTimer(initialRemainMs = null) {
  stopTimer();
  const total = DRAW_SECONDS * 1000;
  $('phase-clock').classList.remove('is-warning');
  const duration = Math.max(0, Math.min(total, initialRemainMs ?? total));
  S.deadline = performance.now() + duration;
  const tick = () => {
    const remain = S.deadline - performance.now();
    updateTimer(Math.max(0, remain), total);
    if (remain <= 0) {
      stopTimer();
      handleDrawTimeout();
    }
  };
  tick();
  S.interval = setInterval(tick, 100);
}

function handleDrawTimeout() {
  const d = S.draw;
  if (!S.game || S.game.phase !== 'draw' || !d?.humanStep) return;
  const step = d.humanStep;
  if (step.min === 2) {
    const auto = d.pool.slice(0, step.max);
    S.poolSelected.clear();
    for (const card of auto) S.poolSelected.add(card.id);
    toast('摸牌超时 · 自动拿走牌池前 2 张');
    confirmPool(false);
  } else {
    toast('摸牌超时 · 本回合不摸牌');
    confirmPool(true);
  }
}

const TUTORIAL_TITLES = ['五行生克制化', '天干地支的五行属性', '月令与旺相休囚死', '会局 / 合局条件', '摸牌与弃1摸1', '积分与胜负'];
const TUTORIAL_KEY = 'month-fusion-tutorial-v1';

function tutorialSeen() {
  try {
    return sessionStorage.getItem(TUTORIAL_KEY) === '1';
  } catch {
    return false;
  }
}

function markTutorialSeen() {
  try {
    sessionStorage.setItem(TUTORIAL_KEY, '1');
  } catch {
    // 本地存储不可用时不影响教程
  }
}

function renderInspect() {
  const month = S.inspectMonth;
  const name = S.inspectName;
  const card = CARD_BY_NAME.get(name) || CARD_BY_NAME.get('甲');
  const f = fortuneOf(card.element, month);
  const score = singleCardScore(card, month);
  const relation = {
    旺: '同月令 · 当令',
    相: '月令生我',
    休: '我生月令',
    囚: '我克月令',
    死: '月令克我',
  }[f.state];
  const stateChips = ['旺', '相', '休', '囚', '死']
    .map((state) => `<span class="inspect-state-chip${state === f.state ? ' is-active' : ''}">${state}</span>`)
    .join('');
  const chips = (list, kind) => list.map((c) => {
    const active = c.name === card.name;
    return `<button class="inspect-chip${active ? ' is-active' : ''}" type="button" data-inspect-card="${c.name}" data-el="${c.element}">${c.name}</button>`;
  }).join('');
  $('inspect-months').innerHTML = MONTH_CYCLE.map((m) => (
    `<button class="inspect-month-chip${m === month ? ' is-active' : ''}" type="button" data-inspect-month="${m}" data-el="${MONTH_ELEMENT[m]}">${m}</button>`
  )).join('');
  $('inspect-cards').innerHTML = `
    <div class="inspect-card-row"><span>天干</span><div>${chips(STEM_TABLE)}</div></div>
    <div class="inspect-card-row"><span>地支</span><div>${chips(BRANCH_TABLE)}</div></div>`;
  $('inspect-output').innerHTML = `
    <div class="inspect-output-top">
      <span class="inspect-month-read">${month}月 · ${MONTH_ELEMENT[month]}旺</span>
      <strong>${card.name} · ${card.element}</strong>
    </div>
    <div class="inspect-output-main">
      <div class="inspect-big-card" data-el="${card.element}">${card.name}<small>${card.element}</small></div>
      <div class="inspect-state-copy">
        <b class="inspect-state-value">${f.state}${f.delta > 0 ? ` +${f.delta}` : f.delta < 0 ? ` ${f.delta}` : ' 0'}</b>
        <span>${relation}</span>
        <span class="inspect-score">单牌 <b>${score}</b> 分${isMonthBranch(card, month) ? '（月令支固定 10）' : ''}</span>
      </div>
    </div>
    <div class="inspect-statebar">${stateChips}</div>
    <div class="inspect-gate ${f.state === '旺' ? 'is-ok' : ''}">${f.state === '旺' ? '此五行当月旺：合局可成' : `此五行当月为${f.state}：不能合出${card.element}局`}</div>`;
}

function renderTutorial() {
  const step = S.tutorialStep;
  $('tutorial-title').textContent = TUTORIAL_TITLES[step];
  document.querySelectorAll('.tutorial-step').forEach((section) => {
    section.hidden = Number(section.dataset.step) !== step;
  });
  const progress = $('tutorial-progress');
  progress.innerHTML = TUTORIAL_TITLES.map((title, index) => (
    `<button class="tut-dot${index === step ? ' is-active' : ''}${index < step ? ' is-done' : ''}" data-tutorial-step="${index}" type="button" aria-label="${title}"></button>`
  )).join('');
  $('tutorial-count').textContent = `${step + 1} / ${TUTORIAL_TITLES.length}`;
  $('tutorial-prev').disabled = step === 0;
  $('tutorial-next').textContent = step === TUTORIAL_TITLES.length - 1 ? '开始对局' : '下一步';
  renderInspect();
}

function openRules() {
  const dialog = $('rules-dialog');
  if (dialog.open) return;
  S.tutorialStep = 0;
  renderTutorial();
  if (
    ((S.game?.phase === 'select' && S.timerSeconds) ||
      (S.game?.phase === 'draw' && S.draw?.humanStep)) &&
    S.interval
  ) {
    S.rulesPausedRemain = Math.max(0, S.deadline - performance.now());
    stopTimer();
  }
  dialog.showModal();
}

function tutorialNext() {
  if (S.tutorialStep >= TUTORIAL_TITLES.length - 1) {
    $('rules-dialog').close();
    return;
  }
  S.tutorialStep += 1;
  renderTutorial();
}

function tutorialPrev() {
  if (S.tutorialStep <= 0) return;
  S.tutorialStep -= 1;
  renderTutorial();
}

function resumeAfterRules() {
  markTutorialSeen();
  if (S.pendingSpinSeed) {
    const seed = S.pendingSpinSeed;
    S.pendingSpinSeed = null;
    showSpinStage(seed);
    return;
  }
  const remain = S.rulesPausedRemain;
  S.rulesPausedRemain = null;
  if (remain !== null) {
    if (S.game?.phase === 'select' && !S.busy) startTimer(remain);
    else if (S.game?.phase === 'draw' && S.draw?.humanStep) startDrawTimer(remain);
  }
}

function stopTimer() {
  if (S.interval) {
    clearInterval(S.interval);
    S.interval = null;
  }
}

function setIdleTimer() {
  stopTimer();
  setRing(1);
  $('phase-clock').classList.remove('is-warning');
}

function handleTimeout() {
  if (!S.game || S.game.phase !== 'select' || S.busy) return;
  toast('时间到 · 本回合判定为超时（不出牌、不消耗手牌）');
  commitAction({ kind: 'timeout' });
}

// ---------- 动作 ----------

function commitAction(playerAction) {
  const g = S.game;
  if (!g || g.phase !== 'select' || S.busy) return;
  S.busy = true;
  stopTimer();

  const aiAction = S.aiAction ?? chooseAction(g, 'a'); // 本轮开始时已暗定，不读取玩家动作

  try {
    g.resolveRound({ p: playerAction, a: aiAction });
  } catch (err) {
    S.busy = false;
    toast(err.message);
    startTimer();
    return;
  }

  S.selected.clear();
  S.pendingCombo = null;
  S.playCards = [];
  S.playError = null;
  S.aiAction = null;
  S.revealed = false;
  S.flipDone = false;
  S.busy = false;
  renderAll();

  clearTimeout(S.revealTimeout);
  S.revealTimeout = setTimeout(() => {
    S.revealed = true;
    const result = S.game.lastResult;
    const aiFlips = result?.actions.a.kind === 'play';
    S.flipDone = !aiFlips;
    const battle = Boolean(result?.winner)
      || (result?.actions.p.kind === 'play' && result?.actions.a.kind === 'play');
    S.battleLocked = battle;
    renderAll();
    if (aiFlips) {
      clearTimeout(S.flipTimer);
      S.flipTimer = setTimeout(() => {
        if (S.game?.lastResult !== result) return;
        S.flipDone = true;
        renderScores();
        renderSummary();
      }, 820);
    }
    if (battle) {
      S.fxTimer = setTimeout(() => runBattleEffect(result), 900);
      clearTimeout(S.fxUnlockTimer);
      S.fxUnlockTimer = setTimeout(() => {
        S.battleLocked = false;
        renderActions();
      }, 1950);
    }
    scheduleAutoProceed(result?.gameOver ? 2800 : battle ? 2700 : 1600);
  }, 850);
}

function renderSwapDialog() {
  const cards = S.swapCards || [];
  const back = (index, label) => `<button class="swap-back" data-index="${index}" aria-label="${label}第${(index % 4) + 1}张暗牌"></button>`;
  $('swap-discard-name').textContent = S.swapOriginal?.name || '—';
  $('swap-pool').innerHTML = `
    <div class="swap-row">
      <span class="swap-row-label">天干</span>
      <div class="swap-backs">${cards.slice(0, 4).map((_, i) => back(i, '天干')).join('')}</div>
    </div>
    <div class="swap-row">
      <span class="swap-row-label">地支</span>
      <div class="swap-backs">${cards.slice(4, 8).map((_, i) => back(i + 4, '地支')).join('')}</div>
    </div>`;
}

function pauseSwapTimer() {
  S.swapPausedRemain = null;
  if (S.game?.phase === 'select' && S.timerSeconds && S.interval) {
    S.swapPausedRemain = Math.max(0, S.deadline - performance.now());
    stopTimer();
  }
}

function resumeSwapTimer() {
  const remain = S.swapPausedRemain;
  S.swapPausedRemain = null;
  if (remain !== null && S.game?.phase === 'select' && !S.busy) startTimer(remain);
}

function closeSwapDialog() {
  const dialog = $('swap-dialog');
  if (dialog?.open) dialog.close();
}

function openSwap() {
  const g = S.game;
  if (!g || g.phase !== 'select') return;
  if (g.swapUsed.p) {
    toast('本回合已经换过牌');
    return;
  }
  const sel = selectedCards();
  if (sel.length !== 1) {
    toast('换牌只能选择 1 张手牌');
    return;
  }
  let opened;
  try {
    opened = g.beginSwap('p', sel[0].id);
  } catch (err) {
    toast(err.message);
    return;
  }
  S.swapCards = opened.cards;
  S.swapOriginal = opened.originalCard;
  S.pendingCombo = null;
  S.selected.clear();
  pauseSwapTimer();
  renderAll();
  renderSwapDialog();
  $('swap-dialog').showModal();
}

function claimSwap(index) {
  const card = S.swapCards?.[index];
  if (!card) return;
  let drawn;
  try {
    drawn = S.game.claimSwap('p', card.id);
  } catch (err) {
    toast(err.message);
    return;
  }
  S.swapCards = null;
  S.swapOriginal = null;
  closeSwapDialog();
  S.newCards.add(drawn.id);
  renderAll();
  resumeSwapTimer();
  toast(`换牌：摸到 ${drawn.kind === 'stem' ? '天干' : '地支'} · ${drawn.name}`);
}

function cancelSwap() {
  if (S.game?.swapState) {
    try {
      S.game.cancelSwap('p');
    } catch (err) {
      toast(err.message);
    }
  }
  S.swapCards = null;
  S.swapOriginal = null;
  closeSwapDialog();
  renderAll();
  resumeSwapTimer();
  toast('已取消换牌，原牌退回手牌');
}

function refreshPool() {
  const g = S.game;
  const d = S.draw;
  if (!g || g.phase !== 'draw' || !d?.humanStep) return;
  const oldView = d.slots;
  const untaken = oldView.filter((slot) => !slot.takenBy);
  const kinds = untaken.map((slot) => slot.card.kind);
  let result;
  try {
    result = g.refreshDrawPool('p', kinds);
  } catch (err) {
    toast(err.message);
    return;
  }
  let next = 0;
  d.slots = oldView.map((slot) => (
    slot.takenBy ? slot : { card: result.cards[next++], takenBy: null }
  ));
  // 对手仍使用刷新前的池视图；这里不改 d.aiSlots
  d.pool = d.slots.filter((slot) => !slot.takenBy).map((slot) => slot.card);
  S.poolSelected.clear();
  renderAll();
  toast(`刷新牌池 · 总分 -5（本池剩余 ${d.pool.length} 张）`);
}

function addToPlayPool(cardId) {
  const g = S.game;
  if (!g || g.phase !== 'select') return;
  if (S.playCards.length >= 3) {
    toast('出牌池最多 3 张');
    return;
  }
  if (S.playCards.some((card) => card.id === cardId)) return;
  const card = g.players.p.hand.find((c) => c.id === cardId);
  if (!card) return;
  const cards = [...S.playCards, card];
  const analysis = analyzeSelection(cards, g.month);
  const visuals = captureCardVisuals([card]);
  S.playCards = cards;
  S.pendingCombo = analysis.ok ? analysis.combo : null;
  S.playError = analysis.ok ? null : analysis.reason;
  S.selected.delete(cardId);
  renderAll();
  if (analysis.ok) {
    const preview = document.querySelector('.duel-slot[data-side="p"] .preview-card');
    playForgeFx(visuals, preview, analysis.combo);
  } else {
    toast(analysis.reason);
  }
}

function clearPlayPool() {
  S.playCards = [];
  S.pendingCombo = null;
  S.playError = null;
  S.selected.clear();
  renderAll();
}

function bindHandDrag() {
  const hand = $('p-hand');
  const pointIn = (rect, x, y) => x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom;
  hand.addEventListener('pointerdown', (event) => {
    const g = S.game;
    if (!g || g.phase !== 'select' || S.busy || S.playCards.length >= 3) return;
    const cardEl = event.target.closest('.card');
    if (!cardEl) return;
    S.handDrag = {
      id: cardEl.dataset.id,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      dragging: false,
      ghost: null,
    };
  });
  window.addEventListener('pointermove', (event) => {
    const drag = S.handDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.dragging) {
      if (Math.hypot(event.clientX - drag.startX, event.clientY - drag.startY) < 7) return;
      drag.dragging = true;
      const cardEl = hand.querySelector(`.card[data-id="${drag.id}"]`);
      if (!cardEl) return;
      const rect = cardEl.getBoundingClientRect();
      const ghost = cardEl.cloneNode(true);
      ghost.classList.add('drag-ghost');
      ghost.classList.remove('is-selected', 'is-new');
      ghost.style.width = `${rect.width}px`;
      ghost.style.height = `${rect.height}px`;
      ghost.style.left = `${event.clientX}px`;
      ghost.style.top = `${event.clientY}px`;
      document.body.append(ghost);
      drag.ghost = ghost;
    }
    event.preventDefault();
    if (drag.ghost) {
      drag.ghost.style.left = `${event.clientX}px`;
      drag.ghost.style.top = `${event.clientY}px`;
    }
    const pool = document.querySelector('[data-play-pool]');
    if (pool) {
      const r = pool.getBoundingClientRect();
      pool.classList.toggle('is-over', pointIn(r, event.clientX, event.clientY));
    }
  });
  const release = (event) => {
    const drag = S.handDrag;
    if (!drag || drag.pointerId !== event.pointerId) return;
    S.handDrag = null;
    if (!drag.dragging) return;
    const pool = document.querySelector('[data-play-pool]');
    const over = pool && pointIn(pool.getBoundingClientRect(), event.clientX, event.clientY);
    pool?.classList.remove('is-over');
    drag.ghost?.remove();
    if (over) {
      S.suppressHandClick = true;
      setTimeout(() => { S.suppressHandClick = false; }, 300);
      addToPlayPool(drag.id);
    }
  };
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
}

function convertSelection() {
  const g = S.game;
  if (!g || g.phase !== 'select') return;
  const sel = selectedCards();
  if (!sel.length) {
    toast('请先选择手牌');
    return;
  }
  const analysis = analyzeSelection(sel, g.month);
  if (!analysis.ok) {
    toast(analysis.reason);
    return;
  }
  const visuals = captureCardVisuals(sel);
  S.pendingCombo = analysis.combo;
  renderAll();
  const preview = document.querySelector('.duel-slot[data-side="p"] .preview-card');
  playForgeFx(visuals, preview, analysis.combo);
  toast(`${sel.length > 1 ? '已合成' : '已转化'}：${analysis.combo.label} · ${analysis.combo.out} ${analysis.combo.score} 分`);
}

function playSelected() {
  const g = S.game;
  if (!g || g.phase !== 'select') return;
  if (!S.pendingCombo) {
    toast('请先把牌拖入出牌池，凑成可出的五行牌');
    return;
  }
  const combo = S.pendingCombo;
  const preview = document.querySelector('.duel-slot[data-side="p"] .preview-card');
  playCastFx(preview, combo);
  commitAction({
    kind: 'play',
    comboType: combo.type,
    cardIds: combo.cards.map((c) => c.id),
  });
}

function scheduleAutoProceed(delay) {
  clearTimeout(S.autoTimer);
  S.autoTimer = setTimeout(() => {
    if (!S.game || S.game.phase !== 'reveal' || !S.revealed) return;
    if ($('rules-dialog')?.open) {
      scheduleAutoProceed(500);
      return;
    }
    if (S.battleLocked) {
      scheduleAutoProceed(250);
      return;
    }
    proceed();
  }, delay);
}

function scheduleAutoDraw() {
  clearTimeout(S.autoDrawTimer);
  S.autoDrawTimer = setTimeout(() => {
    if ($('rules-dialog')?.open) {
      scheduleAutoDraw();
      return;
    }
    if (!S.draw || S.draw.humanStep || !S.draw.needsContinue) return;
    continueDraw();
  }, 1100);
}

function proceed() {
  const g = S.game;
  if (!g || g.phase !== 'reveal' || !S.revealed || S.battleLocked) return;
  clearTimeout(S.autoTimer);
  S.autoTimer = null;
  clearTimeout(S.fxUnlockTimer);
  S.battleLocked = false;
  clearBattleFx();
  g.continueAfterReveal();
  if (g.phase === 'over') {
    renderAll();
    showOverlay();
    return;
  }
  enterDrawPhase();
}

function confirmDiscard() {
  const g = S.game;
  if (!g || g.phase !== 'discard') return;
  const need = g.players.p.hand.length - g.config.handLimit;
  if (S.discardSelected.size !== need) {
    toast(`请恰好选择 ${need} 张弃牌`);
    return;
  }
  try {
    g.discard('p', [...S.discardSelected]);
  } catch (err) {
    toast(err.message);
    return;
  }
  S.discardSelected.clear();
  S.newCards.clear();
  if (g.phase === 'select') {
    enterSelect();
  } else {
    renderAll();
  }
}

function enterSelect() {
  S.aiAction = chooseAction(S.game, 'a');
  S.pendingCombo = null;
  S.playCards = [];
  S.playError = null;
  S.selected.clear();
  S.discardSelected.clear();
  S.poolSelected.clear();
  S.draw = null;
  S.busy = false;
  S.revealed = true;
  S.battleLocked = false;
  renderAll();
  startTimer();
}

function showOverlay() {
  const g = S.game;
  const p = g.players.p.total;
  const a = g.players.a.total;
  const title = p > a ? '你赢了' : p < a ? '电脑赢了' : '平局';
  const sub = p > a
    ? '合局有成，月令在你这边。'
    : p < a
      ? '再试一局，换个出牌节奏。'
      : '势均力敌，胜负未分。';
  $('overlay-card').innerHTML = `
    <div class="eyebrow">对局结束</div>
    <h2>${title}</h2>
    <p class="overlay-sub">${sub}</p>
    <div class="final-score">
      <div class="side"><span class="name">你</span><span class="num ${p >= a ? 'win' : ''}">${p}</span></div>
      <span class="colon">:</span>
      <div class="side"><span class="name">电脑</span><span class="num ${a >= p ? 'win' : ''}">${a}</span></div>
    </div>
    <p class="overlay-stats">共 ${g.maxRounds} 回合 · 最终月令 ${g.month}月 · ${g.direction > 0 ? '顺行' : '逆行'} · 种子 ${g.seed}</p>
    <button class="btn primary" data-act="again">再来一局</button>`;
  $('overlay').hidden = false;
}

function toast(message) {
  const box = $('toast');
  box.textContent = message;
  box.classList.add('show');
  clearTimeout(S.toastTimeout);
  S.toastTimeout = setTimeout(() => box.classList.remove('show'), 2800);
}

// ---------- 事件 ----------

function bindEvents() {
  bindHandDrag();
  $('p-hand').addEventListener('click', (event) => {
    const button = event.target.closest('.card');
    if (!button || !S.game) return;
    const g = S.game;
    const id = button.dataset.id;

    if (g.phase === 'select') {
      if (S.selected.has(id)) {
        S.selected.delete(id);
      } else {
        if (S.selected.size >= 3) {
          toast('一回合最多选择 3 张牌');
          return;
        }
        S.selected.add(id);
      }
      renderHand();
      renderActions();
      return;
    }

    if (g.phase === 'discard') {
      const need = g.players.p.hand.length - g.config.handLimit;
      if (S.discardSelected.has(id)) {
        S.discardSelected.delete(id);
      } else {
        if (S.discardSelected.size >= need) {
          toast(`只需弃置 ${need} 张`);
          return;
        }
        S.discardSelected.add(id);
      }
      renderHand();
      renderActions();
    }
  });

  $('draw-pool').addEventListener('click', (event) => {
    const button = event.target.closest('.card');
    const d = S.draw;
    if (!button || !d || !d.humanStep || S.game.phase !== 'draw') return;
    const id = button.dataset.id;
    if (S.poolSelected.has(id)) {
      S.poolSelected.delete(id);
    } else {
      if (S.poolSelected.size >= d.humanStep.max) {
        toast(`最多选择 ${d.humanStep.max} 张`);
        return;
      }
      S.poolSelected.add(id);
    }
    renderDrawPool();
    renderActions();
  });

  $('actions').addEventListener('click', (event) => {
    const button = event.target.closest('button');
    if (!button || button.disabled) return;
    const act = button.dataset.act;
    if (act === 'play') playSelected();
    else if (act === 'pass') commitAction({ kind: 'pass' });
    else if (act === 'clear') {
      clearPlayPool();
    }
    else if (act === 'swap') openSwap();
    else if (act === 'refresh-pool') refreshPool();
    else if (act === 'continue') proceed();
    else if (act === 'pool-confirm') confirmPool(false);
    else if (act === 'pool-skip') confirmPool(true);
    else if (act === 'pool-clear') {
      S.poolSelected.clear();
      renderDrawPool();
      renderActions();
    } else if (act === 'draw-continue') continueDraw();
    else if (act === 'discard') confirmDiscard();
    else if (act === 'clear-discard') {
      S.discardSelected.clear();
      renderHand();
      renderActions();
    } else if (act === 'again') newGame();
  });

  $('overlay-card').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-act="again"]');
    if (button) restartToSpin();
  });

  $('swap-pool').addEventListener('click', (event) => {
    const back = event.target.closest('.swap-back');
    if (!back) return;
    claimSwap(Number(back.dataset.index));
  });
  $('swap-dialog').addEventListener('cancel', (event) => {
    event.preventDefault();
    cancelSwap();
  });
  $('swap-dialog').addEventListener('click', (event) => {
    if (event.target === $('swap-dialog') || event.target.closest('[data-act="swap-cancel"]')) {
      cancelSwap();
    }
  });

  $('start-game').addEventListener('click', startGame);
  $('spin-enter').addEventListener('click', enterGameFromSpin);
  bindSpinWheel();
  $('rules-btn').addEventListener('click', openRules);
  $('rules-close').addEventListener('click', () => $('rules-dialog').close());
  $('tutorial-prev').addEventListener('click', tutorialPrev);
  $('tutorial-next').addEventListener('click', tutorialNext);
  $('tutorial-progress').addEventListener('click', (event) => {
    const dot = event.target.closest('[data-tutorial-step]');
    if (!dot) return;
    S.tutorialStep = Number(dot.dataset.tutorialStep);
    renderTutorial();
  });
  $('inspect-months').addEventListener('click', (event) => {
    const button = event.target.closest('[data-inspect-month]');
    if (!button) return;
    S.inspectMonth = button.dataset.inspectMonth;
    renderInspect();
  });
  $('inspect-cards').addEventListener('click', (event) => {
    const button = event.target.closest('[data-inspect-card]');
    if (!button) return;
    S.inspectName = button.dataset.inspectCard;
    renderInspect();
  });
  $('rules-dialog').addEventListener('close', resumeAfterRules);
  $('rules-dialog').addEventListener('click', (event) => {
    if (event.target === $('rules-dialog')) $('rules-dialog').close();
  });

  $('restart-btn').addEventListener('click', () => {
    if (!confirm('确定重开一局？当前进度会丢失，会重新定月。')) return;
    restartToSpin();
  });

  $('timer-select').addEventListener('change', (event) => {
    S.timerSeconds = Number(event.target.value);
    if (S.game && S.game.phase === 'select') startTimer();
    if (S.game) updateUrl();
    toast(S.timerSeconds ? `回合时限：${S.timerSeconds} 秒` : '已关闭倒计时（仅本机试玩）');
  });

  document.addEventListener('keydown', (event) => {
    if (event.target.matches('input, select, textarea')) return;
    if ($('rules-dialog').open) return;
    const g = S.game;
    if (!g || g.phase !== 'select') return;
    if (event.key === 'Enter') {
      event.preventDefault();
      playSelected();
    } else if (event.key.toLowerCase() === 'p') {
      event.preventDefault();
      commitAction({ kind: 'pass' });
    } else if (event.key === 'Escape') {
      S.selected.clear();
      renderHand();
      renderActions();
    }
  });
}

// ---------- 开局定月 ----------

function renderSpinWheel() {
  $('spin-wheel').innerHTML = MONTH_CYCLE.map((month, index) => `
    <span class="spin-branch" style="--i:${index}"><b>${month}</b><small>${MONTH_ELEMENT[month]}</small></span>
  `).join('');
}

function setSpinResult(side, month) {
  const el = $(`spin-result-${side}`);
  el.classList.add('is-set');
  el.classList.remove('is-chosen');
  el.innerHTML = `<b>${month}</b><small>${month}月 · ${MONTH_ELEMENT[month]}旺</small>`;
}

function updateSpinAgent(side) {
  const agent = $('spin-agent');
  agent.classList.toggle('is-ai', side === 'a');
  agent.querySelector('span').textContent = side === 'a' ? '电脑' : '你';
}

function beginSpinStage(seed) {
  S.spin = {
    seed,
    rng: mulberry32((seed ^ 0x9e3779b9) >>> 0),
    angle: 0,
    phase: 'p',
    spinning: false,
    drag: null,
    pMonth: null,
    aMonth: null,
    chosen: null,
    chosenSide: null,
    direction: null,
    autoTimer: null,
  };
  renderSpinWheel();
  const wheel = $('spin-wheel');
  wheel.style.transform = 'rotate(0deg)';
  wheel.classList.remove('is-spinning', 'is-dragging');
  wheel.querySelectorAll('.spin-branch').forEach((node) => node.classList.remove('is-current'));
  $('spin-result-p').className = 'spin-result';
  $('spin-result-p').innerHTML = '<b>—</b><small>拨动月盘</small>';
  $('spin-result-a').className = 'spin-result';
  $('spin-result-a').innerHTML = '<b>—</b><small>等待拨动</small>';
  $('spin-verdict').hidden = true;
  $('spin-enter').hidden = true;
  $('spin-turn').textContent = '轮到你拨动月盘';
  $('spin-hint').textContent = '按住轮盘拖动上弦 · 松手开始旋转';
  updateSpinAgent('p');
}

function spinFor(side) {
  const spin = S.spin;
  if (!spin || spin.spinning) return;
  if (side === 'p' && spin.phase !== 'p') return;
  if (side === 'a' && spin.phase !== 'a') return;
  spin.spinning = true;
  spin.phase = side === 'p' ? 'p-spin' : 'a-spin';
  const wheel = $('spin-wheel');
  wheel.classList.add('is-spinning');
  wheel.classList.remove('is-dragging');
  updateSpinAgent(side);
  $('spin-turn').textContent = side === 'p' ? '月盘旋转中…' : '电脑拨动月盘…';
  $('spin-hint').textContent = side === 'p' ? '等待月盘停下…' : '双方可见 · 电脑正在拨动';

  const targetIndex = Math.floor(spin.rng() * 12);
  const month = MONTH_CYCLE[targetIndex];
  const current = spin.angle;
  const norm = ((current % 360) + 360) % 360;
  const targetNorm = ((-targetIndex * 30) % 360 + 360) % 360;
  const delta = (targetNorm - norm + 360) % 360;
  const turns = 3 + Math.floor(spin.rng() * 4);
  const final = current + turns * 360 + delta;
  const duration = 2200 + Math.floor(spin.rng() * 900);
  spin.angle = final;

  const token = (spin.token || 0) + 1;
  spin.token = token;
  let finished = false;
  const finish = () => {
    if (finished || spin.token !== token || S.spin !== spin) return;
    finished = true;
    wheel.style.transform = `rotate(${final}deg)`;
    wheel.classList.remove('is-spinning');
    spin.spinning = false;
    const branch = wheel.querySelectorAll('.spin-branch')[targetIndex];
    branch?.classList.add('is-current');
    if (side === 'p') {
      spin.pMonth = month;
      setSpinResult('p', month);
      spin.phase = 'a';
      $('spin-hint').textContent = '你的月令已定 · 电脑准备拨动';
      $('spin-turn').textContent = '电脑拨动月盘';
      setTimeout(() => spinFor('a'), 850);
    } else {
      spin.aMonth = month;
      setSpinResult('a', month);
      spin.phase = 'resolve';
      resolveSpin();
    }
  };

  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) {
    finish();
    return;
  }
  const anim = wheel.animate(
    [{ transform: `rotate(${current}deg)` }, { transform: `rotate(${final}deg)` }],
    { duration, easing: 'cubic-bezier(.12,.72,.12,1)', fill: 'forwards' },
  );
  anim.onfinish = finish;
  setTimeout(finish, duration + 120);
}

function resolveSpin() {
  const spin = S.spin;
  if (!spin || spin.phase !== 'resolve') return;
  const chosenSide = spin.rng() < 0.5 ? 'p' : 'a';
  const chosen = chosenSide === 'p' ? spin.pMonth : spin.aMonth;
  const direction = spin.rng() < 0.5 ? 1 : -1;
  spin.chosenSide = chosenSide;
  spin.chosen = chosen;
  spin.direction = direction;
  $(`spin-result-${chosenSide}`).classList.add('is-chosen');
  $('spin-chosen').textContent = `${chosen}月 · ${MONTH_ELEMENT[chosen]}旺`;
  $('spin-direction').textContent = direction > 0 ? '顺行 →' : '逆行 ←';
  $('spin-verdict').hidden = false;
  $('spin-enter').hidden = false;
  $('spin-turn').textContent = '开局已定';
  $('spin-hint').textContent = `天择：${chosenSide === 'p' ? '你的' : '电脑的'}${chosen}月`;
  clearTimeout(spin.autoTimer);
  spin.autoTimer = setTimeout(() => {
    if (S.spin === spin && spin.phase === 'resolve') enterGameFromSpin();
  }, 3200);
}

function enterGameFromSpin() {
  const spin = S.spin;
  if (!spin || spin.phase !== 'resolve') return;
  spin.phase = 'done';
  clearTimeout(spin.autoTimer);
  $('spin-stage').hidden = true;
  $('app').hidden = false;
  newGame(spin.seed, { startMonth: spin.chosen, direction: spin.direction });
  window.scrollTo({ top: 0, behavior: 'auto' });
}

function bindSpinWheel() {
  const wheel = $('spin-wheel');
  const centerOf = () => {
    const r = wheel.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  };
  const pointerAngle = (event) => {
    const c = centerOf();
    return Math.atan2(event.clientY - c.y, event.clientX - c.x) * 180 / Math.PI;
  };
  wheel.addEventListener('pointerdown', (event) => {
    const spin = S.spin;
    if (!spin || spin.phase !== 'p' || spin.spinning || spin.drag) return;
    event.preventDefault();
    wheel.setPointerCapture?.(event.pointerId);
    spin.drag = { pointerId: event.pointerId, lastAngle: pointerAngle(event), moved: false };
    wheel.classList.add('is-dragging');
  });
  window.addEventListener('pointermove', (event) => {
    const spin = S.spin;
    if (!spin?.drag || spin.drag.pointerId !== event.pointerId) return;
    event.preventDefault();
    const angle = pointerAngle(event);
    let delta = angle - spin.drag.lastAngle;
    if (delta > 180) delta -= 360;
    if (delta < -180) delta += 360;
    spin.drag.lastAngle = angle;
    spin.drag.moved = true;
    spin.angle += delta;
    wheel.style.transform = `rotate(${spin.angle}deg)`;
  });
  const release = (event) => {
    const spin = S.spin;
    if (!spin?.drag || spin.drag.pointerId !== event.pointerId) return;
    wheel.releasePointerCapture?.(event.pointerId);
    wheel.classList.remove('is-dragging');
    spin.drag = null;
    if (spin.phase === 'p' && !spin.spinning) spinFor('p');
  };
  window.addEventListener('pointerup', release);
  window.addEventListener('pointercancel', release);
}

// ---------- 重开：重新定月 ----------

function restartToSpin() {
  stopTimer();
  clearTimeout(S.autoTimer);
  clearTimeout(S.autoDrawTimer);
  clearTimeout(S.revealTimeout);
  clearTimeout(S.flipTimer);
  clearTimeout(S.fxTimer);
  clearTimeout(S.fxUnlockTimer);
  clearTimeout(S.spin?.autoTimer);
  clearTimeout(S.tutorialTimer);
  S.tutorialTimer = null;
  S.autoTimer = null;
  S.autoDrawTimer = null;
  S.revealTimeout = null;
  S.flipTimer = null;
  S.fxTimer = null;
  S.fxUnlockTimer = null;
  clearBattleFx();
  clearFx();
  closeSwapDialog();
  if ($('overlay')) $('overlay').hidden = true;
  $('app').hidden = true;
  $('spin-stage').hidden = false;
  S.game = null;
  S.draw = null;
  S.selected.clear();
  S.discardSelected.clear();
  S.poolSelected.clear();
  S.newCards.clear();
  S.hints = {};
  S.busy = false;
  S.revealed = true;
  S.flipDone = true;
  S.scoreDelta = null;
  S.pendingCombo = null;
  S.playCards = [];
  S.playError = null;
  S.aiAction = null;
  S.battleLocked = false;
  S.swapCards = null;
  S.swapOriginal = null;
  S.launchSeed = randomSeed();
  S.pendingSpinSeed = null;
  beginSpinStage(S.launchSeed);
  window.scrollTo({ top: 0, behavior: 'auto' });
}

// ---------- 大厅 ----------

function startGame() {
  if (S.game || S.starting) return;
  S.starting = true;
  const seed = S.launchSeed ?? randomSeed();
  const landing = $('landing');
  $('start-game').disabled = true;
  landing.classList.add('is-leaving');
  setTimeout(() => {
    landing.hidden = true;
    $('app').hidden = true;
    $('spin-stage').hidden = true;
    S.starting = false;
    if (!tutorialSeen()) {
      S.pendingSpinSeed = seed;
      openRules();
    } else {
      showSpinStage(seed);
    }
    window.scrollTo({ top: 0, behavior: 'instant' });
  }, 360);
}

function showSpinStage(seed) {
  $('app').hidden = true;
  $('spin-stage').hidden = false;
  beginSpinStage(seed);
  window.scrollTo({ top: 0, behavior: 'auto' });
}

// ---------- 启动 ----------

function boot() {
  const config = readUrl();
  S.timerSeconds = config.timer;
  S.launchSeed = config.seed;
  $('timer-select').value = String(config.timer);
  setRing(1);
  bindEvents();
  $('landing').hidden = false;
  $('app').hidden = true;

  const params = new URLSearchParams(location.search);
  if (params.get('timer') === null) {
    $('timer-select').value = '60';
  }
}

// 供本地调试/自动化测试使用
window.__DSH = { state: S, get game() { return S.game; }, get spin() { return S.spin; }, newGame, render: renderAll, enterDraw: enterDrawPhase, refreshAI: () => { S.aiAction = chooseAction(S.game, 'a'); S.pendingCombo = null; S.playCards = []; S.playError = null; renderAll(); } };

boot();
