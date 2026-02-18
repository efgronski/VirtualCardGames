import { createDeck, removeCardById, shuffle } from '../cards.js';

const SPECIAL_RESET = '2';
const SPECIAL_MIRROR = '3';
const SPECIAL_LIMIT7 = '7';
const SPECIAL_BOMB = '10';

function shitheadRankValue(rank) {
  const order = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];
  return order.indexOf(rank) + 2;
}

function sortShitheadHand(cards) {
  const suits = ['C', 'D', 'H', 'S'];
  return [...cards].sort((a, b) => {
    const rankDiff = shitheadRankValue(a.rank) - shitheadRankValue(b.rank);
    if (rankDiff !== 0) return rankDiff;
    return suits.indexOf(a.suit) - suits.indexOf(b.suit);
  });
}

function baseTopCard(discardPile) {
  for (let i = discardPile.length - 1; i >= 0; i -= 1) {
    const rank = discardPile[i].rank;
    if (rank !== SPECIAL_MIRROR) return discardPile[i];
  }
  return null;
}

function topRule(discardPile) {
  const base = baseTopCard(discardPile);
  if (!base) return { type: 'any' };

  if (base.rank === SPECIAL_RESET) return { type: 'min', value: shitheadRankValue('2'), label: '2 or higher' };
  if (base.rank === SPECIAL_LIMIT7) return { type: 'max', value: shitheadRankValue('7'), label: '7 or lower' };
  return { type: 'min', value: shitheadRankValue(base.rank), label: `${base.rank} or higher` };
}

function canPlayRank(discardPile, rank) {
  if (rank === SPECIAL_RESET || rank === SPECIAL_BOMB || rank === SPECIAL_MIRROR) return true;

  const rule = topRule(discardPile);
  if (rule.type === 'any') return true;

  const value = shitheadRankValue(rank);
  if (rule.type === 'min') return value >= rule.value;
  return value <= rule.value;
}

function effectiveTopRank(discardPile) {
  return baseTopCard(discardPile)?.rank || null;
}

function drawUpToThree(state, userId) {
  while (state.deck.length > 0 && state.hands[userId].length < 3) {
    state.hands[userId].push(state.deck.shift());
  }
  state.hands[userId] = sortShitheadHand(state.hands[userId]);
}

function opponentId(state, userId) {
  return state.playerOrder.find((id) => id !== userId);
}

function hasPlayable(state, userId) {
  return state.hands[userId].some((card) => canPlayRank(state.discardPile, card.rank));
}

function resolveBombClearIfPending(state) {
  if (!state.bombPendingClear) return;
  state.discardPile = [];
  state.lastBombCard = null;
  state.bombPendingClear = false;
}

export const shitheadEngine = {
  create(players) {
    const deck = shuffle(createDeck());
    const hands = {};

    for (const playerId of players) {
      hands[playerId] = sortShitheadHand(deck.splice(0, 3));
    }

    return {
      type: 'shithead',
      deck,
      discardPile: [],
      lastBombCard: null,
      bombPendingClear: false,
      bombsUsed: 0,
      playerOrder: [...players],
      hands,
      turnUserId: players[Math.floor(Math.random() * players.length)],
      winnerUserId: null,
      message: 'Play one or more cards of the same rank.'
    };
  },

  action(state, userId, action) {
    if (state.winnerUserId) return { ok: false, error: 'Game is over' };
    if (state.turnUserId !== userId) return { ok: false, error: 'Not your turn' };

    if (action.type === 'take-pile') {
      resolveBombClearIfPending(state);
      if (state.discardPile.length === 0) return { ok: false, error: 'Pile is empty' };
      state.hands[userId].push(...state.discardPile);
      state.hands[userId] = sortShitheadHand(state.hands[userId]);
      state.discardPile = [];
      state.lastBombCard = null;
      drawUpToThree(state, userId);
      state.turnUserId = opponentId(state, userId);
      state.message = 'Pile picked up. Opponent turn.';
      return { ok: true };
    }

    if (action.type !== 'play') return { ok: false, error: 'Unknown action' };
    resolveBombClearIfPending(state);

    if (state.discardPile.length > 0 && !hasPlayable(state, userId)) {
      return { ok: false, error: 'No legal play. You must take the pile.' };
    }

    const ids = action.cardIds || [];
    if (!ids.length) return { ok: false, error: 'Choose card(s) to play' };

    const selected = ids.map((id) => state.hands[userId].find((c) => c.id === id)).filter(Boolean);
    if (selected.length !== ids.length) return { ok: false, error: 'Invalid card selection' };

    const playRank = selected[0].rank;
    if (!selected.every((c) => c.rank === playRank)) {
      return { ok: false, error: 'All cards played must share the same rank' };
    }

    if (!canPlayRank(state.discardPile, playRank)) {
      if (topRule(state.discardPile).type === 'max') {
        return { ok: false, error: 'Rule of 7: You must play a 7 or lower on this card' };
      }
      return { ok: false, error: 'Selected rank cannot be played on current pile' };
    }

    for (const id of ids) removeCardById(state.hands[userId], id);
    state.discardPile.push(...selected);

    const bombed = playRank === SPECIAL_BOMB;
    if (bombed) {
      state.bombsUsed += selected.length;
      state.lastBombCard = selected[selected.length - 1];
      state.bombPendingClear = true;
      drawUpToThree(state, userId);
      if (state.deck.length === 0 && state.hands[userId].length === 0) {
        state.winnerUserId = userId;
        state.message = 'You win.';
        return { ok: true };
      }
      state.message = 'Bomb played. Pile will clear before next action. You play again.';
      return { ok: true };
    }

    state.lastBombCard = null;
    drawUpToThree(state, userId);

    if (state.deck.length === 0 && state.hands[userId].length === 0) {
      state.winnerUserId = userId;
      state.message = 'You win.';
      return { ok: true };
    }

    const opp = opponentId(state, userId);
    state.turnUserId = opp;
    if (!hasPlayable(state, opp)) {
      state.message = 'Opponent must pick up the pile (no legal play).';
    } else {
      state.message = 'Turn moved to opponent.';
    }

    return { ok: true };
  },

  view(state, userId, players) {
    const opponent = players.find((p) => p.userId !== userId);
    const top = state.discardPile[state.discardPile.length - 1] || null;
    return {
      gameType: 'shithead',
      turnUserId: state.turnUserId,
      winnerUserId: state.winnerUserId,
      yourHand: state.hands[userId],
      opponentCardCount: opponent ? state.hands[opponent.userId].length : 0,
      discardTop: top || state.lastBombCard,
      discardCount: state.discardPile.length,
      deckCount: state.deck.length,
      topRule: topRule(state.discardPile),
      effectiveTopRank: effectiveTopRank(state.discardPile),
      bombsUsed: state.bombsUsed,
      message: state.message
    };
  }
};
