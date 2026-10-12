# LUNAVIA — HANDOFF

**Tagline:** *THE ROAD TO THE MOON.*

Cinematic, NASA-style 3D lunar mission web application. React Three Fiber
front-end, FastAPI + MongoDB back-end, Claude Sonnet 5 flight-director
briefings via SSE. The core playable experience is a physics-based Manual
Lunar Landing; all other flight phases are scripted 3D cinematics.

This document is everything a new developer needs to clone the repository
and run the current version of LUNAVIA end-to-end. No conversation history
is required.

---

## 1. Requirements

| Runtime          | Version                       | Notes                                                                     |
| ---------------- | ----------------------------- | ------------------------------------------------------------------------- |
| Node.js          | **20.x** (tested on 20.20.2)  | Front-end (Create React App via CRACO).                                   |
| Package manager  | **Yarn 1.22.22 (classic)**    | Do **not** use npm — resolutions in `package.json` are yarn-specific.     |
| Python           | **3.11**                      | Back-end (FastAPI + Motor).                                               |
| MongoDB          | **4.4+**                      | Local server on `mongodb://localhost:27017` works out of the box.         |
| Browser          | Any modern WebGL2 browser     | Chromium 110+, Firefox 110+, Safari 16+.                                  |

The app is a WebGL2 real-time 3D application. A GPU with basic modern
support is required for smooth playback.

---

## 2. Repository layout

```
/app
├── HANDOFF.md               ← this file
├── README.md
├── .gitignore
├── design_guidelines.json
├── test_result.md            ← testing protocol scaffold
├── memory/
│   └── PRD.md                ← product requirements document
├── test_reports/
│   ├── iteration_1.json … iteration_5.json  ← historical E2E validation reports
│   └── pytest/
├── backend/
│   ├── .env.example          ← copy to .env
│   ├── requirements.txt
│   ├── pytest.ini
│   ├── server.py             ← FastAPI app (all routes)
│   └── mission_data.py       ← canonical 9-phase mission profile
├── frontend/
│   ├── .env.example          ← copy to .env
│   ├── package.json
│   ├── yarn.lock
│   ├── craco.config.js
│   ├── tailwind.config.js
│   ├── postcss.config.js
│   ├── jsconfig.json
│   ├── components.json
│   ├── public/
│   │   ├── index.html
│   │   └── _dbg/             ← historical debug text-dumps (safe to delete)
│   └── src/
│       ├── App.js / App.css / index.js / index.css / lib/utils.js
│       ├── pages/
│       │   ├── Landing.jsx
│       │   ├── Manifesto.jsx
│       │   └── Mission.jsx           ← master mission state machine
│       ├── components/
│       │   ├── RocketModel.jsx       ← LV-001 (Visual Fidelity Pass)
│       │   ├── SpacecraftModel.jsx   ← CSM (cislunar)
│       │   ├── LanderModel.jsx       ← lunar lander
│       │   ├── EarthMoonHero.jsx     ← landing-page hero canvas
│       │   ├── MissionScene.jsx      ← cislunar 3D scene (Visual Fidelity Pass)
│       │   ├── DescentGame.jsx       ← PLAYABLE manual lunar landing
│       │   ├── MissionHUD.jsx
│       │   ├── MissionResult.jsx
│       │   ├── PhaseTimeline.jsx
│       │   ├── PhaseTransition.jsx
│       │   ├── BriefingPanel.jsx     ← SSE briefing consumer
│       │   ├── PdiBriefing.jsx
│       │   ├── DifficultySelect.jsx
│       │   ├── AbortModal.jsx
│       │   ├── CockpitOverlay.jsx
│       │   ├── Navbar.jsx
│       │   ├── scenes/
│       │   │   ├── LaunchCinematic.jsx   ← automatic Earth departure: pad → orbit → TLI (§23)
│       │   │   ├── launch/               ← environment layer (sky/planet shader, clouds) + GPU particles
│       │   │   ├── LaunchComplex.jsx     ← LC-39 pad, tower, flame pit and trench
│       │   │   ├── DescentScene.jsx      ← descent 3D world (used by DescentGame)
│       │   │   ├── ReentryScene.jsx      ← reentry cinematic
│       │   │   └── ControlRoomView.jsx   ← pre-launch mission control room
│       │   └── ui/                       ← shadcn/ui primitives
│       ├── data/
│       │   ├── missionPhases.js        ← client-side canonical phase timings + trajectory math
│       │   ├── landingPhysics.js       ← lunar-descent physics constants, difficulty, scoring
│       │   ├── landerSim.js            ← lunar-descent integrator (game + tests share it)
│       │   ├── landerPilots.js         ← simulated pilots for balance tests (not bundled)
│       │   └── descentProfile.js       ← descent guidance: target band, braking cue, reserve
│       ├── hooks/
│       │   ├── useMissionAudio.js      ← WebAudio comms/TTS
│       │   └── use-toast.js
│       ├── constants/testIds/          ← data-testid catalog
│       ├── plugins/health-check/       ← optional CRA plugin (Emergent-specific, disabled by default)
│       └── plugins/…
└── tests/
    └── __init__.py                     ← pytest placeholder
```

---

## 3. Environment variables

### `backend/.env` (copy from `backend/.env.example`)

| Variable            | Required | Purpose                                                                     |
| ------------------- | -------- | --------------------------------------------------------------------------- |
| `MONGO_URL`         | ✅       | MongoDB connection string (used by mission log endpoints).                  |
| `DB_NAME`           | ✅       | Database name for `mission_logs`.                                           |
| `CORS_ORIGINS`      | ✅       | Comma-separated allowed origins (`*` in dev).                               |
| `EMERGENT_LLM_KEY`  | ⚠️ opt. | Powers `POST /api/mission/briefing` (Claude Sonnet 5 via emergentintegrations). If empty, only the briefing endpoint is affected — the rest of the app runs fine. |

### `frontend/.env` (copy from `frontend/.env.example`)

| Variable                 | Required | Purpose                                                                    |
| ------------------------ | -------- | -------------------------------------------------------------------------- |
| `REACT_APP_BACKEND_URL`  | ✅       | Base URL of the FastAPI back-end. All fetches append `/api/...`.           |
| `WDS_SOCKET_PORT`        | opt.     | Only needed behind the Emergent Kubernetes ingress. Omit locally.          |
| `ENABLE_HEALTH_CHECK`    | opt.     | Emergent CRA plugin flag. Leave unset locally.                             |

**No secrets are committed to the repository.** The current `backend/.env`
and `frontend/.env` are in `.gitignore` and must be recreated locally from
the `.env.example` files.

---

## 4. Install & run

### 4.1 Back-end

```bash
cd backend
python -m venv .venv
source .venv/bin/activate           # Windows: .venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env                # then edit values
# Ensure MongoDB is running on the URL you set in .env
uvicorn server:app --host 0.0.0.0 --port 8001 --reload
```

Backend listens on **http://localhost:8001**. Routes are prefixed with
`/api` (see §9 for the endpoint list).

Notes:
- `emergentintegrations==0.2.0` is a Emergent-hosted PyPI package. If it
  fails to resolve off-platform, install it from Emergent's index:
  `pip install emergentintegrations==0.2.0 --extra-index-url https://d33sy5i8bnduwe.cloudfront.net/simple/`
  or replace the briefing endpoint with a direct Anthropic SDK call
  (see §9).

### 4.2 Front-end

```bash
cd frontend
yarn install
cp .env.example .env                # then edit values
yarn start                          # dev server on http://localhost:3000
```

Front-end listens on **http://localhost:3000**.

Production build:

```bash
cd frontend
yarn build                          # outputs to ./build
```

Serve `frontend/build/` from any static host, and point
`REACT_APP_BACKEND_URL` at your deployed back-end.

### 4.3 URLs / ports

| Service   | Local URL                | Notes                                    |
| --------- | ------------------------ | ---------------------------------------- |
| Front-end | `http://localhost:3000`  | CRA dev server.                          |
| Back-end  | `http://localhost:8001`  | FastAPI + uvicorn.                       |
| MongoDB   | `mongodb://localhost:27017` | Default; override via `MONGO_URL`.    |

---

## 5. Architecture map

### Application entry points

- **Front-end root:** `frontend/src/index.js` → `frontend/src/App.js`
  (React Router with routes `/`, `/mission`, `/manifesto`).
- **Back-end root:** `backend/server.py` (FastAPI app; router prefixed
  `/api`).

### Front-end key modules

| Concern                   | File                                                    |
| ------------------------- | ------------------------------------------------------- |
| Master state machine      | `frontend/src/pages/Mission.jsx`                        |
| Landing / marketing site  | `frontend/src/pages/Landing.jsx`                        |
| Manifesto page            | `frontend/src/pages/Manifesto.jsx`                      |
| Control room (pre-launch) | `frontend/src/components/scenes/ControlRoomView.jsx`    |
| Launch cinematic (auto)   | `frontend/src/components/scenes/LaunchCinematic.jsx` + `data/launchTimeline.js` |
| LV-001 rocket             | `frontend/src/components/RocketModel.jsx`               |
| Cislunar cinematic        | `frontend/src/components/MissionScene.jsx`              |
| CSM spacecraft model      | `frontend/src/components/SpacecraftModel.jsx`           |
| Playable descent          | `frontend/src/components/DescentGame.jsx`               |
| Descent 3D scene          | `frontend/src/components/scenes/DescentScene.jsx`       |
| Lunar lander model        | `frontend/src/components/LanderModel.jsx`               |
| Landing physics constants | `frontend/src/data/landingPhysics.js`                   |
| Lunar-descent integrator  | `frontend/src/data/landerSim.js` (+ `landerSim.test.js`) |
| Descent guidance          | `frontend/src/data/descentProfile.js`                   |
| Mission phase catalog     | `frontend/src/data/missionPhases.js`                    |
| Reentry cinematic         | `frontend/src/components/scenes/ReentryScene.jsx`       |
| Landing hero (Earth+Moon) | `frontend/src/components/EarthMoonHero.jsx`             |
| HUD / result / timeline   | `MissionHUD.jsx`, `MissionResult.jsx`, `PhaseTimeline.jsx`, `PhaseTransition.jsx`, `PdiBriefing.jsx`, `DifficultySelect.jsx`, `AbortModal.jsx`, `CockpitOverlay.jsx` |
| Briefing SSE consumer     | `frontend/src/components/BriefingPanel.jsx`             |
| Audio (comms/TTS)         | `frontend/src/hooks/useMissionAudio.js`                 |

