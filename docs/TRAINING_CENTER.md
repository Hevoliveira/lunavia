# Flight Training Center

The Training Center lets a player practise LUNAVIA's two flight-control problems on their own: the
powered lunar descent and the Earth reentry. There is no launch, staging, Earth orbit or lunar
transfer to sit through. The full mission is unchanged.

## Navigation

- **Home screen** (`/`): **FLIGHT TRAINING** in the hero, next to INICIAR MISSÃO, outlined in orange
  and above the fold on landscape phones. **Training** is also in the navbar.
- **`/training`**:
  - Choose the **LUNAR LANDING SIMULATOR** ("Practice descending and landing on the Moon") or the
    **EARTH REENTRY SIMULATOR** ("Practice surviving atmospheric reentry and landing safely in the
    ocean").
  - The header shows attempts, successful attempts, completed slots and the build label.
  - **TRAINING RECORDS** opens the personal bests.
- **Scenario screen**:
  - Pick one of the four scenarios. The briefing shows its situation, objective and what it practises.
  - Choose **CADET**, **ASTRONAUT** or **COMMANDER**. The COMMANDER scenarios are locked to
    COMMANDER.
  - The speaker button is **MUTE INSTRUCTOR**.
  - Then **START TRAINING**.
- **During a run**:
  - The game shows a three-second "STARTS IN" hold. The scene and HUD are live, the physics waits, and
    controls can already be held.
  - Then the mission's own descent or reentry runs.
  - PAUSE and ABORT work as in the mission. ABORT returns to the scenarios.
- **After each attempt**: a debrief with **RETRY**, **CHANGE SCENARIO**, **TRAINING CENTER** and
  **MAIN MENU**.

## Same simulation as the mission

Training mounts the mission's own `DescentGame` and `ReentryGame`. These are unchanged:

- the integrators (`landerSim.js`, `reentryPhysics.js`);
- the difficulty configs (`DIFFICULTY`, `ENTRY_DIFFICULTY`);
- controls, cameras, HUD, guidance, limits, hazards and grading (`gradeLanding`, the reentry outcomes).

A scenario only chooses where the flight starts and what counts as meeting its objective. Objectives
are never easier than a safe mission landing or splashdown. The COMMANDER rebalance is kept (fuel
160, limits 2.0 / 1.2 m/s, tilt 30°/s), and a test fails if the old 105-unit tank comes back.

The games gained optional props:

- `init` / `scenario`: start state;
- `coach`: instructor callout;
- `onResult`: debrief data;
- `holdSeconds`: "starts in" hold.

Without them both behave exactly as in the mission.

## Lunar scenarios

| Scenario | Start | Objective |
|---|---|---|
| Standard landing | the difficulty's mission start (CADET 400 m, ASTRONAUT 550 m, COMMANDER 750 m) | land safely inside the primary LZ (< 6 m) |
| Precision landing | 120 m and braking, 35 m past the LZ across a crater: the reference descent's rate, fuel rounded down and engine on | land safely within 3 m of the LZ centre |
| Braking practice | the mission start after 10 s of coasting engine-off, with the full tank: CADET 279 m at −20 m/s, ASTRONAUT 389 m at −24 m/s, COMMANDER 529 m at −30 m/s; braking burn due in ~5 s | brake in time and land safely |
| COMMANDER challenge (locked) | the COMMANDER mission start | land safely inside the primary LZ |

**Feasibility.** `trainingScenarios.test.js` flies every scenario with the simulated pilots of
`landerPilots.js`. They have reaction lag, minimum tap length, HUD refresh and misreadings, at three
lags and six noise seeds (18 runs each).

| Pilot | Scenarios | Result |
|---|---|---|
| Guided and profile pilots | all | land ≥ 90 % at CADET and ASTRONAUT; ≥ 75 % at COMMANDER, matching the COMMANDER mission itself (78–96 %) |
| Guided pilot | standard, braking, COMMANDER challenge | meets the objective ≥ 90 % (CADET, ASTRONAUT) and ≥ 75 % (COMMANDER) |
| Precision pilot (keeps steering for the centre down to ~2 m) | precision | 100 % within 3 m at CADET and ASTRONAUT, 78 % at COMMANDER |

Braking practice is a real problem: without braking the LM crashes at every difficulty.

## Reentry scenarios

| Scenario | Start | Objective |
|---|---|---|
| Nominal entry | ENTRY PREP, planned EI −6.50°, lift up | trim, commit, fly to splashdown |
| Shallow entry recovery | entry interface, committed at **−5.7°**, lift **up** | avoid the skip-out, splash down |
| Steep entry recovery | entry interface, committed at **−6.9°**, lift **down** | keep heating and G inside the limits, splash down |
| COMMANDER reentry (locked) | the mission's COMMANDER ENTRY PREP: random EI dispersion up to ±1.8°, 6.5 m/s RCS, no corridor zones, no prediction | splashdown |

`trainingScenarios.test.js` flies these with a simulated crew in real time, as the game paces it
(`timeScaleFor`). The crew has a 3–6 s reaction delay, decides twice a second on a 0.8 s-old state,
and rolls at the physical 20°/s.

- **Shallow (−5.7°):**
  - Holding lift up skips out.
  - Managing the lift vector recovers, with both the look-ahead guidance and a gauge rule (lift down
    while not descending, lift up in a fast dive).
  - Holding lift down overloads the capsule.
  - The test checks ±0.2° around −5.7°, which sits mid-way in the recoverable band (−5.5° to −5.9°).
- **Steep (−6.9°):**
  - Holding lift down breaks the capsule.
  - Managed entries recover at higher loads than nominal.
  - Holding lift up all the way skips out.
  - The test checks ±0.1° around −6.9°.
- **COMMANDER:**
  - The worst dispersion (1.8°) needs 6.0 m/s of trim against a 6.5 m/s budget, which takes 12 s of
    the 18 s prep.
  - Trimmed to within 0.4° of the target, a managed entry splashes down.
  - Left untrimmed at either extreme, the capsule skips out or burns up.
- **Failures stay possible.** Training adds no margin:
  - entries well outside the corridor are lost even with ideal guidance;
  - skip-out (shallow, no input), thermal failure (trimmed to −8.0° and held lift up) and structural
    failure (steep, no input) all come from the same physics.

## Instructor

The instructor is one callout at a time, computed from the live simulation values the HUD already
shows:

- the descent assessment;
- the reentry prediction, heating and G;
- parachute state.

It sits inside the telemetry column, so it never covers the vehicle, the LZ, the controls, the
corridor gauge or the lift dial. It never pauses the simulation.

| Lunar callout | When |
|---|---|
| DESCENT RATE HIGH — BEGIN BRAKING | the descent assessment is in danger, or the braking burn is due |
| HORIZONTAL VELOCITY EXCESSIVE | drift that cannot be nulled in time, or over the limit below 80 m |
| HAZARD AT TOUCHDOWN POINT · ATTITUDE · FUEL RESERVE LOW | projected hazard; tilt caution; reserve or fuel caution |
| BRAKING ALTITUDE | coasting, braking burn due in under 8 s |
| LANDING ZONE AHEAD | projected touchdown on the primary LZ, 15–150 m up |
| FINAL APPROACH | below 40 m: the touchdown limits |
| SAFE TOUCHDOWN / HARD CONTACT | at contact |

| Reentry callout | When |
|---|---|
| ENTRY CORRIDOR TOO SHALLOW / TOO STEEP | ENTRY PREP: planned EI angle outside the difficulty's guidance band |
| GO FOR ENTRY | in the band, attitude ready |
| SHALLOW / STEEP EDGE OF CORRIDOR | start of the recovery scenarios |
| ADJUST LIFT VECTOR | prediction SKIP or OVERLOAD (or climbing at low G) |
| TRAJECTORY RECOVERED | prediction back to nominal after a predicted failure |
| HEATING APPROACHING LIMIT | heat rate above 80 % of the 200 W/cm² design, or over it |
| G-LOAD INCREASING | above 6 g and rising |
| COMM BLACKOUT · ENTRY COMPLETE · PARACHUTE CONDITIONS MET · MAIN CHUTES · SPLASHDOWN | as they happen |

**By difficulty:**

- **CADET** gets every callout, each with a one-line explanation using the live numbers.
- **ASTRONAUT** gets the warnings and key events in a few words.
- **COMMANDER** gets the objective and the outcome only.

The reentry prediction comes from the mission's look-ahead (`predict`). As in the mission, it runs at
CADET and ASTRONAUT only.

**Voice (optional).** When the callout changes, a short phrase is spoken through the existing audio
hook (`speak`, the device's own speech synthesis), for example "Descent rate high. Begin braking."

- It works offline, with no backend or paid service.
- It never speaks over a Houston call, at most once every 4 s, and never at COMMANDER.
- **MUTE INSTRUCTOR** (the speaker button in the briefing, also in the debrief) is remembered on the
  device.

## Retry

RETRY remounts the same scenario with a new key. That gives a fresh integrator state, timers,
controls, camera, telemetry, instructor and "starts in" hold, with no cinematic.

The games remove their keyboard listeners and animation loops on unmount. React-three-fiber disposes
each Canvas. The page-level audio graph is shared and its rumble is stopped on retry.

`retries.js` checks for accumulation across 10 lunar and 5 reentry retries:

- heap after forced GC;
- window and document listeners;
- canvases;
- animation-frame callbacks per second;
- WebGL warnings.

The results are under Validation.

## Debrief

All values come from the flown simulation.

- **Lunar landing**:
  - landing result and zone;
  - grade and score (`gradeLanding`);
  - vertical and horizontal touchdown speed against their limits;
  - final attitude (tilt);
  - distance from the LZ centre and its accuracy band;
  - fuel remaining, with the starting level for mid-descent starts;
  - main reason for success or failure.
- **Reentry**:
  - initial EI angle;
  - entry-corridor status against the physics corridor (−5.5° to −7.2°): inside, shallow or steep edge,
    or outside;
  - peak heating rate;
  - maximum thermal load (J/cm² and % of the shield);
  - peak G;
  - parachutes (drogue and main deployment altitudes, or not deployed);
  - splashdown velocity;
  - bank-control agreement with the look-ahead guidance (% of hypersonic time, total roll);
  - outcome;
  - main reason.

One or two recommendations follow, chosen from what limited the attempt.

## Training records

Records are kept on this device only, in `localStorage["lunavia.training.v2"]`, separate from the full
mission. For each simulator, scenario and difficulty they store:

- attempts and successful attempts;
- best result;
- best landing grade, best fuel remaining and best LZ distance (safe landings);
- lowest peak G (successful entries).

**TRAINING RECORDS** shows the personal bests by difficulty, including which reentry scenarios have
been passed. The instructor-voice choice is stored in `lunavia.training.voice`.

**Persistence.** In the iOS app the WebView's `localStorage` survives closing and reopening the app.
It is removed when the app is deleted, and iOS can clear it under severe storage pressure.
`persist.js` checks that the records survive a browser restart on the same profile. On a phone this
must still be confirmed by closing and reopening the app.

## Code

| File | Role |
|---|---|
| `pages/Training.jsx` | Training Center UI: simulators, scenarios, briefing, records, runs, debrief, retry, voice |
| `data/trainingScenarios.js` | Scenario starts (reference descent, coasted start, entry angles) and objectives |
| `data/trainingCoach.js` | Instructor callouts by difficulty |
| `data/trainingDebrief.js` | Debriefs, corridor status, recommendations |
| `lib/trainingProgress.js` | Local records and personal bests |
| `components/training/CoachCard.jsx` | Instructor card |
| `data/landerPilots.js` | Adds `precisionStrategy` (tests only) |
| `DescentGame.jsx`, `ReentryGame.jsx` | The optional training props above |
| `data/trainingScenarios.test.js` | 26 tests: start derivation, feasibility, objectives, survivability, instructor, debrief |

## Validation

Validation used Chromium with iPhone emulation: touch only through CDP multi-touch, simulated safe
areas and production builds. The desktop runs were keyboard only. The automated pilots read the HUD,
or for reentry the telemetry the HUD is drawn from. **No physical iPhone was used**: frame rate,
WKWebView behaviour, speech voices and storage persistence on a device are still to be confirmed.

| Check | Result |
|---|---|
| Unit tests | 82 / 82: 56 existing (lander physics and COMMANDER balance 25, reentry physics 19, launch timeline 12) plus 26 training |
| Production build | passes (only the existing `useMissionAudio` warning) |
| iPhone 16 Pro 852 × 393, touch, 13 attempts | **Lunar:** standard CADET A 88 (0.5 m from centre); precision ASTRONAUT A 84 (0.6 m); braking ASTRONAUT and CADET (muted run) safe; COMMANDER challenge 0.3 m from centre. **Reentry:** nominal CADET 7.5 g; shallow recovery ASTRONAUT 5.9 g; steep recovery COMMANDER 9.7 g; COMMANDER reentry 7.3 g. **Failures:** lunar crash (COMMANDER, no input); skip-out (shallow, no input); thermal (trimmed to −7.94°, lift up held); structural (steep, no input). Each debrief names the right cause. Instructor voice heard in the CADET / ASTRONAUT runs, silent when muted and at COMMANDER. 0 console errors |
| iPhone SE 667 × 375 (touch) | standard CADET in the LZ (0.2 m); shallow CADET 5.4 g; COMMANDER crash and steep structural failure debriefs. Training Center, briefing, debrief and buttons all on screen |
| iPhone 16 Pro Max 932 × 430 (touch) | nominal ASTRONAUT 7.4 g; braking COMMANDER crashed at 4.4 m/s (the scripted pilot; the debrief reported it correctly) |
| Desktop 1440 × 900 (keyboard) | precision CADET S 96 (1.3 m); standard ASTRONAUT B 81; steep CADET 9.7 g; COMMANDER reentry 8.0 g; R retries |
| Navigation | main menu → Training Center; RETRY; ABORT → scenarios; CHANGE SCENARIO; TRAINING CENTER; MAIN MENU; records view |
| Retry accumulation (`retries.js`) | 20 lunar + 5 reentry retries: window and document listeners, canvases (1) and animation callbacks flat; heap levels off at 9.8–10.1 MB from retry 9. A snapshot diff (retry 10 vs 20) shows no retained WebGL contexts, shaders or HUD DOM after the texture fix below |
| Records persistence (`persist.js`) | records and the mute choice survive a full browser restart on the same profile |
| Full mission regression (touch, 852 × 393, training build) | departure → cruise → landing by touch → reentry → parachutes → splashdown → relaunch; only the blocked optional photo errors |
| Home screen | FLIGHT TRAINING above the fold at 852 × 393 and 667 × 375 (button bottom 368 px) |

**Leak found and fixed.** Before the fix the heap grew about 0.1 MB per descent retry, linearly over 30
retries. drei's `useTexture` caches the Moon and Earth textures for the session, and each renderer
that used them registered a `dispose` listener on the shared texture. That listener kept every
retired renderer alive, with its WebGL context, canvas and detached HUD. `DescentGame` now disposes
the two textures on unmount; this also covers the mission's "restart descent".

The reentry scene loads its own textures per mount and was not affected. The landing page, mission
cruise and descent-skip scenes still use the shared cache. They mount once per mission, so there was
nothing to fix for training there.
