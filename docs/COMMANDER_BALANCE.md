# COMMANDER lunar landing: diagnosis and rebalance

A player on a physical iPhone found COMMANDER "almost impossible". This page
records why, what changed, and the simulation evidence. It covers the descent
gameplay only: `data/landingPhysics.js`, `data/landerSim.js`,
`data/descentProfile.js`, `components/DescentGame.jsx`.

All figures come from **deterministic simulations in Node and Chromium**. No
result here is a measured human success rate, and none of it was flown on a
physical iPhone.

## How it was measured

- **One integrator.** The descent step that lived inside `DescentGame` moved
  to `data/landerSim.js`; the game and the tests both call it. A unit test
  replays 1 500 frames of mixed inputs through the old inline code and the new
  module and requires identical trajectories (fine control off).
- **Pilot models, not autopilots** (`data/landerPilots.js`, tests and analysis
  only). Each pilot reads the HUD at its 15 Hz refresh, reacts 0.2–0.45 s late,
  decides 8 times a second, presses for at least 0.15 s (a tap), misreads the
  rates by up to ±0.2 m/s, and anticipates the engine from the throttle bar.
  Several strategies are flown, so no claim rests on one control sequence:

  | Strategy | How it flies |
  |---|---|
  | Guided | flies only the new HUD cues (TGT V/S band, braking countdown) |
  | Profile, cautious / firm | descent-rate schedule using 50 % / 70 % of braking authority |
  | Single braking burn | coasts, then one full-thrust burn with a 15 % or 40 % margin |
  | Bank-to-steer + RCS trim | steers by tilting the main engine, RCS only for the final trim |
  | Beginner | steep schedule, loose control, little feel for engine lag, 0.35–0.55 s reactions |

  Each campaign is 3 reaction times × 6–8 noise seeds.

## Diagnosis (parameters before the rebalance)

| | CADET | ASTRONAUT | COMMANDER (before) |
|---|---|---|---|
| Start | 400 m, −4 m/s, 2 m/s drift | 550 m, −8, 4 | 750 m, −14, 6 |
| Thrust-to-weight | 3.40 | 2.96 | 2.59 |
| Braking deceleration | 3.88 m/s² | 3.18 | 2.58 |
| Full-throttle burn time | 50.0 s | 23.3 s | **14.0 s** |
| Fuel the ideal single burn needs | 26.9 | 61.7 | **112.7 (tank: 105)** |
| Tank ÷ ideal | 7.44× | 2.27× | **0.93×** |
| No input: ground in | 19.9 s | 21.6 s | 23.0 s, at 51 m/s |
| Arrest the initial descent | 1.0 s | 2.5 s | 5.4 s |
| Touchdown limits V / H / tilt | 4.5 / 4 / 22° | 2.5 / 2 / 12° | 1.5 / 1.0 / 8° |
| Tilt rate | 22°/s | 30°/s | **38°/s** |

The ideal burn is the cheapest possible landing: coast, then full thrust to
touchdown, with the game's own engine spool, found by bisection.

### Root causes, in order of weight

1. **Insufficient fuel: physically impossible.** The tank held 93 % of the
   ideal burn's need. No input sequence could land. Even starting at rest
   at 750 m, the ideal burn needs 110 units, more than the tank. Every
   simulated strategy failed: 0 of 24 runs each, mostly *FUEL DEPLETED BEFORE
   TOUCHDOWN*.
2. **Touchdown limits finer than the controls.** Even with unlimited fuel,
   skilled pilots failed 20–40 % of landings by a few tenths: 1.51–1.73 m/s
   against the 1.5 limit, 1.05–1.6 m/s against the 1.0 limit. The throttle is
   on/off with spool, and an RCS tap changes drift by 0.3–0.4 m/s, so a ±1 m/s
   lateral window at contact is a coin toss.
3. **Twitchy attitude control, the twitchiest of the three modes.** At 38°/s,
   a 0.1 s tap is 3.8°, half the 8° limit, and an accidental 0.2 s touch on
   the adjacent TILT button is 7.6°. With 0.3 s of reaction lag, levelling
   becomes a pilot-induced oscillation of ±12°.
4. **Guidance did not tell the player what mattered.**
   - There was no braking cue. *DESCENT RATE CRITICAL* arrived about 0.8 s
     before the ideal-burn point, which is too late once reaction and spool
     are counted.
   - Fuel warnings were percentages; nothing said the tank could not land.
   - The predicted touchdown point (LPD) assumed free fall. During braking it
     missed by 50–107 m.

### Factors checked and ruled out

