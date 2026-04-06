import { describe, it, expect } from "vitest";
const { computeLiveRanks } = require("../rooms/ranking");

// Build a distToFinish map for a simple circular track of N cells
// Cell 1 is finish (dist 0), cell N is dist 1, cell N-1 is dist 2, etc.
function buildLinearDistMap(cellCount) {
  const dist = new Map();
  dist.set(1, 0);
  for (let i = 2; i <= cellCount; i++) {
    dist.set(i, cellCount - i + 1);
  }
  return dist;
}

describe("computeLiveRanks", () => {
  const CELL_COUNT = 14;
  const distToFinish = buildLinearDistMap(CELL_COUNT);
  const maxDistance = CELL_COUNT - 1; // 13

  it("ranks a single player who moved as 1st", () => {
    const players = [
      { playerId: "p1", cellId: 2, lapCount: 1 },
      { playerId: "p2", cellId: 1, lapCount: 0 },
      { playerId: "p3", cellId: 1, lapCount: 0 },
    ];
    const ranks = computeLiveRanks(players, [], distToFinish, maxDistance);
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
    const ranks = computeLiveRanks(players, [], distToFinish, maxDistance);
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
    const ranks = computeLiveRanks(players, [], distToFinish, maxDistance);
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
    const ranks = computeLiveRanks(players, finishedRanks, distToFinish, maxDistance);
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
    const ranks = computeLiveRanks(players, finishedRanks, distToFinish, maxDistance);
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
    const ranks = computeLiveRanks(players, finishedRanks, distToFinish, maxDistance);
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
    const ranks = computeLiveRanks(players, [], distToFinish, maxDistance);
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
    const ranks = computeLiveRanks(players, [], distToFinish, maxDistance);
    expect(ranks.get("p1")).toBe(1);
    expect(ranks.get("p2")).toBe(2);
    expect(ranks.get("p3")).toBe(2);
    expect(ranks.get("p4")).toBe(2);
    expect(ranks.get("p5")).toBe(2);
    expect(ranks.get("p6")).toBe(6);
  });

  it("ranks correctly on branching track", () => {
    // Simulate a branching track: red path (cells 9,10,11) vs blue path (cells 13-17)
    // Both branches lead to cell 12 which is 10 hops from finish
    const branchDist = new Map();
    branchDist.set(1, 0);   // finish
    branchDist.set(22, 1);
    branchDist.set(21, 2);
    branchDist.set(20, 3);
    branchDist.set(19, 4);
    branchDist.set(18, 5);
    branchDist.set(12, 6);
    branchDist.set(11, 7);  // red path, 1 hop to 12
    branchDist.set(10, 8);  // red path
    branchDist.set(9, 9);   // red path, first red cell
    branchDist.set(17, 7);  // blue path, 1 hop to 12
    branchDist.set(16, 8);
    branchDist.set(15, 9);
    branchDist.set(14, 10);
    branchDist.set(13, 11); // blue path, first blue cell
    branchDist.set(8, 10);  // fork cell (min of 9+1, 11+1 = 10)
    branchDist.set(7, 11);
    branchDist.set(6, 12);
    branchDist.set(5, 13);
    branchDist.set(4, 14);
    branchDist.set(3, 15);
    branchDist.set(2, 16);
    const branchMax = 16;

    const players = [
      { playerId: "p1", cellId: 11, lapCount: 1 }, // red path, dist 7
      { playerId: "p2", cellId: 15, lapCount: 1 }, // blue path, dist 9
      { playerId: "p3", cellId: 8, lapCount: 1 },  // at fork, dist 10
    ];
    const ranks = computeLiveRanks(players, [], branchDist, branchMax);
    // p1 closest to finish (dist 7), p2 next (dist 9), p3 furthest (dist 10)
    expect(ranks.get("p1")).toBe(1);
    expect(ranks.get("p2")).toBe(2);
    expect(ranks.get("p3")).toBe(3);
  });
});
