import { chooseBotPlay } from "../ai.js";
import { getLeadColor, isValidMove, teamForPlayer } from "../game.js";
import {
  evaluateRoundState,
  evaluateTerminalRound,
  evaluateTrickDecision,
  getWinningPlay,
  resolveTrickResult,
} from "./evaluation.js";
import { inferPublicBelief, sampleHiddenHands } from "./belief.js";
import { DEFAULT_SEARCH_CONFIG, normalizeSearchConfig } from "./config.js";

function now() {
  return globalThis.performance?.now?.() ?? Date.now();
}

function createSearchProfile() {
  return {
    beliefMs: 0,
    samplingMs: 0,
    cloneMs: 0,
    rolloutMs: 0,
    exactMs: 0,
    leafMs: 0,
    scoringMs: 0,
    candidatesScored: 0,
    exactCalls: 0,
    rolloutCalls: 0,
    leafCalls: 0,
    sampleAttempts: 0,
  };
}

function measureProfile(profile, key, fn) {
  const startedAt = now();

  try {
    return fn();
  } finally {
    if (profile && key) {
      profile[key] = (profile[key] ?? 0) + now() - startedAt;
    }
  }
}

function clonePublicGameWithSample(game, sample) {
  return {
    ...game,
    hands: sample.hands.map((hand) => [...hand]),
    bidInfo: {
      ...game.bidInfo,
      passed: [...(game.bidInfo?.passed ?? [])],
    },
    tricks: (game.tricks ?? []).map((trick) => trick.map((play) => ({ ...play }))),
    currentTrick: (game.currentTrick ?? []).map((play) => ({ ...play })),
    pointsTaken: { ...(game.pointsTaken ?? { us: 0, them: 0 }) },
  };
}

export function getLegalPlayCandidates(game, playerId) {
  const hand = game.hands[playerId];
  const leadColor = getLeadColor(game.currentTrick, game.trump);
  const candidates = hand.filter((card) => isValidMove(card, hand, leadColor, game.trump));
  return candidates.length > 0 ? candidates : hand;
}

function advanceTurn(game) {
  game.currentTurn = (game.currentTurn + 1) % 4;
}

function playCardInProjection(projectedGame, playerId, card) {
  const hand = projectedGame.hands[playerId];
  const cardIndex = hand.findIndex((heldCard) => heldCard.id === card.id);
  if (cardIndex < 0) return false;

  const [playedCard] = hand.splice(cardIndex, 1);
  projectedGame.currentTrick.push({ pid: playerId, card: playedCard });
  advanceTurn(projectedGame);
  return true;
}

function resolveTrickInPlace(game) {
  const result = resolveTrickResult(game.currentTrick, game.trump);
  game.pointsTaken[result.winningTeam] += result.points;
  game.tricks.push(game.currentTrick.map((play) => ({ ...play })));
  game.currentTrick = [];
  game.currentTurn = result.winner;
  return result;
}

function allHandsEmpty(game) {
  return game.hands.every((hand) => hand.length === 0);
}

function cloneProjectionState(game) {
  return {
    ...game,
    hands: game.hands.map((hand) => [...hand]),
    bidInfo: {
      ...game.bidInfo,
      passed: [...(game.bidInfo?.passed ?? [])],
    },
    tricks: (game.tricks ?? []).map((trick) => trick.map((play) => ({ ...play }))),
    currentTrick: (game.currentTrick ?? []).map((play) => ({ ...play })),
    pointsTaken: { ...(game.pointsTaken ?? { us: 0, them: 0 }) },
  };
}

function maxHandSize(game) {
  return Math.max(...game.hands.map((hand) => hand.length));
}

function serializeExactState(game) {
  return [
    game.currentTurn,
    game.currentTrick.map((play) => `${play.pid}:${play.card.id}`).join("."),
    game.pointsTaken.us,
    game.pointsTaken.them,
    game.hands.map((hand) => hand.map((card) => card.id).join(".")).join("|"),
  ].join("/");
}

function maybeResolveFullTrick(game) {
  if (game.currentTrick.length === 4) {
    resolveTrickInPlace(game);
  }
}

function isTerminalRound(game) {
  maybeResolveFullTrick(game);
  return allHandsEmpty(game) && game.currentTrick.length === 0;
}

