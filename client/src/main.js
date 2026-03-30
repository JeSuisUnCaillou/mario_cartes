// Route: /                      → home page
// Route: /game/:uid/board        → board screen (Phaser)
// Route: /game/:uid/player       → player screen (mobile DOM)

const path = window.location.pathname;
const boardMatch = path.match(/^\/game\/([^/]+)\/board$/);
const playerMatch = path.match(/^\/game\/([^/]+)\/player$/);

if (boardMatch) {
  const uid = boardMatch[1];
  const { joinAsBoard } = await import('./network/colyseusClient.js');
  const { initBoardGame } = await import('./board/BoardGame.js');
  const room = await joinAsBoard(uid).catch((err) => {
    console.error('Failed to join board:', err);
    return null;
  });
  initBoardGame(uid, room);

} else if (playerMatch) {
  const uid = playerMatch[1];
  const app = document.getElementById('app');

  const name = prompt('Your name?') || 'Player';

  const { joinAsPlayer } = await import('./network/colyseusClient.js');
  const room = await joinAsPlayer(uid, name).catch((err) => {
    console.error('Failed to join as player:', err);
    app.textContent = 'Could not connect. Is the game started?';
    return null;
  });

  if (room) {
    const { PlayerApp } = await import('./player/PlayerApp.js');
    new PlayerApp(app, room);
  }

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
