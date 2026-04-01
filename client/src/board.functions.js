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
