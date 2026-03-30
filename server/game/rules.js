import { CARD_TYPES } from '@mario-cartes/shared';
import { advancePosition, crossedFinishLine, TRACK } from './track.js';

// Pure function: resolves one round of card plays.
//
// players: Map<playerId, { position, laps, hand, drawPile, discardPile, finished, finishRank }>
// cardChoices: Map<playerId, card>
// bananaPositions: Set<cellIndex>
// turnOrder: Array<playerId> — the order in which players resolve this round
//
// Returns { players (updated), bananaPositions (updated), events[] }
// events are consumed by the client animation queue.
export function resolveRound(players, cardChoices, bananaPositions, turnOrder) {
  // Deep-clone to avoid mutation of inputs
  const updatedPlayers = new Map(
    [...players.entries()].map(([id, p]) => [id, { ...p, hand: [...p.hand], drawPile: [...p.drawPile], discardPile: [...p.discardPile] }])
  );
  const updatedBananas = new Set(bananaPositions);
  const events = [];

  for (const playerId of turnOrder) {
    const player = updatedPlayers.get(playerId);
    if (!player || player.finished) continue;

    const card = cardChoices.get(playerId);
    if (!card) continue;

    const steps = card.type === CARD_TYPES.FORWARD_2 ? 2 : 1;
    const dropsBanana = card.type === CARD_TYPES.BANANA_FORWARD_1;

    const from = player.position;
    const to = advancePosition(from, steps);

    // Move the cart
    player.position = to;
    events.push({ type: 'MOVE', playerId, from, to });

    // Drop banana at landing cell (before checking existing bananas)
    if (dropsBanana) {
      updatedBananas.add(to);
      events.push({ type: 'BANANA_PLACED', playerId, cell: to });
    }

    // Check if landing on a banana (banana dropped by another player OR an earlier one)
    if (updatedBananas.has(to) && !dropsBanana) {
      // Discard a random card from hand, excluding the card being played
      const candidates = player.hand.filter((c) => c.id !== card.id);
      if (candidates.length > 0) {
        const picked = candidates[Math.floor(Math.random() * candidates.length)];
        const idx = player.hand.findIndex((c) => c.id === picked.id);
        player.hand.splice(idx, 1);
        player.discardPile.push(picked);
        events.push({ type: 'BANANA_HIT', playerId, discardedCard: picked });
      }
      // Remove the banana (consumed)
      updatedBananas.delete(to);
    }

    // Move played card to discard
    const cardIdx = player.hand.findIndex((c) => c.id === card.id);
    if (cardIdx !== -1) player.hand.splice(cardIdx, 1);
    player.discardPile.push(card);

    // Detect lap completion
    if (crossedFinishLine(from, steps)) {
      player.laps += 1;
      events.push({ type: 'LAP_COMPLETED', playerId, laps: player.laps });
    }
  }

  return { players: updatedPlayers, bananaPositions: updatedBananas, events };
}
