import { Room } from "colyseus";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { MapSchema, ArraySchema } from "@colyseus/schema";
import { STARTING_DECK, RIVER_DEFS } from "./decks.js";
import { computeLiveRanks } from "./ranking.js";
import { canBuyFromRiver } from "./riverRules.js";
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

class GameRoom extends Room {
  _createDeck() {
    if (this._testDeck) {
      return this._testDeck.map((items) => ({ id: randomUUID(), items }));
    }
    const cards = STARTING_DECK.map((items) => ({ id: randomUUID(), items: [...items] }));
    return this._shuffle(cards);
  }

  _createRiverDecks() {
    if (this._testRiverDecks) {
      return this._testRiverDecks.map((river, i) => {
        const cards = river.map((items) => ({ id: randomUUID(), items }));
        return {
          id: i,
          cost: RIVER_DEFS[i].cost,
          deck: cards.slice(3),
          slots: cards.slice(0, 3),
        };
      });
    }
    return RIVER_DEFS.map((river, i) => {
      const cards = this._shuffle(river.cards.map((items) => ({ id: randomUUID(), items: [...items] })));
      return {
        id: i,
        cost: river.cost,
        deck: cards.slice(3),
        slots: cards.slice(0, 3),
      };
    });
  }


  _shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  _cardState(player) {
    const dp = player.discardPile;
    return {
      hand: player.hand,
      drawPileDisplay: player.drawPileDisplay,
      discardPile: player.discardPile,
      drawCount: player.drawPile.length,
      discardCount: dp.length,
      discardTopCard: dp.length > 0 ? dp[dp.length - 1] : null,
      pendingDiscard: player.pendingDiscard,
      pendingShellChoice: player.pendingShellChoice,
      pendingShellType: player.pendingShellType,
      coins: player.coins,
      permanentCoins: player.permanentCoins,
      slowCounters: player.slowCounters,
      deck: [...player.hand, ...player.drawPile, ...player.discardPile],
    };
  }

  _drawCards(player) {
    let shuffledCount = 0;
    let needed = 5;
    const drawn = player.drawPile.splice(0, needed);
    const drawnBeforeShuffle = drawn.length;
    const drawnIds = new Set(drawn.map(c => c.id));
    player.drawPileDisplay = player.drawPileDisplay.filter(c => !drawnIds.has(c.id));
    needed -= drawn.length;
    if (needed > 0 && player.discardPile.length > 0) {
      shuffledCount = player.discardPile.length;
      player.drawPile.push(...this._shuffle(player.discardPile.splice(0)));
      player.drawPileDisplay = this._shuffle([...player.drawPile]);
      drawn.push(...player.drawPile.splice(0, needed));
      const newDrawnIds = new Set(drawn.slice(drawnBeforeShuffle).map(c => c.id));
      player.drawPileDisplay = player.drawPileDisplay.filter(c => !newDrawnIds.has(c.id));
    }
    player.hand.push(...drawn);
    return { ...this._cardState(player), shuffledCount, drawnBeforeShuffle };
  }

  _cellOccupants(cellId) {
    if (!this.cellOccupants[cellId]) this.cellOccupants[cellId] = [];
    return this.cellOccupants[cellId];
  }

  _addToCell(cellId, entry) {
    this._cellOccupants(cellId).push(entry);
  }

  _removeFromCell(cellId, entry) {
    const arr = this._cellOccupants(cellId);
    const idx = arr.indexOf(entry);
    if (idx !== -1) arr.splice(idx, 1);
    if (arr.length === 0) delete this.cellOccupants[cellId];
  }

  _countItemOnCell(cellId, type) {
    return this._cellOccupants(cellId).filter((e) => e === type).length;
  }

  _countShellsOnCell(cellId) {
    return this._countItemOnCell(cellId, "green_shell") + this._countItemOnCell(cellId, "red_shell");
  }

  _previousCell(cellId) {
    return this.prevCell[cellId];
  }

