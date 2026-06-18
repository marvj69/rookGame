import assert from "node:assert/strict";
import { evaluateSampledPlayCandidates, getLegalPlayCandidates } from "../src/ai/search.js";
import { buildDeck, getLeadColor, isValidMove, sortHand } from "../src/game.js";

const deck = buildDeck();

function card(color, rank) {
  const foundCard = deck.find((candidate) => candidate.color === color && candidate.rank === rank);
  assert.ok(foundCard, `missing ${color} ${rank}`);
  return foundCard;
}

function hiddenHand(length, playerId) {
  return new Proxy(new Array(length), {
    get(target, prop) {
      if (prop === "length") return target.length;
      throw new Error(`search prototype inspected hidden hand ${playerId} property ${String(prop)}`);
    },
  });
}

const actingHand = sortHand([card("Red", 14), card("Red", 10), card("Black", 2), card("Yellow", 3)]);
const game = {
  hands: [actingHand, hiddenHand(4, 1), hiddenHand(4, 2), hiddenHand(4, 3)],
  trump: "Red",
  dealer: 0,
  currentTurn: 0,
  kittyPoints: 10,
  bidInfo: {
    active: false,
    highBid: 110,
    bidder: 0,
    passed: [false, false, false, false],
  },
  pointsTaken: { us: 70, them: 50 },
  tricks: [
    [
      { pid: 1, card: card("Green", 10) },
      { pid: 2, card: card("Yellow", 2) },
      { pid: 3, card: card("Green", 13) },
      { pid: 0, card: card("Green", 3) },
    ],
  ],
  currentTrick: [],
};

const legalCandidates = getLegalPlayCandidates(game, 0);
assert.equal(legalCandidates.length, actingHand.length, "all lead cards are legal candidates");

const firstResult = evaluateSampledPlayCandidates(game, 0, {
  seed: 20260618,
  samples: 3,
  minSamples: 2,
  timeLimitMs: 200,
});
const secondResult = evaluateSampledPlayCandidates(game, 0, {
  seed: 20260618,
  samples: 3,
  minSamples: 2,
  timeLimitMs: 200,
});

assert.equal(firstResult.usedFallback, false, "prototype should use sampled evaluations when budget allows");
assert.equal(firstResult.samplesUsed, 3);
assert.equal(firstResult.card.id, secondResult.card.id, "prototype choice is deterministic for a fixed seed");
assert.equal(firstResult.candidates.length, legalCandidates.length);
assert.equal(
  isValidMove(firstResult.card, actingHand, getLeadColor(game.currentTrick, game.trump), game.trump),
  true,
  "prototype choice is legal",
);

const fallbackResult = evaluateSampledPlayCandidates(game, 0, {
  seed: 20260618,
  samples: 3,
  minSamples: 2,
  timeLimitMs: 0,
});

assert.equal(fallbackResult.usedFallback, true, "prototype falls back when no samples fit the budget");
assert.ok(fallbackResult.card, "fallback returns the current heuristic card");

const hiddenVariantA = {
  ...game,
  hands: [
    actingHand,
    sortHand([card("Black", 4), card("Black", 6), card("Black", 7), card("Black", 8)]),
    sortHand([card("Yellow", 4), card("Yellow", 5), card("Yellow", 6), card("Yellow", 7)]),
    sortHand([card("Green", 4), card("Green", 5), card("Green", 6), card("Green", 7)]),
  ],
};
const hiddenVariantB = {
  ...game,
  hands: [
    actingHand,
    sortHand([card("Yellow", 8), card("Yellow", 9), card("Yellow", 11), card("Yellow", 12)]),
    sortHand([card("Black", 9), card("Black", 11), card("Black", 12), card("Black", 13)]),
    sortHand([card("Red", 2), card("Red", 3), card("Red", 4), card("Red", 5)]),
  ],
};
const variantOptions = {
  seed: 20260619,
  samples: 4,
  minSamples: 2,
  timeLimitMs: 200,
};
const variantResultA = evaluateSampledPlayCandidates(hiddenVariantA, 0, variantOptions);
const variantResultB = evaluateSampledPlayCandidates(hiddenVariantB, 0, variantOptions);

assert.equal(
  variantResultA.card.id,
  variantResultB.card.id,
  "mutating hidden opponent cards with the same public hand sizes does not change search result",
);
assert.deepEqual(
  variantResultA.candidates.map((candidate) => [candidate.card.id, candidate.averageScore, candidate.samples]),
  variantResultB.candidates.map((candidate) => [candidate.card.id, candidate.averageScore, candidate.samples]),
  "mutating hidden opponent cards does not change sampled candidate evaluations",
);

console.log("Search prototype validation passed.");
