let menuModalOpen = false;
let boardRoom = null;

export function setMenuRoom(room) {
  boardRoom = room;
}

export function setupMenuKeyboard() {
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape") {
      if (document.querySelector(".debug-modal")) return;
      toggleMenuModal();
    }
  });
}

export function toggleMenuModal() {
  if (menuModalOpen) {
    closeMenuModal();
  } else {
    openMenuModal();
  }
}

function openMenuModal() {
  menuModalOpen = true;
  const overlay = document.createElement("div");
  overlay.className = "menu-modal";

  let mouseDownTarget = null;
  overlay.addEventListener("mousedown", (e) => { mouseDownTarget = e.target; });
  overlay.addEventListener("click", (e) => {
    if (e.target === overlay && mouseDownTarget === overlay) closeMenuModal();
    mouseDownTarget = null;
  });

  const close = document.createElement("button");
  close.className = "menu-modal-close";
  close.textContent = "\u2715";
  close.addEventListener("click", closeMenuModal);
  overlay.appendChild(close);

  const content = document.createElement("div");
  content.className = "menu-modal-content";

  const restartBtn = document.createElement("button");
  restartBtn.className = "menu-modal-btn";
  restartBtn.textContent = "Restart the game";
  restartBtn.addEventListener("click", () => {
    if (boardRoom) boardRoom.send("restartGame");
    closeMenuModal();
  });
  content.appendChild(restartBtn);

  const homeBtn = document.createElement("button");
  homeBtn.className = "menu-modal-btn";
  homeBtn.textContent = "Back to home page";
  homeBtn.addEventListener("click", () => {
    window.location.href = "/";
  });
  content.appendChild(homeBtn);

  overlay.appendChild(content);
  document.body.appendChild(overlay);
}

function closeMenuModal() {
  menuModalOpen = false;
  const overlay = document.querySelector(".menu-modal");
  if (overlay) overlay.remove();
}
