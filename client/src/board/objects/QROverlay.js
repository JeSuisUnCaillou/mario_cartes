import QRCode from 'qrcode';

export class QROverlay {
  constructor(gameUid) {
    this._container = document.createElement('div');
    this._container.style.cssText = `
      position: fixed;
      top: 12px;
      left: 12px;
      background: white;
      padding: 8px;
      border-radius: 4px;
      z-index: 10;
    `;

    const canvas = document.createElement('canvas');
    this._container.appendChild(canvas);

    const label = document.createElement('div');
    label.textContent = 'Scan to join';
    label.style.cssText = 'text-align:center;font-size:11px;color:#333;margin-top:4px;';
    this._container.appendChild(label);

    document.body.appendChild(this._container);

    const playerUrl = `${window.location.origin}/game/${gameUid}/player`;
    QRCode.toCanvas(canvas, playerUrl, { width: 100 }).catch(console.error);
  }

  hide() {
    this._container.style.display = 'none';
  }

  destroy() {
    this._container.remove();
  }
}
