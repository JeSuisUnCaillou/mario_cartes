export function schemaPlayersToArray(state) {
  const players = [];
  state.players.forEach((p, playerId) => {
    players.push({
      playerId,
      name: p.name,
      color: p.color,
      cellId: p.cellId,
      connected: p.connected,
      handCount: p.handCount,
      ready: p.ready,
      coins: p.coins,
      permanentCoins: p.permanentCoins,
      lapCount: p.lapCount,
      slowCounters: p.slowCounters,
      hasMovedThisTurn: p.hasMovedThisTurn,
      pendingShellChoice: p.pendingShellChoice,
      finished: p.finished,
      rank: p.rank,
    });
  });
  return players;
}

export function schemaCellOccupantsToObject(state) {
  const result = {};
  state.cellOccupants.forEach((co, cellId) => {
    const entries = [];
    co.entries.forEach((e) => entries.push(e));
    if (entries.length > 0) result[cellId] = entries;
  });
  return result;
}

export function schemaToGameState(state) {
  const gs = {
    phase: state.phase,
    currentRound: state.currentRound,
    activePlayerId: state.activePlayerId || null,
  };
  if (state.rivers.length > 0) {
    gs.rivers = [];
    state.rivers.forEach((r) => {
      const slots = [];
      r.slots.forEach((s) => {
        if (s.id) {
          slots.push({ id: s.id, items: JSON.parse(s.items) });
        } else {
          slots.push(null);
        }
      });
      gs.rivers.push({ id: r.id, cost: r.cost, slots, deckCount: r.deckCount });
    });
  }
  if (state.ranking.length > 0) {
    gs.ranking = [];
    state.ranking.forEach((r) => {
      gs.ranking.push({ playerId: r.playerId, name: r.name, finalRank: r.finalRank });
    });
  }
  return gs;
}
