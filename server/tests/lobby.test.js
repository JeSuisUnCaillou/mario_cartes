import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  startServer,
  createRoom,
  connectPlayer,
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
