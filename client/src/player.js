import { Client } from "colyseus.js";
import { isPointInRect, splitDrawBatches, initialDrawPileCount, normalizeName, cardItemPositions } from "./player.functions.js";
import { renderRivers } from "./river.js";

function ordinalSuffix(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

const ITEM_ICONS = {
  coin: "/coin.svg",
  banana: "/banana.svg",
  mushroom: "/mushroom.svg",
};

const cardElements = new Map();

function createCardElement(card) {
  const container = document.createElement("div");
  container.className = "card";
  container.dataset.cardId = card.id;
  container.dataset.items = JSON.stringify(card.items);

  const bg = document.createElement("img");
  bg.src = "/card - blank.svg";
  bg.className = "card-bg";
  bg.draggable = false;
  container.appendChild(bg);

  const positions = cardItemPositions(card.items.length);
  card.items.forEach((item, i) => {
    const icon = document.createElement("img");
    icon.src = ITEM_ICONS[item];
    icon.className = "card-item";
    icon.style.left = positions[i].x;
    icon.style.top = positions[i].y;
    icon.draggable = false;
    container.appendChild(icon);
  });

  return container;
}

function ensureCardElements(deck) {
  if (!deck) return;
  for (const card of deck) {
    if (!cardElements.has(card.id)) {
      cardElements.set(card.id, createCardElement(card));
    }
  }
}

function getCardElement(card) {
  if (!cardElements.has(card.id)) {
    cardElements.set(card.id, createCardElement(card));
  }
  return cardElements.get(card.id);
}

let playing = false;
let animating = false;
let animDrawCount = 0;
let currentRoom = null;
let pendingDiscards = 0;
let gamePhase = "lobby";
let isReady = false;
let myPlayerId = null;
let activePlayerId = null;
let latestRivers = null;
let currentCoins = 0;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function spawnThrowAnimation(imageSrc, playZone) {
  const zoneRect = playZone.getBoundingClientRect();
  const el = document.createElement("img");
  el.src = imageSrc;
  el.className = "item-throw";
  el.style.position = "fixed";
  el.style.width = "60px";
  el.style.height = "auto";
  el.style.left = (zoneRect.left + zoneRect.width / 2 - 30) + "px";
  el.style.top = (zoneRect.top + zoneRect.height / 2 - 30) + "px";
  el.style.zIndex = "999";
  el.style.pointerEvents = "none";
  document.body.appendChild(el);
  el.addEventListener("animationend", () => el.remove(), { once: true });
}

async function animateShuffle(count) {
  const discardEl = document.getElementById("discard-pile");
  const drawEl = document.getElementById("draw-pile");
  const discardRect = discardEl.getBoundingClientRect();
  const drawRect = drawEl.getBoundingClientRect();
  let remaining = count;

  for (let i = 0; i < count; i++) {
    remaining--;
    renderPileContent("discard-pile-content", remaining, "Discard pile", "/card - back.svg");
    updatePileCount("discard-count", remaining);

    const card = document.createElement("img");
    card.src = "/card - back.svg";
    card.className = "card-anim";
    card.style.position = "fixed";
    card.style.width = "40px";
    card.style.height = "auto";
    card.style.left = (discardRect.left + discardRect.width / 2 - 20) + "px";
    card.style.top = (discardRect.top) + "px";
    card.style.zIndex = "999";
    card.style.transition = "all 0.12s ease-in-out";
    card.style.pointerEvents = "none";
    document.body.appendChild(card);

    // Force reflow then animate to draw pile in arc
    card.getBoundingClientRect();
    card.style.left = (drawRect.left + drawRect.width / 2 - 20) + "px";
    card.style.top = (drawRect.top) + "px";

    await delay(50);
    card.addEventListener("transitionend", () => card.remove(), { once: true });
  }
  // Wait for last card transition to finish
  await delay(150);
}

async function animateDrawCards(cards, startIndex = 0) {
  const drawEl = document.getElementById("draw-pile");
  const drawRect = drawEl.getBoundingClientRect();
  const handArea = document.getElementById("hand-area");

  // If first batch, clear hand area
  if (startIndex === 0) {
    handArea.innerHTML = "";
  }

  // Animate each card one by one: add to DOM, recompute fan, fly in
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const el = getCardElement(card);
    el.style.visibility = "hidden";
    el.style.transform = "rotate(0deg) translateY(0px)";
    handArea.appendChild(el);

    // Recompute fan for all visible cards + this new one
    const allCards = Array.from(handArea.children);
    const visibleCount = allCards.length;
    const angleStep = 10;
    allCards.forEach((c, idx) => {
      const offset = idx - (visibleCount - 1) / 2;
      const rotation = offset * angleStep;
      const lift = Math.abs(offset) * 8;
      c.dataset.fanTransform = `rotate(${rotation}deg) translateY(${lift}px)`;
      // Existing visible cards animate via CSS transition
      if (c !== el) {
        c.style.transform = c.dataset.fanTransform;
      }
    });

    // Set the new card's transform to get its target position
    el.style.transform = el.dataset.fanTransform;
    const targetRect = el.getBoundingClientRect();

    // Update draw pile count
    animDrawCount--;
    renderPileContent("draw-pile-content", animDrawCount, "Draw pile", "/card - back.svg");
    updatePileCount("draw-count", animDrawCount);

    // Create 3D flipping card that flies from draw pile to hand
    const flyer = document.createElement("div");
    flyer.className = "card-flyer";
    flyer.style.position = "fixed";
    flyer.style.width = "40px";
    flyer.style.aspectRatio = "54 / 86";
    flyer.style.left = (drawRect.left + drawRect.width / 2 - 20) + "px";
    flyer.style.top = drawRect.top + "px";
    flyer.style.zIndex = "999";
    flyer.style.pointerEvents = "none";
    flyer.style.perspective = "600px";

    const inner = document.createElement("div");
    inner.className = "card-flyer-inner";
    inner.style.transition = "transform 0.25s ease-in-out";
    inner.style.transform = "rotateY(0deg)";

    const backFace = document.createElement("img");
    backFace.src = "/card - back.svg";
    backFace.className = "card-flyer-face card-flyer-back";

    const frontFace = el.cloneNode(true);
    frontFace.className = "card-flyer-face card-flyer-front";
    frontFace.style.cssText = "";

    inner.appendChild(backFace);
    inner.appendChild(frontFace);
    flyer.appendChild(inner);
    document.body.appendChild(flyer);

    // Force reflow, then animate position + size + flip
    flyer.getBoundingClientRect();
    const flyDuration = 250;
    flyer.style.transition = `left ${flyDuration}ms ease-out, top ${flyDuration}ms ease-out, width ${flyDuration}ms ease-out`;
    flyer.style.left = targetRect.left + "px";
    flyer.style.top = targetRect.top + "px";
    flyer.style.width = targetRect.width + "px";
    inner.style.transform = "rotateY(180deg)";

    // Wait for fly+flip to fully complete, then swap instantly
    await new Promise((resolve) => {
      flyer.addEventListener("transitionend", () => {
        el.style.visibility = "";
        addDragListeners(el);
        flyer.remove();
        resolve();
      }, { once: true });
    });
  }
}

