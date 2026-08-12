export const DEFAULT_EVALUATION_WEIGHTS = Object.freeze({
  terminalEv: 1,
  bidMadeStateReward: 45,
  bidNeedPenalty: 0.7,
  setStateReward: 90,
  cardPointSpend: 0.5,
  trumpBaseSpend: 3,
  trumpHighSpend: 2.4,
  aceSpend: 2.5,
  kingSpend: 1.4,
  ownTrickPointReward: 1.2,
  opponentTrickPointPenalty: 1.2,
  bidTeamPointReward: 1.3,
  bidTeamPointPenalty: 1.6,
  bidderLosePointPenalty: 1.4,
  defenderSetPointReward: 1.4,
  trickMakesBidReward: 85,
  trickSetsBidReward: 110,
  matchWinReward: 1200,
  matchLeadReward: 160,
  matchLeadScale: 140,
  matchPressureStart: 0.55,
  mustWinBidPressure: 120,
});

export const DEFAULT_SEARCH_CONFIG = Object.freeze({
  label: "default",
  timeLimitMs: 30,
  samples: 8,
  minSamples: 1,
  maxSampleAttempts: 40,
  hiddenHandSampler: "greedy",
  seed: 9001,
  exactEndgameHandSize: 3,
  exactNodeLimit: 20000,
  exactPolicyOrdering: false,
  exactSequencePruning: false,
  exactValueWeight: 1,
  exactPureHandSize: 3,
  exactMaxHandMinTrickPosition: 0,
  exactMaxHandMaxTrickPosition: 3,
  exactOpponentMaxBranches: 0,
  exactOpponentPureHandSize: 3,
  exactMaxHandMinKnownVoids: 0,
  trickLookaheadPlies: 0,
  trickLookaheadBranches: 2,
  trickLookaheadBlend: 1,
  searchStartTrick: 0,
  openingOverrideMargin: 0,
  heuristicOverrideMargin: 0,
  heuristicOverrideZ: 0,
  rolloutMaxHandSize: Number.POSITIVE_INFINITY,
  rolloutExactHandoffHandSize: 0,
  rolloutExactNodeLimit: 10000,
  earlyStopLead: null,
  sampleBudgetMode: "deadline",
  beliefWeighting: true,
  adaptiveSampling: false,
  adaptiveMinSamples: 8,
  adaptiveConfidenceZ: 1.4,
  adaptiveScoreMargin: 18,
  informationSetIterations: 0,
  informationSetTreePlies: 6,
  informationSetMaxCandidates: 3,
  informationSetTriggerMargin: 35,
  informationSetExploration: 70,
  informationSetBlend: 0.2,
  riskAversion: 0,
  rootAggregation: "mean",
  rootCvarFraction: 0.25,
  evaluation: DEFAULT_EVALUATION_WEIGHTS,
});

export const LIVE_SEARCH_CONFIG = Object.freeze({
  ...DEFAULT_SEARCH_CONFIG,
  label: "live-challenger-v6-exact-6-rollout-3",
  timeLimitMs: 120,
  samples: 32,
  minSamples: 1,
  maxSampleAttempts: 128,
  exactEndgameHandSize: 6,
  exactNodeLimit: 10000,
  exactPolicyOrdering: true,
  exactSequencePruning: true,
  rolloutExactHandoffHandSize: 3,
  rolloutExactNodeLimit: 10000,
  rolloutMaxHandSize: Number.POSITIVE_INFINITY,
  earlyStopLead: null,
  sampleBudgetMode: "fixed",
  beliefWeighting: false,
  adaptiveSampling: false,
  adaptiveMinSamples: 12,
  adaptiveConfidenceZ: 1.4,
  adaptiveScoreMargin: 18,
  informationSetIterations: 0,
  informationSetTreePlies: 6,
  informationSetMaxCandidates: 3,
  informationSetTriggerMargin: 35,
  informationSetExploration: 70,
  informationSetBlend: 0.2,
  evaluation: Object.freeze({
    ...DEFAULT_EVALUATION_WEIGHTS,
    matchWinReward: 0,
    matchLeadReward: 0,
    mustWinBidPressure: 0,
  }),
});

export const NAMED_SEARCH_CONFIGS = Object.freeze({
  fast: Object.freeze({
    ...DEFAULT_SEARCH_CONFIG,
    label: "fast",
    timeLimitMs: 15,
    samples: 4,
  }),
  default: DEFAULT_SEARCH_CONFIG,
});

export function normalizeEvaluationWeights(overrides = {}) {
  return {
    ...DEFAULT_EVALUATION_WEIGHTS,
    ...(overrides ?? {}),
  };
}

