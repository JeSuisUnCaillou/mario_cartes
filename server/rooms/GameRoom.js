import { Room } from "colyseus";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { MapSchema, ArraySchema } from "@colyseus/schema";
import { computeLiveRanks } from "./ranking.js";
import { getRiverPrice } from "./riverRules.js";
import { CellGrid } from "./CellGrid.js";
import { DeckManager } from "./DeckManager.js";
import {
  PlayerSchema,
  RankEntrySchema,
  RiverSlotSchema,
  RiverSchema,
  CellOccupantsSchema,
  GameState,
} from "./schema.js";

const DISPOSE_DELAY_MS = 10 * 60 * 1000; // 10 minutes
const PLAYER_COLORS = [
  "#e10000", "#0074D9", "#2ECC40", "#FF851B",
  "#B10DC9", "#FFDC00", "#FF69B4", "#00CED1",
];
const PATCH_DELAY_MS = 60; // Delay between async steps to guarantee separate schema patches (> patchRate 50ms)
const MOVE_DELAY_MS = 700; // Delay after a mushroom move to let the board helmet tween complete with a visible pause
const RIVER_SLOT_COUNT = 3;
const MAX_LAPS = 3;
const MAX_SLOW_COUNTERS = 2;
const START_CELL = 1;

class GameRoom extends Room {
  _buildPlayerList() {
    const list = [];
    for (const [pid, p] of this.players) {
      list.push({ playerId: pid, cellId: p.cellId, lapCount: p.lapCount });
    }
    return list;
  }

  _buildFinishedRanks() {
    return this.ranking.map((pid, i) => ({ playerId: pid, finalRank: i + 1 }));
  }

