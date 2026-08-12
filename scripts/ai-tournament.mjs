import { availableParallelism } from "node:os";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import {
  DEFAULT_EVALUATION_WEIGHTS,
  LIVE_SEARCH_CONFIG,
  NAMED_SEARCH_CONFIGS,
  normalizeSearchConfig,
} from "../src/ai/config.js";
import {
  CHALLENGER_ENGINE_ID,
  CHAMPION_ENGINE_ID,
  SEARCH_V3_ABLATION_ENGINE_ID,
  createBenchmarkStrategies,
  expandOpponentEngineIds,
  getBenchmarkEngine,
  resolveEngineId,
} from "./ai-engines.mjs";
import {
  createBenchmarkTotal,
  getBenchmarkMetrics,
  mergeBenchmarkTotals,
  simulateBenchmarkRange,
} from "./ai-benchmark-sim.mjs";
import {
  DEFAULT_HOLDOUT_SEED_GROUP_ID,
  DEFAULT_TOURNAMENT_SEED_GROUP_ID,
  DEFAULT_TRAINING_SEED_GROUP_ID,
  assertDisjointSeedSets,
  parseSeedSpec,
  resolveSeedGroup,
} from "./ai-seed-groups.mjs";

function getArgValue(args, name) {
  const match = args.find((arg) => arg.startsWith(`--${name}=`));
  if (!match) return null;
  return match.slice(name.length + 3);
}

function getArgValues(args, name) {
  return args.filter((arg) => arg.startsWith(`--${name}=`)).map((arg) => arg.slice(name.length + 3));
}

function hasFlag(args, name) {
  return args.includes(`--${name}`);
}

function getArgNumber(args, name, fallback, min = 0) {
  const rawValue = getArgValue(args, name);
  if (rawValue === null) return fallback;
  const value = Number(rawValue);
  return Number.isFinite(value) && value >= min ? value : fallback;
}

function parseEvaluationOverrides(rawValue) {
  if (!rawValue) return {};

  return Object.fromEntries(
    rawValue
      .split(",")
      .map((entry) => entry.trim())
      .filter(Boolean)
      .map((entry) => {
        const [key, value] = entry.split("=");
        return [key, Number(value)];
      })
      .filter(([key, value]) => key && Number.isFinite(value)),
  );
}

function withGlobalSearchOverrides(config, args) {
  const evaluationOverrides = parseEvaluationOverrides(getArgValue(args, "eval"));
  const overrides = {
    timeLimitMs: getArgNumber(args, "search-ms", config.timeLimitMs, 0),
    samples: getArgNumber(args, "search-samples", config.samples, 1),
    seed: getArgNumber(args, "search-seed", config.seed, 1),
    minSamples: getArgNumber(args, "search-min-samples", config.minSamples, 0),
    maxSampleAttempts: getArgNumber(args, "search-sample-attempts", config.maxSampleAttempts, 1),
    exactEndgameHandSize: getArgNumber(args, "search-endgame", config.exactEndgameHandSize, 0),
    exactNodeLimit: getArgNumber(args, "search-node-limit", config.exactNodeLimit, 1),
    exactValueWeight: getArgNumber(args, "search-exact-weight", config.exactValueWeight, 0),
    exactPureHandSize: getArgNumber(args, "search-exact-pure-hand", config.exactPureHandSize, 0),
    exactMaxHandMinTrickPosition: getArgNumber(
      args,
      "search-exact-min-position",
      config.exactMaxHandMinTrickPosition,
      0,
    ),
    exactMaxHandMaxTrickPosition: getArgNumber(
      args,
      "search-exact-max-position",
      config.exactMaxHandMaxTrickPosition,
      0,
    ),
    exactOpponentMaxBranches: getArgNumber(
      args,
      "search-exact-opponent-branches",
      config.exactOpponentMaxBranches,
      0,
    ),
    exactOpponentPureHandSize: getArgNumber(
      args,
      "search-exact-opponent-pure-hand",
      config.exactOpponentPureHandSize,
      0,
    ),
    exactMaxHandMinKnownVoids: getArgNumber(
      args,
      "search-exact-min-known-voids",
      config.exactMaxHandMinKnownVoids,
      0,
    ),
    rolloutExactHandoffHandSize: getArgNumber(
      args,
      "search-rollout-exact-handoff",
      config.rolloutExactHandoffHandSize,
      0,
    ),
    rolloutExactNodeLimit: getArgNumber(
      args,
      "search-rollout-exact-nodes",
      config.rolloutExactNodeLimit,
      1,
    ),
    rolloutMaxHandSize: getArgNumber(args, "search-rollout-max-hand", config.rolloutMaxHandSize, 0),
    trickLookaheadPlies: getArgNumber(args, "search-trick-plies", config.trickLookaheadPlies, 0),
    trickLookaheadBranches: getArgNumber(args, "search-trick-branches", config.trickLookaheadBranches, 1),
    trickLookaheadBlend: getArgNumber(args, "search-trick-blend", config.trickLookaheadBlend, 0),
    searchStartTrick: getArgNumber(args, "search-start-trick", config.searchStartTrick, 0),
    openingOverrideMargin: getArgNumber(args, "search-opening-margin", config.openingOverrideMargin, 0),
    heuristicOverrideMargin: getArgNumber(args, "search-heuristic-margin", config.heuristicOverrideMargin, 0),
    heuristicOverrideZ: getArgNumber(args, "search-heuristic-z", config.heuristicOverrideZ, 0),
    earlyStopLead: getArgNumber(args, "search-early-stop", config.earlyStopLead, 0),
    adaptiveMinSamples: getArgNumber(args, "search-adaptive-min-samples", config.adaptiveMinSamples, 1),
    adaptiveConfidenceZ: getArgNumber(args, "search-adaptive-z", config.adaptiveConfidenceZ, 0),
    adaptiveScoreMargin: getArgNumber(args, "search-adaptive-margin", config.adaptiveScoreMargin, 0),
    informationSetIterations: getArgNumber(
      args,
      "search-information-iterations",
      config.informationSetIterations,
      0,
    ),
    informationSetTreePlies: getArgNumber(args, "search-information-plies", config.informationSetTreePlies, 1),
    informationSetMaxCandidates: getArgNumber(
      args,
      "search-information-candidates",
      config.informationSetMaxCandidates,
      2,
    ),
    informationSetTriggerMargin: getArgNumber(
      args,
      "search-information-trigger",
      config.informationSetTriggerMargin,
      0,
    ),
    informationSetExploration: getArgNumber(
      args,
      "search-information-exploration",
      config.informationSetExploration,
      0,
    ),
    informationSetBlend: getArgNumber(args, "search-information-blend", config.informationSetBlend, 0),
    riskAversion: getArgNumber(args, "search-risk-aversion", config.riskAversion, 0),
    rootCvarFraction: getArgNumber(args, "search-root-cvar-fraction", config.rootCvarFraction, 0),
  };
  if (hasFlag(args, "no-belief-weighting")) overrides.beliefWeighting = false;
  if (hasFlag(args, "belief-weighting")) overrides.beliefWeighting = true;
  if (hasFlag(args, "no-adaptive-sampling")) overrides.adaptiveSampling = false;
  if (hasFlag(args, "adaptive-sampling")) overrides.adaptiveSampling = true;
  if (hasFlag(args, "no-information-set")) overrides.informationSetIterations = 0;
  if (hasFlag(args, "exact-policy-ordering")) overrides.exactPolicyOrdering = true;
  if (hasFlag(args, "no-exact-policy-ordering")) overrides.exactPolicyOrdering = false;
  if (hasFlag(args, "exact-sequence-pruning")) overrides.exactSequencePruning = true;
  if (hasFlag(args, "no-exact-sequence-pruning")) overrides.exactSequencePruning = false;
  if (hasFlag(args, "matching-sampler")) overrides.hiddenHandSampler = "matching";
  if (hasFlag(args, "stratified-sampler")) overrides.hiddenHandSampler = "stratified";
  if (hasFlag(args, "greedy-sampler")) overrides.hiddenHandSampler = "greedy";
  const rootAggregation = getArgValue(args, "search-root-aggregation");
  if (rootAggregation) overrides.rootAggregation = rootAggregation;

  return normalizeSearchConfig({
    ...config,
    ...overrides,
    evaluation: {
      ...config.evaluation,
      ...evaluationOverrides,
    },
  });
}

