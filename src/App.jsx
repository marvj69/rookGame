import { useEffect, useMemo, useRef, useState } from "react";
import { chooseBotBid, chooseBotKittyPlan, chooseBotPlay } from "./ai.js";
import {
  BID_START,
  DISCARD_COUNT,
  cloneGameState,
  completeRoundScore,
  createInitialGame,
  dealRound,
  getCardPower,
  getLeadColor,
  isValidMove,
  playerName,
  sortHand,
  teamForPlayer,
} from "./game.js";

const BID_MAX = 150;
const TARGET_SCORE = 500;
const COMPLETED_GAMES_STORAGE_KEY = "rook.completedGames";
const ACTIVE_GAME_STORAGE_KEY = "rook.activeGame:v1";
const ACTIVE_GAME_STORAGE_VERSION = 1;
const MAX_COMPLETED_GAMES = 20;

const PLAY_SLOTS = [
  { top: "65%", left: "50%" },
  { top: "45%", left: "35%" },
  { top: "25%", left: "50%" },
  { top: "45%", left: "65%" },
];

const PLAYER_ORIGINS = [
  { top: "120%", left: "50%" },
  { top: "50%", left: "-20%" },
  { top: "-20%", left: "50%" },
  { top: "50%", left: "120%" },
];

function prepareRoundState(state) {
  const { kitty, hands } = dealRound();

  state.kitty = kitty;
  state.hands = hands;
  state.kittyPoints = 0;
  state.trump = null;
  state.pointsTaken = { us: 0, them: 0 };
  state.currentTrick = [];
  state.tricks = [];
  state.collectingWinner = null;
  state.bidInfo = {
    active: true,
    highBid: BID_START,
    bidder: null,
    passed: [false, false, false, false],
  };
  state.dealer = (state.dealer + 1) % 4;
  state.currentTurn = (state.dealer + 1) % 4;
  state.phase = "BID";
  state.selectedCardIndex = -1;
  state.discardSelection = [];
  state.showKittyDisplay = false;
  state.kittyFaceUp = true;
  state.menuOpen = false;
  state.bubbles = { 1: "", 2: "", 3: "" };
  state.roundResult = null;
}

function useElementWidth(ref) {
  const [width, setWidth] = useState(0);

  useEffect(() => {
    if (!ref.current) return undefined;

    const updateWidth = () => {
      setWidth(ref.current?.clientWidth || window.innerWidth);
    };

    updateWidth();
    window.addEventListener("resize", updateWidth);

    let observer = null;
    if ("ResizeObserver" in window) {
      observer = new ResizeObserver(updateWidth);
      observer.observe(ref.current);
    }

    return () => {
      window.removeEventListener("resize", updateWidth);
      observer?.disconnect();
    };
  }, [ref]);

  return width;
}

function cardColorClass(card) {
  return card.color.toLowerCase();
}

function getBidOptions(highBid) {
  const minBid = Math.max(100, highBid + 5);
  const options = [];

  for (let bid = minBid; bid <= BID_MAX; bid += 5) {
    options.push(bid);
  }

  return options;
}

function loadCompletedGames() {
  if (typeof window === "undefined") return [];

  try {
    const savedGames = window.localStorage.getItem(COMPLETED_GAMES_STORAGE_KEY);
    const parsedGames = savedGames ? JSON.parse(savedGames) : [];
    return Array.isArray(parsedGames) ? parsedGames : [];
  } catch {
    return [];
  }
}

function saveCompletedGames(completedGames) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(COMPLETED_GAMES_STORAGE_KEY, JSON.stringify(completedGames));
  } catch {
    // Local storage can fail in private browsing or restricted embeds.
  }
}

function normalizeSavedGame(savedGame) {
  if (!savedGame || typeof savedGame !== "object") return null;

  const initialGame = createInitialGame();
  const savedHands =
    Array.isArray(savedGame.hands) && savedGame.hands.length === 4
      ? savedGame.hands.map((hand) => (Array.isArray(hand) ? hand : []))
      : initialGame.hands;
  const savedBidInfo = savedGame.bidInfo && typeof savedGame.bidInfo === "object" ? savedGame.bidInfo : {};
  const savedSettings = savedGame.settings && typeof savedGame.settings === "object" ? savedGame.settings : {};
  const savedScores = savedGame.scores && typeof savedGame.scores === "object" ? savedGame.scores : {};
  const savedPointsTaken = savedGame.pointsTaken && typeof savedGame.pointsTaken === "object" ? savedGame.pointsTaken : {};

  return cloneGameState({
    ...initialGame,
    ...savedGame,
    kitty: Array.isArray(savedGame.kitty) ? savedGame.kitty : initialGame.kitty,
    hands: savedHands,
    scores: { ...initialGame.scores, ...savedScores },
    bidInfo: {
      ...initialGame.bidInfo,
      ...savedBidInfo,
      passed: initialGame.bidInfo.passed.map((initialValue, index) =>
        Array.isArray(savedBidInfo.passed) ? Boolean(savedBidInfo.passed[index]) : initialValue,
      ),
    },
    tricks: Array.isArray(savedGame.tricks) ? savedGame.tricks : initialGame.tricks,
    currentTrick: Array.isArray(savedGame.currentTrick) ? savedGame.currentTrick : initialGame.currentTrick,
    pointsTaken: { ...initialGame.pointsTaken, ...savedPointsTaken },
    settings: { ...initialGame.settings, ...savedSettings },
    discardSelection: Array.isArray(savedGame.discardSelection) ? savedGame.discardSelection : initialGame.discardSelection,
    toast: initialGame.toast,
    bubbles: initialGame.bubbles,
    menuOpen: false,
    roundResult:
      savedGame.roundResult && typeof savedGame.roundResult === "object" ? { ...savedGame.roundResult } : initialGame.roundResult,
  });
}

