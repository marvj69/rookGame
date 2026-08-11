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
export { evaluateExactPlayCandidates, evaluateSampledPlayCandidates, getLegalPlayCandidates } from "./search.js";
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
  id: "champion-2026-08-11",
  name: "Strong Search Champion v2 2026-08-11",
  sourceCommit: null,
  sourceState: "Promotion-qualified worktree snapshot; source is frozen in this module.",
  sourceFingerprint: "458c338795292fdd1c4c2537d5416a1252f22c5789b0508d47b5cbd90b9ea129",
  snapshotDate: "2026-08-11",
  modulePath: "scripts/champions/strong-search-2026-08-11.mjs",
  defaultSearchConfig: DEFAULT_SEARCH_CONFIG,
  liveSearchConfig: LIVE_SEARCH_CONFIG,
  validationCommands: Object.freeze([
    "npm test",
    "npm run build",
    "npm run ai:benchmark -- --mode=quick --profile=live --candidate=challenger --opponent=champion-2026-08-11 --parallel --seed=20260811",
    "npm run ai:benchmark -- --mode=standard --profile=live --candidate=challenger --opponent=champion-2026-08-11 --gate=consideration --parallel --seed=20260811",
    "npm run ai:benchmark:acceptance -- --profile=live --candidate=challenger --opponent=champion-2026-08-11 --gate=promotion --workers=auto",
    "ROOK_PRIVATE_HOLDOUT_FILE=/absolute/path/to/fresh-seeds.txt npm run ai:holdout -- --candidate=challenger --opponent=champion-2026-08-11 --gate=promotion --workers=auto --strict",
    "npm run test:browser",
  ]),
  promotionEvidence: Object.freeze({
    comparisonChampion: "champion-2026-07-02",
    publicValidation: "178/200 (89.0%), +470.6 average margin, 0 illegal moves",
    broadPromotion: "720/800 (90.0%), +476.2 average margin, 0 illegal moves",
    privateHoldout: "732/800 (91.5%), +500.0 average margin, 0 illegal moves",
    privateHoldoutWilson95: "89.4%-93.2%",
    approximateEloDelta: 413,
    seedCommitment: "fb5ff0acb3803fcb7dbc2c0a6e5250bbdc1f64f3b1385925c92cf6d33049c5f7",
    browserReliability: "normal and 4x-throttled: 39/39 completions, 0 fallbacks/timeouts/errors; forced-timeout: 39/39 legal fallbacks",
  }),
  knownLimitations: Object.freeze([
    "Bidding and kitty selection remain heuristic; the measured promotion gain comes primarily from stronger play search.",
    "No result in this repository establishes superiority over elite human Rook players.",
    "The exact endgame fixtures are engineered oracle cases, not labels supplied by an external human expert.",
  ]),
});

export default Object.freeze({
  championMetadata,
});