function captureHandPositions() {
  const handArea = document.getElementById("hand-area");
  const cards = Array.from(handArea.querySelectorAll(".card"));
  const positions = new Map();
  cards.forEach((img) => {
    positions.set(img.dataset.cardId, img.getBoundingClientRect());
  });
  return positions;
}

function recomputeFan(previousPositions) {
  const handArea = document.getElementById("hand-area");
  const cards = Array.from(handArea.querySelectorAll(".card:not([style*='visibility: hidden'])"));
  const n = cards.length;
  const angleStep = 10;

  // Compute and apply new fan transforms without transition
  cards.forEach((img, i) => {
    img.style.transition = "none";
    const offset = i - (n - 1) / 2;
    const rotation = offset * angleStep;
    const lift = Math.abs(offset) * 8;
    img.dataset.fanTransform = `rotate(${rotation}deg) translateY(${lift}px)`;
    img.style.transform = img.dataset.fanTransform;
  });

  // FLIP: Invert — if we have previous positions, offset cards back to where they were
  if (previousPositions) {
    cards.forEach((img) => {
      const oldRect = previousPositions.get(img.dataset.cardId);
      if (oldRect) {
        const newRect = img.getBoundingClientRect();
        const dx = oldRect.left - newRect.left;
        const dy = oldRect.top - newRect.top;
        img.style.transform = `translate(${dx}px, ${dy}px) ${img.dataset.fanTransform}`;
      }
    });
  }

  // FLIP: Play — force reflow then animate to final positions
  handArea.getBoundingClientRect();
  cards.forEach((img) => {
    img.style.transition = "transform 0.4s ease-in-out, margin-left 0.4s ease-in-out";
    img.style.transform = img.dataset.fanTransform;
  });
}

