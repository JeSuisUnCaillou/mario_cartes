import { Client } from "colyseus.js";

async function joinWithRetry(client, gameId, options, maxAttempts = 30, delayMs = 2000) {
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    try {
      return await client.joinById(gameId, options);
    } catch {
      if (attempt < maxAttempts - 1) {
        await new Promise((resolve) => setTimeout(resolve, delayMs));
      }
    }
  }
  throw new Error("Could not join room after multiple attempts");
}

export function initPlayer(gameId) {
  document.getElementById("app").innerHTML = `
    <div class="player-container">
      <h1>Player — Game ${gameId}</h1>
      <p id="status">Waiting for game to start…</p>
      <button id="ping-btn" disabled>Ping</button>
    </div>
  `;

  const serverUrl = import.meta.env.DEV
    ? "ws://localhost:2567"
    : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;

  const client = new Client(serverUrl);

  joinWithRetry(client, gameId, { type: "player" })
    .then((room) => {
      document.getElementById("status").remove();
      const btn = document.getElementById("ping-btn");
      btn.disabled = false;
      btn.addEventListener("click", () => {
        room.send("ping");
      });
    })
    .catch(() => {
      document.getElementById("status").textContent = "Could not connect to the game.";
    });
}
