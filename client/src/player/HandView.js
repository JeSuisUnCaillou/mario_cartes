import { CARD_TYPES } from '@mario-cartes/shared';

const CARD_LABELS = {
  [CARD_TYPES.FORWARD_1]: 'Go forward 1',
  [CARD_TYPES.FORWARD_2]: 'Go forward 2',
  [CARD_TYPES.BANANA_FORWARD_1]: 'Banana + forward 1',
};

export class HandView {
  constructor(container, onCardPick) {
    this._container = container;
    this._onCardPick = onCardPick;
    this._disabled = false;
    this._selectedId = null;
  }

  render(hand) {
    this._container.innerHTML = '';
    this._selectedId = null;

    hand.forEach((card) => {
      const btn = document.createElement('button');
      btn.className = 'card-btn';
      btn.textContent = CARD_LABELS[card.type] || card.type;
      btn.dataset.cardId = card.id;

      if (this._disabled) {
        btn.disabled = true;
      } else {
        btn.addEventListener('click', () => this._pick(card));
      }

      this._container.appendChild(btn);
    });
  }

  _pick(card) {
    if (this._disabled) return;
    this._disabled = true;
    this._selectedId = card.id;

    // Visual feedback: mark selected
    this._container.querySelectorAll('.card-btn').forEach((btn) => {
      btn.disabled = true;
      if (btn.dataset.cardId === card.id) {
        btn.style.opacity = '1';
        btn.style.border = '2px solid #2ecc71';
      } else {
        btn.style.opacity = '0.4';
      }
    });

    this._onCardPick(card);
  }

  enable() {
    this._disabled = false;
  }

  disable() {
    this._disabled = true;
    this._container.querySelectorAll('.card-btn').forEach((btn) => {
      btn.disabled = true;
    });
  }
}
