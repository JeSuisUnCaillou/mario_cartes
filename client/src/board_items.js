import { itemCounts, permacoinCells } from "./board.functions.js";

export class CellItemSprites {
  constructor(scene, cellPixelPos, cellSlotPos) {
    this.scene = scene;
    this.cellPixelPos = cellPixelPos;
    this.cellSlotPos = cellSlotPos;
    this.bananaSprites = new Map();
    this.shellSprites = new Map();
    this.redShellSprites = new Map();
    this.permacoinSprites = new Map();
    this._inflightShells = new Map();
    this._dustCloudCells = new Set();
  }

  get helmetSlot() { return this.scene.cellW / 4.5; }

  slotOffset(cellId) {
    return permacoinCells.get(cellId) || 0;
  }

  isFrozen(cellId) { return this._dustCloudCells.has(cellId); }
  freezeCell(cellId) { this._dustCloudCells.add(cellId); }
  unfreezeCell(cellId) { this._dustCloudCells.delete(cellId); }
  frozenCellIds() { return this._dustCloudCells; }
  registerInflight(cellId, shell) { this._inflightShells.set(cellId, shell); }
  clearInflight(cellId) { this._inflightShells.delete(cellId); }
  hasInflight(cellId) { return this._inflightShells.has(cellId); }

  createPermacoins() {
    for (const [cellId, count] of permacoinCells) {
      const center = this.cellPixelPos(cellId);
      const sprites = [];
      for (let i = 0; i < count; i++) {
        const sprite = this.scene.add.image(center.x, center.y, "permacoin");
        sprite.setDepth(0);
        sprite.setVisible(false);
        sprites.push(sprite);
      }
      this.permacoinSprites.set(cellId, sprites);
    }
    this.repositionPermacoins(this.scene.latestCellOccupants);
  }

  repositionPermacoins(cellOccupants) {
    const itemSize = this.helmetSlot * 0.7;
    for (const [cellId, sprites] of this.permacoinSprites) {
      if (this.isFrozen(cellId)) continue;
      const occupants = cellOccupants[cellId] || [];
      const coinCount = sprites.length;
      const total = occupants.length + coinCount;
      sprites.forEach((sprite, i) => {
        const { x, y } = this.cellSlotPos(cellId, i, total);
        sprite.setPosition(x, y);
        sprite.setScale(itemSize / sprite.width);
        if (!sprite.visible) sprite.setVisible(true);
      });
    }
  }

  sync(cellOccupants) {
    this._syncSprites(this.bananaSprites, itemCounts(cellOccupants, "banana"), "banana");
    this._syncSprites(this.shellSprites, itemCounts(cellOccupants, "green_shell"), "green_shell");
    this._syncSprites(this.redShellSprites, itemCounts(cellOccupants, "red_shell"), "red_shell");
  }

  _syncSprites(spriteMap, countsByCell, textureKey) {
    for (const [cellId, sprites] of spriteMap) {
      if (this.isFrozen(cellId)) continue;
      if (!countsByCell[cellId]) {
        sprites.forEach((s) => s.destroy());
        spriteMap.delete(cellId);
      }
    }
    for (const [cellId, count] of Object.entries(countsByCell)) {
      const cid = Number(cellId);
      if (this.isFrozen(cid)) continue;
      if ((textureKey === "green_shell" || textureKey === "red_shell") && this.hasInflight(cid)) {
        continue;
      }
      const existing = spriteMap.get(cid) || [];
      while (existing.length > count) {
        existing.pop().destroy();
      }
      while (existing.length < count) {
        const center = this.cellPixelPos(cid);
        const sprite = this.scene.add.image(center.x, center.y, textureKey);
        sprite.setDepth(0);
        existing.push(sprite);
      }
      spriteMap.set(cid, existing);
    }
  }

  _forEachItemSlot(cellOccupants, cellPositions, callback, { skipFrozen = false } = {}) {
    const itemSize = this.helmetSlot * 0.9;

    for (const [cellIdStr, occupants] of Object.entries(cellOccupants)) {
      const cellId = Number(cellIdStr);
      if (!cellPositions[cellId]) continue;
      if (skipFrozen && this.isFrozen(cellId)) continue;
      const bSprites = this.bananaSprites.get(cellId) || [];
      const sSprites = this.shellSprites.get(cellId) || [];
      const rsSprites = this.redShellSprites.get(cellId) || [];
      let bananaIdx = 0;
      let shellIdx = 0;
      let redShellIdx = 0;
      const offset = this.slotOffset(cellId);
      const totalSlots = occupants.length + offset;

      occupants.forEach((entry, slotIndex) => {
        if (entry !== "banana" && entry !== "green_shell" && entry !== "red_shell") return;
        const sprite = entry === "banana" ? bSprites[bananaIdx++]
          : entry === "green_shell" ? sSprites[shellIdx++]
            : rsSprites[redShellIdx++];
        if (!sprite) return;
        const { x, y } = this.cellSlotPos(cellId, slotIndex + offset, totalSlots);
        callback(sprite, x, y, itemSize);
      });
    }
  }

  snapLayout(cellOccupants, cellPositions) {
    this._forEachItemSlot(cellOccupants, cellPositions, (sprite, x, y, itemSize) => {
      sprite.setPosition(x, y);
      sprite.setScale(itemSize / sprite.width);
    });
  }

  tweenLayout(cellOccupants, cellPositions) {
    this._forEachItemSlot(cellOccupants, cellPositions, (sprite, x, y, itemSize) => {
      if (sprite.x !== x || sprite.y !== y) {
        this.scene.tweens.add({ targets: sprite, x, y, duration: 300, ease: "Power2" });
      }
      sprite.setScale(itemSize / sprite.width);
    }, { skipFrozen: true });
  }

  getSpriteMap(itemType) {
    if (itemType === "red_shell") return this.redShellSprites;
    if (itemType === "green_shell") return this.shellSprites;
    return this.bananaSprites;
  }

  popSprite(cellId, itemType) {
    const spriteMap = this.getSpriteMap(itemType);
    const sprites = spriteMap.get(cellId) || [];
    const sprite = sprites.shift();
    if (sprites.length === 0) spriteMap.delete(cellId);
    return sprite;
  }
}
