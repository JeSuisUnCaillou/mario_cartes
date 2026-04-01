// Starting deck for each player
const STARTING_DECK = [
  ...Array.from({ length: 6 }, () => ["coin"]),
  ["coin", "coin"],
  ["green_shell"],
  ["mushroom"],
];

// River definitions: [items[], ...] per river
// First 3 cards become the initial visible slots, rest form the deck.
const RIVER_DEFS = [
  // River 0 (cost: 1) — single-item cards
  {
    cost: 1,
    cards: [
      ...Array.from({ length: 5 }, () => ["coin"]),
      ...Array.from({ length: 5 }, () => ["mushroom"]),
      ...Array.from({ length: 5 }, () => ["banana"]),
      ...Array.from({ length: 5 }, () => ["green_shell"]),
    ],
  },
  // River 1 (cost: 3) — two-item cards
  {
    cost: 3,
    cards: [
      ["coin", "mushroom"],
      ...Array.from({ length: 4 }, () => ["coin", "banana"]),
      ...Array.from({ length: 2 }, () => ["mushroom", "banana"]),
      ["mushroom", "mushroom"],
      ["green_shell", "mushroom"],
      ["green_shell", "coin"],
      ...Array.from({ length: 16 }, () => ["banana", "banana"]),
    ],
  },
  // River 2 (cost: 5) — three-item cards
  {
    cost: 5,
    cards: [
      ...Array.from({ length: 26 }, () => ["banana", "banana", "banana"]),
      ["banana", "banana", "mushroom"],
      ["banana", "banana", "coin"],
      ["banana", "banana", "green_shell"],
      ["green_shell", "mushroom", "coin"],
      ["coin", "coin", "mushroom"],
      ...Array.from({ length: 4 }, () => ["coin", "coin", "banana"]),
      ["coin", "banana", "banana"],
    ],
  },
];

module.exports = { STARTING_DECK, RIVER_DEFS };