const MATCH_NEUTRAL_EVALUATION = Object.freeze({
  ...LIVE_SEARCH_CONFIG.evaluation,
  matchWinReward: 0,
  matchLeadReward: 0,
  mustWinBidPressure: 0,
});

const COMPATIBILITY_SEARCH_CONFIG = normalizeSearchConfig({
  ...LIVE_SEARCH_CONFIG,
  label: "compat-v2",
  exactEndgameHandSize: 3,
  exactNodeLimit: 20000,
  exactPolicyOrdering: false,
  exactSequencePruning: false,
  rolloutExactHandoffHandSize: 0,
  beliefWeighting: false,
  adaptiveSampling: false,
  informationSetIterations: 0,
  evaluation: MATCH_NEUTRAL_EVALUATION,
});

const EXACT_5_10K_SEARCH_CONFIG = normalizeSearchConfig({
  ...COMPATIBILITY_SEARCH_CONFIG,
  label: "exact-5-node-10k",
  exactEndgameHandSize: 5,
  exactNodeLimit: 10000,
});

function exactFiveMatchProfile(label, matchWinReward) {
  return normalizeSearchConfig({
    ...EXACT_5_10K_SEARCH_CONFIG,
    label,
    evaluation: {
      ...MATCH_NEUTRAL_EVALUATION,
      matchWinReward,
    },
  });
}

function exactFiveRiskProfile(label, riskAversion, matchWinReward = 0) {
  return normalizeSearchConfig({
    ...EXACT_5_10K_SEARCH_CONFIG,
    label,
    riskAversion,
    evaluation: {
      ...MATCH_NEUTRAL_EVALUATION,
      matchWinReward,
    },
  });
}

