import { createBenchmarkFingerprint, BENCHMARK_MODE_DEFAULT_GAMES, parseBenchmarkArgs } from "./ai-benchmark-sim.mjs";
import { runBenchmark } from "./benchmark-ai.mjs";

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
  const seed = getArgNumber(args, "seed", 20260618);
  const games = getArgNumber(args, "games", BENCHMARK_MODE_DEFAULT_GAMES.full);
  const rawWorkers = getArgValue(args, "workers");
  const benchmarkArgs = ["--full", `--seed=${seed}`, `--games=${games}`];

  if (rawWorkers) {
    benchmarkArgs.push(`--workers=${rawWorkers}`);
  }

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

  if (expectedFingerprint === null) {
    expectedFingerprint = fingerprint;
    continue;
  }

  if (fingerprint !== expectedFingerprint) {
    throw new Error(`Full benchmark run ${runIndex + 1} produced a different deterministic fingerprint.`);
  }
}

console.log("Full benchmark acceptance validation passed.");
