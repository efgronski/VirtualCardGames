export const DICE_GAME_CATEGORIES = [
  { key: 'ones', label: 'Ones', shortLabel: '1', icon: '1' },
  { key: 'twos', label: 'Twos', shortLabel: '2', icon: '2' },
  { key: 'threes', label: 'Threes', shortLabel: '3', icon: '3' },
  { key: 'fours', label: 'Fours', shortLabel: '4', icon: '4' },
  { key: 'fives', label: 'Fives', shortLabel: '5', icon: '5' },
  { key: 'sixes', label: 'Sixes', shortLabel: '6', icon: '6' },
  { key: 'threeKind', label: '3 of a Kind', shortLabel: '3K', icon: '3K' },
  { key: 'fourKind', label: '4 of a Kind', shortLabel: '4K', icon: '4K' },
  { key: 'fullHouse', label: 'Full House', shortLabel: 'FH', icon: 'FH' },
  { key: 'smallStraight', label: 'Small Straight', shortLabel: 'SS', icon: 'S4' },
  { key: 'largeStraight', label: 'Large Straight', shortLabel: 'LS', icon: 'S5' },
  { key: 'chance', label: 'Chance', shortLabel: 'CH', icon: '?' },
  { key: 'fiveKind', label: '5 of a Kind', shortLabel: '5K', icon: '5K' }
];

export const DICE_GAME_CATEGORY_MAP = Object.fromEntries(
  DICE_GAME_CATEGORIES.map((category) => [category.key, category])
);
