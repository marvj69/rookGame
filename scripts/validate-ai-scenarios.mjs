import assert from "node:assert/strict";
import { chooseBotBid, chooseBotKittyPlan, chooseBotPlay } from "../src/ai.js";
import {
  createCard,
  getEffectiveColor,
  getLeadColor,
  isValidKittyDiscard,
  isValidMove,
  sortHand,
} from "../src/game.js";

let nextId = 2000;

function card(color, rank) {
  const createdCard = createCard(color, rank, nextId);
  nextId += 1;
  return createdCard;
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