function renderHand(hand) {
  const handArea = document.getElementById("hand-area");
  handArea.innerHTML = "";
  const n = hand.length;
  const angleStep = 10;
  hand.forEach((card, i) => {
    const el = getCardElement(card);
    const offset = i - (n - 1) / 2;
    const rotation = offset * angleStep;
    const lift = Math.abs(offset) * 8;
    el.style.transform = `rotate(${rotation}deg) translateY(${lift}px)`;
    el.dataset.fanTransform = el.style.transform;
    addDragListeners(el);
    handArea.appendChild(el);
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
    dragClone.style.filter = "drop-shadow(10px 15px 4px rgba(0, 0, 0, 0.35))";
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

    const inZone = isPointInRect(centerX, centerY, zoneRect.left, zoneRect.top, zoneRect.right, zoneRect.bottom);

    if (inZone && playZone.classList.contains("waiting")) {
      playZone.classList.add("waiting-reject");
      playZone.addEventListener("animationend", () => {
        playZone.classList.remove("waiting-reject");
      }, { once: true });
    }

    if (inZone && !playZone.classList.contains("waiting")) {
      playing = true;
      dragClone.style.transition = "all 0.3s ease";
      dragClone.style.left = (zoneRect.left + zoneRect.width / 2 - cloneRect.width / 2) + "px";
      dragClone.style.top = (zoneRect.top + zoneRect.height / 2 - cloneRect.height / 2) + "px";
      dragClone.style.transform = "scale(1)";
      dragClone.style.filter = "drop-shadow(2px 2px 1px rgba(0, 0, 0, 0.3))";

      setTimeout(() => {
        if (currentRoom) {
          if (pendingDiscards > 0) {
            currentRoom.send("discardCard", { cardId: card.dataset.cardId });
          } else {
            currentRoom.send("playCard", { cardId: card.dataset.cardId });
          }
        }
      }, 500);
    } else {
      // Animate back to original position
      dragClone.style.transition = "all 0.3s ease-in-out";
      dragClone.style.left = origLeft + "px";
      dragClone.style.top = origTop + "px";
      dragClone.style.transform = card.dataset.fanTransform;
      dragClone.addEventListener("transitionend", () => {
        dragClone.remove();
        card.style.visibility = "";
      }, { once: true });
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
    container.innerHTML = `<img class="pile-icon" src="${iconSrc}" alt="${emptyLabel}" />`;
  }
}

function updatePileCount(countId, count) {
  document.getElementById(countId).textContent = count;
}

function updatePiles({ drawCount, discardCount, discardTopCard }) {
  renderPileContent("draw-pile-content", drawCount, "Draw pile", "/card - back.svg");
  const discardContainer = document.getElementById("discard-pile-content");
  if (discardCount === 0) {
    discardContainer.innerHTML = `<div class="pile-empty"><span>Discard pile</span></div>`;
  } else if (discardTopCard) {
    const miniCard = createCardElement(discardTopCard);
    miniCard.className = "card pile-card";
    discardContainer.innerHTML = "";
    discardContainer.appendChild(miniCard);
  }
  updatePileCount("draw-count", drawCount);
  updatePileCount("discard-count", discardCount);
}

function updateBuyButton() {
  const container = document.getElementById("buy-btn-container");
  if (!container) return;
  const isMyTurn = activePlayerId === myPlayerId;
  if (isMyTurn && latestRivers && pendingDiscards === 0) {
    if (!document.getElementById("buy-btn")) {
      container.innerHTML = `<button id="buy-btn" class="buy-btn">Buy cards</button>`;
      document.getElementById("buy-btn").addEventListener("click", openBuyModal);
    }
    container.style.display = "";
  } else {
    container.style.display = "none";
  }
}

function openBuyModal() {
  if (document.querySelector(".buy-modal")) return;
  const overlay = document.createElement("div");
  overlay.className = "buy-modal";
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay) closeBuyModal();
  });

  const closeBtn = document.createElement("button");
  closeBtn.className = "buy-modal-close";
  closeBtn.textContent = "✕";
  closeBtn.addEventListener("click", closeBuyModal);
  overlay.appendChild(closeBtn);

  const content = document.createElement("div");
  content.className = "buy-modal-content";
  overlay.appendChild(content);

  document.body.appendChild(overlay);
  renderBuyModal();
}

