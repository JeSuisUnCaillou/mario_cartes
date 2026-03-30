import { TRACK } from '@mario-cartes/shared/track.js';
import { CELL_TYPES } from '@mario-cartes/shared';

const CELL_SIZE = 48;

export class TrackRenderer {
  constructor(scene) {
    this.scene = scene;
    this._graphics = scene.add.graphics();
    this.draw();
  }

  draw() {
    const g = this._graphics;
    g.clear();

    TRACK.forEach((cell) => {
      const isStart = cell.type === CELL_TYPES.START_FINISH;
      const cx = cell.x;
      const cy = cell.y;
      const half = CELL_SIZE / 2;

      // Cell background
      g.fillStyle(isStart ? 0x222222 : 0x444444, 1);
      g.fillRect(cx - half, cy - half, CELL_SIZE, CELL_SIZE);

      // Cell border
      g.lineStyle(2, isStart ? 0xffffff : 0x888888, 1);
      g.strokeRect(cx - half, cy - half, CELL_SIZE, CELL_SIZE);

      // Checkered pattern for start/finish
      if (isStart) {
        g.fillStyle(0xffffff, 1);
        g.fillRect(cx - half, cy - half, half / 2, half / 2);
        g.fillRect(cx, cy, half / 2, half / 2);
      }

      // Cell number label
      this.scene.add
        .text(cx, cy, String(cell.id), {
          fontSize: '11px',
          color: isStart ? '#ffff00' : '#cccccc',
        })
        .setOrigin(0.5);
    });
  }
}
