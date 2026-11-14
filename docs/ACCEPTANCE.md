# Acceptance evidence — QUINTA (Laravel build)

Run on 14 Nov 2026 against the **production build** (`npm run build`), served by `php artisan serve` on `http://127.0.0.1:8000`. The assets, the service worker and the Laravel receiver share the same origin. Toolchain run in Docker: `composer:2` (PHP 8.5.12, Composer 2.11), `node:22-bookworm`, and Debian Chromium for Playwright 1.52.

## Results actually obtained

| Suite | Command | Result |
|---|---|---|
| Typecheck | `npx tsc --noEmit` | 0 errors |
| Vitest (domain + IndexedDB) | `npm test` | **49 passed** (5 files, including 10 for symptom reports) |
| PHPUnit (shell + receiver) | `php artisan test` | **7 passed**, 35 assertions |
| Playwright E2E (1440 px + 390 px) | `npx playwright test` | **26 passed**, 2 skipped (the two offline scenarios run once, on desktop). Includes the symptom-report journey: photo draft, offline reload, submission, CMO review, feedback |
| Laravel receiver via UI | ad-hoc Playwright script | Report queued to *Laravel test receiver* → **Received**, receipt from the server, SHA-256 identical |
| 3D viewer | ad-hoc Playwright script (SwiftShader WebGL) | Female and male anatomy load on Body & Risks, regions zoom, layers and Front/Side/Back work; captures `18-body-3d-male-lungs-skeleton.png`, `19-body-3d-female-kidneys.png`. Frame rate not measured on a real GPU. Without WebGL the 2D map is shown (E2E M07+M08) |
| Build | `vite build` | main 247 kB (77 kB gzip), lazy `body3d` chunk 602 kB, CSS 37 kB. `public/sw.js` lists 17 URLs, all present |

## Replayed scenarios (kit checklist)

| Scenario | Where verified | Outcome |
|---|---|---|
| Day 138 without alert | `sleep.test.ts`, `repo.test.ts`, E2E V02 | No alert, no CMO notification |
| Day 142 before saving | `sleep.test.ts` (data to D141), E2E V09 (CMO "Nothing waiting for review") | No alert |
| Day 142 after saving the 312 min draft | `repo.test.ts`, E2E V09 | One alert, one CMO notification "Sleep trend needs review", evidence 336 · 324 · 312, "Demo rule", astronaut sees "Crew review pending" |
| 359 / 360 min | `sleep.test.ts` | 359 counts, 360 breaks the run |
| Missing day | `sleep.test.ts` | Breaks the run |
| Sensor-only measurement (actigraphy day) | `sleep.test.ts` | Breaks the diary run. Actigraphy is shown as a separate series in Trends and the report |
| Fourth night, no duplicate | `sleep.test.ts`, `repo.test.ts`, E2E V02 | Same episode key (start day 140), end day 143, 4 pieces of evidence, still one notification |
| Snooze survives a reload | `repo.test.ts`, E2E V09 (`page.reload()`) | "Snoozed until 07:30" after reload, due again at 07:30, unread again once |
| Two reports for different members | `repo.test.ts`, E2E M11 | Moreau and Sato snapshots do not share any observation ID. Hb Below (139 g/L) vs Within (152 g/L) |
| Report frozen after a correction | `repo.test.ts` | Content byte-identical after correcting a BP value |
| Offline reload after preparation | E2E `offline.spec.ts` | "Ready offline" → `context.setOffline(true)` → reload `/trends` → renders. Check-in, CMO review, report generation and queueing all work offline. Queue state survives a reload |
| Resend after a simulated lost receipt | `repo.test.ts`, E2E M11 | Retry available → retry → Received with the **same report ID, same content, original receipt ID** ("Original receipt returned on retry") |
| Demo reset without effect on Explore | `repo.test.ts`, E2E V06 | Explore SpO₂ 96 %, reminder 08:15 and data unchanged after Replay Day 138 |
| Reload on an internal view and after a cache update | E2E `offline.spec.ts` | Caches deleted and SW updated: reports, queue state and CMO review still present (IndexedDB untouched) |

## Matrix M01–M16

