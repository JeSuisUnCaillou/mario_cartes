# CLAUDE.md

## Project Overview

Online multiplayer racing card game inspired by Mario Kart and Slay the Spire 2. It's the digital implementation of a physical board game.

## Architecture

- **Frontend**: Phaser.js (browser game engine)
- **Backend**: Colyseus (WebSocket game server)
- **Language**: Full JavaScript (no TypeScript required unless chosen)
- **Hosting**: Heroku
- **No database** — game state is in-memory only (persistence is a future sprint)

## Two Screens

- **Board screen** (`/game/:uid/board`): The shared big screen everyone watches. Shows the racing track, player positions, and a QR code (top-left) for players to join.
- **Player screen** (`/game/:uid/player`): Mobile phone view. Shows the player's hand of cards and controls.

## Game Rules Summary

- Up to 8 players; each starts with the same deck:
  - 4x "Go forward 1 cell"
  - 2x "Drop a banana & Go forward 1 cell"
  - 1x "Go forward 2 cells"
- All players draw 5 cards at game start. All carts start on the starting cell (checkered).
- **Turns**: All players pick one card to play simultaneously. Turn order cycles each round (P1→P2→...→PN, then P2→P3→...→P1...).
- When a card is played: animate the cart movement, drop banana if applicable, move card to discard.
- When hand is empty: draw 5 new cards. If draw pile empty: shuffle discard into draw pile first.
- **Banana penalty**: If a cart lands on a banana cell, that player discards a random card.
- **Win condition**: First player to complete 3 laps wins. Game ends when all players finish 3 laps. Ties are allowed (ex-aequo).

## Development Guidelines

- **Commit style**: Small, focused commits — baby steps. Each commit should be understandable on its own.
- **Tests**: Write automated tests as much as possible to support a fast-growing codebase.
- **Game state**: Defined as a data structure on the backend (Colyseus schema).

## Plans

All the plans must be saved in `/docs/plans/` BEFORE implementing.
If the plan has slices, make one commit per slice.
Don't cite yourself as the author in the commits.