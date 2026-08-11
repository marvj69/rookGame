import { CHALLENGER_ENGINE_ID, CHAMPION_ENGINE_ID } from "./ai-engines.mjs";
import { DEFAULT_HOLDOUT_BENCHMARK_SEED } from "./ai-seed-groups.mjs";
import { wilsonScoreInterval } from "./ai-statistics.mjs";

export const ADVANCEMENT_GATE_IDS = Object.freeze({
  CONSIDERATION: "consideration",
  PROMOTION: "promotion",
});

const QUICK_CHAMPION_BENCHMARK_COMMAND = `npm run ai:benchmark -- --mode=quick --profile=live --candidate=${CHALLENGER_ENGINE_ID} --opponent=${CHAMPION_ENGINE_ID} --parallel --seed=${DEFAULT_HOLDOUT_BENCHMARK_SEED}`;
const STANDARD_CONSIDERATION_COMMAND = `npm run ai:benchmark -- --mode=standard --profile=live --candidate=${CHALLENGER_ENGINE_ID} --opponent=${CHAMPION_ENGINE_ID} --gate=consideration --parallel --seed=${DEFAULT_HOLDOUT_BENCHMARK_SEED}`;
const FULL_PROMOTION_BENCHMARK_COMMAND = `npm run ai:benchmark:acceptance -- --profile=live --candidate=${CHALLENGER_ENGINE_ID} --opponent=${CHAMPION_ENGINE_ID} --gate=promotion --workers=auto --seed=${DEFAULT_HOLDOUT_BENCHMARK_SEED}`;
const PRIVATE_HOLDOUT_PROMOTION_COMMAND = `ROOK_PRIVATE_HOLDOUT_FILE=/absolute/path/to/fresh-seeds.txt npm run ai:holdout -- --candidate=${CHALLENGER_ENGINE_ID} --opponent=${CHAMPION_ENGINE_ID} --gate=promotion --workers=auto --strict`;

export const PROMOTION_VALIDATION_COMMANDS = Object.freeze([
  "npm test",
  "npm run build",
  QUICK_CHAMPION_BENCHMARK_COMMAND,
  STANDARD_CONSIDERATION_COMMAND,
  FULL_PROMOTION_BENCHMARK_COMMAND,
  PRIVATE_HOLDOUT_PROMOTION_COMMAND,
  "npm run test:browser",
]);

export const ADVANCEMENT_GATES = Object.freeze({
  [ADVANCEMENT_GATE_IDS.CONSIDERATION]: Object.freeze({
    id: ADVANCEMENT_GATE_IDS.CONSIDERATION,
    label: "Standard improvement consideration",
    requiredBenchmarkMode: "standard",
    requiredCandidate: CHALLENGER_ENGINE_ID,
    requiredOpponent: CHAMPION_ENGINE_ID,
    requiredSearchProfile: "live",
    requiredDeterministicSearch: true,
    minGames: 200,
    minWinRate: 0.55,
    minWinRateLowerBound: 0.5,
    minAverageMargin: 0,
    maxBidMakeRateDrop: 0.05,
    minDefensibleBidMakeRate: 0.5,
    requiredCommands: Object.freeze([
      "npm test",
      STANDARD_CONSIDERATION_COMMAND,
    ]),
  }),
  [ADVANCEMENT_GATE_IDS.PROMOTION]: Object.freeze({
    id: ADVANCEMENT_GATE_IDS.PROMOTION,
    label: "Champion promotion",
    requiredBenchmarkMode: "full",
    requiredCandidate: CHALLENGER_ENGINE_ID,
    requiredOpponent: CHAMPION_ENGINE_ID,
    requiredSearchProfile: "live",
    requiredDeterministicSearch: true,
    minGames: 800,
    minWinRate: 0.58,
    minWinRateLowerBound: 0.54,
    minAverageMargin: 0,
    maxBidMakeRateDrop: 0.03,
    minDefensibleBidMakeRate: 0.55,
    requiredCommands: PROMOTION_VALIDATION_COMMANDS,
  }),
});

const GATE_ALIASES = Object.freeze({
  improvement: ADVANCEMENT_GATE_IDS.CONSIDERATION,
  consider: ADVANCEMENT_GATE_IDS.CONSIDERATION,
  consideration: ADVANCEMENT_GATE_IDS.CONSIDERATION,
  holdout: ADVANCEMENT_GATE_IDS.CONSIDERATION,
  standard: ADVANCEMENT_GATE_IDS.CONSIDERATION,
  promote: ADVANCEMENT_GATE_IDS.PROMOTION,
  promotion: ADVANCEMENT_GATE_IDS.PROMOTION,
  champion: ADVANCEMENT_GATE_IDS.PROMOTION,
  full: ADVANCEMENT_GATE_IDS.PROMOTION,
});

