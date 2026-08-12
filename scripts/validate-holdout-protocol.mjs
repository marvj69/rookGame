import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import {
  HOLDOUT_RESULT,
  createHoldoutArtifact,
  createHoldoutOptions,
  evaluateHoldoutResult,
  runHoldoutEvaluation,
} from "./ai-holdout-protocol.mjs";
import {
  DEFAULT_HOLDOUT_SEED_GROUP_ID,
  DEFAULT_TRAINING_SEED_GROUP_ID,
  resolveSeedGroup,
  validateSeedGroups,
} from "./ai-seed-groups.mjs";

assert.equal(validateSeedGroups(), true, "seed groups are valid");

const trainingGroup = resolveSeedGroup(DEFAULT_TRAINING_SEED_GROUP_ID);
const validationGroup = resolveSeedGroup(DEFAULT_HOLDOUT_SEED_GROUP_ID);
const trainingSeeds = new Set(trainingGroup.seeds);

assert.equal(validationGroup.locked, false, "checked-in validation seeds are not represented as private");
assert.equal(validationGroup.exposed, true, "checked-in validation seeds are explicitly exposed");
assert.equal(
  validationGroup.seeds.every((seed) => !trainingSeeds.has(seed)),
  true,
  "public validation seeds are separate from tuning seeds",
);
assert.throws(
  () => createHoldoutOptions([`--seed-group=${validationGroup.id}`, "--gate=promotion"]),
  /fresh private seed file/,
  "promotion cannot use checked-in public seeds",
);
assert.throws(
  () => createHoldoutOptions([`--seed-file=${fileURLToPath(import.meta.url)}`, "--gate=promotion"]),
  /outside the repository/,
  "private seed sources cannot be stored inside the worktree",
);

const deterministicArgs = [
  `--seed-group=${validationGroup.id}`,
  `--seeds=${validationGroup.seeds[0]}`,
  "--games=1",
  "--workers=1",
];
assert.equal(createHoldoutOptions(deterministicArgs).seedWorkers, 1, "holdout batches are sequential by default");
const first = await runHoldoutEvaluation(createHoldoutOptions(deterministicArgs));
const second = await runHoldoutEvaluation(createHoldoutOptions(deterministicArgs));
const artifact = createHoldoutArtifact(first);

assert.equal(first.decision.status, second.decision.status, "fixed holdout seeds produce the same holdout result");
assert.deepEqual(
  first.decision.fingerprint,
  second.decision.fingerprint,
  "fixed holdout seeds produce the same deterministic fingerprint",
);
assert.equal(
  first.decision.status,
  HOLDOUT_RESULT.NEEDS_MORE_GAMES,
  "small public validation samples cannot make an advancement decision",
);
assert.equal(Object.hasOwn(artifact, "seeds"), false, "durable holdout artifacts do not expose raw seeds");
assert.equal(artifact.seedGroup.seedCount, 1, "artifact records seed count without listing seed values");

const forwardedSearch = createHoldoutOptions([
  ...deterministicArgs,
  "--search-rollout-exact-handoff=4",
  "--search-rollout-exact-nodes=4321",
  "--exact-policy-ordering",
  "--exact-sequence-pruning",
  "--stratified-sampler",
  "--search-root-aggregation=borda",
]);
assert.equal(
  forwardedSearch.searchArgs.includes("--search-rollout-exact-handoff=4"),
  true,
  "holdout protocol forwards rollout exact handoff overrides",
);
assert.equal(
  forwardedSearch.searchArgs.includes("--search-rollout-exact-nodes=4321"),
  true,
  "holdout protocol forwards rollout exact node limits",
);
assert.equal(
  forwardedSearch.searchArgs.includes("--exact-policy-ordering"),
  true,
  "holdout protocol forwards exact ordering flags",
);
assert.equal(
  forwardedSearch.searchArgs.includes("--exact-sequence-pruning"),
  true,
  "holdout protocol forwards exact pruning flags",
);
assert.equal(forwardedSearch.searchArgs.includes("--stratified-sampler"), true, "holdout protocol forwards samplers");
assert.equal(
  forwardedSearch.searchArgs.includes("--search-root-aggregation=borda"),
  true,
  "holdout protocol forwards root aggregation",
);

const needsMoreDecision = evaluateHoldoutResult({
  total: first.total,
  elapsedMs: first.elapsedMs,
  options: {
    ...first.options,
    minDecisionGames: first.decision.metrics.games + 1,
  },
});

assert.equal(
  needsMoreDecision.status,
  HOLDOUT_RESULT.NEEDS_MORE_GAMES,
  "holdout protocol reports needs-more-games below the configured game count",
);

console.log("Holdout seed protocol validation passed.");
