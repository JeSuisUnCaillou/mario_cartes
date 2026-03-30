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
        <label for="name-input">Enter your player name, 3 letters.</label>
        <div class="mt-1">
          <input id="name-input" type="text" maxlength="3" placeholder="KYU" autocomplete="off" />
          <button type="submit">Join</button>
        </div>
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
      <h2 id="player-name" class="editable-name">${name}</h2>
      <p id="status">Joining…</p>
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
      setupEditableName(room, name);
    })
    .catch(() => {
      document.getElementById("status").textContent = "Could not connect to the game.";
    });
}

function setupEditableName(room, currentName) {
  const nameEl = document.getElementById("player-name");

  nameEl.addEventListener("click", () => {
    if (nameEl.querySelector("input")) return;

    const input = document.createElement("input");
    input.type = "text";
    input.maxLength = 3;
    input.value = currentName;
    input.className = "name-edit-input";
    input.autocomplete = "off";

    input.addEventListener("input", () => {
      input.value = input.value.toUpperCase().replace(/[^A-Z]/g, "");
    });

    const commit = () => {
      const newName = input.value.trim() || currentName;
      currentName = newName;
      nameEl.textContent = currentName;
      room.send("changeName", currentName);
    };

    input.addEventListener("blur", commit);
    input.addEventListener("keydown", (e) => {
      if (e.key === "Enter") input.blur();
    });

    nameEl.textContent = "";
    nameEl.appendChild(input);
    input.focus();
    input.select();
  });
}
