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
import { DEFAULT_SEARCH_CONFIG, LIVE_SEARCH_CONFIG, normalizeSearchConfig } from "../src/ai/config.js";
import {
  CHALLENGER_ENGINE_ID,
  CHAMPION_ENGINE_ID,
  CURRENT_ENGINE_ID,
  expandOpponentEngineIds,
  resolveEngineId,
} from "./ai-engines.mjs";
import { DEFAULT_BENCHMARK_SEED } from "./ai-seed-groups.mjs";
import { eloDeltaFromScore, wilsonScoreInterval } from "./ai-statistics.mjs";

const TARGET_SCORE = 500;
const MAX_BID = 150;
const MAX_ROUNDS_PER_GAME = 60;
export const BENCHMARK_MODE_DEFAULT_GAMES = {
  quick: 20,
  standard: 200,
  full: 1000,
};
const SEARCH_PROFILES = new Set(["benchmark", "live"]);

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

function getOptionalSearchNumber(args, name, { min = 0, allowInfinity = false, allowNull = false } = {}) {
  const rawValue = getArgValue(args, name);
  if (rawValue === null) return undefined;

  const normalized = String(rawValue).trim().toLowerCase();
  if (allowInfinity && ["infinity", "inf", "unlimited"].includes(normalized)) return Number.POSITIVE_INFINITY;
  if (allowNull && ["null", "none", "off"].includes(normalized)) return null;

  const value = Number(rawValue);
  return Number.isFinite(value) && value >= min ? value : undefined;
}

