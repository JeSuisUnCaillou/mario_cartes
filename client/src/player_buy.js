import { renderRivers } from "./river.js";
import { rankBadge } from "./rank.js";

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

export function openBuyModal(currentRoom, latestRivers, currentCoins, currentRank) {
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
  renderBuyModal(currentRoom, latestRivers, currentCoins, currentRank);
}

export function renderBuyModal(currentRoom, latestRivers, currentCoins, currentRank) {
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

  // Coin display on top of rivers
  const coinBar = document.createElement("div");
  coinBar.className = "buy-modal-coins";
  for (let i = 0; i < currentCoins; i++) {
    const img = document.createElement("img");
    img.src = "/coin.svg";
    img.className = "coin-icon";
    coinBar.appendChild(img);
  }
  content.prepend(coinBar);

  // Rank display on top of coins
  if (currentRank > 0) {
    const rankBar = document.createElement("div");
    rankBar.className = "buy-modal-rank";
    rankBar.innerHTML = rankBadge(currentRank, "buy-modal-rank-icon");
    content.prepend(rankBar);
  }
}

export function closeBuyModal() {
  const modal = document.querySelector(".buy-modal");
  if (modal) modal.remove();
}
