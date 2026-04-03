import Phaser from "phaser";
import { Client, Callbacks } from "@colyseus/sdk";
import QRCode from "qrcode";
import { bananaCounts, shellCounts, redShellCounts, permacoinCells } from "./board.functions.js";
import { renderRivers as renderRiverRows } from "./river.js";
import { loadHelmetTexture, helmetDataUrl } from "./helmet.js";
import { isDebugModalOpen, setDebugRoom, onDebugState, setupDebugKeyboard } from "./board_debug.js";
import { rankBadge } from "./rank.js";
import { schemaPlayersToArray, schemaCellOccupantsToObject, schemaToGameState } from "./schema.js";

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
let latestGameState = null;
let boardRoom = null;

function closeKickMenu() {
  document.querySelectorAll(".kick-menu").forEach((m) => m.remove());
}
document.addEventListener("click", closeKickMenu);

function createSidebar(gameId) {
  const sidebar = document.createElement("div");
  sidebar.className = "board-sidebar";

  const qrContainer = document.createElement("div");
  qrContainer.className = "board-qr";
  const qrCanvas = document.createElement("canvas");
  qrContainer.appendChild(qrCanvas);
  sidebar.appendChild(qrContainer);

  const playersCol = document.createElement("div");
  playersCol.className = "board-sidebar-players";
  playersCol.id = "board-players-row";

  const scanLabel = document.createElement("div");
  scanLabel.className = "board-sidebar-element board-scan-label";
  scanLabel.innerHTML = "Scan to join";
  playersCol.appendChild(scanLabel);

  sidebar.appendChild(playersCol);

  const playerUrl = `${location.origin}/game/${gameId}/player`;
  const sidebarWidth = Math.round(window.innerHeight * 0.18);
  QRCode.toCanvas(qrCanvas, playerUrl, {
    width: sidebarWidth,
    margin: 0,
  });

  return sidebar;
}

