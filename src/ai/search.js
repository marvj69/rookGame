import { chooseBotPlay } from "../ai.js";
import { getCardPower, getLeadColor, isValidMove, teamForPlayer } from "../game.js";
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
    rolloutExactHandoffCalls: 0,
    rolloutExactHandoffSolved: 0,
    rolloutExactHandoffNodes: 0,
    leafCalls: 0,
    sampleAttempts: 0,
    particleWeightTotal: 0,
    particleWeightMin: Number.POSITIVE_INFINITY,
    particleWeightMax: 0,
    candidatesEliminated: 0,
    informationSetIterations: 0,
    informationSetNodes: 0,
    exactNodes: 0,
    exactCutoffs: 0,
    exactCacheHits: 0,
    exactPolicyBlendCalls: 0,
    exactOpponentPolicyNodes: 0,
    trickLookaheadCalls: 0,
    trickLookaheadNodes: 0,
    trickLookaheadLeaves: 0,
    trickLookaheadMs: 0,
    heuristicRetentions: 0,
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
      history: (game.bidInfo?.history ?? []).map((action) => ({ ...action })),
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
  game.tricks = [...(game.tricks ?? []), game.currentTrick.map((play) => ({ ...play }))];
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
    // Auction state and completed tricks are immutable during a projected
    // card-play branch. Share them until a trick resolves, where the array is
    // replaced rather than mutated.
    bidInfo: game.bidInfo,
    tricks: game.tricks ?? [],
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

