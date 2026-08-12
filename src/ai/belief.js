import { COLORS, buildDeck, getEffectiveColor, getLeadColor, sortHand, teamForPlayer } from "../game.js";

const PLAYER_IDS = [0, 1, 2, 3];
const DEFAULT_SAMPLE_ATTEMPTS = 300;
const MIN_PARTICLE_WEIGHT = 0.12;
const MAX_PARTICLE_WEIGHT = 8;

function now() {
  return globalThis.performance?.now?.() ?? Date.now();
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

function shuffle(cards, random) {
  const shuffled = [...cards];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled;
}

function uniqueCards(cards) {
  const seenIds = new Set();
  const unique = [];

  cards.forEach((card) => {
    if (!card || seenIds.has(card.id)) return;
    seenIds.add(card.id);
    unique.push(card);
  });

  return unique;
}

function getPublicPlayedCards(game) {
  return uniqueCards([
    ...(game.tricks ?? []).flatMap((trick) => trick.map((play) => play.card)),
    ...(game.currentTrick ?? []).map((play) => play.card),
  ]);
}

function getObservedCardsByPlayer(game) {
  const cardsByPlayer = PLAYER_IDS.map(() => []);

  [...(game.tricks ?? []), game.currentTrick ?? []].forEach((trick) => {
    trick.forEach((play) => {
      if (PLAYER_IDS.includes(play.pid) && play.card) cardsByPlayer[play.pid].push(play.card);
    });
  });

  return cardsByPlayer;
}

function normalizeAuctionHistory(game) {
  if (Array.isArray(game.bidInfo?.history) && game.bidInfo.history.length > 0) {
    return game.bidInfo.history
      .filter(
        (action) =>
          PLAYER_IDS.includes(action?.playerId) &&
          Number.isInteger(action?.amount) &&
          (action.amount === 0 || (action.amount >= 100 && action.amount <= 150 && action.amount % 5 === 0)),
      )
      .map((action) => ({ playerId: action.playerId, amount: action.amount }));
  }

  return PLAYER_IDS.filter((playerId) => game.bidInfo?.passed?.[playerId]).map((playerId) => ({
    playerId,
    amount: 0,
  }));
}

function getKnownVoidSets(game) {
  const knownVoids = PLAYER_IDS.map(() => new Set());
  const observedTricks = [...(game.tricks ?? []), game.currentTrick ?? []];

  observedTricks.forEach((trick) => {
    const leadColor = getLeadColor(trick, game.trump);
    if (!leadColor) return;

    trick.slice(1).forEach((play) => {
      if (getEffectiveColor(play.card, game.trump) !== leadColor) {
        knownVoids[play.pid].add(leadColor);
      }
    });
  });

  return knownVoids;
}

function sortColors(colors) {
  const colorOrder = new Map(COLORS.map((color, index) => [color, index]));
  return [...colors].sort((a, b) => (colorOrder.get(a) ?? 99) - (colorOrder.get(b) ?? 99));
}

function getRemainingHandSizes(game, actingPlayerId) {
  return PLAYER_IDS.map((playerId) => {
    const hand = game.hands?.[playerId];
    if (playerId === actingPlayerId) return hand?.length ?? 0;
    return Number.isFinite(hand?.length) ? hand.length : 0;
  });
}

function getKnownCurrentColorsForActingPlayer(cards, trump) {
  return new Set(cards.map((card) => getEffectiveColor(card, trump)));
}

function createTeamContext(game, actingPlayerId) {
  const actingTeam = teamForPlayer(actingPlayerId);
  const partnerId = (actingPlayerId + 2) % 4;
  const opponentIds = PLAYER_IDS.filter((playerId) => teamForPlayer(playerId) !== actingTeam);
  const bidder = game.bidInfo?.bidder ?? game.dealer ?? null;
  const bidTeam = bidder === null ? null : teamForPlayer(bidder);

  return {
    actingPlayerId,
    actingTeam,
    partnerId,
    partnerTeam: teamForPlayer(partnerId),
    opponentIds,
    bidder,
    bidTeam,
    actingTeamIsBidTeam: bidTeam === actingTeam,
    partnerIsBidder: bidder === partnerId,
    opponentBidderIds: opponentIds.filter((playerId) => playerId === bidder),
  };
}

export function inferPublicBelief(game, actingPlayerId) {
  const knownCards = [...(game.hands?.[actingPlayerId] ?? [])];
  const publicPlayedCards = getPublicPlayedCards(game);
  const unavailableCardIds = new Set([...knownCards, ...publicPlayedCards].map((card) => card.id));
  const unseenCards = buildDeck().filter((card) => !unavailableCardIds.has(card.id));
  const knownVoidSets = getKnownVoidSets(game);
  const actingCurrentColors = getKnownCurrentColorsForActingPlayer(knownCards, game.trump);
  const remainingHandSizes = getRemainingHandSizes(game, actingPlayerId);
  const observedCardsByPlayer = getObservedCardsByPlayer(game);
  const auctionHistory = normalizeAuctionHistory(game);

  const suitConstraints = PLAYER_IDS.map((playerId) => {
    const cannotHaveColors = sortColors(knownVoidSets[playerId]);
    const canHaveColors = COLORS.filter((color) => !knownVoidSets[playerId].has(color));
    const possibleVoidColors =
      playerId === actingPlayerId
        ? COLORS.filter((color) => !actingCurrentColors.has(color))
        : COLORS;

    return {
      playerId,
      cannotHaveColors,
      canHaveColors,
      possibleVoidColors,
    };
  });

  return {
    actingPlayerId,
    trump: game.trump,
    knownCards,
    knownCardIds: knownCards.map((card) => card.id),
    publicPlayedCards,
    publicPlayedCardIds: publicPlayedCards.map((card) => card.id),
    unavailableCardIds: [...unavailableCardIds],
    unseenCards,
    unseenCardIds: unseenCards.map((card) => card.id),
    remainingHandSizes,
    observedCardsByPlayer,
    auctionHistory,
    knownVoids: knownVoidSets.map((voidSet, playerId) => ({
      playerId,
      colors: sortColors(voidSet),
    })),
    possibleVoids: suitConstraints.map(({ playerId, possibleVoidColors }) => ({
      playerId,
      colors: possibleVoidColors,
    })),
    suitConstraints,
    teamContext: createTeamContext(game, actingPlayerId),
  };
}

function cardControlValue(card, trump) {
  const effectiveColor = getEffectiveColor(card, trump);
  let value = card.value * 0.055;

  if (card.color === "ROOK") value += 2.2;
  if (card.rank === 14) value += 1.7;
  if (card.rank === 13) value += 0.9;
  if (effectiveColor === trump) {
    value += 0.85;
    if (card.rank >= 12 || card.color === "ROOK") value += 0.65;
  }

  return value;
}

function handEvidenceStrength(cards, trump) {
  const trumpCount = cards.filter((card) => getEffectiveColor(card, trump) === trump).length;
  const controls = cards.reduce((sum, card) => sum + cardControlValue(card, trump), 0);
  const pointTotal = cards.reduce((sum, card) => sum + card.value, 0);

  return {
    trumpCount,
    controls,
    pointTotal,
    strength: controls + trumpCount * 0.42 + pointTotal * 0.018,
  };
}

function getPlayerAuctionEvidence(auctionHistory, playerId) {
  const actions = auctionHistory.filter((action) => action.playerId === playerId);
  const positiveBids = actions.filter((action) => action.amount > 0).map((action) => action.amount);
  const passAction = actions.find((action) => action.amount === 0) ?? null;

  return {
    maxBid: positiveBids.length > 0 ? Math.max(...positiveBids) : null,
    passed: Boolean(passAction),
  };
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function scoreSampleLikelihood(game, belief, hiddenHands) {
  const bidder = belief.teamContext.bidder;
  const highBid = Math.max(100, game.bidInfo?.highBid ?? 100);
  let logWeight = 0;
  const evidence = [];

  PLAYER_IDS.forEach((playerId) => {
    if (playerId === belief.actingPlayerId) return;

    const reconstructedCards = [
      ...(hiddenHands[playerId] ?? []),
      ...(belief.observedCardsByPlayer?.[playerId] ?? []),
    ];
    const strength = handEvidenceStrength(reconstructedCards, belief.trump);
    const auction = getPlayerAuctionEvidence(belief.auctionHistory ?? [], playerId);
    let playerLogWeight = 0;

    if (playerId === bidder) {
      const bidPressure = Math.max(0, highBid - 100) / 5;
      const targetStrength = 9.5 + bidPressure * 0.34;
      playerLogWeight += clamp((strength.strength - targetStrength) * 0.11, -1.15, 1.35);
      playerLogWeight += clamp((strength.trumpCount - 3.5) * 0.2, -0.65, 0.9);
    } else if (auction.passed || game.bidInfo?.passed?.[playerId]) {
      const passBid = Math.max(100, auction.maxBid ?? highBid);
      const passPressure = Math.max(0, passBid - 100) / 5;
      const passThreshold = 11.8 + passPressure * 0.2;
      playerLogWeight += clamp((passThreshold - strength.strength) * 0.065, -0.8, 0.55);
    } else if (auction.maxBid !== null) {
      const targetStrength = 8.7 + Math.max(0, auction.maxBid - 100) * 0.055;
      playerLogWeight += clamp((strength.strength - targetStrength) * 0.075, -0.7, 0.8);
    }

    logWeight += playerLogWeight;
    evidence.push({ playerId, ...strength, ...auction, logWeight: playerLogWeight });
  });

  const boundedLogWeight = clamp(logWeight, Math.log(MIN_PARTICLE_WEIGHT), Math.log(MAX_PARTICLE_WEIGHT));
  return {
    weight: Math.exp(boundedLogWeight),
    logWeight: boundedLogWeight,
    evidence,
  };
}

function canAssignCardToPlayer(card, playerId, belief) {
  const constraint = belief.suitConstraints[playerId];
  if (!constraint) return false;
  return !constraint.cannotHaveColors.includes(getEffectiveColor(card, belief.trump));
}

function canCompleteRemainingAssignment(remainingCards, players, hiddenHands, belief) {
  return players.every((playerId) => {
    const needed = belief.remainingHandSizes[playerId] - hiddenHands[playerId].length;
    if (needed <= 0) return true;
    return remainingCards.filter((card) => canAssignCardToPlayer(card, playerId, belief)).length >= needed;
  });
}

function assignHiddenHandsGreedy(cards, belief, random) {
  const hiddenPlayerIds = PLAYER_IDS.filter((playerId) => playerId !== belief.actingPlayerId);
  const hiddenHands = PLAYER_IDS.map(() => []);
  let remainingCards = shuffle(cards, random);

  const assignmentOrder = [...hiddenPlayerIds].sort((a, b) => {
    const legalDiff =
      remainingCards.filter((card) => canAssignCardToPlayer(card, a, belief)).length -
      remainingCards.filter((card) => canAssignCardToPlayer(card, b, belief)).length;
    return legalDiff || belief.remainingHandSizes[b] - belief.remainingHandSizes[a] || a - b;
  });

  for (let assignmentIndex = 0; assignmentIndex < assignmentOrder.length; assignmentIndex += 1) {
    const playerId = assignmentOrder[assignmentIndex];
    const needed = belief.remainingHandSizes[playerId];
    const chosenCards = [];
    const nextRemainingCards = [];

    for (const card of remainingCards) {
      if (chosenCards.length < needed && canAssignCardToPlayer(card, playerId, belief)) {
        chosenCards.push(card);
      } else {
        nextRemainingCards.push(card);
      }
    }

    if (chosenCards.length !== needed) return null;

    hiddenHands[playerId] = chosenCards;
    remainingCards = nextRemainingCards;

    const remainingPlayers = assignmentOrder.slice(assignmentIndex + 1);
    if (!canCompleteRemainingAssignment(remainingCards, remainingPlayers, hiddenHands, belief)) {
      return null;
    }
  }

  return {
    hiddenHands: hiddenHands.map((hand) => sortHand(hand)),
    unassignedCards: sortHand(remainingCards),
  };
}

function greatestCommonDivisor(left, right) {
  let a = Math.abs(left);
  let b = Math.abs(right);
  while (b !== 0) {
    [a, b] = [b, a % b];
  }
  return a;
}

function getCoprimeRotationStep(cardCount) {
  if (cardCount <= 1) return 1;
  let step = Math.max(1, Math.round(cardCount * 0.6180339887498949));
  while (greatestCommonDivisor(step, cardCount) !== 1) step += 1;
  return step % cardCount || 1;
}

function assignHiddenHandsStratified(cards, belief, random, stratumIndex) {
  const shuffled = shuffle(cards, random);
  if (shuffled.length === 0) {
    return { hiddenHands: PLAYER_IDS.map(() => []), unassignedCards: [] };
  }

  const hiddenPlayerIds = PLAYER_IDS.filter((playerId) => playerId !== belief.actingPlayerId);
  const capacities = new Map(hiddenPlayerIds.map((playerId) => [playerId, belief.remainingHandSizes[playerId]]));
  const unassignedCapacity = shuffled.length - [...capacities.values()].reduce((sum, count) => sum + count, 0);
  if (unassignedCapacity < 0) return null;
  capacities.set(null, unassignedCapacity);

  // Interleave ownership slots so every sliding window has approximately the
  // right share for each opponent and for the unseen kitty. Rotating cards
  // against these slots gives low-discrepancy ownership across particles.
  const slotOwners = [];
  while (slotOwners.length < shuffled.length) {
    for (const owner of [...hiddenPlayerIds, null]) {
      const remaining = capacities.get(owner) ?? 0;
      if (remaining <= 0) continue;
      slotOwners.push(owner);
      capacities.set(owner, remaining - 1);
    }
  }

  const rotation = (Math.max(0, stratumIndex) * getCoprimeRotationStep(shuffled.length)) % shuffled.length;
  const slots = slotOwners.map((playerId, slotIndex) => ({ playerId, slotIndex }));
  const slotOrder = [...slots]
    .sort((left, right) => {
      if (left.playerId === null && right.playerId !== null) return 1;
      if (left.playerId !== null && right.playerId === null) return -1;
      const leftLegal = shuffled.filter(
        (card) => left.playerId === null || canAssignCardToPlayer(card, left.playerId, belief),
      ).length;
      const rightLegal = shuffled.filter(
        (card) => right.playerId === null || canAssignCardToPlayer(card, right.playerId, belief),
      ).length;
      return leftLegal - rightLegal || left.slotIndex - right.slotIndex;
    })
    .map(({ slotIndex }) => slotIndex);
  const adjacency = slots.map((slot) => {
    const desiredCardIndex = (slot.slotIndex - rotation + shuffled.length) % shuffled.length;
    return shuffled
      .map((card, cardIndex) => ({
        card,
        cardIndex,
        distance: Math.min(
          (cardIndex - desiredCardIndex + shuffled.length) % shuffled.length,
          (desiredCardIndex - cardIndex + shuffled.length) % shuffled.length,
        ),
      }))
      .filter(({ card }) => slot.playerId === null || canAssignCardToPlayer(card, slot.playerId, belief))
      .sort((left, right) => left.distance - right.distance || left.cardIndex - right.cardIndex)
      .map(({ cardIndex }) => cardIndex);
  });
  const cardToSlot = new Array(shuffled.length).fill(-1);

  function augment(slotIndex, visitedCards) {
    for (const cardIndex of adjacency[slotIndex]) {
      if (visitedCards.has(cardIndex)) continue;
      visitedCards.add(cardIndex);
      const previousSlot = cardToSlot[cardIndex];
      if (previousSlot === -1 || augment(previousSlot, visitedCards)) {
        cardToSlot[cardIndex] = slotIndex;
        return true;
      }
    }
    return false;
  }

  for (const slotIndex of slotOrder) {
    if (!augment(slotIndex, new Set())) return null;
  }

  const hiddenHands = PLAYER_IDS.map(() => []);
  const unassignedCards = [];
  cardToSlot.forEach((slotIndex, cardIndex) => {
    const owner = slots[slotIndex]?.playerId ?? null;
    if (owner === null) unassignedCards.push(shuffled[cardIndex]);
    else hiddenHands[owner].push(shuffled[cardIndex]);
  });
  return {
    hiddenHands: hiddenHands.map((hand) => sortHand(hand)),
    unassignedCards: sortHand(unassignedCards),
  };
}

function assignHiddenHandsMatching(cards, belief, random) {
  const hiddenPlayerIds = PLAYER_IDS.filter((playerId) => playerId !== belief.actingPlayerId);
  const hiddenHands = PLAYER_IDS.map(() => []);
  const slots = hiddenPlayerIds.flatMap((playerId) =>
    Array.from({ length: belief.remainingHandSizes[playerId] }, () => ({
      playerId,
      tieBreaker: random(),
    })),
  );
  const slotOrder = slots
    .map((slot, slotIndex) => ({
      slotIndex,
      legalCards: cards.filter((card) => canAssignCardToPlayer(card, slot.playerId, belief)).length,
      tieBreaker: slot.tieBreaker,
    }))
    .sort((left, right) => left.legalCards - right.legalCards || left.tieBreaker - right.tieBreaker)
    .map(({ slotIndex }) => slotIndex);
  const adjacency = slots.map((slot) =>
    shuffle(
      cards.map((card, cardIndex) => ({ card, cardIndex })),
      random,
    )
      .filter(({ card }) => canAssignCardToPlayer(card, slot.playerId, belief))
      .map(({ cardIndex }) => cardIndex),
  );
  const cardToSlot = new Array(cards.length).fill(-1);

  function augment(slotIndex, visitedCards) {
    for (const cardIndex of adjacency[slotIndex]) {
      if (visitedCards.has(cardIndex)) continue;
      visitedCards.add(cardIndex);
      const previousSlot = cardToSlot[cardIndex];
      if (previousSlot === -1 || augment(previousSlot, visitedCards)) {
        cardToSlot[cardIndex] = slotIndex;
        return true;
      }
    }
    return false;
  }

  for (const slotIndex of slotOrder) {
    if (!augment(slotIndex, new Set())) return null;
  }

  const assignedCardIds = new Set();
  cardToSlot.forEach((slotIndex, cardIndex) => {
    if (slotIndex < 0) return;
    const card = cards[cardIndex];
    hiddenHands[slots[slotIndex].playerId].push(card);
    assignedCardIds.add(card.id);
  });

  return {
    hiddenHands: hiddenHands.map((hand) => sortHand(hand)),
    unassignedCards: sortHand(cards.filter((card) => !assignedCardIds.has(card.id))),
  };
}

export function sampleHiddenHands(game, actingPlayerId, options = {}) {
  const belief = options.belief ?? inferPublicBelief(game, actingPlayerId);
  const maxAttempts = options.maxAttempts ?? DEFAULT_SAMPLE_ATTEMPTS;
  const seed = options.seed ?? 1;
  const deadlineMs = options.deadlineMs ?? Number.POSITIVE_INFINITY;
  const sampler = ["matching", "stratified"].includes(options.sampler) ? options.sampler : "greedy";
  const stratumIndex = Math.max(0, Math.floor(Number(options.stratumIndex) || 0));

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (now() >= deadlineMs) break;

    const random = createRandom(seed + attempt * 0x9e3779b1);
    const assignment =
      sampler === "matching"
        ? assignHiddenHandsMatching(belief.unseenCards, belief, random)
        : sampler === "stratified"
          ? assignHiddenHandsStratified(belief.unseenCards, belief, random, stratumIndex)
          : assignHiddenHandsGreedy(belief.unseenCards, belief, random);

    if (!assignment) continue;

    const sample = {
      seed,
      attempt,
      sampler,
      stratumIndex: sampler === "stratified" ? stratumIndex : null,
      belief,
      hiddenHands: assignment.hiddenHands,
      hands: assignment.hiddenHands.map((hand, playerId) =>
        playerId === actingPlayerId ? sortHand(belief.knownCards) : hand,
      ),
      unassignedCards: assignment.unassignedCards,
    };

    const likelihood = scoreSampleLikelihood(game, belief, sample.hiddenHands);
    sample.likelihoodWeight = likelihood.weight;
    sample.logLikelihood = likelihood.logWeight;
    sample.likelihoodEvidence = likelihood.evidence;

    const validation = validateSampledHiddenHands(belief, sample);
    if (validation.valid) return sample;
  }

  throw new Error(`Unable to sample hidden hands from public belief after ${maxAttempts} attempts.`);
}

export function validateSampledHiddenHands(belief, sample) {
  const errors = [];
  const blockedIds = new Set([...belief.knownCardIds, ...belief.publicPlayedCardIds]);
  const assignedIds = new Set();

  PLAYER_IDS.forEach((playerId) => {
    if (playerId === belief.actingPlayerId) return;

    const hand = sample.hiddenHands[playerId] ?? [];
    if (hand.length !== belief.remainingHandSizes[playerId]) {
      errors.push(`player ${playerId} has ${hand.length} sampled cards, expected ${belief.remainingHandSizes[playerId]}`);
    }

    hand.forEach((card) => {
      if (blockedIds.has(card.id)) {
        errors.push(`player ${playerId} was assigned blocked card ${card.id}`);
      }

      if (assignedIds.has(card.id)) {
        errors.push(`card ${card.id} was assigned more than once`);
      }

      assignedIds.add(card.id);

      if (!canAssignCardToPlayer(card, playerId, belief)) {
        errors.push(`player ${playerId} was assigned ${getEffectiveColor(card, belief.trump)} despite known void evidence`);
      }
    });
  });

  return {
    valid: errors.length === 0,
    errors,
  };
}
