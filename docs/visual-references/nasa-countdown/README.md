# NASA historical visual references — Countdown to Launch

Development references for rebuilding LUNAVIA's five pre-launch scenes. **These are not game
assets.** They are not in `frontend/public`, are not packaged in the iOS app, and must not be
copied there without a rights review (see below).

- `reference-manifest.json` — one entry per file: NASA ID, date, historical context, source page,
  exact download URL, dimensions, SHA-256, credit, caption, what to study, usage label, and the
  download check. It also lists the requested IDs that could not be downloaded and why.
- `contact-sheet.jpg` — every reference on one page, by scene.
- Folders `01-suit-room` … `05-command-module-interior`. File names start with the NASA ID.

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
