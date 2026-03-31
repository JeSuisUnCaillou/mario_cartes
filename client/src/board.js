import Phaser from "phaser";
import { Client } from "colyseus.js";
import QRCode from "qrcode";
import { bananaCounts } from "./board.functions.js";
import { cardItemPositions } from "./player.functions.js";

const ITEM_ICONS = {
  coin: "/coin.svg",
  banana: "/banana.svg",
  mushroom: "/mushroom.svg",
};

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
let boardPhase = "lobby";
let latestPlayersData = [];

function createInfoBar(gameId) {
  const bar = document.createElement("div");
  bar.className = "board-info-bar";

  const qrContainer = document.createElement("div");
  qrContainer.className = "board-qr";
  const qrCanvas = document.createElement("canvas");
  qrContainer.appendChild(qrCanvas);
  bar.appendChild(qrContainer);

  const rightSide = document.createElement("div");
  rightSide.className = "board-info-right";

  const titleContainer = document.createElement("div");
  titleContainer.className = "board-title";
  const title = document.createElement("div");
  title.className = "board-title-name";
  title.textContent = "Mario Cartes";
  titleContainer.appendChild(title);
  rightSide.appendChild(titleContainer);

  const playersRow = document.createElement("div");
  playersRow.className = "board-info-players";
  playersRow.id = "board-players-row";

  const scanLabel = document.createElement("div");
  scanLabel.className = "board-top-element board-scan-label";
  scanLabel.innerHTML = "Scan<br>to<br>join";
  playersRow.appendChild(scanLabel);

  rightSide.appendChild(playersRow);

  bar.appendChild(rightSide);

  const playerUrl = `${location.origin}/game/${gameId}/player`;
  const qrSize = Math.round(window.innerHeight * 0.18);
  QRCode.toCanvas(qrCanvas, playerUrl, {
    width: qrSize,
    margin: 0,
  });

  return bar;
}

function updateInfoBarPlayers(players) {
  latestPlayersData = players;
  const container = document.getElementById("board-players-row");
  if (!container) return;

  const existingEls = new Map();
  for (const el of container.querySelectorAll(".board-player")) {
    existingEls.set(el.dataset.playerId, el);
  }

  const activeIds = new Set(players.map((p) => p.playerId));

  // Remove players no longer present
  for (const [id, el] of existingEls) {
    if (!activeIds.has(id)) el.remove();
  }

  // Create or update each player
  for (const p of players) {
    let el = existingEls.get(p.playerId);
    if (!el) {
      el = document.createElement("div");
      el.className = "board-top-element board-player";
      el.dataset.playerId = p.playerId;

      const name = document.createElement("div");
      name.className = "board-player-name";
      el.appendChild(name);

      const helmet = document.createElement("img");
      helmet.className = "board-player-helmet";
      helmet.src = "/helmet.svg";
      el.appendChild(helmet);

      const status = document.createElement("div");
      status.className = "board-player-status";
      el.appendChild(status);

      const coins = document.createElement("div");
      coins.className = "board-player-coins";
      el.appendChild(coins);

      container.appendChild(el);
    }

    el.classList.toggle("disconnected", !p.connected);
    el.querySelector(".board-player-name").textContent = p.name || "???";

    const statusEl = el.querySelector(".board-player-status");
    if (boardPhase === "lobby") {
      statusEl.className = "board-player-status board-player-ready";
      statusEl.textContent = p.ready ? "✅" : "⏳";
      statusEl.classList.toggle("board-player-waiting", !p.ready);
      statusEl.style.visibility = "visible";
    } else {
      statusEl.className = "board-player-status board-player-cards";
      const currentCount = statusEl.querySelectorAll(".board-card-mini").length;
      if (currentCount !== p.handCount) {
        statusEl.innerHTML = "";
        const n = p.handCount;
        for (let i = 0; i < n; i++) {
          const card = document.createElement("div");
          card.className = "board-card-mini";
          const offset = i - (n - 1) / 2;
          const rotation = offset * 10;
          const lift = Math.abs(offset) * 1.5;
          card.style.transform = `rotate(${rotation}deg) translateY(${lift}px)`;
          statusEl.appendChild(card);
        }
      }
    }

    const coinsEl = el.querySelector(".board-player-coins");
    if (boardPhase !== "lobby") {
      const coinCount = p.coins || 0;
      const zeroClass = coinCount === 0 ? " board-coin-zero" : "";
      coinsEl.innerHTML = `<span class="board-coin-count${zeroClass}">${coinCount}</span><img src="/coin.svg" class="board-coin-icon${zeroClass}" />`;
      coinsEl.style.display = "";
    } else {
      coinsEl.style.display = "none";
    }
  }
}

