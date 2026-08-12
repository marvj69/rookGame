import assert from "node:assert/strict";
import {
  inferPublicBelief,
  sampleHiddenHands,
  scoreSampleLikelihood,
  validateSampledHiddenHands,
} from "../src/ai/belief.js";
import { buildDeck, getEffectiveColor, sortHand } from "../src/game.js";

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
      throw new Error(`belief model inspected hidden hand ${playerId} property ${String(prop)}`);
    },
  });
}

function cardIds(cards) {
  return cards.map((sampledCard) => sampledCard.id).join(",");
}

const actingHand = sortHand([card("Red", 14), card("Black", 2), card("Yellow", 3)]);
const game = {
  hands: [actingHand, hiddenHand(4, 1), hiddenHand(4, 2), hiddenHand(4, 3)],
  trump: "Yellow",
  dealer: 0,
  bidInfo: {
    active: false,
    highBid: 115,
    bidder: 1,
    passed: [false, false, false, false],
    history: [
      { playerId: 0, amount: 100 },
      { playerId: 1, amount: 115 },
      { playerId: 2, amount: 0 },
      { playerId: 3, amount: 0 },
    ],
  },
  tricks: [
    [
      { pid: 0, card: card("Red", 10) },
      { pid: 1, card: card("Green", 2) },
      { pid: 2, card: card("Red", 13) },
      { pid: 3, card: card("ROOK", 0) },
    ],
    [
      { pid: 1, card: card("Black", 10) },
      { pid: 2, card: card("Black", 3) },
      { pid: 3, card: card("Green", 14) },
      { pid: 0, card: card("Black", 5) },
    ],
  ],
  currentTrick: [
    { pid: 2, card: card("Yellow", 10) },
    { pid: 3, card: card("Yellow", 4) },
  ],
};

const belief = inferPublicBelief(game, 0);

assert.deepEqual(belief.knownCardIds, actingHand.map((knownCard) => knownCard.id), "acting hand is known");
assert.equal(belief.publicPlayedCards.length, 10, "completed and current trick cards are public");
assert.equal(belief.unseenCards.length, deck.length - belief.knownCards.length - belief.publicPlayedCards.length);
assert.deepEqual(belief.remainingHandSizes, [3, 4, 4, 4], "remaining hand sizes are public lengths");

assert.deepEqual(belief.knownVoids[1].colors, ["Red"], "player 1 is known void in red after failing to follow");
assert.deepEqual(belief.knownVoids[2].colors, [], "player 2 followed suit in the fixtures");
assert.deepEqual(belief.knownVoids[3].colors, ["Red", "Black"], "player 3 has two known void colors");

assert.deepEqual(belief.suitConstraints[1].cannotHaveColors, ["Red"]);
assert.equal(belief.suitConstraints[1].canHaveColors.includes("Red"), false);
assert.equal(belief.suitConstraints[3].canHaveColors.includes("Black"), false);
assert.deepEqual(belief.possibleVoids[0].colors, ["Green"], "acting player's current hand proves only green is absent");

assert.equal(belief.teamContext.actingTeam, "us");
assert.equal(belief.teamContext.partnerId, 2);
assert.deepEqual(belief.teamContext.opponentIds, [1, 3]);
assert.equal(belief.teamContext.bidTeam, "them");
assert.deepEqual(belief.teamContext.opponentBidderIds, [1]);
assert.deepEqual(belief.auctionHistory, game.bidInfo.history, "public auction actions are retained as likelihood evidence");

const strongBidderLikelihood = scoreSampleLikelihood(game, belief, [
  actingHand,
  [card("Yellow", 14), card("Yellow", 13), card("Yellow", 12), card("Yellow", 11)],
  [card("Green", 3), card("Green", 4), card("Green", 6), card("Green", 7)],
  [card("Black", 3), card("Black", 4), card("Black", 6), card("Black", 7)],
]);
const weakBidderLikelihood = scoreSampleLikelihood(game, belief, [
  actingHand,
  [card("Green", 3), card("Green", 4), card("Green", 6), card("Green", 7)],
  [card("Yellow", 14), card("Yellow", 13), card("Yellow", 12), card("Yellow", 11)],
  [card("Black", 3), card("Black", 4), card("Black", 6), card("Black", 7)],
]);

