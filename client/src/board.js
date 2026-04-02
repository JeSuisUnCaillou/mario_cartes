import Phaser from "phaser";
import { Client } from "colyseus.js";
import QRCode from "qrcode";
import { bananaCounts, shellCounts } from "./board.functions.js";
import { renderRivers as renderRiverRows } from "./river.js";
import { isDebugModalOpen, setDebugRoom, onDebugState, setupDebugKeyboard } from "./board_debug.js";
import { rankBadge } from "./rank.js";

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

function schemaPlayersToArray(state) {
  const players = [];
  state.players.forEach((p, playerId) => {
    players.push({
      playerId,
      name: p.name,
      cellId: p.cellId,
      connected: p.connected,
      handCount: p.handCount,
      ready: p.ready,
      coins: p.coins,
      lapCount: p.lapCount,
      pendingShellChoice: p.pendingShellChoice,
      finished: p.finished,
      rank: p.rank,
    });
  });
  return players;
}

function schemaCellOccupantsToObject(state) {
  const result = {};
  state.cellOccupants.forEach((co, cellId) => {
    const entries = [];
    co.entries.forEach((e) => entries.push(e));
    if (entries.length > 0) result[cellId] = entries;
  });
  return result;
}

function schemaToGameState(state) {
  const gs = {
    phase: state.phase,
    currentRound: state.currentRound,
    activePlayerId: state.activePlayerId || null,
  };
  if (state.rivers.length > 0) {
    gs.rivers = [];
    state.rivers.forEach((r) => {
      const slots = [];
      r.slots.forEach((s) => {
        if (s.id) {
          slots.push({ id: s.id, items: JSON.parse(s.items) });
        } else {
          slots.push(null);
        }
      });
      gs.rivers.push({ id: r.id, cost: r.cost, slots, deckCount: r.deckCount });
    });
  }
  if (state.ranking.length > 0) {
    gs.ranking = [];
    state.ranking.forEach((r) => {
      gs.ranking.push({ playerId: r.playerId, name: r.name, finalRank: r.finalRank });
    });
  }
  return gs;
}


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

  const title = document.createElement("div");
  title.className = "board-title-name";
  title.textContent = "Mario Cartes";
  bar.appendChild(title);

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
      const helmet = document.createElement("img");
      helmet.className = "board-player-helmet";
      helmet.src = "/helmet.svg";
      left.appendChild(helmet);
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
      const zeroClass = coinCount === 0 ? " board-coin-zero" : "";
      coinsEl.innerHTML = `<span class="board-coin-count${zeroClass}">${coinCount}</span><img src="/coin.svg" class="board-coin-icon${zeroClass}" />`;
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

