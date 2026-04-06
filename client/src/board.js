import Phaser from "phaser";
import { Client, Callbacks } from "@colyseus/sdk";
import QRCode from "qrcode";
import { CellItemSprites } from "./board_items.js";
import { BoardAnimator } from "./board_animations.js";
import { renderRivers as renderRiverRows } from "./river.js";
import { loadHelmetTexture, helmetDataUrl } from "./helmet.js";
import { isDebugModalOpen, setDebugRoom, onDebugState, setupDebugKeyboard } from "./board_debug.js";
import { rankBadge } from "./rank.js";
import { schemaPlayersToArray, schemaCellOccupantsToObject, schemaToGameState } from "./schema.js";
import { PlayerAvatar } from "./board_avatar.js";
import { CELL_POSITIONS, SVG_ASPECT } from "./board.functions.js";
const HELMET_SIZE_RATIO = 1;

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
      const hasNormalCoins = coinCount > permCount;
      const coinIcon = hasNormalCoins ? "/coin.svg" : "/permacoin.svg";
      let html = "";
      if (coinCount === 0) {
        html = `<span class="board-coin-count board-coin-zero">0</span><img src="/coin.svg" class="board-coin-icon board-coin-zero" />`;
      } else {
        html = `<span class="board-coin-count">${coinCount}</span><img src="${coinIcon}" class="board-coin-icon" />`;
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
      this.avatars = new Map();
      this.latestPlayers = [];
      this.latestCellOccupants = {};
      this._pendingOccupants = {};
    }

    get cellW() { return this.track.displayWidth / 5; }
    get helmetSlot() { return this.cellW / 4.5; }
    get helmetDisplaySize() { return this.helmetSlot * HELMET_SIZE_RATIO; }

    preload() {
      const dpr = window.devicePixelRatio || 1;
      const maxDim = Math.max(window.innerWidth, window.innerHeight) * dpr;
      const trackW = Math.round(maxDim);
      const trackH = Math.round(maxDim / SVG_ASPECT);
      this.load.svg("racetrack", "/racetrack_1.svg", { width: trackW, height: trackH });
      const spriteSize = Math.round(maxDim / 5 / 4.5 * 0.9);
      this.load.svg("banana", "/banana.svg", { width: spriteSize, height: spriteSize });
      this.load.svg("green_shell", "/green_shell.svg", { width: spriteSize, height: spriteSize });
      this.load.svg("red_shell", "/red_shell.svg", { width: spriteSize, height: spriteSize });
      this.load.svg("blue_shell", "/blue_shell.svg", { width: spriteSize, height: spriteSize });
      this.load.svg("permacoin", "/permacoin.svg", { width: spriteSize, height: spriteSize });
      this.load.svg("hit_star", "/hit_star.svg", { width: spriteSize, height: spriteSize });
      this.load.svg("star_overlay", "/star.svg", { width: spriteSize * 2, height: spriteSize * 2 });
      this.load.svg("dark_mushroom", "/dark_mushroom.svg", { width: spriteSize, height: spriteSize });
      this.load.svg("dust_cloud", "/dust_cloud.svg", { width: spriteSize, height: spriteSize });
    }

    create() {
      this.track = this.add.image(0, 0, "racetrack");
      this.layoutTrack();
      this.items = new CellItemSprites(
        this,
        (cellId) => this.cellPixelPos(cellId),
        (cellId, slotIndex, totalSlots) => this.cellSlotPos(cellId, slotIndex, totalSlots),
      );
      this.items.createPermacoins();
      this.animator = new BoardAnimator(
        this,
        this.items,
        this.avatars,
        (cellId) => this.cellPixelPos(cellId),
        () => this.tweenCellLayout(),
        (cellId) => this.applyPendingOccupants(cellId),
      );
      this.scale.on("resize", this.onResize, this);
      this.connectToRoom(gameId);
    }

    update() {
      const helmetSize = this.track ? this.helmetSlot * 0.9 : 0;
      for (const avatar of this.avatars.values()) {
        if (avatar.starOverlay) {
          avatar.starOverlay.x = avatar.helmet.x;
          avatar.starOverlay.y = avatar.helmet.y - helmetSize * 0.3;
        }
        if (avatar._hitContainer) {
          avatar._hitContainer.setPosition(avatar.helmet.x, avatar.helmet.y);
        }
      }
    }

    layoutTrack() {
      const { width, height } = this.scale;

      this.track.setPosition(width / 2, height / 2);
      const scaleX = (width * 0.9) / this.track.width;
      const scaleY = (height * 0.9) / this.track.height;
      this.track.setScale(Math.min(scaleX, scaleY));
    }

    onResize() {
      this.layoutTrack();
      this.refreshPlayerPositions();
      this.items.snapLayout(this.latestCellOccupants, CELL_POSITIONS);
      this.items.repositionPermacoins(this.latestCellOccupants);
    }

    cellSlotPos(cellId, slotIndex, totalSlots) {
      const cellW = this.cellW;
      const maxPerRow = 4;
      const helmetSlot = this.helmetSlot;
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
      const helmetDisplaySize = this.helmetDisplaySize;

      for (const [cellIdStr, occupants] of Object.entries(this.latestCellOccupants)) {
        const cellId = Number(cellIdStr);
        if (!CELL_POSITIONS[cellId]) continue;
        const offset = this.items.slotOffset(cellId);
        const totalSlots = occupants.length + offset;
        occupants.forEach((entry, slotIndex) => {
          if (entry === "banana" || entry === "green_shell" || entry === "red_shell") return;
          const avatar = this.avatars.get(entry);
          if (!avatar) return;
          const wasActive = avatar.active && avatar.wobbleTween;
          if (wasActive) avatar._stopActiveTweens();
          const { x, y } = this.cellSlotPos(cellId, slotIndex + offset, totalSlots);
          avatar.helmet.setPosition(x, y);
          avatar.helmet.setScale(helmetDisplaySize / avatar.helmet.width);
          avatar.label.setPosition(x, y - helmetDisplaySize * 0.7);
          avatar.label.setFontSize(Math.round(helmetDisplaySize * 0.45));
          if (wasActive) avatar._startActiveTweens();
        });
      }
    }

    tweenCellLayout() {
      const helmetDisplaySize = this.helmetDisplaySize;

      this.items.tweenLayout(this.latestCellOccupants, CELL_POSITIONS);

      for (const [cellIdStr, occupants] of Object.entries(this.latestCellOccupants)) {
        const cellId = Number(cellIdStr);
        if (!CELL_POSITIONS[cellId]) continue;
        if (this.items.isFrozen(cellId)) continue;
        const offset = this.items.slotOffset(cellId);
        const totalSlots = occupants.length + offset;

        occupants.forEach((entry, slotIndex) => {
          if (entry === "banana" || entry === "green_shell" || entry === "red_shell") return;
          const avatar = this.avatars.get(entry);
          if (!avatar) return;
          const { x, y } = this.cellSlotPos(cellId, slotIndex + offset, totalSlots);
          if (avatar.helmet.x !== x || avatar.helmet.y !== y) {
            avatar.moveTo(x, y, 300);
            this.tweens.add({ targets: avatar.label, x, y: y - helmetDisplaySize * 0.7, duration: 300, ease: "Power2" });
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
          for (const [pid, avatar] of this.avatars) {
            avatar.setActive(pid === gameState.activePlayerId);
          }
          if (gameState.rivers) renderRivers(gameState.rivers, state.players.size);
          gameStateDirty = false;
          riversDirty = false;
        }
        if (isDebugModalOpen()) room.send("_debugGetState");
      });

      // Animation events stay as messages (not state)
      room.onMessage("itemHitBoard", (data) => this.animator.animateItemHit(data.playerId, data.cellId, data.type || "banana", data.starHit));
      room.onMessage("shellThrown", (data) => this.animator.enqueue({ _shellThrown: data }));
      room.onMessage("permanentCoinPickup", (data) => this.animator.enqueue({ _permanentCoinPickup: data }));
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

    updateCellOccupants(cellOccupants) {
      // Preserve occupants for frozen cells so slot positions stay stable mid-animation.
      // Store the real server data so we can apply it when the cell unfreezes.
      for (const cellId of this.items.frozenCellIds()) {
        if (cellOccupants[cellId] !== undefined) {
          this._pendingOccupants[cellId] = cellOccupants[cellId];
        } else {
          this._pendingOccupants[cellId] = null;
        }
        if (this.latestCellOccupants[cellId]) {
          cellOccupants[cellId] = this.latestCellOccupants[cellId];
        }
      }
      this.latestCellOccupants = cellOccupants;
      this.items.sync(cellOccupants);
      this.tweenCellLayout();
      this.items.repositionPermacoins(cellOccupants);
    }

    applyPendingOccupants(cellId) {
      if (!(cellId in this._pendingOccupants)) return;
      const pending = this._pendingOccupants[cellId];
      if (pending) {
        this.latestCellOccupants[cellId] = pending;
      } else {
        delete this.latestCellOccupants[cellId];
      }
      delete this._pendingOccupants[cellId];
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

      const cellW = this.cellW;
      const helmetSlot = this.helmetSlot;
      const helmetDisplaySize = this.helmetDisplaySize;

      for (const [cellId, cellPlayers] of byCell) {
        const occupants = this.latestCellOccupants[cellId] || [];
        const offset = this.items.slotOffset(cellId);
        const totalSlots = occupants.length + offset;

        cellPlayers.forEach((p) => {
          const slotIndex = occupants.indexOf(p.playerId);
          const slot = slotIndex !== -1
            ? this.cellSlotPos(cellId, slotIndex + offset, totalSlots)
            : this.cellPixelPos(cellId);
          const { x, y } = slot;
          const alpha = p.connected ? 1 : 0.5;

          if (this.avatars.has(p.playerId)) {
            const avatar = this.avatars.get(p.playerId);
            avatar.label.setText(p.name || "???");
            avatar.helmet.setAlpha(alpha);
            avatar.label.setAlpha(alpha);

            if (avatar.cellId !== p.cellId) {
              avatar.moveTo(x, y, 400);
              this.tweens.add({
                targets: avatar.label,
                x, y: y - helmetDisplaySize * 0.7,
                duration: 400,
                ease: "Power2",
              });
              avatar.cellId = p.cellId;
            } else if (avatar.helmet.x !== x || avatar.helmet.y !== y) {
              avatar.moveTo(x, y, 300);
              this.tweens.add({
                targets: avatar.label,
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
            const avatar = new PlayerAvatar(this, x, y, textureKey, p.name, helmetDisplaySize, alpha);
            avatar.cellId = p.cellId;
            this.avatars.set(p.playerId, avatar);
          }

          // Star overlay and active wobble — sync with current state
          const avatar = this.avatars.get(p.playerId);
          if (avatar) {
            avatar.setStarInvincible(p.starInvincible, helmetDisplaySize);
            avatar.setActive(latestGameState && p.playerId === latestGameState.activePlayerId);
          }
        });
      }

      for (const [playerId, avatar] of this.avatars) {
        if (!activePlayerIds.has(playerId)) {
          avatar.destroy();
          this.avatars.delete(playerId);
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