| Factor | Finding |
|---|---|
| Initial descent rate (−14 m/s) | With enough fuel, 750 m at −14 m/s is recoverable. The ideal burn starts at T+15.8 s, so there are 16 s to plan. −12 m/s gave the same success rates, so it stays. |
| Thrust (4.2) | 4.5 and 4.8 did not consistently improve recovery and cost COMMANDER its weak-engine character, so it stays. |
| Drift (6 m/s from 225 m out) | RCS nulls it in about 2 s. A +4 m/s extra drift is still recoverable. |
| Throttle spool | 63 % response in 0.36 s up, 0.53 s down. It is workable, and pilots who anticipate it fly fine. |
| Touch tap length (0.10 / 0.15 / 0.25 s) | Makes no difference to the outcome. |
| Reaction time | Matters (100 % / 75 % / 38 % at 0.25 / 0.40 / 0.55 s for the guided pilot). That is skill, not a defect. |
| Camera | Already fixed for phones (lander 12–18 % of the clear area). It was not a cause here. |

## Changes

| Parameter | Before | After | Why |
|---|---|---|---|
| `initialFuel` | 105 | **160** | 1.44× the ideal burn (ASTRONAUT 2.27×) |
| `safeVy` | 1.5 m/s | **2.0 m/s** | Inside the Apollo LM's 3 m/s, still the tightest mode |
| `safeVx` | 1.0 m/s | **1.2 m/s** | The Apollo LM lateral limit (4 ft/s), still the tightest |
| `tiltRate` | 38°/s | **30°/s** | No longer twitchier than ASTRONAUT |
| Fine control (all modes) | — | tilt 8°/s and RCS 1 m/s² at the start of a press, full rate after 0.35 s | A tap trims ≈1° or ≈0.15 m/s; a held press keeps full authority |

**Unchanged:** start altitude, descent rate, drift, thrust, fuel flow, RCS
authority, spool, gravity, hazards, the 8° tilt limit, scoring and
crash rules. CADET and ASTRONAUT gain only fine control; their full rates and
every other parameter are the same. No invisible braking or trajectory
correction was added.

## Guidance (all modes, derived from the same physics)

These are new HUD rows, on both the phone and the desktop layouts:

- **TGT V/S** is the recommended descent-rate band for the current altitude.
  It runs from a braking curve using 30–80 % of the engine's authority to a
  gentle final-approach rate. The row turns green inside the band and amber
  above it.
- **BRAKE** depends on the phase:
  - During the initial coast it counts down to the latest prudent start of
    the braking burn (20 % stopping-distance margin), then shows NOW.
  - Once braking, it shows the spare height over a full-thrust stop.
- **RESERVE** is the number of seconds of hover the tank holds beyond the
  least fuel that can still land from here. Apollo crews heard the same as
  "60 seconds" calls. BINGO means the tank can no longer land.

Other guidance changes:

- **The touchdown prediction follows the recommended descent.** The LPD
  reticle, the dashed path, PROJECTED TOUCHDOWN and the camera now use it.
  Error from 400 m is 1–25 m, against 50–107 m for the old free-fall
  estimate.
- **New guidance lines:** BRAKING BURN IN n S, BEGIN BRAKING BURN, FULL
  THRUST – CANNOT STOP IN TIME, FUEL BELOW LANDING MINIMUM, HOVER RESERVE
  LOW.
- **The fuel call reports hover reserve.** The fixed "60 seconds remaining"
  call now gives the actual reserve.
- **No more false caution.** The "hold current throttle" caution now applies
  only in the final 60 m, instead of showing CAUTION through the whole
  coast.

None of this flies the vehicle. The player still has to judge the throttle,
drift and attitude.

## Results

### Skilled strategies, landed share (24 runs each)

Fuel left is the minimum / mean across successful landings.

| Strategy | COMMANDER before | COMMANDER after | ASTRONAUT | CADET |
|---|---|---|---|---|
| Guided (HUD cues only) | 0 % | **96 %**, fuel 11 / 13 % | 100 %, 42 / 43 % | 100 %, 82 / 83 % |
| Profile, cautious | 0 % | **79 %**, 13 / 14 % | 100 % | 100 % |
| Profile, firm | 0 % | **92 %**, 19 / 20 % | 96 % | 100 % |
| Single burn, +40 % margin | 0 % | **92 %**, 19 / 23 % | 88 % | 100 % |
| Single burn, +15 % margin | 0 % | **96 %**, 19 / 22 % | 100 % | 100 % |
| Bank-to-steer + RCS trim | 0 % | **71 %**, 16 / 17 % | — ¹ | — ¹ |