### Back-end key modules

| Concern             | File                          |
| ------------------- | ----------------------------- |
| FastAPI app + routes| `backend/server.py`           |
| Mission phase data  | `backend/mission_data.py`     |

---

## 6. Mission flow (current implementation)

`Mission.jsx` drives a state machine. States listed in playback order:

| # | State                | Type              | User interaction                                          |
| - | -------------------- | ----------------- | --------------------------------------------------------- |
| 1 | `CONTROL_ROOM`       | **INTERACTIVE**   | Click `LAUNCH SEQUENCE` (`data-testid="control-launch-btn"`) — the only input before the Moon. |
| 2 | `LAUNCH`             | AUTOMATIC cinematic | T-15 count → engine start → liftoff → tower clear → max-Q → MECO → staging → upper-stage ignition → parking orbit → TLI (`LaunchCinematic.jsx`, §23). Optional `SKIP CINEMATIC`. |
| 6 | `SPACE` (cislunar)   | SCRIPTED cinematic| Starts after TLI (mission time 12000 s): Earth recedes, deep-space cruise, Moon grows on approach. |
| 7 | `ORBIT` (lunar)      | SCRIPTED cinematic| Slow orbital drift; enables `INITIATE DESCENT` (`btn-descend`) when overhead LZ. |
| 8 | `DIFFICULTY`         | **INTERACTIVE**   | Pick CADET / ASTRONAUT / COMMANDER.                        |
| 9 | `BRIEFING`           | **INTERACTIVE**   | `PdiBriefing` — controls & limits card, click `BEGIN PDI`. |
|10 | `MANUAL_DESCENT`     | **PLAYABLE**      | Full lunar-landing gameplay (`DescentGame.jsx`).           |
|11 | `RESULT`             | **INTERACTIVE**   | Score screen, retry / abort / continue.                    |
|12 | `RETURN` (TEI + coast)| SCRIPTED cinematic|                                                            |
|13 | `REENTRY`            | **PLAYABLE**      | Earth entry gameplay (`ReentryGame.jsx` + `data/reentryPhysics.js`), see §18. |
|14 | `MISSION_COMPLETE`   | End screen        | Splashdown wrap.                                           |

Abort/retry: `AbortModal.jsx` is reachable from `MANUAL_DESCENT` and
returns to `CONTROL_ROOM`.

---

## 7. Current implementation status

### WORKING (validated in `test_reports/iteration_5.json`, 9/9 PASS, 0 console errors)

- Landing / marketing site (`/`) with 3D Earth+Moon+trajectory hero.
- Full mission state machine end-to-end (CONTROL_ROOM → MISSION_COMPLETE).
- Control room UI + `LAUNCH SEQUENCE` gate.
- Countdown (10 s) with audio.
- **Launch complex** (service tower, umbilicals, lightning masts, water
  tower, fuel spheres) — `AscentScene.jsx`.
- **Ignition sequence**: pre-ignition venting vapor, ignition flash,
  instanced lateral shader-based smoke billows, dust ring, liftoff.
- **LV-001 multi-stage rocket** (`RocketModel.jsx`): 5-engine first-stage
  cluster, engine skirt, tank stringer rings, orange LUNAVIA bands,
  black intertank band, lattice interstage, single vacuum bell on S2,
  service module + boost protective cover + launch escape tower + Q-ball
  tip + orange beacon.
- **Layered exhaust plumes**: sea-level orange (bright core → mid → outer
  + shock diamonds + dynamic point light) → vacuum blue translucent
  (wide translucent cone + soft blue fill light) on S2.
- **Stage separation** (MECO → coast → impulse ring + puff → gradual
  relative drift + subtle tumble → delayed S2 ignition).
- **Atmospheric ascent**: gradient sky dome (blue → violet → black),
  curved Earth below, cloud layer parallax, condensation contrail.
- **Cislunar** (`MissionScene.jsx`): corrected craft display radius
  (spacecraft was previously inside the oversized Earth), illuminated
  Earth on TLI departure, Earth recession during cruise, Moon growth on
  approach, sun repositioned so the departure shows a lit gibbous Earth
  and the approach a crescent Moon, hemisphere fill light so the hull
  never becomes pure black, burn-window-only engine glow (TLI/LOI/TEI).
- **Documentary cameras**: low pad shot, climb tracking, MECO arc,
  dedicated separation shot, TLI chase, off-shoulder cruise, Earth→Moon
  pan, behind-craft lunar approach, slow lunar-orbit drift.
- **Trajectory line** split into outbound + return legs.
- Difficulty select (CADET / ASTRONAUT / COMMANDER).
- **PDI briefing card** (`PdiBriefing.jsx`) with controls map, safe
  touchdown limits, entry state, `BEGIN PDI` action.
- **Manual lunar descent gameplay** (`DescentGame.jsx` +
  `data/landingPhysics.js`):
  - Semi-implicit Euler integrator, 60 fps physics, 15 Hz UI sync.
  - Lunar gravity, main-engine throttle, thrust, fuel burn, mass update.
  - Vertical velocity, horizontal velocity, RCS, attitude, angular
    inertia.
  - 3 difficulty tiers (initial state + safe-touchdown limits).
  - Landing zones, hazard bands, projected landing point (`projected-lz`).
  - Dynamic warnings, altitude callouts (Apollo comms).
  - Touchdown detection (with lock), crash detection, mission fail.
  - Scoring (Vy 35 / Vx 15 / Acc 25 / Tilt 15 / Fuel 10 = 100).
  - Multiple cameras (external / cockpit / nav) — `view-*` testids.
  - Retry, pause, abort.
- Mission result screen (`MissionResult.jsx`) with per-component grade.
- Return-to-Earth cinematic.
- Reentry cinematic (`ReentryScene.jsx`).
- Splashdown / mission complete screen.
- SSE briefing endpoint (`POST /api/mission/briefing`) streams
  Claude Sonnet 5 flight-director voice in PT-BR.
- Mission-log endpoints exist on the back-end.

### PARTIAL

- Cockpit interior is a 2D SVG overlay (`CockpitOverlay.jsx`), not real
  3D geometry.
- Terrain in `DescentScene.jsx` is a heightless plane with hazard bands;
  no slope-based safe-zone logic.
- `DescentGame.jsx` is a single ~960-line file (physics + rendering +
  HUD). Works, but flagged for later split (P2 in backlog).

### SCRIPTED / CINEMATIC (playable-looking but not interactive gameplay)

- Launch, ascent, staging, cislunar cruise, lunar orbit approach, TEI,
  reentry, splashdown. All timing-driven.

### PLACEHOLDER

- None currently.

### NOT IMPLEMENTED (backlog, documented in `memory/PRD.md`)

- Front-end call to `POST /api/mission/log` after a completed descent
  (endpoint exists but is not wired from the client).
- Lunar Orbit Insertion as gameplay (currently cinematic).
- Lunar ascent + rendezvous as gameplay.
- Terrain heightfield with slope-based safe zones.
- Mobile responsive HUD (fixed `w-[300px]` widths).
- Real 3D cockpit interior.

---

## 8. Persistence

- **Database:** MongoDB. Connection string from `MONGO_URL`, database name
  from `DB_NAME`. Driver: `motor==3.3.1` (async).
- **Collections in use:** `mission_logs` — schema below.
- **Initialization required:** none. Collections are created lazily on
  first insert.
- **Runtime dependency:** the front-end **does not currently call** the
  mission-log endpoints. The playable mission runs entirely client-side
  and needs the back-end only for the briefing SSE stream. **You can run
  LUNAVIA without MongoDB** if you also skip the mission-log endpoints
  (they will error at runtime, but nothing in the front-end triggers
  them today). To be safe, run MongoDB anyway.

### `mission_logs` schema (see `backend/server.py`)

```jsonc
{
  "id": "uuid4 string",
  "session_id": "client-generated string",
  "phase_id": "e.g. p07",
  "mission_time_s": 12345.6,
  "altitude_km": 100.0,
  "velocity_kms": 1.68,
  "delta_v_remaining_ms": 2100.0,
  "timestamp": "ISO-8601 UTC"
}
```

No PII is written. No user credentials, no session tokens, no auth is
implemented — LUNAVIA has no user accounts.

---

## 9. AI back-end (Claude Sonnet 5 briefing)

**Files involved**
- `backend/server.py` — `POST /api/mission/briefing` streams Server-Sent
  Events.
- `backend/mission_data.py` — canonical phase data referenced by the
  prompt.
- `frontend/src/components/BriefingPanel.jsx` — front-end SSE consumer.

**Model & vendor**
- Provider: **Anthropic Claude Sonnet 5** (`claude-sonnet-5`).
- Access on the Emergent platform: `emergentintegrations` Python SDK,
  authenticated by the `EMERGENT_LLM_KEY` universal key.

**Endpoints consumed by the front-end**
- `GET  /api/`                        — health.
- `GET  /api/mission/phases`          — full phase catalog.
- `GET  /api/mission/phases/{id}`     — phase detail.
- `POST /api/mission/briefing`        — SSE stream of briefing text.
- `POST /api/mission/log`             — write telemetry (unused today).
- `GET  /api/mission/log/{session}`   — read telemetry.

**Environment variable required for briefing**
- `EMERGENT_LLM_KEY`.