function renderBuyModal() {
  const content = document.querySelector(".buy-modal-content");
  if (!content || !latestRivers) return;
  renderRivers(content, latestRivers, {
    onCardClick: (river, card) => {
      if (currentRoom) {
        currentRoom.send("buyCard", { riverId: river.id, cardId: card.id });
      }
    },
    isAffordable: (river) => currentCoins >= river.cost,
  });
}

function closeBuyModal() {
  const modal = document.querySelector(".buy-modal");
  if (modal) modal.remove();
}

function updatePlayZone() {
  const playZone = document.getElementById("play-zone");
  const endTurnContainer = document.getElementById("end-turn-container");
  if (!playZone) return;
  // Ensure end-turn button exists (create once, toggle visibility)
  if (endTurnContainer && !document.getElementById("end-turn-btn")) {
    endTurnContainer.innerHTML = `<button id="end-turn-btn" class="end-turn-btn">End turn</button>`;
    document.getElementById("end-turn-btn").addEventListener("click", () => {
      if (playing || animating || pendingDiscards > 0) return;
      if (currentRoom) currentRoom.send("endTurn");
    });
  }
  const endTurnBtn = document.getElementById("end-turn-btn");
  if (playZone.classList.contains("banana-hit")) {
    if (endTurnBtn) {
      endTurnBtn.style.visibility = "";
      endTurnBtn.disabled = true;
      endTurnBtn.classList.add("disabled");
    }
    return;
  }
  if (activePlayerId !== myPlayerId) {
    playZone.classList.add("waiting");
    playZone.innerHTML = `<span class="play-zone-label">Wait for your turn to play</span>`;
    if (endTurnBtn) endTurnBtn.style.visibility = "hidden";
  } else {
    playZone.classList.remove("waiting");
    playZone.innerHTML = `<span class="play-zone-label">Drag a card here to play it</span>`;
    if (endTurnBtn) {
      endTurnBtn.style.visibility = "";
      endTurnBtn.disabled = false;
      endTurnBtn.classList.remove("disabled");
    }
  }
}

