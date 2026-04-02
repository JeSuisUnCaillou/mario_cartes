const { Schema, defineTypes, MapSchema, ArraySchema } = require("@colyseus/schema");

class PlayerSchema extends Schema {}
defineTypes(PlayerSchema, {
  name: "string",
  cellId: "number",
  connected: "boolean",
  handCount: "number",
  ready: "boolean",
  coins: "number",
  permanentCoins: "number",
  lapCount: "number",
  pendingShellChoice: "boolean",
  finished: "boolean",
  rank: "number",
});

class RankEntrySchema extends Schema {}
defineTypes(RankEntrySchema, {
  playerId: "string",
  name: "string",
  finalRank: "number",
});

class RiverSlotSchema extends Schema {}
defineTypes(RiverSlotSchema, {
  id: "string",
  items: "string",
});

class RiverSchema extends Schema {}
defineTypes(RiverSchema, {
  id: "number",
  cost: "number",
  deckCount: "number",
  slots: [RiverSlotSchema],
});

class CellOccupantsSchema extends Schema {}
defineTypes(CellOccupantsSchema, {
  entries: ["string"],
});

class GameState extends Schema {}
defineTypes(GameState, {
  phase: "string",
  currentRound: "number",
  activePlayerId: "string",
  players: { map: PlayerSchema },
  ranking: [RankEntrySchema],
  rivers: [RiverSchema],
  cellOccupants: { map: CellOccupantsSchema },
});

module.exports = {
  PlayerSchema,
  RankEntrySchema,
  RiverSlotSchema,
  RiverSchema,
  CellOccupantsSchema,
  GameState,
};