**Off-Emergent replacement**
The briefing route calls `emergentintegrations.llm.chat.LlmChat`, which
is a thin abstraction over Anthropic's SDK. If you cannot install
`emergentintegrations`, the code inside the route is straightforward to
port — replace the `LlmChat(...).with_model("anthropic", "claude-sonnet-5")`
+ `stream_message(...)` block with Anthropic's `client.messages.stream`
call and yield each `TextEvent.delta` in the same SSE format
(`data: {chunk}\n\n` + `event: done\ndata: [DONE]\n\n`). No other code
depends on this SDK.

**Secrets** — never committed. `.env` is gitignored.

---

## 10. Emergent-specific dependencies (must-replace off-platform)

The project runs on the Emergent Kubernetes platform. The following items
are Emergent-specific and can be removed or replaced on a fresh
environment:

| Item                                            | What it does                                    | Off-platform action                                                                     |
| ----------------------------------------------- | ----------------------------------------------- | ---------------------------------------------------------------------------------------- |
| `EMERGENT_LLM_KEY`                              | Universal key for Anthropic/OpenAI/Gemini.      | Replace with your own Anthropic API key + swap the SDK (see §9).                        |
| `emergentintegrations==0.2.0` (Python)          | Emergent-hosted PyPI package.                   | Install from the Emergent extra index or port the briefing route to Anthropic SDK.       |
| `@emergentbase/visual-edits` (frontend devDep)  | Emergent-only in-browser editing overlay.       | Safe to remove from `package.json` `devDependencies` for external builds.               |
| `WDS_SOCKET_PORT=443` (frontend env)            | CRA WebSocket hint for K8s ingress.             | Omit locally.                                                                            |
| `ENABLE_HEALTH_CHECK` + `frontend/plugins/health-check/` | Emergent health-check plugin injected via CRACO. | The plugin only activates when `ENABLE_HEALTH_CHECK=true`. Safe to leave in the repo; leave the env var unset. |
| `.emergent/` folder (`emergent.yml`, cron, markers) | Emergent platform metadata + cron dispatchers. | Not needed off-platform. Safe to keep or delete.                                        |
| `/api/*` ingress prefix                         | Emergent ingress rule.                          | Kept as-is: `server.py` mounts routes under `/api`, and `REACT_APP_BACKEND_URL` handles the base. Works everywhere. |
| Supervisor (`supervisord`)                      | Runs both services under supervisor on Emergent.| Not required off-platform — use `uvicorn` and `yarn start` as documented in §4.         |

Nothing else in the repository depends on Emergent infrastructure. The
front-end is a plain CRA + CRACO React app; the back-end is a plain
FastAPI service.

---

## 11. Assets

### Textures — hosted, fetched at runtime

Earth and Moon textures are loaded at runtime from the public three.js
examples CDN. Referenced from:

- `frontend/src/components/EarthMoonHero.jsx`
- `frontend/src/components/MissionScene.jsx`
- `frontend/src/components/scenes/DescentScene.jsx`
- `frontend/src/components/scenes/ReentryScene.jsx`
- `frontend/src/components/DescentGame.jsx`

URLs:

- `https://threejs.org/examples/textures/planets/earth_atmos_2048.jpg`
- `https://threejs.org/examples/textures/planets/earth_normal_2048.jpg`
- `https://threejs.org/examples/textures/planets/earth_specular_2048.jpg`
- `https://threejs.org/examples/textures/planets/earth_clouds_1024.png`
- `https://threejs.org/examples/textures/planets/moon_1024.jpg`

**Consequences**
- These URLs must be reachable at runtime. There is no offline fallback.
- License: three.js's `examples/textures/planets/*` are derived from NASA
  Visible Earth imagery (public domain). If you want to self-host, mirror
  the five files into `frontend/public/textures/` and update the five
  const declarations above. No other code changes are needed.

### Local assets

- **Fonts:** none bundled. UI typography is CSS-defined (system + Tailwind
  defaults).
- **Images:** none — the app is entirely procedural 3D + shaders + SVG.
- **Audio:** none as files. The comms and TTS are generated at runtime by
  `frontend/src/hooks/useMissionAudio.js` using the browser's Web Audio
  API + `SpeechSynthesis`.
- **Models:** all 3D geometry is defined procedurally in React Three
  Fiber components (`RocketModel.jsx`, `SpacecraftModel.jsx`,
  `LanderModel.jsx`, launch complex inside `AscentScene.jsx`). There
  are no GLTF/GLB files.
- **Shaders:** all shaders are inline in the R3F scene files
  (`AscentScene.jsx` sky dome, atmosphere fresnel, instanced smoke;
  `MissionScene.jsx` atmosphere fresnel; `RocketModel.jsx` plume
  materials; etc.). No external `.glsl` files.
- **Icons:** `lucide-react` (in dependencies).
- **Debug leftovers:** `frontend/public/_dbg/` contains historical
  plain-text dumps of components from earlier debugging sessions. Safe to
  delete; unused at runtime.

Nothing needs to be downloaded manually before running the project other
than the three.js texture CDN reachability described above.

---

## 12. Testing

### 12.1 Historical validation

- `test_reports/iteration_5.json` — most recent full-mission E2E run,
  9/9 verification points PASS, 0 console errors, 0 page errors.
- Screenshots referenced inside the JSON live in the Emergent automation
  output tree and are not committed. See the `test_report_links` field
  for filenames.
- Earlier iterations (`iteration_1..4.json`) validated the physics of the
  manual lunar landing across Playwright timing edge cases.

### 12.2 Manual smoke test (recommended before shipping)

1. Start MongoDB, back-end, front-end (see §4).
2. Open `http://localhost:3000`.
3. Landing hero should render 3D Earth + Moon + trajectory arc.
4. Navigate to `/mission`. Control room appears.
5. Click **LAUNCH SEQUENCE** → the Earth departure plays on its own
   (~80 s): countdown, ignition, liftoff, ascent, MECO, staging, upper
   stage, Earth orbit, TLI. No further input until lunar orbit.
6. Optionally press **SKIP CINEMATIC** — it goes straight to the cruise.
7. (Staging is automatic: no button.)
8. Cislunar cruise: Earth visible and lit early on, Moon grows during
   approach.
9. Lunar orbit: **INITIATE DESCENT** becomes enabled ("GO FOR PDI").
10. Pick a difficulty → PDI briefing card → **BEGIN PDI**.
11. Manual landing HUD live, gauges responsive, throttle/RCS input works.
12. Either land or abort. Result screen appears.
13. Continue → return coast → reentry → splashdown.
14. Browser console: should be free of application errors. (Three.js may
    emit driver-level performance warnings — expected.)

### 12.3 Automated

- Back-end: `pytest` scaffold in `backend/pytest.ini` (no tests
  currently). Add tests under `backend/` or `tests/` as needed.
- Front-end: `yarn test` runs the CRA Jest scaffold (no tests currently).
- E2E: previous iterations used the Emergent testing subagent
  (Playwright-based). Reports are in `test_reports/`.

---

## 13. Git integrity

At handoff time:

```
Branch:    main
HEAD:      e3e9ce1  Passagem de Fidelidade Visual — 9/9 PASS
Ahead:     0
Behind:    0
```

Untracked files that were included in the handoff commit:
- `frontend/yarn.lock` (required for reproducible installs)
- `yarn.lock` (workspace lockfile stub)
- `HANDOFF.md` (this file)
- `backend/.env.example`
- `frontend/.env.example`

`.env` files are intentionally excluded (see `.gitignore`).

No git history was rewritten.

---

## 14. Transfer instructions

### 14.1 Clone a fresh copy

```bash
git clone <your-remote-url> lunavia
cd lunavia
cp backend/.env.example  backend/.env    # then fill values
cp frontend/.env.example frontend/.env   # then fill values
```

### 14.2 Bring MongoDB up

Any MongoDB 4.4+ instance. Local option:

```bash
docker run -d -p 27017:27017 --name lunavia-mongo mongo:6
```

### 14.3 Boot services

Two terminals:

```bash
# Terminal 1 — back-end
cd backend && python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn server:app --host 0.0.0.0 --port 8001 --reload

# Terminal 2 — front-end
cd frontend && yarn install && yarn start
```

Open `http://localhost:3000`.

### 14.4 Deployment notes

- Any static host can serve `frontend/build/` (Netlify, Vercel, S3+CF,
  etc.). Set `REACT_APP_BACKEND_URL` to the deployed API URL before
  `yarn build`.
- Any container platform can run the back-end (single `uvicorn` process).
  Only outbound dependency is Anthropic (if the briefing route is used).
- The `/api` path prefix is a hard convention in this codebase — keep it
  in your ingress rules.

---

## 15. Known issues

- **Three.js texture CDN dependency** — five Earth/Moon textures load
  from `threejs.org` at runtime. If that host is unreachable, planets
  render as solid materials. Mirror the files locally to eliminate the
  dependency (see §11).
- **`emergentintegrations` PyPI package** — Emergent-hosted; may need the
  extra index URL to install off-platform. See §4.1.
- **Playwright headless throttling** — `requestAnimationFrame` is
  throttled under headless testing, which historically caused
  false-positive physics failures. Mitigated: `Mission.jsx` caps
  simulation `dt` at 0.1 s, and `landingPhysics.js` sub-steps its
  integrator.
- **`DescentGame.jsx` monolith** — ~960 lines mixing physics, rendering,
  and HUD. Works today, flagged for split.

---

## 16. Do not lose

The following systems were validated and must survive the transfer
unchanged:

- **Visual Fidelity Pass** (`RocketModel.jsx`, `AscentScene.jsx`,
  `MissionScene.jsx`, and the `dt`/pacing tweaks in `Mission.jsx`).
  Confirmed present in the repository at handoff time.