function updateBoardGameState(data) {
  const container = document.getElementById("board-players-row");
  if (!container) return;

  boardPhase = data.phase;

  if (data.phase === "playing") {
    // Replace scan label with round card
    const scanLabel = container.querySelector(".board-scan-label");
    if (scanLabel) scanLabel.remove();

    let roundCard = container.querySelector(".board-round-card");
    if (!roundCard) {
      roundCard = document.createElement("div");
      roundCard.className = "board-top-element board-round-card";
      container.insertBefore(roundCard, container.firstChild);
    }
    roundCard.innerHTML = `<span>Round</span><span class="board-round-number">${data.currentRound}</span>`;

  }

  // Re-render player info with correct phase
  updateInfoBarPlayers(latestPlayersData);

  // Golden border on active player
  for (const el of container.querySelectorAll(".board-player")) {
    el.classList.toggle("active-player", el.dataset.playerId === data.activePlayerId);
  }
}

function createBoardRiverCard(card) {
  const el = document.createElement("div");
  el.className = "board-river-card";
  el.dataset.cardId = card.id;
  const bg = document.createElement("img");
  bg.src = "/card - blank.svg";
  bg.className = "card-bg";
  bg.draggable = false;
  el.appendChild(bg);
  const positions = cardItemPositions(card.items.length);
  card.items.forEach((item, i) => {
    const icon = document.createElement("img");
    icon.src = ITEM_ICONS[item];
    icon.className = "card-item";
    icon.style.left = positions[i].x;
    icon.style.top = positions[i].y;
    icon.draggable = false;
    el.appendChild(icon);
  });
  return el;
}

function renderRivers(rivers) {
  const container = document.getElementById("board-rivers");
  if (!container) return;
  container.innerHTML = "";
  for (const river of rivers) {
    const row = document.createElement("div");
    row.className = "board-river";

    const costLabel = document.createElement("div");
    costLabel.className = "board-river-cost";
    costLabel.innerHTML = `<span>${river.cost}</span><img src="/coin.svg" class="board-river-cost-icon" />`;
    row.appendChild(costLabel);

    const cardsRow = document.createElement("div");
    cardsRow.className = "board-river-cards";

    const deckPile = document.createElement("div");
    deckPile.className = "board-river-deck";
    const deckImg = document.createElement("img");
    deckImg.src = "/card - back.svg";
    deckImg.className = "board-river-deck-img";
    deckImg.draggable = false;
    if (river.deckCount === 0) deckImg.style.opacity = "0.2";
    deckPile.appendChild(deckImg);
    const deckCount = document.createElement("div");
    deckCount.className = "board-river-deck-count";
    deckCount.textContent = river.deckCount;
    deckPile.appendChild(deckCount);
    cardsRow.appendChild(deckPile);

    const slotsContainer = document.createElement("div");
    slotsContainer.className = "board-river-slots";
    for (const card of river.slots) {
      if (card) {
        slotsContainer.appendChild(createBoardRiverCard(card));
      } else {
        const empty = document.createElement("div");
        empty.className = "board-river-card board-river-empty";
        slotsContainer.appendChild(empty);
      }
    }
    cardsRow.appendChild(slotsContainer);

    row.appendChild(cardsRow);
    container.appendChild(row);
  }
}

