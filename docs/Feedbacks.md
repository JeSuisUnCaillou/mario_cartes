# Feedbacks

(with lavo)

Prix des rivières : prix de base + nb joueurs - (rank * 2)

(with indi)
when a cards says 'shell move', animate the shell first then the move. sequentially.

rename "red path" into short path, "blue path" into long path.

OH IDEE : calculer et envoyer au client les positions des cellules forward et backward, pour les afficher au bon endroit dans la modale.

(with vinc & indira)

when choosing forward/backward => illuminate the cell options on the board with the same colors

Automatic end of turn when no option left

Ecrire les règles des items sur le board aussi, à droite
  
choose target on cell with several targets

config game in lobby : nb turns



## OLD

Besoin de plus de single mushroom.
Besoin de plus de cartes à 1 gold.

the double mushroom only advance once. It should advance two cells. Bug pas reproductible.


# DONE

Limiter le nombre de champignons noirs et simplifier la règle ?

the active player shoud have a subtle wobble animation on his avatar on the track.

star should remove slow counters

When a card is discarded and placed on top of the discard pile, it should then disapear (and the discard pile itself will show the last card played on top)

longer vibrate on hit

vibrate the players phone when he becomes active, and color his background in light green. Red bg if waiting player.

DONE Consult deck and discard

-> Prevent both clients to go to sleep, like a youtube video


-> the card zone is too small on mobile, the content overflows -> DONE

-> shouldn't be able to open the buy cards modal (it closes if open) if the player has a pending discard -> DONE

-> one of my players kept being disconnected. RELOU. 
Sometimes, a bug arises for the player client : When 
  he refreshes, he gets the correct game state, but     
  then he has to refresh after each action otherwise    
  he is stuck. For example, he plays a card, the card   
  stays in the play zone. He refreshes, the card has    
  been played correctly -> DONE

-> when you have a pernanent coin, a coin, and a dark mushroom, it overfows from the game board side panel -> DONE
-> A permanent coin is not regenerated, but is kept from a turn to another. They should be spent last. Change the rules. -> DONE

In production, the discard pile is displayed on top of the players hand, it should be below. (I don't have this bug in dev). -> DONE

-> the dark mushroom rule need to be simplified : Now it will prevent the first mushroom played. No more "except the first mushroom of the turn". -> maybe not.

-> In the board remove the special count for permanent coin, use the same display. If the player has only permanent coin, display the blue coin. If he has at least one normal coin, display the yellow coin. -> DONE
