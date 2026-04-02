import { describe, it, expect } from "vitest";
import { bananaCounts, shellCounts, permacoinCells } from "../board.functions.js";

describe("bananaCounts", () => {
  it("returns empty object for empty occupants", () => {
    expect(bananaCounts({})).toEqual({});
  });

  it("returns empty object when no bananas in occupants", () => {
    expect(bananaCounts({ 3: ["player1", "player2"], 7: ["player3"] })).toEqual({});
  });

  it("counts bananas in a single cell", () => {
    expect(bananaCounts({ 5: ["banana", "player1", "banana"] })).toEqual({ 5: 2 });
  });

  it("counts bananas across multiple cells", () => {
    expect(bananaCounts({
      2: ["banana"],
      5: ["player1", "banana", "banana"],
      9: ["player2"],
    })).toEqual({ 2: 1, 5: 2 });
  });

  it("handles cell with only bananas", () => {
    expect(bananaCounts({ 4: ["banana", "banana", "banana"] })).toEqual({ 4: 3 });
  });
});

describe("shellCounts", () => {
  it("returns empty object for empty occupants", () => {
    expect(shellCounts({})).toEqual({});
  });

  it("counts green_shell entries", () => {
    expect(shellCounts({ 2: ["green_shell", "player1"], 5: ["banana", "green_shell", "green_shell"] })).toEqual({ 2: 1, 5: 2 });
  });

  it("ignores bananas and players", () => {
    expect(shellCounts({ 3: ["banana", "player1"] })).toEqual({});
  });
});

describe("permacoinCells", () => {
  it("is a Set of cell IDs with permanent coins", () => {
    expect(permacoinCells).toBeInstanceOf(Set);
    expect(permacoinCells.has(3)).toBe(true);
    expect(permacoinCells.has(7)).toBe(true);
    expect(permacoinCells.has(12)).toBe(true);
  });

  it("does not include cells without permanent coins", () => {
    expect(permacoinCells.has(1)).toBe(false);
    expect(permacoinCells.has(2)).toBe(false);
    expect(permacoinCells.has(4)).toBe(false);
  });
});
