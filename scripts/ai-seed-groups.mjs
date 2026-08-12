export const AI_SEED_GROUPS = Object.freeze({
  "benchmark-smoke-2026-06": Object.freeze({
    id: "benchmark-smoke-2026-06",
    label: "Benchmark smoke seeds",
    role: "benchmark-smoke",
    locked: false,
    seeds: Object.freeze([20260618, 20260619, 20260620]),
    defaultGamesPerSeed: 10,
    description: "Short deterministic tournament suite retained for quick benchmark parity.",
  }),
  "tuning-training-2026-07": Object.freeze({
    id: "tuning-training-2026-07",
    label: "Tuning training seeds",
    role: "training",
    locked: false,
    seeds: Object.freeze([20260621, 20260622, 20260623, 20260624, 20260625, 20260626, 20260627, 20260628, 20260629, 20260630]),
    defaultGamesPerSeed: 10,
    description: "Seeds reserved for search-weight tuning and candidate iteration.",
  }),
  "tuning-training-2026-08-wave2": Object.freeze({
    id: "tuning-training-2026-08-wave2",
    label: "Second-wave tuning seeds",
    role: "training",
    locked: false,
    seeds: Object.freeze([20260821, 20260822, 20260823, 20260824, 20260825, 20260826, 20260827, 20260828, 20260829, 20260830]),
    defaultGamesPerSeed: 1,
    description: "Fresh training seeds reserved after the v4 public consideration screen; never use them as validation evidence.",
  }),
  "public-validation-2026-08": Object.freeze({
    id: "public-validation-2026-08",
    label: "Public regression validation seeds",
    role: "public-validation",
    locked: false,
    exposed: true,
    seeds: Object.freeze([
      20260811,
      20260812,
      20260813,
      20260814,
      20260815,
      20260816,
      20260817,
      20260818,
      20260819,
      20260820,
    ]),
    defaultGamesPerSeed: 10,
    minDecisionGames: 200,
    defaultGate: "consideration",
    search: Object.freeze({
      profile: "live",
    }),
    description: "Checked-in, exposed seeds for repeatable regressions. They are not a private promotion holdout.",
  }),
  "legacy-exposed-holdout-2026-07": Object.freeze({
    id: "legacy-exposed-holdout-2026-07",
    label: "Legacy exposed holdout seeds",
    role: "public-regression",
    locked: false,
    exposed: true,
    seeds: Object.freeze([20260702, 20260703, 20260704]),
    defaultGamesPerSeed: 2,
    description: "Former holdout seeds retained only for regression history after they were committed and exercised.",
  }),
});

export const DEFAULT_TOURNAMENT_SEED_GROUP_ID = "benchmark-smoke-2026-06";
export const DEFAULT_TRAINING_SEED_GROUP_ID = "tuning-training-2026-07";
export const DEFAULT_HOLDOUT_SEED_GROUP_ID = "public-validation-2026-08";
export const DEFAULT_BENCHMARK_SEED = AI_SEED_GROUPS[DEFAULT_TOURNAMENT_SEED_GROUP_ID].seeds[0];
export const DEFAULT_HOLDOUT_BENCHMARK_SEED = AI_SEED_GROUPS[DEFAULT_HOLDOUT_SEED_GROUP_ID].seeds[0];

export function parseSeedSpec(rawValue, fallbackSeeds = []) {
  const value =
    rawValue === null || rawValue === undefined || rawValue === ""
      ? Array.isArray(fallbackSeeds)
        ? fallbackSeeds.join(",")
        : String(fallbackSeeds ?? "")
      : String(rawValue);

  return value
    .split(",")
    .flatMap((part) => {
      const trimmed = part.trim();
      if (!trimmed) return [];
      const rangeMatch = trimmed.match(/^(\d+)-(\d+)$/);
      if (!rangeMatch) return [Number(trimmed)];

      const start = Number(rangeMatch[1]);
      const end = Number(rangeMatch[2]);
      const step = start <= end ? 1 : -1;
      const seeds = [];
      for (let seed = start; seed !== end + step; seed += step) {
        seeds.push(seed);
      }
      return seeds;
    })
    .filter((seed) => Number.isInteger(seed));
}

export function resolveSeedGroup(groupId = DEFAULT_TOURNAMENT_SEED_GROUP_ID) {
  const normalized = String(groupId || DEFAULT_TOURNAMENT_SEED_GROUP_ID).trim();
  const group = AI_SEED_GROUPS[normalized];
  if (!group) {
    throw new Error(`Unsupported seed group "${groupId}". Supported groups: ${Object.keys(AI_SEED_GROUPS).join(", ")}.`);
  }

  return group;
}

export function formatSeedSpec(seeds) {
  if (!seeds.length) return "";

  const ranges = [];
  let rangeStart = seeds[0];
  let previous = seeds[0];

  for (let index = 1; index <= seeds.length; index += 1) {
    const seed = seeds[index];
    if (seed === previous + 1) {
      previous = seed;
      continue;
    }

    ranges.push(rangeStart === previous ? String(rangeStart) : `${rangeStart}-${previous}`);
    rangeStart = seed;
    previous = seed;
  }

  return ranges.join(",");
}

export function assertDisjointSeedSets(leftSeeds, rightSeeds, leftLabel, rightLabel) {
  const rightSet = new Set(rightSeeds);
  const overlap = leftSeeds.filter((seed) => rightSet.has(seed));

  if (overlap.length > 0) {
    throw new Error(`${leftLabel} seeds overlap ${rightLabel} seeds: ${overlap.join(", ")}`);
  }
}

export function validateSeedGroups() {
  const training = resolveSeedGroup(DEFAULT_TRAINING_SEED_GROUP_ID);
  const validation = resolveSeedGroup(DEFAULT_HOLDOUT_SEED_GROUP_ID);

  if (validation.locked || validation.role !== "public-validation" || !validation.exposed) {
    throw new Error(`${validation.id} must be marked as exposed public validation data.`);
  }

  assertDisjointSeedSets(training.seeds, validation.seeds, training.id, validation.id);
  return true;
}
