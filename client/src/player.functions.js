export function isPointInRect(px, py, left, top, right, bottom) {
  return px >= left && px <= right && py >= top && py <= bottom;
}

export function splitDrawBatches(hand, drawnBeforeShuffle) {
  return {
    firstBatch: hand.slice(0, drawnBeforeShuffle),
    secondBatch: hand.slice(drawnBeforeShuffle),
  };
}

export function initialDrawPileCount(drawCount, handLength, shuffledCount, drawnBeforeShuffle) {
  if (shuffledCount > 0) {
    return drawnBeforeShuffle;
  }
  return drawCount + handLength;
}

export function normalizeName(raw) {
  return raw.toUpperCase().replace(/[^A-Z]/g, "");
}
