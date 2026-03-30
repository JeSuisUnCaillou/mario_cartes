import colyseus from 'colyseus';
import { PHASES, MAX_PLAYERS, HAND_SIZE } from '@mario-cartes/shared';
import { buildStartingDeck, shuffle, drawCards } from '../game/deck.js';
import { resolveRound } from '../game/rules.js';
import { createTurnState, startGame, recordChoice, finishResolution } from '../game/turnManager.js';

const { Room } = colyseus;

export class GameRoom extends Room {
  onCreate(options) {
    this.maxClients = MAX_PLAYERS + 1; // +1 for board observer

    // Public state — plain object, broadcast manually via messages.
    // (Colyseus v0.15 setState requires @colyseus/schema decorators for sync;
    // we broadcast the full public state as a 'state' message instead.)
    this._pub = {
      phase: PHASES.WAITING,
      round: 0,
      players: {},          // { [sessionId]: { name, position, laps, handSize, finished, finishRank } }
      bananaPositions: [],
    };

    // Private per-player state (never sent in full)
    this._priv = new Map();   // sessionId → { drawPile, discardPile, hand }
    this._turnState = null;
    this._hostSessionId = null;
    this._finishRankCounter = 0;

    this.onMessage('request_state', (client) => {
      this.send(client, 'state', this._pub);
    });

    this.onMessage('start_game', (client) => {
      if (client.sessionId !== this._hostSessionId) return;
      if (this._pub.phase !== PHASES.WAITING) return;

      const playerIds = Object.keys(this._pub.players);
      if (playerIds.length === 0) return;

      this._turnState = startGame(createTurnState(playerIds));
      this._pub.phase = this._turnState.phase;
      this._pub.round = this._turnState.round;
      this._broadcastState();

      // Send each player their initial hand
      this.clients.forEach((c) => {
        const priv = this._priv.get(c.sessionId);
        if (priv) this.send(c, 'hand_update', { hand: priv.hand });
      });
    });

    this.onMessage('pick_card', (client, { cardId }) => {
      if (this._pub.phase !== PHASES.PICKING) return;

      const priv = this._priv.get(client.sessionId);
      if (!priv) return;

      const card = priv.hand.find((c) => c.id === cardId);
      if (!card) return;

      const activePlayers = Object.keys(this._pub.players);
      this._turnState = recordChoice(this._turnState, client.sessionId, card, activePlayers);
      this._pub.phase = this._turnState.phase;
      this._broadcastState();

      if (this._turnState.phase === PHASES.RESOLVING) {
        this._resolveRound();
      }
    });
  }

  onJoin(client, options) {
    const isBoard = options?.clientType === 'board';

    if (isBoard) {
      if (!this._hostSessionId) this._hostSessionId = client.sessionId;
      // Send current state to the board immediately
      this.send(client, 'state', this._pub);
      return;
    }

    // Player joining
    const name = options?.name || `Player ${Object.keys(this._pub.players).length + 1}`;
    const deck = shuffle(buildStartingDeck());
    const { drawn, newDrawPile } = drawCards(deck, [], HAND_SIZE);

    this._priv.set(client.sessionId, {
      hand: drawn,
      drawPile: newDrawPile,
      discardPile: [],
    });

    this._pub.players[client.sessionId] = {
      name,
      position: 0,
      laps: 0,
      handSize: drawn.length,
      finished: false,
      finishRank: null,
    };

    // Send current state to the new player and broadcast update to everyone
    this.send(client, 'state', this._pub);
    this._broadcastState();
  }

  onLeave(client) {
    this._priv.delete(client.sessionId);
    delete this._pub.players[client.sessionId];
    if (this._turnState) this._turnState.choices.delete(client.sessionId);
    this._broadcastState();
  }

  _broadcastState() {
    this.broadcast('state', this._pub);
  }

  _resolveRound() {
    // Build players map for the rules engine
    const playersForRules = new Map();
    for (const [sid, pub] of Object.entries(this._pub.players)) {
      const priv = this._priv.get(sid);
      playersForRules.set(sid, {
        position: pub.position,
        laps: pub.laps,
        hand: [...priv.hand],
        drawPile: [...priv.drawPile],
        discardPile: [...priv.discardPile],
        finished: pub.finished,
      });
    }

    const bananaSet = new Set(this._pub.bananaPositions);
    const { players: updated, bananaPositions: updatedBananas, events } =
      resolveRound(playersForRules, this._turnState.choices, bananaSet, this._turnState.turnOrder);

    // Apply results back
    for (const [sid, updPlayer] of updated.entries()) {
      const pub = this._pub.players[sid];
      const priv = this._priv.get(sid);
      if (!pub || !priv) continue;

      pub.position = updPlayer.position;
      pub.laps = updPlayer.laps;
      priv.hand = updPlayer.hand;
      priv.drawPile = updPlayer.drawPile;
      priv.discardPile = updPlayer.discardPile;

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
      const playerClient = this.clients.find((c) => c.sessionId === sid);
      if (playerClient) this.send(playerClient, 'hand_update', { hand: priv.hand });
    }

    this._pub.bananaPositions = [...updatedBananas];

    // Broadcast animation events to board
    this.broadcast('round_events', { events });

    // Advance turn state
    const playersForFSM = new Map(
      Object.entries(this._pub.players).map(([id, p]) => [id, { laps: p.laps }])
    );
    this._turnState = finishResolution(this._turnState, playersForFSM);
    this._pub.phase = this._turnState.phase;
    this._pub.round = this._turnState.round;
    this._broadcastState();
  }
}
