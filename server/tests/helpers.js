import { createRequire } from "module";
const require = createRequire(import.meta.url);

const express = require("express");
const { createServer } = require("http");
const { Server, matchMaker } = require("colyseus");
const { WebSocketTransport } = require("@colyseus/ws-transport");
const { Client } = require("colyseus.js");
const { GameRoom } = require("../rooms/GameRoom");

const BUFFERED_TYPES = ["players", "cellOccupants", "gameState", "cardsDrawn", "gameAlreadyStarted", "cardPlayed", "bananaHit", "cardDiscarded", "cardBought"];

function bufferMessages(room) {
  room._messageBuffers = {};
  for (const type of BUFFERED_TYPES) {
    room._messageBuffers[type] = [];
    room.onMessage(type, (data) => {
      room._messageBuffers[type].push(data);
    });
  }
}

export async function startServer() {
  const app = express();
  app.use(express.json());

  const httpServer = createServer(app);
  const gameServer = new Server({
    transport: new WebSocketTransport({ server: httpServer }),
  });

  gameServer.define("game", GameRoom);

  app.get("/create", async (req, res) => {
    const room = await matchMaker.createRoom("game", {});
    res.json({ id: room.roomId });
  });

  app.post("/create", async (req, res) => {
    const room = await matchMaker.createRoom("game", req.body || {});
    res.json({ id: room.roomId });
  });

  app.get("/find-or-create/:gameId", async (req, res) => {
    const { gameId } = req.params;
    const rooms = await matchMaker.query({ roomId: gameId });
    if (rooms.length > 0) {
      return res.json({ id: gameId });
    }
    const room = await matchMaker.createRoom("game", { _roomId: gameId });
    res.json({ id: room.roomId });
  });

  await new Promise((resolve) => httpServer.listen(0, resolve));
  const port = httpServer.address().port;
  const baseUrl = `http://localhost:${port}`;

  async function cleanup() {
    await gameServer.gracefullyShutdown(false);
    await new Promise((resolve) => httpServer.close(resolve));
  }

  return { baseUrl, cleanup };
}

export async function createRoom(baseUrl, options) {
  let res;
  if (options) {
    res = await fetch(`${baseUrl}/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(options),
    });
  } else {
    res = await fetch(`${baseUrl}/create`);
  }
  const { id } = await res.json();
  return id;
}

function wsUrl(baseUrl) {
  return baseUrl.replace("http", "ws");
}

export async function connectPlayer(baseUrl, roomId, opts = {}) {
  const client = new Client(wsUrl(baseUrl));

  let resolvePlayerId;
  const playerIdPromise = new Promise((r) => { resolvePlayerId = r; });

  const originalJoinById = client.joinById.bind(client);
  client.joinById = async function (id, options) {
    const room = await originalJoinById(id, options);
    bufferMessages(room);
    room.onMessage("playerId", (playerId) => resolvePlayerId(playerId));
    return room;
  };

  const room = await client.joinById(roomId, { type: "player", ...opts });

  if (opts.playerId) {
    return { room, playerId: opts.playerId };
  }
  const playerId = await playerIdPromise;
  return { room, playerId };
}

export async function connectRaw(baseUrl, roomId, opts = {}) {
  const client = new Client(wsUrl(baseUrl));

  const originalJoinById = client.joinById.bind(client);
  client.joinById = async function (id, options) {
    const room = await originalJoinById(id, options);
    bufferMessages(room);
    return room;
  };

  const room = await client.joinById(roomId, { type: "player", ...opts });
  return { room };
}

export async function connectBoard(baseUrl, roomId) {
  const client = new Client(wsUrl(baseUrl));

  const originalJoinById = client.joinById.bind(client);
  client.joinById = async function (id, options) {
    const room = await originalJoinById(id, options);
    bufferMessages(room);
    return room;
  };

  const room = await client.joinById(roomId, { type: "board" });
  return { room };
}

export function waitForMessage(room, type, predicateOrTimeout, timeout = 5000) {
  let predicate;
  if (typeof predicateOrTimeout === "function") {
    predicate = predicateOrTimeout;
  } else if (typeof predicateOrTimeout === "number") {
    timeout = predicateOrTimeout;
  }

  const buffer = room._messageBuffers && room._messageBuffers[type];
  if (buffer) {
    if (predicate) {
      for (let i = 0; i < buffer.length; i++) {
        if (predicate(buffer[i])) {
          const match = buffer[i];
          buffer.splice(0, i + 1);
          return Promise.resolve(match);
        }
      }
    } else if (buffer.length > 0) {
      return Promise.resolve(buffer.shift());
    }
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for message "${type}"`)),
      timeout,
    );
    room.onMessage(type, (data) => {
      if (!predicate || predicate(data)) {
        clearTimeout(timer);
        resolve(data);
      }
    });
  });
}

export function waitForPlayers(room, predicate, timeout = 5000) {
  const buffer = room._messageBuffers && room._messageBuffers["players"];
  if (buffer) {
    for (let i = 0; i < buffer.length; i++) {
      if (predicate(buffer[i])) {
        const match = buffer[i];
        buffer.splice(0, i + 1);
        return Promise.resolve(match);
      }
    }
  }
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error("Timed out waiting for players match")),
      timeout,
    );
    room.onMessage("players", (players) => {
      if (predicate(players)) {
        clearTimeout(timer);
        resolve(players);
      }
    });
  });
}
