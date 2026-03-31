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
      { id: randomUUID(), items: ["mushroom"] },
      { id: randomUUID(), items: ["mushroom", "mushroom"] },
      ...Array.from({ length: 2 }, () => ({ id: randomUUID(), items: ["banana", "mushroom"] })),
      { id: randomUUID(), items: ["mushroom", "banana", "coin"] },
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
      [["coin"], ["coin"], ["mushroom"], ["mushroom"], ["banana"], ["banana"]],
      [["coin", "mushroom"], ["coin", "banana"], ["mushroom", "banana"], ["mushroom", "mushroom"], ["banana", "banana"], ["banana", "banana"]],
      [["banana", "banana", "mushroom"], ["banana", "banana", "coin"], ["coin", "coin", "mushroom"], ["coin", "coin", "banana"]],
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
      pendingBananaDiscards: player.pendingBananaDiscards,
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
    this.cellOccupants = {};

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
      if (player.pendingBananaDiscards > 0) return;
      client.send("cardsDrawn", this._drawCards(player));
      this.broadcastPlayers();
    });

    this.onMessage("playCard", (client, data) => {
      const player = this._getPlayer(client);
      if (!player) return;
      if (this.phase !== "playing") return;
      if (player.playerId !== this.activePlayerId) return;
      if (player.pendingBananaDiscards > 0) return;
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
        }
      }

      // Move one cell at a time, checking for banana collisions on each cell
      const bananaHits = [];
      for (let i = 0; i < moveCount; i++) {
        const oldCellId = player.cellId;
        player.cellId = this.cells.get(player.cellId).next_cell;
        this._removeFromCell(oldCellId, player.playerId);
        this._addToCell(player.cellId, player.playerId);
        this.broadcastCellOccupants();
        if (this._bananasOnCell(player.cellId) > 0) {
          this._removeFromCell(player.cellId, "banana");
          this.broadcast("bananaHitBoard", {
            playerId: player.playerId,
            cellId: player.cellId,
            count: 1,
          });
          bananaHits.push({ cellId: player.cellId });
        }
      }

      player.discardPile.push(card);
      client.send("cardPlayed", { cardId: card.id, droppedBanana, coinGained, ...this._cardState(player) });
      this.broadcastPlayers();

      // Send banana hit events to the player (stacking discards)
      if (bananaHits.length > 0) {
        const mustDiscard = Math.min(bananaHits.length, player.hand.length);
        player.pendingBananaDiscards = mustDiscard;
        client.send("bananaHit", {
          bananaHits,
          mustDiscard,
          ...this._cardState(player),
        });
      }

    });

    this.onMessage("discardCard", (client, data) => {
      const player = this._getPlayer(client);
      if (!player) return;
      if (this.phase !== "playing") return;
      if (player.pendingBananaDiscards <= 0) return;
      const cardIndex = player.hand.findIndex((c) => c.id === data.cardId);
      if (cardIndex === -1) return;
      const [card] = player.hand.splice(cardIndex, 1);
      player.discardPile.push(card);
      player.pendingBananaDiscards--;
      client.send("cardDiscarded", {
        cardId: card.id,
        remaining: player.pendingBananaDiscards,
        ...this._cardState(player),
      });
      this.broadcastPlayers();

    });

    this.onMessage("endTurn", (client) => {
      const player = this._getPlayer(client);
      if (!player) return;
      if (this.phase !== "playing") return;
      if (player.playerId !== this.activePlayerId) return;
      if (player.pendingBananaDiscards > 0) return;
      this._endTurnAndAdvance(player);
    });

    this.onMessage("buyCard", (client, data) => {
      const player = this._getPlayer(client);
      if (!player) return;
      if (this.phase !== "playing") return;
      if (player.playerId !== this.activePlayerId) return;
      if (player.pendingBananaDiscards > 0) return;
      const river = this.rivers.find((r) => r.id === data.riverId);
      if (!river) return;
      const slotIndex = river.slots.findIndex((c) => c && c.id === data.cardId);
      if (slotIndex === -1) return;
      if (player.coins < river.cost) return;
      player.coins -= river.cost;
      const card = river.slots[slotIndex];
      player.discardPile.push(card);
      river.slots[slotIndex] = river.deck.length > 0 ? river.deck.shift() : null;
      client.send("cardBought", { cardId: card.id, riverId: river.id, slotIndex, ...this._cardState(player) });
      this.broadcastGameState();
      this.broadcastPlayers();
    });
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
        this.clientsInfo.set(client.sessionId, { type: "player", playerId: existingPlayerId });
        client.send("cardsDrawn", this._cardState(player));
      } else if (this.phase === "lobby") {
        const playerId = randomUUID();
        const name = (options.name || "???").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3) || "???";
        this.players.set(playerId, {
          playerId, name, cellId: 1, connected: true,
          drawPile: this._createDeck(), hand: [], discardPile: [],
          pendingBananaDiscards: 0, ready: false, hasPlayedAllCards: false, coins: 0,
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
        this._advanceTurn();
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
    } while (!this.players.get(this.activePlayerId).connected && attempts < playerIds.length);

    if (attempts >= playerIds.length) return;

    this.players.get(this.activePlayerId).hasPlayedAllCards = false;
    this.broadcastGameState();
    this.broadcastPlayers();
  }
}

module.exports = { GameRoom };
