import assert from "node:assert/strict";
import { applyRootAggregationScores, evaluateSampledPlayCandidates, getLegalPlayCandidates } from "../src/ai/search.js";
import { buildDeck, getLeadColor, isValidMove, sortHand } from "../src/game.js";
import { createPublicSearchView as createBenchmarkPublicSearchView } from "./ai-benchmark-sim.mjs";

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

const delayedSearchResult = evaluateSampledPlayCandidates(game, 0, {
  seed: 20260618,
  samples: 3,
  minSamples: 2,
  sampleBudgetMode: "fixed",
  searchStartTrick: 2,
});
assert.equal(delayedSearchResult.reason, "configured-heuristic-opening");
assert.equal(delayedSearchResult.usedFallback, false, "a configured heuristic opening is a policy choice, not a failure fallback");
assert.equal(delayedSearchResult.samplesUsed, 0);
assert.equal(delayedSearchResult.card.id, delayedSearchResult.fallbackCard.id);

const alternateFallback = legalCandidates.find((candidate) => candidate.id !== firstResult.card.id);
assert.ok(alternateFallback, "fixture has a non-search fallback candidate");
const confidenceGatedResult = evaluateSampledPlayCandidates(game, 0, {
  seed: 20260618,
  samples: 3,
  minSamples: 2,
  sampleBudgetMode: "fixed",
  fallbackCard: alternateFallback,
  openingOverrideMargin: 1_000_000,
});
assert.equal(confidenceGatedResult.card.id, alternateFallback.id, "an uncertain opening override retains the heuristic move");
assert.equal(confidenceGatedResult.reason, "opening-confidence-retained-heuristic");
assert.equal(confidenceGatedResult.profile.heuristicRetentions, 1);

const pairedConfidenceResult = evaluateSampledPlayCandidates(game, 0, {
  seed: 20260618,
  samples: 3,
  minSamples: 2,
  sampleBudgetMode: "fixed",
  fallbackCard: alternateFallback,
  heuristicOverrideZ: 1_000_000,
});
assert.equal(pairedConfidenceResult.card.id, alternateFallback.id, "an imprecise paired advantage retains the heuristic move");
assert.equal(pairedConfidenceResult.reason, "paired-confidence-retained-heuristic");
assert.equal(pairedConfidenceResult.profile.heuristicRetentions, 1);
assert.ok(Number.isFinite(pairedConfidenceResult.pairedHeuristicAdvantage.mean));

const hybridOptions = {
  seed: 20260620,
  samples: 5,
  minSamples: 2,
  sampleBudgetMode: "fixed",
  informationSetIterations: 12,
  informationSetTreePlies: 5,
  informationSetMaxCandidates: 3,
  informationSetTriggerMargin: Number.POSITIVE_INFINITY,
};
const hybridResult = evaluateSampledPlayCandidates(game, 0, hybridOptions);
const repeatedHybridResult = evaluateSampledPlayCandidates(game, 0, hybridOptions);

assert.equal(hybridResult.reason, "information-set-hybrid", "close rollout choices receive an information-set tree tie-break");
assert.equal(hybridResult.profile.informationSetIterations, 12, "fixed-work tree search completes its configured iterations");
assert.ok(hybridResult.profile.informationSetNodes > 0, "information-set search expands shared public-state nodes");
assert.ok(hybridResult.profile.particleWeightTotal > 0, "search profiles the weighted particle population");
assert.equal(hybridResult.card.id, repeatedHybridResult.card.id, "information-set search is deterministic for a fixed seed");
assert.equal(
  hybridResult.candidates.find((candidate) => candidate.card.id === hybridResult.card.id)?.active,
  true,
  "the final choice cannot come from a statistically eliminated candidate",
);

const riskAdjustedResult = evaluateSampledPlayCandidates(game, 0, {
  seed: 20260620,
  samples: 5,
  minSamples: 2,
  sampleBudgetMode: "fixed",
  beliefWeighting: false,
  riskAversion: 0.1,
});
assert.ok(
  riskAdjustedResult.candidates.every(
    (candidate) => candidate.riskPenalty >= 0 && candidate.selectionScore <= candidate.averageScore,
  ),
  "risk-aware aggregation applies only a nonnegative instability penalty",
);

