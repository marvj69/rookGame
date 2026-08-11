import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, relative, resolve } from "node:path";
import { performance } from "node:perf_hooks";
import { fileURLToPath, pathToFileURL } from "node:url";
import {
  evaluateAdvancementGate,
  formatAdvancementGateReport,
  parseAdvancementGate,
} from "./ai-advancement-gates.mjs";
import {
  createBenchmarkFingerprint,
  createBenchmarkTotal,
  getBenchmarkMetrics,
  mergeBenchmarkTotals,
  parseBenchmarkArgs,
} from "./ai-benchmark-sim.mjs";
import { CHALLENGER_ENGINE_ID, CHAMPION_ENGINE_ID, resolveEngineId } from "./ai-engines.mjs";
import {
  DEFAULT_HOLDOUT_SEED_GROUP_ID,
  formatSeedSpec,
  parseSeedSpec,
  resolveSeedGroup,
  validateSeedGroups,
} from "./ai-seed-groups.mjs";
import { runBenchmark } from "./benchmark-ai.mjs";

export const HOLDOUT_RESULT = Object.freeze({
  PASS: "PASS",
  FAIL: "FAIL",
  NEEDS_MORE_GAMES: "NEEDS_MORE_GAMES",
});

const SEARCH_ARG_CONFIG = Object.freeze([
  ["search-ms", "timeLimitMs"],
  ["search-samples", "samples"],
  ["search-seed", "seed"],
  ["search-min-samples", "minSamples"],
  ["search-sample-attempts", "maxSampleAttempts"],
  ["search-endgame", "exactEndgameHandSize"],
  ["search-node-limit", "exactNodeLimit"],
]);
const PRIVATE_HOLDOUT_ENV = "ROOK_PRIVATE_HOLDOUT_FILE";
const PRIVATE_HOLDOUT_MIN_SEEDS = 20;
const PRIVATE_HOLDOUT_DEFAULT_GAMES_PER_SEED = 20;
const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function getArgValue(args, name) {
  const match = args.find((arg) => arg.startsWith(`--${name}=`));
  if (!match) return null;
  return match.slice(name.length + 3);
}

function hasFlag(args, name) {
  return args.includes(`--${name}`);
}

function getArgNumber(args, name, fallback, min = 1) {
  const rawValue = getArgValue(args, name);
  if (rawValue === null) return fallback;
  const value = Number(rawValue);
  return Number.isFinite(value) && value >= min ? value : fallback;
}

function createSearchArgs(args, defaults = {}) {
  return SEARCH_ARG_CONFIG.flatMap(([argName, configKey]) => {
    const rawValue = getArgValue(args, argName);
    const value = rawValue ?? defaults[configKey];
    return value === undefined || value === null ? [] : [`--${argName}=${value}`];
  });
}

function createBenchmarkOptionsForSeed(options, seed) {
  const benchmarkArgs = [
    `--mode=${options.gate.requiredBenchmarkMode}`,
    `--profile=${options.searchProfile}`,
    `--seed=${seed}`,
    `--games=${options.gamesPerSeed}`,
    `--candidate=${options.candidateEngineId}`,
    `--opponent=${options.opponentEngineId}`,
    ...options.searchArgs,
  ];

  if (options.rawWorkers === "auto") {
    benchmarkArgs.push("--parallel");
  } else if (options.rawWorkers) {
    benchmarkArgs.push(`--workers=${options.rawWorkers}`);
  }

  return parseBenchmarkArgs(benchmarkArgs);
}

