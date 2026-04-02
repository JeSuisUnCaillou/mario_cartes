import "./style.css";
import { initBoard } from "./board.js";
import { initPlayer } from "./player.js";

const path = window.location.pathname;
const match = path.match(/^\/game\/([^/]+)\/(board|player)$/);

if (match) {
  const [, gameId, view] = match;
  if (view === "board") {
    initBoard(gameId);
  } else {
    initPlayer(gameId);
  }
}
