import cellsData from "../../assets/racetrack_0_cells.json";

export const permacoinCells = new Set(cellsData.filter((c) => c.permanent_coin).map((c) => c.id));

export function bananaCounts(cellOccupants) {
  const counts = {};
  for (const [cellIdStr, occupants] of Object.entries(cellOccupants)) {
    const count = occupants.filter((e) => e === "banana").length;
    if (count > 0) counts[Number(cellIdStr)] = count;
  }
  return counts;
}

export function shellCounts(cellOccupants) {
  const counts = {};
  for (const [cellIdStr, occupants] of Object.entries(cellOccupants)) {
    const count = occupants.filter((e) => e === "green_shell").length;
    if (count > 0) counts[Number(cellIdStr)] = count;
  }
  return counts;
}
