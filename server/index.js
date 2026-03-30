import express from 'express';
import { createServer } from 'http';
import colyseus from 'colyseus';
import { monitor } from '@colyseus/monitor';
import cors from 'cors';
import path from 'path';
import { fileURLToPath } from 'url';
import { GameRoom } from './rooms/GameRoom.js';

const { Server } = colyseus;
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = process.env.PORT || 2567;

const app = express();
app.use(cors());
app.use(express.json());

const httpServer = createServer(app);
const gameServer = new Server({ server: httpServer });

// Register game rooms
gameServer.define('game', GameRoom);

// Colyseus monitor (dev only)
if (process.env.NODE_ENV !== 'production') {
  app.use('/colyseus', monitor());
}

// Serve built client in production
if (process.env.NODE_ENV === 'production') {
  const clientDist = path.join(__dirname, '../client/dist');
  app.use(express.static(clientDist));
  app.get('*', (_req, res) => {
    res.sendFile(path.join(clientDist, 'index.html'));
  });
}

gameServer.listen(PORT).then(() => {
  console.log(`Server listening on port ${PORT}`);
});
