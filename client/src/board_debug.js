import trackData from "../../assets/racetrack_1_cells.json";

const trackCells = trackData.cells;

let debugModalOpen = false;
let latestDebugState = null;
let boardRoom = null;

export function isDebugModalOpen() {
  return debugModalOpen;
}

export function setDebugRoom(room) {
  boardRoom = room;
}

export function onDebugState(data) {
  latestDebugState = data;
  renderDebugModal(data);
}

export function setupDebugKeyboard() {
  document.addEventListener("keydown", (e) => {
    if (e.ctrlKey && e.key === "d") {
      e.preventDefault();
      toggleDebugModal();
    }
  });
}

function toggleDebugModal() {
  if (debugModalOpen) {
    closeDebugModal();
  } else {
    openDebugModal();
  }
}

function openDebugModal() {
  debugModalOpen = true;
  if (boardRoom) boardRoom.send("_debugGetState");
  let overlay = document.querySelector(".debug-modal");
  if (!overlay) {
    overlay = document.createElement("div");
    overlay.className = "debug-modal";
    overlay.addEventListener("click", (e) => {
      if (e.target === overlay) closeDebugModal();
    });

    const close = document.createElement("button");
    close.className = "debug-modal-close";
    close.textContent = "\u2715";
    close.addEventListener("click", closeDebugModal);
    overlay.appendChild(close);

    const content = document.createElement("div");
    content.className = "debug-modal-content";
    overlay.appendChild(content);

    document.body.appendChild(overlay);
  }
  document.addEventListener("keydown", debugEscHandler);
}

function closeDebugModal() {
  debugModalOpen = false;
  const overlay = document.querySelector(".debug-modal");
  if (overlay) overlay.remove();
  document.removeEventListener("keydown", debugEscHandler);
}

function debugEscHandler(e) {
  if (e.key === "Escape") closeDebugModal();
}

