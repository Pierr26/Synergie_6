# Direction visuelle QUINTA

L’identité associe une palette blanc minéral et vert profond, un accent ambre réservé aux revues, et des surfaces sobres. Le logo de l’équipe identifie le produit. Figtree sert aux libellés, IBM Plex Mono aux heures, valeurs et identifiants. L’aperçu utilise les polices système. Si Claude intègre les fichiers de police, il les sert localement et inclut leurs licences.

## Écrans

| Vue | Premier contenu | Détail accessible ensuite |
|---|---|---|
| Entrée | « Start demo » et « Explore app », avec leur rôle en une phrase | Image de hublot en arrière-plan d’une zone décorative |
| Overview | Rôle, jour, liaison, tâche due ou raison de revue | Planning, mesures, historique et sources |
| Daily Check-in | Durée et somnolence avec libellés près des champs | Informations facultatives et mesures ponctuelles |
| Trends | Dernière valeur comparable, méthode et graphique | Tableau daté, référence personnelle et sources |
| Body & Risks | Sélecteur de régions et fiche active | Mannequin 2D, visionneuse 3D sur demande et fiches HRP |
| Console CMO | Tâches à examiner et membre concerné | Observations, demande, historique et rapports |

Utilise des boutons visibles et distincts, des libellés d’état en toutes lettres et un focus apparent. Sur mobile, l’action principale et le motif arrivent avant les détails. En démo, la confirmation du statut fictif reste près de la règle et de la transmission.

## Actifs et crédits

- `brand/quinta-logo.svg` · logo fourni par Synergy 5, repris de l’archive utilisateur.
- `illustrations/lunar-window.webp` · scène fictive générée pour le kit. Mention à reprendre dans les crédits si l’image est utilisée. Exemple de crédit « AI-generated mission illustration ».
- `illustrations/body-front.webp` · rendu frontal transparent du mannequin du kit. Utiliser le visuel avec une liste de boutons HTML complète. Les repères visuels peuvent être superposés sans dépendre de la couleur et les coordonnées doivent rester solidaires du cadrage de l’image.
- `models/body-mannequin.glb` · maillage original stylisé, sans textures externes ni organes détaillés. Les nœuds `zone-brain`, `zone-eyes`, `zone-inner-ear`, `zone-heart`, `zone-lungs`, `zone-kidneys`, `zone-bones` et `zone-leg-muscles` servent de repères de navigation. Employer les mêmes identifiants métier en 2D et 3D. Les noms et états des fiches restent dans le DOM.
- Les anciens fichiers `body.txt` et `woman.txt` restent des références de la maquette. Le cahier v5.2 demande de confirmer leur origine et leurs droits avant intégration publique.

Le mannequin est un repère régional de démonstration. Les explications sur les risques et les mesures viennent des sources documentées dans le cahier. Lance la 3D sur action explicite, conserve un accès direct aux fiches en cas d’échec WebGL et suspends le rendu lorsque l’écran est masqué.