function loadPrivateSeedSource(filePath) {
  const resolvedPath = resolve(filePath);
  const repositoryRelativePath = relative(PROJECT_ROOT, resolvedPath);
  const isInsideRepository = repositoryRelativePath === "" || (!repositoryRelativePath.startsWith("..") && !isAbsolute(repositoryRelativePath));
  if (isInsideRepository) {
    throw new Error("Private promotion seed files must be stored outside the repository.");
  }

  const raw = readFileSync(resolvedPath, "utf8");
  const normalized = raw.replace(/[\s;]+/g, ",");
  const seeds = [...new Set(parseSeedSpec(normalized, []))];

  if (seeds.length < PRIVATE_HOLDOUT_MIN_SEEDS) {
    throw new Error(
      `Private promotion holdout requires at least ${PRIVATE_HOLDOUT_MIN_SEEDS} distinct seeds; found ${seeds.length}.`,
    );
  }

  const commitment = createHash("sha256").update(seeds.join(",")).digest("hex");
  return {
    seeds,
    commitment,
    sourcePath: resolvedPath,
  };
}

export function createHoldoutOptions(args = process.argv.slice(2)) {
  validateSeedGroups();

  const privateSeedFile = getArgValue(args, "seed-file") ?? process.env[PRIVATE_HOLDOUT_ENV] ?? null;
  const privateSeedSource = privateSeedFile ? loadPrivateSeedSource(privateSeedFile) : null;
  const publicSeedGroup = privateSeedSource
    ? null
    : resolveSeedGroup(getArgValue(args, "seed-group") ?? DEFAULT_HOLDOUT_SEED_GROUP_ID);
  const seedGroup = privateSeedSource
    ? {
        id: `private-${privateSeedSource.commitment.slice(0, 12)}`,
        label: "Fresh private promotion holdout",
        role: "private-holdout",
        locked: true,
        exposed: false,
        seeds: privateSeedSource.seeds,
        defaultGamesPerSeed: PRIVATE_HOLDOUT_DEFAULT_GAMES_PER_SEED,
        minDecisionGames: PRIVATE_HOLDOUT_MIN_SEEDS * PRIVATE_HOLDOUT_DEFAULT_GAMES_PER_SEED * 2,
        defaultGate: "promotion",
        search: { profile: "live" },
      }
    : publicSeedGroup;
  const gate = parseAdvancementGate(getArgValue(args, "gate") ?? seedGroup.defaultGate ?? "consideration");
  if (!gate) {
    throw new Error("Holdout evaluation requires a promotion or consideration gate.");
  }
  if (gate.id === "promotion" && !privateSeedSource) {
    throw new Error(
      `Champion promotion requires a fresh private seed file via --seed-file or ${PRIVATE_HOLDOUT_ENV}; checked-in seeds are regression data only.`,
    );
  }

  const seeds = privateSeedSource ? privateSeedSource.seeds : parseSeedSpec(getArgValue(args, "seeds"), seedGroup.seeds);
  const gamesPerSeed = getArgNumber(args, "games", seedGroup.defaultGamesPerSeed ?? 1, 1);
  const expectedGames = seeds.length * gamesPerSeed * 2;
  const minimumRequiredGames = Math.max(seedGroup.minDecisionGames ?? expectedGames, gate.minGames ?? 1);
  const minDecisionGames = getArgNumber(args, "min-games", minimumRequiredGames, minimumRequiredGames);
  const candidateEngineId = resolveEngineId(getArgValue(args, "candidate") ?? CHALLENGER_ENGINE_ID);
  const opponentEngineId = resolveEngineId(getArgValue(args, "opponent") ?? CHAMPION_ENGINE_ID);
  const searchProfile = getArgValue(args, "profile") ?? seedGroup.search?.profile ?? "live";

  return {
    seedGroup,
    seeds,
    gamesPerSeed,
    minDecisionGames,
    candidateEngineId,
    opponentEngineId,
    gate,
    searchProfile,
    privateHoldout: Boolean(privateSeedSource),
    seedCommitment: privateSeedSource?.commitment ?? null,
    rawWorkers: getArgValue(args, "workers") ?? "auto",
    searchArgs: createSearchArgs(args, seedGroup.search),
    strict: hasFlag(args, "strict"),
    includeJson: hasFlag(args, "json"),
    outputPath: getArgValue(args, "output"),
  };
}

