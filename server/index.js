const express = require("express");
const { createServer } = require("http");
const { Server, matchMaker } = require("colyseus");
const { WebSocketTransport } = require("@colyseus/ws-transport");
const { GameRoom } = require("./rooms/GameRoom");

const app = express();
const httpServer = createServer(app);

app.use(express.json());

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

const port = process.env.PORT || 2567;
httpServer.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
