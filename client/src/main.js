// Route: /                      → home page
// Route: /game/:uid/board        → board screen (Phaser)
// Route: /game/:uid/player       → player screen (mobile DOM)

const path = window.location.pathname;
const boardMatch = path.match(/^\/game\/([^/]+)\/board$/);
const playerMatch = path.match(/^\/game\/([^/]+)\/player$/);

if (boardMatch) {
  const uid = boardMatch[1];
  console.log('Board screen for game:', uid);
  // TODO Slice 7: import and init BoardGame
} else if (playerMatch) {
  const uid = playerMatch[1];
  console.log('Player screen for game:', uid);
  // TODO Slice 8: import and init PlayerApp
} else {
  const app = document.getElementById('app');
  app.innerHTML = `
    <div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;gap:1rem;">
      <h1 style="font-size:2.5rem;">Mario Cartes</h1>
      <p style="color:#aaa;">An online racing card game</p>
      <div style="display:flex;gap:0.5rem;">
        <input id="uid-input" type="text" placeholder="Game name"
          style="padding:0.5rem;font-size:1rem;border-radius:4px;border:1px solid #555;background:#222;color:#fff;" />
        <button id="create-btn"
          style="padding:0.5rem 1rem;font-size:1rem;cursor:pointer;border-radius:4px;background:#2ecc71;color:#fff;border:none;">
          Create game
        </button>
      </div>
    </div>
  `;
  document.getElementById('create-btn').addEventListener('click', () => {
    const uid = document.getElementById('uid-input').value.trim();
    if (uid) window.location.href = `/game/${encodeURIComponent(uid)}/board`;
  });
  document.getElementById('uid-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') document.getElementById('create-btn').click();
  });
}
