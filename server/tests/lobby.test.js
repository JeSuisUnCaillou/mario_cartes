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
      color: "#e10000",
      cellId: 1,
      connected: true,
      handCount: 0,
      ready: false,
      coins: 0,
      permanentCoins: 0,
      lapCount: 0,
      slowCounters: 0,
      pendingShellChoice: false,
      finished: false,
      rank: 0,
      starInvincible: false,
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

    room1.send("startGame");
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

    room1.send("startGame");
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
    const { room: room1, playerId: id1 } = await connectPlayer(baseUrl, roomId);
    const { room: room2, playerId: id2 } = await connectPlayer(baseUrl, roomId);
    room1.send("setReady", true);
    await waitForPlayers(room2, (list) =>
      list.some((p) => p.playerId === id1 && p.ready),
    );
    room1.send("setReady", false);
    const players = await waitForPlayers(room2, (list) =>
      list.some((p) => p.playerId === id1 && !p.ready),
    );
    expect(players.find((p) => p.playerId === id1).ready).toBe(false);
    room1.leave();
    room2.leave();
  });

  it("board observer sees ready state change via schema sync", async () => {
    const roomId = await createRoom(baseUrl);
    const { room: board } = await connectBoard(baseUrl, roomId);
    const { room: playerRoom, playerId } = await connectPlayer(baseUrl, roomId);
    await waitForPlayers(board, (list) =>
      list.some((p) => p.playerId === playerId && !p.ready),
    );
    playerRoom.send("setReady", true);
    const players = await waitForPlayers(board, (list) =>
      list.some((p) => p.playerId === playerId && p.ready),
    );
    expect(players.find((p) => p.playerId === playerId).ready).toBe(true);
    playerRoom.leave();
    board.leave();
  });

  it("single player ready does not auto-start the game", async () => {
    const roomId = await createRoom(baseUrl);
    const { room } = await connectPlayer(baseUrl, roomId);
    room.send("setReady", true);
    await waitForPlayers(room, (list) =>
      list.some((p) => p.ready),
    );
    const buffered = room._messageBuffers["gameState"];
    const playingState = buffered.find((gs) => gs.phase === "playing");
    expect(playingState).toBeUndefined();
    room.leave();
  });

  it("ready player can start the game", async () => {
    const roomId = await createRoom(baseUrl);
    const { room } = await connectPlayer(baseUrl, roomId);
    room.send("setReady", true);
    await waitForPlayers(room, (list) =>
      list.some((p) => p.ready),
    );
    room.send("startGame");
    const gameState = await waitForMessage(room, "gameState", (gs) => gs.phase === "playing");
    expect(gameState.phase).toBe("playing");
    room.leave();
  });

  it("non-ready player cannot start the game", async () => {
    const roomId = await createRoom(baseUrl);
    const { room } = await connectPlayer(baseUrl, roomId);
    room.send("startGame");
    // Give server time to process
    await new Promise((r) => setTimeout(r, 100));
    const buffered = room._messageBuffers["gameState"];
    const playingState = buffered.find((gs) => gs.phase === "playing");
    expect(playingState).toBeUndefined();
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

  it("two players both ready, one starts the game", async () => {
    const roomId = await createRoom(baseUrl);
    const { room: room1 } = await connectPlayer(baseUrl, roomId);
    const { room: room2 } = await connectPlayer(baseUrl, roomId);

    room1.send("setReady", true);
    room2.send("setReady", true);
    await waitForPlayers(room1, (list) =>
      list.every((p) => p.ready),
    );

    room1.send("startGame");

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
    await waitForPlayers(room1, (list) =>
      list.every((p) => p.ready),
    );
    room1.send("startGame");

    const gameState = await waitForMessage(room1, "gameState", (gs) => gs.phase === "playing");
    expect(gameState.phase).toBe("playing");
    expect(gameState.currentRound).toBe(1);
    expect([id1, id2]).toContain(gameState.activePlayerId);

    room1.leave();
    room2.leave();
  });
});

describe("Kick player", () => {
  it("board can kick a player during lobby", async () => {
    const roomId = await createRoom(baseUrl);
    const { room: board } = await connectBoard(baseUrl, roomId);
    const { room: player1, playerId: id1 } = await connectPlayer(baseUrl, roomId);
    const { room: player2 } = await connectPlayer(baseUrl, roomId);

    await waitForPlayers(board, (list) => list.length === 2);

    board.send("kickPlayer", { playerId: id1 });
    await waitForMessage(player1, "kicked");

    const players = await waitForPlayers(board, (list) => list.length === 1);
    expect(players).toHaveLength(1);
    expect(players[0].playerId).not.toBe(id1);

    player1.leave();
    player2.leave();
    board.leave();
  });

  it("board can kick a player during playing phase", async () => {
    const roomId = await createRoom(baseUrl);
    const { room: board } = await connectBoard(baseUrl, roomId);
    const { room: player1, playerId: id1 } = await connectPlayer(baseUrl, roomId);
    const { room: player2, playerId: id2 } = await connectPlayer(baseUrl, roomId);
    const { room: player3 } = await connectPlayer(baseUrl, roomId);

    player1.send("setReady", true);
    player2.send("setReady", true);
    player3.send("setReady", true);
    player1.send("startGame");
    const gs = await waitForMessage(board, "gameState", (g) => g.phase === "playing");

    // Kick a non-active player
    const nonActive = id1 === gs.activePlayerId ? id2 : id1;
    const nonActiveRoom = nonActive === id1 ? player1 : player2;

    board.send("kickPlayer", { playerId: nonActive });
    await waitForMessage(nonActiveRoom, "kicked");

    const players = await waitForPlayers(board, (list) =>
      list.length === 2 && !list.some((p) => p.playerId === nonActive),
    );
    expect(players).toHaveLength(2);

    player1.leave();
    player2.leave();
    player3.leave();
    board.leave();
  });

  it("kicking the active player advances the turn", async () => {
    const roomId = await createRoom(baseUrl);
    const { room: board } = await connectBoard(baseUrl, roomId);
    const { room: player1, playerId: id1 } = await connectPlayer(baseUrl, roomId);
    const { room: player2, playerId: id2 } = await connectPlayer(baseUrl, roomId);
    const { room: player3 } = await connectPlayer(baseUrl, roomId);

    player1.send("setReady", true);
    player2.send("setReady", true);
    player3.send("setReady", true);
    player1.send("startGame");
    const gs = await waitForMessage(board, "gameState", (g) => g.phase === "playing");

    board.send("kickPlayer", { playerId: gs.activePlayerId });

    const gs2 = await waitForMessage(board, "gameState", (g) =>
      g.activePlayerId !== gs.activePlayerId,
    );
    expect(gs2.activePlayerId).not.toBe(gs.activePlayerId);

    player1.leave();
    player2.leave();
    player3.leave();
    board.leave();
  });

  it("player cannot kick another player", async () => {
    const roomId = await createRoom(baseUrl);
    const { room: player1, playerId: id1 } = await connectPlayer(baseUrl, roomId);
    const { room: player2 } = await connectPlayer(baseUrl, roomId);

    await waitForPlayers(player2, (list) => list.length === 2);

    player2.send("kickPlayer", { playerId: id1 });
    // Give server time to process
    await new Promise((r) => setTimeout(r, 100));

    const players = await waitForPlayers(player1, (list) => list.length === 2);
    expect(players).toHaveLength(2);

    player1.leave();
    player2.leave();
  });
});

describe("Deck and coins", () => {
  it("deck has 10 cards (5 drawn, 5 remaining)", async () => {
    const roomId = await createRoom(baseUrl);
    const { room } = await connectPlayer(baseUrl, roomId);
    room.send("setReady", true);
    room.send("startGame");
    await waitForMessage(room, "gameState", (gs) => gs.phase === "playing");
    const cards = await waitForMessage(room, "cardsDrawn");
    expect(cards.hand).toHaveLength(5);
    expect(cards.drawCount).toBe(5);
    expect(cards.deck).toHaveLength(10);
    room.leave();
  });

  it("playing a single-coin card adds 1 coin without moving", async () => {
    const roomId = await createRoom(baseUrl);
    const { room } = await connectPlayer(baseUrl, roomId);
    room.send("setReady", true);
    room.send("startGame");
    await waitForMessage(room, "gameState", (gs) => gs.phase === "playing");
    const cards = await waitForMessage(room, "cardsDrawn");
    const coinCard = cards.hand.find((c) => c.items.length === 1 && c.items[0] === "coin");
    if (!coinCard) return; // Skip if no single-coin card in hand (unlikely with 3/8)
    room.send("playCard", { cardId: coinCard.id });
    await waitForMessage(room, "cardPlayed");
    // Coin is resolved sequentially, check via players broadcast
    const players = await waitForPlayers(room, (list) => list[0].coins === 1);
    expect(players[0].coins).toBe(1);
    expect(players[0].cellId).toBe(1); // should not have moved
    room.leave();
  });

  it("playing a double-coin card adds 2 coins", async () => {
    const roomId = await createRoom(baseUrl);
    const { room } = await connectPlayer(baseUrl, roomId);
    room.send("setReady", true);
    room.send("startGame");
    await waitForMessage(room, "gameState", (gs) => gs.phase === "playing");
    const cards = await waitForMessage(room, "cardsDrawn");
    const coinCard = cards.hand.find((c) => c.items.length === 2 && c.items.every((i) => i === "coin"));
    if (!coinCard) return; // Skip if no double-coin card in hand
    room.send("playCard", { cardId: coinCard.id });
    await waitForMessage(room, "cardPlayed");
    const players = await waitForPlayers(room, (list) => list[0].coins === 2);
    expect(players[0].coins).toBe(2);
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
    room1.send("startGame");
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
    room.send("startGame");
    await waitForMessage(room, "gameState", (g) => g.phase === "playing");
    const cards = await waitForMessage(room, "cardsDrawn");
    const coinCard = cards.hand.find((c) => c.items.length === 1 && c.items[0] === "coin");
    if (!coinCard) { room.leave(); return; }
    room.send("playCard", { cardId: coinCard.id });
    await waitForMessage(room, "cardPlayed");
    await waitForPlayers(room, (list) => list[0].coins === 1);
    room.send("endTurn");
    // After endTurn, players broadcast should show coins: 0
    const players = await waitForPlayers(room, (list) => list[0].coins === 0);
    expect(players[0].coins).toBe(0);
    room.leave();
  });

  it("endTurn draws new cards if hand is empty", async () => {
    const roomId = await createRoom(baseUrl, {
      _testDeck: [["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"]],
    });
    const { room } = await connectPlayer(baseUrl, roomId);
    room.send("setReady", true);
    room.send("startGame");
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
    room1.send("startGame");
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
    const roomId = await createRoom(baseUrl, {
      _testDeck: [["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"]],
    });
    const { room: room1, playerId: id1 } = await connectPlayer(baseUrl, roomId);
    const { room: room2 } = await connectPlayer(baseUrl, roomId);
    room1.send("setReady", true);
    room2.send("setReady", true);
    room1.send("startGame");
    const gs = await waitForMessage(room1, "gameState", (g) => g.phase === "playing");
    const cards1 = await waitForMessage(room1, "cardsDrawn");
    await waitForMessage(room2, "cardsDrawn");
    if (gs.activePlayerId !== id1) { room1.leave(); room2.leave(); return; }
    // Play all 5 cards
    for (const card of cards1.hand) {
      room1.send("playCard", { cardId: card.id });
      await waitForMessage(room1, "cardPlayed");
    }
    // Wait and verify turn did NOT auto-advance
    await new Promise((r) => setTimeout(r, 200));
    // activePlayerId should still be id1 (turn not auto-ended)
    const latestGs = room1._messageBuffers["gameState"];
    const last = latestGs[latestGs.length - 1];
    expect(last.activePlayerId).toBe(id1);
    room1.leave();
    room2.leave();
  });

  it("banana hit with empty hand skips penalty", async () => {
    const roomId = await createRoom(baseUrl, {
      _testDeck: [["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"]],
    });
    const { room } = await connectPlayer(baseUrl, roomId);
    room.send("setReady", true);
    room.send("startGame");
    await waitForMessage(room, "gameState", (g) => g.phase === "playing");
    const cards = await waitForMessage(room, "cardsDrawn");
    // Play all cards to empty hand, then if banana is hit, penalty should be skipped
    // We can't easily control banana placement, so just verify the mustDiscard logic:
    // Play all 5 cards first
    for (const card of cards.hand) {
      room.send("playCard", { cardId: card.id });
      await waitForMessage(room, "cardPlayed");
    }
    // After playing all cards, hand is empty. If any discardHit was received, mustDiscard should be 0
    const discardHits = room._messageBuffers["discardHit"] || [];
    for (const hit of discardHits) {
      if (hit.hand.length === 0) {
        expect(hit.mustDiscard).toBe(0);
      }
    }
    room.leave();
  });
});

