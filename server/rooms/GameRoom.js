const { Room } = require("colyseus");
const { randomUUID } = require("crypto");
const path = require("path");

const DISPOSE_DELAY_MS = 10 * 60 * 1000; // 10 minutes

class GameRoom extends Room {
  _createDeck() {
    const cards = [
      ...Array.from({ length: 8 }, () => ({ id: randomUUID(), type: "move_forward_1" })),
      ...Array.from({ length: 2 }, () => ({ id: randomUUID(), type: "banana_move_forward_1" })),
    ];
    return this._shuffle(cards);
  }

  _shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  _cardState(player) {
    return {
      hand: player.hand,
      drawCount: player.drawPile.length,
      discardCount: player.discardPile.length,
      pendingBananaDiscards: player.pendingBananaDiscards,
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
    this.autoDispose = false;
    this._disposeTimer = null;
    this.clientsInfo = new Map();
    this.players = new Map();

    const cellsData = require(path.join(__dirname, "../../assets/racetrack_0_cells.json"));
    this.cells = new Map(cellsData.map((cell) => [cell.id, cell]));
    this.cellOccupants = {};

    this.onMessage("changeName", (client, newName) => {
      const player = this._getPlayer(client);
      if (!player) return;
      player.name = (newName || "???").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3) || "???";
      this.broadcastPlayers();
    });

    this.onMessage("drawCards", (client) => {
      const player = this._getPlayer(client);
      if (!player) return;
      if (player.hand.length > 0) return;
      if (player.pendingBananaDiscards > 0) return;
      client.send("cardsDrawn", this._drawCards(player));
    });

    this.onMessage("playCard", (client, data) => {
      const player = this._getPlayer(client);
      if (!player) return;
      if (player.pendingBananaDiscards > 0) return;
      const cardIndex = player.hand.findIndex((c) => c.id === data.cardId);
      if (cardIndex === -1) return;
      const [card] = player.hand.splice(cardIndex, 1);
      let droppedBanana = null;
      if (card.type === "banana_move_forward_1") {
        droppedBanana = player.cellId;
        // Insert banana at the player's position in the cell
        const occupants = this._cellOccupants(player.cellId);
        const playerIdx = occupants.indexOf(player.playerId);
        if (playerIdx !== -1) {
          occupants.splice(playerIdx, 0, "banana");
        } else {
          occupants.push("banana");
        }
      }
      if (card.type === "move_forward_1" || card.type === "banana_move_forward_1") {
        const oldCellId = player.cellId;
        player.cellId = this.cells.get(player.cellId).next_cell;
        this._removeFromCell(oldCellId, player.playerId);
        this._addToCell(player.cellId, player.playerId);
      }
      player.discardPile.push(card);
      client.send("cardPlayed", { cardId: card.id, droppedBanana, ...this._cardState(player) });
      this.broadcastCellOccupants();
      this.broadcastPlayers();

      // Check if player landed on a banana
      if (this._bananasOnCell(player.cellId) > 0) {
        this._removeFromCell(player.cellId, "banana");
        this.broadcastCellOccupants();
        player.pendingBananaDiscards = 1;
        let autoDrawn = null;
        if (player.hand.length === 0) {
          const totalAvailable = player.drawPile.length + player.discardPile.length;
          if (totalAvailable > 0) {
            autoDrawn = this._drawCards(player);
          }
        }
        client.send("bananaHit", {
          cellId: player.cellId,
          count: 1,
          mustDiscard: 1,
          autoDrawn,
          ...this._cardState(player),
        });
        this.broadcast("bananaHitBoard", {
          playerId: player.playerId,
          cellId: player.cellId,
          count: 1,
        });
      }
    });

    this.onMessage("discardCard", (client, data) => {
      const player = this._getPlayer(client);
      if (!player) return;
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
      } else {
        const playerId = randomUUID();
        const name = (options.name || "???").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3) || "???";
        this.players.set(playerId, {
          playerId, name, cellId: 1, connected: true,
          drawPile: this._createDeck(), hand: [], discardPile: [],
          pendingBananaDiscards: 0,
        });
        this._addToCell(1, playerId);
        this.clientsInfo.set(client.sessionId, { type: "player", playerId });
        client.send("playerId", playerId);
      }
    } else {
      this.clientsInfo.set(client.sessionId, { type });
    }

    this.broadcastPlayers();
    this.broadcastCellOccupants();
  }

  onLeave(client) {
    const info = this.clientsInfo.get(client.sessionId);
    if (info && info.type === "player" && info.playerId) {
      const player = this.players.get(info.playerId);
      if (player) {
        player.connected = false;
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
    }));
    this.broadcast("players", players);
  }
}

module.exports = { GameRoom };
