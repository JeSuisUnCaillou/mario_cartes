import { PHASES, LAPS_TO_WIN } from '@mario-cartes/shared';
import { shuffle } from './deck.js';

export function createTurnState(playerIds) {
  return {
    phase: PHASES.WAITING,
    turnOrder: [...playerIds],
    round: 0,
    choices: new Map(), // playerId → card
  };
}

// Sets initial random turn order, moves to PICKING phase.
export function startGame(state) {
  return {
    ...state,
    phase: PHASES.PICKING,
    turnOrder: shuffle(state.turnOrder),
    round: 1,
    choices: new Map(),
  };
}

// Record a player's card choice. Returns updated state.
// If all players have chosen, phase moves to RESOLVING.
export function recordChoice(state, playerId, card, activePlayers) {
  const choices = new Map(state.choices);
  choices.set(playerId, card);

  const allChosen = activePlayers.every((id) => choices.has(id));

  return {
    ...state,
    choices,
    phase: allChosen ? PHASES.RESOLVING : state.phase,
  };
}

// Called after the round has been resolved.
// Rotates turn order (first player moves to end), increments round.
// Moves to GAME_OVER if all players have finished, otherwise back to PICKING.
export function finishResolution(state, players) {
  const [first, ...rest] = state.turnOrder;
  const newOrder = [...rest, first];

  const allFinished = [...players.values()].every((p) => p.laps >= LAPS_TO_WIN);

  return {
    ...state,
    phase: allFinished ? PHASES.GAME_OVER : PHASES.PICKING,
    turnOrder: newOrder,
    round: state.round + 1,
    choices: new Map(),
  };
}
