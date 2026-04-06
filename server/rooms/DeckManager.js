import { randomUUID } from "crypto";
import { STARTING_DECK, RIVER_DEFS } from "./decks.js";

const RIVER_SLOT_COUNT = 3;
const INITIAL_HAND_SIZE = 5;

export class DeckManager {
  constructor({ testDeck = null, testRiverDecks = null } = {}) {
    this._testDeck = testDeck;
    this._testRiverDecks = testRiverDecks;
  }

  get isTestMode() { return !!this._testDeck; }

  createDeck() {
    if (this._testDeck) {
      return this._testDeck.map((items) => ({ id: randomUUID(), items }));
    }
    const cards = STARTING_DECK.map((items) => ({ id: randomUUID(), items: [...items] }));
    return this.shuffle(cards);
  }

  createRiverDecks() {
    if (this._testRiverDecks) {
      return this._testRiverDecks.map((river, i) => {
        const cards = river.map((items) => ({ id: randomUUID(), items }));
        return {
          id: i,
          cost: RIVER_DEFS[i].cost,
          deck: cards.slice(RIVER_SLOT_COUNT),
          slots: cards.slice(0, RIVER_SLOT_COUNT),
        };
      });
    }
    return RIVER_DEFS.map((river, i) => {
      const cards = this.shuffle(river.cards.map((items) => ({ id: randomUUID(), items: [...items] })));
      return {
        id: i,
        cost: river.cost,
        deck: cards.slice(RIVER_SLOT_COUNT),
        slots: cards.slice(0, RIVER_SLOT_COUNT),
      };
    });
  }

  shuffle(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }

  cardState(player) {
    const dp = player.discardPile;
    return {
      hand: player.hand,
      drawPileDisplay: player.drawPileDisplay,
      discardPile: player.discardPile,
      drawCount: player.drawPile.length,
      discardCount: dp.length,
      discardTopCard: dp.length > 0 ? dp[dp.length - 1] : null,
      pendingDiscard: player.pendingDiscard,
      pendingShellChoice: player.pendingShellChoice,
      pendingShellType: player.pendingShellType,
      pendingPathChoice: player.pendingPathChoice,
      coins: player.coins,
      permanentCoins: player.permanentCoins,
      slowCounters: player.slowCounters,
      deck: [...player.hand, ...player.drawPile, ...player.discardPile],
    };
  }

  drawCards(player) {
    let shuffledCount = 0;
    let needed = INITIAL_HAND_SIZE;
    const drawn = player.drawPile.splice(0, needed);
    const drawnBeforeShuffle = drawn.length;
    const drawnIds = new Set(drawn.map(c => c.id));
    player.drawPileDisplay = player.drawPileDisplay.filter(c => !drawnIds.has(c.id));
    needed -= drawn.length;
    if (needed > 0 && player.discardPile.length > 0) {
      shuffledCount = player.discardPile.length;
      player.drawPile.push(...this.shuffle(player.discardPile.splice(0)));
      player.drawPileDisplay = this.shuffle([...player.drawPile]);
      drawn.push(...player.drawPile.splice(0, needed));
      const newDrawnIds = new Set(drawn.slice(drawnBeforeShuffle).map(c => c.id));
      player.drawPileDisplay = player.drawPileDisplay.filter(c => !newDrawnIds.has(c.id));
    }
    player.hand.push(...drawn);
    return { ...this.cardState(player), shuffledCount, drawnBeforeShuffle };
  }

  initialPlayerDeck() {
    const drawPile = this.createDeck();
    return { drawPile, drawPileDisplay: this.shuffle([...drawPile]) };
  }
}
