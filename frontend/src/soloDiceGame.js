import { DICE_GAME_CATEGORIES } from './diceGame.js';

const DICE_PER_TURN = 5;
const MAX_ROLLS = 3;
const UPPER_BONUS_THRESHOLD = 63;
const UPPER_BONUS_SCORE = 35;
const EXTRA_FIVE_KIND_BONUS = 100;
const MAX_EXTRA_FIVE_KIND_BONUSES = 3;

const CATEGORY_ORDER = DICE_GAME_CATEGORIES.map((category) => category.key);
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
  for (const value of dice) counts.set(value, (counts.get(value) || 0) + 1);
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
  if (matchingUpper && scorecard.categories[matchingUpper] === null) return matchingUpper;
  return null;
}

function isJokerRoll(scorecard, dice) {
  return isFiveKind(dice) && scorecard.categories.fiveKind === 50;
}

function canAwardExtraFiveKindBonus(scorecard, dice) {
  return isJokerRoll(scorecard, dice) && scorecard.fiveKindBonusCount < MAX_EXTRA_FIVE_KIND_BONUSES;
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
  return {
    upperSubtotal,
    upperBonus,
    lowerSubtotal,
    fiveKindBonus: scorecard.fiveKindBonus,
    fiveKindBonusCount: scorecard.fiveKindBonusCount,
    fiveKindBonusRemaining: Math.max(0, MAX_EXTRA_FIVE_KIND_BONUSES - scorecard.fiveKindBonusCount),
    fiveKindBonusAvailable: scorecard.categories.fiveKind === 50,
    total,
    filledCount
  };
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
  for (const key of legal) previews[key] = scoreCategory(dice, key, scorecard);
  return previews;
}

function buildState({ userId, username, scorecard, dice, held, rollsUsed, gameOver = false, message }) {
  const summary = summarizeScorecard(scorecard);
  return {
    gameType: 'dice-game',
    gameOver,
    winnerUserId: gameOver ? userId : null,
    turnUserId: userId,
    message,
    maxRolls: MAX_ROLLS,
    maxFiveKindBonuses: MAX_EXTRA_FIVE_KIND_BONUSES,
    openingTotals: null,
    extraFiveKindBonusReady: canAwardExtraFiveKindBonus(scorecard, dice),
    forcedCategory: hasMatchingUpperForced(scorecard, dice),
    yourPreviewScores: previewScores(scorecard, dice, rollsUsed),
    players: [
      {
        userId,
        username,
        isViewer: true,
        isCurrentTurn: true,
        dice: [...dice],
        held: [...held],
        rollsUsed,
        rollsRemaining: Math.max(0, MAX_ROLLS - rollsUsed),
        categories: { ...scorecard.categories },
        summary
      }
    ]
  };
}

export function createSoloDiceGame(userId, username) {
  return buildState({
    userId,
    username,
    scorecard: emptyScorecard(),
    dice: Array(DICE_PER_TURN).fill(null),
    held: Array(DICE_PER_TURN).fill(false),
    rollsUsed: 0,
    message: 'Roll the dice to start your turn.'
  });
}

export function soloDiceGameReducer(state, action) {
  if (!state) {
    if (action?.type === 'new-game') return createSoloDiceGame(action.userId, action.username);
    return state;
  }

  if (action.type === 'new-game') {
    return createSoloDiceGame(action.userId, action.username);
  }

  if (state.gameOver) return state;

  const player = state.players[0];
  const scorecard = {
    categories: { ...player.categories },
    fiveKindBonus: player.summary.fiveKindBonus,
    fiveKindBonusCount: player.summary.fiveKindBonusCount
  };
  const dice = [...player.dice];
  const held = [...player.held];
  const rollsUsed = player.rollsUsed;

  if (action.type === 'roll') {
    if (rollsUsed >= MAX_ROLLS) return state;
    for (let i = 0; i < DICE_PER_TURN; i += 1) {
      if (rollsUsed === 0 || !held[i]) dice[i] = rollDie();
    }
    const nextRolls = rollsUsed + 1;
    return buildState({
      userId: player.userId,
      username: player.username,
      scorecard,
      dice,
      held,
      rollsUsed: nextRolls,
      message:
        nextRolls >= MAX_ROLLS
          ? 'Final roll used. Select a score category.'
          : 'Choose dice to hold, roll again, or score this turn.'
    });
  }

  if (action.type === 'toggle-hold') {
    if (rollsUsed === 0 || rollsUsed >= MAX_ROLLS) return state;
    const index = Number(action.index);
    if (!Number.isInteger(index) || index < 0 || index >= DICE_PER_TURN) return state;
    held[index] = !held[index];
    return buildState({
      userId: player.userId,
      username: player.username,
      scorecard,
      dice,
      held,
      rollsUsed,
      message: state.message
    });
  }

  if (action.type === 'score') {
    const category = String(action.category || '');
    if (!CATEGORY_ORDER.includes(category)) return state;
    if (scorecard.categories[category] !== null) return state;
    if (rollsUsed === 0 || dice.some((value) => value == null)) return state;

    const legal = legalCategories(scorecard, dice);
    if (!legal.has(category)) return state;

    if (canAwardExtraFiveKindBonus(scorecard, dice) && category !== 'fiveKind') {
      scorecard.fiveKindBonus += EXTRA_FIVE_KIND_BONUS;
      scorecard.fiveKindBonusCount += 1;
    }

    scorecard.categories[category] = scoreCategory(dice, category, scorecard);
    const filledCount = CATEGORY_ORDER.filter((key) => scorecard.categories[key] !== null).length;

    return buildState({
      userId: player.userId,
      username: player.username,
      scorecard,
      dice: Array(DICE_PER_TURN).fill(null),
      held: Array(DICE_PER_TURN).fill(false),
      rollsUsed: 0,
      gameOver: filledCount === CATEGORY_ORDER.length,
      message:
        filledCount === CATEGORY_ORDER.length
          ? 'All categories filled. Final score locked in.'
          : 'Category scored. Roll the dice to begin the next turn.'
    });
  }

  return state;
}