function loadActiveGame() {
  if (typeof window === "undefined") return null;

  try {
    const savedGame = window.localStorage.getItem(ACTIVE_GAME_STORAGE_KEY);
    if (!savedGame) return null;

    const parsedGame = JSON.parse(savedGame);
    if (parsedGame?.version !== ACTIVE_GAME_STORAGE_VERSION) return null;

    return normalizeSavedGame(parsedGame.game);
  } catch {
    return null;
  }
}

function getSavableGameState(state) {
  const savableGame = cloneGameState(state);
  savableGame.toast = { message: "", visible: false };
  savableGame.bubbles = { 1: "", 2: "", 3: "" };
  savableGame.menuOpen = false;
  return savableGame;
}

function saveActiveGame(state) {
  if (typeof window === "undefined") return;

  try {
    window.localStorage.setItem(
      ACTIVE_GAME_STORAGE_KEY,
      JSON.stringify({
        version: ACTIVE_GAME_STORAGE_VERSION,
        savedAt: new Date().toISOString(),
        game: getSavableGameState(state),
      }),
    );
  } catch {
    // Local storage can fail in private browsing or restricted embeds.
  }
}

function formatCompletedDate(value) {
  try {
    return new Intl.DateTimeFormat(undefined, {
      month: "short",
      day: "numeric",
      hour: "numeric",
      minute: "2-digit",
    }).format(new Date(value));
  } catch {
    return "Recently";
  }
}

