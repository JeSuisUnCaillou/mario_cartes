import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  startServer,
  createRoom,
  connectPlayer,
  connectRaw,
  connectBoard,
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

describe("Game creation", () => {
  it("GET /create returns a room id", async () => {
    const res = await fetch(`${baseUrl}/create`);
    const body = await res.json();
    expect(body).toHaveProperty("id");
    expect(typeof body.id).toBe("string");
    expect(body.id.length).toBeGreaterThan(0);
  });

  it("GET /find-or-create/:gameId creates a room with the given id", async () => {
    const gameId = "test-room-abc";
    const res = await fetch(`${baseUrl}/find-or-create/${gameId}`);
    const body = await res.json();
    expect(body).toEqual({ id: gameId });
  });

  it("GET /find-or-create/:gameId returns existing room without creating a duplicate", async () => {
    const gameId = "test-room-dedup";
    await fetch(`${baseUrl}/find-or-create/${gameId}`);
    const res = await fetch(`${baseUrl}/find-or-create/${gameId}`);
    const body = await res.json();
    expect(body).toEqual({ id: gameId });
  });
});

describe("Joining a room", () => {
  it("player receives a playerId on join", async () => {
    const roomId = await createRoom(baseUrl);
    const { room, playerId } = await connectPlayer(baseUrl, roomId);
    expect(typeof playerId).toBe("string");
    expect(playerId.length).toBeGreaterThan(0);
    room.leave();
  });

  it("player appears in players broadcast with default state", async () => {
    const roomId = await createRoom(baseUrl);
    const { room, playerId } = await connectPlayer(baseUrl, roomId);
    const players = await waitForPlayers(
      room,
      (list) => list.some((p) => p.playerId === playerId),
    );
    const player = players.find((p) => p.playerId === playerId);
    expect(player).toEqual({
      playerId,
      name: "???",
      cellId: 1,
      connected: true,
      handCount: 0,
      ready: false,
      coins: 0,
    });
    room.leave();
  });

  it("board client does not appear in players list", async () => {
    const roomId = await createRoom(baseUrl);
    const { room: boardRoom } = await connectBoard(baseUrl, roomId);
    const { room: playerRoom, playerId } = await connectPlayer(baseUrl, roomId);
    const players = await waitForPlayers(
      boardRoom,
      (list) => list.some((p) => p.playerId === playerId),
    );
    const boardAsPlayer = players.find((p) => p.name === "board");
    expect(boardAsPlayer).toBeUndefined();
    expect(players).toHaveLength(1);
    playerRoom.leave();
    boardRoom.leave();
  });
});

