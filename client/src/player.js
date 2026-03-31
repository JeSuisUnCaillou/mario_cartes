import { Client } from "colyseus.js";

const CARD_ASSETS = {
  move_forward_1: "/card - move forward.svg",
  banana_move_forward_1: "/card - banana and move forward.svg",
};

let playing = false;
let animating = false;
let animDrawCount = 0;
let currentRoom = null;
let pendingDiscards = 0;
let gamePhase = "lobby";
let isReady = false;
let myPlayerId = null;
let activePlayerId = null;

function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function animateShuffle(count) {
  const discardEl = document.getElementById("discard-pile");
  const drawEl = document.getElementById("draw-pile");
  const discardRect = discardEl.getBoundingClientRect();
  const drawRect = drawEl.getBoundingClientRect();
  let remaining = count;

  for (let i = 0; i < count; i++) {
    remaining--;
    renderPileContent("discard-pile-content", remaining, "Discard pile", "/card - move forward.svg");
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
    const img = document.createElement("img");
    img.src = CARD_ASSETS[card.type];
    img.className = "card";
    img.dataset.cardId = card.id;
    img.style.visibility = "hidden";
    img.style.transform = "rotate(0deg) translateY(0px)";
    handArea.appendChild(img);

    // Recompute fan for all visible cards + this new one
    const allCards = Array.from(handArea.children);
    const visibleCount = allCards.length;
    const angleStep = 10;
    allCards.forEach((el, idx) => {
      const offset = idx - (visibleCount - 1) / 2;
      const rotation = offset * angleStep;
      const lift = Math.abs(offset) * 8;
      el.dataset.fanTransform = `rotate(${rotation}deg) translateY(${lift}px)`;
      // Existing visible cards animate via CSS transition
      if (el !== img) {
        el.style.transform = el.dataset.fanTransform;
      }
    });

    // Set the new card's transform to get its target position
    img.style.transform = img.dataset.fanTransform;
    const targetRect = img.getBoundingClientRect();

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

    const frontFace = document.createElement("img");
    frontFace.src = CARD_ASSETS[card.type];
    frontFace.className = "card-flyer-face card-flyer-front";

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
        img.style.visibility = "";
        addDragListeners(img);
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

    const hit =
      !playZone.classList.contains("waiting") &&
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

function updatePiles({ drawCount, discardCount, discardTopType }) {
  renderPileContent("draw-pile-content", drawCount, "Draw pile", "/card - back.svg");
  const discardIcon = discardTopType ? CARD_ASSETS[discardTopType] : "/card - move forward.svg";
  renderPileContent("discard-pile-content", discardCount, "Discard pile", discardIcon);
  updatePileCount("draw-count", drawCount);
  updatePileCount("discard-count", discardCount);
}

function updatePlayZone() {
  const playZone = document.getElementById("play-zone");
  if (!playZone || playZone.classList.contains("banana-hit")) return;
  if (activePlayerId !== myPlayerId) {
    playZone.classList.add("waiting");
    playZone.innerHTML = `<span class="play-zone-label">Wait for your turn to play</span>`;
  } else {
    playZone.classList.remove("waiting");
    playZone.innerHTML = `<span class="play-zone-label">Drag a card here to play it</span>`;
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

function startGame(gameId, name, existingPlayerId) {
  document.getElementById("app").innerHTML = `
    <div class="player-screen">
      <div class="top-zone">
        <input id="player-name" class="name-edit-input" type="text" maxlength="3" value="${name}" autocomplete="off" />
        <p id="status">Joining…</p>
      </div>
      <div id="lobby-zone" class="lobby-zone"></div>
      <div id="game-zone" class="game-zone" style="display: none;">
        <div id="play-zone" class="play-zone">
          <span class="play-zone-label">Drag a card here to play it</span>
        </div>
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
  myPlayerId = existingPlayerId;

  joinWithRetry(client, gameId, joinOptions)
    .then((room) => {
      document.getElementById("status").remove();
      renderLobby(room);

      room.onMessage("playerId", (id) => {
        myPlayerId = id;
        localStorage.setItem(playerIdKey, id);
      });

      currentRoom = room;

      room.onMessage("gameState", (data) => {
        gamePhase = data.phase;
        activePlayerId = data.activePlayerId;
        if (data.phase === "playing") {
          const lobbyZone = document.getElementById("lobby-zone");
          const gameZone = document.getElementById("game-zone");
          if (lobbyZone) lobbyZone.style.display = "none";
          if (gameZone) {
            gameZone.style.display = "";
            updatePiles({ drawCount: 8, discardCount: 0 });
          }
        }
        updatePlayZone();
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
        // On reconnect (hand already existed), just render without animation
        if (data.drawnBeforeShuffle === undefined) {
          renderHand(data.hand);
          updatePiles(data);
          if (data.pendingBananaDiscards > 0) {
            pendingDiscards = data.pendingBananaDiscards;
            const playZone = document.getElementById("play-zone");
            playZone.classList.add("banana-hit");
            playZone.innerHTML = `
              <img src="/banana.svg" class="play-zone-banana" />
              <span class="play-zone-label">Banana! Drag a card here to discard it.</span>
            `;
          }
          return;
        }
        animating = true;

        const before = data.drawnBeforeShuffle;
        const firstBatch = data.hand.slice(0, before);
        const secondBatch = data.hand.slice(before);

        // Track draw pile count during animation
        if (data.shuffledCount > 0) {
          animDrawCount = before; // pile had exactly this many before drawing
        } else {
          animDrawCount = data.drawCount + data.hand.length;
        }

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
        // Capture positions BEFORE removing the card
        const positions = captureHandPositions();
        // Remove the played card from the hand
        const handArea = document.getElementById("hand-area");
        const played = handArea.querySelector(`[data-card-id="${data.cardId}"]`);
        if (played) played.remove();
        // Animate remaining cards from old positions to new fan positions
        recomputeFan(positions);

        // Banana throw animation if server dropped a banana
        if (data.droppedBanana !== null && data.droppedBanana !== undefined) {
          const playZone = document.getElementById("play-zone");
          const zoneRect = playZone.getBoundingClientRect();
          const banana = document.createElement("img");
          banana.src = "/banana.svg";
          banana.className = "banana-throw";
          banana.style.position = "fixed";
          banana.style.width = "60px";
          banana.style.height = "auto";
          banana.style.left = (zoneRect.left + zoneRect.width / 2 - 30) + "px";
          banana.style.top = (zoneRect.top + zoneRect.height / 2 - 30) + "px";
          banana.style.zIndex = "999";
          banana.style.pointerEvents = "none";
          document.body.appendChild(banana);
          banana.addEventListener("animationend", () => banana.remove(), { once: true });
        }

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
          const before = drawData.drawnBeforeShuffle;
          const firstBatch = drawData.hand.slice(0, before);
          const secondBatch = drawData.hand.slice(before);
          animDrawCount = drawData.shuffledCount > 0 ? before : drawData.drawCount + drawData.hand.length;
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
        playZone.classList.add("banana-hit");
        playZone.innerHTML = `
          <img src="/banana.svg" class="play-zone-banana" />
          <span class="play-zone-label"><h2>Banana!</h2><br />Drag a card here to discard it.</span>
        `;
      });

      room.onMessage("cardDiscarded", (data) => {
        playing = false;
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
        }
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
