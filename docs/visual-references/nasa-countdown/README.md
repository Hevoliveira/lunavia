# NASA historical visual references — Countdown to Launch

Development references for rebuilding LUNAVIA's five pre-launch scenes. **These are not game
assets.** They are not in `frontend/public`, are not packaged in the iOS app, and must not be
copied there without a rights review (see below).

- `reference-manifest.json` — one entry per file: NASA ID, date, historical context, source page,
  exact download URL, dimensions, SHA-256, credit, caption, what to study, usage label, and the
  download check. It also lists the requested IDs that could not be downloaded and why.
- `contact-sheet.jpg` — every reference on one page, by scene.
- Folders `01-suit-room` … `05-command-module-interior`, and `06-rocket` … `10-moon-surface`
  (see the second half of this file). File names start with the NASA ID.
- `contact-sheet-rocket-earth-moon.jpg` — the Task 1B references on one page.

Collected 2026-10-28. Every file was fetched from its official NASA URL and checked: HTTP 200,
an image content type, and the file decodes as an image (dimensions recorded). No URL was
guessed: each came from the NASA page or the NASA Image Library API record for that ID.

## Sources

- NASA Image and Video Library (images.nasa.gov; files from images-assets.nasa.gov, the `~orig`
  original of each record).
- NASA History Office: Apollo 11 image gallery (Kipp Teague scans) and the Apollo diagrams page.
- NASA image article "Guenter Wendt and the Apollo 11 Crew" (2013).
- The Apollo Lunar Surface Journal (ALSJ) Apollo 11 image library was used for **captions and
  identification only**. NASA has moved the ALSJ to apollojournals.org; its old nasa.gov file
  links now return 404, and apollojournals.org was not reachable from the build environment.

## The references, by scene

| Scene | Primary | Supplemental |
|---|---|---|
| 01 Suit room | KSC-69PC-377 | KSC-69PC-376, KSC-69PC-381, KSC-69PC-373 |
| 02 Launch tower | S69-38660, KSC-69PC-443 | KSC-69PC-0238 |
| 03 Crew access arm | KSC-69PC-399 | 6900547, 6900560 |
| 04 White room | 69-HC-704 | S69-35316 (Apollo 10), S69-25884 (Apollo 9) |
| 05 CM interior | ad005, ad019 (drawings) | ad010 (drawing) |

Historical context, stated exactly:

- **69-HC-704** is the Countdown Demonstration Test of 3 July 1969: the crew are **leaving** the
  spacecraft after the rehearsal. It is not launch-day boarding.
- **S69-35316** is **Apollo 10** launch day at Pad B. **S69-25884** is the **Apollo 9** CDDT at
  Pad A. Use them for the room's architecture, not as Apollo 11 events.
- **KSC-69PC-399**: NASA's caption names Armstrong and Aldrin; the ALSJ names Armstrong and
  Collins. The disagreement is recorded, not resolved.
- **S69-38660**: the ALSJ text prints "S69-38860" but links the S69-38660 file (a typo on that
  page). The ID used here is the NASA History Office gallery's.
- Folder 05 holds **technical drawings** (training manual 1968; Operations Handbook 1969), not
  photographs. The Command Module has no real interior photograph here yet (see gaps).

## Rights and usage

From NASA's Images and Media guidelines (read 2026-10-28):

- NASA imagery is generally not subject to US copyright and may be used for educational or
  informational purposes, including computer graphical simulations. NASA should be credited.
- **Commercial use** must not state or imply NASA endorsement. The NASA insignia, logotype and
  identifiers are protected by law; they are not public domain.
- **Identifiable persons**: commercial use may infringe privacy or publicity rights. Deceased
  astronauts' estates may still hold them. Name tags or historical context can make a person
  identifiable even when the face is hidden.
- Third-party material (for example, scans credited to a private person) is not covered by
  NASA's permission.

Each file carries one label:

- **VISUAL REFERENCE ONLY** — identifiable people and/or NASA insignia. Study only. Never put
  these people, their name tags, or NASA insignia into the game or its promotion.
- **POSSIBLY REUSABLE WITH REVIEW** — no identifiable people. Even so, for a commercial game,
  model from them rather than copying pixels, and check credits and marks first.