const tacticalResult = evaluateSampledPlayCandidates(game, 0, {
  seed: 20260620,
  samples: 2,
  minSamples: 2,
  sampleBudgetMode: "fixed",
  exactEndgameHandSize: 0,
  trickLookaheadPlies: 2,
  trickLookaheadBranches: 2,
});
assert.equal(tacticalResult.samplesUsed, 2, "bounded trick lookahead preserves the fixed sample budget");
assert.ok(tacticalResult.profile.trickLookaheadCalls > 0, "bounded trick lookahead is exercised before the exact endgame");
assert.ok(tacticalResult.profile.trickLookaheadNodes > tacticalResult.profile.trickLookaheadCalls, "lookahead explores response nodes");
assert.ok(tacticalResult.profile.trickLookaheadLeaves > 0, "lookahead resumes rollout at bounded leaves");

const exactModelBlendResult = evaluateSampledPlayCandidates(game, 0, {
  seed: 20260620,
  samples: 1,
  minSamples: 1,
  sampleBudgetMode: "fixed",
  exactEndgameHandSize: 4,
  exactNodeLimit: 100000,
  exactValueWeight: 0.5,
  exactPureHandSize: 3,
});
assert.ok(exactModelBlendResult.profile.exactCalls > 0, "four-card sampled worlds invoke exact search");
assert.ok(exactModelBlendResult.profile.exactPolicyBlendCalls > 0, "cards four through six blend exact and policy opponent models");
assert.ok(exactModelBlendResult.profile.rolloutCalls > 0, "the blended opponent model evaluates its policy branch");

const positionGatedExactResult = evaluateSampledPlayCandidates(game, 0, {
  seed: 20260620,
  samples: 1,
  minSamples: 1,
  sampleBudgetMode: "fixed",
  exactEndgameHandSize: 4,
  exactNodeLimit: 100000,
  exactMaxHandMinTrickPosition: 1,
  exactMaxHandMaxTrickPosition: 3,
});
assert.equal(positionGatedExactResult.profile.exactCalls, 0, "a lead decision can skip only the maximum exact layer");
assert.ok(positionGatedExactResult.profile.rolloutCalls > 0, "position-gated maximum layer resumes the policy rollout");

const boundedOpponentResult = evaluateSampledPlayCandidates(game, 0, {
  seed: 20260620,
  samples: 1,
  minSamples: 1,
  sampleBudgetMode: "fixed",
  exactEndgameHandSize: 4,
  exactNodeLimit: 100000,
  exactPolicyOrdering: true,
  exactOpponentMaxBranches: 1,
  exactOpponentPureHandSize: 0,
});
assert.ok(boundedOpponentResult.profile.exactOpponentPolicyNodes > 0, "bounded opponent modeling follows its policy branch");

const voidGatedExactResult = evaluateSampledPlayCandidates(game, 0, {
  seed: 20260620,
  samples: 1,
  minSamples: 1,
  sampleBudgetMode: "fixed",
  exactEndgameHandSize: 4,
  exactNodeLimit: 100000,
  exactMaxHandMinKnownVoids: 12,
});
assert.equal(voidGatedExactResult.profile.exactCalls, 0, "maximum exact layer can require sufficient public void evidence");
assert.ok(voidGatedExactResult.profile.rolloutCalls > 0);

const rolloutHandoffResult = evaluateSampledPlayCandidates(game, 0, {
  seed: 20260620,
  samples: 1,
  minSamples: 1,
  sampleBudgetMode: "fixed",
  exactEndgameHandSize: 0,
  rolloutExactHandoffHandSize: 3,
  rolloutExactNodeLimit: 100000,
  exactPolicyOrdering: true,
  exactSequencePruning: true,
});
assert.ok(rolloutHandoffResult.profile.rolloutExactHandoffCalls > 0, "early rollout reaches its exact endgame handoff");
assert.equal(
  rolloutHandoffResult.profile.rolloutExactHandoffCalls,
  rolloutHandoffResult.profile.rolloutExactHandoffSolved,
  "three-card rollout handoffs solve within the fixture budget",
);
assert.ok(rolloutHandoffResult.profile.rolloutExactHandoffNodes > 0);

