const { Room } = require("colyseus");
const { randomUUID } = require("crypto");
const path = require("path");

const DISPOSE_DELAY_MS = 10 * 60 * 1000; // 10 minutes

class GameRoom extends Room {
  _createDeck() {
    if (this._testDeck) {
      return this._testDeck.map((items) => ({ id: randomUUID(), items }));
    }
    const cards = [
      ...Array.from({ length: 6 }, () => ({ id: randomUUID(), items: ["coin"] })),
      { id: randomUUID(), items: ["coin", "coin"] },
      { id: randomUUID(), items: ["green_shell"] },
      { id: randomUUID(), items: ["mushroom"] },
    ];
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
    const riverDefs = [
      // River 1: 15 single-item cards
      [
        ...Array.from({ length: 5 }, () => ["coin"]),
        ...Array.from({ length: 5 }, () => ["mushroom"]),
        ...Array.from({ length: 5 }, () => ["banana"]),
        ...Array.from({ length: 5 }, () => ["green_shell"]),
      ],
      // River 2: 27 two-item cards
      [
        ["coin", "mushroom"],
        ...Array.from({ length: 4 }, () => ["coin", "banana"]),
        ...Array.from({ length: 2 }, () => ["mushroom", "banana"]),
        ["mushroom", "mushroom"],
        ["green_shell", "mushroom"],
        ["green_shell", "coin"],
        ...Array.from({ length: 16 }, () => ["banana", "banana"]),
      ],
      // River 3: 36 three-item cards
      [
        ...Array.from({ length: 26 }, () => ["banana", "banana", "banana"]),
        ["banana", "banana", "mushroom"],
        ["banana", "banana", "coin"],
        ["banana", "banana", "green_shell"],
        ["green_shell", "mushroom", "coin"],
        ["coin", "coin", "mushroom"],
        ...Array.from({ length: 4 }, () => ["coin", "coin", "banana"]),
        ["coin", "banana", "banana"],
      ],
    ];
    return riverDefs.map((def, i) => {
      const cards = this._shuffle(def.map((items) => ({ id: randomUUID(), items })));
      return {
        id: i,
        cost: [1, 3, 5][i],
        deck: cards.slice(3),
        slots: cards.slice(0, 3),
      };
    });
  }