| ID | Requirement | Implementation | Evidence |
|---|---|---|---|
| M01 | Sleep and drowsiness check-in. Mood, symptoms, resting HR optional | `features/check-in`, `submitCheckin` (one transaction): origin, unit, method, quality and timestamps on each observation. "Not recorded" ≠ confirmed 0. Draft autosave and resume | V01 E2E, `labs-measurements.test.ts` parseSleep |
| M02 | Overview and trends built from the measurements | Overview tiles (value, time, method, source, motivated state, no score). Trends: SVG chart and table from the same rows, gaps marked "no reading", personal reference 438.5 min, separate series per method/site/sample | M02 E2E, screenshots 05, 09 |
| M03 | Computed demo sleep rule | `domain/sleep.ts` SLEEP-001 v1, demo workspace only. Episode key `ws|mission|crew|rule|v1|start` | 12 unit tests, V09/V02 E2E |
| M04 | Traceable follow-up | Review request (astronaut), follow-up request (CMO), answer with its own ID, history with author and time in Follow-up and the member file | M04 E2E, `repo.test.ts` follow-up |
| M05 | Offline after preparation | Generated versioned SW, navigation fallback to the cached shell, IndexedDB separate from Cache Storage | `offline.spec.ts` |
| M06 | Persistent queue and explicit receipt | Queued / Sending / Received / Retry available from `reports.queue`. Same UUID and content on retry. Receipt shows receiver and time. Received only after an ack from the selected receiver | M11 E2E, `repo.test.ts` queue, PHPUnit receiver |
| M07 | NASA resources and indicator sheets | Body & Risks: 8 regions with "Why this matters", what is recorded, how to read it, action and sources (HRP, CSA). Five HRP hazards. Precached for offline | M07 E2E |
| M08 | English, accessible jury path | No account, 1440 / 390 px, keyboard (arrow keys in the region list, focus management, dialog), without WebGL (fallback tested), reduced motion | M07+M08 E2E, all E2E run at both widths |
| M09 | Crew medical console | To-review list, member list (alias, last check-in, state), member file with alert evidence, review, follow-up, observations, labs, reports | M04 E2E, screenshot 06 |
| M10 | First-access help per role | `<dialog>` guide with Skip / Next / Finish, reopened from Help, stored per role, works offline | M10 E2E |
| M11 | Individual reports | Member and period (7 days by default), snapshot with alias, mission, period, author, UUID, UTC date, origin, "Simulated crew data". Print / Save as PDF via print stylesheet | M11 E2E, screenshot 08 |
| M12 | Hb/Hct entry | Lab Results form in the member file: value and original unit, normalisation (g/dL×10, L/L×100), interval, status, collection/analysis delay, lab flag kept separately, versioned correction. Included in the report | `labs-measurements.test.ts` (V03), M11 E2E "Below" |
| M13 | Isolated app and demo workspaces | `ws` in every key and query. Reset deletes `ws='demo'` rows only. Clock, rule and reset belong to the demo | V06 E2E, `repo.test.ts` isolation |
| M14 | Daily plan and check-in reminder | `domain/reminder.ts`: Scheduled / Due / Snoozed / Completed / Missed / Off. Snooze within the day. Dismiss per due time. Reminder settings (time, on/off). Unique key per workspace, mission, crew member, day and type | 7 unit tests, V09 E2E |
| M15 | Notification centre per role | Bell with unread count, Needs action / History, Mark as read, direct link to the object, one entry per event (`&eventKey` unique index) | M04 E2E |
| M16 | BP, SpO₂, temperature, glucose on demand | Value, unit, method, context, time. Systolic ≤ diastolic → "Check measurement". SpO₂ 0–100. Site unknown → check. Separate series. Correction keeps the previous version | V11 E2E |

## Matrix V01–V12

| ID | Status | Notes |
|---|---|---|
| V01 Entry | ✅ automated | Confirmed zero vs empty, draft reload, values in Overview, Trends and report |
| V02 Threshold | ✅ automated | J138, J142, 359/360, missing day, invalid, sensor only, fourth night |
| V03 Lab | ✅ automated | 139/140/170/171, 13.9 g/dL→139, 0.42 L/L→42 %, missing unit, preliminary, missing interval. Correction versioning implemented (UI). Not covered by a dedicated test |
| V04 Records | ✅ automated | Moreau/Sato isolation, answer in the right member's file, report frozen after correction |
| V05 Offline and queue | ✅ automated | Over plain HTTP on localhost (counts as a secure context). HTTPS hosting not tested. Lost receipt replayed. Laravel 409 and persistence covered by PHPUnit |
| V06 Workspaces | ✅ automated | |
| V07 Help and accessibility | ✅ partly automated | Guide skip/finish/reopen, keyboard, no-WebGL automated. Reduced motion handled in CSS/JS but **checked by code review only**. Help offline is precached but not opened offline in a test |
| V08 Jury | ⏳ not done | No public URL deployed yet. Needs to be opened in a private window once hosted |
| V09 Reminder | ✅ automated | 06:59 Scheduled, 07:00 Due, snooze to 07:30, reload, 07:29/07:30, save closes, next day, time change, disable (unit tests) |
| V10 Notifications | ✅ partly | On-board request/answer and receipt/retry notifications without duplicates are automated. System notifications (COULD) are not implemented, so there is nothing to refuse; the internal path works |
| V11 Spot measurements | ✅ automated | Four types, pair check, SpO₂ range, site missing, skin/oral and capillary/plasma separation |
| V12 Action | ✅ automated | Explore review request → CMO notification. No SLEEP-001, no automatic report |

## Manual / not done / open gaps

- **Not done**: public hosting and V08 in a private window. Timing the check-in with two first-time users (target < 5 min). MATLAB cross-check (SHOULD). Print tested only up to `window.print()` and the print stylesheet, not printed to paper or PDF. HTTPS run.
- **3D anatomy**: HuBMAP female and male reference bodies (CC BY 4.0) with procedural motion; ready-made animated clips were paid or needed an account. Frame rate was only checked in a software renderer (about 0.5 fps there); the viewer lowers its resolution on slow devices, but it has not been measured on a real GPU. See `ASSET_CREDITS.md`.
- **Service worker in dev**: disabled with `npm run dev` on purpose. Offline acceptance requires the production build.
- **Laravel Boost**: installed as a dev dependency (`laravel/boost`), but its MCP server needs a host PHP binary, which this machine does not have.
- **Extensions not built**: RadLab/OSDR series, PVT, CSV/JSON export, CO₂ panel, system notifications, multi-environment selector, MongoDB Atlas receiver.
- **Explore clock** is the real clock, so its mission day changes at 00:00 UTC; example data is seeded relative to the first visit.
