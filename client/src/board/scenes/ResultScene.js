import Phaser from 'phaser';

export class ResultScene extends Phaser.Scene {
  constructor() {
    super({ key: 'ResultScene' });
  }

  init(data) {
    this._room = data.room;
    this._players = data.players || {};
  }

  create() {
    const { width, height } = this.scale;

    this.add.text(width / 2, 60, 'Race Over!', {
      fontSize: '36px',
      color: '#ffff00',
      fontStyle: 'bold',
    }).setOrigin(0.5);

    // Build sorted ranking
    const ranked = Object.entries(this._players)
      .map(([id, p]) => ({ id, ...p }))
      .sort((a, b) => {
        if (a.finishRank !== null && b.finishRank !== null) return a.finishRank - b.finishRank;
        if (a.finishRank !== null) return -1;
        if (b.finishRank !== null) return 1;
        return b.laps - a.laps;
      });

    ranked.forEach((p, idx) => {
      const isTied = idx > 0 && ranked[idx - 1].finishRank === p.finishRank && p.finishRank !== null;
      const rank = isTied ? `=${idx}` : `${idx + 1}`;
      const line = `${rank}. ${p.name}  (${p.laps} laps)`;
      this.add.text(width / 2, 140 + idx * 36, line, {
        fontSize: '20px',
        color: idx === 0 ? '#f1c40f' : '#ffffff',
      }).setOrigin(0.5);
    });

    // Play again button
    const btn = this.add
      .text(width / 2, height - 60, '[ Play Again ]', {
        fontSize: '18px',
        color: '#aaffaa',
      })
      .setOrigin(0.5)
      .setInteractive({ useHandCursor: true });

    btn.on('pointerup', () => {
      window.location.reload();
    });
  }
}
