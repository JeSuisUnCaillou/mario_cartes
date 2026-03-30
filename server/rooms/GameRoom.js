const { Room } = require("colyseus");

class GameRoom extends Room {
  onCreate() {
    this.clientsInfo = new Map();

    this.onMessage("ping", (client) => {
      this.broadcast("ping", { from: client.sessionId });
    });
  }

  onJoin(client, options) {
    this.clientsInfo.set(client.sessionId, { type: options.type || "player" });
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
    }));
    this.broadcast("players", players);
  }
}

module.exports = { GameRoom };
