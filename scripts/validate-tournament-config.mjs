import assert from "node:assert/strict";
import { LIVE_SEARCH_CONFIG } from "../src/ai/config.js";
import {
  createBenchmarkOptions,
  parseSearchConfigs,
  searchConfigsForEngine,
} from "./ai-tournament.mjs";
import {
  ADVERSARIAL_OPPONENT_LEAGUE,
  CHALLENGER_ENGINE_ID,
  CHAMPION_ENGINE_ID,
  OLD_BASELINE_ENGINE_ID,
  PREVIOUS_CHAMPION_ENGINE_ID,
  SEARCH_V3_ABLATION_ENGINE_ID,
  createBenchmarkStrategies,
  expandOpponentEngineIds,
  getBenchmarkEngine,
} from "./ai-engines.mjs";
import { getBenchmarkMetrics, parseBenchmarkArgs, simulateBenchmarkRange } from "./ai-benchmark-sim.mjs";

const defaultConfigs = parseSearchConfigs([]);
assert.equal(defaultConfigs.length, 1, "tournaments default to one shipped profile");
assert.equal(defaultConfigs[0].label, LIVE_SEARCH_CONFIG.label, "tournaments default to the live challenger profile");
assert.equal(defaultConfigs[0].sampleBudgetMode, "fixed", "default tournament challenger uses fixed-work sampling");
assert.equal(defaultConfigs[0].exactEndgameHandSize, 6, "live challenger solves sampled six-card endgames");
assert.equal(defaultConfigs[0].rolloutExactHandoffHandSize, 3, "live challenger hands sampled rollouts to exact play at three cards");
assert.equal(defaultConfigs[0].rolloutExactNodeLimit, 10000, "live rollout handoff has a bounded exact-search budget");

const ablatedConfig = parseSearchConfigs([
  "--no-belief-weighting",
  "--no-adaptive-sampling",
  "--no-information-set",
])[0];
assert.equal(ablatedConfig.beliefWeighting, false, "tournament CLI can ablate posterior weighting");
assert.equal(ablatedConfig.adaptiveSampling, false, "tournament CLI can ablate adaptive racing");
assert.equal(ablatedConfig.informationSetIterations, 0, "tournament CLI can ablate information-set search");

const experimentConfigs = parseSearchConfigs([
  "--search-configs=compat-v2,match-only,belief-only,adaptive-only,information-only,exact-4,exact-5,exact-6,exact-5-info,exact-4-info,exact-5-64,exact-5-node-5k,exact-5-node-10k,samples-64",
]);
assert.deepEqual(
  experimentConfigs.map((config) => config.label),
  [
    "compat-v2",
    "match-only",
    "belief-only",
    "adaptive-only",
    "information-only",
    "exact-4",
    "exact-5",
    "exact-6",
    "exact-5-info",
    "exact-4-info",
    "exact-5-64",
    "exact-5-node-5k",
    "exact-5-node-10k",
    "samples-64",
  ],
  "training-only one-factor profiles are addressable by stable names",
);
assert.equal(experimentConfigs[0].beliefWeighting, false, "compatibility control disables posterior weighting");
assert.equal(experimentConfigs[0].evaluation.matchWinReward, 0, "compatibility control neutralizes match utility");
assert.equal(experimentConfigs[1].evaluation.matchWinReward, 1200, "match-only restores match utility");
assert.equal(experimentConfigs[2].beliefWeighting, true, "belief-only isolates posterior weighting");
assert.equal(experimentConfigs[3].adaptiveSampling, true, "adaptive-only isolates sample racing");
assert.equal(experimentConfigs[4].informationSetIterations, 36, "information-only isolates the tie-break tree");
assert.equal(experimentConfigs[5].exactEndgameHandSize, 4, "exact-4 expands solved endgames by one card");
assert.equal(experimentConfigs[6].exactEndgameHandSize, 5, "exact-5 expands solved endgames by two cards");
assert.equal(experimentConfigs[7].exactEndgameHandSize, 6, "exact-6 probes one additional trick boundary");
assert.equal(experimentConfigs[8].informationSetIterations, 36, "exact-5-info combines the strongest isolated profiles");
assert.equal(experimentConfigs[9].exactEndgameHandSize, 4, "exact-4-info keeps the cheaper exact-search boundary");
assert.equal(experimentConfigs[10].samples, 64, "exact-5-64 doubles particles at the five-card boundary");
assert.equal(experimentConfigs[11].exactNodeLimit, 5000, "the 5k profile probes an economical exact-search cap");
assert.equal(experimentConfigs[12].exactNodeLimit, 10000, "the 10k profile probes a balanced exact-search cap");
assert.equal(experimentConfigs[13].samples, 64, "samples-64 doubles the determinization budget");

