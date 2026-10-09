# LUNAVIA iOS app — developer notes

The iPhone app is the existing React / Three.js game wrapped with **Capacitor 8**.
Nothing was rewritten in Swift, and no physics, guidance or mission-progression code
changed. The web version builds and runs exactly as before (`yarn start`, `yarn build`).

For the click-by-click install guide for non-programmers, see
[`INSTALL_ON_IPHONE.md`](../INSTALL_ON_IPHONE.md).

## Why Capacitor

The game is a single-page React app whose core is WebGL (react-three-fiber) plus Web Audio
and speech synthesis. Capacitor hosts it in WKWebView, which on iOS supports all three
(WebGL 2, Web Audio, `speechSynthesis`), and produces a normal Xcode project. A Swift
rewrite would mean re-implementing every scene; React Native would not run the R3F scenes.

## Layout

```
frontend/
  capacitor.config.json      appId, appName, webDir=build, iOS web-view options
  ios/App/App.xcodeproj      Xcode project (open this)
  ios/App/App/
    SceneDelegate.swift      + LunaviaViewController (fullscreen, landscape, no status
                             bar, deferred edge swipes, screen kept awake, no web-view
                             bounce). The Home Indicator auto-hides through Capacitor's
                             SystemBars plugin (capacitor.config.json → plugins).
    Info.plist               display name, landscape-only, status bar hidden,
                             arm64/metal, ITSAppUsesNonExemptEncryption=false
    Assets.xcassets          AppIcon (1024² RGB) and Splash (2732² RGB)
    Base.lproj/LaunchScreen  black launch screen with the LUNAVIA wordmark
    public/                  the built web game (committed, see below)
  ios/App/CapApp-SPM         Swift Package that pulls Capacitor (no CocoaPods)
```

The built game in `ios/App/App/public` and the generated `capacitor.config.json` /
`config.xml` are **committed on purpose**: the project then opens and installs from Xcode
with no Node.js on the Mac. The only native dependency is `capacitor-swift-pm`, which
Xcode fetches over Swift Package Manager.

### Swift compatibility note

Do **not** override `prefersHomeIndicatorAutoHidden` in `LunaviaViewController`.
Capacitor 8 already defines it on `CAPBridgeViewController` as `public` (not `open`), in
an extension inside its SystemBars plugin, so an override from the app module fails with
*"Overriding non-open property outside of its defining module"*. The Home Indicator is
hidden with `"plugins": { "SystemBars": { "hidden": true } }` in `capacitor.config.json`
instead. The remaining overrides (`prefersStatusBarHidden`, `supportedInterfaceOrientations`,
`capacitorDidLoad`, `viewDidAppear`) are `open` in Capacitor, and
`preferredScreenEdgesDeferringSystemGestures` is only defined by UIKit.

## Scripts (run in `frontend/`)

| Command | What it does |
|---|---|
| `yarn ios:sync` | Production build without source maps (stamped with the build identity), drop `build/_dbg`, copy into the iOS project (`cap sync ios`). Run after committing any change to the web game, then commit `ios/App/App/public`. The Mac needs neither: the committed bundle is complete. |
| `yarn ios:open` | Open the project in Xcode (macOS only). |

## Build identity and stale installs

Every production build carries the commit and time it was built from:

- `craco.config.js` reads `git rev-parse --short=7 HEAD` (plus `+` if `src/`, `public/` or the
  build config had uncommitted changes) and the UTC time, inlines them as
  `REACT_APP_BUILD_COMMIT` / `REACT_APP_BUILD_TIME`, and writes `build/build-info.json`.
  `yarn ios:sync` copies both into `ios/App/App/public`.
- The home screen shows `LUNAVIA iOS · BUILD <commit> · <time>` (`components/BuildBadge.jsx`,
  `lib/buildInfo.js`; `WEB` instead of `iOS` in a browser). Tapping it adds the bundle
  fingerprint (`main.<hash>.js`), the viewport, whether the phone layout is on, and
  NATIVE/BROWSER. Because the value is compiled into the JS bundle, it describes the bundle
  actually running on the phone, not the branch it was downloaded from.
- Release order, so the label names a real commit: commit the source first, then run
  `yarn ios:sync` on the clean tree and commit `ios/App/App/public` on top. The label then
  shows the source commit, and `public/build-info.json` in the download states the same.