- **Manual Lunar Landing** (`DescentGame.jsx`, `data/landingPhysics.js`,
  `data/descentProfile.js`, `scenes/DescentScene.jsx`,
  `LanderModel.jsx`, `PdiBriefing.jsx`, `DifficultySelect.jsx`,
  `MissionResult.jsx`). All physics values, scoring weights, difficulty
  parameters, safe-touchdown limits, and control mappings are as-shipped
  and were **not** modified during the handoff.

---

## 17. Claude environment migration (post-Emergent)

Sections 1–16 describe the project as handed off from Emergent and are kept
for history. This section records what changed so LUNAVIA runs with **no
access to Emergent infrastructure**. No game code under `frontend/src/` was
modified; physics, visuals, scoring and the scripted reentry are unchanged.

### 17.1 What was removed / isolated

| Item | Change | Why |
| ---- | ------ | --- |
| `@emergentbase/visual-edits` (frontend devDep) | Removed from `package.json` and `yarn.lock` (only its own 4-line lock entry; no other versions moved). | Hosted on `assets.emergent.sh`; blocked `yarn install`. `craco.config.js` already skips it when absent. |
| `emergent-main.js` script tag in `public/index.html` | Removed. | Loaded from `assets.emergent.sh` on every page view. |
| PostHog snippet in `public/index.html` | Removed. | Sent analytics + session recordings to Emergent's `ap.emergent.sh` under Emergent's project key. Not part of the game. |
| `emergentintegrations==0.2.0` (backend) | Removed from `requirements.txt`. | Only on Emergent's private index; blocked `pip install`. |
| `POST /api/mission/briefing` | Now returns **503** when `emergentintegrations` or `EMERGENT_LLM_KEY` is missing (was an unhandled ImportError). | The front-end never calls it (`BriefingPanel.jsx` is not rendered anywhere). |
| `WDS_SOCKET_PORT=443` in `frontend/.env.example` | Commented out. | Breaks the dev-server websocket on localhost. |

Harmless legacy, intentionally kept: `.emergent/` (platform metadata, unused),
`frontend/plugins/health-check/` (inactive unless `ENABLE_HEALTH_CHECK=true`),
the `try/catch` visual-edits hook in `craco.config.js`, the root `.gitconfig`
(not read by git), and the Emergent-branded `<title>` / meta description in
`public/index.html` (cosmetic). No supervisor config exists in the repo.

### 17.2 Install & run

The game is fully client-side. **The backend and MongoDB are optional**: the
current front-end makes no backend calls during the mission.

```bash
# Front-end (required) — Node 20+/22, Yarn 1.22 classic
cd frontend
cp .env.example .env
yarn install          # uses the committed yarn.lock
yarn start            # http://localhost:3000
yarn build            # production bundle in ./build

# Back-end (optional) — Python 3.11
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
cp .env.example .env
uvicorn server:app --host 0.0.0.0 --port 8001
```

The backend starts without a running MongoDB (Motor connects lazily); only
the unused `/api/mission/log` endpoints need one.

### 17.3 Environment variables

| File | Variable | Required | Notes |
| ---- | -------- | -------- | ----- |
| `frontend/.env` | `REACT_APP_BACKEND_URL` | yes (build-time) | `http://localhost:8001`. |
| `frontend/.env` | `ENABLE_HEALTH_CHECK` | no | Leave unset. |
| `frontend/.env` | `WDS_SOCKET_PORT` | no | Leave unset locally. |
| `backend/.env` | `MONGO_URL`, `DB_NAME` | yes (read at startup) | Any value works if you don't use the log endpoints. |
| `backend/.env` | `CORS_ORIGINS` | no | Defaults to `*`. |
| `backend/.env` | `EMERGENT_LLM_KEY` | no | Briefing endpoint only; returns 503 without it. |

### 17.4 External runtime assets (unchanged, not Emergent)

Earth/Moon textures (`threejs.org`), Google Fonts, and the control-room
backdrop photo (`images.unsplash.com`, `ControlRoomView.jsx`) are still
fetched at runtime. See §11 to self-host.

### 17.5 Validation performed at migration

- `yarn install`, `yarn start`, `yarn build`: pass (pre-existing warnings only:
  a missing third-party source map and one `react-hooks/exhaustive-deps` in
  `useMissionAudio.js`).
- Backend: `pip install -r requirements.txt` and `uvicorn` start; `/api/` and
  `/api/mission/phases` return 200.
- Automated tests: none exist (no Jest test files; no pytest tests).
- Headless Chromium end-to-end run (Playwright, keyboard-driven autopilot):
  full mission CONTROL ROOM → … → MISSION COMPLETE with a CADET landing
  graded S; COMMANDER no-input crash → RESULT (F) → RETRY; DESCENT → ABORT →
  CONTROL ROOM; EXT/COCKPIT/NAV cameras. 0 page errors; no requests to any
  Emergent host.

---

## 18. Playable Earth reentry + LV-001 Fidelity II

The scripted reentry cinematic has been replaced by the second genuine
flight-gameplay system in LUNAVIA. The manual lunar landing is unchanged.

### 18.1 Files

| File | Role |
| ---- | ---- |
| `frontend/src/data/reentryPhysics.js` | Pure, deterministic entry simulation (no React). |
| `frontend/src/data/reentryPhysics.test.js` | Jest tests: nominal / too shallow / too steep, recovery, corridor, determinism, step convergence. `yarn test` |
| `frontend/src/data/reentryGuidance.js` | Difficulty, guidance bands, presentation time scale, blackout / phase labels. Never alters physics. |
| `frontend/src/components/ReentryGame.jsx` | Playable layer: approach, ENTRY PREP, bank control, HUD, corridor gauge, failure / retry, abort. |
| `frontend/src/components/scenes/ReentryScene.jsx` | Rendered from live sim state: plasma, Earth limb, sky, chutes, ocean, splashdown. |
| `frontend/src/components/RocketModel.jsx`, `scenes/AscentScene.jsx` | LV-001 Fidelity II geometry/materials and ascent/separation cinematography. |

### 18.2 Physics model (simplified, internally coherent)

- Planar point-mass entry over a spherical, non-rotating Earth; fixed-step
  RK4 at `SIM_DT = 0.02 s` of simulation time.
- Atmosphere: `ρ = 1.225·exp(−h/7200 m)`.
- Capsule: 5560 kg, 11.95 m², C_D 1.29 (β ≈ 361 kg/m²), trim L/D 0.30.
  Drag `D = ½ρv²·C_D·A/m`; lift `L = (L/D)·D`, and only its vertical
  component `L·cos(bank)` shapes the trajectory (cross-range ignored).
- Heating: Sutton-Graves stagnation rate `q = k·√(ρ/R_n)·v³` (R_n 4.69 m),
  integrated to heat load.
- G-load: sensed aerodynamic deceleration `|D, L| / g₀`.
- Vehicle limits (outcomes emerge from these, no angle rules):
  structural 12 g; heat shield over-design budget 90 J/cm² absorbed above
  200 W/cm²; ablator capacity 32 kJ/cm².
- Skip-out: after entering, the capsule climbs back above 121 km.
- Chutes: drogues when h ≤ 7.3 km and v ≤ 220 m/s; mains when
  h ≤ 3.2 km and v ≤ 90 m/s after drogue inflation; both inflate over time
  (reefing), splashdown success requires mains and v < 15 m/s.
- Roll is rate-limited to 20°/s of simulation time.

Survivable EI flight-path angle under ideal lift modulation: about −5.5° to
−7.2° (the tests re-derive this), close to Apollo's documented −5.3° to −7.4°.

### 18.3 Time

Simulation time advances only in fixed `SIM_DT` steps. Presentation time
maps to it through `timeScaleFor()` (4× during the rising heat pulse, up to
32× under main chutes). Rendering reads the state each frame.

### 18.4 Controls

ENTRY PREP: `W/S` or `↑/↓` trims the planned EI angle with the final RCS
corridor-correction burn (limited Δv); `A/D` or `←/→` sets the initial lift
vector; `Enter` commits. Entry: `A/D`, `←/→` or `Q/E` roll the lift vector
(up = shallower, down = steeper). `P` pauses, `G` toggles CADET lift assist.

### 18.5 Difficulty (guidance only — physics identical)

| | CADET | ASTRONAUT | COMMANDER |
| - | - | - | - |
| Entry-angle dispersion to trim out | ±0.6° | ±1.2° | ±1.8° |
| RCS trim Δv | 8 m/s | 7 m/s | 6.5 m/s |
| "GO" guidance band around −6.5° | ±0.7° | ±0.5° | ±0.3° |
| Corridor zones on the gauge | yes | yes | no |
| Outcome prediction (look-ahead sim) | yes | yes | no |
| Bank cue + lift assist (`G`) | yes | no | no |
| Skip-risk warning | yes | yes | no |

The originally proposed ±2.5° / ±1.5° / ±0.8° bands were narrowed: the
physics corridor is only ~1.7° wide in total, so wider bands would have
called fatal angles "GO".

### 18.6 Visuals

- Plasma is driven by the simulated heat rate: faint violet ionization,
  bow-shock cap ahead of the heat shield, edge-lit sheath along the
  afterbody, downstream wake, ablation sparks, heat-shield glow.
- Comm blackout (v > 6 km/s and q > 20 W/cm²) silences comms only;
  telemetry stays live.
- Earth limb / sky / ocean are placed by true altitude; drogues and mains
  inflate from the physics deployment events.
- LV-001 Fidelity II: lathe bells with dark interiors, engine cavity and
  thrust structure, per-engine plume origins, panel-seam textures, ribbed
  interstage with separation joint and retro motors, upper-stage thrust
  cone and vacuum bell, CSM adapter / radiators / CM cover, trussed LES.
  Static parts are batched by material (fewer draw calls than before).

### 18.7 Validation at delivery

- Unit: 19/19 (`yarn test`). Build: `yarn build` passes (pre-existing
  warnings only).
