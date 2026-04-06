function computeLiveRanks(players, finishedRanks, distToFinish, maxDistance) {
  const ranks = new Map();

  for (const { playerId, finalRank } of finishedRanks) {
    ranks.set(playerId, finalRank);
  }

  const finishedIds = new Set(finishedRanks.map((f) => f.playerId));
  const lapSize = maxDistance + 1;
  const unfinished = players
    .filter((p) => !finishedIds.has(p.playerId))
    .map((p) => {
      const dist = distToFinish.get(p.cellId);
      const progress = dist === 0 ? 0 : lapSize - dist;
      return {
        playerId: p.playerId,
        score: p.lapCount === 0 ? 0 : (p.lapCount - 1) * lapSize + progress,
      };
    });

  unfinished.sort((a, b) => b.score - a.score);

  let nextRank = finishedRanks.length + 1;
  for (let i = 0; i < unfinished.length; i++) {
    if (i > 0 && unfinished[i].score === unfinished[i - 1].score) {
      ranks.set(unfinished[i].playerId, ranks.get(unfinished[i - 1].playerId));
    } else {
      ranks.set(unfinished[i].playerId, nextRank + i);
    }
  }

  return ranks;
}

export { computeLiveRanks };
