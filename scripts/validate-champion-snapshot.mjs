import assert from "node:assert/strict";
import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import { fileURLToPath } from "node:url";
import * as champion from "./champions/strong-search-2026-07-02.mjs";
import * as baselineAi from "./current-ai-baseline.mjs";
import { createBenchmarkFingerprint, simulateBenchmarkRange } from "./ai-benchmark-sim.mjs";
import { CHAMPION_ENGINE_ID, createBenchmarkStrategies } from "./ai-engines.mjs";
import { buildDeck, getLeadColor, isValidMove, sortHand } from "../src/game.js";

const rootDir = fileURLToPath(new URL("..", import.meta.url));
const championDir = fileURLToPath(new URL("./champions/strong-search-2026-07-02/", import.meta.url));
const championEntry = fileURLToPath(new URL("./champions/strong-search-2026-07-02.mjs", import.meta.url));
const deck = buildDeck();

function card(color, rank) {
  const foundCard = deck.find((candidate) => candidate.color === color && candidate.rank === rank);
  assert.ok(foundCard, `missing ${color} ${rank}`);
  return foundCard;
}

async function listSnapshotFiles(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  const files = [];

  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await listSnapshotFiles(fullPath)));
    } else if (entry.isFile() && /\.(mjs|js)$/.test(entry.name)) {
      files.push(fullPath);
    }
  }

  return files;
}

async function assertNoMovingAiImports() {
  const files = [championEntry, ...(await listSnapshotFiles(championDir))];
  const forbiddenPatterns = [
    /from\s+["'][^"']*src\/ai(?:\.js|\/)/,
    /from\s+["'](?:\.\.\/)+ai(?:\.js|\/)/,
    /import\(["'][^"']*src\/ai(?:\.js|\/)/,
    /new URL\(["'][^"']*src\/ai(?:\.js|\/)/,
  ];

  for (const file of files) {
    const source = await readFile(file, "utf8");
    const relativePath = relative(rootDir, file);
    for (const pattern of forbiddenPatterns) {
      assert.equal(pattern.test(source), false, `${relativePath} imports moving src/ai implementation`);
    }
  }
}

assert.equal(champion.championMetadata.id, "champion-2026-07-02");
assert.equal(champion.championMetadata.sourceCommit, "5a0dbcd");
assert.equal(champion.championMetadata.defaultSearchConfig.label, "default");
assert.equal(typeof champion.chooseBotBid, "function");
assert.equal(typeof champion.chooseBotKittyPlan, "function");
assert.equal(typeof champion.chooseBotPlay, "function");
assert.equal(typeof champion.evaluateSampledPlayCandidates, "function");
assert.equal(typeof champion.normalizeSearchConfig, "function");

await assertNoMovingAiImports();

const actingHand = sortHand([card("Red", 14), card("Red", 10), card("Black", 2), card("Yellow", 3)]);
const searchGame = {
  hands: [
    actingHand,
    new Array(4),
    new Array(4),
    new Array(4),
  ],
  trump: "Red",
  dealer: 0,
  currentTurn: 0,
  kittyPoints: 10,
  bidInfo: {
    active: false,
    highBid: 110,
    bidder: 0,
    passed: [false, false, false, false],
  },
  pointsTaken: { us: 70, them: 50 },
  tricks: [
    [
      { pid: 1, card: card("Green", 10) },
      { pid: 2, card: card("Yellow", 2) },
      { pid: 3, card: card("Green", 13) },
      { pid: 0, card: card("Green", 3) },
    ],
  ],
  currentTrick: [],
};

const searchOptions = champion.normalizeSearchConfig({
  seed: 20260702,
  samples: 3,
  minSamples: 2,
  timeLimitMs: 200,
});
const firstSearch = champion.evaluateSampledPlayCandidates(searchGame, 0, searchOptions);
const secondSearch = champion.evaluateSampledPlayCandidates(searchGame, 0, searchOptions);

assert.equal(firstSearch.usedFallback, false, "champion search should use sampled evaluations when budget allows");
assert.equal(firstSearch.card.id, secondSearch.card.id, "champion search choice is deterministic for a fixed seed");
assert.equal(
  isValidMove(firstSearch.card, actingHand, getLeadColor(searchGame.currentTrick, searchGame.trump), searchGame.trump),
  true,
  "champion search choice is legal",
);

const quickTotal = simulateBenchmarkRange({
  seed: 20260702,
  gamesPerSide: 1,
  strategies: { candidateAi: champion, baselineAi },
  options: {
    mode: "snapshot-validation",
    candidateMode: "current",
    gamesPerSide: 1,
    seed: 20260702,
    workerCount: 1,
    search: champion.normalizeSearchConfig({ seed: 20260702 }),
  },
});
const fingerprint = createBenchmarkFingerprint(quickTotal);

assert.equal(fingerprint.games, 2, "champion should run through benchmark simulation as an importable strategy");
assert.equal(fingerprint.illegalMoves, 0, "champion benchmark smoke should stay legal");

const championSelfOptions = {
  mode: "snapshot-validation",
  candidateMode: CHAMPION_ENGINE_ID,
  candidateEngineId: CHAMPION_ENGINE_ID,
  opponentEngineId: CHAMPION_ENGINE_ID,
  opponentEngineIds: [CHAMPION_ENGINE_ID],
  gamesPerSide: 1,
  seed: 20260702,
  workerCount: 1,
  search: champion.normalizeSearchConfig({
    seed: 20260702,
    samples: 1,
    minSamples: 1,
    timeLimitMs: 500,
  }),
};
const championSelfStrategies = createBenchmarkStrategies({
  candidate: CHAMPION_ENGINE_ID,
  opponent: CHAMPION_ENGINE_ID,
});
const firstChampionSelfTotal = simulateBenchmarkRange({
  seed: championSelfOptions.seed,
  gamesPerSide: championSelfOptions.gamesPerSide,
  strategies: championSelfStrategies,
  options: championSelfOptions,
});
const secondChampionSelfTotal = simulateBenchmarkRange({
  seed: championSelfOptions.seed,
  gamesPerSide: championSelfOptions.gamesPerSide,
  strategies: championSelfStrategies,
  options: championSelfOptions,
});
const firstChampionSelfFingerprint = createBenchmarkFingerprint(firstChampionSelfTotal);
const secondChampionSelfFingerprint = createBenchmarkFingerprint(secondChampionSelfTotal);

assert.deepEqual(
  secondChampionSelfFingerprint,
  firstChampionSelfFingerprint,
  "champion self-play fingerprint should be deterministic for fixed seeds",
);
assert.equal(firstChampionSelfFingerprint.games, 2, "champion self-play should run one mirrored game pair");
assert.equal(firstChampionSelfFingerprint.wins, 1, "champion self-play should split mirrored games 50/50");
assert.equal(firstChampionSelfFingerprint.margin, 0, "champion self-play mirrored margin should cancel out");
assert.equal(firstChampionSelfFingerprint.illegalMoves, 0, "champion self-play should stay legal");

console.log("Champion snapshot validation passed.");
