import Phaser from "phaser";
import { Client } from "colyseus.js";
import QRCode from "qrcode";

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

const SVG_ASPECT = 131.0025 / 104.54418;

function createInfoBar(gameId) {
  const bar = document.createElement("div");
  bar.className = "board-info-bar";

  const qrContainer = document.createElement("div");
  qrContainer.className = "board-qr";
  const qrCanvas = document.createElement("canvas");
  qrContainer.appendChild(qrCanvas);
  bar.appendChild(qrContainer);

  const titleContainer = document.createElement("div");
  titleContainer.className = "board-title";
  const title = document.createElement("div");
  title.className = "board-title-name";
  title.textContent = "Mario Cartes";
  titleContainer.appendChild(title);
  bar.appendChild(titleContainer);

  const playerUrl = `${location.origin}/game/${gameId}/player`;
  QRCode.toCanvas(qrCanvas, playerUrl, {
    width: 170,
    margin: 0,
  });

  return bar;
}

export function initBoard(gameId) {
  const app = document.getElementById("app");
  app.style.width = "100%";
  app.style.height = "100%";

  app.classList.add("board-layout");
  app.appendChild(createInfoBar(gameId));

  const gameContainer = document.createElement("div");
  gameContainer.className = "board-game";
  app.appendChild(gameContainer);

  const serverUrl = import.meta.env.DEV
    ? "ws://localhost:2567"
    : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;

  const colyseusClient = new Client(serverUrl);

  class GameScene extends Phaser.Scene {
    constructor() {
      super("GameScene");
      this.helmets = new Map();
      this.nameLabels = new Map();
      this.playerCells = new Map();
      this.latestPlayers = [];
      this.bananaSprites = new Map();
    }

    preload() {
      const dpr = window.devicePixelRatio || 1;
      const maxDim = Math.max(window.innerWidth, window.innerHeight) * dpr;
      const trackW = Math.round(maxDim);
      const trackH = Math.round(maxDim / SVG_ASPECT);
      this.load.svg("racetrack", "/racetrack_0.svg", { width: trackW, height: trackH });
      this.load.svg("helmet", "/helmet.svg", { width: 64, height: 64 });
      this.load.svg("banana", "/banana.svg", { width: 128, height: 128 });
      this.load.image("space", "/space.jpg");
    }

    create() {
      this.bg = this.add.image(0, 0, "space").setAlpha(0.6);
      this.track = this.add.image(0, 0, "racetrack");
      this.layoutTrack();
      this.scale.on("resize", this.onResize, this);
      this.connectToRoom(gameId);
    }

    layoutTrack() {
      const { width, height } = this.scale;

      this.bg.setPosition(width / 2, height / 2);
      const bgScaleX = width / this.bg.width;
      const bgScaleY = height / this.bg.height;
      this.bg.setScale(Math.max(bgScaleX, bgScaleY));

      this.track.setPosition(width / 2, height / 2);
      const scaleX = (width * 0.9) / this.track.width;
      const scaleY = (height * 0.9) / this.track.height;
      this.track.setScale(Math.min(scaleX, scaleY));
    }

    onResize() {
      this.layoutTrack();
      this.refreshPlayerPositions();
      this.snapCellLayout();
    }

    cellSlotPos(cellId, slotIndex, totalSlots) {
      const cellW = this.track.displayWidth / 5;
      const maxPerRow = 4;
      const helmetSlot = cellW / 4.5;
      const center = this.cellPixelPos(cellId);
      const rows = Math.ceil(totalSlots / maxPerRow);
      const row = Math.floor(slotIndex / maxPerRow);
      const colsInRow = Math.min(maxPerRow, totalSlots - row * maxPerRow);
      const col = slotIndex % maxPerRow;
      return {
        x: center.x + (col - (colsInRow - 1) / 2) * helmetSlot,
        y: center.y + (row - (rows - 1) / 2) * helmetSlot,
      };
    }

    cellOccupantCount(cellId) {
      const playerCount = (this.latestPlayers || []).filter(
        (p) => p.playerId && p.cellId === cellId
      ).length;
      const bananaCount = (this.latestBananas && this.latestBananas[cellId]) || 0;
      return { playerCount, bananaCount, total: playerCount + bananaCount };
    }

    refreshPlayerPositions() {
      const cellW = this.track.displayWidth / 5;
      const helmetSlot = cellW / 4.5;
      const helmetDisplaySize = helmetSlot * 0.9;

      const byCell = new Map();
      for (const p of this.latestPlayers) {
        if (!p.playerId || !CELL_POSITIONS[p.cellId]) continue;
        if (!byCell.has(p.cellId)) byCell.set(p.cellId, []);
        byCell.get(p.cellId).push(p);
      }

      for (const [cellId, cellPlayers] of byCell) {
        const { total } = this.cellOccupantCount(cellId);
        cellPlayers.forEach((p, i) => {
          const { x, y } = this.cellSlotPos(cellId, i, total);
          const helmet = this.helmets.get(p.playerId);
          const label = this.nameLabels.get(p.playerId);
          if (!helmet) return;
          helmet.setPosition(x, y);
          helmet.setScale(helmetDisplaySize / helmet.width);
          label.setPosition(x, y - helmetDisplaySize * 0.7);
          label.setFontSize(Math.round(helmetDisplaySize * 0.45));
        });
      }
    }

    tweenCellLayout() {
      const cellW = this.track.displayWidth / 5;
      const helmetSlot = cellW / 4.5;
      const helmetDisplaySize = helmetSlot * 0.9;
      const bananaSize = helmetSlot * 0.9;

      // Collect all cells that have players or bananas
      const allCells = new Set();
      const byCell = new Map();
      for (const p of (this.latestPlayers || [])) {
        if (!p.playerId || !CELL_POSITIONS[p.cellId]) continue;
        allCells.add(p.cellId);
        if (!byCell.has(p.cellId)) byCell.set(p.cellId, []);
        byCell.get(p.cellId).push(p);
      }
      for (const cellIdStr of Object.keys(this.latestBananas || {})) {
        allCells.add(Number(cellIdStr));
      }

      for (const cellId of allCells) {
        if (!CELL_POSITIONS[cellId]) continue;
        const { playerCount, total } = this.cellOccupantCount(cellId);
        const cellPlayers = byCell.get(cellId) || [];

        // Tween players to their grid slots
        cellPlayers.forEach((p, i) => {
          const { x, y } = this.cellSlotPos(cellId, i, total);
          const helmet = this.helmets.get(p.playerId);
          const label = this.nameLabels.get(p.playerId);
          if (!helmet) return;
          if (helmet.x !== x || helmet.y !== y) {
            this.tweens.add({ targets: helmet, x, y, duration: 300, ease: "Power2" });
            this.tweens.add({ targets: label, x, y: y - helmetDisplaySize * 0.7, duration: 300, ease: "Power2" });
          }
        });

        // Tween bananas to their grid slots (after players)
        const sprites = this.bananaSprites.get(cellId) || [];
        sprites.forEach((sprite, i) => {
          const { x, y } = this.cellSlotPos(cellId, playerCount + i, total);
          if (sprite.x !== x || sprite.y !== y) {
            this.tweens.add({ targets: sprite, x, y, duration: 300, ease: "Power2" });
          }
          sprite.setScale(bananaSize / sprite.width);
        });
      }
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
      room.onMessage("bananas", (bananas) => {
        this.updateBananas(bananas);
        this.tweenCellLayout();
      });
      room.onMessage("bananaHitBoard", (data) => {
        this.animateBananaHit(data.playerId, data.cellId);
      });
    }

    updateBananas(bananas) {
      this.latestBananas = bananas;

      // Remove sprites for cells no longer in bananas
      for (const [cellId, sprites] of this.bananaSprites) {
        if (!bananas[cellId]) {
          sprites.forEach((s) => s.destroy());
          this.bananaSprites.delete(cellId);
        }
      }

      // Create or destroy sprites to match counts (positioning done by tweenCellLayout)
      for (const [cellIdStr, count] of Object.entries(bananas)) {
        const cellId = Number(cellIdStr);
        if (!CELL_POSITIONS[cellId]) continue;
        const existing = this.bananaSprites.get(cellId) || [];
        while (existing.length > count) {
          existing.pop().destroy();
        }
        while (existing.length < count) {
          const center = this.cellPixelPos(cellId);
          const sprite = this.add.image(center.x, center.y, "banana");
          sprite.setDepth(0);
          existing.push(sprite);
        }
        this.bananaSprites.set(cellId, existing);
      }
    }

    snapCellLayout() {
      const cellW = this.track.displayWidth / 5;
      const helmetSlot = cellW / 4.5;
      const bananaSize = helmetSlot * 0.9;

      for (const [cellId, sprites] of this.bananaSprites) {
        const { playerCount, total } = this.cellOccupantCount(cellId);
        sprites.forEach((sprite, i) => {
          const { x, y } = this.cellSlotPos(cellId, playerCount + i, total);
          sprite.setPosition(x, y);
          sprite.setScale(bananaSize / sprite.width);
        });
      }
    }

    animateBananaHit(playerId, cellId) {
      const helmet = this.helmets.get(playerId);
      const label = this.nameLabels.get(playerId);
      if (!helmet) return;

      const moveDelay = 400;
      const jumpDuration = 600;
      const jumpHeight = helmet.displayHeight * 1.5;

      // Create a temp banana at the cell (the real one is already removed by updateBananas)
      const center = this.cellPixelPos(cellId);
      const cellW = this.track.displayWidth / 5;
      const helmetSlot = cellW / 4.5;
      const size = helmetSlot * 0.9;
      const banana = this.add.image(center.x, center.y, "banana");
      banana.setScale(size / banana.width);
      banana.setDepth(10);

      // After move: helmet jumps up/down with one rotation + banana launches out
      this.tweens.add({
        targets: helmet,
        y: `-=${jumpHeight}`,
        duration: jumpDuration / 2,
        ease: "Sine.easeOut",
        delay: moveDelay,
        yoyo: true,
        yoyoEase: "Sine.easeIn",
      });
      this.tweens.add({
        targets: helmet,
        angle: -360,
        duration: jumpDuration,
        ease: "Linear",
        delay: moveDelay,
        onComplete: () => {
          helmet.setAngle(0);
          // Second rotation on the floor after landing
          this.tweens.add({
            targets: helmet,
            angle: -360,
            duration: 600,
            ease: "Linear",
            onComplete: () => { helmet.setAngle(0); },
          });
        },
      });
      if (label) {
        this.tweens.add({
          targets: label,
          y: `-=${jumpHeight}`,
          duration: jumpDuration / 2,
          ease: "Sine.easeOut",
          delay: moveDelay,
          yoyo: true,
          yoyoEase: "Sine.easeIn",
        });
      }
      this.tweens.add({
        targets: banana,
        y: center.y - this.scale.height * 0.6,
        angle: 360,
        alpha: 0,
        duration: jumpDuration,
        ease: "Power2",
        delay: moveDelay,
        onComplete: () => { banana.destroy(); },
      });
    }

    cellPixelPos(cellId) {
      const [fx, fy] = CELL_POSITIONS[cellId];
      const x = this.track.x - this.track.displayWidth / 2 + fx * this.track.displayWidth;
      const y = this.track.y - this.track.displayHeight / 2 + fy * this.track.displayHeight;
      return { x, y };
    }

    updatePlayers(players) {
      this.latestPlayers = players;
      const activePlayerIds = new Set();

      const byCell = new Map();
      for (const p of players) {
        if (!p.playerId || !CELL_POSITIONS[p.cellId]) continue;
        activePlayerIds.add(p.playerId);
        if (!byCell.has(p.cellId)) byCell.set(p.cellId, []);
        byCell.get(p.cellId).push(p);
      }

      const cellW = this.track.displayWidth / 5;
      const helmetSlot = cellW / 4.5;
      const helmetDisplaySize = helmetSlot * 0.9;

      for (const [cellId, cellPlayers] of byCell) {
        const { total } = this.cellOccupantCount(cellId);

        cellPlayers.forEach((p, i) => {
          const { x, y } = this.cellSlotPos(cellId, i, total);
          const alpha = p.connected ? 1 : 0.5;

          if (this.helmets.has(p.playerId)) {
            const helmet = this.helmets.get(p.playerId);
            const label = this.nameLabels.get(p.playerId);
            const prevCell = this.playerCells.get(p.playerId);
            label.setText(p.name || "???");
            helmet.setAlpha(alpha);
            label.setAlpha(alpha);

            if (prevCell !== p.cellId) {
              this.tweens.add({
                targets: helmet,
                x, y,
                duration: 400,
                ease: "Power2",
              });
              this.tweens.add({
                targets: label,
                x, y: y - helmetDisplaySize * 0.7,
                duration: 400,
                ease: "Power2",
              });
              this.playerCells.set(p.playerId, p.cellId);
            } else if (helmet.x !== x || helmet.y !== y) {
              this.tweens.add({
                targets: helmet,
                x, y,
                duration: 300,
                ease: "Power2",
              });
              this.tweens.add({
                targets: label,
                x, y: y - helmetDisplaySize * 0.7,
                duration: 300,
                ease: "Power2",
              });
            }
          } else {
            const helmet = this.add.image(x, y, "helmet");
            helmet.setScale(helmetDisplaySize / helmet.width);
            helmet.setAlpha(alpha);
            this.helmets.set(p.playerId, helmet);

            const label = this.add.text(x, y - helmetDisplaySize * 0.7, p.name || "???", {
              fontFamily: "monospace",
              fontSize: `${Math.round(helmetDisplaySize * 0.45)}px`,
              color: "#ffffff",
              stroke: "#000000",
              strokeThickness: 3,
              align: "center",
            }).setOrigin(0.5, 1);
            label.setAlpha(alpha);
            this.nameLabels.set(p.playerId, label);
            this.playerCells.set(p.playerId, p.cellId);
          }
        });
      }

      for (const [playerId, helmet] of this.helmets) {
        if (!activePlayerIds.has(playerId)) {
          helmet.destroy();
          this.helmets.delete(playerId);
          this.nameLabels.get(playerId).destroy();
          this.nameLabels.delete(playerId);
          this.playerCells.delete(playerId);
        }
      }

      // Reposition all cell occupants since the shared grid may have changed
      this.tweenCellLayout();
    }
  }

  new Phaser.Game({
    type: Phaser.AUTO,
    parent: gameContainer,
    backgroundColor: "#000000",
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: GameScene,
  });
}