// Training-only profiles make one-factor ablations reproducible without
// changing the shipped live profile or either frozen champion module.
const EXPERIMENT_SEARCH_CONFIGS = Object.freeze({
  "compat-v2": COMPATIBILITY_SEARCH_CONFIG,
  "match-only": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "match-only",
    evaluation: DEFAULT_EVALUATION_WEIGHTS,
  }),
  "belief-only": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "belief-only",
    beliefWeighting: true,
  }),
  "adaptive-only": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "adaptive-only",
    adaptiveSampling: true,
  }),
  "information-only": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "information-only",
    informationSetIterations: 36,
  }),
  "exact-4": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-4",
    exactEndgameHandSize: 4,
  }),
  "exact-5": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-5",
    exactEndgameHandSize: 5,
  }),
  "exact-6": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-6",
    exactEndgameHandSize: 6,
  }),
  "exact-5-info": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-5-info",
    exactEndgameHandSize: 5,
    informationSetIterations: 36,
  }),
  "exact-4-info": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-4-info",
    exactEndgameHandSize: 4,
    informationSetIterations: 36,
  }),
  "exact-5-64": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-5-64",
    exactEndgameHandSize: 5,
    samples: 64,
  }),
  "exact-5-node-5k": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-5-node-5k",
    exactEndgameHandSize: 5,
    exactNodeLimit: 5000,
  }),
  "exact-5-node-10k": normalizeSearchConfig({
    ...EXACT_5_10K_SEARCH_CONFIG,
  }),
  "exact-5-match-100": exactFiveMatchProfile("exact-5-match-100", 100),
  "exact-5-match-250": exactFiveMatchProfile("exact-5-match-250", 250),
  "exact-5-match-500": exactFiveMatchProfile("exact-5-match-500", 500),
  "exact-5-risk-005": exactFiveRiskProfile("exact-5-risk-005", 0.05),
  "exact-5-risk-010": exactFiveRiskProfile("exact-5-risk-010", 0.1),
  "exact-5-risk-020": exactFiveRiskProfile("exact-5-risk-020", 0.2),
  "exact-5-match-250-risk-010": exactFiveRiskProfile("exact-5-match-250-risk-010", 0.1, 250),
  "exact-6-node-2500": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-6-node-2500",
    exactEndgameHandSize: 6,
    exactNodeLimit: 2500,
  }),
  "exact-6-node-5k": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-6-node-5k",
    exactEndgameHandSize: 6,
    exactNodeLimit: 5000,
  }),
  "exact-6-node-10k": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-6-node-10k",
    exactEndgameHandSize: 6,
    exactNodeLimit: 10000,
  }),
  "exact-5-optimized-10k": normalizeSearchConfig({
    ...EXACT_5_10K_SEARCH_CONFIG,
    label: "exact-5-optimized-10k",
    exactPolicyOrdering: true,
    exactSequencePruning: true,
  }),
  "exact-5-optimized-match-100": normalizeSearchConfig({
    ...exactFiveMatchProfile("exact-5-optimized-match-100", 100),
    exactPolicyOrdering: true,
    exactSequencePruning: true,
  }),
  "exact-6-optimized-2500": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-6-optimized-2500",
    exactEndgameHandSize: 6,
    exactNodeLimit: 2500,
    exactPolicyOrdering: true,
    exactSequencePruning: true,
  }),
  "exact-6-optimized-5k": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-6-optimized-5k",
    exactEndgameHandSize: 6,
    exactNodeLimit: 5000,
    exactPolicyOrdering: true,
    exactSequencePruning: true,
  }),
  "exact-6-optimized-10k": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-6-optimized-10k",
    exactEndgameHandSize: 6,
    exactNodeLimit: 10000,
    exactPolicyOrdering: true,
    exactSequencePruning: true,
  }),
  "exact-5-optimized-matching": normalizeSearchConfig({
    ...EXACT_5_10K_SEARCH_CONFIG,
    label: "exact-5-optimized-matching",
    hiddenHandSampler: "matching",
    exactPolicyOrdering: true,
    exactSequencePruning: true,
  }),
  "exact-6-optimized-matching": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-6-optimized-matching",
    hiddenHandSampler: "matching",
    exactEndgameHandSize: 6,
    exactNodeLimit: 10000,
    exactPolicyOrdering: true,
    exactSequencePruning: true,
  }),
  "exact-6-optimized-match-50": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-6-optimized-match-50",
    exactEndgameHandSize: 6,
    exactNodeLimit: 10000,
    exactPolicyOrdering: true,
    exactSequencePruning: true,
    evaluation: { ...MATCH_NEUTRAL_EVALUATION, matchWinReward: 50 },
  }),
  "exact-6-optimized-match-100": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-6-optimized-match-100",
    exactEndgameHandSize: 6,
    exactNodeLimit: 10000,
    exactPolicyOrdering: true,
    exactSequencePruning: true,
    evaluation: { ...MATCH_NEUTRAL_EVALUATION, matchWinReward: 100 },
  }),
  "exact-6-optimized-match-150": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-6-optimized-match-150",
    exactEndgameHandSize: 6,
    exactNodeLimit: 10000,
    exactPolicyOrdering: true,
    exactSequencePruning: true,
    evaluation: { ...MATCH_NEUTRAL_EVALUATION, matchWinReward: 150 },
  }),
  "exact-6-optimized-12500": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-6-optimized-12500",
    exactEndgameHandSize: 6,
    exactNodeLimit: 12500,
    exactPolicyOrdering: true,
    exactSequencePruning: true,
  }),
  "exact-6-optimized-s48": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-6-optimized-s48",
    samples: 48,
    exactEndgameHandSize: 6,
    exactNodeLimit: 10000,
    exactPolicyOrdering: true,
    exactSequencePruning: true,
  }),
  "exact-6-optimized-s64": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-6-optimized-s64",
    samples: 64,
    exactEndgameHandSize: 6,
    exactNodeLimit: 10000,
    exactPolicyOrdering: true,
    exactSequencePruning: true,
  }),
  "exact-7-optimized-10k": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-7-optimized-10k",
    exactEndgameHandSize: 7,
    exactNodeLimit: 10000,
    exactPolicyOrdering: true,
    exactSequencePruning: true,
  }),
  "exact-7-optimized-20k": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-7-optimized-20k",
    exactEndgameHandSize: 7,
    exactNodeLimit: 20000,
    exactPolicyOrdering: true,
    exactSequencePruning: true,
  }),
  "exact-6-plurality": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-6-plurality",
    rootAggregation: "plurality",
    exactEndgameHandSize: 6,
    exactNodeLimit: 10000,
    exactPolicyOrdering: true,
    exactSequencePruning: true,
  }),
  "exact-6-borda": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-6-borda",
    rootAggregation: "borda",
    exactEndgameHandSize: 6,
    exactNodeLimit: 10000,
    exactPolicyOrdering: true,
    exactSequencePruning: true,
  }),
  "exact-6-pairwise": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-6-pairwise",
    rootAggregation: "pairwise",
    exactEndgameHandSize: 6,
    exactNodeLimit: 10000,
    exactPolicyOrdering: true,
    exactSequencePruning: true,
  }),
  "exact-6-median": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-6-median",
    rootAggregation: "median",
    exactEndgameHandSize: 6,
    exactNodeLimit: 10000,
    exactPolicyOrdering: true,
    exactSequencePruning: true,
  }),
  "exact-6-cvar25": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-6-cvar25",
    rootAggregation: "cvar",
    rootCvarFraction: 0.25,
    exactEndgameHandSize: 6,
    exactNodeLimit: 10000,
    exactPolicyOrdering: true,
    exactSequencePruning: true,
  }),
  "exact-6-trick-2x1": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-6-trick-2x1",
    exactEndgameHandSize: 6,
    exactNodeLimit: 10000,
    exactPolicyOrdering: true,
    exactSequencePruning: true,
    trickLookaheadPlies: 1,
    trickLookaheadBranches: 2,
  }),
  "exact-6-trick-2x2": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-6-trick-2x2",
    exactEndgameHandSize: 6,
    exactNodeLimit: 10000,
    exactPolicyOrdering: true,
    exactSequencePruning: true,
    trickLookaheadPlies: 2,
    trickLookaheadBranches: 2,
  }),
  "exact-6-trick-2x3": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-6-trick-2x3",
    exactEndgameHandSize: 6,
    exactNodeLimit: 10000,
    exactPolicyOrdering: true,
    exactSequencePruning: true,
    trickLookaheadPlies: 3,
    trickLookaheadBranches: 2,
  }),
  "exact-6-trick-2x3-s8": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-6-trick-2x3-s8",
    samples: 8,
    exactEndgameHandSize: 6,
    exactNodeLimit: 10000,
    exactPolicyOrdering: true,
    exactSequencePruning: true,
    trickLookaheadPlies: 3,
    trickLookaheadBranches: 2,
  }),
  "exact-6-trick-2x3-s12": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-6-trick-2x3-s12",
    samples: 12,
    exactEndgameHandSize: 6,
    exactNodeLimit: 10000,
    exactPolicyOrdering: true,
    exactSequencePruning: true,
    trickLookaheadPlies: 3,
    trickLookaheadBranches: 2,
  }),
  "exact-6-trick-2x3-s16": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-6-trick-2x3-s16",
    samples: 16,
    exactEndgameHandSize: 6,
    exactNodeLimit: 10000,
    exactPolicyOrdering: true,
    exactSequencePruning: true,
    trickLookaheadPlies: 3,
    trickLookaheadBranches: 2,
  }),
  "exact-6-trick-2x3-s24": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-6-trick-2x3-s24",
    samples: 24,
    exactEndgameHandSize: 6,
    exactNodeLimit: 10000,
    exactPolicyOrdering: true,
    exactSequencePruning: true,
    trickLookaheadPlies: 3,
    trickLookaheadBranches: 2,
  }),
  "exact-6-trick-2x3-s16-b25": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-6-trick-2x3-s16-b25",
    samples: 16,
    exactEndgameHandSize: 6,
    exactNodeLimit: 10000,
    exactPolicyOrdering: true,
    exactSequencePruning: true,
    trickLookaheadPlies: 3,
    trickLookaheadBranches: 2,
    trickLookaheadBlend: 0.25,
  }),
  "exact-6-trick-2x3-s16-b50": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-6-trick-2x3-s16-b50",
    samples: 16,
    exactEndgameHandSize: 6,
    exactNodeLimit: 10000,
    exactPolicyOrdering: true,
    exactSequencePruning: true,
    trickLookaheadPlies: 3,
    trickLookaheadBranches: 2,
    trickLookaheadBlend: 0.5,
  }),
  "exact-6-trick-2x3-s16-b75": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-6-trick-2x3-s16-b75",
    samples: 16,
    exactEndgameHandSize: 6,
    exactNodeLimit: 10000,
    exactPolicyOrdering: true,
    exactSequencePruning: true,
    trickLookaheadPlies: 3,
    trickLookaheadBranches: 2,
    trickLookaheadBlend: 0.75,
  }),
  "exact-6-trick-3x2": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-6-trick-3x2",
    exactEndgameHandSize: 6,
    exactNodeLimit: 10000,
    exactPolicyOrdering: true,
    exactSequencePruning: true,
    trickLookaheadPlies: 2,
    trickLookaheadBranches: 3,
  }),
  "exact-6-start-1": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-6-start-1",
    searchStartTrick: 1,
    exactEndgameHandSize: 6,
    exactNodeLimit: 10000,
    exactPolicyOrdering: true,
    exactSequencePruning: true,
  }),
  "exact-6-start-2": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-6-start-2",
    searchStartTrick: 2,
    exactEndgameHandSize: 6,
    exactNodeLimit: 10000,
    exactPolicyOrdering: true,
    exactSequencePruning: true,
  }),
  "exact-6-start-3": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-6-start-3",
    searchStartTrick: 3,
    exactEndgameHandSize: 6,
    exactNodeLimit: 10000,
    exactPolicyOrdering: true,
    exactSequencePruning: true,
  }),
  "exact-6-start-4": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-6-start-4",
    searchStartTrick: 4,
    exactEndgameHandSize: 6,
    exactNodeLimit: 10000,
    exactPolicyOrdering: true,
    exactSequencePruning: true,
  }),
  "exact-6-start-5": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-6-start-5",
    searchStartTrick: 5,
    exactEndgameHandSize: 6,
    exactNodeLimit: 10000,
    exactPolicyOrdering: true,
    exactSequencePruning: true,
  }),
  "exact-6-opening-margin-10": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-6-opening-margin-10",
    openingOverrideMargin: 10,
    exactEndgameHandSize: 6,
    exactNodeLimit: 10000,
    exactPolicyOrdering: true,
    exactSequencePruning: true,
  }),
  "exact-6-opening-margin-25": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-6-opening-margin-25",
    openingOverrideMargin: 25,
    exactEndgameHandSize: 6,
    exactNodeLimit: 10000,
    exactPolicyOrdering: true,
    exactSequencePruning: true,
  }),
  "exact-6-opening-margin-50": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-6-opening-margin-50",
    openingOverrideMargin: 50,
    exactEndgameHandSize: 6,
    exactNodeLimit: 10000,
    exactPolicyOrdering: true,
    exactSequencePruning: true,
  }),
  "exact-6-opening-margin-100": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-6-opening-margin-100",
    openingOverrideMargin: 100,
    exactEndgameHandSize: 6,
    exactNodeLimit: 10000,
    exactPolicyOrdering: true,
    exactSequencePruning: true,
  }),
  "exact-6-stratified-s8": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-6-stratified-s8",
    hiddenHandSampler: "stratified",
    samples: 8,
    exactEndgameHandSize: 6,
    exactNodeLimit: 10000,
    exactPolicyOrdering: true,
    exactSequencePruning: true,
  }),
  "exact-6-stratified-s16": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-6-stratified-s16",
    hiddenHandSampler: "stratified",
    samples: 16,
    exactEndgameHandSize: 6,
    exactNodeLimit: 10000,
    exactPolicyOrdering: true,
    exactSequencePruning: true,
  }),
  "exact-6-stratified-s24": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-6-stratified-s24",
    hiddenHandSampler: "stratified",
    samples: 24,
    exactEndgameHandSize: 6,
    exactNodeLimit: 10000,
    exactPolicyOrdering: true,
    exactSequencePruning: true,
  }),
  "exact-6-stratified-s32": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-6-stratified-s32",
    hiddenHandSampler: "stratified",
    samples: 32,
    exactEndgameHandSize: 6,
    exactNodeLimit: 10000,
    exactPolicyOrdering: true,
    exactSequencePruning: true,
  }),
  "exact-6-model-blend-25": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-6-model-blend-25",
    exactEndgameHandSize: 6,
    exactNodeLimit: 10000,
    exactPolicyOrdering: true,
    exactSequencePruning: true,
    exactValueWeight: 0.25,
    exactPureHandSize: 3,
  }),
  "exact-6-model-blend-50": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-6-model-blend-50",
    exactEndgameHandSize: 6,
    exactNodeLimit: 10000,
    exactPolicyOrdering: true,
    exactSequencePruning: true,
    exactValueWeight: 0.5,
    exactPureHandSize: 3,
  }),
  "exact-6-model-blend-75": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-6-model-blend-75",
    exactEndgameHandSize: 6,
    exactNodeLimit: 10000,
    exactPolicyOrdering: true,
    exactSequencePruning: true,
    exactValueWeight: 0.75,
    exactPureHandSize: 3,
  }),
  "exact-6-confidence-z025": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-6-confidence-z025",
    heuristicOverrideZ: 0.25,
    exactEndgameHandSize: 6,
    exactNodeLimit: 10000,
    exactPolicyOrdering: true,
    exactSequencePruning: true,
  }),
  "exact-6-confidence-z050": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-6-confidence-z050",
    heuristicOverrideZ: 0.5,
    exactEndgameHandSize: 6,
    exactNodeLimit: 10000,
    exactPolicyOrdering: true,
    exactSequencePruning: true,
  }),
  "exact-6-confidence-z100": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-6-confidence-z100",
    heuristicOverrideZ: 1,
    exactEndgameHandSize: 6,
    exactNodeLimit: 10000,
    exactPolicyOrdering: true,
    exactSequencePruning: true,
  }),
  "exact-6-confidence-z150": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-6-confidence-z150",
    heuristicOverrideZ: 1.5,
    exactEndgameHandSize: 6,
    exactNodeLimit: 10000,
    exactPolicyOrdering: true,
    exactSequencePruning: true,
  }),
  "exact-6-position-lead": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-6-position-lead",
    exactEndgameHandSize: 6,
    exactNodeLimit: 10000,
    exactPolicyOrdering: true,
    exactSequencePruning: true,
    exactMaxHandMinTrickPosition: 0,
    exactMaxHandMaxTrickPosition: 0,
  }),
  "exact-6-position-first-two": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-6-position-first-two",
    exactEndgameHandSize: 6,
    exactNodeLimit: 10000,
    exactPolicyOrdering: true,
    exactSequencePruning: true,
    exactMaxHandMinTrickPosition: 0,
    exactMaxHandMaxTrickPosition: 1,
  }),
  "exact-6-position-last-two": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-6-position-last-two",
    exactEndgameHandSize: 6,
    exactNodeLimit: 10000,
    exactPolicyOrdering: true,
    exactSequencePruning: true,
    exactMaxHandMinTrickPosition: 1,
    exactMaxHandMaxTrickPosition: 3,
  }),
  "exact-6-position-third": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-6-position-third",
    exactEndgameHandSize: 6,
    exactNodeLimit: 10000,
    exactPolicyOrdering: true,
    exactSequencePruning: true,
    exactMaxHandMinTrickPosition: 2,
    exactMaxHandMaxTrickPosition: 2,
  }),
  "exact-6-opponent-policy-1": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-6-opponent-policy-1",
    exactEndgameHandSize: 6,
    exactNodeLimit: 10000,
    exactPolicyOrdering: true,
    exactSequencePruning: true,
    exactOpponentMaxBranches: 1,
    exactOpponentPureHandSize: 3,
  }),
  "exact-6-opponent-policy-2": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-6-opponent-policy-2",
    exactEndgameHandSize: 6,
    exactNodeLimit: 10000,
    exactPolicyOrdering: true,
    exactSequencePruning: true,
    exactOpponentMaxBranches: 2,
    exactOpponentPureHandSize: 3,
  }),
  "exact-6-opponent-policy-3": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-6-opponent-policy-3",
    exactEndgameHandSize: 6,
    exactNodeLimit: 10000,
    exactPolicyOrdering: true,
    exactSequencePruning: true,
    exactOpponentMaxBranches: 3,
    exactOpponentPureHandSize: 3,
  }),
  "exact-6-known-voids-1": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-6-known-voids-1",
    exactEndgameHandSize: 6,
    exactNodeLimit: 10000,
    exactPolicyOrdering: true,
    exactSequencePruning: true,
    exactMaxHandMinKnownVoids: 1,
  }),
  "exact-6-known-voids-2": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-6-known-voids-2",
    exactEndgameHandSize: 6,
    exactNodeLimit: 10000,
    exactPolicyOrdering: true,
    exactSequencePruning: true,
    exactMaxHandMinKnownVoids: 2,
  }),
  "exact-6-known-voids-3": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-6-known-voids-3",
    exactEndgameHandSize: 6,
    exactNodeLimit: 10000,
    exactPolicyOrdering: true,
    exactSequencePruning: true,
    exactMaxHandMinKnownVoids: 3,
  }),
  "exact-6-known-voids-4": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-6-known-voids-4",
    exactEndgameHandSize: 6,
    exactNodeLimit: 10000,
    exactPolicyOrdering: true,
    exactSequencePruning: true,
    exactMaxHandMinKnownVoids: 4,
  }),
  "exact-6-rollout-handoff-2": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-6-rollout-handoff-2",
    exactEndgameHandSize: 6,
    exactNodeLimit: 10000,
    exactPolicyOrdering: true,
    exactSequencePruning: true,
    rolloutExactHandoffHandSize: 2,
    rolloutExactNodeLimit: 10000,
  }),
  "exact-6-rollout-handoff-3": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-6-rollout-handoff-3",
    exactEndgameHandSize: 6,
    exactNodeLimit: 10000,
    exactPolicyOrdering: true,
    exactSequencePruning: true,
    rolloutExactHandoffHandSize: 3,
    rolloutExactNodeLimit: 10000,
  }),
  "exact-6-rollout-handoff-4": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-6-rollout-handoff-4",
    exactEndgameHandSize: 6,
    exactNodeLimit: 10000,
    exactPolicyOrdering: true,
    exactSequencePruning: true,
    rolloutExactHandoffHandSize: 4,
    rolloutExactNodeLimit: 5000,
  }),
  "exact-6-rollout-handoff-5": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "exact-6-rollout-handoff-5",
    exactEndgameHandSize: 6,
    exactNodeLimit: 10000,
    exactPolicyOrdering: true,
    exactSequencePruning: true,
    rolloutExactHandoffHandSize: 5,
    rolloutExactNodeLimit: 2500,
  }),
  "samples-64": normalizeSearchConfig({
    ...COMPATIBILITY_SEARCH_CONFIG,
    label: "samples-64",
    samples: 64,
  }),
});

