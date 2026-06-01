const DICE_PER_TURN = 5;
const MAX_ROLLS = 3;
const UPPER_BONUS_THRESHOLD = 63;
const UPPER_BONUS_SCORE = 35;
const EXTRA_FIVE_KIND_BONUS = 100;
const MAX_EXTRA_FIVE_KIND_BONUSES = 3;

const CATEGORY_ORDER = [
  'ones',
  'twos',
  'threes',
  'fours',
  'fives',
  'sixes',
  'threeKind',
  'fourKind',
  'fullHouse',
  'smallStraight',
  'largeStraight',
  'chance',
  'fiveKind'
];

const UPPER_CATEGORY_TO_FACE = {
  ones: 1,
  twos: 2,
  threes: 3,
  fours: 4,
  fives: 5,
  sixes: 6
};

const LOWER_CATEGORIES = new Set([
  'threeKind',
  'fourKind',
  'fullHouse',
  'smallStraight',
  'largeStraight',
  'chance',
  'fiveKind'
]);

function rollDie() {
  return Math.floor(Math.random() * 6) + 1;
}

function rollDice(count) {
  return Array.from({ length: count }, () => rollDie());
}

function emptyScorecard() {
  return {
    categories: Object.fromEntries(CATEGORY_ORDER.map((key) => [key, null])),
    fiveKindBonus: 0,
    fiveKindBonusCount: 0
  };
}

function diceTotal(dice) {
  return dice.reduce((sum, value) => sum + value, 0);
}

function countsByFace(dice) {
  const counts = new Map();
  for (const value of dice) {
    counts.set(value, (counts.get(value) || 0) + 1);
  }
  return counts;
}

function sortedCounts(dice) {
  return [...countsByFace(dice).values()].sort((a, b) => b - a);
}

function isFiveKind(dice) {
  return sortedCounts(dice)[0] === DICE_PER_TURN;
}

function isFullHouse(dice) {
  const counts = sortedCounts(dice);
  return counts.length === 2 && counts[0] === 3 && counts[1] === 2;
}

function hasStraight(dice, neededLength) {
  const faces = [...new Set(dice)].sort((a, b) => a - b);
  let run = 1;
  for (let i = 1; i < faces.length; i += 1) {
    if (faces[i] === faces[i - 1] + 1) {
      run += 1;
      if (run >= neededLength) return true;
    } else {
      run = 1;
    }
  }
  return false;
}

function hasMatchingUpperForced(scorecard, dice) {
  if (!isFiveKind(dice) || scorecard.categories.fiveKind !== 50) return null;
  const matchingUpper = Object.entries(UPPER_CATEGORY_TO_FACE).find(([, face]) => face === dice[0])?.[0] || null;
  if (matchingUpper && scorecard.categories[matchingUpper] === null) {
    return matchingUpper;
  }
  return null;
}

function isJokerRoll(scorecard, dice) {
  return isFiveKind(dice) && scorecard.categories.fiveKind === 50;
}

function scoreCategory(dice, category, scorecard) {
  const total = diceTotal(dice);
  const counts = sortedCounts(dice);
  const jokerRoll = isJokerRoll(scorecard, dice);

  if (category in UPPER_CATEGORY_TO_FACE) {
    const face = UPPER_CATEGORY_TO_FACE[category];
    return dice.filter((value) => value === face).length * face;
  }

  switch (category) {
    case 'threeKind':
      return counts[0] >= 3 ? total : 0;
    case 'fourKind':
      return counts[0] >= 4 ? total : 0;
    case 'fullHouse':
      return isFullHouse(dice) || jokerRoll ? 25 : 0;
    case 'smallStraight':
      return hasStraight(dice, 4) || jokerRoll ? 30 : 0;
    case 'largeStraight':
      return hasStraight(dice, 5) || jokerRoll ? 40 : 0;
    case 'chance':
      return total;
    case 'fiveKind':
      return isFiveKind(dice) ? 50 : 0;
    default:
      return 0;
  }
}

