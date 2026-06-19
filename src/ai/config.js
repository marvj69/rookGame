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
});

export const DEFAULT_SEARCH_CONFIG = Object.freeze({
  label: "default",
  timeLimitMs: 30,
  samples: 8,
  minSamples: 1,
  maxSampleAttempts: 40,
  seed: 9001,
  exactEndgameHandSize: 3,
  exactNodeLimit: 20000,
  rolloutMaxHandSize: Number.POSITIVE_INFINITY,
  earlyStopLead: null,
  evaluation: DEFAULT_EVALUATION_WEIGHTS,
});

export const LIVE_SEARCH_CONFIG = Object.freeze({
  ...DEFAULT_SEARCH_CONFIG,
  label: "live-default",
  timeLimitMs: 120,
  samples: 3,
  minSamples: 1,
  maxSampleAttempts: 12,
  rolloutMaxHandSize: 7,
  earlyStopLead: 90,
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
    evaluation: normalizeEvaluationWeights(next.evaluation),
  };
}
