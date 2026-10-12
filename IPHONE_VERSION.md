# LUNAVIA for iPhone: this download

This folder installs **BUILD 91c520e**.

When it is installed, the first screen of LUNAVIA shows, at the top left:

> **LUNAVIA iOS · BUILD 91c520e · 2026-10-12 11:05 UTC**

If your iPhone shows any other BUILD, it is not running this download. For example, **cb874af** is the old `claude/ios-app` download from 10 October. How to install and update: **INSTALL_ON_IPHONE.md**.

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
| Lunar landing sites (Tranquillitatis, Fra Mauro, Hadley–Apennine, Tycho) | #8 | 967162b |
| Release build tooling (this branch) | — | 91c520e |

## How this bundle was made and checked

- **Built from a clean checkout of 91c520e**, with dependencies installed from the lockfile (`yarn install --frozen-lockfile`).
- **Reproducible.** A second clean build gave byte-identical files (239 of them).
- **No game changes.** Apart from the BUILD label, the game code is exactly that of #8.
- **`yarn ios:verify` passes.** It checks that:
  - the label in the game and `frontend/ios/App/App/public/build-info.json` agree;
  - no old bundles are left;
  - there is no server URL, so the app plays from its own files;
  - Xcode copies the bundle into the app;
  - every feature above is in the bundled game.
