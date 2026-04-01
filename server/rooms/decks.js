const fs = require("fs");
const path = require("path");
const yaml = require("js-yaml");

const raw = yaml.load(fs.readFileSync(path.join(__dirname, "../../assets/decks.yaml"), "utf8"));

// Parse "6x coin banana" → 6 copies of ["coin", "banana"]
// Parse "coin banana" → 1 copy of ["coin", "banana"]
function parseCardLines(lines) {
  const cards = [];
  for (const line of lines) {
    const match = line.match(/^(\d+)x\s+(.+)$/);
    const count = match ? Number(match[1]) : 1;
    const items = (match ? match[2] : line).split(/\s+/);
    for (let i = 0; i < count; i++) {
      cards.push([...items]);
    }
  }
  return cards;
}

const STARTING_DECK = parseCardLines(raw.player_starting_deck);

const RIVER_DEFS = [raw.river_1, raw.river_2, raw.river_3].map((river) => ({
  cost: river.cost,
  cards: parseCardLines(river.deck || []),
}));

module.exports = { STARTING_DECK, RIVER_DEFS };