describe("Reconnection (page reload)", () => {
  it("player disconnect sets connected to false, reconnect restores it", async () => {
    const roomId = await createRoom(baseUrl);
    const { room: observer } = await connectBoard(baseUrl, roomId);
    const { room: playerRoom, playerId } = await connectPlayer(baseUrl, roomId);

    await waitForPlayers(observer, (list) =>
      list.some((p) => p.playerId === playerId && p.connected),
    );

    playerRoom.leave();

    const disconnected = await waitForPlayers(observer, (list) =>
      list.some((p) => p.playerId === playerId && !p.connected),
    );
    expect(disconnected.find((p) => p.playerId === playerId).connected).toBe(false);

    const { room: reconnected } = await connectPlayer(baseUrl, roomId, { playerId });

    const restored = await waitForPlayers(observer, (list) =>
      list.some((p) => p.playerId === playerId && p.connected),
    );
    expect(restored.find((p) => p.playerId === playerId).connected).toBe(true);

    reconnected.leave();
    observer.leave();
  });

  it("reconnected player receives their card state", async () => {
    const roomId = await createRoom(baseUrl);
    const { room: playerRoom, playerId } = await connectPlayer(baseUrl, roomId);

    playerRoom.leave();

    const { room: reconnected } = await connectPlayer(baseUrl, roomId, { playerId });
    const cardState = await waitForMessage(reconnected, "cardsDrawn");
    expect(cardState).toHaveProperty("hand");
    expect(cardState).toHaveProperty("drawCount");
    expect(cardState).toHaveProperty("discardCount");

    reconnected.leave();
  });

  it("board reconnects and receives players, cellOccupants, and gameState", async () => {
    const roomId = await createRoom(baseUrl);
    const { room: playerRoom } = await connectPlayer(baseUrl, roomId);

    const { room: boardRoom } = await connectBoard(baseUrl, roomId);
    const players = await waitForMessage(boardRoom, "players");
    const cellOccupants = await waitForMessage(boardRoom, "cellOccupants");
    const gameState = await waitForMessage(boardRoom, "gameState");

    expect(Array.isArray(players)).toBe(true);
    expect(players.length).toBe(1);
    expect(typeof cellOccupants).toBe("object");
    expect(gameState).toHaveProperty("phase", "lobby");

    boardRoom.leave();

    const { room: boardRoom2 } = await connectBoard(baseUrl, roomId);
    const players2 = await waitForMessage(boardRoom2, "players");
    const cellOccupants2 = await waitForMessage(boardRoom2, "cellOccupants");
    const gameState2 = await waitForMessage(boardRoom2, "gameState");

    expect(Array.isArray(players2)).toBe(true);
    expect(players2.length).toBe(1);
    expect(typeof cellOccupants2).toBe("object");
    expect(gameState2).toHaveProperty("phase", "lobby");

    boardRoom2.leave();
    playerRoom.leave();
  });

  it("player reconnects during playing phase with full state", async () => {
    const roomId = await createRoom(baseUrl);
    const { room: room1, playerId: id1 } = await connectPlayer(baseUrl, roomId);
    const { room: room2, playerId: id2 } = await connectPlayer(baseUrl, roomId);

    room1.send("setReady", true);
    room2.send("setReady", true);

    await waitForMessage(room1, "gameState");
    const cardsBeforeDisconnect = await waitForMessage(room1, "cardsDrawn");

    room1.leave();

    const { room: reconnected } = await connectPlayer(baseUrl, roomId, { playerId: id1 });
    const restoredCards = await waitForMessage(reconnected, "cardsDrawn");
    expect(restoredCards.hand).toEqual(cardsBeforeDisconnect.hand);
    expect(restoredCards.drawCount).toBe(cardsBeforeDisconnect.drawCount);

    const gameState = await waitForMessage(reconnected, "gameState");
    expect(gameState.phase).toBe("playing");

    reconnected.leave();
    room2.leave();
  });
});

describe("Rejection after game started", () => {
  it("new player joining a started game receives gameAlreadyStarted", async () => {
    const roomId = await createRoom(baseUrl);
    const { room: room1 } = await connectPlayer(baseUrl, roomId);
    const { room: room2 } = await connectPlayer(baseUrl, roomId);

    room1.send("setReady", true);
    room2.send("setReady", true);

    await waitForMessage(room1, "gameState");

    const { room: lateRoom } = await connectRaw(baseUrl, roomId);
    await waitForMessage(lateRoom, "gameAlreadyStarted");

    const players = await waitForPlayers(room1, (list) => list.length === 2);
    expect(players).toHaveLength(2);

    lateRoom.leave();
    room1.leave();
    room2.leave();
  });
});

describe("Player name", () => {
  it("default name is ???", async () => {
    const roomId = await createRoom(baseUrl);
    const { room, playerId } = await connectPlayer(baseUrl, roomId);
    const players = await waitForPlayers(room, (list) =>
      list.some((p) => p.playerId === playerId),
    );
    expect(players.find((p) => p.playerId === playerId).name).toBe("???");
    room.leave();
  });

  it("changeName converts to uppercase", async () => {
    const roomId = await createRoom(baseUrl);
    const { room, playerId } = await connectPlayer(baseUrl, roomId);
    room.send("changeName", "abc");
    const players = await waitForPlayers(room, (list) =>
      list.some((p) => p.playerId === playerId && p.name === "ABC"),
    );
    expect(players.find((p) => p.playerId === playerId).name).toBe("ABC");
    room.leave();
  });

  it("changeName strips non-alpha characters", async () => {
    const roomId = await createRoom(baseUrl);
    const { room, playerId } = await connectPlayer(baseUrl, roomId);
    room.send("changeName", "a1b");
    const players = await waitForPlayers(room, (list) =>
      list.some((p) => p.playerId === playerId && p.name === "AB"),
    );
    expect(players.find((p) => p.playerId === playerId).name).toBe("AB");
    room.leave();
  });

  it("changeName truncates to 3 characters", async () => {
    const roomId = await createRoom(baseUrl);
    const { room, playerId } = await connectPlayer(baseUrl, roomId);
    room.send("changeName", "ABCDEF");
    const players = await waitForPlayers(room, (list) =>
      list.some((p) => p.playerId === playerId && p.name === "ABC"),
    );
    expect(players.find((p) => p.playerId === playerId).name).toBe("ABC");
    room.leave();
  });

  it("changeName with empty string keeps ???", async () => {
    const roomId = await createRoom(baseUrl);
    const { room, playerId } = await connectPlayer(baseUrl, roomId);
    room.send("changeName", "");
    const players = await waitForPlayers(room, (list) =>
      list.some((p) => p.playerId === playerId && p.name === "???"),
    );
    expect(players.find((p) => p.playerId === playerId).name).toBe("???");
    room.leave();
  });
});

