import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  startServer,
  createRoom,
  connectPlayer,
  connectBoard,
  waitForMessage,
  waitForPlayers,
} from "./helpers.js";

const TRACK_1 = "racetrack_1_cells.json";

let baseUrl, cleanup;

beforeAll(async () => {
  ({ baseUrl, cleanup } = await startServer());
});

afterAll(async () => {
  await cleanup();
});

describe("Red shell on branching track", () => {
  it("red shell forward from cell 7 follows red path to hit player on cell 9", async () => {
    const roomId = await createRoom(baseUrl, {
      _testTrack: TRACK_1,
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

    // Place thrower on cell 7, target on red path cell 9
    board.send("_testSetState", { playerId: activeId, cellId: 7 });
    board.send("_testSetState", { playerId: passiveId, cellId: 9 });
    await waitForMessage(board, "cellOccupants", (o) => o[9] && o[9].includes(passiveId));

    const shellCard = activeCards.hand.find((c) => c.items.includes("red_shell"));
    activeRoom.send("playCard", { cardId: shellCard.id });
    await waitForMessage(activeRoom, "cardPlayed", (p) => p.pendingShellChoice === true);

    activeRoom.send("shellChoice", { direction: "forward" });
    const thrown = await waitForMessage(board, "shellThrown");
    expect(thrown.shellType).toBe("red_shell");
    expect(thrown.hit).toBe("player");
    expect(thrown.hitPlayerId).toBe(passiveId);
    expect(thrown.toCellId).toBe(9);
    // Path: 7→8→9 (picks red because player is there)
    expect(thrown.path).toEqual([8, 9]);

    room1.leave();
    room2.leave();
    board.leave();
  });

  it("red shell forward from cell 7 follows blue path when target is only on blue", async () => {
    const roomId = await createRoom(baseUrl, {
      _testTrack: TRACK_1,
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

    // Place thrower on cell 7, target on blue path cell 15
    board.send("_testSetState", { playerId: activeId, cellId: 7 });
    board.send("_testSetState", { playerId: passiveId, cellId: 15 });
    await waitForMessage(board, "cellOccupants", (o) => o[15] && o[15].includes(passiveId));

    const shellCard = activeCards.hand.find((c) => c.items.includes("red_shell"));
    activeRoom.send("playCard", { cardId: shellCard.id });
    await waitForMessage(activeRoom, "cardPlayed", (p) => p.pendingShellChoice === true);

    activeRoom.send("shellChoice", { direction: "forward" });
    const thrown = await waitForMessage(board, "shellThrown");
    expect(thrown.shellType).toBe("red_shell");
    expect(thrown.hit).toBe("player");
    expect(thrown.hitPlayerId).toBe(passiveId);
    expect(thrown.toCellId).toBe(15);
    // Path: 7→8→13→14→15 (picks blue because player is there)
    expect(thrown.path).toEqual([8, 13, 14, 15]);

    room1.leave();
    room2.leave();
    board.leave();
  });

  it("red shell forward at fork with explicit red choice hits player on red path", async () => {
    const roomId = await createRoom(baseUrl, {
      _testTrack: TRACK_1,
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

    // Thrower on fork cell 8, target on red path cell 10
    board.send("_testSetState", { playerId: activeId, cellId: 8 });
    board.send("_testSetState", { playerId: passiveId, cellId: 10 });
    await waitForMessage(board, "cellOccupants", (o) => o[10] && o[10].includes(passiveId));

    const shellCard = activeCards.hand.find((c) => c.items.includes("red_shell"));
    activeRoom.send("playCard", { cardId: shellCard.id });
    await waitForMessage(activeRoom, "cardPlayed", (p) => p.pendingShellChoice === true);

    // At fork: choose red
    activeRoom.send("shellChoice", { direction: "red" });
    const thrown = await waitForMessage(board, "shellThrown");
    expect(thrown.hit).toBe("player");
    expect(thrown.hitPlayerId).toBe(passiveId);
    expect(thrown.toCellId).toBe(10);
    expect(thrown.path).toEqual([9, 10]);

    room1.leave();
    room2.leave();
    board.leave();
  });

  it("red shell backward at merge cell 12 with red choice goes into red branch", async () => {
    const roomId = await createRoom(baseUrl, {
      _testTrack: TRACK_1,
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

    // Thrower on merge cell 12, target on red path cell 9
    board.send("_testSetState", { playerId: activeId, cellId: 12 });
    board.send("_testSetState", { playerId: passiveId, cellId: 9 });
    await waitForMessage(board, "cellOccupants", (o) => o[9] && o[9].includes(passiveId));

    const shellCard = activeCards.hand.find((c) => c.items.includes("red_shell"));
    activeRoom.send("playCard", { cardId: shellCard.id });
    await waitForMessage(activeRoom, "cardPlayed", (p) => p.pendingShellChoice === true);

    // At merge: choose red backward
    activeRoom.send("shellChoice", { direction: "red" });
    const thrown = await waitForMessage(board, "shellThrown");
    expect(thrown.hit).toBe("player");
    expect(thrown.hitPlayerId).toBe(passiveId);
    expect(thrown.toCellId).toBe(9);
    // Path backward: 12→11→10→9
    expect(thrown.path).toEqual([11, 10, 9]);

    room1.leave();
    room2.leave();
    board.leave();
  });

  it("red shell backward at merge cell 12 with blue choice goes into blue branch", async () => {
    const roomId = await createRoom(baseUrl, {
      _testTrack: TRACK_1,
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

    // Thrower on merge cell 12, target on blue path cell 15
    board.send("_testSetState", { playerId: activeId, cellId: 12 });
    board.send("_testSetState", { playerId: passiveId, cellId: 15 });
    await waitForMessage(board, "cellOccupants", (o) => o[15] && o[15].includes(passiveId));

    const shellCard = activeCards.hand.find((c) => c.items.includes("red_shell"));
    activeRoom.send("playCard", { cardId: shellCard.id });
    await waitForMessage(activeRoom, "cardPlayed", (p) => p.pendingShellChoice === true);

    // At merge: choose blue backward
    activeRoom.send("shellChoice", { direction: "blue" });
    const thrown = await waitForMessage(board, "shellThrown");
    expect(thrown.hit).toBe("player");
    expect(thrown.hitPlayerId).toBe(passiveId);
    expect(thrown.toCellId).toBe(15);
    // Path backward: 12→17→16→15
    expect(thrown.path).toEqual([17, 16, 15]);

    room1.leave();
    room2.leave();
    board.leave();
  });
});
