const SUITS = ['S', 'H', 'D', 'C'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

function cloneCard(card) {
  return { ...card };
}

function cardColor(card) {
  return card.suit === 'H' || card.suit === 'D' ? 'red' : 'black';
}

function rankValue(rank) {
  return RANKS.indexOf(rank) + 1;
}

function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ id: `${rank}${suit}`, rank, suit });
    }
  }
  return deck;
}

function shuffle(deck) {
  const next = [...deck];
  for (let i = next.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [next[i], next[j]] = [next[j], next[i]];
  }
  return next;
}

function cloneState(state) {
  return {
    stock: state.stock.map(cloneCard),
    waste: state.waste.map(cloneCard),
    foundations: {
      S: state.foundations.S.map(cloneCard),
      H: state.foundations.H.map(cloneCard),
      D: state.foundations.D.map(cloneCard),
      C: state.foundations.C.map(cloneCard)
    },
    tableau: state.tableau.map((col) => ({
      down: col.down.map(cloneCard),
      up: col.up.map(cloneCard)
    })),
    won: state.won,
    invalidMoveTick: state.invalidMoveTick,
    invalidMoveReason: state.invalidMoveReason,
    history: state.history.map((snapshot) => ({
      stock: snapshot.stock.map(cloneCard),
      waste: snapshot.waste.map(cloneCard),
      foundations: {
        S: snapshot.foundations.S.map(cloneCard),
        H: snapshot.foundations.H.map(cloneCard),
        D: snapshot.foundations.D.map(cloneCard),
        C: snapshot.foundations.C.map(cloneCard)
      },
      tableau: snapshot.tableau.map((col) => ({
        down: col.down.map(cloneCard),
        up: col.up.map(cloneCard)
      })),
      won: snapshot.won
    }))
  };
}

function snapshot(state) {
  return {
    stock: state.stock.map(cloneCard),
    waste: state.waste.map(cloneCard),
    foundations: {
      S: state.foundations.S.map(cloneCard),
      H: state.foundations.H.map(cloneCard),
      D: state.foundations.D.map(cloneCard),
      C: state.foundations.C.map(cloneCard)
    },
    tableau: state.tableau.map((col) => ({
      down: col.down.map(cloneCard),
      up: col.up.map(cloneCard)
    })),
    won: state.won
  };
}

function withHistory(prev, next, reason = '') {
  const snap = snapshot(prev);
  return {
    ...next,
    history: [...prev.history, snap],
    invalidMoveTick: prev.invalidMoveTick,
    invalidMoveReason: reason
  };
}

function withInvalid(prev, reason) {
  return {
    ...prev,
    invalidMoveTick: prev.invalidMoveTick + 1,
    invalidMoveReason: reason
  };
}

function updateWin(next) {
  const total = SUITS.reduce((sum, suit) => sum + next.foundations[suit].length, 0);
  next.won = total === 52;
  return next;
}

function maybeFlipTableauColumn(column) {
  if (column.up.length === 0 && column.down.length > 0) {
    column.up.push(column.down.pop());
  }
}

export function dealKlondike3() {
  const deck = shuffle(createDeck());
  const tableau = [];

  for (let col = 0; col < 7; col += 1) {
    const down = [];
    for (let j = 0; j < col; j += 1) {
      down.push(deck.pop());
    }
    const up = [deck.pop()];
    tableau.push({ down, up });
  }

  return {
    stock: deck,
    waste: [],
    foundations: { S: [], H: [], D: [], C: [] },
    tableau,
    won: false,
    history: [],
    invalidMoveTick: 0,
    invalidMoveReason: ''
  };
}

export function canPlaceOnFoundation(card, foundation) {
  if (!card) return false;
  if (foundation.length === 0) return card.rank === 'A';
  const top = foundation[foundation.length - 1];
  return card.suit === top.suit && rankValue(card.rank) === rankValue(top.rank) + 1;
}

export function isValidTableauSequence(cards) {
  for (let i = 0; i < cards.length - 1; i += 1) {
    const a = cards[i];
    const b = cards[i + 1];
    if (cardColor(a) === cardColor(b)) return false;
    if (rankValue(a.rank) !== rankValue(b.rank) + 1) return false;
  }
  return true;
}

export function canPlaceOnTableau(cards, targetColumn) {
  if (!cards.length) return false;
  const movingTop = cards[0];
  if (targetColumn.up.length === 0) {
    return movingTop.rank === 'K';
  }
  const targetTop = targetColumn.up[targetColumn.up.length - 1];
  if (cardColor(targetTop) === cardColor(movingTop)) return false;
  return rankValue(targetTop.rank) === rankValue(movingTop.rank) + 1;
}

export function canMoveWasteToFoundation(state) {
  const card = state.waste[state.waste.length - 1];
  if (!card) return false;
  return canPlaceOnFoundation(card, state.foundations[card.suit]);
}

export function canMoveWasteToTableau(state, toCol) {
  const card = state.waste[state.waste.length - 1];
  if (!card) return false;
  return canPlaceOnTableau([card], state.tableau[toCol]);
}

