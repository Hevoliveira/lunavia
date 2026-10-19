# LUNAVIA for iPhone: this download

This folder installs **BUILD 96a87a6**.

When it is installed, the first screen of LUNAVIA shows, at the top left:

> **LUNAVIA iOS · BUILD 96a87a6 · 2026-10-19 19:02 UTC**

If your iPhone shows any other BUILD, it is not running this download. For example:
- **af797cc** is the previous release: the photorealistic Earth and Moon, but the docking had no
  assists (no AUTO-ALIGN on demand, STABILIZE, APPROACH SPEED ASSIST or soft capture), and a held
  jet button fired at full thrust at once;
- **4061929** is the previous release: the docking ports made clear, but the Earth and the Moon
  still used the old low-resolution textures (a glowing halo round the Earth, a Moon lit from all
  sides with no true terminator);
- **4bd83f2** is the previous release: mission scoring, medals and achievements, but the docking
  ports were not marked (no TARGET DOCKING PORT marker, approach corridor, capture conditions or
  FOCUS DOCKING PORTS);
- **f9b4dd4** is the previous release: the four docking views, but no mission scores, medals,
  achievements, mission debrief or flight records;
- **6bf030a** is the previous release: RESTART DOCKING and the docking guidance, but the docking
  had one view (the navigation display) and a fixed outside camera;
- **af6a1c4** is the previous release: the lunar ascent, the rendezvous and the docking, but
  no RESTART DOCKING button and no DOCKING GUIDANCE panel;
- **57770c4** is the previous release: the startup screen and the four missions, but a mission
  went straight home after the landing (no lunar ascent, rendezvous or docking);
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
| Lunar ascent, orbital rendezvous and playable docking: after the landing, ascent preparation and liftoff (the descent stage stays on the Moon), the automatic rendezvous with the CSM, and the docking flown by the player (translation, attitude, closing speed), then crew transfer and the ascent stage's jettison before the return | #19 | 48420db, af6a1c4 |
| RESTART DOCKING (hold, at any time in the approach; back to the final-approach checkpoint, never the ascent) and the live DOCKING GUIDANCE panel (one instruction at a time from the docking telemetry: step 1–5, the correction, the button to press, a confirmation; by difficulty; GUIDANCE ON/OFF; Mission Control calls) | #20 | 77c98e5, 6bf030a |
| Four docking views: NAV (the navigation display, as before), WINDOW (first person through the overhead docking window), COCKPIT (the 3D cabin with live instruments) and 360° (a free camera around the ascent stage: drag, pinch, RESET CAMERA), all on the one docking simulation | #21 | f9b4dd4 |
| Mission scoring, medals and achievements: 1,000 points (lunar landing 400, docking 300, reentry 300) from what each phase measured; BRONZE, SILVER, GOLD and PLATINUM (PLATINUM on COMMANDER); 17 achievements; personal records for each destination and difficulty; the MISSION DEBRIEF after splashdown; FLIGHT RECORDS (medals and records, achievements, mission log) | #22 | e0bf765, 4bd83f2 |
| Docking ports made clear: the CSM's receiving port and your drogue marked on the real interfaces, the TARGET DOCKING PORT marker (hidden, out-of-window and off-screen conventions), the approach corridor, port-to-port alignment, the approach status, the FINAL APPROACH capture conditions from the physics' own tolerances, the cause of a failed contact, and FOCUS DOCKING PORTS in 360° | #23 | 4061929 |
| Photorealistic Earth and Moon: NASA imagery shipped in the app (Blue Marble, City Lights and Blue Marble clouds for the Earth; the LRO colour mosaic and LOLA relief for the Moon), a thin sunlit atmospheric limb, a dark night side with city lights, a true lunar terminator, one Sun per scene, in every scene (launch, lunar orbit, docking, landing-site sky, far-side intro, return, reentry) | #24 | af797cc |
| Assisted docking: AUTO-ALIGN, STABILIZE and the APPROACH SPEED ASSIST (CADET; STABILIZE on ASTRONAUT), a forgiving but real soft capture for CADET, a calmer CADET starting point, gentler held jet buttons and FINE control, and the six-step CADET docking sequence on screen | #25 | 96a87a6 |

## How this bundle was made and checked