function parseSearchConfigSpec(spec, args) {
  if (spec === "live") {
    return withGlobalSearchOverrides(LIVE_SEARCH_CONFIG, args);
  }

  if (NAMED_SEARCH_CONFIGS[spec]) {
    return withGlobalSearchOverrides(NAMED_SEARCH_CONFIGS[spec], args);
  }

  if (EXPERIMENT_SEARCH_CONFIGS[spec]) {
    return withGlobalSearchOverrides(EXPERIMENT_SEARCH_CONFIGS[spec], args);
  }

  const [label, timeLimitMs, samples, seed, minSamples, maxSampleAttempts] = spec.split(":");
  if (!label || !timeLimitMs || !samples) {
    throw new Error(`Invalid search config "${spec}". Use a named config or label:ms:samples[:seed[:minSamples[:sampleAttempts]]].`);
  }

  return withGlobalSearchOverrides(
    normalizeSearchConfig({
      label,
      timeLimitMs: Number(timeLimitMs),
      samples: Number(samples),
      seed: seed === undefined ? NAMED_SEARCH_CONFIGS.default.seed : Number(seed),
      minSamples: minSamples === undefined ? NAMED_SEARCH_CONFIGS.default.minSamples : Number(minSamples),
      maxSampleAttempts:
        maxSampleAttempts === undefined ? NAMED_SEARCH_CONFIGS.default.maxSampleAttempts : Number(maxSampleAttempts),
    }),
    args,
  );
}