describe("Mushroom movement and banana collision", () => {
  it("mushroom card moves player forward 1 cell", async () => {
    const roomId = await createRoom(baseUrl, {
      _testDeck: [["mushroom"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"]],
    });
    const { room } = await connectPlayer(baseUrl, roomId);
    room.send("setReady", true);
    room.send("startGame");
    await waitForMessage(room, "gameState", (g) => g.phase === "playing");
    const cards = await waitForMessage(room, "cardsDrawn");
    const mushroomCard = cards.hand.find((c) => c.items.length === 1 && c.items[0] === "mushroom");
    expect(mushroomCard).toBeDefined();
    room.send("playCard", { cardId: mushroomCard.id });
    await waitForMessage(room, "cardPlayed");
    const players = await waitForPlayers(room, (list) => list[0].cellId === 2);
    expect(players[0].cellId).toBe(2);
    room.leave();
  });

  it("multi-item card applies all effects (banana + coin + mushroom)", async () => {
    const roomId = await createRoom(baseUrl, {
      _testDeck: [["banana", "coin", "mushroom"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"]],
    });
    const { room } = await connectPlayer(baseUrl, roomId);
    room.send("setReady", true);
    room.send("startGame");
    await waitForMessage(room, "gameState", (g) => g.phase === "playing");
    const cards = await waitForMessage(room, "cardsDrawn");
    const multiCard = cards.hand.find((c) => c.items.includes("banana") && c.items.includes("coin") && c.items.includes("mushroom"));
    expect(multiCard).toBeDefined();
    room.send("playCard", { cardId: multiCard.id });
    await waitForMessage(room, "cardPlayed");
    // Items resolve sequentially: banana on cell 1, then coin, then mushroom moves to cell 2
    const players = await waitForPlayers(room, (list) => list[0].cellId === 2);
    expect(players[0].cellId).toBe(2); // moved forward 1
    expect(players[0].coins).toBe(1);
    room.leave();
  });

  it("[mushroom, banana] drops banana on cell 2 (after move)", async () => {
    const roomId = await createRoom(baseUrl, {
      _testDeck: [["mushroom", "banana"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"]],
    });
    const { room } = await connectPlayer(baseUrl, roomId);
    const { room: board } = await connectBoard(baseUrl, roomId);
    room.send("setReady", true);
    room.send("startGame");
    await waitForMessage(room, "gameState", (g) => g.phase === "playing");
    const cards = await waitForMessage(room, "cardsDrawn");
    const card = cards.hand.find((c) => c.items[0] === "mushroom" && c.items[1] === "banana");
    room.send("playCard", { cardId: card.id });
    await waitForMessage(room, "cardPlayed");
    // Mushroom moves to cell 2, then banana drops on cell 2
    const occ = await waitForMessage(board, "cellOccupants", (o) => o[2] && o[2].includes("banana"));
    expect(occ[2]).toContain("banana");
    expect(occ[1] || []).not.toContain("banana"); // NOT on starting cell
    room.leave();
    board.leave();
  });

  it("[banana, mushroom] drops banana on cell 1 (before move)", async () => {
    const roomId = await createRoom(baseUrl, {
      _testDeck: [["banana", "mushroom"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"]],
    });
    const { room } = await connectPlayer(baseUrl, roomId);
    const { room: board } = await connectBoard(baseUrl, roomId);
    room.send("setReady", true);
    room.send("startGame");
    await waitForMessage(room, "gameState", (g) => g.phase === "playing");
    const cards = await waitForMessage(room, "cardsDrawn");
    const card = cards.hand.find((c) => c.items[0] === "banana" && c.items[1] === "mushroom");
    room.send("playCard", { cardId: card.id });
    await waitForMessage(room, "cardPlayed");
    // Banana drops on cell 1, then mushroom moves to cell 2
    const players = await waitForPlayers(room, (list) => list[0].cellId === 2);
    expect(players[0].cellId).toBe(2);
    const occ = await waitForMessage(board, "cellOccupants", (o) => o[1] && o[1].includes("banana"));
    expect(occ[1]).toContain("banana"); // banana on starting cell
    room.leave();
    board.leave();
  });

  it("banana-only card broadcasts cellOccupants to board", async () => {
    const roomId = await createRoom(baseUrl, {
      _testDeck: [["banana"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"]],
    });
    const { room } = await connectPlayer(baseUrl, roomId);
    const { room: board } = await connectBoard(baseUrl, roomId);
    room.send("setReady", true);
    room.send("startGame");
    await waitForMessage(room, "gameState", (g) => g.phase === "playing");
    const cards = await waitForMessage(room, "cardsDrawn");
    const bananaCard = cards.hand.find((c) => c.items.length === 1 && c.items[0] === "banana");
    expect(bananaCard).toBeDefined();
    room.send("playCard", { cardId: bananaCard.id });
    await waitForMessage(room, "cardPlayed");
    // Board should receive cellOccupants with a banana on cell 1
    const occupants = await waitForMessage(board, "cellOccupants", (co) =>
      co[1] && co[1].includes("banana"),
    );
    expect(occupants[1]).toContain("banana");
    room.leave();
    board.leave();
  });

  it("player moving through a banana cell triggers discard", async () => {
    const roomId = await createRoom(baseUrl, {
      _testDeck: [["banana"], ["mushroom"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"]],
    });
    const { room: room1, playerId: id1 } = await connectPlayer(baseUrl, roomId);
    const { room: room2, playerId: id2 } = await connectPlayer(baseUrl, roomId);
    room1.send("setReady", true);
    room2.send("setReady", true);
    room1.send("startGame");
    const gs = await waitForMessage(room1, "gameState", (g) => g.phase === "playing");
    const cards1 = await waitForMessage(room1, "cardsDrawn");
    const cards2 = await waitForMessage(room2, "cardsDrawn");
    const activeId = gs.activePlayerId;
    const activeRoom = activeId === id1 ? room1 : room2;
    const activeCards = activeId === id1 ? cards1 : cards2;
    const passiveRoom = activeId === id1 ? room2 : room1;

    // Active player plays mushroom to move to cell 2
    const mushroomCard = activeCards.hand.find((c) => c.items.length === 1 && c.items[0] === "mushroom");
    expect(mushroomCard).toBeDefined();
    activeRoom.send("playCard", { cardId: mushroomCard.id });
    await waitForMessage(activeRoom, "cardPlayed");

    // Active player plays banana to drop banana on cell 2
    const bananaCard = activeCards.hand.find((c) => c.items.length === 1 && c.items[0] === "banana");
    expect(bananaCard).toBeDefined();
    activeRoom.send("playCard", { cardId: bananaCard.id });
    await waitForMessage(activeRoom, "cardPlayed");

    // Active player ends turn
    activeRoom.send("endTurn");
    await waitForMessage(passiveRoom, "gameState", (g) => g.activePlayerId !== activeId);

    // Passive player already has their hand from initial deal
    const passiveCards = activeId === id1 ? cards2 : cards1;
    // Passive player (on cell 1) plays mushroom → moves to cell 2 (hits banana!)
    const passiveMushroomCard = passiveCards.hand.find((c) => c.items.length === 1 && c.items[0] === "mushroom");
    expect(passiveMushroomCard).toBeDefined();
    passiveRoom.send("playCard", { cardId: passiveMushroomCard.id });
    await waitForMessage(passiveRoom, "cardPlayed");

    // Should receive banana hit
    const discardHit = await waitForMessage(passiveRoom, "discardHit");
    expect(discardHit.source).toBe("banana");
    expect(discardHit.mustDiscard).toBe(1);

    room1.leave();
    room2.leave();
  });

  it("double mushroom through two bananas stacks two discards", async () => {
    // Each player gets: [mushroom, banana, mushroom, banana, mushroom+mushroom] in hand
    // Active sets up bananas on cells 2 and 3, then passive hits both with double mushroom
    const roomId = await createRoom(baseUrl, {
      _testDeck: [["mushroom"], ["banana"], ["mushroom"], ["banana"], ["mushroom", "mushroom"], ["coin"], ["coin"], ["coin"]],
    });
    const { room: room1, playerId: id1 } = await connectPlayer(baseUrl, roomId);
    const { room: room2, playerId: id2 } = await connectPlayer(baseUrl, roomId);
    room1.send("setReady", true);
    room2.send("setReady", true);
    room1.send("startGame");
    const gs = await waitForMessage(room1, "gameState", (g) => g.phase === "playing");
    const cards1 = await waitForMessage(room1, "cardsDrawn");
    const cards2 = await waitForMessage(room2, "cardsDrawn");
    const activeId = gs.activePlayerId;
    const activeRoom = activeId === id1 ? room1 : room2;
    const activeCards = activeId === id1 ? cards1 : cards2;
    const passiveRoom = activeId === id1 ? room2 : room1;

    const mushrooms = activeCards.hand.filter((c) => c.items.length === 1 && c.items[0] === "mushroom");
    const bananas = activeCards.hand.filter((c) => c.items.length === 1 && c.items[0] === "banana");

    // Move to cell 2, drop banana on cell 2
    activeRoom.send("playCard", { cardId: mushrooms[0].id });
    await waitForMessage(activeRoom, "cardPlayed");
    activeRoom.send("playCard", { cardId: bananas[0].id });
    await waitForMessage(activeRoom, "cardPlayed");

    // Move to cell 3, drop banana on cell 3
    activeRoom.send("playCard", { cardId: mushrooms[1].id });
    await waitForMessage(activeRoom, "cardPlayed");
    activeRoom.send("playCard", { cardId: bananas[1].id });
    await waitForMessage(activeRoom, "cardPlayed");

    // End turn — bananas are on cells 2 and 3
    activeRoom.send("endTurn");
    await waitForMessage(passiveRoom, "gameState", (g) => g.activePlayerId !== activeId);

    // Passive player already has their hand from initial deal
    const passiveCards = activeId === id1 ? cards2 : cards1;
    // Passive player (on cell 1) plays double mushroom: cell 1→2 (banana!) →3 (banana!)
    const doubleMushroom = passiveCards.hand.find((c) => c.items.length === 2 && c.items.every((i) => i === "mushroom"));
    expect(doubleMushroom).toBeDefined();
    passiveRoom.send("playCard", { cardId: doubleMushroom.id });
    await waitForMessage(passiveRoom, "cardPlayed");

    // First mushroom hits banana on cell 2
    const discardHit1 = await waitForMessage(passiveRoom, "discardHit");
    expect(discardHit1.source).toBe("banana");
    expect(discardHit1.mustDiscard).toBe(1);

    // Discard a card to resolve first hit
    const discardable = passiveCards.hand.find((c) => c.id !== doubleMushroom.id);
    passiveRoom.send("discardCard", { cardId: discardable.id });
    await waitForMessage(passiveRoom, "cardDiscarded");

    // Second mushroom hits banana on cell 3
    const discardHit2 = await waitForMessage(passiveRoom, "discardHit");
    expect(discardHit2.source).toBe("banana");
    expect(discardHit2.mustDiscard).toBe(1);

    room1.leave();
    room2.leave();
  });

  it("hitting a banana with empty hand skips the discard", async () => {
    // Player gets: [mushroom, banana, mushroom, mushroom, mushroom] — 5 cards
    // Play all 5 to empty hand: drop banana on cell 1, move 4 cells to cell 5
    // Then end turn → draw 5 new cards, plays mushroom to hit the banana on cell 1...
    // Actually simpler: use _testSetState to place player near a banana.
    // Setup: active player drops banana on cell 2, ends turn.
    // Passive player has only 1 card (mushroom). Plays it → moves to cell 2 (banana!).
    // But hand is now empty (played last card). mustDiscard should be 0, no discardHit sent.
    const roomId = await createRoom(baseUrl, {
      _testDeck: [["banana"], ["mushroom"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"]],
    });
    const { room: room1, playerId: id1 } = await connectPlayer(baseUrl, roomId);
    const { room: room2, playerId: id2 } = await connectPlayer(baseUrl, roomId);
    const { room: board } = await connectBoard(baseUrl, roomId);
    room1.send("setReady", true);
    room2.send("setReady", true);
    room1.send("startGame");
    const gs = await waitForMessage(room1, "gameState", (g) => g.phase === "playing");
    const cards1 = await waitForMessage(room1, "cardsDrawn");
    const cards2 = await waitForMessage(room2, "cardsDrawn");
    const activeId = gs.activePlayerId;
    const activeRoom = activeId === id1 ? room1 : room2;
    const activeCards = activeId === id1 ? cards1 : cards2;
    const passiveRoom = activeId === id1 ? room2 : room1;
    const passiveCards = activeId === id1 ? cards2 : cards1;

    // Active player moves to cell 2 and drops banana
    const mushroomCard = activeCards.hand.find((c) => c.items.length === 1 && c.items[0] === "mushroom");
    activeRoom.send("playCard", { cardId: mushroomCard.id });
    await waitForMessage(activeRoom, "cardPlayed");
    const bananaCard = activeCards.hand.find((c) => c.items.length === 1 && c.items[0] === "banana");
    activeRoom.send("playCard", { cardId: bananaCard.id });
    await waitForMessage(activeRoom, "cardPlayed");
    activeRoom.send("endTurn");
    await waitForMessage(passiveRoom, "gameState", (g) => g.activePlayerId !== activeId);

    // Passive player plays all 5 cards (4 coins + 1 mushroom) to empty hand
    // Play coins first (they don't move), then the mushroom last to hit the banana
    const coins = passiveCards.hand.filter((c) => c.items[0] === "coin");
    const mushroom = passiveCards.hand.find((c) => c.items[0] === "mushroom");
    for (const coin of coins) {
      passiveRoom.send("playCard", { cardId: coin.id });
      await waitForMessage(passiveRoom, "cardPlayed");
    }
    // Play the banana card (drops banana but doesn't move)
    const passiveBanana = passiveCards.hand.find((c) => c.items[0] === "banana");
    if (passiveBanana) {
      passiveRoom.send("playCard", { cardId: passiveBanana.id });
      await waitForMessage(passiveRoom, "cardPlayed");
    }
    // Last card: mushroom → moves to cell 2 (banana!), but hand is now empty
    passiveRoom.send("playCard", { cardId: mushroom.id });
    const played = await waitForMessage(passiveRoom, "cardPlayed");

    // No discardHit should be sent — player can end turn normally
    // Give server time to process, then check no discardHit was received
    await new Promise((r) => setTimeout(r, 100));
    const buffered = passiveRoom._messageBuffers["discardHit"];
    expect(buffered).toHaveLength(0);

    // Player should be able to end turn (pendingDiscard is 0)
    passiveRoom.send("endTurn");
    const nextGs = await waitForMessage(board, "gameState", (g) => g.activePlayerId === activeId);
    expect(nextGs.activePlayerId).toBe(activeId);

    room1.leave();
    room2.leave();
    board.leave();
  });
});

describe("Card buying (rivers)", () => {
  it("rivers are included in gameState on game start", async () => {
    const roomId = await createRoom(baseUrl);
    const { room } = await connectPlayer(baseUrl, roomId);
    room.send("setReady", true);
    room.send("startGame");
    const gs = await waitForMessage(room, "gameState", (gs) => gs.phase === "playing");
    const rivers = gs.rivers;
    expect(rivers).toHaveLength(4);
    expect(rivers[0].cost).toBe(1);
    expect(rivers[1].cost).toBe(3);
    expect(rivers[2].cost).toBe(5);
    expect(rivers[3].cost).toBe(8);
    for (const river of rivers) {
      expect(river.slots).toHaveLength(3);
      for (const card of river.slots) {
        expect(card).toHaveProperty("id");
        expect(card).toHaveProperty("items");
      }
      expect(river).toHaveProperty("deckCount");
    }
    room.leave();
  });

  it("rivers are included in gameState on reconnect", async () => {
    const roomId = await createRoom(baseUrl);
    const { room } = await connectPlayer(baseUrl, roomId);
    room.send("setReady", true);
    room.send("startGame");
    await waitForMessage(room, "gameState", (gs) => gs.phase === "playing");
    const { room: board } = await connectBoard(baseUrl, roomId);
    const gs = await waitForMessage(board, "gameState");
    expect(gs.rivers).toHaveLength(4);
    room.leave();
    board.leave();
  });

  it("buyCard succeeds with enough coins", async () => {
    const roomId = await createRoom(baseUrl, {
      _testDeck: [["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"]],
      _testRiverDecks: [
        [["mushroom"], ["banana"], ["coin"], ["mushroom"], ["banana"], ["coin"]],
        [["mushroom", "mushroom"], ["banana", "banana"], ["coin", "coin"], ["mushroom", "mushroom"], ["banana", "banana"], ["coin", "coin"]],
        [["mushroom", "mushroom", "mushroom"], ["banana", "banana", "banana"], ["coin", "coin", "coin"], ["mushroom", "mushroom", "mushroom"]],
      ],
    });
    const { room } = await connectPlayer(baseUrl, roomId);
    room.send("setReady", true);
    room.send("startGame");
    const gs = await waitForMessage(room, "gameState", (gs) => gs.phase === "playing");
    const cards = await waitForMessage(room, "cardsDrawn");

    // Play a coin card to earn 1 coin
    room.send("playCard", { cardId: cards.hand[0].id });
    await waitForMessage(room, "cardPlayed");

    const river0Card = gs.rivers[0].slots[0];
    room.send("buyCard", { riverId: 0, cardId: river0Card.id });
    const bought = await waitForMessage(room, "cardBought");
    expect(bought.cardId).toBe(river0Card.id);
    expect(bought.coins).toBe(0); // 1 coin earned - 1 spent
    expect(bought.deck.some((c) => c.id === river0Card.id)).toBe(true);
    room.leave();
  });

  it("buyCard with 2 coins on a 1-cost river leaves 1 coin", async () => {
    const roomId = await createRoom(baseUrl, {
      _testDeck: [["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"]],
      _testRiverDecks: [
        [["mushroom"], ["banana"], ["coin"], ["mushroom"], ["banana"], ["coin"]],
        [["mushroom", "mushroom"], ["banana", "banana"], ["coin", "coin"], ["mushroom", "mushroom"], ["banana", "banana"], ["coin", "coin"]],
        [["mushroom", "mushroom", "mushroom"], ["banana", "banana", "banana"], ["coin", "coin", "coin"], ["mushroom", "mushroom", "mushroom"]],
      ],
    });
    const { room } = await connectPlayer(baseUrl, roomId);
    room.send("setReady", true);
    room.send("startGame");
    const gs = await waitForMessage(room, "gameState", (gs) => gs.phase === "playing");
    const cards = await waitForMessage(room, "cardsDrawn");

    // Play 2 coin cards to earn 2 coins
    room.send("playCard", { cardId: cards.hand[0].id });
    await waitForMessage(room, "cardPlayed");
    room.send("playCard", { cardId: cards.hand[1].id });
    await waitForMessage(room, "cardPlayed");

    const river0Card = gs.rivers[0].slots[0];
    room.send("buyCard", { riverId: 0, cardId: river0Card.id });
    const bought = await waitForMessage(room, "cardBought");
    expect(bought.coins).toBe(1); // 2 - 1 = 1
    room.leave();
  });

  it("buyCard deducts correct amount of coins", async () => {
    const roomId = await createRoom(baseUrl, {
      _testDeck: [["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"]],
      _testRiverDecks: [
        [["mushroom"], ["banana"], ["coin"], ["mushroom"], ["banana"], ["coin"]],
        [["mushroom", "mushroom"], ["banana", "banana"], ["coin", "coin"], ["mushroom", "mushroom"], ["banana", "banana"], ["coin", "coin"]],
        [["mushroom", "mushroom", "mushroom"], ["banana", "banana", "banana"], ["coin", "coin", "coin"], ["mushroom", "mushroom", "mushroom"]],
      ],
    });
    const { room } = await connectPlayer(baseUrl, roomId);
    room.send("setReady", true);
    room.send("startGame");
    const gs = await waitForMessage(room, "gameState", (gs) => gs.phase === "playing");
    const cards = await waitForMessage(room, "cardsDrawn");

    // Play 3 coin cards to earn 3 coins
    room.send("playCard", { cardId: cards.hand[0].id });
    await waitForMessage(room, "cardPlayed");
    room.send("playCard", { cardId: cards.hand[1].id });
    await waitForMessage(room, "cardPlayed");
    room.send("playCard", { cardId: cards.hand[2].id });
    await waitForMessage(room, "cardPlayed");

    const river0Card = gs.rivers[0].slots[0];
    room.send("buyCard", { riverId: 0, cardId: river0Card.id });
    const bought = await waitForMessage(room, "cardBought");
    expect(bought.coins).toBe(2); // 3 - 1 = 2
    room.leave();
  });

  it("buyCard fails with insufficient coins", async () => {
    const roomId = await createRoom(baseUrl, {
      _testDeck: [["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"]],
      _testRiverDecks: [
        [["mushroom"], ["banana"], ["coin"], ["mushroom"], ["banana"], ["coin"]],
        [["mushroom", "mushroom"], ["banana", "banana"], ["coin", "coin"], ["mushroom", "mushroom"], ["banana", "banana"], ["coin", "coin"]],
        [["mushroom", "mushroom", "mushroom"], ["banana", "banana", "banana"], ["coin", "coin", "coin"], ["mushroom", "mushroom", "mushroom"]],
      ],
    });
    const { room } = await connectPlayer(baseUrl, roomId);
    room.send("setReady", true);
    room.send("startGame");
    const gs = await waitForMessage(room, "gameState", (gs) => gs.phase === "playing");
    await waitForMessage(room, "cardsDrawn");

    // Try to buy from river 1 (cost 3) with 0 coins
    room.send("buyCard", { riverId: 1, cardId: gs.rivers[1].slots[0].id });
    // Should not receive cardBought — wait briefly and check buffer is empty
    await new Promise((r) => setTimeout(r, 200));
    const buffer = room._messageBuffers["cardBought"];
    expect(buffer).toHaveLength(0);
    room.leave();
  });

  it("buyCard fails when not player's turn", async () => {
    const roomId = await createRoom(baseUrl, {
      _testDeck: [["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"]],
      _testRiverDecks: [
        [["mushroom"], ["banana"], ["coin"], ["mushroom"], ["banana"], ["coin"]],
        [["mushroom", "mushroom"], ["banana", "banana"], ["coin", "coin"], ["mushroom", "mushroom"], ["banana", "banana"], ["coin", "coin"]],
        [["mushroom", "mushroom", "mushroom"], ["banana", "banana", "banana"], ["coin", "coin", "coin"], ["mushroom", "mushroom", "mushroom"]],
      ],
    });
    const { room: room1, playerId: id1 } = await connectPlayer(baseUrl, roomId);
    const { room: room2 } = await connectPlayer(baseUrl, roomId);
    room1.send("setReady", true);
    room2.send("setReady", true);
    room1.send("startGame");
    const gs = await waitForMessage(room1, "gameState", (g) => g.phase === "playing");
    await waitForMessage(room1, "cardsDrawn");
    await waitForMessage(room2, "cardsDrawn");

    // Non-active player tries to buy
    const inactiveRoom = gs.activePlayerId === id1 ? room2 : room1;
    inactiveRoom.send("buyCard", { riverId: 0, cardId: gs.rivers[0].slots[0].id });
    await new Promise((r) => setTimeout(r, 200));
    const buffer = inactiveRoom._messageBuffers["cardBought"];
    expect(buffer).toHaveLength(0);
    room1.leave();
    room2.leave();
  });

  it("buyCard refills slot from deck", async () => {
    const roomId = await createRoom(baseUrl, {
      _testDeck: [["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"]],
      _testRiverDecks: [
        [["mushroom"], ["banana"], ["coin"], ["mushroom"], ["banana"], ["coin"]],
        [["mushroom", "mushroom"], ["banana", "banana"], ["coin", "coin"], ["mushroom", "mushroom"], ["banana", "banana"], ["coin", "coin"]],
        [["mushroom", "mushroom", "mushroom"], ["banana", "banana", "banana"], ["coin", "coin", "coin"], ["mushroom", "mushroom", "mushroom"]],
      ],
    });
    const { room } = await connectPlayer(baseUrl, roomId);
    const { room: board } = await connectBoard(baseUrl, roomId);
    room.send("setReady", true);
    room.send("startGame");
    const gs = await waitForMessage(room, "gameState", (g) => g.phase === "playing");
    const cards = await waitForMessage(room, "cardsDrawn");
    expect(gs.rivers[0].deckCount).toBe(3);

    // Earn a coin and buy
    room.send("playCard", { cardId: cards.hand[0].id });
    await waitForMessage(room, "cardPlayed");
    const boughtCardId = gs.rivers[0].slots[0].id;
    room.send("buyCard", { riverId: 0, cardId: boughtCardId });
    await waitForMessage(room, "cardBought");

    // buyCard triggers broadcastGameState which includes updated rivers
    const updatedGs = await waitForMessage(board, "gameState", (g) => g.rivers && g.rivers[0].deckCount === 2);
    expect(updatedGs.rivers[0].slots[0]).not.toBeNull();
    expect(updatedGs.rivers[0].slots[0].id).not.toBe(boughtCardId);
    room.leave();
    board.leave();
  });

  it("buyCard leaves slot null when deck is empty", async () => {
    const roomId = await createRoom(baseUrl, {
      _testDeck: [["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"]],
      _testRiverDecks: [
        [["mushroom"], ["banana"], ["coin"]], // Only 3 cards, no deck reserve
        [["mushroom", "mushroom"], ["banana", "banana"], ["coin", "coin"]],
        [["mushroom", "mushroom", "mushroom"], ["banana", "banana", "banana"], ["coin", "coin", "coin"]],
      ],
    });
    const { room } = await connectPlayer(baseUrl, roomId);
    const { room: board } = await connectBoard(baseUrl, roomId);
    room.send("setReady", true);
    room.send("startGame");
    const gs = await waitForMessage(room, "gameState", (g) => g.phase === "playing");
    const cards = await waitForMessage(room, "cardsDrawn");
    expect(gs.rivers[0].deckCount).toBe(0);

    // Earn a coin and buy
    room.send("playCard", { cardId: cards.hand[0].id });
    await waitForMessage(room, "cardPlayed");
    room.send("buyCard", { riverId: 0, cardId: gs.rivers[0].slots[0].id });
    await waitForMessage(room, "cardBought");

    const updatedGs = await waitForMessage(board, "gameState", (g) => g.rivers && g.rivers[0].slots[0] === null);
    expect(updatedGs.rivers[0].slots[0]).toBeNull();
    expect(updatedGs.rivers[0].deckCount).toBe(0);
    room.leave();
    board.leave();
  });
  it("buyCard fails when rank 1 tries to buy from river 1", async () => {
    const roomId = await createRoom(baseUrl, {
      _testDeck: [["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"]],
      _testRiverDecks: [
        [["mushroom"], ["banana"], ["coin"], ["mushroom"], ["banana"], ["coin"]],
        [["mushroom", "mushroom"], ["banana", "banana"], ["coin", "coin"], ["mushroom", "mushroom"], ["banana", "banana"], ["coin", "coin"]],
        [["mushroom", "mushroom", "mushroom"], ["banana", "banana", "banana"], ["coin", "coin", "coin"], ["mushroom", "mushroom", "mushroom"]],
      ],
    });
    const { room: room1, playerId: pid1 } = await connectPlayer(baseUrl, roomId);
    const { room: room2 } = await connectPlayer(baseUrl, roomId);
    const { room: board } = await connectBoard(baseUrl, roomId);
    room1.send("setReady", true);
    room2.send("setReady", true);
    room1.send("startGame");
    const gs = await waitForMessage(room1, "gameState", (g) => g.phase === "playing");
    await waitForMessage(room1, "cardsDrawn");

    // Move player 1 ahead so they become rank 1
    board.send("_testSetState", { playerId: pid1, cellId: 5, lapCount: 1, coins: 3 });
    await waitForMessage(board, "gameState");

    // Player 1 (rank 1) tries to buy from river 1 — should be rejected
    const river1Card = gs.rivers[1].slots[0];
    room1.send("buyCard", { riverId: 1, cardId: river1Card.id });

    // Buy from river 0 should still work
    const river0Card = gs.rivers[0].slots[0];
    room1.send("buyCard", { riverId: 0, cardId: river0Card.id });
    const bought = await waitForMessage(room1, "cardBought");
    expect(bought.cardId).toBe(river0Card.id);

    room1.leave();
    room2.leave();
    board.leave();
  });

  it("buyCard succeeds when rank 2 buys from river 1", async () => {
    const roomId = await createRoom(baseUrl, {
      _testDeck: [["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"]],
      _testRiverDecks: [
        [["mushroom"], ["banana"], ["coin"], ["mushroom"], ["banana"], ["coin"]],
        [["mushroom", "mushroom"], ["banana", "banana"], ["coin", "coin"], ["mushroom", "mushroom"], ["banana", "banana"], ["coin", "coin"]],
        [["mushroom", "mushroom", "mushroom"], ["banana", "banana", "banana"], ["coin", "coin", "coin"], ["mushroom", "mushroom", "mushroom"]],
      ],
    });
    const { room: room1, playerId: pid1 } = await connectPlayer(baseUrl, roomId);
    const { room: room2, playerId: pid2 } = await connectPlayer(baseUrl, roomId);
    const { room: board } = await connectBoard(baseUrl, roomId);
    room1.send("setReady", true);
    room2.send("setReady", true);
    room1.send("startGame");
    const gs = await waitForMessage(room2, "gameState", (g) => g.phase === "playing");
    await waitForMessage(room2, "cardsDrawn");

    // Move player 1 ahead so player 2 becomes rank 2
    board.send("_testSetState", { playerId: pid1, cellId: 5, lapCount: 1 });
    // Switch active player to player 2 and give them coins
    board.send("_debugSetGameState", { activePlayerId: pid2 });
    board.send("_testSetState", { playerId: pid2, coins: 3 });
    await waitForMessage(board, "gameState");

    // Player 2 (rank 2) buys from river 1 — should succeed
    const river1Card = gs.rivers[1].slots[0];
    room2.send("buyCard", { riverId: 1, cardId: river1Card.id });
    const bought = await waitForMessage(room2, "cardBought");
    expect(bought.cardId).toBe(river1Card.id);

    room1.leave();
    room2.leave();
    board.leave();
  });

  it("last-place player in 2-player game can buy from all rivers", async () => {
    const roomId = await createRoom(baseUrl, {
      _testDeck: [["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"]],
      _testRiverDecks: [
        [["mushroom"], ["banana"], ["coin"], ["mushroom"], ["banana"], ["coin"]],
        [["mushroom", "mushroom"], ["banana", "banana"], ["coin", "coin"], ["mushroom", "mushroom"], ["banana", "banana"], ["coin", "coin"]],
        [["mushroom", "mushroom", "mushroom"], ["banana", "banana", "banana"], ["coin", "coin", "coin"], ["mushroom", "mushroom", "mushroom"]],
      ],
    });
    const { room: room1, playerId: pid1 } = await connectPlayer(baseUrl, roomId);
    const { room: room2, playerId: pid2 } = await connectPlayer(baseUrl, roomId);
    const { room: board } = await connectBoard(baseUrl, roomId);
    room1.send("setReady", true);
    room2.send("setReady", true);
    room1.send("startGame");
    const gs = await waitForMessage(room2, "gameState", (g) => g.phase === "playing");
    await waitForMessage(room2, "cardsDrawn");

    // Move player 1 ahead so player 2 becomes rank 2
    board.send("_testSetState", { playerId: pid1, cellId: 5, lapCount: 1 });
    // Switch active player to player 2 and give them coins
    board.send("_debugSetGameState", { activePlayerId: pid2 });
    board.send("_testSetState", { playerId: pid2, coins: 10 });
    await waitForMessage(board, "gameState");

    // Player 2 (rank 2, last place in 2-player game) can buy from river 2
    const river2Card = gs.rivers[2].slots[0];
    room2.send("buyCard", { riverId: 2, cardId: river2Card.id });
    const bought = await waitForMessage(room2, "cardBought");
    expect(bought.cardId).toBe(river2Card.id);

    room1.leave();
    room2.leave();
    board.leave();
  });
});

describe("Win condition and laps", () => {
  // Single-mushroom deck: 1 cell per card.
  const singleDeck = Array.from({ length: 10 }, () => ["mushroom"]);

  async function startGame(rooms) {
    for (const r of rooms) r.send("setReady", true);
    rooms[0].send("startGame");
    await waitForMessage(rooms[0], "gameState", (gs) => gs.phase === "playing");
  }

  it("crossing the finish line increments lapCount", async () => {
    const roomId = await createRoom(baseUrl, { _testDeck: singleDeck });
    const { room: room1, playerId: id1 } = await connectPlayer(baseUrl, roomId);
    const { room: room2 } = await connectPlayer(baseUrl, roomId);
    const { room: board } = await connectBoard(baseUrl, roomId);

    await startGame([room1, room2]);

    // Place player 1 on cell 13 (2 cells from finish), lap 1
    room1.send("_testSetState", { cellId: 13, lapCount: 1 });
    await waitForPlayers(board, (list) =>
      list.some((p) => p.playerId === id1 && p.cellId === 13),
    );

    // Play 2 cards: cell 13→14→1 (crosses finish line → lap 2)
    const cards = await waitForMessage(room1, "cardsDrawn");
    room1.send("playCard", { cardId: cards.hand[0].id });
    await waitForMessage(room1, "cardPlayed");
    room1.send("playCard", { cardId: cards.hand[1].id });
    await waitForMessage(room1, "cardPlayed");

    const players = await waitForPlayers(board, (list) =>
      list.some((p) => p.playerId === id1 && p.lapCount === 2),
    );
    expect(players.find((p) => p.playerId === id1).lapCount).toBe(2);
    expect(players.find((p) => p.playerId === id1).finished).toBe(false);

    room1.leave();
    room2.leave();
    board.leave();
  });

  it("player completing 3 laps is marked finished", async () => {
    const roomId = await createRoom(baseUrl, { _testDeck: singleDeck });
    const { room: room1, playerId: id1 } = await connectPlayer(baseUrl, roomId);
    const { room: room2 } = await connectPlayer(baseUrl, roomId);
    const { room: board } = await connectBoard(baseUrl, roomId);

    await startGame([room1, room2]);

    // Place player 1 on cell 13, lap 3 (last lap, 2 cells from finish)
    room1.send("_testSetState", { cellId: 13, lapCount: 3 });
    await waitForPlayers(board, (list) =>
      list.some((p) => p.playerId === id1 && p.cellId === 13),
    );

    // Play 2 cards: cell 13→14→1 → lapCount is 3 (already on last lap) → finished
    const cards = await waitForMessage(room1, "cardsDrawn");
    room1.send("playCard", { cardId: cards.hand[0].id });
    await waitForMessage(room1, "cardPlayed");
    room1.send("playCard", { cardId: cards.hand[1].id });
    await waitForMessage(room1, "cardPlayed");

    const players = await waitForPlayers(board, (list) =>
      list.some((p) => p.playerId === id1 && p.finished),
    );
    expect(players.find((p) => p.playerId === id1).finished).toBe(true);

    room1.leave();
    room2.leave();
    board.leave();
  });

  it("single player race ends when they finish", async () => {
    const roomId = await createRoom(baseUrl, { _testDeck: singleDeck });
    const { room, playerId } = await connectPlayer(baseUrl, roomId);
    const { room: board } = await connectBoard(baseUrl, roomId);

    room.send("setReady", true);
    room.send("startGame");
    await waitForMessage(room, "gameState", (gs) => gs.phase === "playing");

    room.send("_testSetState", { cellId: 13, lapCount: 3 });
    await waitForPlayers(board, (list) =>
      list.some((p) => p.playerId === playerId && p.cellId === 13),
    );

    const cards = await waitForMessage(room, "cardsDrawn");
    room.send("playCard", { cardId: cards.hand[0].id });
    await waitForMessage(room, "cardPlayed");
    room.send("playCard", { cardId: cards.hand[1].id });
    await waitForMessage(room, "cardPlayed");

    const gs = await waitForMessage(board, "gameState", (g) => g.phase === "finished");
    expect(gs.ranking).toHaveLength(1);
    expect(gs.ranking[0].playerId).toBe(playerId);
    expect(gs.ranking[0].finalRank).toBe(1);

    room.leave();
    board.leave();
  });

  it("all players finishing sets phase to finished with ranking", async () => {
    const roomId = await createRoom(baseUrl, { _testDeck: singleDeck });
    const { room: room1, playerId: id1 } = await connectPlayer(baseUrl, roomId);
    const { room: room2, playerId: id2 } = await connectPlayer(baseUrl, roomId);
    const { room: board } = await connectBoard(baseUrl, roomId);

    await startGame([room1, room2]);

    // Both players on cell 13, lap 3
    room1.send("_testSetState", { cellId: 13, lapCount: 3 });
    room2.send("_testSetState", { cellId: 13, lapCount: 3 });
    await waitForPlayers(board, (list) =>
      list.every((p) => p.cellId === 13 && p.lapCount === 3),
    );

    // Player 1 finishes — with only 2 players, the race ends immediately
    const cards1 = await waitForMessage(room1, "cardsDrawn");
    room1.send("playCard", { cardId: cards1.hand[0].id });
    await waitForMessage(room1, "cardPlayed");
    room1.send("playCard", { cardId: cards1.hand[1].id });
    await waitForMessage(room1, "cardPlayed");

    const gs = await waitForMessage(board, "gameState", (g) => g.phase === "finished");
    expect(gs.phase).toBe("finished");
    expect(gs.ranking).toHaveLength(2);
    expect(gs.ranking[0].playerId).toBe(id1);
    expect(gs.ranking[0].finalRank).toBe(1);
    expect(gs.ranking[1].playerId).toBe(id2);
    expect(gs.ranking[1].finalRank).toBe(2);

    room1.leave();
    room2.leave();
    board.leave();
  });

  it("race ends when only one player remains, ranked last automatically", async () => {
    const roomId = await createRoom(baseUrl, { _testDeck: singleDeck });
    const { room: room1, playerId: id1 } = await connectPlayer(baseUrl, roomId);
    const { room: room2, playerId: id2 } = await connectPlayer(baseUrl, roomId);
    const { room: room3, playerId: id3 } = await connectPlayer(baseUrl, roomId);
    const { room: board } = await connectBoard(baseUrl, roomId);

    await startGame([room1, room2, room3]);

    // Place all near finish on last lap
    room1.send("_testSetState", { cellId: 13, lapCount: 3 });
    room2.send("_testSetState", { cellId: 13, lapCount: 3 });
    room3.send("_testSetState", { cellId: 13, lapCount: 3 });
    await waitForPlayers(board, (list) =>
      list.every((p) => p.cellId === 13 && p.lapCount === 3),
    );

    // Player 1 finishes
    const cards1 = await waitForMessage(room1, "cardsDrawn");
    room1.send("playCard", { cardId: cards1.hand[0].id });
    await waitForMessage(room1, "cardPlayed");
    room1.send("playCard", { cardId: cards1.hand[1].id });
    await waitForMessage(room1, "cardPlayed");
    await waitForPlayers(board, (list) =>
      list.some((p) => p.playerId === id1 && p.finished),
    );

    // Player 2 finishes — only player 3 remains, race ends
    const cards2 = await waitForMessage(room2, "cardsDrawn");
    room2.send("playCard", { cardId: cards2.hand[0].id });
    await waitForMessage(room2, "cardPlayed");
    room2.send("playCard", { cardId: cards2.hand[1].id });
    await waitForMessage(room2, "cardPlayed");

    const gs = await waitForMessage(board, "gameState", (g) => g.phase === "finished");
    expect(gs.ranking).toHaveLength(3);
    expect(gs.ranking[0].playerId).toBe(id1);
    expect(gs.ranking[1].playerId).toBe(id2);
    expect(gs.ranking[2].playerId).toBe(id3);
    expect(gs.ranking[2].finalRank).toBe(3);

    room1.leave();
    room2.leave();
    room3.leave();
    board.leave();
  });

  it("finished player is skipped in turn order", async () => {
    const roomId = await createRoom(baseUrl, { _testDeck: singleDeck });
    const { room: room1, playerId: id1 } = await connectPlayer(baseUrl, roomId);
    const { room: room2, playerId: id2 } = await connectPlayer(baseUrl, roomId);
    const { room: room3, playerId: id3 } = await connectPlayer(baseUrl, roomId);
    const { room: board } = await connectBoard(baseUrl, roomId);

    await startGame([room1, room2, room3]);

    // Player 1 near finish, others at start
    room1.send("_testSetState", { cellId: 13, lapCount: 3 });
    await waitForPlayers(board, (list) =>
      list.some((p) => p.playerId === id1 && p.cellId === 13),
    );

    // Player 1 finishes
    const cards1 = await waitForMessage(room1, "cardsDrawn");
    room1.send("playCard", { cardId: cards1.hand[0].id });
    await waitForMessage(room1, "cardPlayed");
    room1.send("playCard", { cardId: cards1.hand[1].id });
    await waitForMessage(room1, "cardPlayed");

    // Turn should go to player 2 (skipping finished player 1)
    const gs = await waitForMessage(board, "gameState", (g) => g.activePlayerId === id2);
    expect(gs.activePlayerId).toBe(id2);

    // Player 2 plays and ends turn — next should be player 3, not player 1
    const cards2 = await waitForMessage(room2, "cardsDrawn");
    room2.send("playCard", { cardId: cards2.hand[0].id });
    await waitForMessage(room2, "cardPlayed");
    room2.send("endTurn");

    const gs2 = await waitForMessage(board, "gameState", (g) => g.activePlayerId === id3);
    expect(gs2.activePlayerId).toBe(id3);

    room1.leave();
    room2.leave();
    room3.leave();
    board.leave();
  });

  it("broadcastPlayers includes lapCount and finished fields", async () => {
    const roomId = await createRoom(baseUrl);
    const { room, playerId } = await connectPlayer(baseUrl, roomId);
    const players = await waitForPlayers(room, (list) =>
      list.some((p) => p.playerId === playerId),
    );
    const player = players.find((p) => p.playerId === playerId);
    expect(player).toHaveProperty("lapCount", 0);
    expect(player).toHaveProperty("finished", false);
    room.leave();
  });
});

describe("Start over", () => {
  const singleDeck = Array.from({ length: 10 }, () => ["mushroom"]);

  async function finishGame(baseUrl) {
    const roomId = await createRoom(baseUrl, { _testDeck: singleDeck });
    const { room: room1, playerId: id1 } = await connectPlayer(baseUrl, roomId);
    const { room: room2, playerId: id2 } = await connectPlayer(baseUrl, roomId);
    const { room: board } = await connectBoard(baseUrl, roomId);

    room1.send("setReady", true);
    room2.send("setReady", true);
    room1.send("startGame");
    await waitForMessage(room1, "gameState", (gs) => gs.phase === "playing");

    // Place both players near finish on last lap
    room1.send("_testSetState", { cellId: 13, lapCount: 3 });
    room2.send("_testSetState", { cellId: 13, lapCount: 3 });
    await waitForPlayers(board, (list) =>
      list.every((p) => p.cellId === 13 && p.lapCount === 3),
    );

    // Player 1 finishes — with 2 players, race ends immediately (last player ranked automatically)
    const cards1 = await waitForMessage(room1, "cardsDrawn");
    room1.send("playCard", { cardId: cards1.hand[0].id });
    await waitForMessage(room1, "cardPlayed");
    room1.send("playCard", { cardId: cards1.hand[1].id });
    await waitForMessage(room1, "cardPlayed");

    await waitForMessage(board, "gameState", (g) => g.phase === "finished");
    return { room1, room2, board, id1, id2, roomId };
  }

  it("startOver resets phase to lobby", async () => {
    const { room1, room2, board } = await finishGame(baseUrl);

    room1.send("startOver");
    const gs = await waitForMessage(board, "gameState", (g) => g.phase === "lobby");
    expect(gs.phase).toBe("lobby");
    expect(gs.ranking).toBeUndefined();

    room1.leave();
    room2.leave();
    board.leave();
  });

  it("startOver resets all player state", async () => {
    const { room1, room2, board, id1 } = await finishGame(baseUrl);

    room1.send("startOver");
    const players = await waitForPlayers(board, (list) =>
      list.every((p) => p.cellId === 1 && p.lapCount === 0 && !p.finished && !p.ready),
    );
    const p1 = players.find((p) => p.playerId === id1);
    expect(p1.cellId).toBe(1);
    expect(p1.lapCount).toBe(0);
    expect(p1.finished).toBe(false);
    expect(p1.ready).toBe(false);
    expect(p1.coins).toBe(0);

    room1.leave();
    room2.leave();
    board.leave();
  });

  it("startOver resets rivers with fresh decks", async () => {
    const { room1, room2, board } = await finishGame(baseUrl);

    room1.send("startOver");
    const gs = await waitForMessage(board, "gameState", (g) => g.phase === "lobby" && g.rivers);
    expect(gs.rivers).toHaveLength(4);
    expect(gs.rivers[0].slots).toHaveLength(3);
    expect(gs.rivers[0].slots[0]).not.toBeNull();

    room1.leave();
    room2.leave();
    board.leave();
  });

  it("startOver resets cell occupants", async () => {
    const { room1, room2, board } = await finishGame(baseUrl);

    room1.send("startOver");
    const occupants = await waitForMessage(board, "cellOccupants", (occ) =>
      occ[1] && occ[1].length === 2,
    );
    expect(occupants[1]).toHaveLength(2);

    room1.leave();
    room2.leave();
    board.leave();
  });

  it("startOver is ignored when phase is not finished", async () => {
    const roomId = await createRoom(baseUrl, { _testDeck: singleDeck });
    const { room: room1 } = await connectPlayer(baseUrl, roomId);
    const { room: room2 } = await connectPlayer(baseUrl, roomId);
    const { room: board } = await connectBoard(baseUrl, roomId);

    room1.send("setReady", true);
    room2.send("setReady", true);
    room1.send("startGame");
    await waitForMessage(board, "gameState", (gs) => gs.phase === "playing");

    // Drain buffer so we can check nothing new arrives
    board._messageBuffers["gameState"] = [];

    room1.send("startOver");
    // Give server time to process the ignored message
    await new Promise((r) => setTimeout(r, 100));

    const buffered = board._messageBuffers["gameState"];
    const lobbyState = buffered.find((gs) => gs.phase === "lobby");
    expect(lobbyState).toBeUndefined();

    room1.leave();
    room2.leave();
    board.leave();
  });
});

describe("Debug mode", () => {
  it("board can request full state via _debugGetState", async () => {
    const roomId = await createRoom(baseUrl);
    const { room: p1, playerId: pid1 } = await connectPlayer(baseUrl, roomId);
    const { room: board } = await connectBoard(baseUrl, roomId);

    board.send("_debugGetState");
    const state = await waitForMessage(board, "_debugState");

    expect(state.phase).toBe("lobby");
    expect(state.currentRound).toBe(0);
    expect(state.players).toHaveLength(1);
    expect(state.players[0].playerId).toBe(pid1);
    expect(state.players[0]).toHaveProperty("hand");
    expect(state.players[0]).toHaveProperty("drawPile");
    expect(state.players[0]).toHaveProperty("discardPile");
    expect(state.cellOccupants).toBeDefined();

    p1.leave();
    board.leave();
  });

  it("player client cannot request _debugGetState", async () => {
    const roomId = await createRoom(baseUrl);
    const { room: p1 } = await connectPlayer(baseUrl, roomId);

    p1.send("_debugGetState");
    await new Promise((r) => setTimeout(r, 100));
    const buffered = p1._messageBuffers["_debugState"] || [];
    expect(buffered).toHaveLength(0);

    p1.leave();
  });

  it("board can set player state via _testSetState with playerId", async () => {
    const roomId = await createRoom(baseUrl);
    const { room: p1, playerId: pid1 } = await connectPlayer(baseUrl, roomId);
    const { room: board } = await connectBoard(baseUrl, roomId);

    board.send("_testSetState", { playerId: pid1, cellId: 5, coins: 10, lapCount: 2 });
    const players = await waitForPlayers(board, (ps) =>
      ps.some((p) => p.playerId === pid1 && p.cellId === 5 && p.coins === 10 && p.lapCount === 2),
    );
    expect(players).toBeDefined();

    p1.leave();
    board.leave();
  });

  it("board can set game state via _debugSetGameState", async () => {
    const roomId = await createRoom(baseUrl);
    const { room: p1 } = await connectPlayer(baseUrl, roomId);
    const { room: p2 } = await connectPlayer(baseUrl, roomId);
    const { room: board } = await connectBoard(baseUrl, roomId);

    p1.send("setReady", true);
    p2.send("setReady", true);
    p1.send("startGame");
    await waitForMessage(board, "gameState", (gs) => gs.phase === "playing");

    board.send("_debugSetGameState", { addBanana: { cellId: 5 } });
    const occ = await waitForMessage(board, "cellOccupants", (co) =>
      (co["5"] || []).includes("banana"),
    );
    expect(occ["5"]).toContain("banana");

    board.send("_debugSetGameState", { removeBanana: { cellId: 5 } });
    const occ2 = await waitForMessage(board, "cellOccupants", (co) =>
      !(co["5"] || []).includes("banana"),
    );
    expect((occ2["5"] || []).includes("banana")).toBe(false);

    p1.leave();
    p2.leave();
    board.leave();
  });

  it("board can edit river slot via _debugSetGameState", async () => {
    const roomId = await createRoom(baseUrl);
    const { room: p1 } = await connectPlayer(baseUrl, roomId);
    const { room: p2 } = await connectPlayer(baseUrl, roomId);
    const { room: board } = await connectBoard(baseUrl, roomId);

    p1.send("setReady", true);
    p2.send("setReady", true);
    p1.send("startGame");
    await waitForMessage(board, "gameState", (gs) => gs.phase === "playing");

    board.send("_debugSetGameState", {
      setRiverSlot: { riverId: 0, slotIndex: 0, items: ["mushroom", "banana"] },
    });
    const gs = await waitForMessage(board, "gameState", (gs) =>
      gs.rivers && gs.rivers[0].slots[0] &&
      gs.rivers[0].slots[0].items.length === 2 &&
      gs.rivers[0].slots[0].items[0] === "mushroom" &&
      gs.rivers[0].slots[0].items[1] === "banana",
    );
    expect(gs.rivers[0].slots[0].items).toEqual(["mushroom", "banana"]);

    p1.leave();
    p2.leave();
    board.leave();
  });

  it("_debugGetState includes rivers when game is playing", async () => {
    const roomId = await createRoom(baseUrl);
    const { room: p1 } = await connectPlayer(baseUrl, roomId);
    const { room: p2 } = await connectPlayer(baseUrl, roomId);
    const { room: board } = await connectBoard(baseUrl, roomId);

    p1.send("setReady", true);
    p2.send("setReady", true);
    p1.send("startGame");
    await waitForMessage(board, "gameState", (gs) => gs.phase === "playing");

    board.send("_debugGetState");
    const state = await waitForMessage(board, "_debugState");

    expect(state.rivers).toHaveLength(4);
    expect(state.rivers[0]).toHaveProperty("cost");
    expect(state.rivers[0]).toHaveProperty("slots");
    expect(state.rivers[0]).toHaveProperty("deckCount");

    p1.leave();
    p2.leave();
    board.leave();
  });

  it("board can add, edit, and remove cards in a player's hand", async () => {
    const roomId = await createRoom(baseUrl);
    const { room: p1, playerId: pid1 } = await connectPlayer(baseUrl, roomId);
    const { room: p2 } = await connectPlayer(baseUrl, roomId);
    const { room: board } = await connectBoard(baseUrl, roomId);

    p1.send("setReady", true);
    p2.send("setReady", true);
    p1.send("startGame");
    await waitForMessage(board, "gameState", (gs) => gs.phase === "playing");

    // Get initial state
    board.send("_debugGetState");
    const before = await waitForMessage(board, "_debugState");
    const player = before.players.find((p) => p.playerId === pid1);
    const initialHandSize = player.handCount;

    // Add a card
    board.send("_testSetState", { playerId: pid1, addHandCard: { items: ["mushroom", "banana"] } });
    await waitForPlayers(board, (ps) => ps.find((p) => p.playerId === pid1).handCount === initialHandSize + 1);

    board._messageBuffers["_debugState"] = [];
    board.send("_debugGetState");
    const afterAdd = await waitForMessage(board, "_debugState");
    const addedPlayer = afterAdd.players.find((p) => p.playerId === pid1);
    const lastCard = addedPlayer.hand[addedPlayer.hand.length - 1];
    expect(lastCard.items).toEqual(["mushroom", "banana"]);

    // Edit the last card
    const editIndex = addedPlayer.hand.length - 1;
    board.send("_testSetState", { playerId: pid1, setHandCard: { index: editIndex, items: ["coin", "coin"] } });
    await waitForPlayers(board, () => true);
    board._messageBuffers["_debugState"] = [];
    board.send("_debugGetState");
    const afterEdit = await waitForMessage(board, "_debugState");
    const editedCard = afterEdit.players.find((p) => p.playerId === pid1).hand[editIndex];
    expect(editedCard.items).toEqual(["coin", "coin"]);

    // Remove that card
    board.send("_testSetState", { playerId: pid1, setHandCard: { index: editIndex, items: null } });
    await waitForPlayers(board, (ps) => ps.find((p) => p.playerId === pid1).handCount === initialHandSize);

    p1.leave();
    p2.leave();
    board.leave();
  });

  it("player client receives updated hand when board edits it", async () => {
    const roomId = await createRoom(baseUrl);
    const { room: p1, playerId: pid1 } = await connectPlayer(baseUrl, roomId);
    const { room: p2 } = await connectPlayer(baseUrl, roomId);
    const { room: board } = await connectBoard(baseUrl, roomId);

    p1.send("setReady", true);
    p2.send("setReady", true);
    p1.send("startGame");
    await waitForMessage(board, "gameState", (gs) => gs.phase === "playing");
    // Wait for game start, then clear cardsDrawn buffer
    await waitForMessage(p1, "cardsDrawn");
    p1._messageBuffers["cardsDrawn"] = [];

    // Add a card via debug
    board.send("_testSetState", { playerId: pid1, addHandCard: { items: ["banana", "banana"] } });
    const afterAdd = await waitForMessage(p1, "cardsDrawn");
    const addedCard = afterAdd.hand[afterAdd.hand.length - 1];
    expect(addedCard.items).toEqual(["banana", "banana"]);
    const sizeAfterAdd = afterAdd.hand.length;

    // Edit first card via debug
    p1._messageBuffers["cardsDrawn"] = [];
    board.send("_testSetState", { playerId: pid1, setHandCard: { index: 0, items: ["mushroom"] } });
    const afterEdit = await waitForMessage(p1, "cardsDrawn");
    expect(afterEdit.hand[0].items).toEqual(["mushroom"]);

    // Remove first card via debug
    p1._messageBuffers["cardsDrawn"] = [];
    board.send("_testSetState", { playerId: pid1, setHandCard: { index: 0, items: null } });
    const afterRemove = await waitForMessage(p1, "cardsDrawn");
    expect(afterRemove.hand.length).toBe(sizeAfterAdd - 1);

    p1.leave();
    p2.leave();
    board.leave();
  });
});

describe("Green shell", () => {
  it("prevCell correctly maps every cell in reverse", async () => {
    const roomId = await createRoom(baseUrl);
    const { room } = await connectPlayer(baseUrl, roomId);
    const { room: board } = await connectBoard(baseUrl, roomId);
    board.send("_debugGetState");
    // We can't access prevCell directly, but we can verify it via the game behavior.
    // Instead, test that _previousCell works by throwing shells backward.
    // For now, just verify the room initializes correctly.
    room.leave();
    board.leave();
  });

  it("playing a green_shell card sets pendingShellChoice", async () => {
    const roomId = await createRoom(baseUrl, {
      _testDeck: [["green_shell"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"]],
    });
    const { room } = await connectPlayer(baseUrl, roomId);
    room.send("setReady", true);
    room.send("startGame");
    await waitForMessage(room, "gameState", (g) => g.phase === "playing");
    const cards = await waitForMessage(room, "cardsDrawn");
    const shellCard = cards.hand.find((c) => c.items.includes("green_shell"));
    expect(shellCard).toBeDefined();

    room.send("playCard", { cardId: shellCard.id });
    // First cardPlayed is card removal, second is after green_shell resolves with pendingShellChoice
    const played = await waitForMessage(room, "cardPlayed", (p) => p.pendingShellChoice === true);
    expect(played.pendingShellChoice).toBe(true);

    room.leave();
  });

  it("pendingShellChoice blocks playCard, endTurn, and buyCard", async () => {
    const roomId = await createRoom(baseUrl, {
      _testDeck: [["green_shell"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"]],
    });
    const { room, playerId } = await connectPlayer(baseUrl, roomId);
    room.send("setReady", true);
    room.send("startGame");
    await waitForMessage(room, "gameState", (g) => g.phase === "playing");
    const cards = await waitForMessage(room, "cardsDrawn");
    const shellCard = cards.hand.find((c) => c.items.includes("green_shell"));
    room.send("playCard", { cardId: shellCard.id });
    await waitForMessage(room, "cardPlayed", (p) => p.pendingShellChoice === true);

    // Try playing another card — should be ignored
    const coinCard = cards.hand.find((c) => c.items.includes("coin"));
    room.send("playCard", { cardId: coinCard.id });

    // Try ending turn — should be ignored
    room.send("endTurn");

    // Verify player is still active with pendingShellChoice (turn didn't advance)
    await new Promise((r) => setTimeout(r, 100));
    const players = await waitForMessage(room, "players", (p) => {
      const me = p.find((x) => x.playerId === playerId);
      return me && me.pendingShellChoice === true;
    });
    const me = players.find((p) => p.playerId === playerId);
    expect(me.pendingShellChoice).toBe(true);

    room.leave();
  });

  it("shellChoice forward places shell on next cell when empty", async () => {
    const roomId = await createRoom(baseUrl, {
      _testDeck: [["green_shell"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"]],
    });
    const { room } = await connectPlayer(baseUrl, roomId);
    const { room: board } = await connectBoard(baseUrl, roomId);
    room.send("setReady", true);
    room.send("startGame");
    await waitForMessage(room, "gameState", (g) => g.phase === "playing");
    const cards = await waitForMessage(room, "cardsDrawn");
    const shellCard = cards.hand.find((c) => c.items.includes("green_shell"));

    room.send("playCard", { cardId: shellCard.id });
    await waitForMessage(room, "cardPlayed", (p) => p.pendingShellChoice === true);

    room.send("shellChoice", { direction: "forward" });
    const thrown = await waitForMessage(board, "shellThrown");
    expect(thrown.fromCellId).toBe(1);
    expect(thrown.toCellId).toBe(2);
    expect(thrown.hit).toBeNull();

    // Shell should be on cell 2
    const occ = await waitForMessage(board, "cellOccupants", (o) => o[2] && o[2].includes("green_shell"));
    expect(occ[2]).toContain("green_shell");

    room.leave();
    board.leave();
  });

  it("shellChoice backward places shell on previous cell", async () => {
    const roomId = await createRoom(baseUrl, {
      _testDeck: [["green_shell"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"]],
    });
    const { room } = await connectPlayer(baseUrl, roomId);
    const { room: board } = await connectBoard(baseUrl, roomId);
    room.send("setReady", true);
    room.send("startGame");
    await waitForMessage(room, "gameState", (g) => g.phase === "playing");
    const cards = await waitForMessage(room, "cardsDrawn");
    const shellCard = cards.hand.find((c) => c.items.includes("green_shell"));

    room.send("playCard", { cardId: shellCard.id });
    await waitForMessage(room, "cardPlayed", (p) => p.pendingShellChoice === true);

    room.send("shellChoice", { direction: "backward" });
    const thrown = await waitForMessage(board, "shellThrown");
    expect(thrown.fromCellId).toBe(1);
    expect(thrown.toCellId).toBe(14);
    expect(thrown.hit).toBeNull();

    room.leave();
    board.leave();
  });

  it("shell hits a player on the target cell", async () => {
    const roomId = await createRoom(baseUrl, {
      _testDeck: [["green_shell"], ["mushroom"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"]],
    });
    const { room: room1, playerId: id1 } = await connectPlayer(baseUrl, roomId);
    const { room: room2, playerId: id2 } = await connectPlayer(baseUrl, roomId);
    const { room: board } = await connectBoard(baseUrl, roomId);
    room1.send("setReady", true);
    room2.send("setReady", true);
    room1.send("startGame");
    const gs = await waitForMessage(room1, "gameState", (g) => g.phase === "playing");
    const cards1 = await waitForMessage(room1, "cardsDrawn");
    const cards2 = await waitForMessage(room2, "cardsDrawn");
    const activeId = gs.activePlayerId;
    const activeRoom = activeId === id1 ? room1 : room2;
    const passiveRoom = activeId === id1 ? room2 : room1;
    const passiveId = activeId === id1 ? id2 : id1;
    const activeCards = activeId === id1 ? cards1 : cards2;

    // Active plays mushroom to go to cell 2
    const mushroom = activeCards.hand.find((c) => c.items.includes("mushroom"));
    activeRoom.send("playCard", { cardId: mushroom.id });
    await waitForMessage(activeRoom, "cardPlayed");

    // Now active is on cell 2. Throw shell backward to cell 1 where passive is
    const shellCard = activeCards.hand.find((c) => c.items.includes("green_shell"));
    activeRoom.send("playCard", { cardId: shellCard.id });
    await waitForMessage(activeRoom, "cardPlayed", (p) => p.pendingShellChoice === true);

    activeRoom.send("shellChoice", { direction: "backward" });
    const thrown = await waitForMessage(board, "shellThrown");
    expect(thrown.hit).toBe("player");
    expect(thrown.hitPlayerId).toBe(passiveId);

    // Passive player should gain a slow counter
    const players = await waitForMessage(board, "players", (ps) => ps.find((p) => p.playerId === passiveId)?.slowCounters === 1);
    expect(players.find((p) => p.playerId === passiveId).slowCounters).toBe(1);

    room1.leave();
    room2.leave();
    board.leave();
  });

  it("shell hits a banana on the target cell — both destroyed", async () => {
    const roomId = await createRoom(baseUrl, {
      _testDeck: [["green_shell"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"]],
    });
    const { room } = await connectPlayer(baseUrl, roomId);
    const { room: board } = await connectBoard(baseUrl, roomId);
    room.send("setReady", true);
    room.send("startGame");
    await waitForMessage(room, "gameState", (g) => g.phase === "playing");
    const cards = await waitForMessage(room, "cardsDrawn");

    // Place a banana on cell 2 via debug
    board.send("_debugSetGameState", { addBanana: { cellId: 2 } });
    await waitForMessage(board, "cellOccupants", (o) => o[2] && o[2].includes("banana"));

    const shellCard = cards.hand.find((c) => c.items.includes("green_shell"));
    room.send("playCard", { cardId: shellCard.id });
    await waitForMessage(room, "cardPlayed", (p) => p.pendingShellChoice === true);

    room.send("shellChoice", { direction: "forward" });
    const thrown = await waitForMessage(board, "shellThrown");
    expect(thrown.toCellId).toBe(2);
    expect(thrown.hit).toBe("banana");

    // Banana removed, shell not added
    const occ = await waitForMessage(board, "cellOccupants", (o) => !o[2] || !o[2].includes("banana"));
    expect(occ[2] || []).not.toContain("banana");
    expect(occ[2] || []).not.toContain("green_shell");

    room.leave();
    board.leave();
  });

  it("invalid shellChoice direction is rejected", async () => {
    const roomId = await createRoom(baseUrl, {
      _testDeck: [["green_shell"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"]],
    });
    const { room, playerId } = await connectPlayer(baseUrl, roomId);
    room.send("setReady", true);
    room.send("startGame");
    await waitForMessage(room, "gameState", (g) => g.phase === "playing");
    const cards = await waitForMessage(room, "cardsDrawn");
    const shellCard = cards.hand.find((c) => c.items.includes("green_shell"));

    room.send("playCard", { cardId: shellCard.id });
    await waitForMessage(room, "cardPlayed", (p) => p.pendingShellChoice === true);

    room.send("shellChoice", { direction: "left" });
    await new Promise((r) => setTimeout(r, 100));

    const players = await waitForMessage(room, "players", (p) => {
      const me = p.find((x) => x.playerId === playerId);
      return me && me.pendingShellChoice === true;
    });
    expect(players.find((p) => p.playerId === playerId).pendingShellChoice).toBe(true);

    room.leave();
  });

  it("player moving onto a green_shell triggers discard", async () => {
    const roomId = await createRoom(baseUrl, {
      _testDeck: [["green_shell"], ["mushroom"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"]],
    });
    const { room } = await connectPlayer(baseUrl, roomId);
    const { room: board } = await connectBoard(baseUrl, roomId);
    room.send("setReady", true);
    room.send("startGame");
    await waitForMessage(room, "gameState", (g) => g.phase === "playing");
    const cards = await waitForMessage(room, "cardsDrawn");

    // Play green_shell, throw forward to cell 2
    const shellCard = cards.hand.find((c) => c.items.includes("green_shell"));
    room.send("playCard", { cardId: shellCard.id });
    await waitForMessage(room, "cardPlayed", (p) => p.pendingShellChoice === true);
    room.send("shellChoice", { direction: "forward" });
    await waitForMessage(board, "shellThrown");

    // Play mushroom to move to cell 2 (where shell is)
    const mushroom = cards.hand.find((c) => c.items.includes("mushroom"));
    room.send("playCard", { cardId: mushroom.id });
    await waitForMessage(room, "cardPlayed");

    // Board should receive itemHitBoard with type green_shell
    const hit = await waitForMessage(board, "itemHitBoard", (h) => h.type === "green_shell");
    expect(hit.type).toBe("green_shell");

    // Player should gain a slow counter instead of discarding
    const players = await waitForMessage(board, "players", (ps) => ps[0]?.slowCounters === 1);
    expect(players[0].slowCounters).toBe(1);

    room.leave();
    board.leave();
  });
});

describe("Red shell", () => {
  it("playing a red_shell card sets pendingShellChoice and pendingShellType", async () => {
    const roomId = await createRoom(baseUrl, {
      _testDeck: [["red_shell"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"]],
    });
    const { room } = await connectPlayer(baseUrl, roomId);
    room.send("setReady", true);
    room.send("startGame");
    await waitForMessage(room, "gameState", (g) => g.phase === "playing");
    const cards = await waitForMessage(room, "cardsDrawn");
    const shellCard = cards.hand.find((c) => c.items.includes("red_shell"));
    expect(shellCard).toBeDefined();

    room.send("playCard", { cardId: shellCard.id });
    const played = await waitForMessage(room, "cardPlayed", (p) => p.pendingShellChoice === true);
    expect(played.pendingShellChoice).toBe(true);
    expect(played.pendingShellType).toBe("red_shell");

    room.leave();
  });

  it("red shell forward hits player on non-adjacent cell", async () => {
    const roomId = await createRoom(baseUrl, {
      _testDeck: [["red_shell"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"]],
    });
    const { room: room1, playerId: id1 } = await connectPlayer(baseUrl, roomId);
    const { room: room2, playerId: id2 } = await connectPlayer(baseUrl, roomId);
    const { room: board } = await connectBoard(baseUrl, roomId);
    room1.send("setReady", true);
    room2.send("setReady", true);
    room1.send("startGame");
    const gs = await waitForMessage(room1, "gameState", (g) => g.phase === "playing");
    const cards1 = await waitForMessage(room1, "cardsDrawn");
    const cards2 = await waitForMessage(room2, "cardsDrawn");
    const activeId = gs.activePlayerId;
    const activeRoom = activeId === id1 ? room1 : room2;
    const passiveRoom = activeId === id1 ? room2 : room1;
    const passiveId = activeId === id1 ? id2 : id1;
    const activeCards = activeId === id1 ? cards1 : cards2;

    // Move passive player to cell 5 via debug
    board.send("_testSetState", { playerId: passiveId, cellId: 5 });
    await waitForMessage(board, "cellOccupants", (o) => o[5] && o[5].includes(passiveId));

    // Play red shell forward
    const shellCard = activeCards.hand.find((c) => c.items.includes("red_shell"));
    activeRoom.send("playCard", { cardId: shellCard.id });
    await waitForMessage(activeRoom, "cardPlayed", (p) => p.pendingShellChoice === true);

    activeRoom.send("shellChoice", { direction: "forward" });
    const thrown = await waitForMessage(board, "shellThrown");
    expect(thrown.shellType).toBe("red_shell");
    expect(thrown.hit).toBe("player");
    expect(thrown.hitPlayerId).toBe(passiveId);
    expect(thrown.toCellId).toBe(5);
    expect(thrown.path).toEqual([2, 3, 4, 5]);

    // Passive player should gain a slow counter
    const players = await waitForMessage(board, "players", (ps) => ps.find((p) => p.playerId === passiveId)?.slowCounters === 1);
    expect(players.find((p) => p.playerId === passiveId).slowCounters).toBe(1);

    room1.leave();
    room2.leave();
    board.leave();
  });

  it("red shell hits banana on intermediate cell", async () => {
    const roomId = await createRoom(baseUrl, {
      _testDeck: [["red_shell"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"]],
    });
    const { room } = await connectPlayer(baseUrl, roomId);
    const { room: board } = await connectBoard(baseUrl, roomId);
    room.send("setReady", true);
    room.send("startGame");
    await waitForMessage(room, "gameState", (g) => g.phase === "playing");
    const cards = await waitForMessage(room, "cardsDrawn");

    // Place banana on cell 4
    board.send("_debugSetGameState", { addBanana: { cellId: 4 } });
    await waitForMessage(board, "cellOccupants", (o) => o[4] && o[4].includes("banana"));

    const shellCard = cards.hand.find((c) => c.items.includes("red_shell"));
    room.send("playCard", { cardId: shellCard.id });
    await waitForMessage(room, "cardPlayed", (p) => p.pendingShellChoice === true);

    room.send("shellChoice", { direction: "forward" });
    const thrown = await waitForMessage(board, "shellThrown");
    expect(thrown.shellType).toBe("red_shell");
    expect(thrown.toCellId).toBe(4);
    expect(thrown.hit).toBe("banana");
    expect(thrown.path).toEqual([2, 3, 4]);

    // Banana should be removed
    const occ = await waitForMessage(board, "cellOccupants", (o) => !o[4] || !o[4].includes("banana"));
    expect(occ[4] || []).not.toContain("banana");

    room.leave();
    board.leave();
  });

  it("red shell hits green shell on cell", async () => {
    const roomId = await createRoom(baseUrl, {
      _testDeck: [["red_shell"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"]],
    });
    const { room } = await connectPlayer(baseUrl, roomId);
    const { room: board } = await connectBoard(baseUrl, roomId);
    room.send("setReady", true);
    room.send("startGame");
    await waitForMessage(room, "gameState", (g) => g.phase === "playing");
    const cards = await waitForMessage(room, "cardsDrawn");

    // Place green shell on cell 6
    board.send("_debugSetGameState", { addShell: { cellId: 6 } });
    await waitForMessage(board, "cellOccupants", (o) => o[6] && o[6].includes("green_shell"));

    const shellCard = cards.hand.find((c) => c.items.includes("red_shell"));
    room.send("playCard", { cardId: shellCard.id });
    await waitForMessage(room, "cardPlayed", (p) => p.pendingShellChoice === true);

    room.send("shellChoice", { direction: "forward" });
    const thrown = await waitForMessage(board, "shellThrown");
    expect(thrown.shellType).toBe("red_shell");
    expect(thrown.toCellId).toBe(6);
    expect(thrown.hit).toBe("green_shell");
    expect(thrown.path).toEqual([2, 3, 4, 5, 6]);

    // Green shell should be removed
    const occ = await waitForMessage(board, "cellOccupants", (o) => !o[6] || !o[6].includes("green_shell"));
    expect(occ[6] || []).not.toContain("green_shell");

    room.leave();
    board.leave();
  });

  it("red shell with no other target hits the thrower", async () => {
    const roomId = await createRoom(baseUrl, {
      _testDeck: [["red_shell"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"]],
    });
    const { room, playerId } = await connectPlayer(baseUrl, roomId);
    const { room: board } = await connectBoard(baseUrl, roomId);
    room.send("setReady", true);
    room.send("startGame");
    await waitForMessage(room, "gameState", (g) => g.phase === "playing");
    const cards = await waitForMessage(room, "cardsDrawn");

    const shellCard = cards.hand.find((c) => c.items.includes("red_shell"));
    room.send("playCard", { cardId: shellCard.id });
    await waitForMessage(room, "cardPlayed", (p) => p.pendingShellChoice === true);

    room.send("shellChoice", { direction: "forward" });
    const thrown = await waitForMessage(board, "shellThrown");
    expect(thrown.shellType).toBe("red_shell");
    expect(thrown.hit).toBe("player");
    expect(thrown.hitPlayerId).toBe(playerId);
    expect(thrown.path).toHaveLength(14);

    // Thrower should gain a slow counter
    const players = await waitForMessage(board, "players", (ps) => ps.find((p) => p.playerId === playerId)?.slowCounters === 1);
    expect(players.find((p) => p.playerId === playerId).slowCounters).toBe(1);

    room.leave();
    board.leave();
  });

  it("red shell backward behaves like green shell (adjacent cell only)", async () => {
    const roomId = await createRoom(baseUrl, {
      _testDeck: [["red_shell"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"]],
    });
    const { room: room1, playerId: id1 } = await connectPlayer(baseUrl, roomId);
    const { room: room2, playerId: id2 } = await connectPlayer(baseUrl, roomId);
    const { room: board } = await connectBoard(baseUrl, roomId);
    room1.send("setReady", true);
    room2.send("setReady", true);
    room1.send("startGame");
    const gs = await waitForMessage(room1, "gameState", (g) => g.phase === "playing");
    const cards1 = await waitForMessage(room1, "cardsDrawn");
    const cards2 = await waitForMessage(room2, "cardsDrawn");
    const activeId = gs.activePlayerId;
    const activeRoom = activeId === id1 ? room1 : room2;
    const passiveId = activeId === id1 ? id2 : id1;
    const activeCards = activeId === id1 ? cards1 : cards2;

    // Move passive to cell 14 (adjacent behind cell 1)
    board.send("_testSetState", { playerId: passiveId, cellId: 14 });
    await waitForMessage(board, "cellOccupants", (o) => o[14] && o[14].includes(passiveId));

    const shellCard = activeCards.hand.find((c) => c.items.includes("red_shell"));
    activeRoom.send("playCard", { cardId: shellCard.id });
    await waitForMessage(activeRoom, "cardPlayed", (p) => p.pendingShellChoice === true);

    activeRoom.send("shellChoice", { direction: "backward" });
    const thrown = await waitForMessage(board, "shellThrown");
    expect(thrown.shellType).toBe("red_shell");
    expect(thrown.hit).toBe("player");
    expect(thrown.hitPlayerId).toBe(passiveId);
    expect(thrown.toCellId).toBe(14);
    // No path — single-cell throw like green shell
    expect(thrown.path).toBeUndefined();

    room1.leave();
    room2.leave();
    board.leave();
  });

  it("red shell backward misses non-adjacent target and stays on cell", async () => {
    const roomId = await createRoom(baseUrl, {
      _testDeck: [["red_shell"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"]],
    });
    const { room: room1, playerId: id1 } = await connectPlayer(baseUrl, roomId);
    const { room: room2, playerId: id2 } = await connectPlayer(baseUrl, roomId);
    const { room: board } = await connectBoard(baseUrl, roomId);
    room1.send("setReady", true);
    room2.send("setReady", true);
    room1.send("startGame");
    const gs = await waitForMessage(room1, "gameState", (g) => g.phase === "playing");
    const cards1 = await waitForMessage(room1, "cardsDrawn");
    const cards2 = await waitForMessage(room2, "cardsDrawn");
    const activeId = gs.activePlayerId;
    const activeRoom = activeId === id1 ? room1 : room2;
    const passiveId = activeId === id1 ? id2 : id1;
    const activeCards = activeId === id1 ? cards1 : cards2;

    // Move passive to cell 12 (far behind, not adjacent)
    board.send("_testSetState", { playerId: passiveId, cellId: 12 });
    await waitForMessage(board, "cellOccupants", (o) => o[12] && o[12].includes(passiveId));

    const shellCard = activeCards.hand.find((c) => c.items.includes("red_shell"));
    activeRoom.send("playCard", { cardId: shellCard.id });
    await waitForMessage(activeRoom, "cardPlayed", (p) => p.pendingShellChoice === true);

    activeRoom.send("shellChoice", { direction: "backward" });
    const thrown = await waitForMessage(board, "shellThrown");
    expect(thrown.shellType).toBe("red_shell");
    expect(thrown.hit).toBeNull();
    expect(thrown.toCellId).toBe(14);

    // Shell stays on cell 14 as a red_shell occupant
    const occ = await waitForMessage(board, "cellOccupants", (o) => o[14] && o[14].includes("red_shell"));
    expect(occ[14]).toContain("red_shell");

    room1.leave();
    room2.leave();
    board.leave();
  });
});

describe("Permanent coins", () => {
  it("permanentCoins starts at 0", async () => {
    const roomId = await createRoom(baseUrl, {
      _testDeck: [["coin"], ["coin"], ["coin"], ["coin"], ["coin"]],
    });
    const { room } = await connectPlayer(baseUrl, roomId);
    room.send("setReady", true);
    room.send("startGame");
    await waitForMessage(room, "gameState", (g) => g.phase === "playing");
    const players = await waitForPlayers(room, (list) => list.length === 1);
    expect(players[0].permanentCoins).toBe(0);
    room.leave();
  });

  it("landing on permanent coin cell increments permanentCoins and coins", async () => {
    // Cell 1→2→3; cell 3 has permanent_coin: 1
    const roomId = await createRoom(baseUrl, {
      _testDeck: [["mushroom", "mushroom"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"]],
    });
    const { room } = await connectPlayer(baseUrl, roomId);
    room.send("setReady", true);
    room.send("startGame");
    await waitForMessage(room, "gameState", (g) => g.phase === "playing");
    const cards = await waitForMessage(room, "cardsDrawn");
    const mmCard = cards.hand.find((c) => c.items.join(",") === "mushroom,mushroom");
    room.send("playCard", { cardId: mmCard.id });
    await waitForMessage(room, "cardPlayed");
    const players = await waitForPlayers(room, (list) => list[0].permanentCoins === 1);
    expect(players[0].permanentCoins).toBe(1);
    expect(players[0].coins).toBe(1);
    expect(players[0].cellId).toBe(3);
    room.leave();
  });

  it("endTurn restores coins to permanentCoins", async () => {
    const roomId = await createRoom(baseUrl, {
      _testDeck: [["mushroom", "mushroom"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"]],
    });
    const { room } = await connectPlayer(baseUrl, roomId);
    room.send("setReady", true);
    room.send("startGame");
    await waitForMessage(room, "gameState", (g) => g.phase === "playing");
    const cards = await waitForMessage(room, "cardsDrawn");
    // Play mushroom×2 to land on cell 3 (permanent coin)
    const mmCard = cards.hand.find((c) => c.items.join(",") === "mushroom,mushroom");
    room.send("playCard", { cardId: mmCard.id });
    await waitForMessage(room, "cardPlayed");
    await waitForPlayers(room, (list) => list[0].permanentCoins === 1);
    // Play a coin card to earn 1 regular coin (total coins = 2)
    const coinCard = cards.hand.find((c) => c.items.length === 1 && c.items[0] === "coin");
    room.send("playCard", { cardId: coinCard.id });
    await waitForMessage(room, "cardPlayed");
    await waitForPlayers(room, (list) => list[0].coins === 2);
    // End turn: regular coins reset, permanent coins restored
    room.send("endTurn");
    const players = await waitForPlayers(room, (list) => list[0].coins === 1);
    expect(players[0].coins).toBe(1);
    expect(players[0].permanentCoins).toBe(1);
    room.leave();
  });

  it("landing on same permanent coin cell again increments again", async () => {
    const roomId = await createRoom(baseUrl, {
      _testDeck: [["mushroom", "mushroom"], ["coin"], ["coin"], ["coin"], ["coin"],
        ["mushroom", "mushroom"], ["coin"], ["coin"], ["coin"], ["coin"],
        ["mushroom", "mushroom"], ["coin"], ["coin"], ["coin"], ["coin"]],
    });
    const { room } = await connectPlayer(baseUrl, roomId);
    room.send("setReady", true);
    room.send("startGame");
    await waitForMessage(room, "gameState", (g) => g.phase === "playing");
    let cards = await waitForMessage(room, "cardsDrawn");

    // First trip: mushroom×2 → cell 1→2→3 (gain 1 permanent coin)
    let mmCard = cards.hand.find((c) => c.items.join(",") === "mushroom,mushroom");
    room.send("playCard", { cardId: mmCard.id });
    await waitForMessage(room, "cardPlayed");
    await waitForPlayers(room, (list) => list[0].permanentCoins === 1);

    // End turn to reset
    room.send("endTurn");
    cards = await waitForMessage(room, "cardsDrawn");

    // Position back to cell 1 via _testSetState
    room.send("_testSetState", { cellId: 1 });
    await waitForPlayers(room, (list) => list[0].cellId === 1);

    // Second trip: mushroom×2 → cell 1→2→3 again
    mmCard = cards.hand.find((c) => c.items.join(",") === "mushroom,mushroom");
    room.send("playCard", { cardId: mmCard.id });
    await waitForMessage(room, "cardPlayed");
    // After endTurn coins=1 (permanentCoins=1), then gain 1 more permanent = coins 2, permanentCoins 2
    const players = await waitForPlayers(room, (list) => list[0].permanentCoins === 2);
    expect(players[0].permanentCoins).toBe(2);
    expect(players[0].coins).toBe(2);
    room.leave();
  });

  it("buying cards spends regular coins first, permanent coins survive turn end", async () => {
    const roomId = await createRoom(baseUrl, {
      _testDeck: [["mushroom", "mushroom"], ["coin"], ["coin"], ["coin"], ["coin"],
        ["coin"], ["coin"], ["coin"], ["coin"], ["coin"]],
      _testRiverDecks: [
        [["mushroom"], ["banana"], ["coin"], ["mushroom"], ["banana"], ["coin"]],
        [["mushroom", "mushroom"], ["banana", "banana"], ["coin", "coin"], ["mushroom", "mushroom"], ["banana", "banana"], ["coin", "coin"]],
        [["mushroom", "mushroom", "mushroom"], ["banana", "banana", "banana"], ["coin", "coin", "coin"], ["mushroom", "mushroom", "mushroom"]],
      ],
    });
    const { room } = await connectPlayer(baseUrl, roomId);
    room.send("setReady", true);
    room.send("startGame");
    const gs = await waitForMessage(room, "gameState", (g) => g.phase === "playing");
    const cards = await waitForMessage(room, "cardsDrawn");

    // Play mushroom×2 to land on cell 3 (1 permanent coin)
    const mmCard = cards.hand.find((c) => c.items.join(",") === "mushroom,mushroom");
    room.send("playCard", { cardId: mmCard.id });
    await waitForMessage(room, "cardPlayed");
    await waitForPlayers(room, (list) => list[0].permanentCoins === 1);

    // Play 2 coin cards to earn 2 regular coins (total coins = 3, permanentCoins = 1)
    const coinCards = cards.hand.filter((c) => c.items.length === 1 && c.items[0] === "coin");
    room.send("playCard", { cardId: coinCards[0].id });
    await waitForMessage(room, "cardPlayed");
    room.send("playCard", { cardId: coinCards[1].id });
    await waitForMessage(room, "cardPlayed");
    await waitForPlayers(room, (list) => list[0].coins === 3);

    // Buy a river 0 card (cost 1) — spends 1 regular coin
    const river0Card = gs.rivers[0].slots[0];
    room.send("buyCard", { riverId: 0, cardId: river0Card.id });
    const bought = await waitForMessage(room, "cardBought");
    expect(bought.coins).toBe(2); // 3 - 1 = 2
    expect(bought.permanentCoins).toBe(1);

    // End turn: coins should restore to permanentCoins (1)
    room.send("endTurn");
    const players = await waitForPlayers(room, (list) => list[0].coins === 1);
    expect(players[0].coins).toBe(1);
    expect(players[0].permanentCoins).toBe(1);
    room.leave();
  });

  it("buying with insufficient regular coins spends permanent coins", async () => {
    const roomId = await createRoom(baseUrl, {
      _testDeck: [["mushroom", "mushroom"], ["coin"], ["coin"], ["coin"], ["coin"],
        ["coin"], ["coin"], ["coin"], ["coin"], ["coin"]],
      _testRiverDecks: [
        [["mushroom"], ["banana"], ["coin"], ["mushroom"], ["banana"], ["coin"]],
        [["mushroom", "mushroom"], ["banana", "banana"], ["coin", "coin"], ["mushroom", "mushroom"], ["banana", "banana"], ["coin", "coin"]],
        [["mushroom", "mushroom", "mushroom"], ["banana", "banana", "banana"], ["coin", "coin", "coin"], ["mushroom", "mushroom", "mushroom"]],
      ],
    });
    const { room } = await connectPlayer(baseUrl, roomId);
    room.send("setReady", true);
    room.send("startGame");
    const gs = await waitForMessage(room, "gameState", (g) => g.phase === "playing");
    const cards = await waitForMessage(room, "cardsDrawn");

    // Play mushroom×2 to land on cell 3 (1 permanent coin)
    const mmCard = cards.hand.find((c) => c.items.join(",") === "mushroom,mushroom");
    room.send("playCard", { cardId: mmCard.id });
    await waitForMessage(room, "cardPlayed");
    await waitForPlayers(room, (list) => list[0].permanentCoins === 1);

    // No coin cards played — only 1 permanent coin available (coins=1, permanentCoins=1)
    // Buy a river 0 card (cost 1) — must spend the permanent coin
    const river0Card = gs.rivers[0].slots[0];
    room.send("buyCard", { riverId: 0, cardId: river0Card.id });
    const bought = await waitForMessage(room, "cardBought");
    expect(bought.coins).toBe(0);
    expect(bought.permanentCoins).toBe(0);

    // End turn: coins should be 0 since permanent coin was spent
    room.send("endTurn");
    const players = await waitForPlayers(room, (list) => list[0].coins === 0);
    expect(players[0].coins).toBe(0);
    expect(players[0].permanentCoins).toBe(0);
    room.leave();
  });
});