const blendedTacticalResult = evaluateSampledPlayCandidates(game, 0, {
  seed: 20260620,
  samples: 2,
  minSamples: 2,
  sampleBudgetMode: "fixed",
  exactEndgameHandSize: 0,
  trickLookaheadPlies: 2,
  trickLookaheadBranches: 2,
  trickLookaheadBlend: 0.5,
});
assert.ok(blendedTacticalResult.profile.rolloutCalls > 0, "blended lookahead evaluates the baseline policy value");
assert.equal(blendedTacticalResult.profile.trickLookaheadCalls, tacticalResult.profile.trickLookaheadCalls);

const aggregationCandidates = [
  {
    averageScore: 32.67,
    observations: [
      { sampleIndex: 0, value: 100, weight: 1 },
      { sampleIndex: 1, value: -1, weight: 1 },
      { sampleIndex: 2, value: -1, weight: 1 },
    ],
  },
  {
    averageScore: 0,
    observations: [
      { sampleIndex: 0, value: 0, weight: 1 },
      { sampleIndex: 1, value: 0, weight: 1 },
      { sampleIndex: 2, value: 0, weight: 1 },
    ],
  },
];
applyRootAggregationScores(aggregationCandidates, {
  rootAggregation: "plurality",
  rootCvarFraction: 0.25,
  riskAversion: 0,
});
assert.ok(
  aggregationCandidates[1].selectionScore > aggregationCandidates[0].selectionScore,
  "plurality prefers the move that is best in more hidden worlds over one extreme mean payoff",
);
applyRootAggregationScores(aggregationCandidates, {
  rootAggregation: "cvar",
  rootCvarFraction: 0.25,
  riskAversion: 0,
});
assert.ok(
  aggregationCandidates[1].selectionScore > aggregationCandidates[0].selectionScore,
  "lower-tail aggregation prefers the robust hidden-world result",
);

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

const benchmarkHiddenVariantA = {
  ...hiddenVariantA,
  kitty: [card("Red", 2), card("Red", 3), card("Red", 4), card("Red", 5), card("Red", 6)],
};
const benchmarkHiddenVariantB = {
  ...hiddenVariantB,
  kitty: [card("Black", 2), card("Black", 3), card("Black", 5), card("Black", 10), card("Yellow", 14)],
};
const benchmarkPublicA = createBenchmarkPublicSearchView(benchmarkHiddenVariantA, 0);
const benchmarkPublicB = createBenchmarkPublicSearchView(benchmarkHiddenVariantB, 0);

assert.deepEqual(benchmarkPublicA.kitty, [], "benchmark public search view does not expose kitty cards");
assert.equal(Object.keys(benchmarkPublicA.hands[1]).length, 0, "benchmark public search view hides player 1 cards");
assert.equal(Object.keys(benchmarkPublicA.hands[2]).length, 0, "benchmark public search view hides player 2 cards");
assert.equal(Object.keys(benchmarkPublicA.hands[3]).length, 0, "benchmark public search view hides player 3 cards");
assert.deepEqual(
  benchmarkPublicA.hands.map((hand) => hand.length),
  benchmarkHiddenVariantA.hands.map((hand) => hand.length),
  "benchmark public search view preserves hand lengths",
);

const benchmarkPublicResultA = evaluateSampledPlayCandidates(benchmarkPublicA, 0, variantOptions);
const benchmarkPublicResultB = evaluateSampledPlayCandidates(benchmarkPublicB, 0, variantOptions);

assert.equal(
  benchmarkPublicResultA.card.id,
  benchmarkPublicResultB.card.id,
  "benchmark public search result is stable when hidden hands and kitty are mutated",
);
assert.deepEqual(
  benchmarkPublicResultA.candidates.map((candidate) => [candidate.card.id, candidate.averageScore, candidate.samples]),
  benchmarkPublicResultB.candidates.map((candidate) => [candidate.card.id, candidate.averageScore, candidate.samples]),
  "benchmark public search scores are stable when hidden hands and kitty are mutated",
);

console.log("Search prototype validation passed.");