export default function App() {
  const gameRef = useRef(null);
  const activeTimeoutsRef = useRef([]);

  if (gameRef.current === null) {
    gameRef.current = loadActiveGame() || createInitialGame();
  }

  const [game, setGame] = useState(() => cloneGameState(gameRef.current));
  const [menuView, setMenuView] = useState("home");
  const [completedGames, setCompletedGames] = useState(loadCompletedGames);

  function commitGame() {
    const nextGame = cloneGameState(gameRef.current);
    saveActiveGame(nextGame);
    setGame(nextGame);
  }

  function mutateGame(mutator) {
    mutator(gameRef.current);
    commitGame();
  }

  function clearAllTimeouts() {
    activeTimeoutsRef.current.forEach((timeoutId) => window.clearTimeout(timeoutId));
    activeTimeoutsRef.current = [];
  }

  function delay(fn, ms) {
    const timeoutId = window.setTimeout(() => {
      activeTimeoutsRef.current = activeTimeoutsRef.current.filter((id) => id !== timeoutId);
      fn();
    }, ms);

    activeTimeoutsRef.current.push(timeoutId);
    return timeoutId;
  }

  function showToast(message) {
    mutateGame((state) => {
      state.toast = { message, visible: true };
    });

    delay(() => {
      mutateGame((state) => {
        if (state.toast.message === message) {
          state.toast = { ...state.toast, visible: false };
        }
      });
    }, 2000);
  }

  function showBubble(playerId, text) {
    if (playerId === 0) return;

    mutateGame((state) => {
      state.bubbles = { ...state.bubbles, [playerId]: text };
    });

    delay(() => {
      mutateGame((state) => {
        if (state.bubbles[playerId] === text) {
          state.bubbles = { ...state.bubbles, [playerId]: "" };
        }
      });
    }, 2000);
  }

  function recordCompletedGame(completedGame) {
    setCompletedGames((currentGames) => {
      const nextGames = [completedGame, ...currentGames].slice(0, MAX_COMPLETED_GAMES);
      saveCompletedGames(nextGames);
      return nextGames;
    });
  }

  function clearCompletedGames() {
    saveCompletedGames([]);
    setCompletedGames([]);
  }

  function startGame() {
    clearAllTimeouts();
    setMenuView("home");

    mutateGame((state) => {
      const settings = { ...state.settings };
      Object.assign(state, createInitialGame());
      state.settings = settings;
      state.scores = { us: 0, them: 0 };
      state.dealer = Math.floor(Math.random() * 4);
      prepareRoundState(state);
    });

    showToast("Bidding Starts");
    processTurn();
  }

  function goToMainMenu() {
    clearAllTimeouts();
    setMenuView("home");

    mutateGame((state) => {
      const settings = { ...state.settings };
      Object.assign(state, createInitialGame());
      state.settings = settings;
    });
  }

  function startRound() {
    clearAllTimeouts();

    mutateGame((state) => {
      prepareRoundState(state);
    });

    showToast("Bidding Starts");
    processTurn();
  }

  function processTurn() {
    const state = gameRef.current;

    if (state.phase === "KITTY_WAIT") {
      const winner = state.bidInfo.bidder ?? state.dealer;
      delay(() => botChooseKitty(winner), 1000);
      return;
    }

    if (state.phase === "BID") {
      const activeBidderCount = state.bidInfo.passed.filter((hasPassed) => !hasPassed).length;

      if (activeBidderCount <= 1) {
        endBidding();
        return;
      }

      if (state.bidInfo.passed[state.currentTurn]) {
        advanceTurn();
        return;
      }

      if (state.currentTurn !== 0) {
        const botId = state.currentTurn;
        delay(() => botBid(botId), 800);
      }

      return;
    }

    if (state.phase === "PLAY") {
      if (state.currentTrick.length === 4) {
        if (state.collectingWinner !== null) {
          const winner = state.collectingWinner;
          delay(() => collectResolvedTrick(winner), 500);
        } else {
          delay(resolveTrick, 1500);
        }
        return;
      }

      if (state.currentTurn === 0) {
        mutateGame((nextState) => {
          const hand = nextState.hands[0];
          const selectedCard = hand[nextState.selectedCardIndex];
          const leadColor = getLeadColor(nextState.currentTrick, nextState.trump);

          if (selectedCard && !isValidMove(selectedCard, hand, leadColor, nextState.trump)) {
            nextState.selectedCardIndex = -1;
          }
        });
      } else {
        const botId = state.currentTurn;
        delay(() => botPlay(botId), 800);
      }
    }
  }

  function advanceTurn() {
    mutateGame((state) => {
      state.currentTurn = (state.currentTurn + 1) % 4;
    });

    processTurn();
  }

  function humanPass() {
    submitBid(0, 0);
  }

  function botBid(playerId) {
    const state = gameRef.current;
    if (state.phase !== "BID" || state.currentTurn !== playerId) return;

    submitBid(playerId, chooseBotBid(state, playerId, BID_MAX));
  }

  function submitBid(playerId, amount) {
    mutateGame((state) => {
      if (amount > 0) {
        state.bidInfo.highBid = amount;
        state.bidInfo.bidder = playerId;
        state.bidInfo.passed[playerId] = false;
      } else {
        state.bidInfo.passed[playerId] = true;
      }
    });

    showBubble(playerId, amount > 0 ? amount.toString() : "Pass");
    advanceTurn();
  }

  function endBidding() {
    const state = gameRef.current;
    const winner = state.bidInfo.bidder ?? state.dealer;
    const finalBid = Math.max(100, state.bidInfo.highBid);

    mutateGame((nextState) => {
      nextState.bidInfo.highBid = finalBid;
      nextState.bidInfo.bidder = winner;
      nextState.hands[winner] = sortHand([...nextState.hands[winner], ...nextState.kitty]);
      nextState.showKittyDisplay = true;
      nextState.kittyFaceUp = true;
      nextState.selectedCardIndex = -1;
      nextState.discardSelection = [];
      nextState.phase = winner === 0 ? "KITTY" : "KITTY_WAIT";
    });

    showToast(`${playerName(winner)} won bid at ${finalBid}`);

    if (winner === 0) return;

    const revealDuration = 5000;
    const thinkDuration = (1 + Math.floor(Math.random() * 4)) * 1000;

    delay(() => botChooseKitty(winner), revealDuration + thinkDuration);
  }

  function botChooseKitty(winner) {
    const latest = gameRef.current;
    if (latest.phase !== "KITTY_WAIT" || latest.bidInfo.bidder !== winner) return;

    let chosenTrump = "Red";

    mutateGame((nextState) => {
      const plan = chooseBotKittyPlan(nextState.hands[winner]);
      const discards = plan.discards;
      chosenTrump = plan.trump;

      nextState.hands[winner] = plan.hand;
      nextState.kittyPoints = discards.reduce((sum, card) => sum + card.value, 0);
      nextState.showKittyDisplay = false;
      nextState.trump = chosenTrump;
      nextState.phase = "PLAY";
      nextState.currentTurn = winner;
    });

    showToast(`Trump is ${chosenTrump}`);
    processTurn();
  }

  function toggleDiscard(index) {
    mutateGame((state) => {
      if (state.phase !== "KITTY") return;

      const existingIndex = state.discardSelection.indexOf(index);
      if (existingIndex >= 0) {
        state.discardSelection.splice(existingIndex, 1);
      } else if (state.discardSelection.length < DISCARD_COUNT) {
        state.discardSelection.push(index);
      }
    });
  }

  function confirmDiscard() {
    const state = gameRef.current;
    if (state.phase !== "KITTY" || state.discardSelection.length !== DISCARD_COUNT) return;

    mutateGame((nextState) => {
      const hand = [...nextState.hands[0]];
      const removed = [];

      [...nextState.discardSelection]
        .sort((a, b) => b - a)
        .forEach((index) => {
          removed.push(hand[index]);
          hand.splice(index, 1);
        });

      nextState.hands[0] = sortHand(hand);
      nextState.kittyPoints = removed.reduce((sum, card) => sum + card.value, 0);
      nextState.discardSelection = [];
      nextState.selectedCardIndex = -1;
      nextState.showKittyDisplay = false;
      nextState.phase = "TRUMP";
    });
  }

  function humanSelectTrump(color) {
    mutateGame((state) => {
      if (state.phase !== "TRUMP") return;

      state.trump = color;
      state.phase = "PLAY";
      state.currentTurn = 0;
    });

    showToast(`Trump is ${color}`);
    processTurn();
  }

  function selectHandCard(index, playable) {
    const state = gameRef.current;

    if (state.phase === "KITTY") {
      toggleDiscard(index);
      return;
    }

    if (state.phase !== "PLAY" || state.currentTurn !== 0 || !playable) return;

    mutateGame((nextState) => {
      nextState.selectedCardIndex = nextState.selectedCardIndex === index ? -1 : index;
    });
  }

  function humanPlayCard() {
    const state = gameRef.current;
    if (state.phase !== "PLAY" || state.currentTurn !== 0 || state.selectedCardIndex < 0) return;

    const card = state.hands[0][state.selectedCardIndex];
    if (!card) return;

    mutateGame((nextState) => {
      nextState.hands[0].splice(nextState.selectedCardIndex, 1);
      nextState.selectedCardIndex = -1;
      nextState.currentTrick.push({
        pid: 0,
        card,
        rotation: Math.random() * 20 - 10,
      });
    });

    advanceTurn();
  }

  function botPlay(playerId) {
    const state = gameRef.current;
    if (state.phase !== "PLAY" || state.currentTurn !== playerId) return;

    const choice = chooseBotPlay(state, playerId);
    if (!choice) return;

    mutateGame((nextState) => {
      const cardIndex = nextState.hands[playerId].findIndex((card) => card.id === choice.id);
      if (cardIndex >= 0) {
        nextState.hands[playerId].splice(cardIndex, 1);
      }

      nextState.currentTrick.push({
        pid: playerId,
        card: choice,
        rotation: Math.random() * 20 - 10,
      });
    });

    advanceTurn();
  }

  function resolveTrick() {
    const state = gameRef.current;
    if (state.phase !== "PLAY" || state.currentTrick.length !== 4) return;

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
    const winningTeam = teamForPlayer(winner);

    mutateGame((nextState) => {
      nextState.collectingWinner = winner;
      nextState.pointsTaken[winningTeam] += points;
    });

    showBubble(winner, `+${points}`);

    delay(() => collectResolvedTrick(winner), 500);
  }

  function collectResolvedTrick(winner) {
    let shouldContinue = false;
    let completedGame = null;

    mutateGame((nextState) => {
      if (nextState.phase !== "PLAY" || nextState.currentTrick.length !== 4 || nextState.collectingWinner !== winner) return;

      nextState.tricks.push(nextState.currentTrick.map((play) => ({ ...play })));
      nextState.currentTrick = [];
      nextState.collectingWinner = null;
      nextState.currentTurn = winner;

      if (nextState.hands[0].length === 0) {
        completedGame = finishRound(nextState);
      } else {
        shouldContinue = true;
      }
    });

    if (completedGame) {
      recordCompletedGame(completedGame);
    }

    if (shouldContinue) {
      processTurn();
    }
  }

  function finishRound(state) {
    const roundScore = completeRoundScore(state);

    state.pointsTaken = roundScore.pointsTaken;
    state.scores.us += roundScore.scoreChange.us;
    state.scores.them += roundScore.scoreChange.them;
    state.roundsCompleted += 1;

    const leadingTeam = state.scores.us >= state.scores.them ? "us" : "them";
    const reachedTarget = state.scores[leadingTeam] >= TARGET_SCORE;
    const canWin = !state.settings.mustWinByBid || roundScore.bidTeam === leadingTeam;
    const winnerTeam = reachedTarget && canWin ? leadingTeam : null;
    const scoreSummary = `Bid: ${roundScore.bid} (${roundScore.bidTeam.toUpperCase()})\nPoints: US ${roundScore.pointsTaken.us} | THEM ${roundScore.pointsTaken.them}\n\nScore Change:\nUS: ${roundScore.scoreChange.us}\nTHEM: ${roundScore.scoreChange.them}`;

    if (winnerTeam) {
      const completedGame = {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        finishedAt: new Date().toISOString(),
        winner: winnerTeam,
        scores: { ...state.scores },
        rounds: state.roundsCompleted,
      };

      state.phase = "GAME_END";
      state.roundResult = {
        title: `${winnerTeam.toUpperCase()} Wins`,
        detail: `${scoreSummary}\n\nFinal Score:\nUS: ${state.scores.us}\nTHEM: ${state.scores.them}`,
      };

      return completedGame;
    }

    state.phase = "ROUND_END";
    state.roundResult = {
      title: "Round Over",
      detail: scoreSummary,
    };

    return null;
  }

  function openSettings() {
    mutateGame((state) => {
      state.menuOpen = true;
    });
  }

  function closeSettings() {
    mutateGame((state) => {
      state.menuOpen = false;
    });
  }

  function toggleMustWinByBid(checked) {
    mutateGame((state) => {
      state.settings.mustWinByBid = checked;
    });
  }

  useEffect(() => {
    processTurn();

    return () => {
      clearAllTimeouts();
    };
  }, []);

  const appClassName = game.phase === "BID" && game.currentTurn === 0 ? "rook-app bid-focus" : "rook-app";

  if (game.phase === "MENU") {
    return (
      <main className="rook-app menu-mode">
        <MainMenuScreen
          completedGames={completedGames}
          menuView={menuView}
          settings={game.settings}
          targetScore={TARGET_SCORE}
          onClearCompletedGames={clearCompletedGames}
          onSelectView={setMenuView}
          onStartGame={startGame}
          onToggleMustWinByBid={toggleMustWinByBid}
        />
      </main>
    );
  }

  return (
    <main className={appClassName}>
      <Hud game={game} onOpenSettings={openSettings} />

      <section id="game-table" aria-label="Rook game table">
        <Avatar playerId={2} position="top-player" active={game.currentTurn === 2} bubble={game.bubbles[2]} />
        <Avatar playerId={1} position="left-player" active={game.currentTurn === 1} bubble={game.bubbles[1]} />
        <Avatar playerId={3} position="right-player" active={game.currentTurn === 3} bubble={game.bubbles[3]} />

        <PlayedCards game={game} />

        {game.showKittyDisplay && <KittyDisplay kitty={game.kitty} faceUp={game.kittyFaceUp} />}

        <button
          id="play-btn"
          className={game.phase === "PLAY" && game.currentTurn === 0 && game.selectedCardIndex !== -1 ? "visible" : ""}
          type="button"
          onClick={humanPlayCard}
        >
          PLAY CARD
        </button>

        <Hand game={game} onCardClick={selectHandCard} />
      </section>

      <Toast toast={game.toast} />

      {game.phase === "BID" && game.currentTurn === 0 && (
        <BidModal game={game} onBid={(amount) => submitBid(0, amount)} onPass={humanPass} />
      )}
      {game.phase === "TRUMP" && <TrumpModal onSelectTrump={humanSelectTrump} />}
      {game.phase === "KITTY" && <KittyModal game={game} onConfirmDiscard={confirmDiscard} />}
      {game.phase === "ROUND_END" && game.roundResult && (
        <RoundEndModal
          result={game.roundResult}
          primaryLabel="NEXT ROUND"
          secondaryLabel="MAIN MENU"
          onPrimary={startRound}
          onSecondary={goToMainMenu}
        />
      )}
      {game.phase === "GAME_END" && game.roundResult && (
        <RoundEndModal
          result={game.roundResult}
          primaryLabel="START NEW GAME"
          secondaryLabel="MAIN MENU"
          onPrimary={startGame}
          onSecondary={goToMainMenu}
        />
      )}
      {game.menuOpen && (
        <SettingsModal
          game={game}
          onClose={closeSettings}
          onRestart={startGame}
          onToggleMustWinByBid={toggleMustWinByBid}
        />
      )}
    </main>
  );
}