function createTopBar() {
  const bar = document.createElement("div");
  bar.className = "board-top-bar";

  const exitBtn = document.createElement("button");
  exitBtn.className = "board-exit-btn";
  exitBtn.textContent = "End the game";
  exitBtn.addEventListener("click", () => {
    if (boardRoom) boardRoom.send("destroyRoom");
    window.location.href = "/";
  });
  bar.appendChild(exitBtn);

  const riversContainer = document.createElement("div");
  riversContainer.className = "board-rivers";
  riversContainer.id = "board-rivers";
  bar.appendChild(riversContainer);

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
      el.className = "board-sidebar-element board-player";
      el.dataset.playerId = p.playerId;

      const left = document.createElement("div");
      left.className = "board-player-left";
      const name = document.createElement("div");
      name.className = "board-player-name";
      left.appendChild(name);
      const helmetWrapper = document.createElement("div");
      helmetWrapper.className = "board-player-helmet-wrapper";
      const helmet = document.createElement("img");
      helmet.className = "board-player-helmet";
      helmet.src = "/helmet.svg";
      helmetWrapper.appendChild(helmet);
      const dcIcon = document.createElement("img");
      dcIcon.className = "board-player-dc-icon";
      dcIcon.src = "/disconnected.svg";
      helmetWrapper.appendChild(dcIcon);
      left.appendChild(helmetWrapper);
      el.appendChild(left);

      const right = document.createElement("div");
      right.className = "board-player-right";
      const status = document.createElement("div");
      status.className = "board-player-status";
      right.appendChild(status);
      const coins = document.createElement("div");
      coins.className = "board-player-coins";
      right.appendChild(coins);
      el.appendChild(right);

      el.addEventListener("click", (e) => {
        e.stopPropagation();
        if (boardPhase === "finished" || !boardRoom) return;
        closeKickMenu();
        const menu = document.createElement("div");
        menu.className = "kick-menu";
        menu.innerHTML = `<button class="kick-btn">Kick</button>`;
        menu.querySelector(".kick-btn").addEventListener("click", (ev) => {
          ev.stopPropagation();
          boardRoom.send("kickPlayer", { playerId: p.playerId });
          closeKickMenu();
        });
        el.appendChild(menu);
      });

      container.appendChild(el);
    }

    el.classList.toggle("disconnected", !p.connected);
    el.querySelector(".board-player-name").textContent = p.name || "???";

    const helmetImg = el.querySelector(".board-player-helmet");
    if (p.color && helmetImg.dataset.color !== p.color) {
      helmetImg.dataset.color = p.color;
      helmetDataUrl(p.color).then((url) => { helmetImg.src = url; });
    }

    const leftEl = el.querySelector(".board-player-left");
    const rightEl = el.querySelector(".board-player-right");
    const statusEl = el.querySelector(".board-player-status");
    const coinsEl = el.querySelector(".board-player-coins");
    let lapEl = el.querySelector(".board-player-lap");
    let liveRankEl = el.querySelector(".board-player-live-rank");

    statusEl.style.display = "";
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

    // Lap counter
    if (boardPhase !== "lobby") {
      if (!lapEl) {
        lapEl = document.createElement("div");
        lapEl.className = "board-player-lap";
        rightEl.appendChild(lapEl);
      }
      lapEl.style.display = "";
      const lap = Math.min(p.lapCount, 3);
      lapEl.textContent = `Lap ${lap}/3`;
    } else if (lapEl) {
      lapEl.style.display = "none";
    }

    if (boardPhase !== "lobby") {
      const coinCount = p.coins || 0;
      const permCount = p.permanentCoins || 0;
      const blueCount = Math.min(coinCount, permCount);
      const goldCount = Math.max(0, coinCount - permCount);
      let html = "";
      if (blueCount > 0) {
        html += `<span class="board-coin-count">${blueCount}</span><img src="/permacoin.svg" class="board-coin-icon" />`;
      }
      if (goldCount > 0) {
        if (blueCount > 0) html += `<span class="board-coin-sep"></span>`;
        html += `<span class="board-coin-count">${goldCount}</span><img src="/coin.svg" class="board-coin-icon" />`;
      }
      if (coinCount === 0) {
        html = `<span class="board-coin-count board-coin-zero">0</span><img src="/coin.svg" class="board-coin-icon board-coin-zero" />`;
      }
      const slowCount = p.slowCounters || 0;
      if (slowCount > 0) {
        html += `<span class="board-coin-sep"></span>`;
        html += `<span class="board-coin-count">${slowCount}</span><img src="/dark_mushroom.svg" class="board-coin-icon" />`;
      }
      coinsEl.innerHTML = html;
      coinsEl.style.display = "";
    } else {
      coinsEl.style.display = "none";
    }

    // Live rank
    if (boardPhase !== "lobby" && p.rank > 0) {
      if (!liveRankEl) {
        liveRankEl = document.createElement("div");
        liveRankEl.className = "board-player-live-rank";
        leftEl.appendChild(liveRankEl);
      }
      liveRankEl.innerHTML = rankBadge(p.rank, "board-rank-icon");
      liveRankEl.style.color = p.rank === 1 ? "#FFD700" : "#fff";
      liveRankEl.style.display = "";
    } else if (liveRankEl) {
      liveRankEl.style.display = "none";
    }
  }
}

function updateBoardGameState(data) {
  const container = document.getElementById("board-players-row");
  if (!container) return;

  boardPhase = data.phase;
  latestGameState = data;

  const gameEl = document.getElementById("board-game");
  const hideCanvas = data.phase === "lobby" && latestPlayersData.length === 0;
  if (gameEl) gameEl.style.visibility = hideCanvas ? "hidden" : "";

  if (data.phase === "playing") {
    // Replace scan label with round card
    const scanLabel = container.querySelector(".board-scan-label");
    if (scanLabel) scanLabel.remove();

    let roundCard = container.querySelector(".board-round-card");
    if (!roundCard) {
      roundCard = document.createElement("div");
      roundCard.className = "board-sidebar-element board-round-card";
      container.insertBefore(roundCard, container.firstChild);
    }
    roundCard.innerHTML = `<span>Round</span><span class="board-round-number">${data.currentRound}</span>`;

    // Remove leaderboard if present (after start over → playing again)
    removeLeaderboard();
  }

  if (data.phase === "finished" && data.ranking) {
    showLeaderboard(data.ranking);
  }

  if (data.phase === "lobby") {
    removeLeaderboard();

    // Remove round card and restore scan label
    const roundCard = container.querySelector(".board-round-card");
    if (roundCard) roundCard.remove();
    if (!container.querySelector(".board-scan-label")) {
      const scanLabel = document.createElement("div");
      scanLabel.className = "board-sidebar-element board-scan-label";
      scanLabel.innerHTML = "Scan to join";
      container.insertBefore(scanLabel, container.firstChild);
    }
  }

  // Re-render player info with correct phase
  updateInfoBarPlayers(latestPlayersData);

  // Golden border on active player
  for (const el of container.querySelectorAll(".board-player")) {
    el.classList.toggle("active-player", el.dataset.playerId === data.activePlayerId);
  }
}

