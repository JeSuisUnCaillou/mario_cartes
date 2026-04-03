import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  startServer,
  createRoom,
  connectPlayer,
  waitForMessage,
  waitForPlayers,
} from "./helpers.js";

let baseUrl, cleanup;

beforeAll(async () => {
  ({ baseUrl, cleanup } = await startServer());
});

afterAll(async () => {
  await cleanup();
});

describe("Disconnection during game", () => {
  it("turn is NOT skipped when a disconnected player's turn comes", async () => {
    const roomId = await createRoom(baseUrl);
    const { room: room1, playerId: id1 } = await connectPlayer(baseUrl, roomId);
    const { room: room2, playerId: id2 } = await connectPlayer(baseUrl, roomId);

    room1.send("setReady", true);
    room2.send("setReady", true);
    room1.send("startGame");

    const gs = await waitForMessage(room1, "gameState", (g) => g.phase === "playing");
    await waitForMessage(room1, "cardsDrawn");
    await waitForMessage(room2, "cardsDrawn");

    // Identify active and inactive player
    const activeId = gs.activePlayerId;
    const inactiveId = activeId === id1 ? id2 : id1;
    const activeRoom = activeId === id1 ? room1 : room2;
    const inactiveRoom = activeId === id1 ? room2 : room1;

    // Disconnect the inactive player (whose turn comes next)
    inactiveRoom.leave();

    // Wait for disconnection to be reflected
    await waitForPlayers(activeRoom, (list) => {
      const p = list.find((pl) => pl.playerId === inactiveId);
      return p && !p.connected;
    });

    // Active player ends their turn
    activeRoom.send("endTurn");

    // The turn should now be on the disconnected player — NOT skipped back to activeId
    const newGs = await waitForMessage(activeRoom, "gameState", (g) =>
      g.activePlayerId === inactiveId,
    );
    expect(newGs.activePlayerId).toBe(inactiveId);

    activeRoom.leave();
  });

  it("disconnected active player's turn is preserved (no auto-advance)", async () => {
    const roomId = await createRoom(baseUrl);
    const { room: room1, playerId: id1 } = await connectPlayer(baseUrl, roomId);
    const { room: room2, playerId: id2 } = await connectPlayer(baseUrl, roomId);

    room1.send("setReady", true);
    room2.send("setReady", true);
    room1.send("startGame");

    const gs = await waitForMessage(room1, "gameState", (g) => g.phase === "playing");
    await waitForMessage(room1, "cardsDrawn");
    await waitForMessage(room2, "cardsDrawn");

    const activeId = gs.activePlayerId;
    const activeRoom = activeId === id1 ? room1 : room2;
    const otherRoom = activeId === id1 ? room2 : room1;

    // Disconnect the active player
    activeRoom.leave();

    // Wait for disconnection
    await waitForPlayers(otherRoom, (list) => {
      const p = list.find((pl) => pl.playerId === activeId);
      return p && !p.connected;
    });

    // Wait a bit and verify turn did NOT auto-advance
    await new Promise((r) => setTimeout(r, 300));
    const buffered = otherRoom._messageBuffers["gameState"];
    const latest = buffered[buffered.length - 1];
    expect(latest.activePlayerId).toBe(activeId);

    otherRoom.leave();
  });

  it("player receives cardPlayed after page-refresh reconnect", async () => {
    const roomId = await createRoom(baseUrl);
    const { room: room1, playerId: id1 } = await connectPlayer(baseUrl, roomId);
    const { room: room2, playerId: id2 } = await connectPlayer(baseUrl, roomId);

    room1.send("setReady", true);
    room2.send("setReady", true);
    room1.send("startGame");

    const gs = await waitForMessage(room1, "gameState", (g) => g.phase === "playing");
    await waitForMessage(room1, "cardsDrawn");
    await waitForMessage(room2, "cardsDrawn");

    const activeId = gs.activePlayerId;
    const activeRoom = activeId === id1 ? room1 : room2;
    const otherRoom = activeId === id1 ? room2 : room1;
    const otherId = activeId === id1 ? id2 : id1;

    // Simulate page refresh: active player leaves, then reconnects with same playerId
    activeRoom.leave();
    await waitForPlayers(otherRoom, (list) => {
      const p = list.find((pl) => pl.playerId === activeId);
      return p && !p.connected;
    });

    const { room: reconnected } = await connectPlayer(baseUrl, roomId, { playerId: activeId });
    const cardsAfterReconnect = await waitForMessage(reconnected, "cardsDrawn");
    expect(cardsAfterReconnect.hand.length).toBeGreaterThan(0);

    // Play a card and verify the cardPlayed message is received
    const cardId = cardsAfterReconnect.hand[0].id;
    reconnected.send("playCard", { cardId });
    const played = await waitForMessage(reconnected, "cardPlayed");
    expect(played.cardId).toBe(cardId);

    reconnected.leave();
    otherRoom.leave();
  });
});