export function parseBenchmarkArgs(args = process.argv.slice(2)) {
  const mode = getArgValue(args, "mode") ?? (hasFlag(args, "quick") ? "quick" : hasFlag(args, "full") ? "full" : "standard");
  const searchProfile = (getArgValue(args, "profile") ?? "benchmark").trim().toLowerCase();
  const candidateSpec = getArgValue(args, "candidate") ?? (hasFlag(args, "play-search") ? CHALLENGER_ENGINE_ID : CURRENT_ENGINE_ID);
  const candidateEngineId = resolveEngineId(candidateSpec);
  const opponentEngineIds = expandOpponentEngineIds(getArgValue(args, "opponent"), {
    includeBothBaselines: hasFlag(args, "both-baselines") || hasFlag(args, "compare-baselines"),
  });

  if (!Object.hasOwn(BENCHMARK_MODE_DEFAULT_GAMES, mode)) {
    throw new Error(`Unsupported benchmark mode "${mode}". Use "quick", "standard", or "full".`);
  }
  if (!SEARCH_PROFILES.has(searchProfile)) {
    throw new Error(`Unsupported search profile "${searchProfile}". Use "benchmark" or "live".`);
  }

  const requestedGamesPerSide = getArgNumber(args, "games", null);
  const requestedWorkers = getArgNumber(args, "workers", null);
  const profileSearchConfig = searchProfile === "live" ? LIVE_SEARCH_CONFIG : DEFAULT_SEARCH_CONFIG;
  const searchOverrides = {};
  const overrideSpecs = [
    ["search-ms", "timeLimitMs", { min: 0 }],
    ["search-samples", "samples", { min: 1 }],
    ["search-seed", "seed", { min: 1 }],
    ["search-min-samples", "minSamples", { min: 0 }],
    ["search-sample-attempts", "maxSampleAttempts", { min: 1 }],
    ["search-endgame", "exactEndgameHandSize", { min: 0 }],
    ["search-node-limit", "exactNodeLimit", { min: 1 }],
    ["search-rollout-max-hand", "rolloutMaxHandSize", { min: 0, allowInfinity: true }],
    ["search-early-stop", "earlyStopLead", { min: 0, allowNull: true }],
  ];

  overrideSpecs.forEach(([argName, configKey, parseOptions]) => {
    const value = getOptionalSearchNumber(args, argName, parseOptions);
    if (value !== undefined) searchOverrides[configKey] = value;
  });

  return {
    mode,
    advancementGate: getArgValue(args, "gate") ?? (hasFlag(args, "promotion-gate") ? "promotion" : hasFlag(args, "consideration-gate") ? "consideration" : null),
    candidateMode: candidateEngineId,
    candidateEngineId,
    opponentEngineId: opponentEngineIds[0] ?? CHAMPION_ENGINE_ID,
    opponentEngineIds,
    gamesPerSide: requestedGamesPerSide ?? BENCHMARK_MODE_DEFAULT_GAMES[mode],
    seed: getArgNumber(args, "seed", DEFAULT_BENCHMARK_SEED),
    workerCount: requestedWorkers ?? (hasFlag(args, "parallel") || mode === "full" ? "auto" : 1),
    searchProfile,
    deterministicSearch: searchProfile === "live" && !hasFlag(args, "wall-clock-search"),
    searchOverrides,
    search: normalizeSearchConfig({
      ...profileSearchConfig,
      ...searchOverrides,
    }),
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
  return getEngine(playerId, candidateTeam, strategies).ai;
}

function getEngine(playerId, candidateTeam, strategies) {
  const label = strategyLabelForPlayer(playerId, candidateTeam);
  if (strategies.candidateEngine || strategies.baselineEngine) {
    return label === "candidate" ? strategies.candidateEngine : strategies.baselineEngine;
  }

  return {
    id: label,
    name: label,
    ai: label === "candidate" ? strategies.candidateAi : strategies.baselineAi,
    evaluateSearch: null,
    usesSearch: false,
  };
}

function createStats() {
  const createRolePerformance = () => ({
    bidRounds: 0,
    madeBids: 0,
    failedBids: 0,
    defenseRounds: 0,
    sets: 0,
    scoreAsBidder: 0,
    scoreAsDefender: 0,
  });
  const createTrickPerformance = () => ({
    early: { won: 0, points: 0 },
    middle: { won: 0, points: 0 },
    endgame: { won: 0, points: 0 },
  });

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
    rolePerformance: {
      candidate: createRolePerformance(),
      baseline: createRolePerformance(),
    },
    trickPerformance: {
      candidate: createTrickPerformance(),
      baseline: createTrickPerformance(),
    },
    search: {
      decisions: 0,
      fallbacks: 0,
      samples: 0,
      runtimeMs: 0,
      timeouts: 0,
    },
    illegalMoves: 0,
    illegal: {
      bids: 0,
      discards: 0,
      plays: 0,
    },
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

function failIllegal(stats, kind, message) {
  stats.illegalMoves += 1;
  if (stats.illegal[kind] !== undefined) {
    stats.illegal[kind] += 1;
  }
  throw new Error(message);
}

export function createPublicSearchView(state, playerId) {
  return {
    ...state,
    kitty: [],
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

function shouldUseSearchForPlay(engine) {
  return Boolean(engine?.usesSearch && typeof engine.evaluateSearch === "function");
}

function getEngineSearchConfig(engine, options, strategyLabel) {
  const engineSpecificConfig = options.engineSearchConfigs?.[strategyLabel];
  if (engineSpecificConfig) {
    const normalized = normalizeSearchConfig(engineSpecificConfig);
    return options.deterministicSearch
      ? normalizeSearchConfig({ ...normalized, timeLimitMs: Math.max(normalized.timeLimitMs, 5000) })
      : normalized;
  }

  if (!options.searchProfile) return normalizeSearchConfig(options.search);

  const profileConfig =
    options.searchProfile === "live"
      ? engine.liveSearchConfig ?? options.search
      : engine.defaultSearchConfig ?? options.search;
  const overrides = options.searchOverrides ?? {};

  const normalized = normalizeSearchConfig({
    ...profileConfig,
    ...overrides,
    evaluation: {
      ...profileConfig.evaluation,
      ...(overrides.evaluation ?? {}),
    },
  });

  return options.deterministicSearch
    ? normalizeSearchConfig({ ...normalized, timeLimitMs: Math.max(normalized.timeLimitMs, 5000) })
    : normalized;
}

function choosePlayCard(state, playerId, candidateTeam, stats, strategies, options) {
  const label = strategyLabelForPlayer(playerId, candidateTeam);
  const engine = getEngine(playerId, candidateTeam, strategies);
  const strategy = engine.ai;

  if (!shouldUseSearchForPlay(engine)) {
    return strategy.chooseBotPlay(state, playerId);
  }

  const searchConfig = getEngineSearchConfig(engine, options, label);

  const searchSeed =
    state.searchContext.baseSeed +
    state.searchContext.decisionIndex * 1009 +
    stats.rounds * 9176 +
    playerId * 193 +
    state.currentTrick.length * 31;
  state.searchContext.decisionIndex += 1;
  const result = engine.evaluateSearch(createPublicSearchView(state, playerId), playerId, {
    ...searchConfig,
    seed: searchSeed,
    policy: strategy.chooseBotPlay,
    fallbackCard: strategy.chooseBotPlay(state, playerId),
  });

  stats.search.decisions += 1;
  stats.search.samples += result.samplesUsed;
  stats.search.runtimeMs += result.elapsedMs;

  if (result.usedFallback) {
    stats.search.fallbacks += 1;
  }

  if (result.elapsedMs >= searchConfig.timeLimitMs && result.samplesUsed < searchConfig.samples) {
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
      failIllegal(stats, "bids", `Strategy ${label} returned a non-integer bid.`);
    }

    if (amount !== 0 && (amount < nextBid || amount > MAX_BID || amount % 5 !== 0)) {
      failIllegal(stats, "bids", `Strategy ${label} returned an illegal bid ${amount}; expected 0 or ${nextBid}-${MAX_BID}.`);
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
  const plan = measureDecision(stats, label, "kitty", () =>
    strategy.chooseBotKittyPlan(state.hands[winner], { game: state, playerId: winner }),
  );

  if (!isValidKittyDiscard(state.hands[winner], plan.discards, plan.trump)) {
    failIllegal(stats, "discards", `Strategy ${label} returned an illegal kitty discard.`);
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

  if (!choice) failIllegal(stats, "plays", `Strategy ${label} returned no card.`);

  const isValid = validCards.length === 0 || validCards.some((card) => card.id === choice.id);
  if (!isValid) {
    failIllegal(stats, "plays", `Strategy ${label} returned an illegal card.`);
  }

  const cardIndex = hand.findIndex((card) => card.id === choice.id);
  if (cardIndex < 0) failIllegal(stats, "plays", `Strategy ${label} returned a card that is not in hand.`);

  const [card] = hand.splice(cardIndex, 1);
  state.currentTrick.push({ pid: playerId, card });
  advanceTurn(state);
}

function resolveTrick(state, candidateTeam, stats) {
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
  const winningTeam = teamForPlayer(winner);
  const winningLabel = winningTeam === candidateTeam ? "candidate" : "baseline";
  const trickIndex = state.tricks.length;
  const stage = trickIndex < 4 ? "early" : trickIndex < 9 ? "middle" : "endgame";
  state.pointsTaken[winningTeam] += points;
  stats.trickPerformance[winningLabel][stage].won += 1;
  stats.trickPerformance[winningLabel][stage].points += points;
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

    resolveTrick(state, candidateTeam, stats);
  }

  const roundScore = completeRoundScore(state);
  state.pointsTaken = roundScore.pointsTaken;
  state.scores.us += roundScore.scoreChange.us;
  state.scores.them += roundScore.scoreChange.them;

  const bidLabel = strategyLabelForPlayer(roundScore.bidTeam === "us" ? 0 : 1, candidateTeam);
  const defenseLabel = bidLabel === "candidate" ? "baseline" : "candidate";
  const defenseTeam = roundScore.bidTeam === "us" ? "them" : "us";
  const bidMade = roundScore.scoreChange[roundScore.bidTeam] >= 0;
  stats.rolePerformance[bidLabel].bidRounds += 1;
  stats.rolePerformance[defenseLabel].defenseRounds += 1;
  stats.rolePerformance[bidLabel].scoreAsBidder += roundScore.scoreChange[roundScore.bidTeam];
  stats.rolePerformance[defenseLabel].scoreAsDefender += roundScore.scoreChange[defenseTeam];
  if (bidMade) {
    stats.madeBids[bidLabel] += 1;
    stats.rolePerformance[bidLabel].madeBids += 1;
  } else {
    stats.failedBids[bidLabel] += 1;
    stats.rolePerformance[bidLabel].failedBids += 1;
    stats.rolePerformance[defenseLabel].sets += 1;
  }

  stats.rounds += 1;
  stats.roundScore.candidate += roundScore.scoreChange[candidateTeam];
  stats.roundScore.baseline += roundScore.scoreChange[candidateTeam === "us" ? "them" : "us"];
}

function simulateGame(seed, candidateTeam, strategies, options) {
  const game = createGame(seed);
  const stats = createStats();
  game.state.searchContext = {
    baseSeed: options.search.seed + seed * 37,
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
  for (const label of ["candidate", "baseline"]) {
    for (const key of ["bidRounds", "madeBids", "failedBids", "defenseRounds", "sets", "scoreAsBidder", "scoreAsDefender"]) {
      total.rolePerformance[label][key] += next.rolePerformance[label][key];
    }
    for (const stage of ["early", "middle", "endgame"]) {
      total.trickPerformance[label][stage].won += next.trickPerformance[label][stage].won;
      total.trickPerformance[label][stage].points += next.trickPerformance[label][stage].points;
    }
  }
  total.search.decisions += next.search.decisions;
  total.search.fallbacks += next.search.fallbacks;
  total.search.samples += next.search.samples;
  total.search.runtimeMs += next.search.runtimeMs;
  total.search.timeouts += next.search.timeouts;
  total.illegalMoves += next.illegalMoves;
  total.illegal.bids += next.illegal.bids;
  total.illegal.discards += next.illegal.discards;
  total.illegal.plays += next.illegal.plays;
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

export function getBenchmarkMetrics(total, elapsedMs = 0) {
  const candidateBidDecisions = total.stats.madeBids.candidate + total.stats.failedBids.candidate;
  const baselineBidDecisions = total.stats.madeBids.baseline + total.stats.failedBids.baseline;
  const totalDecisions = total.stats.decisions.candidate + total.stats.decisions.baseline;
  const totalDecisionRuntimeMs = total.stats.decisionRuntimeMs.candidate + total.stats.decisionRuntimeMs.baseline;
  const averageSamplesPerSearchDecision =
    total.stats.search.decisions > 0 ? total.stats.search.samples / total.stats.search.decisions : 0;
  const averageSearchMsPerDecision =
    total.stats.search.decisions > 0 ? total.stats.search.runtimeMs / total.stats.search.decisions : 0;
  const winRate = total.games > 0 ? total.wins / total.games : 0;
  const winRateInterval = wilsonScoreInterval(total.wins, total.games);

  return {
    games: total.games,
    wins: total.wins,
    winRate,
    winRateLow95: winRateInterval.low,
    winRateHigh95: winRateInterval.high,
    approximateEloDelta: total.games > 0 ? eloDeltaFromScore(winRate) : 0,
    averageMargin: total.games > 0 ? total.margin / total.games : 0,
    rounds: total.stats.rounds,
    candidateRoundScoreAverage: total.stats.rounds > 0 ? total.stats.roundScore.candidate / total.stats.rounds : 0,
    baselineRoundScoreAverage: total.stats.rounds > 0 ? total.stats.roundScore.baseline / total.stats.rounds : 0,
    candidateBidsWon: total.stats.roundBids.candidate,
    baselineBidsWon: total.stats.roundBids.baseline,
    candidateBidMakeRate: candidateBidDecisions > 0 ? total.stats.madeBids.candidate / candidateBidDecisions : 0,
    baselineBidMakeRate: baselineBidDecisions > 0 ? total.stats.madeBids.baseline / baselineBidDecisions : 0,
    candidateDecisions: total.stats.decisions.candidate,
    baselineDecisions: total.stats.decisions.baseline,
    totalDecisions,
    decisionsPerGame: total.games > 0 ? totalDecisions / total.games : 0,
    illegalMoves: total.stats.illegalMoves,
    decisionKinds: { ...total.stats.decisionKinds },
    decisionKindRuntimeMs: { ...total.stats.decisionKindRuntimeMs },
    rolePerformance: structuredClone(total.stats.rolePerformance),
    trickPerformance: structuredClone(total.stats.trickPerformance),
    searchDecisions: total.stats.search.decisions,
    searchFallbacks: total.stats.search.fallbacks,
    searchFallbackRate: total.stats.search.decisions > 0 ? total.stats.search.fallbacks / total.stats.search.decisions : 0,
    searchSamples: total.stats.search.samples,
    averageSearchSamplesPerDecision: averageSamplesPerSearchDecision,
    averageSearchMsPerDecision,
    searchTimeouts: total.stats.search.timeouts,
    illegalBids: total.stats.illegal.bids,
    illegalDiscards: total.stats.illegal.discards,
    illegalPlays: total.stats.illegal.plays,
    elapsedMs,
    averageRuntimeMsPerGame: total.games > 0 ? elapsedMs / total.games : 0,
    averageMeasuredMsPerDecision: totalDecisions > 0 ? totalDecisionRuntimeMs / totalDecisions : 0,
    candidateDecisionRuntimeMs: total.stats.decisionRuntimeMs.candidate,
    baselineDecisionRuntimeMs: total.stats.decisionRuntimeMs.baseline,
  };
}

export function createBenchmarkFingerprint(total) {
  return {
    games: total.games,
    wins: total.wins,
    margin: total.margin,
    rounds: total.stats.rounds,
    bids: { ...total.stats.bids },
    roundBids: { ...total.stats.roundBids },
    madeBids: { ...total.stats.madeBids },
    failedBids: { ...total.stats.failedBids },
    roundScore: { ...total.stats.roundScore },
    decisions: { ...total.stats.decisions },
    decisionKinds: { ...total.stats.decisionKinds },
    rolePerformance: structuredClone(total.stats.rolePerformance),
    trickPerformance: structuredClone(total.stats.trickPerformance),
    search: {
      decisions: total.stats.search.decisions,
      fallbacks: total.stats.search.fallbacks,
      samples: total.stats.search.samples,
      timeouts: total.stats.search.timeouts,
    },
    illegalMoves: total.stats.illegalMoves,
    illegal: { ...total.stats.illegal },
  };
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

export function formatBenchmarkSummary({
  total,
  seed,
  mode,
  candidateMode,
  candidate,
  opponent,
  gamesPerSide,
  elapsedMs,
  workerCount,
  search,
  searchProfile = "benchmark",
  deterministicSearch = false,
}) {
  const metrics = getBenchmarkMetrics(total, elapsedMs);
  const candidateLabel = candidate ?? candidateMode ?? "candidate";
  const opponentLabel = opponent ?? "baseline";

  return [
    `AI benchmark seed: ${seed}`,
    `Benchmark mode: ${mode}`,
    `Candidate engine: ${candidateLabel}`,
    `Opponent engine: ${opponentLabel}`,
    `Search profile: ${searchProfile}`,
    `Deterministic fixed-work strength run: ${deterministicSearch ? "yes" : "no"}`,
    `Workers: ${workerCount}`,
    `Games per orientation: ${gamesPerSide}`,
    `Total games: ${total.games}`,
    `Candidate wins: ${total.wins}/${total.games} (${pct(total.wins, total.games)})`,
    `95% win-rate interval: ${pct(metrics.winRateLow95, 1)}-${pct(metrics.winRateHigh95, 1)}`,
    `Approximate Elo delta: ${metrics.approximateEloDelta >= 0 ? "+" : ""}${metrics.approximateEloDelta.toFixed(0)}`,
    `Average final margin: ${metrics.averageMargin.toFixed(1)} points`,
    `Rounds played: ${total.stats.rounds}`,
    `Round score average: candidate ${metrics.candidateRoundScoreAverage.toFixed(1)}, opponent ${metrics.baselineRoundScoreAverage.toFixed(1)}`,
    `Bids won: candidate ${total.stats.roundBids.candidate}, opponent ${total.stats.roundBids.baseline}`,
    `Bid make rate: candidate ${pct(total.stats.madeBids.candidate, total.stats.madeBids.candidate + total.stats.failedBids.candidate)}, opponent ${pct(
      total.stats.madeBids.baseline,
      total.stats.madeBids.baseline + total.stats.failedBids.baseline,
    )}`,
    `Bid/defense split: candidate ${total.stats.rolePerformance.candidate.bidRounds} contracts, ${total.stats.rolePerformance.candidate.sets} defensive sets; opponent ${total.stats.rolePerformance.baseline.bidRounds} contracts, ${total.stats.rolePerformance.baseline.sets} defensive sets`,
    `Trick points by stage (candidate/opponent): early ${total.stats.trickPerformance.candidate.early.points}/${total.stats.trickPerformance.baseline.early.points}, middle ${total.stats.trickPerformance.candidate.middle.points}/${total.stats.trickPerformance.baseline.middle.points}, endgame ${total.stats.trickPerformance.candidate.endgame.points}/${total.stats.trickPerformance.baseline.endgame.points}`,
    `Decisions: candidate ${total.stats.decisions.candidate}, opponent ${total.stats.decisions.baseline}, total ${metrics.totalDecisions}, average ${metrics.decisionsPerGame.toFixed(
      1,
    )}/game`,
    `Illegal move count: ${total.stats.illegalMoves} (bids ${total.stats.illegal.bids}, discards ${total.stats.illegal.discards}, plays ${total.stats.illegal.plays})`,
    `Decision type counts: bid ${total.stats.decisionKinds.bid}, kitty ${total.stats.decisionKinds.kitty}, play ${total.stats.decisionKinds.play}`,
    `Decision type runtime: bid ${total.stats.decisionKindRuntimeMs.bid.toFixed(1)} ms, kitty ${total.stats.decisionKindRuntimeMs.kitty.toFixed(
      1,
    )} ms, play ${total.stats.decisionKindRuntimeMs.play.toFixed(1)} ms`,
    `Search config: time ${search.timeLimitMs} ms, max samples ${search.samples}, seed ${search.seed}, min samples ${search.minSamples}`,
    `Search decisions: ${total.stats.search.decisions}`,
    `Search fallback decisions: ${total.stats.search.fallbacks} (${pct(total.stats.search.fallbacks, total.stats.search.decisions)})`,
    `Search samples evaluated: ${total.stats.search.samples}`,
    `Average search samples/decision: ${metrics.averageSearchSamplesPerDecision.toFixed(2)}`,
    `Average search ms/decision: ${metrics.averageSearchMsPerDecision.toFixed(2)}`,
    `Search timeout count: ${total.stats.search.timeouts}`,
    `Elapsed time: ${elapsedMs.toFixed(1)} ms`,
    `Average runtime: ${metrics.averageRuntimeMsPerGame.toFixed(2)} ms/game, ${metrics.averageMeasuredMsPerDecision.toFixed(
      4,
    )} ms/decision`,
    `Measured AI decision time: candidate ${total.stats.decisionRuntimeMs.candidate.toFixed(1)} ms, opponent ${total.stats.decisionRuntimeMs.baseline.toFixed(
      1,
    )} ms`,
    `Deterministic fingerprint: ${JSON.stringify(createBenchmarkFingerprint(total))}`,
  ];
}
