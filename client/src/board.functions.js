import trackData from "../../assets/racetrack_1_cells.json";

const { svg_width, svg_height, cells: cellsData } = trackData;

export const SVG_ASPECT = svg_width / svg_height;

// Compute cell positions as fractional coordinates within the SVG viewBox (1-indexed, index 0 is null)
export const CELL_POSITIONS = [null, ...cellsData.map((c) => [c.center_position.x / svg_width, c.center_position.y / svg_height])];

export const permacoinCells = new Set(cellsData.filter((c) => c.permanent_coin).map((c) => c.id));

export function itemCounts(cellOccupants, itemType) {
  const counts = {};
  for (const [cellIdStr, occupants] of Object.entries(cellOccupants)) {
    const count = occupants.filter((e) => e === itemType).length;
    if (count > 0) counts[Number(cellIdStr)] = count;
  }
  return counts;
}