function rolloutToTerminal(game, playerId, policy, deadlineMs, evaluationWeights, exactHandoff = null) {
  while (now() < deadlineMs) {
    maybeResolveFullTrick(game);

    if (allHandsEmpty(game) && game.currentTrick.length === 0) {
      return evaluateTerminalRound(game, playerId, evaluationWeights);
    }

    if (
      exactHandoff?.handSize > 0 &&
      maxHandSize(game) > 0 &&
      maxHandSize(game) <= exactHandoff.handSize
    ) {
      const budget = {
        nodes: 0,
        maxNodes: exactHandoff.nodeLimit,
        cutoffs: 0,
        cacheHits: 0,
        opponentPolicyNodes: 0,
      };
      if (exactHandoff.profile) exactHandoff.profile.rolloutExactHandoffCalls += 1;
      const exactValue = exactEndgameValue(
        game,
        playerId,
        deadlineMs,
        exactHandoff.memo ?? new Map(),
        budget,
        evaluationWeights,
        exactHandoff.policyOrdering ? policy : null,
        exactHandoff.sequencePruning,
      );
      if (exactHandoff.profile) {
        exactHandoff.profile.rolloutExactHandoffNodes += budget.nodes;
        if (exactValue !== null) exactHandoff.profile.rolloutExactHandoffSolved += 1;
      }
      if (exactValue !== null) return exactValue;
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

function selectTacticalCards(game, playerId, policy, maxBranches, evaluationWeights) {
  const legalCards = getLegalPlayCandidates(game, game.currentTurn);
  if (legalCards.length <= maxBranches) return legalCards;

  const preferredCard = policy(game, game.currentTurn);
  const preferred = preferredCard
    ? legalCards.find((card) => card.id === preferredCard.id) ?? null
    : null;
  const maximizing = teamForPlayer(game.currentTurn) === teamForPlayer(playerId);
  const ranked = legalCards.map((card) => {
    const projectedGame = cloneProjectionState(game);
    const previousWinner =
      projectedGame.currentTrick.length > 0
        ? getWinningPlay(projectedGame.currentTrick, projectedGame.trump).pid
        : null;
    if (!playCardInProjection(projectedGame, projectedGame.currentTurn, card)) {
      return { card, score: maximizing ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY };
    }
    return {
      card,
      score: scoreLeaf(projectedGame, playerId, card, previousWinner, evaluationWeights),
    };
  });
  ranked.sort((left, right) => {
    const difference = maximizing ? right.score - left.score : left.score - right.score;
    return difference || left.card.id - right.card.id;
  });

  const selected = preferred ? [preferred] : [];
  for (const entry of ranked) {
    if (selected.some((card) => card.id === entry.card.id)) continue;
    selected.push(entry.card);
    if (selected.length >= maxBranches) break;
  }
  return selected;
}

// Before the exact endgame, the normal rollout assumes every later player
// follows the heuristic policy. This bounded minimax gives both partnerships a
// chance to deviate tactically until the current trick resolves, then resumes
// the same rollout. It only sees a sampled hidden deal, never the live hands.
function boundedCurrentTrickValue(
  game,
  playerId,
  policy,
  deadlineMs,
  evaluationWeights,
  pliesRemaining,
  maxBranches,
  counters,
) {
  if (now() >= deadlineMs) return null;
  counters.nodes += 1;
  maybeResolveFullTrick(game);

  if (allHandsEmpty(game) && game.currentTrick.length === 0) {
    counters.leaves += 1;
    return evaluateTerminalRound(game, playerId, evaluationWeights);
  }
  if (game.currentTrick.length === 0 || pliesRemaining <= 0) {
    counters.leaves += 1;
    return rolloutToTerminal(game, playerId, policy, deadlineMs, evaluationWeights);
  }

  const maximizing = teamForPlayer(game.currentTurn) === teamForPlayer(playerId);
  const cards = selectTacticalCards(game, playerId, policy, maxBranches, evaluationWeights);
  let bestValue = maximizing ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;

  for (const card of cards) {
    const projectedGame = cloneProjectionState(game);
    if (!playCardInProjection(projectedGame, projectedGame.currentTurn, card)) continue;
    const value = boundedCurrentTrickValue(
      projectedGame,
      playerId,
      policy,
      deadlineMs,
      evaluationWeights,
      pliesRemaining - 1,
      maxBranches,
      counters,
    );
    if (value === null) return null;
    bestValue = maximizing ? Math.max(bestValue, value) : Math.min(bestValue, value);
  }

  return Number.isFinite(bestValue) ? bestValue : null;
}

function pruneEquivalentExactCards(game, legalCards) {
  if (legalCards.length <= 1) return legalCards;
  const remainingCards = [
    ...game.hands.flat(),
    ...(game.currentTrick ?? []).map((play) => play.card),
  ];
  const groups = new Map();

  legalCards.forEach((card) => {
    const color = card.color === "ROOK" ? game.trump : card.color;
    if (!groups.has(color)) groups.set(color, []);
    groups.get(color).push(card);
  });

  const distinct = [];
  groups.forEach((cards, color) => {
    const byPower = [...cards].sort(
      (left, right) => getCardPower(left, game.trump, color) - getCardPower(right, game.trump, color),
    );
    byPower.forEach((card, index) => {
      const previous = byPower[index - 1];
      if (!previous || previous.value !== card.value) {
        distinct.push(card);
        return;
      }

      const lowerPower = getCardPower(previous, game.trump, color);
      const upperPower = getCardPower(card, game.trump, color);
      const hasInterveningCard = remainingCards.some((remainingCard) => {
        if (remainingCard.id === previous.id || remainingCard.id === card.id) return false;
        const remainingColor = remainingCard.color === "ROOK" ? game.trump : remainingCard.color;
        if (remainingColor !== color) return false;
        const power = getCardPower(remainingCard, game.trump, color);
        return power > lowerPower && power < upperPower;
      });

      if (hasInterveningCard) distinct.push(card);
    });
  });

  const distinctIds = new Set(distinct.map((card) => card.id));
  return legalCards.filter((card) => distinctIds.has(card.id));
}

function orderExactCards(game, legalCards, maximizing, policy = null, sequencePruning = false) {
  const leadColor = getLeadColor(game.currentTrick, game.trump);
  const candidates = sequencePruning ? pruneEquivalentExactCards(game, legalCards) : legalCards;
  const ordered = [...candidates].sort((left, right) => {
    const leftScore = left.value * 4 + (left.color === "ROOK" ? 600 : 0) + (left.color === game.trump ? 500 : 0) + left.rank;
    const rightScore = right.value * 4 + (right.color === "ROOK" ? 600 : 0) + (right.color === game.trump ? 500 : 0) + right.rank;
    const powerLeft = leadColor ? leftScore : leftScore + left.rank;
    const powerRight = leadColor ? rightScore : rightScore + right.rank;
    return maximizing ? powerRight - powerLeft : powerLeft - powerRight;
  });
  const preferredCard = policy?.(game, game.currentTurn) ?? null;
  const preferredIndex = preferredCard ? ordered.findIndex((card) => card.id === preferredCard.id) : -1;
  if (preferredIndex > 0) {
    const [preferred] = ordered.splice(preferredIndex, 1);
    ordered.unshift(preferred);
  }
  return ordered;
}

function exactEndgameValue(
  game,
  playerId,
  deadlineMs,
  memo,
  budget,
  evaluationWeights,
  policy = null,
  sequencePruning = false,
  opponentMaxBranches = 0,
  opponentPureHandSize = 3,
  alpha = Number.NEGATIVE_INFINITY,
  beta = Number.POSITIVE_INFINITY,
) {
  if (now() >= deadlineMs || budget.nodes >= budget.maxNodes) return null;
  budget.nodes += 1;

  maybeResolveFullTrick(game);

  if (allHandsEmpty(game) && game.currentTrick.length === 0) {
    return evaluateTerminalRound(game, playerId, evaluationWeights);
  }

  const cacheKey = serializeExactState(game);
  const cached = memo.get(cacheKey);
  if (cached) {
    budget.cacheHits = (budget.cacheHits ?? 0) + 1;
    if (cached.flag === "exact") return cached.value;
    if (cached.flag === "lower") alpha = Math.max(alpha, cached.value);
    if (cached.flag === "upper") beta = Math.min(beta, cached.value);
    if (alpha >= beta) return cached.value;
  }

  const legalCards = getLegalPlayCandidates(game, game.currentTurn);
  const maximizing = teamForPlayer(game.currentTurn) === teamForPlayer(playerId);
  const originalAlpha = alpha;
  const originalBeta = beta;
  let bestValue = maximizing ? Number.NEGATIVE_INFINITY : Number.POSITIVE_INFINITY;

  const orderedCards = orderExactCards(game, legalCards, maximizing, policy, sequencePruning);
  const searchedCards =
    !maximizing && opponentMaxBranches > 0 && maxHandSize(game) > opponentPureHandSize
      ? orderedCards.slice(0, opponentMaxBranches)
      : orderedCards;
  if (searchedCards.length < orderedCards.length) {
    budget.opponentPolicyNodes = (budget.opponentPolicyNodes ?? 0) + 1;
  }

  for (const card of searchedCards) {
    const nextGame = cloneProjectionState(game);
    if (!playCardInProjection(nextGame, nextGame.currentTurn, card)) continue;

    const value = exactEndgameValue(
      nextGame,
      playerId,
      deadlineMs,
      memo,
      budget,
      evaluationWeights,
      policy,
      sequencePruning,
      opponentMaxBranches,
      opponentPureHandSize,
      alpha,
      beta,
    );
    if (value === null) return null;

    if (maximizing) {
      bestValue = Math.max(bestValue, value);
      alpha = Math.max(alpha, bestValue);
    } else {
      bestValue = Math.min(bestValue, value);
      beta = Math.min(beta, bestValue);
    }

    if (alpha >= beta) {
      budget.cutoffs = (budget.cutoffs ?? 0) + 1;
      break;
    }
  }

  const flag = bestValue <= originalAlpha ? "upper" : bestValue >= originalBeta ? "lower" : "exact";
  memo.set(cacheKey, { value: bestValue, flag });
  return bestValue;
}

// Fully-known endgame oracle used by tactical fixtures and diagnostics. Live
// play never calls this with opponents' cards; the shipped bot reaches the
// same solver only after constructing a sampled hidden deal.
export function evaluateExactPlayCandidates(game, playerId, options = {}) {
  const config = normalizeSearchConfig(options);
  const candidates = getLegalPlayCandidates(game, playerId);
  const deadlineMs = options.deadlineMs ?? Number.POSITIVE_INFINITY;
  const scoredCandidates = candidates.map((card) => {
    const projectedGame = cloneProjectionState(game);
    if (!playCardInProjection(projectedGame, playerId, card)) {
      return { card, score: null, nodes: 0 };
    }

    const budget = { nodes: 0, maxNodes: config.exactNodeLimit, cutoffs: 0, cacheHits: 0 };
    const score = isTerminalRound(projectedGame)
      ? evaluateTerminalRound(projectedGame, playerId, config.evaluation)
      : exactEndgameValue(
          projectedGame,
          playerId,
          deadlineMs,
          new Map(),
          budget,
          config.evaluation,
          config.exactPolicyOrdering ? options.policy ?? chooseBotPlay : null,
          config.exactSequencePruning,
          config.exactOpponentMaxBranches,
          config.exactOpponentPureHandSize,
        );

    return { card, score, nodes: budget.nodes, cutoffs: budget.cutoffs, cacheHits: budget.cacheHits };
  });
  const solved = scoredCandidates.every((candidate) => candidate.score !== null);
  const ranked = solved
    ? [...scoredCandidates].sort((left, right) => {
        const scoreDifference = right.score - left.score;
        if (scoreDifference !== 0) return scoreDifference;
        return candidates.findIndex((card) => card.id === left.card.id) - candidates.findIndex((card) => card.id === right.card.id);
      })
    : scoredCandidates;

  return {
    solved,
    card: solved ? ranked[0]?.card ?? null : null,
    candidates: scoredCandidates,
  };
}

function evaluateCandidateOnSample(game, playerId, candidate, sample, policy, options, deadlineMs, profile) {
  const projectedGame = measureProfile(profile, "cloneMs", () => clonePublicGameWithSample(game, sample));
  const rootTrickPosition = projectedGame.currentTrick.length;
  const previousWinner = projectedGame.currentTrick.length > 0 ? getWinningPlay(projectedGame.currentTrick, projectedGame.trump).pid : null;

  if (!playCardInProjection(projectedGame, playerId, candidate)) return null;

  if (isTerminalRound(projectedGame)) {
    return measureProfile(profile, "scoringMs", () => evaluateTerminalRound(projectedGame, playerId, options.evaluation));
  }

  const projectedMaxHandSize = maxHandSize(projectedGame);
  const usesMaximumExactLayer = projectedMaxHandSize === options.exactEndgameHandSize;
  const exactPositionEligible =
    !usesMaximumExactLayer ||
    (rootTrickPosition >= options.exactMaxHandMinTrickPosition &&
      rootTrickPosition <= options.exactMaxHandMaxTrickPosition);
  const exactVoidEvidenceEligible =
    !usesMaximumExactLayer || options.publicKnownVoidCount >= options.exactMaxHandMinKnownVoids;
  if (
    projectedMaxHandSize <= options.exactEndgameHandSize &&
    exactPositionEligible &&
    exactVoidEvidenceEligible
  ) {
    if (profile) profile.exactCalls += 1;
    const shouldBlendExact =
      options.exactValueWeight < 1 && projectedMaxHandSize > options.exactPureHandSize;
    const policyProjection = shouldBlendExact ? cloneProjectionState(projectedGame) : null;
    const budget = { nodes: 0, maxNodes: options.exactNodeLimit, cutoffs: 0, cacheHits: 0, opponentPolicyNodes: 0 };
    const exactValue = measureProfile(profile, "exactMs", () =>
      exactEndgameValue(
        projectedGame,
        playerId,
        deadlineMs,
        options.exactMemo ?? new Map(),
        budget,
        options.evaluation,
        options.exactPolicyOrdering ? policy : null,
        options.exactSequencePruning,
        options.exactOpponentMaxBranches,
        options.exactOpponentPureHandSize,
      ),
    );
    if (profile) {
      profile.exactNodes += budget.nodes;
      profile.exactCutoffs += budget.cutoffs;
      profile.exactCacheHits += budget.cacheHits;
      profile.exactOpponentPolicyNodes += budget.opponentPolicyNodes;
    }

    if (exactValue !== null) {
      if (!shouldBlendExact) return exactValue;
      if (profile) {
        profile.exactPolicyBlendCalls += 1;
        profile.rolloutCalls += 1;
      }
      const policyValue = measureProfile(profile, "rolloutMs", () =>
        rolloutToTerminal(policyProjection, playerId, policy, deadlineMs, options.evaluation),
      );
      if (policyValue !== null) {
        return exactValue * options.exactValueWeight + policyValue * (1 - options.exactValueWeight);
      }
      return exactValue;
    }
  }

  if (options.trickLookaheadPlies > 0 && projectedGame.currentTrick.length > 0) {
    if (profile) profile.trickLookaheadCalls += 1;
    const counters = { nodes: 0, leaves: 0 };
    const tacticalValue = measureProfile(profile, "trickLookaheadMs", () =>
      boundedCurrentTrickValue(
        projectedGame,
        playerId,
        policy,
        deadlineMs,
        options.evaluation,
        options.trickLookaheadPlies,
        options.trickLookaheadBranches,
        counters,
      ),
    );
    if (profile) {
      profile.trickLookaheadNodes += counters.nodes;
      profile.trickLookaheadLeaves += counters.leaves;
    }
    if (tacticalValue !== null) {
      if (options.trickLookaheadBlend >= 1) return tacticalValue;
      if (profile) profile.rolloutCalls += 1;
      const policyValue = measureProfile(profile, "rolloutMs", () =>
        rolloutToTerminal(
          cloneProjectionState(projectedGame),
          playerId,
          policy,
          deadlineMs,
          options.evaluation,
        ),
      );
      if (policyValue !== null) {
        return policyValue * (1 - options.trickLookaheadBlend) + tacticalValue * options.trickLookaheadBlend;
      }
      return tacticalValue;
    }
  }

  if (maxHandSize(projectedGame) <= options.rolloutMaxHandSize) {
    if (profile) profile.rolloutCalls += 1;
    const rolloutValue = measureProfile(profile, "rolloutMs", () =>
      rolloutToTerminal(projectedGame, playerId, policy, deadlineMs, options.evaluation, {
        handSize: options.rolloutExactHandoffHandSize,
        nodeLimit: options.rolloutExactNodeLimit,
        memo: options.rolloutExactMemo,
        policyOrdering: options.exactPolicyOrdering,
        sequencePruning: options.exactSequencePruning,
        profile,
      }),
    );
    if (rolloutValue !== null) return rolloutValue;
  }

  if (profile) profile.leafCalls += 1;
  return measureProfile(profile, "leafMs", () => scoreLeaf(projectedGame, playerId, candidate, previousWinner, options.evaluation));
}

function weightedMean(observations) {
  const totalWeight = observations.reduce((sum, observation) => sum + observation.weight, 0);
  if (totalWeight <= 0) return Number.NEGATIVE_INFINITY;
  return observations.reduce((sum, observation) => sum + observation.value * observation.weight, 0) / totalWeight;
}

function weightedQuantile(observations, probability) {
  if (observations.length === 0) return Number.NEGATIVE_INFINITY;
  const ordered = [...observations].sort((left, right) => left.value - right.value);
  const totalWeight = ordered.reduce((sum, observation) => sum + observation.weight, 0);
  let target = Math.max(0, Math.min(1, probability)) * totalWeight;
  for (const observation of ordered) {
    target -= observation.weight;
    if (target <= 0) return observation.value;
  }
  return ordered[ordered.length - 1].value;
}

function weightedLowerTailMean(observations, fraction) {
  if (observations.length === 0) return Number.NEGATIVE_INFINITY;
  const ordered = [...observations].sort((left, right) => left.value - right.value);
  const totalWeight = ordered.reduce((sum, observation) => sum + observation.weight, 0);
  let remainingWeight = totalWeight * Math.max(0.05, Math.min(1, fraction));
  let weightedTotal = 0;
  let usedWeight = 0;

  for (const observation of ordered) {
    if (remainingWeight <= 0) break;
    const weight = Math.min(observation.weight, remainingWeight);
    weightedTotal += observation.value * weight;
    usedWeight += weight;
    remainingWeight -= weight;
  }
  return usedWeight > 0 ? weightedTotal / usedWeight : ordered[0].value;
}

export function applyRootAggregationScores(candidateScores, config) {
  const bestBySample = new Map();
  candidateScores.forEach((candidate) => {
    candidate.observations.forEach((observation) => {
      bestBySample.set(
        observation.sampleIndex,
        Math.max(bestBySample.get(observation.sampleIndex) ?? Number.NEGATIVE_INFINITY, observation.value),
      );
    });
  });

  candidateScores.forEach((candidate) => {
    const regrets = candidate.observations.map((observation) => ({
      value: (bestBySample.get(observation.sampleIndex) ?? observation.value) - observation.value,
      weight: observation.weight,
    }));
    const meanRegret = weightedMean(regrets);
    const totalWeight = regrets.reduce((sum, observation) => sum + observation.weight, 0);
    const regretVariance =
      totalWeight > 0
        ? regrets.reduce(
            (sum, observation) => sum + observation.weight * (observation.value - meanRegret) ** 2,
            0,
          ) / totalWeight
        : 0;
    candidate.regretDeviation = Math.sqrt(Math.max(0, regretVariance));
    candidate.riskPenalty = config.riskAversion * candidate.regretDeviation;
    candidate.selectionScore = candidate.averageScore - candidate.riskPenalty;
  });

  if (config.rootAggregation === "median") {
    candidateScores.forEach((candidate) => {
      candidate.selectionScore = weightedQuantile(candidate.observations, 0.5);
    });
    return;
  }
  if (config.rootAggregation === "cvar") {
    candidateScores.forEach((candidate) => {
      candidate.selectionScore = weightedLowerTailMean(candidate.observations, config.rootCvarFraction);
    });
    return;
  }
  if (config.rootAggregation === "mean") return;

  const sampleGroups = new Map();
  candidateScores.forEach((candidate) => {
    candidate.observations.forEach((observation) => {
      if (!sampleGroups.has(observation.sampleIndex)) sampleGroups.set(observation.sampleIndex, []);
      sampleGroups.get(observation.sampleIndex).push({ candidate, observation });
    });
  });

  const totals = new Map(candidateScores.map((candidate) => [candidate, 0]));
  const pairwise = new Map(candidateScores.map((candidate) => [candidate, new Map()]));
  let totalWorldWeight = 0;

  sampleGroups.forEach((entries) => {
    const worldWeight = Math.min(...entries.map(({ observation }) => observation.weight));
    totalWorldWeight += worldWeight;
    const bestValue = Math.max(...entries.map(({ observation }) => observation.value));
    const leaders = entries.filter(({ observation }) => observation.value === bestValue);

    if (config.rootAggregation === "plurality") {
      leaders.forEach(({ candidate }) => {
        totals.set(candidate, totals.get(candidate) + worldWeight / leaders.length);
      });
      return;
    }

    entries.forEach(({ candidate, observation }) => {
      entries.forEach(({ candidate: opponent, observation: opponentObservation }) => {
        if (candidate === opponent) return;
        const result = observation.value > opponentObservation.value ? 1 : observation.value === opponentObservation.value ? 0.5 : 0;
        const record = pairwise.get(candidate).get(opponent) ?? { score: 0, weight: 0 };
        record.score += result * worldWeight;
        record.weight += worldWeight;
        pairwise.get(candidate).set(opponent, record);
      });
    });
  });

  candidateScores.forEach((candidate) => {
    if (config.rootAggregation === "plurality") {
      candidate.selectionScore = totalWorldWeight > 0 ? totals.get(candidate) / totalWorldWeight : 0;
      return;
    }
    const rates = [...pairwise.get(candidate).values()].map((record) =>
      record.weight > 0 ? record.score / record.weight : 0.5,
    );
    candidate.selectionScore =
      rates.length === 0
        ? 0
        : config.rootAggregation === "pairwise"
          ? Math.min(...rates)
          : rates.reduce((sum, rate) => sum + rate, 0) / rates.length;
  });
}

function pairedDifferenceStats(leader, challenger) {
  const challengerBySample = new Map(challenger.observations.map((observation) => [observation.sampleIndex, observation]));
  const differences = leader.observations.flatMap((leaderObservation) => {
    const challengerObservation = challengerBySample.get(leaderObservation.sampleIndex);
    if (!challengerObservation) return [];
    return [{
      value: leaderObservation.value - challengerObservation.value,
      weight: Math.min(leaderObservation.weight, challengerObservation.weight),
    }];
  });
  const mean = weightedMean(differences);
  const totalWeight = differences.reduce((sum, observation) => sum + observation.weight, 0);
  const squaredWeight = differences.reduce((sum, observation) => sum + observation.weight ** 2, 0);
  const effectiveSamples = squaredWeight > 0 ? (totalWeight ** 2) / squaredWeight : 0;
  const variance =
    totalWeight > 0
      ? differences.reduce((sum, observation) => sum + observation.weight * (observation.value - mean) ** 2, 0) /
        totalWeight
      : Number.POSITIVE_INFINITY;

  return {
    samples: differences.length,
    effectiveSamples,
    mean,
    standardError: effectiveSamples > 1 ? Math.sqrt(variance / effectiveSamples) : Number.POSITIVE_INFINITY,
  };
}

function eliminateDominatedCandidates(candidateScores, config, profile) {
  const active = candidateScores.filter((candidate) => candidate.active && candidate.samples >= config.adaptiveMinSamples);
  if (!config.adaptiveSampling || active.length <= 1) return;

  active.forEach((candidate) => {
    candidate.averageScore = candidate.totalWeight > 0 ? candidate.weightedTotalScore / candidate.totalWeight : Number.NEGATIVE_INFINITY;
  });
  const leader = [...active].sort((left, right) => right.averageScore - left.averageScore)[0];

  active.forEach((candidate) => {
    if (candidate === leader) return;
    const difference = pairedDifferenceStats(leader, candidate);
    const confidenceGap = config.adaptiveScoreMargin + config.adaptiveConfidenceZ * difference.standardError;
    if (difference.samples >= config.adaptiveMinSamples && difference.mean > confidenceGap) {
      candidate.active = false;
      candidate.eliminatedAfterSamples = candidate.samples;
      if (profile) profile.candidatesEliminated += 1;
    }
  });
}

function serializeInformationSetState(game) {
  return [
    game.currentTurn,
    game.tricks.length,
    game.currentTrick.map((play) => `${play.pid}:${play.card.id}`).join("."),
    game.pointsTaken.us,
    game.pointsTaken.them,
    game.hands.map((hand) => hand.length).join("."),
    (game.tricks ?? []).slice(-2).flatMap((trick) => trick.map((play) => play.card.id)).join("."),
  ].join("/");
}

function getInformationSetNode(tree, key) {
  if (!tree.has(key)) {
    tree.set(key, { visits: 0, actions: new Map() });
  }
  return tree.get(key);
}

function chooseInformationSetAction(node, legalCards, maximizing, exploration) {
  const orderedCards = [...legalCards].sort((left, right) => left.id - right.id);
  const unvisited = orderedCards.find((card) => !node.actions.has(card.id) || node.actions.get(card.id).visits === 0);
  if (unvisited) {
    return { card: unvisited, action: node.actions.get(unvisited.id) ?? { visits: 0, total: 0 }, expanded: true };
  }

  const logVisits = Math.log(Math.max(2, node.visits));
  const ranked = orderedCards.map((card) => {
    const action = node.actions.get(card.id);
    const mean = action.total / action.visits;
    const exploitation = maximizing ? mean : -mean;
    const bonus = exploration * Math.sqrt(logVisits / action.visits);
    return { card, action, score: exploitation + bonus, expanded: false };
  });
  ranked.sort((left, right) => right.score - left.score || left.card.id - right.card.id);
  return ranked[0];
}

function selectWeightedParticle(particles, iteration, seed) {
  const totalWeight = particles.reduce((sum, particle) => sum + particle.weight, 0);
  if (totalWeight <= 0) return particles[iteration % particles.length].sample;
  const seedOffset = ((seed >>> 0) % 104729) / 104729;
  const fraction = (seedOffset + iteration * 0.6180339887498949) % 1;
  let target = fraction * totalWeight;

  for (const particle of particles) {
    target -= particle.weight;
    if (target <= 0) return particle.sample;
  }
  return particles[particles.length - 1].sample;
}

export function evaluateInformationSetTreeCandidates(game, playerId, options = {}) {
  const config = normalizeSearchConfig(options);
  const policy = options.policy ?? chooseBotPlay;
  const particles = options.particles ?? [];
  const candidates = options.candidates ?? getLegalPlayCandidates(game, playerId);
  const iterations = Math.max(0, Math.floor(options.iterations ?? config.informationSetIterations));
  const deadlineMs = options.deadlineMs ?? Number.POSITIVE_INFINITY;
  const tree = new Map();
  let completedIterations = 0;

  if (particles.length === 0 || candidates.length <= 1 || iterations === 0) {
    return { iterations: 0, nodes: 0, candidates: candidates.map((card) => ({ card, visits: 0, averageScore: null })) };
  }

  for (let iteration = 0; iteration < iterations && now() < deadlineMs; iteration += 1) {
    const sample = selectWeightedParticle(particles, iteration, config.seed);
    const projectedGame = clonePublicGameWithSample(game, sample);
    const visited = [];
    let expanded = false;
    let plies = 0;

    while (plies < config.informationSetTreePlies && now() < deadlineMs) {
      maybeResolveFullTrick(projectedGame);
      if (allHandsEmpty(projectedGame) && projectedGame.currentTrick.length === 0) break;

      const nodeKey = serializeInformationSetState(projectedGame);
      const node = getInformationSetNode(tree, nodeKey);
      const legalCards =
        plies === 0
          ? candidates.filter((candidate) => projectedGame.hands[playerId].some((card) => card.id === candidate.id))
          : getLegalPlayCandidates(projectedGame, projectedGame.currentTurn);
      if (legalCards.length === 0) break;

      const maximizing = teamForPlayer(projectedGame.currentTurn) === teamForPlayer(playerId);
      const selection = chooseInformationSetAction(node, legalCards, maximizing, config.informationSetExploration);
      if (!node.actions.has(selection.card.id)) node.actions.set(selection.card.id, selection.action);
      visited.push({ node, action: node.actions.get(selection.card.id) });
      if (!playCardInProjection(projectedGame, projectedGame.currentTurn, selection.card)) break;
      plies += 1;

      if (selection.expanded) {
        expanded = true;
        break;
      }
    }

    const terminal = isTerminalRound(projectedGame)
      ? evaluateTerminalRound(projectedGame, playerId, config.evaluation)
      : rolloutToTerminal(projectedGame, playerId, policy, deadlineMs, config.evaluation);
    if (terminal === null || visited.length === 0) continue;

    visited.forEach(({ node, action }) => {
      node.visits += 1;
      action.visits += 1;
      action.total += terminal;
    });
    completedIterations += 1;
    if (!expanded && plies === 0) break;
  }

  const root = tree.get(serializeInformationSetState(clonePublicGameWithSample(game, particles[0].sample)));
  return {
    iterations: completedIterations,
    nodes: tree.size,
    candidates: candidates.map((card) => {
      const action = root?.actions.get(card.id);
      return {
        card,
        visits: action?.visits ?? 0,
        averageScore: action?.visits ? action.total / action.visits : null,
      };
    }),
  };
}

function applyInformationSetTieBreak(game, playerId, candidateScores, particles, config, policy, deadlineMs, profile) {
  const ranked = [...candidateScores]
    .filter((candidate) => candidate.active && candidate.samples > 0)
    .sort((left, right) => right.averageScore - left.averageScore);
  if (ranked.length <= 1 || config.informationSetIterations <= 0) return false;
  if (ranked[0].averageScore - ranked[1].averageScore > config.informationSetTriggerMargin) return false;

  const finalists = ranked.slice(0, Math.max(2, config.informationSetMaxCandidates));
  const result = evaluateInformationSetTreeCandidates(game, playerId, {
    ...config,
    policy,
    particles,
    candidates: finalists.map((candidate) => candidate.card),
    iterations: config.informationSetIterations,
    deadlineMs,
  });
  if (profile) {
    profile.informationSetIterations += result.iterations;
    profile.informationSetNodes += result.nodes;
  }

  result.candidates.forEach((treeCandidate) => {
    const candidate = candidateScores.find((score) => score.card.id === treeCandidate.card.id);
    if (!candidate || treeCandidate.averageScore === null) return;
    candidate.informationSetVisits = treeCandidate.visits;
    candidate.informationSetScore = treeCandidate.averageScore;
    candidate.combinedScore =
      candidate.averageScore * (1 - config.informationSetBlend) + treeCandidate.averageScore * config.informationSetBlend;
  });
  return result.iterations > 0;
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
  const fixedSampleBudget = config.sampleBudgetMode === "fixed";
  const seed = config.seed;
  const policy = options.policy ?? chooseBotPlay;
  const searchOptions = {
    exactEndgameHandSize: config.exactEndgameHandSize,
    exactNodeLimit: config.exactNodeLimit,
    exactPolicyOrdering: config.exactPolicyOrdering,
    exactSequencePruning: config.exactSequencePruning,
    exactValueWeight: config.exactValueWeight,
    exactPureHandSize: config.exactPureHandSize,
    exactMaxHandMinTrickPosition: config.exactMaxHandMinTrickPosition,
    exactMaxHandMaxTrickPosition: config.exactMaxHandMaxTrickPosition,
    exactOpponentMaxBranches: config.exactOpponentMaxBranches,
    exactOpponentPureHandSize: config.exactOpponentPureHandSize,
    exactMaxHandMinKnownVoids: config.exactMaxHandMinKnownVoids,
    trickLookaheadPlies: config.trickLookaheadPlies,
    trickLookaheadBranches: config.trickLookaheadBranches,
    trickLookaheadBlend: config.trickLookaheadBlend,
    rolloutMaxHandSize: config.rolloutMaxHandSize ?? Number.POSITIVE_INFINITY,
    rolloutExactHandoffHandSize: config.rolloutExactHandoffHandSize,
    rolloutExactNodeLimit: config.rolloutExactNodeLimit,
    evaluation: config.evaluation,
  };
  const profile = options.profile === false ? null : createSearchProfile();
  const candidates = getLegalPlayCandidates(game, playerId);
  const fallbackCard = options.fallbackCard ?? policy(game, playerId);
  const belief = options.belief ?? measureProfile(profile, "beliefMs", () => inferPublicBelief(game, playerId));
  searchOptions.publicKnownVoidCount = (belief.knownVoids ?? []).reduce(
    (sum, entry) => sum + (entry.colors?.length ?? 0),
    0,
  );
  const candidateScores = candidates.map((card) => ({
    card,
    totalScore: 0,
    weightedTotalScore: 0,
    totalWeight: 0,
    averageScore: 0,
    samples: 0,
    active: true,
    observations: [],
    combinedScore: null,
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

  if ((game.tricks?.length ?? 0) < config.searchStartTrick) {
    return {
      card: fallbackCard,
      fallbackCard,
      usedFallback: false,
      reason: "configured-heuristic-opening",
      samplesUsed: 0,
      elapsedMs: now() - startedAt,
      profile,
      candidates: candidateScores,
    };
  }

  let samplesUsed = 0;
  const deadlineMs = fixedSampleBudget ? Number.POSITIVE_INFINITY : startedAt + timeLimitMs;
  const particles = [];

  for (let sampleIndex = 0; sampleIndex < maxSamples; sampleIndex += 1) {
    if (now() >= deadlineMs) break;

    let sample = null;
    try {
      sample = measureProfile(profile, "samplingMs", () =>
        sampleHiddenHands(game, playerId, {
          belief,
          seed: config.hiddenHandSampler === "stratified" ? seed : seed + sampleIndex * 9973,
          stratumIndex: sampleIndex,
          maxAttempts: config.maxSampleAttempts,
          sampler: config.hiddenHandSampler,
          deadlineMs,
        }),
      );
    } catch {
      break;
    }

    const particleWeight = config.beliefWeighting ? sample.likelihoodWeight ?? 1 : 1;
    particles.push({ sample, weight: particleWeight });
    if (profile) {
      profile.sampleAttempts += sample.attempt + 1;
      profile.particleWeightTotal += particleWeight;
      profile.particleWeightMin = Math.min(profile.particleWeightMin, particleWeight);
      profile.particleWeightMax = Math.max(profile.particleWeightMax, particleWeight);
    }

    const completedScores = new Map();
    const activeCandidates = candidateScores.filter((candidateScore) => candidateScore.active);
    const sampleSearchOptions = {
      ...searchOptions,
      // Candidate branches from the same determinization can transpose after
      // later tricks. Reusing this table preserves exact values and avoids
      // resolving those states independently for every root card.
      exactMemo: new Map(),
      rolloutExactMemo: new Map(),
    };

    for (const candidateScore of activeCandidates) {
      if (now() >= deadlineMs) break;

      const score = evaluateCandidateOnSample(
        game,
        playerId,
        candidateScore.card,
        sample,
        policy,
        sampleSearchOptions,
        deadlineMs,
        profile,
      );
      if (score === null) continue;

      completedScores.set(candidateScore.card.id, score);
    }

    // A partial sample systematically favors cards earlier in candidate order.
    // Discard it unless every legal card was evaluated under the same hidden deal.
    if (completedScores.size !== activeCandidates.length) break;

    activeCandidates.forEach((candidateScore) => {
      const score = completedScores.get(candidateScore.card.id);
      candidateScore.totalScore += score;
      candidateScore.weightedTotalScore += score * particleWeight;
      candidateScore.totalWeight += particleWeight;
      candidateScore.samples += 1;
      candidateScore.observations.push({ sampleIndex, value: score, weight: particleWeight });
      if (profile) profile.candidatesScored += 1;
    });
    samplesUsed += 1;
    eliminateDominatedCandidates(candidateScores, config, profile);

    if (candidateScores.filter((candidateScore) => candidateScore.active).length === 1 && samplesUsed >= config.adaptiveMinSamples) {
      break;
    }

    if (config.earlyStopLead !== null && samplesUsed >= minSamples) {
      const rankedScores = candidateScores
        .filter((candidateScore) => candidateScore.active && candidateScore.samples > 0)
        .map((candidateScore) => candidateScore.weightedTotalScore / candidateScore.totalWeight)
        .sort((a, b) => b - a);

      if (rankedScores.length > 1 && rankedScores[0] - rankedScores[1] >= config.earlyStopLead) break;
    }
  }

  candidateScores.forEach((candidateScore) => {
    candidateScore.averageScore =
      candidateScore.totalWeight > 0 ? candidateScore.weightedTotalScore / candidateScore.totalWeight : Number.NEGATIVE_INFINITY;
  });
  applyRootAggregationScores(candidateScores, config);

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

  const usedInformationSetSearch = applyInformationSetTieBreak(
    game,
    playerId,
    candidateScores,
    particles,
    config,
    policy,
    deadlineMs,
    profile,
  );
  const eligibleCandidates = candidateScores.filter((candidateScore) => candidateScore.active && candidateScore.samples > 0);
  const bestCandidate = [...eligibleCandidates].sort((a, b) => {
    const scoreA = a.combinedScore ?? a.selectionScore ?? a.averageScore;
    const scoreB = b.combinedScore ?? b.selectionScore ?? b.averageScore;
    const scoreDiff = scoreB - scoreA;
    if (scoreDiff !== 0) return scoreDiff;
    const meanDiff = b.averageScore - a.averageScore;
    if (meanDiff !== 0) return meanDiff;
    return candidates.findIndex((card) => card.id === a.card.id) - candidates.findIndex((card) => card.id === b.card.id);
  })[0];
  const fallbackCandidate = eligibleCandidates.find((candidate) => candidate.card.id === fallbackCard?.id);
  const openingMarginApplies = (game.tricks?.length ?? 0) < 4 && config.openingOverrideMargin > 0;
  const bestSelectionScore = bestCandidate?.combinedScore ?? bestCandidate?.selectionScore ?? bestCandidate?.averageScore;
  const fallbackSelectionScore =
    fallbackCandidate?.combinedScore ?? fallbackCandidate?.selectionScore ?? fallbackCandidate?.averageScore;
  const retainHeuristic = Boolean(
    openingMarginApplies &&
      bestCandidate &&
      fallbackCandidate &&
      bestCandidate.card.id !== fallbackCandidate.card.id &&
      Number.isFinite(bestSelectionScore) &&
      Number.isFinite(fallbackSelectionScore) &&
      bestSelectionScore - fallbackSelectionScore < config.openingOverrideMargin,
  );
  const confidenceGateApplies = config.heuristicOverrideMargin > 0 || config.heuristicOverrideZ > 0;
  const pairedAdvantage =
    bestCandidate && fallbackCandidate && bestCandidate.card.id !== fallbackCandidate.card.id
      ? pairedDifferenceStats(bestCandidate, fallbackCandidate)
      : null;
  const retainForConfidence = Boolean(
    !retainHeuristic &&
      confidenceGateApplies &&
      pairedAdvantage &&
      Number.isFinite(pairedAdvantage.mean) &&
      pairedAdvantage.mean <
        config.heuristicOverrideMargin + config.heuristicOverrideZ * pairedAdvantage.standardError,
  );
  const retainedHeuristic = retainHeuristic || retainForConfidence;
  if (retainedHeuristic && profile) profile.heuristicRetentions += 1;

  return {
    card: retainedHeuristic ? fallbackCard : bestCandidate?.card ?? fallbackCard,
    fallbackCard,
    usedFallback: false,
    reason: retainedHeuristic
      ? retainHeuristic
        ? "opening-confidence-retained-heuristic"
        : "paired-confidence-retained-heuristic"
      : usedInformationSetSearch
        ? "information-set-hybrid"
        : "weighted-sampled-rollout",
    samplesUsed,
    elapsedMs: now() - startedAt,
    profile,
    pairedHeuristicAdvantage: pairedAdvantage,
    candidates: candidateScores,
  };
}
