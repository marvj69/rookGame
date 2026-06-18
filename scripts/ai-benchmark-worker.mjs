import { parentPort, workerData } from "node:worker_threads";
import * as candidateAi from "../src/ai.js";
import * as baselineAi from "./current-ai-baseline.mjs";
import { simulateBenchmarkRange } from "./ai-benchmark-sim.mjs";

try {
  const total = simulateBenchmarkRange({
    startIndex: workerData.startIndex,
    gamesPerSide: workerData.gamesPerSide,
    seed: workerData.seed,
    strategies: { candidateAi, baselineAi },
    options: workerData.options,
  });

  parentPort.postMessage({ ok: true, startIndex: workerData.startIndex, total });
} catch (error) {
  parentPort.postMessage({
    ok: false,
    error: {
      message: error.message,
      stack: error.stack,
    },
  });
}
