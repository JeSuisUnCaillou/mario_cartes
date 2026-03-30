import { describe, it, expect } from 'vitest';
import { buildStartingDeck, shuffle, drawCards } from '../game/deck.js';
import { CARD_TYPES } from '@mario-cartes/shared';

describe('buildStartingDeck', () => {
  it('returns 7 cards', () => {
    expect(buildStartingDeck()).toHaveLength(7);
  });

  it('has 4x FORWARD_1, 2x BANANA_FORWARD_1, 1x FORWARD_2', () => {
    const deck = buildStartingDeck();
    const counts = deck.reduce((acc, c) => {
      acc[c.type] = (acc[c.type] || 0) + 1;
      return acc;
    }, {});
    expect(counts[CARD_TYPES.FORWARD_1]).toBe(4);
    expect(counts[CARD_TYPES.BANANA_FORWARD_1]).toBe(2);
    expect(counts[CARD_TYPES.FORWARD_2]).toBe(1);
  });

  it('all cards have unique ids', () => {
    const deck = buildStartingDeck();
    const ids = deck.map((c) => c.id);
    expect(new Set(ids).size).toBe(deck.length);
  });
});

describe('shuffle', () => {
  it('returns a new array with the same elements', () => {
    const deck = buildStartingDeck();
    const shuffled = shuffle(deck);
    expect(shuffled).toHaveLength(deck.length);
    expect(shuffled).not.toBe(deck);
    expect(shuffled.map((c) => c.id).sort()).toEqual(deck.map((c) => c.id).sort());
  });
});

describe('drawCards', () => {
  it('draws n cards from the pile', () => {
    const deck = shuffle(buildStartingDeck());
    const { drawn, newDrawPile } = drawCards(deck, [], 5);
    expect(drawn).toHaveLength(5);
    expect(newDrawPile).toHaveLength(2);
  });

  it('draws all cards if fewer than n remain', () => {
    const { drawn, newDrawPile } = drawCards([buildStartingDeck()[0]], [], 5);
    expect(drawn).toHaveLength(1);
    expect(newDrawPile).toHaveLength(0);
  });

  it('reshuffles discard into draw when draw pile is empty', () => {
    const deck = buildStartingDeck();
    const drawPile = deck.slice(0, 2);
    const discardPile = deck.slice(2); // 5 cards in discard
    const { drawn, newDrawPile, newDiscardPile } = drawCards(drawPile, discardPile, 5);
    expect(drawn).toHaveLength(5);
    expect(newDiscardPile).toHaveLength(0);
    expect(newDrawPile).toHaveLength(2); // 2 (initial draw) + 5 (reshuffled) - 5 (drawn) = 2
  });

  it('returns empty drawn array if both piles are empty', () => {
    const { drawn } = drawCards([], [], 5);
    expect(drawn).toHaveLength(0);
  });
});
