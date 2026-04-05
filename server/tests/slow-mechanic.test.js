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

describe("Slow mechanic", () => {
  it("green shell throw gives slow counter instead of discard", async () => {
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
    const passiveId = activeId === id1 ? id2 : id1;
    const activeCards = activeId === id1 ? cards1 : cards2;

    // Active plays mushroom to go to cell 2
    const mushroom = activeCards.hand.find((c) => c.items.includes("mushroom"));
    activeRoom.send("playCard", { cardId: mushroom.id });
    await waitForMessage(activeRoom, "cardPlayed");

    // Throw shell backward to cell 1 where passive is
    const shellCard = activeCards.hand.find((c) => c.items.includes("green_shell"));
    activeRoom.send("playCard", { cardId: shellCard.id });
    await waitForMessage(activeRoom, "cardPlayed", (p) => p.pendingShellChoice === true);
    activeRoom.send("shellChoice", { direction: "backward" });

    const thrown = await waitForMessage(board, "shellThrown");
    expect(thrown.hit).toBe("player");
    expect(thrown.hitPlayerId).toBe(passiveId);

    // Passive should have 1 slow counter, no discard
    const players = await waitForPlayers(board, (ps) => ps.find((p) => p.playerId === passiveId)?.slowCounters === 1);
    const passive = players.find((p) => p.playerId === passiveId);
    expect(passive.slowCounters).toBe(1);
    expect(passive.handCount).toBe(5); // no cards discarded

    room1.leave(); room2.leave(); board.leave();
  });

  it("red shell throw gives slow counter instead of discard", async () => {
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

    // Move passive to cell 5
    board.send("_testSetState", { playerId: passiveId, cellId: 5 });
    await waitForMessage(board, "cellOccupants", (o) => o[5] && o[5].includes(passiveId));

    const shellCard = activeCards.hand.find((c) => c.items.includes("red_shell"));
    activeRoom.send("playCard", { cardId: shellCard.id });
    await waitForMessage(activeRoom, "cardPlayed", (p) => p.pendingShellChoice === true);
    activeRoom.send("shellChoice", { direction: "forward" });

    const thrown = await waitForMessage(board, "shellThrown");
    expect(thrown.hit).toBe("player");
    expect(thrown.hitPlayerId).toBe(passiveId);

    const players = await waitForPlayers(board, (ps) => ps.find((p) => p.playerId === passiveId)?.slowCounters === 1);
    expect(players.find((p) => p.playerId === passiveId).slowCounters).toBe(1);

    room1.leave(); room2.leave(); board.leave();
  });

  it("landing on shell gives slow counter instead of discard", async () => {
    const roomId = await createRoom(baseUrl, {
      _testDeck: [["green_shell"], ["mushroom"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"]],
    });
    const { room } = await connectPlayer(baseUrl, roomId);
    const { room: board } = await connectBoard(baseUrl, roomId);
    room.send("setReady", true);
    room.send("startGame");
    await waitForMessage(room, "gameState", (g) => g.phase === "playing");
    const cards = await waitForMessage(room, "cardsDrawn");

    // Place a green shell on cell 2
    const shellCard = cards.hand.find((c) => c.items.includes("green_shell"));
    room.send("playCard", { cardId: shellCard.id });
    await waitForMessage(room, "cardPlayed", (p) => p.pendingShellChoice === true);
    room.send("shellChoice", { direction: "forward" });
    await waitForMessage(board, "shellThrown");

    // Move onto cell 2 where the shell is
    const mushroom = cards.hand.find((c) => c.items.includes("mushroom"));
    room.send("playCard", { cardId: mushroom.id });
    await waitForMessage(room, "cardPlayed");

    const hit = await waitForMessage(board, "itemHitBoard", (h) => h.type === "green_shell");
    expect(hit.type).toBe("green_shell");

    const players = await waitForPlayers(board, (ps) => ps[0]?.slowCounters === 1);
    expect(players[0].slowCounters).toBe(1);

    room.leave(); board.leave();
  });

  it("banana hit still causes discard (unchanged)", async () => {
    const roomId = await createRoom(baseUrl, {
      _testDeck: [["mushroom"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"]],
    });
    const { room } = await connectPlayer(baseUrl, roomId);
    const { room: board } = await connectBoard(baseUrl, roomId);
    room.send("setReady", true);
    room.send("startGame");
    await waitForMessage(room, "gameState", (g) => g.phase === "playing");
    const cards = await waitForMessage(room, "cardsDrawn");

    // Place banana on cell 2
    board.send("_debugSetGameState", { addBanana: { cellId: 2 } });
    await waitForMessage(board, "cellOccupants", (o) => o[2] && o[2].includes("banana"));

    const mushroom = cards.hand.find((c) => c.items.includes("mushroom"));
    room.send("playCard", { cardId: mushroom.id });
    await waitForMessage(room, "cardPlayed");

    // Should receive discardHit for banana
    const discardHit = await waitForMessage(room, "discardHit");
    expect(discardHit.source).toBe("banana");
    expect(discardHit.mustDiscard).toBe(1);

    // Slow counter should remain 0
    const players = await waitForPlayers(board, (ps) => ps[0]?.cellId === 2);
    expect(players[0].slowCounters).toBe(0);

    room.leave(); board.leave();
  });

  it("slow counter reduces movement: 2 mushrooms + 1 slow = 1 move", async () => {
    const roomId = await createRoom(baseUrl, {
      _testDeck: [["mushroom", "mushroom"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"]],
    });
    const { room } = await connectPlayer(baseUrl, roomId);
    const { room: board } = await connectBoard(baseUrl, roomId);
    room.send("setReady", true);
    room.send("startGame");
    await waitForMessage(room, "gameState", (g) => g.phase === "playing");
    const cards = await waitForMessage(room, "cardsDrawn");

    // Give player 1 slow counter
    room.send("_testSetState", { slowCounters: 1 });
    await waitForPlayers(board, (ps) => ps[0]?.slowCounters === 1);

    const card = cards.hand.find((c) => c.items.filter((i) => i === "mushroom").length === 2);
    room.send("playCard", { cardId: card.id });
    await waitForMessage(room, "cardPlayed");

    // Should only move 1 cell (from 1 to 2), not 2
    const players = await waitForPlayers(board, (ps) => ps[0]?.cellId === 2 && ps[0]?.slowCounters === 0);
    expect(players[0].cellId).toBe(2);
    expect(players[0].slowCounters).toBe(0);

    room.leave(); board.leave();
  });

  it("1 mushroom + 1 slow = 0 moves, counter consumed", async () => {
    const roomId = await createRoom(baseUrl, {
      _testDeck: [["mushroom"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"]],
    });
    const { room } = await connectPlayer(baseUrl, roomId);
    const { room: board } = await connectBoard(baseUrl, roomId);
    room.send("setReady", true);
    room.send("startGame");
    await waitForMessage(room, "gameState", (g) => g.phase === "playing");
    const cards = await waitForMessage(room, "cardsDrawn");

    // Give player 1 slow counter
    room.send("_testSetState", { slowCounters: 1 });
    await waitForPlayers(board, (ps) => ps[0]?.slowCounters === 1);

    const mushroom = cards.hand.find((c) => c.items.includes("mushroom"));
    room.send("playCard", { cardId: mushroom.id });
    await waitForMessage(room, "cardPlayed");

    // Should NOT move, slow counter consumed
    const players = await waitForPlayers(board, (ps) => ps[0]?.slowCounters === 0);
    expect(players[0].cellId).toBe(1);
    expect(players[0].slowCounters).toBe(0);

    room.leave(); board.leave();
  });

  it("multiple slow counters: 3 mushrooms + 2 slow = 1 move", async () => {
    const roomId = await createRoom(baseUrl, {
      _testDeck: [["mushroom", "mushroom", "mushroom"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"]],
    });
    const { room } = await connectPlayer(baseUrl, roomId);
    const { room: board } = await connectBoard(baseUrl, roomId);
    room.send("setReady", true);
    room.send("startGame");
    await waitForMessage(room, "gameState", (g) => g.phase === "playing");
    const cards = await waitForMessage(room, "cardsDrawn");

    // Give player 2 slow counters
    room.send("_testSetState", { slowCounters: 2 });
    await waitForPlayers(board, (ps) => ps[0]?.slowCounters === 2);

    const card = cards.hand.find((c) => c.items.filter((i) => i === "mushroom").length === 3);
    room.send("playCard", { cardId: card.id });
    await waitForMessage(room, "cardPlayed");

    // Should move 1 cell (3 - 2 = 1), both slow counters consumed
    const players = await waitForPlayers(board, (ps) => ps[0]?.cellId === 2 && ps[0]?.slowCounters === 0);
    expect(players[0].cellId).toBe(2);
    expect(players[0].slowCounters).toBe(0);

    room.leave(); board.leave();
  });

  it("slow counters reset on game reset", async () => {
    const roomId = await createRoom(baseUrl, {
      _testDeck: [["green_shell"], ["mushroom"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"], ["coin"]],
    });
    const { room: room1, playerId: id1 } = await connectPlayer(baseUrl, roomId);
    const { room: room2, playerId: id2 } = await connectPlayer(baseUrl, roomId);
    const { room: board } = await connectBoard(baseUrl, roomId);
    room1.send("setReady", true);
    room2.send("setReady", true);
    room1.send("startGame");
    await waitForMessage(room1, "gameState", (g) => g.phase === "playing");
    await waitForMessage(room1, "cardsDrawn");
    await waitForMessage(room2, "cardsDrawn");

    // Give both players slow counters via debug
    board.send("_testSetState", { playerId: id1, slowCounters: 2 });
    board.send("_testSetState", { playerId: id2, slowCounters: 3 });
    await waitForPlayers(board, (ps) =>
      ps.find((p) => p.playerId === id1)?.slowCounters === 2
      && ps.find((p) => p.playerId === id2)?.slowCounters === 3,
    );

    // Force game to finished phase and start over
    board.send("_debugSetGameState", { phase: "finished" });
    await waitForMessage(board, "gameState", (g) => g.phase === "finished");
    room1.send("startOver");
    await waitForMessage(board, "gameState", (g) => g.phase === "lobby");

    const players = await waitForPlayers(board, (ps) =>
      ps.find((p) => p.playerId === id1)?.slowCounters === 0
      && ps.find((p) => p.playerId === id2)?.slowCounters === 0,
    );
    expect(players.find((p) => p.playerId === id1).slowCounters).toBe(0);
    expect(players.find((p) => p.playerId === id2).slowCounters).toBe(0);

    room1.leave(); room2.leave(); board.leave();
  });

  it("slow counters capped at 2", async () => {
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
    const passiveId = activeId === id1 ? id2 : id1;
    const activeCards = activeId === id1 ? cards1 : cards2;

    // Give passive player 2 slow counters (already at max)
    board.send("_testSetState", { playerId: passiveId, slowCounters: 2 });
    await waitForPlayers(board, (ps) => ps.find((p) => p.playerId === passiveId)?.slowCounters === 2);

    // Active plays mushroom to go to cell 2
    const mushroom = activeCards.hand.find((c) => c.items.includes("mushroom"));
    activeRoom.send("playCard", { cardId: mushroom.id });
    await waitForMessage(activeRoom, "cardPlayed");

    // Throw shell backward at passive on cell 1
    const shellCard = activeCards.hand.find((c) => c.items.includes("green_shell"));
    activeRoom.send("playCard", { cardId: shellCard.id });
    await waitForMessage(activeRoom, "cardPlayed", (p) => p.pendingShellChoice === true);
    activeRoom.send("shellChoice", { direction: "backward" });
    await waitForMessage(board, "shellThrown");

    // Passive should still have 2 slow counters (capped, not 3)
    const players = await waitForPlayers(board, (ps) => ps.find((p) => p.playerId === passiveId) != null);
    expect(players.find((p) => p.playerId === passiveId).slowCounters).toBe(2);

    room1.leave(); room2.leave(); board.leave();
  });

});