function moveWasteToFoundation(state) {
  const card = state.waste[state.waste.length - 1];
  if (!card) return null;
  const foundation = state.foundations[card.suit];
  if (!canPlaceOnFoundation(card, foundation)) return null;

  const next = cloneState(state);
  next.waste.pop();
  next.foundations[card.suit].push(card);
  return updateWin(next);
}

function moveWasteToTableau(state, toCol) {
  const card = state.waste[state.waste.length - 1];
  if (!card) return null;
  if (!canPlaceOnTableau([card], state.tableau[toCol])) return null;

  const next = cloneState(state);
  next.waste.pop();
  next.tableau[toCol].up.push(card);
  return updateWin(next);
}

function moveTableauToFoundation(state, fromCol, startIndex = null) {
  const source = state.tableau[fromCol];
  const card = source.up[source.up.length - 1];
  if (!card) return null;
  if (startIndex != null && startIndex !== source.up.length - 1) return null;

  if (!canPlaceOnFoundation(card, state.foundations[card.suit])) return null;

  const next = cloneState(state);
  const moved = next.tableau[fromCol].up.pop();
  next.foundations[moved.suit].push(moved);
  maybeFlipTableauColumn(next.tableau[fromCol]);
  return updateWin(next);
}

function moveTableauToTableau(state, fromCol, startIndex, toCol) {
  if (fromCol === toCol) return null;
  const source = state.tableau[fromCol];
  const target = state.tableau[toCol];
  if (startIndex < 0 || startIndex >= source.up.length) return null;

  const sequence = source.up.slice(startIndex);
  if (!isValidTableauSequence(sequence)) return null;
  if (!canPlaceOnTableau(sequence, target)) return null;

  const next = cloneState(state);
  const moved = next.tableau[fromCol].up.splice(startIndex);
  next.tableau[toCol].up.push(...moved);
  maybeFlipTableauColumn(next.tableau[fromCol]);
  return updateWin(next);
}

function drawThree(state) {
  if (state.stock.length === 0) {
    if (state.waste.length === 0) return null;
    const next = cloneState(state);
    next.stock = [...next.waste].reverse();
    next.waste = [];
    return updateWin(next);
  }

  const next = cloneState(state);
  const drawCount = Math.min(3, next.stock.length);
  for (let i = 0; i < drawCount; i += 1) {
    next.waste.push(next.stock.pop());
  }
  return updateWin(next);
}

function autoMoveFromWaste(state) {
  const card = state.waste[state.waste.length - 1];
  if (!card) return null;

  const toFoundation = moveWasteToFoundation(state);
  if (toFoundation) return toFoundation;

  for (let i = 0; i < state.tableau.length; i += 1) {
    const moved = moveWasteToTableau(state, i);
    if (moved) return moved;
  }

  return null;
}

function autoMoveFromTableau(state, fromCol, upIndex) {
  const source = state.tableau[fromCol];
  if (!source || upIndex < 0 || upIndex >= source.up.length) return null;

  const isTop = upIndex === source.up.length - 1;

  if (isTop) {
    const toFoundation = moveTableauToFoundation(state, fromCol);
    if (toFoundation) return toFoundation;
  }

  for (let toCol = 0; toCol < state.tableau.length; toCol += 1) {
    const moved = moveTableauToTableau(state, fromCol, upIndex, toCol);
    if (moved) return moved;
  }

  return null;
}

export function solitaireReducer(state, action) {
  if (!state) return dealKlondike3();

  if (action.type === 'NEW_GAME') return dealKlondike3();

  if (action.type === 'UNDO') {
    if (state.history.length === 0) return withInvalid(state, 'Nothing to undo');
    const prev = state.history[state.history.length - 1];
    return {
      ...cloneState({ ...prev, history: state.history.slice(0, -1), invalidMoveTick: state.invalidMoveTick, invalidMoveReason: '' })
    };
  }

  let next = null;

  if (action.type === 'DRAW') {
    next = drawThree(state);
  } else if (action.type === 'MOVE_WASTE_TO_FOUNDATION') {
    next = moveWasteToFoundation(state);
  } else if (action.type === 'MOVE_WASTE_TO_TABLEAU') {
    next = moveWasteToTableau(state, action.toCol);
  } else if (action.type === 'MOVE_TABLEAU_TO_FOUNDATION') {
    next = moveTableauToFoundation(state, action.fromCol, action.startIndex ?? null);
  } else if (action.type === 'MOVE_TABLEAU_TO_TABLEAU') {
    next = moveTableauToTableau(state, action.fromCol, action.startIndex, action.toCol);
  } else if (action.type === 'AUTO_WASTE') {
    next = autoMoveFromWaste(state);
  } else if (action.type === 'AUTO_TABLEAU') {
    next = autoMoveFromTableau(state, action.fromCol, action.upIndex);
  }

  if (!next) {
    return withInvalid(state, 'Invalid move');
  }

  return withHistory(state, next, '');
}
