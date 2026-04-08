import { describe, it, expect } from "vitest";
const { computeLiveRanks } = require("../rooms/ranking");

// Build a distFromStart map for a simple circular track of N cells.
// Cell 1 is finish (dist 0); forward order is 1 → 2 → 3 → ... → N → 1, so
// cell 2 is dist 1, cell 3 dist 2, ..., cell N dist N-1.
function buildLinearDistFromStart(cellCount) {
  const dist = new Map();
  dist.set(1, 0);
  for (let i = 2; i <= cellCount; i++) {
    dist.set(i, i - 1);
  }
  return dist;
}

describe("computeLiveRanks", () => {
  const CELL_COUNT = 14;
  const distFromStart = buildLinearDistFromStart(CELL_COUNT);
  const maxDistance = CELL_COUNT - 1; // 13

  it("ranks a single player who moved as 1st", () => {
    const players = [
      { playerId: "p1", cellId: 2, lapCount: 1 },
      { playerId: "p2", cellId: 1, lapCount: 0 },
      { playerId: "p3", cellId: 1, lapCount: 0 },
    ];
    const ranks = computeLiveRanks(players, [], distFromStart, maxDistance);
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
    const ranks = computeLiveRanks(players, [], distFromStart, maxDistance);
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
    const ranks = computeLiveRanks(players, [], distFromStart, maxDistance);
    expect(ranks.get("p1")).toBe(1); // lap 2, dist 0 → score 13
    expect(ranks.get("p2")).toBe(2); // lap 1, dist 1 → score 12
  });

  it("assigns finished players their final rank", () => {
    const players = [
      { playerId: "p1", cellId: 1, lapCount: 4 },
      { playerId: "p2", cellId: 5, lapCount: 2 },
      { playerId: "p3", cellId: 3, lapCount: 1 },
    ];
    const finishedRanks = [{ playerId: "p1", finalRank: 1 }];
    const ranks = computeLiveRanks(players, finishedRanks, distFromStart, maxDistance);
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
    const ranks = computeLiveRanks(players, finishedRanks, distFromStart, maxDistance);
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
    const ranks = computeLiveRanks(players, finishedRanks, distFromStart, maxDistance);
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
    const ranks = computeLiveRanks(players, [], distFromStart, maxDistance);
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
    const ranks = computeLiveRanks(players, [], distFromStart, maxDistance);
    expect(ranks.get("p1")).toBe(1);
    expect(ranks.get("p2")).toBe(2);
    expect(ranks.get("p3")).toBe(2);
    expect(ranks.get("p4")).toBe(2);
    expect(ranks.get("p5")).toBe(2);
    expect(ranks.get("p6")).toBe(6);
  });

  it("ranks correctly on branching track — longer branch scores higher", () => {
    // Track layout (forward direction): 1(finish) → 2 → ... → 8 (fork)
    // Red branch:  8 → 9 → 10 → 11 → 12     (3 cells, shorter)
    // Blue branch: 8 → 13 → 14 → 15 → 16 → 17 → 12  (5 cells, longer)
    // Then 12 → 18 → 19 → 20 → 21 → 22 → 1
    // distFromStart = forward BFS from finish (cell 1)
    const branchDist = new Map();
    branchDist.set(1, 0);
    branchDist.set(2, 1);
    branchDist.set(3, 2);
    branchDist.set(4, 3);
    branchDist.set(5, 4);
    branchDist.set(6, 5);
    branchDist.set(7, 6);
    branchDist.set(8, 7);  // fork
    // red branch
    branchDist.set(9, 8);
    branchDist.set(10, 9);
    branchDist.set(11, 10);
    // blue branch
    branchDist.set(13, 8);
    branchDist.set(14, 9);
    branchDist.set(15, 10);
    branchDist.set(16, 11);
    branchDist.set(17, 12);
    // post-merge (BFS reaches 12 first via the shorter red branch)
    branchDist.set(12, 11);
    branchDist.set(18, 12);
    branchDist.set(19, 13);
    branchDist.set(20, 14);
    branchDist.set(21, 15);
    branchDist.set(22, 16);
    const branchMax = 16;

    // p1 took 3 steps into red branch (cell 11, dist 10)
    // p2 took 3 steps into blue branch (cell 15, dist 10) — same step count
    // p3 took 5 steps into blue branch (cell 17, dist 12) — more cells covered
    const players = [
      { playerId: "p1", cellId: 11, lapCount: 1 },
      { playerId: "p2", cellId: 15, lapCount: 1 },
      { playerId: "p3", cellId: 17, lapCount: 1 },
    ];
    const ranks = computeLiveRanks(players, [], branchDist, branchMax);
    // p3 has covered the most ground → 1st; p1 and p2 tied at dist 10
    expect(ranks.get("p3")).toBe(1);
    expect(ranks.get("p1")).toBe(2);
    expect(ranks.get("p2")).toBe(2);
  });
});
