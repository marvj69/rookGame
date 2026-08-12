import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";

const expertDirectory = fileURLToPath(new URL("../benchmarks/expert/", import.meta.url));
const requireExpert = process.argv.includes("--require-expert");
const evidenceFiles = readdirSync(expertDirectory)
  .filter((file) => file.endsWith(".json") && file !== "scenario.schema.json")
  .sort();
const sourceIds = new Set();
const scenarioIds = new Set();
let scenarioCount = 0;

for (const file of evidenceFiles) {
  const payload = JSON.parse(readFileSync(path.join(expertDirectory, file), "utf8"));
  assert.equal(payload.schemaVersion, 1, `${file}: schemaVersion must be 1`);
  assert.equal(payload.source?.external, true, `${file}: source must be independently external`);
  assert.equal(typeof payload.source?.id, "string", `${file}: source id is required`);
  assert.ok(payload.source.id.trim(), `${file}: source id cannot be blank`);
  assert.equal(sourceIds.has(payload.source.id), false, `${file}: duplicate source id ${payload.source.id}`);
  sourceIds.add(payload.source.id);
  assert.ok(payload.source?.qualification?.trim(), `${file}: expert qualification is required`);
  if (payload.source.privateSourceCommitment !== null && payload.source.privateSourceCommitment !== undefined) {
    assert.match(
      payload.source.privateSourceCommitment,
      /^sha256:[a-f0-9]{64}$/,
      `${file}: private source commitment must be a lowercase SHA-256 digest`,
    );
  }
  assert.ok(payload.ruleset?.trim(), `${file}: exact ruleset is required`);
  assert.equal(typeof payload.consent?.aggregatePublication, "boolean", `${file}: consent flag is required`);
  assert.ok(Array.isArray(payload.scenarios) && payload.scenarios.length > 0, `${file}: scenarios are required`);

  payload.scenarios.forEach((scenario) => {
    assert.ok(scenario.id?.trim(), `${file}: scenario id is required`);
    assert.equal(scenarioIds.has(scenario.id), false, `${file}: duplicate scenario id ${scenario.id}`);
    scenarioIds.add(scenario.id);
    assert.ok(["bid", "kitty", "play"].includes(scenario.phase), `${file}: unsupported phase ${scenario.phase}`);
    assert.ok(scenario.publicState && typeof scenario.publicState === "object", `${file}: publicState is required`);
    assert.ok(Array.isArray(scenario.legalChoices) && scenario.legalChoices.length > 0, `${file}: legal choices are required`);
    assert.ok(Object.hasOwn(scenario, "expertChoice"), `${file}: expertChoice is required`);
    assert.ok(
      scenario.legalChoices.some((choice) => isDeepStrictEqual(choice, scenario.expertChoice)),
      `${file}: expertChoice must be one of legalChoices`,
    );
    scenarioCount += 1;
  });
}

if (requireExpert && evidenceFiles.length === 0) {
  throw new Error("No qualified external expert evidence files are present.");
}

console.log(
  evidenceFiles.length > 0
    ? `External expert evidence validation passed (${evidenceFiles.length} sources, ${scenarioCount} scenarios).`
    : "External expert evidence pipeline validation passed (0 sources; human-superhuman claims remain blocked).",
);