- **REQUIRES FURTHER RIGHTS CLEARANCE** — not used for any file here.

LUNAVIA's own vehicle (LV-001), crew and insignia stay its own. These photographs inform shape,
scale, materials and procedure; they are not to be replicated as Apollo, Saturn V or NASA.

## Gaps (requested, not downloaded)

69-H-1129, 69-H-1131, S69-38658, KSC-69PC-366, KSC-69PC-338, 69-HC-717 and Apollo 11 in-flight
CM interior photographs are only on the ALSJ. Official replacements were used where they exist;
see `requested_but_not_downloaded` in the manifest. To get the originals, allow
`apollojournals.org` in the environment's network settings and rerun the download.

---

# Rocket, launch complex, Earth and Moon (Task 1B)

Five more folders, collected 2026-10-28 with the same checks (HTTP 200, image content type,
decodes, dimensions and SHA-256 in the manifest). Every file came from the NASA Image Library
API record for its ID (`images-api.nasa.gov/search?nasa_id=…` and `/asset/…`); no URL was guessed.

| Folder | What | Primary |
|---|---|---|
| `06-rocket` | Saturn V at launch; MSFC cutaways of the vehicle and each stage; the F-1 | S69-39525, S69-39961, 9903403, 6862832 |
| `07-launch-complex` | Pad 39A from construction to launch; mobile launcher; flame trench | 6900846, KSC-69P-446, 6760617 |
| `08-earth` | Earth from space: full disc, limb, terminator, sun glint, cloud composite | as17-148-22727, iss061e123823 |
| `09-moon-global` | Whole-disc Moon views (photographs and LRO renderings) | as17-152-23311, e001939 (far side) |
| `10-moon-surface` | Tranquility, Hadley–Apennine, Tycho, far side (King crater) | as10-29-4321, S71-44671, as15-89-12100, e001873, as16-120-19228 |

**LV-001 is LUNAVIA's own, fictional vehicle.** The Saturn V files are engineering inspiration
(stage proportions, engine layout, panels, umbilicals, launch lighting). They are not a reason to
replace or copy the approved LV-001, and Saturn V markings ("USA", flags) are not used.

## Launch-day versus preparation

| File | Configuration |
|---|---|
| s69-39525, S69-39961, S69-39959, 6900540, KSC-69P-446 | **Apollo 11 launch day**, 16 July 1969: arms swinging away, MSS gone, ignition |
| 6900846 | Apollo 11 **after rollout**, 20 May 1969: Mobile Service Structure still beside the vehicle |
| S69-38660 in `02-launch-tower` (Task 1) | Apollo 11 at the pad, 1 July 1969, MSS adjacent (not duplicated here) |
| 6760617 | **Apollo 4** (SA-501), Nov 1967, same pad and mobile launcher generation |
| S69-27741 | **Apollo 10** rolling out to **Pad B**, March 1969 |
| 64C-5545 | Pad 39A **under construction**, Nov 1965: trench and mound, no hardware |
| KSC-2009-3313 | Flame trench in **2009** (Shuttle era, modified from Apollo) |

## Mapping: none of these files is a texture map or a heightmap

- Photographs and renderings here are **local or whole-disc views**. None is equirectangular, and
  none carries elevation. A photograph must never be used as a heightmap.
- `e001939` (far side) is an **orthographic** view centred on 180° E, 0°: not a map projection
  usable on a sphere without reprojection.
- `GSFC…e002131` (Blue Marble 2007) is a **composite render** with clouds, not a photograph and
  not the flat map.

The game's existing planet maps are separate and already documented in
`frontend/public/textures/planets/SOURCES.md` (built by `frontend/scripts/planets/prepare_textures.py`):

- `moon_color_4k.jpg`: SVS 4720 CGI Moon Kit `lroc_color_poles_8k.tif`, equirectangular,
  2:1, longitude −180°…180° centred on 0°, north up.
- `moon_normal_2k.jpg`: derived from `ldem_16_uint.tif` (16 px/°, uint16 heights;
  units and offset as documented on the SVS 4720 page).
- `earth_day_4k.jpg`, `earth_aux_4k.jpg`: Blue Marble, equirectangular. The aux map packs
  water mask, city lights and clouds; the Blue Marble day map itself has no clouds, atmosphere
  or elevation.

