import { Client } from "colyseus.js";

export function initPlayer(gameId) {
  document.getElementById("app").innerHTML = `
    <div class="player-container">
      <h1>Player — Game ${gameId}</h1>
      <button id="ping-btn">Ping</button>
    </div>
  `;

  const serverUrl = import.meta.env.DEV
    ? "ws://localhost:2567"
    : `${location.protocol === "https:" ? "wss" : "ws"}://${location.host}`;

  const client = new Client(serverUrl);

  client.joinById(gameId, { type: "player" }).then((room) => {
    document.getElementById("ping-btn").addEventListener("click", () => {
      room.send("ping");
    });
  });
}