  _resolveShell(thrower, throwerClient, targetCellId, shellType = "green_shell") {
    const occupants = this._cellOccupants(targetCellId);

    // Priority 1: hit a player (excluding thrower), randomly chosen
    const playerIds = occupants.filter((e) => e !== "banana" && e !== "green_shell" && e !== "red_shell" && e !== thrower.playerId && !this.players.get(e)?.starInvincible);
    if (playerIds.length > 0) {
      const hitPlayerId = playerIds[Math.floor(Math.random() * playerIds.length)];
      const hitPlayer = this.players.get(hitPlayerId);
      hitPlayer.slowCounters++;
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
    if (this._countItemOnCell(targetCellId, "banana") > 0) {
      this._removeFromCell(targetCellId, "banana");
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
    const hitShellType = this._countItemOnCell(targetCellId, "green_shell") > 0 ? "green_shell"
      : this._countItemOnCell(targetCellId, "red_shell") > 0 ? "red_shell"
        : null;
    if (hitShellType) {
      this._removeFromCell(targetCellId, hitShellType);
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
    this._addToCell(targetCellId, shellType);
    this.broadcast("shellThrown", {
      playerId: thrower.playerId,
      fromCellId: thrower.cellId,
      toCellId: targetCellId,
      shellType,
      hit: null,
    });
    this._syncState();
  }

  _resolveRedShell(thrower, throwerClient, direction) {
    const path = [];
    let currentCellId = thrower.cellId;
    const totalCells = this.cells.size;

    for (let step = 0; step < totalCells; step++) {
      currentCellId = direction === "forward"
        ? this.cells.get(currentCellId).next_cell
        : this._previousCell(currentCellId);
      path.push(currentCellId);

      const occupants = this._cellOccupants(currentCellId);
      const isLastStep = step === totalCells - 1;

      // Priority 1: hit a player (exclude thrower unless last step)
      const playerIds = occupants.filter(
        (e) => e !== "banana" && e !== "green_shell" && e !== "red_shell" && (isLastStep || e !== thrower.playerId) && !this.players.get(e)?.starInvincible,
      );
      if (playerIds.length > 0) {
        const hitPlayerId = playerIds[Math.floor(Math.random() * playerIds.length)];
        const hitPlayer = this.players.get(hitPlayerId);
        hitPlayer.slowCounters++;
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
      if (this._countItemOnCell(currentCellId, "banana") > 0) {
        this._removeFromCell(currentCellId, "banana");
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
      const hitShellType = this._countItemOnCell(currentCellId, "green_shell") > 0 ? "green_shell"
        : this._countItemOnCell(currentCellId, "red_shell") > 0 ? "red_shell"
          : null;
      if (hitShellType) {
        this._removeFromCell(currentCellId, hitShellType);
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

  _resolveBlueShell(thrower) {
    // Find rank-1 unfinished player
    const finishedIds = new Set(this.ranking);
    const playerList = [];
    for (const [pid, p] of this.players) {
      playerList.push({ playerId: pid, cellId: p.cellId, lapCount: p.lapCount });
    }
    const finishedRanks = this.ranking.map((pid, i) => ({ playerId: pid, finalRank: i + 1 }));
    const liveRanks = computeLiveRanks(playerList, finishedRanks, this.cells.size);

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

    // Build forward path from thrower to target (skip all obstacles)
    const path = [];
    let currentCellId = thrower.cellId;
    const totalCells = this.cells.size;
    for (let step = 0; step < totalCells; step++) {
      currentCellId = this.cells.get(currentCellId).next_cell;
      path.push(currentCellId);
      if (currentCellId === target.cellId) break;
    }

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
        ...this._cardState(target),
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
    this._testDeck = options._testDeck || null;
    this._testRiverDecks = options._testRiverDecks || null;
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
    const cellsData = JSON.parse(fs.readFileSync(path.join(__dirname, "../../assets/racetrack_0_cells.json"), "utf8"));
    this.cells = new Map(cellsData.map((cell) => [cell.id, cell]));
    this.prevCell = {};
    for (const cell of cellsData) {
      this.prevCell[cell.next_cell] = cell.id;
    }
    this.cellOccupants = {};
    this.ranking = [];

    this.onMessage("_testSetState", (client, data) => {
      const info = this.clientsInfo.get(client.sessionId);
      if (!info) return;
      let player;
      if (info.type === "board") {
        if (!data.playerId) return;
        player = this.players.get(data.playerId);
      } else {
        if (!this._testDeck) return;
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
        this._addToCell(data.addBanana.cellId, "banana");
      }
      if (data.removeBanana) {
        this._removeFromCell(data.removeBanana.cellId, "banana");
      }
      if (data.addShell) {
        this._addToCell(data.addShell.cellId, "green_shell");
      }
      if (data.removeShell) {
        this._removeFromCell(data.removeShell.cellId, "green_shell");
      }
      if (data.setRanking) {
        this.ranking = data.setRanking.filter((id) => this.players.has(id));
      }
      if (data.setRiverSlot && this.rivers) {
        const river = this.rivers.find((r) => r.id === data.setRiverSlot.riverId);
        if (river && data.setRiverSlot.slotIndex >= 0 && data.setRiverSlot.slotIndex < 3) {
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
      this.phase = "lobby";
      this.ranking = [];
      this.currentRound = 0;
      this.turnIndex = -1;
      this.activePlayerId = null;
      this.rivers = this._createRiverDecks();
      this.cellOccupants = {};
      for (const player of this.players.values()) {
        Object.assign(player, this._initialPlayerState());
        this._addToCell(1, player.playerId);
      }
      this._syncState();
    });

    this.onMessage("_debugGetState", (client) => {
      const info = this.clientsInfo.get(client.sessionId);
      if (!info || info.type !== "board") return;
      client.send("_debugState", this._fullState());
    });

    this.onMessage("changeName", (client, newName) => {
      const player = this._getPlayer(client);
      if (!player) return;
      player.name = (newName || "???").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3) || "???";
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
      client.send("cardsDrawn", this._drawCards(player));
      this._syncState();
    });

    this.onMessage("playCard", (client, data) => {
      const player = this._getPlayer(client);
      if (!player) return;
      if (this.phase !== "playing") return;
      if (player.playerId !== this.activePlayerId) return;
      if (player.pendingDiscard > 0) return;
      if (player.pendingShellChoice) return;
      if (player.pendingItems.length > 0) return;
      const cardIndex = player.hand.findIndex((c) => c.id === data.cardId);
      if (cardIndex === -1) return;
      const [card] = player.hand.splice(cardIndex, 1);
      if (player.hand.length === 0) player.hasPlayedAllCards = true;

      player.discardPile.push(card);
      player.pendingItems = [...card.items];
      this._sendToPlayer(player.playerId, "cardPlayed", { cardId: card.id, ...this._cardState(player) });
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
        ...this._cardState(player),
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
      if (data.direction !== "forward" && data.direction !== "backward") return;

      player.pendingShellChoice = false;
      const shellType = player.pendingShellType;
      player.pendingShellType = null;
      if (!shellType) return;

      if (shellType === "red_shell" && data.direction === "forward") {
        this._resolveRedShell(player, client, data.direction);
      } else {
        const targetCellId = data.direction === "forward"
          ? this.cells.get(player.cellId).next_cell
          : this._previousCell(player.cellId);
        this._resolveShell(player, client, targetCellId, shellType);
      }

      if (player.pendingItems.length > 0) {
        this._processNextItem(player);
      }
    });

    this.onMessage("endTurn", (client) => {
      const player = this._getPlayer(client);
      if (!player) return;
      if (this.phase !== "playing") return;
      if (player.playerId !== this.activePlayerId) return;
      if (player.pendingDiscard > 0) return;
      if (player.pendingShellChoice) return;
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
      if (player.pendingItems.length > 0) return;
      const river = this.rivers.find((r) => r.id === data.riverId);
      if (!river) return;
      const slotIndex = river.slots.findIndex((c) => c && c.id === data.cardId);
      if (slotIndex === -1) return;
      if (player.coins < river.cost) return;
      const rank = this._getLiveRank(player.playerId);
      if (!canBuyFromRiver(rank, this.rivers.length, river.id, this.players.size)) return;
      const regularCoins = player.coins - player.permanentCoins;
      const fromPermanent = Math.max(0, river.cost - regularCoins);
      player.coins -= river.cost;
      player.permanentCoins -= fromPermanent;
      const card = river.slots[slotIndex];
      player.discardPile.push(card);
      river.slots[slotIndex] = null;
      client.send("cardBought", { cardId: card.id, riverId: river.id, slotIndex, ...this._cardState(player) });
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
      this.phase = "lobby";
      this.ranking = [];
      this.currentRound = 0;
      this.turnIndex = -1;
      this.activePlayerId = null;
      this.rivers = this._createRiverDecks();
      this.cellOccupants = {};
      for (const player of this.players.values()) {
        Object.assign(player, this._initialPlayerState());
        this._addToCell(1, player.playerId);
      }
      this._syncState();
    });
  }

  _applyPlayerState(player, data) {
    if (data.cellId !== undefined) {
      this._removeFromCell(player.cellId, player.playerId);
      player.cellId = data.cellId;
      this._addToCell(player.cellId, player.playerId);
    }
    if (data.lapCount !== undefined) player.lapCount = data.lapCount;
    if (data.coins !== undefined) player.coins = data.coins;
    if (data.permanentCoins !== undefined) player.permanentCoins = data.permanentCoins;
    if (data.pendingDiscard !== undefined) player.pendingDiscard = data.pendingDiscard;
    if (data.pendingShellChoice !== undefined) player.pendingShellChoice = data.pendingShellChoice;
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
      this._sendToPlayer(player.playerId, "cardsDrawn", this._cardState(player));
    }
    this._syncState();
  }

  _fullState() {
    const liveRanks = this.phase === "playing"
      ? computeLiveRanks(
        Array.from(this.players.values()).map((p) => ({ playerId: p.playerId, cellId: p.cellId, lapCount: p.lapCount })),
        this.ranking.map((pid, i) => ({ playerId: pid, finalRank: i + 1 })),
        this.cells.size,
      )
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
      cellOccupants: this.cellOccupants,
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
    const drawPile = this._createDeck();
    return {
      cellId: 1, drawPile, drawPileDisplay: this._shuffle([...drawPile]), hand: [], discardPile: [],
      pendingDiscard: 0, pendingShellChoice: false, pendingItems: [], ready: false, hasPlayedAllCards: false, coins: 0, permanentCoins: 0, lapCount: 0, slowCounters: 0, hasMovedThisTurn: false, starInvincible: false,
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
        client.send("cardsDrawn", this._cardState(player));
      } else if (this.phase === "lobby") {
        const playerId = randomUUID();
        const name = (options.name || "???").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3) || "???";
        const usedColors = new Set([...this.players.values()].map(p => p.color));
        const color = PLAYER_COLORS.find(c => !usedColors.has(c));
        this.players.set(playerId, {
          playerId, name, color, connected: true,
          ...this._initialPlayerState(),
        });
        this._addToCell(1, playerId);
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
    const playerList = [];
    for (const [pid, p] of this.players) {
      playerList.push({ playerId: pid, cellId: p.cellId, lapCount: p.lapCount });
    }
    const finishedRanks = this.ranking.map((pid, i) => ({ playerId: pid, finalRank: i + 1 }));
    const liveRanks = computeLiveRanks(playerList, finishedRanks, this.cells.size);
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
      const playerList = [];
      for (const [playerId, p] of this.players) {
        playerList.push({ playerId, cellId: p.cellId, lapCount: p.lapCount });
      }
      const finishedRanks = this.ranking.map((pid, i) => ({ playerId: pid, finalRank: i + 1 }));
      liveRanks = computeLiveRanks(playerList, finishedRanks, this.cells.size);
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
      sp.hasMovedThisTurn = p.hasMovedThisTurn;
      sp.pendingShellChoice = p.pendingShellChoice;
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
    for (const cellId of Object.keys(this.cellOccupants)) {
      activeCellIds.add(String(cellId));
      let co = this.state.cellOccupants.get(String(cellId));
      if (!co) {
        co = new CellOccupantsSchema();
        co.entries = new ArraySchema();
        this.state.cellOccupants.set(String(cellId), co);
      }
      while (co.entries.length > 0) co.entries.pop();
      for (const entry of this.cellOccupants[cellId]) {
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
    this._removeFromCell(player.cellId, playerId);
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
    } else if (item === "blue_shell") {
      this._resolveBlueShell(player);
    } else if (item === "green_shell" || item === "red_shell") {
      player.pendingShellChoice = true;
      player.pendingShellType = item;
      this._sendToPlayer(player.playerId, "cardPlayed", { ...this._cardState(player) });
      this._syncState();
      return;
    }

    this.clock.setTimeout(() => this._processNextItem(player), PATCH_DELAY_MS);
  }

  _resolveMushroomStep(player) {
    if (player.hasMovedThisTurn && player.slowCounters > 0) {
      player.slowCounters--;
      this._syncState();
      this.clock.setTimeout(() => this._processNextItem(player), MOVE_DELAY_MS);
      return;
    }
    player.hasMovedThisTurn = true;

    if (player.lapCount === 0) player.lapCount = 1;
    const oldCellId = player.cellId;
    player.cellId = this.cells.get(player.cellId).next_cell;
    this._removeFromCell(oldCellId, player.playerId);
    this._addToCell(player.cellId, player.playerId);

    const cellData = this.cells.get(player.cellId);
    if (cellData.permanent_coin) {
      player.permanentCoins += cellData.permanent_coin;
      player.coins += cellData.permanent_coin;
      this.broadcast("permanentCoinPickup", {
        playerId: player.playerId,
        cellId: player.cellId,
      });
    }

    this._syncState();

    if (cellData.finish_line) {
      player.lapCount++;
      if (player.lapCount > 3) {
        this.ranking.push(player.playerId);
        player.pendingItems = [];
        this._endTurnForFinishedPlayer(player);
        if (this._checkRaceOver()) return;
        return;
      }
    }

    if (player.starInvincible) {
      // Star-invincible: destroy one item on the cell (shell priority: player > banana > shell)
      const occupants = this._cellOccupants(player.cellId);
      const otherPlayers = occupants.filter(
        (e) => e !== player.playerId && e !== "banana" && e !== "green_shell" && e !== "red_shell",
      );
      if (otherPlayers.length > 0) {
        const hitPlayerId = otherPlayers[Math.floor(Math.random() * otherPlayers.length)];
        const hitPlayer = this.players.get(hitPlayerId);
        hitPlayer.slowCounters++;
        this.broadcast("itemHitBoard", {
          type: "star",
          playerId: hitPlayerId,
          cellId: player.cellId,
        });
      } else if (this._countItemOnCell(player.cellId, "banana") > 0) {
        this._removeFromCell(player.cellId, "banana");
        this.broadcast("itemHitBoard", {
          type: "banana",
          playerId: player.playerId,
          cellId: player.cellId,
          starHit: true,
        });
      } else if (this._countItemOnCell(player.cellId, "green_shell") > 0) {
        this._removeFromCell(player.cellId, "green_shell");
        this.broadcast("itemHitBoard", {
          type: "green_shell",
          playerId: player.playerId,
          cellId: player.cellId,
          starHit: true,
        });
      } else if (this._countItemOnCell(player.cellId, "red_shell") > 0) {
        this._removeFromCell(player.cellId, "red_shell");
        this.broadcast("itemHitBoard", {
          type: "red_shell",
          playerId: player.playerId,
          cellId: player.cellId,
          starHit: true,
        });
      }
      this._syncState();
      this.clock.setTimeout(() => this._processNextItem(player), MOVE_DELAY_MS);
    } else {
      const hitType = this._countItemOnCell(player.cellId, "banana") > 0 ? "banana"
        : this._countItemOnCell(player.cellId, "green_shell") > 0 ? "green_shell"
          : this._countItemOnCell(player.cellId, "red_shell") > 0 ? "red_shell"
            : null;

      if (hitType) {
        this._removeFromCell(player.cellId, hitType);
        // Send itemHitBoard BEFORE _syncState so the message arrives before the patch.
        // The board's animateItemHit has a built-in moveDelay (400ms) that waits for
        // the helmet tween to finish before playing the hit effects.
        this.broadcast("itemHitBoard", {
          type: hitType,
          playerId: player.playerId,
          cellId: player.cellId,
        });
        if (hitType === "banana") {
          const mustDiscard = Math.min(1, player.hand.length);
          if (mustDiscard > 0) {
            player.pendingDiscard = mustDiscard;
            this._sendToPlayer(player.playerId, "discardHit", {
              source: hitType,
              mustDiscard,
              ...this._cardState(player),
            });
          }
          this._syncState();
          if (player.pendingDiscard === 0) {
            this.clock.setTimeout(() => this._processNextItem(player), MOVE_DELAY_MS);
          }
        } else {
          player.slowCounters++;
          this._syncState();
          this.clock.setTimeout(() => this._processNextItem(player), MOVE_DELAY_MS);
        }
      } else {
        // No hit — continue to next item after tween completes
        this.clock.setTimeout(() => this._processNextItem(player), MOVE_DELAY_MS);
      }
    }
  }

  _resolveBananaStep(player) {
    const occupants = this._cellOccupants(player.cellId);
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
    this.rivers = this._createRiverDecks();

    // Deal initial hand to all players
    for (const [playerId, player] of this.players) {
      const drawResult = this._drawCards(player);
      this._sendToPlayer(playerId, "cardsDrawn", drawResult);
    }

    this._syncState();
  }

  _endTurnAndAdvance(player) {
    player.coins = player.permanentCoins;
    player.slowCounters = 0;
    player.pendingItems = [];
    // Discard remaining hand cards
    if (player.hand.length > 0) {
      player.discardPile.push(...player.hand.splice(0));
    }
    const drawResult = this._drawCards(player);
    this._sendToPlayer(player.playerId, "cardsDrawn", drawResult);
    this._syncState();
    player.hasPlayedAllCards = false;
    player.hasMovedThisTurn = false;
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
    player.coins = player.permanentCoins;
    player.slowCounters = 0;
    player.pendingItems = [];
    if (player.hand.length > 0) {
      player.discardPile.push(...player.hand.splice(0));
    }
    player.hasPlayedAllCards = false;
    player.hasMovedThisTurn = false;
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