export function normalizeSearchConfig(overrides = {}) {
  const base = DEFAULT_SEARCH_CONFIG;
  const next = {
    ...base,
    ...(overrides ?? {}),
  };

  return {
    ...next,
    hiddenHandSampler: ["matching", "stratified"].includes(next.hiddenHandSampler)
      ? next.hiddenHandSampler
      : "greedy",
    beliefWeighting: next.beliefWeighting !== false,
    exactPolicyOrdering: Boolean(next.exactPolicyOrdering),
    exactSequencePruning: Boolean(next.exactSequencePruning),
    exactValueWeight: Math.max(
      0,
      Math.min(1, Number.isFinite(Number(next.exactValueWeight)) ? Number(next.exactValueWeight) : base.exactValueWeight),
    ),
    exactPureHandSize: Math.max(0, Math.min(13, Math.floor(Number(next.exactPureHandSize) || 0))),
    exactMaxHandMinTrickPosition: Math.max(
      0,
      Math.min(3, Math.floor(Number(next.exactMaxHandMinTrickPosition) || 0)),
    ),
    exactMaxHandMaxTrickPosition: Math.max(
      0,
      Math.min(
        3,
        Number.isFinite(Number(next.exactMaxHandMaxTrickPosition))
          ? Math.floor(Number(next.exactMaxHandMaxTrickPosition))
          : base.exactMaxHandMaxTrickPosition,
      ),
    ),
    exactOpponentMaxBranches: Math.max(0, Math.min(13, Math.floor(Number(next.exactOpponentMaxBranches) || 0))),
    exactOpponentPureHandSize: Math.max(0, Math.min(13, Math.floor(Number(next.exactOpponentPureHandSize) || 0))),
    exactMaxHandMinKnownVoids: Math.max(0, Math.min(12, Math.floor(Number(next.exactMaxHandMinKnownVoids) || 0))),
    rolloutExactHandoffHandSize: Math.max(
      0,
      Math.min(13, Math.floor(Number(next.rolloutExactHandoffHandSize) || 0)),
    ),
    rolloutExactNodeLimit: Math.max(1, Math.floor(Number(next.rolloutExactNodeLimit) || base.rolloutExactNodeLimit)),
    trickLookaheadPlies: Math.max(0, Math.min(3, Math.floor(Number(next.trickLookaheadPlies) || 0))),
    trickLookaheadBranches: Math.max(1, Math.min(8, Math.floor(Number(next.trickLookaheadBranches) || 1))),
    trickLookaheadBlend: Math.max(
      0,
      Math.min(1, Number.isFinite(Number(next.trickLookaheadBlend)) ? Number(next.trickLookaheadBlend) : base.trickLookaheadBlend),
    ),
    searchStartTrick: Math.max(0, Math.min(13, Math.floor(Number(next.searchStartTrick) || 0))),
    openingOverrideMargin: Math.max(0, Number(next.openingOverrideMargin) || 0),
    heuristicOverrideMargin: Math.max(0, Number(next.heuristicOverrideMargin) || 0),
    heuristicOverrideZ: Math.max(0, Number(next.heuristicOverrideZ) || 0),
    adaptiveSampling: Boolean(next.adaptiveSampling),
    adaptiveMinSamples: Math.max(1, Math.floor(Number(next.adaptiveMinSamples) || base.adaptiveMinSamples)),
    adaptiveConfidenceZ: Math.max(0, Number(next.adaptiveConfidenceZ) || 0),
    adaptiveScoreMargin: Math.max(0, Number(next.adaptiveScoreMargin) || 0),
    informationSetIterations: Math.max(0, Math.floor(Number(next.informationSetIterations) || 0)),
    informationSetTreePlies: Math.max(1, Math.floor(Number(next.informationSetTreePlies) || 1)),
    informationSetMaxCandidates: Math.max(2, Math.floor(Number(next.informationSetMaxCandidates) || 2)),
    informationSetTriggerMargin:
      next.informationSetTriggerMargin === Number.POSITIVE_INFINITY
        ? Number.POSITIVE_INFINITY
        : Math.max(0, Number(next.informationSetTriggerMargin) || 0),
    informationSetExploration: Math.max(0, Number(next.informationSetExploration) || 0),
    informationSetBlend: Math.max(0, Math.min(1, Number(next.informationSetBlend) || 0)),
    riskAversion: Math.max(0, Number(next.riskAversion) || 0),
    rootAggregation: ["mean", "plurality", "borda", "pairwise", "median", "cvar"].includes(next.rootAggregation)
      ? next.rootAggregation
      : "mean",
    rootCvarFraction: Math.max(0.05, Math.min(1, Number(next.rootCvarFraction) || base.rootCvarFraction)),
    evaluation: normalizeEvaluationWeights(next.evaluation),
  };
}