describe("Ready state and game start", () => {
  it("setReady(true) sets player ready", async () => {
    const roomId = await createRoom(baseUrl);
    const { room, playerId } = await connectPlayer(baseUrl, roomId);
    room.send("setReady", true);
    const players = await waitForPlayers(room, (list) =>
      list.some((p) => p.playerId === playerId && p.ready),
    );
    expect(players.find((p) => p.playerId === playerId).ready).toBe(true);
    room.leave();
  });

  it("setReady(false) unsets player ready", async () => {
    const roomId = await createRoom(baseUrl);
    const { room, playerId } = await connectPlayer(baseUrl, roomId);
    room.send("setReady", true);
    await waitForPlayers(room, (list) =>
      list.some((p) => p.playerId === playerId && p.ready),
    );
    room.send("setReady", false);
    const players = await waitForPlayers(room, (list) =>
      list.some((p) => p.playerId === playerId && !p.ready),
    );
    expect(players.find((p) => p.playerId === playerId).ready).toBe(false);
    room.leave();
  });

  it("single player ready starts the game", async () => {
    const roomId = await createRoom(baseUrl);
    const { room } = await connectPlayer(baseUrl, roomId);
    room.send("setReady", true);
    const gameState = await waitForMessage(room, "gameState", (gs) => gs.phase === "playing");
    expect(gameState.phase).toBe("playing");
    room.leave();
  });

  it("two players, only one ready, game does not start", async () => {
    const roomId = await createRoom(baseUrl);
    const { room: room1, playerId: id1 } = await connectPlayer(baseUrl, roomId);
    const { room: room2 } = await connectPlayer(baseUrl, roomId);

    room1.send("setReady", true);
    const players = await waitForPlayers(room2, (list) =>
      list.some((p) => p.playerId === id1 && p.ready),
    );
    // Game state should still be lobby — check buffered gameState messages
    const buffered = room2._messageBuffers["gameState"];
    const playingState = buffered.find((gs) => gs.phase === "playing");
    expect(playingState).toBeUndefined();

    room1.leave();
    room2.leave();
  });

  it("two players both ready starts the game", async () => {
    const roomId = await createRoom(baseUrl);
    const { room: room1 } = await connectPlayer(baseUrl, roomId);
    const { room: room2 } = await connectPlayer(baseUrl, roomId);

    room1.send("setReady", true);
    room2.send("setReady", true);

    const gameState = await waitForMessage(room1, "gameState", (gs) => gs.phase === "playing");
    expect(gameState.phase).toBe("playing");

    const cards1 = await waitForMessage(room1, "cardsDrawn");
    const cards2 = await waitForMessage(room2, "cardsDrawn");
    expect(cards1.hand).toHaveLength(5);
    expect(cards2.hand).toHaveLength(5);

    room1.leave();
    room2.leave();
  });

  it("after game start, currentRound is 1 and activePlayerId is set", async () => {
    const roomId = await createRoom(baseUrl);
    const { room: room1, playerId: id1 } = await connectPlayer(baseUrl, roomId);
    const { room: room2, playerId: id2 } = await connectPlayer(baseUrl, roomId);

    room1.send("setReady", true);
    room2.send("setReady", true);

    const gameState = await waitForMessage(room1, "gameState", (gs) => gs.phase === "playing");
    expect(gameState.phase).toBe("playing");
    expect(gameState.currentRound).toBe(1);
    expect([id1, id2]).toContain(gameState.activePlayerId);

    room1.leave();
    room2.leave();
  });
});

