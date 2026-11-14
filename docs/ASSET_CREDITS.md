# Asset credits and rights

Every asset actually shipped in `public/` or bundled from `resources/` is listed here. Assets left out on purpose are listed at the end.

| Asset | Where | Origin | Rights / attribution | Changes |
|---|---|---|---|---|
| QUINTA logo, symbol, app icons, favicon | `public/assets/brand/` | Synergy 5 team (kit `public/assets/brand/quinta-logo.svg`, team archive `logo/`) | Team property, used by the team | None |
| Lunar window scene | `public/assets/illustrations/lunar-window.webp` | Generated for the QUINTA kit | Declared as **AI-generated mission illustration** (credit shown on the entry screen and in Help) | None. Decorative only (`alt=""`, `aria-hidden`) |
| Body front render | `public/assets/illustrations/body-front.webp` | Kit render of the original stylised mannequin | Kit asset (Synergy 5) | None. Region markers are overlaid in % coordinates of the 640×900 frame; the full region list is HTML buttons |
| 3D anatomy, female and male | `public/assets/models/anatomy-female.glb`, `anatomy-male.glb` (1.4 MB each) | **HuBMAP Human Reference Atlas, 3D Reference Object Library**: "united" female and male reference bodies v1.10 ([female](https://cdn.humanatlas.io/digital-objects/ref-organ/united-female/latest/assets/3d-vh-f-united.glb), [male](https://cdn.humanatlas.io/digital-objects/ref-organ/united-male/latest/assets/3d-vh-m-united.glb)), modelled by Kristen Browne and colleagues from the NLM Visible Human data; brain from the Allen Human Reference Atlas | **CC BY 4.0** (licence stated in the dataset metadata, publisher HuBMAP). Credit shown under the viewer and here | Built by `tools/build-anatomy-hra.mjs`: ten systems kept (skin, brain, eyes, heart, blood vessels, lungs and airways, kidneys and ureters, spine/pelvis/leg bones, knee muscles, digestive organs), each baked to world space, merged, simplified from about 7 million to 290,000 triangles, normals recomputed, meshopt-compressed. Colours and all motion are added by QUINTA |
| Figtree, Young Serif, IBM Plex Mono (woff2) | `resources/fonts/` → bundled by Vite | Reused from the mockup `QUINTA-lot4/fonts/` | SIL Open Font License 1.1 (Google Fonts families). Served locally, no CDN | Subsetting as delivered in the mockup |
| three.js r180, GLTFLoader, meshopt decoder, RoomEnvironment | npm `three@0.180.0` (lazy chunk `body3d-*.js`) | three.js authors | MIT | None |
| Dexie.js 4 | npm `dexie` | Dexie authors | Apache-2.0 | None |
| Laravel 13, Vite 8, laravel-vite-plugin | Composer / npm | Laravel, Vite teams | MIT | None |

## Animation decision

The team asked for a more visual, rotating anatomy with a female and a male body. Ready-made animated anatomy clips found online were either paid marketplace assets or Sketchfab downloads that need an account. The HuBMAP reference bodies are open (CC BY 4.0), exist for both sexes and keep every organ registered in the same frame, but they are static.

All motion is therefore **procedural and written for QUINTA**: turntable rotation, heartbeat, breathing, a light band sweeping the selected system, and a scan line on the skin. It is labelled in the UI as an illustration, independent of any crew member's measurements. Motion starts paused with `prefers-reduced-motion`, and there is an explicit Play / Pause button.

Earlier iterations (kit mannequin with an original heart, then a BodyParts3D build) were removed from `public/`.

## Not integrated

| Asset | Reason |
|---|---|
| `reference/QUINTA-lot4/body.txt` (base64 GLB, ~4.99 MB, metadata "Innerscene, CC0") | Skin only, no organs; replaced by the HuBMAP bodies |
| `reference/QUINTA-lot4/woman.txt` (~5.9 MB decoded mesh) and `img/woman_n.jpg` | Licence of mesh and texture unconfirmed |
| `reference/QUINTA-lot4/img/iss.jpg, mars.jpg, moon.jpg, rover.jpg` | Origin and rights not documented in the kit; multi-environment selector is an extension |

## Symptom photos

Photos attached to a symptom report are user content stored in IndexedDB only (never in `public/`, the service worker cache or a ground report). The demo offers a **simulated image** drawn in the browser (labelled "SIMULATED IMAGE", not a real person).

## Data

All crew records are **simulated** (versioned demo dataset `demo-2026.11-v1`, Explore examples). Sources linked from Body & Risks and Help are public NASA HRP, NASA and CSA pages, cited from the cadrage v5.2 reference list (S01–S05, S11, S29, S32, SANS, astronaut exercise, NASA-STD-3001 Vol. 2). Not affiliated with or endorsed by NASA.