function scoreLeaf(game, playerId, playedCard, previousWinner, evaluationWeights) {
  if (game.currentTrick.length > 0) {
    const winningPlay = getWinningPlay(game.currentTrick, game.trump);
    return evaluateTrickDecision(game, playerId, {
      winner: winningPlay.pid,
      points: game.currentTrick.reduce((sum, play) => sum + play.card.value, 0),
      card: playedCard,
      previousWinner,
      weights: evaluationWeights,
    });
  }

  return evaluateRoundState(game, playerId, evaluationWeights);
}

function rolloutToTerminal(game, playerId, policy, deadlineMs, evaluationWeights) {
  while (now() < deadlineMs) {
    maybeResolveFullTrick(game);

    if (allHandsEmpty(game) && game.currentTrick.length === 0) {
      return evaluateTerminalRound(game, playerId, evaluationWeights);
    }

    const nextPlayerId = game.currentTurn;
    const nextCard = policy(game, nextPlayerId);
    if (!nextCard) return null;

    const nextHand = game.hands[nextPlayerId];
    const leadColor = getLeadColor(game.currentTrick, game.trump);
    if (!isValidMove(nextCard, nextHand, leadColor, game.trump)) return null;

    if (!playCardInProjection(game, nextPlayerId, nextCard)) return null;
  }

  return null;
}

function exactEndgameValue(game, playerId, deadlineMs, memo, budget, evaluationWeights) {
  if (now() >= deadlineMs || budget.nodes >= budget.maxNodes) return null;
  budget.nodes += 1;

  maybeResolveFullTrick(game);

  if (allHandsEmpty(game) && game.currentTrick.length === 0) {
    return evaluateTerminalRound(game, playerId, evaluationWeights);
  }

  const cacheKey = serializeExactState(game);
  if (memo.has(cacheKey)) return memo.get(cacheKey);

  const legalCards = getLegalPlayCandidates(game, game.currentTurn);
  const maximizing = teamForPlayer(game.currentTurn) === teamForPlayer(playerId);
  let bestValue = maximizing ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;

  for (const card of legalCards) {
    const nextGame = cloneProjectionState(game);
    if (!playCardInProjection(nextGame, nextGame.currentTurn, card)) continue;

    const value = exactEndgameValue(nextGame, playerId, deadlineMs, memo, budget, evaluationWeights);
    if (value === null) return null;

    bestValue = maximizing ? Math.max(bestValue, value) : Math.min(bestValue, value);
  }

  memo.set(cacheKey, bestValue);
  return bestValue;
}

function evaluateCandidateOnSample(game, playerId, candidate, sample, policy, options, deadlineMs, profile) {
  const projectedGame = measureProfile(profile, "cloneMs", () => clonePublicGameWithSample(game, sample));
  const previousWinner = projectedGame.currentTrick.length > 0 ? getWinningPlay(projectedGame.currentTrick, projectedGame.trump).pid : null;

  if (!playCardInProjection(projectedGame, playerId, candidate)) return null;

  if (isTerminalRound(projectedGame)) {
    return measureProfile(profile, "scoringMs", () => evaluateTerminalRound(projectedGame, playerId, options.evaluation));
  }

  if (maxHandSize(projectedGame) <= options.exactEndgameHandSize) {
    if (profile) profile.exactCalls += 1;
    const exactValue = measureProfile(profile, "exactMs", () =>
      exactEndgameValue(
        projectedGame,
        playerId,
        deadlineMs,
        new Map(),
        {
          nodes: 0,
          maxNodes: options.exactNodeLimit,
        },
        options.evaluation,
      ),
    );

    if (exactValue !== null) return exactValue;
  }

  if (maxHandSize(projectedGame) <= options.rolloutMaxHandSize) {
    if (profile) profile.rolloutCalls += 1;
    const rolloutValue = measureProfile(profile, "rolloutMs", () =>
      rolloutToTerminal(projectedGame, playerId, policy, deadlineMs, options.evaluation),
    );
    if (rolloutValue !== null) return rolloutValue;
  }

  if (profile) profile.leafCalls += 1;
  return measureProfile(profile, "leafMs", () => scoreLeaf(projectedGame, playerId, candidate, previousWinner, options.evaluation));
}

