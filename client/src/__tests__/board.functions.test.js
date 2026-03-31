import { describe, it, expect } from "vitest";
import { bananaCounts } from "../board.functions.js";

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
