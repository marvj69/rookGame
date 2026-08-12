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
  Object.freeze({
    id: "cash-points-under-partner-winner",
    label: "Contract team cashes a point card under its partner's ace",
    actingPlayer: 0,
    expectedCard: Object.freeze({ color: "Green", rank: 10 }),
    rationale: "The ten is safe under the partner's ace now; saving it feeds the opponents on the final trick.",
    game: Object.freeze({
      kittyPoints: 0,
      trump: "Red",
      dealer: 0,
      currentTurn: 0,
      bidInfo: bidInfo(110, 0),
      pointsTaken: Object.freeze({ us: 85, them: 55 }),
      tricks: Object.freeze([]),
      currentTrick: Object.freeze([
        Object.freeze({ pid: 1, card: card("Green", 5) }),
        Object.freeze({ pid: 2, card: card("Green", 14) }),
        Object.freeze({ pid: 3, card: card("Green", 3) }),
      ]),
      hands: Object.freeze([
        Object.freeze(sortHand([card("Green", 10), card("Green", 2)])),
        Object.freeze([card("Black", 3)]),
        Object.freeze([card("Black", 2)]),
        Object.freeze([card("Black", 14)]),
      ]),
    }),
  }),
  Object.freeze({
    id: "duck-to-retain-second-round-control",
    label: "Defender ducks behind its partner to retain the ace",
    actingPlayer: 1,
    expectedCard: Object.freeze({ color: "Yellow", rank: 3 }),
    rationale: "The partner already owns this trick, so ducking keeps the ace to beat the opponent's queen next.",
    game: Object.freeze({
      kittyPoints: 0,
      trump: "Red",
      dealer: 0,
      currentTurn: 1,
      bidInfo: bidInfo(120, 0),
      pointsTaken: Object.freeze({ us: 105, them: 35 }),
      tricks: Object.freeze([]),
      currentTrick: Object.freeze([
        Object.freeze({ pid: 2, card: card("Yellow", 2) }),
        Object.freeze({ pid: 3, card: card("Yellow", 13) }),
        Object.freeze({ pid: 0, card: card("Yellow", 10) }),
      ]),
      hands: Object.freeze([
        Object.freeze([card("Yellow", 12)]),
        Object.freeze(sortHand([card("Yellow", 14), card("Yellow", 3)])),
        Object.freeze([card("Yellow", 4)]),
        Object.freeze([card("Yellow", 5)]),
      ]),
    }),
  }),
  Object.freeze({
    id: "rook-must-follow-effective-trump",
    label: "Rook follows an effective trump lead",
    actingPlayer: 1,
    expectedCard: Object.freeze({ color: "ROOK", rank: 0 }),
    rationale: "The Rook belongs to the trump suit and is the only legal way to follow the red lead.",
    game: Object.freeze({
      kittyPoints: 0,
      trump: "Red",
      dealer: 0,
      currentTurn: 1,
      bidInfo: bidInfo(115, 1),
      pointsTaken: Object.freeze({ us: 70, them: 65 }),
      tricks: Object.freeze([]),
      currentTrick: Object.freeze([Object.freeze({ pid: 0, card: card("Red", 2) })]),
      hands: Object.freeze([
        Object.freeze([card("Green", 2)]),
        Object.freeze(sortHand([card("ROOK", 0), card("Black", 14)])),
        Object.freeze([card("Red", 3), card("Green", 3)]),
        Object.freeze([card("Red", 4), card("Green", 4)]),
      ]),
    }),
  }),
  Object.freeze({
    id: "preserve-trump-under-partner-winner",
    label: "Bidder preserves trump and feeds a ten to its partner",
    actingPlayer: 0,
    expectedCard: Object.freeze({ color: "Black", rank: 10 }),
    rationale: "The partner is already winning, so the ten scores now while the low trump remains available for the final trick.",
    game: Object.freeze({
      kittyPoints: 0,
      trump: "Red",
      dealer: 0,
      currentTurn: 0,
      bidInfo: bidInfo(115, 0),
      pointsTaken: Object.freeze({ us: 90, them: 40 }),
      tricks: Object.freeze([]),
      currentTrick: Object.freeze([
        Object.freeze({ pid: 1, card: card("Green", 2) }),
        Object.freeze({ pid: 2, card: card("Green", 14) }),
        Object.freeze({ pid: 3, card: card("Green", 3) }),
      ]),
      hands: Object.freeze([
        Object.freeze(sortHand([card("Red", 2), card("Black", 10)])),
        Object.freeze([card("Red", 14)]),
        Object.freeze([card("Yellow", 2)]),
        Object.freeze([card("Yellow", 14)]),
      ]),
    }),
  }),
  Object.freeze({
    id: "win-with-cheapest-control",
    label: "Defender wins with the queen and saves the ace",
    actingPlayer: 1,
    expectedCard: Object.freeze({ color: "Black", rank: 12 }),
    rationale: "The queen wins the current trick and preserves the ace to beat the opponent's king on the last trick.",
    game: Object.freeze({
      kittyPoints: 0,
      trump: "Red",
      dealer: 0,
      currentTurn: 1,
      bidInfo: bidInfo(120, 0),
      pointsTaken: Object.freeze({ us: 110, them: 30 }),
      tricks: Object.freeze([]),
      currentTrick: Object.freeze([
        Object.freeze({ pid: 2, card: card("Black", 5) }),
        Object.freeze({ pid: 3, card: card("Black", 2) }),
        Object.freeze({ pid: 0, card: card("Black", 11) }),
      ]),
      hands: Object.freeze([
        Object.freeze([card("Black", 13)]),
        Object.freeze(sortHand([card("Black", 14), card("Black", 12)])),
        Object.freeze([card("Black", 10)]),
        Object.freeze([card("Black", 4)]),
      ]),
    }),
  }),
]);
