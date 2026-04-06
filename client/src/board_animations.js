export class BoardAnimator {
  constructor(scene, items, avatars, cellPixelPos, tweenCellLayout, applyPendingOccupants) {
    this.scene = scene;
    this.items = items;
    this.avatars = avatars;
    this.cellPixelPos = cellPixelPos;
    this.tweenCellLayout = tweenCellLayout;
    this.applyPendingOccupants = applyPendingOccupants;
    this._queue = [];
    this._processing = false;
  }

  enqueue(entry) {
    this._queue.push(entry);
    while (this._queue.length > 10) {
      this._queue.shift();
    }
    if (!this._processing) {
      this._processNext();
    }
  }

  _processNext() {
    if (this._queue.length === 0) {
      this._processing = false;
      return;
    }
    this._processing = true;
    const entry = this._queue.shift();
    if (entry._shellThrown) {
      const pathLen = entry._shellThrown.path ? entry._shellThrown.path.length : 0;
      const travelTime = pathLen > 1 ? pathLen * 200 : 400;
      this.animateShellThrow(entry._shellThrown);
      this.scene.time.delayedCall(travelTime + 1000, () => this._processNext());
    } else if (entry._permanentCoinPickup) {
      this.animatePermacoinPickup(entry._permanentCoinPickup.cellId);
      this.scene.time.delayedCall(700, () => this._processNext());
    }
  }

  animatePermacoinPickup(cellId) {
    const sprites = this.items.permacoinSprites.get(cellId);
    if (!sprites || sprites.length === 0) return;
    const cellW = this.scene.cellW;
    const jumpHeight = cellW / 3;
    for (const sprite of sprites) {
      const origY = sprite.y;
      sprite.setDepth(10);
      this.scene.tweens.add({
        targets: sprite,
        y: origY - jumpHeight,
        duration: 300,
        ease: "Power2",
        yoyo: true,
        onComplete: () => {
          sprite.setDepth(0);
        },
      });
      this.scene.tweens.add({
        targets: sprite,
        angle: 720,
        duration: 600,
        ease: "Linear",
        onComplete: () => {
          sprite.setAngle(0);
        },
      });
    }
  }

  animateItemHit(playerId, cellId, itemType = "banana", starHit = false) {
    const avatar = this.avatars.get(playerId);
    if (!avatar) return;

    // Remove the hit sprite from the sprite map so sync doesn't destroy it.
    // The patch (arriving after this message) will adjust counts — since we
    // already removed one sprite, the counts will match and remaining sprites
    // stay in place.
    const item = this.items.popSprite(cellId, itemType);

    // Fire hit effect when the move tween completes, or immediately if already arrived
    const onArrive = () => {
      if (starHit) {
        const helmetSize = this.items.helmetSlot * 0.9;
        if (item) {
          this._spawnDustCloud(item.x, item.y, helmetSize);
          item.destroy();
        }
      } else {
        if (item) item.destroy();
        const shellHit = itemType === "green_shell" || itemType === "red_shell";
        avatar.playHitEffect(shellHit);
      }
    };

    if (avatar._moving) {
      avatar._onMoveComplete = onArrive;
    } else {
      onArrive();
    }
  }

  _unfreezeCell(cellId) {
    this.items.unfreezeCell(cellId);
    this.applyPendingOccupants(cellId);
    this.items.sync(this.scene.latestCellOccupants);
    this.tweenCellLayout();
    this.items.repositionPermacoins(this.scene.latestCellOccupants);
  }

  animateShellThrow(data) {
    const from = this.cellPixelPos(data.fromCellId);
    const to = this.cellPixelPos(data.toCellId);
    const itemSize = this.items.helmetSlot * 0.9;
    const textureKey = data.shellType || "green_shell";

    const shell = this.scene.add.image(from.x, from.y, textureKey);
    shell.setScale(itemSize / shell.width);
    shell.setDepth(10);

    if (data.hit === "banana" || data.hit === "green_shell" || data.hit === "red_shell") {
      this.items.freezeCell(data.toCellId);
    }

    if (!data.hit && (textureKey === "green_shell" || textureKey === "red_shell")) {
      const synced = this.items.popSprite(data.toCellId, textureKey);
      if (synced) synced.destroy();
      this.items.registerInflight(data.toCellId, shell);
    }

    const waypoints = data.path && data.path.length > 1
      ? data.path.map((cellId) => this.cellPixelPos(cellId))
      : [to];
    const perCell = waypoints.length > 1 ? 200 : 400;
    const totalTravelTime = waypoints.length * perCell;

    const events = waypoints.map((wp, i) => ({
      at: i * perCell,
      tween: {
        targets: shell,
        x: wp.x,
        y: wp.y,
        duration: perCell,
        ease: "Linear",
      },
    }));

    events.push({
      at: totalTravelTime,
      run: () => {
        if (data.hit === "player") {
          shell.destroy();
          const hitAvatar = this.avatars.get(data.hitPlayerId);
          if (hitAvatar) hitAvatar.playHitEffect(true);
        } else if (data.hit === "banana" || data.hit === "green_shell" || data.hit === "red_shell") {
          const hitItem = this.items.popSprite(data.toCellId, data.hit);
          if (hitItem) {
            this._spawnDustCloud(hitItem.x, hitItem.y, itemSize);
            hitItem.destroy();
          }
          shell.destroy();
          this.scene.time.delayedCall(500, () => {
            this._unfreezeCell(data.toCellId);
          });
        } else if (!data.hit && (textureKey === "green_shell" || textureKey === "red_shell")) {
          shell.setDepth(0);
          this.items.clearInflight(data.toCellId);
          const destMap = this.items.getSpriteMap(textureKey);
          const existing = destMap.get(data.toCellId) || [];
          existing.push(shell);
          destMap.set(data.toCellId, existing);
          this.tweenCellLayout();
        } else {
          shell.destroy();
        }
      },
    });

    this.scene.add.timeline(events).play();
  }

  _spawnDustCloud(x, y, size) {
    const cloud = this.scene.add.image(x, y, "dust_cloud");
    cloud.setScale(size / cloud.width);
    cloud.setDepth(10);
    this.scene.tweens.add({
      targets: cloud,
      scale: cloud.scale * 2,
      duration: 500,
      ease: "Power2",
      onComplete: () => { cloud.destroy(); },
    });
    this.scene.tweens.add({
      targets: cloud,
      alpha: 0,
      duration: 125,
      delay: 375,
    });
  }
}