function Hud({ game, onOpenSettings }) {
  const trump = game.trump || "-";
  const bidTeam = game.bidInfo.bidder !== null ? (teamForPlayer(game.bidInfo.bidder) === "us" ? " (US)" : " (THEM)") : "";
  const bidText = game.bidInfo.highBid > 0 ? `${game.bidInfo.highBid}${bidTeam}` : "-";

  const trumpPillStyle = {
    borderColor:
      trump === "Red"
        ? "#e53935"
        : trump === "Green"
          ? "#43a047"
          : trump === "Yellow"
            ? "#fdd835"
            : trump === "Black"
              ? "#555"
              : "rgba(255, 255, 255, 0.2)",
  };

  return (
    <header id="hud">
      <div className="hud-group">
        <div className="pill" id="trump-pill" style={trumpPillStyle}>
          Trump:{" "}
          <span className="val" id="trump-val" style={{ color: trump === "Yellow" ? "#fdd835" : "white" }}>
            {trump}
          </span>
        </div>
        <div className="pill">
          Bid:{" "}
          <span className="val" id="bid-val">
            {bidText}
          </span>
        </div>
      </div>

      <div className="hud-group score-group">
        <div className="pill">
          US: <span className="val">{game.scores.us}</span>
        </div>
        <div className="pill">
          THEM: <span className="val">{game.scores.them}</span>
        </div>
      </div>

      <button className="menu-btn" type="button" aria-label="Open settings" onClick={onOpenSettings}>
        <span className="menu-icon" aria-hidden="true">
          <span />
          <span />
          <span />
        </span>
      </button>
    </header>
  );
}

