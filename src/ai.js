import {
  COLORS,
  DISCARD_COUNT,
  buildDeck,
  getCardPower,
  getLeadColor,
  isValidMove,
  sortHand,
  teamForPlayer,
} from "./game.js";

const MAX_BID = 150;
const MIN_BID = 100;

function effectiveColor(card, trump) {
  return card.color === "ROOK" ? trump : card.color;
}

function isTrump(card, trump) {
  return effectiveColor(card, trump) === trump;
}

function cardLeadPower(card, trump) {
  return getCardPower(card, trump, effectiveColor(card, trump));
}

function roundDownToFive(value) {
  return Math.floor(value / 5) * 5;
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function getTeamBidder(game) {
  return game.bidInfo.bidder ?? game.dealer;
}

function countByColor(hand) {
  return COLORS.reduce((counts, color) => {
    counts[color] = hand.filter((card) => card.color === color).length;
    return counts;
  }, {});
}

function colorCardScore(card) {
  if (card.color === "ROOK") return 7;
  if (card.rank === 14) return 9;
  if (card.rank === 13) return 6;
  if (card.rank === 12) return 4;
  if (card.rank === 11) return 2;
  if (card.rank === 1) return 2;
  return 0;
}

function evaluateHandForTrump(hand, trump) {
  const counts = countByColor(hand);
  const trumpCards = hand.filter((card) => isTrump(card, trump));
  const trumpCount = trumpCards.length;
  const pointTotal = hand.reduce((sum, card) => sum + card.value, 0);
  const trumpStrength = trumpCards.reduce((sum, card) => sum + colorCardScore(card) + card.value * 0.12, 0);
  const sideStrength = hand.reduce((sum, card) => {
    if (isTrump(card, trump)) return sum;
    return sum + colorCardScore(card) * 0.8 + (card.rank === 1 ? 1.5 : 0);
  }, 0);
  const shortageBonus = COLORS.reduce((sum, color) => {
    if (color === trump) return sum;
    const count = counts[color] || 0;
    if (count === 0) return sum + 8;
    if (count === 1) return sum + 4;
    return sum;
  }, 0);
  const rookBonus = hand.some((card) => card.color === "ROOK") ? 4 : 0;

  return {
    score: pointTotal * 0.35 + trumpCount * 5.5 + trumpStrength + sideStrength + shortageBonus + rookBonus,
    trumpCount,
    pointTotal,
  };
}

function estimateBidCeiling(hand) {
  const best = COLORS.reduce(
    (bestTrump, trump) => {
      const evaluation = evaluateHandForTrump(hand, trump);
      return evaluation.score > bestTrump.score ? { trump, ...evaluation } : bestTrump;
    },
    { trump: COLORS[0], score: -Infinity, trumpCount: 0, pointTotal: 0 },
  );

  const rawBid = 55 + best.score * 0.92 + Math.min(8, Math.max(0, best.pointTotal - 35) * 0.18);
  return {
    trump: best.trump,
    ceiling: clamp(roundDownToFive(rawBid), 95, MAX_BID),
    strength: best.score,
  };
}

export function chooseBotBid(game, playerId, maxBid = MAX_BID) {
  const hand = game.hands[playerId];
  const currentBid = game.bidInfo.highBid;
  const currentBidder = game.bidInfo.bidder;
  const nextBid = Math.max(MIN_BID, currentBid + 5);
  const bidLimit = Math.min(maxBid, MAX_BID);
  const { ceiling } = estimateBidCeiling(hand);

  if (nextBid > bidLimit || nextBid > ceiling) return 0;

  if (currentBidder !== null && teamForPlayer(currentBidder) === teamForPlayer(playerId)) {
    return ceiling >= nextBid + 15 ? nextBid : 0;
  }

  if (currentBidder === null && ceiling < MIN_BID) return 0;

  const defensivePush = currentBidder !== null && teamForPlayer(currentBidder) !== teamForPlayer(playerId) ? 5 : 0;
  return nextBid <= ceiling + defensivePush ? nextBid : 0;
}

function* discardCombinations(length, choose, start = 0, prefix = []) {
  if (prefix.length === choose) {
    yield prefix;
    return;
  }

  const remainingNeeded = choose - prefix.length;
  for (let index = start; index <= length - remainingNeeded; index += 1) {
    yield* discardCombinations(length, choose, index + 1, [...prefix, index]);
  }
}

function evaluateKeptHand(keptCards, discardedCards, trump) {
  const base = evaluateHandForTrump(keptCards, trump).score;
  const discardPoints = discardedCards.reduce((sum, card) => sum + card.value, 0);
  const trumpLossPenalty = discardedCards.reduce((sum, card) => {
    if (!isTrump(card, trump)) return sum;
    return sum + 14 + colorCardScore(card) + card.value * 0.25;
  }, 0);
  const keptPoints = keptCards.reduce((sum, card) => sum + card.value, 0);
  const riskyPointPenalty = keptCards.reduce((sum, card) => {
    if (isTrump(card, trump)) return sum;
    if (card.value === 0) return sum;
    if (card.rank >= 12 || card.rank === 14) return sum;
    return sum + card.value * 0.35;
  }, 0);

  return base + discardPoints * 1.15 + keptPoints * 0.12 - trumpLossPenalty - riskyPointPenalty;
}

export function chooseBotKittyPlan(fullHand) {
  let bestPlan = null;

  COLORS.forEach((trump) => {
    for (const discardIndexes of discardCombinations(fullHand.length, DISCARD_COUNT)) {
      const discardSet = new Set(discardIndexes);
      const discardedCards = [];
      const keptCards = [];

      fullHand.forEach((card, index) => {
        if (discardSet.has(index)) {
          discardedCards.push(card);
        } else {
          keptCards.push(card);
        }
      });

      const score = evaluateKeptHand(keptCards, discardedCards, trump);

      if (!bestPlan || score > bestPlan.score) {
        bestPlan = {
          score,
          trump,
          discards: discardedCards,
          hand: sortHand(keptCards),
        };
      }
    }
  });

  return bestPlan;
}

function flattenCompletedTricks(game) {
  return game.tricks.flatMap((trick) => trick.map((play) => play.card));
}

function getPublicPlayedCards(game) {
  return [...flattenCompletedTricks(game), ...game.currentTrick.map((play) => play.card)];
}

function getUnseenCards(game, playerId) {
  const knownIds = new Set([
    ...game.hands[playerId].map((card) => card.id),
    ...getPublicPlayedCards(game).map((card) => card.id),
  ]);

  return buildDeck().filter((card) => !knownIds.has(card.id));
}

function getWinningPlay(currentTrick, trump) {
  const leadColor = getLeadColor(currentTrick, trump);
  return currentTrick.reduce(
    (best, play) => {
      const power = getCardPower(play.card, trump, leadColor);
      return power > best.power ? { play, power } : best;
    },
    { play: currentTrick[0], power: getCardPower(currentTrick[0].card, trump, leadColor) },
  ).play;
}

function beatsCurrentWinner(card, game) {
  if (game.currentTrick.length === 0) return true;
  const leadColor = getLeadColor(game.currentTrick, game.trump);
  const winningPlay = getWinningPlay(game.currentTrick, game.trump);
  return getCardPower(card, game.trump, leadColor) > getCardPower(winningPlay.card, game.trump, leadColor);
}

function canUnseenCardBeat(card, unseenCards, trump) {
  const color = effectiveColor(card, trump);
  const cardPower = getCardPower(card, trump, color);

  return unseenCards.some((unseenCard) => {
    if (effectiveColor(unseenCard, trump) !== color) return false;
    return getCardPower(unseenCard, trump, color) > cardPower;
  });
}

function sortLowestRisk(cards, trump) {
  return [...cards].sort((a, b) => {
    const valueDiff = a.value - b.value;
    if (valueDiff !== 0) return valueDiff;
    return cardLeadPower(a, trump) - cardLeadPower(b, trump);
  });
}

function sortHighestPointDump(cards, trump) {
  return [...cards].sort((a, b) => {
    const valueDiff = b.value - a.value;
    if (valueDiff !== 0) return valueDiff;
    return cardLeadPower(a, trump) - cardLeadPower(b, trump);
  });
}

function sortSmallestWinner(cards, game) {
  const leadColor = getLeadColor(game.currentTrick, game.trump);
  return [...cards].sort((a, b) => getCardPower(a, game.trump, leadColor) - getCardPower(b, game.trump, leadColor));
}

function chooseLeadCard(game, playerId, candidates) {
  const trump = game.trump;
  const playerTeam = teamForPlayer(playerId);
  const bidTeam = teamForPlayer(getTeamBidder(game));
  const unseenCards = getUnseenCards(game, playerId);
  const sureWinners = candidates.filter((card) => !canUnseenCardBeat(card, unseenCards, trump));
  const trumpCards = candidates.filter((card) => isTrump(card, trump));
  const sideCards = candidates.filter((card) => !isTrump(card, trump));

  if (sureWinners.length > 0) {
    const scoringWinners = sureWinners.filter((card) => card.value > 0);
    if (scoringWinners.length > 0) {
      return sortHighestPointDump(scoringWinners, trump)[0];
    }
  }

  if (playerTeam === bidTeam && trumpCards.length >= 4) {
    return [...trumpCards].sort((a, b) => cardLeadPower(b, trump) - cardLeadPower(a, trump))[0];
  }

  if (playerTeam !== bidTeam && sideCards.length > 0) {
    return sortLowestRisk(sideCards, trump)[0];
  }

  const colorCounts = candidates.reduce((counts, card) => {
    const color = effectiveColor(card, trump);
    counts[color] = (counts[color] || 0) + 1;
    return counts;
  }, {});

  return [...candidates].sort((a, b) => {
    const colorDiff = (colorCounts[effectiveColor(b, trump)] || 0) - (colorCounts[effectiveColor(a, trump)] || 0);
    if (colorDiff !== 0) return colorDiff;
    return cardLeadPower(a, trump) - cardLeadPower(b, trump);
  })[0];
}

function chooseFollowingCard(game, playerId, candidates) {
  const trump = game.trump;
  const winningPlay = getWinningPlay(game.currentTrick, trump);
  const partnerWinning = teamForPlayer(winningPlay.pid) === teamForPlayer(playerId);
  const trickPoints = game.currentTrick.reduce((sum, play) => sum + play.card.value, 0);
  const winningCards = candidates.filter((card) => beatsCurrentWinner(card, game));
  const losingCards = candidates.filter((card) => !beatsCurrentWinner(card, game));
  const isLastToPlay = game.currentTrick.length === 3;
  const bidTeam = teamForPlayer(getTeamBidder(game));
  const playerTeam = teamForPlayer(playerId);
  const needsPoints = playerTeam === bidTeam || trickPoints >= 15;

  if (partnerWinning) {
    if (losingCards.length > 0) {
      const dumpableCards = losingCards.filter((card) => !isTrump(card, trump));
      return sortHighestPointDump(dumpableCards.length > 0 ? dumpableCards : losingCards, trump)[0];
    }

    return sortSmallestWinner(winningCards, game)[0];
  }

  if (winningCards.length > 0) {
    const bestCheapWinner = sortSmallestWinner(winningCards, game)[0];
    const cost = bestCheapWinner.value + (isTrump(bestCheapWinner, trump) ? 4 : 0);

    if (isLastToPlay || needsPoints || trickPoints + bestCheapWinner.value >= cost + 8) {
      return bestCheapWinner;
    }
  }

  const nonTrumpLosers = losingCards.filter((card) => !isTrump(card, trump));
  if (nonTrumpLosers.length > 0) return sortLowestRisk(nonTrumpLosers, trump)[0];
  if (losingCards.length > 0) return sortLowestRisk(losingCards, trump)[0];
  return sortSmallestWinner(winningCards, game)[0];
}

export function chooseBotPlay(game, playerId) {
  const hand = game.hands[playerId];
  const leadColor = getLeadColor(game.currentTrick, game.trump);
  let candidates = hand.filter((card) => isValidMove(card, hand, leadColor, game.trump));

  if (candidates.length === 0) {
    candidates = hand;
  }

  if (candidates.length <= 1) return candidates[0] ?? null;

  if (game.currentTrick.length === 0) {
    return chooseLeadCard(game, playerId, candidates);
  }

  return chooseFollowingCard(game, playerId, candidates);
}

export function describeAiHandStrength(hand) {
  return estimateBidCeiling(hand);
}
