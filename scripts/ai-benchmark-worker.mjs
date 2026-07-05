import { parentPort, workerData } from "node:worker_threads";
import { createBenchmarkStrategies } from "./ai-engines.mjs";
import { simulateBenchmarkRange } from "./ai-benchmark-sim.mjs";

try {
  const candidateEngine = workerData.candidateEngine ?? workerData.options?.candidateEngineId ?? workerData.options?.candidateMode;
  const opponentEngine = workerData.opponentEngine ?? workerData.options?.opponentEngineId;
  const strategies = createBenchmarkStrategies({ candidate: candidateEngine, opponent: opponentEngine });
  const total = simulateBenchmarkRange({
    startIndex: workerData.startIndex,
    gamesPerSide: workerData.gamesPerSide,
    seed: workerData.seed,
    strategies,
    options: workerData.options,
  });

  parentPort.postMessage({ ok: true, jobId: workerData.jobId, startIndex: workerData.startIndex, total });
} catch (error) {
  parentPort.postMessage({
    ok: false,
    error: {
      message: error.message,
      stack: error.stack,
    },
  });
}
