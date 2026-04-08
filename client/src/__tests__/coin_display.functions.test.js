import { describe, it, expect } from "vitest";
import { coinDisplayEntries } from "../coin_display.functions.js";

const PERMA = "/permacoin.svg";
const COIN = "/coin.svg";

describe("coinDisplayEntries", () => {
  it("returns nothing when both counts are zero", () => {
    expect(coinDisplayEntries(0, 0)).toEqual([]);
  });

  it("renders coins individually when count is 3 or fewer", () => {
    expect(coinDisplayEntries(3, 0)).toEqual([
      { kind: "icon", src: COIN },
      { kind: "icon", src: COIN },
      { kind: "icon", src: COIN },
    ]);
  });

  it("collapses coins into a group when count is greater than 3", () => {
    expect(coinDisplayEntries(5, 0)).toEqual([
      { kind: "group", src: COIN, count: 5 },
    ]);
  });

  it("collapses permacoins independently", () => {
    expect(coinDisplayEntries(0, 7)).toEqual([
      { kind: "group", src: PERMA, count: 7 },
    ]);
  });

  it("collapses both types when both exceed the threshold", () => {
    expect(coinDisplayEntries(5, 6)).toEqual([
      { kind: "group", src: PERMA, count: 6 },
      { kind: "group", src: COIN, count: 5 },
    ]);
  });

  it("collapses coins even when permacoins are few (regression: mixed display)", () => {
    expect(coinDisplayEntries(5, 1)).toEqual([
      { kind: "icon", src: PERMA },
      { kind: "group", src: COIN, count: 5 },
    ]);
  });

  it("collapses permacoins even when coins are few (regression: mixed display)", () => {
    expect(coinDisplayEntries(2, 10)).toEqual([
      { kind: "group", src: PERMA, count: 10 },
      { kind: "icon", src: COIN },
      { kind: "icon", src: COIN },
    ]);
  });

  it("renders permacoins before coins", () => {
    const entries = coinDisplayEntries(1, 1);
    expect(entries[0].src).toBe(PERMA);
    expect(entries[1].src).toBe(COIN);
  });
});
