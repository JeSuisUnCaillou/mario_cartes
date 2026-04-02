# Mario Cartes

Online multiplayer racing card game inspired by Mario Kart and Slay the Spire 2. It's the digital implementation of a physical board game. Up to 8 players race karts around a 14-cell track, playing cards to move, collect coins, drop bananas, and throw shells. First to complete 3 laps wins.

## Architecture

- **Frontend**: Phaser.js (browser game engine)
- **Backend**: Colyseus (WebSocket game server)
- **Language**: Full JavaScript (no TypeScript required unless chosen)
- **Hosting**: Heroku
- **No database** — game state is in-memory only (persistence is a future sprint)

## Two Screens

- **Board screen** (`/game/:uid/board`): The shared big screen everyone watches. Shows the racing track, player positions, and a QR code (top-left) for players to join.
- **Player screen** (`/game/:uid/player`): Mobile phone view. Shows the player's hand of cards and controls (play cards, buy from rivers, discard, choose shell direction, end turn).

## Game Rules

### Setup
- Up to 8 players; each starts with the same shuffled 18-card deck:
  - 3× coin + mushroom
  - 5× coin
  - 1× green shell
  - 1× mushroom
  - 1× banana + mushroom
  - (7 unique card templates, some repeated)
- All players draw 5 cards at game start. All carts start on cell 1 (finish line).

### Card Items
Each card contains 1–3 items resolved sequentially:
- **Mushroom**: Move forward 1 cell (subject to slow counters).
- **Coin**: Gain 1 coin (regular, lost at turn end).
- **Banana**: Drop a banana on current cell.
- **Green shell**: Throw to an adjacent cell (player chooses forward or backward). Hits: player → slow counter, banana → both destroyed, shell → both destroyed, nothing → shell stays.
- **Red shell**: Forward — travels entire track until hitting something. Backward — acts like green shell (adjacent only). Same hit priority as green shell.

### Turns
- One player is active at a time. The active player can play cards, buy river cards, or end their turn.
- Turn order cycles each round (P1→P2→…→PN, then P2→P3→…→P1, etc.).
- Finished players are skipped. Disconnected players auto-advance (never skipped).

### Draw & Discard
- When hand is empty after playing a card: draw 5 new cards.
- If draw pile is empty: shuffle discard into draw pile first, then draw.
- At turn end: remaining hand cards are discarded, then draw 5 new cards.

### Rivers (Card Shop)
- 3 rivers with costs of 1, 3, and 5 coins. Each shows 3 buyable cards.
- **Rank-based access** (catch-up mechanic): trailing players can buy from higher-tier rivers.
  - Rank 1: river 1 only. Rank 2: rivers 1–2. Rank 3+: all rivers.
- Bought cards go to discard pile. Slot refills from the river's deck.

### Coins
- **Regular coins** (gold): earned from card items, spent on river cards, lost at turn end.
- **Permanent coins** (blue): collected from special cells (cells 3, 7, 12), never decrease. At turn end, coins reset to the permanent coin total (not zero).

### Slow Counters
- Gained when hit by a shell (green or red) or when landing on a shell.
- Each slow counter cancels one mushroom movement (except the first move of a turn, which always moves).
- Consumed one-at-a-time as mushrooms are played.

### Track
- 14 cells in a rectangular loop. Cell 1 is the start/finish line.
- Cells can contain bananas, shells, and/or multiple player carts.
- Cells 3, 7, 12 award a permanent coin when landed on.

### Banana Penalty
- Landing on a banana: player must discard 1 random card from hand.

### Win Condition
- First player to complete 3 laps wins. Game ends when all players finish. Ties are allowed (ex-aequo).
- Live ranking during play is based on lap count + cell position.
