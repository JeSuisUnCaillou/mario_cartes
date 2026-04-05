import { ITEM_ICONS, createCardDOM, renderCoinIcons } from "./constants.js";

function computeFanTransform(index, count) {
  const angleStep = 10;
  const offset = index - (count - 1) / 2;
  const rotation = offset * angleStep;
  const lift = Math.abs(offset) * 8;
  return `rotate(${rotation}deg) translateY(${lift}px)`;
}

const cardElements = new Map();

export function clearCardElements() {
  cardElements.clear();
}

export function updateCardMushroomIcons(darkCount) {
  for (const [, el] of cardElements) {
    let items = [];
    try { items = JSON.parse(el.dataset.items); } catch (e) {}
    const icons = el.querySelectorAll(".card-item");
    let remaining = darkCount;
    items.forEach((item, i) => {
      if (item === "mushroom") {
        icons[i].src = remaining > 0 ? "/dark_mushroom.svg" : "/mushroom.svg";
        remaining--;
      }
    });
  }
}

export function createCardElement(card) {
  const el = createCardDOM(card);
  el.dataset.items = JSON.stringify(card.items);
  return el;
}

export function ensureCardElements(deck) {
  if (!deck) return;
  for (const card of deck) {
    if (!cardElements.has(card.id)) {
      cardElements.set(card.id, createCardElement(card));
    }
  }
}

export function getCardElement(card) {
  if (!cardElements.has(card.id)) {
    cardElements.set(card.id, createCardElement(card));
  }
  return cardElements.get(card.id);
}

export function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function spawnThrowAnimation(imageSrc, playZone) {
  const zoneRect = playZone.getBoundingClientRect();
  const el = document.createElement("img");
  el.src = imageSrc;
  el.className = "item-throw";
  el.style.position = "fixed";
  el.style.width = "60px";
  el.style.height = "auto";
  el.style.left = (zoneRect.left + zoneRect.width / 2 - 30) + "px";
  el.style.top = (zoneRect.top + zoneRect.height / 2 - 30) + "px";
  el.style.zIndex = "999";
  el.style.pointerEvents = "none";
  document.body.appendChild(el);
  el.addEventListener("animationend", () => el.remove(), { once: true });
}

export async function animateShuffle(count) {
  const discardEl = document.getElementById("discard-pile");
  const drawEl = document.getElementById("draw-pile");
  const discardRect = discardEl.getBoundingClientRect();
  const drawRect = drawEl.getBoundingClientRect();
  let remaining = count;

  for (let i = 0; i < count; i++) {
    remaining--;
    renderPileContent("discard-pile-content", remaining, "Discard pile", "/card - back.svg");
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

export async function animateDrawCards(cards, addDragListeners, animDrawCount, startIndex = 0) {
  const drawEl = document.getElementById("draw-pile");
  const drawRect = drawEl.getBoundingClientRect();
  const handArea = document.getElementById("hand-area");

  // If first batch, clear hand area
  if (startIndex === 0) {
    handArea.innerHTML = "";
  }

  let currentDrawCount = animDrawCount;

  // Animate each card one by one: add to DOM, recompute fan, fly in
  for (let i = 0; i < cards.length; i++) {
    const card = cards[i];
    const el = getCardElement(card);
    el.style.visibility = "hidden";
    el.style.transform = "rotate(0deg) translateY(0px)";
    handArea.appendChild(el);

    // Recompute fan for all visible cards + this new one
    const allCards = Array.from(handArea.children);
    const visibleCount = allCards.length;
    allCards.forEach((c, idx) => {
      c.dataset.fanTransform = computeFanTransform(idx, visibleCount);
      // Existing visible cards animate via CSS transition
      if (c !== el) {
        c.style.transform = c.dataset.fanTransform;
      }
    });

    // Set the new card's transform to get its target position
    el.style.transform = el.dataset.fanTransform;
    const targetRect = el.getBoundingClientRect();

    // Update draw pile count
    currentDrawCount--;
    renderPileContent("draw-pile-content", currentDrawCount, "Draw pile", "/card - back.svg");
    updatePileCount("draw-count", currentDrawCount);

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

    const frontFace = el.cloneNode(true);
    frontFace.className = "card-flyer-face card-flyer-front";
    frontFace.style.cssText = "";

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
        el.style.visibility = "";
        addDragListeners(el);
        flyer.remove();
        resolve();
      }, { once: true });
    });
  }

  return currentDrawCount;
}

export function captureHandPositions() {
  const handArea = document.getElementById("hand-area");
  const cards = Array.from(handArea.querySelectorAll(".card"));
  const positions = new Map();
  cards.forEach((img) => {
    positions.set(img.dataset.cardId, img.getBoundingClientRect());
  });
  return positions;
}

export function recomputeFan(previousPositions) {
  const handArea = document.getElementById("hand-area");
  const cards = Array.from(handArea.querySelectorAll(".card:not([style*='visibility: hidden'])"));
  const n = cards.length;
  // Compute and apply new fan transforms without transition
  cards.forEach((img, i) => {
    img.style.transition = "none";
    img.dataset.fanTransform = computeFanTransform(i, n);
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

export function renderHand(hand, addDragListeners) {
  const handArea = document.getElementById("hand-area");
  handArea.innerHTML = "";
  const n = hand.length;
  hand.forEach((card, i) => {
    const el = getCardElement(card);
    el.style.transform = computeFanTransform(i, n);
    el.dataset.fanTransform = el.style.transform;
    addDragListeners(el);
    handArea.appendChild(el);
  });
}

export function renderPileContent(containerId, count, emptyLabel, iconSrc) {
  const container = document.getElementById(containerId);
  if (count === 0) {
    container.innerHTML = `<div class="pile-empty"><span>${emptyLabel}</span></div>`;
  } else {
    container.innerHTML = `<img class="pile-icon" src="${iconSrc}" alt="${emptyLabel}" />`;
  }
}

export function updatePileCount(countId, count) {
  document.getElementById(countId).textContent = count;
}

export function updatePiles({ drawCount, discardCount, discardTopCard }) {
  renderPileContent("draw-pile-content", drawCount, "Draw pile", "/card - back.svg");
  const discardContainer = document.getElementById("discard-pile-content");
  if (discardCount === 0) {
    discardContainer.innerHTML = `<div class="pile-empty"><span>Discard pile</span></div>`;
  } else if (discardTopCard) {
    const miniCard = createCardElement(discardTopCard);
    miniCard.className = "card pile-card";
    discardContainer.innerHTML = "";
    discardContainer.appendChild(miniCard);
  }
  updatePileCount("draw-count", drawCount);
  updatePileCount("discard-count", discardCount);
}

export function updateCoinDisplay(coins, permanentCoins, updateBuyButton, slowCounters = 0) {
  const coinDisplay = document.getElementById("coin-display");
  if (!coinDisplay) return;
  coinDisplay.innerHTML = "";
  renderCoinIcons(coinDisplay, coins, permanentCoins);
  for (let i = 0; i < slowCounters; i++) {
    const img = document.createElement("img");
    img.src = "/dark_mushroom.svg";
    img.className = "coin-icon";
    coinDisplay.appendChild(img);
  }
  updateBuyButton();
}
