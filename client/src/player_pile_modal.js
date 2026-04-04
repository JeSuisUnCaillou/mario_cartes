import { createCardElement } from "./player_cards.js";

export function openPileModal(title, cards) {
  if (document.querySelector(".pile-modal")) return;
  const overlay = document.createElement("div");
  overlay.className = "pile-modal";
  overlay.addEventListener("click", (e) => {
    if (e.target.closest(".pile-modal-content, .pile-modal-close")) return;
    closePileModal();
  });

  const closeBtn = document.createElement("button");
  closeBtn.className = "pile-modal-close";
  closeBtn.textContent = "✕";
  closeBtn.addEventListener("click", closePileModal);
  overlay.appendChild(closeBtn);

  const heading = document.createElement("h2");
  heading.className = "pile-modal-title";
  heading.textContent = title;
  overlay.appendChild(heading);

  const content = document.createElement("div");
  content.className = "pile-modal-content";
  if (cards.length === 0) {
    content.innerHTML = `<div class="pile-modal-empty">No cards</div>`;
  } else {
    for (const card of cards) {
      const el = createCardElement(card);
      el.className = "card pile-modal-card";
      content.appendChild(el);
    }
  }
  overlay.appendChild(content);

  document.body.appendChild(overlay);
}

export function closePileModal() {
  const modal = document.querySelector(".pile-modal");
  if (modal) modal.remove();
}
