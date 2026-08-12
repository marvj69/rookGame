import * as challengerAi from "../src/ai.js";
import {
  DEFAULT_SEARCH_CONFIG as CHALLENGER_DEFAULT_SEARCH_CONFIG,
  LIVE_SEARCH_CONFIG as CHALLENGER_LIVE_SEARCH_CONFIG,
} from "../src/ai/config.js";
import { evaluateSampledPlayCandidates as evaluateChallengerSearch } from "../src/ai/search.js";
import * as oldBaselineAi from "./current-ai-baseline.mjs";
import * as previousChampionAi from "./champions/strong-search-2026-07-02.mjs";
import * as championAi from "./champions/strong-search-2026-08-11.mjs";
import { conservativeProbeAi, pointHunterProbeAi, pressureProbeAi } from "./adversarial-ai.mjs";

export const CHALLENGER_ENGINE_ID = "challenger";
export const CURRENT_ENGINE_ID = "current";
export const OLD_BASELINE_ENGINE_ID = "old-baseline";
export const PREVIOUS_CHAMPION_ENGINE_ID = previousChampionAi.championMetadata.id;
export const CHAMPION_ENGINE_ID = championAi.championMetadata.id;
export const PRESSURE_PROBE_ENGINE_ID = "probe-pressure";
export const CONSERVATIVE_PROBE_ENGINE_ID = "probe-conservative";
export const POINT_HUNTER_PROBE_ENGINE_ID = "probe-point-hunter";
export const SEARCH_V3_ABLATION_ENGINE_ID = "ablation-search-v3";
export const AUCTION_KITTY_V3_ABLATION_ENGINE_ID = "ablation-auction-kitty-v3";
export const FROZEN_OPPONENT_LEAGUE = Object.freeze([
  OLD_BASELINE_ENGINE_ID,
  PREVIOUS_CHAMPION_ENGINE_ID,
  CHAMPION_ENGINE_ID,
]);
export const ADVERSARIAL_OPPONENT_LEAGUE = Object.freeze([
  PRESSURE_PROBE_ENGINE_ID,
  CONSERVATIVE_PROBE_ENGINE_ID,
  POINT_HUNTER_PROBE_ENGINE_ID,
]);

const ENGINE_DEFINITIONS = Object.freeze({
  [CHALLENGER_ENGINE_ID]: Object.freeze({
    id: CHALLENGER_ENGINE_ID,
    name: "Challenger (moving Strong/search AI)",
    ai: challengerAi,
    evaluateSearch: evaluateChallengerSearch,
    usesSearch: true,
    defaultSearchConfig: CHALLENGER_DEFAULT_SEARCH_CONFIG,
    liveSearchConfig: CHALLENGER_LIVE_SEARCH_CONFIG,
  }),
  [CURRENT_ENGINE_ID]: Object.freeze({
    id: CURRENT_ENGINE_ID,
    name: "Current moving heuristic AI",
    ai: challengerAi,
    evaluateSearch: null,
    usesSearch: false,
  }),
  [OLD_BASELINE_ENGINE_ID]: Object.freeze({
    id: OLD_BASELINE_ENGINE_ID,
    name: "Old frozen baseline AI",
    ai: oldBaselineAi,
    evaluateSearch: null,
    usesSearch: false,
  }),
  [PREVIOUS_CHAMPION_ENGINE_ID]: Object.freeze({
    id: PREVIOUS_CHAMPION_ENGINE_ID,
    name: previousChampionAi.championMetadata.name,
    ai: previousChampionAi,
    evaluateSearch: previousChampionAi.evaluateSampledPlayCandidates,
    usesSearch: true,
    defaultSearchConfig: previousChampionAi.championMetadata.defaultSearchConfig,
    liveSearchConfig: previousChampionAi.championMetadata.liveSearchConfig,
    metadata: previousChampionAi.championMetadata,
  }),
  [CHAMPION_ENGINE_ID]: Object.freeze({
    id: CHAMPION_ENGINE_ID,
    name: championAi.championMetadata.name,
    ai: championAi,
    evaluateSearch: championAi.evaluateSampledPlayCandidates,
    usesSearch: true,
    defaultSearchConfig: championAi.championMetadata.defaultSearchConfig,
    liveSearchConfig: championAi.championMetadata.liveSearchConfig,
    metadata: championAi.championMetadata,
  }),
  [PRESSURE_PROBE_ENGINE_ID]: Object.freeze({
    id: PRESSURE_PROBE_ENGINE_ID,
    name: "Auction and trump pressure probe",
    ai: pressureProbeAi,
    evaluateSearch: null,
    usesSearch: false,
  }),
  [CONSERVATIVE_PROBE_ENGINE_ID]: Object.freeze({
    id: CONSERVATIVE_PROBE_ENGINE_ID,
    name: "Conservative control probe",
    ai: conservativeProbeAi,
    evaluateSearch: null,
    usesSearch: false,
  }),
  [POINT_HUNTER_PROBE_ENGINE_ID]: Object.freeze({
    id: POINT_HUNTER_PROBE_ENGINE_ID,
    name: "Point-capture probe",
    ai: pointHunterProbeAi,
    evaluateSearch: null,
    usesSearch: false,
  }),
  [SEARCH_V3_ABLATION_ENGINE_ID]: Object.freeze({
    id: SEARCH_V3_ABLATION_ENGINE_ID,
    name: "Ablation: v3 search with frozen champion auction and kitty",
    ai: Object.freeze({
      chooseBotBid: championAi.chooseBotBid,
      chooseBotKittyPlan: championAi.chooseBotKittyPlan,
      chooseBotPlay: challengerAi.chooseBotPlay,
    }),
    evaluateSearch: evaluateChallengerSearch,
    usesSearch: true,
    defaultSearchConfig: CHALLENGER_DEFAULT_SEARCH_CONFIG,
    liveSearchConfig: CHALLENGER_LIVE_SEARCH_CONFIG,
  }),
  [AUCTION_KITTY_V3_ABLATION_ENGINE_ID]: Object.freeze({
    id: AUCTION_KITTY_V3_ABLATION_ENGINE_ID,
    name: "Ablation: v3 auction and kitty with frozen champion search",
    ai: challengerAi,
    evaluateSearch: championAi.evaluateSampledPlayCandidates,
    usesSearch: true,
    defaultSearchConfig: championAi.championMetadata.defaultSearchConfig,
    liveSearchConfig: championAi.championMetadata.liveSearchConfig,
  }),
});

