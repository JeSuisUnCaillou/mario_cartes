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
      <h1>Game ${gameId}</h1>
      <form id="name-form">
        <input id="name-input" type="text" maxlength="3" placeholder="AAA" autocomplete="off" />
        <button type="submit">Join</button>
      </form>
    </div>
  `;

  const nameInput = document.getElementById("name-input");
  nameInput.focus();
  nameInput.addEventListener("input", () => {
    nameInput.value = nameInput.value.toUpperCase().replace(/[^A-Z]/g, "");
  });

  document.getElementById("name-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = nameInput.value.trim() || "???";
    startGame(gameId, name);
  });
}

function startGame(gameId, name) {
  document.getElementById("app").innerHTML = `
    <div class="player-container">
      <h1>Game ${gameId}</h1>
      <p id="status">Joining as <strong>${name}</strong>…</p>
      <button id="ping-btn" disabled>Ping</button>
    </div>
  `;

  const serverUrl = import.meta.env.DEV
    ? "ws://localhost:2567"
    : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;

  const client = new Client(serverUrl);

  joinWithRetry(client, gameId, { type: "player", name })
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
