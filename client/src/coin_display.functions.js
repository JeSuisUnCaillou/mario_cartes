// Pure function: returns the list of entries to render for a coin display.
// Each entry is either { kind: "group", src, count } when collapsed (count > 3)
// or { kind: "icon", src } repeated `count` times otherwise.
// Permanent coins and regular coins collapse independently.

const COIN_COLLAPSE_THRESHOLD = 3;

function entriesFor(count, src) {
  if (count <= 0) return [];
  if (count > COIN_COLLAPSE_THRESHOLD) return [{ kind: "group", src, count }];
  return Array.from({ length: count }, () => ({ kind: "icon", src }));
}

export function coinDisplayEntries(coins, permanentCoins) {
  return [
    ...entriesFor(permanentCoins, "/permacoin.svg"),
    ...entriesFor(coins, "/coin.svg"),
  ];
}
