// Intentionally duplicated in server/rooms/riverRules.js — keep both in sync.
export function canBuyFromRiver(rank, riverCount, riverId, playerCount) {
  if (rank === 0) return true;
  if (rank >= riverCount) return true;
  if (playerCount > 0 && rank >= playerCount) return true;
  return riverId < rank;
}
