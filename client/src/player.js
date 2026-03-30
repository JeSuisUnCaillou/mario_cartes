import { Client } from "colyseus.js";

const CARD_ASSETS = {
  move_forward_1: "/card - move forward.svg",
};

let playing = false;
let currentRoom = null;

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
    const lift = Math.abs(offset) * 8;
    img.style.transform = `rotate(${rotation}deg) translateY(${lift}px)`;
    img.dataset.fanTransform = img.style.transform;
    addDragListeners(img);
    handArea.appendChild(img);
  });
}

function getPointerPos(e) {
  if (e.touches) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
  return { x: e.clientX, y: e.clientY };
}

function addDragListeners(card) {
  let startX, startY, origLeft, origTop;

  function onStart(e) {
    if (playing) return;
    e.preventDefault();
    const pos = getPointerPos(e);
    const rect = card.getBoundingClientRect();
    startX = pos.x;
    startY = pos.y;
    origLeft = rect.left;
    origTop = rect.top;

    card.style.position = "fixed";
    card.style.left = origLeft + "px";
    card.style.top = origTop + "px";
    card.style.transform = "scale(1.1)";
    card.style.zIndex = "1000";
    card.style.margin = "0";
    card.style.transition = "none";

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onEnd);
    document.addEventListener("touchmove", onMove, { passive: false });
    document.addEventListener("touchend", onEnd);
  }

  function onMove(e) {
    e.preventDefault();
    const pos = getPointerPos(e);
    const dx = pos.x - startX;
    const dy = pos.y - startY;
    card.style.left = (origLeft + dx) + "px";
    card.style.top = (origTop + dy) + "px";
  }

  function onEnd(e) {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onEnd);
    document.removeEventListener("touchmove", onMove);
    document.removeEventListener("touchend", onEnd);

    const endPos = e.changedTouches ? e.changedTouches[0] : e;
    const playZone = document.getElementById("play-zone");
    const zoneRect = playZone.getBoundingClientRect();
    const cardRect = card.getBoundingClientRect();
    const cardCenterX = cardRect.left + cardRect.width / 2;
    const cardCenterY = cardRect.top + cardRect.height / 2;

    const hit =
      cardCenterX >= zoneRect.left &&
      cardCenterX <= zoneRect.right &&
      cardCenterY >= zoneRect.top &&
      cardCenterY <= zoneRect.bottom;

    if (hit) {
      playing = true;
      card.style.transition = "all 0.3s ease";
      card.style.left = (zoneRect.left + zoneRect.width / 2 - cardRect.width / 2) + "px";
      card.style.top = (zoneRect.top + zoneRect.height / 2 - cardRect.height / 2) + "px";
      card.style.transform = "scale(1)";

      setTimeout(() => {
        if (currentRoom) {
          currentRoom.send("playCard", { cardId: card.dataset.cardId });
        }
      }, 500);
    } else {
      // Animate back to fan position
      card.style.position = "";
      card.style.left = "";
      card.style.top = "";
      card.style.zIndex = "";
      card.style.margin = "";
      card.style.transition = "";
      card.style.transform = card.dataset.fanTransform;
    }
  }

  card.addEventListener("mousedown", onStart);
  card.addEventListener("touchstart", onStart, { passive: false });
}

function renderPileContent(containerId, count, emptyLabel, iconSrc) {
  const container = document.getElementById(containerId);
  if (count === 0) {
    container.innerHTML = `<div class="pile-empty"><span>${emptyLabel}</span></div>`;
  } else {
    container.innerHTML = `
      <img class="pile-icon" src="${iconSrc}" alt="${emptyLabel}" />
      <div class="pile-count">${count}</div>
    `;
  }
}

function updatePiles({ drawCount, discardCount }) {
  renderPileContent("draw-pile-content", drawCount, "Draw pile", "/card - back.svg");
  renderPileContent("discard-pile-content", discardCount, "Discard pile", "/card - move forward.svg");
  const drawBtn = document.getElementById("draw-btn");
  const handArea = document.getElementById("hand-area");
  const handEmpty = handArea.children.length === 0;
  const totalAvailable = drawCount + discardCount;
  drawBtn.style.display = handEmpty && totalAvailable > 0 ? "" : "none";
  if (handEmpty && totalAvailable > 0) {
    drawBtn.textContent = `Draw ${Math.min(5, totalAvailable)} cards`;
  }
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
        <span class="play-zone-label">Drag a card here to play it</span>
      </div>
      <div class="cards-zone">
        <div id="draw-pile" class="draw-pile">
          <div id="draw-pile-content"></div>
          <button id="draw-btn" class="draw-btn">Draw 5 cards</button>
        </div>
        <div id="hand-area" class="hand-area"></div>
        <div id="discard-pile" class="discard-pile">
          <div id="discard-pile-content"></div>
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
      updatePiles({ drawCount: 8, discardCount: 0 });

      room.onMessage("playerId", (id) => {
        myPlayerId = id;
        localStorage.setItem(playerIdKey, id);
      });

      currentRoom = room;

      room.onMessage("cardsDrawn", (data) => {
        renderHand(data.hand);
        updatePiles(data);
      });

      room.onMessage("cardPlayed", (data) => {
        playing = false;
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
