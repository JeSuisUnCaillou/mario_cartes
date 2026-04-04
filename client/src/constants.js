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
