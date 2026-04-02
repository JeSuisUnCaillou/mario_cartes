import { Client } from "colyseus.js";
import { isPointInRect, splitDrawBatches, initialDrawPileCount, normalizeName } from "./player.functions.js";
import {
  ensureCardElements, getCardElement, spawnThrowAnimation,
  animateShuffle, animateDrawCards, captureHandPositions, recomputeFan,
  renderHand, renderPileContent, updatePileCount, updatePiles, updateCoinDisplay,
} from "./player_cards.js";
import { updateBuyButton as _updateBuyButton, openBuyModal as _openBuyModal, renderBuyModal, closeBuyModal } from "./player_buy.js";

function ordinalSuffix(n) {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return n + (s[(v - 20) % 10] || s[v] || s[0]);
}

let playing = false;
let animating = false;
let animDrawCount = 0;
let currentRoom = null;
let pendingDiscards = 0;
let gamePhase = "lobby";
let isReady = false;
let allConnectedReady = false;
let myPlayerId = null;
let activePlayerId = null;
let latestRivers = null;
let currentCoins = 0;
let pendingShellChoice = false;

function updateBuyButton() {
  _updateBuyButton(activePlayerId, myPlayerId, latestRivers, pendingDiscards || pendingShellChoice, openBuyModal);
}

function openBuyModal() {
  _openBuyModal(currentRoom, latestRivers, currentCoins);
}

function showShellModal() {
  closeShellModal();
  const overlay = document.createElement("div");
  overlay.className = "shell-modal";

  const content = document.createElement("div");
  content.className = "shell-modal-content";

  const title = document.createElement("h2");
  title.className = "shell-modal-title";
  title.textContent = "Throw the green shell";
  content.appendChild(title);

  const buttons = document.createElement("div");
  buttons.className = "shell-modal-buttons";

  const forwardBtn = document.createElement("button");
  forwardBtn.className = "shell-modal-btn shell-modal-forward";
  forwardBtn.innerHTML = "Forward &#x2191;";
  forwardBtn.addEventListener("click", () => {
    if (currentRoom) currentRoom.send("shellChoice", { direction: "forward" });
    pendingShellChoice = false;
    closeShellModal();
    updatePlayZone();
    updateBuyButton();
  });
  buttons.appendChild(forwardBtn);

  const backwardBtn = document.createElement("button");
  backwardBtn.className = "shell-modal-btn shell-modal-backward";
  backwardBtn.innerHTML = "Backward &#x2193;";
  backwardBtn.addEventListener("click", () => {
    if (currentRoom) currentRoom.send("shellChoice", { direction: "backward" });
    pendingShellChoice = false;
    closeShellModal();
    updatePlayZone();
    updateBuyButton();
  });
  buttons.appendChild(backwardBtn);

  content.appendChild(buttons);
  overlay.appendChild(content);
  document.body.appendChild(overlay);
}

