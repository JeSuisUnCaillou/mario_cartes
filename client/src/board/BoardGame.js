import Phaser from 'phaser';
import { BoardScene } from './scenes/BoardScene.js';
import { ResultScene } from './scenes/ResultScene.js';
import { QROverlay } from './objects/QROverlay.js';

// Module-level store so BoardScene can read it on first create()
// (Phaser auto-starts the first scene before we can pass data via scene.start)
let _initData = null;
export function getBoardInitData() { return _initData; }

export function initBoardGame(gameUid, room) {
  _initData = { room, gameUid };
  new QROverlay(gameUid);

  new Phaser.Game({
    type: Phaser.AUTO,
    width: 1280,
    height: 720,
    backgroundColor: '#111111',
    scene: [BoardScene, ResultScene],
    parent: 'app',
  });
}
