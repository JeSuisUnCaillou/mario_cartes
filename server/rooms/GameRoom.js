const { Room } = require("colyseus");
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

    const cellsData = require(path.join(__dirname, "../../assets/racetrack_0_cells.json"));
    this.cells = new Map(cellsData.map((cell) => [cell.id, cell]));

    this.onMessage("ping", (client) => {
      const info = this.clientsInfo.get(client.sessionId);
      if (!info || info.type !== "player") return;
      info.cellId = this.cells.get(info.cellId).next_cell;
      this.broadcastPlayers();
    });
  }

  onJoin(client, options) {
    if (this._disposeTimer) {
      clearTimeout(this._disposeTimer);
      this._disposeTimer = null;
    }
    const type = options.type || "player";
    const info = { type };
    if (type === "player") info.cellId = 1;
    this.clientsInfo.set(client.sessionId, info);
    this.broadcastPlayers();
  }

  onLeave(client) {
    this.clientsInfo.delete(client.sessionId);
    this.broadcastPlayers();
    if (this.clients.length === 0) {
      this._disposeTimer = setTimeout(() => this.disconnect(), DISPOSE_DELAY_MS);
    }
  }

  broadcastPlayers() {
    const players = Array.from(this.clientsInfo.entries()).map(([id, info]) => ({
      sessionId: id,
      type: info.type,
      cellId: info.cellId,
    }));
    this.broadcast("players", players);
  }
}

module.exports = { GameRoom };