export function initBoard(gameId) {
  const app = document.getElementById("app");
  app.style.width = "100%";
  app.style.height = "100%";

  app.classList.add("board-layout");
  app.appendChild(createInfoBar(gameId));

  const mainContainer = document.createElement("div");
  mainContainer.className = "board-main";

  const riversContainer = document.createElement("div");
  riversContainer.className = "board-rivers";
  riversContainer.id = "board-rivers";
  mainContainer.appendChild(riversContainer);

  const gameContainer = document.createElement("div");
  gameContainer.className = "board-game";
  mainContainer.appendChild(gameContainer);

  app.appendChild(mainContainer);

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
      this.latestCellOccupants = {};
      this._cellOccupantsQueue = [];
      this._processingQueue = false;
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

    refreshPlayerPositions() {
      const cellW = this.track.displayWidth / 5;
      const helmetSlot = cellW / 4.5;
      const helmetDisplaySize = helmetSlot * 0.9;

      for (const [cellIdStr, occupants] of Object.entries(this.latestCellOccupants)) {
        const cellId = Number(cellIdStr);
        if (!CELL_POSITIONS[cellId]) continue;
        occupants.forEach((entry, slotIndex) => {
          if (entry === "banana") return;
          const helmet = this.helmets.get(entry);
          const label = this.nameLabels.get(entry);
          if (!helmet) return;
          const { x, y } = this.cellSlotPos(cellId, slotIndex, occupants.length);
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

      for (const [cellIdStr, occupants] of Object.entries(this.latestCellOccupants)) {
        const cellId = Number(cellIdStr);
        if (!CELL_POSITIONS[cellId]) continue;
        const sprites = this.bananaSprites.get(cellId) || [];
        let bananaIdx = 0;

        occupants.forEach((entry, slotIndex) => {
          const { x, y } = this.cellSlotPos(cellId, slotIndex, occupants.length);
          if (entry === "banana") {
            const sprite = sprites[bananaIdx++];
            if (sprite && (sprite.x !== x || sprite.y !== y)) {
              this.tweens.add({ targets: sprite, x, y, duration: 300, ease: "Power2" });
            }
            if (sprite) sprite.setScale(bananaSize / sprite.width);
          } else {
            const helmet = this.helmets.get(entry);
            const label = this.nameLabels.get(entry);
            if (!helmet) return;
            if (helmet.x !== x || helmet.y !== y) {
              this.tweens.add({ targets: helmet, x, y, duration: 300, ease: "Power2" });
              this.tweens.add({ targets: label, x, y: y - helmetDisplaySize * 0.7, duration: 300, ease: "Power2" });
            }
          }
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
        updateInfoBarPlayers(players);
        this._cellOccupantsQueue.push({ _players: players });
        if (!this._processingQueue) {
          this._processNextCellOccupants();
        }
      });
      room.onMessage("cellOccupants", (cellOccupants) => {
        this.enqueueCellOccupants(cellOccupants);
      });
      room.onMessage("bananaHitBoard", (data) => {
        this._cellOccupantsQueue.push({ _bananaHit: data });
        if (!this._processingQueue) {
          this._processNextCellOccupants();
        }
      });
      room.onMessage("gameState", (data) => {
        updateBoardGameState(data);
        if (data.rivers) renderRivers(data.rivers);
      });
    }

    enqueueCellOccupants(cellOccupants) {
      this._cellOccupantsQueue.push(cellOccupants);
      if (!this._processingQueue) {
        this._processNextCellOccupants();
      }
    }

    _processNextCellOccupants() {
      if (this._cellOccupantsQueue.length === 0) {
        this._processingQueue = false;
        return;
      }
      this._processingQueue = true;
      const entry = this._cellOccupantsQueue.shift();
      if (entry._bananaHit) {
        this.animateBananaHit(entry._bananaHit.playerId, entry._bananaHit.cellId);
        this.time.delayedCall(1400, () => this._processNextCellOccupants());
      } else if (entry._players) {
        this.updatePlayers(entry._players);
        this.time.delayedCall(350, () => this._processNextCellOccupants());
      } else {
        this.updateCellOccupants(entry);
        this.time.delayedCall(350, () => this._processNextCellOccupants());
      }
    }

    updateCellOccupants(cellOccupants) {
      this.latestCellOccupants = cellOccupants;

      const bananaCountsByCell = bananaCounts(cellOccupants);

      // Remove sprites for cells that no longer have bananas
      for (const [cellId, sprites] of this.bananaSprites) {
        if (!bananaCountsByCell[cellId]) {
          sprites.forEach((s) => s.destroy());
          this.bananaSprites.delete(cellId);
        }
      }

      // Create or destroy sprites to match counts
      for (const [cellId, count] of Object.entries(bananaCountsByCell)) {
        const existing = this.bananaSprites.get(Number(cellId)) || [];
        while (existing.length > count) {
          existing.pop().destroy();
        }
        while (existing.length < count) {
          const center = this.cellPixelPos(Number(cellId));
          const sprite = this.add.image(center.x, center.y, "banana");
          sprite.setDepth(0);
          existing.push(sprite);
        }
        this.bananaSprites.set(Number(cellId), existing);
      }

      this.tweenCellLayout();
    }

    snapCellLayout() {
      const cellW = this.track.displayWidth / 5;
      const helmetSlot = cellW / 4.5;
      const bananaSize = helmetSlot * 0.9;

      for (const [cellIdStr, occupants] of Object.entries(this.latestCellOccupants)) {
        const cellId = Number(cellIdStr);
        if (!CELL_POSITIONS[cellId]) continue;
        const sprites = this.bananaSprites.get(cellId) || [];
        let bananaIdx = 0;

        occupants.forEach((entry, slotIndex) => {
          if (entry !== "banana") return;
          const sprite = sprites[bananaIdx++];
          if (!sprite) return;
          const { x, y } = this.cellSlotPos(cellId, slotIndex, occupants.length);
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

      // Use the real banana sprite from the cell (server hasn't broadcast its removal yet)
      const sprites = this.bananaSprites.get(cellId) || [];
      const banana = sprites.pop();
      if (sprites.length === 0) {
        this.bananaSprites.delete(cellId);
      }

      if (!banana) return;
      banana.setDepth(10);

      // Also remove the banana from latestCellOccupants so tweenCellLayout doesn't reposition it
      const occupants = this.latestCellOccupants[cellId];
      if (occupants) {
        const idx = occupants.lastIndexOf("banana");
        if (idx !== -1) occupants.splice(idx, 1);
      }

      // After move completes, rearrange remaining occupants on the cell
      this.time.delayedCall(moveDelay, () => this.tweenCellLayout());

      // After move: helmet rotates twice, banana launches out
      const center = this.cellPixelPos(cellId);
      this.tweens.add({
        targets: helmet,
        angle: -720,
        duration: 1000,
        ease: "Linear",
        delay: moveDelay,
        onComplete: () => { helmet.setAngle(0); },
      });
      this.tweens.add({
        targets: banana,
        y: center.y - this.scale.height * 0.6,
        angle: 360,
        alpha: 0,
        duration: 600,
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
        const occupants = this.latestCellOccupants[cellId] || [];

        cellPlayers.forEach((p) => {
          const slotIndex = occupants.indexOf(p.playerId);
          const slot = slotIndex !== -1
            ? this.cellSlotPos(cellId, slotIndex, occupants.length)
            : this.cellPixelPos(cellId);
          const { x, y } = slot;
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
