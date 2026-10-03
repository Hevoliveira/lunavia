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
                             bar, Home Indicator auto-hide, deferred edge swipes,
                             screen kept awake, no web-view bounce)
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

## Scripts (run in `frontend/`)

| Command | What it does |
|---|---|
| `yarn ios:sync` | Production build without source maps, drop `build/_dbg`, copy into the iOS project (`cap sync ios`). Run after any change to the web game, then commit `ios/App/App/public`. |
| `yarn ios:open` | Open the project in Xcode (macOS only). |

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

## Performance

Measured on the production build at iPhone 16 Pro landscape (852×393 CSS px, 3× screen),
Chromium with SwiftShader (a CPU renderer, so frame rates are **not** representative of an
iPhone GPU; the workload numbers are):

| Scene | Draw calls / frame | Render size | JS heap |
|---|---|---|---|
| Landing hero | 19 | 1704×875 | 11 MB |
| Ascent / staging prompt | 22 | 1704×786 | 14 MB |
| Stage separation | 34 | 1704×786 | 14 MB |
| Cislunar / lunar orbit | 17 | 1704×786 | 16 MB |
| Lunar descent (game) | 26 | 1704×786 | 17 MB |
| Reentry prep / plasma | 20 | 1704×786 | 19–23 MB |

- Device pixel ratio: every `<Canvas>` already caps at 2 (`dpr={[1, 2]}`), so a 3× iPhone
  renders 2× — about 1.3 MP.
- Textures: the largest are the 2048×1024 Earth colour / normal / specular maps
  (≈ 11 MB of GPU memory each with mipmaps); clouds and Moon are 1024×512.
- Particles: fixed counts (star fields 3,500–8,000 points in one draw call each; ascent
  smoke 108 sprites); nothing accumulates over time.
- Shaders compile once per scene mount (each scene has its own WebGL context).

Nothing in these numbers calls for a mobile-specific quality cut, so none was applied.
Watch for thermal throttling on long sessions on older iPhones; the first knob would be
`dpr={[1, 1.5]}` on phones.

## Validation (this change)

Done in Linux with Chromium emulating iPhones: touch only (multi-touch via the DevTools
protocol, no keyboard), simulated safe areas, production build, **internet blocked**.

| Check | Result |
|---|---|
| Web production build (`yarn build`) | passes |
| Unit tests (`yarn test`) | 19 / 19 pass |
| `npx cap sync ios` | passes; 3.7 MB web bundle, no source maps, no `_dbg` |
| Xcode project integrity | `project.pbxproj` parses; all referenced files exist; one target `App`, bundle id `com.lunavia.app.dev`, iPhone only, iOS 15; Info.plist and storyboard are valid XML; Swift overrides checked against Capacitor's `CAPBridgeViewController` API |
| Full mission by touch, iPhone 16 Pro (852×393, notch insets 59/59/21) | launch → staging → manual lunar landing (two simultaneous touches) → reentry → parachutes → splashdown → mission complete; no control in an unsafe area, no overlaps |
| Same, iPhone 16 Pro Max (932×430) | complete, no layout issues |
| Same, iPhone SE (667×375) | complete, no layout issues |
| Desktop 1440×900 regression (keyboard) | full mission, skip-out / overheat / nominal reentry cases and failure paths pass; reentry figures identical to before (peak 174 W/cm², 7.23 g, splash 8.5 m/s) |
| Offline assets | Earth and Moon textures and fonts load with the network blocked; the only failed request is the optional Unsplash backdrop |
| Application console errors | 0 (only the blocked optional photo is logged) |

**Not verified here:** there is no Mac, Xcode or iPhone in this environment, so the native
build, code signing, installation, WKWebView rendering, real-GPU frame rate and thermals,
and the audio unlock on a physical device have not been tested.
