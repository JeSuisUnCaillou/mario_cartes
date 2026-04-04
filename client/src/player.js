import { Client, Callbacks } from "@colyseus/sdk";
import { splitDrawBatches, initialDrawPileCount, normalizeName } from "./player.functions.js";
import { CardDragHandler } from "./player_drag.js";
import {
  ensureCardElements, getCardElement, spawnThrowAnimation, clearCardElements,
  animateShuffle, animateDrawCards, captureHandPositions, recomputeFan,
  renderHand, renderPileContent, updatePileCount, updatePiles, updateCoinDisplay, updateCardMushroomIcons,
} from "./player_cards.js";
import { updateBuyButton as _updateBuyButton, openBuyModal as _openBuyModal, renderBuyModal, closeBuyModal } from "./player_buy.js";
import { openPileModal, closePileModal } from "./player_pile_modal.js";
import { rankBadge } from "./rank.js";
import { helmetDataUrl } from "./helmet.js";
import { ITEM_ICONS } from "./constants.js";

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
let currentPermanentCoins = 0;
let currentSlowCounters = 0;
let currentHasMovedThisTurn = false;
let currentRank = 0;
let currentPlayerCount = 0;
let pendingShellChoice = false;
let latestDrawPileDisplay = [];
let latestDiscardPile = [];

const drag = new CardDragHandler({
  getRoom: () => currentRoom,
  isBlocked: () => animating,
  isPendingDiscard: () => pendingDiscards > 0,
});

function addDragListeners(card) {
  drag.attach(card);
}

function updateBuyButton() {
  _updateBuyButton(activePlayerId, myPlayerId, latestRivers, pendingDiscards || pendingShellChoice, openBuyModal);
}

function updatePilesAndTrack(data) {
  latestDrawPileDisplay = data.drawPileDisplay || [];
  latestDiscardPile = data.discardPile || [];
  updatePiles(data);
}

function openBuyModal() {
  _openBuyModal(currentRoom, latestRivers, currentCoins, currentRank, currentPermanentCoins, currentPlayerCount);
}

function showRulesModal() {
  closeRulesModal();
  const overlay = document.createElement("div");
  overlay.className = "rules-modal";
  overlay.addEventListener("click", (e) => { if (e.target === overlay) closeRulesModal(); });

  const closeBtn = document.createElement("button");
  closeBtn.className = "rules-modal-close";
  closeBtn.textContent = "\u00D7";
  closeBtn.addEventListener("click", closeRulesModal);
  overlay.appendChild(closeBtn);

  const content = document.createElement("div");
  content.className = "rules-modal-content";

  const title = document.createElement("h2");
  title.className = "rules-modal-title";
  title.textContent = "Items";
  content.appendChild(title);

  const rules = [
    { icon: "/coin.svg", title: "Coin", text: "Gain 1 coin until end of turn." },
    { icon: "/permacoin.svg", title: "Permanent Coin", text: "A permanent coin is kept from turn to turn. Permanent coins are spent last." },
    { icon: "/mushroom.svg", title: "Mushroom", text: "Move forward 1 cell (subject to dark mushrooms)." },
    { icon: "/banana.svg", title: "Banana", text: "Drop a banana on your cell. Landing on a banana: discard 1 card." },
    { icon: "/green_shell.svg", title: "Green Shell", text: "Throw to adjacent cell, forward or backward. Gives dark mushrooms to players, or destroys bananas and shells." },
    { icon: "/red_shell.svg", title: "Red Shell", text: "Forward: travels until it hits something. Backward: One cell only. Same hit effects as green shell." },
    { icon: "/blue_shell.svg", title: "Blue Shell", text: "Automatically targets 1st player. That player discards their entire hand." },
    { icon: "/star.svg", title: "Star", text: "Become invincible until the start of your next turn. Immune to all items. Destroys items on cells you enter." },
    { icon: "/dark_mushroom.svg", title: "Dark Mushroom", text: "Each cancels one mushroom, except the first mushroom of the turn. Reset at end of turn." },
  ];

  for (const rule of rules) {
    const row = document.createElement("div");
    row.className = "rules-row";

    const img = document.createElement("img");
    img.src = rule.icon;
    row.appendChild(img);

    const textDiv = document.createElement("div");
    textDiv.className = "rules-row-text";
    const strong = document.createElement("strong");
    strong.textContent = rule.title;
    textDiv.appendChild(strong);
    textDiv.appendChild(document.createTextNode(rule.text));
    row.appendChild(textDiv);

    content.appendChild(row);
  }

  overlay.appendChild(content);
  document.body.appendChild(overlay);
}

