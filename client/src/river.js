import { cardItemPositions } from "./player.functions.js";

const ITEM_ICONS = {
  coin: "/coin.svg",
  banana: "/banana.svg",
  mushroom: "/mushroom.svg",
};

function createRiverCard(card) {
  const el = document.createElement("div");
  el.className = "river-card";
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

function createEmptySlot() {
  const empty = document.createElement("div");
  empty.className = "river-card river-slot-empty";
  return empty;
}

function createDeckPile(river) {
  const deckPile = document.createElement("div");
  deckPile.className = "river-deck";

  if (river.deckCount === 0) {
    const emptyEl = document.createElement("div");
    emptyEl.className = "river-deck-empty";
    const span = document.createElement("span");
    span.textContent = "Empty";
    emptyEl.appendChild(span);
    deckPile.appendChild(emptyEl);
  } else {
    const deckImg = document.createElement("img");
    deckImg.src = "/card - back.svg";
    deckImg.className = "river-deck-img";
    deckImg.draggable = false;
    deckPile.appendChild(deckImg);
  }

  const deckCount = document.createElement("div");
  deckCount.className = "river-deck-count";
  deckCount.textContent = river.deckCount;
  deckPile.appendChild(deckCount);

  return deckPile;
}

/**
 * Render a full river row.
 * @param {object} river - { id, cost, slots, deckCount }
 * @param {object} options
 * @param {function} [options.onCardClick] - (river, card) => void
 * @param {function} [options.isAffordable] - (river) => boolean
 */
export function renderRiverRow(river, options = {}) {
  const { onCardClick, isAffordable } = options;

  const row = document.createElement("div");
  row.className = "river-row";
  row.dataset.riverId = river.id;

  const costLabel = document.createElement("div");
  costLabel.className = "river-cost";
  costLabel.innerHTML = `<span>${river.cost}</span><img src="/coin.svg" class="river-cost-icon" />`;
  row.appendChild(costLabel);

  const cardsRow = document.createElement("div");
  cardsRow.className = "river-cards";

  cardsRow.appendChild(createDeckPile(river));

  const slotsContainer = document.createElement("div");
  slotsContainer.className = "river-slots";

  for (const card of river.slots) {
    if (card) {
      const cardEl = createRiverCard(card);
      if (isAffordable && !isAffordable(river)) {
        cardEl.classList.add("unaffordable");
      } else if (onCardClick) {
        cardEl.style.cursor = "pointer";
        cardEl.addEventListener("click", () => onCardClick(river, card));
      }
      slotsContainer.appendChild(cardEl);
    } else {
      slotsContainer.appendChild(createEmptySlot());
    }
  }

  cardsRow.appendChild(slotsContainer);
  row.appendChild(cardsRow);
  return row;
}

/**
 * Render all rivers into a container.
 * @param {HTMLElement} container
 * @param {Array} rivers
 * @param {object} options - passed to renderRiverRow
 */
export function renderRivers(container, rivers, options = {}) {
  container.innerHTML = "";
  for (const river of rivers) {
    container.appendChild(renderRiverRow(river, options));
  }
}