function updateCoinDisplay(coins) {
  currentCoins = coins;
  const coinDisplay = document.getElementById("coin-display");
  if (!coinDisplay) return;
  coinDisplay.innerHTML = "";
  for (let i = 0; i < coins; i++) {
    const img = document.createElement("img");
    img.src = "/coin.svg";
    img.className = "coin-icon";
    coinDisplay.appendChild(img);
  }
  updateBuyButton();
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

  // Join room immediately to check if game is still joinable
  // If we have an existing playerId (reload during name form), reuse it
  document.getElementById("app").innerHTML = `
    <div class="player-container">
      <p>Joining…</p>
    </div>
  `;

  const serverUrl = import.meta.env.DEV
    ? "ws://localhost:2567"
    : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;
  const client = new Client(serverUrl);

  const joinOptions = { type: "player", name: "???" };
  if (existingPlayerId) {
    joinOptions.playerId = existingPlayerId;
  }

  joinWithRetry(client, gameId, joinOptions)
    .then((room) => {
      room.onMessage("gameAlreadyStarted", () => {
        document.getElementById("app").innerHTML = `
          <div class="player-screen">
            <div class="lobby-zone game-rejected">
              <span class="rejected-message">You can't join, the game has already started.</span>
            </div>
          </div>
        `;
      });

      room.onMessage("playerId", (id) => {
        myPlayerId = id;
        localStorage.setItem(playerIdKey, id);
        showNameForm(gameId, room);
      });

      // Reconnecting existing player without a name — show name form
      if (existingPlayerId) {
        myPlayerId = existingPlayerId;
        showNameForm(gameId, room);
      }
    })
    .catch(() => {
      document.getElementById("app").innerHTML = `
        <div class="player-container">
          <p>Could not connect to the game.</p>
        </div>
      `;
    });
}

function showNameForm(gameId, room) {
  const existingName = localStorage.getItem("playerName");
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
    nameInput.value = normalizeName(nameInput.value);
  });

  document.getElementById("name-form").addEventListener("submit", (e) => {
    e.preventDefault();
    const name = nameInput.value.trim() || "???";
    localStorage.setItem("playerName", name);
    room.send("changeName", name);
    startGame(gameId, name, myPlayerId, room);
  });
}

function renderLobby(room) {
  const lobbyZone = document.getElementById("lobby-zone");
  if (!lobbyZone) return;
  if (isReady) {
    lobbyZone.innerHTML = `
      <div class="ready-message">You are ready</div>
      <button id="cancel-btn" class="cancel-btn">Cancel</button>
    `;
    document.getElementById("cancel-btn").addEventListener("click", () => {
      isReady = false;
      room.send("setReady", false);
      renderLobby(room);
    });
  } else {
    lobbyZone.innerHTML = `
      <button id="ready-btn" class="ready-btn">READY</button>
    `;
    document.getElementById("ready-btn").addEventListener("click", () => {
      isReady = true;
      room.send("setReady", true);
      renderLobby(room);
    });
  }
}

function renderFinishedZone(container, ranking, room) {
  const medals = ["🥇", "🥈", "🥉"];
  container.innerHTML = `
    <h2 class="finished-title">Race Complete!</h2>
    <ol class="finished-list">
      ${(ranking || []).map((entry) => {
        const medal = medals[entry.rank - 1] || "";
        const ordinal = ordinalSuffix(entry.rank);
        return `<li class="finished-entry"><span class="finished-rank">${medal} ${ordinal}</span><span class="finished-name">${entry.name}</span></li>`;
      }).join("")}
    </ol>
    <button id="start-over-btn" class="start-over-btn">Start Over</button>
  `;
  document.getElementById("start-over-btn").addEventListener("click", () => {
    room.send("startOver");
  });
}

