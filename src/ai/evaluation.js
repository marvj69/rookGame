import { completeRoundScore, getCardPower, getLeadColor, isTrumpCard, teamForPlayer } from "../game.js";
import { normalizeEvaluationWeights } from "./config.js";

const MIN_BID = 100;

function opponentTeam(team) {
  return team === "us" ? "them" : "us";
}

export function getTrickPoints(trick) {
  return trick.reduce((sum, play) => sum + play.card.value, 0);
}

export function getWinningPlay(trick, trump) {
  const leadColor = getLeadColor(trick, trump);

  return trick.reduce(
    (best, play) => {
      const power = getCardPower(play.card, trump, leadColor);
      return power > best.power ? { play, power } : best;
    },
    { play: trick[0], power: getCardPower(trick[0].card, trump, leadColor) },
  ).play;
}

export function resolveTrickResult(trick, trump) {
  const winningPlay = getWinningPlay(trick, trump);

  return {
    winner: winningPlay.pid,
    winningTeam: teamForPlayer(winningPlay.pid),
    points: getTrickPoints(trick),
  };
}

export function getBidContext(game) {
  const bidder = game.bidInfo?.bidder ?? game.dealer;
  const bidTeam = teamForPlayer(bidder);
  const bid = Math.max(MIN_BID, game.bidInfo?.highBid ?? MIN_BID);
  const pointsTaken = game.pointsTaken ?? { us: 0, them: 0 };
  const bidTeamPoints = pointsTaken[bidTeam] + (game.kittyPoints ?? 0);
  const opponent = opponentTeam(bidTeam);
  const unseenHandPoints = (game.hands ?? []).flat().reduce((sum, card) => sum + card.value, 0);
  const currentTrickPoints = getTrickPoints(game.currentTrick ?? []);

  return {
    bidder,
    bidTeam,
    opponentTeam: opponent,
    bid,
    bidTeamPoints,
    opponentPoints: pointsTaken[opponent],
    pointsNeeded: Math.max(0, bid - bidTeamPoints),
    maxBidTeamPoints: bidTeamPoints + unseenHandPoints + currentTrickPoints,
    bidAlreadyMade: bidTeamPoints >= bid,
    bidCanStillMake: bidTeamPoints + unseenHandPoints + currentTrickPoints >= bid,
  };
}

export function evaluateTerminalRound(game, playerId, weights = null) {
  const evaluation = normalizeEvaluationWeights(weights);
  const playerTeam = teamForPlayer(playerId);
  const score = completeRoundScore(game).scoreChange;
  return (score[playerTeam] - score[opponentTeam(playerTeam)]) * evaluation.terminalEv;
}

export function evaluateRoundState(game, playerId, weights = null) {
  const evaluation = normalizeEvaluationWeights(weights);
  const playerTeam = teamForPlayer(playerId);
  const context = getBidContext(game);
  const playerIsBidTeam = playerTeam === context.bidTeam;
  const playerPoints = (game.pointsTaken?.[playerTeam] ?? 0) + (playerIsBidTeam ? game.kittyPoints ?? 0 : 0);
  const opponent = opponentTeam(playerTeam);
  const opponentPoints = (game.pointsTaken?.[opponent] ?? 0) + (opponent === context.bidTeam ? game.kittyPoints ?? 0 : 0);
  let score = playerPoints - opponentPoints;

  if (context.bidAlreadyMade) {
    score += playerIsBidTeam ? evaluation.bidMadeStateReward : -evaluation.bidMadeStateReward;
  } else {
    score += playerIsBidTeam ? -context.pointsNeeded * evaluation.bidNeedPenalty : context.pointsNeeded * evaluation.bidNeedPenalty;
  }

  if (!context.bidCanStillMake) {
    score += playerIsBidTeam ? -evaluation.setStateReward : evaluation.setStateReward;
  }

  return score;
}

export function getCardSpendCost(card, game, { outcomeCritical = false, weights = null } = {}) {
  if (outcomeCritical) return 0;
  const evaluation = normalizeEvaluationWeights(weights);

  let cost = card.value * evaluation.cardPointSpend;

  if (isTrumpCard(card, game.trump)) {
    const trumpPower = getCardPower(card, game.trump, game.trump) - 500;
    cost += evaluation.trumpBaseSpend + Math.max(0, trumpPower - 8) * evaluation.trumpHighSpend;
  } else if (card.rank === 14) {
    cost += evaluation.aceSpend;
  } else if (card.rank === 13) {
    cost += evaluation.kingSpend;
  }

  return cost;
}

export function evaluateTrickDecision(game, playerId, { winner, points, card, previousWinner = null, weights = null }) {
  const evaluation = normalizeEvaluationWeights(weights);
  const playerTeam = teamForPlayer(playerId);
  const winningTeam = teamForPlayer(winner);
  const context = getBidContext(game);
  const playerIsBidTeam = playerTeam === context.bidTeam;
  const bidTeamWinsTrick = winningTeam === context.bidTeam;
  const bidTeamPointsAfter = context.bidTeamPoints + (bidTeamWinsTrick ? points : 0);
  const bidMadeByTrick = context.bidTeamPoints < context.bid && bidTeamPointsAfter >= context.bid;
  const bidStillSetAfterTrick = context.maxBidTeamPoints < context.bid;
  const outcomeCritical = bidMadeByTrick || bidStillSetAfterTrick || (previousWinner !== null && previousWinner !== winner);

  let score = winningTeam === playerTeam ? points * evaluation.ownTrickPointReward : -points * evaluation.opponentTrickPointPenalty;

  if (bidTeamWinsTrick) {
    score += playerIsBidTeam ? points * evaluation.bidTeamPointReward : -points * evaluation.bidTeamPointPenalty;
  } else {
    score += playerIsBidTeam ? -points * evaluation.bidderLosePointPenalty : points * evaluation.defenderSetPointReward;
  }

  if (bidMadeByTrick) {
    score += playerIsBidTeam ? evaluation.trickMakesBidReward : -evaluation.trickMakesBidReward;
  }

  if (bidStillSetAfterTrick) {
    score += playerIsBidTeam ? -evaluation.trickSetsBidReward : evaluation.trickSetsBidReward;
  }

  return score - getCardSpendCost(card, game, { outcomeCritical, weights: evaluation });
}
