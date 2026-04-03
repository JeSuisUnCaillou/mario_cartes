# Mario Cartes

Online multiplayer racing card game inspired by Mario Kart and deckbuilders like Slay the Spire. It's the digital implementation of a physical board game designed by @lavomancien.

Up to 8 players race around a track, playing cards to move, collect coins, drop bananas, and throw shells. First to complete 3 laps wins.

## How It Works

The game uses a two-screen setup:

- **Board screen** — displayed on a shared TV or laptop. Shows the racing track, player positions, and a QR code for players to join.
- **Player screen** — each player uses their phone. Scan the QR code to join, then play cards, buy from rivers, throw shells, and manage your hand.

One person creates a game, puts the board screen up on a big display, and everyone else joins by scanning the QR code on their phone.

## Tech Stack

- **Phaser.js** — board rendering (track, sprites, animations)
- **Colyseus** — WebSocket game server (real-time state sync)
- **Vite** — build tool and dev server
- **JavaScript** — full stack, no TypeScript
- **Heroku** — hosting

## Getting Started

Requires **Node.js 24+**.

```sh
git clone git@github.com:JeSuisUnCaillou/mario_cartes.git
cd mario_cartes
npm install
npm run dev
```

Open `http://localhost:5173` in your browser. The Vite dev server proxies API and WebSocket requests to the Colyseus server on port 2567.

## Running Tests

```sh
npm test -w server
npm test -w client
```

## Game Rules

### Setup
- Up to 8 players; each starts with the same deck.
- All players draw 5 cards at game start. All players start on cell 1 (finish line).

### Items
Each card contains 1–3 items resolved sequentially from top to bottom:
- **Mushroom**: Move forward 1 cell (subject to dark mushrooms).
- **Coin**: Gain 1 coin until end of turn.
- **Permanent coin**: A permanent coin is kept from turn to turn. Permanent coins are spent last.
- **Banana**: Drop a banana on your cell. Landing on a banana: discard 1 card.
- **Green shell**: Throw to adjacent cell, forward or backward. Gives dark mushrooms to players, or destroys bananas and shells.
- **Red shell**: Forward: travels until it hits something. Backward: one cell only. Same hit effects as green shell.
- **Dark mushroom**: Each cancels one mushroom, except the first mushroom of the turn. Reset at end of turn.

### Turns
- One player is active at a time. The active player can play cards, buy river cards, or end their turn.
- Turn order cycles each round (P1→P2→…→PN, then P2→P3→…→P1, etc.).
- Finished players are skipped.

### Draw & Discard
- When hand is empty after playing a card: draw 5 new cards.
- If draw pile is empty: shuffle discard into draw pile first, then draw.
- At turn end: remaining hand cards are discarded, then draw 5 new cards.

### Rivers (Card Shop)
- 3 rivers with costs of 1, 3, and 5 coins. Each shows 3 buyable cards.
- **Rank-based access** (catch-up mechanic): trailing players can buy from higher-tier rivers.
  - Rank 1: river 1 only. Rank 2: rivers 1–2. Rank 3+: all rivers.
  - The last-place player always has access to all rivers, regardless of player count.
- Bought cards go to discard pile. Slot refills from the river's deck.


### Track

Only one track exists at the moment :
- 14 cells in a rectangular loop. Cell 1 is the start/finish line.
- Cells can contain bananas, shells, and/or multiple player carts.
- Cells 3, 7, 12 award a permanent coin when landed on.

### Banana Penalty
- Landing on a banana: player must discard 1 card from hand.

### Win Condition
- First player to complete 3 laps wins. Game ends when only one player is left.
- Live ranking during play is based on lap count + cell position.