export function evaluateSampledPlayCandidates(game, playerId, options = {}) {
  const startedAt = now();
  const config = normalizeSearchConfig({
    ...DEFAULT_SEARCH_CONFIG,
    ...(options.config ?? {}),
    ...options,
  });
  const timeLimitMs = config.timeLimitMs;
  const maxSamples = config.samples;
  const minSamples = config.minSamples;
  const seed = config.seed;
  const policy = options.policy ?? chooseBotPlay;
  const searchOptions = {
    exactEndgameHandSize: config.exactEndgameHandSize,
    exactNodeLimit: config.exactNodeLimit,
    rolloutMaxHandSize: config.rolloutMaxHandSize ?? Number.POSITIVE_INFINITY,
    evaluation: config.evaluation,
  };
  const profile = options.profile === false ? null : createSearchProfile();
  const candidates = getLegalPlayCandidates(game, playerId);
  const fallbackCard = options.fallbackCard ?? policy(game, playerId);
  const belief = options.belief ?? measureProfile(profile, "beliefMs", () => inferPublicBelief(game, playerId));
  const candidateScores = candidates.map((card) => ({
    card,
    totalScore: 0,
    averageScore: 0,
    samples: 0,
  }));

  if (candidates.length <= 1) {
    return {
      card: candidates[0] ?? null,
      fallbackCard,
      usedFallback: false,
      reason: "single-candidate",
      samplesUsed: 0,
      elapsedMs: now() - startedAt,
      profile,
      candidates: candidateScores,
    };
  }

  let samplesUsed = 0;
  const deadlineMs = startedAt + timeLimitMs;

  for (let sampleIndex = 0; sampleIndex < maxSamples; sampleIndex += 1) {
    if (now() >= deadlineMs) break;

    let sample = null;
    try {
      sample = measureProfile(profile, "samplingMs", () =>
        sampleHiddenHands(game, playerId, {
          belief,
          seed: seed + sampleIndex * 9973,
          maxAttempts: config.maxSampleAttempts,
          deadlineMs,
        }),
      );
    } catch {
      break;
    }

    if (profile) profile.sampleAttempts += sample.attempt + 1;

    let scoredAnyCandidate = false;

    for (const candidateScore of candidateScores) {
      if (now() >= deadlineMs) break;

      const score = evaluateCandidateOnSample(
        game,
        playerId,
        candidateScore.card,
        sample,
        policy,
        searchOptions,
        deadlineMs,
        profile,
      );
      if (score === null) continue;

      candidateScore.totalScore += score;
      candidateScore.samples += 1;
      scoredAnyCandidate = true;
      if (profile) profile.candidatesScored += 1;
    }

    if (scoredAnyCandidate) {
      samplesUsed += 1;
    }

    if (config.earlyStopLead !== null && samplesUsed >= minSamples) {
      const rankedScores = candidateScores
        .filter((candidateScore) => candidateScore.samples > 0)
        .map((candidateScore) => candidateScore.totalScore / candidateScore.samples)
        .sort((a, b) => b - a);

      if (rankedScores.length > 1 && rankedScores[0] - rankedScores[1] >= config.earlyStopLead) break;
    }
  }

  candidateScores.forEach((candidateScore) => {
    candidateScore.averageScore =
      candidateScore.samples > 0 ? candidateScore.totalScore / candidateScore.samples : Number.NEGATIVE_INFINITY;
  });

  if (samplesUsed < minSamples) {
    return {
      card: fallbackCard,
      fallbackCard,
      usedFallback: true,
      reason: "insufficient-samples",
      samplesUsed,
      elapsedMs: now() - startedAt,
      profile,
      candidates: candidateScores,
    };
  }

  const bestCandidate = [...candidateScores].sort((a, b) => {
    const scoreDiff = b.averageScore - a.averageScore;
    if (scoreDiff !== 0) return scoreDiff;
    return candidates.findIndex((card) => card.id === a.card.id) - candidates.findIndex((card) => card.id === b.card.id);
  })[0];

  return {
    card: bestCandidate?.card ?? fallbackCard,
    fallbackCard,
    usedFallback: false,
    reason: "sampled-rollout",
    samplesUsed,
    elapsedMs: now() - startedAt,
    profile,
    candidates: candidateScores,
  };
}