export function parseSearchConfigs(args) {
  const specs = [
    ...getArgValues(args, "search-config"),
    ...getArgValues(args, "search-configs").flatMap((value) => value.split(",")),
  ].filter(Boolean);

  const selectedSpecs = specs.length > 0 ? specs : ["live"];
  return selectedSpecs.map((spec) => parseSearchConfigSpec(spec.trim(), args));
}

function resolveWorkerCount(rawWorkerCount, jobCount) {
  if (jobCount <= 1) return 1;
  if (rawWorkerCount === "auto") {
    return Math.max(1, Math.min(jobCount, availableParallelism(), 8));
  }

  const numeric = Number(rawWorkerCount);
  return Number.isFinite(numeric) ? Math.max(1, Math.min(jobCount, Math.floor(numeric))) : 1;
}

export function createBenchmarkOptions({ candidateEngineId, opponentEngineId, search, gamesPerSide, mustWinByBid = false }) {
  return {
    mode: "tournament",
    candidateMode: candidateEngineId,
    candidateEngineId,
    opponentEngineId,
    opponentEngineIds: [opponentEngineId],
    gamesPerSide,
    seed: 0,
    workerCount: 1,
    searchProfile: "live",
    deterministicSearch: true,
    mustWinByBid,
    search: normalizeSearchConfig(search),
    engineSearchConfigs: {
      candidate: normalizeSearchConfig(search),
    },
  };
}

export function searchConfigsForEngine(engine, searchConfigs) {
  if (!engine.usesSearch) return [searchConfigs[0]];
  if ([CHALLENGER_ENGINE_ID, SEARCH_V3_ABLATION_ENGINE_ID].includes(engine.id)) return searchConfigs;
  return [normalizeSearchConfig(engine.liveSearchConfig ?? engine.defaultSearchConfig ?? searchConfigs[0])];
}