The phone layout no longer depends on the web view's reported height inside the app.
`lib/buildInfo.js` detects the Capacitor bridge (`window.Capacitor.isNativePlatform()`), and
`src/index.js` sets `html[data-native="1"]`. Then:

- the Tailwind `short`/`narrow` variants (now plugin variants in `tailwind.config.js`)
  match on that attribute as well as on `(max-height: 520px)`;
- `useCompact()` returns true, which drives the compact descent HUD and toasts;
- `index.css` hides the navbar during flight.

The app is iPhone-only and landscape-only, so this is the layout it gets anyway. Both
variant forms carry one `html` of specificity, so they still beat `sm`/`md`/`lg` as the
screen did, and lose to `hover:`/`focus:`.

When an iPhone shows an older UI than the repository holds, the repository bundle is not
the cause if `ios/App/App/public/static/js/main.*.js` contains the new UI. The causes left
are on the Mac or the phone:

- an old project folder opened from Xcode's recent-projects list;
- an incremental build reusing DerivedData, since the same ZIP folder name gives the same
  DerivedData path;
- the old app still installed.

`INSTALL_ON_IPHONE.md` → *Updating* makes deleting the old app, deleting the old folders,
opening from Finder and **Product → Clean Build Folder** mandatory, and the BUILD label
confirms the result.

## Identity — what to replace

| Item | Current value | Where to change |
|---|---|---|
| Display name | `LUNAVIA` | `capacitor.config.json` → `appName`; `ios/App/App/Info.plist` → `CFBundleDisplayName` |
| Bundle identifier | `com.lunavia.app.dev` (**temporary**) | Xcode → App target → *Signing & Capabilities* → *Bundle Identifier* (writes `PRODUCT_BUNDLE_IDENTIFIER` in `project.pbxproj`), **and** `capacitor.config.json` → `appId`. Use your final reverse-DNS id, e.g. `com.yourcompany.lunavia`. |
| Version | `1.0` (build `1`) | Xcode → App target → *General* → *Version* / *Build* |
| Team | none | Xcode → *Signing & Capabilities* → *Team* |
| App icon | `Assets.xcassets/AppIcon.appiconset/AppIcon-512@2x.png` | Replace the 1024×1024 PNG (no transparency). |
| Launch screen | `Assets.xcassets/Splash.imageset/*` + `LaunchScreen.storyboard` | Replace the three 2732×2732 PNGs. |

## Future TestFlight distribution (not done)

1. Join the Apple Developer Program and create the app in App Store Connect with the
   final bundle identifier.
2. In Xcode choose *Any iOS Device (arm64)*, then *Product → Archive*.
3. In the Organizer: *Distribute App → App Store Connect → Upload*.
4. In App Store Connect, add testers under TestFlight.
   Export compliance is pre-answered (`ITSAppUsesNonExemptEncryption = false`).

## What changed in the web game for mobile

All changes are presentation / input only; desktop renders the same.

- **Safe areas.** `viewport-fit=cover`; CSS variables `--sat/--sar/--sab/--sal` from
  `env(safe-area-inset-*)` (0 on desktop). HUD panels use `safe-ml` / `safe-mr` /
  `safe-mb` margins, which add to their normal offsets, so nothing sits under the notch,
  Dynamic Island, rounded corners or Home Indicator. The 3D scene still fills the screen.
- **Short landscape screens.** Tailwind screen `short` = `(max-height: 520px)`. Under it
  the navbar is 44 px, HUD panels are compact, the lunar-landing setup screens and the
  landing result scroll, and the reentry centre column narrows. Desktop windows never match.
- **Touch-first devices.** Tailwind screen `touch` = `(hover: none) and (pointer: coarse)`
  hides keyboard hints and shows touch hints. `future.hoverOnlyWhenSupported` stops
  sticky hover colours after a tap.
- **Flight controls** use `HoldButton` (pointer events): one finger per control, several
  controls at once (throttle + RCS, roll + trim), a visible pressed state, and release
  on `pointerup`, `pointercancel`, lost capture, window blur and unmount. Hit targets are
  ≥ 44 pt.
- **Reentry lift assist** (CADET) now has an on-screen ASSIST ON/OFF button; it was
  keyboard-only (`G`).
