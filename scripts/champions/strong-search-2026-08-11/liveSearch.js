import { DEFAULT_SEARCH_CONFIG } from "./config.js";

export const AI_STRENGTH_FAST = "fast";
export const AI_STRENGTH_STRONG = "strong";
export const STRONG_AI_RESPONSE_TIMEOUT_MS = 5000;
export const STRONG_AI_TIMEOUT_STORAGE_KEY = "rook.strongAiTimeoutMs";

export function normalizeAiStrength(value) {
  return value === AI_STRENGTH_STRONG ? AI_STRENGTH_STRONG : AI_STRENGTH_FAST;
}

export function createPublicSearchView(state, playerId) {
  return {
    ...state,
    kitty: [],
    hands: state.hands.map((hand, handPlayerId) => {
      if (handPlayerId === playerId) return [...hand];
      return new Array(hand.length);
    }),
    bidInfo: {
      ...state.bidInfo,
      passed: [...state.bidInfo.passed],
    },
    tricks: state.tricks.map((trick) => trick.map((play) => ({ ...play }))),
    currentTrick: state.currentTrick.map((play) => ({ ...play })),
    pointsTaken: { ...state.pointsTaken },
    scores: { ...state.scores },
    settings: { ...state.settings },
  };
}

function mixSeed(seed, value) {
  return Math.imul(seed ^ value, 16777619) >>> 0;
}

export function deriveStrongAiSeed(publicState, playerId) {
  const publicCardIds = [
    ...(publicState.hands[playerId] ?? []).map((card) => card.id),
    ...publicState.tricks.flatMap((trick) => trick.map((play) => play.card.id)),
    ...publicState.currentTrick.map((play) => play.card.id),
  ];
  let seed = mixSeed(DEFAULT_SEARCH_CONFIG.seed, playerId + 1);
  seed = mixSeed(seed, publicState.roundsCompleted ?? 0);
  seed = mixSeed(seed, publicState.tricks.length);
  seed = mixSeed(seed, publicState.currentTrick.length);
  seed = mixSeed(seed, publicState.pointsTaken.us ?? 0);
  seed = mixSeed(seed, publicState.pointsTaken.them ?? 0);
  seed = mixSeed(seed, publicState.bidInfo?.highBid ?? 0);

  publicCardIds.forEach((cardId) => {
    seed = mixSeed(seed, cardId + 31);
  });

  return seed || DEFAULT_SEARCH_CONFIG.seed;
}

export function getStrongAiResponseTimeoutMs() {
  if (typeof window === "undefined") return STRONG_AI_RESPONSE_TIMEOUT_MS;

  const queryOverride = new URLSearchParams(window.location.search).get("strongAiTimeoutMs");
  let storedOverride = null;

  try {
    storedOverride = window.localStorage.getItem(STRONG_AI_TIMEOUT_STORAGE_KEY);
  } catch {
    storedOverride = null;
  }

  const overrideValue = queryOverride ?? storedOverride;
  if (overrideValue === null || overrideValue === "") return STRONG_AI_RESPONSE_TIMEOUT_MS;

  const override = Number(overrideValue);
  return Number.isFinite(override) && override >= 0 ? override : STRONG_AI_RESPONSE_TIMEOUT_MS;
}

export function createStrongAiWorker() {
  return new Worker(new URL("./searchWorker.js", import.meta.url), { type: "module" });
}
