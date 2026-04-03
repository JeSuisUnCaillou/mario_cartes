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

describe("Blue shell", () => {
  it("hits rank-1 player and auto-discards their entire hand", async () => {
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
    const activeRoom = activeId === id1 ? room1 : room2;
    const passiveRoom = activeId === id1 ? room2 : room1;
    const passiveId = activeId === id1 ? id2 : id1;
    const activeCards = activeId === id1 ? cards1 : cards2;

    // Move passive ahead so they are rank 1
    board.send("_testSetState", { playerId: passiveId, cellId: 5, lapCount: 1 });
    await waitForMessage(board, "cellOccupants", (o) => o[5] && o[5].includes(passiveId));

    // Play blue shell card
    const shellCard = activeCards.hand.find((c) => c.items.includes("blue_shell"));
    activeRoom.send("playCard", { cardId: shellCard.id });

    // Board should see shellThrown
    const thrown = await waitForMessage(board, "shellThrown");
    expect(thrown.shellType).toBe("blue_shell");
    expect(thrown.hit).toBe("player");
    expect(thrown.hitPlayerId).toBe(passiveId);
    expect(thrown.path.length).toBeGreaterThan(0);
    expect(thrown.path[thrown.path.length - 1]).toBe(5);

    // Passive receives blueShellHit with all card IDs
    const hit = await waitForMessage(passiveRoom, "blueShellHit");
    expect(hit.discardedCardIds.length).toBe(5); // full hand

    // Passive hand is now empty
    const players = await waitForPlayers(board, (ps) => ps.find((p) => p.playerId === passiveId)?.handCount === 0);
    const passive = players.find((p) => p.playerId === passiveId);
    expect(passive.handCount).toBe(0);

    room1.leave(); room2.leave(); board.leave();
  });

  it("hits thrower when thrower is rank 1 (self-hit)", async () => {
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
    const activeRoom = activeId === id1 ? room1 : room2;
    const activeCards = activeId === id1 ? cards1 : cards2;

    // Move active ahead so they are rank 1
    board.send("_testSetState", { playerId: activeId, cellId: 5 });
    await waitForMessage(board, "cellOccupants", (o) => o[5] && o[5].includes(activeId));

    const shellCard = activeCards.hand.find((c) => c.items.includes("blue_shell"));
    activeRoom.send("playCard", { cardId: shellCard.id });

    const thrown = await waitForMessage(board, "shellThrown");
    expect(thrown.hitPlayerId).toBe(activeId);

    // Active receives blueShellHit
    const hit = await waitForMessage(activeRoom, "blueShellHit");
    expect(hit.discardedCardIds.length).toBeGreaterThan(0);

    // Active hand should be empty (played 1 card, rest auto-discarded)
    const players = await waitForPlayers(board, (ps) => ps.find((p) => p.playerId === activeId)?.handCount === 0);
    expect(players.find((p) => p.playerId === activeId).handCount).toBe(0);

    room1.leave(); room2.leave(); board.leave();
  });

  it("does not send blueShellHit when target hand is empty", async () => {
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
    const activeRoom = activeId === id1 ? room1 : room2;
    const passiveRoom = activeId === id1 ? room2 : room1;
    const passiveId = activeId === id1 ? id2 : id1;
    const activeCards = activeId === id1 ? cards1 : cards2;

    // Move passive ahead and remove all cards from hand one by one
    board.send("_testSetState", { playerId: passiveId, cellId: 5, lapCount: 1 });
    await waitForMessage(board, "cellOccupants", (o) => o[5] && o[5].includes(passiveId));
    for (let i = 0; i < 5; i++) {
      board.send("_testSetState", { playerId: passiveId, setHandCard: { index: 0 } });
    }
    await waitForPlayers(board, (ps) => ps.find((p) => p.playerId === passiveId)?.handCount === 0);

    const shellCard = activeCards.hand.find((c) => c.items.includes("blue_shell"));
    activeRoom.send("playCard", { cardId: shellCard.id });

    // shellThrown still broadcast
    const thrown = await waitForMessage(board, "shellThrown");
    expect(thrown.hit).toBe("player");
    expect(thrown.hitPlayerId).toBe(passiveId);

    // No blueShellHit should be sent — give server time, then check buffer
    await new Promise((r) => setTimeout(r, 200));
    const buffered = passiveRoom._messageBuffers["blueShellHit"];
    expect(buffered.length).toBe(0);

    room1.leave(); room2.leave(); board.leave();
  });

  it("does not trigger direction modal (no pendingShellChoice)", async () => {
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
    const activeRoom = activeId === id1 ? room1 : room2;
    const activeCards = activeId === id1 ? cards1 : cards2;

    const shellCard = activeCards.hand.find((c) => c.items.includes("blue_shell"));
    activeRoom.send("playCard", { cardId: shellCard.id });

    // Should get cardPlayed WITHOUT pendingShellChoice
    const played = await waitForMessage(activeRoom, "cardPlayed");
    expect(played.pendingShellChoice).toBeFalsy();

    // shellThrown fires immediately (no need for shellChoice message)
    const thrown = await waitForMessage(board, "shellThrown");
    expect(thrown.shellType).toBe("blue_shell");

    room1.leave(); room2.leave(); board.leave();
  });
});