function summarizeScorecard(scorecard) {
  const upperSubtotal = Object.keys(UPPER_CATEGORY_TO_FACE).reduce(
    (sum, key) => sum + (scorecard.categories[key] || 0),
    0
  );
  const upperBonus = upperSubtotal >= UPPER_BONUS_THRESHOLD ? UPPER_BONUS_SCORE : 0;
  const lowerSubtotal = CATEGORY_ORDER.filter((key) => LOWER_CATEGORIES.has(key)).reduce(
    (sum, key) => sum + (scorecard.categories[key] || 0),
    0
  );
  const total = upperSubtotal + upperBonus + lowerSubtotal + scorecard.fiveKindBonus;
  const filledCount = CATEGORY_ORDER.filter((key) => scorecard.categories[key] !== null).length;
  const fiveKindBonusAvailable = scorecard.categories.fiveKind === 50;

  return {
    upperSubtotal,
    upperBonus,
    lowerSubtotal,
    fiveKindBonus: scorecard.fiveKindBonus,
    fiveKindBonusCount: scorecard.fiveKindBonusCount,
    fiveKindBonusRemaining: Math.max(0, MAX_EXTRA_FIVE_KIND_BONUSES - scorecard.fiveKindBonusCount),
    fiveKindBonusAvailable,
    total,
    filledCount
  };
}

function getNextPlayerId(state, userId) {
  return state.playerOrder.find((id) => id !== userId);
}

function resetTurn(state, userId) {
  state.turnUserId = userId;
  state.turn = {
    dice: Array(DICE_PER_TURN).fill(null),
    held: Array(DICE_PER_TURN).fill(false),
    rollsUsed: 0
  };
}

function updateVisibleTurn(state, userId) {
  state.visibleBoards[userId] = {
    dice: [...state.turn.dice],
    held: [...state.turn.held]
  };
}

function decideFirstPlayer(players) {
  while (true) {
    const rolls = Object.fromEntries(players.map((id) => [id, rollDice(DICE_PER_TURN)]));
    const totals = players.map((id) => ({ id, total: diceTotal(rolls[id]) }));
    totals.sort((a, b) => b.total - a.total);
    if (totals[0].total !== totals[1].total) {
      return {
        firstPlayerId: totals[0].id,
        openingRolls: rolls,
        openingTotals: Object.fromEntries(totals.map(({ id, total }) => [id, total]))
      };
    }
  }
}

function isGameComplete(state) {
  return state.playerOrder.every((id) => summarizeScorecard(state.scorecards[id]).filledCount === CATEGORY_ORDER.length);
}

function getWinnerId(state) {
  const [a, b] = state.playerOrder;
  const aTotal = summarizeScorecard(state.scorecards[a]).total;
  const bTotal = summarizeScorecard(state.scorecards[b]).total;
  if (aTotal === bTotal) return null;
  return aTotal > bTotal ? a : b;
}

function legalCategories(scorecard, dice) {
  const forced = hasMatchingUpperForced(scorecard, dice);
  if (forced) return new Set([forced]);

  return new Set(CATEGORY_ORDER.filter((key) => scorecard.categories[key] === null));
}

function previewScores(scorecard, dice, rollsUsed) {
  if (rollsUsed === 0 || dice.some((value) => value == null)) return {};

  const legal = legalCategories(scorecard, dice);
  const previews = {};
  for (const key of legal) {
    previews[key] = scoreCategory(dice, key, scorecard);
  }
  return previews;
}

function canAwardExtraFiveKindBonus(scorecard, dice) {
  return (
    isJokerRoll(scorecard, dice) &&
    scorecard.fiveKindBonusCount < MAX_EXTRA_FIVE_KIND_BONUSES
  );
}

