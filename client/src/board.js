import Phaser from "phaser";
import { Client } from "colyseus.js";

const CELL_POSITIONS = [
  null,           // index 0 unused (cells are 1-indexed)
  [0.096, 0.374], // 1 — finish/checkered (left side)
  [0.096, 0.120], // 2 — top-left
  [0.298, 0.120], // 3
  [0.500, 0.120], // 4
  [0.702, 0.120], // 5
  [0.904, 0.120], // 6 — top-right
  [0.904, 0.374], // 7 — right side
  [0.904, 0.626], // 8
  [0.904, 0.880], // 9 — bottom-right
  [0.702, 0.880], // 10
  [0.500, 0.880], // 11
  [0.298, 0.880], // 12
  [0.096, 0.880], // 13 — bottom-left
  [0.096, 0.626], // 14 — left side
];

export function initBoard(gameId) {
  const app = document.getElementById("app");
  app.style.width = "100%";
  app.style.height = "100%";

  const serverUrl = import.meta.env.DEV
    ? "ws://localhost:2567"
    : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;

  const colyseusClient = new Client(serverUrl);

  class GameScene extends Phaser.Scene {
    constructor() {
      super("GameScene");
      this.helmets = new Map();
      this.nameLabels = new Map();
    }

    preload() {
      const dpr = window.devicePixelRatio || 1;
      const trackW = Math.round(window.innerWidth * 0.9 * dpr);
      const trackH = Math.round(window.innerHeight * 0.9 * dpr);
      this.load.svg("racetrack", "/racetrack_0.svg", { width: trackW, height: trackH });
      this.load.svg("helmet", "/helmet.svg", { width: 64, height: 64 });
    }

    create() {
      const { width, height } = this.scale;

      this.track = this.add.image(width / 2, height / 2, "racetrack");

      const scaleX = (width * 0.9) / this.track.width;
      const scaleY = (height * 0.9) / this.track.height;
      const trackScale = Math.min(scaleX, scaleY);
      this.track.setScale(trackScale);

      this.connectToRoom(gameId);
    }

    async connectToRoom(roomId) {
      try {
        await colyseusClient.joinById(roomId, { type: "board" });
      } catch {
        await fetch(`/find-or-create/${roomId}`);
      }
      const room = await colyseusClient.joinById(roomId, { type: "board" });
      room.onMessage("players", (players) => {
        this.updatePlayers(players);
      });
    }

    cellPixelPos(cellId) {
      const [fx, fy] = CELL_POSITIONS[cellId];
      const x = this.track.x - this.track.displayWidth / 2 + fx * this.track.displayWidth;
      const y = this.track.y - this.track.displayHeight / 2 + fy * this.track.displayHeight;
      return { x, y };
    }

    updatePlayers(players) {
      const activePlayers = new Set();

      const byCell = new Map();
      for (const p of players) {
        if (p.type !== "player") continue;
        activePlayers.add(p.sessionId);
        if (!byCell.has(p.cellId)) byCell.set(p.cellId, []);
        byCell.get(p.cellId).push(p);
      }

      const cellW = this.track.displayWidth / 5;
      const maxPerRow = 4;
      const helmetSlot = cellW / 4.5;
      const helmetDisplaySize = helmetSlot * 0.9;

      for (const [cellId, cellPlayers] of byCell) {
        const center = this.cellPixelPos(cellId);
        const cols = Math.min(cellPlayers.length, maxPerRow);
        const rows = Math.ceil(cellPlayers.length / maxPerRow);

        cellPlayers.forEach((p, i) => {
          const col = i % maxPerRow;
          const row = Math.floor(i / maxPerRow);
          const colsInRow = Math.min(maxPerRow, cellPlayers.length - row * maxPerRow);
          const x = center.x + (col - (colsInRow - 1) / 2) * helmetSlot;
          const y = center.y + (row - (rows - 1) / 2) * helmetSlot;

          if (this.helmets.has(p.sessionId)) {
            this.helmets.get(p.sessionId).setPosition(x, y);
            const label = this.nameLabels.get(p.sessionId);
            label.setPosition(x, y - helmetDisplaySize * 0.7);
            label.setText(p.name || "???");
          } else {
            const helmet = this.add.image(x, y, "helmet");
            helmet.setScale(helmetDisplaySize / helmet.width);
            this.helmets.set(p.sessionId, helmet);

            const label = this.add.text(x, y - helmetDisplaySize * 0.7, p.name || "???", {
              fontFamily: "monospace",
              fontSize: `${Math.round(helmetDisplaySize * 0.45)}px`,
              color: "#ffffff",
              stroke: "#000000",
              strokeThickness: 3,
              align: "center",
            }).setOrigin(0.5, 1);
            this.nameLabels.set(p.sessionId, label);
          }
        });
      }

      for (const [sessionId, helmet] of this.helmets) {
        if (!activePlayers.has(sessionId)) {
          helmet.destroy();
          this.helmets.delete(sessionId);
          this.nameLabels.get(sessionId).destroy();
          this.nameLabels.delete(sessionId);
        }
      }
    }
  }

  new Phaser.Game({
    type: Phaser.AUTO,
    parent: app,
    width: window.innerWidth,
    height: window.innerHeight,
    backgroundColor: "#1a1a2e",
    scale: {
      mode: Phaser.Scale.FIT,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: GameScene,
  });
}