function pct(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function signedPct(value) {
  const formatted = pct(Math.abs(value));
  return value < 0 ? `-${formatted}` : formatted;
}

function check(id, label, passed, detail) {
  return { id, label, passed, detail };
}

export function parseAdvancementGate(rawValue) {
  if (rawValue === null || rawValue === undefined || rawValue === "" || rawValue === false) return null;

  const normalized = String(rawValue).trim().toLowerCase();
  if (!normalized || ["0", "false", "none", "off"].includes(normalized)) return null;

  const gateId = GATE_ALIASES[normalized] ?? normalized;
  const gate = ADVANCEMENT_GATES[gateId];
  if (!gate) {
    throw new Error(`Unsupported advancement gate "${rawValue}". Use "consideration", "promotion", or "none".`);
  }

  return gate;
}

export function evaluateAdvancementGate({
  metrics,
  gate,
  mode,
  candidateEngineId,
  opponentEngineId,
  searchProfile,
  deterministicSearch,
}) {
  const resolvedGate = typeof gate === "string" ? parseAdvancementGate(gate) : gate;
  if (!resolvedGate) return null;

  const illegalBids = metrics.illegalBids ?? 0;
  const illegalDiscards = metrics.illegalDiscards ?? 0;
  const illegalPlays = metrics.illegalPlays ?? 0;
  const totalIllegalMoves = metrics.illegalMoves ?? illegalBids + illegalDiscards + illegalPlays;
  const bidMakeRateDrop = metrics.baselineBidMakeRate - metrics.candidateBidMakeRate;
  const bidMakeRateDefensible =
    metrics.candidateBidMakeRate >= metrics.baselineBidMakeRate ||
    (bidMakeRateDrop <= resolvedGate.maxBidMakeRateDrop &&
      metrics.candidateBidMakeRate >= resolvedGate.minDefensibleBidMakeRate);
  const winRateInterval = wilsonScoreInterval(metrics.wins, metrics.games);

  const checks = [
    check(
      "matchup",
      "Champion matchup",
      candidateEngineId === resolvedGate.requiredCandidate && opponentEngineId === resolvedGate.requiredOpponent,
      `${candidateEngineId} vs ${opponentEngineId}; required ${resolvedGate.requiredCandidate} vs ${resolvedGate.requiredOpponent}`,
    ),
    check(
      "mode",
      "Benchmark suite",
      mode === resolvedGate.requiredBenchmarkMode,
      `${mode}; required ${resolvedGate.requiredBenchmarkMode}`,
    ),
    check(
      "search-profile",
      "Shipped search profile",
      searchProfile === resolvedGate.requiredSearchProfile,
      `${searchProfile ?? "unspecified"}; required ${resolvedGate.requiredSearchProfile}`,
    ),
    check(
      "deterministic-search",
      "Fixed-work strength sampling",
      deterministicSearch === resolvedGate.requiredDeterministicSearch,
      `${deterministicSearch ? "enabled" : "disabled"}; required enabled`,
    ),
    check(
      "sample-size",
      "Game count",
      metrics.games >= resolvedGate.minGames,
      `${metrics.games} games; required at least ${resolvedGate.minGames}`,
    ),
    check(
      "legality",
      "Legal decisions",
      totalIllegalMoves === 0 && illegalBids === 0 && illegalDiscards === 0 && illegalPlays === 0,
      `${illegalBids} illegal bids, ${illegalDiscards} illegal discards, ${illegalPlays} illegal plays`,
    ),
    check(
      "win-rate",
      "Win rate",
      metrics.winRate >= resolvedGate.minWinRate,
      `${pct(metrics.winRate)}; required at least ${pct(resolvedGate.minWinRate)}`,
    ),
    check(
      "win-rate-confidence",
      "95% win-rate lower bound",
      winRateInterval.low >= resolvedGate.minWinRateLowerBound,
      `${pct(winRateInterval.low)}-${pct(winRateInterval.high)}; lower bound must be at least ${pct(
        resolvedGate.minWinRateLowerBound,
      )}`,
    ),
    check(
      "average-margin",
      "Average margin",
      metrics.averageMargin >= resolvedGate.minAverageMargin,
      `${metrics.averageMargin.toFixed(1)} points/game; required at least ${resolvedGate.minAverageMargin.toFixed(1)}`,
    ),
    check(
      "bid-make-rate",
      "Bid make rate",
      bidMakeRateDefensible,
      `candidate ${pct(metrics.candidateBidMakeRate)}, champion ${pct(metrics.baselineBidMakeRate)}, drop ${signedPct(
        Math.max(0, bidMakeRateDrop),
      )}; allowed drop ${pct(resolvedGate.maxBidMakeRateDrop)} with candidate at least ${pct(
        resolvedGate.minDefensibleBidMakeRate,
      )}`,
    ),
  ];

  return {
    gate: resolvedGate,
    passed: checks.every((result) => result.passed),
    checks,
    requiredCommands: resolvedGate.requiredCommands,
  };
}

export function formatAdvancementGateReport(report, { includeRequiredCommands = true } = {}) {
  if (!report) return [];

  const lines = [
    `Advancement gate: ${report.gate.label} (${report.gate.id})`,
    `Gate result: ${report.passed ? "PASS" : "FAIL"}`,
    ...report.checks.map((result) => `- ${result.passed ? "PASS" : "FAIL"} ${result.label}: ${result.detail}`),
  ];

  if (includeRequiredCommands && report.requiredCommands?.length) {
    lines.push("Required validation before champion promotion:");
    report.requiredCommands.forEach((command) => {
      lines.push(`- ${command}`);
    });
  }

  return lines;
}
