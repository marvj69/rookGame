import {
  COLORS,
  DISCARD_COUNT,
  buildDeck,
  canDiscardCard,
  canSatisfyKittyDiscardRule,
  getEffectiveColor,
  getCardPower,
  getKittyDiscardRule,
  getLeadColor,
  isPointCard,
  isTrumpCard,
  isValidKittyDiscard,
  isValidMove,
  sortHand,
  teamForPlayer,
} from "./game.js";

const MAX_BID = 150;
const MIN_BID = 100;

function effectiveColor(card, trump) {
  return getEffectiveColor(card, trump);
}

function isTrump(card, trump) {
  return isTrumpCard(card, trump);
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

function partnerForPlayer(playerId) {
  return (playerId + 2) % 4;
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
  if (card.rank === 1) return 1;
  return 0;
}

function countEffectiveColors(hand, trump) {
  return hand.reduce((counts, card) => {
    const color = effectiveColor(card, trump);
    counts[color] = (counts[color] || 0) + 1;
    return counts;
  }, {});
}

function controlScore(card, trump, colorCounts) {
  const color = effectiveColor(card, trump);
  const colorCount = colorCounts[color] || 0;

  if (isTrump(card, trump)) {
    if (card.color === "ROOK") return 5;
    if (card.rank === 14) return 12;
    if (card.rank === 13) return 9;
    if (card.rank === 12) return 6;
    if (card.rank === 11) return 3;
    if (card.rank === 1) return colorCount >= 5 ? 2 : -2;
    return Math.max(0, card.rank - 8) * 0.5;
  }

  if (card.rank === 14) return colorCount >= 2 ? 5 : 3;
  if (card.rank === 13) return colorCount >= 3 ? 2.5 : 1;
  if (card.rank === 12) return colorCount >= 4 ? 1 : 0;
  if (card.rank === 1) return colorCount <= 2 ? -1 : -3;
  return 0;
}

function pointLiability(card, trump, colorCounts) {
  if (isTrump(card, trump) || card.value === 0) return 0;

  const colorCount = colorCounts[effectiveColor(card, trump)] || 0;
  if (card.rank === 1) return colorCount >= 4 ? 4 : 7;
  if (card.rank === 10) return colorCount >= 4 ? 2 : 4;
  if (card.rank === 5) return colorCount >= 3 ? 1 : 2;
  return 0;
}

function evaluateHandForTrump(hand, trump) {
  const counts = countByColor(hand);
  const effectiveCounts = countEffectiveColors(hand, trump);
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
  const controlBonus = hand.reduce((sum, card) => sum + controlScore(card, trump, effectiveCounts), 0);
  const liabilityPenalty = hand.reduce((sum, card) => sum + pointLiability(card, trump, effectiveCounts), 0);
  const trumpLengthBonus = trumpCount >= 5 ? (trumpCount - 4) * 3 : trumpCount <= 2 ? -4 : 0;

  return {
    score:
      pointTotal * 0.32 +
      trumpCount * 4.8 +
      trumpStrength +
      sideStrength +
      shortageBonus +
      rookBonus +
      controlBonus +
      trumpLengthBonus -
      liabilityPenalty,
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
    return ceiling >= nextBid + 25 ? nextBid : 0;
  }

  if (currentBidder === null && ceiling < MIN_BID) return 0;

  return nextBid <= ceiling ? nextBid : 0;
}

const KITTY_PLAN_CACHE_LIMIT = 2000;
const LEGAL_DISCARD_CACHE_LIMIT = 4000;
const discardCombinationCache = new Map();
const legalDiscardCache = new Map();
const kittyPlanCache = new Map();

function rememberCacheValue(cache, key, value, limit) {
  if (cache.size >= limit) {
    cache.delete(cache.keys().next().value);
  }

  cache.set(key, value);
}

function getOrderedHandSignature(fullHand) {
  return fullHand.map((card) => card.id).join(",");
}

function createDiscardCombinations(length, choose, start = 0, prefix = [], combinations = []) {
  if (prefix.length === choose) {
    combinations.push({
      indexes: prefix,
      mask: prefix.reduce((mask, index) => mask | (1 << index), 0),
    });
    return combinations;
  }

  const remainingNeeded = choose - prefix.length;
  for (let index = start; index <= length - remainingNeeded; index += 1) {
    createDiscardCombinations(length, choose, index + 1, [...prefix, index], combinations);
  }

  return combinations;
}

function getDiscardCombinations(length, choose) {
  const key = `${length}:${choose}`;
  const cached = discardCombinationCache.get(key);
  if (cached) return cached;

  const combinations = createDiscardCombinations(length, choose);
  discardCombinationCache.set(key, combinations);
  return combinations;
}

function createDiscardContext(fullHand, trump) {
  const rule = getKittyDiscardRule(fullHand, trump);
  if (!rule.canSatisfy) return null;

  return {
    rule,
    cards: fullHand.map((card) => {
      const pointCard = isPointCard(card);
      const trumpPointCard = pointCard && isTrump(card, trump);

      return {
        canDiscard: !pointCard || (rule.requiredTrumpPointCount > 0 && trumpPointCard),
        nonPoint: !pointCard,
        trumpPoint: trumpPointCard,
      };
    }),
  };
}

function isLegalDiscardCombination(combination, context) {
  let nonPointCount = 0;
  let trumpPointCount = 0;

  for (const index of combination.indexes) {
    const cardContext = context.cards[index];
    if (!cardContext.canDiscard) return false;
    if (cardContext.nonPoint) nonPointCount += 1;
    if (cardContext.trumpPoint) trumpPointCount += 1;
  }

  return (
    nonPointCount === context.rule.requiredNonPointCount &&
    trumpPointCount === context.rule.requiredTrumpPointCount
  );
}

function getLegalDiscardIdSets(fullHand, trump, handSignature) {
  const cacheKey = `${handSignature}|${trump}`;
  const cached = legalDiscardCache.get(cacheKey);
  if (cached) return cached;

  const context = createDiscardContext(fullHand, trump);
  const legalDiscardIdSets = [];

  if (context) {
    for (const combination of getDiscardCombinations(fullHand.length, DISCARD_COUNT)) {
      if (isLegalDiscardCombination(combination, context)) {
        legalDiscardIdSets.push(combination.indexes.map((index) => fullHand[index].id));
      }
    }
  }

  rememberCacheValue(legalDiscardCache, cacheKey, legalDiscardIdSets, LEGAL_DISCARD_CACHE_LIMIT);
  return legalDiscardIdSets;
}

function materializeKittyPlan(fullHand, cachedPlan) {
  const discardIds = new Set(cachedPlan.discardIds);
  const discards = [];
  const keptCards = [];

  fullHand.forEach((card) => {
    if (discardIds.has(card.id)) {
      discards.push(card);
    } else {
      keptCards.push(card);
    }
  });

  return {
    score: cachedPlan.score,
    trump: cachedPlan.trump,
    discards,
    hand: sortHand(keptCards),
  };
}

function rememberKittyPlan(handSignature, plan) {
  rememberCacheValue(
    kittyPlanCache,
    handSignature,
    {
      score: plan.score,
      trump: plan.trump,
      discardIds: plan.discards.map((card) => card.id),
    },
    KITTY_PLAN_CACHE_LIMIT,
  );
}

function evaluateKeptHand(keptCards, discardedCards, trump) {
  const base = evaluateHandForTrump(keptCards, trump).score;
  const discardPoints = discardedCards.reduce((sum, card) => sum + card.value, 0);
  const keptCounts = countEffectiveColors(keptCards, trump);
  const trumpLossPenalty = discardedCards.reduce((sum, card) => {
    if (!isTrump(card, trump)) return sum;
    return sum + 14 + colorCardScore(card) + card.value * 0.25;
  }, 0);
  const keptPoints = keptCards.reduce((sum, card) => sum + card.value, 0);
  const riskyPointPenalty = keptCards.reduce((sum, card) => {
    if (isTrump(card, trump)) return sum;
    if (card.value === 0) return sum;
    if (card.rank >= 12) return sum + pointLiability(card, trump, keptCounts) * 0.25;
    return sum + card.value * 0.55 + pointLiability(card, trump, keptCounts);
  }, 0);

  return base + discardPoints * 1.15 + keptPoints * 0.12 - trumpLossPenalty - riskyPointPenalty;
}

function createFallbackKittyPlan(fullHand) {
  const trump = COLORS.find((color) => canSatisfyKittyDiscardRule(fullHand, color)) || COLORS[0];
  const discards = [];

  for (const card of fullHand) {
    if (canDiscardCard(card, fullHand, trump)) {
      discards.push(card);
    }

    if (discards.length === DISCARD_COUNT) break;
  }

  const discardIds = new Set(discards.map((card) => card.id));
  return {
    score: -Infinity,
    trump,
    discards,
    hand: sortHand(fullHand.filter((card) => !discardIds.has(card.id))),
  };
}

export function chooseBotKittyPlan(fullHand) {
  const handSignature = getOrderedHandSignature(fullHand);
  const cachedPlan = kittyPlanCache.get(handSignature);
  if (cachedPlan) return materializeKittyPlan(fullHand, cachedPlan);

  let bestPlan = null;

  COLORS.forEach((trump) => {
    for (const discardIds of getLegalDiscardIdSets(fullHand, trump, handSignature)) {
      const discardSet = new Set(discardIds);
      const discardedCards = [];
      const keptCards = [];

      fullHand.forEach((card) => {
        if (discardSet.has(card.id)) {
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

  let plan = bestPlan || createFallbackKittyPlan(fullHand);

  if (!isValidKittyDiscard(fullHand, plan.discards, plan.trump)) {
    plan = createFallbackKittyPlan(fullHand);
  }

  rememberKittyPlan(handSignature, plan);
  return plan;
}

function flattenCompletedTricks(game) {
  return game.tricks.flatMap((trick) => trick.map((play) => play.card));
}

function getPublicPlayedCards(game) {
  return [...flattenCompletedTricks(game), ...game.currentTrick.map((play) => play.card)];
}

function getKnownVoids(game) {
  const voids = [new Set(), new Set(), new Set(), new Set()];
  const observedTricks = [...game.tricks, game.currentTrick];

  observedTricks.forEach((trick) => {
    const leadColor = getLeadColor(trick, game.trump);
    if (!leadColor) return;

    trick.slice(1).forEach((play) => {
      if (effectiveColor(play.card, game.trump) !== leadColor) {
        voids[play.pid].add(leadColor);
      }
    });
  });

  return voids;
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

function sortVoidBuildingLeads(cards, trump) {
  const counts = countEffectiveColors(cards, trump);

  return [...cards].sort((a, b) => {
    const countDiff = (counts[effectiveColor(a, trump)] || 0) - (counts[effectiveColor(b, trump)] || 0);
    if (countDiff !== 0) return countDiff;

    const valueDiff = a.value - b.value;
    if (valueDiff !== 0) return valueDiff;

    return cardLeadPower(a, trump) - cardLeadPower(b, trump);
  });
}

function sortPressureLeads(cards, trump) {
  const counts = countEffectiveColors(cards, trump);

  return [...cards].sort((a, b) => {
    const controlDiff = controlScore(b, trump, counts) - controlScore(a, trump, counts);
    if (controlDiff !== 0) return controlDiff;

    const valueDiff = b.value - a.value;
    if (valueDiff !== 0) return valueDiff;

    return cardLeadPower(b, trump) - cardLeadPower(a, trump);
  });
}

function getValidCardsForPlayer(game, playerId) {
  const hand = game.hands[playerId];
  const leadColor = getLeadColor(game.currentTrick, game.trump);
  const validCards = hand.filter((card) => isValidMove(card, hand, leadColor, game.trump));
  return validCards.length > 0 ? validCards : hand;
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
    const knownVoids = getKnownVoids(game);
    const partnerVoids = knownVoids[partnerForPlayer(playerId)];
    const opponents = [1, 2, 3, 0].filter(
      (candidatePlayerId) =>
        candidatePlayerId !== playerId && teamForPlayer(candidatePlayerId) !== teamForPlayer(playerId),
    );
    const partnerRuffLeads = sideCards.filter((card) => partnerVoids.has(effectiveColor(card, trump)) && card.value === 0);

    if (partnerRuffLeads.length > 0) {
      return sortLowestRisk(partnerRuffLeads, trump)[0];
    }

    const pressureCards = sideCards.filter((card) => card.rank >= 13 && card.value > 0);
    if (pressureCards.length > 0) {
      const safePressureCards = pressureCards.filter(
        (card) => !opponents.some((opponentId) => knownVoids[opponentId].has(effectiveColor(card, trump))),
      );
      return sortPressureLeads(safePressureCards.length > 0 ? safePressureCards : pressureCards, trump)[0];
    }

    const safeSideCards = sideCards.filter(
      (card) => card.value === 0 || !opponents.some((opponentId) => knownVoids[opponentId].has(effectiveColor(card, trump))),
    );
    return sortVoidBuildingLeads(safeSideCards.length > 0 ? safeSideCards : sideCards, trump)[0];
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
  const opponentBidTeamWinning = teamForPlayer(winningPlay.pid) === bidTeam && playerTeam !== bidTeam;

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
    const cheapControlTake = bestCheapWinner.value === 0 && !isTrump(bestCheapWinner, trump);

    if (isLastToPlay || needsPoints || cheapControlTake || opponentBidTeamWinning || trickPoints + bestCheapWinner.value >= cost + 8) {
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
