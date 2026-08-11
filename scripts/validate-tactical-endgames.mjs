import assert from "node:assert/strict";
import { evaluateExactPlayCandidates } from "../src/ai/search.js";
import { getLeadColor, isValidMove } from "../src/game.js";
import { TACTICAL_ENDGAME_FIXTURES } from "./fixtures/ai-tactical-endgames.mjs";

assert.ok(TACTICAL_ENDGAME_FIXTURES.length >= 3, "the tactical pack contains contract and defense fixtures");

for (const fixture of TACTICAL_ENDGAME_FIXTURES) {
  const result = evaluateExactPlayCandidates(fixture.game, fixture.actingPlayer, { exactNodeLimit: 100_000 });
  const expectedCard = fixture.game.hands[fixture.actingPlayer].find(
    (card) => card.color === fixture.expectedCard.color && card.rank === fixture.expectedCard.rank,
  );

  assert.ok(expectedCard, `${fixture.id}: expected card is present`);
  assert.equal(result.solved, true, `${fixture.id}: exhaustive endgame search completes`);
  assert.ok(result.card, `${fixture.id}: exhaustive search returns a card`);
  assert.equal(result.card.id, expectedCard.id, `${fixture.id}: ${fixture.rationale}`);
  assert.equal(
    isValidMove(
      result.card,
      fixture.game.hands[fixture.actingPlayer],
      getLeadColor(fixture.game.currentTrick, fixture.game.trump),
      fixture.game.trump,
    ),
    true,
    `${fixture.id}: exact choice is legal`,
  );
}

console.log(`Tactical endgame validation passed (${TACTICAL_ENDGAME_FIXTURES.length} fixtures).`);
