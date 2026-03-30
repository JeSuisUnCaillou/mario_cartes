# V0 - Initial pitch

We want to create an online racing card game, with [phaser](https://docs.phaser.io/phaser/getting-started/installation) and a websocket server. The game is heavily inspired from racing games like Mario Cart and deckbuilder games like Slay the Spire 2. It is the implementation of a board game, playable IRL with friends.

The home page needs several screens with different pages :
- a big screen with the board game and what everyone will see
- several phones with the player's cards and controls

For the initial shape, we will keep the game very simple in order to just lay down the basic components needed to iterate.

## How the game works

The home page just presents the game, and has a link "create game", with an input where you can name your game (this will be the game uid).

The board (/game/:uid/board) screen has a racing track, in the shape of a simple loop. The track is separated in cells.

There is a QR code top left of the screen for the players to join with their phones (/game/:uid/player). The players start with a hand of 5 cards. Maximum 8 players.

The starting decks are :
- 4x Go forward 1 cell
- 2x Drop a banana & Go forward 1 cell
- 1x Go forward 2 cells

All player draw 5 cards at random from their deck at the beginning of the game.
There is a starting cell (with a checkered texture). All player's carts start on the starting cell.

The game is rythmed by turns. Each turn has an order (player1, then player2, then player3, ...). Each turn, all players have to select one card in their hand to play. Then the turn order cycles (player 2, then player 3, ... , then player1)

When a cart is played by a plaer, the action of the card is animating on his cart (go forward one or two cell, and eventually dropping a banana), then the card goes to the player's discard pile. Once a player has no cards in hand anymore, he draws 5 new cards. If the draw pile is empty when he tries to draw a card, the discard pile is shuffled into the draw pile before he draws.

If a cart finishes its move on a cell with a banana, its player discards a card (at random).

When a cart has reached the finish line 3 times (it's the same cell as the starting line), this player is ranked first and wins. The game continues until all players has completed the circuit 3 times. Then the game is over and a ranking of the players is displayed, letting them celebrate and roast each other :D.

If several carts reach the finish line on the same turn, they are ex-aequo.

## Technical directions

This is a full JS project.

I want to build this as a web browser game, with [Phaser js](https://github.com/phaserjs/phaser).
The backend will be handled by [Colyseus](https://github.com/colyseus/colyseus)

The game state needs to be described in a data structure in the backend.

We don't persist the data yet, we will handle this in another sprint. No database required.

I want automated tests as much as we can to support the fast growing codebase.

We need to split this V0 in understandable small commits, baby steps.

We will host it on heroku.

# Split the complexity

We will not implement this shape at once, we are going to make several smaller shapes to implement step by step.