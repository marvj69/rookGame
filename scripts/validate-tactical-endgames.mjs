import assert from "node:assert/strict";
import { evaluateExactPlayCandidates } from "../src/ai/search.js";
import { buildDeck, getLeadColor, isValidMove, sortHand } from "../src/game.js";
import { TACTICAL_ENDGAME_FIXTURES } from "./fixtures/ai-tactical-endgames.mjs";

assert.ok(TACTICAL_ENDGAME_FIXTURES.length >= 8, "the tactical pack covers contract, defense, control, and effective-suit play");

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

function createRandom(seed) {
  let value = seed >>> 0;
  return () => {
    value += 0x6d2b79f5;
    let mixed = value;
    mixed = Math.imul(mixed ^ (mixed >>> 15), mixed | 1);
    mixed ^= mixed + Math.imul(mixed ^ (mixed >>> 7), mixed | 61);
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

const deck = buildDeck();
let baselineExactNodes = 0;
let optimizedExactNodes = 0;

for (let fixtureIndex = 0; fixtureIndex < 32; fixtureIndex += 1) {
  const random = createRandom(20260831 + fixtureIndex * 9973);
  const shuffled = [...deck];
  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }
  const game = {
    hands: [0, 1, 2, 3].map((playerId) => sortHand(shuffled.slice(playerId * 3, playerId * 3 + 3))),
    trump: ["Red", "Green", "Black", "Yellow"][fixtureIndex % 4],
    dealer: 0,
    currentTurn: 0,
    kittyPoints: 0,
    bidInfo: {
      active: false,
      highBid: 100 + (fixtureIndex % 6) * 5,
      bidder: fixtureIndex % 4,
      passed: [false, false, false, false],
      history: [],
    },
    pointsTaken: { us: (fixtureIndex % 5) * 5, them: (fixtureIndex % 7) * 5 },
    tricks: [],
    currentTrick: [],
    scores: { us: 0, them: 0 },
    settings: { mustWinByBid: false },
  };
  const baseline = evaluateExactPlayCandidates(game, 0, {
    exactNodeLimit: 1_000_000,
    exactPolicyOrdering: false,
    exactSequencePruning: false,
  });
  const optimized = evaluateExactPlayCandidates(game, 0, {
    exactNodeLimit: 1_000_000,
    exactPolicyOrdering: true,
    exactSequencePruning: true,
  });

  assert.equal(baseline.solved, true, `random exact fixture ${fixtureIndex}: baseline solves`);
  assert.equal(optimized.solved, true, `random exact fixture ${fixtureIndex}: optimized solver completes`);
  assert.deepEqual(
    optimized.candidates.map((candidate) => [candidate.card.id, candidate.score]),
    baseline.candidates.map((candidate) => [candidate.card.id, candidate.score]),
    `random exact fixture ${fixtureIndex}: pruning and move ordering preserve every root value`,
  );
  baselineExactNodes += baseline.candidates.reduce((sum, candidate) => sum + candidate.nodes, 0);
  optimizedExactNodes += optimized.candidates.reduce((sum, candidate) => sum + candidate.nodes, 0);
}

assert.ok(optimizedExactNodes < baselineExactNodes, "optimized exact solver reduces aggregate node count");

console.log(
  `Tactical endgame validation passed (${TACTICAL_ENDGAME_FIXTURES.length} authored + 32 equivalence fixtures; exact nodes ${baselineExactNodes} -> ${optimizedExactNodes}).`,
);
