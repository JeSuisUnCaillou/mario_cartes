const { Room } = require("colyseus");
const { randomUUID } = require("crypto");
const path = require("path");

const DISPOSE_DELAY_MS = 10 * 60 * 1000; // 10 minutes

class GameRoom extends Room {
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

    this.onMessage("changeName", (client, newName) => {
      const player = this._getPlayer(client);
      if (!player) return;
      player.name = (newName || "???").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3) || "???";
      this.broadcastPlayers();
    });

    this.onMessage("ping", (client) => {
      const player = this._getPlayer(client);
      if (!player) return;
      player.cellId = this.cells.get(player.cellId).next_cell;
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
      } else {
        const playerId = randomUUID();
        const name = (options.name || "???").toUpperCase().replace(/[^A-Z]/g, "").slice(0, 3) || "???";
        this.players.set(playerId, { playerId, name, cellId: 1, connected: true });
        this.clientsInfo.set(client.sessionId, { type: "player", playerId });
        client.send("playerId", playerId);
      }
    } else {
      this.clientsInfo.set(client.sessionId, { type });
    }

    this.broadcastPlayers();
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
