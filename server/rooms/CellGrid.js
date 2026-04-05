export class CellGrid {
  constructor(cellsData) {
    this.cells = new Map(cellsData.map((cell) => [cell.id, cell]));
    this.prevCell = {};
    for (const cell of cellsData) {
      this.prevCell[cell.next_cell] = cell.id;
    }
    this.occupants = {};
  }

  reset() {
    this.occupants = {};
  }

  getOccupants(cellId) {
    if (!this.occupants[cellId]) this.occupants[cellId] = [];
    return this.occupants[cellId];
  }

  add(cellId, entry) {
    this.getOccupants(cellId).push(entry);
  }

  remove(cellId, entry) {
    const arr = this.getOccupants(cellId);
    const idx = arr.indexOf(entry);
    if (idx !== -1) arr.splice(idx, 1);
    if (arr.length === 0) delete this.occupants[cellId];
  }

  replace(cellId, oldEntry, newEntry) {
    const arr = this.getOccupants(cellId);
    const idx = arr.indexOf(oldEntry);
    if (idx !== -1) {
      arr[idx] = newEntry;
    }
  }

  countItem(cellId, type) {
    return this.getOccupants(cellId).filter((e) => e === type).length;
  }

  countShells(cellId) {
    return this.countItem(cellId, "green_shell") + this.countItem(cellId, "red_shell");
  }

  shellType(cellId) {
    if (this.countItem(cellId, "green_shell") > 0) return "green_shell";
    if (this.countItem(cellId, "red_shell") > 0) return "red_shell";
    return null;
  }

  hazard(cellId) {
    if (this.countItem(cellId, "banana") > 0) return "banana";
    return this.shellType(cellId);
  }

  previousCell(cellId) {
    return this.prevCell[cellId];
  }
}
