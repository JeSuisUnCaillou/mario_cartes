import "./style.css";
import { initBoard } from "./board.js";
import { initPlayer } from "./player.js";

// Prevent screen from sleeping (like a video player)
async function requestWakeLock() {
  try {
    if (navigator.wakeLock) await navigator.wakeLock.request("screen");
  } catch { /* user or browser denied */ }
}
requestWakeLock();
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") requestWakeLock();
});

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
