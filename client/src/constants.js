import { cardItemPositions } from "./player.functions.js";

export const ITEM_ICONS = {
  coin: "/coin.svg",
  banana: "/banana.svg",
  mushroom: "/mushroom.svg",
  green_shell: "/green_shell.svg",
  red_shell: "/red_shell.svg",
  blue_shell: "/blue_shell.svg",
  star: "/star.svg",
};

export function createCardDOM(card, className = "card") {
  const el = document.createElement("div");
  el.className = className;
  el.dataset.cardId = card.id;

  const bg = document.createElement("img");
  bg.src = "/card - blank.svg";
  bg.className = "card-bg";
  bg.draggable = false;
  el.appendChild(bg);

  const positions = cardItemPositions(card.items.length);
  card.items.forEach((item, i) => {
    const icon = document.createElement("img");
    icon.src = ITEM_ICONS[item];
    icon.className = "card-item";
    icon.style.left = positions[i].x;
    icon.style.top = positions[i].y;
    icon.draggable = false;
    el.appendChild(icon);
  });

  return el;
}

function appendCoins(container, count, src, collapsed) {
  if (count <= 0) return;
  if (collapsed) {
    const wrapper = document.createElement("span");
    wrapper.className = "coin-group";
    const img = document.createElement("img");
    img.src = src;
    img.className = "coin-icon";
    wrapper.appendChild(img);
    const label = document.createElement("span");
    label.className = "coin-count";
    label.textContent = `x${count}`;
    wrapper.appendChild(label);
    container.appendChild(wrapper);
  } else {
    for (let i = 0; i < count; i++) {
      const img = document.createElement("img");
      img.src = src;
      img.className = "coin-icon";
      container.appendChild(img);
    }
  }
}

export function renderCoinIcons(container, coins, permanentCoins) {
  const blueCount = Math.min(coins, permanentCoins);
  const goldCount = Math.max(0, coins - permanentCoins);
  const collapsed = blueCount > 3 && goldCount > 3;
  appendCoins(container, blueCount, "/permacoin.svg", collapsed);
  appendCoins(container, goldCount, "/coin.svg", collapsed);
}