function Avatar({ playerId, position, active, bubble }) {
  return (
    <div className={`avatar-container ${position}`}>
      <div className={active ? "avatar active" : "avatar"}>{playerName(playerId)}</div>
      <div className={bubble ? "bubble visible" : "bubble"}>{bubble}</div>
    </div>
  );
}

function PlayedCards({ game }) {
  return (
    <div id="play-area">
      {game.currentTrick.map((play, index) => {
        const isCollecting = game.collectingWinner !== null;
        const position = isCollecting ? PLAYER_ORIGINS[game.collectingWinner] : PLAY_SLOTS[play.pid];
        const transform = isCollecting
          ? "translate(-50%, -50%) scale(0.5)"
          : `translate(-50%, -50%) rotate(${play.rotation}deg)`;

        return (
          <CardView
            key={`${play.card.id}-${index}`}
            card={play.card}
            className="played-card"
            style={{
              top: position.top,
              left: position.left,
              zIndex: 100 + index,
              opacity: isCollecting ? 0 : 1,
              transform,
            }}
          />
        );
      })}
    </div>
  );
}

function KittyDisplay({ kitty, faceUp }) {
  return (
    <aside id="kitty-display" aria-label="Kitty cards">
      <div className="kitty-label">Kitty</div>
      <div className="kitty-row">
        {kitty.map((card) => (
          <CardView
            key={card.id}
            card={card}
            back={!faceUp}
            style={{
              position: "relative",
              width: "40px",
              height: "56px",
              fontSize: "14px",
            }}
          />
        ))}
      </div>
    </aside>
  );
}