- **Built from the clean tree at 96a87a6** with `yarn ios:sync`. The build is reproducible: the label carries the commit's own time, so rebuilding this commit gives identical files.
- **This release makes the docking playable on the iPhone; nothing else changes** (the landing, the ascent, the spacecraft, the planets, the return and reentry are as before).
  - **CADET**, the recommended sequence, shown on screen with ticks:
    1. Press **AUTO-ALIGN**: the RCS turns the ascent stage onto the docking axis and holds it (AUTO-ALIGN ACTIVE, then DOCKING AXIS ALIGNED). It does not move you sideways or forward.
    2. Press **STABILIZE**: the RCS cancels the sideways drift and the rotation (STABILIZATION ACTIVE, then RELATIVE MOTION STABLE), and then keeps holding. Your taps still work: a tap sets a steady slide, and STABILIZE keeps it.
    3. Check that the target is aligned (the guidance says which way to tap).
    4. Tap **FWD** a few times.
    5. The **APPROACH SPEED ASSIST** (on by default) keeps the closing speed safe for the distance and brakes as you get close. FWD will not push past the limit, and the assist never pushes you forward.
    6. **SOFT CAPTURE**: the probe latches even with small errors, and the mechanism pulls the two vehicles together and lines them up, then HARD DOCK CONFIRMED.
  - **CADET starts closer and calmer:** 22 m out, within a metre of the axis, barely drifting.
  - **ASTRONAUT:** STABILIZE is there when you want it. It cancels the drift once and hands control back; any translation command cancels it. The tolerances are as before.
  - **COMMANDER:** fully manual, as before (no assists).
  - **Jet buttons, all difficulties:**
    - A tap is one small pulse, as before.
    - Holding starts gently (about a third of the thrust) and builds to full in about 2 s.
    - **FINE** (top-left of the pad) makes every press a third as strong, for the last metres.
    - No jet stays on if the app loses the screen.
  - **On screen:** the assists' state above the guidance panel (AUTO-ALIGN: ACTIVE · STABILIZE: HOLDING · APPROACH ASSIST: ACTIVE · you fly the translation and FWD/AFT). Each assist button shows what it is doing. The four views, the port markers, the approach corridor and RESTART DOCKING are unchanged. RESTART DOCKING also switches the assists back to how the attempt starts.
- **As in the previous releases:** the photorealistic Earth and Moon; the docking ports made clear (TARGET DOCKING PORT, the approach corridor, the capture conditions, FOCUS DOCKING PORTS); mission scoring, medals, achievements and FLIGHT RECORDS; the four docking views; **RESTART DOCKING** (hold it) and the **DOCKING GUIDANCE** panel.
- **How a mission goes after the landing** (as in the previous release):
  1. After a successful landing, **CONTINUE MISSION** shows **LUNAR SURFACE — ASCENT PREPARATION**: the checklist ticks in, and nothing starts until you press **INITIATE LUNAR ASCENT**.
  2. A short countdown, then **PROCEED**. The ascent stage leaves the descent stage, which stays on the Moon with its legs, and climbs away. SKIP CINEMATIC goes on to orbit.
  3. **Orbit insertion** and the **automatic rendezvous**: the radar range falls from 48 km as the guidance flies the terminal phase, a midcourse correction and the braking. SKIP CINEMATIC goes to the hand-over.
  4. **LUNAVIA — DOCKING OPERATIONS:** you fly the ascent stage onto the CSM's docking probe.
     - Left pad: **▲ ▼ ◀ ▶** move it up, down, left and right. Right buttons: **FWD / AFT** (closing speed).
     - **MODE** switches the pad to **ATTITUDE** (pitch and yaw; the right buttons roll).
     - A tap is one small RCS pulse; holding keeps the jets firing. Two fingers work together.
     - **NAV | WINDOW | COCKPIT | 360°** choose the view (in NAV, the cyan circle on the reticle is the probe tip).
     - The panel top right shows your port's offset (dot) and the attitude (cross) against the capture circle, INSIDE / OUTSIDE CORRIDOR, and the capture conditions (all green: PROCEED WITH FINAL APPROACH).
     - CADET: **AUTO-ALIGN**, **STABILIZE** and the **APPROACH SPEED ASSIST** help (see above). ASTRONAUT: the attitude holds still when you let go, and **STABILIZE** cancels a drift once. COMMANDER: nothing holds; you stop what you start.
     - Too fast, off the axis, misaligned or rotating: no capture, and the vehicles push apart. Back off and try again. A hard impact or a collision ends the attempt: **RESTART DOCKING** (no new landing or launch).
  5. **HARD DOCK CONFIRMED**, crew transfer, the ascent stage jettisoned, then the return and reentry as before. MISSION COMPLETE needs the docking.
  - Silent Horizon (far side): no Houston on the surface or after insertion, until the rendezvous brings you back into view of the Earth. The guidance panel works throughout.
- **Records are kept on the iPhone:** the mission log (every flight: landing, docking, reentry, score, medal, how it ended) and the flight records (best scores and medals, achievements). Flights from earlier releases stay in the log (marked as flown before mission scoring) and keep what they proved (for example FIRST FOOTPRINT), without an invented score.
- **`yarn ios:verify` passes.** It checks that:
  - the label in the game and `frontend/ios/App/App/public/build-info.json` agree;
  - no old bundles are left;
  - there is no server URL, so the app plays from its own files;
  - Xcode copies the bundle into the app;
  - every planet texture the game loads is in the bundle, is a valid image and is identical to the source copy; the old textures are gone; the NASA sources (`SOURCES.md`) are bundled;
  - every feature above is in the bundled game, including the docking assists (AUTO-ALIGN, STABILIZE, the speed assist, soft capture, FINE, the CADET sequence in Portuguese), the photorealistic Earth and Moon, the docking-port markers (English and Portuguese), FOCUS DOCKING PORTS, the capture conditions and the approach corridor, the mission debrief (English and Portuguese), the medals, the achievements and the flight records, the four docking views, RESTART DOCKING and the docking guidance, the startup screen (THE ROAD TO THE MOON, LAUNCH SEQUENCE — INITIATE), the direct cut to lunar orbit, the MISSIONS / TRAINING menu and the four official missions; it also fails if any removed travel shot, or the four destinations as training exercises, is still in the bundle.
