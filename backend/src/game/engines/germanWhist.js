import { createDeck, removeCardById, shuffle, sortByRank } from '../cards.js';

function partner(state, userId) {
  return state.playerOrder.find((id) => id !== userId);
}

function rankScore(rank) {
  const order = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  return order.indexOf(rank);
}

function beats(cardA, cardB, leadSuit, trumpSuit) {
  const aTrump = cardA.suit === trumpSuit;
  const bTrump = cardB.suit === trumpSuit;
  if (aTrump && !bTrump) return true;
  if (!aTrump && bTrump) return false;

  const aLead = cardA.suit === leadSuit;
  const bLead = cardB.suit === leadSuit;
  if (aLead && !bLead) return true;
  if (!aLead && bLead) return false;

  return rankScore(cardA.rank) > rankScore(cardB.rank);
}

function trickWinnerUserId(state) {
  const [lead, follow] = state.currentTrick.cards;
  const leadSuit = lead.card.suit;
  return beats(lead.card, follow.card, leadSuit, state.trumpSuit) ? lead.userId : follow.userId;
}

function canFollowSuit(hand, suit) {
  return hand.some((card) => card.suit === suit);
}

export const germanWhistEngine = {
  create(players) {
    const deck = shuffle(createDeck());
    const hands = {};

    for (const id of players) {
      hands[id] = sortByRank(deck.splice(0, 13));
    }

    const dealerUserId = players[Math.floor(Math.random() * players.length)];
    const firstLeader = players.find((id) => id !== dealerUserId);

    const upcard = deck.shift();
    const trumpSuit = upcard.suit;

    return {
      type: 'german-whist',
      playerOrder: [...players],
      dealerUserId,
      turnUserId: firstLeader,
      leaderUserId: firstLeader,
      hands,
      trumpSuit,
      stage: 'stock',
      upcard,
      stock: deck,
      stockTricksPlayed: 0,
      currentTrick: { leaderUserId: firstLeader, cards: [] },
      secondStageTrickWins: { [players[0]]: 0, [players[1]]: 0 },
      winnerUserId: null,
      message: 'Stock stage: non-dealer leads.'
    };
  },

  action(state, userId, action) {
    if (state.winnerUserId) return { ok: false, error: 'Game is over' };
    if (state.turnUserId !== userId) return { ok: false, error: 'Not your turn' };
    if (action.type !== 'play') return { ok: false, error: 'Unknown action' };

    const hand = state.hands[userId];
    const card = removeCardById(hand, action.cardId);
    if (!card) return { ok: false, error: 'Card not in hand' };

    if (state.currentTrick.cards.length === 1) {
      const leadSuit = state.currentTrick.cards[0].card.suit;
      if (card.suit !== leadSuit && canFollowSuit(hand, leadSuit)) {
        hand.push(card);
        state.hands[userId] = sortByRank(hand);
        return { ok: false, error: 'You must follow suit when possible' };
      }
    }

    state.currentTrick.cards.push({ userId, card });
    if (state.currentTrick.cards.length < 2) {
      state.turnUserId = partner(state, userId);
      state.message = 'Opponent to play second card.';
      return { ok: true };
    }

    const winner = trickWinnerUserId(state);
    const loser = partner(state, winner);

    if (state.stage === 'stock') {
      state.hands[winner].push(state.upcard);
      const loserCard = state.stock.shift();
      if (loserCard) state.hands[loser].push(loserCard);
      state.hands[winner] = sortByRank(state.hands[winner]);
      state.hands[loser] = sortByRank(state.hands[loser]);

      state.stockTricksPlayed += 1;
      state.upcard = state.stock.shift() || null;

      if (!state.upcard) {
        state.stage = 'endgame';
        state.message = 'Endgame started. Only these 13 tricks count.';
      } else {
        state.message = 'Stock stage: winner leads next trick.';
      }
    } else {
      state.secondStageTrickWins[winner] += 1;
      state.message = 'Endgame: trick counted.';
    }

    state.currentTrick = { leaderUserId: winner, cards: [] };
    state.leaderUserId = winner;
    state.turnUserId = winner;

    const allHandsEmpty = state.playerOrder.every((id) => state.hands[id].length === 0);
    if (allHandsEmpty) {
      const [a, b] = state.playerOrder;
      const aWins = state.secondStageTrickWins[a];
      const bWins = state.secondStageTrickWins[b];
      state.winnerUserId = aWins === bWins ? null : aWins > bWins ? a : b;
      state.message = `Endgame tricks: ${aWins}-${bWins}.`;
    }

    return { ok: true };
  },

  view(state, userId, players) {
    const opponent = players.find((p) => p.userId !== userId);
    return {
      gameType: 'german-whist',
      turnUserId: state.turnUserId,
      winnerUserId: state.winnerUserId,
      stage: state.stage,
      yourHand: state.hands[userId],
      opponentCardCount: opponent ? state.hands[opponent.userId].length : 0,
      trumpSuit: state.trumpSuit,
      stockCount: state.stock.length,
      upcard: state.upcard,
      stockTricksPlayed: state.stockTricksPlayed,
      secondStageTrickWins: state.secondStageTrickWins,
      currentTrick: state.currentTrick.cards,
      message: state.message
    };
  }
};