- **No accidental gestures.** `user-scalable=no`, `touch-action` on the mission surface
  and controls, `overscroll-behavior: none`, no text selection or long-press callouts
  during play; natively, the web view does not bounce and edge swipes are deferred.
- **Mission mode (phones).** During active flight (`html[data-flight="1"]`, set by
  `Mission.jsx`) the website navbar is hidden on landscape phones and the HUD moves up
  (`--hud-top`). Pause and abort stay in every phase's HUD; the navbar returns in the
  control room, menus, results and mission complete. Mission toasts go bottom-left and
  narrow on phones.
- **Lunar descent HUD (phones).** `CompactDescentHud` in `DescentGame.jsx`:
  - **Telemetry**: one slim panel on the lower left (132 px): ALT, V/S, H/S, TILT, FUEL
    and THR bars, distance to the LZ and the projected touchdown zone.
  - **Controls**: one cluster in the lower-right corner, within reach of the right thumb.
    Two 50 × 46 pt pairs (TILT ← →, RCS ◄ ►) sit beside a tall 58 pt throttle at the
    screen edge that shows its spool level. The buttons have thin translucent backgrounds
    and no surrounding panel. They are `HoldButton`s, so any combination can be held at
    once.
  - **Top band**: profile, camera and pause/abort.

  Elements that obstruct the view are tagged `data-hud-block`. The game measures the
  **gameplay visibility area** they leave open, between the telemetry and the control
  cluster.
- **Descent camera (EXTERNAL).** A pilot's chase view that sizes the lander first
  (`DescentCamera` in `DescentGame.jsx`):
  - The lander fills roughly 12–18 % of the visibility area's height (`LANDER_FRAC_*`).
    The zoom is clamped against the lander's own depth, so leaning the view never shrinks
    or blows up the lander.
  - Within that budget the camera keeps a nearby primary LZ in frame. It then leans
    towards the projected touchdown point (LPD) as far as the budget allows, using a
    bisection on the lander → LPD segment.
  - A distant LZ never pulls the camera back. The LZ comes into frame progressively as
    the lander approaches.
  - When the LZ or the LPD lies outside the visibility area, an edge chip points to it:
    `LZ <m>` in orange, `TOUCHDOWN` in yellow. The chips never stack.
  - A faint dashed arc (`TouchdownPath`) draws the no-thrust trajectory from the lander's
    footpads to the LPD.
  - Motion is exponentially smoothed. NAV keeps the top-down map that frames lander, LPD
    and LZ together, and COCKPIT is unchanged.
  - The lander model now sits on its footpads at altitude 0 (`LANDER_FOOT`, visual only).
  - Desktop keeps its HUD. Its panels are tagged too, so the camera avoids them.
- **Landing markers drawn at the right place.** Zone and hazard markers used physics
  metres directly while the lander uses metres × 0.5, so every marker except the primary LZ
  was drawn twice as far from the LZ as the ground it is graded against. They now share the
  lander's mapping (`WORLD_X`). Physics, hazards and scoring are unchanged.
- **Bug fixes found on phones.** The control-room telemetry strip covered the LAUNCH
  button and swallowed taps; the PDI briefing's BEGIN PDI button and the difficulty
  screen's skip link were below the fold with no way to scroll.

## Audio on iOS

WebKit only starts audio inside a user gesture, but LUNAVIA's engine rumble and comms are
triggered from timers (e.g. after the 10 s countdown). `useMissionAudio` now unlocks on
the first `touchend` / `click` / `keydown` anywhere: it creates and resumes the
`AudioContext`, plays one silent sample, and primes `speechSynthesis` with a silent
utterance. Sounds still stay off until the mission calls `init()` at launch, as before.
The context is resumed after `interrupted` states (calls, Siri, app switch) and on
returning to the foreground. On iOS 17+ the audio session type is `playback`, so mission
audio plays with the silent switch on.

## Runtime network dependencies

