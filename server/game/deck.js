import { CARD_TYPES, HAND_SIZE } from '@mario-cartes/shared';

let _nextId = 0;
function makeCard(type) {
  return { id: `card-${_nextId++}`, type };
}

export function buildStartingDeck() {
  return [
    makeCard(CARD_TYPES.FORWARD_1),
    makeCard(CARD_TYPES.FORWARD_1),
    makeCard(CARD_TYPES.FORWARD_1),
    makeCard(CARD_TYPES.FORWARD_1),
    makeCard(CARD_TYPES.BANANA_FORWARD_1),
    makeCard(CARD_TYPES.BANANA_FORWARD_1),
    makeCard(CARD_TYPES.FORWARD_2),
  ];
}

// Fisher-Yates shuffle — returns a new array
export function shuffle(array) {
  const arr = [...array];
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// Draw n cards from drawPile. If drawPile runs out, shuffle discardPile into it.
// Returns { drawn, newDrawPile, newDiscardPile }
export function drawCards(drawPile, discardPile, n = HAND_SIZE) {
  let pile = [...drawPile];
  let discard = [...discardPile];
  const drawn = [];

  while (drawn.length < n) {
    if (pile.length === 0) {
      if (discard.length === 0) break; // no cards left at all
      pile = shuffle(discard);
      discard = [];
    }
    drawn.push(pile.shift());
  }

  return { drawn, newDrawPile: pile, newDiscardPile: discard };
}
