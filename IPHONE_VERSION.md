# LUNAVIA for iPhone: this download

This folder installs **BUILD 532885b**.

When it is installed, the first screen of LUNAVIA shows, at the top left:

> **LUNAVIA iOS · BUILD 532885b · 2026-10-12 23:51 UTC**

If your iPhone shows any other BUILD, it is not running this download. For example:
- **11618a2** is the previous release: the shared spacecraft and the opening, but no lunar
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

## How this bundle was made and checked

- **Built from the clean tree at 532885b** with `yarn ios:sync`. The build is reproducible: the label carries the commit's own time, so rebuilding this commit gives identical files.
- **This release changes what you see, not how you fly.** The lunar module now rides inside LV-001's adapter (the pad's second shot shows it through the adapter). After the TLI burn the launch cinematic continues for 38 seconds: the adapter opens, the CSM turns round, docks with the lunar module and pulls it out, and the upper stage is left behind. SKIP CINEMATIC skips all of it. Before arrival there is a new close shot of the docked spacecraft approaching the Moon. Descent physics, difficulty, touchdown limits, scoring, training and the four missions are unchanged.
- **From the previous release:** the same CSM and LM fly the whole mission; in lunar orbit the LM undocks and the descent setup opens by itself; the opening plays once on first launch.
- **Records are kept.** The opening writes only its own `lunavia.opening.seen` flag.
- **`yarn ios:verify` passes.** It checks that:
  - the label in the game and `frontend/ios/App/App/public/build-info.json` agree;
  - no old bundles are left;
  - there is no server URL, so the app plays from its own files;
  - Xcode copies the bundle into the app;
  - every feature above is in the bundled game, including the lunar module in the adapter, the transposition and extraction, and the lunar approach.
