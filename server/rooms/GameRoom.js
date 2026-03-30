import colyseus from 'colyseus';
import { PHASES, MAX_PLAYERS, HAND_SIZE } from '@mario-cartes/shared';
import { buildStartingDeck, shuffle, drawCards } from '../game/deck.js';
import { resolveRound } from '../game/rules.js';
import { createTurnState, startGame, recordChoice, finishResolution } from '../game/turnManager.js';

const { Room } = colyseus;

export class GameRoom extends Room {
  onCreate(options) {
    this.maxClients = MAX_PLAYERS + 1; // +1 for board observer

    // Public game state (broadcast to all clients via Colyseus)
    // We use plain setState since we're on Colyseus v0.15 without schema decorators
    this.setState({
      phase: PHASES.WAITING,
      round: 0,
      players: {},       // { [playerId]: { name, position, laps, handSize, finished, finishRank } }
      bananaPositions: [], // array of cell indices
    });

    // Private game state (not exposed via state sync)
    this._turnState = null;
    this._privateState = new Map(); // sessionId → { drawPile, discardPile, hand }
    this._hostSessionId = null;
    this._finishRankCounter = 0;

    // Message handlers
    this.onMessage('start_game', (client) => {
      if (client.sessionId !== this._hostSessionId) return;
      if (this.state.phase !== PHASES.WAITING) return;

      const playerIds = Object.keys(this.state.players);
      if (playerIds.length === 0) return;

      this._turnState = startGame(createTurnState(playerIds));

      this.state.phase = this._turnState.phase;
      this.state.round = this._turnState.round;

      // Send each player their initial hand
      this.clients.forEach((c) => {
        const priv = this._privateState.get(c.sessionId);
        if (priv) {
          this.send(c, 'hand_update', { hand: priv.hand });
        }
      });
    });

    this.onMessage('pick_card', (client, { cardId }) => {
      if (this.state.phase !== PHASES.PICKING) return;

      const priv = this._privateState.get(client.sessionId);
      if (!priv) return;

      const card = priv.hand.find((c) => c.id === cardId);
      if (!card) return;

      const playerId = client.sessionId;
      const activePlayers = Object.keys(this.state.players);

      this._turnState = recordChoice(this._turnState, playerId, card, activePlayers);
      this.state.phase = this._turnState.phase;

      if (this._turnState.phase === PHASES.RESOLVING) {
        this._resolveRound();
      }
    });
  }

  onJoin(client, options) {
    const isBoard = options?.clientType === 'board';

    if (isBoard) {
      if (!this._hostSessionId) this._hostSessionId = client.sessionId;
      return;
    }

    // It's a player joining
    const name = options?.name || `Player ${Object.keys(this.state.players).length + 1}`;
    const deck = shuffle(buildStartingDeck());
    const { drawn, newDrawPile } = drawCards(deck, [], HAND_SIZE);

    this._privateState.set(client.sessionId, {
      hand: drawn,
      drawPile: newDrawPile,
      discardPile: [],
    });

    this.state.players[client.sessionId] = {
      name,
      position: 0,
      laps: 0,
      handSize: drawn.length,
      finished: false,
      finishRank: null,
    };
  }

  onLeave(client) {
    this._privateState.delete(client.sessionId);
    delete this.state.players[client.sessionId];
    if (this._turnState) {
      this._turnState.choices.delete(client.sessionId);
    }
  }

  _resolveRound() {
    // Build players map for rules engine
    const playersForRules = new Map();
    for (const [sessionId, pub] of Object.entries(this.state.players)) {
      const priv = this._privateState.get(sessionId);
      playersForRules.set(sessionId, {
        position: pub.position,
        laps: pub.laps,
        hand: [...priv.hand],
        drawPile: [...priv.drawPile],
        discardPile: [...priv.discardPile],
        finished: pub.finished,
      });
    }

    const bananaSet = new Set(this.state.bananaPositions);
    const { players: updated, bananaPositions: updatedBananas, events } =
      resolveRound(playersForRules, this._turnState.choices, bananaSet, this._turnState.turnOrder);

    // Apply results back
    for (const [sessionId, updPlayer] of updated.entries()) {
      const pub = this.state.players[sessionId];
      const priv = this._privateState.get(sessionId);
      if (!pub || !priv) continue;

      pub.position = updPlayer.position;
      pub.laps = updPlayer.laps;
      priv.hand = updPlayer.hand;
      priv.drawPile = updPlayer.drawPile;
      priv.discardPile = updPlayer.discardPile;

      // Check if player just finished
      if (pub.laps >= 3 && !pub.finished) {
        pub.finished = true;
        this._finishRankCounter += 1;
        pub.finishRank = this._finishRankCounter;
      }

      // Refill hand if empty
      if (priv.hand.length === 0) {
        const { drawn, newDrawPile, newDiscardPile } = drawCards(priv.drawPile, priv.discardPile, HAND_SIZE);
        priv.hand = drawn;
        priv.drawPile = newDrawPile;
        priv.discardPile = newDiscardPile;
      }
      pub.handSize = priv.hand.length;

      // Send updated hand to player
      const playerClient = this.clients.find((c) => c.sessionId === sessionId);
      if (playerClient) {
        this.send(playerClient, 'hand_update', { hand: priv.hand });
      }
    }

    this.state.bananaPositions = [...updatedBananas];

    // Broadcast animation events to board
    this.broadcast('round_events', { events });

    // Advance turn state
    const playersMapForFSM = new Map(
      Object.entries(this.state.players).map(([id, p]) => [id, { laps: p.laps }])
    );
    this._turnState = finishResolution(this._turnState, playersMapForFSM);
    this.state.phase = this._turnState.phase;
    this.state.round = this._turnState.round;
  }
}
