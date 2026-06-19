import { chooseBotPlay } from "../ai.js";
import { LIVE_SEARCH_CONFIG, normalizeSearchConfig } from "./config.js";
import { evaluateSampledPlayCandidates } from "./search.js";

function now() {
  return globalThis.performance?.now?.() ?? Date.now();
}

self.onmessage = (event) => {
  const receivedAt = now();
  const { type, requestId, game, playerId, seed } = event.data ?? {};

  if (type === "warm") {
    self.postMessage({
      ok: true,
      type: "warm",
      receivedAt,
      workerElapsedMs: now() - receivedAt,
    });
    return;
  }
  if (type !== "play") return;

  try {
    const config = normalizeSearchConfig({
      ...LIVE_SEARCH_CONFIG,
      seed: seed ?? LIVE_SEARCH_CONFIG.seed,
    });
    const fallbackStartedAt = now();
    const fallbackCard = chooseBotPlay(game, playerId);
    const fallbackElapsedMs = now() - fallbackStartedAt;
    const result = evaluateSampledPlayCandidates(game, playerId, {
      ...config,
      fallbackCard,
      policy: chooseBotPlay,
    });
    const completedAt = now();

    self.postMessage({
      ok: true,
      type: "play",
      requestId,
      card: result.card ?? fallbackCard,
      usedFallback: result.usedFallback,
      reason: result.reason,
      samplesUsed: result.samplesUsed,
      elapsedMs: result.elapsedMs,
      fallbackElapsedMs,
      receivedAt,
      completedAt,
      workerElapsedMs: completedAt - receivedAt,
      profile: result.profile,
    });
  } catch (error) {
    self.postMessage({
      ok: false,
      type: "play",
      requestId,
      error: error instanceof Error ? error.message : String(error),
      receivedAt,
      workerElapsedMs: now() - receivedAt,
    });
  }
};