Keep these maps as they are: equirectangular, not rotated or mirrored. Reprojection or flipping
belongs to the shader/UV mapping, not to the image.

## Large files

Originals over 2.5 MB are **not committed**. The committed file is then NASA's own `~large`
derivative from the same record (`committed_version` in the manifest). For each, the manifest's
`original` block keeps the URL, byte size, dimensions and SHA-256, so the original can be fetched
and checked again:

```
curl -sSfLO "<original.url from the manifest>"
sha256sum <file>   # must equal original.sha256
```

Folders 06–10 total about 28 MB.

## Requested but not downloaded

The environment's network policy refused these hosts, and no third-party copy was used in
their place (manifest: `task_1b_blocked_sources`):

| Wanted | Official source | To get it |
|---|---|---|
| Blue Marble NG 5400×2700 JPEG | science.nasa.gov (files on assets.science.nasa.gov / eoimages.gsfc.nasa.gov) | allow those hosts |
| CGI Moon Kit: `lroc_color_2k.jpg`, `lroc_color_16bit_srgb_4k.tif`, `ldem_4_uint.tif` | svs.gsfc.nasa.gov/4720 | allow svs.gsfc.nasa.gov |
| LROC local downloads (Tranquility, Hadley, Tycho, far side) | lroc.im-ldi.com/images/downloads | allow lroc.im-ldi.com, www.lroc.asu.edu |
| S69-38658, KSC-69PC-366 | Apollo Lunar Surface Journal | allow apollojournals.org |
| KSC-69PC-419 | not found in any reachable NASA source | ID needs confirmation |

LRO/LROC images that NASA also publishes in the Image Library (PIA12909, PIA12941, PIA12945 and
the GSFC LRO releases) are used for the local terrain instead; they are official, not substitutes
from a third party.

## Rights (Task 1B)

Same rules as above. In addition:

- Most files here show no people and are labelled **POSSIBLY REUSABLE WITH REVIEW**. 6760478
  shows a worker and is **VISUAL REFERENCE ONLY**.
- LRO images credit **NASA/GSFC/Arizona State University**; KSC-2009-3313 credits
  **NASA/Jim Grossmann**; the Blue Marble 2007 render credits **NASA/GSFC/Reto Stöckli**.
  Keep those credits with any derivative.
- Vehicle markings (USA, US flag) and any NASA insignia are not to be reproduced on LV-001.

---

# Where these references went (NASA-inspired visual upgrade)

The references above informed procedural geometry and shaders; no reference photograph is shown
in the game, and none of these files is in the iOS bundle.

| Reference | Used for | Code |
|---|---|---|
| 64C-5545, 6900846, S69-27741, KSC-69P-446 | Raised hardstand 15 m above the land, flame trench through it, crawlerway ramp, pad layout | `frontend/src/components/scenes/launchSite.js` |
| KSC-2009-3313, 6760617 | Trench walls (refractory panels, soot), deflector under the engines, launcher deck over the hole | `launchSite.js`, `LaunchComplex.jsx` |
| S69-38660, KSC-69PC-443 (Task 1) | Tower piping, cable tray, stairs, equipment rooms; hold-down arms | `LaunchComplex.jsx` |
| S69-39961, S69-39959, 9903403 | LV-001 skin: irregular panel seams, weld lands, oil-canning, access panels (LV-001's own white, orange and black kept) | `frontend/src/components/RocketModel.jsx` |
| as17-148-22727, ast-19-1555, iss061e123823 | Earth: the NASA cloud map's real systems shown through one cover curve (globe and launch film) | `components/planets/planetMaterials.js`, `scenes/launch/environment.js` |
| as17-152-23311, e000868, e001939 | Moon: albedo contrast of maria and highlands, crisper LRO colour | `planetMaterials.js` |
| as10-29-4321, PIA12909, S71-44671, as16-120-19228 | Crater relief below the mesh in descent, neutral regolith, mottled rocks | `components/scenes/LunarSite.jsx` |

LV-001, the complex's layout and the assembly building remain LUNAVIA's own: no NASA insignia,
no Saturn V markings, no copied photograph.