  _riverState() {
    return this.rivers.map((r) => ({
      id: r.id,
      cost: r.cost,
      slots: r.slots,
      deckCount: r.deck.length,
    }));
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
      this.broadcastCellOccupants();
      this.broadcastPlayers();
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
      this.broadcastCellOccupants();
      this.broadcastPlayers();
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
      this.broadcastCellOccupants();
      this.broadcastPlayers();
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
    this.broadcastCellOccupants();
    this.broadcastPlayers();
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
      this.broadcastPlayers();
      this.broadcastCellOccupants();
      this.broadcastGameState();
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
      this.broadcastPlayers();
    });

    this.onMessage("setReady", (client, ready) => {
      const player = this._getPlayer(client);
      if (!player) return;
      if (this.phase !== "lobby") return;
      player.ready = !!ready;
      this.broadcastPlayers();
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
      this.broadcastPlayers();
    });

    this.onMessage("playCard", (client, data) => {
      const player = this._getPlayer(client);
      if (!player) return;
      if (this.phase !== "playing") return;
      if (player.playerId !== this.activePlayerId) return;
      if (player.pendingDiscard > 0) return;
      if (player.pendingShellChoice) return;
      const cardIndex = player.hand.findIndex((c) => c.id === data.cardId);
      if (cardIndex === -1) return;
      const [card] = player.hand.splice(cardIndex, 1);
      if (player.hand.length === 0) player.hasPlayedAllCards = true;

      // Process card items
      let droppedBanana = null;
      let coinGained = 0;
      let moveCount = 0;
      for (const item of card.items) {
        if (item === "banana") {
          if (droppedBanana === null) droppedBanana = player.cellId;
          const occupants = this._cellOccupants(player.cellId);
          const playerIdx = occupants.indexOf(player.playerId);
          if (playerIdx !== -1) {
            occupants.splice(playerIdx, 0, "banana");
          } else {
            occupants.push("banana");
          }
        } else if (item === "coin") {
          player.coins += 1;
          coinGained += 1;
        } else if (item === "mushroom") {
          moveCount += 1;
        } else if (item === "green_shell") {
          player.pendingShellChoice = true;
        }
      }

      // Move one cell at a time, checking for item collisions and lap completion
      const itemHits = [];
      let playerFinished = false;
      if (player.lapCount === 0) player.lapCount = 1;
      for (let i = 0; i < moveCount; i++) {
        const oldCellId = player.cellId;
        player.cellId = this.cells.get(player.cellId).next_cell;
        this._removeFromCell(oldCellId, player.playerId);
        this._addToCell(player.cellId, player.playerId);
        this.broadcastCellOccupants();

        // Lap detection
        if (this.cells.get(player.cellId).finish_line) {
          player.lapCount++;
          if (player.lapCount > 3) {
            this.ranking.push(player.playerId);
            playerFinished = true;
            break;
          }
        }

        if (this._bananasOnCell(player.cellId) > 0) {
          this._removeFromCell(player.cellId, "banana");
          this.broadcast("itemHitBoard", {
            type: "banana",
            playerId: player.playerId,
            cellId: player.cellId,
          });
          itemHits.push({ cellId: player.cellId, source: "banana" });
        } else if (this._greenShellsOnCell(player.cellId) > 0) {
          this._removeFromCell(player.cellId, "green_shell");
          this.broadcast("itemHitBoard", {
            type: "green_shell",
            playerId: player.playerId,
            cellId: player.cellId,
          });
          itemHits.push({ cellId: player.cellId, source: "green_shell" });
        }
      }

      player.discardPile.push(card);
      if (droppedBanana !== null) this.broadcastCellOccupants();
      client.send("cardPlayed", { cardId: card.id, droppedBanana, coinGained, ...this._cardState(player) });
      this.broadcastPlayers();

      // Player just finished: auto-end turn
      if (playerFinished) {
        this._endTurnForFinishedPlayer(player);
        if (this.ranking.length === this.players.size) {
          this._endGame();
        }
        return;
      }

      // Send item hit events to the player (stacking discards)
      if (itemHits.length > 0) {
        const mustDiscard = Math.min(itemHits.length, player.hand.length);
        if (mustDiscard > 0) {
          player.pendingDiscard = mustDiscard;
          client.send("discardHit", {
            source: itemHits[0].source,
            itemHits,
            mustDiscard,
            ...this._cardState(player),
          });
        }
      }

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
      this.broadcastPlayers();

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
    });

    this.onMessage("endTurn", (client) => {
      const player = this._getPlayer(client);
      if (!player) return;
      if (this.phase !== "playing") return;
      if (player.playerId !== this.activePlayerId) return;
      if (player.pendingDiscard > 0) return;
      if (player.pendingShellChoice) return;
      this._endTurnAndAdvance(player);
    });

    this.onMessage("buyCard", (client, data) => {
      const player = this._getPlayer(client);
      if (!player) return;
      if (this.phase !== "playing") return;
      if (player.playerId !== this.activePlayerId) return;
      if (player.pendingDiscard > 0) return;
      if (player.pendingShellChoice) return;
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
      this.broadcastGameState();
      this.broadcastPlayers();
      if (river.deck.length > 0) {
        this.clock.setTimeout(() => {
          river.slots[slotIndex] = river.deck.shift();
          this.broadcastGameState();
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
      this.broadcastPlayers();
      this.broadcastCellOccupants();
      this.broadcastGameState();
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
    this.broadcastPlayers();
    this.broadcastCellOccupants();
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
      pendingDiscard: 0, pendingShellChoice: false, ready: false, hasPlayedAllCards: false, coins: 0, lapCount: 0,
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

    this.broadcastPlayers();
    this.broadcastCellOccupants();
    this.broadcastGameState();
  }

  onLeave(client) {
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
    }
    this.clientsInfo.delete(client.sessionId);
    this.broadcastPlayers();
    if (this.clients.length === 0) {
      this._disposeTimer = setTimeout(() => this.disconnect(), DISPOSE_DELAY_MS);
    }
  }

  broadcastCellOccupants() {
    this.broadcast("cellOccupants", this.cellOccupants);
  }

  broadcastPlayers() {
    const players = Array.from(this.players.values()).map((p) => ({
      playerId: p.playerId,
      name: p.name,
      cellId: p.cellId,
      connected: p.connected,
      handCount: p.hand.length,
      ready: p.ready,
      coins: p.coins,
      lapCount: p.lapCount,
      pendingShellChoice: p.pendingShellChoice,
      finished: this.ranking.includes(p.playerId),
    }));
    this.broadcast("players", players);
  }

  broadcastGameState() {
    const state = {
      phase: this.phase,
      currentRound: this.currentRound,
      activePlayerId: this.activePlayerId,
    };
    if (this.rivers) state.rivers = this._riverState();
    if (this.ranking.length > 0) {
      state.ranking = this.ranking.map((playerId, i) => ({
        playerId,
        name: this.players.get(playerId).name,
        rank: i + 1,
      }));
    }
    this.broadcast("gameState", state);
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

    this.broadcastGameState();
    this.broadcastPlayers();
  }

  _endTurnAndAdvance(player) {
    player.coins = 0;
    // Discard remaining hand cards
    if (player.hand.length > 0) {
      player.discardPile.push(...player.hand.splice(0));
    }
    const drawResult = this._drawCards(player);
    this._sendToPlayer(player.playerId, "cardsDrawn", drawResult);
    this.broadcastPlayers();
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
    this.broadcastGameState();
    this.broadcastPlayers();
  }

  _endTurnForFinishedPlayer(player) {
    player.coins = 0;
    if (player.hand.length > 0) {
      player.discardPile.push(...player.hand.splice(0));
    }
    player.hasPlayedAllCards = false;
    this.broadcastPlayers();
    this._advanceTurn();
  }

  _endGame() {
    this.phase = "finished";
    this.broadcastGameState();
    this.broadcastPlayers();
  }
}

module.exports = { GameRoom };
