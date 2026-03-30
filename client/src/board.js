import { Client } from "colyseus.js";

export function initBoard(gameId) {
  document.getElementById("app").innerHTML = `
    <h1>Board — Game ${gameId}</h1>
    <h2>Connected players</h2>
    <ul id="player-list"></ul>
    <div id="ping-msg" style="display:none; font-size:2em; color:green;"></div>
  `;

  const serverUrl = import.meta.env.DEV
    ? "ws://localhost:2567"
    : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;

  const client = new Client(serverUrl);

  client.joinById(gameId, { type: "board" }).then((room) => {
    room.onMessage("players", (players) => {
      const list = document.getElementById("player-list");
      list.innerHTML = players
        .map((p) => `<li>${p.type} — ${p.sessionId}</li>`)
        .join("");
    });

    room.onMessage("ping", ({ from }) => {
      const el = document.getElementById("ping-msg");
      el.textContent = `ping from ${from}`;
      el.style.display = "block";
      setTimeout(() => {
        el.style.display = "none";
      }, 1000);
    });
  });
}
