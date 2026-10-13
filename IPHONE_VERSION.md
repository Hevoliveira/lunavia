# LUNAVIA for iPhone: this download

This folder installs **BUILD 8224e36**.

When it is installed, the first screen of LUNAVIA shows, at the top left:

> **LUNAVIA iOS · BUILD 8224e36 · 2026-10-13 05:54 UTC**

If your iPhone shows any other BUILD, it is not running this download. For example:
- **532885b** is the previous release: the lunar module in the rocket and the transposition,
  but the opening before the menu and the old Earth-to-Moon transition (the jump to a giant
  Earth, the dark frames and the fade to black before lunar orbit);
- **11618a2** is the release before: the shared spacecraft and the opening, but no lunar
  module inside the rocket and no transposition and docking;
- **a360daf** is the four lunar missions release, with the old spacecraft and no opening;
- **718ce0c** is the lunar module fidelity release, without the four missions;
- **cb874af** is the old `claude/ios-app` download from 10 October.

How to install and update: **INSTALL_ON_IPHONE.md**.

## What is in it

Every finished LUNAVIA feature, in the order it was built. The release branch `claude/ios-release` is the last branch of this chain plus the iPhone bundle. Nothing in it has been merged into `main` yet.

| Feature | Pull request | Source commit |
|---|---|---|
| Playable Earth reentry, LV-001 fidelity II | #2 | fee26de |
| iPhone app | #3 | 5fefadb |
| COMMANDER lunar landing rebalance and guidance | #3 | f4373ed |
| Cinematic Earth departure (ignition to TLI), Earth-orbit finale | #3 | e9c666c, 27689db |
| Flight Training Center (landing and reentry scenarios, instructor, debrief, records) | #4 | 6df4448 … 4bdfab9 |
| Mission Control voice (EN/PT, subtitles, AUDIO settings) | #5 | 20eba4f … 8e64f2a |
| Lunar orbit: no spinning Moon, Moon-anchored arrival | #6 | 82a32ff, 22cef22 |
| Lunar touchdown fidelity (final 50 m, legs, dust, CONTACT LIGHT / ENGINE STOP) | #7 | d5e31db |
| Lunar landing sites | #8 | 967162b |
| Release build tooling | — | 91c520e |
| Lunar module visual fidelity (two-stage LM, materials, legs, engine, plume, framing) | #9 | b9e4298, 0c2bd8f, 718ce0c |
| Four lunar missions: Sea of Tranquility, Hadley–Apennine, Tycho Highlands, Silent Horizon (far side, no Earth link) | #10 | 5217691, 16900c0, a360daf |
| One spacecraft from Earth to the Moon (shared CSM, escape tower jettison), lunar module undocking, opening cinematic, Laju Productions credit | #11 | 11618a2 |
| Spacecraft lineage: the lunar module inside LV-001's adapter, transposition, docking and extraction after TLI, lunar approach | #12 | 532885b |
| Cinematic flow: the Earth-to-Moon coast at true scale, lunar orbit insertion burn, the title inside the mission after the go for powered descent, no opening before the menu | #13 | 8224e36 |

## How this bundle was made and checked

- **Built from the clean tree at 8224e36** with `yarn ios:sync`. The build is reproducible: the label carries the commit's own time, so rebuilding this commit gives identical files.
- **This release changes what you see, not how you fly.**
  - The home screen opens straight away, every time: no opening film before the menu, no first-launch flag.
  - The Earth-to-Moon coast is three close shots of the docked spacecraft (departure, deep space, lunar approach) with the planet behind it at its true size: no jump to a giant Earth, no dark frames, no fade to black. On the approach the spacecraft turns engine first.
  - Lunar orbit opens on the insertion burn (the service module's engine firing over the Moon), then the whole Moon, the docked spacecraft and the undocking as before.
  - After the undocking and FLIGHT's "we're go for powered descent", the title LUNAVIA · A LAJU PRODUCTIONS GAME appears over the lunar module moving away, then the descent setup opens. Once per mission; SKIP TO DESCENT goes straight to the descent setup; never in Training.
  - Descent physics, difficulty, touchdown limits, scoring, training, the four missions, the spacecraft and the launch with the transposition are unchanged.
- **Records are kept.** Nothing new is stored; the old `lunavia.opening.seen` flag, if present, is ignored.
- **`yarn ios:verify` passes.** It checks that:
  - the label in the game and `frontend/ios/App/App/public/build-info.json` agree;
  - no old bundles are left;
  - there is no server URL, so the app plays from its own files;
  - Xcode copies the bundle into the app;
  - every feature above is in the bundled game, including the true-scale coast, the insertion burn and the title inside the mission.
