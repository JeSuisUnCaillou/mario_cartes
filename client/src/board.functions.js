import cellsData from "../../assets/racetrack_0_cells.json";

export const permacoinCells = new Set(cellsData.filter((c) => c.permanent_coin).map((c) => c.id));

export function itemCounts(cellOccupants, itemType) {
  const counts = {};
  for (const [cellIdStr, occupants] of Object.entries(cellOccupants)) {
    const count = occupants.filter((e) => e === itemType).length;
    if (count > 0) counts[Number(cellIdStr)] = count;
  }
  return counts;
}
