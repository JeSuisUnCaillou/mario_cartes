import { TRACK } from '@mario-cartes/shared/track.js';

const PLAYER_COLORS = [0xe74c3c, 0x3498db, 0x2ecc71, 0xf39c12, 0x9b59b6, 0x1abc9c, 0xe67e22, 0x95a5a6];
const CART_RADIUS = 14;

export class CartSprite {
  constructor(scene, playerIndex, playerName) {
    this.scene = scene;
    this.playerIndex = playerIndex;
    this.color = PLAYER_COLORS[playerIndex % PLAYER_COLORS.length];

    this._circle = scene.add.circle(0, 0, CART_RADIUS, this.color);
    this._label = scene.add.text(0, 0, String(playerIndex + 1), {
      fontSize: '12px',
      color: '#ffffff',
      fontStyle: 'bold',
    }).setOrigin(0.5);

    this._nameTag = scene.add.text(0, CART_RADIUS + 6, playerName || '', {
      fontSize: '10px',
      color: '#ffffff',
    }).setOrigin(0.5);
  }

  setPosition(cellIndex) {
    const cell = TRACK[cellIndex];
    if (!cell) return;
    // Offset slightly by player index to avoid full overlap when multiple carts on same cell
    const offsetX = (this.playerIndex % 4) * 6 - 9;
    const offsetY = Math.floor(this.playerIndex / 4) * 6 - 3;
    this._circle.setPosition(cell.x + offsetX, cell.y + offsetY);
    this._label.setPosition(cell.x + offsetX, cell.y + offsetY);
    this._nameTag.setPosition(cell.x + offsetX, cell.y + offsetY);
  }

  animateTo(cellIndex, onComplete) {
    const cell = TRACK[cellIndex];
    if (!cell) { onComplete?.(); return; }
    const offsetX = (this.playerIndex % 4) * 6 - 9;
    const offsetY = Math.floor(this.playerIndex / 4) * 6 - 3;
    const targetX = cell.x + offsetX;
    const targetY = cell.y + offsetY;

    this.scene.tweens.add({
      targets: [this._circle, this._label, this._nameTag],
      x: targetX,
      y: targetY,
      duration: 300,
      ease: 'Cubic.easeInOut',
      onComplete: () => onComplete?.(),
    });
  }

  destroy() {
    this._circle.destroy();
    this._label.destroy();
    this._nameTag.destroy();
  }
}
