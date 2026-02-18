import { createDeck, rankValue, removeCardById, shuffle, sortByRank } from '../cards.js';

const SPECIAL_RESET = '2';
const SPECIAL_MIRROR = '3';
const SPECIAL_LIMIT7 = '7';
const SPECIAL_BOMB = '10';

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

  if (base.rank === SPECIAL_RESET) return { type: 'min', value: rankValue('2') };
  if (base.rank === SPECIAL_LIMIT7) return { type: 'max', value: rankValue('7') };
  return { type: 'min', value: rankValue(base.rank) };
}

function canPlayRank(discardPile, rank) {
  if (rank === SPECIAL_RESET || rank === SPECIAL_BOMB || rank === SPECIAL_MIRROR) return true;

  const rule = topRule(discardPile);
  if (rule.type === 'any') return true;

  const value = rankValue(rank);
  if (rule.type === 'min') return value >= rule.value;
  return value <= rule.value;
}

function drawUpToThree(state, userId) {
  while (state.deck.length > 0 && state.hands[userId].length < 3) {
    state.hands[userId].push(state.deck.shift());
  }
  state.hands[userId] = sortByRank(state.hands[userId]);
}

function opponentId(state, userId) {
  return state.playerOrder.find((id) => id !== userId);
}

function hasPlayable(state, userId) {
  return state.hands[userId].some((card) => canPlayRank(state.discardPile, card.rank));
}

export const shitheadEngine = {
  create(players) {
    const deck = shuffle(createDeck());
    const hands = {};

    for (const playerId of players) {
      hands[playerId] = sortByRank(deck.splice(0, 3));
    }

    return {
      type: 'shithead',
      deck,
      discardPile: [],
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
      if (state.discardPile.length === 0) return { ok: false, error: 'Pile is empty' };
      state.hands[userId].push(...state.discardPile);
      state.hands[userId] = sortByRank(state.hands[userId]);
      state.discardPile = [];
      drawUpToThree(state, userId);
      state.turnUserId = opponentId(state, userId);
      state.message = 'Pile picked up. Opponent turn.';
      return { ok: true };
    }

    if (action.type !== 'play') return { ok: false, error: 'Unknown action' };
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
      return { ok: false, error: 'Selected rank cannot be played on current pile' };
    }

    for (const id of ids) removeCardById(state.hands[userId], id);
    state.discardPile.push(...selected);

    const bombed = playRank === SPECIAL_BOMB;
    if (bombed) {
      state.discardPile = [];
      drawUpToThree(state, userId);
      if (state.deck.length === 0 && state.hands[userId].length === 0) {
        state.winnerUserId = userId;
        state.message = 'You win.';
        return { ok: true };
      }
      state.message = 'Bomb! Pile cleared. You play again.';
      return { ok: true };
    }

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
    return {
      gameType: 'shithead',
      turnUserId: state.turnUserId,
      winnerUserId: state.winnerUserId,
      yourHand: state.hands[userId],
      opponentCardCount: opponent ? state.hands[opponent.userId].length : 0,
      discardTop: state.discardPile[state.discardPile.length - 1] || null,
      discardCount: state.discardPile.length,
      deckCount: state.deck.length,
      topRule: topRule(state.discardPile),
      message: state.message
    };
  }
};
