import assert from "node:assert/strict";
import {
  evaluateTerminalRound,
  evaluateTrickDecision,
  getCardSpendCost,
} from "../src/ai/evaluation.js";
import { buildDeck, sortHand } from "../src/game.js";

const deck = buildDeck();

function card(color, rank) {
  const foundCard = deck.find((candidate) => candidate.color === color && candidate.rank === rank);
  assert.ok(foundCard, `missing ${color} ${rank}`);
  return foundCard;
}

function baseGame(overrides = {}) {
  return {
    hands: [[], [], [], []],
    trump: "Red",
    dealer: 0,
    kittyPoints: 0,
    pointsTaken: { us: 0, them: 0 },
    bidInfo: {
      active: false,
      highBid: 120,
      bidder: 0,
      passed: [false, false, false, false],
    },
    currentTrick: [],
    tricks: [],
    ...overrides,
  };
}

{
  const madeBid = baseGame({ pointsTaken: { us: 120, them: 60 } });
  const missedBid = baseGame({ pointsTaken: { us: 115, them: 65 } });

  assert.ok(
    evaluateTerminalRound(madeBid, 0) - evaluateTerminalRound(missedBid, 0) >= 220,
    "making the bid is heavily rewarded",
  );
}

{
  const setBidTeam = baseGame({ pointsTaken: { us: 95, them: 85 } });
  const opponentView = evaluateTerminalRound(setBidTeam, 1);
  const bidderView = evaluateTerminalRound(setBidTeam, 0);

  assert.ok(opponentView - bidderView >= 350, "setting the bidding team is heavily rewarded");
}

{
  const highTrump = card("Red", 14);
  const lowCard = card("Black", 2);
  const game = baseGame();
  const wasteCost = getCardSpendCost(highTrump, game);
  const lowCost = getCardSpendCost(lowCard, game);
  const criticalCost = getCardSpendCost(highTrump, game, { outcomeCritical: true });
  const lowerTrumpSpendCost = getCardSpendCost(highTrump, game, { weights: { trumpHighSpend: 0 } });

  assert.ok(wasteCost > lowCost + 15, "wasting high trump is penalized");
  assert.equal(criticalCost, 0, "high trump cost is waived when it changes bid/set outcome");
  assert.ok(lowerTrumpSpendCost < wasteCost, "evaluation weight overrides affect trump spend cost");
}

{
  const pointCard = card("Green", 10);
  const game = baseGame({
    bidInfo: { active: false, highBid: 120, bidder: 1, passed: [false, false, false, false] },
    pointsTaken: { us: 30, them: 100 },
    hands: [sortHand([pointCard]), [], [], []],
  });
  const partnerScore = evaluateTrickDecision(game, 1, {
    winner: 3,
    points: 25,
    card: pointCard,
  });
  const opponentScore = evaluateTrickDecision(game, 1, {
    winner: 0,
    points: 25,
    card: pointCard,
  });

  assert.ok(partnerScore > 0, "dumping points to partner is rewarded");
  assert.ok(opponentScore < 0, "dumping points to opponent is penalized");
  assert.ok(partnerScore - opponentScore > 100, "partner dump is much better than opponent dump");
}

console.log("Evaluation validation passed.");
