import assert from "node:assert/strict";
import {
  analyzeBotBidDecision,
  chooseBotBid,
  chooseBotKittyPlan,
  chooseBotPlay,
  evaluateKittyPlansWithSharedWorlds,
} from "../src/ai.js";
import {
  buildDeck,
  createCard,
  getEffectiveColor,
  getLeadColor,
  isValidKittyDiscard,
  isValidMove,
  sortHand,
} from "../src/game.js";

let nextId = 2000;
const canonicalDeck = buildDeck();

function card(color, rank) {
  const createdCard = createCard(color, rank, nextId);
  nextId += 1;
  return createdCard;
}

function canonicalCard(color, rank) {
  const foundCard = canonicalDeck.find((candidate) => candidate.color === color && candidate.rank === rank);
  assert.ok(foundCard, `missing canonical ${color} ${rank}`);
  return foundCard;
}

function baseGame(overrides = {}) {
  return {
    kitty: [],
    kittyPoints: 0,
    hands: [[], [], [], []],
    dealer: 0,
    currentTurn: 1,
    bidInfo: {
      active: true,
      highBid: 95,
      bidder: null,
      passed: [false, false, false, false],
    },
    trump: "Red",
    tricks: [],
    currentTrick: [],
    pointsTaken: { us: 0, them: 0 },
    settings: { mustWinByBid: false },
    ...overrides,
  };
}

function assertPlayableChoice(game, playerId, choice, message) {
  const hand = game.hands[playerId];
  const leadColor = getLeadColor(game.currentTrick, game.trump);

  assert.ok(choice, `${message}: expected a card`);
  assert.equal(hand.some((heldCard) => heldCard.id === choice.id), true, `${message}: choice is in hand`);
  assert.equal(isValidMove(choice, hand, leadColor, game.trump), true, `${message}: choice is legal`);
}

function hiddenHand(playerId) {
  return new Proxy([], {
    get() {
      throw new Error(`chooseBotPlay inspected hidden hand for player ${playerId}`);
    },
  });
}

{
  const strongHand = sortHand([
    card("Red", 14),
    card("Red", 13),
    card("Red", 12),
    card("Red", 11),
    card("Red", 10),
    card("Red", 5),
    card("ROOK", 0),
    card("Green", 14),
    card("Green", 13),
    card("Black", 14),
    card("Yellow", 2),
    card("Yellow", 3),
    card("Black", 2),
  ]);
  const weakHand = sortHand([
    card("Red", 2),
    card("Red", 3),
    card("Green", 4),
    card("Green", 6),
    card("Black", 7),
    card("Black", 8),
    card("Yellow", 9),
    card("Yellow", 11),
    card("Red", 6),
    card("Green", 7),
    card("Black", 9),
    card("Yellow", 12),
    card("Green", 2),
  ]);

  assert.equal(
    chooseBotBid(baseGame({ hands: [[], strongHand, [], []] }), 1, 150),
    100,
    "strong scoring hand opens at the minimum legal bid",
  );
  assert.equal(
    chooseBotBid(
      baseGame({
        hands: [[], weakHand, [], []],
        bidInfo: {
          active: true,
          highBid: 120,
          bidder: 2,
          passed: [false, false, false, false],
        },
      }),
      1,
      150,
    ),
    0,
    "weak hand passes instead of taking excessive bid risk",
  );
}

{
  const directEvHand = sortHand([
    canonicalCard("Red", 14),
    canonicalCard("Red", 13),
    canonicalCard("Red", 12),
    canonicalCard("Red", 11),
    canonicalCard("Red", 10),
    canonicalCard("Red", 9),
    canonicalCard("Red", 5),
    canonicalCard("ROOK", 0),
    canonicalCard("Green", 14),
    canonicalCard("Green", 13),
    canonicalCard("Black", 14),
    canonicalCard("Yellow", 2),
    canonicalCard("Black", 2),
  ]);
  const game = baseGame({ hands: [[], directEvHand, [], []] });
  const analysis = analyzeBotBidDecision(game, 1);

  assert.equal(analysis.contractOutcomes.length, 11, "direct EV evaluates every legal contract from 100 through 150");
  assert.deepEqual(
    analysis.contractOutcomes.map((outcome) => outcome.bid),
    [100, 105, 110, 115, 120, 125, 130, 135, 140, 145, 150],
    "contract grid advances in legal five-point increments",
  );
  assert.equal(
    analysis.contractOutcomes.every(
      (outcome) => outcome.samples === 8 && outcome.makeRate >= 0 && outcome.makeRate <= 1 && Number.isFinite(outcome.averageUtility),
    ),
    true,
    "each contract is scored on the same deterministic deal worlds",
  );
  assert.ok([0, analysis.nextBid].includes(analysis.decision), "diagnostic decision is either pass or the next legal bid");
}

