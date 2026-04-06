import { schema } from "@colyseus/schema";

const PlayerSchema = schema({
  name: "string",
  color: "string",
  cellId: "number",
  connected: "boolean",
  handCount: "number",
  ready: "boolean",
  coins: "number",
  permanentCoins: "number",
  lapCount: "number",
  slowCounters: "number",
  pendingShellChoice: "boolean",
  pendingPathChoice: "boolean",
  finished: "boolean",
  rank: "number",
  starInvincible: "boolean",
});

const RankEntrySchema = schema({
  playerId: "string",
  name: "string",
  finalRank: "number",
});

const RiverSlotSchema = schema({
  id: "string",
  items: "string",
});

const RiverSchema = schema({
  id: "number",
  cost: "number",
  deckCount: "number",
  slots: [RiverSlotSchema],
});

const CellOccupantsSchema = schema({
  entries: ["string"],
});

const GameState = schema({
  phase: "string",
  currentRound: "number",
  activePlayerId: "string",
  players: { map: PlayerSchema },
  ranking: [RankEntrySchema],
  rivers: [RiverSchema],
  cellOccupants: { map: CellOccupantsSchema },
});

export {
  PlayerSchema,
  RankEntrySchema,
  RiverSlotSchema,
  RiverSchema,
  CellOccupantsSchema,
  GameState,
};
