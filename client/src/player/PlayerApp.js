import { HandView } from './HandView.js';
import { StatusView } from './StatusView.js';
import { PHASES } from '@mario-cartes/shared';

export class PlayerApp {
  constructor(appEl, room) {
    this._room = room;
    this._hand = [];

    appEl.innerHTML = `
      <div id="player-ui" style="max-width:420px;margin:0 auto;padding:1rem;">
        <div id="status"></div>
        <div id="hand" style="display:flex;flex-direction:column;gap:0.5rem;margin-top:1rem;"></div>
      </div>
    `;

    this._statusView = new StatusView(document.getElementById('status'));
    this._handView = new HandView(document.getElementById('hand'), (card) => {
      this._room.send('pick_card', { cardId: card.id });
    });

    room.onMessage('hand_update', ({ hand }) => {
      this._hand = hand;
      this._handView.enable();
      this._handView.render(hand);
    });

    room.onStateChange((state) => {
      this._statusView.render(state, room.sessionId);

      if (state.phase === PHASES.PICKING) {
        this._handView.enable();
      } else if (state.phase === PHASES.RESOLVING) {
        this._handView.disable();
      }
    });
  }
}
