import { describe, it, expect } from "vitest";
const { getRiverPrice } = require("../rooms/riverRules");

describe("getRiverPrice", () => {
  it("last place pays base price", () => {
    expect(getRiverPrice(3, 4, 4)).toBe(3);
  });

  it("first place pays base + (playerCount - 1)", () => {
    expect(getRiverPrice(3, 1, 4)).toBe(6);
  });

  it("middle rank pays proportional surcharge", () => {
    expect(getRiverPrice(3, 2, 4)).toBe(5);
    expect(getRiverPrice(3, 3, 4)).toBe(4);
  });

  it("works with 2 players", () => {
    expect(getRiverPrice(1, 1, 2)).toBe(2);
    expect(getRiverPrice(1, 2, 2)).toBe(1);
  });

  it("works with different base costs", () => {
    expect(getRiverPrice(1, 1, 3)).toBe(3);
    expect(getRiverPrice(5, 1, 3)).toBe(7);
    expect(getRiverPrice(8, 3, 3)).toBe(8);
  });
});
