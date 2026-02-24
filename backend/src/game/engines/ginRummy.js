import { cardPoints, createDeck, rankValue, removeCardById, shuffle, sortByRank } from '../cards.js';

const TOTAL_ROUNDS = 3;
const GIN_BONUS = 20;
const UNDERCUT_BONUS = 10;

function getAllMeldMasks(cards) {
  const melds = [];

  const byRank = new Map();
  cards.forEach((card, idx) => {
    const arr = byRank.get(card.rank) || [];
    arr.push(idx);
    byRank.set(card.rank, arr);
  });

  for (const idxs of byRank.values()) {
    if (idxs.length >= 3) {
      if (idxs.length === 3) {
        melds.push(idxs.reduce((m, i) => m | (1 << i), 0));
      } else {
        melds.push(idxs.reduce((m, i) => m | (1 << i), 0));
        for (const drop of idxs) {
          let mask = 0;
          for (const i of idxs) {
            if (i !== drop) mask |= 1 << i;
          }
          melds.push(mask);
        }
      }
    }
  }

  const bySuit = new Map();
  cards.forEach((card, idx) => {
    const arr = bySuit.get(card.suit) || [];
    arr.push({ idx, rank: rankValue(card.rank) });
    bySuit.set(card.suit, arr);
  });

  for (const suited of bySuit.values()) {
    suited.sort((a, b) => a.rank - b.rank);
    for (let i = 0; i < suited.length; i += 1) {
      let j = i;
      while (j + 1 < suited.length && suited[j + 1].rank === suited[j].rank + 1) j += 1;
      if (j - i + 1 >= 3) {
        for (let start = i; start <= j - 2; start += 1) {
          for (let end = start + 2; end <= j; end += 1) {
            let mask = 0;
            for (let k = start; k <= end; k += 1) mask |= 1 << suited[k].idx;
            melds.push(mask);
          }
        }
      }
      i = j;
    }
  }

  return [...new Set(melds)];
}

function minDeadwood(cards) {
  const meldMasks = getAllMeldMasks(cards);
  const memo = new Map();
  const pointsByIndex = cards.map(cardPoints);

  function dfs(usedMask) {
    if (memo.has(usedMask)) return memo.get(usedMask);

    let best = 0;
    for (let i = 0; i < cards.length; i += 1) {
      if ((usedMask & (1 << i)) === 0) best += pointsByIndex[i];
    }

    for (const meldMask of meldMasks) {
      if ((meldMask & usedMask) === 0) {
        const candidate = dfs(usedMask | meldMask);
        if (candidate < best) best = candidate;
      }
    }

    memo.set(usedMask, best);
    return best;
  }

  return dfs(0);
}

function findOpponentId(state, userId) {
  return state.playerOrder.find((id) => id !== userId);
}

function setupRound(state) {
  const deck = shuffle(createDeck());
  const hands = {};
  for (const playerId of state.playerOrder) {
    hands[playerId] = sortByRank(deck.splice(0, 10));
  }

  state.deck = deck;
  state.discardPile = [deck.shift()];
  state.hands = hands;
  state.turnUserId = state.playerOrder[Math.floor(Math.random() * state.playerOrder.length)];
  state.mustDiscard = false;
  state.roundOver = false;
  state.roundWinnerUserId = null;
  state.knockedBy = null;
  state.lastRound = null;
  state.message = `Round ${state.roundNumber}: draw from deck or discard pile.`;
}

function finishRound(state, knockerId = null) {
  const a = state.playerOrder[0];
  const b = state.playerOrder[1];
  const aDeadwood = minDeadwood(state.hands[a]);
  const bDeadwood = minDeadwood(state.hands[b]);

  let winnerId = null;
  let points = 0;
  let note = '';

  if (knockerId) {
    const opponentId = findOpponentId(state, knockerId);
    const knockerDeadwood = knockerId === a ? aDeadwood : bDeadwood;
    const opponentDeadwood = opponentId === a ? aDeadwood : bDeadwood;

    if (knockerDeadwood === 0 && opponentDeadwood > 0) {
      winnerId = knockerId;
      points = GIN_BONUS + (opponentDeadwood - knockerDeadwood);
      note = `Gin bonus ${GIN_BONUS} + deadwood diff.`;
    } else if (knockerDeadwood <= opponentDeadwood) {
      winnerId = knockerId;
      points = opponentDeadwood - knockerDeadwood;
      note = 'Knock successful.';
    } else {
      winnerId = opponentId;
      points = UNDERCUT_BONUS + (knockerDeadwood - opponentDeadwood);
      note = `Undercut bonus ${UNDERCUT_BONUS} + deadwood diff.`;
    }
  } else {
    if (aDeadwood < bDeadwood) {
      winnerId = a;
      points = bDeadwood - aDeadwood;
    } else if (bDeadwood < aDeadwood) {
      winnerId = b;
      points = aDeadwood - bDeadwood;
    }
    note = 'Round ended (deck exhausted).';
  }

  if (winnerId) state.scores[winnerId] += points;
  state.roundWinnerUserId = winnerId;
  state.roundOver = true;
  state.lastRound = { aDeadwood, bDeadwood, winnerId, points, note };

  if (state.roundNumber >= TOTAL_ROUNDS) {
    const aScore = state.scores[a];
    const bScore = state.scores[b];
    state.matchWinnerUserId = aScore === bScore ? null : aScore > bScore ? a : b;
    state.winnerUserId = state.matchWinnerUserId;
    state.message = `Match complete after ${TOTAL_ROUNDS} rounds. Score ${aScore}-${bScore}.`;
  } else {
    state.message = `Round ${state.roundNumber} complete. ${note} Press next round.`;
  }
}