function showLeaderboard(ranking) {
  let overlay = document.querySelector(".board-leaderboard");
  if (overlay) overlay.remove();

  overlay = document.createElement("div");
  overlay.className = "board-leaderboard";

  const title = document.createElement("h1");
  title.className = "board-leaderboard-title";
  title.textContent = "Race Complete!";
  overlay.appendChild(title);

  const list = document.createElement("ol");
  list.className = "board-leaderboard-list";
  for (const entry of ranking) {
    const li = document.createElement("li");
    li.className = "board-leaderboard-entry";
    li.innerHTML = `<span class="board-leaderboard-rank">${rankBadge(entry.finalRank, "board-leaderboard-icon")}</span><span class="board-leaderboard-name">${entry.name}</span>`;
    list.appendChild(li);
  }
  overlay.appendChild(list);

  document.body.appendChild(overlay);
}

function removeLeaderboard() {
  const overlay = document.querySelector(".board-leaderboard");
  if (overlay) overlay.remove();
}

function renderRivers(rivers, playerCount) {
  const container = document.getElementById("board-rivers");
  if (!container) return;
  renderRiverRows(container, rivers, { rankIndicators: true, riverCount: rivers.length, playerCount });
}

export function initBoard(gameId) {
  const app = document.getElementById("app");
  app.style.width = "100%";
  app.style.height = "100%";

  app.classList.add("board-layout");
  app.appendChild(createSidebar(gameId));

  const rightSide = document.createElement("div");
  rightSide.className = "board-right";

  rightSide.appendChild(createTopBar());

  const gameContainer = document.createElement("div");
  gameContainer.className = "board-game";
  gameContainer.id = "board-game";
  gameContainer.style.visibility = "hidden";
  rightSide.appendChild(gameContainer);

  app.appendChild(rightSide);

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
      this.shellSprites = new Map();
      this.redShellSprites = new Map();
      this.permacoinSprites = new Map();
      this._inflightShells = new Map(); // cellId → shell sprite being animated to that cell
      this._dustCloudCells = new Set(); // cellIds with active dust cloud animations
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
      const spriteSize = Math.round(maxDim / 5 / 4.5 * 0.9);
      this.load.svg("banana", "/banana.svg", { width: spriteSize, height: spriteSize });
      this.load.svg("green_shell", "/green_shell.svg", { width: spriteSize, height: spriteSize });
      this.load.svg("red_shell", "/red_shell.svg", { width: spriteSize, height: spriteSize });
      this.load.svg("permacoin", "/permacoin.svg", { width: spriteSize, height: spriteSize });
      this.load.svg("hit_star", "/hit_star.svg", { width: spriteSize, height: spriteSize });
      this.load.svg("dark_mushroom", "/dark_mushroom.svg", { width: spriteSize, height: spriteSize });
      this.load.svg("dust_cloud", "/dust_cloud.svg", { width: spriteSize, height: spriteSize });
    }

    create() {
      this.track = this.add.image(0, 0, "racetrack");
      this.layoutTrack();
      this.createPermacoinSprites();
      this.scale.on("resize", this.onResize, this);
      this.connectToRoom(gameId);
    }

    layoutTrack() {
      const { width, height } = this.scale;

      this.track.setPosition(width / 2, height / 2);
      const scaleX = (width * 0.9) / this.track.width;
      const scaleY = (height * 0.9) / this.track.height;
      this.track.setScale(Math.min(scaleX, scaleY));
    }

    createPermacoinSprites() {
      for (const cellId of permacoinCells) {
        const center = this.cellPixelPos(cellId);
        const sprite = this.add.image(center.x, center.y, "permacoin");
        sprite.setDepth(0);
        sprite.setVisible(false);
        this.permacoinSprites.set(cellId, sprite);
      }
      this.repositionPermacoinSprites();
    }

    repositionPermacoinSprites() {
      const cellW = this.track.displayWidth / 5;
      const itemSize = (cellW / 4.5) * 0.9;
      for (const [cellId, sprite] of this.permacoinSprites) {
        const occupants = this.latestCellOccupants[cellId] || [];
        const total = occupants.length + 1; // +1 for permacoin at slot 0
        const { x, y } = this.cellSlotPos(cellId, 0, total);
        sprite.setPosition(x, y);
        sprite.setScale(itemSize / sprite.width);
        if (!sprite.visible) sprite.setVisible(true);
      }
    }

    onResize() {
      this.layoutTrack();
      this.refreshPlayerPositions();
      this.snapCellLayout();
      this.repositionPermacoinSprites();
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

    _slotOffset(cellId) {
      return permacoinCells.has(cellId) ? 1 : 0;
    }

    refreshPlayerPositions() {
      const cellW = this.track.displayWidth / 5;
      const helmetSlot = cellW / 4.5;
      const helmetDisplaySize = helmetSlot * 0.9;

      for (const [cellIdStr, occupants] of Object.entries(this.latestCellOccupants)) {
        const cellId = Number(cellIdStr);
        if (!CELL_POSITIONS[cellId]) continue;
        const offset = this._slotOffset(cellId);
        const totalSlots = occupants.length + offset;
        occupants.forEach((entry, slotIndex) => {
          if (entry === "banana" || entry === "green_shell" || entry === "red_shell") return;
          const helmet = this.helmets.get(entry);
          const label = this.nameLabels.get(entry);
          if (!helmet) return;
          const { x, y } = this.cellSlotPos(cellId, slotIndex + offset, totalSlots);
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
      const itemSize = helmetSlot * 0.9;

      for (const [cellIdStr, occupants] of Object.entries(this.latestCellOccupants)) {
        const cellId = Number(cellIdStr);
        if (!CELL_POSITIONS[cellId]) continue;
        if (this._dustCloudCells.has(cellId)) continue;
        const bSprites = this.bananaSprites.get(cellId) || [];
        const sSprites = this.shellSprites.get(cellId) || [];
        const rsSprites = this.redShellSprites.get(cellId) || [];
        let bananaIdx = 0;
        let shellIdx = 0;
        let redShellIdx = 0;
        const offset = this._slotOffset(cellId);
        const totalSlots = occupants.length + offset;

        occupants.forEach((entry, slotIndex) => {
          const { x, y } = this.cellSlotPos(cellId, slotIndex + offset, totalSlots);
          if (entry === "banana" || entry === "green_shell" || entry === "red_shell") {
            const sprite = entry === "banana" ? bSprites[bananaIdx++]
              : entry === "green_shell" ? sSprites[shellIdx++]
                : rsSprites[redShellIdx++];
            if (sprite && (sprite.x !== x || sprite.y !== y)) {
              this.tweens.add({ targets: sprite, x, y, duration: 300, ease: "Power2" });
            }
            if (sprite) sprite.setScale(itemSize / sprite.width);
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
      let room;
      try {
        room = await colyseusClient.joinById(roomId, { type: "board" });
      } catch {
        await fetch(`/find-or-create/${roomId}`);
        room = await colyseusClient.joinById(roomId, { type: "board" });
      }
      this.setupRoom(room, roomId);
    }

    setupRoom(room, roomId) {
      boardRoom = room;
      setDebugRoom(room);

      // Schema-based state sync
      let playersDirty = false;
      let cellOccupantsDirty = false;
      let gameStateDirty = false;
      let riversDirty = false;

      const $ = Callbacks.get(room);

      $.onAdd("players", (player) => {
        playersDirty = true;
        $.onChange(player, () => { playersDirty = true; });
      });
      $.onRemove("players", () => { playersDirty = true; });

      $.onAdd("cellOccupants", (co) => {
        cellOccupantsDirty = true;
        $.onAdd(co, "entries", () => { cellOccupantsDirty = true; });
        $.onChange(co, () => { cellOccupantsDirty = true; });
        $.onRemove(co, "entries", () => { cellOccupantsDirty = true; });
      });
      $.onRemove("cellOccupants", () => { cellOccupantsDirty = true; });

      $.listen("phase", () => { gameStateDirty = true; });
      $.listen("currentRound", () => { gameStateDirty = true; });
      $.listen("activePlayerId", () => { gameStateDirty = true; });

      $.onAdd("ranking", () => { gameStateDirty = true; });
      $.onRemove("ranking", () => { gameStateDirty = true; });

      $.onAdd("rivers", () => { riversDirty = true; });
      $.onChange("rivers", () => { riversDirty = true; });
      $.onRemove("rivers", () => { riversDirty = true; });

      room.onStateChange((state) => {
        // Process cellOccupants before players so grid slots are up-to-date
        // when updatePlayers computes tween targets for moving helmets
        if (cellOccupantsDirty) {
          const cellOccupants = schemaCellOccupantsToObject(state);
          this.updateCellOccupants(cellOccupants);
          cellOccupantsDirty = false;
        }
        if (playersDirty) {
          const players = schemaPlayersToArray(state);
          updateInfoBarPlayers(players);
          this.updatePlayers(players);
          playersDirty = false;
        }
        if (gameStateDirty || riversDirty) {
          const gameState = schemaToGameState(state);
          updateBoardGameState(gameState);
          if (gameState.rivers) renderRivers(gameState.rivers, state.players.size);
          gameStateDirty = false;
          riversDirty = false;
        }
        if (isDebugModalOpen()) room.send("_debugGetState");
      });

      // Animation events stay as messages (not state)
      room.onMessage("itemHitBoard", (data) => this._enqueueAnimation({ _itemHit: data }));
      room.onMessage("shellThrown", (data) => this._enqueueAnimation({ _shellThrown: data }));
      room.onMessage("permanentCoinPickup", (data) => this._enqueueAnimation({ _permanentCoinPickup: data }));
      room.onMessage("_debugState", (data) => {
        onDebugState(data);
      });

      // Built-in auto-reconnect (Colyseus 0.17)
      room.reconnection.maxRetries = 30;
      room.reconnection.maxDelay = 5000;

      const scene = this;
      room.onLeave((code) => {
        if (code === 4003) {
          // Reconnection failed — fallback: fresh join
          colyseusClient.joinById(roomId, { type: "board" })
            .then((newRoom) => scene.setupRoom(newRoom, roomId));
        }
      });
    }

    _enqueueAnimation(entry) {
      this._cellOccupantsQueue.push(entry);
      while (this._cellOccupantsQueue.length > 10) {
        this._cellOccupantsQueue.shift();
      }
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
      if (entry._itemHit) {
        this.animateItemHit(entry._itemHit.playerId, entry._itemHit.cellId, entry._itemHit.type || "banana");
        this.time.delayedCall(1400, () => this._processNextCellOccupants());
      } else if (entry._shellThrown) {
        const pathLen = entry._shellThrown.path ? entry._shellThrown.path.length : 0;
        const travelTime = pathLen > 1 ? pathLen * 200 : 400;
        this.animateShellThrow(entry._shellThrown);
        this.time.delayedCall(travelTime + 1000, () => this._processNextCellOccupants());
      } else if (entry._permanentCoinPickup) {
        this.animatePermacoinPickup(entry._permanentCoinPickup.cellId);
        this.time.delayedCall(700, () => this._processNextCellOccupants());
      }
    }

    animatePermacoinPickup(cellId) {
      const sprite = this.permacoinSprites.get(cellId);
      if (!sprite) return;
      const origY = sprite.y;
      const cellW = this.track.displayWidth / 5;
      const jumpHeight = cellW / 3;
      sprite.setDepth(10);
      this.tweens.add({
        targets: sprite,
        y: origY - jumpHeight,
        duration: 300,
        ease: "Power2",
        yoyo: true,
        onComplete: () => {
          sprite.setDepth(0);
        },
      });
      this.tweens.add({
        targets: sprite,
        angle: 720,
        duration: 600,
        ease: "Linear",
        onComplete: () => {
          sprite.setAngle(0);
        },
      });
    }

    updateCellOccupants(cellOccupants) {
      this.latestCellOccupants = cellOccupants;

      this._syncItemSprites(this.bananaSprites, bananaCounts(cellOccupants), "banana");
      this._syncItemSprites(this.shellSprites, shellCounts(cellOccupants), "green_shell");
      this._syncItemSprites(this.redShellSprites, redShellCounts(cellOccupants), "red_shell");

      this.tweenCellLayout();
      this.repositionPermacoinSprites();
    }

    _syncItemSprites(spriteMap, countsByCell, textureKey) {
      // Remove sprites for cells that no longer have this item
      for (const [cellId, sprites] of spriteMap) {
        if (!countsByCell[cellId]) {
          sprites.forEach((s) => s.destroy());
          spriteMap.delete(cellId);
        }
      }
      // Create or destroy sprites to match counts
      for (const [cellId, count] of Object.entries(countsByCell)) {
        const cid = Number(cellId);
        // Skip cells with an in-flight shell animation — the animation
        // sprite will be registered when it arrives
        if ((textureKey === "green_shell" || textureKey === "red_shell") && this._inflightShells.has(cid)) {
          continue;
        }
        const existing = spriteMap.get(cid) || [];
        while (existing.length > count) {
          existing.pop().destroy();
        }
        while (existing.length < count) {
          const center = this.cellPixelPos(cid);
          const sprite = this.add.image(center.x, center.y, textureKey);
          sprite.setDepth(0);
          existing.push(sprite);
        }
        spriteMap.set(cid, existing);
      }
    }

    snapCellLayout() {
      const cellW = this.track.displayWidth / 5;
      const helmetSlot = cellW / 4.5;
      const bananaSize = helmetSlot * 0.9;

      for (const [cellIdStr, occupants] of Object.entries(this.latestCellOccupants)) {
        const cellId = Number(cellIdStr);
        if (!CELL_POSITIONS[cellId]) continue;
        const bSprites = this.bananaSprites.get(cellId) || [];
        const sSprites = this.shellSprites.get(cellId) || [];
        const rsSprites = this.redShellSprites.get(cellId) || [];
        let bananaIdx = 0;
        let shellIdx = 0;
        let redShellIdx = 0;
        const offset = this._slotOffset(cellId);
        const totalSlots = occupants.length + offset;

        occupants.forEach((entry, slotIndex) => {
          if (entry !== "banana" && entry !== "green_shell" && entry !== "red_shell") return;
          const sprite = entry === "banana" ? bSprites[bananaIdx++]
            : entry === "green_shell" ? sSprites[shellIdx++]
              : rsSprites[redShellIdx++];
          if (!sprite) return;
          const { x, y } = this.cellSlotPos(cellId, slotIndex + offset, totalSlots);
          sprite.setPosition(x, y);
          sprite.setScale(bananaSize / sprite.width);
        });
      }
    }

    _spawnHitStars(x, y, size) {
      const directions = [180, 135, 45, 0]; // upward-ish fan: left → upper-left → upper-right → right
      const rotations = [0, 18, 36, 54];     // spread within one 72° symmetry period
      directions.forEach((dir, i) => {
        const star = this.add.image(x, y, "hit_star");
        star.setScale(size * 0.4 / star.width);
        star.setAngle(rotations[i]);
        star.setDepth(10);
        const rad = dir * Math.PI / 180;
        this.tweens.add({
          targets: star,
          x: x + Math.cos(rad) * size,
          y: y - Math.sin(rad) * size,
          angle: rotations[i] + 360,
          duration: 400,
          ease: "Power2",
          onComplete: () => { star.destroy(); },
        });
      });
    }

    _spawnDarkMushroom(x, y, size) {
      const mush = this.add.image(x, y, "dark_mushroom");
      mush.setScale(size * 0.5 / mush.width);
      mush.setDepth(10);
      this.tweens.add({
        targets: mush,
        y: y - size * 2,
        scale: mush.scale * 2,
        duration: 1000,
        ease: "Power2",
        onComplete: () => { mush.destroy(); },
      });
      this.tweens.add({
        targets: mush,
        alpha: 0,
        duration: 350,
        delay: 650,
      });
    }

    _spawnDustCloud(x, y, size) {
      const cloud = this.add.image(x, y, "dust_cloud");
      cloud.setScale(size / cloud.width);
      cloud.setDepth(10);
      this.tweens.add({
        targets: cloud,
        scale: cloud.scale * 2,
        duration: 500,
        ease: "Power2",
        onComplete: () => { cloud.destroy(); },
      });
      this.tweens.add({
        targets: cloud,
        alpha: 0,
        duration: 125,
        delay: 375,
      });
    }

    animateItemHit(playerId, cellId, itemType = "banana") {
      const helmet = this.helmets.get(playerId);
      const label = this.nameLabels.get(playerId);
      if (!helmet) return;

      const moveDelay = 350; // Slightly shorter than the 400ms helmet tween to account for Power2 ease deceleration
      const spriteMap = itemType === "red_shell" ? this.redShellSprites
        : itemType === "green_shell" ? this.shellSprites
          : this.bananaSprites;

      // Use the real item sprite from the cell (server hasn't broadcast its removal yet)
      const sprites = spriteMap.get(cellId) || [];
      const item = sprites.pop();
      if (sprites.length === 0) {
        spriteMap.delete(cellId);
      }

      if (!item) return;
      item.setDepth(10);

      // Also remove from latestCellOccupants so tweenCellLayout doesn't reposition it
      const occupants = this.latestCellOccupants[cellId];
      if (occupants) {
        const idx = occupants.lastIndexOf(itemType);
        if (idx !== -1) occupants.splice(idx, 1);
      }

      // After move completes, rearrange remaining occupants on the cell
      this.time.delayedCall(moveDelay, () => this.tweenCellLayout());

      // After move: helmet rotates twice, item launches out, stars burst
      const center = this.cellPixelPos(cellId);
      const helmetSize = this.track.displayWidth / 5 / 4.5 * 0.9;
      this.tweens.add({
        targets: helmet,
        angle: -720,
        duration: 1000,
        ease: "Linear",
        delay: moveDelay,
        onComplete: () => { helmet.setAngle(0); },
      });
      this.tweens.add({
        targets: item,
        y: center.y - this.scale.height * 0.6,
        angle: 360,
        alpha: 0,
        duration: 600,
        ease: "Power2",
        delay: moveDelay,
        onComplete: () => { item.destroy(); },
      });
      this.time.delayedCall(moveDelay, () => {
        this._spawnHitStars(helmet.x, helmet.y, helmetSize);
        if (itemType === "green_shell" || itemType === "red_shell") {
          this._spawnDarkMushroom(helmet.x, helmet.y, helmetSize);
        }
      });
    }

    animateShellThrow(data) {
      const from = this.cellPixelPos(data.fromCellId);
      const to = this.cellPixelPos(data.toCellId);
      const cellW = this.track.displayWidth / 5;
      const itemSize = cellW / 4.5 * 0.9;
      const textureKey = data.shellType || "green_shell";

      // Create shell sprite at thrower position
      const shell = this.add.image(from.x, from.y, textureKey);
      shell.setScale(itemSize / shell.width);
      shell.setDepth(10);

      // Grab the hit item sprite NOW before updateCellOccupants destroys it
      let hitItem = null;
      if (data.hit === "banana" || data.hit === "green_shell" || data.hit === "red_shell") {
        const hitSpriteMap = data.hit === "banana" ? this.bananaSprites
          : data.hit === "green_shell" ? this.shellSprites
            : this.redShellSprites;
        const hitSprites = hitSpriteMap.get(data.toCellId) || [];
        hitItem = hitSprites.pop();
        if (hitSprites.length === 0) hitSpriteMap.delete(data.toCellId);

        // Remove from latestCellOccupants so tweenCellLayout doesn't reposition it
        const occupants = this.latestCellOccupants[data.toCellId];
        if (occupants) {
          const idx = occupants.lastIndexOf(data.hit);
          if (idx !== -1) occupants.splice(idx, 1);
        }
      }

      // For shells that land on the cell (no hit), mark cell as
      // in-flight so _syncItemSprites won't create a duplicate sprite.
      // The animation sprite becomes the permanent one on arrival.
      if (!data.hit && (textureKey === "green_shell" || textureKey === "red_shell")) {
        // Destroy any sprite _syncItemSprites already created
        const destMap = textureKey === "green_shell" ? this.shellSprites : this.redShellSprites;
        const destSprites = destMap.get(data.toCellId) || [];
        const synced = destSprites.pop();
        if (synced) synced.destroy();
        if (destSprites.length === 0) destMap.delete(data.toCellId);

        this._inflightShells.set(data.toCellId, shell);
      }

      // Build waypoints for the shell travel path
      const waypoints = data.path && data.path.length > 1
        ? data.path.map((cellId) => this.cellPixelPos(cellId))
        : [to];
      const perCell = waypoints.length > 1 ? 200 : 400;
      const totalTravelTime = waypoints.length * perCell;

      // Create a timeline that moves the shell through all waypoints smoothly
      const events = waypoints.map((wp, i) => ({
        at: i * perCell,
        tween: {
          targets: shell,
          x: wp.x,
          y: wp.y,
          duration: perCell,
          ease: "Linear",
        },
      }));

      // Play hit effects after shell reaches destination
      events.push({
        at: totalTravelTime,
        run: () => {
          if (data.hit === "player") {
            // Spin hit player's helmet, launch shell upward, burst stars + dark mushroom
            const helmet = this.helmets.get(data.hitPlayerId);
            const helmetSize = this.track.displayWidth / 5 / 4.5 * 0.9;
            if (helmet) {
              this.tweens.add({
                targets: helmet,
                angle: -720,
                duration: 1000,
                ease: "Linear",
                onComplete: () => { helmet.setAngle(0); },
              });
              this._spawnHitStars(helmet.x, helmet.y, helmetSize);
              this._spawnDarkMushroom(helmet.x, helmet.y, helmetSize);
            }
            this.tweens.add({
              targets: shell,
              y: to.y - this.scale.height * 0.6,
              angle: 360,
              alpha: 0,
              duration: 600,
              ease: "Power2",
              onComplete: () => { shell.destroy(); },
            });
          } else if (data.hit === "banana" || data.hit === "green_shell" || data.hit === "red_shell") {
            // Dust cloud on target object, freeze cell layout until animation ends
            this._dustCloudCells.add(data.toCellId);
            if (hitItem) {
              this._spawnDustCloud(hitItem.x, hitItem.y, itemSize);
              hitItem.destroy();
            }
            shell.destroy();
            this.time.delayedCall(500, () => {
              this._dustCloudCells.delete(data.toCellId);
              this.tweenCellLayout();
            });
          } else if (!data.hit && (textureKey === "green_shell" || textureKey === "red_shell")) {
            // Shell, no hit — shell stays on cell
            shell.setDepth(0);
            this._inflightShells.delete(data.toCellId);
            const destMap = textureKey === "green_shell" ? this.shellSprites : this.redShellSprites;
            const existing = destMap.get(data.toCellId) || [];
            existing.push(shell);
            destMap.set(data.toCellId, existing);
            this.tweenCellLayout();
          } else {
            shell.destroy();
          }
        },
      });

      this.add.timeline(events).play();
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
        const offset = this._slotOffset(cellId);
        const totalSlots = occupants.length + offset;

        cellPlayers.forEach((p) => {
          const slotIndex = occupants.indexOf(p.playerId);
          const slot = slotIndex !== -1
            ? this.cellSlotPos(cellId, slotIndex + offset, totalSlots)
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
            const textureKey = `helmet_${p.color}`;
            if (!this.textures.exists(textureKey)) {
              loadHelmetTexture(this, p.color).then(() => this.updatePlayers(this.latestPlayers));
              return;
            }
            const helmet = this.add.image(x, y, textureKey);
            helmet.setScale(helmetDisplaySize / helmet.width);
            helmet.setAlpha(alpha);
            helmet.setDepth(5);
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
            label.setDepth(5);
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
    backgroundColor: "#111111",
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: GameScene,
  });

  setupDebugKeyboard();
}

