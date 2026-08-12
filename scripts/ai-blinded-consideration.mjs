import { randomInt } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import {
  HOLDOUT_RESULT,
  createHoldoutArtifact,
  createHoldoutOptions,
  formatHoldoutReport,
  runHoldoutEvaluation,
} from "./ai-holdout-protocol.mjs";

const PRIVATE_SEED_COUNT = 20;
const GAMES_PER_SEED_PER_ORIENTATION = 5;

function getArgValue(name) {
  const prefix = `--${name}=`;
  return process.argv.slice(2).find((arg) => arg.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function createPrivateSeeds(count) {
  const seeds = new Set();
  while (seeds.size < count) {
    seeds.add(randomInt(1, 2_147_483_647));
  }
  return [...seeds];
}

const outputPath = resolve(
  getArgValue("output") ?? `benchmarks/blinded-consideration-${new Date().toISOString().slice(0, 10)}.json`,
);
const temporaryDirectory = mkdtempSync(join(tmpdir(), "rook-blinded-consideration-"));
const seedFile = join(temporaryDirectory, "private-seeds.txt");
let cleanedUp = false;

function cleanupTemporaryDirectory() {
  if (cleanedUp) return;
  cleanedUp = true;
  rmSync(temporaryDirectory, { recursive: true, force: true });
}

const terminationSignals = Object.freeze([
  ["SIGINT", 2],
  ["SIGTERM", 15],
  ["SIGHUP", 1],
]);
terminationSignals.forEach(([signal, number]) => {
  process.once(signal, () => {
    cleanupTemporaryDirectory();
    process.exit(128 + number);
  });
});

try {
  // Raw seeds exist only in this temporary file. Console output and the durable
  // artifact expose only the count and SHA-256 commitment.
  writeFileSync(seedFile, `${createPrivateSeeds(PRIVATE_SEED_COUNT).join("\n")}\n`, { mode: 0o600 });
  const options = createHoldoutOptions([
    `--seed-file=${seedFile}`,
    "--gate=consideration",
    `--games=${GAMES_PER_SEED_PER_ORIENTATION}`,
    "--min-games=200",
    "--candidate=challenger",
    "--opponent=champion-2026-08-11",
    "--profile=live",
    "--seed-workers=auto",
    "--workers=2",
  ]);
  const evaluation = await runHoldoutEvaluation(options, {
    onSeedComplete: ({ completed, total }) => {
      console.log(`Blinded batch completed: ${completed}/${total}`);
    },
  });

  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(createHoldoutArtifact(evaluation), null, 2)}\n`);
  console.log(formatHoldoutReport(evaluation).join("\n"));
  console.log(`Blinded artifact: ${outputPath}`);

  if (evaluation.decision.status !== HOLDOUT_RESULT.PASS) process.exitCode = 1;
} finally {
  cleanupTemporaryDirectory();
}
