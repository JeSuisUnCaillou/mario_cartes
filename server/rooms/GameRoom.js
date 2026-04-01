const { Room } = require("colyseus");
const { randomUUID } = require("crypto");
const path = require("path");
const { MapSchema, ArraySchema } = require("@colyseus/schema");
const { STARTING_DECK, RIVER_DEFS } = require("./decks");
const {
  PlayerSchema,
  RankEntrySchema,
  RiverSlotSchema,
  RiverSchema,
  CellOccupantsSchema,
  GameState,
} = require("./schema");

const DISPOSE_DELAY_MS = 10 * 60 * 1000; // 10 minutes
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
          cost: [1, 3, 5][i],
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
      drawCount: player.drawPile.length,
      discardCount: dp.length,
      discardTopCard: dp.length > 0 ? dp[dp.length - 1] : null,
      pendingDiscard: player.pendingDiscard,
      pendingShellChoice: player.pendingShellChoice,
      coins: player.coins,
      deck: [...player.hand, ...player.drawPile, ...player.discardPile],
    };
  }

  _drawCards(player) {
    let shuffledCount = 0;
    let needed = 5;
    const drawn = player.drawPile.splice(0, needed);
    const drawnBeforeShuffle = drawn.length;
    needed -= drawn.length;
    if (needed > 0 && player.discardPile.length > 0) {
      shuffledCount = player.discardPile.length;
      player.drawPile.push(...this._shuffle(player.discardPile.splice(0)));
      drawn.push(...player.drawPile.splice(0, needed));
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

  _bananasOnCell(cellId) {
    return this._cellOccupants(cellId).filter((e) => e === "banana").length;
  }

  _greenShellsOnCell(cellId) {
    return this._cellOccupants(cellId).filter((e) => e === "green_shell").length;
  }

  _previousCell(cellId) {
    return this.prevCell[cellId];
  }

  _resolveShell(thrower, throwerClient, targetCellId) {
    const occupants = this._cellOccupants(targetCellId);

    // Priority 1: hit a player (excluding thrower), randomly chosen
    const playerIds = occupants.filter((e) => e !== "banana" && e !== "green_shell" && e !== thrower.playerId);
    if (playerIds.length > 0) {
      const hitPlayerId = playerIds[Math.floor(Math.random() * playerIds.length)];
      const hitPlayer = this.players.get(hitPlayerId);
      const mustDiscard = Math.min(1, hitPlayer.hand.length);
      if (mustDiscard > 0) {
        hitPlayer.pendingDiscard = mustDiscard;
        this._sendToPlayer(hitPlayerId, "discardHit", {
          source: "green_shell",
          mustDiscard,
          ...this._cardState(hitPlayer),
        });
      }
      this.broadcast("shellThrown", {
        playerId: thrower.playerId,
        fromCellId: thrower.cellId,
        toCellId: targetCellId,
        hit: "player",
        hitPlayerId,
      });
      this._syncState();
      return;
    }

    // Priority 2: hit a banana — both destroyed
    if (this._bananasOnCell(targetCellId) > 0) {
      this._removeFromCell(targetCellId, "banana");
      this.broadcast("shellThrown", {
        playerId: thrower.playerId,
        fromCellId: thrower.cellId,
        toCellId: targetCellId,
        hit: "banana",
      });
      this._syncState();
      return;
    }

    // Priority 3: hit another shell — both destroyed
    if (this._greenShellsOnCell(targetCellId) > 0) {
      this._removeFromCell(targetCellId, "green_shell");
      this.broadcast("shellThrown", {
        playerId: thrower.playerId,
        fromCellId: thrower.cellId,
        toCellId: targetCellId,
        hit: "green_shell",
      });
      this._syncState();
      return;
    }

    // Nothing to hit — shell stays on cell
    this._addToCell(targetCellId, "green_shell");
    this.broadcast("shellThrown", {
      playerId: thrower.playerId,
      fromCellId: thrower.cellId,
      toCellId: targetCellId,
      hit: null,
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

    const cellsData = require(path.join(__dirname, "../../assets/racetrack_0_cells.json"));
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
      this._checkAllReady();
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
      const targetCellId = data.direction === "forward"
        ? this.cells.get(player.cellId).next_cell
        : this._previousCell(player.cellId);

      this._resolveShell(player, client, targetCellId);

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
      player.coins -= river.cost;
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

    this.onMessage("startOver", () => {
      if (this.phase !== "finished") return;
      this.phase = "lobby";
      this.ranking = [];
      this.currentRound = 0;
      this.turnIndex = -1;
      this.activePlayerId = null;
      this.rivers = null;
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
    if (data.pendingDiscard !== undefined) player.pendingDiscard = data.pendingDiscard;
    if (data.pendingShellChoice !== undefined) player.pendingShellChoice = data.pendingShellChoice;
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
    const players = Array.from(this.players.values()).map((p) => ({
      playerId: p.playerId,
      name: p.name,
      cellId: p.cellId,
      connected: p.connected,
      ready: p.ready,
      coins: p.coins,
      lapCount: p.lapCount,
      pendingDiscard: p.pendingDiscard,
      pendingShellChoice: p.pendingShellChoice,
      handCount: p.hand.length,
      drawCount: p.drawPile.length,
      discardCount: p.discardPile.length,
      hand: p.hand,
      drawPile: p.drawPile,
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
        rank: i + 1,
      }));
    }
    return state;
  }

  _initialPlayerState() {
    return {
      cellId: 1, drawPile: this._createDeck(), hand: [], discardPile: [],
      pendingDiscard: 0, pendingShellChoice: false, pendingItems: [], ready: false, hasPlayedAllCards: false, coins: 0, lapCount: 0,
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
        if (this._turnAdvanceTimer) {
          this._turnAdvanceTimer.clear();
          this._turnAdvanceTimer = null;
        }
        this.clientsInfo.set(client.sessionId, { type: "player", playerId: existingPlayerId });
        client.send("cardsDrawn", this._cardState(player));
      } else if (this.phase === "lobby") {
        const playerId = randomUUID();
        const name = (options.name || "???").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3) || "???";
        this.players.set(playerId, {
          playerId, name, connected: true,
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

  async onLeave(client, consented) {
    const info = this.clientsInfo.get(client.sessionId);
    if (info && info.type === "player" && info.playerId) {
      const player = this.players.get(info.playerId);
      if (player) {
        player.connected = false;
      }
      if (this.phase === "playing" && info.playerId === this.activePlayerId) {
        this._turnAdvanceTimer = this.clock.setTimeout(() => {
          if (!player.connected && this.activePlayerId === info.playerId) {
            this._advanceTurn();
          }
        }, DISPOSE_DELAY_MS);
      }
      this.clientsInfo.delete(client.sessionId);
      this._syncState();

      // Allow reconnection for 60s — Colyseus buffers schema patches during this window
      if (!consented) {
        try {
          await this.allowReconnection(client, 60);
          // Client reconnected — restore connection state
          if (player) player.connected = true;
          if (this._turnAdvanceTimer) {
            this._turnAdvanceTimer.clear();
            this._turnAdvanceTimer = null;
          }
          this.clientsInfo.set(client.sessionId, { type: "player", playerId: info.playerId });
          this._syncState();
          return;
        } catch {
          // Reconnection timed out — player stays disconnected
        }
      }
    } else {
      this.clientsInfo.delete(client.sessionId);
    }
    if (this.clients.length === 0) {
      this._disposeTimer = setTimeout(() => this.disconnect(), DISPOSE_DELAY_MS);
    }
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
      sp.cellId = p.cellId;
      sp.connected = p.connected;
      sp.handCount = p.hand.length;
      sp.ready = p.ready;
      sp.coins = p.coins;
      sp.lapCount = p.lapCount;
      sp.pendingShellChoice = p.pendingShellChoice;
      sp.finished = this.ranking.includes(playerId);
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
      entry.rank = i + 1;
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
    } else if (item === "green_shell") {
      player.pendingShellChoice = true;
      this._sendToPlayer(player.playerId, "cardPlayed", { ...this._cardState(player) });
      this._syncState();
      return;
    }

    this.clock.setTimeout(() => this._processNextItem(player), PATCH_DELAY_MS);
  }

  _resolveMushroomStep(player) {
    if (player.lapCount === 0) player.lapCount = 1;
    const oldCellId = player.cellId;
    player.cellId = this.cells.get(player.cellId).next_cell;
    this._removeFromCell(oldCellId, player.playerId);
    this._addToCell(player.cellId, player.playerId);
    this._syncState();

    if (this.cells.get(player.cellId).finish_line) {
      player.lapCount++;
      if (player.lapCount > 3) {
        this.ranking.push(player.playerId);
        player.pendingItems = [];
        this._endTurnForFinishedPlayer(player);
        if (this._checkRaceOver()) return;
        return;
      }
    }

    const hitType = this._bananasOnCell(player.cellId) > 0 ? "banana"
      : this._greenShellsOnCell(player.cellId) > 0 ? "green_shell"
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
      // No hit — continue to next item after tween completes
      this.clock.setTimeout(() => this._processNextItem(player), MOVE_DELAY_MS);
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

  _checkAllReady() {
    if (this.players.size === 0) return;
    for (const player of this.players.values()) {
      if (!player.ready) return;
    }
    this._startGame();
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
    player.coins = 0;
    player.pendingItems = [];
    // Discard remaining hand cards
    if (player.hand.length > 0) {
      player.discardPile.push(...player.hand.splice(0));
    }
    const drawResult = this._drawCards(player);
    this._sendToPlayer(player.playerId, "cardsDrawn", drawResult);
    this._syncState();
    player.hasPlayedAllCards = false;
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
      (!this.players.get(this.activePlayerId).connected || this.ranking.includes(this.activePlayerId))
      && attempts < playerIds.length
    );

    if (attempts >= playerIds.length) return;

    this.players.get(this.activePlayerId).hasPlayedAllCards = false;
    this._syncState();
  }

  _endTurnForFinishedPlayer(player) {
    player.coins = 0;
    player.pendingItems = [];
    if (player.hand.length > 0) {
      player.discardPile.push(...player.hand.splice(0));
    }
    player.hasPlayedAllCards = false;
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

module.exports = { GameRoom };
