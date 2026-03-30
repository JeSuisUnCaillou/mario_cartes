import { Client } from "colyseus.js";

const CARD_ASSETS = {
  move_forward_1: "/card - move forward.svg",
};

function renderHand(hand) {
  const handArea = document.getElementById("hand-area");
  handArea.innerHTML = "";
  const n = hand.length;
  const angleStep = 10;
  hand.forEach((card, i) => {
    const img = document.createElement("img");
    img.src = CARD_ASSETS[card.type];
    img.className = "card";
    img.dataset.cardId = card.id;
    const offset = i - (n - 1) / 2;
    const rotation = offset * angleStep;
    const lift = -Math.abs(offset) * 5;
    img.style.transform = `rotate(${rotation}deg) translateY(${lift}px)`;
    handArea.appendChild(img);
  });
}

function updatePiles({ drawCount, discardCount }) {
  document.getElementById("draw-count").textContent = drawCount;
  document.getElementById("discard-count").textContent = discardCount;
  const drawBtn = document.getElementById("draw-btn");
  const handArea = document.getElementById("hand-area");
  const handEmpty = handArea.children.length === 0;
  drawBtn.style.display = handEmpty && drawCount > 0 ? "" : "none";
}

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
  const playerIdKey = `playerId:${gameId}`;
  const existingPlayerId = localStorage.getItem(playerIdKey);
  const existingName = localStorage.getItem("playerName");

  if (existingPlayerId && existingName) {
    startGame(gameId, existingName, existingPlayerId);
    return;
  }

  document.getElementById("app").innerHTML = `
    <div class="player-container">
      <h1>Game ${gameId}</h1>
      <form id="name-form">
        <label for="name-input">Enter your player name, 3 letters.</label>
        <div class="mt-1">
          <input id="name-input" type="text" maxlength="3" placeholder="KYU" autocomplete="off" value="${existingName || ""}" />
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
    localStorage.setItem("playerName", name);
    startGame(gameId, name, null);
  });
}

function startGame(gameId, name, existingPlayerId) {
  document.getElementById("app").innerHTML = `
    <div class="player-screen">
      <div class="top-zone">
        <input id="player-name" class="name-edit-input" type="text" maxlength="3" value="${name}" autocomplete="off" />
        <p id="status">Joining…</p>
      </div>
      <div id="play-zone" class="play-zone">
        <span class="play-zone-label">Drag a card here</span>
      </div>
      <div class="cards-zone">
        <div id="draw-pile" class="draw-pile">
          <div class="pile-count" id="draw-count">8</div>
          <button id="draw-btn" class="draw-btn">Draw</button>
        </div>
        <div id="hand-area" class="hand-area"></div>
        <div id="discard-pile" class="discard-pile">
          <div class="pile-count" id="discard-count">0</div>
        </div>
      </div>
    </div>
  `;

  const nameInput = document.getElementById("player-name");
  nameInput.addEventListener("input", () => {
    nameInput.value = nameInput.value.toUpperCase().replace(/[^A-Z]/g, "");
  });
  nameInput.addEventListener("focus", () => nameInput.select());

  const serverUrl = import.meta.env.DEV
    ? "ws://localhost:2567"
    : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;

  const client = new Client(serverUrl);

  const joinOptions = { type: "player", name };
  if (existingPlayerId) {
    joinOptions.playerId = existingPlayerId;
  }

  const playerIdKey = `playerId:${gameId}`;
  let myPlayerId = existingPlayerId;

  joinWithRetry(client, gameId, joinOptions)
    .then((room) => {
      document.getElementById("status").remove();

      room.onMessage("playerId", (id) => {
        myPlayerId = id;
        localStorage.setItem(playerIdKey, id);
      });

      room.onMessage("cardsDrawn", (data) => {
        renderHand(data.hand);
        updatePiles(data);
      });

      document.getElementById("draw-btn").addEventListener("click", () => {
        room.send("drawCards");
      });

      nameInput.addEventListener("change", () => {
        const newName = nameInput.value.trim() || "???";
        nameInput.value = newName;
        localStorage.setItem("playerName", newName);
        room.send("changeName", newName);
      });
    })
    .catch(() => {
      document.getElementById("status").textContent = "Could not connect to the game.";
    });
}
