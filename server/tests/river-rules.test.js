import { describe, it, expect } from "vitest";
const { canBuyFromRiver } = require("../rooms/riverRules");

describe("canBuyFromRiver", () => {
  describe("with 3 rivers", () => {
    const riverCount = 3;

    it("rank 0 (unranked) can buy from all rivers", () => {
      expect(canBuyFromRiver(0, riverCount, 0)).toBe(true);
      expect(canBuyFromRiver(0, riverCount, 1)).toBe(true);
      expect(canBuyFromRiver(0, riverCount, 2)).toBe(true);
    });

    it("rank 1 can only buy from river 0", () => {
      expect(canBuyFromRiver(1, riverCount, 0)).toBe(true);
      expect(canBuyFromRiver(1, riverCount, 1)).toBe(false);
      expect(canBuyFromRiver(1, riverCount, 2)).toBe(false);
    });

    it("rank 2 can buy from rivers 0 and 1", () => {
      expect(canBuyFromRiver(2, riverCount, 0)).toBe(true);
      expect(canBuyFromRiver(2, riverCount, 1)).toBe(true);
      expect(canBuyFromRiver(2, riverCount, 2)).toBe(false);
    });

    it("rank 3 can buy from all rivers", () => {
      expect(canBuyFromRiver(3, riverCount, 0)).toBe(true);
      expect(canBuyFromRiver(3, riverCount, 1)).toBe(true);
      expect(canBuyFromRiver(3, riverCount, 2)).toBe(true);
    });

    it("rank 4+ can buy from all rivers", () => {
      expect(canBuyFromRiver(4, riverCount, 0)).toBe(true);
      expect(canBuyFromRiver(4, riverCount, 1)).toBe(true);
      expect(canBuyFromRiver(4, riverCount, 2)).toBe(true);
    });
  });

  describe("with 4 rivers", () => {
    const riverCount = 4;

    it("rank 1 can only buy from river 0", () => {
      expect(canBuyFromRiver(1, riverCount, 0)).toBe(true);
      expect(canBuyFromRiver(1, riverCount, 1)).toBe(false);
      expect(canBuyFromRiver(1, riverCount, 2)).toBe(false);
      expect(canBuyFromRiver(1, riverCount, 3)).toBe(false);
    });

    it("rank 2 can buy from rivers 0 and 1", () => {
      expect(canBuyFromRiver(2, riverCount, 0)).toBe(true);
      expect(canBuyFromRiver(2, riverCount, 1)).toBe(true);
      expect(canBuyFromRiver(2, riverCount, 2)).toBe(false);
      expect(canBuyFromRiver(2, riverCount, 3)).toBe(false);
    });

    it("rank 3 can buy from rivers 0, 1 and 2", () => {
      expect(canBuyFromRiver(3, riverCount, 0)).toBe(true);
      expect(canBuyFromRiver(3, riverCount, 1)).toBe(true);
      expect(canBuyFromRiver(3, riverCount, 2)).toBe(true);
      expect(canBuyFromRiver(3, riverCount, 3)).toBe(false);
    });

    it("rank 4 can buy from all rivers", () => {
      expect(canBuyFromRiver(4, riverCount, 0)).toBe(true);
      expect(canBuyFromRiver(4, riverCount, 1)).toBe(true);
      expect(canBuyFromRiver(4, riverCount, 2)).toBe(true);
      expect(canBuyFromRiver(4, riverCount, 3)).toBe(true);
    });

    it("rank 5+ can buy from all rivers", () => {
      expect(canBuyFromRiver(5, riverCount, 0)).toBe(true);
      expect(canBuyFromRiver(5, riverCount, 1)).toBe(true);
      expect(canBuyFromRiver(5, riverCount, 2)).toBe(true);
      expect(canBuyFromRiver(5, riverCount, 3)).toBe(true);
    });
  });
});