| Dependency | Used by | Classification | Status in the app |
|---|---|---|---|
| `threejs.org/examples/textures/planets/*` (Earth colour/normal/specular/clouds, Moon) | All 3D scenes | SAFE TO BUNDLE | **Bundled** in `public/textures/planets/` (from three.js r169, MIT). Previously, an unreachable CDN crashed the cislunar scene. |
| Google Fonts (Inter, JetBrains Mono, Space Grotesk) | All text | SAFE TO BUNDLE | **Bundled** via `@fontsource/*` (latin subset, same weights). |
| `fonts.googleapis.com` / `fonts.gstatic.com` preconnects | `index.html` | SAFE TO REMOVE | Removed. |
| `images.unsplash.com` mission-control backdrop | Control room | OPTIONAL | Still remote. Decorative at 40 % opacity; offline, the control room shows its grid and gradient and works normally. Could be bundled later (it could not be downloaded from this build environment). |
| `${REACT_APP_BACKEND_URL}/api/mission/briefing` | `BriefingPanel.jsx` | SAFE TO REMOVE | Component is not imported anywhere; never runs. Left untouched. |
| `public/_dbg/*.txt` debug dumps | nothing | SAFE TO REMOVE | Excluded from the iOS bundle by `yarn ios:sync`; still in the web `public/`. |
| REQUIRED | — | — | **None.** The full mission runs offline. Speech uses on-device voices. |

## Visual Fidelity III (launch vehicle, pad, staging)

- **LV-001** (`RocketModel.jsx`), batched by material so draw calls stay flat: engine bells
  with cooling-tube relief, manifold band and heat-tinted extension; stiffener bands;
  turbine-exhaust manifolds; gimbal actuators; thrust ring and outriggers; quilted base heat
  shield with flexible boots; booster raceway with clamp straps, umbilical plates, seam
  relief with rivet rows, weathering streaks and aft soot; interstage separation joint,
  vents and hatches; upper-stage turbopumps, gas generator, ducts and thrust-cone struts;
  adapter separation-bolt ring; escape tower with tapered legs, ring frames and X-bracing.
- **Material response.** A procedural sky environment map (PMREM, no downloaded HDR) gives
  metals and paint real reflections; its strength fades from the pad to near-space.
- **Launch complex** (`scenes/LaunchComplex.jsx`, about a dozen draw calls): mobile
  launcher deck over a flame hole and trench, hold-down arms, tail service masts, deluge
  ring, umbilical tower with braced bays, grated floors, handrails, elevator shaft and
  hammerhead crane, five swing arms with sagging umbilical hoses, crew access arm and white
  room, concrete hardstand, crawlerway, propellant spheres on braced legs with pipe runs,
  water tower, lightning masts with catenary wires, flood lights, buildings and vehicles for
  scale. The sun casts shadows on the pad; the shadow map stops updating once the pad is
  out of view.
- **Cinematography** is now part of the automatic Earth departure (next section).

## Cinematic Earth departure

The outbound flight is automatic. After LAUNCH in the control room, nothing needs input
until lunar orbit: `INITIATE DESCENT`, difficulty and `BEGIN PDI` come next, as before.
A discreet **SKIP CINEMATIC** jumps to the cislunar cruise; it changes only the film,
not the mission states.

| t (s) | Shot | Event / caption |
|---|---|---|
| 0–4 | Wide: LC-39 complex | T-15, cryogenic venting |
| 4–7.5 | Low angle: vehicle height against the tower | |
| 7.5–14.2 | Engine section, from the flame pit | HBOI sparklers; **MAIN ENGINE START** (T-6.5, staggered); the camera exposure surges as the engines reach full thrust; steam boils off the pit; stack "twang" |
| 14.2–19 | Flame trench, low wide | **LIFTOFF** (hold-down release); a ground surge of smoke rolls out across the pad; trench exhaust, steam, dust |
| 19–25 | Tower-mounted, looking up | slow rise; **TOWER CLEARED** |
| 25–32 | Long-lens tracking | full vehicle and smoke column leaving the complex |
| 32–43 | Atmospheric ascent | cirrus passes below; sky darkens; **MAX-Q** |
| 43–46.5 | Engine section | **MAIN ENGINE CUTOFF**: plume tails off, nozzles cool |
| 46.5–49.5 | Separation plane | **STAGE SEPARATION**: pyro, separation motors, vapour ring |
| 49.5–53 | Both stages | gap opens, spent stage tumbles |
| 53–57 | Onboard camera on the spent stage | the upper stage pulls away and its engine lights into the lens (**UPPER STAGE IGNITION**); silent |
| 57–61 | Upper stage, external | vacuum plume; spent stage recedes |
| 61–65 | Wide: vehicle against the limb | leaving the atmosphere |
| 65–70.5 | A · wide over the Atlantic | **EARTH ORBIT** (cutoff, 185 km parking orbit) |
| 70.5–75.5 | B · engineering close-up | upper stage and spacecraft over the West African coast, Earth sliding past |
| 75.5–80 | C · along the atmospheric limb | the thin blue limb ahead of the vehicle |
| 80–85 | D · orbital sunset | warm, low sunlight on the vehicle over the night side |
| 85–89 | E · night pass | **TLI PREPARATION**: RCS roll to burn attitude in Earth's shadow |
| 89–95.5 | Behind the burning stage | **TRANSLUNAR INJECTION** at orbital sunrise |
| 95.5–102 | Looking back past the spacecraft | **LUNAR TRANSFER**: the Earth recedes to a half-lit globe |

