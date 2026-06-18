import { performance } from "node:perf_hooks";
import {
  BID_START,
  buildDeck,
  completeRoundScore,
  getCardPower,
  getLeadColor,
  isValidKittyDiscard,
  isValidMove,
  sortHand,
  teamForPlayer,
} from "../src/game.js";
import { evaluateSampledPlayCandidates } from "../src/ai/search.js";

const TARGET_SCORE = 500;
const MAX_BID = 150;
const MAX_ROUNDS_PER_GAME = 60;
export const BENCHMARK_MODE_DEFAULT_GAMES = {
  quick: 20,
  standard: 200,
  full: 1000,
};

function getArgValue(args, name) {
  const match = args.find((arg) => arg.startsWith(`--${name}=`));
  if (!match) return null;
  return match.split("=")[1];
}

function hasFlag(args, name) {
  return args.includes(`--${name}`);
}

function getArgNumber(args, name, fallback, min = 1) {
  const rawValue = getArgValue(args, name);
  if (rawValue === null) return fallback;
  const value = Number(rawValue);
  return Number.isFinite(value) && value >= min ? value : fallback;
}

export function parseBenchmarkArgs(args = process.argv.slice(2)) {
  const mode = getArgValue(args, "mode") ?? (hasFlag(args, "quick") ? "quick" : hasFlag(args, "full") ? "full" : "standard");
  const candidateMode = getArgValue(args, "candidate") ?? (hasFlag(args, "play-search") ? "search" : "current");

  if (!Object.hasOwn(BENCHMARK_MODE_DEFAULT_GAMES, mode)) {
    throw new Error(`Unsupported benchmark mode "${mode}". Use "quick", "standard", or "full".`);
  }

  if (!["current", "search"].includes(candidateMode)) {
    throw new Error(`Unsupported candidate mode "${candidateMode}". Use "current" or "search".`);
  }

  const requestedGamesPerSide = getArgNumber(args, "games", null);
  const requestedWorkers = getArgNumber(args, "workers", null);

  return {
    mode,
    candidateMode,
    gamesPerSide: requestedGamesPerSide ?? BENCHMARK_MODE_DEFAULT_GAMES[mode],
    seed: getArgNumber(args, "seed", 20260618),
    workerCount: requestedWorkers ?? (hasFlag(args, "parallel") || mode === "full" ? "auto" : 1),
    search: {
      timeLimitMs: getArgNumber(args, "search-ms", 25, 0),
      samples: getArgNumber(args, "search-samples", 4),
      seed: getArgNumber(args, "search-seed", 424242),
      minSamples: getArgNumber(args, "search-min-samples", 1, 0),
      maxSampleAttempts: getArgNumber(args, "search-sample-attempts", 40),
    },
  };
}

