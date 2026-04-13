# Un jeu vidéo en une semaine, sans regarder le code

Durant ma semaine de vacances, j'ai eu envie de fabriquer un jeu pour monter en compétences, comme j'ai pu le faire par le passé avec [Spaceball.fr](https://www.spaceball.fr/) ou [Idle Please](https://www.caillou.ninja/idle_please).

J'ai donc demandé à un pote qui designe des jeux de plateau pour le plaisir si il avait pas un concept de jeu que je pourrais implémenter. Une semaine plus tard, [Mario Cartes](https://mario-cartes-553e5e88a07e.herokuapp.com/) est né.

# Le setup

- [agent-vm](https://github.com/sylvinus/agent-vm) qui est super bien pour faire tourner claude code en mode YOLO dans un environnement restreint.

- Le plus gros abonnement de Claude code 180€/mois.

- Claude Code sans addons ni skills particuliers.

- [Colyseus](https://github.com/colyseus/colyseus) pour le backend et [Phaser](https://github.com/phaserjs/phaser) pour le front.


# Ce que j'ai appris

## Première tentative : Tout faire d'un coup (sénule)

Je savais que `/plan` permettait de mieux cadrer l'implem, mais je pense que je surestimais un peu trop ses capacités.

J'ai tenté de décrire le jeu d'un seul coup à claude dans un `/plan`, puis de lui faire implémenter direct. Je lui ait fait un asset de circuit un asset de joueur, et un asset de banane.

C'était de la merde. Rien de salvageable.


## Deuxième tentative : Comme si je codais moi-même

Je reprend le truc à la base. Comment je ferait si c'était moi qui codait ?

Etape 1, mettre en place la communication server-client avec un bouton "Ping".
Etape 2: Afficher le circuit et placer les clients de joueurs connectés.
Etape 3: Faire avancer un joueur sur le circuit quand il clique sur le bouton "Ping".
etc...

Et ça marche de ouf ! A chaque étape :
- `/clear` pour reset le contexte
- je pitch ma feature dans un `/plan`
- j'itère rapidement sur le plan proposé
- je le lance dans l'implémentation
- je fait une phase de feedbacks où je le fait itérer sur des détails.

Chaque étape me prend quelques minutes (genre 15-20min à vue de nez, j'ai pas chronométré) et en 1 jour j'ai ma base :
- un circuit avec des joueurs qui avancent
- un client mobile avec le jeu de cartes animées
- un game state persistent (je peux reload ma page)


## Itérer sur le CLAUDE.md

Dès le début, j'ai mis dans le CLAUDE.md qu'il doit faire ses commits tout seul, à chaque slice du plan implémenté, et à chaque fix qu'il fait.

Rapidement j'ai du ajouter l'instruction de faire passer les infos du back au front via le game state, plutôt que via plein d'évènements isolés, pour garantir que le jeu reste consistent si on reload un page.

Et tout au long de la semaine, dès qu'il faisait 2 fois un truc qui ne me plaisait pas, je lui disait d'inscrire une nouvelle instruction dans CLAUDE.md pour éviter de récidiver.


### CLAUDE.md vs README.md

Il arrivait parfois qu'il ne respecte plus certains instructions que je lui ait donné dans le CLAUDE.md. Je pense que le fichier était trop gros à un moment, diluant l'importance de certains instruction.

Je lui avait fait générer une description du jeu dans le CLAUDE.md,  à partir de mon pitch initial. Mais finalement, j'ai fini par déplacer ça dans le README.md. 

Et en même temps, c'est logique -> Tout ce qui est aussi valable pour les humains, dans le README.md, et tout ce qui est instructions spécifiques pour claude dans le CLAUDE.md. La description du jeu n'est pas exclusivement destinée à Claude.


## Je stocke tous mes pitchs et je lui fait stocker tous ses plans.

Je voulais garder une trace de mes pitchs, et des plans qu'il génère.

Donc au lieu d'écrire mes pitchs dans claude code, je les mettais dans [/docs/shaping/](/docs/shaping/). Et je lui ai dit dans CLAUDE.md d'écrire ses plans dans [/docs/plans/](/docs/plans/).

Même mes feedbacks, je les écrivait dans une section `Feedbacks` à la fin de mes docs de shaping pour avoir une trace, sinon c'était dur de me souvenir de tout ce que j'ai pu lui demander. Quand il y avait pleins de petits aller-retours post-implémentation, ça me permettait de pouvoir garder le fil de ce qu'on faisait.

Je me demande si ça ne l'a pas aidé à avoir un contexte complet aussi, quand il re-lisait la codebase après un `/clear`.


## Claude est nul à interpréter les besoins visuels

Plusieurs fois il m'a pété mes animations, ou mon CSS. Et quand je lui expliquait quoi fixer, il faisait n'importe quoi.

En fait, quand je décrit une animation ou un placement visuel, j'étais jamais assez précis. Comme il a pas idée de ce qui est logique visuellement - même juste "bien aligné" ça n'a pas de sens pour lui - il était tout le temps à côté de la plaque.

J'ai fini par pondre une [description hyper détaillée des séquences d'animations](https://github.com/JeSuisUnCaillou/mario_cartes/blob/main/CLAUDE.md?plain=1#L57:L88), presque du pseudocode quoi, pour qu'il arrive à l'implémenter correctement.

Pour le CSS, j'ai juste été le faire moi-même plusieurs fois, c'était plus rapide que de lui expliquer.

## Mes 2 plus grosses refactos

### Il n'utilisait pas Colyseus

#### Le problème

Au bout de 2 ou 3 jours, je sais plus, je fait un playtest avec mon pote, et on remarque que certains clients sont souvent déconnectés, et n'arrivent plus à reprendre la partie normalement.

Je tente de faire fix ça à Claude une ou deux fois, puis un doute me prend : Je relis rapidement la doc de Colyseus et ... ouais en fait c'est censé être complètement géré par ce framework ! C'est même pour ça que je l'ai choisi. Je demande à claude si il utilise bien Colyseus en lui linkant la doc, et la réponse est non 🤦. Il avait fait son propre système de websockets natif.

#### La solution

Je lui dit d'explorer la doc et de faire la liste de toute ce qu'il pourrait utiliser parmi les features proposées par colyseus, et il me fait une belle refacto. (Qui a complètement pété mes animations, mais on en a déjà parlé).

### Il ne faisait pas de OOP

#### Le problème

A un moment, je lui dit de placer une étoile sur un joueur pour représenter le fait qu'il est invincible, et après l'implémentation je remarque que l'étoile ne suit pas le joueur : elle reste sur place quand il se déplace lol.

Mais alors doute : Comment c'est possible, dans ma tête y'a un objet "player" qui est facilement utilisable pour regrouper les assets à déplacer ensemble. Il y avait déjà l'avatar et le nom, maintenant l'étoile en plus.

Eh bien ce cher claude avait pas du tout DU TOUT fait de programmation objet : tout était dispersé dans des fonctions un peu partout, et si je voulais que l'étoile suive l'avatar comme le nom, il fallait spécifiquement déplacer l'étoile en plus lors du mouvement.

#### La solution

Je lui dit que dans un jeu vidéo, "OOP is important", et lui demande de lister tous les objets qu'il pourrait créer pour regrouper du code. Il me fait une liste, j'itère sur ce que je veux et ne veux pas, et il me fait une belle refacto (qui a de nouveau pété les animations, tu t'en doutais).

## Le prix

J'avais pris 180€/mois par ce que je ne voulais pas être limité, je comptais mettre tout mon temps dedans. Mais finalement, en voyant la consommation que j'ai eu, 90€/mois aurait suffit.

Je pense que le 180€/mois est nécessaire seulement si tu fait bosser plusieurs agents en parallèle toute la journée, ce que je n'ai pas fait. 

# Conclusion

