const { Room } = require("colyseus");

class GameRoom extends Room {
  onCreate() {
    this.clientsInfo = new Map();

    this.onMessage("ping", (client) => {
      const info = this.clientsInfo.get(client.sessionId);
      if (!info || info.type !== "player") return;
      info.cellId = (info.cellId % 14) + 1;
      this.broadcastPlayers();
    });
  }

  onJoin(client, options) {
    const type = options.type || "player";
    const info = { type };
    if (type === "player") info.cellId = 1;
    this.clientsInfo.set(client.sessionId, info);
    this.broadcastPlayers();
  }

  onLeave(client) {
    this.clientsInfo.delete(client.sessionId);
    this.broadcastPlayers();
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
