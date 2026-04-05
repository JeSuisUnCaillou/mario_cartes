export class PlayerAvatar {
  constructor(scene, x, y, textureKey, name, helmetDisplaySize, alpha = 1) {
    this.scene = scene;
    this.helmet = scene.add.image(x, y, textureKey);
    this.helmet.setScale(helmetDisplaySize / this.helmet.width);
    this.helmet.setAlpha(alpha);
    this.helmet.setDepth(5);

    this.label = scene.add.text(x, y - helmetDisplaySize * 0.7, name || "???", {
      fontFamily: "monospace",
      fontSize: `${Math.round(helmetDisplaySize * 0.45)}px`,
      color: "#ffffff",
      stroke: "#000000",
      strokeThickness: 3,
      align: "center",
    }).setOrigin(0.5, 1);
    this.label.setAlpha(alpha);
    this.label.setDepth(5);

    this.starOverlay = null;
    this.wobbleTween = null;
    this.bobTween = null;
    this._hitTween = null;
    this.active = false;
    this.cellId = null;
  }

  setActive(active) {
    if (active === this.active) return;
    this.active = active;
    if (active) {
      this._startActiveTweens();
    } else {
      this._stopActiveTweens();
    }
  }

  _startActiveTweens() {
    if (this.wobbleTween || this._hitTween) return;
    this.wobbleTween = this.scene.tweens.add({
      targets: this.helmet,
      angle: { from: -1.5, to: 1.5 },
      duration: 150,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
    const bobAmount = this.helmet.displayHeight * 0.06;
    this.bobTween = this.scene.tweens.add({
      targets: this.helmet,
      y: `-=${bobAmount}`,
      duration: 120,
      yoyo: true,
      repeat: -1,
      ease: "Sine.easeInOut",
    });
  }

  _stopActiveTweens() {
    if (this.wobbleTween) {
      this.wobbleTween.stop();
      this.wobbleTween = null;
      if (!this._hitTween) this.helmet.setAngle(0);
    }
    if (this.bobTween) {
      this.bobTween.stop();
      this.bobTween = null;
    }
  }

  playHitEffect(shellHit) {
    this._stopActiveTweens();
    if (this._hitTween) {
      this._hitTween.stop();
      this._hitTween = null;
    }
    if (this._hitContainer) {
      this._hitContainer.destroy();
      this._hitContainer = null;
    }

    const container = this.scene.add.container(this.helmet.x, this.helmet.y);
    container.setDepth(10);
    this._hitContainer = container;

    // Helmet rotation (twice = -720°)
    this.helmet.setAngle(0);
    this._hitTween = this.scene.tweens.add({
      targets: this.helmet,
      angle: { from: 0, to: -720 },
      duration: 600,
      ease: "Linear",
      onComplete: () => {
        this._hitTween = null;
        this.helmet.setAngle(0);
        if (this.active) this._startActiveTweens();
        container.destroy();
        this._hitContainer = null;
      },
    });

    // Hit stars bursting outward
    const size = this.helmet.displayWidth;
    const directions = [180, 135, 45, 0];
    const rotations = [0, 18, 36, 54];
    directions.forEach((dir, i) => {
      const star = this.scene.add.image(0, 0, "hit_star");
      star.setScale(size * 0.4 / star.width);
      star.setAngle(rotations[i]);
      container.add(star);
      const rad = dir * Math.PI / 180;
      this.scene.tweens.add({
        targets: star,
        x: Math.cos(rad) * size,
        y: -Math.sin(rad) * size,
        angle: rotations[i] + 360,
        duration: 400,
        ease: "Power2",
        onComplete: () => { star.destroy(); },
      });
    });

    // Dark mushroom rising (shell hits only)
    if (shellHit) {
      const mush = this.scene.add.image(0, 0, "dark_mushroom");
      mush.setScale(size * 0.5 / mush.width);
      container.add(mush);
      this.scene.tweens.add({
        targets: mush,
        y: -size * 2,
        scale: mush.scale * 2,
        duration: 1000,
        ease: "Power2",
        onComplete: () => { mush.destroy(); },
      });
      this.scene.tweens.add({
        targets: mush,
        alpha: 0,
        duration: 350,
        delay: 650,
      });
    }
  }

  moveTo(x, y, duration) {
    this._stopActiveTweens();
    this._moving = true;
    this.scene.tweens.add({
      targets: this.helmet,
      x, y,
      duration,
      ease: "Power2",
      onComplete: () => {
        this._moving = false;
        if (this._onMoveComplete) {
          const cb = this._onMoveComplete;
          this._onMoveComplete = null;
          cb();
        } else if (this.active) {
          this._startActiveTweens();
        }
      },
    });
  }

  setStarInvincible(enabled, helmetDisplaySize) {
    if (enabled && !this.starOverlay) {
      const baseScale = helmetDisplaySize * 1.1 / this.scene.textures.get("star_overlay").getSourceImage().width;
      const star = this.scene.add.image(this.helmet.x, this.helmet.y - helmetDisplaySize * 0.3, "star_overlay");
      star.setScale(baseScale);
      star.setDepth(6);
      star._baseScale = baseScale;
      this.scene.tweens.add({
        targets: star,
        alpha: { from: 1, to: 0.5 },
        scale: { from: baseScale, to: baseScale * 0.8 },
        duration: 600,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
      this.starOverlay = star;
    } else if (!enabled && this.starOverlay) {
      this.starOverlay.destroy();
      this.starOverlay = null;
    }
  }

  destroy() {
    if (this.wobbleTween) this.wobbleTween.stop();
    if (this.bobTween) this.bobTween.stop();
    if (this.starOverlay) this.starOverlay.destroy();
    this.helmet.destroy();
    this.label.destroy();
  }
}
