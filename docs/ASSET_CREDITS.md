# Asset credits and rights

Every asset actually shipped in `public/` or bundled from `resources/` is listed here. Assets left out on purpose are listed at the end.

| Asset | Where | Origin | Rights / attribution | Changes |
|---|---|---|---|---|
| QUINTA logo, symbol, app icons, favicon | `public/assets/brand/` | Synergy 5 team (kit `public/assets/brand/quinta-logo.svg`, team archive `logo/`) | Team property, used by the team | None |
| Lunar window scene | `public/assets/illustrations/lunar-window.webp` | Generated for the QUINTA kit | Declared as **AI-generated mission illustration** (credit shown on the entry screen and in Help) | None. Decorative only (`alt=""`, `aria-hidden`) |
| Landing page video | `public/assets/illustrations/earth-entry.mp4` | User-supplied `05-terre-nette-etoiles-5s.mp4` | Source and redistribution terms not supplied | The opening Earth shot plays muted |
| Landing page Earth background | `public/assets/illustrations/entry-earth.webp` | Reconstructed from the supplied landing page mockup with ImageGen | Source mockup supplied by the project | Decorative background |
| Landing page role portraits | `public/assets/photos/entry-astronaut.webp`, `entry-cmo.webp`, `entry-ground.webp` | Cropped from the supplied landing page mockup. The astronaut portrait was retouched with ImageGen to remove the selection marker | Source mockup supplied by the project | Decorative images with separate HTML role labels |
| Today cockpit background | `public/assets/illustrations/today-cockpit.mp4` | User-supplied `cockpit-terre-rotation-5s (1).mp4` | Source and redistribution terms not supplied | Decorative background, muted and looped |
| Body front render | `public/assets/illustrations/body-front.webp` | Kit render of the original stylised mannequin | Kit asset (Synergy 5) | None. Region markers are overlaid in % coordinates of the 640×900 frame; the full region list is HTML buttons |
| 3D anatomy, female and male | `public/assets/models/anatomy-female.glb`, `anatomy-male.glb` (1.4 MB each) | **HuBMAP Human Reference Atlas, 3D Reference Object Library**: "united" female and male reference bodies v1.10 ([female](https://cdn.humanatlas.io/digital-objects/ref-organ/united-female/latest/assets/3d-vh-f-united.glb), [male](https://cdn.humanatlas.io/digital-objects/ref-organ/united-male/latest/assets/3d-vh-m-united.glb)), modelled by Kristen Browne and colleagues from the NLM Visible Human data; brain from the Allen Human Reference Atlas | **CC BY 4.0** (licence stated in the dataset metadata, publisher HuBMAP). Credit shown under the viewer and here | Built by `tools/build-anatomy-hra.mjs`: ten systems kept (skin, brain, eyes, heart, blood vessels, lungs and airways, kidneys and ureters, spine/pelvis/leg bones, knee muscles, digestive organs), each baked to world space, merged, simplified from about 7 million to 290,000 triangles, normals recomputed, meshopt-compressed. Colours and all motion are added by QUINTA |
| Male mockup body shell | `public/assets/models/mock-shell-male.glb` (4.99 MB) | `HEXTA-lot4/body.txt`, base64 decoded | GLB metadata: authored by Innerscene Corp, dedicated to the public domain under **CC0 1.0** | Aligned to the HuBMAP organ layers; a shader creates a transparency window at the selected region |
| Female mockup body shell and normal map | `public/assets/models/mock-shell-female.bin` (5.9 MB), `mock-shell-female-normal.jpg` (109 kB) | `HEXTA-lot4/woman.txt` and `img/woman_n.jpg` | **Source and redistribution rights are not established. Local visual prototype only; clear rights or replace these two files before publishing or pushing them to a shared repository.** | Base64 decoded, aligned to the HuBMAP layers, with a transparency window at the selected region |
| Body & Risks navigation icon | `resources/images/body-risks.png` | Provided by the project | Project-supplied artwork | Its alpha channel masks the theme’s navigation color |
| Figtree, Young Serif, IBM Plex Mono (woff2) | `resources/fonts/` → bundled by Vite | Reused from the mockup `QUINTA-lot4/fonts/` | SIL Open Font License 1.1 (Google Fonts families). Served locally, no CDN | Subsetting as delivered in the mockup |
| three.js r180, GLTFLoader, meshopt decoder, RoomEnvironment | npm `three@0.180.0` (lazy chunk `body3d-*.js`) | three.js authors | MIT | None |
| Dexie.js 4 | npm `dexie` | Dexie authors | Apache-2.0 | None |
| Laravel 13, Vite 8, laravel-vite-plugin | Composer / npm | Laravel, Vite teams | MIT | None |

## Animation decision

The team asked for a more visual, rotating anatomy with a female and a male body. The male mockup provides its exterior. HuBMAP provides the internal organs and the default female exterior. The female mockup shell is an optional local preview asset and is excluded from the shared repository.

All motion is therefore **procedural and written for QUINTA**: turntable rotation, heartbeat, breathing, a light band sweeping the selected system, and a scan line on the skin. It is labelled in the UI as an illustration, independent of any crew member's measurements. Motion starts paused with `prefers-reduced-motion`, and there is an explicit Play / Pause button.

The local shell registration keeps the brain and heart uniformly scaled, preserving the source proportions and orientation. Each eye is fitted separately and uses a procedural sclera, iris and pupil. Leg registration uses triangle-plane cross-sections of the reference skin and the selected shell, separately for each leg, with an inset for bones and muscles. Long layers use a transparent silhouette. The male shell writes exterior depth so its oral cavity does not render over the face. No source model or texture is replaced by these rendering changes.

Earlier iterations (kit mannequin with an original heart, then a BodyParts3D build) were removed from `public/`.

## Not integrated

| Asset | Reason |
|---|---|
| `reference/QUINTA-lot4/img/iss.jpg, mars.jpg, moon.jpg, rover.jpg` | Origin and rights not documented in the kit; multi-environment selector is an extension |

## Symptom photos

Photos attached to a symptom report are user content stored in IndexedDB only (never in `public/`, the service worker cache or a ground report). The demo offers `public/assets/illustrations/simulated-skin-mark.webp` (20 kB), generated with the built-in ImageGen tool on 2026-11-14. It depicts a synthetic training mannequin, with the visible label "SIMULATED IMAGE · NOT A REAL PERSON". It replaces the old canvas drawing. The final prompt and integration decisions are recorded in `docs/ROLE_REDESIGN.md`. Connected account attachments are stored privately on the onboard Laravel server, behind the account’s mission and record authorization; they are excluded from report snapshots.

## Data

All crew records are **simulated** (versioned demo dataset `demo-2026.11-v1`, Explore examples). Sources linked from Body & Risks and Help are public NASA HRP, NASA and CSA pages, cited from the cadrage v5.2 reference list (S01–S05, S11, S29, S32, SANS, astronaut exercise, NASA-STD-3001 Vol. 2). Not affiliated with or endorsed by NASA.