function Hand({ game, onCardClick }) {
  const containerRef = useRef(null);
  const containerWidth = useElementWidth(containerRef);
  const hand = game.hands[0];
  const leadColor = useMemo(() => getLeadColor(game.currentTrick, game.trump), [game.currentTrick, game.trump]);
  const viewportWidth = typeof window === "undefined" ? 390 : window.innerWidth;
  const cardWidth = Math.min(Math.max(viewportWidth * 0.14, 50), 80);
  const halfCard = cardWidth / 2;
  const total = hand.length;
  const center = (total - 1) / 2;
  const spacing = Math.min(35, Math.max(14, ((containerWidth || viewportWidth) - cardWidth) / Math.max(total - 1, 1)));

  return (
    <div className="bottom-area">
      <div className="hand-container" id="player-hand" ref={containerRef}>
        {hand.map((card, index) => {
          const isSelected = game.selectedCardIndex === index || (game.phase === "KITTY" && game.discardSelection.includes(index));
          const playable =
            game.phase === "KITTY" ||
            (game.phase === "PLAY" && game.currentTurn === 0 && isValidMove(card, hand, leadColor, game.trump));
          const offset = index - center;
          const rotation = offset * 3;
          const yTranslate = Math.abs(offset) * 4;

          return (
            <CardView
              key={card.id}
              card={card}
              className={`hand-card${isSelected ? " selected" : ""}${!playable && game.phase === "PLAY" ? " unplayable" : ""}`}
              onClick={(event) => {
                event.stopPropagation();
                onCardClick(index, playable);
              }}
              style={{
                left: `calc(50% + ${offset * spacing}px)`,
                marginLeft: `-${halfCard}px`,
                bottom: `${-10 - yTranslate}px`,
                transform: `rotate(${rotation}deg)`,
                zIndex: index,
              }}
            />
          );
        })}
      </div>
    </div>
  );
}

function CardView({ card, className = "", style, onClick, back = false }) {
  const rankDisplay = card.color === "ROOK" ? "ROOK" : card.rank;
  const cornerRank = card.color === "ROOK" ? "R" : card.rank;
  const classes = ["card", cardColorClass(card), card.color === "ROOK" ? "rook" : "", back ? "back" : "", className]
    .filter(Boolean)
    .join(" ");

  return (
    <button className={classes} style={style} type="button" onClick={onClick} aria-label={`${rankDisplay} ${card.color}`}>
      <span className="card-corner tl">{cornerRank}</span>
      <span className="card-inner">{rankDisplay}</span>
      <span className="card-corner br">{cornerRank}</span>
    </button>
  );
}

function Toast({ toast }) {
  return <div className={toast.visible ? "toast show" : "toast"}>{toast.message || "Message"}</div>;
}