- Headless Chromium, full mission with keyboard-only pilots: nominal −6.5°
  → splashdown 8.5 m/s (peak 7.4 g, 176 W/cm² at 56.9 km, drogues 7.3 km /
  132 m/s, mains 3.2 km / 62 m/s); −5.0° → skip-out; −8.0° → thermal loss.
  Crash→retry and descent→abort unchanged. 0 application console errors.

### 18.8 Known limitations

- Planar model: no cross-range, Earth rotation, Mach-dependent aero or
  radiative heating.
- The corridor constants in `CORRIDOR` are guidance display values derived
  from the physics; the tests fail if they drift from what the physics does.
- Earth/Moon textures still load from the three.js CDN (see §11).

## 19. Native iPhone app (Capacitor)

LUNAVIA ships as an installable iOS app built from the same React / Three.js
game. The web version is unchanged in behaviour; no physics, guidance or
mission-progression code was touched.

- Project: `frontend/ios/App/App.xcodeproj` (Capacitor 8, Swift Package Manager,
  iOS 15+, iPhone, landscape only, fullscreen).
- Refresh the app after web changes: `cd frontend && yarn ios:sync`, then commit
  `frontend/ios/App/App/public`.
- Temporary bundle id `com.lunavia.app.dev`: replace it in Xcode and in
  `frontend/capacitor.config.json` (details in `docs/IOS_APP.md`).
- Essential assets (planet textures, fonts) are bundled; the mission runs offline.
- Mobile layout uses Tailwind screens `short` (landscape phones) and `touch`
  (coarse pointers), plus safe-area margins `safe-ml / safe-mr / safe-mb`.
- Flight controls use `components/HoldButton.jsx` (multi-touch, pressed state,
  release on cancel).
- iOS audio is unlocked on the first tap (`hooks/useMissionAudio.js`).

Developer notes: `docs/IOS_APP.md`. Non-programmer install guide:
`INSTALL_ON_IPHONE.md`.

## 20. iPhone gameplay UX + Visual Fidelity III

Driven by the first physical-iPhone test. Presentation and input only: lunar gravity,
thrust, fuel use, landing scoring and hazards, entry physics, heating, G-load,
parachutes, progression and difficulty are unchanged.

- **Lunar descent on phones**: split controls on the lower edges (throttle left thumb,
  tilt + RCS right thumb), slim telemetry, a measured gameplay visibility area, and an
  adaptive camera that keeps the lander, predicted touchdown and LZ inside it
  (`DescentGame.jsx`, `lib/cameraFraming.js`). Landing markers now use the same
  physics-to-scene mapping as the lander (`WORLD_X`).
- **Mission mode**: the website navbar is hidden during active flight on landscape phones
  (`html[data-flight]`, `--hud-top`).
- **LV-001 Fidelity III** (`RocketModel.jsx`), **launch complex** (`scenes/LaunchComplex.jsx`),
  sky environment map, pad shadows, anisotropic filtering.
- **Staging cinematography** (`scenes/AscentScene.jsx`): beats framed by solving for the
  hardware that must be visible.
- **Xcode**: `prefersHomeIndicatorAutoHidden` must not be overridden (Capacitor 8 declares
  it `public`); the Home Indicator is hidden via `plugins.SystemBars.hidden`.

Details, measurements and validation: `docs/IOS_APP.md`.

## 21. iOS build identity and stale-install hardening

Triggered by a physical-iPhone report showing the pre-§20 descent UI after a fresh ZIP
download. The committed bundle (`ios/App/App/public`, `main.7013b6f6.js`) did contain the
§20 UI, so the repository was not stale.

- **Build label**: the home screen shows `LUNAVIA iOS · BUILD <commit> · <UTC time>`,
  compiled into the bundle by `craco.config.js`. The same data is in
  `public/build-info.json`.
- **Native phone layout**: inside the app, `html[data-native="1"]` forces the
  `short`/`narrow` Tailwind variants, `useCompact()` and the flight navbar hiding,
  independent of the reported viewport height.
- **Install guide**: deleting the old app, deleting the old folders, opening from Finder and
  Clean Build Folder are now mandatory update steps. No script is needed on the Mac.

Details: `docs/IOS_APP.md` → *Build identity and stale installs*.

## 22. iPhone lunar landing UX refinement

Driven by the first physical-iPhone test of §20. Presentation and input only. Lunar
gravity, thrust, fuel, RCS, tilt, landing limits, hazards, scoring and mission flow are
unchanged.

- **Camera** (`DescentCamera`, EXTERNAL):
  - The lander is sized first, at roughly 12–18 % of the visibility area's height.
  - A nearby LZ is kept in frame; then the view leans towards the projected touchdown
    point within that zoom budget.
  - Off-frame LZ and touchdown point get edge chips.
  - A dashed no-thrust arc shows the trajectory to the touchdown point.
- **Controls** (`CompactDescentHud`, phones): tilt, RCS and throttle are now one cluster
  in the lower-right corner, replacing the left/right split. Telemetry is one compact
  panel on the lower left.
- **Lander** sits on its footpads at altitude 0 (visual offset only).

Details and measurements: `docs/IOS_APP.md`.

## 23. Cinematic Earth departure (automatic)

The outbound flight from LAUNCH to lunar orbit needs no input. `LaunchCinematic.jsx`
replaces `AscentScene.jsx` and the `SEP_PROMPT` gate. It is driven by
`data/launchTimeline.js` (shots, events, mission clock, trajectory and engine schedules,
unit-tested in `launchTimeline.test.js`).

- **Sequence (~102 s since §24)**: T-15 count with venting and HBOI sparklers → staggered
  five-engine start (6.5 s before release, stack "twang") → hold-down release and a slow,
  heavy rise → tower clear → atmospheric ascent through cirrus with max-Q → MECO (plume
  tails off, nozzles cool) → separation motors → spent stage tumbles away, seen from its
  own onboard camera as the vacuum engine lights → leaving the atmosphere → upper-stage
  cutoff in a 185 km parking orbit → five orbit compositions through orbital sunset and a
  night pass → TLI restart at sunrise → LUNAR TRANSFER with the Earth receding, then the
  cruise (from mission time 12000 s, after the burn).
- **Rendering**: two layers. The environment is true scale: one full-screen shader
  ray-traces the planet and its atmosphere (single scattering, exact horizon at any
  altitude, thin limb in orbit), plus true-altitude clouds. The vehicle, pad and
  particles are drawn at pad scale over a cleared depth buffer, so the vehicle is never
  oversized against the Earth.
- **Effects**: GPU particle pools for smoke, steam, dust and the trail, plus fire, sparks
  and the turbulent plume. They are world-anchored, so smoke stays at the pad; each pool
  is one draw call. The flame pit and a west-facing trench carry the exhaust. The plume
  has shock-diamond cores at sea level and expands with altitude.
- **Audio**: synthesized roar with crackle, hold-down clank, structure-borne staging
  thud, venting hiss, pad ambience, deliberate silence at MECO, and a restrained drone in
  space (the vacuum carries no external sound).
- **Unchanged**: descent physics, scoring, fuel, hazards, difficulty, reentry, splashdown,
  mission completion and the descent touch controls.

Details, measurements and validation: `docs/IOS_APP.md` → *Cinematic Earth departure*.

## 24. COMMANDER rebalance + Cinematic Flight IV

**COMMANDER.** A physical-iPhone test found COMMANDER almost impossible. It was: its
105-unit tank held 93 % of what even an ideal single braking burn needs from the start
state, so no input could land. The integrator moved to `data/landerSim.js` (the game and
the tests share it, and a test proves it reproduces the old inline code). Simulated pilots
with human handicaps (`data/landerPilots.js`, tests only) measured every factor.

- **Changes**: COMMANDER fuel 105 → 160 (1.44× the ideal burn; ASTRONAUT 2.27×), touchdown
  limits 1.5 / 1.0 → 2.0 / 1.2 m/s, tilt rate 38 → 30°/s, plus fine control on all modes
  (a tap trims ~1° or ~0.15 m/s, a held press keeps full authority).
- **Unchanged**: altitude, descent rate, drift, thrust, gravity, hazards and scoring.
- **Guidance** (`descentProfile.js`, all modes): TGT V/S band, BRAKE countdown or stop
  margin, RESERVE (hover seconds beyond the minimum landing fuel), and a touchdown
  prediction along the recommended descent.
- `landerSim.test.js` (25 tests) covers the diagnosis, the hierarchy and every
  success / failure scenario. Full analysis: `docs/COMMANDER_BALANCE.md`.

**Cinematic Flight IV** (`LaunchCinematic.jsx`, `launch/environment.js`, `launchTimeline.js`):

- Ignition: camera exposure surge, pit steam, a ground surge of smoke at release and
  heavier deck billows.
- Separation: an onboard camera on the spent stage watches the upper stage pull away and
  light.
- Earth orbit, five compositions: wide over the Atlantic, close engineering shot over West
  Africa, the atmospheric limb, orbital sunset (warm light on the vehicle over the night
  side), and a night pass with an RCS roll to burn attitude.
- The Sun is fixed in the Earth frame, so day, sunset, Earth's shadow and sunrise follow
  the vehicle's position.
- Earth shader: sub-texture cloud and land detail from orbit, a tighter rippled glint,
  thinner orbital haze, night-side city lights and a tighter Sun glare.
- TLI at sunrise on the second orbit, then the Earth recedes to a globe (19 000 km).
- Audio: sub-bass rumble, pyro and clank at staging, RCS thumps, and Quindar tones on
  space-to-ground calls.


## 25. Orbit finale polish + larger lander (EXTERNAL view)

**Orbit finale** (`LaunchCinematic.jsx`, `launch/environment.js`, `launchTimeline.js`).
The orbit shots A–C are kept. The last part of the parking orbit is now its own six-shot
finale, and the sequence runs 108 s (was 102 s):

