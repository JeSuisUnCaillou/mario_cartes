import { describe, it, expect } from 'vitest';
import { TRACK, advancePosition, crossedFinishLine } from '../game/track.js';
import { CELL_TYPES } from '@mario-cartes/shared';

describe('TRACK', () => {
  it('has 20 cells', () => {
    expect(TRACK).toHaveLength(20);
  });

  it('cell 0 is START_FINISH', () => {
    expect(TRACK[0].type).toBe(CELL_TYPES.START_FINISH);
  });

  it('all other cells are NORMAL', () => {
    TRACK.slice(1).forEach((cell) => {
      expect(cell.type).toBe(CELL_TYPES.NORMAL);
    });
  });

  it('has no duplicate IDs', () => {
    const ids = TRACK.map((c) => c.id);
    expect(new Set(ids).size).toBe(TRACK.length);
  });

  it('all cells have numeric x and y coordinates', () => {
    TRACK.forEach((cell) => {
      expect(typeof cell.x).toBe('number');
      expect(typeof cell.y).toBe('number');
    });
  });
});

describe('advancePosition', () => {
  it('advances by steps', () => {
    expect(advancePosition(0, 1)).toBe(1);
    expect(advancePosition(0, 2)).toBe(2);
  });

  it('wraps around at track length', () => {
    expect(advancePosition(19, 1)).toBe(0);
    expect(advancePosition(18, 3)).toBe(1);
  });
});

describe('crossedFinishLine', () => {
  it('detects crossing cell 0', () => {
    expect(crossedFinishLine(19, 1)).toBe(true);
    expect(crossedFinishLine(18, 2)).toBe(true);
  });

  it('does not trigger when not crossing cell 0', () => {
    expect(crossedFinishLine(0, 1)).toBe(false);
    expect(crossedFinishLine(5, 3)).toBe(false);
  });
});
