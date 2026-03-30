import Phaser from 'phaser';
import { BoardScene } from './scenes/BoardScene.js';
import { ResultScene } from './scenes/ResultScene.js';
import { QROverlay } from './objects/QROverlay.js';

export function initBoardGame(gameUid, room) {
  new QROverlay(gameUid);

  new Phaser.Game({
    type: Phaser.AUTO,
    width: 1280,
    height: 720,
    backgroundColor: '#111111',
    scene: [BoardScene, ResultScene],
    parent: 'app',
    callbacks: {
      preBoot: (game) => {
        game.scene.start('BoardScene', { room, gameUid });
      },
    },
  });
}
