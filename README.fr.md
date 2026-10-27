# BroadbandStarless

**Un script PixInsight qui transforme trois masters R, G et B en une image RGB linéaire sans
étoiles et une image d'étoiles linéaire, calibrées en couleur par SPCC.**
Choisis les masters, clique *Exécuter* : le script assemble les canaux, retire le gradient, pose
une preview sur une zone de ciel propre, neutralise et calibre les couleurs, puis sépare les
étoiles. Les masters ne sont jamais modifiés.

*English version: [README.md](README.md)*

Conçu pour la chaîne de traitement de l'auteur (masters issus de CommonCrop, puis ce script, puis
étirement et réinsertion des étoiles). Script jumeau de NarrowbandStarless, qui fait le même travail
sur des masters SII, Ha et OIII. Partagé tel quel.

## Ce qu'il fait

Sur une nouvelle image RGB construite à partir des vues choisies :

1. **ChannelCombination** de R, G et B ; la solution astrométrique des masters est héritée.
2. **GraXpert** : retrait de gradient par IA (*Replace image* toujours activé dans le pipeline).
3. **Preview de fond de ciel** : le script cherche le carré de ciel au signal le plus bas et le
   plus plat (niveau médian, dispersion et écart moyenne/médiane pénalisés, pour éviter étoiles et
   nébulosité) et y crée une preview, `Background` par défaut. Une preview déjà posée sur un des
   masters peut être reprise à la place. Cette preview sert ensuite de référence aux deux étapes
   suivantes.
4. **BackgroundNeutralization**, référence = la preview. *Upper limit* est calculé à partir des
   statistiques de la preview (médiane + 3 σ par canal, σ issu de la MAD, la plus grande des bornes
   retenue), pour ne rejeter que les étoiles restées dans le carré. *Working mode* est par défaut
   *Target background* avec la médiane de la preview comme cible : l'image garde son niveau de fond
   et rien n'est plaqué sur le plancher à zéro, ce qui préserve les outils IA suivants des artefacts
   de tuiles. Le pourcentage de pixels de la preview retenus par canal est écrit dans la console.
5. **BlurXTerminator**, *Correct Only* : forme des étoiles corrigée avant la résolution
   astrométrique et SPCC.
6. **ImageSolver** : résolution astrométrique par le moteur d'ImageSolver (sans dialogue), à partir
   des métadonnées de l'image (focale, taille de pixel, coordonnées). Activée par défaut même si
   l'image porte déjà une solution.
7. **SpectrophotometricColorCalibration** : filtres et courbe QE du capteur choisis dans la base
   de filtres de PixInsight (celle de FilterManager et de SPCC), ou repris d'une icône de process
   SPCC du bureau ; *Background neutralization* sur le rectangle de la preview (*Region of
   interest*).
8. **BlurXTerminator** : déconvolution.
9. **StarXTerminator** : image sans étoiles et image des étoiles.
10. **NoiseXTerminator** (optionnel, désactivé par défaut) : réduction du bruit sur l'image sans
    étoiles.
