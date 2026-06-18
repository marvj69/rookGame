import assert from "node:assert/strict";
import {
  DISCARD_COUNT,
  buildDeck,
  canDiscardCard,
  canSatisfyKittyDiscardRule,
  createCard,
  isValidKittyDiscard,
  sortHand,
} from "../src/game.js";
import { chooseBotKittyPlan } from "../src/ai.js";

let nextId = 1000;

function card(color, rank) {
  const createdCard = createCard(color, rank, nextId);
  nextId += 1;
  return createdCard;
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

function shuffle(deck, random) {
  const shuffled = [...deck];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled;
}

const plentyOfNonPoints = [
  card("Red", 2),
  card("Red", 3),
  card("Green", 4),
  card("Green", 6),
  card("Black", 7),
  card("Yellow", 8),
  card("Red", 14),
  card("Green", 10),
];

assert.equal(
  isValidKittyDiscard(plentyOfNonPoints, plentyOfNonPoints.slice(0, DISCARD_COUNT), "Red"),
  true,
  "five non-point cards are a legal discard",
);
assert.equal(
  isValidKittyDiscard(
    plentyOfNonPoints,
    [plentyOfNonPoints[0], plentyOfNonPoints[1], plentyOfNonPoints[2], plentyOfNonPoints[3], plentyOfNonPoints[6]],
    "Red",
  ),
  false,
  "point cards are not legal when enough non-point cards are available",
);
assert.equal(
  canDiscardCard(plentyOfNonPoints[6], plentyOfNonPoints, "Red"),
  false,
  "a trump point card is still blocked when it is not needed",
);

const scarceNonPoints = [
  card("Red", 2),
  card("Green", 3),
  card("Black", 4),
  card("Red", 14),
  card("Red", 10),
  card("Green", 14),
  card("Yellow", 10),
];

assert.equal(canSatisfyKittyDiscardRule(scarceNonPoints, "Red"), true, "red trump can complete the discard");
assert.equal(canSatisfyKittyDiscardRule(scarceNonPoints, "Yellow"), false, "yellow trump cannot complete the discard");
assert.equal(canDiscardCard(scarceNonPoints[3], scarceNonPoints, "Red"), true, "trump points are legal as fallback");
assert.equal(canDiscardCard(scarceNonPoints[5], scarceNonPoints, "Red"), false, "non-trump points stay illegal");
assert.equal(
  isValidKittyDiscard(scarceNonPoints, scarceNonPoints.slice(0, DISCARD_COUNT), "Red"),
  true,
  "scarce non-point hands must use trump points to fill the discard",
);
assert.equal(
  isValidKittyDiscard(
    scarceNonPoints,
    [scarceNonPoints[0], scarceNonPoints[1], scarceNonPoints[3], scarceNonPoints[4], scarceNonPoints[5]],
    "Red",
  ),
  false,
  "all available non-point cards must be discarded before fallback trump points",
);

for (let seed = 1; seed <= 25; seed += 1) {
  const fullHand = sortHand(shuffle(buildDeck(), createRandom(seed)).slice(0, 18));
  const plan = chooseBotKittyPlan(fullHand);

  assert.equal(plan.discards.length, DISCARD_COUNT, `bot plan ${seed} discards five cards`);
  assert.equal(plan.hand.length, fullHand.length - DISCARD_COUNT, `bot plan ${seed} keeps the right hand size`);
  assert.equal(
    isValidKittyDiscard(fullHand, plan.discards, plan.trump),
    true,
    `bot plan ${seed} obeys the discard rule`,
  );
}

console.log("Discard rule validation passed.");