function createJobs({ seeds, candidates, opponents, searchConfigs, gamesPerSide, mustWinByBid = false }) {
  const jobs = [];

  seeds.forEach((seed) => {
    opponents.forEach((opponentEngineId) => {
      candidates.forEach((candidateEngineId) => {
        const candidateEngine = getBenchmarkEngine(candidateEngineId);
        searchConfigsForEngine(candidateEngine, searchConfigs).forEach((searchConfig) => {
          const configLabel = candidateEngine.usesSearch ? searchConfig.label : "heuristic";
          jobs.push({
            id: `${candidateEngine.id}:vs:${opponentEngineId}:${configLabel}:${seed}`,
            seed,
            engine: candidateEngine.id,
            opponent: opponentEngineId,
            configLabel,
            candidateEngine: candidateEngine.id,
            opponentEngine: opponentEngineId,
            options: createBenchmarkOptions({
              candidateEngineId: candidateEngine.id,
              opponentEngineId,
              search: searchConfig,
              gamesPerSide,
              mustWinByBid,
            }),
            gamesPerSide,
          });
        });
      });
    });
  });

  return jobs;
}

function runJobLocal(job) {
  const startedAt = performance.now();
  const total = simulateBenchmarkRange({
    seed: job.seed,
    gamesPerSide: job.gamesPerSide,
    strategies: createBenchmarkStrategies({
      candidate: job.candidateEngine,
      opponent: job.opponentEngine,
    }),
    options: job.options,
  });
  return {
    ...job,
    total,
    elapsedMs: performance.now() - startedAt,
  };
}

function runJobWorker(job) {
  const startedAt = performance.now();

  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./ai-benchmark-worker.mjs", import.meta.url), {
      workerData: {
        jobId: job.id,
        startIndex: 0,
        gamesPerSide: job.gamesPerSide,
        seed: job.seed,
        candidateEngine: job.candidateEngine,
        opponentEngine: job.opponentEngine,
        options: job.options,
      },
    });

    worker.on("message", (message) => {
      if (message.ok) {
        resolve({
          ...job,
          total: message.total,
          elapsedMs: performance.now() - startedAt,
        });
      } else {
        reject(new Error(message.error?.stack || message.error?.message || "Tournament worker failed."));
      }
    });
    worker.on("error", reject);
    worker.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`Tournament worker exited with code ${code}.`));
      }
    });
  });
}

async function runJobs(jobs, workerCount) {
  if (workerCount <= 1) {
    return jobs.map((job) => runJobLocal(job));
  }

  const results = [];
  let nextIndex = 0;

  async function runNext() {
    while (nextIndex < jobs.length) {
      const job = jobs[nextIndex];
      nextIndex += 1;
      results.push(await runJobWorker(job));
    }
  }

  await Promise.all(Array.from({ length: workerCount }, runNext));
  return results.sort((a, b) => jobs.findIndex((job) => job.id === a.id) - jobs.findIndex((job) => job.id === b.id));
}

function rowFromResult(result) {
  return {
    seed: result.seed,
    engine: result.engine,
    opponent: result.opponent,
    config: result.configLabel,
    metrics: getBenchmarkMetrics(result.total, result.elapsedMs),
  };
}

function aggregateResults(results) {
  const groups = new Map();

  results.forEach((result) => {
    const key = `${result.engine}:${result.opponent}:${result.configLabel}`;
    if (!groups.has(key)) {
      groups.set(key, {
        engine: result.engine,
        opponent: result.opponent,
        config: result.configLabel,
        seeds: [],
        total: createBenchmarkTotal(),
        elapsedMs: 0,
      });
    }

    const group = groups.get(key);
    group.seeds.push(result.seed);
    group.elapsedMs += result.elapsedMs;
    mergeBenchmarkTotals(group.total, result.total);
  });

  return [...groups.values()].map((group) => ({
    engine: group.engine,
    opponent: group.opponent,
    config: group.config,
    seeds: group.seeds,
    metrics: getBenchmarkMetrics(group.total, group.elapsedMs),
  }));
}

function aggregateLeagueResults(results) {
  const groups = new Map();

  results.forEach((result) => {
    const key = `${result.engine}:${result.configLabel}`;
    if (!groups.has(key)) {
      groups.set(key, {
        engine: result.engine,
        opponent: "opponent-league",
        config: result.configLabel,
        seeds: new Set(),
        opponents: new Set(),
        total: createBenchmarkTotal(),
        elapsedMs: 0,
      });
    }
    const group = groups.get(key);
    group.seeds.add(result.seed);
    group.opponents.add(result.opponent);
    group.elapsedMs += result.elapsedMs;
    mergeBenchmarkTotals(group.total, result.total);
  });

  return [...groups.values()].map((group) => ({
    engine: group.engine,
    opponent: group.opponent,
    config: group.config,
    seeds: [...group.seeds],
    opponents: [...group.opponents],
    metrics: getBenchmarkMetrics(group.total, group.elapsedMs),
  }));
}

