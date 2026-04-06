// Intentionally duplicated in client/src/river.functions.js — keep both in sync.
const PRICE_SCALE_FACTOR = 1;

function getRiverPrice(baseCost, rank, playerCount) {
  return baseCost + (playerCount - rank) * PRICE_SCALE_FACTOR;
}

export { getRiverPrice };
