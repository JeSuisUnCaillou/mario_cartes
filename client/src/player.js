import { Client } from "colyseus.js";

const CARD_ASSETS = {
  move_forward_1: "/card - move forward.svg",
};

let playing = false;
let animating = false;
let currentRoom = null;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function animateShuffle(count) {
  const discardEl = document.getElementById("discard-pile");
  const drawEl = document.getElementById("draw-pile");
  const discardRect = discardEl.getBoundingClientRect();
  const drawRect = drawEl.getBoundingClientRect();

  for (let i = 0; i < count; i++) {
    const card = document.createElement("img");
    card.src = "/card - back.svg";
    card.className = "card-anim";
    card.style.position = "fixed";
    card.style.width = "40px";
    card.style.height = "auto";
    card.style.left = (discardRect.left + discardRect.width / 2 - 20) + "px";
    card.style.top = (discardRect.top) + "px";
    card.style.zIndex = "999";
    card.style.transition = "all 0.3s ease-in-out";
    card.style.pointerEvents = "none";
    document.body.appendChild(card);

    // Force reflow then animate to draw pile in arc
    card.getBoundingClientRect();
    card.style.left = (drawRect.left + drawRect.width / 2 - 20) + "px";
    card.style.top = (drawRect.top) + "px";

    await delay(120);
    card.addEventListener("transitionend", () => card.remove(), { once: true });
  }
  // Wait for last card transition to finish
  await delay(350);
}

async function animateDrawCards(hand) {
  const drawEl = document.getElementById("draw-pile");
  const drawRect = drawEl.getBoundingClientRect();
  const handArea = document.getElementById("hand-area");

  // Render cards invisibly first to get target positions
  handArea.innerHTML = "";
  const n = hand.length;
  const angleStep = 10;
  const cards = hand.map((card, i) => {
    const img = document.createElement("img");
    img.src = CARD_ASSETS[card.type];
    img.className = "card";
    img.dataset.cardId = card.id;
    const offset = i - (n - 1) / 2;
    const rotation = offset * angleStep;
    const lift = Math.abs(offset) * 8;
    img.dataset.fanTransform = `rotate(${rotation}deg) translateY(${lift}px)`;
    img.style.visibility = "hidden";
    img.style.transform = img.dataset.fanTransform;
    handArea.appendChild(img);
    return img;
  });

  // Animate each card from draw pile to its position
  for (let i = 0; i < cards.length; i++) {
    const img = cards[i];
    const targetRect = img.getBoundingClientRect();

    // Create flying card
    const flyer = document.createElement("img");
    flyer.src = "/card - back.svg";
    flyer.className = "card-anim";
    flyer.style.position = "fixed";
    flyer.style.width = "40px";
    flyer.style.height = "auto";
    flyer.style.left = (drawRect.left + drawRect.width / 2 - 20) + "px";
    flyer.style.top = drawRect.top + "px";
    flyer.style.zIndex = "999";
    flyer.style.transition = "all 0.35s ease-out";
    flyer.style.pointerEvents = "none";
    document.body.appendChild(flyer);

    // Force reflow then animate to target
    flyer.getBoundingClientRect();
    flyer.style.left = targetRect.left + "px";
    flyer.style.top = targetRect.top + "px";
    flyer.style.width = targetRect.width + "px";

    await delay(200);

    // Show the real card and remove flyer
    img.style.visibility = "";
    addDragListeners(img);
    flyer.addEventListener("transitionend", () => flyer.remove(), { once: true });
    // In case transition already ended
    setTimeout(() => flyer.remove(), 400);
  }
}

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
  let startX, startY, origLeft, origTop, dragClone;

  function onStart(e) {
    if (playing || animating) return;
    e.preventDefault();
    const pos = getPointerPos(e);
    const rect = card.getBoundingClientRect();
    startX = pos.x;
    startY = pos.y;
    origLeft = rect.left;
    origTop = rect.top;

    // Create a visual clone for dragging
    dragClone = card.cloneNode(true);
    dragClone.style.position = "fixed";
    dragClone.style.left = origLeft + "px";
    dragClone.style.top = origTop + "px";
    dragClone.style.width = rect.width + "px";
    dragClone.style.height = rect.height + "px";
    dragClone.style.transform = "scale(1.1)";
    dragClone.style.zIndex = "1000";
    dragClone.style.margin = "0";
    dragClone.style.transition = "none";
    dragClone.style.pointerEvents = "none";
    document.body.appendChild(dragClone);

    // Hide original to keep gap
    card.style.visibility = "hidden";

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
    dragClone.style.left = (origLeft + dx) + "px";
    dragClone.style.top = (origTop + dy) + "px";
  }

  function onEnd(e) {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onEnd);
    document.removeEventListener("touchmove", onMove);
    document.removeEventListener("touchend", onEnd);

    const playZone = document.getElementById("play-zone");
    const zoneRect = playZone.getBoundingClientRect();
    const cloneRect = dragClone.getBoundingClientRect();
    const centerX = cloneRect.left + cloneRect.width / 2;
    const centerY = cloneRect.top + cloneRect.height / 2;

    const hit =
      centerX >= zoneRect.left &&
      centerX <= zoneRect.right &&
      centerY >= zoneRect.top &&
      centerY <= zoneRect.bottom;

    if (hit) {
      playing = true;
      dragClone.style.transition = "all 0.3s ease";
      dragClone.style.left = (zoneRect.left + zoneRect.width / 2 - cloneRect.width / 2) + "px";
      dragClone.style.top = (zoneRect.top + zoneRect.height / 2 - cloneRect.height / 2) + "px";
      dragClone.style.transform = "scale(1)";

      setTimeout(() => {
        if (currentRoom) {
          currentRoom.send("playCard", { cardId: card.dataset.cardId });
        }
      }, 500);
    } else {
      // Snap back: remove clone, show original
      dragClone.remove();
      card.style.visibility = "";
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

      room.onMessage("cardsDrawn", async (data) => {
        if (animating) return;
        // On reconnect (hand already existed), just render without animation
        if (!data.shuffledCount && data.shuffledCount !== 0) {
          renderHand(data.hand);
          updatePiles(data);
          return;
        }
        animating = true;
        document.getElementById("draw-btn").style.display = "none";

        if (data.shuffledCount > 0) {
          await animateShuffle(data.shuffledCount);
        }

        updatePiles(data);
        await animateDrawCards(data.hand);
        animating = false;
      });

      room.onMessage("cardPlayed", (data) => {
        playing = false;
        document.querySelectorAll("body > .card").forEach((el) => el.remove());
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