function Modal({ id, children, className = "" }) {
  return (
    <div id={id} className={`modal ${className}`}>
      {children}
    </div>
  );
}

function MainMenuScreen({
  completedGames,
  menuView,
  settings,
  targetScore,
  onClearCompletedGames,
  onSelectView,
  onStartGame,
  onToggleMustWinByBid,
}) {
  return (
    <section className="main-menu-screen" aria-label="Main menu">
      <div className="main-menu-shell">
        <aside className="main-menu-brand" aria-label="Rook overview">
          <img className="main-menu-logo" src="/rook-icon.svg" alt="" aria-hidden="true" />
          <p className="menu-kicker">Partnership card game</p>
          <h1>Rook</h1>
          <p className="menu-copy">Set the table first. Start bidding only when you are ready.</p>
          <div className="menu-stat-strip" aria-label="Game defaults">
            <div>
              <span>{targetScore}</span>
              <small>Target</small>
            </div>
            <div>
              <span>4</span>
              <small>Players</small>
            </div>
            <div>
              <span>{completedGames.length}</span>
              <small>Finished</small>
            </div>
          </div>
        </aside>

        <section className="main-menu-panel" aria-label="Menu options">
          <nav className="main-menu-actions" aria-label="Main menu options">
            <button className="menu-action menu-action-primary" type="button" onClick={onStartGame}>
              <span>Start New Game</span>
              <small>Deal a fresh table</small>
            </button>
            <button
              className={menuView === "home" ? "menu-action active" : "menu-action"}
              type="button"
              aria-current={menuView === "home" ? "page" : undefined}
              onClick={() => onSelectView("home")}
            >
              <span>Main Menu</span>
              <small>Table overview</small>
            </button>
            <button
              className={menuView === "completed" ? "menu-action active" : "menu-action"}
              type="button"
              aria-current={menuView === "completed" ? "page" : undefined}
              onClick={() => onSelectView("completed")}
            >
              <span>Completed Games</span>
              <small>{completedGames.length ? `${completedGames.length} saved` : "No saved games"}</small>
            </button>
            <button
              className={menuView === "settings" ? "menu-action active" : "menu-action"}
              type="button"
              aria-current={menuView === "settings" ? "page" : undefined}
              onClick={() => onSelectView("settings")}
            >
              <span>Settings</span>
              <small>Rules and scoring</small>
            </button>
            <button
              className={menuView === "how-to" ? "menu-action active" : "menu-action"}
              type="button"
              aria-current={menuView === "how-to" ? "page" : undefined}
              onClick={() => onSelectView("how-to")}
            >
              <span>How To Play</span>
              <small>Bid, trump, tricks</small>
            </button>
          </nav>

          <div className="main-menu-content">
            {menuView === "home" && <MenuHome targetScore={targetScore} onStartGame={onStartGame} />}
            {menuView === "completed" && (
              <CompletedGamesView completedGames={completedGames} onClearCompletedGames={onClearCompletedGames} />
            )}
            {menuView === "settings" && (
              <MenuSettingsView settings={settings} targetScore={targetScore} onToggleMustWinByBid={onToggleMustWinByBid} />
            )}
            {menuView === "how-to" && <HowToPlayView />}
          </div>
        </section>
      </div>
    </section>
  );
}

function MenuHome({ targetScore, onStartGame }) {
  return (
    <>
      <p className="section-kicker">Main Menu</p>
      <h2>Ready table</h2>
      <p className="menu-panel-copy">Your team sits South and North. First team to {targetScore} wins.</p>
      <div className="menu-summary-grid">
        <div className="menu-summary-card red-card">
          <span>Bid</span>
          <strong>Start at 100</strong>
        </div>
        <div className="menu-summary-card green-card">
          <span>Kitty</span>
          <strong>5 cards</strong>
        </div>
        <div className="menu-summary-card yellow-card">
          <span>Score</span>
          <strong>Bid or set</strong>
        </div>
      </div>
      <button className="menu-large-start" type="button" onClick={onStartGame}>
        Start New Game
      </button>
    </>
  );
}

function CompletedGamesView({ completedGames, onClearCompletedGames }) {
  return (
    <>
      <p className="section-kicker">History</p>
      <h2>Completed games</h2>
      {completedGames.length === 0 ? (
        <div className="empty-history">
          <strong>No completed games yet</strong>
          <span>Finished games will appear here with winner, score, and round count.</span>
        </div>
      ) : (
        <>
          <ol className="completed-game-list">
            {completedGames.map((completedGame) => (
              <li className="completed-game" key={completedGame.id}>
                <div>
                  <strong>{completedGame.winner.toUpperCase()} won</strong>
                  <span>{formatCompletedDate(completedGame.finishedAt)}</span>
                </div>
                <div className="completed-score">
                  <span>US {completedGame.scores.us}</span>
                  <span>THEM {completedGame.scores.them}</span>
                  <span>{completedGame.rounds} rounds</span>
                </div>
              </li>
            ))}
          </ol>
          <button className="menu-text-button" type="button" onClick={onClearCompletedGames}>
            Clear History
          </button>
        </>
      )}
    </>
  );
}

