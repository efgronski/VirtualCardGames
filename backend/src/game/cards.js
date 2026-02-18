const SUITS = ['S', 'H', 'D', 'C'];
const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

export function createDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) {
      deck.push({ id: `${rank}${suit}`, rank, suit });
    }
  }
  return deck;
}

export function shuffle(cards) {
  const deck = [...cards];
  for (let i = deck.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck;
}

export function rankValue(rank) {
  return RANKS.indexOf(rank) + 1;
}

export function cardPoints(card) {
  if (card.rank === 'A') return 1;
  if (['J', 'Q', 'K'].includes(card.rank)) return 10;
  return Number(card.rank);
}

export function removeCardById(cards, cardId) {
  const idx = cards.findIndex((c) => c.id === cardId);
  if (idx === -1) return null;
  const [card] = cards.splice(idx, 1);
  return card;
}

export function sortByRank(cards) {
  return [...cards].sort((a, b) => {
    const rankDiff = rankValue(a.rank) - rankValue(b.rank);
    if (rankDiff !== 0) return rankDiff;
    return a.suit.localeCompare(b.suit);
  });
}

export const RANK_ORDER = RANKS;