{
  const fullHand = sortHand([
    card("Red", 14),
    card("Red", 10),
    card("Red", 5),
    card("Green", 14),
    card("Green", 10),
    card("Black", 1),
    card("Yellow", 1),
    card("Red", 2),
    card("Green", 3),
    card("Black", 4),
    card("Yellow", 6),
    card("Red", 7),
    card("Green", 8),
    card("Black", 9),
    card("Yellow", 11),
    card("Red", 12),
    card("Green", 13),
    card("ROOK", 0),
  ]);
  const plan = chooseBotKittyPlan(fullHand);
  const discardIds = new Set(plan.discards.map((discard) => discard.id));
  const keptIds = new Set(plan.hand.map((keptCard) => keptCard.id));

  assert.equal(plan.discards.length, 5, "kitty plan discards five cards");
  assert.equal(plan.hand.length, 13, "kitty plan keeps thirteen cards");
  assert.equal(isValidKittyDiscard(fullHand, plan.discards, plan.trump), true, "kitty plan obeys discard rules");
  assert.equal(plan.discards.every((discard) => discard.value === 0), true, "kitty plan does not discard points when non-points are available");
  assert.equal([...discardIds].some((id) => keptIds.has(id)), false, "kitty discards are removed from the kept hand");
}

{
  const fullHand = sortHand([
    canonicalCard("Red", 14),
    canonicalCard("Red", 13),
    canonicalCard("Red", 10),
    canonicalCard("Red", 5),
    canonicalCard("Green", 14),
    canonicalCard("Green", 10),
    canonicalCard("Black", 14),
    canonicalCard("Black", 5),
    canonicalCard("Yellow", 14),
    canonicalCard("Yellow", 10),
    canonicalCard("Red", 2),
    canonicalCard("Green", 3),
    canonicalCard("Black", 4),
    canonicalCard("Yellow", 6),
    canonicalCard("Red", 7),
    canonicalCard("Green", 8),
    canonicalCard("Black", 9),
    canonicalCard("ROOK", 0),
  ]);
  const basePlan = chooseBotKittyPlan(fullHand);
  const context = {
    playerId: 1,
    game: baseGame({
      hands: [[], fullHand, [], []],
      currentTurn: 1,
      bidInfo: {
        active: false,
        highBid: 115,
        bidder: 1,
        passed: [false, false, false, false],
        history: [{ playerId: 1, amount: 115 }],
      },
      scores: { us: 260, them: 310 },
    }),
  };
  const duplicated = evaluateKittyPlansWithSharedWorlds(
    fullHand,
    [basePlan, { ...basePlan, discards: [...basePlan.discards], hand: [...basePlan.hand] }],
    context,
  );
  const repeated = evaluateKittyPlansWithSharedWorlds(fullHand, [basePlan, { ...basePlan }], context);

  assert.ok(duplicated.worldFingerprints.length >= 2 && duplicated.worldFingerprints.length <= 5, "kitty racing uses a bounded world budget");
  assert.deepEqual(duplicated.worldFingerprints, repeated.worldFingerprints, "kitty deal worlds are deterministic");
  assert.deepEqual(
    duplicated.plans[0].rolloutSamples,
    duplicated.plans[1].rolloutSamples,
    "identical plans receive identical paired outcomes on shared opponent worlds",
  );
  assert.equal(
    duplicated.plans.every((plan) => isValidKittyDiscard(fullHand, plan.discards, plan.trump)),
    true,
    "shared-world racing never mutates plan legality",
  );
}

{
  const playableHand = sortHand([
    card("Red", 14),
    card("Red", 13),
    card("Red", 12),
    card("Green", 10),
    card("Black", 5),
    card("Yellow", 1),
    card("ROOK", 0),
    card("Red", 2),
    card("Green", 3),
    card("Black", 4),
    card("Yellow", 6),
    card("Red", 7),
    card("Green", 8),
  ]);
  const hiddenKitty = hiddenHand(5);
  const game = baseGame({
    hands: [hiddenHand(0), playableHand, hiddenHand(2), hiddenHand(3)],
    kitty: hiddenKitty,
    dealer: 0,
    currentTurn: 1,
    bidInfo: {
      active: true,
      highBid: 105,
      bidder: 3,
      passed: [false, false, false, false],
    },
    scores: { us: 180, them: 240 },
  });

  assert.doesNotThrow(() => chooseBotBid(game, 1, 150), "bid EV does not inspect hidden hands or hidden kitty");
}

