// Intentionally duplicated in server/rooms/riverRules.js — keep both in sync.
const PRICE_SCALE_FACTOR = 1;

export function getRiverPrice(baseCost, rank, playerCount) {
  return baseCost + (playerCount - rank) * PRICE_SCALE_FACTOR;
}
