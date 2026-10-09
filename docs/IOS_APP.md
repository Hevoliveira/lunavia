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
- **Cinematography** (`AscentScene.jsx`): every beat names the hardware it must show and the
  camera distance is solved so it fits inside the screen area the HUD leaves free — PAD,
  CLIMB, MECO (engine section, engines off, composed left of the crew-action prompt),
  IMPULSE (separation plane, active stage whole), STAGES and RECEDE (both stages whole on a
  gentle diagonal with Earth's limb below), ACTIVE (burning upper stage). Stage 1 now falls
  back more gently (it was exaggerated), and upper-stage ignition waits until the gap is
  readable. No shake, no cuts.

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

## Validation

Done in Linux with Chromium emulating iPhones: touch only (multi-touch via the DevTools
protocol, no keyboard), simulated safe areas, production builds, **internet blocked**.

| Check | Result |
|---|---|
| Web production build (`yarn build`) | passes (only pre-existing warnings) |
| Unit tests (`yarn test`) | 19 / 19 pass |
| `yarn ios:sync` / `cap sync ios` | passes; no source maps, no `_dbg`, development hooks compiled out |
| Xcode project integrity | `project.pbxproj` parses; referenced files exist; Swift overrides checked against Capacitor's sources, including plugin extensions |
| Lunar descent visibility (iPhone 16 Pro) | lander, predicted touchdown point and primary LZ on screen and uncovered by any HUD element in 164 / 164 samples from 400 m to touchdown; touch landing with two simultaneous touches |
| Full mission by touch, iPhone 16 Pro / SE / Pro Max | launch → staging → manual lunar landing → reentry → parachutes → splashdown → mission complete; no control in an unsafe area, no overlaps, no clipping, all targets ≥ 44 pt |
| Desktop 1440 × 900 regression (keyboard) | full mission and reentry failure / success cases pass; nominal entry at −6.51° → peak 176 W/cm², 7.39 g, splashdown 8.5 m/s (physics files untouched) |
| Application console errors | 0 (only the blocked optional photo is logged) |

**Not verified here:** there is no Mac, Xcode or iPhone in this environment, so the native
build, signing, installation, WKWebView rendering, real-GPU frame rate and thermals, and
audio on a physical device have not been tested.
