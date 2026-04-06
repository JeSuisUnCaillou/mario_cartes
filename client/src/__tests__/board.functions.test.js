import { describe, it, expect } from "vitest";
import { itemCounts, permacoinCells } from "../board.functions.js";

describe("itemCounts", () => {
  it("returns empty object for empty occupants", () => {
    expect(itemCounts({}, "banana")).toEqual({});
  });

  it("returns empty object when no matching items in occupants", () => {
    expect(itemCounts({ 3: ["player1", "player2"], 7: ["player3"] }, "banana")).toEqual({});
  });

  it("counts bananas in a single cell", () => {
    expect(itemCounts({ 5: ["banana", "player1", "banana"] }, "banana")).toEqual({ 5: 2 });
  });

  it("counts bananas across multiple cells", () => {
    expect(itemCounts({
      2: ["banana"],
      5: ["player1", "banana", "banana"],
      9: ["player2"],
    }, "banana")).toEqual({ 2: 1, 5: 2 });
  });

  it("counts green_shell entries", () => {
    expect(itemCounts({ 2: ["green_shell", "player1"], 5: ["banana", "green_shell", "green_shell"] }, "green_shell")).toEqual({ 2: 1, 5: 2 });
  });

  it("counts red_shell entries", () => {
    expect(itemCounts({ 2: ["red_shell", "player1"], 5: ["banana", "red_shell", "green_shell"] }, "red_shell")).toEqual({ 2: 1, 5: 1 });
  });

  it("ignores non-matching items", () => {
    expect(itemCounts({ 3: ["banana", "green_shell", "player1"] }, "red_shell")).toEqual({});
  });
});

describe("permacoinCells", () => {
  it("is a Map of cell IDs to permanent coin counts", () => {
    expect(permacoinCells).toBeInstanceOf(Map);
    expect(permacoinCells.get(4)).toBe(1);
    expect(permacoinCells.get(14)).toBe(1);
    expect(permacoinCells.get(16)).toBe(2);
    expect(permacoinCells.get(21)).toBe(1);
  });

  it("does not include cells without permanent coins", () => {
    expect(permacoinCells.has(1)).toBe(false);
    expect(permacoinCells.has(8)).toBe(false);
    expect(permacoinCells.has(12)).toBe(false);
  });
});
