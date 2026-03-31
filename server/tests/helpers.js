import { createRequire } from "module";
const require = createRequire(import.meta.url);

const express = require("express");
const { createServer } = require("http");
const { Server, matchMaker } = require("colyseus");
const { WebSocketTransport } = require("@colyseus/ws-transport");
const { Client } = require("colyseus.js");
const { GameRoom } = require("../rooms/GameRoom");

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

export async function createRoom(baseUrl) {
  const res = await fetch(`${baseUrl}/create`);
  const { id } = await res.json();
  return id;
}

function wsUrl(baseUrl) {
  return baseUrl.replace("http", "ws");
}

export async function connectPlayer(baseUrl, roomId, opts = {}) {
  const client = new Client(wsUrl(baseUrl));
  const playersPromise = new Promise((resolve) => {
    const originalJoinById = client.joinById.bind(client);
    client.joinById = async function (id, options) {
      const room = await originalJoinById(id, options);
      room.onMessage("playerId", (playerId) => resolve({ room, playerId }));
      return room;
    };
  });
  const room = await client.joinById(roomId, { type: "player", ...opts });
  if (opts.playerId) {
    return { room, playerId: opts.playerId };
  }
  const result = await playersPromise;
  return result;
}

export async function connectBoard(baseUrl, roomId) {
  const client = new Client(wsUrl(baseUrl));
  const room = await client.joinById(roomId, { type: "board" });
  return { room };
}

export function waitForMessage(room, type, timeout = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for message "${type}"`)),
      timeout,
    );
    room.onMessage(type, (data) => {
      clearTimeout(timer);
      resolve(data);
    });
  });
}

export function waitForPlayers(room, predicate, timeout = 5000) {
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
