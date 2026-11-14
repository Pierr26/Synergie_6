# QUINTA — refonte des expériences par rôle

## Versions et retour arrière

- Dossier de référence Claude : `/home/marius/NASA/QUINTA`, branche `main`, inchangé après sauvegarde (hors `.gitignore` renforcé avant le premier commit).
- SHA de sauvegarde : `7bb5f444a23ba92aca249fa08fea4ae436bff5ec`.
- Tag annoté : `quinta-before-role-redesign` ; objet tag `ec1f5abeb7b8c626a8f161fd08ecd14c7bff310a`.
- Worktree de refonte : `/home/marius/NASA/QUINTA-role-redesign`.
- Branche : `feat/quinta-role-based-experience`.
- Le dossier original n’avait aucun dépôt Git, ni dépôt parent. 259 fichiers ont été examinés et sauvegardés : code, références, actifs de Claude et lockfiles. Aucun secret détecté dans le contenu indexé. `.env`, bases SQLite, photos privées et dépendances générées sont ignorés. Aucun fichier sensible n’était déjà suivi puisque Git a été initialisé pour cette sauvegarde.

Rouvrir l’ancienne version dans un autre dossier :

```bash
git -C /home/marius/NASA/QUINTA worktree add --detach /home/marius/NASA/QUINTA-before quinta-before-role-redesign
```

Ce worktree contient le code, pas les données du navigateur, les dépendances ni `.env`. Pour le lancer : installer les dépendances, créer son environnement local et sa propre base selon le README sauvegardé. Le dossier original conserve déjà son environnement fonctionnel de référence.

La branche et le tag Claude ont été poussés lors de la demande intermédiaire. La consigne ultérieure « laisse GitHub » a arrêté les opérations distantes ; la refonte reste locale. Aucune pull request n’a été créée.

## Lancer l’aperçu

```bash
cd /home/marius/NASA/QUINTA-role-redesign
./preview.sh
```

Adresse : **http://localhost:8001**. Le script construit les actifs, applique les migrations locales sans effacer les données et crée les deux profils fictifs s’ils n’existent pas. Les identifiants générés sont dans `storage/app/private/local-profiles.txt`, exclu de Git et accessible seulement à son propriétaire. La démo ne nécessite aucun compte.

La session de travail utilisée pour la refonte bloque les sockets : `php artisan serve` ne peut pas écouter sur `127.0.0.1:8001`, Docker répond `permission denied` sur `/var/run/docker.sock`, le navigateur intégré n’a aucun hôte accessible et Playwright n’a pas de Chromium installé. Le serveur n’est donc **pas annoncé comme démarré ou visuellement vérifié**. L’aperçu doit être lancé depuis le terminal normal du PC.

## Décisions et reprise du travail de Claude

Conservés : Laravel 13, TypeScript natif/Vite, Dexie, service worker, règles de sommeil de démo, scénarios J138/J142, notifications, mesures et tendances datées avec provenance, file de rapports idempotente, formulaires et stockage des photos, guides, mode nuit, palette clavier et anatomie Three.js/GLB. Aucune dépendance ajoutée.

1. **Entrée** : deux choix principaux `Start demo` et `Sign in`. Le bac à sable `Explore app` reste disponible en retrait pour préserver les données existantes.
2. **Today** : une seule action principale, dérivée des dossiers réels. Priorité au complément demandé, puis au check-in ; une fois sauvegardé, confirmation/résumé ou suivi de revue. Les autres sections restent ouvertes. L’ancien long tableau de mesures et le guide omniprésent ont cédé la place à trois entrées de parcours et aux dernières valeurs avec leur provenance.
3. **Pages dédiées** : Daily Check-in, Trends, Body & Risks, Report a Symptom et Follow-up. Le signalement n’est plus caché sous Follow-up. Les anciens liens `/follow-up/symptom` fonctionnent encore.
4. **Médecin** : la file de revues arrive avant le tableau d’équipage. Chaque entrée porte membre, motif, date et statut. Les réponses reviennent dans le dossier ; le médecin peut les marquer relues.
5. **États cohérents** : `Crew review pending`, `Follow-up requested`, `Response received`, `Reviewed`. Le modèle de lecture partagé sert à Today, aux badges et à la file de revues.
6. **Identité** : logo et palette lagon conservés ; Figtree à l’échelle d’une application pour les titres, hublot réservé à l’accueil, contrôles de scénario repliables. Navigation mobile et palette donnent accès aux sections sans terminer le parcours.
7. **Comptes** : deux profils locaux préconfigurés, sessions Laravel, rôle et mission attribués côté serveur. Aucun sélecteur de rôle dans l’espace connecté. Validation et autorisation à chaque lecture, photo, écriture, revue et rapport. Création sur invitation à construire ensuite.

## Parcours et limites de preuve

| Étape | Résultat vérifié par tests exécutés | Limite visuelle |
|---|---|---|
| 1. Entrée sans compte | Shell public et route signalement accessibles ; comptes séparés | Aucun navigateur disponible |
| 2. Today → check-in | État dû, sauvegarde, résumé, règle J138 silencieuse / J142 en revue | Composition mobile/ordinateur non observée |
| 3. File médecin → dossier | Motif, état, membre et accès au bon dossier ; isolation par mission | Clics et mise en page à vérifier au navigateur |
| 4. Demande de complément | Priorité sur Today ; demande liée au champ et dossier | Focus/scroll et lecteurs d’écran non testés |
| 5. Réponse astronaute → médecin | Réponse retrouvée, état reçu puis relu ; thread conservé | Parcours visuel non exécuté |
| 6. Signalement / photo | Sans photo, remplacement/retrait, identifiants et stockage IndexedDB ; image serveur privée | Caméra, galerie et rechargement réellement hors réseau à vérifier |

