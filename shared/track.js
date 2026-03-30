import { CELL_TYPES } from './constants.js';

const STEP = 60;
const OFFSET_X = 160;
const OFFSET_Y = 100;

// Rectangular loop of 20 cells.
// 8 cells top (left→right), 3 right, 7 bottom (right→left), 1 left → + cell 0 = 20
//
//  [1][2][3][4][5][6][7][8]
//  [0]                   [9]
//  [19]                  [10]
//  [18][17][16][15][14][13][12][11]
//
// Cell 0 = START_FINISH (left side, middle)
function buildTrack() {
  const cells = [];

  // Cell 0: start/finish — left col
  cells.push({ id: 0, type: CELL_TYPES.START_FINISH, x: OFFSET_X, y: OFFSET_Y + 3 * STEP });

  // Cells 1–8: top row, left→right
  for (let i = 0; i < 8; i++) {
    cells.push({
      id: cells.length,
      type: CELL_TYPES.NORMAL,
      x: OFFSET_X + (i + 1) * STEP,
      y: OFFSET_Y,
    });
  }

  // Cells 9–11: right col, top→bottom (3 cells)
  for (let i = 0; i < 3; i++) {
    cells.push({
      id: cells.length,
      type: CELL_TYPES.NORMAL,
      x: OFFSET_X + 9 * STEP,
      y: OFFSET_Y + (i + 1) * STEP,
    });
  }

  // Cells 12–18: bottom row, right→left (7 cells)
  for (let i = 0; i < 7; i++) {
    cells.push({
      id: cells.length,
      type: CELL_TYPES.NORMAL,
      x: OFFSET_X + (8 - i) * STEP,
      y: OFFSET_Y + 4 * STEP,
    });
  }

  // Cell 19: left col bottom (connects back toward cell 0)
  cells.push({
    id: cells.length,
    type: CELL_TYPES.NORMAL,
    x: OFFSET_X,
    y: OFFSET_Y + 4 * STEP,
  });

  return cells;
}

export const TRACK = buildTrack();

export function advancePosition(currentIndex, steps) {
  return (currentIndex + steps) % TRACK.length;
}

// Returns true if advancing `steps` from `from` crosses cell 0 (start/finish)
export function crossedFinishLine(from, steps) {
  for (let s = 1; s <= steps; s++) {
    if ((from + s) % TRACK.length === 0) return true;
  }
  return false;
}
