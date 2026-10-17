# LUNAVIA for iPhone: this download

This folder installs **BUILD 57770c4**.

When it is installed, the first screen of LUNAVIA shows, at the top left:

> **LUNAVIA iOS · BUILD 57770c4 · 2026-10-17 22:24 UTC**

If your iPhone shows any other BUILD, it is not running this download. For example:
- **de30822** is the previous release: the launch started by itself when LUNAVIA opened,
  without the THE ROAD TO THE MOON startup screen;
- **902db61** is the previous release: the four official missions, but MISSIONS came first and
  the launch only started from a mission-control screen (LAUNCH SEQUENCE — INITIATE);
- **af89907** is the previous release: the direct cut to lunar orbit, but every full mission
  landed at the Sea of Tranquility, and the four destinations were training exercises only;
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
| Four official lunar missions: MISSIONS (01 Sea of Tranquility, introductory; 02 Hadley–Apennine, intermediate; 03 Tycho Highlands, advanced; 04 Silent Horizon, expert, far side), then the pilot difficulty; the whole mission flies to the chosen destination. The Flight Training Center keeps lunar landing training at the Sea of Tranquility only | #18 | 39625fa, 902db61 |
| Opening first: LUNAVIA opens on the launch (Earth departure, direct cut to lunar orbit, deployment, undocking, title); START MISSIONS then opens MISSIONS / TRAINING, and a mission continues from lunar orbit to its destination | #18 | 0dcc555, de30822 |
| Startup screen restored: LUNAVIA opens on THE ROAD TO THE MOON and the launch starts only when you press LAUNCH SEQUENCE — INITIATE | #18 | 57770c4 |

## How this bundle was made and checked

- **Built from the clean tree at 57770c4** with `yarn ios:sync`. The build is reproducible: the label carries the commit's own time, so rebuilding this commit gives identical files.
- **This release restores the startup screen; everything after the launch is unchanged.**
  1. Open LUNAVIA and you see THE ROAD TO THE MOON (LV-001 · READY FOR LAUNCH, mission control). It waits for as long as you like; nothing starts by itself.
  2. Press **LAUNCH SEQUENCE — INITIATE**. The launch starts, once: liftoff, ascent, staging, Earth orbit, translunar injection and "Cutoff.".
  3. Two seconds later the film cuts to lunar orbit and CAPCOM welcomes the crew. The deployment, the undocking, the go for powered descent and LUNAVIA / A LAJU PRODUCTIONS GAME follow.
  4. **START MISSIONS** opens **MISSIONS** (the four official missions) or **TRAINING**.
  - ABORT, the end of a mission and MAIN MENU bring you back to MISSIONS / TRAINING.
  - LAUNCH in the navigation bar, or reopening the app, shows THE ROAD TO THE MOON again, waiting for the button.
- **Records are kept.** New: the last mission chosen, and a log of the official missions flown (destination, difficulty, landing, completion), kept on the iPhone apart from the training records.
- **`yarn ios:verify` passes.** It checks that:
  - the label in the game and `frontend/ios/App/App/public/build-info.json` agree;
  - no old bundles are left;
  - there is no server URL, so the app plays from its own files;
  - Xcode copies the bundle into the app;
  - every feature above is in the bundled game, including the startup screen (THE ROAD TO THE MOON, LAUNCH SEQUENCE — INITIATE), the direct cut to lunar orbit, the MISSIONS / TRAINING menu and the four official missions; it also fails if any removed travel shot, or the four destinations as training exercises, is still in the bundle.
