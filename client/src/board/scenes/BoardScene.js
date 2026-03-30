import Phaser from 'phaser';
import { TrackRenderer } from '../objects/TrackRenderer.js';
import { CartSprite } from '../objects/CartSprite.js';
import { TRACK } from '@mario-cartes/shared/track.js';
import { PHASES } from '@mario-cartes/shared';
import { getBoardInitData } from '../BoardGame.js';

const BANANA_COLOR = 0xf1c40f;

export class BoardScene extends Phaser.Scene {
  constructor() {
    super({ key: 'BoardScene' });
    this._carts = new Map();      // sessionId → CartSprite
    this._bananas = new Map();    // cellIndex → Phaser.GameObjects.Arc
    this._animating = false;
    this._room = null;
  }

  create() {
    const { room, gameUid } = getBoardInitData() || {};
    this._room = room || null;
    this._gameUid = gameUid || null;
    new TrackRenderer(this);
    this._statusText = this.add.text(10, 10, 'Waiting for players...', {
      fontSize: '14px',
      color: '#ffffff',
    });

    if (!this._room) return;

    this._room.onMessage('state', (state) => this._syncState(state));
    this._room.onMessage('round_events', ({ events }) => this._playEventQueue(events));
    this._room.send('request_state');
  }

  _syncState(state) {
    const phaseLabels = {
      [PHASES.WAITING]: 'Waiting for players...',
      [PHASES.PICKING]: `Round ${state.round} — Pick a card`,
      [PHASES.RESOLVING]: `Round ${state.round} — Resolving...`,
      [PHASES.GAME_OVER]: 'Game Over!',
    };
    this._statusText.setText(phaseLabels[state.phase] || state.phase);

    // Sync carts
    const playerIds = Object.keys(state.players);
    playerIds.forEach((id, idx) => {
      if (!this._carts.has(id)) {
        const p = state.players[id];
        const cart = new CartSprite(this, idx, p.name);
        this._carts.set(id, cart);
        cart.setPosition(p.position);
      }
    });

    // Remove carts for departed players
    for (const [id, cart] of this._carts.entries()) {
      if (!state.players[id]) {
        cart.destroy();
        this._carts.delete(id);
      }
    }

    // Sync banana overlays (non-animated, just sync after events finish)
    if (!this._animating) {
      this._syncBananas(state.bananaPositions);
    }

    if (state.phase === PHASES.GAME_OVER) {
      this.time.delayedCall(2000, () => {
        this.scene.start('ResultScene', { room: this._room, players: state.players });
      });
    }
  }

  _syncBananas(bananaPositions) {
    // Remove all existing banana sprites
    for (const [, sprite] of this._bananas.entries()) sprite.destroy();
    this._bananas.clear();

    bananaPositions.forEach((cellIndex) => {
      const cell = TRACK[cellIndex];
      if (!cell) return;
      const sprite = this.add.circle(cell.x, cell.y + 16, 6, BANANA_COLOR);
      this._bananas.set(cellIndex, sprite);
    });
  }

  // Plays the event queue sequentially (animation-driven)
  _playEventQueue(events) {
    this._animating = true;
    let chain = Promise.resolve();

    events.forEach((event) => {
      chain = chain.then(() => this._playEvent(event));
    });

    chain.then(() => {
      this._animating = false;
    });
  }

  _playEvent(event) {
    return new Promise((resolve) => {
      switch (event.type) {
        case 'MOVE': {
          const cart = this._carts.get(event.playerId);
          if (cart) {
            cart.animateTo(event.to, resolve);
          } else {
            resolve();
          }
          break;
        }
        case 'BANANA_PLACED': {
          const cell = TRACK[event.cell];
          if (cell) {
            const sprite = this.add.circle(cell.x, cell.y + 16, 6, BANANA_COLOR);
            this._bananas.set(event.cell, sprite);
          }
          this.time.delayedCall(150, resolve);
          break;
        }
        case 'BANANA_HIT': {
          // Flash the cart to indicate banana hit
          const cart = this._carts.get(event.playerId);
          if (cart) {
            this.tweens.add({
              targets: cart._circle,
              alpha: 0.2,
              yoyo: true,
              repeat: 2,
              duration: 100,
              onComplete: resolve,
            });
          } else {
            resolve();
          }
          // Remove banana from display
          const bananaSprite = this._bananas.get(event.cell);
          if (bananaSprite) {
            bananaSprite.destroy();
            this._bananas.delete(event.cell);
          }
          break;
        }
        case 'LAP_COMPLETED': {
          // Brief flash text
          const cart = this._carts.get(event.playerId);
          if (cart) {
            const lapText = this.add
              .text(cart._circle.x, cart._circle.y - 30, `Lap ${event.laps}!`, {
                fontSize: '16px',
                color: '#ffff00',
                fontStyle: 'bold',
              })
              .setOrigin(0.5);
            this.tweens.add({
              targets: lapText,
              y: lapText.y - 40,
              alpha: 0,
              duration: 1000,
              onComplete: () => { lapText.destroy(); resolve(); },
            });
          } else {
            resolve();
          }
          break;
        }
        default:
          resolve();
      }
    });
  }
}
