import { describe, it, expect } from "vitest";
const { computeLiveRanks } = require("../rooms/ranking");

describe("computeLiveRanks", () => {
  const CELL_COUNT = 14;

  it("ranks a single player who moved as 1st", () => {
    const players = [
      { playerId: "p1", cellId: 2, lapCount: 1 },
      { playerId: "p2", cellId: 1, lapCount: 0 },
      { playerId: "p3", cellId: 1, lapCount: 0 },
    ];
    const ranks = computeLiveRanks(players, [], CELL_COUNT);
    expect(ranks.get("p1")).toBe(1);
    expect(ranks.get("p2")).toBe(2);
    expect(ranks.get("p3")).toBe(2);
  });

  it("handles tied players on same cell and lap", () => {
    const players = [
      { playerId: "p1", cellId: 5, lapCount: 1 },
      { playerId: "p2", cellId: 3, lapCount: 1 },
      { playerId: "p3", cellId: 3, lapCount: 1 },
      { playerId: "p4", cellId: 1, lapCount: 1 },
    ];
    const ranks = computeLiveRanks(players, [], CELL_COUNT);
    expect(ranks.get("p1")).toBe(1);
    expect(ranks.get("p2")).toBe(2);
    expect(ranks.get("p3")).toBe(2);
    expect(ranks.get("p4")).toBe(4);
  });

  it("ranks by lap then cell position", () => {
    const players = [
      { playerId: "p1", cellId: 1, lapCount: 2 },
      { playerId: "p2", cellId: 14, lapCount: 1 },
    ];
    const ranks = computeLiveRanks(players, [], CELL_COUNT);
    expect(ranks.get("p1")).toBe(1); // lap 2 cell 1 = score 14
    expect(ranks.get("p2")).toBe(2); // lap 1 cell 14 = score 13
  });

  it("assigns finished players their final rank", () => {
    const players = [
      { playerId: "p1", cellId: 1, lapCount: 4 },
      { playerId: "p2", cellId: 5, lapCount: 2 },
      { playerId: "p3", cellId: 3, lapCount: 1 },
    ];
    const finishedRanks = [{ playerId: "p1", finalRank: 1 }];
    const ranks = computeLiveRanks(players, finishedRanks, CELL_COUNT);
    expect(ranks.get("p1")).toBe(1);
    expect(ranks.get("p2")).toBe(2);
    expect(ranks.get("p3")).toBe(3);
  });

  it("unfinished ranks start after finished count", () => {
    const players = [
      { playerId: "p1", cellId: 1, lapCount: 4 },
      { playerId: "p2", cellId: 1, lapCount: 4 },
      { playerId: "p3", cellId: 5, lapCount: 2 },
      { playerId: "p4", cellId: 3, lapCount: 1 },
    ];
    const finishedRanks = [
      { playerId: "p1", finalRank: 1 },
      { playerId: "p2", finalRank: 2 },
    ];
    const ranks = computeLiveRanks(players, finishedRanks, CELL_COUNT);
    expect(ranks.get("p1")).toBe(1);
    expect(ranks.get("p2")).toBe(2);
    expect(ranks.get("p3")).toBe(3);
    expect(ranks.get("p4")).toBe(4);
  });

  it("handles mix of finished and tied unfinished", () => {
    const players = [
      { playerId: "p1", cellId: 1, lapCount: 4 },
      { playerId: "p2", cellId: 5, lapCount: 2 },
      { playerId: "p3", cellId: 5, lapCount: 2 },
      { playerId: "p4", cellId: 1, lapCount: 1 },
    ];
    const finishedRanks = [{ playerId: "p1", finalRank: 1 }];
    const ranks = computeLiveRanks(players, finishedRanks, CELL_COUNT);
    expect(ranks.get("p1")).toBe(1);
    expect(ranks.get("p2")).toBe(2);
    expect(ranks.get("p3")).toBe(2);
    expect(ranks.get("p4")).toBe(4);
  });

  it("all players on same cell get same rank", () => {
    const players = [
      { playerId: "p1", cellId: 1, lapCount: 0 },
      { playerId: "p2", cellId: 1, lapCount: 0 },
      { playerId: "p3", cellId: 1, lapCount: 0 },
    ];
    const ranks = computeLiveRanks(players, [], CELL_COUNT);
    expect(ranks.get("p1")).toBe(1);
    expect(ranks.get("p2")).toBe(1);
    expect(ranks.get("p3")).toBe(1);
  });

  it("example from spec: 6 players with ties", () => {
    const players = [
      { playerId: "p1", cellId: 5, lapCount: 1 },
      { playerId: "p2", cellId: 4, lapCount: 1 },
      { playerId: "p3", cellId: 4, lapCount: 1 },
      { playerId: "p4", cellId: 4, lapCount: 1 },
      { playerId: "p5", cellId: 4, lapCount: 1 },
      { playerId: "p6", cellId: 3, lapCount: 1 },
    ];
    const ranks = computeLiveRanks(players, [], CELL_COUNT);
    expect(ranks.get("p1")).toBe(1);
    expect(ranks.get("p2")).toBe(2);
    expect(ranks.get("p3")).toBe(2);
    expect(ranks.get("p4")).toBe(2);
    expect(ranks.get("p5")).toBe(2);
    expect(ranks.get("p6")).toBe(6);
  });
});