export function evaluateHoldoutResult({ total, elapsedMs, options }) {
  const metrics = getBenchmarkMetrics(total, elapsedMs);
  const gateReport = evaluateAdvancementGate({
    metrics,
    gate: options.gate,
    mode: options.gate.requiredBenchmarkMode,
    candidateEngineId: options.candidateEngineId,
    opponentEngineId: options.opponentEngineId,
    searchProfile: options.searchProfile,
    deterministicSearch: true,
  });
  const matchupCheck = gateReport.checks.find((check) => check.id === "matchup");
  const legalityCheck = gateReport.checks.find((check) => check.id === "legality");
  let status = HOLDOUT_RESULT.FAIL;
  let reason = "The challenger did not satisfy the holdout advancement gate.";

  if (!matchupCheck?.passed) {
    status = HOLDOUT_RESULT.FAIL;
    reason = "Holdout evaluation must compare challenger against the current champion.";
  } else if (!legalityCheck?.passed) {
    status = HOLDOUT_RESULT.FAIL;
    reason = "Illegal decisions are an immediate holdout failure.";
  } else if (metrics.games < options.minDecisionGames) {
    status = HOLDOUT_RESULT.NEEDS_MORE_GAMES;
    reason = `Only ${metrics.games} games completed; ${options.minDecisionGames} are required for this holdout decision.`;
  } else if (options.gate.id === "promotion" && !options.privateHoldout) {
    status = HOLDOUT_RESULT.FAIL;
    reason = "Champion promotion requires a fresh private holdout.";
  } else if (gateReport.passed) {
    status = HOLDOUT_RESULT.PASS;
    reason = "The challenger satisfied the holdout advancement gate.";
  }

  return {
    status,
    reason,
    metrics,
    gateReport,
    fingerprint: createBenchmarkFingerprint(total),
  };
}

export async function runHoldoutEvaluation(options = createHoldoutOptions(), { onSeedComplete = null } = {}) {
  const startedAt = performance.now();
  const total = createBenchmarkTotal();
  const seedResults = [];

  // Each benchmark already parallelizes its mirrored games. Running every seed
  // concurrently would multiply the worker count and make wall-clock behavior
  // dependent on machine load.
  for (const [seedIndex, seed] of options.seeds.entries()) {
    const result = await runBenchmark(createBenchmarkOptionsForSeed(options, seed));
    seedResults.push({ seed, result });
    onSeedComplete?.({ completed: seedIndex + 1, total: options.seeds.length });
  }

  seedResults
    .sort((a, b) => a.seed - b.seed)
    .forEach(({ result }) => {
      mergeBenchmarkTotals(total, result.total);
    });

  const elapsedMs = performance.now() - startedAt;
  const decision = evaluateHoldoutResult({ total, elapsedMs, options });

  return {
    options,
    total,
    elapsedMs,
    seedResults,
    decision,
  };
}

function pct(value) {
  return `${(value * 100).toFixed(1)}%`;
}

function formatNumber(value, digits = 1) {
  return Number.isFinite(value) ? value.toFixed(digits) : "0.0";
}