{
  const fullHand = sortHand([
    card("Red", 14),
    card("Red", 13),
    card("Red", 10),
    card("Red", 5),
    card("Green", 14),
    card("Green", 10),
    card("Black", 1),
    card("Yellow", 1),
    card("Red", 2),
    card("Green", 3),
    card("Black", 4),
    card("Yellow", 6),
    card("Red", 7),
    card("Green", 8),
    card("Black", 9),
    card("Yellow", 11),
    card("Red", 12),
    card("ROOK", 0),
  ]);
  const game = baseGame({
    hands: [hiddenHand(0), fullHand, hiddenHand(2), hiddenHand(3)],
    kitty: hiddenHand(5),
    dealer: 0,
    currentTurn: 1,
    bidInfo: {
      active: false,
      highBid: 115,
      bidder: 1,
      passed: [false, false, false, false],
    },
    scores: { us: 220, them: 160 },
  });
  const plan = chooseBotKittyPlan(fullHand, { game, playerId: 1 });

  assert.equal(
    isValidKittyDiscard(fullHand, plan.discards, plan.trump),
    true,
    "contextual kitty rollout plan remains legal without hidden-card access",
  );
}

{
  const redLead = card("Red", 10);
  const redFollower = card("Red", 2);
  const offSuitPoint = card("Green", 14);
  const rook = card("ROOK", 0);
  const game = baseGame({
    hands: [[], sortHand([offSuitPoint, redFollower, rook]), [], []],
    trump: "Green",
    currentTrick: [{ pid: 0, card: redLead }],
  });
  const choice = chooseBotPlay(game, 1);

  assertPlayableChoice(game, 1, choice, "follow-suit scenario");
  assert.equal(choice.id, redFollower.id, "bot follows the led non-trump suit instead of dumping points");
}

{
  const redLead = card("Red", 2);
  const rook = card("ROOK", 0);
  const blackAce = card("Black", 14);
  const greenLow = card("Green", 3);
  const game = baseGame({
    hands: [[], sortHand([rook, blackAce, greenLow]), [], []],
    trump: "Red",
    currentTrick: [{ pid: 0, card: redLead }],
  });
  const choice = chooseBotPlay(game, 1);

  assertPlayableChoice(game, 1, choice, "Rook-as-trump scenario");
  assert.equal(choice.id, rook.id, "Rook follows trump when trump is led");
  assert.equal(getEffectiveColor(choice, game.trump), "Red", "Rook is treated as the effective trump color");
}

{
  const leadWinner = card("Green", 12);
  const scoringCardOne = card("Green", 10);
  const scoringCardTwo = card("Green", 5);
  const smallestWinner = card("Green", 13);
  const loser = card("Green", 2);
  const offSuitAce = card("Black", 14);
  const game = baseGame({
    hands: [[], sortHand([smallestWinner, loser, offSuitAce]), [], []],
    trump: "Red",
    bidInfo: {
      active: false,
      highBid: 100,
      bidder: 1,
      passed: [false, false, false, false],
    },
    currentTrick: [
      { pid: 0, card: leadWinner },
      { pid: 2, card: scoringCardOne },
      { pid: 3, card: scoringCardTwo },
    ],
    pointsTaken: { us: 0, them: 90 },
  });
  const choice = chooseBotPlay(game, 1);

  assertPlayableChoice(game, 1, choice, "last-to-play scoring scenario");
  assert.equal(choice.id, smallestWinner.id, "bid team captures scoring points with the smallest winning card");
}

{
  const playableHand = sortHand([card("Red", 14), card("Black", 2), card("Yellow", 3)]);
  const game = baseGame({
    hands: [hiddenHand(0), playableHand, hiddenHand(2), hiddenHand(3)],
    trump: "Yellow",
    currentTrick: [],
  });
  const choice = chooseBotPlay(game, 1);

  assertPlayableChoice(game, 1, choice, "hidden-card access regression");
}

console.log("AI scenario validation passed.");