**Pacing and clock.** The countdown and the first 17 s of flight run in real time.
Documentary cuts then compress the flight, and the mission clock jumps with them:
T+00:02:30 at MECO, T+00:10:00 at orbit insertion, about T+02:52 at TLI (second orbit).
In orbit each shot is a separate moment of the parking orbit; within a shot the ground
moves at 3–4× real speed, so the orbital motion reads without blurring. The whole
sequence is about 102 s; **SKIP CINEMATIC** is available throughout. Ascent, orbit
insertion, TLI and lunar transfer stay distinct; the tests check altitude, speed, the
orbit compositions and the day / sunset / night / sunrise geometry.

**Sunlight in orbit.** The Sun is fixed in the Earth frame (the same direction that
lights the pad). As the vehicle travels round the orbit:

- the local Sun elevation changes;
- the vehicle keeps the Sun until it sinks below the limb (horizon dip at 185 km is
  13.7°), so it is still sunlit over a dark Earth at orbital sunset;
- its light reddens near the limb, it goes dark in Earth's shadow, and it comes back
  at sunrise;
- the environment lighting switches between day, dusk and night maps to match.

**Scale strategy.** Two layers are composited every frame:

- **Environment, true scale** (`scenes/launch/environment.js`). A full-screen shader
  ray-traces the planet (R = 2000 units = 6371 km) and its atmosphere: single
  scattering, Rayleigh plus Mie, the Earth texture, ocean glint and a cloud map. The
  horizon is therefore exact at every altitude, flat from the pad and a thin limb from
  orbit. It also draws the Sun and the stars, which appear as the sky darkens.
  Cumulus and cirrus sit at their true altitudes near the site. From orbit the shader
  adds procedural cloud and land detail below the textures' resolution (fading out
  where it would alias), a tight rippled sun glint, thinner haze, and city lights on
  the night side.
- **Vehicle layer, pad scale** (1 unit = 30 m). It holds LV-001, the complex and all
  particles. In flight the vehicle stays at the origin and the environment camera rides
  the trajectory (altitude, downrange, local horizon).

The depth buffer is cleared between the layers, so the vehicle is never oversized
against the Earth.

**Effects.**

- `scenes/launch/particles.js`: GPU pools, one draw call each, integrated in the vertex
  shader and world-anchored. Ground smoke and steam therefore stay at the pad, and only
  new particles are uploaded each frame.
- Engines: per-engine staggered start with individual cores, shock diamonds at sea
  level, and a plume that widens and fades with altitude. A turbulent particle envelope
  replaces simple cones.
- Pad: a pit open under the engines and a west-facing flame trench. A flickering point
  light lights the deck, tower and smoke from the flames.
- Separation: retro motors and a vapour ring. The upper-stage vacuum plume is clearly
  visible, with a soft halo.
- Ignition and liftoff: the close cameras' exposure surges with thrust; steam boils off
  the flame pit; a ground surge of smoke rolls out at release; heavier deck billows.
- Orbit: RCS puffs during the roll to burn attitude.
- No shock heating is drawn during powered ascent.

**Audio** (`hooks/useMissionAudio.js`, synthesized):

- Pad: ambience and venting hiss, the countdown, then a roar with an impulsive crackle
  layer whose brightness follows the camera distance.
