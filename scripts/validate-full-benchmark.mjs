import { createBenchmarkFingerprint, BENCHMARK_MODE_DEFAULT_GAMES, parseBenchmarkArgs } from "./ai-benchmark-sim.mjs";
import { formatAdvancementGateReport } from "./ai-advancement-gates.mjs";
import { runBenchmark } from "./benchmark-ai.mjs";
import { DEFAULT_BENCHMARK_SEED } from "./ai-seed-groups.mjs";

function getArgValue(args, name) {
  const match = args.find((arg) => arg.startsWith(`--${name}=`));
  if (!match) return null;
  return match.slice(name.length + 3);
}

function getArgNumber(args, name, fallback, min = 1) {
  const rawValue = getArgValue(args, name);
  if (rawValue === null) return fallback;
  const value = Number(rawValue);
  return Number.isFinite(value) && value >= min ? value : fallback;
}

function formatSeconds(ms) {
  return `${(ms / 1000).toFixed(1)}s`;
}

function createFullBenchmarkOptions(args) {
  const seed = getArgNumber(args, "seed", DEFAULT_BENCHMARK_SEED);
  const games = getArgNumber(args, "games", BENCHMARK_MODE_DEFAULT_GAMES.full);
  const rawWorkers = getArgValue(args, "workers");
  const candidate = getArgValue(args, "candidate");
  const opponent = getArgValue(args, "opponent");
  const gate = getArgValue(args, "gate");
  const benchmarkArgs = ["--full", `--seed=${seed}`, `--games=${games}`];
  const forwardedArgs = [
    "profile",
    "search-ms",
    "search-samples",
    "search-seed",
    "search-min-samples",
    "search-sample-attempts",
    "search-endgame",
    "search-node-limit",
    "search-rollout-max-hand",
    "search-early-stop",
  ];

  if (rawWorkers) {
    benchmarkArgs.push(`--workers=${rawWorkers}`);
  }
  if (candidate) {
    benchmarkArgs.push(`--candidate=${candidate}`);
  }
  if (opponent) {
    benchmarkArgs.push(`--opponent=${opponent}`);
  }
  if (gate) {
    benchmarkArgs.push(`--gate=${gate}`);
  }
  forwardedArgs.forEach((name) => {
    const value = getArgValue(args, name);
    if (value !== null) benchmarkArgs.push(`--${name}=${value}`);
  });

  return parseBenchmarkArgs(benchmarkArgs);
}

const args = process.argv.slice(2);
const runs = getArgNumber(args, "runs", 2);
const maxElapsedMs = getArgNumber(args, "max-ms", 120_000);
const options = createFullBenchmarkOptions(args);
let expectedFingerprint = null;

console.log(`Full benchmark acceptance seed: ${options.seed}`);
console.log(`Games per orientation: ${options.gamesPerSide}`);
console.log(`Runs: ${runs}`);
console.log(`Max elapsed per run: ${formatSeconds(maxElapsedMs)}`);

for (let runIndex = 0; runIndex < runs; runIndex += 1) {
  const result = await runBenchmark(options);
  const fingerprint = JSON.stringify(createBenchmarkFingerprint(result.total));

  console.log(
    `Run ${runIndex + 1}/${runs}: ${formatSeconds(result.elapsedMs)}, workers ${result.workerCount}, wins ${
      result.total.wins
    }/${result.total.games}, margin ${(result.total.margin / result.total.games).toFixed(1)}, illegal ${
      result.total.stats.illegalMoves
    }`,
  );

  if (result.elapsedMs > maxElapsedMs) {
    throw new Error(
      `Full benchmark run ${runIndex + 1} took ${formatSeconds(result.elapsedMs)}, above ${formatSeconds(maxElapsedMs)}.`,
    );
  }

  if (result.total.stats.illegalMoves > 0) {
    throw new Error(
      `Full benchmark run ${runIndex + 1} had illegal decisions: ${JSON.stringify(result.total.stats.illegal)}.`,
    );
  }

  if (result.gateReport) {
    console.log(formatAdvancementGateReport(result.gateReport, { includeRequiredCommands: runIndex === 0 }).join("\n"));
    if (!result.gateReport.passed) {
      throw new Error(`Full benchmark run ${runIndex + 1} failed the ${result.gateReport.gate.id} advancement gate.`);
    }
  }

  if (expectedFingerprint === null) {
    expectedFingerprint = fingerprint;
    continue;
  }

  if (fingerprint !== expectedFingerprint) {
    throw new Error(`Full benchmark run ${runIndex + 1} produced a different deterministic fingerprint.`);
  }
}

console.log("Full benchmark acceptance validation passed.");
