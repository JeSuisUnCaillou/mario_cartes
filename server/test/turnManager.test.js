import { describe, it, expect } from 'vitest';
import { createTurnState, startGame, recordChoice, finishResolution } from '../game/turnManager.js';
import { PHASES, LAPS_TO_WIN } from '@mario-cartes/shared';

function card(type = 'FORWARD_1') {
  return { id: `c-${Math.random()}`, type };
}

describe('createTurnState', () => {
  it('starts in WAITING phase', () => {
    const state = createTurnState(['p1', 'p2']);
    expect(state.phase).toBe(PHASES.WAITING);
  });
});

describe('startGame', () => {
  it('moves to PICKING phase', () => {
    const state = startGame(createTurnState(['p1', 'p2']));
    expect(state.phase).toBe(PHASES.PICKING);
  });

  it('sets round to 1', () => {
    const state = startGame(createTurnState(['p1', 'p2']));
    expect(state.round).toBe(1);
  });

  it('includes all players in turn order', () => {
    const state = startGame(createTurnState(['p1', 'p2', 'p3']));
    expect(state.turnOrder).toHaveLength(3);
    expect(state.turnOrder.sort()).toEqual(['p1', 'p2', 'p3']);
  });
});

describe('recordChoice', () => {
  it('stays in PICKING until all players have chosen', () => {
    let state = startGame(createTurnState(['p1', 'p2']));
    state = recordChoice(state, 'p1', card(), ['p1', 'p2']);
    expect(state.phase).toBe(PHASES.PICKING);
  });

  it('moves to RESOLVING when all players have chosen', () => {
    let state = startGame(createTurnState(['p1', 'p2']));
    state = recordChoice(state, 'p1', card(), ['p1', 'p2']);
    state = recordChoice(state, 'p2', card(), ['p1', 'p2']);
    expect(state.phase).toBe(PHASES.RESOLVING);
  });
});

describe('finishResolution', () => {
  it('rotates turn order (first player moves to end)', () => {
    let state = startGame(createTurnState(['p1', 'p2', 'p3']));
    // Force a known order for deterministic testing
    state = { ...state, turnOrder: ['p1', 'p2', 'p3'] };
    const players = new Map([
      ['p1', { laps: 0 }],
      ['p2', { laps: 0 }],
      ['p3', { laps: 0 }],
    ]);
    const next = finishResolution(state, players);
    expect(next.turnOrder).toEqual(['p2', 'p3', 'p1']);
  });

  it('increments round', () => {
    let state = startGame(createTurnState(['p1']));
    state = { ...state, turnOrder: ['p1'] };
    const players = new Map([['p1', { laps: 0 }]]);
    const next = finishResolution(state, players);
    expect(next.round).toBe(2);
  });

  it('moves to GAME_OVER when all players have finished', () => {
    let state = startGame(createTurnState(['p1', 'p2']));
    state = { ...state, turnOrder: ['p1', 'p2'] };
    const players = new Map([
      ['p1', { laps: LAPS_TO_WIN }],
      ['p2', { laps: LAPS_TO_WIN }],
    ]);
    const next = finishResolution(state, players);
    expect(next.phase).toBe(PHASES.GAME_OVER);
  });

  it('stays in PICKING if not all players have finished', () => {
    let state = startGame(createTurnState(['p1', 'p2']));
    state = { ...state, turnOrder: ['p1', 'p2'] };
    const players = new Map([
      ['p1', { laps: LAPS_TO_WIN }],
      ['p2', { laps: 0 }],
    ]);
    const next = finishResolution(state, players);
    expect(next.phase).toBe(PHASES.PICKING);
  });

  it('clears choices after resolution', () => {
    let state = startGame(createTurnState(['p1']));
    state = recordChoice({ ...state, turnOrder: ['p1'] }, 'p1', card(), ['p1']);
    const players = new Map([['p1', { laps: 0 }]]);
    const next = finishResolution(state, players);
    expect(next.choices.size).toBe(0);
  });
});
