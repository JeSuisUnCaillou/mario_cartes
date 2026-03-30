import { describe, it, expect } from 'vitest';
import { resolveRound } from '../game/rules.js';
import { buildStartingDeck } from '../game/deck.js';
import { CARD_TYPES } from '@mario-cartes/shared';

function makePlayer(id, position = 1) {
  const deck = buildStartingDeck();
  return {
    id,
    position,
    laps: 0,
    hand: [...deck],
    drawPile: [],
    discardPile: [],
    finished: false,
  };
}

function makePlayers(...ids) {
  const map = new Map();
  ids.forEach((id) => map.set(id, makePlayer(id)));
  return map;
}

function card(type) {
  return { id: `test-${Math.random()}`, type };
}

// Pick a card of a given type from a player's actual hand
function pickFromHand(player, type) {
  const c = player.hand.find((card) => card.type === type);
  if (!c) throw new Error(`No card of type ${type} in hand`);
  return c;
}

describe('resolveRound', () => {
  it('moves a cart forward 1 cell with FORWARD_1', () => {
    const players = makePlayers('p1');
    players.get('p1').position = 5;
    const choices = new Map([['p1', card(CARD_TYPES.FORWARD_1)]]);
    const { players: updated } = resolveRound(players, choices, new Set(), ['p1']);
    expect(updated.get('p1').position).toBe(6);
  });

  it('moves a cart forward 2 cells with FORWARD_2', () => {
    const players = makePlayers('p1');
    players.get('p1').position = 5;
    const choices = new Map([['p1', card(CARD_TYPES.FORWARD_2)]]);
    const { players: updated } = resolveRound(players, choices, new Set(), ['p1']);
    expect(updated.get('p1').position).toBe(7);
  });

  it('places a banana at landing cell with BANANA_FORWARD_1', () => {
    const players = makePlayers('p1');
    players.get('p1').position = 3;
    const choices = new Map([['p1', card(CARD_TYPES.BANANA_FORWARD_1)]]);
    const { bananaPositions, events } = resolveRound(players, choices, new Set(), ['p1']);
    expect(bananaPositions.has(4)).toBe(true);
    expect(events.some((e) => e.type === 'BANANA_PLACED')).toBe(true);
  });

  it('discards a random card when landing on a banana', () => {
    const players = makePlayers('p1', 'p2');
    // p2 at cell 2 plays BANANA_FORWARD_1 → lands at 3, drops banana there
    // p1 at cell 2 plays FORWARD_1 → lands at 3 (banana already placed by p2)
    players.get('p1').position = 2;
    players.get('p2').position = 2;
    const choices = new Map([
      ['p2', pickFromHand(players.get('p2'), CARD_TYPES.BANANA_FORWARD_1)],
      ['p1', pickFromHand(players.get('p1'), CARD_TYPES.FORWARD_1)],
    ]);
    const initialHandSize = players.get('p1').hand.length;
    const { players: updated, events } = resolveRound(players, choices, new Set(), ['p2', 'p1']);
    // p1 played 1 card (to discard) + 1 discarded by banana hit = hand - 2
    expect(updated.get('p1').hand.length).toBe(initialHandSize - 2);
    expect(events.some((e) => e.type === 'BANANA_HIT' && e.playerId === 'p1')).toBe(true);
  });

  it('detects lap completion when crossing start/finish', () => {
    const players = makePlayers('p1');
    players.get('p1').position = 19; // one cell before finish
    const choices = new Map([['p1', card(CARD_TYPES.FORWARD_1)]]);
    const { players: updated, events } = resolveRound(players, choices, new Set(), ['p1']);
    expect(updated.get('p1').laps).toBe(1);
    expect(events.some((e) => e.type === 'LAP_COMPLETED')).toBe(true);
  });

  it('respects turn order: banana placed by earlier player is landable by later player', () => {
    const players = makePlayers('p1', 'p2');
    // p1 at cell 3 plays BANANA_FORWARD_1 → lands at 4, drops banana at 4
    // p2 at cell 3 plays FORWARD_1 → lands at 4 (hits banana placed by p1)
    players.get('p1').position = 3;
    players.get('p2').position = 3;
    const choices = new Map([
      ['p1', pickFromHand(players.get('p1'), CARD_TYPES.BANANA_FORWARD_1)],
      ['p2', pickFromHand(players.get('p2'), CARD_TYPES.FORWARD_1)],
    ]);
    const initialP2HandSize = players.get('p2').hand.length;
    const { players: updated } = resolveRound(players, choices, new Set(), ['p1', 'p2']);
    // p2 played 1 card (to discard) + 1 discarded by banana hit = hand - 2
    expect(updated.get('p2').hand.length).toBe(initialP2HandSize - 2);
  });

  it('does not mutate input players map', () => {
    const players = makePlayers('p1');
    players.get('p1').position = 5;
    const originalPos = players.get('p1').position;
    const choices = new Map([['p1', card(CARD_TYPES.FORWARD_1)]]);
    resolveRound(players, choices, new Set(), ['p1']);
    expect(players.get('p1').position).toBe(originalPos);
  });
});
