import { cardItemPositions } from "./player.functions.js";
import { RANK_ICONS, ordinalSuffix } from "./rank.js";
import { canBuyFromRiver } from "./river.functions.js";
import { ITEM_ICONS } from "./constants.js";

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

function animateCardFlip(deckEl, cardEl) {
  cardEl.style.visibility = "hidden";

  requestAnimationFrame(() => {
    const deckRect = deckEl.getBoundingClientRect();
    const cardRect = cardEl.getBoundingClientRect();

    const flyer = document.createElement("div");
    flyer.className = "card-flyer";
    flyer.style.position = "fixed";
    flyer.style.width = deckRect.width + "px";
    flyer.style.aspectRatio = "54 / 86";
    flyer.style.left = deckRect.left + "px";
    flyer.style.top = deckRect.top + "px";
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

    const frontFace = cardEl.cloneNode(true);
    frontFace.className = "card-flyer-face card-flyer-front";
    frontFace.style.cssText = "";

    inner.appendChild(backFace);
    inner.appendChild(frontFace);
    flyer.appendChild(inner);
    document.body.appendChild(flyer);

    flyer.getBoundingClientRect();
    const flyDuration = 250;
    flyer.style.transition = `left ${flyDuration}ms ease-out, top ${flyDuration}ms ease-out, width ${flyDuration}ms ease-out`;
    flyer.style.left = cardRect.left + "px";
    flyer.style.top = cardRect.top + "px";
    flyer.style.width = cardRect.width + "px";
    inner.style.transform = "rotateY(180deg)";

    flyer.addEventListener("transitionend", () => {
      cardEl.style.visibility = "";
      flyer.remove();
    }, { once: true });
  });
}

/**
 * Detect slots that changed from null to a card (refill).
 */
function detectRefills(prevRivers, newRivers) {
  const refills = [];
  if (!prevRivers) return refills;
  for (const newRiver of newRivers) {
    const prevRiver = prevRivers.find((r) => r.id === newRiver.id);
    if (!prevRiver) continue;
    for (let i = 0; i < newRiver.slots.length; i++) {
      if (prevRiver.slots[i] === null && newRiver.slots[i] !== null) {
        refills.push({ riverId: newRiver.id, slotIndex: i });
      }
    }
  }
  return refills;
}

/**
 * Render a full river row.
 * @param {object} river - { id, cost, slots, deckCount }
 * @param {object} options
 * @param {function} [options.onCardClick] - (river, card) => void
 * @param {function} [options.isAffordable] - (river) => boolean
 */
function renderRankIndicators(riverId, riverCount, playerCount) {
  const container = document.createElement("div");
  container.className = "river-rank-indicators";
  const maxRank = playerCount > 0 ? Math.min(RANK_ICONS.length, playerCount) : RANK_ICONS.length;
  for (let rank = 1; rank <= maxRank; rank++) {
    const wrapper = document.createElement("span");
    const icon = document.createElement("img");
    icon.src = RANK_ICONS[rank - 1];
    icon.className = "river-rank-icon";
    icon.draggable = false;
    if (!canBuyFromRiver(rank, riverCount, riverId, playerCount)) {
      wrapper.className = "river-rank-denied";
    }
    wrapper.appendChild(icon);
    const label = document.createElement("span");
    label.className = "river-rank-label";
    label.textContent = ordinalSuffix(rank);
    wrapper.appendChild(label);
    container.appendChild(wrapper);
  }
  return container;
}

export function renderRiverRow(river, options = {}) {
  const { onCardClick, isAffordable, isAccessible, rankIndicators, riverCount, playerCount } = options;

  const row = document.createElement("div");
  row.className = "river-row";
  row.dataset.riverId = river.id;

  const costLabel = document.createElement("div");
  costLabel.className = "river-cost";
  costLabel.innerHTML = `<span class="river-cost-badge"><span>${river.cost}</span><img src="/coin.svg" class="river-cost-icon" /></span>`;
  if (rankIndicators) {
    costLabel.appendChild(renderRankIndicators(river.id, riverCount, playerCount));
  }
  row.appendChild(costLabel);

  const cardsRow = document.createElement("div");
  cardsRow.className = "river-cards";

  cardsRow.appendChild(createDeckPile(river));

  const slotsContainer = document.createElement("div");
  slotsContainer.className = "river-slots";

  const accessible = !isAccessible || isAccessible(river);

  if (!accessible) {
    row.classList.add("inaccessible");
  }

  for (const card of river.slots) {
    if (card) {
      const cardEl = createRiverCard(card);
      if (!accessible) {
        cardEl.classList.add("inaccessible");
      } else if (isAffordable && !isAffordable(river)) {
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
 * Detects slot refills (null → card) and animates them with a card flip.
 * @param {HTMLElement} container
 * @param {Array} rivers
 * @param {object} options - passed to renderRiverRow
 */
export function renderRivers(container, rivers, options = {}) {
  const prevRivers = container._previousRivers || null;
  const refills = detectRefills(prevRivers, rivers);

  container.innerHTML = "";
  for (const river of rivers) {
    container.appendChild(renderRiverRow(river, options));
  }

  container._previousRivers = rivers;

  for (const { riverId, slotIndex } of refills) {
    const row = container.querySelector(`[data-river-id="${riverId}"]`);
    if (!row) continue;
    const deckEl = row.querySelector(".river-deck-img") || row.querySelector(".river-deck-empty");
    const slots = row.querySelectorAll(".river-slots > .river-card");
    const cardEl = slots[slotIndex];
    if (deckEl && cardEl && !cardEl.classList.contains("river-slot-empty")) {
      animateCardFlip(deckEl, cardEl);
    }
  }
}
