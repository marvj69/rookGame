import { COLORS, buildDeck, getEffectiveColor, getLeadColor, sortHand, teamForPlayer } from "../game.js";

const PLAYER_IDS = [0, 1, 2, 3];
const DEFAULT_SAMPLE_ATTEMPTS = 300;

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

export function sampleHiddenHands(game, actingPlayerId, options = {}) {
  const belief = options.belief ?? inferPublicBelief(game, actingPlayerId);
  const maxAttempts = options.maxAttempts ?? DEFAULT_SAMPLE_ATTEMPTS;
  const seed = options.seed ?? 1;

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const random = createRandom(seed + attempt * 0x9e3779b1);
    const assignment = assignHiddenHandsGreedy(belief.unseenCards, belief, random);

    if (!assignment) continue;

    const sample = {
      seed,
      attempt,
      belief,
      hiddenHands: assignment.hiddenHands,
      hands: assignment.hiddenHands.map((hand, playerId) =>
        playerId === actingPlayerId ? sortHand(belief.knownCards) : hand,
      ),
      unassignedCards: assignment.unassignedCards,
    };

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