1. final Earth pass: the last sunset, the terminator below, the Sun setting into the limb;
2. TLI preparation: the rev 2 night pass, with the RCS roll under the airglow;
3. GO FOR TLI: ullage, a 3-2-1 hold, first light on the limb;
4. TLI ignition at sunrise: the burn carries the vehicle out of the night into daylight;
5. leaving Earth orbit: the camera falls back as the stage climbs away above the sunlit
   Earth;
6. the farewell globe.

- **Light**: a limb twilight band where the terminator meets the atmosphere, green
  airglow on the night side, a Sun starburst, and three additive glint sprites on the
  vehicle's metal bands, driven by the Sun–camera half-vector.
- **Overlay**: an orbit dial and REV in the telemetry while in Earth orbit; a TLI
  countdown with beeps; caption kickers (EARTH ORBIT · REV 1/2, DEPARTURE FOR THE MOON).
- **Audio**: final pass and go-for-TLI calls, ullage, cutoff and "good burn".
- **Unchanged**: the timeline tests still check the sunset, night and sunrise geometry,
  plus the roll, ullage, countdown and revolution count. The ascent, the cruise and
  every mission state are untouched.

**Lander camera.** `LANDER_FRAC_NEAR/FAR` 0.185 / 0.14 → 0.225 / 0.175 in `DescentGame.jsx`.
The lander is about 20–25 % larger in EXTERNAL view. The LZ, the LPD and the visibility
area logic are unchanged. Physics, fuel, hazards, scoring and the touch layout are
untouched.

## 26. Flight Training Center

`/training`, reached from the home screen and the navbar. FLIGHT TRAINING sits above the fold on
phones. It practises the lunar landing and the Earth reentry without the outbound flight; the full
mission is unchanged. Details and validation: `docs/TRAINING_CENTER.md`.

- **Same simulation.** Training mounts the mission's `DescentGame` / `ReentryGame`, with their physics,
  controls, difficulty configs, limits and grading. New optional props:
  - `init` / `scenario`: start state;
  - `coach`: instructor callout;
  - `onResult`: debrief data;
  - `holdSeconds`: "starts in" hold.

  Without them both games behave exactly as before.
- **Lunar scenarios**:
  - standard (mission start, land in the LZ);
  - precision (120 m, reference-descent state, within 3 m of the centre);
  - braking (mission start after 10 s of engine-off coasting, full tank);
  - COMMANDER challenge.

  Every scenario is shown achievable by the simulated human pilots in `trainingScenarios.test.js`.
