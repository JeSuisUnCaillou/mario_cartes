# CLAUDE.md

See [README.md](README.md) for the game description, architecture, and rules.

## Project Structure

Monorepo with npm workspaces (`server`, `client`):

- `server/` — Colyseus game server
  - `rooms/GameRoom.js` — main game logic (turns, card play, movement, shells, coins)
  - `rooms/CellGrid.js` — cell occupant data structure (add/remove/query items and players on cells)
  - `rooms/DeckManager.js` — deck creation, shuffle, draw, and card state
  - `rooms/schema.js` — Colyseus state schema (PlayerSchema, GameState, rivers, cell occupants)
  - `rooms/decks.js` — card deck loading from YAML
  - `rooms/ranking.js` — live ranking calculation
  - `rooms/riverRules.js` — rank-based shop access
  - `tests/` — integration tests + `helpers.js`
- `client/src/` — frontend
  - `board.js` — Phaser scene for the shared big screen (track, state sync, layout)
  - `board_avatar.js` — PlayerAvatar game object (helmet sprite, name label, wobble/bob tweens)
  - `board_items.js` — CellItemSprites game object (banana/shell/permacoin sprite management)
  - `board_animations.js` — BoardAnimator (animation queue, shell throw, item hit, visual effects)
  - `player.js` — DOM-based mobile player screen (hand, card play, buy UI)
  - `player_drag.js` — CardDragHandler component (drag-to-play/discard interaction)
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
- **DRY (Don't Repeat Yourself)**: never duplicate logic. If the same value, expression, or block appears more than once, extract it into a constant, function, or shared module. When modifying code, actively look for existing duplication to factorize.
- **Game objects (Phaser canvas)**: encapsulate related sprites, tweens, and state into ES6 classes. Each object owns the lifecycle of its parts (create, animate, destroy). Example: `PlayerAvatar` in `board.js`.
- **Components (DOM UI)**: encapsulate related HTML, CSS, and behavior into ES6 classes. Each component owns its DOM elements and event listeners.

## Design Principles

- **Server is authority**: the client sends player actions (e.g. "play this card"), the server decides all outcomes. The client never decides game logic.
- **State over messages**: drive UI from Colyseus schema state, not one-off event messages. The client must reconstruct the correct UI from the current state alone — essential for page reloads. Do not introduce new message types when a state change already carries the information.
- **Reload-safe**: any screen (board or player) must display the correct state after a page reload at any point during the game.
- **`*.functions.js` pattern**: extract pure game-state functions into `*.functions.js` files alongside UI files. Test those, not visual logic.

## Board Hit Animations

The server broadcasts `itemHitBoard` BEFORE `_syncState()` so the client processes the message before the patch.

### Player walks into a banana or shell

Server side:
1. Move player to new cell (`grid.add`)
2. Detect hazard → `grid.remove(player)` + `grid.replace(item, player)` — player takes the item's slot
3. `broadcast("itemHitBoard")` — message sent BEFORE patch
4. `_syncState()` — patch has player at item's slot, item gone

Client side:
1. Message arrives → `animateItemHit` runs immediately (not queued)
2. `popSprite` shifts the FIRST sprite of that type out of the sprite map (matching server's first-occurrence hazard detection)
3. Sets `avatar._onMoveComplete` callback (or fires immediately if move already finished)
4. Patch arrives → `_syncSprites` sees count matches (we already removed one) → remaining sprites stay in place. `updatePlayers` positions player at the item's former slot
5. Move tween completes → callback fires → sprite destroyed + `avatar.playHitEffect(shellHit)`

### `playHitEffect` (all simultaneous, inside a Container that follows the helmet)
- Helmet rotates twice (-720°, 600ms)
- Hit stars burst outward from helmet
- Dark mushroom rises (shell hits only)
- Container tracks helmet position every frame via scene `update()`
- `_hitTween` guards prevent `_startActiveTweens`/`_stopActiveTweens` from interfering

### Shell thrown at a player
1. Shell sprite travels along waypoints (timeline)
2. On arrival: shell destroyed + `avatar.playHitEffect(true)`

### Shell thrown at a banana or shell (dust cloud)
1. Shell travels to target cell; cell frozen via `_dustCloudCells`
2. On arrival: target sprite + shell destroyed, dust cloud plays
3. After 500ms: cell unfreezes, pending occupants applied, cell reorganizes

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