function MenuSettingsView({ settings, targetScore, onToggleMustWinByBid }) {
  return (
    <>
      <p className="section-kicker">Settings</p>
      <h2>Game rules</h2>
      <div className="menu-settings-list">
        <label className="menu-setting-row">
          <span>
            <strong>Must Win Bid</strong>
            <small>Only the bidding team can finish the game after reaching {targetScore}.</small>
          </span>
          <input
            type="checkbox"
            checked={settings.mustWinByBid}
            onChange={(event) => onToggleMustWinByBid(event.target.checked)}
          />
        </label>
      </div>
    </>
  );
}

function HowToPlayView() {
  return (
    <>
      <p className="section-kicker">Rules</p>
      <h2>How to play</h2>
      <div className="rules-list">
        <p>
          Bid for the right to take the kitty, name trump, and lead the first trick. Passing leaves the bid to the
          remaining players.
        </p>
        <p>Follow the led color when you can. Trump beats other colors, and the Rook follows trump.</p>
        <p>Hit your bid to score your points. Miss it and your team loses the bid amount.</p>
      </div>
    </>
  );
}

function BidModal({ game, onBid, onPass }) {
  const bidOptions = getBidOptions(game.bidInfo.highBid);

  return (
    <Modal id="bid-modal">
      <div className="modal-card">
        <h2 className="modal-title">Your Bid</h2>
        <p className="modal-subtitle">
          Current High: <span className="modal-emphasis">{game.bidInfo.highBid}</span>
        </p>
        <div className="grid-options">
          {bidOptions.map((bid) => (
            <button className="btn-opt" type="button" key={bid} onClick={() => onBid(bid)}>
              {bid}
            </button>
          ))}
        </div>
        <div className="button-row">
          <button className="btn-secondary btn-pass" type="button" onClick={onPass}>
            PASS
          </button>
        </div>
      </div>
    </Modal>
  );
}

function TrumpModal({ onSelectTrump }) {
  return (
    <Modal id="trump-modal">
      <div className="modal-card">
        <h2 className="modal-title">Choose Trump</h2>
        <div className="color-options">
          <button className="btn-opt btn-red" type="button" onClick={() => onSelectTrump("Red")}>
            RED
          </button>
          <button className="btn-opt btn-green" type="button" onClick={() => onSelectTrump("Green")}>
            GREEN
          </button>
          <button className="btn-opt btn-black" type="button" onClick={() => onSelectTrump("Black")}>
            BLACK
          </button>
          <button className="btn-opt btn-yellow" type="button" onClick={() => onSelectTrump("Yellow")}>
            YELLOW
          </button>
        </div>
      </div>
    </Modal>
  );
}

function KittyModal({ game, onConfirmDiscard }) {
  const selectedCount = game.discardSelection.length;

  return (
    <Modal id="kitty-modal">
      <div className="modal-card kitty-card">
        <h2 className="modal-title">The Kitty</h2>
        <p className="modal-subtitle">Tap 5 cards in your hand to discard.</p>
        <button
          className="btn-primary"
          id="confirm-discard-btn"
          type="button"
          disabled={selectedCount !== DISCARD_COUNT}
          onClick={onConfirmDiscard}
        >
          CONFIRM ({selectedCount}/5)
        </button>
      </div>
    </Modal>
  );
}

function RoundEndModal({ result, primaryLabel, secondaryLabel, onPrimary, onSecondary }) {
  return (
    <Modal id="round-end-modal">
      <div className="modal-card">
        <h2 className="modal-title">{result.title}</h2>
        <p className="modal-subtitle round-detail">{result.detail}</p>
        <button className="btn-primary" type="button" onClick={onPrimary}>
          {primaryLabel}
        </button>
        {secondaryLabel && (
          <button className="btn-secondary" type="button" onClick={onSecondary}>
            {secondaryLabel}
          </button>
        )}
      </div>
    </Modal>
  );
}

function SettingsModal({ game, onClose, onRestart, onToggleMustWinByBid }) {
  return (
    <Modal id="menu-modal">
      <div className="modal-card">
        <h2 className="modal-title">Settings</h2>
        <div className="settings-list">
          <label className="settings-row">
            <span>Must Win Bid</span>
            <input
              type="checkbox"
              checked={game.settings.mustWinByBid}
              onChange={(event) => onToggleMustWinByBid(event.target.checked)}
            />
          </label>
        </div>
        <button className="btn-primary" type="button" onClick={onRestart}>
          RESTART GAME
        </button>
        <button className="btn-secondary" type="button" onClick={onClose}>
          CLOSE
        </button>
      </div>
    </Modal>
  );
}
