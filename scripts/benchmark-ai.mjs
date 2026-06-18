import * as candidateAi from "../src/ai.js";
import {
  BID_START,
  buildDeck,
  completeRoundScore,
  getCardPower,
  getLeadColor,
  isValidKittyDiscard,
  isValidMove,
  sortHand,
  teamForPlayer,
} from "../src/game.js";
import * as legacyAi from "./legacy-ai.mjs";

const TARGET_SCORE = 500;
const MAX_BID = 150;
const MAX_ROUNDS_PER_GAME = 60;

function getArgNumber(name, fallback) {
  const match = process.argv.find((arg) => arg.startsWith(`--${name}=`));
  if (!match) return fallback;
  const value = Number(match.split("=")[1]);
  return Number.isFinite(value) && value > 0 ? value : fallback;
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

function dealRound(random) {
  const deck = shuffle(buildDeck(), random);
  const kitty = deck.slice(0, 5);
  const hands = [[], [], [], []];
  let dealIndex = 5;

  for (let player = 0; player < 4; player += 1) {
    hands[player] = sortHand(deck.slice(dealIndex, dealIndex + 13));
    dealIndex += 13;
  }

  return { kitty, hands };
}

function strategyLabelForPlayer(playerId, candidateTeam) {
  return teamForPlayer(playerId) === candidateTeam ? "candidate" : "legacy";
}

function getStrategy(playerId, candidateTeam) {
  return strategyLabelForPlayer(playerId, candidateTeam) === "candidate" ? candidateAi : legacyAi;
}

function createGame(seed) {
  const random = createRandom(seed);

  return {
    random,
    state: {
      kitty: [],
      kittyPoints: 0,
      hands: [[], [], [], []],
      scores: { us: 0, them: 0 },
      dealer: Math.floor(random() * 4),
      currentTurn: 0,
      bidInfo: {
        active: false,
        highBid: 0,
        bidder: null,
        passed: [false, false, false, false],
      },
      trump: null,
      tricks: [],
      currentTrick: [],
      pointsTaken: { us: 0, them: 0 },
      settings: { mustWinByBid: false },
    },
  };
}

function prepareRound(game) {
  const { kitty, hands } = dealRound(game.random);
  const state = game.state;

  state.kitty = kitty;
  state.hands = hands;
  state.kittyPoints = 0;
  state.trump = null;
  state.pointsTaken = { us: 0, them: 0 };
  state.currentTrick = [];
  state.tricks = [];
  state.bidInfo = {
    active: true,
    highBid: BID_START,
    bidder: null,
    passed: [false, false, false, false],
  };
  state.dealer = (state.dealer + 1) % 4;
  state.currentTurn = (state.dealer + 1) % 4;
}

function advanceTurn(state) {
  state.currentTurn = (state.currentTurn + 1) % 4;
}

function runBidding(state, candidateTeam, stats) {
  let guard = 0;

  while (state.bidInfo.passed.filter((hasPassed) => !hasPassed).length > 1) {
    guard += 1;
    if (guard > 80) throw new Error("Bidding did not terminate.");

    if (state.bidInfo.passed[state.currentTurn]) {
      advanceTurn(state);
      continue;
    }

    const strategy = getStrategy(state.currentTurn, candidateTeam);
    const amount = strategy.chooseBotBid(state, state.currentTurn, MAX_BID);
    const label = strategyLabelForPlayer(state.currentTurn, candidateTeam);

    if (amount > 0) {
      state.bidInfo.highBid = amount;
      state.bidInfo.bidder = state.currentTurn;
      state.bidInfo.passed[state.currentTurn] = false;
      stats.bids[label] += 1;
    } else {
      state.bidInfo.passed[state.currentTurn] = true;
    }

    advanceTurn(state);
  }

  const winner = state.bidInfo.bidder ?? state.dealer;
  state.bidInfo.highBid = Math.max(100, state.bidInfo.highBid);
  state.bidInfo.bidder = winner;
  state.hands[winner] = sortHand([...state.hands[winner], ...state.kitty]);
  stats.roundBids[strategyLabelForPlayer(winner, candidateTeam)] += 1;

  return winner;
}

function chooseKitty(state, winner, candidateTeam) {
  const strategy = getStrategy(winner, candidateTeam);
  const plan = strategy.chooseBotKittyPlan(state.hands[winner]);

  if (!isValidKittyDiscard(state.hands[winner], plan.discards, plan.trump)) {
    throw new Error(`Strategy ${strategyLabelForPlayer(winner, candidateTeam)} returned an illegal kitty discard.`);
  }

  state.hands[winner] = plan.hand;
  state.kittyPoints = plan.discards.reduce((sum, card) => sum + card.value, 0);
  state.trump = plan.trump;
  state.currentTurn = winner;
}

function playCard(state, playerId, candidateTeam) {
  const strategy = getStrategy(playerId, candidateTeam);
  const hand = state.hands[playerId];
  const leadColor = getLeadColor(state.currentTrick, state.trump);
  const validCards = hand.filter((card) => isValidMove(card, hand, leadColor, state.trump));
  const choice = strategy.chooseBotPlay(state, playerId);

  if (!choice) throw new Error(`Strategy ${strategyLabelForPlayer(playerId, candidateTeam)} returned no card.`);

  const isValid = validCards.length === 0 || validCards.some((card) => card.id === choice.id);
  if (!isValid) {
    throw new Error(`Strategy ${strategyLabelForPlayer(playerId, candidateTeam)} returned an illegal card.`);
  }

  const cardIndex = hand.findIndex((card) => card.id === choice.id);
  if (cardIndex < 0) throw new Error("Strategy returned a card that is not in hand.");

  const [card] = hand.splice(cardIndex, 1);
  state.currentTrick.push({ pid: playerId, card });
  advanceTurn(state);
}

function resolveTrick(state) {
  const leadColor = getLeadColor(state.currentTrick, state.trump);
  let bestIndex = 0;
  let bestPower = getCardPower(state.currentTrick[0].card, state.trump, leadColor);
  let points = 0;

  state.currentTrick.forEach((play, index) => {
    points += play.card.value;

    if (index === 0) return;

    const power = getCardPower(play.card, state.trump, leadColor);
    if (power > bestPower) {
      bestPower = power;
      bestIndex = index;
    }
  });

  const winner = state.currentTrick[bestIndex].pid;
  state.pointsTaken[teamForPlayer(winner)] += points;
  state.tricks.push(state.currentTrick.map((play) => ({ ...play })));
  state.currentTrick = [];
  state.currentTurn = winner;
}

function playRound(state, candidateTeam, stats) {
  const bidder = runBidding(state, candidateTeam, stats);
  chooseKitty(state, bidder, candidateTeam);

  while (state.hands[0].length > 0) {
    while (state.currentTrick.length < 4) {
      playCard(state, state.currentTurn, candidateTeam);
    }

    resolveTrick(state);
  }

  const roundScore = completeRoundScore(state);
  state.pointsTaken = roundScore.pointsTaken;
  state.scores.us += roundScore.scoreChange.us;
  state.scores.them += roundScore.scoreChange.them;

  const bidLabel = strategyLabelForPlayer(roundScore.bidTeam === "us" ? 0 : 1, candidateTeam);
  const bidMade = roundScore.scoreChange[roundScore.bidTeam] >= 0;
  if (bidMade) {
    stats.madeBids[bidLabel] += 1;
  } else {
    stats.failedBids[bidLabel] += 1;
  }

  stats.rounds += 1;
  stats.roundScore.candidate += roundScore.scoreChange[candidateTeam];
  stats.roundScore.legacy += roundScore.scoreChange[candidateTeam === "us" ? "them" : "us"];
}

function simulateGame(seed, candidateTeam) {
  const game = createGame(seed);
  const stats = {
    rounds: 0,
    bids: { candidate: 0, legacy: 0 },
    roundBids: { candidate: 0, legacy: 0 },
    madeBids: { candidate: 0, legacy: 0 },
    failedBids: { candidate: 0, legacy: 0 },
    roundScore: { candidate: 0, legacy: 0 },
  };

  while (
    Math.max(game.state.scores.us, game.state.scores.them) < TARGET_SCORE &&
    stats.rounds < MAX_ROUNDS_PER_GAME
  ) {
    prepareRound(game);
    playRound(game.state, candidateTeam, stats);
  }

  const candidateScore = game.state.scores[candidateTeam];
  const legacyScore = game.state.scores[candidateTeam === "us" ? "them" : "us"];

  return {
    candidateTeam,
    candidateScore,
    legacyScore,
    candidateWon: candidateScore > legacyScore,
    margin: candidateScore - legacyScore,
    stats,
  };
}

function mergeStats(total, next) {
  total.rounds += next.rounds;
  total.bids.candidate += next.bids.candidate;
  total.bids.legacy += next.bids.legacy;
  total.roundBids.candidate += next.roundBids.candidate;
  total.roundBids.legacy += next.roundBids.legacy;
  total.madeBids.candidate += next.madeBids.candidate;
  total.madeBids.legacy += next.madeBids.legacy;
  total.failedBids.candidate += next.failedBids.candidate;
  total.failedBids.legacy += next.failedBids.legacy;
  total.roundScore.candidate += next.roundScore.candidate;
  total.roundScore.legacy += next.roundScore.legacy;
}

function pct(numerator, denominator) {
  return denominator === 0 ? "0.0%" : `${((numerator / denominator) * 100).toFixed(1)}%`;
}

const gamesPerSide = getArgNumber("games", 200);
const seed = getArgNumber("seed", 20260618);
const total = {
  games: 0,
  wins: 0,
  margin: 0,
  stats: {
    rounds: 0,
    bids: { candidate: 0, legacy: 0 },
    roundBids: { candidate: 0, legacy: 0 },
    madeBids: { candidate: 0, legacy: 0 },
    failedBids: { candidate: 0, legacy: 0 },
    roundScore: { candidate: 0, legacy: 0 },
  },
};

for (let index = 0; index < gamesPerSide; index += 1) {
  for (const candidateTeam of ["us", "them"]) {
    const gameSeed = seed + index * 97;
    const result = simulateGame(gameSeed, candidateTeam);
    total.games += 1;
    total.wins += result.candidateWon ? 1 : 0;
    total.margin += result.margin;
    mergeStats(total.stats, result.stats);
  }
}

const candidateBidDecisions = total.stats.madeBids.candidate + total.stats.failedBids.candidate;
const legacyBidDecisions = total.stats.madeBids.legacy + total.stats.failedBids.legacy;

console.log(`AI benchmark seed: ${seed}`);
console.log(`Games per orientation: ${gamesPerSide}`);
console.log(`Total games: ${total.games}`);
console.log(`Candidate wins: ${total.wins}/${total.games} (${pct(total.wins, total.games)})`);
console.log(`Average final margin: ${(total.margin / total.games).toFixed(1)} points`);
console.log(`Rounds played: ${total.stats.rounds}`);
console.log(
  `Round score average: candidate ${(total.stats.roundScore.candidate / total.stats.rounds).toFixed(1)}, legacy ${(
    total.stats.roundScore.legacy / total.stats.rounds
  ).toFixed(1)}`,
);
console.log(
  `Bids won: candidate ${total.stats.roundBids.candidate}, legacy ${total.stats.roundBids.legacy}`,
);
console.log(
  `Bid make rate: candidate ${pct(total.stats.madeBids.candidate, candidateBidDecisions)}, legacy ${pct(
    total.stats.madeBids.legacy,
    legacyBidDecisions,
  )}`,
);
