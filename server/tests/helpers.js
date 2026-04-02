import express from "express";
import { Server, matchMaker } from "colyseus";
import { Client } from "@colyseus/sdk";
import { GameRoom } from "../rooms/GameRoom.js";
import { schemaPlayersToArray, schemaCellOccupantsToObject, schemaToGameState } from "../../client/src/schema.js";

// "players", "cellOccupants", "gameState" are synthesized from schema state (not broadcast messages)
const BUFFERED_TYPES = ["players", "cellOccupants", "gameState", "cardsDrawn", "gameAlreadyStarted", "kicked", "cardPlayed", "discardHit", "cardDiscarded", "cardBought", "shellThrown", "itemHitBoard", "_debugState"];

function bufferMessages(room) {
  room._messageBuffers = {};
  for (const type of BUFFERED_TYPES) {
    room._messageBuffers[type] = [];
    room.onMessage(type, (data) => {
      room._messageBuffers[type].push(data);
    });
  }

  // Synthesize players/gameState/cellOccupants from schema state changes
  room.onStateChange((state) => {
    room._messageBuffers["players"].push(schemaPlayersToArray(state));
    room._messageBuffers["cellOccupants"].push(schemaCellOccupantsToObject(state));
    room._messageBuffers["gameState"].push(schemaToGameState(state));

    // Fire pending waitForMessage/waitForPlayers callbacks
    if (room._stateChangeCallbacks) {
      for (const cb of room._stateChangeCallbacks) cb();
    }
  });
}

export async function startServer() {
  const gameServer = new Server({
    greet: false,
    express: (app) => {
      app.use(express.json());

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
    },
  });

  gameServer.define("game", GameRoom);

  await gameServer.listen(0);
  const port = gameServer.transport.server.address().port;
  const baseUrl = `http://localhost:${port}`;

  async function cleanup() {
    await gameServer.gracefullyShutdown(false);
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

const SCHEMA_SYNCED_TYPES = new Set(["players", "cellOccupants", "gameState"]);

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

    // For schema-synced types, check buffer on each state change
    if (SCHEMA_SYNCED_TYPES.has(type)) {
      if (!room._stateChangeCallbacks) room._stateChangeCallbacks = [];
      const check = () => {
        if (predicate) {
          for (let i = 0; i < buffer.length; i++) {
            if (predicate(buffer[i])) {
              const match = buffer[i];
              buffer.splice(0, i + 1);
              clearTimeout(timer);
              const idx = room._stateChangeCallbacks.indexOf(check);
              if (idx !== -1) room._stateChangeCallbacks.splice(idx, 1);
              resolve(match);
              return;
            }
          }
        } else if (buffer.length > 0) {
          clearTimeout(timer);
          const idx = room._stateChangeCallbacks.indexOf(check);
          if (idx !== -1) room._stateChangeCallbacks.splice(idx, 1);
          resolve(buffer.shift());
        }
      };
      room._stateChangeCallbacks.push(check);
    } else {
      room.onMessage(type, (data) => {
        if (!predicate || predicate(data)) {
          clearTimeout(timer);
          resolve(data);
        }
      });
    }
  });
}

export function waitForPlayers(room, predicate, timeout = 5000) {
  return waitForMessage(room, "players", predicate, timeout);
}