const ENGINE_ALIASES = Object.freeze({
  baseline: OLD_BASELINE_ENGINE_ID,
  "old-baseline": OLD_BASELINE_ENGINE_ID,
  legacy: OLD_BASELINE_ENGINE_ID,
  old: OLD_BASELINE_ENGINE_ID,
  current: CURRENT_ENGINE_ID,
  fast: CURRENT_ENGINE_ID,
  "current-fast": CURRENT_ENGINE_ID,
  candidate: CHALLENGER_ENGINE_ID,
  challenger: CHALLENGER_ENGINE_ID,
  search: CHALLENGER_ENGINE_ID,
  strong: CHALLENGER_ENGINE_ID,
  "moving-search": CHALLENGER_ENGINE_ID,
  champion: CHAMPION_ENGINE_ID,
  "current-champion": CHAMPION_ENGINE_ID,
  "previous-champion": PREVIOUS_CHAMPION_ENGINE_ID,
  "strong-search-2026-07-02": PREVIOUS_CHAMPION_ENGINE_ID,
  [PREVIOUS_CHAMPION_ENGINE_ID]: PREVIOUS_CHAMPION_ENGINE_ID,
  "strong-search-2026-08-11": CHAMPION_ENGINE_ID,
  [CHAMPION_ENGINE_ID]: CHAMPION_ENGINE_ID,
  pressure: PRESSURE_PROBE_ENGINE_ID,
  conservative: CONSERVATIVE_PROBE_ENGINE_ID,
  "point-hunter": POINT_HUNTER_PROBE_ENGINE_ID,
  "search-v3-only": SEARCH_V3_ABLATION_ENGINE_ID,
  "auction-kitty-v3-only": AUCTION_KITTY_V3_ABLATION_ENGINE_ID,
});

export function listBenchmarkEngineIds() {
  return Object.keys(ENGINE_DEFINITIONS);
}

export function supportedEngineMessage() {
  return listBenchmarkEngineIds().join(", ");
}

export function resolveEngineId(spec) {
  const normalized = String(spec ?? "").trim();
  if (!normalized) {
    throw new Error(`Missing benchmark engine. Supported engines: ${supportedEngineMessage()}.`);
  }

  const key = normalized.toLowerCase();
  const engineId = ENGINE_ALIASES[key] ?? normalized;
  if (!ENGINE_DEFINITIONS[engineId]) {
    throw new Error(`Unsupported benchmark engine "${spec}". Supported engines: ${supportedEngineMessage()}.`);
  }

  return engineId;
}

export function getBenchmarkEngine(spec) {
  return ENGINE_DEFINITIONS[resolveEngineId(spec)];
}

export function createBenchmarkStrategies({ candidate, opponent }) {
  return {
    candidateEngine: getBenchmarkEngine(candidate),
    baselineEngine: getBenchmarkEngine(opponent),
  };
}

export function expandOpponentEngineIds(rawValue, { includeBothBaselines = false } = {}) {
  const value = rawValue ?? CHAMPION_ENGINE_ID;
  const normalized = String(value).trim().toLowerCase();

  if (["league", "frozen-league", "all", "all-baselines"].includes(normalized)) {
    return [...FROZEN_OPPONENT_LEAGUE];
  }
  if (["adversarial", "adversarial-league", "probes"].includes(normalized)) {
    return [...ADVERSARIAL_OPPONENT_LEAGUE];
  }
  if (["robust-league", "full-league"].includes(normalized)) {
    return [...FROZEN_OPPONENT_LEAGUE, ...ADVERSARIAL_OPPONENT_LEAGUE];
  }
  if (includeBothBaselines || ["both", "both-baselines"].includes(normalized)) {
    return [OLD_BASELINE_ENGINE_ID, CHAMPION_ENGINE_ID];
  }

  return String(value)
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .map(resolveEngineId);
}
