import { availableParallelism } from "node:os";
import { performance } from "node:perf_hooks";
import { pathToFileURL } from "node:url";
import { Worker } from "node:worker_threads";
import {
  evaluateAdvancementGate,
  formatAdvancementGateReport,
  parseAdvancementGate,
} from "./ai-advancement-gates.mjs";
import { createBenchmarkStrategies, getBenchmarkEngine } from "./ai-engines.mjs";
import {
  createBenchmarkTotal,
  formatBenchmarkSummary,
  getBenchmarkMetrics,
  mergeBenchmarkTotals,
  parseBenchmarkArgs,
  simulateBenchmarkRange,
} from "./ai-benchmark-sim.mjs";

export function resolveWorkerCount(requestedWorkerCount, gamesPerSide) {
  if (gamesPerSide <= 1) return 1;

  if (requestedWorkerCount === "auto") {
    return Math.max(1, Math.min(gamesPerSide, availableParallelism(), 8));
  }

  return Math.max(1, Math.min(gamesPerSide, Math.floor(requestedWorkerCount)));
}

export function splitRanges(gamesPerSide, workerCount) {
  const ranges = [];
  const baseSize = Math.floor(gamesPerSide / workerCount);
  const remainder = gamesPerSide % workerCount;
  let startIndex = 0;

  for (let workerIndex = 0; workerIndex < workerCount; workerIndex += 1) {
    const rangeSize = baseSize + (workerIndex < remainder ? 1 : 0);
    if (rangeSize > 0) {
      ranges.push({ startIndex, gamesPerSide: rangeSize });
    }
    startIndex += rangeSize;
  }

  return ranges;
}

export function runWorker({ startIndex, gamesPerSide, seed, options }) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./ai-benchmark-worker.mjs", import.meta.url), {
      workerData: { startIndex, gamesPerSide, seed, options },
    });

    worker.on("message", (message) => {
      if (message.ok) {
        resolve(message);
      } else {
        reject(new Error(message.error?.stack || message.error?.message || "Benchmark worker failed."));
      }
    });
    worker.on("error", reject);
    worker.on("exit", (code) => {
      if (code !== 0) {
        reject(new Error(`Benchmark worker exited with code ${code}.`));
      }
    });
  });
}

export async function runParallelBenchmark({ seed, gamesPerSide, workerCount, benchmarkOptions }) {
  const total = createBenchmarkTotal();
  const ranges = splitRanges(gamesPerSide, workerCount);
  const results = await Promise.all(ranges.map((range) => runWorker({ ...range, seed, options: benchmarkOptions })));

  results
    .sort((a, b) => a.startIndex - b.startIndex)
    .forEach((result) => {
      mergeBenchmarkTotals(total, result.total);
    });

  return total;
}

export async function runBenchmark(options = parseBenchmarkArgs()) {
  const workerCount = resolveWorkerCount(options.workerCount, options.gamesPerSide);
  const candidateEngine = getBenchmarkEngine(options.candidateEngineId ?? options.candidateMode);
  const opponentEngine = getBenchmarkEngine(options.opponentEngineId);
  const startedAt = performance.now();
  const total =
    workerCount > 1
      ? await runParallelBenchmark({ ...options, workerCount, benchmarkOptions: options })
      : simulateBenchmarkRange({
          seed: options.seed,
          gamesPerSide: options.gamesPerSide,
          strategies: createBenchmarkStrategies({
            candidate: candidateEngine.id,
            opponent: opponentEngine.id,
          }),
          options,
        });
  const elapsedMs = performance.now() - startedAt;
  const advancementGate = parseAdvancementGate(options.advancementGate);
  const gateReport = advancementGate
    ? evaluateAdvancementGate({
        metrics: getBenchmarkMetrics(total, elapsedMs),
        gate: advancementGate,
        mode: options.mode,
        candidateEngineId: candidateEngine.id,
        opponentEngineId: opponentEngine.id,
        searchProfile: options.searchProfile,
        deterministicSearch: options.deterministicSearch,
      })
    : null;

  return {
    total,
    elapsedMs,
    workerCount,
    options,
    candidateEngine,
    opponentEngine,
    gateReport,
  };
}

export async function runBenchmarkSuite(options = parseBenchmarkArgs()) {
  const opponentEngineIds = options.opponentEngineIds?.length ? options.opponentEngineIds : [options.opponentEngineId];
  const results = [];

  for (const opponentEngineId of opponentEngineIds) {
    results.push(await runBenchmark({ ...options, opponentEngineId }));
  }

  return results;
}

function isMainModule() {
  return process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
}

if (isMainModule()) {
  const results = await runBenchmarkSuite(parseBenchmarkArgs());
  let failedGate = false;

  results.forEach((result, index) => {
    const { total, elapsedMs, workerCount, options, candidateEngine, opponentEngine, gateReport } = result;
    if (index > 0) console.log("");
    console.log(
      formatBenchmarkSummary({
        total,
        seed: options.seed,
        mode: options.mode,
        candidateMode: options.candidateMode,
        candidate: candidateEngine.id,
        opponent: opponentEngine.id,
        gamesPerSide: options.gamesPerSide,
        elapsedMs,
        workerCount,
        search: options.search,
        searchProfile: options.searchProfile,
        deterministicSearch: options.deterministicSearch,
      }).join("\n"),
    );

    if (gateReport) {
      console.log("");
      console.log(formatAdvancementGateReport(gateReport).join("\n"));
      failedGate = failedGate || !gateReport.passed;
    }
  });

  if (failedGate) {
    process.exitCode = 1;
  }
}
