import { renderRivers } from "./river.js";
import { getRiverPrice } from "./river.functions.js";
import { renderCoinIcons } from "./constants.js";

export function updateBuyButton(activePlayerId, myPlayerId, latestRivers, blocked, openBuyModal) {
  const container = document.getElementById("buy-btn-container");
  if (!container) return;
  const isMyTurn = activePlayerId === myPlayerId;
  if (isMyTurn && latestRivers && !blocked) {
    if (!document.getElementById("buy-btn")) {
      container.innerHTML = `<button id="buy-btn" class="buy-btn">Buy cards</button>`;
      document.getElementById("buy-btn").addEventListener("click", openBuyModal);
    }
    container.style.visibility = "";
  } else {
    container.style.visibility = "hidden";
  }
}

export function openBuyModal(currentRoom, latestRivers, currentCoins, currentRank, currentPermanentCoins = 0, playerCount = 0) {
  if (document.querySelector(".buy-modal")) return;
  const overlay = document.createElement("div");
  overlay.className = "buy-modal";
  overlay.addEventListener("click", (e) => {
    if (e.target.closest(".river-row, .buy-modal-close")) return;
    closeBuyModal();
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
  renderBuyModal(currentRoom, latestRivers, currentCoins, currentRank, currentPermanentCoins, playerCount);
}

export function renderBuyModal(currentRoom, latestRivers, currentCoins, currentRank, currentPermanentCoins = 0, playerCount = 0) {
  const content = document.querySelector(".buy-modal-content");
  if (!content || !latestRivers) return;

  renderRivers(content, latestRivers, {
    onCardClick: (river, card) => {
      if (currentRoom) {
        currentRoom.send("buyCard", { riverId: river.id, cardId: card.id });
      }
    },
    effectivePrice: (river) => getRiverPrice(river.cost, currentRank, playerCount),
    isAffordable: (river) => currentCoins + currentPermanentCoins >= getRiverPrice(river.cost, currentRank, playerCount),
  });

  // Coin display on top of rivers
  const coinBar = document.createElement("div");
  coinBar.className = "buy-modal-coins";
  renderCoinIcons(coinBar, currentCoins, currentPermanentCoins);
  content.prepend(coinBar);
}

export function closeBuyModal() {
  const modal = document.querySelector(".buy-modal");
  if (modal) modal.remove();
}