assert.ok(
  strongBidderLikelihood.weight > weakBidderLikelihood.weight,
  "a trump-rich bidder world receives more posterior weight than a weak bidder world",
);
assert.ok(strongBidderLikelihood.weight <= 8 && weakBidderLikelihood.weight >= 0.12, "particle weights stay bounded");

const firstSample = sampleHiddenHands(game, 0, { seed: 20260618, belief });
const secondSample = sampleHiddenHands(game, 0, { seed: 20260618, belief });
const validation = validateSampledHiddenHands(belief, firstSample);

assert.equal(validation.valid, true, validation.errors.join("; "));
assert.ok(firstSample.likelihoodWeight >= 0.12 && firstSample.likelihoodWeight <= 8, "sample carries a bounded likelihood weight");
assert.equal(firstSample.likelihoodEvidence.length, 3, "sample exposes auditable evidence for each hidden hand");
assert.deepEqual(
  firstSample.hiddenHands.map(cardIds),
  secondSample.hiddenHands.map(cardIds),
  "sampling is deterministic for a fixed seed",
);

const stratifiedSamples = Array.from({ length: 32 }, (_, stratumIndex) =>
  sampleHiddenHands(game, 0, {
    seed: 20260618,
    belief,
    sampler: "stratified",
    stratumIndex,
  }),
);
stratifiedSamples.forEach((sample, stratumIndex) => {
  assert.equal(sample.sampler, "stratified");
  assert.equal(sample.stratumIndex, stratumIndex);
  assert.equal(validateSampledHiddenHands(belief, sample).valid, true);
});
const unconstrainedGame = { ...game, tricks: [], currentTrick: [] };
const unconstrainedBelief = inferPublicBelief(unconstrainedGame, 0);
const unconstrainedStrata = Array.from({ length: unconstrainedBelief.unseenCards.length }, (_, stratumIndex) =>
  sampleHiddenHands(unconstrainedGame, 0, {
    seed: 20260618,
    belief: unconstrainedBelief,
    sampler: "stratified",
    stratumIndex,
  }),
);
const ownershipCounts = new Map(
  unconstrainedBelief.unseenCards.map((unseenCard) => [
    unseenCard.id,
    [1, 2, 3].map(
      (playerId) => unconstrainedStrata.filter((sample) => sample.hands[playerId].some((held) => held.id === unseenCard.id)).length,
    ),
  ]),
);
assert.ok(
  [...ownershipCounts.values()].every((counts) => counts.every((count) => count === 4)),
  "a full unconstrained stratum cycle assigns every unseen card exactly four times to each opponent",
);

const blockedIds = new Set([...belief.knownCardIds, ...belief.publicPlayedCardIds]);
const sampledIds = new Set();

[1, 2, 3].forEach((playerId) => {
  assert.equal(firstSample.hiddenHands[playerId].length, belief.remainingHandSizes[playerId]);

  firstSample.hiddenHands[playerId].forEach((sampledCard) => {
    assert.equal(blockedIds.has(sampledCard.id), false, `sampled blocked card ${sampledCard.id}`);
    assert.equal(sampledIds.has(sampledCard.id), false, `sampled duplicate card ${sampledCard.id}`);
    sampledIds.add(sampledCard.id);

    assert.equal(
      belief.suitConstraints[playerId].cannotHaveColors.includes(getEffectiveColor(sampledCard, belief.trump)),
      false,
      `sampled ${getEffectiveColor(sampledCard, belief.trump)} for known-void player ${playerId}`,
    );
  });
});

assert.equal(firstSample.unassignedCards.length, belief.unseenCards.length - 12, "unassigned cards represent unseen kitty/out-of-hand cards");

for (let seedOffset = 0; seedOffset < 64; seedOffset += 1) {
  const matchingSample = sampleHiddenHands(game, 0, {
    seed: 20260831 + seedOffset * 9973,
    belief,
    sampler: "matching",
    maxAttempts: 1,
  });
  const matchingValidation = validateSampledHiddenHands(belief, matchingSample);
  assert.equal(matchingSample.sampler, "matching", "sample records the configured construction method");
  assert.equal(matchingSample.attempt, 0, "maximum matching fills a feasible particle on its first construction");
  assert.equal(matchingValidation.valid, true, matchingValidation.errors.join("; "));
}

console.log("Belief model validation passed.");