const searchAblation = getBenchmarkEngine(SEARCH_V3_ABLATION_ENGINE_ID);
assert.equal(
  searchConfigsForEngine(searchAblation, experimentConfigs).length,
  experimentConfigs.length,
  "the search-only diagnostic engine accepts experimental profiles",
);

const tunedBenchmark = parseBenchmarkArgs([
  "--mode=quick",
  "--profile=live",
  "--candidate=challenger",
  "--search-adaptive-min-samples=9",
  "--search-information-iterations=17",
  "--search-information-blend=0.35",
  "--search-rollout-exact-handoff=4",
  "--search-rollout-exact-nodes=4321",
  "--exact-policy-ordering",
  "--exact-sequence-pruning",
]);
assert.equal(tunedBenchmark.search.adaptiveMinSamples, 9, "benchmark CLI exposes the adaptive sample floor");
assert.equal(tunedBenchmark.search.informationSetIterations, 17, "benchmark CLI exposes tree iterations");
assert.equal(tunedBenchmark.search.informationSetBlend, 0.35, "benchmark CLI exposes rollout/tree blending");
assert.equal(tunedBenchmark.search.rolloutExactHandoffHandSize, 4, "benchmark CLI exposes rollout exact handoff");
assert.equal(tunedBenchmark.search.rolloutExactNodeLimit, 4321, "benchmark CLI exposes rollout exact node limits");
assert.equal(tunedBenchmark.search.exactPolicyOrdering, true, "benchmark CLI exposes exact policy ordering");
assert.equal(tunedBenchmark.search.exactSequencePruning, true, "benchmark CLI exposes exact sequence pruning");

const previousChampion = getBenchmarkEngine(PREVIOUS_CHAMPION_ENGINE_ID);
const previousConfigs = searchConfigsForEngine(previousChampion, defaultConfigs);
assert.equal(previousConfigs.length, 1, "a frozen engine uses one frozen profile");
assert.equal(
  previousConfigs[0].label,
  previousChampion.liveSearchConfig.label,
  "a frozen engine is not assigned the moving challenger's config",
);
assert.equal(previousConfigs[0].samples, 3, "the July champion retains its shipped three-sample live profile");

const options = createBenchmarkOptions({
  candidateEngineId: CHALLENGER_ENGINE_ID,
  opponentEngineId: CHAMPION_ENGINE_ID,
  search: defaultConfigs[0],
  gamesPerSide: 1,
});
assert.equal(options.searchProfile, "live", "tournament benchmarks identify the shipped profile");
assert.equal(options.deterministicSearch, true, "tournament evidence uses deterministic fixed work");
assert.equal(options.engineSearchConfigs.candidate.samples, 32, "candidate override applies to the candidate side");
assert.equal(
  Object.hasOwn(options.engineSearchConfigs, "baseline"),
  false,
  "the opponent resolves its own frozen live profile",
);

const mustWinOptions = createBenchmarkOptions({
  candidateEngineId: CHALLENGER_ENGINE_ID,
  opponentEngineId: CHAMPION_ENGINE_ID,
  search: defaultConfigs[0],
  gamesPerSide: 1,
  mustWinByBid: true,
});
assert.equal(mustWinOptions.mustWinByBid, true, "rule-variant tournaments propagate must-win-by-bid into game state");
assert.deepEqual(
  expandOpponentEngineIds("adversarial-league"),
  [...ADVERSARIAL_OPPONENT_LEAGUE],
  "the adversarial league expands to all frozen exploitability probes",
);

for (const [probeIndex, probeEngineId] of ADVERSARIAL_OPPONENT_LEAGUE.entries()) {
  const probeOptions = createBenchmarkOptions({
    candidateEngineId: OLD_BASELINE_ENGINE_ID,
    opponentEngineId: probeEngineId,
    search: defaultConfigs[0],
    gamesPerSide: 1,
  });
  const total = simulateBenchmarkRange({
    gamesPerSide: 1,
    seed: 20260811 + probeIndex * 101,
    strategies: createBenchmarkStrategies({ candidate: OLD_BASELINE_ENGINE_ID, opponent: probeEngineId }),
    options: probeOptions,
  });
  const metrics = getBenchmarkMetrics(total);
  assert.equal(metrics.games, 2, `${probeEngineId}: mirrored smoke run completes`);
  assert.equal(metrics.illegalMoves, 0, `${probeEngineId}: probe emits only legal bids, discards, and plays`);
}

console.log("Tournament search-profile validation passed.");
