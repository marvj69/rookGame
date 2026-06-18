import { availableParallelism } from "node:os";
import { performance } from "node:perf_hooks";
import { Worker } from "node:worker_threads";
import * as candidateAi from "../src/ai.js";
import * as baselineAi from "./current-ai-baseline.mjs";
import {
  createBenchmarkTotal,
  formatBenchmarkSummary,
  mergeBenchmarkTotals,
  parseBenchmarkArgs,
  simulateBenchmarkRange,
} from "./ai-benchmark-sim.mjs";

function resolveWorkerCount(requestedWorkerCount, gamesPerSide) {
  if (gamesPerSide <= 1) return 1;

  if (requestedWorkerCount === "auto") {
    return Math.max(1, Math.min(gamesPerSide, availableParallelism(), 8));
  }

  return Math.max(1, Math.min(gamesPerSide, Math.floor(requestedWorkerCount)));
}

function splitRanges(gamesPerSide, workerCount) {
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

function runWorker({ startIndex, gamesPerSide, seed }) {
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL("./ai-benchmark-worker.mjs", import.meta.url), {
      workerData: { startIndex, gamesPerSide, seed },
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

async function runParallelBenchmark({ seed, gamesPerSide, workerCount }) {
  const total = createBenchmarkTotal();
  const ranges = splitRanges(gamesPerSide, workerCount);
  const results = await Promise.all(ranges.map((range) => runWorker({ ...range, seed })));

  results
    .sort((a, b) => a.startIndex - b.startIndex)
    .forEach((result) => {
      mergeBenchmarkTotals(total, result.total);
    });

  return total;
}

const options = parseBenchmarkArgs();
const workerCount = resolveWorkerCount(options.workerCount, options.gamesPerSide);
const startedAt = performance.now();
const total =
  workerCount > 1
    ? await runParallelBenchmark({ ...options, workerCount })
    : simulateBenchmarkRange({
        seed: options.seed,
        gamesPerSide: options.gamesPerSide,
        strategies: { candidateAi, baselineAi },
      });
const elapsedMs = performance.now() - startedAt;

console.log(
  formatBenchmarkSummary({
    total,
    seed: options.seed,
    mode: options.mode,
    gamesPerSide: options.gamesPerSide,
    elapsedMs,
    workerCount,
  }).join("\n"),
);
