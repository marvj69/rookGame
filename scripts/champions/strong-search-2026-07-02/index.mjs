import { DEFAULT_SEARCH_CONFIG, LIVE_SEARCH_CONFIG } from "./config.js";

export { chooseBotBid, chooseBotKittyPlan, chooseBotPlay, describeAiHandStrength } from "./heuristics.js";
export {
  DEFAULT_EVALUATION_WEIGHTS,
  DEFAULT_SEARCH_CONFIG,
  LIVE_SEARCH_CONFIG,
  NAMED_SEARCH_CONFIGS,
  normalizeEvaluationWeights,
  normalizeSearchConfig,
} from "./config.js";
export {
  evaluateRoundState,
  evaluateTerminalRound,
  evaluateTrickDecision,
  getBidContext,
  getCardSpendCost,
  getTrickPoints,
  getWinningPlay,
  resolveTrickResult,
} from "./evaluation.js";
export { inferPublicBelief, sampleHiddenHands, validateSampledHiddenHands } from "./belief.js";
export { evaluateSampledPlayCandidates, getLegalPlayCandidates } from "./search.js";
export {
  AI_STRENGTH_FAST,
  AI_STRENGTH_STRONG,
  STRONG_AI_RESPONSE_TIMEOUT_MS,
  STRONG_AI_TIMEOUT_STORAGE_KEY,
  createPublicSearchView,
  createStrongAiWorker,
  deriveStrongAiSeed,
  getStrongAiResponseTimeoutMs,
  normalizeAiStrength,
} from "./liveSearch.js";

export const championMetadata = Object.freeze({
  id: "champion-2026-07-02",
  name: "Strong Search Champion 2026-07-02",
  sourceCommit: "5a0dbcd",
  sourceCommitSubject: "Complete superhuman AI TODOs",
  snapshotDate: "2026-07-02",
  modulePath: "scripts/champions/strong-search-2026-07-02.mjs",
  defaultSearchConfig: DEFAULT_SEARCH_CONFIG,
  liveSearchConfig: LIVE_SEARCH_CONFIG,
  validationCommands: Object.freeze([
    "npm test",
    "npm run build",
    "npm run ai:benchmark -- --mode=quick --candidate=challenger --opponent=champion-2026-07-02 --parallel --seed=20260702",
    "npm run ai:benchmark -- --mode=standard --candidate=challenger --opponent=champion-2026-07-02 --gate=consideration --parallel --seed=20260702",
    "npm run ai:benchmark:acceptance -- --candidate=challenger --opponent=champion-2026-07-02 --gate=promotion --workers=auto",
    "npm run ai:tournament -- --seeds=20260618-20260620 --games=20 --candidates=champion-2026-07-02,challenger --opponent=champion-2026-07-02 --workers=auto --no-json",
    "npm run ai:browser-reliability -- --games=1 --hands=1 --no-json",
  ]),
  knownEvidence: Object.freeze({
    oldBaselineFastWinRate: "226/400 (56.5%)",
    oldBaselineFastAverageMargin: 78.6,
    oldBaselineStrongWinRate: "271/400 (67.8%)",
    oldBaselineStrongAverageMargin: 172.5,
    threeSeedStrongTournamentWinRate: "89/120 (74.2%)",
    threeSeedStrongTournamentAverageMargin: 215.8,
    browserReliability: "39/39 search completions, 0 fallbacks, 0 timeouts, 0 illegal/stale/worker errors",
  }),
});

export default Object.freeze({
  championMetadata,
});