- Liftoff: hold-down clank.
- Ascent: aerodynamic roar peaking at max-Q, muffled as the air thins.
- Launch: a sub-bass layer under the roar (felt more than heard).
- Space: silence at MECO, then pyro, a clank and a structure-borne thud at separation.
  The camera on the spent stage hears nothing. A muffled onboard rumble plays while a
  stage burns (no external sound in vacuum), and RCS thumps during the roll. A soft drone
  plays through orbit and cruise and fades at the Moon.
- Comms calls mark each event. Space-to-ground calls carry Quindar tones, as Apollo's
  did.

## Resolution and texture findings

Measured at iPhone 16 Pro landscape on the tightest framing (MECO close-up):

| Factor | Finding | Action |
|---|---|---|
| Texture resolution | Booster tank spans 296 × 115 device px; the 512 × 1024 skin already gives 3.5 texels/px vertically and 2.2 across | Kept 512 × 1024 (a 1024 × 2048 test added no visible detail and ~22 MB) |
| Texture filtering | All rocket textures had anisotropy 1; cylinders always present grazing angles, so seams and bands smeared | Anisotropy 8 on rocket, pad and Earth textures |
| Lighting / materials | No environment lighting: metals rendered flat and dull | Procedural sky environment map |
| Geometry | Engines, tower and pad were simple primitives | Fidelity III geometry above |
| Device pixel ratio | Cap 2 on a 3× display renders 1.34 MP instead of 3.0 MP (2.25× fragment work at 3×, plus 4× MSAA) | Cap kept at 2: raising it needs a measurement on a real iPhone |
| Anti-aliasing | MSAA 4× active (`samples: 4`) | Unchanged |

## Performance

Steady-state workload per frame, production builds, iPhone 16 Pro landscape (852 × 393 CSS
px, render 1704 × 786). Measured in Chromium with SwiftShader, a CPU renderer: draw calls
and triangles are exact, frame rates are **not** representative of an iPhone GPU.

| Scene | Draw calls before → after | Triangles before → after |
|---|---|---|
| Landing hero | 19 → 19 | 78k → 78k |
| Launch pad / liftoff | 84 → 104 | 30k → 85k (includes the pad shadow pass) |
| MECO (staging prompt) | 22 → 25 | 13k → 42k |
| Stage separation | 34 → 33 | 24k → 33k |
| Cislunar / lunar orbit | 18 → 17 | 27k → 19k |
| Lunar descent (game) | 26 → 27 | 0.9k → 9k (distant Earth now in frame) |
| Reentry | 20 → 20 | unchanged |

- JS heap stays at 10–27 MB across the mission.
- The pad shadow pass and the new geometry roughly halve the CPU rasteriser's frame rate
  on the pad shot (1.9 → 0.9 fps there; GPU cost on a phone is far lower). If device
  testing shows frame drops on the pad, the first knobs are the shadow map size
  (`PadShadows`, 1536²) and `dpr={[1, 1.5]}` for that scene.
- Device pixel ratio: every `<Canvas>` caps at 2. Particles are fixed-count.

### Launch cinematic workload

Production build, 852 × 393 CSS px (render 1704 × 786), SwiftShader. Draw calls and
triangles are for the vehicle layer, including the pad shadow pass; the environment layer
adds 2 (sky/planet quad and clouds). Overdraw is the summed screen area of live particle
sprites divided by the screen area.

| Shot | Draw calls | Triangles | Live particles (smoke / fire) | Peak overdraw (smoke / fire) | CPU-raster fps, old ascent → new |
|---|---|---|---|---|---|
| Wide complex | 43 | 38k | 8 / 0 | 0.1 / 0 | 1.2 → 1.0 |
| Engine pit, full thrust | 36 | 31k | 270 / 154 | 3.7 / 0.8 | — → 0.75 |
| Liftoff (trench) | 51 | 38k | 490 / 140 | 9.5 / 1.1 | 1.2 → 0.5 |
| Tower clearance | 50 | 38k | 616 / 133 | 4.2 / 0.1 | — → 1.0 |
| Long-lens ascent | 39 | 25k | 422 / 108 | 7.3 / 0.3 | — → 1.5 |
| Atmospheric ascent | 37 | 25k | 113 / 36 | 1.2 / 0.4 | — → 2.5 |
| MECO / separation | 29–32 | 23–25k | ≤ 86 / ≤ 37 | ≤ 1.7 | 2.2 → 1.5–1.75 |
| Orbit / TLI | 14–18 | 9.5k | 0 | 0 | 1.43 → 2.25 |

