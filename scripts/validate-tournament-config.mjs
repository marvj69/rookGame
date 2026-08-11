import assert from "node:assert/strict";
import { LIVE_SEARCH_CONFIG } from "../src/ai/config.js";
import {
  createBenchmarkOptions,
  parseSearchConfigs,
  searchConfigsForEngine,
} from "./ai-tournament.mjs";
import {
  CHALLENGER_ENGINE_ID,
  CHAMPION_ENGINE_ID,
  PREVIOUS_CHAMPION_ENGINE_ID,
  getBenchmarkEngine,
} from "./ai-engines.mjs";

const defaultConfigs = parseSearchConfigs([]);
assert.equal(defaultConfigs.length, 1, "tournaments default to one shipped profile");
assert.equal(defaultConfigs[0].label, LIVE_SEARCH_CONFIG.label, "tournaments default to the live challenger profile");
assert.equal(defaultConfigs[0].sampleBudgetMode, "fixed", "default tournament challenger uses fixed-work sampling");

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

console.log("Tournament search-profile validation passed.");