¹ This model only steers while braking, so on the shorter CADET and ASTRONAUT
descents it cannot cover the distance to the zone and lands in hazards. That
is a limit of the model, so the strategy is reported for COMMANDER only.

Remaining COMMANDER failures are marginal: excessive horizontal speed or
vertical speed just over the limit.

### Mistakes (COMMANDER)

| Mistake | Before | After |
|---|---|---|
| Reacts 2 s late to the braking cue | 0 % | **79 %** (recoverable) |
| Reacts 3 s late | 0 % | 58 % (marginal) |
| Reacts 4 s late | 0 % | **0 %**, hard landing |
| Brakes very early (30 % of authority) | 0 % | 92 %, but lands with ≈2 % fuel |
| Extra +4 m/s drift | — | ≥ 70 % (unit test) |
| Hovers down from altitude at 6 m/s | 0 % | **0 %**, tanks run dry |
| Never corrects drift (no RCS) | 0 % | **0 %**, excessive horizontal speed |
| Cuts the engine at 15 m | 0 % | **0 %**, hard landing |

### Beginner model (24 runs)

| CADET | ASTRONAUT | COMMANDER after | COMMANDER before |
|---|---|---|---|
| 46 % | 29 % | **21 %** | 0 % |

### Why this is fairer

- **The hard parts are skill-based.** COMMANDER still has the highest
  start, the fastest initial descent, the weakest engine, the tightest
  limits, no tilt assist, and the smallest fuel margin (11–23 % left on a
  good landing, against 42–50 % on ASTRONAUT).
- **It is now possible and recoverable.** Multiple strategies work, and a
  2 s late reaction can be recovered.
- **Poor approaches still fail.** A 4 s late reaction, a long hover, ignored
  drift or a cut engine all crash.
- **Twitchy controls and a hidden fuel deficit no longer decide the
  outcome.**

## Touchscreen findings

- **Simultaneous throttle and RCS hold.** The lower-right cluster supports
  multi-touch; up to 2 simultaneous touches were used in the browser touch
  flights.
- **Fine control makes taps precise and mis-taps forgiving.** A 0.2 s
  accidental TILT touch is now ≈2.5° instead of 7.6°.
- **Tap length does not decide outcomes.** Reaction time does, and that is
  skill.
- **Browser touch flights** (Chromium, native layout emulated, software
  renderer). The in-page pilot reads only the HUD: ALT, V/S, H/S, TILT, THR
  and the TGT V/S band.

  | Viewport | Mode | Result |
  |---|---|---|
  | 852×393 (iPhone 16 Pro) | COMMANDER | landed, 1st attempt, twice (B 71, then C 61 on bundle `2a7d5ee`, whose descent code is final); 1.50 / 0.09 m/s and 1.47 / 0.76 m/s; 12–14 % fuel |
  | 932×430 (16 Pro Max) | COMMANDER | landed, 1st attempt (C 69) |
  | 667×375 (SE) | COMMANDER | landed, 2nd attempt (C 57, 1.79 m/s, 11 % fuel) ² |
  | 852×393 | ASTRONAUT | landed, 1st attempt (B 70) |
  | 852×393 | CADET | landed, 1st attempt (C 64) |
  | 1440×900 desktop, keyboard | COMMANDER | landed, 2nd attempt (C 60, 1.84 m/s, tanks dry below 5 m) ³ |

  ² The first attempt touched down at 2.14 m/s against the 2.0 m/s limit.
  At 19 m the harness stalled for 3 s while another browser test ran on the
  same machine, and it could not press the throttle during that time.

  ³ The desktop HUD shows the throttle without a test id, so this pilot
  flew without anticipating the engine. It over-controlled, used all its fuel
  both times, and the first attempt touched down at 2.28 m/s.

  Up to 2 simultaneous touches were used. Lander, LZ and touchdown chips
  stayed visible and uncovered, and the lander held 12–15 % of the visible
  area's height from 700 m to touchdown.

## Tests

`data/landerSim.test.js` (25 tests) checks:

- the integrator matches the old in-game code exactly;
- gravity, spool, fuel flow, dry tanks, fine control, frame-rate
  independence and determinism;
- the old COMMANDER is impossible;
- the difficulty hierarchy holds;
- every COMMANDER scenario above;
- guidance accuracy: touchdown prediction, braking-cue timing, hover reserve
  and the target band.

## Limits of this evidence

- **Pilot models are not players.** The rates above compare parameter sets
  under the same simulated handicaps. They are not a prediction of how often
  a person will land.
- **The touch flights ran in Chromium on a software renderer.** Physical
  iPhone touch latency, frame rate and ergonomics still need a real-device
  test.
