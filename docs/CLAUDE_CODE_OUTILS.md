# Extensions Claude Code pour QUINTA

## Plugins

| Priorité | Plugin | Usage concret |
|---|---|---|
| 1 | `frontend-design` | Proposer une direction visuelle propre à QUINTA à partir de la maquette et réaliser des écrans lisibles sur mobile. |
| 1 | `playwright` | Ouvrir le prototype local, vérifier J138/J142, prendre des captures aux deux largeurs et tester les interactions. Les tests reproductibles restent dans le dépôt. |
| 1 | Laravel Boost | Aide spécifique à Laravel, avec recherche documentaire et contexte du projet. À ajouter en dépendance de développement si la version Laravel/PHP retenue est compatible. |
| 1 | `context7` | Chercher les API et exemples correspondant aux versions installées de Laravel, Dexie, Vite et Three.js. Authentification possible selon le service. |
| 2 | `typescript-lsp` | Navigation dans les types et diagnostics pour les observations, notifications et états de rapport. Voir le README du plugin pour le binaire de langage requis. |
| 2 | `code-review` | Faire une revue des PR une fois les parcours assemblés. Fournir aussi les résultats et captures à GPT pour la revue du produit. |
| Option | Figma | Utile si l’équipe maintient une maquette Figma comme référence de conception. |
| Option | GitHub | Utile si Claude doit lire les issues et PR du dépôt. |

Dans une session Claude Code :

```text
/plugin install frontend-design@claude-plugins-official
/plugin install playwright@claude-plugins-official
/plugin install context7@claude-plugins-official
/plugin install typescript-lsp@claude-plugins-official
/plugin install code-review@claude-plugins-official
```

Si un identifiant ne se résout pas, chercher le nom dans `/plugin` → Discover et choisir la fiche correspondant au fournisseur. Frontend Design, Playwright et Context7 couvrent les besoins immédiats. Pour Laravel Boost, après initialisation du projet, suivre la [documentation Laravel](https://laravel.com/docs/12.x/installation#installing-laravel-boost), puis lancer `composer require laravel/boost --dev` et `php artisan boost:install` si la version choisie est compatible. Sources [marketplace Claude](https://claude.com/marketplace/plugins), [installation des plugins](https://code.claude.com/docs/en/discover-plugins), [README TypeScript LSP](https://github.com/anthropics/claude-plugins-official/blob/main/plugins/typescript-lsp/README.md).

## Skills d’équipe à ajouter au besoin

Un skill de projet se place dans `.claude/skills/<nom>/SKILL.md`, avec `name` et `description` dans le frontmatter. Conserver le cadrage en document de référence et pointer vers ses sections depuis les skills. Voici trois procédures spécifiques à QUINTA à faire formaliser une fois le dépôt en place.

| Nom proposé | Procédure à consigner |
|---|---|
| `quinta-demo-qa` | Rejouer J138 et J142, vérifier l’absence de doublon, recharger hors réseau, tester rapport et reçu simulé, consigner les observations. |
| `quinta-review-data` | Vérifier la cohérence des valeurs et méthodes entre Bilan, Trends, fiche CMO et rapport. Vérifier les données absentes et la séparation Explore/démo. |
| `quinta-3d-assets` | Vérifier licence, attribution, clip et poids du GLB, puis tester la fiche sans WebGL et avec mouvement réduit. |

Source [documentation officielle des skills](https://code.claude.com/docs/en/skills).
