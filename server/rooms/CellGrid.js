export class CellGrid {
  constructor(cellsData) {
    // Normalize next_cell to always be an array
    for (const cell of cellsData) {
      if (!Array.isArray(cell.next_cell)) cell.next_cell = [cell.next_cell];
    }

    this.cells = new Map(cellsData.map((cell) => [cell.id, cell]));

    // Build reverse adjacency: cellId → array of predecessor ids
    this.prevCells = new Map();
    for (const cell of cellsData) {
      for (const nextId of cell.next_cell) {
        if (!this.prevCells.has(nextId)) this.prevCells.set(nextId, []);
        this.prevCells.get(nextId).push(cell.id);
      }
    }

    this._computeDistances(cellsData);
    this.occupants = {};
  }

  _computeDistances(cellsData) {
    const finishCell = cellsData.find((c) => c.finish_line);
    const finishId = finishCell.id;

    // Build reverse adjacency for BFS
    const reverseAdj = new Map();
    for (const cell of cellsData) {
      for (const nextId of cell.next_cell) {
        if (!reverseAdj.has(nextId)) reverseAdj.set(nextId, []);
        reverseAdj.get(nextId).push(cell.id);
      }
    }

    // BFS backward from finish cell
    this.distToFinish = new Map();
    this.distToFinish.set(finishId, 0);
    const queue = [finishId];
    while (queue.length > 0) {
      const current = queue.shift();
      const preds = reverseAdj.get(current) || [];
      for (const pred of preds) {
        if (!this.distToFinish.has(pred)) {
          this.distToFinish.set(pred, this.distToFinish.get(current) + 1);
          queue.push(pred);
        }
      }
    }

    this.maxDistance = Math.max(...this.distToFinish.values());
  }

  reset() {
    this.occupants = {};
  }

  nextCell(cellId) {
    return this.cells.get(cellId).next_cell[0];
  }

  nextCells(cellId) {
    return this.cells.get(cellId).next_cell;
  }

  previousCell(cellId) {
    const preds = this.prevCells.get(cellId);
    if (!preds || preds.length === 0) return undefined;
    if (preds.length === 1) return preds[0];
    // Pick predecessor closest to finish (shorter path)
    return preds.reduce((best, id) =>
      this.distToFinish.get(id) < this.distToFinish.get(best) ? id : best,
    );
  }

  previousCells(cellId) {
    return this.prevCells.get(cellId) || [];
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
}