function renderRivers(rivers) {
  const container = document.getElementById("board-rivers");
  if (!container) return;
  renderRiverRows(container, rivers, { rankIndicators: true, riverCount: rivers.length });
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
      this.load.svg("green_shell", "/green_shell.svg", { width: 128, height: 128 });
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
          if (entry === "banana" || entry === "green_shell") return;
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
      const itemSize = helmetSlot * 0.9;

      for (const [cellIdStr, occupants] of Object.entries(this.latestCellOccupants)) {
        const cellId = Number(cellIdStr);
        if (!CELL_POSITIONS[cellId]) continue;
        const bSprites = this.bananaSprites.get(cellId) || [];
        const sSprites = this.shellSprites.get(cellId) || [];
        let bananaIdx = 0;
        let shellIdx = 0;

        occupants.forEach((entry, slotIndex) => {
          const { x, y } = this.cellSlotPos(cellId, slotIndex, occupants.length);
          if (entry === "banana" || entry === "green_shell") {
            const sprite = entry === "banana" ? bSprites[bananaIdx++] : sSprites[shellIdx++];
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
      try {
        await colyseusClient.joinById(roomId, { type: "board" });
      } catch {
        await fetch(`/find-or-create/${roomId}`);
      }
      const room = await colyseusClient.joinById(roomId, { type: "board" });
      boardRoom = room;
      setDebugRoom(room);

      // Schema-based state sync
      let playersDirty = false;
      let cellOccupantsDirty = false;
      let gameStateDirty = false;
      let riversDirty = false;

      room.state.players.onAdd((player) => {
        playersDirty = true;
        player.onChange(() => { playersDirty = true; });
      });
      room.state.players.onRemove(() => { playersDirty = true; });

      room.state.cellOccupants.onAdd((co, key) => {
        cellOccupantsDirty = true;
        co.entries.onAdd(() => { cellOccupantsDirty = true; });
        co.entries.onChange(() => { cellOccupantsDirty = true; });
        co.entries.onRemove(() => { cellOccupantsDirty = true; });
      });
      room.state.cellOccupants.onRemove(() => { cellOccupantsDirty = true; });

      room.state.listen("phase", () => { gameStateDirty = true; });
      room.state.listen("currentRound", () => { gameStateDirty = true; });
      room.state.listen("activePlayerId", () => { gameStateDirty = true; });

      room.state.ranking.onAdd(() => { gameStateDirty = true; });
      room.state.ranking.onRemove(() => { gameStateDirty = true; });

      room.state.rivers.onAdd(() => { riversDirty = true; });
      room.state.rivers.onChange(() => { riversDirty = true; });
      room.state.rivers.onRemove(() => { riversDirty = true; });

      room.onStateChange((state) => {
        if (playersDirty) {
          const players = schemaPlayersToArray(state);
          updateInfoBarPlayers(players);
          this.updatePlayers(players);
          playersDirty = false;
        }
        if (cellOccupantsDirty) {
          const cellOccupants = schemaCellOccupantsToObject(state);
          this.updateCellOccupants(cellOccupants);
          cellOccupantsDirty = false;
        }
        if (gameStateDirty || riversDirty) {
          const gameState = schemaToGameState(state);
          updateBoardGameState(gameState);
          if (riversDirty && gameState.rivers) renderRivers(gameState.rivers);
          gameStateDirty = false;
          riversDirty = false;
        }
        if (isDebugModalOpen()) room.send("_debugGetState");
      });

      // Animation events stay as messages (not state)
      room.onMessage("itemHitBoard", (data) => {
        this._cellOccupantsQueue.push({ _itemHit: data });
        if (!this._processingQueue) {
          this._processNextCellOccupants();
        }
      });
      room.onMessage("shellThrown", (data) => {
        this._cellOccupantsQueue.push({ _shellThrown: data });
        if (!this._processingQueue) {
          this._processNextCellOccupants();
        }
      });
      room.onMessage("_debugState", (data) => {
        onDebugState(data);
      });
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
        this.animateShellThrow(entry._shellThrown);
        this.time.delayedCall(1400, () => this._processNextCellOccupants());
      }
    }

    updateCellOccupants(cellOccupants) {
      this.latestCellOccupants = cellOccupants;

      this._syncItemSprites(this.bananaSprites, bananaCounts(cellOccupants), "banana");
      this._syncItemSprites(this.shellSprites, shellCounts(cellOccupants), "green_shell");

      this.tweenCellLayout();
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
        const existing = spriteMap.get(Number(cellId)) || [];
        while (existing.length > count) {
          existing.pop().destroy();
        }
        while (existing.length < count) {
          const center = this.cellPixelPos(Number(cellId));
          const sprite = this.add.image(center.x, center.y, textureKey);
          sprite.setDepth(0);
          existing.push(sprite);
        }
        spriteMap.set(Number(cellId), existing);
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
        let bananaIdx = 0;
        let shellIdx = 0;

        occupants.forEach((entry, slotIndex) => {
          if (entry !== "banana" && entry !== "green_shell") return;
          const sprite = entry === "banana" ? bSprites[bananaIdx++] : sSprites[shellIdx++];
          if (!sprite) return;
          const { x, y } = this.cellSlotPos(cellId, slotIndex, occupants.length);
          sprite.setPosition(x, y);
          sprite.setScale(bananaSize / sprite.width);
        });
      }
    }

    animateItemHit(playerId, cellId, itemType = "banana") {
      const helmet = this.helmets.get(playerId);
      const label = this.nameLabels.get(playerId);
      if (!helmet) return;

      const moveDelay = 350; // Slightly shorter than the 400ms helmet tween to account for Power2 ease deceleration
      const spriteMap = itemType === "green_shell" ? this.shellSprites : this.bananaSprites;

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

      // After move: helmet rotates twice, item launches out
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
        targets: item,
        y: center.y - this.scale.height * 0.6,
        angle: 360,
        alpha: 0,
        duration: 600,
        ease: "Power2",
        delay: moveDelay,
        onComplete: () => { item.destroy(); },
      });
    }

    animateShellThrow(data) {
      const from = this.cellPixelPos(data.fromCellId);
      const to = this.cellPixelPos(data.toCellId);
      const cellW = this.track.displayWidth / 5;
      const itemSize = cellW / 4.5 * 0.9;

      // Create shell sprite at thrower position
      const shell = this.add.image(from.x, from.y, "green_shell");
      shell.setScale(itemSize / shell.width);
      shell.setDepth(10);

      // Grab the hit item sprite NOW before updateCellOccupants destroys it
      let hitItem = null;
      if (data.hit === "banana" || data.hit === "green_shell") {
        const hitSpriteMap = data.hit === "banana" ? this.bananaSprites : this.shellSprites;
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

      // Tween shell to target cell
      this.tweens.add({
        targets: shell,
        x: to.x,
        y: to.y,
        duration: 400,
        ease: "Power2",
        onComplete: () => {
          if (data.hit === "player") {
            // Spin hit player's helmet and launch shell upward
            const helmet = this.helmets.get(data.hitPlayerId);
            if (helmet) {
              this.tweens.add({
                targets: helmet,
                angle: -720,
                duration: 1000,
                ease: "Linear",
                onComplete: () => { helmet.setAngle(0); },
              });
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
          } else if (data.hit === "banana" || data.hit === "green_shell") {
            const launchY = to.y - this.scale.height * 0.6;
            const spread = Math.tan(7.5 * Math.PI / 180) * this.scale.height * 0.6;

            // Shell launches upward-left
            this.tweens.add({
              targets: shell,
              x: to.x - spread,
              y: launchY,
              angle: 360,
              alpha: 0,
              duration: 600,
              ease: "Power2",
              onComplete: () => { shell.destroy(); },
            });

            // Hit item launches upward-right
            if (hitItem) {
              hitItem.setDepth(10);
              this.tweens.add({
                targets: hitItem,
                x: to.x + spread,
                y: launchY,
                angle: -360,
                alpha: 0,
                duration: 600,
                ease: "Power2",
                onComplete: () => { hitItem.destroy(); },
              });
            }

            this.tweenCellLayout();
          } else {
            // No hit — shell stays. Add it to shellSprites so _syncItemSprites
            // doesn't create a duplicate (which would cause a blink).
            shell.setDepth(0);
            const existing = this.shellSprites.get(data.toCellId) || [];
            existing.push(shell);
            this.shellSprites.set(data.toCellId, existing);
          }
        },
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
    backgroundColor: "#000000",
    scale: {
      mode: Phaser.Scale.RESIZE,
      autoCenter: Phaser.Scale.CENTER_BOTH,
    },
    scene: GameScene,
  });

  setupDebugKeyboard();
}

