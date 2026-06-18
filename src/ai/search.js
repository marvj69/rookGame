import { chooseBotPlay } from "../ai.js";
import { getCardPower, getLeadColor, isValidMove, teamForPlayer } from "../game.js";
import { inferPublicBelief, sampleHiddenHands } from "./belief.js";

const DEFAULT_SAMPLE_COUNT = 8;
const DEFAULT_MIN_SAMPLES = 1;
const DEFAULT_TIME_LIMIT_MS = 35;

function now() {
  return globalThis.performance?.now?.() ?? Date.now();
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

function resolveProjectedTrick(currentTrick, trump) {
  const leadColor = getLeadColor(currentTrick, trump);
  let points = 0;
  let bestIndex = 0;
  let bestPower = getCardPower(currentTrick[0].card, trump, leadColor);

  currentTrick.forEach((play, index) => {
    points += play.card.value;

    if (index === 0) return;

    const power = getCardPower(play.card, trump, leadColor);
    if (power > bestPower) {
      bestPower = power;
      bestIndex = index;
    }
  });

  return {
    points,
    winner: currentTrick[bestIndex].pid,
  };
}

function scoreProjectedTrick(game, playerId, projection) {
  const playerTeam = teamForPlayer(playerId);
  const winningTeam = teamForPlayer(projection.winner);
  const bidder = game.bidInfo?.bidder ?? game.dealer;
  const bidTeam = teamForPlayer(bidder);
  const bid = Math.max(100, game.bidInfo?.highBid ?? 100);
  const bidTeamPoints = (game.pointsTaken?.[bidTeam] ?? 0) + (game.kittyPoints ?? 0);
  const bidPressure = bidTeamPoints < bid && bidTeamPoints + projection.points >= bid;
  const setPressure = bidTeamPoints + projection.points < bid ? 0 : 1;

  let score = winningTeam === playerTeam ? projection.points : -projection.points;

  if (winningTeam === bidTeam) {
    score += playerTeam === bidTeam ? projection.points * 0.8 : -projection.points * 1.1;
  } else {
    score += playerTeam === bidTeam ? -projection.points * 0.9 : projection.points * 0.9;
  }

  if (bidPressure) {
    score += playerTeam === bidTeam ? 20 : -20;
  }

  if (bidTeam !== playerTeam && setPressure === 0) {
    score += 8;
  }

  return score;
}

function evaluateCandidateOnSample(game, playerId, candidate, sample, policy) {
  const projectedGame = clonePublicGameWithSample(game, sample);

  if (!playCardInProjection(projectedGame, playerId, candidate)) return null;

  while (projectedGame.currentTrick.length < 4) {
    const nextPlayerId = projectedGame.currentTurn;
    const nextCard = policy(projectedGame, nextPlayerId);
    if (!nextCard) return null;

    const nextHand = projectedGame.hands[nextPlayerId];
    const leadColor = getLeadColor(projectedGame.currentTrick, projectedGame.trump);
    if (!isValidMove(nextCard, nextHand, leadColor, projectedGame.trump)) return null;

    if (!playCardInProjection(projectedGame, nextPlayerId, nextCard)) return null;
  }

  const projection = resolveProjectedTrick(projectedGame.currentTrick, projectedGame.trump);
  return scoreProjectedTrick(game, playerId, projection);
}

export function evaluateSampledPlayCandidates(game, playerId, options = {}) {
  const startedAt = now();
  const timeLimitMs = options.timeLimitMs ?? DEFAULT_TIME_LIMIT_MS;
  const maxSamples = options.samples ?? DEFAULT_SAMPLE_COUNT;
  const minSamples = options.minSamples ?? DEFAULT_MIN_SAMPLES;
  const seed = options.seed ?? 1;
  const policy = options.policy ?? chooseBotPlay;
  const candidates = getLegalPlayCandidates(game, playerId);
  const fallbackCard = options.fallbackCard ?? policy(game, playerId);
  const belief = options.belief ?? inferPublicBelief(game, playerId);
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
      candidates: candidateScores,
    };
  }

  let samplesUsed = 0;

  for (let sampleIndex = 0; sampleIndex < maxSamples; sampleIndex += 1) {
    if (now() - startedAt >= timeLimitMs) break;

    const sample = sampleHiddenHands(game, playerId, {
      belief,
      seed: seed + sampleIndex * 9973,
      maxAttempts: options.maxSampleAttempts ?? 80,
    });

    let scoredAnyCandidate = false;

    candidateScores.forEach((candidateScore) => {
      const score = evaluateCandidateOnSample(game, playerId, candidateScore.card, sample, policy);
      if (score === null) return;

      candidateScore.totalScore += score;
      candidateScore.samples += 1;
      scoredAnyCandidate = true;
    });

    if (scoredAnyCandidate) {
      samplesUsed += 1;
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
    reason: "sampled-trick",
    samplesUsed,
    elapsedMs: now() - startedAt,
    candidates: candidateScores,
  };
}