function closeShellModal() {
  const modal = document.querySelector(".shell-modal");
  if (modal) modal.remove();
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

function updatePlayZone() {
  const playZone = document.getElementById("play-zone");
  const endTurnContainer = document.getElementById("end-turn-container");
  if (!playZone) return;
  // Ensure end-turn button exists (create once, toggle visibility)
  if (endTurnContainer && !document.getElementById("end-turn-btn")) {
    endTurnContainer.innerHTML = `<button id="end-turn-btn" class="end-turn-btn">End turn</button>`;
    document.getElementById("end-turn-btn").addEventListener("click", () => {
      if (playing || animating || pendingDiscards > 0 || pendingShellChoice) return;
      currentCoins = 0;
      updateCoinDisplay(0, updateBuyButton);
      if (currentRoom) currentRoom.send("endTurn");
    });
  }
  const endTurnBtn = document.getElementById("end-turn-btn");
  if (playZone.classList.contains("discard-hit") || pendingShellChoice) {
    if (endTurnBtn) {
      const isMyTurn = activePlayerId === myPlayerId;
      endTurnBtn.style.visibility = isMyTurn ? "" : "hidden";
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

      room.onMessage("kicked", () => {
        localStorage.removeItem(playerIdKey);
        document.getElementById("app").innerHTML = `
          <div class="player-screen">
            <div class="lobby-zone game-rejected">
              <span class="rejected-message">You have been kicked from the game.</span>
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
      <div class="lobby-buttons">
        <button id="start-btn" class="start-btn">Start the game</button>
        <button id="cancel-btn" class="cancel-btn">Cancel</button>
      </div>
    `;
    const startBtn = document.getElementById("start-btn");
    startBtn.disabled = !allConnectedReady;
    startBtn.addEventListener("click", () => {
      room.send("startGame");
    });
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

function renderFinishedZone(container, ranking, room, { showStartOver = true, myPlayerId: pid = null } = {}) {
  const medals = ["🥇", "🥈", "🥉"];
  if (showStartOver) {
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
  } else {
    const myEntry = (ranking || []).find((e) => e.playerId === pid);
    const rank = myEntry ? myEntry.rank : ranking ? ranking.length : 1;
    const medal = medals[rank - 1] || "";
    const ordinal = ordinalSuffix(rank);
    container.innerHTML = `
      <h2 class="finished-title">You finished!</h2>
      <div class="finished-entry"><span class="finished-rank">${medal} ${ordinal}</span></div>
      <p class="waiting-message">Waiting for other players…</p>
    `;
  }
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
        <div id="buy-btn-container" class="buy-btn-container" style="visibility:hidden"></div>
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

      // Schema-based state sync for public game state
      let gameStateDirty = false;
      let playersDirty = false;
      let riversDirty = false;

      room.state.listen("phase", () => { gameStateDirty = true; });
      room.state.listen("currentRound", () => { gameStateDirty = true; });
      room.state.listen("activePlayerId", () => { gameStateDirty = true; });

      room.state.players.onAdd((player) => {
        playersDirty = true;
        player.onChange(() => { playersDirty = true; });
      });
      room.state.players.onRemove(() => { playersDirty = true; });

      room.state.ranking.onAdd(() => { gameStateDirty = true; });
      room.state.ranking.onRemove(() => { gameStateDirty = true; });

      room.state.rivers.onAdd(() => { riversDirty = true; });
      room.state.rivers.onChange(() => { riversDirty = true; });
      room.state.rivers.onRemove(() => { riversDirty = true; });

      room.onStateChange((state) => {
        if (gameStateDirty || riversDirty) {
          gamePhase = state.phase;
          activePlayerId = state.activePlayerId || null;

          if (riversDirty && state.rivers.length > 0) {
            latestRivers = [];
            state.rivers.forEach((r) => {
              const slots = [];
              r.slots.forEach((s) => {
                if (s.id) {
                  slots.push({ id: s.id, items: JSON.parse(s.items) });
                } else {
                  slots.push(null);
                }
              });
              latestRivers.push({ id: r.id, cost: r.cost, slots, deckCount: r.deckCount });
            });
          }

          const lobbyZone = document.getElementById("lobby-zone");
          const gameZone = document.getElementById("game-zone");
          const finishedZone = document.getElementById("finished-zone");

          if (state.phase === "playing") {
            const me = myPlayerId ? state.players.get(myPlayerId) : null;
            if (me && me.finished) {
              if (lobbyZone) lobbyZone.style.display = "none";
              if (gameZone) gameZone.style.display = "none";
              if (finishedZone) {
                finishedZone.style.display = "";
                const ranking = [];
                state.ranking.forEach((r) => {
                  ranking.push({ playerId: r.playerId, name: r.name, rank: r.rank });
                });
                renderFinishedZone(finishedZone, ranking, room, { showStartOver: false, myPlayerId });
              }
            } else {
              if (lobbyZone) lobbyZone.style.display = "none";
              if (finishedZone) finishedZone.style.display = "none";
              if (gameZone && gameZone.style.display === "none") {
                gameZone.style.display = "";
              }
            }
          } else if (state.phase === "finished") {
            if (lobbyZone) lobbyZone.style.display = "none";
            if (gameZone) gameZone.style.display = "none";
            if (finishedZone) {
              finishedZone.style.display = "";
              const ranking = [];
              state.ranking.forEach((r) => {
                ranking.push({ playerId: r.playerId, name: r.name, rank: r.rank });
              });
              renderFinishedZone(finishedZone, ranking, room);
            }
          } else if (state.phase === "lobby") {
            if (gameZone) gameZone.style.display = "none";
            if (finishedZone) finishedZone.style.display = "none";
            isReady = false;
            allConnectedReady = false;
            if (lobbyZone) {
              lobbyZone.style.display = "";
              renderLobby(room);
            }
          }

          updatePlayZone();
          updateBuyButton();
          if (document.querySelector(".buy-modal")) renderBuyModal(currentRoom, latestRivers, currentCoins);
          gameStateDirty = false;
          riversDirty = false;
        }

        if (playersDirty) {
          if (gamePhase === "lobby") {
            let allReady = true;
            state.players.forEach((p) => {
              if (p.connected && !p.ready) allReady = false;
            });
            if (allReady !== allConnectedReady) {
              allConnectedReady = allReady;
              renderLobby(room);
            }
          }
          if (myPlayerId) {
            const me = state.players.get(myPlayerId);
            if (me) {
              if (gamePhase === "lobby" && me.ready !== isReady) {
                isReady = me.ready;
                renderLobby(room);
              }
              if (gamePhase === "playing" && me.coins !== currentCoins) {
                currentCoins = me.coins;
                updateCoinDisplay(currentCoins, updateBuyButton);
              }
              if (gamePhase === "playing" && me.finished) {
                const gameZone = document.getElementById("game-zone");
                const finishedZone = document.getElementById("finished-zone");
                if (gameZone) gameZone.style.display = "none";
                if (finishedZone) {
                  finishedZone.style.display = "";
                  const ranking = [];
                  state.ranking.forEach((r) => {
                    ranking.push({ playerId: r.playerId, name: r.name, rank: r.rank });
                  });
                  renderFinishedZone(finishedZone, ranking, room, { showStartOver: false, myPlayerId });
                }
              }
            }
          }
          playersDirty = false;
        }
      });

      room.onMessage("cardsDrawn", async (data) => {
        if (animating) return;
        ensureCardElements(data.deck);
        // On reconnect (hand already existed), just render without animation
        if (data.drawnBeforeShuffle === undefined) {
          renderHand(data.hand, addDragListeners);
          updatePiles(data);
          currentCoins = data.coins || 0;
          updateCoinDisplay(currentCoins, updateBuyButton);
          if (data.pendingDiscard > 0) {
            pendingDiscards = data.pendingDiscard;
            const playZone = document.getElementById("play-zone");
            playZone.classList.add("discard-hit", "discard-hit-banana");
            playZone.innerHTML = `
              <img src="/banana.svg" class="play-zone-banana" />
              <span class="play-zone-label">Drag a card here to discard it.</span>
            `;
            updatePlayZone();
          }
          if (data.pendingShellChoice) {
            pendingShellChoice = true;
            showShellModal();
            updatePlayZone();
            updateBuyButton();
          }
          return;
        }
        animating = true;

        const { firstBatch, secondBatch } = splitDrawBatches(data.hand, data.drawnBeforeShuffle);
        animDrawCount = initialDrawPileCount(data.drawCount, data.hand.length, data.shuffledCount, data.drawnBeforeShuffle);

        // Draw first batch (cards from draw pile before shuffle)
        if (firstBatch.length > 0) {
          animDrawCount = await animateDrawCards(firstBatch, addDragListeners, animDrawCount);
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
          animDrawCount = await animateDrawCards(secondBatch, addDragListeners, animDrawCount, firstBatch.length);
        }

        updatePiles(data);
        currentCoins = data.coins || 0;
        updateCoinDisplay(currentCoins, updateBuyButton);
        animating = false;
      });

      room.onMessage("cardPlayed", (data) => {
        if (!data.cardId) {
          // State-only update (e.g. after green_shell resolves pendingShellChoice)
          if (data.pendingShellChoice) {
            pendingShellChoice = true;
            showShellModal();
            updatePlayZone();
            updateBuyButton();
          }
          return;
        }
        playing = false;
        ensureCardElements(data.deck);
        // Capture positions BEFORE removing the card
        const positions = captureHandPositions();
        // Read items from the card element before removing it
        const handArea = document.getElementById("hand-area");
        const played = handArea.querySelector(`[data-card-id="${data.cardId}"]`);
        const items = played ? JSON.parse(played.dataset.items) : [];
        if (played) played.remove();
        // Animate remaining cards from old positions to new fan positions
        recomputeFan(positions);

        // Sequentially throw each item icon (top to bottom, 400ms apart)
        const ITEM_ICON = { banana: "/banana.svg", coin: "/coin.svg", mushroom: "/mushroom.svg", green_shell: "/green_shell.svg" };
        const playZone = document.getElementById("play-zone");
        items.forEach((item, i) => {
          if (ITEM_ICON[item]) {
            setTimeout(() => spawnThrowAnimation(ITEM_ICON[item], playZone), i * 400);
          }
        });

        // Coins are updated via schema state (onStateChange), no need to set from cardPlayed

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

      room.onMessage("discardHit", async (data) => {
        const playZone = document.getElementById("play-zone");
        const zoneRect = playZone.getBoundingClientRect();

        const isShell = data.source === "green_shell";
        const crashSrc = isShell ? "/green_shell.svg" : "/banana.svg";
        const hitLabel = isShell ? "Green shell!" : "Banana!";
        const hitClass = isShell ? "discard-hit-shell" : "discard-hit-banana";

        // Crash animation: item falls from above into the play zone
        const crashItem = document.createElement("img");
        crashItem.src = crashSrc;
        crashItem.style.position = "fixed";
        crashItem.style.width = "80px";
        crashItem.style.height = "auto";
        crashItem.style.left = (zoneRect.left + zoneRect.width / 2 - 40) + "px";
        crashItem.style.top = "-100px";
        crashItem.style.zIndex = "999";
        crashItem.style.pointerEvents = "none";
        document.body.appendChild(crashItem);
        crashItem.getBoundingClientRect();
        crashItem.style.transition = "all 0.5s cubic-bezier(0.34, 1.56, 0.64, 1)";
        crashItem.style.top = (zoneRect.top + zoneRect.height / 2 - 40) + "px";
        await new Promise((resolve) => {
          crashItem.addEventListener("transitionend", resolve, { once: true });
        });
        crashItem.remove();

        // Auto-draw if server drew cards for us
        if (data.autoDrawn) {
          animating = true;
          const drawData = data.autoDrawn;
          const { firstBatch, secondBatch } = splitDrawBatches(drawData.hand, drawData.drawnBeforeShuffle);
          animDrawCount = initialDrawPileCount(drawData.drawCount, drawData.hand.length, drawData.shuffledCount, drawData.drawnBeforeShuffle);
          if (firstBatch.length > 0) animDrawCount = await animateDrawCards(firstBatch, addDragListeners, animDrawCount);
          if (drawData.shuffledCount > 0) {
            await animateShuffle(drawData.shuffledCount);
            animDrawCount = drawData.drawCount + secondBatch.length;
            renderPileContent("draw-pile-content", animDrawCount, "Draw pile", "/card - back.svg");
            updatePileCount("draw-count", animDrawCount);
          }
          if (secondBatch.length > 0) animDrawCount = await animateDrawCards(secondBatch, addDragListeners, animDrawCount, firstBatch.length);
          updatePiles(drawData);
          animating = false;
        }

        // Enter discard mode
        pendingDiscards = data.mustDiscard;
        closeBuyModal();
        updateBuyButton();
        playZone.classList.remove("waiting");
        playZone.classList.add("discard-hit", hitClass);
        playZone.innerHTML = `
          <img src="${crashSrc}" class="play-zone-banana" />
          <span class="play-zone-label"><h2>${hitLabel}</h2><br />Drag a card here to discard it.</span>
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
          playZone.classList.remove("discard-hit", "discard-hit-banana", "discard-hit-shell");
          updatePlayZone();
          updateBuyButton();
        }
      });

      room.onMessage("cardBought", (data) => {
        ensureCardElements(data.deck);
        currentCoins = data.coins;
        updateCoinDisplay(data.coins, updateBuyButton);
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
            clone.style.zIndex = "50";
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
          if (latestRivers) renderBuyModal(currentRoom, latestRivers, currentCoins);
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