function startGame(gameId, name, existingPlayerId, existingRoom) {
  document.getElementById("app").innerHTML = `
    <div class="player-screen">
      <div class="top-zone">
        <input id="player-name" class="name-edit-input" type="text" maxlength="3" value="${name}" autocomplete="off" />
        ${existingRoom ? "" : '<p id="status">Joining…</p>'}
      </div>
      <div id="lobby-zone" class="lobby-zone"></div>
      <div id="finished-zone" class="finished-zone" style="display: none;"></div>
      <div id="game-zone" class="game-zone" style="display: none;">
        <div id="end-turn-container" class="end-turn-container"></div>
        <div id="play-zone" class="play-zone">
          <span class="play-zone-label">Drag a card here to play it</span>
        </div>
        <div id="coin-display" class="coin-display"></div>
        <div id="buy-btn-container" class="buy-btn-container" style="display:none"></div>
        <div class="cards-zone">
          <div id="draw-pile" class="draw-pile">
            <div id="draw-pile-content"></div>
            <div class="pile-count" id="draw-count">8</div>
          </div>
          <div id="hand-area" class="hand-area"></div>
          <div id="discard-pile" class="discard-pile">
            <div id="discard-pile-content"></div>
            <div class="pile-count" id="discard-count">0</div>
          </div>
        </div>
      </div>
    </div>
  `;

  const nameInput = document.getElementById("player-name");
  nameInput.addEventListener("input", () => {
    nameInput.value = normalizeName(nameInput.value);
  });
  nameInput.addEventListener("focus", () => nameInput.select());

  const playerIdKey = `playerId:${gameId}`;

  function setupRoom(room) {
    renderLobby(room);
    currentRoom = room;

      room.onMessage("gameState", (data) => {
        gamePhase = data.phase;
        activePlayerId = data.activePlayerId;
        if (data.rivers) latestRivers = data.rivers;

        const lobbyZone = document.getElementById("lobby-zone");
        const gameZone = document.getElementById("game-zone");
        const finishedZone = document.getElementById("finished-zone");

        if (data.phase === "playing") {
          if (lobbyZone) lobbyZone.style.display = "none";
          if (finishedZone) finishedZone.style.display = "none";
          if (gameZone && gameZone.style.display === "none") {
            gameZone.style.display = "";
          }
        } else if (data.phase === "finished") {
          if (lobbyZone) lobbyZone.style.display = "none";
          if (gameZone) gameZone.style.display = "none";
          if (finishedZone) {
            finishedZone.style.display = "";
            renderFinishedZone(finishedZone, data.ranking, room);
          }
        } else if (data.phase === "lobby") {
          if (gameZone) gameZone.style.display = "none";
          if (finishedZone) finishedZone.style.display = "none";
          if (lobbyZone) {
            lobbyZone.style.display = "";
            renderLobby(room);
          }
        }

        updatePlayZone();
        updateBuyButton();
        if (document.querySelector(".buy-modal")) renderBuyModal();
      });

      room.onMessage("players", (players) => {
        if (gamePhase === "lobby" && myPlayerId) {
          const me = players.find((p) => p.playerId === myPlayerId);
          if (me && me.ready !== isReady) {
            isReady = me.ready;
            renderLobby(room);
          }
        }
      });

      room.onMessage("cardsDrawn", async (data) => {
        if (animating) return;
        ensureCardElements(data.deck);
        // On reconnect (hand already existed), just render without animation
        if (data.drawnBeforeShuffle === undefined) {
          renderHand(data.hand);
          updatePiles(data);
          updateCoinDisplay(data.coins || 0);
          if (data.pendingBananaDiscards > 0) {
            pendingDiscards = data.pendingBananaDiscards;
            const playZone = document.getElementById("play-zone");
            playZone.classList.add("banana-hit");
            playZone.innerHTML = `
              <img src="/banana.svg" class="play-zone-banana" />
              <span class="play-zone-label">Banana! Drag a card here to discard it.</span>
            `;
            updatePlayZone();
          }
          return;
        }
        animating = true;

        const { firstBatch, secondBatch } = splitDrawBatches(data.hand, data.drawnBeforeShuffle);
        animDrawCount = initialDrawPileCount(data.drawCount, data.hand.length, data.shuffledCount, data.drawnBeforeShuffle);

        // Draw first batch (cards from draw pile before shuffle)
        if (firstBatch.length > 0) {
          await animateDrawCards(firstBatch);
        }

        // Shuffle animation if needed
        if (data.shuffledCount > 0) {
          await animateShuffle(data.shuffledCount);
          // After shuffle, draw pile is refilled
          animDrawCount = data.drawCount + secondBatch.length;
          renderPileContent("draw-pile-content", animDrawCount, "Draw pile", "/card - back.svg");
          updatePileCount("draw-count", animDrawCount);
        }

        // Draw second batch (cards from draw pile after shuffle)
        if (secondBatch.length > 0) {
          await animateDrawCards(secondBatch, firstBatch.length);
        }

        updatePiles(data);
        animating = false;
      });

      room.onMessage("cardPlayed", (data) => {
        playing = false;
        ensureCardElements(data.deck);
        // Capture positions BEFORE removing the card
        const positions = captureHandPositions();
        // Remove the played card from the hand
        const handArea = document.getElementById("hand-area");
        const played = handArea.querySelector(`[data-card-id="${data.cardId}"]`);
        if (played) played.remove();
        // Animate remaining cards from old positions to new fan positions
        recomputeFan(positions);

        // Throw animation for banana or coin
        const playZone = document.getElementById("play-zone");
        if (data.droppedBanana !== null && data.droppedBanana !== undefined) {
          spawnThrowAnimation("/banana.svg", playZone);
        }
        for (let i = 0; i < data.coinGained; i++) {
          setTimeout(() => spawnThrowAnimation("/coin.svg", playZone), i * 400);
        }

        updateCoinDisplay(data.coins);

        // Animate drag clone from play zone to discard pile
        const discardEl = document.getElementById("discard-pile");
        const discardRect = discardEl.getBoundingClientRect();
        const clones = document.querySelectorAll("body > .card");
        clones.forEach((clone) => {
          clone.style.transition = "all 0.3s ease-in-out";
          clone.style.left = (discardRect.left + discardRect.width / 2 - 25) + "px";
          clone.style.top = discardRect.top + "px";
          clone.style.width = "50px";
          clone.style.height = "auto";
          clone.style.transform = "rotate(0deg)";
          clone.style.filter = "none";
          clone.addEventListener("transitionend", () => {
            clone.remove();
            updatePiles(data);
          }, { once: true });
        });
        if (clones.length === 0) {
          updatePiles(data);
        }
      });

      room.onMessage("bananaHit", async (data) => {
        const playZone = document.getElementById("play-zone");
        const zoneRect = playZone.getBoundingClientRect();

        // Crash animation: banana falls from above into the play zone
        const crashBanana = document.createElement("img");
        crashBanana.src = "/banana.svg";
        crashBanana.className = "banana-crash";
        crashBanana.style.position = "fixed";
        crashBanana.style.width = "80px";
        crashBanana.style.height = "auto";
        crashBanana.style.left = (zoneRect.left + zoneRect.width / 2 - 40) + "px";
        crashBanana.style.top = "-100px";
        crashBanana.style.zIndex = "999";
        crashBanana.style.pointerEvents = "none";
        document.body.appendChild(crashBanana);
        crashBanana.getBoundingClientRect();
        crashBanana.style.transition = "all 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)";
        crashBanana.style.top = (zoneRect.top + zoneRect.height / 2 - 40) + "px";
        await new Promise((resolve) => {
          crashBanana.addEventListener("transitionend", resolve, { once: true });
        });
        crashBanana.remove();

        // Auto-draw if server drew cards for us
        if (data.autoDrawn) {
          animating = true;
          const drawData = data.autoDrawn;
          const { firstBatch, secondBatch } = splitDrawBatches(drawData.hand, drawData.drawnBeforeShuffle);
          animDrawCount = initialDrawPileCount(drawData.drawCount, drawData.hand.length, drawData.shuffledCount, drawData.drawnBeforeShuffle);
          if (firstBatch.length > 0) await animateDrawCards(firstBatch);
          if (drawData.shuffledCount > 0) {
            await animateShuffle(drawData.shuffledCount);
            animDrawCount = drawData.drawCount + secondBatch.length;
            renderPileContent("draw-pile-content", animDrawCount, "Draw pile", "/card - back.svg");
            updatePileCount("draw-count", animDrawCount);
          }
          if (secondBatch.length > 0) await animateDrawCards(secondBatch, firstBatch.length);
          updatePiles(drawData);
          animating = false;
        }

        // Enter banana discard mode
        pendingDiscards = data.mustDiscard;
        closeBuyModal();
        updateBuyButton();
        playZone.classList.add("banana-hit");
        playZone.innerHTML = `
          <img src="/banana.svg" class="play-zone-banana" />
          <span class="play-zone-label"><h2>Banana!</h2><br />Drag a card here to discard it.</span>
        `;
        updatePlayZone();
      });

      room.onMessage("cardDiscarded", (data) => {
        playing = false;
        ensureCardElements(data.deck);
        // Remove the discarded card from hand
        const positions = captureHandPositions();
        const handArea = document.getElementById("hand-area");
        const discarded = handArea.querySelector(`[data-card-id="${data.cardId}"]`);
        if (discarded) discarded.remove();
        recomputeFan(positions);

        // Animate clone to discard pile
        const discardEl = document.getElementById("discard-pile");
        const discardRect = discardEl.getBoundingClientRect();
        const clones = document.querySelectorAll("body > .card");
        clones.forEach((clone) => {
          clone.style.transition = "all 0.3s ease-in-out";
          clone.style.left = (discardRect.left + discardRect.width / 2 - 25) + "px";
          clone.style.top = discardRect.top + "px";
          clone.style.width = "50px";
          clone.style.height = "auto";
          clone.style.transform = "rotate(0deg)";
          clone.style.filter = "none";
          clone.addEventListener("transitionend", () => {
            clone.remove();
            updatePiles(data);
          }, { once: true });
        });
        if (clones.length === 0) {
          updatePiles(data);
        }

        // Restore play zone when all discards are done
        if (data.remaining <= 0) {
          pendingDiscards = 0;
          const playZone = document.getElementById("play-zone");
          playZone.classList.remove("banana-hit");
          updatePlayZone();
          updateBuyButton();
        }
      });

      room.onMessage("cardBought", (data) => {
        ensureCardElements(data.deck);
        currentCoins = data.coins;
        updateCoinDisplay(data.coins);
        updatePiles(data);
        updateBuyButton();

        // Animate bought card from modal to discard pile
        const modal = document.querySelector(".buy-modal");
        const discardEl = document.getElementById("discard-pile");
        if (modal && discardEl) {
          const boughtEl = modal.querySelector(`[data-card-id="${data.cardId}"]`);
          if (boughtEl) {
            const srcRect = boughtEl.getBoundingClientRect();
            const discardRect = discardEl.getBoundingClientRect();
            const clone = boughtEl.cloneNode(true);
            clone.style.position = "fixed";
            clone.style.left = srcRect.left + "px";
            clone.style.top = srcRect.top + "px";
            clone.style.width = srcRect.width + "px";
            clone.style.height = srcRect.height + "px";
            clone.style.zIndex = "200";
            clone.style.margin = "0";
            clone.style.transition = "all 0.3s ease-in-out";
            document.body.appendChild(clone);
            requestAnimationFrame(() => {
              clone.style.left = (discardRect.left + discardRect.width / 2 - 25) + "px";
              clone.style.top = discardRect.top + "px";
              clone.style.width = "50px";
              clone.style.height = "auto";
              clone.addEventListener("transitionend", () => clone.remove(), { once: true });
            });
          }
          // Re-render modal with updated rivers and coins
          if (latestRivers) renderBuyModal();
        }
      });

      nameInput.addEventListener("change", () => {
        const newName = nameInput.value.trim() || "???";
        nameInput.value = newName;
        localStorage.setItem("playerName", newName);
        room.send("changeName", newName);
      });
  }

  if (existingRoom) {
    setupRoom(existingRoom);
  } else {
    const serverUrl = import.meta.env.DEV
      ? "ws://localhost:2567"
      : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;
    const client = new Client(serverUrl);
    const joinOptions = { type: "player", name };
    if (existingPlayerId) {
      joinOptions.playerId = existingPlayerId;
    }
    myPlayerId = existingPlayerId;

    joinWithRetry(client, gameId, joinOptions)
      .then((room) => {
        const statusEl = document.getElementById("status");
        if (statusEl) statusEl.remove();

        room.onMessage("playerId", (id) => {
          myPlayerId = id;
          localStorage.setItem(playerIdKey, id);
        });

        setupRoom(room);
      })
      .catch(() => {
        document.getElementById("status").textContent = "Could not connect to the game.";
      });
  }
}