- Particle pools are fixed (1000 smoke, 400 fire), one draw call each, and integrated on
  the GPU. Only newly emitted particles are uploaded.
- Each sprite's on-screen size is capped at 27 % of its distance (thinned instead), and
  sprites at the lens dissolve. This took the liftoff shots from 30–50 layers of overdraw
  to under 10.
- The pad shadow map renders only while the pad is in view.
- **Adaptive resolution**: if a device cannot hold about 45 fps, the cinematic lowers its
  pixel ratio by 0.25 every 2 s, down to 1.25, and never raises it again.
- The CPU rasteriser's frame rate is no guide to an iPhone GPU. Relative to the old
  ascent, the liftoff is about 2.4× the cost there, and the space shots are cheaper.

## Validation

Done in Linux with Chromium emulating iPhones: touch only (multi-touch via the DevTools
protocol, no keyboard), simulated safe areas, production builds, **internet blocked**.

| Check | Result |
|---|---|
| Web production build (`yarn build`) | passes (only pre-existing warnings) |
| Unit tests (`yarn test`) | 26 / 26 pass (19 reentry physics + 7 launch timeline) |
| `yarn ios:sync` / `cap sync ios` | passes; no source maps, no `_dbg`, development hooks compiled out |
| Xcode project integrity | `project.pbxproj` parses; referenced files exist; Swift overrides checked against Capacitor's sources, including plugin extensions |
| Lunar descent framing, ASTRONAUT from 550 m (16 Pro / Pro Max / SE) | Lander height as a share of the visibility area's height, before → after: 4.3 / 4.9 / 3.6 % → 12.6 / 12.7 / 12.5 % at 500 m; 6.7 / 6.9 / 5.4 % → 12.6 / 12.7 / 12.4 % at 200 m; 10.6 / 10.8 / 8.5 % → 16.4 / 16.7 / 13.8 % at 100 m; 16.3 / 16.6 / 14.4 % → 16.6 / 16.6 / 15.4 % at 30 m; 17.1 / 17.3 / 16.7 % → 16.7 / 16.7 / 16.8 % at touchdown. Lander, LZ and on-screen touchdown point were never under a HUD element, with one exception: at 500 m the touchdown point lies ~150 m ahead and 500 m below, outside the frame, and is marked by the TOUCHDOWN chip while its ring sits behind the control cluster. All three runs landed (grades A / S / A). |
| Desktop 1440 × 900 descent | Desktop HUD unchanged; the lander is 90–120 px (12.6–16.8 %); landed. |
| Automatic Earth departure (bundles `379a642` and final `f1e1909`), 852 × 393, 932 × 430, 667 × 375 | One tap on LAUNCH, then **0 input events** until lunar orbit (counted by capturing listeners). All 10 captioned events fire in order (engine start → lunar transfer), then cislunar cruise and the INITIATE DESCENT prompt |
| Skip cinematic, desktop 1440 × 900 | SKIP goes straight to the cruise and lunar orbit; descent keyboard throttle works; abort returns to the control room |
| Descent after the automatic departure | throttle 99 % while RCS is held (two simultaneous touches); abort → control room |
| Full mission by touch, bundle `379a642` (final `f1e1909` differs only in the adaptive-resolution trigger), iPhone 16 Pro | automatic departure → cruise → lunar orbit → manual landing by touch (first attempt, two simultaneous touches) → reentry → parachutes → splashdown → mission complete → relaunch; no control in an unsafe area, no overlaps, no clipping, all targets ≥ 44 pt. SE and Pro Max full missions: previous pass (descent and reentry code unchanged since) |
| Desktop 1440 × 900 regression (keyboard) | full mission and reentry failure / success cases pass; nominal entry at −6.51° → peak 176 W/cm², 7.39 g, splashdown 8.5 m/s (physics files untouched) |
| Application console errors | 0 (only the blocked optional photo is logged) |

**Not verified here:** there is no Mac, Xcode or iPhone in this environment, so the native
build, signing, installation, WKWebView rendering, real-GPU frame rate and thermals, and
audio on a physical device have not been tested.
