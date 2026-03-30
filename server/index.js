const express = require("express");
const { createServer } = require("http");
const { Server } = require("colyseus");
const { WebSocketTransport } = require("@colyseus/ws-transport");

const app = express();
const httpServer = createServer(app);

const gameServer = new Server({
  transport: new WebSocketTransport({ server: httpServer }),
});

const port = process.env.PORT || 2567;
httpServer.listen(port, () => {
  console.log(`Server listening on port ${port}`);
});
