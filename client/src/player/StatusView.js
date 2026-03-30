import { PHASES } from '@mario-cartes/shared';

export class StatusView {
  constructor(container) {
    this._container = container;
  }

  render(state, mySessionId) {
    const player = state.players?.[mySessionId];
    const laps = player?.laps ?? 0;
    const finished = player?.finished ?? false;

    let phaseText = '';
    switch (state.phase) {
      case PHASES.WAITING:
        phaseText = 'Waiting for game to start...';
        break;
      case PHASES.PICKING:
        phaseText = 'Pick a card!';
        break;
      case PHASES.RESOLVING:
        phaseText = 'Waiting for others...';
        break;
      case PHASES.GAME_OVER:
        phaseText = finished ? 'You finished! 🏁' : 'Game over!';
        break;
    }

    this._container.innerHTML = `
      <div class="status-lap">Lap: ${laps} / 3</div>
      <div class="status-round">Round: ${state.round || 0}</div>
      <div class="status-phase">${phaseText}</div>
    `;
  }
}
