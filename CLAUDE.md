# CLAUDE.md

See [README.md](README.md) for the game description, architecture, and rules.

## Project Structure

Monorepo with npm workspaces (`server`, `client`):

- `server/` — Colyseus game server
  - `rooms/GameRoom.js` — main game logic (turns, card play, movement, shells, coins)
  - `rooms/schema.js` — Colyseus state schema (PlayerSchema, GameState, rivers, cell occupants)
  - `rooms/decks.js` — card deck loading from YAML
  - `rooms/ranking.js` — live ranking calculation
  - `rooms/riverRules.js` — rank-based shop access
  - `tests/` — integration tests + `helpers.js`
- `client/src/` — frontend
  - `board.js` — Phaser scene for the shared big screen (track, sprites, animations)
  - `player.js` — DOM-based mobile player screen (hand, card play, buy UI)
  - `*.functions.js` — pure functions extracted alongside UI files (tested independently)
  - `__tests__/` — unit tests for `*.functions.js`
- `assets/` — SVG sprites, `decks.yaml` (card definitions)
- `docs/plans/` — versioned feature plans

## Commands

- `npm run dev` — start both server and client dev servers
- `npm test -w server` — run server tests
- `npm test -w client` — run client tests
- `npm run build` — build client for production

## Code Conventions

- Full JavaScript, ESM everywhere (explicit `.js` extensions in imports)
- No TypeScript, no linter config
- Constants: `UPPER_CASE`. Variables/functions: `camelCase`
- Card definitions live in `assets/decks.yaml`

## Design Principles

- **Server is authority**: the client sends player actions (e.g. "play this card"), the server decides all outcomes. The client never decides game logic.
- **State over messages**: drive UI from Colyseus schema state, not one-off event messages. The client must reconstruct the correct UI from the current state alone — essential for page reloads. Do not introduce new message types when a state change already carries the information.
- **Reload-safe**: any screen (board or player) must display the correct state after a page reload at any point during the game.
- **`*.functions.js` pattern**: extract pure game-state functions into `*.functions.js` files alongside UI files. Test those, not visual logic.

## Testing

- Framework: Vitest
- Server: `server/tests/*.test.js` — integration tests using Colyseus SDK + helpers (`helpers.js`)
- Client: `client/src/__tests__/*.test.js` — unit tests on `*.functions.js` pure functions
- Test game state logic (draw pile counts, hit detection, ranking). Do not test visual-only logic (layout positioning, fan transforms, coordinate conversions, scaling).
- Always run both test suites before committing.

## Commits & Plans

- Small, focused commits — baby steps. Each commit should be understandable on its own.
- Always commit after completing a change. Never leave changes uncommitted. Commit each slice as you go — do not wait until all work is done to commit. This is critical — never end a turn with uncommitted changes.
- The workflow for every slice is: edit → test → commit. Treat commit as part of the test step, not a separate step after reporting results.
- Plans saved and committed in `/docs/plans/` before implementing.
- One commit per slice. Don't cite yourself as the author.
- No `Co-Authored-By` trailer in commits.
- When changing game rules, update both the rules section in `README.md` and the player UI rules in `client/src/player.js`.
