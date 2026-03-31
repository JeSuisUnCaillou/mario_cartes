import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { startServer, createRoom } from "./helpers.js";

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