export const diceGameEngine = {
  create(players) {
    const { firstPlayerId, openingRolls, openingTotals } = decideFirstPlayer(players);
    const scorecards = Object.fromEntries(players.map((id) => [id, emptyScorecard()]));
    const visibleBoards = Object.fromEntries(
      players.map((id) => [
        id,
        {
          dice: [...openingRolls[id]],
          held: Array(DICE_PER_TURN).fill(false)
        }
      ])
    );

    return {
      type: 'dice-game',
      playerOrder: [...players],
      scorecards,
      visibleBoards,
      openingTotals,
      turnUserId: firstPlayerId,
      turn: {
        dice: Array(DICE_PER_TURN).fill(null),
        held: Array(DICE_PER_TURN).fill(false),
        rollsUsed: 0
      },
      gameOver: false,
      winnerUserId: null,
      message: 'Roll the dice to start your turn.'
    };
  },

  action(state, userId, action) {
    if (state.gameOver) return { ok: false, error: 'Game is over' };
    if (state.turnUserId !== userId) return { ok: false, error: 'Not your turn' };

    const scorecard = state.scorecards[userId];

    if (action.type === 'roll') {
      if (state.turn.rollsUsed >= MAX_ROLLS) {
        return { ok: false, error: 'No rolls remaining. Choose a category.' };
      }

      for (let i = 0; i < DICE_PER_TURN; i += 1) {
        if (state.turn.rollsUsed === 0 || !state.turn.held[i]) {
          state.turn.dice[i] = rollDie();
        }
      }

      state.turn.rollsUsed += 1;
      updateVisibleTurn(state, userId);
      state.message =
        state.turn.rollsUsed >= MAX_ROLLS
          ? 'Final roll used. Select a score category.'
          : 'Choose dice to hold, roll again, or score this turn.';
      return { ok: true };
    }

    if (action.type === 'toggle-hold') {
      if (state.turn.rollsUsed === 0) return { ok: false, error: 'Roll first before holding dice' };
      if (state.turn.rollsUsed >= MAX_ROLLS) return { ok: false, error: 'No rolls remaining. Choose a category.' };
      const index = Number(action.index);
      if (!Number.isInteger(index) || index < 0 || index >= DICE_PER_TURN) {
        return { ok: false, error: 'Invalid die selection' };
      }
      state.turn.held[index] = !state.turn.held[index];
      updateVisibleTurn(state, userId);
      return { ok: true };
    }

    if (action.type === 'score') {
      const category = String(action.category || '');
      if (!CATEGORY_ORDER.includes(category)) return { ok: false, error: 'Unknown score category' };
      if (scorecard.categories[category] !== null) return { ok: false, error: 'That category has already been used' };
      if (state.turn.rollsUsed === 0 || state.turn.dice.some((value) => value == null)) {
        return { ok: false, error: 'Roll the dice before scoring' };
      }

      const legal = legalCategories(scorecard, state.turn.dice);
      if (!legal.has(category)) {
        return { ok: false, error: 'This roll must be scored in the matching upper category' };
      }

      if (canAwardExtraFiveKindBonus(scorecard, state.turn.dice) && category !== 'fiveKind') {
        scorecard.fiveKindBonus += EXTRA_FIVE_KIND_BONUS;
        scorecard.fiveKindBonusCount += 1;
      }

      const scoredValue = scoreCategory(state.turn.dice, category, scorecard);
      scorecard.categories[category] = scoredValue;
      updateVisibleTurn(state, userId);

      if (isGameComplete(state)) {
        state.gameOver = true;
        state.winnerUserId = getWinnerId(state);
        state.message = 'All categories filled. Final score locked in.';
        return { ok: true };
      }

      resetTurn(state, getNextPlayerId(state, userId));
      state.message = 'Turn passed. Roll the dice to begin the next turn.';
      return { ok: true };
    }

    return { ok: false, error: 'Unknown action' };
  },

  view(state, userId, players) {
    return {
      gameType: 'dice-game',
      turnUserId: state.turnUserId,
      gameOver: state.gameOver,
      winnerUserId: state.winnerUserId,
      message: state.message,
      maxRolls: MAX_ROLLS,
      maxFiveKindBonuses: MAX_EXTRA_FIVE_KIND_BONUSES,
      openingTotals: state.openingTotals,
      players: state.playerOrder.map((id) => {
        const scorecard = state.scorecards[id];
        const summary = summarizeScorecard(scorecard);
        const isCurrentTurn = id === state.turnUserId;
        const board = isCurrentTurn ? state.turn : state.visibleBoards[id];
        return {
          userId: id,
          username: players.find((player) => player.userId === id)?.username || `Player ${id}`,
          isViewer: id === userId,
          isCurrentTurn,
          dice: [...board.dice],
          held: [...board.held],
          rollsUsed: isCurrentTurn ? state.turn.rollsUsed : 0,
          rollsRemaining: isCurrentTurn ? MAX_ROLLS - state.turn.rollsUsed : 0,
          categories: { ...scorecard.categories },
          summary
        };
      }),
      yourPreviewScores: previewScores(state.scorecards[userId], state.turn.dice, state.turn.rollsUsed),
      forcedCategory: hasMatchingUpperForced(state.scorecards[userId], state.turn.dice),
      extraFiveKindBonusReady: canAwardExtraFiveKindBonus(state.scorecards[userId], state.turn.dice),
      categoryOrder: CATEGORY_ORDER
    };
  }
};