export const ginRummyEngine = {
  create(players) {
    const state = {
      type: 'gin-rummy',
      playerOrder: [...players],
      scores: { [players[0]]: 0, [players[1]]: 0 },
      roundNumber: 1,
      winnerUserId: null,
      matchWinnerUserId: null
    };
    setupRound(state);
    return state;
  },

  action(state, userId, action) {
    if (action.type === 'next-round') {
      if (!state.roundOver) return { ok: false, error: 'Current round is not finished' };
      if (state.roundNumber >= TOTAL_ROUNDS) return { ok: false, error: 'Match already finished' };
      state.roundNumber += 1;
      setupRound(state);
      return { ok: true };
    }

    if (state.roundOver || state.winnerUserId) {
      return { ok: false, error: 'Round is over' };
    }
    if (state.turnUserId !== userId) return { ok: false, error: 'Not your turn' };

    const hand = state.hands[userId];

    if (action.type === 'draw') {
      if (state.mustDiscard) return { ok: false, error: 'You must discard first' };
      if (action.source === 'discard') {
        if (!state.discardPile.length) return { ok: false, error: 'Discard pile is empty' };
        hand.push(state.discardPile.pop());
      } else {
        if (!state.deck.length) return { ok: false, error: 'Deck is empty' };
        hand.push(state.deck.shift());
      }
      state.hands[userId] = sortByRank(hand);
      state.mustDiscard = true;
      state.message = 'Discard one card or knock (deadwood 10 or less).';
      return { ok: true };
    }

    if (action.type === 'discard') {
      if (!state.mustDiscard) return { ok: false, error: 'Draw first' };
      const removed = removeCardById(hand, action.cardId);
      if (!removed) return { ok: false, error: 'Card not in hand' };

      state.discardPile.push(removed);
      state.mustDiscard = false;

      if (!state.deck.length) {
        finishRound(state, null);
      } else {
        state.turnUserId = findOpponentId(state, userId);
        state.message = 'Opponent turn.';
      }
      return { ok: true };
    }

    if (action.type === 'knock') {
      if (!state.mustDiscard) return { ok: false, error: 'Knock after drawing' };
      const myDeadwood = minDeadwood(state.hands[userId]);
      if (myDeadwood > 10) return { ok: false, error: 'Deadwood must be 10 or less to knock' };
      state.knockedBy = userId;
      finishRound(state, userId);
      return { ok: true };
    }

    return { ok: false, error: 'Unknown action' };
  },

  view(state, userId, players) {
    const opponent = players.find((p) => p.userId !== userId);
    const opponentId = opponent?.userId;
    const revealHands = state.roundOver || state.winnerUserId !== null;

    return {
      gameType: 'gin-rummy',
      turnUserId: state.turnUserId,
      winnerUserId: state.winnerUserId,
      matchWinnerUserId: state.matchWinnerUserId,
      roundWinnerUserId: state.roundWinnerUserId,
      roundNumber: state.roundNumber,
      totalRounds: TOTAL_ROUNDS,
      roundOver: state.roundOver,
      deckCount: state.deck.length,
      discardTop: state.discardPile[state.discardPile.length - 1] || null,
      yourHand: state.hands[userId],
      opponentCardCount: opponentId ? state.hands[opponentId].length : 0,
      opponentHand: revealHands && opponentId ? state.hands[opponentId] : null,
      mustDiscard: state.mustDiscard,
      message: state.message,
      scores: { ...state.scores },
      lastRound: state.lastRound,
      yourDeadwood: minDeadwood(state.hands[userId])
    };
  }
};
