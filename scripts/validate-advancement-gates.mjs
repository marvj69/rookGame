import assert from "node:assert/strict";
import { ADVANCEMENT_GATES, evaluateAdvancementGate } from "./ai-advancement-gates.mjs";
import { CHALLENGER_ENGINE_ID, CHAMPION_ENGINE_ID } from "./ai-engines.mjs";
import {
  deterministicClusterBootstrapInterval,
  eloDeltaFromScore,
  wilsonScoreInterval,
} from "./ai-statistics.mjs";

function metrics(overrides = {}) {
  return {
    games: 800,
    wins: 600,
    winRate: 0.75,
    averageMargin: 100,
    candidateBidMakeRate: 0.7,
    baselineBidMakeRate: 0.6,
    illegalMoves: 0,
    illegalBids: 0,
    illegalDiscards: 0,
    illegalPlays: 0,
    unfinishedGames: 0,
    ...overrides,
  };
}

function promotionReport(metricOverrides = {}, reportOverrides = {}) {
  return evaluateAdvancementGate({
    metrics: metrics(metricOverrides),
    gate: ADVANCEMENT_GATES.promotion,
    mode: "full",
    candidateEngineId: CHALLENGER_ENGINE_ID,
    opponentEngineId: CHAMPION_ENGINE_ID,
    searchProfile: "live",
    deterministicSearch: true,
    ...reportOverrides,
  });
}

const symmetricInterval = wilsonScoreInterval(50, 100);
assert.ok(symmetricInterval.low < 0.5 && symmetricInterval.high > 0.5, "Wilson interval contains the observed rate");
assert.equal(Math.round(eloDeltaFromScore(0.5)), 0, "an even score has zero Elo delta");
assert.ok(eloDeltaFromScore(0.75) > 190, "a 75% score produces a large positive Elo delta");

const pairedBootstrap = deterministicClusterBootstrapInterval([0, 0.5, 1, 1], {
  replicates: 1000,
  seed: 20260811,
});
const repeatedBootstrap = deterministicClusterBootstrapInterval([0, 0.5, 1, 1], {
  replicates: 1000,
  seed: 20260811,
});
assert.deepEqual(pairedBootstrap, repeatedBootstrap, "paired bootstrap intervals are reproducible");
assert.ok(
  pairedBootstrap.low <= 0.625 && pairedBootstrap.high >= 0.625,
  "paired bootstrap interval contains the observed cluster mean",
);

assert.equal(promotionReport().passed, true, "a statistically strong, legal live run passes promotion");
assert.equal(
  promotionReport({ games: 799, wins: 599, winRate: 599 / 799 }).checks.find((check) => check.id === "sample-size").passed,
  false,
  "promotion rejects undersized runs",
);
assert.equal(
  promotionReport({}, { searchProfile: "benchmark" }).checks.find((check) => check.id === "search-profile").passed,
  false,
  "promotion rejects a non-shipped search profile",
);
assert.equal(
  promotionReport({}, { deterministicSearch: false }).checks.find((check) => check.id === "deterministic-search").passed,
  false,
  "promotion rejects wall-clock-dependent strength evidence",
);
assert.equal(
  promotionReport({ illegalMoves: 1, illegalPlays: 1 }).checks.find((check) => check.id === "legality").passed,
  false,
  "any illegal decision fails promotion",
);
assert.equal(
  promotionReport({ unfinishedGames: 1 }).checks.find((check) => check.id === "completed-games").passed,
  false,
  "a safety-capped match cannot count as promotion evidence",
);
assert.equal(
  promotionReport({ conservativeWinRateLow95: 0.51, conservativeWinRateHigh95: 0.82 }).checks.find(
    (check) => check.id === "win-rate-confidence",
  ).passed,
  false,
  "promotion uses the conservative paired or seed-cluster interval when available",
);

const marginalConsideration = evaluateAdvancementGate({
  metrics: metrics({ games: 200, wins: 110, winRate: 0.55 }),
  gate: ADVANCEMENT_GATES.consideration,
  mode: "standard",
  candidateEngineId: CHALLENGER_ENGINE_ID,
  opponentEngineId: CHAMPION_ENGINE_ID,
  searchProfile: "live",
  deterministicSearch: true,
});
assert.equal(
  marginalConsideration.checks.find((check) => check.id === "win-rate").passed,
  true,
  "the point estimate can meet the threshold",
);
assert.equal(
  marginalConsideration.checks.find((check) => check.id === "win-rate-confidence").passed,
  false,
  "the confidence gate rejects a noisy threshold-edge result",
);

console.log("Advancement gate and statistics validation passed.");