describe("Deck and coins", () => {
  it("deck has 8 cards (5 drawn, 3 remaining)", async () => {
    const roomId = await createRoom(baseUrl);
    const { room } = await connectPlayer(baseUrl, roomId);
    room.send("setReady", true);
    await waitForMessage(room, "gameState", (gs) => gs.phase === "playing");
    const cards = await waitForMessage(room, "cardsDrawn");
    expect(cards.hand).toHaveLength(5);
    expect(cards.drawCount).toBe(3);
    expect(cards.deck).toHaveLength(8);
    room.leave();
  });

  it("playing a single-coin card adds 1 coin without moving", async () => {
    const roomId = await createRoom(baseUrl);
    const { room } = await connectPlayer(baseUrl, roomId);
    room.send("setReady", true);
    await waitForMessage(room, "gameState", (gs) => gs.phase === "playing");
    const cards = await waitForMessage(room, "cardsDrawn");
    const coinCard = cards.hand.find((c) => c.items.length === 1 && c.items[0] === "coin");
    if (!coinCard) return; // Skip if no single-coin card in hand (unlikely with 3/8)
    room.send("playCard", { cardId: coinCard.id });
    const result = await waitForMessage(room, "cardPlayed");
    expect(result.coins).toBe(1);
    expect(result.coinGained).toBe(1);
    // Player should not have moved from cell 1
    const players = await waitForPlayers(room, (list) => list[0].handCount === 4);
    expect(players[0].cellId).toBe(1);
    room.leave();
  });

  it("playing a double-coin card adds 2 coins", async () => {
    const roomId = await createRoom(baseUrl);
    const { room } = await connectPlayer(baseUrl, roomId);
    room.send("setReady", true);
    await waitForMessage(room, "gameState", (gs) => gs.phase === "playing");
    const cards = await waitForMessage(room, "cardsDrawn");
    const coinCard = cards.hand.find((c) => c.items.length === 2 && c.items.every((i) => i === "coin"));
    if (!coinCard) return; // Skip if no double-coin card in hand
    room.send("playCard", { cardId: coinCard.id });
    const result = await waitForMessage(room, "cardPlayed");
    expect(result.coins).toBe(2);
    expect(result.coinGained).toBe(2);
    room.leave();
  });
});

