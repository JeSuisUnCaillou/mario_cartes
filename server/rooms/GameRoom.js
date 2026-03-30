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
    this.bananas = {};

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
        this.bananas[player.cellId] = (this.bananas[player.cellId] || 0) + 1;
      }
      if (card.type === "move_forward_1" || card.type === "banana_move_forward_1") {
        player.cellId = this.cells.get(player.cellId).next_cell;
      }
      player.discardPile.push(card);
      client.send("cardPlayed", { cardId: card.id, droppedBanana, ...this._cardState(player) });
      if (droppedBanana !== null) this.broadcastBananas();
      this.broadcastPlayers();

      // Check if player landed on banana(s)
      const bananaCount = this.bananas[player.cellId] || 0;
      if (bananaCount > 0) {
        delete this.bananas[player.cellId];
        this.broadcastBananas();
        player.pendingBananaDiscards = bananaCount;
        let autoDrawn = null;
        if (player.hand.length === 0) {
          const totalAvailable = player.drawPile.length + player.discardPile.length;
          if (totalAvailable > 0) {
            autoDrawn = this._drawCards(player);
          }
        }
        client.send("bananaHit", {
          cellId: player.cellId,
          count: bananaCount,
          mustDiscard: bananaCount,
          autoDrawn,
          ...this._cardState(player),
        });
        this.broadcast("bananaHitBoard", {
          playerId: player.playerId,
          cellId: player.cellId,
          count: bananaCount,
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
        this.clientsInfo.set(client.sessionId, { type: "player", playerId });
        client.send("playerId", playerId);
      }
    } else {
      this.clientsInfo.set(client.sessionId, { type });
    }

    this.broadcastPlayers();
    this.broadcastBananas();
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

  broadcastBananas() {
    this.broadcast("bananas", this.bananas);
  }

  broadcastPlayers() {
    const players = Array.from(this.players.values()).map((p) => ({
      playerId: p.playerId,
      name: p.name,
      cellId: p.cellId,
      connected: p.connected,
    }));
    this.broadcast("players", players);
  }
}

module.exports = { GameRoom };