  _normalizeName(raw) {
    return (raw || "???").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3) || "???";
  }

  _resetGame() {
    this.phase = "lobby";
    this.ranking = [];
    this.currentRound = 0;
    this.turnIndex = -1;
    this.activePlayerId = null;
    this.rivers = this.decks.createRiverDecks();
    this.grid.reset();
    for (const player of this.players.values()) {
      Object.assign(player, this._initialPlayerState());
      this.grid.add(START_CELL, player.playerId);
    }
    this._syncState();
  }

  _resolveShell(thrower, throwerClient, targetCellId, shellType = "green_shell") {
    const occupants = this.grid.getOccupants(targetCellId);

    // Priority 1: hit a player (excluding thrower), randomly chosen
    const playerIds = occupants.filter((e) => e !== "banana" && e !== "green_shell" && e !== "red_shell" && e !== thrower.playerId && !this.players.get(e)?.starInvincible);
    if (playerIds.length > 0) {
      const hitPlayerId = playerIds[Math.floor(Math.random() * playerIds.length)];
      const hitPlayer = this.players.get(hitPlayerId);
      if (hitPlayer.slowCounters < MAX_SLOW_COUNTERS) hitPlayer.slowCounters++;
      this.broadcast("shellThrown", {
        playerId: thrower.playerId,
        fromCellId: thrower.cellId,
        toCellId: targetCellId,
        shellType,
        hit: "player",
        hitPlayerId,
      });
      this._syncState();
      return;
    }

    // Priority 2: hit a banana — both destroyed
    if (this.grid.countItem(targetCellId, "banana") > 0) {
      this.grid.remove(targetCellId, "banana");
      this.broadcast("shellThrown", {
        playerId: thrower.playerId,
        fromCellId: thrower.cellId,
        toCellId: targetCellId,
        shellType,
        hit: "banana",
      });
      this._syncState();
      return;
    }

    // Priority 3: hit another shell (green or red) — both destroyed
    const hitShellType = this.grid.shellType(targetCellId);
    if (hitShellType) {
      this.grid.remove(targetCellId, hitShellType);
      this.broadcast("shellThrown", {
        playerId: thrower.playerId,
        fromCellId: thrower.cellId,
        toCellId: targetCellId,
        shellType,
        hit: hitShellType,
      });
      this._syncState();
      return;
    }

    // Nothing to hit — shell stays on cell
    this.grid.add(targetCellId, shellType);
    this.broadcast("shellThrown", {
      playerId: thrower.playerId,
      fromCellId: thrower.cellId,
      toCellId: targetCellId,
      shellType,
      hit: null,
    });
    this._syncState();
  }

  _redShellPickBranch(cellId, thrower) {
    const nextCells = this.grid.nextCells(cellId);
    if (nextCells.length <= 1) return nextCells[0];

    // Check each branch for hittable players
    const hasPlayer = (startId) => {
      let id = startId;
      while (id) {
        const cell = this.grid.cells.get(id);
        const occupants = this.grid.getOccupants(id);
        const hittable = occupants.some(
          (e) => e !== "banana" && e !== "green_shell" && e !== "red_shell"
            && e !== thrower.playerId && !this.players.get(e)?.starInvincible,
        );
        if (hittable) return true;
        // Stop when the branch ends (no path_color or different path_color)
        const nextIds = this.grid.nextCells(id);
        const next = nextIds[0];
        if (!next || !this.grid.cells.get(next).path_color || this.grid.cells.get(next).path_color !== cell.path_color) break;
        id = next;
      }
      return false;
    };

    // Prefer first branch (shorter) unless only the other branch has players
    if (hasPlayer(nextCells[0])) return nextCells[0];
    if (hasPlayer(nextCells[1])) return nextCells[1];
    return nextCells[0]; // no players on either → default to shortest
  }

  _redShellPickBranchBackward(cellId, thrower) {
    const prevCells = this.grid.previousCells(cellId);
    if (prevCells.length <= 1) return prevCells[0];

    const hasPlayer = (startId) => {
      let id = startId;
      while (id) {
        const cell = this.grid.cells.get(id);
        const occupants = this.grid.getOccupants(id);
        const hittable = occupants.some(
          (e) => e !== "banana" && e !== "green_shell" && e !== "red_shell"
            && e !== thrower.playerId && !this.players.get(e)?.starInvincible,
        );
        if (hittable) return true;
        const prevIds = this.grid.previousCells(id);
        const prev = prevIds[0];
        if (!prev || !this.grid.cells.get(prev).path_color || this.grid.cells.get(prev).path_color !== cell.path_color) break;
        id = prev;
      }
      return false;
    };

    // Prefer first predecessor (shorter path) unless only the other has players
    if (hasPlayer(prevCells[0])) return prevCells[0];
    if (hasPlayer(prevCells[1])) return prevCells[1];
    return this.grid.previousCell(cellId); // no players on either → default to shortest
  }

  _redShellHasTarget(thrower, direction, startCellId) {
    let currentCellId = thrower.cellId;
    const totalCells = this.grid.cells.size;
    const isBackward = direction === "backward";

    for (let step = 0; step < totalCells; step++) {
      if (step === 0 && startCellId) {
        currentCellId = startCellId;
      } else if (step === 0 && (direction === "red" || direction === "blue")) {
        const candidates = this.grid.nextCells(currentCellId);
        currentCellId = candidates.find((id) => this.grid.cells.get(id).path_color === direction) || candidates[0];
      } else {
        if (isBackward) {
          const prevCells = this.grid.previousCells(currentCellId);
          currentCellId = prevCells.length > 1
            ? this._redShellPickBranchBackward(currentCellId, thrower)
            : this.grid.previousCell(currentCellId);
        } else {
          const nextCells = this.grid.nextCells(currentCellId);
          currentCellId = nextCells.length > 1
            ? this._redShellPickBranch(currentCellId, thrower)
            : this.grid.nextCell(currentCellId);
        }
      }

      const occupants = this.grid.getOccupants(currentCellId);
      const isLastStep = step === totalCells - 1;
      for (const e of occupants) {
        if (e === "banana" || e === "green_shell" || e === "red_shell") return true;
        if ((isLastStep || e !== thrower.playerId) && !this.players.get(e)?.starInvincible) return true;
      }
    }
    return false;
  }

  _resolveRedShell(thrower, throwerClient, direction, startCellId) {
    const path = [];
    let currentCellId = thrower.cellId;
    const totalCells = this.grid.cells.size;
    const isBackward = direction === "backward";

    for (let step = 0; step < totalCells; step++) {
      if (step === 0 && startCellId) {
        // Explicit start cell (e.g. backward into a specific branch at a merge)
        currentCellId = startCellId;
      } else if (step === 0 && (direction === "red" || direction === "blue")) {
        // First step at a fork: pick the branch matching the chosen color
        const candidates = this.grid.nextCells(currentCellId);
        currentCellId = candidates.find((id) => this.grid.cells.get(id).path_color === direction) || candidates[0];
      } else {
        if (isBackward) {
          const prevCells = this.grid.previousCells(currentCellId);
          currentCellId = prevCells.length > 1
            ? this._redShellPickBranchBackward(currentCellId, thrower)
            : this.grid.previousCell(currentCellId);
        } else {
          const nextCells = this.grid.nextCells(currentCellId);
          currentCellId = nextCells.length > 1
            ? this._redShellPickBranch(currentCellId, thrower)
            : this.grid.nextCell(currentCellId);
        }
      }
      path.push(currentCellId);

      const occupants = this.grid.getOccupants(currentCellId);
      const isLastStep = step === totalCells - 1;

      // Priority 1: hit a player (exclude thrower unless last step)
      const playerIds = occupants.filter(
        (e) => e !== "banana" && e !== "green_shell" && e !== "red_shell" && (isLastStep || e !== thrower.playerId) && !this.players.get(e)?.starInvincible,
      );
      if (playerIds.length > 0) {
        const hitPlayerId = playerIds[Math.floor(Math.random() * playerIds.length)];
        const hitPlayer = this.players.get(hitPlayerId);
        if (hitPlayer.slowCounters < MAX_SLOW_COUNTERS) hitPlayer.slowCounters++;
        this.broadcast("shellThrown", {
          playerId: thrower.playerId,
          fromCellId: thrower.cellId,
          toCellId: currentCellId,
          shellType: "red_shell",
          path,
          hit: "player",
          hitPlayerId,
        });
        this._syncState();
        return;
      }

      // Priority 2: hit a banana
      if (this.grid.countItem(currentCellId, "banana") > 0) {
        this.grid.remove(currentCellId, "banana");
        this.broadcast("shellThrown", {
          playerId: thrower.playerId,
          fromCellId: thrower.cellId,
          toCellId: currentCellId,
          shellType: "red_shell",
          path,
          hit: "banana",
        });
        this._syncState();
        return;
      }

      // Priority 3: hit a shell (green or red)
      const hitShellType = this.grid.shellType(currentCellId);
      if (hitShellType) {
        this.grid.remove(currentCellId, hitShellType);
        this.broadcast("shellThrown", {
          playerId: thrower.playerId,
          fromCellId: thrower.cellId,
          toCellId: currentCellId,
          shellType: "red_shell",
          path,
          hit: hitShellType,
        });
        this._syncState();
        return;
      }
    }
  }

  _bfsPath(fromCellId, toCellId) {
    const visited = new Map(); // cellId → parent cellId
    visited.set(fromCellId, null);
    const queue = [fromCellId];
    while (queue.length > 0) {
      const current = queue.shift();
      for (const nextId of this.grid.nextCells(current)) {
        if (visited.has(nextId)) continue;
        visited.set(nextId, current);
        if (nextId === toCellId) {
          // Reconstruct path (excluding start)
          const path = [];
          let node = toCellId;
          while (node !== fromCellId) {
            path.unshift(node);
            node = visited.get(node);
          }
          return path;
        }
        queue.push(nextId);
      }
    }
    // Fallback: should not happen on a connected track
    return [toCellId];
  }

  _resolveBlueShell(thrower) {
    // Find rank-1 unfinished player
    const finishedIds = new Set(this.ranking);
    const liveRanks = computeLiveRanks(this._buildPlayerList(), this._buildFinishedRanks(), this.grid.distToFinish, this.grid.maxDistance);

    // Find the best rank among unfinished players
    let bestRank = Infinity;
    for (const [pid, rank] of liveRanks) {
      if (finishedIds.has(pid)) continue;
      if (rank < bestRank) bestRank = rank;
    }
    if (bestRank === Infinity) return;

    // Collect all rank-1 candidates; prefer others over the thrower
    const candidates = [];
    for (const [pid, rank] of liveRanks) {
      if (finishedIds.has(pid) || rank !== bestRank) continue;
      candidates.push(pid);
    }
    const others = candidates.filter((pid) => pid !== thrower.playerId);
    const pool = others.length > 0 ? others : candidates;
    const targetId = pool[Math.floor(Math.random() * pool.length)];
    const target = this.players.get(targetId);

    // BFS forward from thrower to target (handles branching paths)
    const path = this._bfsPath(thrower.cellId, target.cellId);

    if (target.starInvincible) {
      // Star blocks the blue shell — animate but no effect
      this.broadcast("shellThrown", {
        playerId: thrower.playerId,
        fromCellId: thrower.cellId,
        toCellId: target.cellId,
        shellType: "blue_shell",
        path,
        hit: "star_blocked",
        hitPlayerId: target.playerId,
      });
      this._syncState();
      return;
    }

    // Auto-discard target's entire hand
    const discardedCardIds = target.hand.map((c) => c.id);
    while (target.hand.length > 0) {
      target.discardPile.push(target.hand.pop());
    }

    if (discardedCardIds.length > 0) {
      this._sendToPlayer(target.playerId, "blueShellHit", {
        discardedCardIds,
        ...this.decks.cardState(target),
      });
    }

    this.broadcast("shellThrown", {
      playerId: thrower.playerId,
      fromCellId: thrower.cellId,
      toCellId: target.cellId,
      shellType: "blue_shell",
      path,
      hit: "player",
      hitPlayerId: target.playerId,
    });
    this._syncState();
  }

  onCreate(options) {
    if (options._roomId) {
      this.roomId = options._roomId;
    }
    this.decks = new DeckManager({
      testDeck: options._testDeck || null,
      testRiverDecks: options._testRiverDecks || null,
    });
    this.autoDispose = false;
    this._disposeTimer = null;
    this.clientsInfo = new Map();
    this.players = new Map();
    this.phase = "lobby";
    this.currentRound = 0;
    this.turnIndex = -1;
    this.activePlayerId = null;

    this.setState(new GameState());
    // Separate clock ticking from patch sending so that clock.setTimeout
    // callbacks don't fire inside broadcastPatch() (which would batch
    // their state changes into the same patch as the previous _syncState).
    this.setSimulationInterval(() => {});
    this.state.phase = "lobby";
    this.state.currentRound = 0;
    this.state.activePlayerId = "";
    this.state.players = new MapSchema();
    this.state.ranking = new ArraySchema();
    this.state.rivers = new ArraySchema();
    this.state.cellOccupants = new MapSchema();

    const __dirname = path.dirname(fileURLToPath(import.meta.url));
    const trackFile = options._testTrack || "racetrack_1_cells.json";
    const trackJson = JSON.parse(fs.readFileSync(path.join(__dirname, "../../assets/" + trackFile), "utf8"));
    const cellsData = trackJson.cells || trackJson;
    this.grid = new CellGrid(cellsData);
    this.ranking = [];

    this.onMessage("_testSetState", (client, data) => {
      const info = this.clientsInfo.get(client.sessionId);
      if (!info) return;
      let player;
      if (info.type === "board") {
        if (!data.playerId) return;
        player = this.players.get(data.playerId);
      } else {
        if (!this.decks.isTestMode) return;
        player = this._getPlayer(client);
      }
      if (!player) return;
      this._applyPlayerState(player, data);
    });

    this.onMessage("_debugSetGameState", (client, data) => {
      const info = this.clientsInfo.get(client.sessionId);
      if (!info || info.type !== "board") return;
      if (data.phase !== undefined) this.phase = data.phase;
      if (data.activePlayerId !== undefined) {
        this.activePlayerId = data.activePlayerId;
        const playerIds = Array.from(this.players.keys());
        this.turnIndex = playerIds.indexOf(data.activePlayerId);
      }
      if (data.addBanana) {
        this.grid.add(data.addBanana.cellId, "banana");
      }
      if (data.removeBanana) {
        this.grid.remove(data.removeBanana.cellId, "banana");
      }
      if (data.addShell) {
        this.grid.add(data.addShell.cellId, "green_shell");
      }
      if (data.removeShell) {
        this.grid.remove(data.removeShell.cellId, "green_shell");
      }
      if (data.setRanking) {
        this.ranking = data.setRanking.filter((id) => this.players.has(id));
      }
      if (data.setRiverSlot && this.rivers) {
        const river = this.rivers.find((r) => r.id === data.setRiverSlot.riverId);
        if (river && data.setRiverSlot.slotIndex >= 0 && data.setRiverSlot.slotIndex < RIVER_SLOT_COUNT) {
          if (data.setRiverSlot.items) {
            river.slots[data.setRiverSlot.slotIndex] = {
              id: randomUUID(),
              items: data.setRiverSlot.items,
            };
          } else {
            river.slots[data.setRiverSlot.slotIndex] = null;
          }
        }
      }
      this._syncState();
    });

    this.onMessage("_debugRestart", (client) => {
      const info = this.clientsInfo.get(client.sessionId);
      if (!info || info.type !== "board") return;
      this._resetGame();
    });

    this.onMessage("_debugGetState", (client) => {
      const info = this.clientsInfo.get(client.sessionId);
      if (!info || info.type !== "board") return;
      client.send("_debugState", this._fullState());
    });

    this.onMessage("changeName", (client, newName) => {
      const player = this._getPlayer(client);
      if (!player) return;
      player.name = this._normalizeName(newName);
      this._syncState();
    });

    this.onMessage("setReady", (client, ready) => {
      const player = this._getPlayer(client);
      if (!player) return;
      if (this.phase !== "lobby") return;
      player.ready = !!ready;
      this._syncState();
    });

    this.onMessage("kickPlayer", (client, data) => {
      const info = this.clientsInfo.get(client.sessionId);
      if (!info || info.type !== "board") return;
      if (this.phase === "finished") return;
      const playerId = data && data.playerId;
      if (!playerId || !this.players.has(playerId)) return;
      this._kickPlayer(playerId);
    });

    this.onMessage("startGame", (client) => {
      const player = this._getPlayer(client);
      if (!player) return;
      if (this.phase !== "lobby") return;
      if (!player.ready) return;
      this._startGame();
    });

    this.onMessage("drawCards", (client) => {
      const player = this._getPlayer(client);
      if (!player) return;
      if (this.phase !== "playing") return;
      if (player.playerId !== this.activePlayerId) return;
      if (player.hand.length > 0) return;
      if (player.pendingDiscard > 0) return;
      if (player.pendingShellChoice) return;
      if (player.pendingPathChoice) return;
      client.send("cardsDrawn", this.decks.drawCards(player));
      this._syncState();
    });

    this.onMessage("playCard", (client, data) => {
      const player = this._getPlayer(client);
      if (!player) return;
      if (this.phase !== "playing") return;
      if (player.playerId !== this.activePlayerId) return;
      if (player.pendingDiscard > 0) return;
      if (player.pendingShellChoice) return;
      if (player.pendingPathChoice) return;
      if (player.pendingItems.length > 0) return;
      const cardIndex = player.hand.findIndex((c) => c.id === data.cardId);
      if (cardIndex === -1) return;
      const [card] = player.hand.splice(cardIndex, 1);
      if (player.hand.length === 0) player.hasPlayedAllCards = true;

      player.discardPile.push(card);
      player.pendingItems = [...card.items];
      this._sendToPlayer(player.playerId, "cardPlayed", { cardId: card.id, ...this.decks.cardState(player) });
      this._processNextItem(player);
    });

    this.onMessage("discardCard", (client, data) => {
      const player = this._getPlayer(client);
      if (!player) return;
      if (this.phase !== "playing") return;
      if (player.pendingDiscard <= 0) return;
      const cardIndex = player.hand.findIndex((c) => c.id === data.cardId);
      if (cardIndex === -1) return;
      const [card] = player.hand.splice(cardIndex, 1);
      player.discardPile.push(card);
      player.pendingDiscard--;
      client.send("cardDiscarded", {
        cardId: card.id,
        remaining: player.pendingDiscard,
        ...this.decks.cardState(player),
      });
      this._syncState();

      if (player.pendingDiscard === 0 && player.pendingItems.length > 0) {
        this._processNextItem(player);
      }
    });

    this.onMessage("shellChoice", (client, data) => {
      const player = this._getPlayer(client);
      if (!player) return;
      if (!player.pendingShellChoice) return;
      const validDirs = ["forward", "backward", "red", "blue"];
      if (!validDirs.includes(data.direction)) return;

      player.pendingShellChoice = false;
      const shellType = player.pendingShellType;
      player.pendingShellType = null;
      if (!shellType) return;

      let targetCellId;
      if (data.direction === "red" || data.direction === "blue") {
        // Fork or merge: find the cell matching the chosen path color
        const isForward = this.grid.nextCells(player.cellId).length > 1;
        if (isForward) {
          targetCellId = this.grid.nextCells(player.cellId)
            .find((id) => this.grid.cells.get(id).path_color === data.direction);
        } else {
          targetCellId = this.grid.previousCells(player.cellId)
            .find((id) => this.grid.cells.get(id).path_color === data.direction);
        }
      } else if (data.direction === "forward") {
        targetCellId = this.grid.nextCell(player.cellId);
      } else {
        targetCellId = this.grid.previousCell(player.cellId);
      }
      if (!targetCellId) return;

      if (shellType === "red_shell") {
        if (data.direction === "red" || data.direction === "blue") {
          const isForward = this.grid.nextCells(player.cellId).length > 1;
          this._resolveRedShell(player, client, isForward ? data.direction : "backward", isForward ? null : targetCellId);
        } else {
          this._resolveRedShell(player, client, data.direction);
        }
      } else {
        this._resolveShell(player, client, targetCellId, shellType);
      }

      if (player.pendingItems.length > 0) {
        this._processNextItem(player);
      }
    });

    this.onMessage("pathChoice", (client, data) => {
      const player = this._getPlayer(client);
      if (!player) return;
      if (!player.pendingPathChoice) return;
      if (data.color !== "red" && data.color !== "blue") return;

      player.pendingPathChoice = false;
      const nextCells = this.grid.nextCells(player.cellId);
      const targetCellId = nextCells.find(
        (id) => this.grid.cells.get(id).path_color === data.color,
      );
      if (!targetCellId) return;

      this._executeMushroomMove(player, targetCellId);
    });

    this.onMessage("endTurn", (client) => {
      const player = this._getPlayer(client);
      if (!player) return;
      if (this.phase !== "playing") return;
      if (player.playerId !== this.activePlayerId) return;
      if (player.pendingDiscard > 0) return;
      if (player.pendingShellChoice) return;
      if (player.pendingPathChoice) return;
      if (player.pendingItems.length > 0) return;
      this._endTurnAndAdvance(player);
    });

    this.onMessage("buyCard", (client, data) => {
      const player = this._getPlayer(client);
      if (!player) return;
      if (this.phase !== "playing") return;
      if (player.playerId !== this.activePlayerId) return;
      if (player.pendingDiscard > 0) return;
      if (player.pendingShellChoice) return;
      if (player.pendingPathChoice) return;
      if (player.pendingItems.length > 0) return;
      const river = this.rivers.find((r) => r.id === data.riverId);
      if (!river) return;
      const slotIndex = river.slots.findIndex((c) => c && c.id === data.cardId);
      if (slotIndex === -1) return;
      const rank = this._getLiveRank(player.playerId);
      const price = getRiverPrice(river.cost, rank, this.players.size);
      if (player.coins < price) return;
      const regularCoins = player.coins - player.permanentCoins;
      const fromPermanent = Math.max(0, price - regularCoins);
      player.coins -= price;
      player.permanentCoins -= fromPermanent;
      const card = river.slots[slotIndex];
      player.discardPile.push(card);
      river.slots[slotIndex] = null;
      client.send("cardBought", { cardId: card.id, riverId: river.id, slotIndex, ...this.decks.cardState(player) });
      this._syncState();
      if (river.deck.length > 0) {
        this.clock.setTimeout(() => {
          river.slots[slotIndex] = river.deck.shift();
          this._syncState();
        }, 400);
      }
    });

    this.onMessage("destroyRoom", (client) => {
      const info = this.clientsInfo.get(client.sessionId);
      if (!info || info.type !== "board") return;
      this.broadcast("roomDestroyed");
      this.clock.setTimeout(() => this.disconnect(), 100);
    });

    this.onMessage("startOver", () => {
      if (this.phase !== "finished") return;
      this._resetGame();
    });
  }

  _applyPlayerState(player, data) {
    if (data.cellId !== undefined) {
      this.grid.remove(player.cellId, player.playerId);
      player.cellId = data.cellId;
      this.grid.add(player.cellId, player.playerId);
    }
    if (data.lapCount !== undefined) player.lapCount = data.lapCount;
    if (data.coins !== undefined) player.coins = data.coins;
    if (data.permanentCoins !== undefined) player.permanentCoins = data.permanentCoins;
    if (data.pendingDiscard !== undefined) player.pendingDiscard = data.pendingDiscard;
    if (data.pendingShellChoice !== undefined) player.pendingShellChoice = data.pendingShellChoice;
    if (data.pendingPathChoice !== undefined) player.pendingPathChoice = data.pendingPathChoice;
    if (data.slowCounters !== undefined) player.slowCounters = data.slowCounters;
    if (data.starInvincible !== undefined) player.starInvincible = data.starInvincible;
    if (data.setHandCard) {
      const { index, items } = data.setHandCard;
      if (index >= 0 && index < player.hand.length) {
        if (items) {
          player.hand[index] = { id: randomUUID(), items };
        } else {
          player.hand.splice(index, 1);
        }
      }
    }
    if (data.addHandCard) {
      player.hand.push({ id: randomUUID(), items: data.addHandCard.items });
    }
    if (data.setHandCard || data.addHandCard) {
      this._sendToPlayer(player.playerId, "cardsDrawn", this.decks.cardState(player));
    }
    this._syncState();
  }

  _fullState() {
    const liveRanks = this.phase === "playing"
      ? computeLiveRanks(this._buildPlayerList(), this._buildFinishedRanks(), this.grid.distToFinish, this.grid.maxDistance)
      : new Map();
    const players = Array.from(this.players.values()).map((p) => ({
      playerId: p.playerId,
      name: p.name,
      cellId: p.cellId,
      connected: p.connected,
      ready: p.ready,
      coins: p.coins,
      permanentCoins: p.permanentCoins,
      lapCount: p.lapCount,
      rank: liveRanks.get(p.playerId) || 0,
      pendingDiscard: p.pendingDiscard,
      pendingShellChoice: p.pendingShellChoice,
      pendingPathChoice: p.pendingPathChoice,
      handCount: p.hand.length,
      drawCount: p.drawPile.length,
      discardCount: p.discardPile.length,
      hand: p.hand,
      drawPile: p.drawPile,
      drawPileDisplay: p.drawPileDisplay,
      discardPile: p.discardPile,
    }));
    const state = {
      phase: this.phase,
      currentRound: this.currentRound,
      activePlayerId: this.activePlayerId,
      cellOccupants: this.grid.occupants,
      players,
    };
    if (this.rivers) {
      state.rivers = this.rivers.map((r) => ({
        id: r.id,
        cost: r.cost,
        slots: r.slots,
        deckCount: r.deck.length,
      }));
    }
    if (this.ranking.length > 0) {
      state.ranking = this.ranking.map((playerId, i) => ({
        playerId,
        name: this.players.get(playerId).name,
        finalRank: i + 1,
      }));
    }
    return state;
  }

  _initialPlayerState() {
    const { drawPile, drawPileDisplay } = this.decks.initialPlayerDeck();
    return {
      cellId: START_CELL, drawPile, drawPileDisplay, hand: [], discardPile: [],
      pendingDiscard: 0, pendingShellChoice: false, pendingPathChoice: false, pendingItems: [], shellChoiceOptions: null, disabledShellOptions: [], ready: false, hasPlayedAllCards: false, coins: 0, permanentCoins: 0, lapCount: 0, slowCounters: 0, starInvincible: false,
    };
  }

  _getPlayer(client) {
    const info = this.clientsInfo.get(client.sessionId);
    if (!info || info.type !== "player") return null;
    return this.players.get(info.playerId);
  }

  onJoin(client, options) {
    if (this._disposeTimer) {
      clearTimeout(this._disposeTimer);
      this._disposeTimer = null;
    }

    const type = options.type || "player";

    if (type === "player") {
      const existingPlayerId = options.playerId;
      if (existingPlayerId && this.players.has(existingPlayerId)) {
        const player = this.players.get(existingPlayerId);
        player.connected = true;
        // Remove stale clientsInfo entries for this playerId (e.g. from a previous dropped connection)
        for (const [sid, info] of this.clientsInfo) {
          if (info.playerId === existingPlayerId && sid !== client.sessionId) {
            this.clientsInfo.delete(sid);
          }
        }
        this.clientsInfo.set(client.sessionId, { type: "player", playerId: existingPlayerId });
        client.send("cardsDrawn", this.decks.cardState(player));
      } else if (this.phase === "lobby") {
        const playerId = randomUUID();
        const name = this._normalizeName(options.name);
        const usedColors = new Set([...this.players.values()].map(p => p.color));
        const color = PLAYER_COLORS.find(c => !usedColors.has(c));
        this.players.set(playerId, {
          playerId, name, color, connected: true,
          ...this._initialPlayerState(),
        });
        this.grid.add(START_CELL, playerId);
        this.clientsInfo.set(client.sessionId, { type: "player", playerId });
        client.send("playerId", playerId);
      } else {
        client.send("gameAlreadyStarted");
      }
    } else {
      this.clientsInfo.set(client.sessionId, { type });
    }

    this._syncState();
  }

  onDrop(client) {
    const info = this.clientsInfo.get(client.sessionId);
    if (info && info.type === "player" && info.playerId) {
      const player = this.players.get(info.playerId);
      if (player) player.connected = false;
      this._syncState();
    }
    this.allowReconnection(client, 120);
  }

  onReconnect(client) {
    const info = this.clientsInfo.get(client.sessionId);
    if (info && info.type === "player" && info.playerId) {
      const player = this.players.get(info.playerId);
      if (player) player.connected = true;
      this._syncState();
    }
  }

  onLeave(client) {
    const info = this.clientsInfo.get(client.sessionId);
    if (info && info.type === "player" && info.playerId) {
      const player = this.players.get(info.playerId);
      if (player) player.connected = false;
      this._syncState();
    }
    if (info) this.clientsInfo.delete(client.sessionId);
    if (this.clients.length === 0) {
      this._disposeTimer = setTimeout(() => this.disconnect(), DISPOSE_DELAY_MS);
    }
  }


  _getLiveRank(playerId) {
    const liveRanks = computeLiveRanks(this._buildPlayerList(), this._buildFinishedRanks(), this.grid.distToFinish, this.grid.maxDistance);
    return liveRanks.get(playerId) || 0;
  }

  _syncState() {
    // Sync fields then send patch immediately (don't wait for patchRate interval)
    this._syncSchemaFields();
    this.broadcastPatch();
  }

  _syncSchemaFields() {
    // Sync top-level fields
    this.state.phase = this.phase;
    this.state.currentRound = this.currentRound;
    this.state.activePlayerId = this.activePlayerId || "";

    // Compute live ranks
    let liveRanks = new Map();
    if (this.phase === "playing") {
      liveRanks = computeLiveRanks(this._buildPlayerList(), this._buildFinishedRanks(), this.grid.distToFinish, this.grid.maxDistance);
    }

    // Sync players
    const activePlayerIds = new Set();
    for (const [playerId, p] of this.players) {
      activePlayerIds.add(playerId);
      let sp = this.state.players.get(playerId);
      if (!sp) {
        sp = new PlayerSchema();
        this.state.players.set(playerId, sp);
      }
      sp.name = p.name;
      sp.color = p.color;
      sp.cellId = p.cellId;
      sp.connected = p.connected;
      sp.handCount = p.hand.length;
      sp.ready = p.ready;
      sp.coins = p.coins;
      sp.permanentCoins = p.permanentCoins;
      sp.lapCount = p.lapCount;
      sp.slowCounters = p.slowCounters;
      sp.pendingShellChoice = p.pendingShellChoice;
      sp.pendingPathChoice = p.pendingPathChoice;
      sp.starInvincible = p.starInvincible || false;
      sp.finished = this.ranking.includes(playerId);
      sp.rank = liveRanks.get(playerId) || 0;
    }
    for (const key of this.state.players.keys()) {
      if (!activePlayerIds.has(key)) this.state.players.delete(key);
    }

    // Sync ranking
    while (this.state.ranking.length > 0) this.state.ranking.pop();
    for (let i = 0; i < this.ranking.length; i++) {
      const playerId = this.ranking[i];
      const entry = new RankEntrySchema();
      entry.playerId = playerId;
      entry.name = this.players.get(playerId).name;
      entry.finalRank = i + 1;
      this.state.ranking.push(entry);
    }

    // Sync rivers
    while (this.state.rivers.length > 0) this.state.rivers.pop();
    if (this.rivers) {
      for (const r of this.rivers) {
        const rs = new RiverSchema();
        rs.id = r.id;
        rs.cost = r.cost;
        rs.deckCount = r.deck.length;
        rs.slots = new ArraySchema();
        for (const slot of r.slots) {
          const ss = new RiverSlotSchema();
          if (slot) {
            ss.id = slot.id;
            ss.items = JSON.stringify(slot.items);
          } else {
            ss.id = "";
            ss.items = "";
          }
          rs.slots.push(ss);
        }
        this.state.rivers.push(rs);
      }
    }

    // Sync cellOccupants
    const activeCellIds = new Set();
    for (const cellId of Object.keys(this.grid.occupants)) {
      activeCellIds.add(String(cellId));
      let co = this.state.cellOccupants.get(String(cellId));
      if (!co) {
        co = new CellOccupantsSchema();
        co.entries = new ArraySchema();
        this.state.cellOccupants.set(String(cellId), co);
      }
      while (co.entries.length > 0) co.entries.pop();
      for (const entry of this.grid.occupants[cellId]) {
        co.entries.push(entry);
      }
    }
    for (const key of this.state.cellOccupants.keys()) {
      if (!activeCellIds.has(key)) this.state.cellOccupants.delete(key);
    }
  }

  _kickPlayer(playerId) {
    const player = this.players.get(playerId);
    const wasActive = this.phase === "playing" && this.activePlayerId === playerId;

    this._sendToPlayer(playerId, "kicked");
    this.grid.remove(player.cellId, playerId);
    this.players.delete(playerId);
    // Remove from ranking if present
    const rankIdx = this.ranking.indexOf(playerId);
    if (rankIdx !== -1) this.ranking.splice(rankIdx, 1);

    // Remove clientsInfo entry and leave the client
    for (const [sessionId, info] of this.clientsInfo) {
      if (info.playerId === playerId) {
        this.clientsInfo.delete(sessionId);
        const client = this.clients.find((c) => c.sessionId === sessionId);
        if (client) client.leave();
        break;
      }
    }

    this._syncState();

    if (this.phase === "playing") {
      if (this.players.size === 0) {
        this._endGame();
        return;
      }
      // Fix turnIndex after removal
      const playerIds = Array.from(this.players.keys());
      if (wasActive) {
        this.turnIndex = this.turnIndex % playerIds.length;
        this.activePlayerId = playerIds[this.turnIndex];
        this.players.get(this.activePlayerId).hasPlayedAllCards = false;
        this._syncState();
        if (this._checkRaceOver()) return;
      } else {
        // Recalculate turnIndex to keep activePlayerId correct
        this.turnIndex = playerIds.indexOf(this.activePlayerId);
        if (this._checkRaceOver()) return;
      }
    }
  }

  _sendToPlayer(playerId, type, data) {
    for (const [sessionId, info] of this.clientsInfo) {
      if (info.playerId === playerId) {
        const client = this.clients.find((c) => c.sessionId === sessionId);
        if (client) client.send(type, data);
        return;
      }
    }
  }

  _processNextItem(player) {
    if (player.pendingItems.length === 0) {
      this._syncState();
      return;
    }

    const item = player.pendingItems.shift();

    if (item === "mushroom") {
      this._resolveMushroomStep(player);
      // _resolveMushroomStep handles continuation itself (may be async on hit)
      return;
    } else if (item === "banana") {
      this._resolveBananaStep(player);
    } else if (item === "coin") {
      this._resolveCoinStep(player);
    } else if (item === "star") {
      player.starInvincible = true;
      player.slowCounters = 0;
    } else if (item === "blue_shell") {
      this._resolveBlueShell(player);
    } else if (item === "green_shell" || item === "red_shell") {
      player.pendingShellChoice = true;
      player.pendingShellType = item;
      const nextCells = this.grid.nextCells(player.cellId);
      const prevCells = this.grid.previousCells(player.cellId);
      if (nextCells.length > 1) {
        player.shellChoiceOptions = [...nextCells.map((id) => this.grid.cells.get(id).path_color), "backward"];
      } else if (prevCells.length > 1) {
        player.shellChoiceOptions = ["forward", ...prevCells.map((id) => this.grid.cells.get(id).path_color)];
      } else {
        player.shellChoiceOptions = ["forward", "backward"];
      }
      // For red shells, check which directions have targets
      player.disabledShellOptions = [];
      if (item === "red_shell") {
        for (const option of player.shellChoiceOptions) {
          let hasTarget;
          if (option === "forward") {
            hasTarget = this._redShellHasTarget(player, "forward");
          } else if (option === "backward") {
            hasTarget = this._redShellHasTarget(player, "backward");
          } else {
            // "red" or "blue" — determine if forward (fork) or backward (merge)
            const isForward = nextCells.length > 1;
            if (isForward) {
              hasTarget = this._redShellHasTarget(player, option);
            } else {
              const targetCellId = prevCells.find((id) => this.grid.cells.get(id).path_color === option);
              hasTarget = this._redShellHasTarget(player, "backward", targetCellId);
            }
          }
          if (!hasTarget) player.disabledShellOptions.push(option);
        }
      }
      this._sendToPlayer(player.playerId, "cardPlayed", {
        ...this.decks.cardState(player),
        pendingShellChoice: true,
        pendingShellType: item,
        shellChoiceOptions: player.shellChoiceOptions,
        disabledShellOptions: player.disabledShellOptions,
      });
      this._syncState();
      return;
    }

    this.clock.setTimeout(() => this._processNextItem(player), PATCH_DELAY_MS);
  }

  _resolveMushroomStep(player) {
    if (player.slowCounters > 0) {
      player.slowCounters--;
      this._syncState();
      this.clock.setTimeout(() => this._processNextItem(player), MOVE_DELAY_MS);
      return;
    }

    if (player.lapCount === 0) player.lapCount = 1;

    // Check for fork (multiple next cells)
    const nextCells = this.grid.nextCells(player.cellId);
    if (nextCells.length > 1) {
      player.pendingPathChoice = true;
      this._sendToPlayer(player.playerId, "cardPlayed", {
        ...this.decks.cardState(player),
        pendingPathChoice: true,
        pathOptions: nextCells.map((id) => this.grid.cells.get(id).path_color),
      });
      this._syncState();
      return;
    }

    this._executeMushroomMove(player, nextCells[0]);
  }

  _executeMushroomMove(player, targetCellId) {
    const oldCellId = player.cellId;
    player.cellId = targetCellId;
    this.grid.remove(oldCellId, player.playerId);
    this.grid.add(player.cellId, player.playerId);

    const cellData = this.grid.cells.get(player.cellId);
    if (cellData.permanent_coin) {
      player.permanentCoins += cellData.permanent_coin;
      player.coins += cellData.permanent_coin;
      this.broadcast("permanentCoinPickup", {
        playerId: player.playerId,
        cellId: player.cellId,
      });
    }

    // Detect hazard and place player at the item's slot BEFORE the first sync,
    // so the client moves the player directly to the item's position.
    let hitType = null;
    if (player.starInvincible) {
      const occupants = this.grid.getOccupants(player.cellId);
      const otherPlayers = occupants.filter(
        (e) => e !== player.playerId && e !== "banana" && e !== "green_shell" && e !== "red_shell",
      );
      if (otherPlayers.length > 0) {
        hitType = "star_player";
      } else {
        const starItem = this.grid.hazard(player.cellId);
        if (starItem) {
          hitType = "star_" + starItem;
          this.grid.remove(player.cellId, player.playerId);
          this.grid.replace(player.cellId, starItem, player.playerId);
        }
      }
    } else {
      hitType = this.grid.hazard(player.cellId);
      if (hitType) {
        this.grid.remove(player.cellId, player.playerId);
        this.grid.replace(player.cellId, hitType, player.playerId);
      }
    }

    // Broadcast itemHitBoard BEFORE _syncState so the client freezes the cell
    // before the patch arrives. This prevents _syncSprites from destroying the
    // wrong sprite or rearranging items.
    if (player.starInvincible) {
      if (hitType === "star_player") {
        const occupants = this.grid.getOccupants(player.cellId);
        const otherPlayers = occupants.filter(
          (e) => e !== player.playerId && e !== "banana" && e !== "green_shell" && e !== "red_shell",
        );
        const hitPlayerId = otherPlayers[Math.floor(Math.random() * otherPlayers.length)];
        const hitPlayer = this.players.get(hitPlayerId);
        if (hitPlayer.slowCounters < MAX_SLOW_COUNTERS) hitPlayer.slowCounters++;
        this.broadcast("itemHitBoard", {
          type: "star",
          playerId: hitPlayerId,
          cellId: player.cellId,
        });
      } else if (hitType) {
        const itemType = hitType.slice("star_".length);
        this.broadcast("itemHitBoard", {
          type: itemType,
          playerId: player.playerId,
          cellId: player.cellId,
          starHit: true,
        });
      }
    } else if (hitType) {
      this.broadcast("itemHitBoard", {
        type: hitType,
        playerId: player.playerId,
        cellId: player.cellId,
      });
    }

    this._syncState();

    if (cellData.finish_line) {
      player.lapCount++;
      if (player.lapCount > MAX_LAPS) {
        this.ranking.push(player.playerId);
        player.pendingItems = [];
        this._endTurnForFinishedPlayer(player);
        if (this._checkRaceOver()) return;
        return;
      }
    }

    if (player.starInvincible) {
      this._syncState();
      this.clock.setTimeout(() => this._processNextItem(player), MOVE_DELAY_MS);
    } else if (hitType) {
      if (hitType === "banana") {
        const mustDiscard = Math.min(1, player.hand.length);
        if (mustDiscard > 0) {
          player.pendingDiscard = mustDiscard;
          this._sendToPlayer(player.playerId, "discardHit", {
            source: hitType,
            mustDiscard,
            ...this.decks.cardState(player),
          });
        }
        this._syncState();
        if (player.pendingDiscard === 0) {
          this.clock.setTimeout(() => this._processNextItem(player), MOVE_DELAY_MS);
        }
      } else {
        if (player.slowCounters < MAX_SLOW_COUNTERS) player.slowCounters++;
        this._syncState();
        this.clock.setTimeout(() => this._processNextItem(player), MOVE_DELAY_MS);
      }
    } else {
      // No hit — continue to next item after tween completes
      this.clock.setTimeout(() => this._processNextItem(player), MOVE_DELAY_MS);
    }
  }

  _resolveBananaStep(player) {
    const occupants = this.grid.getOccupants(player.cellId);
    const playerIdx = occupants.indexOf(player.playerId);
    if (playerIdx !== -1) {
      occupants.splice(playerIdx, 0, "banana");
    } else {
      occupants.push("banana");
    }
    this._syncState();
  }

  _resolveCoinStep(player) {
    player.coins += 1;
    this._syncState();
  }

  _startGame() {
    this.phase = "playing";
    this.currentRound = 1;
    this.turnIndex = 0;
    this.activePlayerId = Array.from(this.players.keys())[0];
    this.rivers = this.decks.createRiverDecks();

    // Deal initial hand to all players
    for (const [playerId, player] of this.players) {
      const drawResult = this.decks.drawCards(player);
      this._sendToPlayer(playerId, "cardsDrawn", drawResult);
    }

    this._syncState();
  }

  _resetPlayerTurn(player) {
    player.coins = player.permanentCoins;
    player.slowCounters = 0;
    player.pendingItems = [];
    if (player.hand.length > 0) {
      player.discardPile.push(...player.hand.splice(0));
    }
    player.hasPlayedAllCards = false;
  }

  _endTurnAndAdvance(player) {
    this._resetPlayerTurn(player);
    const drawResult = this.decks.drawCards(player);
    this._sendToPlayer(player.playerId, "cardsDrawn", drawResult);
    this._syncState();
    this._advanceTurn();
  }

  _advanceTurn() {
    const playerIds = Array.from(this.players.keys());
    let attempts = 0;
    do {
      this.turnIndex++;
      if (this.turnIndex >= playerIds.length) {
        this.turnIndex = 0;
        this.currentRound++;
      }
      this.activePlayerId = playerIds[this.turnIndex];
      attempts++;
    } while (
      this.ranking.includes(this.activePlayerId)
      && attempts < playerIds.length
    );

    if (attempts >= playerIds.length) return;

    const activePlayer = this.players.get(this.activePlayerId);
    activePlayer.hasPlayedAllCards = false;
    activePlayer.starInvincible = false;
    this._syncState();
  }

  _endTurnForFinishedPlayer(player) {
    this._resetPlayerTurn(player);
    player.starInvincible = false;
    this._syncState();
    this._advanceTurn();
  }

  _checkRaceOver() {
    const unfinished = Array.from(this.players.keys()).filter((id) => !this.ranking.includes(id));
    if (unfinished.length <= 1) {
      for (const id of unfinished) {
        this.ranking.push(id);
      }
      this._endGame();
      return true;
    }
    return false;
  }

  _endGame() {
    this.phase = "finished";
    this._syncState();
  }
}

export { GameRoom };