Les anciennes captures de Claude sont conservées sous `docs/screenshots/`. Elles documentent son travail et **ne constituent pas des captures de cet audit**. Aucune capture avant/après de la présente session n’a été fabriquée. Les tests E2E adaptés écrivent dans `docs/screenshots/role-redesign/`, sans écraser les références.

Product Design Audit a été chargé, mais son audit visuel n’a pas pu être mené faute de navigateur. Les décisions ci-dessus reposent sur le code et les tests, pas sur une inspection de nouvelles captures. Les risques d’accessibilité restants concernent notamment le focus, la navigation clavier complète, les tailles tactiles effectives, les contrastes et le débordement à 390 px.

## Données et hors ligne

- **Démo / Explore** : IndexedDB `quinta`, clés isolées par workspace. Le médecin de la démo utilise le **même navigateur et la même origine** ; aucun partage vers un autre appareil n’est prétendu. Brouillons et photos restent sur cet appareil. Effacer les données du site les efface. Changer de navigateur ou de port crée un autre espace.
- **Comptes** : dossiers et photos sur la base SQLite et le stockage privé Laravel de ce worktree. Les brouillons réutilisent Dexie dans une base distincte par mission et utilisateur. Ils restent sur l’appareil jusqu’à leur envoi réussi. Les pages privées et photos sont `private, no-store` et contournent le service worker ; leur rechargement hors connexion au serveur de bord n’est pas pris en charge. La démo conserve le rechargement hors réseau après préparation du cache.
- **Bord / sol** : un brouillon local n’est pas disponible au médecin connecté avant POST réussi au serveur de bord. Le lien vers le sol est un autre état. Les rapports de démo gardent le récepteur simulé et le récepteur de test de Claude. Les rapports connectés peuvent être préparés et mis en file ; aucun récepteur sol connecté n’est configuré et aucun faux accusé n’est affiché. Photos exclues des snapshots.
- Aucune analyse d’image par IA n’a été implémentée. Les profils locaux restent fictifs. L’invitation, la synchronisation multiappareils hors serveur de bord et le transport sol connecté sont les lots suivants.

## Visuels et 3D

Hublot existant conservé : 48 718 octets, adapté au hors ligne. Aucune vidéo d’ambiance n’a été intégrée ; l’accès aux outils Higgsfield a été examiné, mais le résultat local et les préférences de mouvement ne pouvaient pas être vérifiés dans cet environnement. L’image fixe permet de terminer le parcours sans média distant.

Nouvel actif : `public/assets/illustrations/simulated-skin-mark.webp` (environ 20 kB), généré par l’outil intégré ImageGen puis optimisé à 800×600 maximum. Un mannequin synthétique portant une petite marque rouge remplace le dessin canvas. Le libellé fictif figure dans l’image. Aucun logo, hublot ou photo privée n’a été remplacé.

Prompt ImageGen :

> Use case: scientific-educational. Asset: a fictional photo attachment for the QUINTA space crew health software demo. Generate a neutral close crop of the forearm of a visibly synthetic medical training mannequin (not a real person), showing one small reddish skin patch. Plain warm light, no dramatic injury, no blood. Landscape 4:3 composition. Include a crisp dark teal footer with exact readable white text: "SIMULATED IMAGE · NOT A REAL PERSON". No diagnosis, no logos, no other text. The purpose is to demonstrate attaching an optional image for a human medical officer to review.

GLB inspectés : 10 meshes chacun, 1 419 512 / 1 430 632 octets, **0 clip embarqué**. Les métadonnées mentionnent HuBMAP Human Reference Atlas, Visible Human et Allen brain, CC BY 4.0 ; crédits existants conservés dans `ASSET_CREDITS.md` et le viewer. Les animations procédurales existantes restent illustratives, indépendantes des mesures. Le chargement automatique a été supprimé : vue 2D et liste d’abord, `View in 3D` à la demande. La rotation, sélection de région et préférence de mouvement réduit existantes sont conservées, sans nouvelle vérification WebGL.

## Vérifications

Exécutées :

- `npm run build` : TypeScript strict + build Vite réussis.
- `npm test` : **53 tests réussis**, dont les règles J138/J142, séparation Demo/Explore, rapports/accusés, pièces jointes IndexedDB, transitions Today/revue/complément/réponse.
- `php artisan test` : **17 tests, 126 assertions réussies**, dont connexion/déconnexion, rôle du compte, absence d’affectation, isolation équipage/mission, données injectées refusées, upload, accès privé aux photos, revue complète et rapports.
- `vendor/bin/pint --dirty --test` : réussi.
- Migrations et commande `quinta:profiles` exécutées sur la base locale isolée.
- Inspection des GLB et de leurs métadonnées/clips.

Tentées, bloquées :

- Playwright `tests/e2e/symptoms.spec.ts`, projet desktop : deux tests arrêtés au lancement, **Chromium absent**, avant toute navigation. Ce n’est pas une validation des interactions.
- Serveur local, Docker et navigateur intégré : blocages détaillés ci-dessus.

À exécuter sur le PC après `./preview.sh`, dans un second terminal :

```bash
cd /home/marius/NASA/QUINTA-role-redesign
QUINTA_URL=http://127.0.0.1:8001 npx playwright test
# ou, si l’image quinta-browser de Claude est installée :
BASE=http://127.0.0.1:8001 ./pw.sh npx playwright test
```

Les projets Playwright couvrent 1440×900 et 390×844. Les tests ont été adaptés aux nouveaux libellés et aux contrôles de scénario repliables ; ils restent **non exécutés jusqu’au bout** dans cette session. Les captures comparatives avant/après et la validation visuelle restent à réaliser.