function closeRulesModal() {
  const modal = document.querySelector(".rules-modal");
  if (modal) modal.remove();
}

function showShellModal(shellType) {
  closeShellModal();
  const overlay = document.createElement("div");
  overlay.className = "shell-modal";

  const content = document.createElement("div");
  content.className = "shell-modal-content";

  const title = document.createElement("h2");
  title.className = "shell-modal-title";
  title.textContent = shellType === "red_shell" ? "Throw the red shell" : "Throw the green shell";
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

function updatePlayZone() {
  const playZone = document.getElementById("play-zone");
  const endTurnContainer = document.getElementById("end-turn-container");
  if (!playZone) return;
  // Toggle active/waiting background on the player screen
  const screen = document.querySelector(".player-screen");
  if (screen) {
    if (gamePhase === "playing" && activePlayerId) {
      const isActive = activePlayerId === myPlayerId;
      screen.classList.toggle("my-turn", isActive);
      screen.classList.toggle("waiting-turn", !isActive);
    } else {
      screen.classList.remove("my-turn", "waiting-turn");
    }
  }
  // Ensure end-turn button exists (create once, toggle visibility)
  if (endTurnContainer && !document.getElementById("end-turn-btn")) {
    endTurnContainer.innerHTML = `<button id="end-turn-btn" class="end-turn-btn">End turn</button>`;
    document.getElementById("end-turn-btn").addEventListener("click", () => {
      if (drag.isPlaying || animating || pendingDiscards > 0 || pendingShellChoice) return;
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
      <h1>Join game</h1>
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

function areAllConnectedPlayersReady(room) {
  let allReady = true;
  if (room.state && room.state.players) {
    room.state.players.forEach((p) => {
      if (p.connected && !p.ready) allReady = false;
    });
  }
  return allReady;
}

function renderLobby(room) {
  const lobbyZone = document.getElementById("lobby-zone");
  if (!lobbyZone) return;
  if (isReady) {
    lobbyZone.innerHTML = `
      <div class="ready-message">You are ready</div>
      <div class="lobby-buttons">
        <button id="start-btn" class="lobby-btn start-btn">Start the game</button>
        <button id="cancel-btn" class="lobby-btn cancel-btn">Cancel</button>
      </div>
      <div class="lobby-hint">All connected players must be ready to start the game</div>
    `;
    const startBtn = document.getElementById("start-btn");
    const allReady = areAllConnectedPlayersReady(room);
    startBtn.disabled = !allReady;
    document.querySelector(".lobby-hint").style.visibility = allReady ? "hidden" : "";
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
      <button id="ready-btn" class="lobby-btn ready-btn">READY</button>
    `;
    document.getElementById("ready-btn").addEventListener("click", () => {
      isReady = true;
      room.send("setReady", true);
      renderLobby(room);
    });
  }
}

function renderFinishedZone(container, ranking, room, { showStartOver = true, myPlayerId: pid = null } = {}) {
  if (showStartOver) {
    container.innerHTML = `
      <h2 class="finished-title">Race Complete!</h2>
      <ol class="finished-list">
        ${(ranking || []).map((entry) => {
          return `<li class="finished-entry"><span class="finished-rank">${rankBadge(entry.finalRank, "finished-rank-icon")}</span><span class="finished-name">${entry.name}</span></li>`;
        }).join("")}
      </ol>
      <button id="start-over-btn" class="start-over-btn">Start Over</button>
    `;
    document.getElementById("start-over-btn").addEventListener("click", () => {
      room.send("startOver");
    });
  } else {
    const myEntry = (ranking || []).find((e) => e.playerId === pid);
    const rank = myEntry ? myEntry.finalRank : ranking ? ranking.length : 1;
    container.innerHTML = `
      <h2 class="finished-title">You finished!</h2>
      <div class="finished-entry"><span class="finished-rank">${rankBadge(rank, "finished-rank-icon")}</span></div>
      <p class="waiting-message">Waiting for other players…</p>
    `;
  }
}

function startGame(gameId, name, existingPlayerId, existingRoom) {
  document.getElementById("app").innerHTML = `
    <div class="player-screen">
      <div class="top-zone">
        <button id="rules-btn" class="rules-btn">?</button>
        <img id="player-helmet" class="player-helmet" src="/helmet.svg" />
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

  document.getElementById("rules-btn").addEventListener("click", showRulesModal);
  document.getElementById("draw-pile").addEventListener("click", () => {
    openPileModal("Draw pile", latestDrawPileDisplay);
  });
  document.getElementById("discard-pile").addEventListener("click", () => {
    openPileModal("Discard pile", latestDiscardPile);
  });

  const nameInput = document.getElementById("player-name");
  nameInput.addEventListener("input", () => {
    nameInput.value = normalizeName(nameInput.value);
  });
  nameInput.addEventListener("focus", () => nameInput.select());

  const playerIdKey = `playerId:${gameId}`;

  function setupRoom(room) {
    renderLobby(room);
    currentRoom = room;
    drag.reset();
    animating = false;
    pendingDiscards = 0;
    pendingShellChoice = false;

      // Schema-based state sync for public game state
      let gameStateDirty = false;
      let playersDirty = false;
      let riversDirty = false;

      const $ = Callbacks.get(room);

      $.listen("phase", () => { gameStateDirty = true; });
      $.listen("currentRound", () => { gameStateDirty = true; });
      $.listen("activePlayerId", () => { gameStateDirty = true; });

      $.onAdd("players", (player) => {
        playersDirty = true;
        $.onChange(player, () => { playersDirty = true; });
      });
      $.onRemove("players", () => { playersDirty = true; });

      $.onAdd("ranking", () => { gameStateDirty = true; });
      $.onRemove("ranking", () => { gameStateDirty = true; });

      $.onAdd("rivers", () => { riversDirty = true; });
      $.onChange("rivers", () => { riversDirty = true; });
      $.onRemove("rivers", () => { riversDirty = true; });

      room.onStateChange((state) => {
        if (gameStateDirty || riversDirty) {
          gamePhase = state.phase;
          const prevActive = activePlayerId;
          activePlayerId = state.activePlayerId || null;
          if (activePlayerId === myPlayerId && prevActive !== myPlayerId && navigator.vibrate) {
            navigator.vibrate(200);
          }

          if (state.rivers.length > 0) {
            latestRivers = [];
            state.rivers.forEach((r) => {
              const slots = [];
              r.slots.forEach((s) => {
                if (s.id) {
                  let items = [];
                  try { items = JSON.parse(s.items); } catch (e) {}
                  slots.push({ id: s.id, items });
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
                  ranking.push({ playerId: r.playerId, name: r.name, finalRank: r.finalRank });
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
                ranking.push({ playerId: r.playerId, name: r.name, finalRank: r.finalRank });
              });
              renderFinishedZone(finishedZone, ranking, room);
            }
          } else if (state.phase === "lobby") {
            if (gameZone) gameZone.style.display = "none";
            if (finishedZone) finishedZone.style.display = "none";
            isReady = false;
            clearCardElements();
            if (lobbyZone) {
              lobbyZone.style.display = "";
              renderLobby(room);
            }
          }

          updatePlayZone();
          updateBuyButton();
          if (document.querySelector(".buy-modal")) renderBuyModal(currentRoom, latestRivers, currentCoins, currentRank, currentPermanentCoins, currentPlayerCount);
          gameStateDirty = false;
          riversDirty = false;
        }

        if (playersDirty) {
          currentPlayerCount = state.players.size;
          if (gamePhase === "lobby" && isReady) {
            renderLobby(room);
          }
          if (myPlayerId) {
            const me = state.players.get(myPlayerId);
            if (me) {
              const helmetEl = document.getElementById("player-helmet");
              if (helmetEl && me.color && helmetEl.dataset.color !== me.color) {
                helmetEl.dataset.color = me.color;
                helmetDataUrl(me.color).then((url) => { helmetEl.src = url; });
              }
              if (gamePhase === "lobby" && me.ready !== isReady) {
                isReady = me.ready;
                renderLobby(room);
              }
              if (gamePhase === "playing" && (me.coins !== currentCoins || me.permanentCoins !== currentPermanentCoins || me.slowCounters !== currentSlowCounters || me.hasMovedThisTurn !== currentHasMovedThisTurn)) {
                const slowChanged = me.slowCounters !== currentSlowCounters || me.hasMovedThisTurn !== currentHasMovedThisTurn;
                if (me.slowCounters > currentSlowCounters) navigator.vibrate?.(200);
                currentCoins = me.coins;
                currentPermanentCoins = me.permanentCoins;
                currentSlowCounters = me.slowCounters;
                currentHasMovedThisTurn = me.hasMovedThisTurn;
                updateCoinDisplay(currentCoins, currentPermanentCoins, updateBuyButton, currentSlowCounters);
                if (slowChanged) {
                  updateCardMushroomIcons(currentHasMovedThisTurn && currentSlowCounters > 0);
                }
              }
              if (gamePhase === "playing") {
                currentRank = me.rank;
              }
              if (gamePhase === "playing" && me.finished) {
                const gameZone = document.getElementById("game-zone");
                const finishedZone = document.getElementById("finished-zone");
                if (gameZone) gameZone.style.display = "none";
                if (finishedZone) {
                  finishedZone.style.display = "";
                  const ranking = [];
                  state.ranking.forEach((r) => {
                    ranking.push({ playerId: r.playerId, name: r.name, finalRank: r.finalRank });
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
        closePileModal();
        ensureCardElements(data.deck);
        // On reconnect (hand already existed), just render without animation
        if (data.drawnBeforeShuffle === undefined) {
          renderHand(data.hand, addDragListeners);
          updatePilesAndTrack(data);
          currentCoins = data.coins || 0;
          currentPermanentCoins = data.permanentCoins || 0;
          currentSlowCounters = data.slowCounters || 0;
          updateCoinDisplay(currentCoins, currentPermanentCoins, updateBuyButton, currentSlowCounters);
          updateCardMushroomIcons(currentHasMovedThisTurn && currentSlowCounters > 0);
          if (data.pendingDiscard > 0) {
            pendingDiscards = data.pendingDiscard;
            closeBuyModal();
            updateBuyButton();
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
            showShellModal(data.pendingShellType);
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

        updatePilesAndTrack(data);
        currentCoins = data.coins || 0;
        currentPermanentCoins = data.permanentCoins || 0;
        currentSlowCounters = data.slowCounters || 0;
        currentHasMovedThisTurn = false;
        updateCoinDisplay(currentCoins, currentPermanentCoins, updateBuyButton, currentSlowCounters);
        updateCardMushroomIcons(false);
        animating = false;
      });

      room.onMessage("cardPlayed", (data) => {
        if (!data.cardId) {
          // State-only update (e.g. after green_shell resolves pendingShellChoice)
          if (data.pendingShellChoice) {
            pendingShellChoice = true;
            showShellModal(data.pendingShellType);
            updatePlayZone();
            updateBuyButton();
          }
          return;
        }
        drag.reset();
        ensureCardElements(data.deck);
        // Capture positions BEFORE removing the card
        const positions = captureHandPositions();
        // Read items from the card element before removing it
        const handArea = document.getElementById("hand-area");
        const played = handArea.querySelector(`[data-card-id="${data.cardId}"]`);
        let items = [];
        if (played) { try { items = JSON.parse(played.dataset.items); } catch (e) {} }
        if (played) played.remove();
        // Animate remaining cards from old positions to new fan positions
        recomputeFan(positions);

        // Sequentially throw each item icon (top to bottom, 400ms apart)
        const playZone = document.getElementById("play-zone");
        items.forEach((item, i) => {
          if (ITEM_ICONS[item]) {
            setTimeout(() => spawnThrowAnimation(ITEM_ICONS[item], playZone), i * 400);
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
            updatePilesAndTrack(data);
          }, { once: true });
        });
        if (clones.length === 0) {
          updatePilesAndTrack(data);
        }
      });

      room.onMessage("discardHit", async (data) => {
        navigator.vibrate?.(200);
        const playZone = document.getElementById("play-zone");
        const zoneRect = playZone.getBoundingClientRect();

        const crashSrc = data.source === "red_shell" ? "/red_shell.svg"
          : data.source === "green_shell" ? "/green_shell.svg" : "/banana.svg";
        const hitLabel = data.source === "red_shell" ? "Red shell!"
          : data.source === "green_shell" ? "Green shell!" : "Banana!";
        const hitClass = data.source === "red_shell" ? "discard-hit-redshell"
          : data.source === "green_shell" ? "discard-hit-shell" : "discard-hit-banana";

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
          updatePilesAndTrack(drawData);
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
        drag.reset();
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
            updatePilesAndTrack(data);
          }, { once: true });
        });
        if (clones.length === 0) {
          updatePilesAndTrack(data);
        }

        // Restore play zone when all discards are done
        if (data.remaining <= 0) {
          pendingDiscards = 0;
          const playZone = document.getElementById("play-zone");
          playZone.classList.remove("discard-hit", "discard-hit-banana", "discard-hit-shell", "discard-hit-redshell");
          updatePlayZone();
          updateBuyButton();
        }
      });

      room.onMessage("blueShellHit", async (data) => {
        navigator.vibrate?.(200);
        const playZone = document.getElementById("play-zone");
        const zoneRect = playZone.getBoundingClientRect();

        // Crash animation: blue shell falls into play zone
        const crashItem = document.createElement("img");
        crashItem.src = "/blue_shell.svg";
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

        // Show blue shell hit zone
        playZone.classList.remove("waiting");
        playZone.classList.add("discard-hit", "discard-hit-blueshell");
        playZone.innerHTML = `
          <img src="/blue_shell.svg" class="play-zone-banana" />
          <span class="play-zone-label"><h2>Blue shell!</h2></span>
        `;

        // Auto-animate each card flying to discard pile
        const handArea = document.getElementById("hand-area");
        const discardEl = document.getElementById("discard-pile");
        const discardRect = discardEl.getBoundingClientRect();

        for (const cardId of data.discardedCardIds) {
          const card = handArea.querySelector(`[data-card-id="${cardId}"]`);
          if (!card) continue;
          const positions = captureHandPositions();
          const cardRect = card.getBoundingClientRect();

          // Create clone flying to discard pile
          const clone = card.cloneNode(true);
          clone.style.position = "fixed";
          clone.style.left = cardRect.left + "px";
          clone.style.top = cardRect.top + "px";
          clone.style.width = cardRect.width + "px";
          clone.style.height = cardRect.height + "px";
          clone.style.zIndex = "50";
          clone.style.margin = "0";
          clone.style.transform = "none";
          clone.style.transition = "all 0.3s ease-in-out";
          document.body.appendChild(clone);
          card.remove();
          recomputeFan(positions);

          requestAnimationFrame(() => {
            clone.style.left = (discardRect.left + discardRect.width / 2 - 25) + "px";
            clone.style.top = discardRect.top + "px";
            clone.style.width = "50px";
            clone.style.height = "auto";
            clone.style.transform = "rotate(0deg)";
            clone.style.filter = "none";
          });
          await new Promise((r) => setTimeout(r, 200));
        }

        // Wait for last clone transition to finish, then clean up
        await new Promise((r) => setTimeout(r, 300));
        document.querySelectorAll("body > .card").forEach((c) => c.remove());
        ensureCardElements(data.deck);
        updatePilesAndTrack(data);
        playZone.classList.remove("discard-hit", "discard-hit-blueshell");
        updatePlayZone();
        updateBuyButton();
      });

      room.onMessage("cardBought", (data) => {
        ensureCardElements(data.deck);
        currentCoins = data.coins;
        currentPermanentCoins = data.permanentCoins || 0;
        updateCoinDisplay(data.coins, currentPermanentCoins, updateBuyButton, currentSlowCounters);
        updatePilesAndTrack(data);
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
            clone.style.pointerEvents = "none";
            document.body.appendChild(clone);
            requestAnimationFrame(() => {
              clone.style.left = (discardRect.left + discardRect.width / 2 - 25) + "px";
              clone.style.top = discardRect.top + "px";
              clone.style.width = "50px";
              clone.style.height = "auto";
              setTimeout(() => clone.remove(), 350);
            });
          }
          // Re-render modal with updated rivers and coins
          if (latestRivers) renderBuyModal(currentRoom, latestRivers, currentCoins, currentRank, currentPermanentCoins, currentPlayerCount);
        }
      });

      nameInput.addEventListener("change", () => {
        const newName = nameInput.value.trim() || "???";
        nameInput.value = newName;
        localStorage.setItem("playerName", newName);
        room.send("changeName", newName);
      });

      let roomDestroyed = false;
      room.onMessage("roomDestroyed", () => {
        roomDestroyed = true;
        document.getElementById("app").innerHTML =
          '<div class="player-container" style="justify-content:center;"><h2>The game has been ended</h2></div>';
      });

      // Built-in auto-reconnect (Colyseus 0.17)
      room.reconnection.maxRetries = 30;
      room.reconnection.maxDelay = 5000;

      // Show disconnect overlay after 5s of lost connection
      let disconnectTimer = null;
      room.onDrop(() => {
        disconnectTimer = setTimeout(() => {
          if (document.querySelector(".disconnect-overlay")) return;
          const overlay = document.createElement("div");
          overlay.className = "disconnect-overlay";
          overlay.innerHTML =
            '<h2>Connection lost</h2><p>Trying to reconnect\u2026</p>' +
            '<button onclick="location.reload()">Reload</button>';
          document.getElementById("app").appendChild(overlay);
        }, 5000);
      });
      room.onReconnect(() => {
        clearTimeout(disconnectTimer);
        document.querySelector(".disconnect-overlay")?.remove();
      });

      room.onLeave((code) => {
        if (roomDestroyed) return;
        if (code === 4003) {
          // Reconnection failed — fallback: fresh join with existing playerId
          const serverUrl = import.meta.env.DEV
            ? "ws://localhost:2567"
            : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;
          const reconnectClient = new Client(serverUrl);
          joinWithRetry(reconnectClient, gameId, {
            type: "player", name, playerId: myPlayerId,
          }).then((newRoom) => setupRoom(newRoom));
        }
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