- **Reentry scenarios**:
  - nominal (PREP −6.5°);
  - shallow (−5.7°, lift up);
  - steep (−6.9°, lift down);
  - COMMANDER (the mission's dispersed prep; the worst case is shown trimmable and survivable).

  The angles were chosen by a real-time simulated-crew sweep.
- **Instructor.** One telemetry-driven callout at a time, with an optional on-device voice and MUTE
  INSTRUCTOR. CADET gets everything, ASTRONAUT concise calls, COMMANDER the objective only.
- **Debrief.** Flown values only, a main reason and 1–2 tips. RETRY / CHANGE SCENARIO / TRAINING
  CENTER / MAIN MENU.
- **Records.** `localStorage`, separate from the mission: personal bests by difficulty.
- **Retry leak fixed.** `DescentGame` disposes its cached textures on unmount; before, each retry
  retained the old renderer, canvas and HUD.

## 27. Mission Control voice

Device speech synthesis is replaced by a cast of mission controllers. They speak from bundled neural
voice clips through a live radio chain, decided by telemetry and scheduled by priority. Details,
approach comparison, validation and the human-recording spec: `docs/VOICE.md`.

- **Cast.** FLIGHT, CAPCOM, GUIDANCE, the onboard COMPUTER (alarms only) and the crew. English and
  Brazilian Portuguese. 69 lines, 99 variants per language, rendered offline with Kokoro-82M
  (Apache-2.0, local CPU, no API) by `tools/voice/render.py` into `frontend/public/voice` (3.0 MB).
- **Who speaks when.** `src/audio/commsDirector.js` keeps one channel:
  - CRITICAL > HIGH > NORMAL > AMBIENT;
  - only CRITICAL cuts a speaker;
  - gaps of silence by priority;
  - cooldowns, dedupe, staleness and a relevance re-check before speaking;
  - blackout gating;
  - verbosity by difficulty (COMMANDER: no coaching).
- **What is said.** `descentComms.js` and `reentryComms.js` read the same assessments the HUDs show
  (`assessDescent`, the entry prediction, heat rate, G) and trigger on sustained conditions with a
  reminder interval. Reentry also drives the link quality (degrading with heat) and the blackout.
- **Mix.** `useMissionAudio` has an SFX bus and a voice bus. The SFX bus is ducked to 60 % (42 % for
  CRITICAL calls) while someone speaks.
- **Player settings.** AUDIO in the navbar: voice on/off, voice language, subtitles, subtitle language,
  volumes, radio effects, RADIO CHECK. Saved in `lunavia.audio.v1`. Subtitles: `CommsSubtitles`.
- **Training.** The instructor card stays. The spoken instructor is now this mission control, and
  MUTE INSTRUCTOR mutes it on that page.
- **Not changed.** Physics, difficulty, controls, cameras, parachutes, progression and
  cinematography. Only the audio calls moved.
- **Premium pack.** Record `tools/voice/RECORDING_SCRIPT.csv` with voice actors and replace the MP3s,
  keeping the file names. No code change is needed.

## 28. Lunar orbit: no more spinning Moon before the descent

On iPhone the Moon appeared to spin rapidly under the spacecraft on the LUNAR DESCENT screen.

- **Root cause** (measured by replaying the camera at 60 fps):
  - In the lunar-orbit shot the camera's orbit angle was `missionTime × 0.015`, while the ORBIT
    state advanced mission time at 300× real time. The camera target circled the Moon at 258°/s.
  - The smoothing lag pulled the camera in to about half a radius above the surface. The surface
    beneath it swept past at about 130°/s, and the picture panned at about 120°/s.
- **Contributing problems:**
  - at the end of the cruise the lagging camera kept looking back at the Earth, then whipped
    ~110° onto the Moon in half a second;
  - the Moon then turned at ~17°/s while the craft was drawn inside it;
  - the craft lapped the Moon every 24 s;
  - the Moon mesh had its own spin;
  - ORBIT, DIFFICULTY and BRIEFING each mounted a new scene, so the camera snapped;
  - mission time jumped from 270000 to 288000 on entering orbit;
  - GO FOR PDI ran on a 10-second timer unrelated to the craft.
- **First fix (82a32ff) was not enough.** It limited rotation *rates* (≤ 12°/s), but the camera
  still swung around the Moon on arrival: 39° at the end of the cruise, 27° in the hand-over and 42°
  in the push-in, about 110° in the first ~14 s. On the phone that still read as the Moon turning.
  Tests now bound the *total* apparent rotation.
- **The rule now** (`data/lunarOrbitShot.js`, pure, 19 tests): once the Moon is big on screen, the
  camera never moves around it.
  - It stays on one fixed ray from the Moon's centre, moving only along it (dolly) and tilting.
  - The point of the surface under the camera never changes, so the surface cannot slide.
  - The Moon has one fixed orientation in every shot.
  - Measured in the app at 667, 852, 932 and 1280 px wide (`window.__lvMissionView`): 0.000° of
    sweep in orbit and on the prep screens, and 0° in the cruise while the Moon is larger than 8°.
- **Arrival** (`APPROACH`, MissionScene cruise shots ≥ 55000 s):
  - The camera turns from the Earth to the Moon on a time-based schedule, fast while only stars are
    in view and slowing as the small Moon comes in.
  - It then follows the craft down a fixed ray from the Moon and stops at 4.4 radii while the craft
    flies on.
  - At loss of signal (207000 s, craft ~1.9 radii out) `Mission.jsx` fades to black. It never shows
    the craft reaching the drawn Moon, which the display trajectory does at ~225000 s.
  - Lunar orbit opens from black (`LOS_FADE_OUT_MS` / `LOS_FADE_IN_MS`).
- **Orbit:**
  - The landing site is on the face the camera sees (`CAMERA_RAY`, `LZ_UP`), in 17.6° morning
    sunlight from the east.
  - The craft flies east to west (left to right). Its arrival is time-compressed, then eases into a
    1° creep past PDI that is bounded however long the player reads.
  - GO FOR PDI lights at ~9 s.
  - The camera holds the whole Moon, then dollies in from 3.6 to 1.5 radii while tilting (≤ 8°/s)
    to the settled composition: craft upper left over the surface, site ahead, the bottom-right
    corner clear for the prompt on every phone size.
  - The orbit craft uses `SpacecraftModel matte` (a less metallic hull), so it reads without an
    environment map.
- **Also:**
  - `Mission.jsx` mounts one scene for the cruise, orbit and prep screens. The orbit clock lives in
    a ref, so there is no React render per frame.
  - BEGIN PDI fades through black into the descent.
  - The display geometry (`craftScenePos`, `displayRadius`) moved to `data/sceneTrack.js` so tests
    use the scene's own numbers.
- **Unchanged:**
  - the descent's initial state and physics (`DescentGame`, `landerSim` untouched);
  - scoring, difficulty and controls;
  - reentry, Training, and the Earth launch, orbit and TLI sequences.

## 29. Lunar touchdown fidelity (the final 50 m)

The touchdown is still captured, graded and scored only by `landerSim` / `landingPhysics`
(capture at 0.5 m, the same thresholds and scoring). Everything below is presentation that
reads that state (`data/touchdownFx.js`, pure, 23 tests; drawn by
`components/scenes/TouchdownFx.jsx`).

- **Vertical scale near the ground.** The scene drew 0.05 unit/m, so with a 1.75-unit LM
  (35 "metres" tall) the last 50 m looked like the LM was already on the ground.
  `sceneAlt(alt) = 0.05·alt + 3·(1 − e^(−alt/15))` keeps 0.05 unit/m high up. Near the surface
  it gives 0.25 unit/m, the LM's true 7 m height. The LM, the camera and the predicted path all
  use it.
- **Regolith sheet** (`RegolithSheet`, one instanced draw call, 900 streaks, motion in the vertex
  shader).
  - Vacuum behaviour: straight, flat (1–3°), fast grains radiating from where the plume meets
    the ground (shifted by the attitude). They never billow, and they vanish the instant the
    engine stops; grains already in flight finish their run.
  - Level: `dustLevel(alt, throttle)`. It starts at 30 m, is continuous and monotonic in thrust
    and height, and is dense at hover thrust near the ground.
  - A light flow sheet on the ground races outward with it (`GroundMarks`). After landing, a
    slightly brighter blast zone stays.
  - Fairness: per-streak opacity ≤ 0.42, nothing drawn within 1.35 units of the plume axis (the
    pads stay visible), and the LZ rings, hazards, LPD and predicted path render after the dust
    (`renderOrder` 2), so dust can never hide them.
- **Landing gear** (`LanderModel`).
  - Legs at front/back/sides. Each has a primary strut (sleeve + stroking piston), two
    secondary struts and a dished footpad (lathe).
  - Contact probes sit on three legs; the front leg carries the ladder.
  - All struts, probes and rungs are one `InstancedMesh`, and the pads another, so the gear is
    two draw calls.
  - The flame now follows the real throttle.
- **Foot contact.** With a bank the low-side pad touches first and its strut compresses
  (`legContact`); past the stroke the body rides up on it. No pad ever goes below the surface
  (tested). Contact shadows under each pad, and the LM's shadow, darken as they close.
- **Settle** (`touchdownPlan`, `settleStep`). The struts take the load as a damped spring:
  harder landings compress further, within the stroke, and the LM rocks level onto four pads
  in < 1.2 s. A failed landing plays out its graded reason:
  - vertical: struts bottom out and crush;
  - tilt: leans over to ≤ 26°;
  - drift or terrain: ~13–14° lean.
- **CONTACT LIGHT / ENGINE STOP.**
  - The probes reach the surface at 1.7 m (`PROBE_ALT`). The blue CONTACT LIGHT lamp, a relay
    click with a soft tone, and the crew's "Contact light." (moved from 4 m) happen together.
  - At capture, the ENGINE STOP lamp comes on and the rumble cuts in 60 ms, with a valve thunk
    and pressure bleed (`useMissionAudio.engineStop`). The touchdown thud is sized by the
    impact (`touchdown`).
  - The lamps are steady panel lamps, not red alarms.
- **The shot after a landing** (EXTERNAL view, `touchdownCamera`).
  - From the chase camera: one crane down and in on a sphere round the LM (≤ 12° of swing),
    ending low with the horizon and stars above the LM.
  - The HUD fades and the picture recentres. The result card waits for it
    (`RESULT_DELAY.landed` 5.2 s; failures 3.0 s with a short camera jolt).
  - In COCKPIT the LM's own deck is hidden from the window view.
- **Validation tooling** (validation only, read-only): `window.__lvDescentInit` (start state),
  `__lvDescentPhys`, `__lvDescentFx`, `__lvDescentGl` (renderer.info), `__lvDescentFreeze`
  (hold the physics for an exact screenshot).

**Architecture note, not done (needs approval).** The simulation treats the ground as a flat
plane with hazard *zones*: touchdown is graded at one point (the LM's x) at 0.5 m. Per-leg contact
on real terrain would need:
- a terrain heightfield shared by the sim and the scene;
- leg geometry and per-pad contact detection in `landerSim`;
- a rule for grading a touchdown that spans uneven ground;
- re-validated difficulty balance.

That would change outcomes (for example, a pad on a boulder edge), so it is left for an explicit
decision. Today the visual settle only plays out the graded result.

## 30. Lunar landing sites

Four landing sites for the Training Center. The full mission always lands at Mare
Tranquillitatis (`MISSION_SITE_ID` in `data/landingSites.js`). Its orbit cinematic, captions
and PDI are Tranquillity's, so switching the mission's site is a deliberate change, not a
setting.

| Site | Reference | Terrain | Approach | Primary LZ | Sun |
|---|---|---|---|---|---|
| MARE TRANQUILLITATIS | Apollo 11 | flat mare, the four marked hazards, West crater | from −x (the mission's), offset 0.3 | 6 m | 14° |
| FRA MAURO | Apollo 14 | rolling ejecta ridges (flanks past 12°), Doublet craters, Cone crater boulders | from +x, offset 0.3 | 6 m | 13° |
| HADLEY–APENNINE | Apollo 15 | Apennine flank under the approach, Hadley Rille beyond the LZ, mountains | from −x, steep (offset 0.18) | 5 m | 17° |
| TYCHO REGION | Surveyor 7 | crater- and boulder-dominated ejecta; melt ponds the only safe ground | from +x, offset 0.24 | 4 m | 22° |

The sites are visual and geographic references, not reconstructed topography.

**One site description drives both the physics and the drawing** (`data/landingSites.js`,
pure, 28 tests):
- `height(x, z)`: compact analytic features (craters with rims and ejecta, hills, ridges, a
  mountain front, a rille, swells, gentle noise) and smoothed LZ patches. Metres above the
  primary LZ's centre.
- `rocks`: generated once from the site seed. Boulders are ≥ 0.9 m and debris ≤ 0.35 m;
  nothing is generated in between.
- `zones`: the landing zones. The primary is always at x = 0, so `gradeLanding`'s accuracy
  score is unchanged.
- The LM flies in the plane z = 0, so its footpads stand at (x ± 4.3 m, 0) and (x, ± 4.3 m).

**Physics changes (requested: "physically consistent terrain collision")**
- `landerSim` integrates the height `y` above the site's datum. `alt` is measured to the
  first thing the LM would meet coming down (`contactGround`): the highest ground under a
  footpad, a boulder under a footpad, or a boulder or mound reaching the engine skirt
  (0.88 m). Touchdown is still captured at `alt` ≤ 0.5 m. Flight dynamics, controls and the
  `DIFFICULTY` table are unchanged.
- At touchdown, `site.evaluate(x)` replaces the old flat hazard zones. It reports UNSAFE
  TERRAIN, graded by `gradeLanding` with the same thresholds and scoring, when any of these is
  under the LM's footprint (4.87 m radius):
  - a boulder;
  - ground sloping more than 12° across the footpads (the LM's design limit);
  - a footpad on ground steeper than 20° (a crater wall);
  - unevenness the struts cannot take up (0.36 m);
  - a mound reaching the engine skirt.
- New per-site constraints, stated, not silent:
  - the LZ radius (6/6/5/4 m), which the STANDARD and COMMANDER objectives use;
  - the approach side and start offset. The start's altitude, descent rate and drift are the
    difficulty's own.
- At Tranquillity the four hazards are where they were, now as real craters and boulders.
  The unsafe ground around each now includes the footprint, so a pad on a boulder is a crash.
  Outside the hazards the ground is flat at the datum, and the mission start is bit-identical
  (tested).
- `predictTouchdownX(p, cfg, site)` measures the height left to the ground at the predicted
  point.

**Scene scale.**
- Near the ground the vertical scale now equals the horizontal one: 0.5 unit/m, true
  proportion, so a 12° slope looks like 12°.
- The LM is drawn at true size (`LM.scale` 2.4): 7 m tall, footpads 4.3 m from the axis.
- `verticalScale(bandTop)`: true scale from the lowest crater floor to the highest ground
  near the track, blending to 0.05 unit/m above it. It is a function of height, not of
  height above the ground, so the LM never bobs as terrain passes under it.
- Dust, ground marks, the touchdown shot and the camera are scaled with the LM.

**Drawing** (`data/terrainMesh.js`, pure, 15 tests; `components/scenes/LunarSite.jsx`):
- **Terrain.** One mesh, about 65k vertices: 1 m cells over ±112 × ±48 m, growing to ±2 km.
  It is lit by the site's low Sun. Shadows of the terrain itself are baked per vertex
  (horizon march), and a procedural regolith texture adds detail at two scales.
- **Albedo.** Per-site palette: ejecta halos on fresh craters, brighter steep slopes,
  highlands at Hadley, rays and dark melt ponds at Tycho.
- **Rocks.** Two instanced meshes (boulders, debris), each drawn exactly as the physics
  knows it: same position, top and radius (tested).
- **Shadows.** A real-time shadow map (PCF, 2048, ±44 units) follows the LM; the LM and
  the boulders cast into it.
- **Sky.** Stars and the Earth travel with the camera. The Earth sits where it hangs in that
  site's sky, and the distant mountains on the horizon are baked-shaded silhouettes.
- **Markers** (drawn after the dust, `renderOrder` 2), laid on the terrain:
  - The LZ rings.
  - The **unsafe-ground strip**: exactly `hazardMap` (the touchdown evaluation), crimson
    hatching across the footprint's width, legible from 400 m.
  - The **landing point designator**: the LM's footprint ring at the predicted touchdown point,
    yellow when the ground there is safe, red when it is not.
- **Landing.** The LM's legs meet the ground under each footpad (terrain or boulder top).
  After touchdown it settles onto the plane of that ground (bank and pitch). The
  scour, blast zone and pad shadows are laid on the terrain.
- **Camera.** It follows the approach direction and never goes below the terrain.

**Training UI.**
- LUNAR LANDING SIMULATOR → **LANDING SITE**: four cards, a live 3D preview (the same scene
  with an LM on the LZ for scale and the approach path), an elevation profile along the track
  (unsafe stretches in red, LZs, the approach side), and the site's terrain, approach, LZ and
  Sun.
- SELECT SITE → the scenario screen, with the site in the header (tap to change).
- All four scenarios work at every site: starts are placed on the site's approach.
- Records are kept per site. Tranquillity keeps the old keys, so earlier records stay; the
  personal bests add up all four.

**Validation tooling** (read-only): `window.__lvDescentScene`, and `__lvLandingPoint` (the LPD's
x, safety and label).

**Validation.**
- **Jest:** 207 tests pass (147 before). They cover:
  - the site catalogue and determinism;
  - terrain contact (uphill pad first, boulder tops, slopes, crater walls, flying into a ridge);
  - what is drawn is what is flown (mesh heights, every rock, the hazard strip);
  - LZ placement, starts and terrain consequences;
  - the full scenario × site × difficulty feasibility matrix with simulated pilots.
- **In the app** (headless Chromium, 852×393, in-page autopilot from each difficulty's real
  start): all 12 site × difficulty landings reached OBJECTIVE COMPLETE.
- **Hazards:** a vertical touchdown on each site's hazard was graded CREW LOST with the right
  cause: Tycho BOULDERS, Fra Mauro RIDGE FLANK · 31°, Hadley RILLE · 35°, Tranquillity
  CRATER · 29°.
- **Performance** (final 50 m, headless software renderer, which is not an iPhone GPU):

  | Build | Frame time | Draw calls | Triangles |
  |---|---|---|---|
  | Before (flat ground) | 117–133 ms | 35 | 4k |
  | Tranquillity | 267 ms | 33 | 68k |
  | Tycho | 283 ms | 32 | 84k |

  `DescentGame` steps quality down on a device that cannot hold its frame rate: pixel ratio
  first (2 → 1.5 → 1.25), then the real-time shadows. `window.__lvQuality` pins a step for
  validation.

## 31. iPhone release branch

**Symptom.** The iPhone kept running an old game after a fresh ZIP, Clean Build Folder and
install.

**Cause.** The wrong branch was downloaded; nothing on the Mac or the phone was at fault. The
work was delivered as a stack of branches, each with its own correct bundle:

| Branch (PR) | Adds | Bundle BUILD |
|---|---|---|
| `claude/ios-app` (#3) | iOS app, COMMANDER rebalance, Flight IV, Earth-orbit finale | cb874af |
| `claude/flight-training-center` (#4) | Training Center | 4bdfab9 |
| `claude/mission-control-voice` (#5) | Mission Control voice | 8e64f2a |
| `claude/lunar-orbit-fix` (#6) | lunar orbit rotation fix | 22cef22 |
| `claude/lunar-touchdown-fidelity` (#7) | touchdown fidelity | d5e31db |
| `claude/lunar-landing-sites` (#8) | landing sites | 967162b |

`INSTALL_ON_IPHONE.md` told the reader to download `claude/ios-app` every time, and every
later branch inherited that line. That download is a consistent, working build from
10 October, without any later feature. PR #2 (playable reentry) is already contained in
`claude/ios-app`. There is one Xcode project and one bundle identifier on every branch. No
Capacitor config has a server URL, and there is no service worker.

**Fix.**
- **The release branch.** `claude/ios-release` is the tip of the stack, with no merges,
  plus:
  - this release tooling;
  - its own bundle;
  - `IPHONE_VERSION.md` at the top, naming the BUILD and its features.
- **The guide.** `INSTALL_ON_IPHONE.md` now names `claude/ios-release` and gives the direct
  ZIP link.
- **Reproducible builds.** The build identity uses the source commit's time, so rebuilding
  a commit gives byte-identical files.
- **The verifier.** `yarn ios:verify` (`scripts/verify-ios-bundle.js`, also run by
  `yarn ios:sync`) checks that:
  - `public/build-info.json` and the compiled label name the same build;
  - `index.html` loads a bundle that exists, with no leftovers;
  - no Capacitor server URL is set;
  - Xcode's Resources phase copies `public/`, and there is a single bundle identifier;
  - no web source changed since the bundle was built;
  - every feature marker in the source is in the bundle.

  It also runs on an unpacked GitHub ZIP: `node scripts/verify-ios-bundle.js <folder>`.

**Releasing a new iPhone build.**
1. Bring `claude/ios-release` up to the newest finished branch (fast-forward or merge).
2. Commit the source, run `yarn ios:sync` on the clean tree, and update
   `IPHONE_VERSION.md`.
3. Commit, then push.

## 32. Lunar module visual fidelity

**Why the LM looked like a placeholder** (audited on BUILD 91c520e):
- **Shape.** About a dozen primitives:
  - a plain box cabin with one black rectangle for a window;
  - a smooth eight-sided gold cylinder for the descent stage;
  - an eight-sided cone for the engine;
  - one antenna;
  - landing gear of uniform thin silver rods.

  Nothing broke the silhouette, so from the chase camera it read as a box on a drum.
- **Materials.** They had no texture. They were metallic, but nothing in the scene was
  there to reflect, so the metal came out flat dark grey and the gold came out mustard.
- **Light and shadow.** The LM did not receive shadows (no self-shadowing). The only
  ground contact cue was the four pad shadows.
- **Engine.** The plume was a pale cone hung under a small nozzle, with no visible
  link to the engine.
- **Size.** 46–62 px tall on an 852×393 phone, 15–21 % of the clear view; 11 meshes,
  1,424 triangles.

**The new LM.**
- **Shape: `data/lmDesign.js`** (pure, core three.js, tested in `lmDesign.test.js`).
  - *Ascent stage:*
    - a faceted cabin with bevelled edges and a raked front with the hatch;
    - a dark window facet with two framed triangular windows;
    - darker side panels;
    - side propellant pods with LUNAVIA's orange bands;
    - an aft equipment bay with radiator ribs;
    - four RCS quads on booms, each with four thrusters;
    - a docking tunnel, a rendezvous radar, a steerable S-band dish and two VHF whips.
  - *Descent stage:*
    - an octagonal foil body with framed equipment bays (dark foil on the sides, gold
      fore and aft);
    - a top rim band and deck, leg outriggers, the porch with handrails and an
      equipment box;
    - a heat shield, the engine skirt, a gimbal ring and a real bell nozzle.
  - *Gear (`legFrames`, built per frame in `LanderModel`):*
    - a foil-wrapped primary sleeve, a shock-absorber collar and a piston that strokes
      on touchdown;
    - two secondary struts and a V downlock truss;
    - dished footpads on ball joints;
    - the probes, with the ladder on the front leg.
- **Contact contract (tested).** These are unchanged: footpad bottoms, centres and
  radius; the nozzle exit plane; the 7 m height; the probe length. They are what
  `touchdownFx` and the physics use, so drawn = flown still holds.
- **Materials: `components/LanderModel.jsx`.**
  - *Paint:* matte paint with procedural panel seams, fasteners and light wear; a
    darker anodised paint.
  - *Foil:* crinkled gold and black foil (procedural, used as colour, roughness and
    bump).
  - *Other surfaces:* bare metal; a dark engine with a lining that glows from the
    throat with thrust; dark reflective glass; matte black; LUNAVIA orange.
  - *Environment:* a small PMREM environment (black sky over bright regolith, one
    per renderer). It lights metal and foil from below like the sunlit ground, without
    softening the shadows.
- **Engine.**
  - The plume starts at the nozzle exit with the exit's radius: an alpha-blended veil
    that reads over bright ground, and an additive core.
  - The bell lining glows from the throat with thrust, so the flame comes out of the
    engine.
- **Light and depth.**
  - Every LM mesh casts and receives the site Sun's real-time shadow, so the parts
    self-shadow.
  - `GroundMarks` adds a soft occlusion patch draped on the terrain under the descent
    stage from about 10 m down, as well as the pad shadows.
- **Size.**
  - `LANDER_FRAC_NEAR/FAR` go from 0.225/0.175 to 0.255/0.205 of the clear view's
    height, about 13–17 % larger.
  - The framing logic is unchanged: it still includes the LZ and the touchdown point
    when the zoom budget allows, and points to them otherwise.

**Not changed:** physics, thrust, fuel, difficulty, COMMANDER settings, hazards,
touchdown, scoring, training rules, reentry.

**Cost:** see Validation below. The body is one merged geometry per material, about
15 draw calls, and the gear is two instanced meshes.

**Validation** (headless Chromium with software rendering, in-page autopilot from each
difficulty's real start, BUILD 91c520e before vs this branch):
- **Jest:** 213 tests pass (6 new in `lmDesign.test.js`).
- **Landings:** all reached OBJECTIVE COMPLETE with no page errors:
  - ASTRONAUT at 667×375, 852×393 and 1280×800;
  - CADET and COMMANDER at 852×393;
  - COMMANDER at Tycho;
  - CADET at Hadley, 932×430.
- **Nothing covered:** at 300, 100, 20 and 5 m and at touchdown, neither the
  projected touchdown point nor the primary LZ fell inside the LM's screen box in
  any run.
- **Touch:** real multi-touch on the on-screen buttons (THR, THR + RCS together,
  TILT) moves the LM as before, at 852×393 and 667×375.
- **Size on an 852×393 phone:**

  | | 300 m | 100 m | 20 m | 5 m | touchdown |
  |---|---|---|---|---|---|
  | Before | 46 px | 61 px | 55 px | 62 px | 62 px |
  | After | 54 px | 64 px | 62 px | 71 px | 70 px |

- **Cost of the LM itself:**

  | | Meshes | Triangles |
  |---|---|---|
  | Before | 11 | 1,424 |
  | After | 14 | 8,150 |

- **Final 50 m, whole scene:**

  | Site | Frame median | Draw calls (median / max) | Triangles |
  |---|---|---|---|
  | Tranquillity | 200 → 200 ms | 31/34 → 34/36 | 67.7k → 75.3k |
  | Tycho | 200 → 217–233 ms (3 runs) | 30/33 → 33/35 | 83.9k → 91.5k |

  The Tycho cost is the physically based shading of the LM's pixels in the
  software renderer. On the phone, the descent's quality step-down still applies.
