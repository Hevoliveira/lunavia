# LUNAVIA for iPhone: this download

This folder installs **BUILD af89907**.

When it is installed, the first screen of LUNAVIA shows, at the top left:

> **LUNAVIA iOS · BUILD af89907 · 2026-10-13 20:30 UTC**

If your iPhone shows any other BUILD, it is not running this download. For example:
- **d25ef56** is the previous release: it still played the whole Earth-to-Moon travel (the
  upper stage's separation, the translunar coast, deep space and the midcourse correction,
  the approach and the insertion burn);
- **33d6f8c** is the previous release: the carrier's main engine and the burns, but the
  assembly coasted 65–80° off its direction of travel (it seemed to fly sideways), and the
  midcourse correction fired without turning into a burn attitude;
- **e85ea35** is the previous release: the deployment in lunar orbit and the START MISSIONS title
  screen, but the Moon-bound assembly had no visible main engine and coasted broadside;
- **8224e36** is the previous release: the true-scale coast and the title inside the mission,
  but the lunar module and the CSM still left the rocket near the Earth (the transposition
  after TLI), and the title went straight on to the descent setup by itself;
- **532885b** is the release before: the lunar module in the rocket and the transposition,
  but the opening before the menu and the old Earth-to-Moon transition (the jump to a giant
  Earth, the dark frames and the fade to black before lunar orbit);
- **11618a2** is an earlier release: the shared spacecraft and the opening, but no lunar
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
| Lunar deployment: the LM and CSM stay integrated to the Moon on a lunar transfer carrier (only the spent upper stage separates after TLI), the carrier's insertion burn, the deployment in lunar orbit, and a persistent title screen with START MISSIONS | #14 | e85ea35 |
| Outbound propulsion: the carrier's visible main engine, travel attitudes (engine back at the Earth, nose to the Moon, then engine first), a midcourse correction burn and the insertion burn on the main engine | #15 | 33d6f8c |
| Translunar attitude: nose forward along the flight path after TLI, and the midcourse correction as a real maneuver (RCS turn into the burn attitude, main-engine burn, turn back) | #16 | d25ef56 |
| Direct cut: the Earth departure ends 2 s after GUIDANCE's "Cutoff." and the film cuts straight to lunar orbit, where CAPCOM welcomes the crew (the translunar travel sequence removed) | #17 | af89907 |

## How this bundle was made and checked

- **Built from the clean tree at af89907** with `yarn ios:sync`. The build is reproducible: the label carries the commit's own time, so rebuilding this commit gives identical files.
- **This release shortens the film between the Earth and the Moon; it does not change how you fly.**
  - The launch plays as before up to translunar injection. GUIDANCE says "Cutoff.", the departure shot stays 2 seconds more, then a brief fade to black.
  - The next scene is LUNAR ORBIT (T+80:00:00): CAPCOM says "LUNAVIA, Houston. Lunar orbit insertion looks good. Welcome to the Moon."
  - No travel between the two is shown any more: no upper-stage separation shot, translunar coast, deep space, midcourse correction, lunar approach or insertion burn.
  - SKIP CINEMATIC during the launch goes to the same arrival.
  - The lunar-orbit deployment, the undocking, the title screen and START MISSIONS, the four missions, descent, return, reentry and training are unchanged.
- **Records are kept.** Nothing new is stored.
- **`yarn ios:verify` passes.** It checks that:
  - the label in the game and `frontend/ios/App/App/public/build-info.json` agree;
  - no old bundles are left;
  - there is no server URL, so the app plays from its own files;
  - Xcode copies the bundle into the app;
  - every feature above is in the bundled game, including the direct cut to lunar orbit; it also fails if any removed travel shot is still in the bundle.