function createRandom(seed) {
  let value = seed >>> 0;

  return () => {
    value += 0x6d2b79f5;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function shuffle(deck, random) {
  const shuffled = [...deck];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled;
}

function dealRound(random) {
  const deck = shuffle(buildDeck(), random);
  const kitty = deck.slice(0, 5);
  const hands = [[], [], [], []];
  let dealIndex = 5;

  for (let player = 0; player < 4; player += 1) {
    hands[player] = sortHand(deck.slice(dealIndex, dealIndex + 13));
    dealIndex += 13;
  }

  return { kitty, hands };
}

function strategyLabelForPlayer(playerId, candidateTeam) {
  return teamForPlayer(playerId) === candidateTeam ? "candidate" : "baseline";
}

function getStrategy(playerId, candidateTeam, strategies) {
  return strategyLabelForPlayer(playerId, candidateTeam) === "candidate" ? strategies.candidateAi : strategies.baselineAi;
}

function createStats() {
  return {
    rounds: 0,
    bids: { candidate: 0, baseline: 0 },
    roundBids: { candidate: 0, baseline: 0 },
    madeBids: { candidate: 0, baseline: 0 },
    failedBids: { candidate: 0, baseline: 0 },
    roundScore: { candidate: 0, baseline: 0 },
    decisions: { candidate: 0, baseline: 0 },
    decisionRuntimeMs: { candidate: 0, baseline: 0 },
    decisionKinds: { bid: 0, kitty: 0, play: 0 },
    decisionKindRuntimeMs: { bid: 0, kitty: 0, play: 0 },
    search: {
      decisions: 0,
      fallbacks: 0,
      samples: 0,
      runtimeMs: 0,
      timeouts: 0,
    },
    illegalMoves: 0,
  };
}

function measureDecision(stats, label, kind, callback) {
  const startedAt = performance.now();
  stats.decisions[label] += 1;
  stats.decisionKinds[kind] += 1;

  try {
    return callback();
  } finally {
    const elapsedMs = performance.now() - startedAt;
    stats.decisionRuntimeMs[label] += elapsedMs;
    stats.decisionKindRuntimeMs[kind] += elapsedMs;
  }
}

function failIllegal(stats, message) {
  stats.illegalMoves += 1;
  throw new Error(message);
}

function createPublicSearchView(state, playerId) {
  return {
    ...state,
    hands: state.hands.map((hand, handPlayerId) => {
      if (handPlayerId === playerId) return [...hand];
      return new Array(hand.length);
    }),
    bidInfo: {
      ...state.bidInfo,
      passed: [...state.bidInfo.passed],
    },
    tricks: state.tricks.map((trick) => trick.map((play) => ({ ...play }))),
    currentTrick: state.currentTrick.map((play) => ({ ...play })),
    pointsTaken: { ...state.pointsTaken },
    settings: { ...state.settings },
  };
}

function shouldUseSearchForPlay(label, options) {
  return label === "candidate" && options.candidateMode === "search";
}

function choosePlayCard(state, playerId, candidateTeam, stats, strategies, options) {
  const label = strategyLabelForPlayer(playerId, candidateTeam);
  const strategy = getStrategy(playerId, candidateTeam, strategies);

  if (!shouldUseSearchForPlay(label, options)) {
    return strategy.chooseBotPlay(state, playerId);
  }

  const searchSeed =
    state.searchContext.baseSeed +
    state.searchContext.decisionIndex * 1009 +
    stats.rounds * 9176 +
    playerId * 193 +
    state.currentTrick.length * 31;
  state.searchContext.decisionIndex += 1;
  const result = evaluateSampledPlayCandidates(createPublicSearchView(state, playerId), playerId, {
    seed: searchSeed,
    samples: options.search.samples,
    minSamples: options.search.minSamples,
    timeLimitMs: options.search.timeLimitMs,
    maxSampleAttempts: options.search.maxSampleAttempts,
    policy: strategy.chooseBotPlay,
    fallbackCard: strategy.chooseBotPlay(state, playerId),
  });

  stats.search.decisions += 1;
  stats.search.samples += result.samplesUsed;
  stats.search.runtimeMs += result.elapsedMs;

  if (result.usedFallback) {
    stats.search.fallbacks += 1;
  }

  if (result.elapsedMs >= options.search.timeLimitMs && result.samplesUsed < options.search.samples) {
    stats.search.timeouts += 1;
  }

  return result.card;
}

function createGame(seed) {
  const random = createRandom(seed);

  return {
    random,
    state: {
      kitty: [],
      kittyPoints: 0,
      hands: [[], [], [], []],
      scores: { us: 0, them: 0 },
      dealer: Math.floor(random() * 4),
      currentTurn: 0,
      bidInfo: {
        active: false,
        highBid: 0,
        bidder: null,
        passed: [false, false, false, false],
      },
      trump: null,
      tricks: [],
      currentTrick: [],
      pointsTaken: { us: 0, them: 0 },
      settings: { mustWinByBid: false },
    },
  };
}

function prepareRound(game) {
  const { kitty, hands } = dealRound(game.random);
  const state = game.state;

  state.kitty = kitty;
  state.hands = hands;
  state.kittyPoints = 0;
  state.trump = null;
  state.pointsTaken = { us: 0, them: 0 };
  state.currentTrick = [];
  state.tricks = [];
  state.bidInfo = {
    active: true,
    highBid: BID_START,
    bidder: null,
    passed: [false, false, false, false],
  };
  state.dealer = (state.dealer + 1) % 4;
  state.currentTurn = (state.dealer + 1) % 4;
}

function advanceTurn(state) {
  state.currentTurn = (state.currentTurn + 1) % 4;
}

function runBidding(state, candidateTeam, stats, strategies) {
  let guard = 0;

  while (state.bidInfo.passed.filter((hasPassed) => !hasPassed).length > 1) {
    guard += 1;
    if (guard > 80) throw new Error("Bidding did not terminate.");

    if (state.bidInfo.passed[state.currentTurn]) {
      advanceTurn(state);
      continue;
    }

    const strategy = getStrategy(state.currentTurn, candidateTeam, strategies);
    const label = strategyLabelForPlayer(state.currentTurn, candidateTeam);
    const amount = measureDecision(stats, label, "bid", () => strategy.chooseBotBid(state, state.currentTurn, MAX_BID));
    const nextBid = Math.max(100, state.bidInfo.highBid + 5);

    if (!Number.isInteger(amount)) {
      failIllegal(stats, `Strategy ${label} returned a non-integer bid.`);
    }

    if (amount !== 0 && (amount < nextBid || amount > MAX_BID || amount % 5 !== 0)) {
      failIllegal(stats, `Strategy ${label} returned an illegal bid ${amount}; expected 0 or ${nextBid}-${MAX_BID}.`);
    }

    if (amount > 0) {
      state.bidInfo.highBid = amount;
      state.bidInfo.bidder = state.currentTurn;
      state.bidInfo.passed[state.currentTurn] = false;
      stats.bids[label] += 1;
    } else {
      state.bidInfo.passed[state.currentTurn] = true;
    }

    advanceTurn(state);
  }

  const winner = state.bidInfo.bidder ?? state.dealer;
  state.bidInfo.highBid = Math.max(100, state.bidInfo.highBid);
  state.bidInfo.bidder = winner;
  state.hands[winner] = sortHand([...state.hands[winner], ...state.kitty]);
  stats.roundBids[strategyLabelForPlayer(winner, candidateTeam)] += 1;

  return winner;
}

function chooseKitty(state, winner, candidateTeam, stats, strategies) {
  const strategy = getStrategy(winner, candidateTeam, strategies);
  const label = strategyLabelForPlayer(winner, candidateTeam);
  const plan = measureDecision(stats, label, "kitty", () => strategy.chooseBotKittyPlan(state.hands[winner]));

  if (!isValidKittyDiscard(state.hands[winner], plan.discards, plan.trump)) {
    failIllegal(stats, `Strategy ${label} returned an illegal kitty discard.`);
  }

  state.hands[winner] = plan.hand;
  state.kittyPoints = plan.discards.reduce((sum, card) => sum + card.value, 0);
  state.trump = plan.trump;
  state.currentTurn = winner;
}

function playCard(state, playerId, candidateTeam, stats, strategies, options) {
  const label = strategyLabelForPlayer(playerId, candidateTeam);
  const hand = state.hands[playerId];
  const leadColor = getLeadColor(state.currentTrick, state.trump);
  const validCards = hand.filter((card) => isValidMove(card, hand, leadColor, state.trump));
  const choice = measureDecision(stats, label, "play", () =>
    choosePlayCard(state, playerId, candidateTeam, stats, strategies, options),
  );

  if (!choice) failIllegal(stats, `Strategy ${label} returned no card.`);

  const isValid = validCards.length === 0 || validCards.some((card) => card.id === choice.id);
  if (!isValid) {
    failIllegal(stats, `Strategy ${label} returned an illegal card.`);
  }

  const cardIndex = hand.findIndex((card) => card.id === choice.id);
  if (cardIndex < 0) failIllegal(stats, `Strategy ${label} returned a card that is not in hand.`);

  const [card] = hand.splice(cardIndex, 1);
  state.currentTrick.push({ pid: playerId, card });
  advanceTurn(state);
}

function resolveTrick(state) {
  const leadColor = getLeadColor(state.currentTrick, state.trump);
  let bestIndex = 0;
  let bestPower = getCardPower(state.currentTrick[0].card, state.trump, leadColor);
  let points = 0;

  state.currentTrick.forEach((play, index) => {
    points += play.card.value;

    if (index === 0) return;

    const power = getCardPower(play.card, state.trump, leadColor);
    if (power > bestPower) {
      bestPower = power;
      bestIndex = index;
    }
  });

  const winner = state.currentTrick[bestIndex].pid;
  state.pointsTaken[teamForPlayer(winner)] += points;
  state.tricks.push(state.currentTrick.map((play) => ({ ...play })));
  state.currentTrick = [];
  state.currentTurn = winner;
}

function playRound(state, candidateTeam, stats, strategies, options) {
  const bidder = runBidding(state, candidateTeam, stats, strategies);
  chooseKitty(state, bidder, candidateTeam, stats, strategies);

  while (state.hands[0].length > 0) {
    while (state.currentTrick.length < 4) {
      playCard(state, state.currentTurn, candidateTeam, stats, strategies, options);
    }

    resolveTrick(state);
  }

  const roundScore = completeRoundScore(state);
  state.pointsTaken = roundScore.pointsTaken;
  state.scores.us += roundScore.scoreChange.us;
  state.scores.them += roundScore.scoreChange.them;

  const bidLabel = strategyLabelForPlayer(roundScore.bidTeam === "us" ? 0 : 1, candidateTeam);
  const bidMade = roundScore.scoreChange[roundScore.bidTeam] >= 0;
  if (bidMade) {
    stats.madeBids[bidLabel] += 1;
  } else {
    stats.failedBids[bidLabel] += 1;
  }

  stats.rounds += 1;
  stats.roundScore.candidate += roundScore.scoreChange[candidateTeam];
  stats.roundScore.baseline += roundScore.scoreChange[candidateTeam === "us" ? "them" : "us"];
}

function simulateGame(seed, candidateTeam, strategies, options) {
  const game = createGame(seed);
  const stats = createStats();
  game.state.searchContext = {
    baseSeed: options.search.seed + seed * 37 + (candidateTeam === "us" ? 0 : 1_000_003),
    decisionIndex: 0,
  };

  while (
    Math.max(game.state.scores.us, game.state.scores.them) < TARGET_SCORE &&
    stats.rounds < MAX_ROUNDS_PER_GAME
  ) {
    prepareRound(game);
    playRound(game.state, candidateTeam, stats, strategies, options);
  }

  const candidateScore = game.state.scores[candidateTeam];
  const baselineScore = game.state.scores[candidateTeam === "us" ? "them" : "us"];

  return {
    candidateTeam,
    candidateScore,
    baselineScore,
    candidateWon: candidateScore > baselineScore,
    margin: candidateScore - baselineScore,
    stats,
  };
}

function mergeStats(total, next) {
  total.rounds += next.rounds;
  total.bids.candidate += next.bids.candidate;
  total.bids.baseline += next.bids.baseline;
  total.roundBids.candidate += next.roundBids.candidate;
  total.roundBids.baseline += next.roundBids.baseline;
  total.madeBids.candidate += next.madeBids.candidate;
  total.madeBids.baseline += next.madeBids.baseline;
  total.failedBids.candidate += next.failedBids.candidate;
  total.failedBids.baseline += next.failedBids.baseline;
  total.roundScore.candidate += next.roundScore.candidate;
  total.roundScore.baseline += next.roundScore.baseline;
  total.decisions.candidate += next.decisions.candidate;
  total.decisions.baseline += next.decisions.baseline;
  total.decisionRuntimeMs.candidate += next.decisionRuntimeMs.candidate;
  total.decisionRuntimeMs.baseline += next.decisionRuntimeMs.baseline;
  total.decisionKinds.bid += next.decisionKinds.bid;
  total.decisionKinds.kitty += next.decisionKinds.kitty;
  total.decisionKinds.play += next.decisionKinds.play;
  total.decisionKindRuntimeMs.bid += next.decisionKindRuntimeMs.bid;
  total.decisionKindRuntimeMs.kitty += next.decisionKindRuntimeMs.kitty;
  total.decisionKindRuntimeMs.play += next.decisionKindRuntimeMs.play;
  total.search.decisions += next.search.decisions;
  total.search.fallbacks += next.search.fallbacks;
  total.search.samples += next.search.samples;
  total.search.runtimeMs += next.search.runtimeMs;
  total.search.timeouts += next.search.timeouts;
  total.illegalMoves += next.illegalMoves;
}

function pct(numerator, denominator) {
  return denominator === 0 ? "0.0%" : `${((numerator / denominator) * 100).toFixed(1)}%`;
}

export function createBenchmarkTotal() {
  return {
    games: 0,
    wins: 0,
    margin: 0,
    stats: createStats(),
  };
}

export function mergeBenchmarkTotals(total, next) {
  total.games += next.games;
  total.wins += next.wins;
  total.margin += next.margin;
  mergeStats(total.stats, next.stats);
  return total;
}

export function simulateBenchmarkRange({ startIndex = 0, gamesPerSide, seed, strategies, options }) {
  const total = createBenchmarkTotal();
  const benchmarkOptions = options ?? parseBenchmarkArgs([]);

  for (let index = startIndex; index < startIndex + gamesPerSide; index += 1) {
    for (const candidateTeam of ["us", "them"]) {
      const gameSeed = seed + index * 97;
      const result = simulateGame(gameSeed, candidateTeam, strategies, benchmarkOptions);
      total.games += 1;
      total.wins += result.candidateWon ? 1 : 0;
      total.margin += result.margin;
      mergeStats(total.stats, result.stats);
    }
  }

  return total;
}

export function formatBenchmarkSummary({ total, seed, mode, candidateMode, gamesPerSide, elapsedMs, workerCount, search }) {
  const candidateBidDecisions = total.stats.madeBids.candidate + total.stats.failedBids.candidate;
  const baselineBidDecisions = total.stats.madeBids.baseline + total.stats.failedBids.baseline;
  const totalDecisions = total.stats.decisions.candidate + total.stats.decisions.baseline;
  const totalDecisionRuntimeMs = total.stats.decisionRuntimeMs.candidate + total.stats.decisionRuntimeMs.baseline;
  const averageSamplesPerSearchDecision =
    total.stats.search.decisions > 0 ? total.stats.search.samples / total.stats.search.decisions : 0;
  const averageSearchMsPerDecision =
    total.stats.search.decisions > 0 ? total.stats.search.runtimeMs / total.stats.search.decisions : 0;
  const searchFallbackRate =
    total.stats.search.decisions > 0 ? pct(total.stats.search.fallbacks, total.stats.search.decisions) : "0.0%";

  return [
    `AI benchmark seed: ${seed}`,
    `Benchmark mode: ${mode}`,
    `Candidate mode: ${candidateMode}`,
    `Workers: ${workerCount}`,
    `Games per orientation: ${gamesPerSide}`,
    `Total games: ${total.games}`,
    `Candidate wins: ${total.wins}/${total.games} (${pct(total.wins, total.games)})`,
    `Average final margin: ${(total.margin / total.games).toFixed(1)} points`,
    `Rounds played: ${total.stats.rounds}`,
    `Round score average: candidate ${(total.stats.roundScore.candidate / total.stats.rounds).toFixed(1)}, baseline ${(
      total.stats.roundScore.baseline / total.stats.rounds
    ).toFixed(1)}`,
    `Bids won: candidate ${total.stats.roundBids.candidate}, baseline ${total.stats.roundBids.baseline}`,
    `Bid make rate: candidate ${pct(total.stats.madeBids.candidate, candidateBidDecisions)}, baseline ${pct(
      total.stats.madeBids.baseline,
      baselineBidDecisions,
    )}`,
    `Decisions: candidate ${total.stats.decisions.candidate}, baseline ${total.stats.decisions.baseline}, total ${totalDecisions}, average ${(
      totalDecisions / total.games
    ).toFixed(1)}/game`,
    `Illegal move count: ${total.stats.illegalMoves}`,
    `Decision type counts: bid ${total.stats.decisionKinds.bid}, kitty ${total.stats.decisionKinds.kitty}, play ${total.stats.decisionKinds.play}`,
    `Decision type runtime: bid ${total.stats.decisionKindRuntimeMs.bid.toFixed(1)} ms, kitty ${total.stats.decisionKindRuntimeMs.kitty.toFixed(
      1,
    )} ms, play ${total.stats.decisionKindRuntimeMs.play.toFixed(1)} ms`,
    `Search config: time ${search.timeLimitMs} ms, max samples ${search.samples}, seed ${search.seed}, min samples ${search.minSamples}`,
    `Search decisions: ${total.stats.search.decisions}`,
    `Search fallback decisions: ${total.stats.search.fallbacks} (${searchFallbackRate})`,
    `Search samples evaluated: ${total.stats.search.samples}`,
    `Average search samples/decision: ${averageSamplesPerSearchDecision.toFixed(2)}`,
    `Average search ms/decision: ${averageSearchMsPerDecision.toFixed(2)}`,
    `Search timeout count: ${total.stats.search.timeouts}`,
    `Elapsed time: ${elapsedMs.toFixed(1)} ms`,
    `Average runtime: ${(elapsedMs / total.games).toFixed(2)} ms/game, ${(totalDecisionRuntimeMs / totalDecisions).toFixed(
      4,
    )} ms/decision`,
    `Measured AI decision time: candidate ${total.stats.decisionRuntimeMs.candidate.toFixed(1)} ms, baseline ${total.stats.decisionRuntimeMs.baseline.toFixed(
      1,
    )} ms`,
  ];
}
