export const COLORS = ["Red", "Green", "Black", "Yellow"];
export const DISCARD_COUNT = 5;
export const BID_START = 95;

const CARD_VALUES = {
  1: 15,
  5: 5,
  10: 10,
  14: 10,
  ROOK: 20,
};

const COLOR_ORDER = {
  Red: 1,
  Green: 2,
  Black: 3,
  Yellow: 4,
  ROOK: 5,
};

export function createInitialGame() {
  return {
    kitty: [],
    kittyPoints: 0,
    hands: [[], [], [], []],
    scores: { us: 0, them: 0 },
    dealer: 0,
    currentTurn: 0,
    bidInfo: {
      active: false,
      highBid: 0,
      bidder: null,
      passed: [false, false, false, false],
    },
    trump: null,
    tricks: [],
    roundsCompleted: 0,
    currentTrick: [],
    collectingWinner: null,
    pointsTaken: { us: 0, them: 0 },
    phase: "MENU",
    settings: { mustWinByBid: false },
    selectedCardIndex: -1,
    discardSelection: [],
    showKittyDisplay: false,
    kittyFaceUp: true,
    menuOpen: false,
    toast: { message: "", visible: false },
    bubbles: { 1: "", 2: "", 3: "" },
    roundResult: null,
  };
}

export function cloneGameState(state) {
  return {
    ...state,
    kitty: [...state.kitty],
    hands: state.hands.map((hand) => [...hand]),
    scores: { ...state.scores },
    bidInfo: {
      ...state.bidInfo,
      passed: [...state.bidInfo.passed],
    },
    tricks: state.tricks.map((trick) => trick.map((play) => ({ ...play }))),
    roundsCompleted: state.roundsCompleted,
    currentTrick: state.currentTrick.map((play) => ({ ...play })),
    pointsTaken: { ...state.pointsTaken },
    settings: { ...state.settings },
    discardSelection: [...state.discardSelection],
    toast: { ...state.toast },
    bubbles: { ...state.bubbles },
    roundResult: state.roundResult ? { ...state.roundResult } : null,
  };
}

export function createCard(color, rank, id) {
  return {
    color,
    rank,
    id,
    value: color === "ROOK" ? CARD_VALUES.ROOK : CARD_VALUES[rank] || 0,
  };
}

export function buildDeck() {
  const deck = [];
  let id = 0;

  COLORS.forEach((color) => {
    for (let rank = 1; rank <= 14; rank += 1) {
      deck.push(createCard(color, rank, id));
      id += 1;
    }
  });

  deck.push(createCard("ROOK", 0, id));
  return deck;
}

export function shuffleDeck(deck) {
  const shuffled = [...deck];

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]];
  }

  return shuffled;
}

export function dealRound() {
  const deck = shuffleDeck(buildDeck());
  const kitty = deck.slice(0, DISCARD_COUNT);
  const hands = [[], [], [], []];
  let dealIndex = DISCARD_COUNT;

  for (let player = 0; player < 4; player += 1) {
    hands[player] = sortHand(deck.slice(dealIndex, dealIndex + 13));
    dealIndex += 13;
  }

  return { kitty, hands };
}

export function sortHand(hand) {
  return [...hand].sort((a, b) => {
    if (COLOR_ORDER[a.color] !== COLOR_ORDER[b.color]) {
      return COLOR_ORDER[a.color] - COLOR_ORDER[b.color];
    }

    return b.rank - a.rank;
  });
}

export function getCardPower(card, trump, leadColor) {
  const effectiveColor = card.color === "ROOK" ? trump : card.color;
  const baseRankPower = card.rank === 1 ? 1.5 : card.rank;
  const power = card.color === "ROOK" ? 0.5 : baseRankPower;

  if (effectiveColor === trump) return 500 + power;
  if (effectiveColor === leadColor) return 100 + power;
  return power;
}

export function getLeadColor(currentTrick, trump) {
  const leadCard = currentTrick[0]?.card;
  if (!leadCard) return null;
  return leadCard.color === "ROOK" ? trump : leadCard.color;
}

export function isValidMove(card, hand, leadColor, trump) {
  if (!leadColor) return true;

  const cardColor = card.color === "ROOK" ? trump : card.color;
  if (cardColor === leadColor) return true;

  const hasLeadColor = hand.some((heldCard) => {
    const heldColor = heldCard.color === "ROOK" ? trump : heldCard.color;
    return heldColor === leadColor;
  });

  return !hasLeadColor;
}

export function playerName(playerId) {
  return playerId === 0 ? "You" : ["W", "N", "E"][playerId - 1];
}

export function teamForPlayer(playerId) {
  return playerId === 0 || playerId === 2 ? "us" : "them";
}

export function completeRoundScore(game) {
  const bidder = game.bidInfo.bidder ?? game.dealer;
  const bid = game.bidInfo.highBid;
  const bidTeam = teamForPlayer(bidder);
  const pointsTaken = { ...game.pointsTaken };

  pointsTaken[bidTeam] += game.kittyPoints;

  let usRoundPoints = pointsTaken.us;
  let themRoundPoints = pointsTaken.them;

  if (usRoundPoints === 180) usRoundPoints = 360;
  if (themRoundPoints === 180) themRoundPoints = 360;

  let usScore = 0;
  let themScore = 0;

  if (bidTeam === "us") {
    usScore = usRoundPoints >= bid ? usRoundPoints : -bid;
    themScore = themRoundPoints;
  } else {
    themScore = themRoundPoints >= bid ? themRoundPoints : -bid;
    usScore = usRoundPoints;
  }

  return {
    bid,
    bidTeam,
    pointsTaken,
    scoreChange: { us: usScore, them: themScore },
  };
}
