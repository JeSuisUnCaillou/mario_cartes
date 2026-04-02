export function canBuyFromRiver(rank, riverCount, riverId) {
  if (rank === 0) return true;
  if (rank >= riverCount) return true;
  return riverId < rank;
}