11. **Auto STF** (optionnel, activé par défaut) : STF automatique liée sur l'image sans étoiles et
    le modèle de fond ; l'image des étoiles reçoit la même STF que l'image sans étoiles (une auto STF
    à part n'a pas de sens sur une image de médiane nulle). Affichage seulement : les pixels ne sont
    pas modifiés.

Chaque outil est lancé seul (pas de ProcessContainer), avec la durée de chaque étape dans la console
et *Pause/Abort* pris en compte entre deux étapes. Les résultats s'appellent `StarlessRGB` et
`StarsLinear` par défaut (modifiables). Le modèle de fond GraXpert, s'il est affiché, s'appelle
`Background_<résultat>`.

## Prérequis

| Élément | Version |
|---|---|
| PixInsight | 1.9.5 et suivants (moteur JavaScript V8, ImageSolver 6.5) |
| Process GraXpert (DeepSkyForge) et application GraXpert | le process exige GraXpert 4.0.0 ou plus récent |
| BlurXTerminator, StarXTerminator, NoiseXTerminator | RC Astro, licences à part |
| Catalogues Gaia DR3 et Gaia DR3/SP (fichiers XPSD locaux) ou connexion internet | pour ImageSolver et SPCC |

Seuls les outils activés doivent être installés.

## Installation

### Depuis le dépôt de mises à jour PixInsight (recommandé)

1. *Resources > Updates > Manage Repositories*, ajouter
   `https://jps-34.github.io/BroadbandStarless/`
2. *Resources > Updates > Check for Updates*, puis redémarrer PixInsight.
3. Le script apparaît dans *Script > JPS > BroadbandStarless* (*Script > Utilities* jusqu'à la 1.0.1).

Tant que le dépôt n'est pas signé, PixInsight ne l'accepte qu'avec l'option de sécurité *Allow
unsigned update repositories* activée.

### Manuelle

Télécharger `scripts/BroadbandStarless.js`, puis soit l'exécuter avec *Script > Execute Script
File*, soit ajouter son dossier avec *Script > Feature Scripts > Add* pour qu'il apparaisse dans
*Script > JPS*.

## Prise en main

1. Ouvrir les trois **masters linéaires monochromes avec étoiles**, déjà recadrés sur la même zone
   (par exemple `R_crop`, `G_crop`, `B_crop`). Le script présélectionne les vues dont le nom
   contient R, G ou B comme un mot (`R_crop`, `master_G`...).
2. Vérifier les trois images dans le groupe *Images* et les deux noms de résultat.
3. Cocher les étapes à exécuter. Dans *Fond de ciel*, garder *Recherche automatique* sauf si une
   preview est déjà posée sur un master.
4. En mode avancé, *SpectrophotometricColorCalibration* : choisir une fois pour toutes les filtres
   *Red*, *Green*, *Blue* et la *QE curve* de la caméra ; le choix est mémorisé.
5. *Exécuter*. La progression, le rectangle de la preview, les statistiques de fond, le résumé de
   la résolution astrométrique et les résultats SPCC sont dans la console.

Les réglages sont mémorisés d'une session à l'autre. *Réinitialiser* (en bas à gauche) remet les
valeurs par défaut en gardant les images choisies. Glisser le triangle *New Instance* sur le bureau
enregistre tous les réglages et les noms d'images dans une icône de process ; un double-clic sur
l'icône rouvre le dialogue avec ces réglages.

## Réglages

L'interface est en anglais ou en français (menu *Langue / Language*) et défile quand le mode avancé
est activé. **Les réglages des outils gardent les noms utilisés par les outils eux-mêmes**, dans les
deux langues, pour une correspondance un pour un.

Le *mode avancé* affiche :

| Groupe | Réglages |
|---|---|
| GraXpert | Smoothing (défaut 0.0), Correction (Subtraction / Division), Show background, Disable GPU acceleration |
| Preview de fond + BackgroundNeutralization | Nom de la preview, Taille du carré (px, défaut 100), Marge de bord (%, défaut 2), Poids structure ; Lower limit, Upper limit automatique (Sigmas au-dessus de la médiane, défaut 3) ou Upper limit, Working mode, Target background automatique (médiane de la preview) ou Target background |
| ImageSolver | Résoudre même si déjà résolue (activé par défaut), Distortion correction |
| SpectrophotometricColorCalibration | Icône de process, Red / Green / Blue filter, QE curve, Background neutralization, Region of interest = preview de fond, Generate graphs |
| BlurXTerminator | Sharpen Stars, Adjust Star Halos, Automatic PSF, PSF Diameter, Sharpen Nonstellar |
| StarXTerminator | Unscreen Stars |
| NoiseXTerminator | Intensity/color separation, Frequency separation, puis seulement les réglages utilisés par ce mode, Frequency scale, Detail, Iterations |
| Auto STF | Shadows clipping (défaut -2.80, en MAD normalisées), Target background (défaut 0.25) |

Notes :

* **Recherche de fond après le retrait de gradient.** La recherche cherche le carré plat le plus
  sombre ; sur une image qui porte encore un gradient, elle s'arrêterait sur le coin le moins dégradé
  plutôt que sur le vrai ciel. Garder GraXpert activé, ou fournir une image déjà aplanie.
* **Un Upper limit en pourcentage ne marche pas en automatique.** Après soustraction du gradient le
  niveau de fond est très bas, et quelques pour cent de ce niveau peuvent être plus petits que le
  bruit : la borne couperait alors dans les pixels de ciel eux-mêmes. La borne en sigmas est
  indépendante du niveau. Vérifier dans la console : proche de 99 % de pixels retenus, la borne ne
  coupe que les étoiles.
* **Filtres et capteur SPCC.** Les listes viennent de `filters.xspd` dans le dossier `library` de
  PixInsight (utilisateur ou installation). *(icône ou défaut)* garde la valeur de l'icône de process
  choisie, ou le défaut de SPCC. La référence de blanc et le catalogue viennent toujours de l'icône
  ou des défauts.
* **Icône de process SPCC.** N'importe quelle icône SpectrophotometricColorCalibration du bureau
  peut servir de source de réglages ; le script ne remplace que le bloc de neutralisation du fond.
* GraXpert *Smoothing* : la documentation du process GraXpert recommande 0.0 dans la plupart des
  cas (il ne fait que flouter le modèle de fond).
* StarXTerminator *Unscreen Stars* est prévu pour les images étirées ; RC Astro recommande de ne pas
  l'utiliser sur des données linéaires.

## Licence

Copyright (c) 2026 Jacques Pouyaud. Publié sous
[licence publique générale GNU, version 3 ou ultérieure](LICENSE) (GPL-3.0-or-later) : il peut être
utilisé, étudié, partagé et modifié ; toute œuvre distribuée qui intègre ce code doit être publiée
sous la même licence, avec son code source. Les versions jusqu'à 1.0.0 ont été publiées sous licence
MIT, qui reste valable pour les copies de ces versions.

**Demande de crédit.** En cas de reprise de la méthode ou du code de BroadbandStarless, dans un
script, une application ou un tutoriel, merci de le citer par son nom avec un lien vers ce dépôt.
C'est une demande, pas une condition de la licence ; quand le code lui-même est repris, la GPL
impose déjà de conserver la mention de copyright.

## Crédits

*Code écrit par Claude (Anthropic), sous la direction de Jacques Pouyaud, qui a défini le besoin,
testé sur ses propres données et validé les résultats.* La recherche de fond de ciel s'inspire du
script FindBackground de Franklin Marek (SetiAstro), réimplémentée ici pour que le pipeline ne dépende
d'aucun autre script.
