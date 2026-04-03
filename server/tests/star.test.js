import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  startServer, createRoom, connectPlayer, connectBoard,
  waitForMessage, waitForPlayers,
} from "./helpers.js";

let baseUrl, cleanup;

beforeAll(async () => {
  ({ baseUrl, cleanup } = await startServer());
});
afterAll(async () => { await cleanup(); });

describe("Star", () => {
  it("star + mushroom sets invincibility and moves forward", async () => {
    const roomId = await createRoom(baseUrl, {
      _testDeck: [["star", "mushroom"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"]],
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

    const starCard = activeCards.hand.find((c) => c.items.includes("star"));
    activeRoom.send("playCard", { cardId: starCard.id });

    // Player should be star-invincible and moved to cell 2
    const players = await waitForPlayers(board, (ps) => {
      const p = ps.find((p) => p.playerId === activeId);
      return p?.starInvincible && p?.cellId === 2;
    });
    const active = players.find((p) => p.playerId === activeId);
    expect(active.starInvincible).toBe(true);
    expect(active.cellId).toBe(2);

    room1.leave(); room2.leave(); board.leave();
  });

  it("green shell passes through star-invincible player", async () => {
    const roomId = await createRoom(baseUrl, {
      _testDeck: [["green_shell"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"]],
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
    const passiveId = activeId === id1 ? id2 : id1;
    const activeRoom = activeId === id1 ? room1 : room2;
    const activeCards = activeId === id1 ? cards1 : cards2;

    // Move passive to cell 2 (adjacent forward) and make them star-invincible
    board.send("_testSetState", { playerId: passiveId, cellId: 2, lapCount: 1, starInvincible: true });
    await waitForPlayers(board, (ps) => ps.find((p) => p.playerId === passiveId)?.cellId === 2);

    // Active throws green shell forward at cell 2
    const shellCard = activeCards.hand.find((c) => c.items.includes("green_shell"));
    activeRoom.send("playCard", { cardId: shellCard.id });
    await waitForMessage(activeRoom, "cardPlayed", (p) => p.pendingShellChoice === true);
    activeRoom.send("shellChoice", { direction: "forward" });

    // Shell should land on cell 2 (not hit the star-invincible player)
    const thrown = await waitForMessage(board, "shellThrown");
    expect(thrown.hit).toBeNull();
    expect(thrown.toCellId).toBe(2);

    // Passive should have no slow counters
    const players = await waitForPlayers(board, (ps) => {
      const p = ps.find((p) => p.playerId === passiveId);
      return p?.slowCounters === 0;
    });
    expect(players.find((p) => p.playerId === passiveId).slowCounters).toBe(0);

    room1.leave(); room2.leave(); board.leave();
  });

  it("red shell passes through star-invincible player", async () => {
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
    const passiveId = activeId === id1 ? id2 : id1;
    const activeRoom = activeId === id1 ? room1 : room2;
    const activeCards = activeId === id1 ? cards1 : cards2;

    // Move passive to cell 3 and make them star-invincible
    board.send("_testSetState", { playerId: passiveId, cellId: 3, lapCount: 1, starInvincible: true });
    await waitForPlayers(board, (ps) => ps.find((p) => p.playerId === passiveId)?.cellId === 3);

    // Active throws red shell forward — should pass through star-invincible passive
    const shellCard = activeCards.hand.find((c) => c.items.includes("red_shell"));
    activeRoom.send("playCard", { cardId: shellCard.id });
    await waitForMessage(activeRoom, "cardPlayed", (p) => p.pendingShellChoice === true);
    activeRoom.send("shellChoice", { direction: "forward" });

    // Red shell should hit the thrower (wraps around) since the star-invincible player is skipped
    const thrown = await waitForMessage(board, "shellThrown");
    expect(thrown.hitPlayerId).not.toBe(passiveId);

    // Passive should have no slow counters
    const players = await waitForPlayers(board, (ps) => {
      const p = ps.find((p) => p.playerId === passiveId);
      return p !== undefined;
    });
    expect(players.find((p) => p.playerId === passiveId).slowCounters).toBe(0);

    room1.leave(); room2.leave(); board.leave();
  });

  it("blue shell blocked by star (no hand discard)", async () => {
    const roomId = await createRoom(baseUrl, {
      _testDeck: [["blue_shell"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"]],
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
    const passiveId = activeId === id1 ? id2 : id1;
    const activeRoom = activeId === id1 ? room1 : room2;
    const activeCards = activeId === id1 ? cards1 : cards2;

    // Move passive ahead (rank 1) and make them star-invincible
    board.send("_testSetState", { playerId: passiveId, cellId: 5, lapCount: 1, starInvincible: true });
    await waitForPlayers(board, (ps) => ps.find((p) => p.playerId === passiveId)?.starInvincible === true);

    // Play blue shell
    const shellCard = activeCards.hand.find((c) => c.items.includes("blue_shell"));
    activeRoom.send("playCard", { cardId: shellCard.id });

    // Board should see shellThrown with hit: "star_blocked"
    const thrown = await waitForMessage(board, "shellThrown");
    expect(thrown.shellType).toBe("blue_shell");
    expect(thrown.hit).toBe("star_blocked");
    expect(thrown.hitPlayerId).toBe(passiveId);

    // Passive should still have full hand (5 cards)
    const players = await waitForPlayers(board, (ps) => {
      const p = ps.find((p) => p.playerId === passiveId);
      return p?.handCount === 5;
    });
    expect(players.find((p) => p.playerId === passiveId).handCount).toBe(5);

    room1.leave(); room2.leave(); board.leave();
  });

  it("star-invincible player destroys banana on landing (no discard)", async () => {
    const roomId = await createRoom(baseUrl, {
      _testDeck: [["star", "mushroom"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"]],
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

    // Place a banana on cell 2
    board.send("_debugSetGameState", { addBanana: { cellId: 2 } });
    await waitForMessage(board, "cellOccupants", (o) => o[2] && o[2].includes("banana"));

    // Play star + mushroom card
    const starCard = activeCards.hand.find((c) => c.items.includes("star"));
    activeRoom.send("playCard", { cardId: starCard.id });

    // Should move to cell 2 and destroy the banana
    const occupants = await waitForMessage(board, "cellOccupants", (o) => {
      return o[2] && !o[2].includes("banana");
    });
    expect(occupants[2]?.includes("banana")).toBeFalsy();

    // Player should have no pending discard (hand stays at 4 since 1 card was played)
    const players = await waitForPlayers(board, (ps) => {
      const p = ps.find((p) => p.playerId === activeId);
      return p?.cellId === 2;
    });
    const active = players.find((p) => p.playerId === activeId);
    expect(active.handCount).toBe(4);

    room1.leave(); room2.leave(); board.leave();
  });

  it("star-invincible player gives slow counter to other player on landing", async () => {
    const roomId = await createRoom(baseUrl, {
      _testDeck: [["star", "mushroom"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"]],
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
    const passiveId = activeId === id1 ? id2 : id1;
    const activeRoom = activeId === id1 ? room1 : room2;
    const activeCards = activeId === id1 ? cards1 : cards2;

    // Move passive to cell 2
    board.send("_testSetState", { playerId: passiveId, cellId: 2, lapCount: 1 });
    await waitForPlayers(board, (ps) => ps.find((p) => p.playerId === passiveId)?.cellId === 2);

    // Play star + mushroom card
    const starCard = activeCards.hand.find((c) => c.items.includes("star"));
    activeRoom.send("playCard", { cardId: starCard.id });

    // Passive should get a slow counter
    const players = await waitForPlayers(board, (ps) => {
      const p = ps.find((p) => p.playerId === passiveId);
      return p?.slowCounters === 1;
    });
    expect(players.find((p) => p.playerId === passiveId).slowCounters).toBe(1);

    room1.leave(); room2.leave(); board.leave();
  });

  it("star-invincible player destroys shell on landing", async () => {
    const roomId = await createRoom(baseUrl, {
      _testDeck: [["star", "mushroom"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"]],
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

    // Place a green shell on cell 2
    board.send("_debugSetGameState", { addShell: { cellId: 2 } });
    await waitForMessage(board, "cellOccupants", (o) => o[2] && o[2].includes("green_shell"));

    // Play star + mushroom card
    const starCard = activeCards.hand.find((c) => c.items.includes("star"));
    activeRoom.send("playCard", { cardId: starCard.id });

    // Should move to cell 2 and destroy the shell
    const occupants = await waitForMessage(board, "cellOccupants", (o) => {
      return o[2] && !o[2].includes("green_shell");
    });
    expect(occupants[2]?.includes("green_shell")).toBeFalsy();

    // Player should have no slow counters (star protects)
    const players = await waitForPlayers(board, (ps) => {
      const p = ps.find((p) => p.playerId === activeId);
      return p?.cellId === 2;
    });
    expect(players.find((p) => p.playerId === activeId).slowCounters).toBe(0);

    room1.leave(); room2.leave(); board.leave();
  });

  it("star invincibility persists through other turns and resets at start of next turn", async () => {
    const roomId = await createRoom(baseUrl, {
      _testDeck: [["star"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"]],
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
    const passiveId = activeId === id1 ? id2 : id1;
    const activeRoom = activeId === id1 ? room1 : room2;
    const passiveRoom = activeId === id1 ? room2 : room1;
    const activeCards = activeId === id1 ? cards1 : cards2;

    // Play star card
    const starCard = activeCards.hand.find((c) => c.items.includes("star"));
    activeRoom.send("playCard", { cardId: starCard.id });

    // Verify star-invincible
    await waitForPlayers(board, (ps) => ps.find((p) => p.playerId === activeId)?.starInvincible === true);

    // End turn — invincibility should persist through passive's turn
    activeRoom.send("endTurn");
    await waitForMessage(board, "gameState", (g) => g.activePlayerId === passiveId);

    // During passive's turn, active should still be star-invincible
    let players = await waitForPlayers(board, (ps) => {
      const p = ps.find((p) => p.playerId === activeId);
      return p !== undefined;
    });
    expect(players.find((p) => p.playerId === activeId).starInvincible).toBe(true);

    // End passive's turn — active becomes active again, invincibility resets
    passiveRoom.send("endTurn");
    await waitForMessage(board, "gameState", (g) => g.activePlayerId === activeId);

    players = await waitForPlayers(board, (ps) => {
      const p = ps.find((p) => p.playerId === activeId);
      return p?.starInvincible === false;
    });
    expect(players.find((p) => p.playerId === activeId).starInvincible).toBe(false);

    room1.leave(); room2.leave(); board.leave();
  });
});
