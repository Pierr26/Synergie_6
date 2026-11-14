# Architecture cible Laravel

Laravel sert le document initial, les ressources compilées et, si nécessaire, un récepteur de test distinct. Blade porte le cadre de l’interface. TypeScript gère les parcours interactifs dans le navigateur. Vite compile les styles et scripts. Dexie/IndexedDB conserve les données nécessaires aux opérations hors ligne.

```text
QUINTA/
├── app/Http/Controllers/       Entrée et éventuel récepteur de test
├── routes/web.php              Point d’entrée Laravel
├── resources/
│   ├── views/app.blade.php     Document initial avec @vite
│   ├── css/tokens.css
│   └── js/
│       ├── main.ts             Entrée et navigation côté navigateur
│       ├── components/         Contrôles et statuts partagés
│       ├── features/
│       │   ├── overview/       Bilan et planning
│       │   ├── check-in/       Rappel, brouillon et saisie
│       │   ├── measurements/   Mesures ponctuelles et laboratoire
│       │   ├── trends/         Historique, référence et tableau
│       │   ├── body-risks/     Régions 2D, fiches et 3D facultative
│       │   ├── follow-up/      Demandes, réponses et revue
│       │   ├── crew/           Console CMO et dossier membre
│       │   ├── notifications/  Boîte de réception par rôle
│       │   ├── reports/        Impression, instantané, file et reçu
│       │   └── help/           Guides courts par rôle
│       ├── domain/             Règles et transitions disponibles hors réseau
│       ├── data/               Dexie, transactions et récepteurs
│       ├── demo/               Données versionnées, horloge et reset
│       └── offline/            Préparation et enregistrement du service worker
├── public/
│   ├── sw.js                   Service worker servi à la racine
│   └── assets/                 Logo, illustrations et modèles
├── tests/                      Cas limites, parcours navigateur et tests PHP utiles
├── reference/                  Maquette et cadrage v5.2
└── docs/                       Conception, ressources et preuves de recette
```

Ce plan décrit le projet que Claude doit créer. Le kit contient déjà les références, l’aperçu, les styles et les actifs.

## Fonctionnement hors ligne

Après la première visite réussie, le service worker met en cache le document initial et les fichiers versionnés requis par les vues essentielles. Prévoir un état « Ready offline » une fois cette préparation terminée. Utiliser le build de production Vite servi par Laravel pour la recette. Le stockage des observations et rapports reste distinct du cache d’interface. Les changements de version du cache préservent IndexedDB.

Les écrans lisent les observations depuis des requêtes Dexie communes. Les écritures liées, comme l’enregistrement du check-in et la création de la notification, se font dans une transaction. Utiliser l’espace, le membre, le jour de mission et la méthode pour identifier les observations. La correction conserve l’historique. Le reset cible uniquement l’espace de démo.

## Réception des rapports

Le rapport conserve son UUID et son contenu figé au renvoi. Le récepteur fictif local simule l’accusé lorsque la liaison sol simulée revient. Le récepteur Laravel de test reste une extension distincte, accessible quand son réseau est disponible. Si cette extension est retenue, dédupliquer côté serveur par UUID et ne marquer le rapport reçu qu’après persistance de l’accusé côté client.

Référence [intégration Laravel et Vite](https://laravel.com/docs/vite).
