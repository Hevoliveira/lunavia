# Flight Training Center

The Training Center lets a player practise LUNAVIA's two flight-control problems on their own, without
the launch, staging, Earth orbit or lunar transfer:

- the powered lunar descent;
- the Earth reentry.

The full mission is unchanged.

## Navigation

- **Main menu** (`/`): **FLIGHT TRAINING** in the hero, next to INICIAR MISSÃO, and **Training** in the
  navbar.
- **`/training`**:
  1. Choose **LUNAR LANDING** or **EARTH REENTRY**.
  2. Pick a scenario from the list. The briefing shows its situation, objective and what it practises.
  3. Choose a difficulty: CADET, ASTRONAUT or COMMANDER. The two COMMANDER challenges are locked to
     COMMANDER.
  4. **START TRAINING**.
- **During a run**:
  - The game shows a three-second "STARTS IN" hold. The scene and HUD are live, the physics waits, and
    controls can already be held.
  - Then the mission's own descent or reentry runs.
  - ABORT returns to the scenario list.
- **After each attempt**: a debrief with **RETRY**, **CHANGE SCENARIO**, **TRAINING CENTER** and
  **MAIN MENU**.
  - RETRY remounts the same scenario immediately, at the same difficulty, without replaying anything.
  - On desktop, R also retries.

## Scenarios

### Lunar landing

The lunar scenarios use `DescentGame` with the mission's `DIFFICULTY` config. These are unchanged:

- thrust, fuel flow and gravity;
- the touchdown limits, hazards and grading (`gradeLanding`).

| Scenario | Start | Objective |
|---|---|---|
| Guided descent | the difficulty's own mission start (CADET 400 m, ASTRONAUT 550 m, COMMANDER 750 m) | land safely |
| Horizontal velocity correction | 220 m, the reference descent's rate and fuel, plus a 10 m/s eastward drift toward a crater | land safely |
| Precision landing | 120 m, the reference descent's rate and fuel, 35 m past the primary LZ across a crater | land safely **inside the primary LZ** (< 6 m) |
| COMMANDER challenge (locked) | the COMMANDER mission start | land safely |

**Mid-descent starts are never more generous than the mission.** The state at 220 m and 120 m is
taken from the reference descent: the guided pilot of `landerPilots.js`, with its reaction lag, tap
length and HUD refresh, flying the full descent.

- **Descent rate:** the reference pilot's.
- **Fuel:** rounded down from what that pilot has left.
- **Engine:** running where it was mid-burn over the previous second (off at CADET 220 m, where it is
  still coasting to its braking burn).

`trainingScenarios.test.js` re-derives these values.

### Earth reentry

The reentry scenarios use `ReentryGame` with the mission's `reentryPhysics.js` and `ENTRY_DIFFICULTY`
guidance settings.

| Scenario | Start | Objective |
|---|---|---|
| Nominal entry | ENTRY PREP, planned EI angle −6.50°, lift up | trim, commit, fly to splashdown |
| Shallow entry recovery | entry interface, committed at **−5.7°**, lift **up** | avoid the skip-out |
| Steep entry recovery | entry interface, committed at **−6.9°**, lift **down** | keep heating and G inside the limits |
| COMMANDER reentry challenge (locked) | the mission's COMMANDER ENTRY PREP: random dispersion up to ±1.8°, 6.5 m/s RCS, no corridor zones, no prediction | splashdown |

**How the shallow and steep angles were chosen.** They come from the physics, not a guess.
`trainingScenarios.test.js` sweeps entry angles with a simulated crew flying in real time, as the
game paces it (`timeScaleFor`). The crew has a 3–6 s reaction delay, decides twice a second on a
state 0.8 s old, and rolls at the physical 20°/s.

- **Shallow:**
  - Holding the attitude skips out at every angle from −5.2° to −5.9°.
  - Following the look-ahead guidance recovers from −5.5° to −5.9°.
  - So does a gauge rule a player can fly: lift down while not descending, lift up in a fast dive.
  - −5.7° sits mid-band, and the test checks ±0.2° around it.
  - Holding lift down instead overloads the capsule, so the scenario needs management, not one roll.
- **Steep:**
  - Holding lift down breaks the capsule.
  - Managed entries recover from about −6.8° to −7.2°, with peak loads of about 10–11 g against
    8.6 g for the nominal entry.
  - Holding lift up all the way skips out, so it too needs management.
  - The test checks ±0.1° around −6.9°.
- **Failure stays possible:** entries well outside the corridor (−4.9°, −7.6°) are still lost even
  with ideal guidance. Training adds no margin.

## Guidance by difficulty

The instructor appears inside the telemetry column, so it never covers the vehicle, the LZ, the
entry-corridor gauge or the lift-vector dial. It shows one line at a time and never pauses the
simulation. The mission's own HUD guidance for the difficulty is shown as usual. For example:

- the descent shows TGT V/S, BRAKE and RESERVE;
- the CADET reentry shows the bank cue and lift assist;
- CADET and ASTRONAUT reentries show the prediction.

