import * as champion from "./champions/strong-search-2026-08-11.mjs";
import { getCardPower, getLeadColor, isTrumpCard, isValidMove, teamForPlayer } from "../src/game.js";

function legalCards(game, playerId) {
  const hand = game.hands[playerId];
  const leadColor = getLeadColor(game.currentTrick, game.trump);
  const legal = hand.filter((card) => isValidMove(card, hand, leadColor, game.trump));
  return legal.length > 0 ? legal : hand;
}

function currentWinner(game) {
  if (game.currentTrick.length === 0) return null;
  const leadColor = getLeadColor(game.currentTrick, game.trump);
  return game.currentTrick.reduce(
    (best, play) => {
      const power = getCardPower(play.card, game.trump, leadColor);
      return power > best.power ? { play, power } : best;
    },
    { play: game.currentTrick[0], power: getCardPower(game.currentTrick[0].card, game.trump, leadColor) },
  );
}

function smallestWinningCard(game, playerId) {
  const winner = currentWinner(game);
  if (!winner) return null;
  const leadColor = getLeadColor(game.currentTrick, game.trump);
  return legalCards(game, playerId)
    .filter((card) => getCardPower(card, game.trump, leadColor) > winner.power)
    .sort((left, right) => getCardPower(left, game.trump, leadColor) - getCardPower(right, game.trump, leadColor))[0] ?? null;
}

export const pressureProbeAi = Object.freeze({
  chooseBotBid(game, playerId, maxBid = 150) {
    const championBid = champion.chooseBotBid(game, playerId, maxBid);
    if (championBid > 0) return championBid;
    const nextBid = Math.max(100, (game.bidInfo?.highBid ?? 95) + 5);
    const bidder = game.bidInfo?.bidder;
    const opponentHasBid = bidder !== null && teamForPlayer(bidder) !== teamForPlayer(playerId);
    return opponentHasBid && nextBid <= Math.min(110, maxBid) ? nextBid : 0;
  },
  chooseBotKittyPlan: champion.chooseBotKittyPlan,
  chooseBotPlay(game, playerId) {
    const cards = legalCards(game, playerId);
    if (game.currentTrick.length === 0) {
      const trumps = cards.filter((card) => isTrumpCard(card, game.trump));
      if (trumps.length >= 3) {
        return [...trumps].sort((left, right) => getCardPower(right, game.trump, game.trump) - getCardPower(left, game.trump, game.trump))[0];
      }
    }
    return smallestWinningCard(game, playerId) ?? champion.chooseBotPlay(game, playerId);
  },
});

export const conservativeProbeAi = Object.freeze({
  chooseBotBid(game, playerId, maxBid = 150) {
    return champion.chooseBotBid(game, playerId, Math.min(120, maxBid));
  },
  chooseBotKittyPlan: champion.chooseBotKittyPlan,
  chooseBotPlay(game, playerId) {
    const cards = legalCards(game, playerId);
    const winner = currentWinner(game);
    if (winner && teamForPlayer(winner.play.pid) === teamForPlayer(playerId)) {
      return [...cards].sort((left, right) => left.value - right.value || left.rank - right.rank)[0];
    }
    return champion.chooseBotPlay(game, playerId);
  },
});

export const pointHunterProbeAi = Object.freeze({
  chooseBotBid: champion.chooseBotBid,
  chooseBotKittyPlan: champion.chooseBotKittyPlan,
  chooseBotPlay(game, playerId) {
    const winning = smallestWinningCard(game, playerId);
    const trickPoints = game.currentTrick.reduce((sum, play) => sum + play.card.value, 0);
    if (winning && trickPoints >= 10) return winning;
    return champion.chooseBotPlay(game, playerId);
  },
});