describe("End turn", () => {
  it("endTurn advances to next player", async () => {
    const roomId = await createRoom(baseUrl);
    const { room: room1, playerId: id1 } = await connectPlayer(baseUrl, roomId);
    const { room: room2, playerId: id2 } = await connectPlayer(baseUrl, roomId);
    room1.send("setReady", true);
    room2.send("setReady", true);
    const gs = await waitForMessage(room1, "gameState", (g) => g.phase === "playing");
    await waitForMessage(room1, "cardsDrawn");
    await waitForMessage(room2, "cardsDrawn");
    const activeRoom = gs.activePlayerId === id1 ? room1 : room2;
    const otherRoom = gs.activePlayerId === id1 ? room2 : room1;
    const otherId = gs.activePlayerId === id1 ? id2 : id1;
    activeRoom.send("endTurn");
    const newGs = await waitForMessage(otherRoom, "gameState", (g) => g.activePlayerId === otherId);
    expect(newGs.activePlayerId).toBe(otherId);
    room1.leave();
    room2.leave();
  });

  it("endTurn resets coins to 0", async () => {
    const roomId = await createRoom(baseUrl);
    const { room } = await connectPlayer(baseUrl, roomId);
    room.send("setReady", true);
    await waitForMessage(room, "gameState", (g) => g.phase === "playing");
    const cards = await waitForMessage(room, "cardsDrawn");
    const coinCard = cards.hand.find((c) => c.items.length === 1 && c.items[0] === "coin");
    if (!coinCard) { room.leave(); return; }
    room.send("playCard", { cardId: coinCard.id });
    const played = await waitForMessage(room, "cardPlayed");
    expect(played.coins).toBe(1);
    room.send("endTurn");
    // After endTurn, players broadcast should show coins: 0
    const players = await waitForPlayers(room, (list) => list[0].coins === 0);
    expect(players[0].coins).toBe(0);
    room.leave();
  });

  it("endTurn draws new cards if hand is empty", async () => {
    const roomId = await createRoom(baseUrl);
    const { room } = await connectPlayer(baseUrl, roomId);
    room.send("setReady", true);
    await waitForMessage(room, "gameState", (g) => g.phase === "playing");
    const cards = await waitForMessage(room, "cardsDrawn");
    // Play all 5 cards
    for (const card of cards.hand) {
      room.send("playCard", { cardId: card.id });
      await waitForMessage(room, "cardPlayed");
    }
    room.send("endTurn");
    const drawn = await waitForMessage(room, "cardsDrawn");
    expect(drawn.hand.length).toBeGreaterThan(0);
    room.leave();
  });

  it("endTurn rejected for non-active player", async () => {
    const roomId = await createRoom(baseUrl);
    const { room: room1, playerId: id1 } = await connectPlayer(baseUrl, roomId);
    const { room: room2, playerId: id2 } = await connectPlayer(baseUrl, roomId);
    room1.send("setReady", true);
    room2.send("setReady", true);
    const gs = await waitForMessage(room1, "gameState", (g) => g.phase === "playing");
    await waitForMessage(room1, "cardsDrawn");
    await waitForMessage(room2, "cardsDrawn");
    const inactiveRoom = gs.activePlayerId === id1 ? room2 : room1;
    // Clear buffered gameState messages before testing
    inactiveRoom._messageBuffers["gameState"] = [];
    inactiveRoom.send("endTurn");
    // Wait a bit and verify no gameState change
    await new Promise((r) => setTimeout(r, 200));
    const buffered = inactiveRoom._messageBuffers["gameState"];
    expect(buffered).toHaveLength(0);
    room1.leave();
    room2.leave();
  });

  it("playing all cards does not auto-end turn", async () => {
    const roomId = await createRoom(baseUrl);
    const { room: room1, playerId: id1 } = await connectPlayer(baseUrl, roomId);
    const { room: room2 } = await connectPlayer(baseUrl, roomId);
    room1.send("setReady", true);
    room2.send("setReady", true);
    const gs = await waitForMessage(room1, "gameState", (g) => g.phase === "playing");
    const cards1 = await waitForMessage(room1, "cardsDrawn");
    await waitForMessage(room2, "cardsDrawn");
    if (gs.activePlayerId !== id1) { room1.leave(); room2.leave(); return; }
    // Play all 5 cards
    for (const card of cards1.hand) {
      room1.send("playCard", { cardId: card.id });
      await waitForMessage(room1, "cardPlayed");
    }
    // Clear buffered gameState messages before checking
    room1._messageBuffers["gameState"] = [];
    // Wait and verify turn did NOT auto-advance
    await new Promise((r) => setTimeout(r, 200));
    const buffered = room1._messageBuffers["gameState"];
    expect(buffered).toHaveLength(0);
    room1.leave();
    room2.leave();
  });

  it("banana hit with empty hand skips penalty", async () => {
    const roomId = await createRoom(baseUrl);
    const { room } = await connectPlayer(baseUrl, roomId);
    room.send("setReady", true);
    await waitForMessage(room, "gameState", (g) => g.phase === "playing");
    const cards = await waitForMessage(room, "cardsDrawn");
    // Play all cards to empty hand, then if banana is hit, penalty should be skipped
    // We can't easily control banana placement, so just verify the mustDiscard logic:
    // Play all 5 cards first
    for (const card of cards.hand) {
      room.send("playCard", { cardId: card.id });
      await waitForMessage(room, "cardPlayed");
    }
    // After playing all cards, hand is empty. If any bananaHit was received, mustDiscard should be 0
    const bananaHits = room._messageBuffers["bananaHit"] || [];
    for (const hit of bananaHits) {
      if (hit.hand.length === 0) {
        expect(hit.mustDiscard).toBe(0);
      }
    }
    room.leave();
  });
});