| Difficulty | Instructor |
|---|---|
| CADET | Explains each event and what to do. Lunar: braking, drift, attitude, fuel, final-approach limits. Reentry: entry angle, corridor, trim, bank orientation, skip-out, G-load, heating, thermal limit, blackout, end of the hypersonic phase, parachutes. |
| ASTRONAUT | The objective; touchdown limits below 40 m; hazard, skip-out and overload warnings; corridor reminder in ENTRY PREP. |
| COMMANDER | The objective only. |

## Debrief

All values come from the flown simulation.

- **Lunar landing**:
  - touchdown vertical speed, horizontal velocity and tilt, each against its limit;
  - fuel remaining, with the starting level for mid-descent starts;
  - landing accuracy, with its band and zone;
  - grade and score from `gradeLanding`;
  - failure reasons.
- **Reentry**:
  - initial (EI) entry angle;
  - peak G-load against 12 g;
  - peak heating rate against the 200 W/cm² design rate;
  - maximum thermal load (J/cm² and % of the shield);
  - bank-control performance;
  - result, and the reason for failure.

**Bank-control performance** is the share of hypersonic flight time during which the lift vector's
vertical component was within 0.5 of the look-ahead guidance's recommendation, plus the total roll
flown. The recommendation is sampled every 0.75 s, the same `recommendBank` that drives the CADET
cue.

**The recommendation** names what limited the attempt:

- the failure cause; or
- the precision miss; or
- a nearly dry tank; or
- the weakest touchdown component; or
- for reentry, high G, shield use or poor guidance agreement.

## Progress

Progress is kept on this device only, under `localStorage["lunavia.training.v1"]`, per discipline,
scenario and difficulty:

- attempts;
- successful attempts;
- best result: landing grade and score, or the reentry's lowest peak G.

The header shows attempts, successful attempts and completed slots (20). There is no account, backend
or sync. If storage is unavailable, training still works and progress simply is not kept.

## Code

| File | Role |
|---|---|
| `pages/Training.jsx` | Training Center UI: selection, runs, debrief, retry and navigation |
| `data/trainingScenarios.js` | Scenario starts and objectives |
| `data/trainingCoach.js` | Instructor lines by difficulty |
| `data/trainingDebrief.js` | Debriefs and recommendations |
| `lib/trainingProgress.js` | Local progress |
| `components/training/CoachCard.jsx` | Instructor card |
| `DescentGame.jsx`, `ReentryGame.jsx` | Optional props: `init` / `scenario`, `coach`, `onResult`, `holdSeconds`. Without them, both behave exactly as in the mission. |
| `data/trainingScenarios.test.js` | 21 tests: start-condition derivation, landability, objectives, instructor, debrief |

## Validation

Validation used Chromium with iPhone emulation: touch only, through CDP multi-touch, simulated safe
areas and production builds. The desktop runs were keyboard only. **No physical iPhone was used.**

| Check | Result |
|---|---|
| Unit tests | 77 / 77 (56 existing + 21 training) |
| Production build | passes (only the existing `useMissionAudio` warning) |
| iPhone 16 Pro 852 × 393, touch, 9 attempts | **Lunar:** guided CADET S 92; drift ASTRONAUT B 81; precision COMMANDER A 83; COMMANDER challenge A 85. All objectives met. **Reentry:** nominal CADET splashdown at 7.5 g; shallow recovery ASTRONAUT splashdown at 6.3 g; steep recovery COMMANDER splashdown at 9.7 g; COMMANDER challenge splashdown (dispersion trimmed to −6.56°). **Failure case:** shallow entry with no input ends in ATMOSPHERIC SKIP, and the debrief shows the reason and the fix. Progress after a reload: 9 attempts, 8 successful. 0 console errors |
| iPhone SE 667 × 375 (touch) | guided CADET landing; precision CADET A 90; steep CADET splashdown at 10.0 g; nominal ASTRONAUT splashdown. The briefing and START fit without scrolling |
| iPhone 16 Pro Max 932 × 430 (touch) | drift CADET B 80; shallow CADET splashdown at 5.2 g |
| Desktop 1440 × 900 (keyboard) | guided ASTRONAUT A 85, then R → retry; nominal and steep ASTRONAUT splashdowns |
| Navigation | main menu → Training Center; RETRY (the same scenario restarts at once, about 2.5 s in the emulator including the harness's own waits); ABORT → scenarios; CHANGE SCENARIO; TRAINING CENTER; MAIN MENU |
| Layout (every run) | the instructor card, telemetry, controls, corridor gauge and lift dial never overlap and are never off screen; buttons are ≥ 44 pt |
| Full mission regression (touch, 852 × 393, training build) | departure → cruise → landing by touch → reentry → parachutes → splashdown → relaunch; only the blocked optional photo errors |

With three emulated browsers running at once, the scripted pilot's reaction time grew. Two 852
landings then failed: CADET touched down at 5.0 m/s against a 4.5 m/s limit, and the COMMANDER
challenge also failed. The debriefs reported both correctly. Re-run alone, both landed (A 83, B 80).
This was the test pilot, not the game.
