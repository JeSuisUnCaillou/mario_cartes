import { describe, it, expect } from "vitest";
import {
  isPointInRect,
  splitDrawBatches,
  initialDrawPileCount,
  normalizeName,
  cardItemPositions,
} from "../player.functions.js";

describe("isPointInRect", () => {
  const rect = { left: 10, top: 20, right: 110, bottom: 80 };

  it("returns true when point is inside", () => {
    expect(isPointInRect(50, 50, rect.left, rect.top, rect.right, rect.bottom)).toBe(true);
  });

  it("returns true when point is on the edge", () => {
    expect(isPointInRect(10, 20, rect.left, rect.top, rect.right, rect.bottom)).toBe(true);
    expect(isPointInRect(110, 80, rect.left, rect.top, rect.right, rect.bottom)).toBe(true);
  });

  it("returns false when point is outside left", () => {
    expect(isPointInRect(9, 50, rect.left, rect.top, rect.right, rect.bottom)).toBe(false);
  });

  it("returns false when point is outside right", () => {
    expect(isPointInRect(111, 50, rect.left, rect.top, rect.right, rect.bottom)).toBe(false);
  });

  it("returns false when point is above", () => {
    expect(isPointInRect(50, 19, rect.left, rect.top, rect.right, rect.bottom)).toBe(false);
  });

  it("returns false when point is below", () => {
    expect(isPointInRect(50, 81, rect.left, rect.top, rect.right, rect.bottom)).toBe(false);
  });
});

describe("splitDrawBatches", () => {
  const hand = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }, { id: "e" }];

  it("puts all cards in secondBatch when drawnBeforeShuffle is 0", () => {
    const { firstBatch, secondBatch } = splitDrawBatches(hand, 0);
    expect(firstBatch).toEqual([]);
    expect(secondBatch).toEqual(hand);
  });

  it("puts all cards in firstBatch when drawnBeforeShuffle equals hand length", () => {
    const { firstBatch, secondBatch } = splitDrawBatches(hand, 5);
    expect(firstBatch).toEqual(hand);
    expect(secondBatch).toEqual([]);
  });

  it("splits in the middle", () => {
    const { firstBatch, secondBatch } = splitDrawBatches(hand, 2);
    expect(firstBatch).toEqual([{ id: "a" }, { id: "b" }]);
    expect(secondBatch).toEqual([{ id: "c" }, { id: "d" }, { id: "e" }]);
  });

  it("handles empty hand", () => {
    const { firstBatch, secondBatch } = splitDrawBatches([], 0);
    expect(firstBatch).toEqual([]);
    expect(secondBatch).toEqual([]);
  });
});

describe("initialDrawPileCount", () => {
  it("returns drawnBeforeShuffle when shuffle happened", () => {
    expect(initialDrawPileCount(3, 5, 4, 2)).toBe(2);
  });

  it("returns drawCount + handLength when no shuffle", () => {
    expect(initialDrawPileCount(3, 5, 0, 5)).toBe(8);
  });
});

describe("normalizeName", () => {
  it("converts lowercase to uppercase", () => {
    expect(normalizeName("abc")).toBe("ABC");
  });

  it("strips digits", () => {
    expect(normalizeName("a1b")).toBe("AB");
  });

  it("strips special characters", () => {
    expect(normalizeName("a!@b")).toBe("AB");
  });

  it("keeps already uppercase letters", () => {
    expect(normalizeName("XYZ")).toBe("XYZ");
  });

  it("returns empty string for empty input", () => {
    expect(normalizeName("")).toBe("");
  });

  it("returns empty string for all-digit input", () => {
    expect(normalizeName("123")).toBe("");
  });
});

describe("cardItemPositions", () => {
  it("returns empty array for 0 items", () => {
    expect(cardItemPositions(0)).toEqual([]);
  });

  it("returns centered position for 1 item", () => {
    const positions = cardItemPositions(1);
    expect(positions).toEqual([{ x: "50%", y: "50%" }]);
  });

  it("returns top-left and bottom-right for 2 items", () => {
    const positions = cardItemPositions(2);
    expect(positions).toHaveLength(2);
    expect(positions[0]).toEqual({ x: "28%", y: "30%" });
    expect(positions[1]).toEqual({ x: "72%", y: "70%" });
  });

  it("returns top-left, middle-right, bottom-left for 3 items", () => {
    const positions = cardItemPositions(3);
    expect(positions).toHaveLength(3);
    expect(positions[0]).toEqual({ x: "28%", y: "25%" });
    expect(positions[1]).toEqual({ x: "72%", y: "50%" });
    expect(positions[2]).toEqual({ x: "28%", y: "75%" });
  });
});
