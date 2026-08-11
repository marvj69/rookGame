import { buildDeck, sortHand } from "../../src/game.js";

const deck = buildDeck();

function card(color, rank) {
  const match = deck.find((candidate) => candidate.color === color && candidate.rank === rank);
  if (!match) throw new Error(`Missing fixture card ${color} ${rank}.`);
  return match;
}

function bidInfo(highBid = 120, bidder = 0) {
  return {
    active: false,
    highBid,
    bidder,
    passed: [false, false, false, false],
  };
}

export const TACTICAL_ENDGAME_FIXTURES = Object.freeze([
  Object.freeze({
    id: "bidder-captures-contract-points",
    label: "Bidder spends the ace to capture contract points",
    actingPlayer: 0,
    expectedCard: Object.freeze({ color: "Red", rank: 14 }),
    rationale: "Taking the 30-point trick is the only line that reaches the contract before the final trick.",
    game: Object.freeze({
      kittyPoints: 0,
      trump: "Red",
      dealer: 0,
      currentTurn: 0,
      bidInfo: bidInfo(),
      pointsTaken: Object.freeze({ us: 90, them: 40 }),
      tricks: Object.freeze([]),
      currentTrick: Object.freeze([
        Object.freeze({ pid: 1, card: card("Red", 10) }),
        Object.freeze({ pid: 2, card: card("Red", 2) }),
        Object.freeze({ pid: 3, card: card("Red", 5) }),
      ]),
      hands: Object.freeze([
        Object.freeze(sortHand([card("Red", 14), card("Red", 3)])),
        Object.freeze([card("Black", 2)]),
        Object.freeze([card("Black", 3)]),
        Object.freeze([card("Black", 4)]),
      ]),
    }),
  }),
  Object.freeze({
    id: "defender-takes-setting-trick",
    label: "Defender overtakes the bidder to preserve the set",
    actingPlayer: 1,
    expectedCard: Object.freeze({ color: "Black", rank: 14 }),
    rationale: "The defender must overtake the bidder's king; ducking lets the contract team escape the set.",
    game: Object.freeze({
      kittyPoints: 0,
      trump: "Red",
      dealer: 0,
      currentTurn: 1,
      bidInfo: bidInfo(),
      pointsTaken: Object.freeze({ us: 115, them: 30 }),
      tricks: Object.freeze([]),
      currentTrick: Object.freeze([
        Object.freeze({ pid: 2, card: card("Black", 5) }),
        Object.freeze({ pid: 3, card: card("Black", 2) }),
        Object.freeze({ pid: 0, card: card("Black", 13) }),
      ]),
      hands: Object.freeze([
        Object.freeze([card("Yellow", 2)]),
        Object.freeze(sortHand([card("Black", 14), card("Black", 3)])),
        Object.freeze([card("Yellow", 3)]),
        Object.freeze([card("Yellow", 4)]),
      ]),
    }),
  }),
  Object.freeze({
    id: "trump-contract-swing",
    label: "Bidder trumps a point-rich off-suit trick",
    actingPlayer: 0,
    expectedCard: Object.freeze({ color: "Red", rank: 14 }),
    rationale: "Trumping captures the exposed 15 and 10; discarding leaves the contract short.",
    game: Object.freeze({
      kittyPoints: 5,
      trump: "Red",
      dealer: 0,
      currentTurn: 0,
      bidInfo: bidInfo(),
      pointsTaken: Object.freeze({ us: 90, them: 35 }),
      tricks: Object.freeze([]),
      currentTrick: Object.freeze([
        Object.freeze({ pid: 1, card: card("Yellow", 10) }),
        Object.freeze({ pid: 2, card: card("Yellow", 5) }),
        Object.freeze({ pid: 3, card: card("Yellow", 13) }),
      ]),
      hands: Object.freeze([
        Object.freeze(sortHand([card("Red", 14), card("Black", 2)])),
        Object.freeze([card("Green", 2)]),
        Object.freeze([card("Green", 3)]),
        Object.freeze([card("Green", 4)]),
      ]),
    }),
  }),
]);
