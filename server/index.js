import express from "express";
import path from "path";
import { fileURLToPath } from "url";
import { Server, matchMaker } from "colyseus";
import { GameRoom } from "./rooms/GameRoom.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const clientDist = path.join(__dirname, "../client/dist");

const gameServer = new Server({
  pingInterval: 5000,
  pingMaxRetries: 5,
  express: (app) => {
    app.use(express.json());
    app.use(express.static(clientDist));

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

    app.get("/", (req, res) => {
      res.sendFile(path.join(clientDist, "home.html"));
    });

    app.get("/game/*", (req, res) => {
      res.sendFile(path.join(clientDist, "index.html"));
    });
  },
});

gameServer.define("game", GameRoom);

const port = process.env.PORT || 2567;
gameServer.listen(port);
