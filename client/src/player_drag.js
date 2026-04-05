import { isPointInRect } from "./player.functions.js";

function getPointerPos(e) {
  if (e.touches) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
  return { x: e.clientX, y: e.clientY };
}

export class CardDragHandler {
  constructor({ getRoom, isBlocked, isPendingDiscard }) {
    this.getRoom = getRoom;
    this.isBlocked = isBlocked;
    this.isPendingDiscard = isPendingDiscard;
    this._playing = false;
  }

  get isPlaying() { return this._playing; }
  reset() { this._playing = false; }

  attach(card) {
    const handler = this;
    let startX, startY, origLeft, origTop, dragClone;

    function onStart(e) {
      if (handler._playing || handler.isBlocked()) return;
      e.preventDefault();
      const pos = getPointerPos(e);
      const rect = card.getBoundingClientRect();
      startX = pos.x;
      startY = pos.y;
      origLeft = rect.left;
      origTop = rect.top;

      dragClone = card.cloneNode(true);
      dragClone.style.position = "fixed";
      dragClone.style.left = origLeft + "px";
      dragClone.style.top = origTop + "px";
      dragClone.style.width = rect.width + "px";
      dragClone.style.height = rect.height + "px";
      dragClone.style.transform = "scale(1.1)";
      dragClone.style.zIndex = "1000";
      dragClone.style.margin = "0";
      dragClone.style.transition = "none";
      dragClone.style.pointerEvents = "none";
      dragClone.style.filter = "drop-shadow(10px 15px 4px rgba(0, 0, 0, 0.35))";
      document.body.appendChild(dragClone);

      card.style.visibility = "hidden";

      document.addEventListener("mousemove", onMove);
      document.addEventListener("mouseup", onEnd);
      document.addEventListener("touchmove", onMove, { passive: false });
      document.addEventListener("touchend", onEnd);
    }

    function onMove(e) {
      e.preventDefault();
      const pos = getPointerPos(e);
      const dx = pos.x - startX;
      const dy = pos.y - startY;
      dragClone.style.left = (origLeft + dx) + "px";
      dragClone.style.top = (origTop + dy) + "px";
    }

    function onEnd() {
      document.removeEventListener("mousemove", onMove);
      document.removeEventListener("mouseup", onEnd);
      document.removeEventListener("touchmove", onMove);
      document.removeEventListener("touchend", onEnd);

      const playZone = document.getElementById("play-zone");
      const zoneRect = playZone.getBoundingClientRect();
      const cloneRect = dragClone.getBoundingClientRect();
      const centerX = cloneRect.left + cloneRect.width / 2;
      const centerY = cloneRect.top + cloneRect.height / 2;

      const inZone = isPointInRect(centerX, centerY, zoneRect.left, zoneRect.top, zoneRect.right, zoneRect.bottom);

      if (inZone && playZone.classList.contains("waiting")) {
        playZone.classList.add("waiting-reject");
        playZone.addEventListener("animationend", () => {
          playZone.classList.remove("waiting-reject");
        }, { once: true });
      }

      if (inZone && !playZone.classList.contains("waiting")) {
        handler._playing = true;
        dragClone.style.transition = "all 0.3s ease";
        dragClone.style.left = (zoneRect.left + zoneRect.width / 2 - cloneRect.width / 2) + "px";
        dragClone.style.top = (zoneRect.top + zoneRect.height / 2 - cloneRect.height / 2) + "px";
        dragClone.style.transform = "scale(1)";
        dragClone.style.filter = "drop-shadow(2px 2px 1px rgba(0, 0, 0, 0.3))";

        const room = handler.getRoom();
        setTimeout(() => {
          if (room) {
            if (handler.isPendingDiscard()) {
              room.send("discardCard", { cardId: card.dataset.cardId });
            } else {
              room.send("playCard", { cardId: card.dataset.cardId });
            }
          }
        }, 500);
        setTimeout(() => { if (handler._playing) handler._playing = false; }, 5000);
      } else {
        dragClone.style.transition = "all 0.3s ease-in-out";
        dragClone.style.left = origLeft + "px";
        dragClone.style.top = origTop + "px";
        dragClone.style.transform = card.dataset.fanTransform;
        dragClone.addEventListener("transitionend", () => {
          dragClone.remove();
          card.style.visibility = "";
        }, { once: true });
      }
    }

    card.addEventListener("mousedown", onStart);
    card.addEventListener("touchstart", onStart, { passive: false });
  }
}
