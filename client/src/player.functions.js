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

export function cardItemPositions(itemCount) {
  if (itemCount === 1) return [{ x: "50%", y: "50%" }];
  if (itemCount === 2) return [{ x: "28%", y: "30%" }, { x: "72%", y: "70%" }];
  if (itemCount === 3) return [{ x: "28%", y: "25%" }, { x: "72%", y: "50%" }, { x: "28%", y: "75%" }];
  return [];
}
