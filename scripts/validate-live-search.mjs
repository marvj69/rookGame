import assert from "node:assert/strict";
import {
  AI_STRENGTH_FAST,
  AI_STRENGTH_STRONG,
  STRONG_AI_RESPONSE_TIMEOUT_MS,
  createPublicSearchView,
  deriveStrongAiSeed,
  getStrongAiResponseTimeoutMs,
  normalizeAiStrength,
} from "../src/ai/liveSearch.js";
import { buildDeck, sortHand } from "../src/game.js";

const deck = buildDeck();

function card(color, rank) {
  const foundCard = deck.find((candidate) => candidate.color === color && candidate.rank === rank);
  assert.ok(foundCard, `missing ${color} ${rank}`);
  return foundCard;
}

function baseGame(hiddenHands) {
  return {
    kitty: [card("Red", 2), card("Green", 2)],
    hands: [
      sortHand([card("Red", 14), card("Black", 2), card("Yellow", 3)]),
      hiddenHands[0],
      hiddenHands[1],
      hiddenHands[2],
    ],
    scores: { us: 0, them: 0 },
    trump: "Red",
    dealer: 0,
    roundsCompleted: 2,
    currentTurn: 0,
    kittyPoints: 10,
    bidInfo: {
      active: false,
      highBid: 120,
      bidder: 0,
      passed: [false, false, false, false],
    },
    pointsTaken: { us: 70, them: 40 },
    tricks: [
      [
        { pid: 1, card: card("Green", 10) },
        { pid: 2, card: card("Green", 3) },
        { pid: 3, card: card("Black", 10) },
        { pid: 0, card: card("Green", 4) },
      ],
    ],
    currentTrick: [{ pid: 1, card: card("Yellow", 10) }],
    settings: { mustWinByBid: false, aiStrength: AI_STRENGTH_STRONG },
  };
}

const hiddenVariantA = baseGame([
  sortHand([card("Black", 4), card("Black", 6), card("Black", 7)]),
  sortHand([card("Yellow", 4), card("Yellow", 5), card("Yellow", 6)]),
  sortHand([card("Green", 5), card("Green", 6), card("Green", 7)]),
]);
const hiddenVariantB = baseGame([
  sortHand([card("Yellow", 7), card("Yellow", 8), card("Yellow", 9)]),
  sortHand([card("Black", 8), card("Black", 9), card("Black", 11)]),
  sortHand([card("Red", 3), card("Red", 4), card("Red", 5)]),
]);

const publicA = createPublicSearchView(hiddenVariantA, 0);
const publicB = createPublicSearchView(hiddenVariantB, 0);

assert.deepEqual(
  publicA.hands.map((hand) => hand.length),
  hiddenVariantA.hands.map((hand) => hand.length),
  "public search view preserves hand lengths",
);
assert.deepEqual(publicA.hands[0].map((card) => card.id), hiddenVariantA.hands[0].map((card) => card.id));
assert.equal(Object.keys(publicA.hands[1]).length, 0, "hidden player 1 cards are not copied");
assert.equal(Object.keys(publicA.hands[2]).length, 0, "hidden player 2 cards are not copied");
assert.equal(Object.keys(publicA.hands[3]).length, 0, "hidden player 3 cards are not copied");
assert.deepEqual(publicA.kitty, [], "kitty cards are not sent to live search");
assert.equal(
  deriveStrongAiSeed(publicA, 0),
  deriveStrongAiSeed(publicB, 0),
  "hidden card mutations do not change live search seed for the same public state",
);
assert.equal(normalizeAiStrength("unknown"), AI_STRENGTH_FAST);
assert.equal(normalizeAiStrength(AI_STRENGTH_STRONG), AI_STRENGTH_STRONG);

const originalWindow = globalThis.window;
globalThis.window = {
  location: { search: "" },
};
assert.equal(getStrongAiResponseTimeoutMs(), STRONG_AI_RESPONSE_TIMEOUT_MS, "missing override uses default timeout");
globalThis.window = {
  location: { search: "?strongAiTimeoutMs=0" },
};
assert.equal(getStrongAiResponseTimeoutMs(), 0, "zero timeout override remains available for fallback tests");
globalThis.window = originalWindow;

console.log("Live search validation passed.");