function renderDebugModal(state) {
  const content = document.querySelector(".debug-modal-content");
  if (!content) return;
  content.innerHTML = "";

  const badge = el("div", "debug-badge", "DEBUG");
  content.appendChild(badge);

  // --- Game section ---
  const gameSection = el("div", "debug-section");
  gameSection.appendChild(el("h3", "debug-section-title", "Game State"));
  const gameForm = el("div", "debug-form");

  const phaseSelect = el("select", "debug-input");
  for (const p of ["lobby", "playing", "finished"]) {
    const opt = document.createElement("option");
    opt.value = p;
    opt.textContent = p;
    if (state.phase === p) opt.selected = true;
    phaseSelect.appendChild(opt);
  }
  gameForm.appendChild(labeledField("Phase", phaseSelect));

  const activeSelect = el("select", "debug-input");
  const noneOpt = document.createElement("option");
  noneOpt.value = "";
  noneOpt.textContent = "(none)";
  activeSelect.appendChild(noneOpt);
  for (const p of state.players) {
    const opt = document.createElement("option");
    opt.value = p.playerId;
    opt.textContent = p.name || p.playerId.slice(0, 8);
    if (state.activePlayerId === p.playerId) opt.selected = true;
    activeSelect.appendChild(opt);
  }
  gameForm.appendChild(labeledField("Active player", activeSelect));

  const roundInput = numInput(state.currentRound);
  gameForm.appendChild(labeledField("Round", roundInput));

  const gameApply = el("button", "debug-apply-btn", "Apply");
  gameApply.addEventListener("click", () => {
    boardRoom.send("_debugSetGameState", {
      phase: phaseSelect.value,
      activePlayerId: activeSelect.value || null,
    });
  });
  gameForm.appendChild(gameApply);

  const restartBtn = el("button", "debug-apply-btn debug-restart-btn", "Restart game");
  restartBtn.addEventListener("click", () => {
    boardRoom.send("_debugRestart");
  });
  gameForm.appendChild(restartBtn);

  gameSection.appendChild(gameForm);
  content.appendChild(gameSection);

  // --- Players section ---
  const playersSection = el("div", "debug-section");
  playersSection.appendChild(el("h3", "debug-section-title", "Players"));
  for (const p of state.players) {
    const pCard = el("div", "debug-player-card");
    const pTitle = el("div", "debug-player-title", `${p.name} (${p.playerId.slice(0, 8)})`);
    pTitle.classList.toggle("debug-disconnected", !p.connected);
    pCard.appendChild(pTitle);

    const pForm = el("div", "debug-form");
    const cellInput = numInput(p.cellId, 1, trackCells.length);
    pForm.appendChild(labeledField("Cell", cellInput));
    const lapInput = numInput(p.lapCount, 0, 4);
    pForm.appendChild(labeledField("Lap", lapInput));
    const coinsInput = numInput(p.coins, 0);
    pForm.appendChild(labeledField("Coins", coinsInput));
    const rankInput = numInput(p.rank);
    rankInput.readOnly = true;
    rankInput.classList.add("debug-readonly");
    pForm.appendChild(labeledField("Rank", rankInput));
    const bananaDiscInput = numInput(p.pendingDiscard, 0);
    pForm.appendChild(labeledField("Pending discards", bananaDiscInput));
    const drawInput = numInput(p.drawCount);
    drawInput.readOnly = true;
    drawInput.classList.add("debug-readonly");
    pForm.appendChild(labeledField("Draw", drawInput));
    const discardInput = numInput(p.discardCount);
    discardInput.readOnly = true;
    discardInput.classList.add("debug-readonly");
    pForm.appendChild(labeledField("Discard", discardInput));

    const pApply = el("button", "debug-apply-btn", "Apply");
    pApply.addEventListener("click", () => {
      boardRoom.send("_testSetState", {
        playerId: p.playerId,
        cellId: Number(cellInput.value),
        lapCount: Number(lapInput.value),
        coins: Number(coinsInput.value),
        pendingDiscard: Number(bananaDiscInput.value),
      });
    });
    pForm.appendChild(pApply);
    pCard.appendChild(pForm);

    // Hand cards
    const handSection = el("div", "debug-hand-section");
    handSection.appendChild(el("div", "debug-label", `Hand (${p.hand.length})`));
    const handCards = el("div", "debug-hand-cards");
    for (let ci = 0; ci < p.hand.length; ci++) {
      const card = p.hand[ci];
      const cardEl = el("div", "debug-hand-card");
      const itemsInput = el("input", "debug-input debug-river-items-input");
      itemsInput.value = card.items.join(", ");
      cardEl.appendChild(itemsInput);
      const applyBtn = el("button", "debug-small-btn debug-apply-btn", "\u2713");
      const cardIndex = ci;
      const applyCard = () => {
        const raw = itemsInput.value.trim();
        const items = raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : null;
        if (items) {
          boardRoom.send("_testSetState", { playerId: p.playerId, setHandCard: { index: cardIndex, items } });
        }
      };
      applyBtn.addEventListener("click", applyCard);
      itemsInput.addEventListener("keydown", (e) => { if (e.key === "Enter") applyCard(); });
      cardEl.appendChild(applyBtn);
      const removeBtn = el("button", "debug-small-btn debug-remove-btn", "\u2715");
      removeBtn.addEventListener("click", () => {
        boardRoom.send("_testSetState", { playerId: p.playerId, setHandCard: { index: cardIndex, items: null } });
      });
      cardEl.appendChild(removeBtn);
      handCards.appendChild(cardEl);
    }
    const addCardBtn = el("button", "debug-small-btn debug-add-btn", "+ card");
    addCardBtn.addEventListener("click", () => {
      boardRoom.send("_testSetState", { playerId: p.playerId, addHandCard: { items: ["coin"] } });
    });
    handCards.appendChild(addCardBtn);
    handSection.appendChild(handCards);
    pCard.appendChild(handSection);

    playersSection.appendChild(pCard);
  }
  content.appendChild(playersSection);

  // --- Ranking section ---
  const rankingSection = el("div", "debug-section");
  rankingSection.appendChild(el("h3", "debug-section-title", "Final Ranking"));
  const currentRanking = state.ranking || [];
  const rankedIds = currentRanking.map((r) => r.playerId);
  const rankingList = el("div", "debug-ranking-list");

  function rebuildRankingUI() {
    rankingList.innerHTML = "";
    for (let i = 0; i < rankedIds.length; i++) {
      const p = state.players.find((pl) => pl.playerId === rankedIds[i]);
      const row = el("div", "debug-ranking-row");
      row.textContent = `${i + 1}. ${p ? p.name : rankedIds[i].slice(0, 8)}`;
      const removeBtn = el("button", "debug-small-btn debug-remove-btn", "\u2715");
      removeBtn.addEventListener("click", () => {
        rankedIds.splice(i, 1);
        rebuildRankingUI();
        boardRoom.send("_debugSetGameState", { setRanking: rankedIds });
      });
      row.appendChild(removeBtn);
      rankingList.appendChild(row);
    }
  }
  rebuildRankingUI();
  rankingSection.appendChild(rankingList);

  const unranked = state.players.filter((p) => !rankedIds.includes(p.playerId));
  if (unranked.length > 0) {
    const addRow = el("div", "debug-ranking-add");
    const addSelect = el("select", "debug-input");
    for (const p of unranked) {
      const opt = document.createElement("option");
      opt.value = p.playerId;
      opt.textContent = p.name || p.playerId.slice(0, 8);
      addSelect.appendChild(opt);
    }
    addRow.appendChild(addSelect);
    const addBtn = el("button", "debug-small-btn debug-add-btn", "+");
    addBtn.addEventListener("click", () => {
      rankedIds.push(addSelect.value);
      boardRoom.send("_debugSetGameState", { setRanking: rankedIds });
    });
    addRow.appendChild(addBtn);
    rankingSection.appendChild(addRow);
  }
  content.appendChild(rankingSection);

  // --- Circuit section ---
  const circuitSection = el("div", "debug-section");
  circuitSection.appendChild(el("h3", "debug-section-title", "Circuit"));
  const circuitGrid = el("div", "debug-circuit-grid");
  for (const cellDef of trackCells) {
    const cellId = cellDef.id;
    const cellEl = el("div", "debug-cell");
    if (cellDef.path_color) cellEl.classList.add(`debug-cell-${cellDef.path_color}`);
    const isFinish = !!cellDef.finish_line;
    const cellLabel = el("div", "debug-cell-id", `Cell ${cellId}${isFinish ? " \u2691" : ""}`);
    cellEl.appendChild(cellLabel);

    const occupants = state.cellOccupants[cellId] || [];
    const playerNames = [];
    let bananaCount = 0;
    let shellCount = 0;
    for (const occ of occupants) {
      if (occ === "banana") {
        bananaCount++;
      } else if (occ === "green_shell") {
        shellCount++;
      } else {
        const player = state.players.find((p) => p.playerId === occ);
        playerNames.push(player ? player.name : occ.slice(0, 6));
      }
    }

    if (playerNames.length > 0) {
      cellEl.appendChild(el("div", "debug-cell-players", playerNames.join(", ")));
    }
    if (bananaCount > 0) {
      const bananaRow = el("div", "debug-cell-bananas");
      bananaRow.textContent = "\uD83C\uDF4C \u00D7" + bananaCount + " ";
      const removeBtn = el("button", "debug-small-btn debug-remove-btn", "\u2212");
      removeBtn.addEventListener("click", () => {
        boardRoom.send("_debugSetGameState", { removeBanana: { cellId } });
      });
      bananaRow.appendChild(removeBtn);
      cellEl.appendChild(bananaRow);
    }
    if (shellCount > 0) {
      const shellRow = el("div", "debug-cell-bananas");
      shellRow.textContent = "\uD83D\uDC22 \u00D7" + shellCount + " ";
      const removeBtn = el("button", "debug-small-btn debug-remove-btn", "\u2212");
      removeBtn.addEventListener("click", () => {
        boardRoom.send("_debugSetGameState", { removeShell: { cellId } });
      });
      shellRow.appendChild(removeBtn);
      cellEl.appendChild(shellRow);
    }
    const addBananaBtn = el("button", "debug-small-btn debug-add-btn", "+\uD83C\uDF4C");
    addBananaBtn.addEventListener("click", () => {
      boardRoom.send("_debugSetGameState", { addBanana: { cellId } });
    });
    cellEl.appendChild(addBananaBtn);
    const addShellBtn = el("button", "debug-small-btn debug-add-btn", "+\uD83D\uDC22");
    addShellBtn.addEventListener("click", () => {
      boardRoom.send("_debugSetGameState", { addShell: { cellId } });
    });
    cellEl.appendChild(addShellBtn);
    circuitGrid.appendChild(cellEl);
  }
  circuitSection.appendChild(circuitGrid);
  content.appendChild(circuitSection);

  // --- Rivers section ---
  if (state.rivers) {
    const riversSection = el("div", "debug-section");
    riversSection.appendChild(el("h3", "debug-section-title", "Rivers"));
    for (const river of state.rivers) {
      const rCard = el("div", "debug-river-card");
      rCard.appendChild(el("div", "debug-river-title", `River ${river.id} (cost: ${river.cost}, deck: ${river.deckCount})`));
      const slotsRow = el("div", "debug-river-slots");
      for (let si = 0; si < 3; si++) {
        const slot = river.slots[si];
        const slotEl = el("div", "debug-river-slot");
        const slotLabel = el("div", "debug-river-slot-label", `Slot ${si}`);
        slotEl.appendChild(slotLabel);

        const itemsInput = el("input", "debug-input debug-river-items-input");
        itemsInput.value = slot ? slot.items.join(", ") : "";
        itemsInput.placeholder = "empty";
        slotEl.appendChild(itemsInput);

        const slotApply = el("button", "debug-small-btn debug-apply-btn", "\u2713");
        const riverId = river.id;
        const slotIndex = si;
        const applySlot = () => {
          const raw = itemsInput.value.trim();
          const items = raw ? raw.split(",").map((s) => s.trim()).filter(Boolean) : null;
          boardRoom.send("_debugSetGameState", {
            setRiverSlot: { riverId, slotIndex, items },
          });
        };
        slotApply.addEventListener("click", applySlot);
        itemsInput.addEventListener("keydown", (e) => { if (e.key === "Enter") applySlot(); });
        slotEl.appendChild(slotApply);
        slotsRow.appendChild(slotEl);
      }
      rCard.appendChild(slotsRow);
      riversSection.appendChild(rCard);
    }
    content.appendChild(riversSection);
  }

  // --- Raw JSON toggle ---
  const rawSection = el("div", "debug-section");
  const rawToggle = el("button", "debug-raw-toggle", "Toggle Raw JSON");
  const rawPre = el("pre", "debug-raw-json");
  rawPre.textContent = JSON.stringify(state, null, 2);
  rawPre.style.display = "none";
  rawToggle.addEventListener("click", () => {
    rawPre.style.display = rawPre.style.display === "none" ? "block" : "none";
  });
  rawSection.appendChild(rawToggle);
  rawSection.appendChild(rawPre);
  content.appendChild(rawSection);
}

function el(tag, className, text) {
  const e = document.createElement(tag);
  if (className) e.className = className;
  if (text) e.textContent = text;
  return e;
}

function numInput(value, min, max) {
  const input = el("input", "debug-input");
  input.type = "number";
  input.value = value;
  if (min !== undefined) input.min = min;
  if (max !== undefined) input.max = max;
  return input;
}

function labeledField(label, input) {
  const wrapper = el("div", "debug-field");
  wrapper.appendChild(el("label", "debug-label", label));
  wrapper.appendChild(input);
  return wrapper;
}