function pct(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatNumber(value, digits = 1) {
  return Number.isFinite(value) ? value.toFixed(digits) : "0.0";
}

function formatTable(rows, columns) {
  const widths = columns.map((column) =>
    Math.max(
      column.header.length,
      ...rows.map((row) => String(column.value(row)).length),
    ),
  );
  const line = columns.map((column, index) => column.header.padEnd(widths[index])).join("  ");
  const divider = widths.map((width) => "-".repeat(width)).join("  ");
  const body = rows.map((row) =>
    columns.map((column, index) => String(column.value(row)).padEnd(widths[index])).join("  "),
  );

  return [line, divider, ...body].join("\n");
}

function tableColumns() {
  return [
    { header: "Seed", value: (row) => row.seed ?? "ALL" },
    { header: "Engine", value: (row) => row.engine },
    { header: "Opponent", value: (row) => row.opponent },
    { header: "Config", value: (row) => row.config },
    { header: "Games", value: (row) => row.metrics.games },
    { header: "Wins", value: (row) => row.metrics.wins },
    { header: "Win%", value: (row) => pct(row.metrics.winRate) },
    { header: "EloΔ", value: (row) => formatNumber(row.metrics.approximateEloDelta, 0) },
    { header: "Margin", value: (row) => formatNumber(row.metrics.averageMargin, 1) },
    { header: "BidMake", value: (row) => pct(row.metrics.candidateBidMakeRate) },
    { header: "Illegal", value: (row) => row.metrics.illegalMoves },
    { header: "Unfinished", value: (row) => row.metrics.unfinishedGames },
    { header: "Search", value: (row) => row.metrics.searchDecisions },
    { header: "AvgS", value: (row) => formatNumber(row.metrics.averageSearchSamplesPerDecision, 2) },
    { header: "AvgMs", value: (row) => formatNumber(row.metrics.averageSearchMsPerDecision, 2) },
    { header: "Fallback", value: (row) => row.metrics.searchFallbacks },
    { header: "Timeout", value: (row) => row.metrics.searchTimeouts },
    { header: "Elapsed", value: (row) => `${formatNumber(row.metrics.elapsedMs / 1000, 1)}s` },
  ];
}

function printTournamentSummary(summary, { includeJson }) {
  if (summary.seedGroup) {
    console.log(
      `Tournament seed group: ${summary.seedGroup.id} (${summary.seedGroup.role}${summary.seedGroup.locked ? ", locked" : ""})`,
    );
  }
  console.log(`Tournament seeds: ${summary.seeds.join(", ")}`);
  console.log(`Tournament opponents: ${summary.opponents.join(", ")}`);
  console.log(`Search profile: ${summary.searchProfile} (fixed-work deterministic: ${summary.deterministicSearch ? "yes" : "no"})`);
  console.log(`Games per seed per orientation: ${summary.gamesPerSeed}`);
  console.log(`Workers: ${summary.workers}`);
  console.log(`Wall time: ${formatNumber(summary.elapsedMs / 1000, 1)}s`);
  console.log("\nPer-seed results:");
  console.log(formatTable(summary.rows, tableColumns()));
  console.log("\nAggregate results:");
  console.log(formatTable(summary.aggregates.map((row) => ({ ...row, seed: "ALL" })), tableColumns()));
  if (summary.opponents.length > 1) {
    console.log("\nMulti-opponent league aggregate:");
    console.log(formatTable(summary.leagueAggregates.map((row) => ({ ...row, seed: "LEAGUE" })), tableColumns()));
  }

  if (includeJson) {
    console.log("\nJSON summary:");
    console.log(JSON.stringify(summary, null, 2));
  }
}

function summarizeResults({ args, seedGroup, seeds, opponents, gamesPerSeed, workers, searchConfigs, results, startedAt }) {
  const rows = results.map((result) => ({
    ...rowFromResult(result),
    total: result.total,
  }));

  return {
    seedGroup: seedGroup
      ? {
          id: seedGroup.id,
          role: seedGroup.role,
          locked: seedGroup.locked,
        }
      : null,
    seeds,
    opponents,
    searchProfile: "live",
    deterministicSearch: true,
    mustWinByBid: Boolean(args.some((arg) => arg === "--must-win-by-bid" || arg === "--must-win-by-bid=true")),
    gamesPerSeed,
    workers,
    searchConfigs: searchConfigs.map((config) => ({
      label: config.label,
      timeLimitMs: config.timeLimitMs,
      samples: config.samples,
      minSamples: config.minSamples,
      maxSampleAttempts: config.maxSampleAttempts,
      hiddenHandSampler: config.hiddenHandSampler,
      seed: config.seed,
      exactEndgameHandSize: config.exactEndgameHandSize,
      exactNodeLimit: config.exactNodeLimit,
      exactPolicyOrdering: config.exactPolicyOrdering,
      exactSequencePruning: config.exactSequencePruning,
      exactValueWeight: config.exactValueWeight,
      exactPureHandSize: config.exactPureHandSize,
      exactMaxHandMinTrickPosition: config.exactMaxHandMinTrickPosition,
      exactMaxHandMaxTrickPosition: config.exactMaxHandMaxTrickPosition,
      exactOpponentMaxBranches: config.exactOpponentMaxBranches,
      exactOpponentPureHandSize: config.exactOpponentPureHandSize,
      exactMaxHandMinKnownVoids: config.exactMaxHandMinKnownVoids,
      rolloutMaxHandSize: config.rolloutMaxHandSize,
      rolloutExactHandoffHandSize: config.rolloutExactHandoffHandSize,
      rolloutExactNodeLimit: config.rolloutExactNodeLimit,
      trickLookaheadPlies: config.trickLookaheadPlies,
      trickLookaheadBranches: config.trickLookaheadBranches,
      trickLookaheadBlend: config.trickLookaheadBlend,
      searchStartTrick: config.searchStartTrick,
      openingOverrideMargin: config.openingOverrideMargin,
      heuristicOverrideMargin: config.heuristicOverrideMargin,
      heuristicOverrideZ: config.heuristicOverrideZ,
      earlyStopLead: config.earlyStopLead,
      sampleBudgetMode: config.sampleBudgetMode,
      beliefWeighting: config.beliefWeighting,
      adaptiveSampling: config.adaptiveSampling,
      adaptiveMinSamples: config.adaptiveMinSamples,
      adaptiveConfidenceZ: config.adaptiveConfidenceZ,
      adaptiveScoreMargin: config.adaptiveScoreMargin,
      informationSetIterations: config.informationSetIterations,
      informationSetTreePlies: config.informationSetTreePlies,
      informationSetMaxCandidates: config.informationSetMaxCandidates,
      informationSetTriggerMargin: config.informationSetTriggerMargin,
      informationSetExploration: config.informationSetExploration,
      informationSetBlend: config.informationSetBlend,
      riskAversion: config.riskAversion,
      rootAggregation: config.rootAggregation,
      rootCvarFraction: config.rootCvarFraction,
      evaluation: config.evaluation,
    })),
    rows: rows.map(({ total, ...row }) => row),
    aggregates: aggregateResults(results),
    leagueAggregates: aggregateLeagueResults(results),
    elapsedMs: performance.now() - startedAt,
    command: `node scripts/ai-tournament.mjs ${args.join(" ")}`.trim(),
  };
}

function createTournamentOptions(args) {
  const resolvedSeedGroup = resolveSeedGroup(getArgValue(args, "seed-group") ?? DEFAULT_TOURNAMENT_SEED_GROUP_ID);
  const explicitSeedSpec = getArgValue(args, "seeds");
  const seeds = parseSeedSpec(explicitSeedSpec, resolvedSeedGroup.seeds);
  const candidates = (getArgValue(args, "candidates") ?? `old-baseline,current,${CHALLENGER_ENGINE_ID}`)
    .split(",")
    .map((candidate) => candidate.trim())
    .filter(Boolean)
    .map(resolveEngineId);
  const opponents = expandOpponentEngineIds(getArgValue(args, "opponent"), {
    includeBothBaselines: hasFlag(args, "both-baselines") || hasFlag(args, "compare-baselines"),
  });

  const searchConfigs = parseSearchConfigs(args);
  const gamesPerSeed = getArgNumber(args, "games", resolvedSeedGroup.defaultGamesPerSeed ?? 10, 1);
  const rawWorkers = getArgValue(args, "workers") ?? (hasFlag(args, "parallel") ? "auto" : "1");

  return {
    seeds,
    seedGroup: explicitSeedSpec === null ? resolvedSeedGroup : null,
    candidates,
    opponents,
    searchConfigs,
    gamesPerSeed,
    rawWorkers,
    includeJson: !hasFlag(args, "no-json"),
    mustWinByBid: hasFlag(args, "must-win-by-bid") || getArgValue(args, "must-win-by-bid") === "true",
  };
}

function createTuningSearchConfigs(args, baseConfig) {
  const variants = [
    { label: "default", evaluation: {} },
    {
      label: "bid-pressure-plus",
      evaluation: {
        bidMadeStateReward: 55,
        bidNeedPenalty: 0.85,
        setStateReward: 105,
        trickMakesBidReward: 105,
        trickSetsBidReward: 130,
      },
    },
    {
      label: "trump-frugal",
      evaluation: {
        cardPointSpend: 0.6,
        trumpBaseSpend: 4,
        trumpHighSpend: 3,
      },
    },
    {
      label: "point-dump-plus",
      evaluation: {
        bidTeamPointReward: 1.5,
        bidTeamPointPenalty: 1.8,
        bidderLosePointPenalty: 1.55,
        defenderSetPointReward: 1.6,
      },
    },
    {
      label: "terminal-heavy",
      evaluation: {
        terminalEv: 1.15,
        bidMadeStateReward: 60,
        setStateReward: 115,
      },
    },
  ];
  const limit = getArgNumber(args, "tune-limit", variants.length, 1);

  return variants.slice(0, limit).map((variant) =>
    normalizeSearchConfig({
      ...baseConfig,
      label: variant.label,
      evaluation: {
        ...baseConfig.evaluation,
        ...variant.evaluation,
      },
    }),
  );
}

function bestAggregate(aggregates) {
  return [...aggregates].sort((a, b) => {
    const marginDiff = b.metrics.averageMargin - a.metrics.averageMargin;
    if (marginDiff !== 0) return marginDiff;
    return b.metrics.winRate - a.metrics.winRate;
  })[0];
}

async function runTournament(args, overrides = {}) {
  const options = {
    ...createTournamentOptions(args),
    ...overrides,
  };
  const jobs = createJobs({
    seeds: options.seeds,
    candidates: options.candidates,
    opponents: options.opponents,
    searchConfigs: options.searchConfigs,
    gamesPerSide: options.gamesPerSeed,
    mustWinByBid: options.mustWinByBid,
  });
  const workers = resolveWorkerCount(options.rawWorkers, jobs.length);
  const startedAt = performance.now();
  const results = await runJobs(jobs, workers);

  return summarizeResults({
    args,
    seedGroup: options.seedGroup,
    seeds: options.seeds,
    opponents: options.opponents,
    gamesPerSeed: options.gamesPerSeed,
    workers,
    searchConfigs: options.searchConfigs,
    results,
    startedAt,
  });
}

async function runTuning(args) {
  const baseSearchConfig = parseSearchConfigs(args)[0];
  const trainGroup = resolveSeedGroup(getArgValue(args, "train-group") ?? DEFAULT_TRAINING_SEED_GROUP_ID);
  const holdoutGroup = resolveSeedGroup(getArgValue(args, "holdout-group") ?? DEFAULT_HOLDOUT_SEED_GROUP_ID);
  const trainSeeds = parseSeedSpec(getArgValue(args, "train") ?? getArgValue(args, "tune-train"), trainGroup.seeds);
  const holdoutSeeds = parseSeedSpec(getArgValue(args, "holdout") ?? getArgValue(args, "tune-holdout"), holdoutGroup.seeds);
  const gamesPerSeed = getArgNumber(args, "games", trainGroup.defaultGamesPerSeed ?? 10, 1);
  const rawWorkers = getArgValue(args, "workers") ?? "auto";
  const searchConfigs = createTuningSearchConfigs(args, baseSearchConfig);

  if (holdoutGroup.role !== "public-validation" || !holdoutGroup.exposed) {
    throw new Error(`Tuning validation group ${holdoutGroup.id} must be marked as exposed public validation data.`);
  }
  assertDisjointSeedSets(trainSeeds, holdoutSeeds, "training", "holdout");

  console.log(`Training seed group: ${trainGroup.id}`);
  console.log(`Public validation seed group: ${holdoutGroup.id}`);
  console.log("Training search configs:");
  searchConfigs.forEach((config) => {
    console.log(`- ${config.label}: ${config.timeLimitMs} ms, ${config.samples} samples`);
  });

  const trainSummary = await runTournament(args, {
    seeds: trainSeeds,
    seedGroup: trainGroup,
    candidates: [CHALLENGER_ENGINE_ID],
    opponents: [CHAMPION_ENGINE_ID],
    searchConfigs,
    gamesPerSeed,
    rawWorkers,
    includeJson: false,
  });
  printTournamentSummary(trainSummary, { includeJson: false });

  const defaultAggregate = trainSummary.aggregates.find((aggregate) => aggregate.config === "default");
  const bestTrain = bestAggregate(trainSummary.aggregates);
  const bestConfig = searchConfigs.find((config) => config.label === bestTrain.config) ?? searchConfigs[0];
  const holdoutConfigs =
    bestConfig.label === "default"
      ? [bestConfig]
      : [searchConfigs.find((config) => config.label === "default") ?? searchConfigs[0], bestConfig];

  console.log("\nHoldout confirmation configs:");
  holdoutConfigs.forEach((config) => console.log(`- ${config.label}`));

  const holdoutSummary = await runTournament(args, {
    seeds: holdoutSeeds,
    seedGroup: holdoutGroup,
    candidates: ["old-baseline", "current", CHALLENGER_ENGINE_ID],
    opponents: [CHAMPION_ENGINE_ID],
    searchConfigs: holdoutConfigs,
    gamesPerSeed,
    rawWorkers,
    includeJson: false,
  });
  printTournamentSummary(holdoutSummary, { includeJson: false });

  const bestHoldout = holdoutSummary.aggregates.find(
    (aggregate) => aggregate.engine === CHALLENGER_ENGINE_ID && aggregate.config === bestConfig.label,
  );
  const defaultHoldout = holdoutSummary.aggregates.find(
    (aggregate) => aggregate.engine === CHALLENGER_ENGINE_ID && aggregate.config === "default",
  );
  const materialMarginGain =
    bestHoldout && defaultHoldout ? bestHoldout.metrics.averageMargin - defaultHoldout.metrics.averageMargin : 0;
  const accepted = bestConfig.label !== "default" && materialMarginGain >= 10;

  const tuningSummary = {
    train: trainSummary,
    holdout: holdoutSummary,
    bestConfig: {
      label: bestConfig.label,
      search: bestConfig,
      trainMetrics: bestTrain.metrics,
      holdoutMetrics: bestHoldout?.metrics ?? null,
    },
    defaultTrainMetrics: defaultAggregate?.metrics ?? null,
    defaultHoldoutMetrics: defaultHoldout?.metrics ?? null,
    accepted,
    acceptanceRule: "non-default config must improve holdout average margin by at least 10 points",
  };

  console.log("\nTuning result:");
  console.log(`Best train config: ${bestConfig.label}`);
  console.log(`Holdout material margin gain vs default: ${formatNumber(materialMarginGain, 1)}`);
  console.log(`Default update recommended: ${accepted ? "yes" : "no"}`);

  if (!hasFlag(args, "no-json")) {
    console.log("\nJSON tuning summary:");
    console.log(JSON.stringify(tuningSummary, null, 2));
  }

  return tuningSummary;
}

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  const args = process.argv.slice(2);

  if (hasFlag(args, "tune")) {
    await runTuning(args);
  } else {
    const summary = await runTournament(args);
    printTournamentSummary(summary, { includeJson: !hasFlag(args, "no-json") });
  }
}