export function formatHoldoutReport(evaluation) {
  const { options, decision, elapsedMs } = evaluation;
  const lines = [
    `Holdout seed group: ${options.seedGroup.id} (${options.seedGroup.role}${options.privateHoldout ? ", private" : ", exposed"})`,
    options.privateHoldout
      ? `Holdout seeds: ${options.seeds.length} private seeds; SHA-256 commitment ${options.seedCommitment}`
      : `Validation seeds: ${formatSeedSpec(options.seeds)}`,
    `Candidate engine: ${options.candidateEngineId}`,
    `Opponent engine: ${options.opponentEngineId}`,
    `Gate: ${options.gate.id}`,
    `Search profile: ${options.searchProfile}`,
    `Games per seed per orientation: ${options.gamesPerSeed}`,
    `Minimum games for decision: ${options.minDecisionGames}`,
    `Search overrides: ${options.searchArgs.length ? options.searchArgs.join(" ") : "benchmark defaults"}`,
    `Total games: ${decision.metrics.games}`,
    `Win rate: ${decision.metrics.wins}/${decision.metrics.games} (${pct(decision.metrics.winRate)})`,
    `Average final margin: ${formatNumber(decision.metrics.averageMargin, 1)} points`,
    `Bid make rate: candidate ${pct(decision.metrics.candidateBidMakeRate)}, champion ${pct(decision.metrics.baselineBidMakeRate)}`,
    `Illegal move count: ${decision.metrics.illegalMoves} (bids ${decision.metrics.illegalBids}, discards ${decision.metrics.illegalDiscards}, plays ${decision.metrics.illegalPlays})`,
    `Elapsed time: ${formatNumber(elapsedMs / 1000, 1)}s`,
    `Holdout result: ${decision.status}`,
    `Reason: ${decision.reason}`,
    `Deterministic fingerprint: ${JSON.stringify(decision.fingerprint)}`,
    "",
    ...formatAdvancementGateReport(decision.gateReport, { includeRequiredCommands: false }),
  ];

  if (options.includeJson) {
    lines.push(
      "",
      "JSON holdout summary:",
      JSON.stringify(
        {
          seedGroup: {
            id: options.seedGroup.id,
            role: options.seedGroup.role,
            locked: options.seedGroup.locked,
            private: options.privateHoldout,
            commitment: options.seedCommitment,
          },
          seeds: options.privateHoldout ? undefined : options.seeds,
          gamesPerSeed: options.gamesPerSeed,
          minDecisionGames: options.minDecisionGames,
          candidate: options.candidateEngineId,
          opponent: options.opponentEngineId,
          gate: options.gate.id,
          status: decision.status,
          reason: decision.reason,
          metrics: decision.metrics,
          fingerprint: decision.fingerprint,
        },
        null,
        2,
      ),
    );
  }

  return lines;
}

export function createHoldoutArtifact(evaluation) {
  const { options, decision, elapsedMs, total } = evaluation;

  return {
    schemaVersion: 1,
    recordedAt: new Date().toISOString(),
    seedGroup: {
      id: options.seedGroup.id,
      role: options.seedGroup.role,
      exposed: !options.privateHoldout,
      commitment: options.seedCommitment,
      seedCount: options.seeds.length,
    },
    gamesPerSeedPerOrientation: options.gamesPerSeed,
    candidate: options.candidateEngineId,
    opponent: options.opponentEngineId,
    gate: options.gate.id,
    searchProfile: options.searchProfile,
    deterministicSearch: true,
    status: decision.status,
    reason: decision.reason,
    elapsedMs,
    metrics: decision.metrics,
    fingerprint: decision.fingerprint,
    categories: {
      rolePerformance: total.stats.rolePerformance,
      trickPerformance: total.stats.trickPerformance,
    },
  };
}

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  const options = createHoldoutOptions();
  const evaluation = await runHoldoutEvaluation(options, {
    onSeedComplete: ({ completed, total }) => {
      console.log(`Holdout batch completed: ${completed}/${total}`);
    },
  });
  console.log(formatHoldoutReport(evaluation).join("\n"));

  if (evaluation.options.outputPath) {
    const outputPath = resolve(evaluation.options.outputPath);
    writeFileSync(outputPath, `${JSON.stringify(createHoldoutArtifact(evaluation), null, 2)}\n`);
    console.log(`Holdout artifact: ${outputPath}`);
  }

  if (evaluation.options.strict && evaluation.decision.status !== HOLDOUT_RESULT.PASS) {
    process.exitCode = evaluation.decision.status === HOLDOUT_RESULT.NEEDS_MORE_GAMES ? 2 : 1;
  }
}
