# QUINTA — crew health, even when the ground link drops

Synergy 5 · NASA Space Apps Challenge 2026 (Casablanca) · *Create Health Monitoring Software for Astronauts on Space Missions*.

The astronaut logs sleep and drowsiness in a short daily check-in. The crew medical officer (CMO) reviews a signal on board and asks for a follow-up. The CMO can generate an individual report, print it and queue it for the ground. All of this keeps working offline and during a simulated ground-link outage.

**Simulated crew data. Demo rules are not clinical thresholds. Not affiliated with NASA.**

## Stack

- **Laravel 13** (PHP ≥ 8.3, tested on 8.5) serves the single Blade document (`resources/views/app.blade.php`), the compiled assets, and a separate **Laravel test receiver** (`PUT /api/v1/reports/{uuid}`).
- **Vite 8 + TypeScript**, no UI framework: client-side routing over the same cached document.
- **Dexie / IndexedDB** for every record (observations, check-ins, tasks, notifications, requests, alerts, lab results, reports, queue). Workspace isolation on every key and every query.
- **Service worker** (`public/sw.js`, generated at build from the Vite manifest), versioned precache, offline reload of any internal view.
- **three.js** and the 3D anatomy (female / male, 1.4 MB each) load only on Body & Risks (separate chunk, cached on first use).

## Prerequisites

| Tool | Version used | Notes |
|---|---|---|
| PHP | 8.5.12 (`^8.3` required) | extensions: pdo_sqlite, mbstring, openssl, tokenizer, xml, ctype, json |
| Composer | 2.11 | |
| Node.js | 22 LTS (npm 10) | |
| Chromium | any recent | only for the end-to-end tests |

PHP 8.5, Composer and Node 22 are now installed on the build machine: `npm run build`, `npm test` and `php artisan test` run directly. The first build was done in the official `composer:2` and `node:22-bookworm` Docker images (wrapper `./scripts-node.sh`). The end-to-end tests still run in the browser image built from `tools/docker/Dockerfile.browser`, through `./pw.sh`.

## Run it

```bash
composer install
cp .env.example .env && php artisan key:generate
php artisan migrate            # SQLite table for the Laravel test receiver only
npm install
npm run build                  # tsc --noEmit + vite build + public/sw.js
php artisan serve              # http://127.0.0.1:8000
```

For development with hot reload, run `npm run dev` alongside `php artisan serve`. The service worker registers **only with the production build**, so do the offline acceptance run against `npm run build` + `php artisan serve` (same origin as Laravel).

Docker equivalent (what was actually run):

```bash
docker run --rm -u $(id -u):$(id -g) -v $PWD:/app -w /app composer:2 composer install
./scripts-node.sh npm install
./scripts-node.sh npm run build
docker run --rm -u $(id -u):$(id -g) -v $PWD:/app -w /app composer:2 php artisan migrate
docker run -d --name quinta-serve -u $(id -u):$(id -g) --network host -v $PWD:/app -w /app composer:2 php artisan serve --host=127.0.0.1 --port=8000
```

## Tests

```bash
npm test                                     # Vitest: domain rules + IndexedDB data layer (fake-indexeddb)
php artisan test                             # PHPUnit: shell routes + Laravel test receiver
npx playwright test                          # E2E at 1440 px and 390 px against http://127.0.0.1:8000
# Docker: docker build -t quinta-browser -f tools/docker/Dockerfile.browser tools/docker && ./pw.sh npx playwright test
```

The results, the M01–M16 / V01–V12 matrix and the open gaps are in [`docs/ACCEPTANCE.md`](docs/ACCEPTANCE.md). Design decisions, with before/after captures, are in [`docs/DESIGN_DECISIONS.md`](docs/DESIGN_DECISIONS.md). Asset rights are in [`docs/ASSET_CREDITS.md`](docs/ASSET_CREDITS.md).

## Guided demo (30 s path)

1. **Start demo** → Day 142, 06:59 UTC, ground link offline. *Today's plan* says "Scheduled 07:00".
2. **Advance 1 minute** → "Daily check-in is due" banner and notification. *Snooze 30 min* is available.
3. **Open check-in** → the draft (5 h 12 min) is pre-filled → **Save check-in** → "Saved on this device" and "Sleep trend needs review · Demo rule · Crew review pending", with Day 140 5 h 36, Day 141 5 h 24 and Day 142 5 h 12.
4. Switch to **CMO** → bell with 1 unread → open the notification → **Record review** and request a follow-up.
5. **Reports** → generate the Moreau report → **Queue for ground** → "Queued". Toggle **Ground link** → *Sending* → *Received*, with the receipt from the "Simulated ground receiver".

Demo controls (Advance 1 minute / 30 min, Next day, Replay Day 138 / 142, Lose next receipt) only touch the demo workspace. **Explore app** is an independent fictional crew on the real clock, with no mission rule configured.

## Project layout

```
app/Http/Controllers/AppShellController.php        one document for every internal view
app/Http/Controllers/Api/ReportReceiverController.php   Laravel test receiver (idempotent per UUID, 409 on different content)
resources/js/domain/      pure, offline rules: SLEEP-001, reminders, labs, measurements, queue
resources/js/data/        Dexie schema + transactions (repo.ts)
resources/js/demo/        versioned demo dataset, workspace config, seeding
resources/js/features/    overview, check-in, measurements, trends, body-risks (+ lazy body3d), follow-up, crew, notifications, reports, help, settings
resources/sw/sw.template.js   service worker template (vite.config.ts writes public/sw.js)
tools/build-anatomy-hra.mjs  builds the female / male anatomy GLBs from the HuBMAP reference bodies
tests/js · tests/Feature · tests/e2e
reference/                kit references: cadrage v5.2, original mockup, kit prompt
```

## Role-based redesign (local branch)

The current branch adds Today, a dedicated symptom page, a shared review queue and a separate authenticated Laravel workspace. The existing offline demo, J138/J142 scenarios, report queue and lazy 3D viewer are retained. 2D now opens first.

```bash
./preview.sh   # build, migrate the local database, prepare local fictional accounts, serve on port 8001
```

Open **http://localhost:8001**. Start demo needs no account. Sign in uses the two generated local profiles; credentials are stored only in `storage/app/private/local-profiles.txt` (ignored, mode 0600). Invitations are the next account-provisioning step. Connected records and photos are mission-scoped on the onboard server; their private pages are never cached by the demo service worker. Demo and account data are separate.

See [the redesign handoff](docs/ROLE_REDESIGN.md) for the backup SHA/tag, rollback command, design decisions, actual test results, browser/environment blockers and remaining acceptance checks. Existing screenshots are Claude's historical references; no new browser captures were possible in the restricted agent environment.
