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

**Superseded (§49).** The Earth and the Moon now use NASA textures shipped in
`frontend/public/textures/planets/` (see `SOURCES.md` there), drawn by the shared
renderer in `frontend/src/components/planets/`. Nothing is fetched at run time; the
three.js example textures listed here before were removed.

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

## 33. Four lunar landing missions

The Training Center's lunar landing now offers four missions, each with its own terrain,
piloting problem and briefing. The full mission still lands at the Sea of Tranquility
(`MISSION_SITE_ID`).

| Mission | Kind · level | Reference | Terrain | Approach | Primary LZ | Sun | Earth |
|---|---|---|---|---|---|---|---|
| SEA OF TRANQUILITY | WIDE PLAIN · 1 BEGINNER | Mare Tranquillitatis · Apollo 11 | broad mare with gentle swells off the track, sparse old craters, the four marked hazards | from −x, offset 0.3 (the mission's) | 6 m | 14° | 62° up |
| HADLEY–APENNINE | MOUNTAIN VALLEY · 2 INTERMEDIATE | Apennine Mountains · Apollo 15 | the Apennine flank under the approach, Hadley Rille beyond the clearing, mountains on every side | from −x, steep (0.18) | 5 m | 17° | 64° up |
| TYCHO HIGHLANDS | CRATER REGION · 3 ADVANCED | Tycho ejecta · Surveyor 7 | fresh craters and boulders everywhere; melt ponds the only safe ground | from +x, 0.24 | 4 m | 22° | 46° up |
| SILENT HORIZON | FAR SIDE · 4 EXPERT | South Pole–Aitken basin · far side | ancient crater floor: crater wall and talus under the approach, wrinkle ridges, boulder fields, a secondary crater, basin-ring massifs | from +x over the crater wall, 0.26 | 4 m | 11° | below the horizon |

Fra Mauro (§30) is retired to keep four distinct environments. A stored choice of it falls
back to Tranquility, and its old records stay in storage, unused.

**One mission definition** (`data/landingSites.js`, the §30 model) still drives collision,
the touchdown evaluation, the hazard strip, the 3D scene, the preview and the profile. It now
also carries the mission's identity:
- `name`, `short`, `kind`, `ref`, `level`, `rating`;
- `blurb`, `challenge` (the card), and `briefing` (the descent briefing, word for word from
  the brief);
- `earthLink: false` (far side only).

`earth: null` means the Earth is below the horizon: none is drawn, and there is no direct
radio link.

**Silent Horizon: the far side.**
- *Terrain.* The crater wall (a front 16 m high with talus boulders) lies under the
  approach. Wrinkle ridges cross the track west of the LZ, with a boulder field just short of
  it and a 5 m secondary crater just past it. The ancient crater, the broken ridge and the
  basin-ring massifs rise behind.
- *Landing zones.* The primary is a 4 m clearing with hazards about 4.3 m beyond its edge on
  both sides. The alternates are WALL FOOT (+42 m) and BEYOND RIDGE (−52 m). All of them are
  in sunlight (tested). It is daylight on the far side, with the Sun at 11° throwing long
  shadows.
- *Radio: no line of sight to the Earth.*
  - `comms.setEarthLink(false)` uses the reentry blackout's director mode: only onboard
    voices (COMPUTER) and `throughBlackout` lines get through. It has no static burst.
  - CREW's `descent.contact` ("Contact light") is now `throughBlackout`; it is the crew
    in the cabin.
  - `DescentGame` sets the link down for the whole far-side descent and restores it on
    unmount.
  - Houston's calls (CAPCOM, FLIGHT, GUIDANCE) are dropped, including the touchdown
    congratulation. Onboard warnings, telemetry, guidance and hazard indicators are
    unchanged.
  - No relay satellite is invented.
- *HUD.* "◌ EARTH LINK UNAVAILABLE" (`earth-link`) sits under the status in the compact HUD
  and first in the desktop warnings strip. On a safe landing, "FAR SIDE TOUCHDOWN CONFIRMED"
  (`farside-touchdown`) shows under the CONTACT LIGHT / ENGINE STOP lamps, with no
  congratulation.
- *Instructor.* The Training coach's text says "No Earth link: onboard guidance only" once,
  at the start. Its spoken lines are CAPCOM's, so the blackout silences them too.
- *Intro* (`components/training/FarSideIntro.jsx`, about 12.5 s, SKIP at any time; on the
  first far-side start after opening the Training Center):
  1. low over the limb, the Earth sets behind the Moon;
  2. Houston's last transmission, the existing `cruise.ambient` clip ("Everything looks good
     from here. Enjoy the view."), fades as the radio link degrades;
  3. loss of signal brings the static burst, then silence;
  4. "ONBOARD TELEMETRY NOMINAL · GUIDANCE ACTIVE";
  5. the view tips down to the surface, and the descent briefing follows.

  It uses existing voice clips and textures only.
- *Full mission.* The far side is training-only. The mission's orbit cinematic, captions and
  PDI are Tranquility's, and a far-side mission would need its own orbit, LOS and comms
  continuity rather than a teleport.

**Mission selector** (`pages/Training.jsx`).
- LUNAR LANDING SIMULATOR → LUNAR MISSIONS · CHOOSE A DESTINATION shows four cards, one row
  on a landscape phone. Each card has:
  - the terrain image;
  - the level badge (and NO EARTH LINK on the far side);
  - kind, title, reference, description and PILOTING CHALLENGE;
  - TERRAIN pips;
  - START MISSION, which goes straight to the descent briefing.
- Tapping a card selects it. On wider screens, the live 3D preview, the profile and the
  mission's approach, LZ, Sun and EARTH LINK show below the cards.
- The scenario briefing and the descent's hold banner show the mission briefing.
- Difficulty, the four scenarios, retry, the debrief, the instructor and per-mission records
  are unchanged.
- The card images (`public/missions/<id>.jpg`, about 20 KB each) are crops of the live
  preview. Regenerate them if a site's terrain changes.

**Not changed:** gravity, thrust, fuel, RCS, tilt, the COMMANDER rebalance, touchdown limits,
scoring, training objectives, the full mission, reentry.

**Validation** (headless Chromium with software rendering, an in-page pilot flying from
each difficulty's real start; browser tests, not a physical iPhone):
- **Jest:** 220 tests pass (213 before). New tests cover:
  - the catalogue (ids, names, kinds, levels, radii, briefings);
  - the far side has no Earth and no link;
  - the environments are distinct (relief, boulders, unsafe ground, gaps around the LZ);
  - Silent Horizon's hazards crash and its zones are safe;
  - every landing zone is in sunlight;
  - far-side comms: a replayed descent airs only onboard lines, and `setEarthLink` blocks
    and restores Houston.
- **All 12 site × difficulty landings at 852×393 reached OBJECTIVE COMPLETE**, with no page
  errors:

  | | Tranquility | Hadley | Tycho | Far side | Fuel left |
  |---|---|---|---|---|---|
  | CADET | 2.8 m/s · 0.0 m | 2.9 m/s · 0.2 m | 2.6 m/s · 0.2 m | 2.6 m/s · 0.1 m | 83 % |
  | ASTRONAUT | 1.6 m/s · 0.2 m | 1.6 m/s · 0.0 m | 1.1 m/s · 0.1 m | 1.5 m/s · 0.0 m | 43–44 % |
  | COMMANDER | 1.2 m/s · 0.1 m | 1.2 m/s · 0.1 m | 1.3 m/s · 0.1 m | 1.1 m/s · 0.1 m | 12 % |

  Each cell is the touchdown rate and the distance from the LZ centre. RETRY restarted every
  run, with no far-side intro the second time.
- **Simulated pilots** (18 per cell: three reaction lags × six seeds):
  - CADET and ASTRONAUT land 100 % at every site, in every scenario.
  - COMMANDER meets its objectives 78–100 % of the time; on the far side, 78–89 %, which is
    Tycho's range.
- **Hazards:** a vertical touchdown at 1 m/s gave CREW LOST with the right cause on:
  - Tranquility: BOULDERS, CRATER · 29°;
  - Hadley: HADLEY RILLE · 33°, TALUS BOULDERS, APENNINE FLANK · 29°;
  - Tycho: FRESH CRATER, BOULDERS;
  - far side: SECONDARY CRATER, BOULDER FIELD, WRINKLE RIDGE, CRATER WALL · 15°.

  The same touchdown on each primary LZ gave OBJECTIVE COMPLETE.
- **Diversions** from the mission's own start to an alternate LZ landed safely, graded
  LANDED · OBJECTIVE NOT MET because STANDARD asks for the primary:
  - far side, WALL FOOT (ASTRONAUT) and BEYOND RIDGE (COMMANDER);
  - Tycho, NORTH POND (ASTRONAUT);
  - Hadley, BENCH (CADET);
  - Tranquility, ALT LZ WEST (COMMANDER).
- **Far-side comms in the app:**
  - At every difficulty, only two lines aired: Houston's last call in the intro, cut at
    loss of signal, and CREW "Contact light."
  - The blackout dropped 8 Houston calls per descent, the touchdown congratulation among
    them.
  - EARTH LINK UNAVAILABLE shows throughout, and FAR SIDE TOUCHDOWN CONFIRMED on landing.
  - A full far-side RETRY at COMMANDER aired only "Contact light" (10 calls dropped).
  - The other sites air Houston's full sequence.
- **Selector and intro:**
  - At 852×393, 667×375 and 1280×800 the cards fit with their images, and the desktop
    preview panel shows at 1280×800.
  - The intro's captions run in order. SKIP works, and the hold banner shows the briefing.
- **Performance, final 50 m, back to back against BUILD 718ce0c** (two runs each):

  | Site | Frame median, 718ce0c → this branch | Draw calls | Triangles |
  |---|---|---|---|
  | Tranquility | 217–233 → 217–233 ms | 34 → 34 | 75.3k → 75.3k |
  | Hadley | 200–217 → 217 ms | 31 → 31 | 78.4k → 80.1k (horizon ridges) |
  | Tycho | 233 → 233–250 ms | 33 → 33 | 91.5k → 91.5k |
  | Far side | — → 217–233 ms | 33 | 83.6k |

- **Full mission** (the canonical Tranquility mission, flown end to end in the app):
  THE EAGLE HAS LANDED, return, reentry, splashdown, MISSION COMPLETE.

**Limitations:**
- The far side is training-only; the reason is given above.
- The intro's audio (the fading last call, the static burst) is the existing voice pack and
  radio chain. It is untested on a physical iPhone.
- Fra Mauro records from earlier builds stay in storage but are no longer shown.

## 34. One spacecraft from Earth to the Moon; the opening

**What was wrong** (audited on BUILD a360daf). Four different spacecraft flew one mission:

| Phase | Model before |
|---|---|
| Launch, Earth orbit, TLI | `RocketModel`: the upper stage carried a 9.4 m service-module drum, a boost cover and the escape tower. The tower was never jettisoned, and no lunar module was modelled. |
| Cruise, arrival, return | `SpacecraftModel`: a 14-primitive grey cone and drum with blue solar panels, drawn about 900 km long and always rolling. No lunar module; the upper stage simply gone. |
| Lunar orbit | The same icon at 0.2 scale, matte: the small, dark spacecraft. |
| Descent | `LanderModel`, appearing from nowhere: there was no undocking. |
| Reentry | A 3.9 m command module with LUNAVIA's band. |
| Main menu | The icon again. |

**The canonical spacecraft.**
- `data/csmDesign.js` (pure, tested; metres, the long axis +Y, origin at the CM/SM interface) defines the command and service module once. The proportions are Apollo-class and the finish is LUNAVIA's.
  - *Command module:* the reentry capsule's own profile (3.9 m): dished heat shield, the orange band above the shoulder, five windows, the hatch, RCS ports, the docking tunnel and the probe.
  - *Service module:* a 3.9 m drum with the forward fairing and six panel sectors; two radiator panels and the radiator band; four RCS quads of four thrusters; the aft bulkhead; the SPS engine on its gimbal ring; the steerable high-gain antenna on its boom; the umbilical fairing; the LUNAVIA · LV-001 marking along the axis.
- `components/spacecraft/CsmModel.jsx` provides one merged geometry per material (about 11 draw calls) plus instanced RCS puffs. Its materials take the host scene's environment, so the model reads correctly over the Earth and over the Moon.
- The lunar module is the approved `LanderModel`, unchanged. `lmDesign` now also exports its RCS thruster positions.
- `components/spacecraft/SpacecraftStack.jsx`: the lunar module docks upside down, drogue ring on the docking ring, on the CSM's axis (`dockedLmPose`). Nothing passes through the command module (tested). Undocking moves the same two models apart; nothing is swapped.

**Each configuration, and who draws it.**

| Stage | Configuration | Where |
|---|---|---|
| Launch and ascent | CSM on a tapered spacecraft-LM adapter (the LM rides inside), boost cover and escape tower | `RocketModel` |
| Upper-stage burn, T+59.3 s | The escape tower and boost cover are jettisoned on the tower's own motor (caption ESCAPE TOWER JETTISONED) | `RocketModel`, `launchTimeline.LES_JETTISON` |
| Earth orbit, TLI | Upper stage, adapter, CSM | `RocketModel` |
| Translunar coast | CSM and LM docked. The caption says the transposition and docking are done and the upper stage has been left behind; that manoeuvre is not shown. | `MissionScene` |
| Lunar orbit | Docked, LM legs deployed | `MissionScene` |
| Undocking | The LM undocks; the CSM backs away; the two separate | `MissionScene` + `data/undocking` |
| Descent | LM alone | `DescentGame` (unchanged) |
| Return | CSM alone | `MissionScene` |
| Reentry | The same CM (`buildCM({ probe: false })`) and the same SM until it is jettisoned | `ReentryScene` |

The rocket's spacecraft section is now the shared CSM at true size on the adapter. The launch cinematic frames on the CM's nose once the tower has gone, and its glints moved with the hardware.

**True scale, by composition.** `MissionScene` renders two layers every frame, as the launch cinematic does (`data/orbitSequence` explains the frames):
1. the planets in scene units (1 unit ≈ 1,922 km);
2. the spacecraft in metres, over a cleared depth buffer.

The planet camera stands where the spacecraft is, so the Moon below and the Earth behind are seen at the sizes they have from the spacecraft. The spacecraft is never enlarged; camera distance and composition make it read. In wide shots, where a 17 m spacecraft is far below one pixel, it is a sunlit glint on its path. Other changes:
- From lunar orbit, the Earth is drawn at its true size in the sky.
- In the close cruise shot, the Earth's apparent size follows an Apollo-like coast (`coastDistanceKm`), continuing from the launch cinematic's last shot.
- Close to the surface, the Moon's 1k map is softened by about a texel and a fine regolith detail fades in. Its JPEG blocks no longer show, and the wide views are unchanged.

**The mission's lunar orbit** (`data/orbitSequence` ORBIT_SHOTS, `pages/Mission.jsx`):

| Seconds | Shot |
|---|---|
| 0–4.5 | ESTABLISHING: the whole Moon, the orbit, the landing site; the spacecraft a glint (time-compressed arrival) |
| 4.5–11 | LV-001 IN LUNAR ORBIT: tracking shot of the docked stack above the lunar horizon |
| 11–16 | UNDOCKING PREPARATION: close on the docking tunnel |
| 16–26 | UNDOCKING: the latches release (clank), the CSM backs away on its RCS (hiss), the LM rolls to show its gear |
| 26–34 | TWO SPACECRAFT: the CSM stays in orbit, the LM moves on; the separation burn; FLIGHT's "go for powered descent" |
| 34– | The camera stays with the LM while the descent is set up |

- From the cut to the spacecraft, the craft flies at its real orbital rate (0.044°/s at 278 km), so the surface drifts as it would.
- **INITIATE DESCENT is gone.** It only started the descent setup, and the undocking now leads there by itself. The first input after LAUNCH is still the descent setup (difficulty, then BEGIN PDI), as before.
- SKIP TO DESCENT jumps to the end of the undocking. Pause, abort and training are unchanged.
- Descent orbit insertion and the coast down to the powered-descent point are not flown on screen. BEGIN PDI cuts, through black, to the descent's own fixed start.

**Undocking** (`data/undocking`, pure, tested):
- The latches release; the CSM's forward thrusters build 0.35 m/s over 1.6 s.
- The LM rolls 90° at no more than 13.5°/s, with RCS pulses to start and stop.
- A 0.8 m/s separation burn follows.
- Speed and gap are continuous (no jolt), and both vehicles move about their common centre of mass.

**The opening** (`components/opening/OpeningCinematic.jsx`, shots in `data/openingSequence.js`, about 52 s):

| Seconds | Shot |
|---|---|
| 0–4.5 | The whole Moon in deep space; the spacecraft a glint on its orbit |
| 4.5–10.5 | Over the lunar horizon, the spacecraft approaches |
| 10.5–17.5 | Tracking along it: engine, service module, command module, docking, lunar module |
| 17.5–24 | Close on the docking tunnel |
| 24–34 | Undocking (25 s): latches, RCS, the LM's roll |
| 34–41.5 | The two spacecraft above the Moon; FLIGHT's "go for powered descent" |
| 41.5–52 | The camera stays with the LM: LUNAVIA, A LAJU PRODUCTIONS GAME, MASTER THE DESCENT. EXPLORE THE MOON. RETURN TO EARTH., fade to the menu |

- Same Moon, Sun, spacecraft and undocking as the mission.
- **Autoplay:** only the first time on a device (`lunavia.opening.seen`). It never replays on returning to the menu, and ABERTURA on the menu replays it. SKIP INTRO works at any time.
- **No side effects:** no mission state, no records, no descent.
- **Sound** (the existing synthesized pad, clank, hiss and one existing radio line; no new voices) starts on the first tap, since browsers allow audio only after a gesture.
- **Title loop** (`TitleLoop`): the menu's backdrop is now the CSM alone in lunar orbit, the camera drifting round it. It replaces `EarthMoonHero`, which drew the old icon.

**LAJU PRODUCTIONS.**
- "A LAJU PRODUCTIONS GAME" appears in the opening's title, the menu (LUNAVIA · A LAJU PRODUCTIONS GAME) and the footer's CREDITS.
- No logo, company history or affiliation is invented.

**Removed:** `SpacecraftModel.jsx`, `EarthMoonHero.jsx`.

**Not changed:** descent physics, touchdown, scoring, difficulty, training, the four missions, mission timing (only the cinematic time compression during two close shots), reentry physics.

**Performance** (`components/scenes/AdaptiveResolution.jsx`, `MissionScene`):
- The spacecraft is one merged geometry per material, its materials shared singletons (about 11 draw calls for the CSM; the LM is unchanged).
- Shadows only in the spacecraft layer, plain PCF (not soft), one 1,024² map fitted to the stack.
- The Moon's map is filtered at 4× anisotropy (16× cost a quarter of a frame, measured), the regolith detail at 2×.
- The spacecraft's shaders are compiled when the scene mounts, not at the first cut to it.
- The mission, opening and title-loop canvases use the launch cinematic's adaptive resolution: below ~45 fps the pixel ratio steps down (2 → 1.25 at most), never back up.

**Validation** (headless Chromium with software rendering; browser tests, not a physical iPhone):
- **Jest:** 253 tests pass (220 before). New tests:
  - the CSM's profile, proportions and budget (draw calls, vertices);
  - the docked stack (drogue on the docking ring, on the axis; the LM inverted; nothing passes through the CM);
  - the undocking (no jolt, RCS speeds, centre of mass, slow roll);
  - the orbit and opening shots (order, cameras outside the spacecraft, the Sun on the camera's side, captions);
  - the cruise and return true-size distances;
  - the escape-tower jettison.
- **Continuity, frame by frame against BUILD a360daf** (852×393): Earth orbit (escape tower gone, the CSM on its adapter), translunar coast (CSM and LM docked, the Earth at its true size), lunar orbit, before, during and after the separation, the title over the LM.
- **Lunar orbit in the app** at 667×375, 852×393 and 932×430, no page errors:
  - the captions ran in order (LUNAR ORBIT, LV-001 IN LUNAR ORBIT, UNDOCKING PREPARATION, UNDOCKING, TWO SPACECRAFT);
  - the gap opened from 0.07 m at the release to 9.4 m at the hand-over;
  - the descent setup opened by itself at 34.6 s;
  - captions and SKIP TO DESCENT never overlap.
- **The opening** at 852×393 and 667×375, as the iPhone app on first launch, no page errors:
  - it autoplayed, and the seven shots ran in order (undocking at 25 s, the title from 41.5 s);
  - it ended in the menu with the title loop and LUNAVIA · A LAJU PRODUCTIONS GAME;
  - it wrote only `lunavia.opening.seen`, and a stored training record was untouched;
  - it did not autoplay on returning to the menu or on relaunch;
  - ABERTURA replayed it, and SKIP INTRO closed it straight into the menu.
- **Performance, back to back against BUILD a360daf** (852×393, pixel ratio 1; draw calls and triangles counted at the WebGL API):

  | Scene | Frame median, a360daf → now | Draw calls | Triangles |
  |---|---|---|---|
  | Menu backdrop (icon → title loop) | 133 → 117 ms | 19 → 29 | 78.1k → 58.1k |
  | Cruise | 50 → 83 ms | 16 → 7 (111 in the close shot) | 18.8k → 58.8k |
  | Lunar arrival | 50 → 83 ms | 16 → 5 | 18.8k → 38.1k |
  | Orbit, establishing shot | 50 → 100 ms | 17 → 6 | 19.0k → 38.3k |
  | Orbit, close shots of the spacecraft | 67 → 167 ms | 17 → 53 | 19.0k → 74.2k |
  | Opening (new) | — → 133 ms | 52 | 74.2k |
  | Descent, final 50 m (reference, unchanged) | 200 ms | 34 | 75.3k |

  - The close shots draw a real spacecraft close up where a 2-pixel icon was. Switching one feature off at a time, the spacecraft costs about 83 ms of the close shot, the Moon about 67 ms and the shadows about 17 ms.
  - Measured cuts before release: Moon filtering 16× → 4×, plain PCF shadows and shader pre-compilation. Together they took the menu from 133 to 117 ms, the opening from 167 to 133 ms, the close shots from 183 to 167 ms, and the worst cruise frames (p95) from 550 to 367 ms.
  - Every new scene costs less than the descent's final 50 m, the game's heaviest playable scene, on the same machine.
- **Full mission**, flown end to end in the app at 1280×720:
  - launch: all 22 calls aired;
  - lunar orbit: the arrival call and FLIGHT's "go for powered descent" aired, and the descent setup opened by itself (no INITIATE DESCENT);
  - descent: THE EAGLE HAS LANDED;
  - return (the CSM alone), reentry and splashdown, with all calls aired: MISSION COMPLETE.

  The only page error is the external font request the harness blocks.

**Limitations:**
- Transposition, docking and LM extraction are not flown. The translunar caption says they are done and the upper stage has been left behind.
- Descent orbit insertion and the coast to the powered-descent point are not flown (see above).
- The LM's legs are deployed from the translunar coast on (Apollo's stayed folded until lunar orbit). The approved LM model is unchanged.
- In the close orbit shots the lunar surface is the existing 1k map, softened, with a fine regolith detail: no longer blocky, but soft.
- The opening's sound starts on the first tap (iOS allows audio only after a gesture).
- The ascent stage's rendezvous with the CSM is not shown; the return shows the CSM alone.
- All validation ran in a browser with software rendering, not on a physical iPhone.

## 35. One launch vehicle, one spacecraft: the payload and transposition

**What was wrong** (audited on BUILD 11618a2, after an iPhone review of the outbound mission). The CSM was the shared model from the pad to reentry (§34), but the lunar module had no origin:
- the spacecraft adapter was one opaque, empty cone; no lunar module existed anywhere in the launch vehicle;
- after TLI the cinematic jumped twenty minutes, and the cruise opened on a lunar module already docked; "transposition and docking complete" was a caption, and the upper stage simply vanished;
- as drawn, the payload could not have worked: the CSM's deployed high-gain antenna pierced the adapter wall by 2 m, and with its contact probes hanging, the lunar module did not fit (footpads against the tapering wall, probes 1.7 m into the upper stage);
- during the launch the spacecraft was never framed close, so nothing tied the small tip of LV-001 to the vehicles near the Moon.

**The payload** (`data/payloadDesign.js`, pure and tested; `components/spacecraft/PayloadSection.jsx`; metres, origin on the axis at the upper stage's forward bulkhead):

| From the top | Configuration at launch |
|---|---|
| Escape tower + boost cover | Over the command module; jettisoned at T+59.3 s (§34) |
| Command and service module | `CsmModel`; the service module's base on the adapter's top, its engine bell reaching 3 m down into the adapter; the high-gain antenna folded beside the bell (`csmDesign` HGA_FOLD: 47.5° on its hinge, head turned 30°) |
| Spacecraft adapter | A frustum from the upper stage (10.9 m) to the service module (4 m), 11.2 m tall, as before. Now a fixed 1 m ring on the stage and four panels hinged to it, centred on the lunar module's legs |
| Lunar module | `LanderModel`, the approved model, unchanged: upright, legs out, contact probes folded up along the legs, standing on four mounts on the bulkhead. Its drogue is on the vehicle's axis, facing the CSM's engine 1.7 m above |
| Upper stage | Orbit insertion and TLI, then left behind |

Clearances (measured; the tests hold the minimums): lunar module to adapter wall 0.31 m; folded antenna to wall 0.11 m and to the engine bell 0.06 m, and 1.2 m above the lunar module; engine exit 0.86 m above the lunar module's highest point; footpads 0.26 m inside the ring as the lunar module rises out. RocketModel's stations (`SPACECRAFT`) are derived from the same numbers.

**Transposition, docking and extraction** (`data/transposition.js`, pure and tested; launch cinematic 103.5–141.5 s, `TD_START` = 103.5):

| τ (s) | Shot | What happens |
|---|---|---|
| 0.3–3.6 | tdSep | Pyros; the panels swing out 45° on their hinges, then are jettisoned and drift away (0.35 m/s). The lunar module is uncovered, standing on the stage. The CSM backs out 4.6 m on its RCS |
| 5–17 | tdTurn | The CSM turns 180° about +Z, its engine already clear of the adapter, every point at least 1 m above the lunar module |
| 17.5–28.5 | tdDock | It closes in nose first; the probe touches the drogue on the axis |
| 28.5–30.8 | tdDock | Capture latches; the probe retracts and pulls the two together; hard dock, twelve latches |
| 31.5– | tdExtract | The mounts release; the docked pair backs out of the adapter at 0.9 m/s; the stage stays |
| 34.5–38 | tdExtract | The high-gain antenna swings out |
| 38– | farewell | Looking down past the docked spacecraft at the Earth; the spent stage falls behind (the coast at 40×) |

- At hard dock, the lunar module's pose relative to the CSM is exactly `dockedLmPose(0)`, the pose the stack flies to the Moon with (tested). Nothing is swapped: the same `PayloadSection` object that stood on the pad does it.
- Speeds and turn rate are continuous, at most 1.6 m/s and 25°/s (condensed from Apollo's slower turn). RCS puffs fire only while something speeds up, slows down or turns.
- Captions: SPACECRAFT SEPARATION, TRANSPOSITION, DOCKING, DOCKED, LUNAR MODULE EXTRACTED, HIGH-GAIN ANTENNA DEPLOYED, UPPER STAGE LEFT BEHIND. Sounds: pyro thuds, RCS hiss, capture and latch clanks. No new voice lines.
- The mission clock reaches the cruise's start (T+3:20:00) as the cinematic ends; the docking runs at 20×.

**Seeing the lunar module in the rocket.** The pad's second shot (`payload`, replacing the low-angle shot, same 3.5 s) frames the spacecraft from the side away from the tower. For about two seconds the adapter turns translucent with an orange outline, showing the lunar module standing inside under the CSM's engine; caption LUNAR PAYLOAD · LUNAR MODULE INSIDE THE ADAPTER. The rest of the launch shows the vehicle as it is.

**After the extraction:**
- **Cruise:** the docked stack as extracted, probes still folded, antenna deployed. New lunar approach close shot (mission 195,000 s to loss of signal): the same stack, the Moon behind it at its true size, growing from 11° to about 40° across. Caption LUNAR APPROACH.
- **Lunar orbit:** the probes swing down 9–6 s before the latches release (in the mission's stack shot and in the opening), then the undocking of §34, unchanged.

**Lineage** (`data/lineage.js`, tested): one ordered list of configurations from the pad to splashdown. Each step names the event, the parts it removes or joins, the shot that shows it, and the component that draws it. The tests hold:
- no part appears after the pad;
- every part that leaves is shown leaving;
- the CSM and LM that undock in lunar orbit are the ones from the pad;
- every scene draws the spacecraft from `CsmModel` and `LanderModel` only (a source check also fails if a substitute model appears).

**Validation** (headless Chromium with software rendering; browser tests, not a physical iPhone):
- **Jest:** 281 tests pass (253 before). New tests:
  - `payloadDesign`: the fit of the LM, engine bell and folded antenna in the adapter, and that a deployed antenna or hanging probes would not fit;
  - `transposition`: the order of steps; no jumps or jolts; a turn clear of the LM; probe-to-drogue contact and a hard dock equal to `dockedLmPose(0)`; rigid docked motion; extraction clear of the ring; the stage left behind; panels; RCS; antenna;
  - `lineage`: nothing appears after the pad, every removal shown in an existing shot, the same CSM and LM in lunar orbit, no substitute models (a source check);
  - `undocking`: probes folded in the coast and deployed before release;
  - `launchTimeline`: transposition after TLI cutoff, the MET reaching the cruise, the payload reveal only in its shot;
  - `orbitSequence`: the lunar approach.
- **Checkpoints A–H**, frames against BUILD 11618a2 at 852×393: launch, Earth orbit, TLI, transposition and docking, translunar coast, lunar arrival, lunar orbit, undocking. The transposition sequence was also checked at 667×375 and 932×430; the turn camera was widened so the CSM stays in frame at 932×430.
- **Full mission**, flown end to end in the app at 1280×720, no page errors (the harness blocks one external font):
  - launch, now with transposition, all 22 calls aired;
  - lunar orbit: the descent setup opened by itself;
  - THE EAGLE HAS LANDED; reentry and splashdown with all calls aired; MISSION COMPLETE.
- **The opening** (unchanged apart from the probes) at 852×393: autoplay, the seven shots, records untouched, no autoplay on return or relaunch, replay and skip.
- **Performance**: the launch cinematic played in real time, back to back against BUILD 11618a2. Median frame per shot; draw calls counted at the WebGL API; 852×393:

  | Shot | 11618a2 → now | Draw calls |
  |---|---|---|
  | Pad, wide | 283 → 300 ms | 108 → 116 |
  | Pad, payload (was the low-angle shot) | 283 → 333 ms | 108 → 135 (the LM is drawn while the adapter is seen through) |
  | Earth orbit (wide / close) | 167 / 200 → 183 / 200 ms | 25 / 26 → 29 / 30 |
  | TLI | 150 → 150 ms | 29 → 33 |
  | Transposition and docking (new) | 183–233 ms | 40–45 |
  | Farewell | 117 → 150 ms | 25 → 28 |

  - Until the adapter opens (or is seen through) it is drawn as one closed frustum and its band, and nothing inside it is drawn; the open adapter's and the LM's shaders are compiled at mount.
  - A first version without this cost 21 extra draw calls in every launch shot (double-sided transparent panels draw twice); measured and fixed before release.
  - The four extra calls left are the antenna's own hinge group (3) and the adapter's band.
  - The transposition shots cost less than the pad shots (300–417 ms) and the descent's final 50 m (200 ms, §34).

**Limitations:**
- SKIP CINEMATIC skips the transposition with the rest of the launch, by the player's choice; the cruise then shows the docked stack.
- The lunar module rides with its legs out (LV-001's adapter is wide enough at its base); Apollo's were folded until lunar orbit. Its contact probes are folded and deploy in lunar orbit. At 3 cm they are thin, so their swing is subtle at the distances shown.
- The turn and the approach are condensed (the turn averages 15°/s; Apollo's took minutes).
- The upper stage's evasive burn and propellant dump are not shown; it is simply left behind.
- The pad's look inside the adapter is a stylised, translucent view: the real adapter is opaque.
- The ascent stage's rendezvous with the CSM is not flown; the return is the CSM alone (§34).
- No new voice lines: the transposition has captions and mechanical sounds only.
- All validation ran in a browser with software rendering, not on a physical iPhone.

## 36. Cinematic flow: the cislunar coast, lunar orbit insertion and the title inside the mission

**What was wrong** (audited on BUILD 532885b against an iPhone recording, 12 October 2026):
- **The opening played before the game.** `Landing.jsx` mounted `OpeningCinematic` on the first launch on a device (`lunavia.opening.seen` in localStorage): a 52 s film with its own, synthetic undocking, before the player had launched anything. The mission itself never showed the title.
- **2:38–2:54 of the recording (the translunar coast).** Measured frame by frame (`window.__lvMissionView`, 30 fps device timeline):
  - The close departure shot draws the Earth at its true apparent size (6.3° at the cut, 117,000 km). The next shot was a *wide* chase shot in the scene's map scale, where the Earth is drawn 10× oversized and the camera sat at 1.2–1.6× the craft's distance from it, looking back at it: the Earth jumped from 6.3° to 65° across the cut and filled the frame.
  - The chase camera then turned towards a small Moon seen from its night side (a crescent, by design of the old "phase language"), lagging behind a 30,000× time compression: about 4 s of near-black frames (mean luminance 6–7 of 255) with only stars and the red trajectory lines.
  - The close approach shot also looked at the Moon's night side; at loss of signal the dark disc filled the frame, then the picture faded to black (450 ms + 80 ms hold + 1.1 s fade-in; 17 frames below luminance 4) and cut to the wide lunar-orbit shot, with the cruise clock jumping to its end under the black. No lunar orbit insertion was shown.

**The coast now** (`data/orbitSequence.js` `CISLUNAR`, `cruiseTime`, `coastShotAt`; pure and tested). Every shot from TLI to lunar orbit is close on the docked stack; the planet behind it is drawn at its true apparent size for the spacecraft's real distance. The map-scale planets are never seen from close by; in these shots only the planet the shot is about is drawn (`viewRef.only`).

| Real s | Mission t | Shot | What it shows |
|---|---|---|---|
| 0–4 | 12,000–40,000 | DEPARTURE (`cruiseClose`, unchanged) | The stack; the Earth behind it, 26° → 6.3° |
| 4–8.2 | 40,000–150,000 | DEEP SPACE (`deepSpace`, new) | Further back, from the LM's end; the Earth small in the upper right, 6.3° → 2.6° (285,000 km) |
| 8.2–15 | 150,000–207,000 | LUNAR APPROACH (`approachClose`) | The Moon behind the stack, growing at a steady zoom rate (64,000 → 4,600 km, 3.1° → 41°), seen from the side the lunar-orbit shots look at (`APPROACH_RAY`, the orbit camera's azimuth): the same sunlit face, lit the same way. The stack turns engine first for the burn (`approachYaw`: 180° about the local vertical through its middle, a smooth start and stop on the service module's RCS couple) |

- The coast runs on its own real-seconds clock (`cruiseTime`); there is no fade and no clock jump: at 15 s lunar orbit opens.
- The Earth's apparent size only shrinks and the Moon's only grows (tested), and the size is continuous at the departure → deep-space cut.

**Lunar orbit now opens on the insertion burn** (`ORBIT_SEQ`, orbit clock τ):

| τ (s) | Shot | |
|---|---|---|
| 0–5.6 | LUNAR ORBIT INSERTION (`loi`, new) | The stack engine first over the lunar horizon (lit terrain, the Sun from behind and above); the SPS fires retrograde (0.9–4.7 s, a soft start and shutdown); caption BEHIND THE MOON · SPS ENGINE · RETROGRADE BURN · OUT OF CONTACT WITH EARTH; a low rumble aboard |
| 5.6–10.1 | establishing (wide) | Unchanged, shifted: the whole Moon, the orbit, the site; "Lunar orbit insertion looks good. Welcome to the Moon." once the signal is back |
| 10.1–31.6 | stack, tunnel, undock | Unchanged (§34–35); latches release at 21.6 |
| 31.6–36 | TWO SPACECRAFT | Ends closer (32 m) and low in the frame, so FLIGHT's subtitle sits above the two spacecraft. FLIGHT: "Capcom, we're go for powered descent." at 34.8 |
| 36–46.4 | title (new) | No cut: from where the two-spacecraft shot stops, the camera eases in behind the LM as it moves away, the CSM receding; LUNAVIA at 38.6, A LAJU PRODUCTIONS GAME at 41, both gone by 45.8 |
| 46.4– | followLm | The descent setup (difficulty) fades in over the same, still-moving shot |

- `craftAlpha` and `orbitCamera` are measured from `ORBIT_SEQ.arrive`; during the burn the craft flies at its real orbital rate, so the surface does not slide.
- The SPS plume is an exhaust effect added in `SpacecraftStack` (`SpsPlume`, the LM's vacuum plume shader, exported from `LanderModel`); the CSM's geometry is unchanged. `VehicleLayer` now pre-compiles hidden objects too, so the first ignition does not hitch.

**The title, inside the mission** (`data/titleReveal.js`, `components/MissionTitle.jsx`):
- It belongs to the orbit clock, so it plays once per full mission: SKIP TO DESCENT jumps past it with everything else, a restarted landing (back to DIFFICULTY) and BRIEFING → back never replay it, and the Training Center (which never flies the orbit) never shows it. A new mission (RELAUNCH, or LAUNCH after an abort) plays it again.
- The overlay sets its opacities from the orbit clock in its own requestAnimationFrame loop: no React render per frame.
- LUNAVIA is sized to its column (`.title-reveal-name`: min(3rem, 7.5vw − 0.4rem) on phones, min(6rem, 6vw − 0.4rem) from md), measured to fit from 667×375 to 1920×1080 while letter-spaced in the fade.
- Music: the space pad swells in under it (from τ 35.4) and fades as the descent setup opens. All sound in the mission starts after the LAUNCH tap (iOS gesture rule); if the audio context is suspended the title simply plays silent.

**The home screen** opens as it is, every time: the title loop (CSM alone in lunar orbit) and the static LUNAVIA · A LAJU PRODUCTIONS GAME credit. Removed: `OpeningCinematic`, `OpeningScene`'s opening mode, `data/openingSequence.js`, the ABERTURA button and the `lunavia.opening.seen` flag (no longer read or written; an old copy on a device is ignored). The title loop is now one component (`components/opening/TitleLoop.jsx`, `data/titleLoop.js`).

**Descent preparation:** unchanged. The difficulty selection still opens after the orbit (now after the title), as an overlay over the moving LM shot (`veil-in`, 0.9 s), then BRIEFING and BEGIN PDI. Destination (the mission's site) and difficulty are kept through SKIP, BRIEFING → back and restarts.

**Validation** (headless Chromium with software rendering; browser tests, not a physical iPhone):
- **Jest:** 292 tests pass (281 before). New or rewritten:
  - `orbitSequence`: the coast clock; the Earth only shrinking and the Moon only growing at a steady rate, with no jump at the departure → deep-space cut; the planet in frame and the Sun on the camera's side on three iPhone aspects; the turn and its RCS; LOI (engine first, SPS on/off); the title shot continuing the two-spacecraft shot exactly and settling where the descent setup holds;
  - `titleReveal`: the title after the go for powered descent and before the descent setup, absent after SKIP or while the orbit flies on behind the descent setup; the LM clear of the title on three aspects; source checks that the home screen plays nothing and nothing records it;
  - `lunarOrbitShot`: the shifted orbit clock, the approach ray matching the orbit camera's lit face.
- **The 2:38–2:54 window**, recorded on the device timeline (fake clock stepped at 30 fps, 852×393) from SKIP CINEMATIC on BUILD 532885b and on this branch, with the planet's apparent size and the picture's brightness per frame:
  - Before: the Earth jumps 6.3° → 65° at a cut, then about 4 s at brightness 6–7, and 17 frames below 4 (the fade to black).
  - After: the sizes are continuous and no frame falls below 9. The cuts hold scale, orientation and lighting, and the two-spacecraft → title move has no cut.
- **A/B:** first and second launch on a fresh device. The home screen is shown, nothing autoplays, and no flag is written.
- **F:** a Training lunar landing starts normally, with no title.
- **G**, each path back to a clean state:
  - SKIP CINEMATIC, then ABORT in the coast;
  - SKIP TO DESCENT during the burn (no title) and during the title (gone at once), each straight to the descent setup, the orbit not restarted;
  - BRIEFING → back; pause and resume; ABORT from the descent;
  - a restarted landing with no second title;
  - back to the menu and back; relaunch on /mission.

  A–G were also run against the bundled iOS files.
- **C/E: two full missions** in the app at 960×540, no page errors (the harness blocks one external font):
  - Mission 1, the whole film: launch with transposition → coast → LOI → undocking → go for PDI → title → descent setup → THE EAGLE HAS LANDED → reentry → MISSION COMPLETE.
  - Mission 2, after RELAUNCH: launch skipped → title → a hard landing → restarted landing (no second title) → landed → MISSION COMPLETE.
  - Exactly one title per mission, 4.9 s after the go-for-PDI subtitle.
- **H:** stills at 667×375, 852×393 and 932×430 (captions, subtitles, SKIP, safe areas). The title was measured at 8 sizes from 667×375 to 1920×1080, during the fade and settled. A first version clipped the title's first letter at 960×540 and up; it was fixed before release.
- **iOS bundle:** BUILD 8224e36, built with `yarn ios:sync` from the clean commit; `ios:verify` passes with three new markers (true-scale coast, insertion burn, title in the mission).

**Limitations:**
- The difficulty selection still opens after the orbit (now after the title); it is unchanged apart from a 0.9 s fade over the moving shot.
- The insertion burn is condensed: about 4 s of a 6-minute burn.
- The stack turns back to LM first during the establishing shot, where it is a glint.
- The SPS plume is faint at the distance shown.
- The go for powered descent call is the existing FLIGHT line; no new voice lines.
- The return to Earth after the landing is unchanged (it still uses its wide shots).
- An old `lunavia.opening.seen` value on a device is ignored, not deleted.
- In headless captures CSS fades do not follow the fake clock, so stills catch the descent setup mid-fade; in real time it is fully in after 0.9 s (checked at 667×375).
- Not tested on a physical iPhone.


## 37. Lunar deployment and the persistent title screen

**What was wrong** (BUILD 8224e36, from the brief "Critical mission sequence & persistent title screen"):
- **The lunar module and the CSM were released near the Earth.** `data/launchTimeline.js` ran the transposition, docking and extraction of §35 at `TD_START` = 103.5 s, about 20 minutes after TLI, around 6,000 km from the Earth:
  - the adapter's panels were jettisoned;
  - the CSM turned round, docked with the LM and pulled it out;
  - the upper stage was left behind.

  From there the cruise drew `SpacecraftStack` (the docked pair alone). Captions and fades never hid it: it was the mission's actual sequence (`lineage.js`: `panelsJettison`, `docking`, `extraction`, all with `shot.launch`).
- **Why it stayed.** §35 followed Apollo, where the S-IVB carried the payload only through TLI. LV-001 had nothing else to propel the LM and the CSM together to the Moon:
  - the upper stage is 24.5 m long and must not go to the Moon;
  - the CSM's engine bell sits 0.9 m above the LM inside the adapter, so it cannot fire with the LM in there.

  Moving the deployment to lunar orbit needed a propulsion module that does not exist in Apollo. Every earlier milestone corrected framing, scale and continuity around that sequence; none changed the sequence itself.
- **The title auto-advanced.** `Mission.jsx` switched to the descent setup at `ORBIT_SEQ.end` (46.4 s), with no button. SKIP TO DESCENT went straight past it.

**The structural adaptation: the lunar transfer carrier** (`data/carrier.js`, pure and tested; `components/spacecraft/CarrierModel.jsx`). Explained to the user before it was implemented.
- It is the top 1.35 m of LV-001's upper-stage cylinder, now a separate module:
  - same radius (5.44 m);
  - the black band under the adapter unchanged (1.08 m), a strip of the stage's white below it;
  - so LV-001's outline and identity do not change.
- The payload frame's origin is now its deck, so the LM's mounts, the LM, the adapter and the CSM do not move by a millimetre.
- **Contents:**
  - the deck and the adapter's fixed ring;
  - a toroidal tank (R 3.35 m, tube 0.5 m: 16.5 m³ for 15 m³ of storable propellant);
  - four 27 kN engines (Isp 316 s) at 45/135/225/315°, between the LM's legs, nested in the upper stage's forward skirt above its new forward dome (0.25 m clearance);
  - four RCS quads.
- **Mass:**

  | Part | Mass (t) |
  |---|---|
  | CSM | 28.8 |
  | LM | 15.1 |
  | Adapter | 2.2 |
  | Carrier, dry | 4.2 |
  | Carrier, propellant | 18 |
  | **Assembly at LOI** | **68.3** |

  That gives 948 m/s of Δv, against 910 m/s for LOI plus 20 m/s of midcourse corrections. The LOI burn takes about 500 s on four engines; the centre of mass sits inside the adapter.
- **The outbound assembly:** carrier → closed adapter with the LM inside → CSM, its high-gain antenna folded. It is 22 m long, from the engine exits to the probe.

**Mission timeline now**

| When | What |
|---|---|
| Launch 0–99 s | Unchanged: pad, ascent, staging, tower jettison, Earth orbit, TLI, departure |
| 103.5–111 (`carrierSep`) | UPPER STAGE SEPARATION · THE TRANSFER CARRIER TAKES OVER · LM AND CSM STAY INTEGRATED. Pyros at 104.1; the carrier's RCS pushes the assembly ahead (0.5 m/s); the stage falls back, its forward dome and the carrier's engines uncovered (`STAGE_SEP`, `stageGap`) |
| 111–116.5 (`farewell`) | UPPER STAGE LEFT BEHIND: looking down past the assembly at the Earth; the spent stage falls behind; MET reaches 12,000 s |
| Coast, 15 s real | DEPARTURE, DEEP SPACE, LUNAR APPROACH (§36), now of the integrated assembly, nose first, pivoted on its centre of mass. On the approach it turns engines first (the CSM's RCS couple) |
| τ 0–5.6 (`loi`) | LUNAR ORBIT INSERTION · TRANSFER CARRIER ENGINES · RETROGRADE BURN; the carrier's four plumes; rumble |
| 5.6–10.1 | Establishing shot (wide): LM AND CSM STILL INTEGRATED |
| 10.1–15.1 (`assembly`) | LV-001 IN LUNAR ORBIT: a stable shot of the integrated assembly over the horizon |
| 15.1–53.1 | The deployment (`data/transposition.js` TD, unchanged mechanics, now relative to the carrier): ADAPTER OPENS (panels jettisoned at 1.6 m/s), TRANSPOSITION, DOCKING, LUNAR MODULE EXTRACTED, the antenna out |
| 53.1–58.6 (`leave`) | CARRIER LEFT BEHIND: SpacecraftStack takes over the docked pair at the cut, in the identical pose; the carrier backs away on its RCS (`carrierDrift`), then is not drawn |
| 58.6–77 | Unchanged choreography, shifted: tunnel, UNDOCKING at 62.6 (latches, the CSM's RCS, the LM's roll, the separation burn), TWO SPACECRAFT; CAPCOM's existing "we're go for powered descent" at 75.8 |
| 79.6, 82 | LUNAVIA, then A LAJU PRODUCTIONS GAME, over the LM moving away |
| 84.6– (TITLE state) | START MISSIONS; the title screen, held |

**Frames.** The payload frame is laid on the vehicle frame by +90° about Z (`ASSEMBLY_ROTATION`): payload +Y runs along −X, payload +X along +Y.
- In the coast the assembly pivots on its centre of mass. Yaw π puts the nose first; π + turn brings the engines first.
- In lunar orbit it is placed at `ORBIT_ANCHOR` = `DOCK.hardY` + the extraction offset at TD's end (13.94 m). The docked pair the deployment ends with then lands exactly on SpacecraftStack's pose: CSM origin at the vehicle origin, LM at `dockedLmPose(0)`, with the same rotation. This is tested, so there is no jump at the hand-over.
- `PayloadSection` takes new controls: `carrier` (engines, rcs, retro, inside), `yawRcs` (the CSM's couple about +X) and `hideCraft`. `MissionScene`'s `VehicleLayer` draws it with shadows (`assembly`); the title loop does not mount it.

**The persistent title screen** (`Mission.jsx` TITLE state, `components/MissionTitle.jsx`, `data/titleReveal.js`):
- **What is on screen.** LUNAVIA, A LAJU PRODUCTIONS GAME and **START MISSIONS** (**INICIAR MISSÕES** when the subtitles are in Portuguese). The button is 240×56 px, the only control in the overlay that takes input.
- **No timer.** Nothing advances by itself.
- **The orbit clock** slows to a stop past `ORBIT_SEQ.titleScreen` (`orbitClockAt`: τ → 84.6 + 6·(1 − e^(−t/6))). The LM and the CSM come to rest about 20 m apart, the Moon is steady, and nothing replays.
- **The camera** drifts over 36 s of real time (`TITLE_DRIFT`, circling the LM so it holds its place in frame) to a wide hold from ahead of the LM. The CSM is in the distance between the title and the LM, the lunar horizon below. A slow breathing sway follows (real time).
- **Music.** The space pad stays under it until START.
- **START MISSIONS:**
  - it is accepted once (`startedRef`, and the button disables itself), only in TITLE;
  - it opens the existing descent setup (DIFFICULTY → BRIEFING → BEGIN PDI);
  - the destination chosen before launch is kept, nothing is relaunched or reset, and there is no second destination choice.
- **SKIP CINEMATIC** in lunar orbit (renamed from SKIP TO DESCENT) jumps to the title screen, never past it. The skipped sounds stay silent.
- **Once per mission.** A restarted landing or BRIEFING → back returns to DIFFICULTY without the title; a new mission (RELAUNCH, or LAUNCH after ABORT) reaches its own title screen. Nothing is stored and there is no first-run flag. Training never flies the orbit and never shows it.
- ABORT stays available on the title screen (top right); the HUD strip is hidden there.

**Validation tooling (read-only):**
- `window.__lvLaunchView` (t, shot, stageGap, payload state, adapterOpened);
- `window.__lvMissionView` (asm, stackOn, real);
- `window.__lvOrbitSeek` (jump the orbit clock forward, like `__lvLaunchSeek`).

**Not changed:** LV-001's identity and outline; the LM's and the CSM's geometry; landing physics, fuel, the COMMANDER balance, the four sites, hazards, Training, reentry, touch controls, scoring and records. No medals, challenges or leaderboards.

**Validation.** Headless Chromium with software rendering at iPhone landscape sizes. These are browser tests, not a physical iPhone. Everything below ran on the bundled iOS files of BUILD e85ea35 (`frontend/ios/App/App/public`, served locally) unless noted.
- **Jest:** 303 tests pass (292 before). New or rewritten:
  - `carrier`: the outline is unchanged, the LM does not move, the tank and engines fit and clear the stage's dome, the mass and Δv budget, the separation gap and its RCS, soft burns;
  - `launchTimeline`: no transposition, docking, extraction, panel or antenna event or shot after TLI, and no caption saying so; the separation at the carrier's pyros; the MET reaching the cruise;
  - `lineage`: every step shown in the launch keeps the LM inside the closed adapter; the panels, docking, extraction and the carrier's departure only after `lunarOrbitInsertion` (burn: carrier), each in a lunar-orbit shot; near the Earth only the stages and the tower go;
  - `orbitSequence`:
    - the shot order;
    - integrated through the burn and the steady shot, each deployment phase in its own shot;
    - the hand-over to SpacecraftStack is exact (CSM at the origin, same rotation, LM at `dockedLmPose(0)`);
    - the carrier drifts away and is not drawn again;
    - the carrier's burn engines-first and only in the burn;
    - camera clearances for the assembly;
  - `titleReveal`:
    - LUNAVIA, the credit and START MISSIONS after the go for powered descent, and they stay up;
    - the orbit clock never goes back and comes to rest (no second undocking, the LM and CSM 20 m apart);
    - the LM clear of the title on three aspects through the drift; the CSM in frame at the wide hold;
    - the camera's speed and turn rate;
    - EN/PT labels;
  - `transposition`: the real 0.9 m/s after the sequence.
- **The 90-second title screen test**, in real time (no fake clock), run alone. For each language: launch skipped, coast and lunar orbit played by themselves to the title screen, then 90 s with no input, sampled every 5 s, then one tap on START MISSIONS.

  | | English, 852×393 | Portuguese, 667×375 |
  |---|---|---|
  | Title screen opened by itself | τ 84.7 | τ 84.7 |
  | Go-for-PDI subtitle → LUNAVIA | τ 75.9 → 80.7 | τ 76.0 → 80.8 |
  | Over 90 s, every sample | LUNAVIA, credit and button fully up; still TITLE; no descent setup | same |
  | LM–CSM gap over 90 s | 14.3 → 20.2 m, monotonic; last 30 s: +0.006 m | 14.2 → 20.2 m; last 30 s: +0.002 m |
  | Orbit clock over 90 s | 85.46 → 90.60 | 85.38 → 90.60 |
  | Button | 240×56 px, "START MISSIONS" | 247×56 px, "INICIAR MISSÕES" |
  | One tap | descent setup once, button gone, orbit not restarted, the existing difficulties | same |
  | Titles this mission / page errors | 1 / none | 1 / none |

  A first run of both in parallel with other jobs (frame rate starved) passed every check except the extra "all but still" one: the mission caps each frame at 0.1 s, so the clock's slowing had not finished within 90 wall seconds. Rerun alone, all pass.
- **Two full missions** in the app at 852×393, run alone. No page errors; the console shows only the external font the harness blocks.
  - **Mission 1, the whole film.** Launch → UPPER STAGE SEPARATION → coast → carrier LOI → deployment → undocking → CAPCOM go for PDI (τ 75.8) → LUNAVIA (τ 80.7) → title screen held 10 s → START MISSIONS → ASTRONAUT → THE EAGLE HAS LANDED → reentry → MISSION COMPLETE. Traces:
    - launch: 1,593 samples across all 23 shots; the adapter never opened; the stage gap opened at t 105 s, after TLI cutoff (100 s);
    - coast: 91 samples, all integrated (`mated`, the CSM and LM drawn by the assembly, no stack);
    - lunar orbit: carrier engines on τ 1.1–4.9; the first deployment phase at τ 15.4 (separation); then transposition, approach, capture, docked, extraction; SpacecraftStack from τ 53.1 at the `leave` cut; shots in order loi → establish → assembly → deploySep → deployTurn → deployDock → deployExtract → leave → tunnel → undock → pair → title.
  - **Mission 2, after RELAUNCH.** Launch skipped → coast → SKIP CINEMATIC during the burn → title screen held 5 s → START MISSIONS → CADET, no input: HARD LANDING → restarted landing (no second title) → THE EAGLE HAS LANDED → reentry → MISSION COMPLETE.
- **A/B/F/G path checks**, fake clock, 852×393:
  - A/B: the home screen; nothing autoplays and no flag is written.
  - F: a Training landing starts with no title.
  - G1: SKIP CINEMATIC, then ABORT in the coast.
  - G2: SKIP CINEMATIC during the insertion burn lands on the title screen (not the descent setup). It waits 20 s more, then START opens the setup once.
  - G3: BRIEFING → back (the title not shown again); pause and resume; ABORT from the descent.
  - G4: SKIP during the title animation lands on the title screen with its button. START pressed twice gives one descent setup.
  - G5: a restarted landing does not repeat the title.
  - G6: back to the menu and back.
  - G8: ABORT from the title screen.
  - G7: relaunch on /mission.
  - No page errors.
- **Stills of every phase** (26, from the pad to the held title screen) at 852×393, 667×375 and 932×430. "Before" frames of BUILD 8224e36's transposition near the Earth (T+03:04–03:15).
- **iOS bundle:** BUILD e85ea35, built with `yarn ios:sync` from the clean commit. `ios:verify` passes, with the new markers: upper-stage separation, carrier LOI, deployment in lunar orbit, carrier left behind, START MISSIONS.

**Limitations:**
- The carrier is LUNAVIA's own design, not Apollo hardware. Its insertion burn is condensed (about 4 s on screen for a ~500 s burn), and so is the deployment (38 s, §35's choreography, the panels spring-jettisoned at 1.6 m/s).
- The carrier's disposal is not shown: it backs away on its RCS and is no longer drawn from the tunnel shot on.
- From the insertion burn to the title screen now takes about 85 s instead of 36 s, because the deployment is shown. SKIP CINEMATIC goes to the title screen.
- On the title screen the LM and the CSM come to rest because the orbit clock slows to a stop, not by physics; the ambient motion is the camera's drift and sway. During the drift the CSM passes behind the title text for a few seconds.
- The go for powered descent is the existing line, which the subtitles label FLIGHT; there are no new voice lines.
- Under the black band, the carrier's 0.27 m white strip uses the vehicle's plain white rather than the stage's panel texture.
- `window.__lvOrbitSeek` (validation tooling) ships in the bundle; it is inert unless set.
- Unchanged and noted: the site navbar shows over the descent setup, and the difficulty cards' descriptions are in Portuguese.
- In headless captures CSS animations do not follow the fake clock, so captions are caught mid-animation.
- Not tested on a physical iPhone.

## 38. Outbound propulsion: the transfer carrier's main engine

**What was wrong** (BUILD e85ea35):
- After the upper stage separated, the Moon-bound assembly did not read as propulsion-capable. Its aft end was a dark 10.9 m disc carrying four bells 0.68 m across (about 6% of the diameter).
- No coast camera faced that end. Every coast shot held the assembly broadside to the planet behind it (`radialFrame`). The approach turned it from broadside to broadside: it never pointed at the Moon, so it seemed to drift sideways.
- No burn was shown between the separation and lunar orbit insertion. The LOI shot looked from the nose side, and its four plumes were faint.

**The propulsion end** (`data/carrier.js`, `CarrierModel.jsx`):
- **Main engine:** one gimballed engine on the axis, 110 kN, Isp 316 s, hypergolic. It hangs from a conical thrust structure (eight longerons) under the aft bulkhead. Its parts:
  - the gimbal block, the chamber and two gimbal actuators;
  - two feed lines from the toroidal tank;
  - a 2.65 m bell, 2.6 m across at the exit (area ratio ~29): a dark upper bell, a lighter radiatively cooled extension, a sooty interior that glows faintly while it fires.
- **Fit at launch:** nested in the upper stage's forward skirt; the stage's forward dome was moved down 2.75 m to clear it (0.3 m, tested).
- **Assembly:** now 24.7 m from the engine exit to the CSM's probe. LOI takes about 490 s on the one engine; the Δv budget is unchanged.
- **RCS:** the four quads stay. The quads at ±X fire sideways to join the CSM's couple during the turn.
- **Plume:** one main plume, a faint wide vacuum plume and a brighter core.

**Attitude and burns:**

| When | Attitude | Engine |
|---|---|---|
| Upper-stage separation | Engine emerging from the stage's skirt | off; RCS push |
| Farewell (launch) | Filmed from aft: engine, thrust cone, Earth beyond, stage falling away | off |
| Departure | Nose 30° away from the Earth, engine back at it; near-profile view, the bell standing out past the carrier | off (coast) |
| Deep space | Nose 25° away from the Earth | **midcourse correction**, 1.2 s on screen (~3 m/s), soft ignition and shutdown, rumble aboard |
| Approach | Nose on towards the Moon, the engine end towards the camera; then the turn, engine first, on RCS (the bell in profile mid-turn) | off; RCS |
| LOI | Engine first; filmed from ahead of the engine end | **on** τ 0.9–4.7 |

`coastAttitude`, `MCC`/`mccLevel` and the coast cameras are pure and tested:
- the engine faces the Earth when leaving it;
- the nose faces the Moon, then the engine does;
- every coast camera is near profile (92–112° off the nose);
- the only coast burn is the MCC;
- the LOI is filmed from ahead of the engine end.

## 39. Translunar attitude and the midcourse correction maneuver

**What was wrong** (BUILD 33d6f8c):
- **Sideways travel.** In the departure and deep-space coasts the assembly held its nose 25–30° off the local horizontal. The flight path in those shots runs at 94–107° (outward from the Earth), so the nose sat 65–80° off the direction of travel and the spacecraft seemed to fly sideways towards the Moon.
- **MCC without a maneuver.** The midcourse correction fired in that same coast attitude, with no turn before or after. The burn did not match a thrust direction, and the main engine only read as a real maneuver at LOI.

**TLI and the separation (checked, unchanged):** the upper stage flies TLI (launchTimeline 92.6–100 s), nose along the flight path, 12° above the local horizontal. The carrier separates at 104.1 s. The only planned maneuver after separation is the carrier's RCS push clear of the stage (`stageSepRcs`). No main-engine burn was added there: none is planned, and adding one would invent acceleration.

**Attitude and burns now** (`data/orbitSequence.js`; cameras untouched):

| Phase | Attitude | Engine / RCS |
|---|---|---|
| After separation (launch) | TLI attitude held, nose along the flight path | off; separation RCS push |
| Departure coast | **φ 75°**: nose forward, 19–32° off the flight path (held, not steered onto the velocity); engine back towards the Earth | off; no RCS |
| Deep space, s 0–0.1 | φ 75° | off |
| MCC turn in, s 0.1–1.15 | RCS turn 75° → −10° (85°), quintic, couple starting and stopping it | off; RCS |
| MCC burn, s 1.25–2.45 (+0.5 s tail-off) | **burn attitude φ −10°**: thrust axis = the correction's Δv (`MCC_DIRECTION`, 3 m/s across the flight path, trimming the arrival) | **main engine on**; plume from the bell; rumble aboard |
| MCC turn out, s 3.0–4.05 | RCS turn back to φ 75° | off; RCS |
| Deep coast resumed | φ 75° | off |
| Approach, LOI | unchanged (nose to the Moon, the turn engine first on RCS, the retrograde insertion burn) | unchanged |

**RCS puffs:**
- The carrier's side firings during the turns are soft billboard puffs down each jet, three per quad (`CarrierModel` `yawFx`). Together with the service module's couple they make the turns visible.
- Before this, the side-puff meshes never showed. React Three Fiber *copies* a `material` prop of the mesh's own default class (`MeshBasicMaterial`) into the mesh's material, so per-frame writes to the memoised material never reached the rendered one.
- The same applies to `M.puff`, the separation and retro puffs. Those were left as they are: outside this milestone's scope.

**Tests** (`orbitSequence.test.js`):
- the departure and deep coasts stay within 35° of the flight path, with no RCS, outside the maneuver;
- the MCC is ordered turn → hold → burn → tail-off → turn;
- the engine fires only in the burn attitude, the thrust axis lies along `MCC_DIRECTION`, and there is no thrust while turning;
- each turn is more than 60°, with RCS starting and stopping it;
- the deep camera sees the burn from behind the engine end (50–85° from the thrust axis);
- the departure camera sees the coasting assembly obliquely (130–160°).

The §38 "near profile 92–112°" check was replaced by these.

## 40. Direct cut: from TLI cutoff straight to lunar orbit

**Editing decision (requested):** the whole translunar travel sequence is removed from the player's experience. It is not repaired, redesigned or replaced: no new animation stands in for it. The film now goes:

> EARTH DEPARTURE → GUIDANCE "Cutoff." → the departure shot held 2 s → fade to black (0.35 s) → LUNAR ORBIT (T+80:00:00) → CAPCOM "LUNAVIA, Houston. Lunar orbit insertion looks good. Welcome to the Moon."

**Removed (runtime sequences and their references):**
- **Launch cinematic:**
  - the `carrierSep` (upper-stage separation) and `farewell` (stage left behind) shots, with their cameras (`SEP_CAMS`), events, captions and separation sounds;
  - CAPCOM's `launch.lunarTransfer` call ("good burn… on your way to the Moon"), which would have been cut off mid-sentence.
- **Mission:**
  - the `SPACE` state (CISLUNAR CRUISE) and its loop: the departure, deep-space/MCC and approach shots, their captions, the MCC rumble and CAPCOM's `cruise.ambient` call;
  - the lunar-orbit `loi` shot (the insertion burn), its rumble cues and `loiBurnLevel`.
- **MissionScene:** the Director's outbound close-shot branch (only the return's close shot remains).
- **Data (orbitSequence):** `CISLUNAR`, `cruiseTime`, `coastShotAt`, `coastDistanceKm`, `approachMoonKm`, `APPROACH_RAY`, `approachYaw`, `COAST_*`, `coastAttitude`, `MCC*`, `mccAttitude`, the coast cameras and shot captions; their tests.
- **Kept:** the voice lines stay in the catalogue and voice pack, unused. All spacecraft models and shared components are unchanged (CarrierModel, PayloadSection, RocketModel; `data/carrier` stage-separation helpers).

**The 2-second cut** (`data/launchTimeline` `TLI_CUT`, `tliCutHoldEnd`; `LaunchCinematic`):
- The film subscribes to the comms hub. When GUIDANCE's `launch.tliCutoff` ends (the clip with voice, or the subtitle's own timing without), the departure shot is held exactly 2 s on the real clock (`performance.now`, whatever the frame rate), then fades through black in 0.35 s and completes.
- The film's own clock caps each frame at 0.1 s, so on a very slow device it falls behind real time; the hold does not.
- If the call is never said (filtered, a seek past it), the clip's length (0.75 s ≥ the 0.63/0.71 s EN/PT clips) stands in from its 0.2 s delay, in film time.
- The film never runs past `DURATION` (105).
- The departure shot keeps its camera move (`camEnd` 103.5); the cut normally comes at about t 103.2–103.5.
- The "Cutoff." subtitle is never cut, and the LUNAR TRANSFER caption stays up through the hold.

**The jump** (`Mission.jsx`):
- `handleLaunchComplete` (end of the film or SKIP) sets the orbit clock to `ORBIT_ENTRY` (= `ORBIT_SEQ.arrive`, 5.6), marks earlier cues done and enters `ORBIT`.
- The establishing shot (LUNAR ORBIT · LUNAR ORBIT INSERTION COMPLETE · LM AND CSM STILL INTEGRATED) opens. CAPCOM's welcome follows at 0.6 s (the existing `arrival` cue). The deployment, undocking, go for PDI, title and START MISSIONS follow on the same clock, unchanged.
- **No blank frame:**
  - the lunar-orbit textures are preloaded at launch (`preloadMissionScene`);
  - from "Cutoff." the lunar-orbit scene is mounted under the launch, held on the arrival (`onCutAhead`), so the cut lands on an already-drawn frame.
- **Mission state:**
  - The outbound assembly arrives integrated (carrier, closed adapter with the LM, CSM); the spent upper stage is gone. `data/lineage` records the cut as the one off-screen step (`translunarCut`: stage 2 leaves; the insertion burn is flown).
  - No hidden timer: nothing of the coast runs in the background.
  - `resetMission` clears the pre-mount.

**Tests** (297):
- `launchTimeline.test` (the cut, the call, the hold, the fade, no shot after the departure);
- `orbitSequence.test` (entry on the arrival, integrated, engines off);
- `lineage.test` (the off-screen step);
- `pages/directCut.test` (no cruise state; launch and SKIP go straight to the arrival; the welcome cue; no separation, coast or LOI code left).

`verify-ios-bundle` also fails if any removed caption is still in the bundled game.

## 41. Four official lunar missions; Sea of Tranquility-only lunar landing training

**Before** (BUILD af89907):
- The four destinations (data/landingSites `SITE_DEFS`) existed only inside the Flight Training Center: landing discipline → site cards (`MissionCard`) → scenarios.
- The full mission never chose a site. `DescentGame` defaulted to `MISSION_SITE_ID` (Tranquility), and the pilot difficulty was asked only after START MISSIONS.

**Now — one configuration, two modes** (`data/missionConfig.js`, tested):
- `OFFICIAL_MISSIONS`:

  | Mission | Destination | Environment |
  |---|---|---|
  | 01 | Sea of Tranquility | INTRODUCTORY |
  | 02 | Hadley–Apennine | INTERMEDIATE |
  | 03 | Tycho Highlands | ADVANCED |
  | 04 | Silent Horizon | EXPERT |

  Each has a summary, features and a piloting challenge.
- `TRAINING_LANDING_SITES = ["tranquillitatis"]`.
- `createMissionConfig({ mode, siteId, difficulty })` returns one frozen object for a flight: mode, destination, pilot difficulty, environment, terrain id, landing zones, comms (`earthLink`/`farSide`), seed, coordinates, the lunar-orbit view, briefing and base name.
- Terrain, hazards and landing zones remain the site implementations themselves (`getSite(id)`); nothing is copied. The same `DescentGame` and `landerSim` fly every destination.
- Environmental difficulty comes from the terrain only. Pilot difficulty (CADET/ASTRONAUT/COMMANDER, `DIFFICULTY`) is unchanged and identical at every destination: same entry state, fuel, engine and limits (tested). The reference pilot lands all 12 combinations (tested).

**Official mission flow** (`pages/Mission.jsx`):
- Main menu / nav → `/missions` → `MissionSelect`: four cards (number, name, summary, terrain preview, environment level, piloting challenge, START MISSION). The pilot step reuses `DifficultySelect`.
- Then mission control, which shows the mission with a CHANGE MISSION button, and LAUNCH.
- Launch → "Cutoff." → 2-s hold → direct cut to lunar orbit → CAPCOM's welcome → deployment, undocking, go for PDI, title, START MISSIONS.
- START MISSIONS → **the destination's PDI briefing**: mission number, site name, environment, the site's own briefing. No second selection, no difficulty prompt, no relaunch.
- BEGIN PDI → descent at the destination → results, shown over the landed LM at that site with the site named → return → reentry → MISSION COMPLETE (with the mission number, base and difficulty).
- RETRY DESCENT returns to the same briefing.
- The selection is held from launch to splashdown. It can be changed only on MISSIONS, before launch; it is kept on the device (`lib/missionSelection`).
- **Lunar orbit over the destination:** `lunarOrbitShot.moonRotationFor(lat, lon)` turns the Moon so the destination lies under the same orbit, marker, camera and lighting (Tranquility's rotation is unchanged, `MOON_ROTATION`). The orbit captions name the destination.
- **Silent Horizon (far side):**
  - The orbit is shown over the near side, on the ground track 120° east of the site, with no site marker. CAPCOM's welcome and the go for powered descent need a line of sight to the Earth.
  - After BEGIN PDI, `FarSideIntro` plays the loss of signal behind the Moon (existing voices only), with no call to Houston.
  - The descent runs with no Earth link, as before: `DescentGame` cuts the link and shows the chip.
  - The link returns when the LM leaves the descent, for the return and reentry.
- **Results logging:** each official flight is logged on the device (`lunavia.mission.log.v1`) with destination, difficulty, landing (success, grade, zone, telemetry, attempts) and completion. Training records (`lunavia.training.v2`) are separate.
- **Removed from the official flow:** "SKIP — WATCH CINEMATIC AUTO-LANDING" (`DescentScene`, `DESCENT`/`SURFACE` states). That scene is a generic Moon surface: it would land the player at the wrong terrain and skip the landing results.

**Flight Training Center:**
- Lunar landing is "SEA OF TRANQUILITY — LUNAR LANDING TRAINING" only. There is no site step and no site cards; the far-side intro is gone from training.
- Scenarios are unchanged:
  - STANDARD: throttle, safe touchdown;
  - PRECISION: RCS, horizontal velocity;
  - BRAKING;
  - COMMANDER.
- Retry, debrief and records are unchanged; reentry training is unchanged.
- Hadley, Tycho and Silent Horizon are no longer offered in training. Their code is used by the official missions.

**Tests:**
- `data/missionConfig.test.js`: the four missions, training = Tranquility, frozen configs, distinct destinations, the same spacecraft everywhere, 12 achievable combinations, the orbit view;
- `lib/missionSelection.test.js`: persistence, the log, training kept separate;
- `pages/officialMissions.test.js`: routes, no second selection, the far side, the log, training.

## 42. Opening first, then MISSIONS / TRAINING

**Order of the game (as asked):**
1. Opening LUNAVIA (`/`) starts the LV-001 launch by itself. There is no menu, mission-control screen or tap before it.
2. The approved af89907 film follows: ascent, staging, Earth orbit, TLI, GUIDANCE "Cutoff.", the 2-s hold, and the direct cut to lunar orbit.
3. Lunar orbit: CAPCOM's welcome, the deployment, the undocking, the go for powered descent, then LUNAVIA / A LAJU PRODUCTIONS GAME.
4. The persistent title screen waits for START MISSIONS.
5. START MISSIONS opens the game menu (`ModeMenu`): **MISSIONS** or **TRAINING**. It sits in the title's place, over the same lunar-orbit shot. Nothing is replayed or reset.
6. MISSIONS opens the four official destinations, then the pilot difficulty. The mission then continues from lunar orbit at that destination:
   - its PDI briefing, with CHANGE MISSION going back to MISSIONS;
   - the descent (Silent Horizon: loss of signal first);
   - results, with RETRY going back to the same briefing;
   - return, reentry, MISSION COMPLETE.

   There is no second launch.
7. TRAINING opens the Flight Training Center. Lunar landing training is at the Sea of Tranquility only and starts directly at the descent. Reentry training is unchanged.

**Routes** (`App.js`; each has its own `key`, so moving between them starts that entry fresh):

| Route | Opens on |
|---|---|
| `/` and `/mission` | the opening (`entry="opening"` → `LAUNCH`) |
| `/menu` | MENU |
| `/missions` | SELECT |
| `/home` | the old landing page |

- `/menu` and `/missions` show lunar orbit as the opening leaves it: the orbit clock is at the title screen and its sounds are marked done.
- The navigation bar: Home → `/menu`, Missions → `/missions`, LAUNCH → `/` (the opening).
- Training's MAIN MENU → `/menu`.

**States** (`pages/Mission.jsx`):
- The flow is LAUNCH → ORBIT → TITLE → MENU → SELECT → BRIEFING → (FAR_SIDE) → MANUAL_DESCENT → RESULT → RETURN → REENTRY → COMPLETE.
- `ORBIT_STATES` (ORBIT, TITLE, MENU, SELECT, BRIEFING) keep the one lunar-orbit scene and clock mounted.
- ABORT (launch, orbit, descent, return, reentry), END MISSION and MAIN MENU on MISSION COMPLETE all return to MENU (`resetMission`). The opening is not replayed.
- `ControlRoomView` (the mission-control screen with LAUNCH SEQUENCE — INITIATE) is removed. This also removes the game's only online image (Unsplash).

**Other changes:**
- The orbit is the opening's own view (the approved Tranquility framing; captions without a destination), because no destination is chosen yet. `missionConfig.orbitView` and `moonRotationFor` remain available, but the scene no longer uses them.
- An official flight is logged from the moment its destination and difficulty are confirmed.
- **Sound:** the opening calls `audio.init()` on mount. In the iOS app the web view does not require a tap for media (Capacitor sets `mediaTypesRequiringUserActionForPlayback = []`), so the launch is heard at once. In a desktop browser, the first tap or key unlocks sound (`useMissionAudio`).

**Tests:** `pages/officialMissions.test.js` covers the new order.

## 43. Startup screen restored: THE ROAD TO THE MOON before the launch

**What changed in §42, and why it went wrong:**
- §42 made `/` start the launch on mount: `ENTRY_STATE.opening` was `LAUNCH`, and a mount effect called `audio.init()`.
- It also deleted `ControlRoomView`, the original startup screen.

**Now:**
- `ENTRY_STATE.opening` is `CONTROL` again.
- `ControlRoomView` is restored byte-for-byte from af89907: THE ROAD TO THE MOON, "LV-001 · READY FOR LAUNCH", LAUNCH SEQUENCE — INITIATE, and the LV-001 ARTEMIS-CLASS strip.
- It waits with no timer. Only its button calls `handleLaunch`, after its own 1.1-s GO.
- **`handleLaunch` is the only `setState(STATES.LAUNCH)`.** It:
  - returns unless the state is `CONTROL`;
  - sets `stateRef` to `LAUNCH` at once, so a double tap cannot start a second sequence;
  - then calls `audio.init()`, which runs within the tap, so iOS and browsers both play sound.
- Nothing listens for visibility or app-resume events, so backgrounding and resuming cannot launch.

**Unchanged from §42:**
- Everything after the launch: the cut, lunar orbit, the title, START MISSIONS → MISSIONS / TRAINING, the missions and training.
- ABORT and MAIN MENU return to the menu (`/menu`).
- LAUNCH in the navigation bar, or reopening the app, shows the startup screen again; it never relaunches by itself.

## 44. Lunar ascent, orbital rendezvous and playable docking

**Mission order now:**
1. Startup → launch → direct cut → lunar orbit → undocking → title → MISSIONS.
2. Landing → results → **CONTINUE MISSION**.
3. **LUNAR SURFACE — ASCENT PREPARATION**, which waits for INITIATE LUNAR ASCENT.
4. Lunar liftoff → orbit insertion → automatic rendezvous.
5. **LUNAVIA — DOCKING OPERATIONS**, flown by the player.
6. Hard dock → crew transfer → ascent stage jettisoned.
7. The existing return (TEI) → reentry → MISSION COMPLETE.

A mission is complete only at splashdown, which needs the docking.

**Files:**

| File | What it is |
|---|---|
| `data/dockingSim.js` (tested) | the authoritative docking physics |
| `data/rendezvous.js` (tested) | Clohessy–Wiltshire rendezvous guidance |
| `data/lunarAscent.js` (tested) | the liftoff trajectory |
| `data/lmDesign.js buildStages` (tested) | the LM split into its two stages |
| `components/LanderModel.jsx` | `ascent` / `parts` props |
| `components/LunarAscent.jsx` | ascent preparation and liftoff |
| `components/DockingOps.jsx` | rendezvous film, docking UI, hard dock, transfer, jettison |
| `pages/Mission.jsx` | the ASCENT and DOCKING states |
| `lib/missionSelection.js` | `logMissionDocking` |
| `audio/commsLines.json` | 22 new lines, Kokoro-rendered EN/PT clips |
| `components/DescentGame.jsx` | `result.pose`, the landed pose (landing physics and controls untouched) |

**Stage separation:**
- `lmDesign.collect()` keeps the descent and ascent parts apart.
- `buildBody()` (the joined LM) is unchanged: same parts, same order.
- `buildStages()` also adds the ascent engine bell, hidden inside the interstage while the stages are joined.
- At liftoff the descent stage stays with its legs at the landing's pose (position on the terrain, tilt, strut compression), on the same site terrain.

**Liftoff** (`ascentAt`):
- 15.6 kN on 4.8 t, in lunar gravity.
- 10 s of vertical rise, then a pitchover to 52°.
- The film runs 22 s.
- The vacuum plume is short and faint, with no smoke. An ignition flash lights the descent stage's deck.

**Rendezvous** (`planRendezvous`):
- In the CSM's LVLH frame. Insertion is co-elliptic, 14 km below and 46 km behind.
- TPI fires when the CSM is 27° above the ascent stage's horizon (≈ 1000 s after insertion, as on Apollo): a two-point CW targeting burn over a 130° transfer to a braking gate 1.2 km behind and 150 m below the CSM, executed with a deterministic 1–2 % error.
- A midcourse correction re-targets the gate from the actual state.
- At the gate: a short final approach from behind (840 s) to the docking checkpoint.
- A braking burn leaves exactly the checkpoint's state.
- The total is ≈ 1 h 14 min of mission time, played as a 34-s film whose clock slows near the end.
- Tested:
  - numerical integration of the docking sim's own dynamics lands on the checkpoint within centimetres;
  - the path never comes closer to the CSM than the checkpoint;
  - the last 1.5 km is flown from behind.
- (A first version aimed the 130° arc straight at the checkpoint. It came in from ahead and passed 11 m from the CSM, so the gate was added.)

**Docking** (`dockingSim`): the CSM's frame in metres; the CSM holds LVLH attitude with its probe pointing −V-bar.
- **Translational motion:** Clohessy–Wiltshire plus the RCS in body axes.
- **Attitude:** a quaternion with body rates. Attitude hold damps the rates on CADET and ASTRONAUT; COMMANDER has no hold.
- **Auto align (CADET):** an option that holds the docking attitude. Translation stays with the player.
- **Contact:** judged when the probe tip crosses the drogue's ring plane, using the drogue's offset from the probe's axis, the axis angle, roll, closing and lateral speed, and the rates.
  - Inside tolerance: capture, a 6-s retraction, then hard dock on the ring (`dockedLmPose`).
  - Outside tolerance: deflection and rebound, which is recoverable.
- **Failures:**
  - closing above 0.6 m/s damages the mechanism;
  - the hull points meeting the CM cone or SM drum is a collision (recoverable below 0.12 m/s);
  - beyond 180 m the target is lost;
  - an empty RCS, stopped short of the target, is a failure.
- **Difficulties** (`DOCKING`): RCS authority, propellant, start state and tolerances.

  | | lateral | angle | closing |
  |---|---|---|---|
  | CADET | 0.30 m | 7° | 0.015–0.40 m/s |
  | ASTRONAUT | 0.20 m | 5° | 0.025–0.30 m/s |
  | COMMANDER | 0.14 m | 3.5° | 0.03–0.22 m/s |

  The reference pilot (0.25–0.4 s reaction time, pulses only) docks at all three.

**UI** (DockingOps):
- **Views:** see §46 (NAV, WINDOW, COCKPIT, 360°). Before §46 the docking had one navigation camera (the COAS boresight, labelled WINDOW) and a fixed chase camera (EXTERNAL).
- **HUD:** range, closing, lateral and vertical rates, offset, attitude error, RCS %, status, warnings.
- **Alignment display:** an offset dot (±1 m) and an attitude cross (±10°), against the tolerance ring; "IN CORRIDOR" when within tolerance.
- **Controls:** a cross pad with FWD/AFT, switching between TRANSLATION and ATTITUDE (pitch/yaw, roll).
  - A tap is a 0.12-s minimum impulse; holding keeps firing; multi-touch works.
  - CADET has the AUTO ALIGN toggle. (The step-by-step hints became the DOCKING GUIDANCE panel, §45.)
  - Keyboard: W/S/A/D/R/F for translation, arrows and Q/E for attitude.
- **Failure:** RESTART DOCKING (back to the rendezvous checkpoint, full RCS; §45) or ABORT MISSION.

**Far side (Silent Horizon):**
- No Earth link on the surface or after insertion; the crew's calls pass through (`throughBlackout`).
- Signal is reacquired during the rendezvous, at `COAST + 0.3·TRANSFER`, or at hand-over if the film is skipped.

**Validation tooling** (never set by the game): `window.__lvTimeScale` (docking only, ≤ 16×) and `window.__lvDockAutopilot`, the reference pilot on the simulation clock. Read-only state: `__lvDock`, `__lvDockState`, `__lvAscent`.

## 45. RESTART DOCKING and the docking guidance

The docking physics, thresholds, RCS authority and propellant are unchanged (§44). This adds two things on top: a restart, and an instructor that reads the simulation.

**RESTART DOCKING** (Portuguese: REINICIAR DOCKING, by the subtitle language like START MISSIONS):
- In the top bar between PAUSE and ABORT, 96 × 44 pt, amber. **Press and hold 0.6 s** (`RESTART_HOLD_MS`); the fill shows the hold. A short tap only says HOLD TO RESTART, so a brush or a thumb sliding off a jet cannot fire it.
- Also on the PAUSE screen (a plain tap) and on the failure screen (replacing the old retry button; the screen still says RETRY FROM RENDEZVOUS CHECKPOINT).
- Available during the whole approach; not once the probe has captured (the capture is already a success).
- It restarts only the docking: never the rendezvous, the ascent or the landing.
- `dockingSim.restoreCheckpoint(s, difficulty)` rebuilds the state in place from `checkpointState`: position and velocity on the approach axis (the checkpoint's own slow drift), attitude and rates, the simulation clock, contacts, capture and failure state. Everything else the last attempt left on the object is deleted; only the scene's clocks and mode survive (`RESTART_KEEP`). Tested: deep-equal to a fresh checkpoint, and it evolves identically.
- **RCS** is refilled, as the retry always did: each attempt starts with the difficulty's budget. No damage is carried over (a damaging contact ends the attempt).
- No jet carries over: held pad buttons are cleared, and keys still down are ignored until released (`keysBlocked`). Measured in the browser: a finger left on RIGHT and the D key held through a restart fire nothing.
- The guidance starts afresh (step 1), queued comms are flushed, the pause is cleared.
- **Statistics:** each restart is a new attempt. The mission log's docking entry has `attempts`, `restarts`, `firstAttempt` (true only for a first-try docking with no restart) and the contacts of all attempts. Attempts and restarts only grow, so restarting until a clean run never reads as a clean first attempt.

**DOCKING GUIDANCE** (`data/dockingGuidance.js`, pure and tested; the panel in `DockingOps`):
- **Panel:** bottom centre, between the pad and the FWD/AFT column (clear of CADET's AUTO ALIGN), below the window reticle and the target. It shows:
  - DOCKING GUIDANCE — STEP n/5 and the step's name, with a 5-segment bar;
  - the single instruction, in colour by severity;
  - the explanation (by difficulty);
  - ▸ the control to use;
  - the telemetry behind the instruction.
- **Steps:** 1 ACQUIRE THE DOCKING TARGET, 2 ALIGN WITH THE DOCKING PORT, 3 REDUCE RELATIVE VELOCITY, 4 PROCEED WITH FINAL APPROACH, 5 DOCKING CONTACT (contact ✓, capture ✓, retraction %, hard dock).
- **Rules, in priority order:**
  1. RCS depleted;
  2. closing above `closingLimit` (BRAKE NOW);
  3. within 3 m and not lined up (BACK OFF);
  4. rotating faster than the capture's rate tolerance within 1.5 m;
  5. attitude (per-axis error against the tolerance; the worst axis leads and any axis needing a comparable correction is named with it, two fingers on the pad, so no turn runs unwatched; on COMMANDER, leftover turn rates down to about one tap);
  6. lateral alignment and drift;
  7. closing speed (slow, begin the approach, too slow to latch, opening);
  8. CADET's auto align still turning;
  9. the good news: cleared for the approach, STAND BY FOR CONTACT once every capture tolerance is met within 1.5 m.
- **Thresholds come from the physics:** the capture tolerances (`DOCKING[d].tol`), `closingLimit`, and one tap's change (acceleration × `PULSE`) as the band an instruction starts and clears at (hysteresis: about half of it to clear). Target speeds are the reference pilot's: closing that falls with the range, lateral speed toward the axis that falls with the offset, a turn rate that falls with the error.
- **Directions:** a correction is worked out in the CSM frame and turned into body axes through the current attitude, then into buttons (`CONTROLS`, the table the pad and the keyboard are now built from). Lateral motion uses the vehicle's own velocity, since a turn swings the port sideways and that is the attitude's to fix. While the attitude is outside tolerance, lateral aim is where the port will be once aligned. Tested on 400 seeded states with up to 40° of roll: one tap of what the panel names reduces the error it names.
- **One instruction at a time:**
  - an instruction stays on screen at least 1.5 s unless a safety rule outranks it (the hold counts from when it is visible);
  - "wait" instructions hold against their own rule's next order;
  - a correction that is done is confirmed for 1.1 s (✓ CLOSING VELOCITY REDUCED, ✓ RELATIVE MOTION STABILIZED…), and its rule then stays quiet for 1.5 s unless it is a safety order;
  - the opposite jet on the same axis is never ordered within 2.5 s of the last order (1 s when it only brakes motion the last order started), otherwise LET IT SETTLE.
- **Difficulty** (amount of guidance only; physics untouched):
  - CADET: the briefing (step 1, 6 s), full explanations (which button, inertia, why), the named button lit on the pad (MODE lit first when needed), AUTO ALIGN wait states.
  - ASTRONAUT: a 3.5-s briefing, the order with its number, the button lit.
  - COMMANDER: no briefing, the order and the control alone, no lit buttons.
- **GUIDANCE ON/OFF:** a toggle in the panel, remembered per difficulty (`lunavia.dockGuidance`), default ON. Off, the panel becomes a small GUIDANCE OFF chip; the HUD's safety warnings and telemetry stay, and the guidance voice calls stop.
- **Voice:** 10 new lines, Kokoro-rendered EN/PT like the rest:
  - GUIDANCE: "Flight, docking target acquired."
  - CAPCOM: reduce relative velocity, off axis, attitude, back off, opening range, alignment good / cleared, continue, stand by for contact, restart acknowledgement.
  - Spoken only when the instruction changes, and only if it is still current when the channel is free. Corrective lines are `coach` (CADET and ASTRONAUT) in one `dockGuide` group with 20–60 s cooldowns. The director's priorities keep them under the critical calls. Far side: the panel is onboard and always there; Houston's calls follow the Earth link as before.
- **The guidance only reads** (tested: evaluating it never changes the state). Docking is still decided only by `judgeContact`.

**Proof it teaches enough:** `guidedPilot` is a student that does only what the panel says (MODE when told, one tap, then a pause to see the effect; nothing while it says wait). It docks all three difficulties at reaction times from 0.25 s to 1.2 s in the unit tests. (Naming one rotation axis at a time used to fail COMMANDER from about 0.9 s: the other axes kept turning. Naming every axis that needs it fixed this.) In the browser, the same student reads the real panel and presses the real buttons with touch events in real time, with no autopilot and no time scale, and docks.

**Validation tooling** (adds to §44): `__lvDock.guidance`, `__lvDock.restarts`, `__lvDockingTools.guidedPilot` and `checkpointState`.

## 46. Four docking views: NAV, WINDOW, COCKPIT, 360°

**Before this milestone** the docking had one real view, now called **NAV**: the camera on the docking port's own axis, looking up it at the probe. Over it are the reticle, the far axis mark, the projected probe-tip ring, the alignment display and the full HUD. Its button read "VIEW · WINDOW", but it was a navigation boresight, not a look through a window. The other setting, EXTERNAL, was a fixed chase camera with no control. Now there are four views. All of them look at the **one** simulation; a view only decides where the camera is and which way it looks.

| View | Camera (`data/dockingViews.js`, tested) | Drawn over / around it |
|---|---|---|
| **NAV** (first) | unchanged: on the port's axis 0.25 m inside the port, along the docking axis, body +Z up, 50° | reticle, tip ring, far mark, HUD, alignment display, as before |
| **WINDOW** | the commander's eye under the overhead docking window (body −0.30, 0.80, 0.22 m), along the docking axis, 62° | the window's 3D frame, gasket, bolts and glass (`DockingCabin WindowFrame`), lit by the Sun as the vehicle turns; a compact RANGE / CLOSING / LATERAL readout |
| **COCKPIT** | further back in the cabin (−0.22, 0.45, 0.15 m), 72° | the 3D cabin (`DockingCabin Cockpit`); see below |
| **360°** | orbits the ascent stage's centre in the CSM frame (still while the vehicle turns); starts on the old chase framing | the docking corridor lines, HUD and alignment display, RESET CAMERA |

- **Cockpit:**
  - The forward bulkhead (extruded, with the docking window and two flanking observation panes cut through it), window frames, display bezels, an overhead beam and grab handle, a cable run, side walls and ceiling.
  - A breaker console (instanced knobs) and indicator lamps.
  - A dim warm cabin light.
  - Four instrument displays (canvas textures redrawn about 8 times a second from `telemetry`):
    - RANGE · RATE (range, closing in red over the limit, the limit);
    - LATERAL · ATTITUDE (lateral and vertical speed, pitch/yaw/roll, rate);
    - ALIGNMENT (the port's offset dot and the attitude cross against the capture ring, IN/OUT CORRIDOR);
    - RCS · STATUS (propellant, the 16 jets lit while firing, mode, auto align, guidance step, contact, capture, hard dock).
  - Measured in the browser: the displays show exactly the simulation's range, closing, propellant and offset.
- **One camera orientation for every first-person view:** they all look along body +Y with body +Z up (`MOUNT_Q`), so the pad's ▲ ▼ ◀ ▶ mean the same on screen in NAV, WINDOW and COCKPIT. The eye positions keep the probe in view, and inside the window openings, from the checkpoint to contact (tested along reference-pilot flights at every difficulty and iPhone aspect).
- **Selector:** `NAV | WINDOW | COCKPIT | 360°`, under the top bar (36 pt tall). Keys 1–4 also switch views.
  - Switching only sets the view state: the simulation, the held jets and the attempt are untouched.
  - The cockpit, the window frame and the cabin light are always in the scene, hidden when not used. The light sits at zero intensity, so a switch never builds or compiles anything.
- **360° gestures:**
  - `OrbitPad` is a layer under the HUD and the controls: one finger orbits (about a full turn per 1000 px; over the top and under, to ±83°), two fingers pinch-zoom (3–90 m), and the wheel zooms.
  - The controls sit above it, so a drag never reaches a jet button and a jet button never turns the camera; a finger on a jet and another dragging both work (separate pointers).
  - The Moon is the existing `MoonBelow`, so it appears below whenever the camera looks down at it.
- **Unchanged:** the docking physics, the target geometry, RCS authority and propellant, collisions, the thresholds, RESTART DOCKING (it keeps the current view), the guidance (its briefing names what each view shows), the difficulties, the ascent and rendezvous, and the return.
- **Validation tooling:** `__lvDockCam` (the current view's camera), `__lvDock.view`, `__lvDock.viewSwitches`, `__lvDock.orbit`, `__lvCockpitShows` (what the instruments read), `__lvCockpitDrawn`, `__lvOrbitGestures`.


## 47. Mission scoring, medals, achievements and personal records

An official mission is now scored out of **1,000 points**: LUNAR LANDING 400, ORBITAL DOCKING 300, EARTH REENTRY 300. Everything is computed from what the simulations measured, at the end of each phase, by pure functions (`data/missionScoring.js`, `SCORING_VERSION = 1`). The same snapshots, difficulty, destination and version always give the same score. Nothing is scored or shown during flight; the four docking views, the guidance and the language never affect a score. No physics, limit or tolerance changed.

**Where the numbers come from (phase snapshots, `data/flightScoring.js`):**
- **Landing:** the graded touchdown (`landerSim gradeTouchdown`, which now also carries the raw `fuelLeft`, `initialFuel` and descent `time`; the /100 grade on the landing result screen is unchanged).
- **Docking:** the capture judgement's own facts at the instant the probe tip crossed the drogue ring (`judgeContact`: lateral offset, axis angle, roll, closing and lateral speed, rotation rate), the RCS left, the capturing attempt's bounced contacts and the attempt history (DockingOps' hard-dock result now carries `capture` and `attemptContacts`).
- **Reentry:** ReentryGame's measured entry (`resultData`: flown entry angle, peak heat rate, heat load, overheat, shield used, peak g, splashdown speed) plus the bank-control share (the Training Center's measure, now sampled in missions too; read-only predictions) and the entry attempts and capsules lost.
- One snapshot per phase, from the attempt that ended it. `beginDescent()` (BEGIN PDI, also after RETRY DESCENT) drops everything earlier; nothing is summed across attempts.

**Curves** (each against the pilot difficulty's own limit): `underLimit(r, free)` = full up to `free` of the limit, then down quadratically to 0 at the limit; `lowerBetter(v, full, zero)` and `higherBetter(v, zero, full)` are linear. Each component is rounded, and the phase score is their sum.

| Phase | Component | Points | Rule |
|---|---|---|---|
| Landing 400 | vertical touchdown speed | 140 | `underLimit(vy / safeVy, 0.2)` |
| | horizontal touchdown speed | 60 | `underLimit(vx / safeVx, 0.2)` |
| | attitude (tilt) | 40 | `underLimit(tilt / safeTilt, 0.1)` |
| | accuracy (from the primary LZ centre) | 100 | full ≤ 1 m, 0 at 30 m |
| | fuel & descent efficiency | 60 | ideal-burn fuel ÷ fuel used: 0 at 0.35, full at 0.85 (a fuller tank earns nothing more) |
| Docking 300 | contact speed | 70 | `underLimit(closing / vMax, 0.3)` |
| | port alignment | 70 | `underLimit(lateral / tol.lateral, 0.1)` |
| | lateral / vertical drift | 40 | `underLimit(vLat / tol.vLat, 0.1)` |
| | angular alignment / roll / rotation | 30 / 10 / 10 | `underLimit(x / tol.x, 0.1)` |
| | RCS efficiency | 40 | RCS left of the attempt's budget: 0 at 30 %, full at 85 % |
| | clean capture | 30 | −15 per contact that bounced off before the capture |
| | restarts and retries | −10 each, at most −30 | each extra attempt (RESTART DOCKING or a failed attempt) |
| Reentry 300 | entry corridor | 90 | full within 0.15° of −6.50°, 0 at 0.9° |
| | peak g | 70 | full ≤ 9 g, 0 at 12 g (the structural limit) |
| | peak heating | 60 | full ≤ 188 W/cm², 0 at 200 (the design rate) or any overheat |
| | heat shield used | 40 | full ≤ 60 %, 0 at 90 % |
| | flight control | 40 | hypersonic flight with the lift vector on guidance: 0 at 50 %, full at 90 % |

- **Gates:** a crash scores 0 for the landing; a docking scores only on the physics' capture; a reentry only on splashdown. Splashdown speed is set by the parachutes and there is no recovery target, so neither is scored. "Descent efficiency" and "fuel remaining" are one measurement here (fixed start, fixed tank), so they are scored once. The ideal-burn table (`LANDING_FUEL_REF`) is re-derived from `landerPilots idealBurn` in the tests.
- **Medals:** BRONZE 500, SILVER 700, GOLD 850, PLATINUM 950. A medal needs a safe landing, the docking, a splashdown, and no capsule lost on an earlier entry (RETRY ENTRY finishes the flight, but a lost capsule is a failed mission). CADET and ASTRONAUT are capped at GOLD and the debrief says so ("950 points reached — awarded GOLD"); PLATINUM is COMMANDER only. A failed mission shows its partial score and no medal.
- **Retries:** RETRY DESCENT restarts the scored mission (nothing has been flown before the descent, so it equals choosing the mission again). Docking restarts cost 10 each (capped at 30) and are never a first attempt. Phase ratings use the medals' shares: OUTSTANDING 95 %, EXCELLENT 85 %, GOOD 70 %, FAIR 50 %, NEEDS WORK below.
- **Calibration** (reference pilots flying the real simulations, `missionScoring.test.js`): a precise flight scores 900–968 at every destination and difficulty (PLATINUM only on COMMANDER, at one destination), a looser one 745–832 (SILVER).

**Achievements** (17, `ACHIEVEMENTS`; decided at the landing result, the hard dock, the splashdown or the end of a successful mission; official missions only; each unlocked once, with its flight, date and place):
- **Landing:** FIRST FOOTPRINT (a safe landing), SOFT TOUCHDOWN (both touchdown speeds ≤ 30 % of their limits), PRECISION PILOT (≤ 1.0 m from the LZ centre), FUEL MASTER (≤ 1.14× the ideal burn's fuel).
- **Docking:** FIRST CONTACT; PRECISION DOCKING (lateral ≤ 25 % and angle ≤ 25 % of tolerance, closing ≤ 50 % of the window, drift ≤ 30 %); FIRST-ATTEMPT DOCKING (one attempt, no restart, no failure); RENDEZVOUS MASTER (≥ 270/300).
- **Earth return:** WELCOME HOME (a splashdown); REENTRY SPECIALIST (≥ 270/300).
- **Destinations and elite:** FOUR DESTINATIONS, MOUNTAIN NAVIGATOR (Hadley), CRATER SPECIALIST (Tycho), SILENT HORIZON VETERAN (far side), COMMANDER QUALIFIED, PERFECT EXPEDITION (≥ 90 % in all three phases in one successful mission), LUNAVIA MASTER (PLATINUM at all four on COMMANDER).

**Records and persistence** (`lib/missionRecords.js`, localStorage key `lunavia.mission.records.v1`, `schema: 1`):
- Twelve categories (destination × difficulty): mission attempts (flights whose descent began), successful missions, best total and medal, best landing, docking, first-attempt docking and reentry, first-attempt and restarted docking counts, achievements earned there.
- The history is the existing official-missions log (`lunavia.mission.log.v1`). Its entries gain `flown`, `reentry`, `scoring` (version, status, the phase snapshots, scores, medal, `newBest`, `prevBest`) and `endedAt`. Statuses: complete, complete-after-loss, failed-landing, failed-docking, failed-reentry, aborted.
- Loading never destroys anything:
  - damaged data is kept under `…records.v1.damaged`;
  - a newer schema is read but never written;
  - junk categories and achievements are dropped.
- On the first load, flights logged before scoring are taken over only for what they prove: attempts, FIRST FOOTPRINT, FIRST CONTACT, FIRST-ATTEMPT DOCKING, WELCOME HOME and a "completed before scoring" count. No score or medal is invented for them.
- Training records (`lunavia.training.v2`) are separate and untouched.

**Screens:**
- **MISSION COMPLETE** is unchanged over the splashdown, with a MISSION DEBRIEF button. After 5 s the debrief takes over by itself.
- **The debrief** (`components/scoring/MissionDebrief.jsx`) reveals:
  1. the phase scores, ratings and bars;
  2. the total;
  3. the medal (`MedalEmblem`);
  4. the achievements this flight unlocked;
  5. the personal record (NEW PERSONAL BEST / previous best);
  6. one recommendation drawn from the flight's own numbers (`recommendation`).
- A tap shows everything at once; the debrief never closes itself. DETAILED TELEMETRY lists every measured value, its points and the rule, the deductions, the medal gates and rules, and all unlocked achievements.
- A failed mission's END MISSION (crash, failed docking, lost capsule) shows the partial debrief (state `DEBRIEF`). An in-flight ABORT is logged as aborted and returns to the menu.
- **FLIGHT RECORDS** (`/records`, from MISSIONS and from the debrief) has three tabs:
  - MEDALS & RECORDS: the 4 × 3 grid, each category's detail, and the medal rules;
  - ACHIEVEMENTS: earned with date and place, locked with the exact requirement and progress where measurable;
  - MISSION LOG: every official flight, with its debrief again.
- The MISSIONS cards show each destination's best medal and score. ModeMenu (MISSIONS / TRAINING) is untouched. All four destinations stay open.
- **Language:** every new text is in English and Brazilian Portuguese, following the subtitle language (`scoringText.js`).

**Future exploration:** EVA and surface exploration are not playable and not scored. A future exploration phase comes with `SCORING_VERSION` 2; the log and records keep the version each result was scored with.

**Tests:**
- `data/missionScoring.test.js` (27): each phase's formula, the 1,000 maximum, determinism, medal thresholds and caps, failed missions, restarts, no inflation, no duplicate unlocks, personal bests, persistence (restart, damaged, newer), 12-category separation, training separation, legacy import, and real reference flights at all 12 combinations.
- `pages/officialMissions.test.js`: the flow wiring; no score in the flight views; the menus unchanged.
- `scripts/verify-ios-bundle.js` checks the debrief, the Portuguese debrief, the medal rule, the achievements and the records key in the packaged bundle.

**In-app validation (headless Chromium, landscape iPhone sizes; not a physical iPhone).** Each mission was flown in full on the packaged bundle: landing by an in-page pilot on the keyboard controls, docking by the reference pilot through the docking simulation, reentry with the trim and roll keys.
- **All 12 destination × difficulty combinations:**
  - 11 successful missions at 906–932 points (GOLD) after reload;
  - one COMMANDER flight lost its capsule (a deliberate skip-out), then RETRY ENTRY: completed, 933 points, NO MEDAL;
  - a docking with RESTART DOCKING and one after a failed attempt each scored −10, with no FIRST-ATTEMPT DOCKING;
  - achievements unlocked once each, FOUR DESTINATIONS on the fourth destination;
  - all 12 categories were kept after a page reload; the training records were untouched.
- **A crash and END MISSION** gave the partial debrief: MISSION FAILED, 0 points, no medal, and the gate as the recommendation.
- **Personal bests:** a second mission at the same destination and difficulty showed NEW PERSONAL BEST with the previous best.
- **No score in flight:** none was found on screen during the descent or the docking.
- **The debrief** took over 3–5 s after MISSION COMPLETE and was still open 20 s after its reveal.
- **The test pilot's reentry** agreed with the lift guidance only about 37 % of the time, so every flown entry scored 260/300 (flight control 0/40). The debrief named that component.
- **PLATINUM in flight:** no in-browser flight reached it. Reference flights that follow the guidance reach it in `missionScoring.test.js` (COMMANDER at the Sea of Tranquility, 962).

## 48. Docking ports: where the two spacecraft connect

**The problem:** the docking worked, but the screen never said *where* the two vehicles connect. Both ports were small and dark (a black ring and a thin probe on the CSM; a black ring on the ascent stage). Nothing labelled them. The 360° view started behind the ascent stage, whose port faces away from the camera. And the rendezvous marker pointed at the CSM's middle.

**Audit (before any change):** the physics and the 3D models agree, so no geometry was changed.

| Interface | Physics (`dockingSim`) | 3D model | Agreement (tested in `dockingPorts.test.js`) |
|---|---|---|---|
| **Target port** (CSM, receiving) | docking ring at `[0, DOCK_Y, 0]` = 2.98 m; probe tip `PROBE_TIP` 0.78 m beyond, on the CSM's +Y | `csmDesign buildCM`: ring torus r 0.40 m at the tunnel top; probe cone apex at `CM_TOP + PROBE_L` | the model's highest probe vertex is `PROBE_TIP` (< 1 µm) |
| **Active port** (ascent stage, flown) | drogue `PORT_B` = 1.464 m up body +Y from the stage's centre; mouth `DROGUE_R` 0.42 m | `lmDesign`: drogue torus r 0.088 u at (0, 0.905, −0.03) u, × 4.8 m/u | the torus centre maps to `PORT_B` within 1 cm; 0.088 × 4.8 = `DROGUE_R` |
| Contact | judged when the probe tip crosses the drogue's ring plane (`judgeContact`); docked, the drogue ring sits on the CSM ring, face to face | `dockedLmPose` | tested |
| Approach axis | the CSM's +Y (the approach comes from behind along the orbit) | — | — |

**What the player sees now** (`data/dockingPorts.js` pure and tested; `components/DockingPorts.jsx`; `DockingOps`):
- **The ports themselves** (docking scene only; the canonical CSM and LM models are unchanged, so no other scene changes):
  - CSM: a light anodised docking-ring face, four orange alignment index marks, a dark capture collar under a bright probe tip.
  - Ascent stage: the drogue's funnel face (radius = `DROGUE_R`, the real capture boundary) with its receptacle and four index marks.
  - While the approach is flown: a thin cyan perimeter on the target port, orange on yours.
- **TARGET DOCKING PORT marker:** projected every frame from the probe tip through the live camera (in tests and in the browser, within 0.06 px of the real projection).
  - It is not the CSM's centre: 5.8 m away in space, and 50–175 px apart on screen from the side.
  - The bracket tightens on the ring as the range closes. In the last 3 m only the corner ticks remain, outside the ring.
  - When the port is not in plain view, the marker uses a convention instead:
    - behind a hull: dashed, "HIDDEN" (tested with occlusion by the CSM's and the ascent stage's hulls);
    - outside the window (COCKPIT/WINDOW): dashed, "OUT OF WINDOW VIEW";
    - off screen: an edge arrow.
    - These are kept between the top bar and the controls, with an arrow pointing at the real port.
  - 360°: a second marker, YOUR PORT, on the drogue. From the default camera behind the stage it reads "YOUR PORT · HIDDEN", because the port faces the CSM.
- **Approach corridor** (attached to the receiving port, from `corridorGeometry`):
  - the probe's axis;
  - a translucent cone whose radius is the guidance's own lined-up threshold, max(0.6 × lateral tolerance, 0.03 × range) — one corridor, not a second rule;
  - distance rings at 5, 10, 20 and 30 m;
  - the capture ring (the lateral capture tolerance) at the probe tip;
  - the ascent stage's own axis;
  - in 360°, an amber arrow for the translation the guidance asks for (the buttons' body push turned through the attitude).
  - Cyan inside the corridor, amber outside.
  - Shown by view: 360° everything; NAV the rings ahead of the camera and the capture ring; WINDOW/COCKPIT the capture ring only, fading as it gets close.
- **Port-frame HUD (NAV, 360°):** PORT–PORT distance (drogue to probe tip), CLOSING (the drogue's speed along the axis), OFFSET R/L and U/D (the drogue from the probe's axis), DRIFT, PORT ANGLE, attitude and RCS. Everything is measured at the ports, not the vehicles' centres.
- **Approach status** (`approachStatus`), one line:
  - TARGET ACQUIRED;
  - ALIGN DOCKING PORTS;
  - CORRECT LATERAL OFFSET;
  - CORRECT ATTITUDE;
  - APPROACH CORRIDOR ALIGNED;
  - REDUCE CLOSING VELOCITY;
  - UNSAFE APPROACH (the drogue not facing the probe / beside the probe / drifting outside the drogue in the last 3 m);
  - FINAL APPROACH AUTHORIZED;
  - DOCKING CONTACT;
  - HARD DOCK CONFIRMED.
- **FINAL APPROACH · CAPTURE CONDITIONS** (`captureReadiness`):
  - The checks are judgeContact's own, each against the difficulty's tolerance: port alignment (angle and roll), lateral offset, lateral drift, closing velocity (vMin–vMax, and under the closing limit), rotation, plus the docking corridor.
  - Each is green only with a 5 % margin inside the tolerance. All green: PROCEED WITH FINAL APPROACH.
  - Shown in full in NAV, and as six dots in WINDOW, COCKPIT and 360°.
  - The guidance's STAND BY FOR CONTACT uses the same check.
- **Directions:** they come only from the guidance (`dockingGuidance`, body axes through the current attitude, inertia, no flip-flop).
  - The panel's control line now starts with the order in words: MOVE LEFT/RIGHT, TRANSLATE UP/DOWN, CLOSE IN, REDUCE CLOSING VELOCITY.
  - NAV shows the same order as chevrons on the reticle (in NAV screen right is body +X).
- **Why a contact failed** (`contactCause`, from the physics' facts):
  - every deflection reason with its measured value against the limit (e.g. LATERAL OFFSET 0.33 m > 0.20 m);
  - outside the drogue (offset vs the 0.42 m mouth);
  - excessive impact velocity (vs 0.60 m/s);
  - contact with a non-docking surface (which part of the ascent stage against the CM cone or the SM; and an incorrect approach direction when the drogue was not facing the probe);
  - target lost; RCS depleted.
  - Shown on the contact toast and the failure screen.
- **360° FOCUS DOCKING PORTS** (`focusOrbit`): the camera moves to the sunlit side, perpendicular to the docking axis, centred between the two ports, far enough to hold both. It stays freely draggable and pinchable; RESET CAMERA returns to the default.
- **Languages:** everything new is in English and Brazilian Portuguese (`dockingPortsText.js`).

**Unchanged:** `dockingSim.js` (not edited): RCS authority, propellant, relative motion, tolerances, collisions, difficulties, RESTART DOCKING, the rendezvous, ascent, crew transfer and return. The four views' cameras are unchanged; only the 360° camera can now centre on the ports.

**Tests** (`data/dockingPorts.test.js`, 31):
- the model's ports equal the physics' ports;
- the marker sits on the projected port, not the centre, follows motion and tightens with range;
- off-screen, hidden and outside-window states;
- the corridor is attached to and turns with the port frame, and is the guidance's own radius;
- offsets and angle respond to real displacement and rotation;
- closing is the port's speed;
- words and the 3D arrow follow the buttons (400 rolled states);
- unsafe "miss" approaches never capture;
- readiness: never green one step before a contact the physics rejects (2,345 random final approaches), and green at 79 % of the captures made inside the corridor;
- reference and guided pilots' flights are authorized at capture on all difficulties;
- failure causes from real physics contacts;
- FOCUS frames both ports along whole approaches at three iPhone sizes;
- restart resets the status;
- the physics values are unchanged.

## 49. Photorealistic Earth and Moon (NASA textures, one planet renderer)

**The problem (audit before any change):**
- **Earth:**
  - three.js example textures (2048 day map, 1024 clouds) drawn as `MeshPhong`;
  - a fresnel shell `pow(0.68 − n·v, 2.6)` that glowed all round the disc like neon;
  - a second "atmosphere" sphere at R × 1.055 (about 350 km: four times too thick);
  - on the Moon's sky, a self-lit Earth (`emissive #0a1830`).
- **Moon:**
  - the 1k three.js map, blurred further at load;
  - a bump map taken from the albedo, so dark maria became pits and craters looked like stickers;
  - `MeshStandard` lit by the scene's ambient and hemisphere fills, so there was no true terminator and the night side glowed.
- **Duplication:** seven separate planet implementations, some loading the same textures twice.
- **Launch:** the launch already had a ray-traced atmosphere, but hazy oceans, procedural city lights and its own copy of the old maps.

**Textures** (`frontend/public/textures/planets/`, sources and rights in `SOURCES.md` there; built by `scripts/planets/prepare_textures.py`, checked by `scripts/planets/check_textures.py`):

| File | Size | Content |
|---|---|---|
| `earth_day_4k.jpg` | 4096 × 2048 | NASA Blue Marble (land, shallow water, relief shading) |
| `earth_aux_4k.jpg` | 4096 × 2048 | data channels: R water mask, G NASA city lights, B NASA Blue Marble clouds |
| `earth_day_1k.jpg`, `earth_aux_1k.jpg` | 1024 × 512 | the same two maps, smaller, for an Earth that is only a small disc (the lunar sky, the far-side intro: `PlanetEarth small`), so those scenes never upload the 4k maps |
| `moon_color_4k.jpg` | 4096 × 2048 | NASA CGI Moon Kit: LRO Camera (WAC) colour mosaic |
| `moon_normal_2k.jpg` | 2048 × 1024 | normals computed from the LOLA elevation (relief × 2), local east/north/up frame |

- **Download path:** NASA's servers are blocked by this build environment's network policy, so the unmodified NASA files came from public GitHub mirrors (listed in `SOURCES.md`). Everything ships in the app and works offline. Nothing is fetched at run time.
- **Projection:** all four maps share one projection, the same as before (longitude −180° at the left edge, north up; three.js sphere UVs). The Moon's per-mission orientation (`moonQuaternionFor`) is unchanged.

**The renderer** (`components/planets/`): `planetMaterials.js` holds the shaders and the shared texture cache; `Planets.jsx` holds `PlanetEarth` and `PlanetMoon`.
- **One Sun, no ambient:**
  - Each planet is lit only by the `sun` direction it is given, the same vector that lights that scene's spacecraft.
  - The materials are `ShaderMaterial`s with `lights: false`, so the scenes' ambient and hemisphere fills (which the spacecraft still need) never reach the planets.
- **Earth surface:**
  - day map × Sun light, with a slightly warmer colour near the terminator;
  - cloud shadows offset from the clouds;
  - a narrow sun glint on water only;
  - a thin blue aerial haze growing towards the limb.
  - The night side is dark: city lights (the NASA map, squared to keep only real cities) show only where the Sun is below the horizon, on land, dimmed under cloud.
- **Clouds:** a separate shell at R × 1.004 that drifts slowly. It is lit by the same Sun, has a soft terminator and thins at the limb.
- **Atmosphere:**
  - A thin limb, not a halo: a back-face shell at R × 1.018 (about 115 km).
  - It is shaded per pixel by the ray's closest approach to the planet: an exponential density, blue on the day side, a warm twilight band at the terminator, forward scattering towards the Sun. It is invisible on the night side.
  - Rays that hit the planet are discarded, so the limb never covers the disc.
- **Moon:**
  - LRO colour × a lunar-Lambert reflectance (Lommel–Seeliger blended with Lambert): the full Moon stays bright to the limb, and the terminator falls off naturally.
  - The LOLA normal map gives the relief, with soft wrapping so texel steps never draw black dashes.
  - The terminator follows the true sphere, so relief cannot light the night side.
  - Earthshine is 0.4 % (a trace), with no other ambient light.
  - Optional fine regolith detail for close views.
- **Memory:**
  - Each texture is loaded once and shared by every scene (`planetTexture`): mipmaps, anisotropy 4, sRGB for the colour maps and linear for the data maps. Textures are never disposed by a scene; materials are.
  - GPU memory with mipmaps: the four large maps about 145 MB, the two 1k Earth maps about 6 MB (before: about 40 MB for the old maps, and some were loaded twice).
  - Each scene has its own WebGL context, so it holds only the maps it draws: the launch the two 4k Earth maps, lunar orbit and the return up to all four (about 145 MB; a map is uploaded only once something using it is drawn), docking the Moon's two (about 56 MB), the landing sites the 1k Earth (about 6 MB).
  - JPEG, not KTX2/Basis: no compressed-texture pipeline in this project yet.

**Scenes:**

| Scene | Change |
|---|---|
| Launch (`scenes/launch/environment.js`) | keeps its ray-traced atmosphere; now uses the shared Blue Marble day map (decoded as sRGB, no manual gamma), the real water mask, NASA clouds with the launch's formation detail, a lighter haze veil from orbit, and NASA city lights in place of the procedural ones |
| Lunar orbit and the mission's Earth (`MissionScene`) | `PlanetMoon` / `PlanetEarth` with the scene's `SUN_DIR`; regolith detail fades in only for the close lunar-orbit framings |
| Undocking, descent setup | the same `PlanetMoon` |
| Docking, all four views (`DockingOps`) | `PlanetMoon` with the docking scene's Sun, darker (exposure 0.55, about the old Moon's brightness here) and light detail, so the corridor, markers and NAV text stay readable over it |
| Landing sites (`LunarSite`) | the Earth in the sky is `PlanetEarth` lit by the site's Sun (its phase follows from the geometry), shown about 2× its real 1.9° as before; **no Earth at the far side** (Silent Horizon: `site.earth` is null) |
| Far-side intro (`FarSideIntro`) | the far side really faces the camera (`farSideQuaternion`), lit by one Sun; the Earth sets behind the limb |
| Return and reentry (`ReentryScene`) | `PlanetEarth` with the reentry Sun; the limb fades out once the camera is inside the air |
| Training background | `moon_color_4k.jpg` |

`components/scenes/DescentScene.jsx` (unused, still on the old textures) was deleted.

**Tests:**
- `components/planets/planets.test.js` (9):
  - every texture exists, is credited and is local;
  - the old textures are gone and unreferenced;
  - the textures are shared, with the right colour spaces and mipmaps;
  - every scene uses the shared renderer;
  - one Sun by reference and no ambient term;
  - the thin limb with its discard;
  - each scene passes its spacecraft's Sun;
  - no Earth on the far side and an Earth above the horizon elsewhere;
  - the Moon's orientation is kept.
- `scripts/planets/check_textures.py`:
  - sizes and blank maps;
  - Earth geography (Sahara, oceans, ice, water mask, city lights in London/New York/Tokyo, none in mid-ocean);
  - Moon geography (Imbrium and Crisium darker than the highlands, near side darker than the far side);
  - seams;
  - normals pointing outwards.
- `scripts/verify-ios-bundle.js` §9: every texture the JS names is in the bundle, valid, identical to the source copy; retired textures absent; `SOURCES.md` bundled.

**Unchanged:** gameplay, physics, trajectories, landing terrain, spacecraft models, docking logic and cameras, the direct cut into lunar orbit.

## 50. Assisted docking: AUTO-ALIGN, STABILIZE, APPROACH SPEED ASSIST, soft capture

**Why docking was too hard (Phase 0 audit).**
- **Method:** simulated pilots flew the real `dockingSim` from each difficulty's checkpoint, pressing only what a player can press. There were six pilots:
  - the reference pilot;
  - the guidance follower at 0.25, 0.7 and 1.0 s reaction time;
  - a "holder", who keeps the shown button down until the instruction changes (the usual touchscreen habit);
  - an impatient pilot, who leans on FWD.
- **The physics, geometry and guidance are sound.** The capture is judged on the real drogue and probe, the HUD and guidance agree with the physics, and the controls are body-axis and correct in every view. A pilot who follows the panel perfectly docks every difficulty.
- **Too long and too fiddly.**
  - Even a perfect pilot needed 3.5–6.5 minutes and 40–330 separate inputs (CADET 212 s; COMMANDER 378 s).
  - The checkpoint was 30–38 m out at 4–6 cm/s with 2–4.5 m of lateral offset.
- **Holding a button meant full RCS at once.** A tap is 0.012 m/s; a 1-second hold is 0.1 m/s, the whole lateral tolerance. The "holder" overshot, chased its own corrections, and drained the tanks:
  - CADET used 85 % of its RCS;
  - ASTRONAUT and COMMANDER ran out (RCS PROPELLANT DEPLETED). At ASTRONAUT the "reduce lateral drift" order alone burned 12 of the 18 m/s.
- **Nothing nulled drift for the player.** The orbit's Coriolis coupling is real: at 0.3 m/s closing, it carries the vehicle about 1 m off the axis per minute. Hands off for 2 minutes, CADET drifted 3.6 m off the axis.
- **The impatient approach:** a deflection, then a glancing touch of the command module counted every simulation step as a new contact (4,025 "contacts" in one run). That was a bug.
- **Parameters before:**

| | CADET | ASTRONAUT | COMMANDER |
|---|---|---|---|
| Start | 30 m, offset 2.0 m, drift 1.6 cm/s, 4 cm/s closing, 5° | 34 m, 3.4 m, 2.7 cm/s, 5 cm/s, 10° | 38 m, 4.5 m, 4.3 cm/s, 6 cm/s, 15°, 0.4°/s |
| RCS | 0.10 m/s², 30 m/s | 0.08 m/s², 18 m/s | 0.07 m/s², 12 m/s |
| Capture tolerances | 0.30 m, 7°, roll 15°, 0.015–0.40 m/s, lateral 0.10 m/s, 1.5°/s | 0.20 m, 5°, 10°, 0.025–0.30, 0.07, 1.0°/s | 0.14 m, 3.5°, 6°, 0.03–0.22, 0.05, 0.7°/s |
| Help | attitude hold, AUTO ALIGN (on by default) | attitude hold | none |

**The assists** (`dockingSim.js` "assists"; `assistsOf`, `engageStabilize`, `assistLimit`).
- **The rules they all follow:**
  - Every assist fires the same RCS as the pilot: its command is added to the pilot's, clipped to the same per-axis authority, and paid from the same propellant.
  - Nothing is set or teleported. The tests check the acceleration never exceeds the RCS's and the turn rate never exceeds the attitude limit.
  - No assist closes in, and nothing docks by itself.
- **AUTO-ALIGN** (CADET):
  - The autopilot turns onto the docking attitude (drogue axis along the probe, no roll) and holds it.
  - A held attitude button overrides it while held.
  - Its state shows as ACTIVE, ALIGNED or MANUAL. Messages: AUTO-ALIGN ACTIVE, DOCKING AXIS ALIGNED.
  - It does not translate. It is now off at the start of a CADET attempt: the first step of the taught sequence is to press it.
- **STABILIZE:**
  - The RCS drives the velocity to a held value: no sideways or vertical motion, a closing speed between 0 and the safe approach speed. Rates are damped.
  - Messages: STABILIZATION ACTIVE, then RELATIVE MOTION STABLE.
  - **CADET ("hold"):** it keeps holding. The pilot's translation still fires and moves the held velocity by exactly the Δv it adds. A tap therefore sets a new steady slide, and the assist only cancels the drift nobody commanded (the orbit's pull). Hands off for a minute, CADET now stays within 5 cm of the axis; free, it drifts 0.3 m or more.
  - **ASTRONAUT ("once"):** it nulls, says RELATIVE MOTION STABLE and hands back. Any translation command cancels it ("STABILIZE CANCELLED — YOUR RCS COMMAND"). The guidance offers it as the alternative to jets for a drift.
  - **COMMANDER:** none.
- **APPROACH SPEED ASSIST** (CADET, on by default, can be switched off):
  - The closing limit is `assistLimit(axial)` = min(0.45, 0.08 + 0.025 × distance) m/s: 0.45 m/s from 15 m out, 0.33 at 10 m, 0.13 at 2 m, 0.08 at contact.
  - Above the limit the RCS brakes (aft thrust, at most the RCS's 0.1 m/s²). At the limit, FWD is not fired.
  - It never pushes forward: hands off at rest, nothing moves. Message: APPROACH SPEED ASSIST ACTIVE; the button reads BRAKING.
- **Soft capture** (CADET's tolerances are its soft-capture envelope):
  - **Envelope:** 0.36 m (the drogue's mouth is 0.42 m), 9°, roll 18°, 0.01–0.45 m/s, lateral 0.13 m/s, 2.5°/s.
  - **Sequence:** the probe latches (SOFT CAPTURE), and over 6 s the mechanism draws the vehicles together and lines them up (pose interpolation from the capture pose, as before), then HARD DOCK CONFIRMED.
  - **What it rejects:** 0.5 m off, 0.55 m/s, 14° or 0.2 m/s sideways (tested). ASTRONAUT and COMMANDER keep their tolerances and refuse the same contact that CADET captures.
  - "DOCKING CONTACT" now reads SOFT CAPTURE in every difficulty (the captured state is the soft capture).
- **CADET checkpoint:** 22 m out, within a metre of the axis (0.7 / −0.5 m), drift 0.5 cm/s, closing 3 cm/s, attitude 3/−2/4°, no rotation, facing the probe. ASTRONAUT and COMMANDER start as before. RESTART DOCKING rebuilds each difficulty's own checkpoint with STABILIZE off and the switches back to their defaults.
- **Collisions:** a glancing touch is one contact for as long as it lasts, not one per step.

**Controls** (`jetCommand`, `DockingOps`).
- **Taps:** a tap is the same minimum impulse as before (0.12 s, full thrust).
- **Holding:** gives 35 % until 0.6 s, then builds to full thrust by 2.0 s. A 0.5 s press now adds about half of what it did.
- **FINE** (top-left of the pad, every difficulty: it is not automation) scales the jets to 35 %.
- **No stuck thrust:** every held button and key is released when the app loses the screen or the focus (blur, visibilitychange).
- **Unchanged:** the jet buttons' own pointer capture and cancel, the 360° gesture layer under the controls, and the camera views (they never touch the physics).

**On screen.**
- **Assist buttons:** a column beside FWD/AFT, each showing its state (CADET: AUTO-ALIGN, STABILIZE, SPEED ASSIST; ASTRONAUT: STABILIZE; COMMANDER: none).
- **Above the guidance panel:**
  - the assist states (AUTO-ALIGN: ACTIVE · STABILIZE: HOLDING · APPROACH ASSIST: ACTIVE · YOU FLY: TRANSLATION AND FWD/AFT);
  - the latest assist message;
  - in CADET, the six-step sequence with live ticks (`assistSequence`): press AUTO-ALIGN, press STABILIZE, check the target is aligned, use forward RCS carefully, keep a safe closing velocity, let soft capture happen.
- **The guidance** teaches the same sequence:
  - new instructions PRESS AUTO-ALIGN, PRESS STABILIZE, STABILIZATION ACTIVE — WAIT and APPROACH SPEED ASSIST BRAKING (nothing to press);
  - the assist it names is highlighted;
  - with the speed assist on, CADET's target closing speed is 70 % of the assisted limit.
- **Languages:** everything is in English and Brazilian Portuguese.

- **Final tuning found by those players:**
  - With the speed assist on, CADET's guidance says "tap FWD up to about half the assisted limit", then hands off. As the ports close, the assist and STABILIZE brake along the falling limit, so there is no AFT order to chase.
  - STABILIZE's "stable" judges the sideways motion and rotation, not the planned braking along the axis.
  - The CADET hold keeps at most 6 cm/s sideways (3 cm/s in the last 3 m), so a long press is not kept as a fast slide.

**Results: simulated players** (the real physics, input only; `dockingAssist.test.js`, 22 tests):

| Pilot | CADET before | CADET now | ASTRONAUT now | COMMANDER now |
|---|---|---|---|---|
| Follows the panel, 0.7 s reaction | docks, 218 s, 42 inputs | docks, 133 s, 27 presses, 2 % RCS | docks, ~320 s, 8 % RCS | docks, ~390 s |
| Holds the shown button | docks, 85 % RCS (old jets) | docks, 126 s, 16 % RCS | docks, 43 % RCS (before: out of RCS) | runs out of RCS (demanding by design) |
| Impatient, leans on FWD | docks after a deflection | docks, 93 s, no contact | docks | docks, 85 % RCS |

CADET also recovers from closing too fast (0.7 m/s at 18 m), sideways drift (9 cm/s) and an attitude 25° off: all three dock, with no contact.

**Results: in the browser** (production build, a real mission flown to the docking, then only on-screen button presses following the panel, about 0.7 s between looking and pressing; headless Chromium, not a phone):
- **CADET** (CDP touch events, the four views cycled every 20 s, RESTART DOCKING held at 45 s):
  - The restart returned to the 22 m checkpoint with STABILIZE and AUTO-ALIGN off, the speed assist on, full RCS and attempt 2.
  - The player pressed AUTO-ALIGN and STABILIZE again and reached soft capture: 61 presses in all, no contact, 98 % RCS left.
- **ASTRONAUT:** soft capture after 569 s and 551 presses, no contact. The player took the optional STABILIZE 58 times.
- **COMMANDER:** soft capture after 422 s and 303 presses, no assist, no contact.
- No page errors in any run.

## 51. Docking copilot: AUTO-CENTER, MATCH VELOCITY, FINE APPROACH, DOCKING TRAINING

**Audit (before the change).**
- **What each assist did:**
  - AUTO-ALIGN corrected the attitude only.
  - STABILIZE matched the velocity (and kept holding it on CADET).
  - The speed assist capped the closing speed.
  - The guidance already lit the right jet button, derived from the attitude and the real button mapping.
- **Can a player be oriented but displaced? Yes.** With AUTO-ALIGN and STABILIZE on and hands off, the CADET port stayed 0.88 m off the probe's axis. Capture needs 0.36 m; the "lined up" corridor at that distance is 0.61 m.
  - So the player still had to translate on two axes and set the closing speed at the same time.
  - A perfect guided CADET still spent 6 sideways and 19 FWD/AFT presses. Browser players needed about 60 presses, mostly sideways corrections and 0.012 m/s FWD taps.
- **Why beginners still failed:**
  - working out which sideways jet moves the port which way;
  - managing two lateral axes together;
  - many tiny FWD taps to build a sensible closing speed;
  - long holds that overshoot.

**What changed** (`dockingSim.js` assists; `dockingGuidance.js`; `DockingOps.jsx`). Everything flies the same RCS as the pilot (authority, propellant). Nothing teleports, and nothing closes in by itself.
- **AUTO-CENTER (new):** translation, not attitude.
  - It slides the ascent stage sideways until its docking port (the drogue, through the current attitude: `portOffset`) is on the probe's approach axis.
  - Slide speed is min(6 cm/s, 0.1 × offset), and 3 cm/s in the last 3 m.
  - It is centred within min(8 cm, 0.4 × the lined-up corridor) and drifting less than 1 cm/s. Progress shows on the button (CENTERING 63 %), with CENTERLINE ACQUIRED when done.
  - **CADET:** it keeps holding the centreline against the orbit's drift. A sideways command from the pilot switches it off ("AUTO-CENTER OFF — YOUR SIDEWAYS COMMAND").
  - **ASTRONAUT:** it centres once and hands back. **COMMANDER:** none.
  - With MATCH VELOCITY on, it sets the hold's sideways velocity and the hold flies it; alone, it fires the sideways jets itself. It never moves the vehicle along the axis.
- **MATCH VELOCITY:** the existing STABILIZE engine, renamed on screen (no second system).
  - It matches the ascent stage's velocity to the CSM's in the CSM's rotating orbital frame: the hold cancels the Clohessy–Wiltshire Coriolis and tidal pull. Both vehicles stay in orbit; only the relative motion is managed.
  - Messages: MATCHING VELOCITY, then RELATIVE MOTION STABLE.
- **FINE APPROACH** (`fineStep`):
  - **CADET, with MATCH VELOCITY holding:** each FWD/AFT press sets the held closing speed exactly ±0.02 m/s, between 0 and the safe speed for the distance. The RCS reaches it gently (≤ 0.1 m/s²). Holding repeats every 0.35 s, and the keyboard R/F keys do the same. The buttons read +0.02 / −0.02.
  - **ASTRONAUT and COMMANDER:** FINE scales the jets to 35 %, as before.
  - **Feedback (all difficulties):** a closing readout above the guidance shows CLOSING, SET, SAFE ≤ (the assist's limit, or the physics' closing limit) and the distance. It turns red above the safe speed.
- **The right control, shown:**
  - The guidance still lights the jet it names, derived from the relative position, velocity, attitude and the real button mapping.
  - AFT shows BRAKE when it is the order.
  - A jet still held down that the guidance no longer asks for gets a red RELEASE cue.
  - Assists to press are lit the same way (AUTO-ALIGN, AUTO-CENTER, MATCH VELOCITY, FINE).
  - The tracker's hold-time, confirmations and "let it settle" rules still stop chatter.
- **CADET copilot** (`copilotSteps`, `copilotText`): five steps judged from the telemetry, each saying why it is not yet done, with the numbers:
  1. **AUTO-ALIGN** — the axis within half the attitude tolerance;
  2. **AUTO-CENTER** — the port within the corridor ("Port 0.42 m left and low of the centreline (needs < 0.22 m)");
  3. **MATCH VELOCITY** — drift < 1 cm/s, no rotation, not opening, not too fast;
  4. **FINAL APPROACH** — distance, closing, set and safe speeds;
  5. **SOFT CAPTURE** — the probe latching and lining up.
  - The steps run in order with a little hysteresis, and never on a timer. If the vehicle drifts off the axis on the way in, the copilot goes back to step 2.
  - The guidance asks for each assist in turn and waits while it works. It never orders sideways taps while AUTO-CENTER is flying.
- **Difficulties:**
  - **CADET:** the full copilot, all assists and FINE APPROACH.
  - **ASTRONAUT:** AUTO-CENTER and MATCH VELOCITY offered as one-shot alternatives to the jets (lit beside the jet), with the shorter instruction texts.
  - **COMMANDER:** nothing automated, the same physics and strict capture; FINE only scales the jets.
- **DOCKING TRAINING** (Training Center, `DOCKING_SCENARIOS`, `dockingDebrief`):
  - **Scenarios:**
    - FINAL APPROACH AND DOCKING: the mission checkpoint;
    - DRIFTING APPROACH: 1.4 / −1.1 m off, drifting 3.5 / −2.5 cm/s, closing 0.18 m/s, 9/−6/10° off;
    - COMMANDER DOCKING (locked).
  - **Flow:** DockingOps' `training` mode starts at that checkpoint with no ascent or rendezvous. RESTART DOCKING returns to the scenario's own start, and the run ends at HARD DOCK with no crew transfer.
  - **Debrief:** time, attempts, bounced contacts, and the physics' capture facts (closing, probe off centre, port angle, sideways drift) against the difficulty's limits; RCS left; advice. RETRY puts the player back at the checkpoint at once.
  - **Records:** attempts go to the training store only (`lunavia.training.v2`). The Training Center imports nothing from mission records, scoring, medals or achievements.
  - Lunar landing and Earth reentry training are unchanged.

**Tests:**
- **`dockingAssist.test.js`** (27):
  - AUTO-CENTER through thrust within the RCS authority, holding for 2 minutes, override, and ASTRONAUT's one-shot;
  - FINE APPROACH steps (exact, clamped, reached gently);
  - the guidance asking for each assist in turn;
  - the copilot steps, their reasons in EN/PT, and stepping back on a drift;
  - **the straightforward beginner sequence from the real checkpoint:** AUTO-ALIGN → AUTO-CENTER → MATCH VELOCITY → FINE APPROACH → FWD presses up to 0.2 m/s. CADET docks in 138 s with 9 FWD presses and 2 % of the RCS, at reaction times of 0.5 and 1.5 s;
  - 12 random CADET starts never produce an impossible state (acceleration within the RCS, propellant never negative, captures only inside the envelope).
- **`dockingTraining.test.js`** (5): the third discipline; every scenario dockable at each difficulty it offers; start and restart at the scenario's checkpoint; the debrief; no mission rewards.
- **MATCH VELOCITY holds station.** Pressed, it matches the CSM's velocity: no sideways motion and no closing. The final approach always starts with the pilot's FWD presses (tested: every assist on and no FWD for 3 minutes, even from the fast drifting start, and the vehicle holds station, centred).

**Results in the browser** (production build; headless Chromium, not a phone). A real mission is flown to the docking, or the Training Center is used; then only on-screen presses following the panel, about 0.7 s between looking and pressing:

| Run | Result |
|---|---|
| Mission, CADET (touch events, four views cycled, RESTART DOCKING at 40 s) | soft capture; the copilot sequence was redone after the restart; 28 presses across both attempts (8 assist presses, 20 FWD steps); no contact |
| Training FINAL APPROACH, CADET (touch) | soft capture after 146 s with 16 presses (AUTO-ALIGN, AUTO-CENTER, MATCH VELOCITY, FINE APPROACH, 12 FWD); probe 0.01 m off centre at 0.083 m/s; 98 % RCS left. The debrief, then RETRY: back at the checkpoint in 2.7 s with full RCS. Records only in the training store |
| Training DRIFTING APPROACH, CADET, 667 × 375 (iPhone SE size) | soft capture after 144 s with 18 presses (12 FWD); no contact |
| Mission, ASTRONAUT (taking the offered alternatives) | soft capture after 346 s (569 s before this change), 232 presses, AUTO-CENTER ×3 and MATCH VELOCITY ×4; 94 % RCS left |
| Mission, COMMANDER | soft capture after 510 s, 417 presses, no assists, no contact |

No page errors in any run.

## 52. The return to Earth: TEI, the coast, the Earth approach, the service module's separation

**Audit (what was wrong, and why it looked sideways).**
- After the hard dock and the ascent stage's jettison, the RETURN state played one close shot
  ("TRANSEARTH COAST", `returnClose` in MissionScene), then wide shots, before the reentry:
  - The close shot was built in `radialFrame`: Z pointed away from the Moon, X along the orbit
    tangent. The CSM was laid along X, but the shot moved the spacecraft straight away from the
    Moon along Z (the Moon only shrank). The CSM therefore travelled **broadside, at 90° to its
    own axis**. This was an orientation problem, not a camera trick. The camera, fixed to the CSM,
    made it worse: the only cue of motion was the Moon shrinking behind a CSM lying across the
    frame.
  - **No burn.** SpacecraftStack had an SPS plume, but MissionScene always set `sps = 0`, so
    nothing propelled the CSM out of lunar orbit.
  - The wide shots then showed only a sub-pixel glint and a trajectory line while the Earth grew,
    so the spacecraft disappeared before the approach.
  - **In the reentry** (ReentryScene/ReentryGame), the separated service module backed away
    towards the camera's side and filled the top right of the frame. The command module began its
    180° turn to heat-shield-first 1.2 s after separation, with the SM still about half a metre
    away.
- Unchanged and correct: the crew transfer and the jettison in DockingOps; the CSM is the same
  CsmModel/SpacecraftStack that stayed in lunar orbit; the reentry's own attitude (heat shield
  into the flow, trim angle, bank from the simulation) and plasma (the flow frame from the
  velocity).

**What changed.**
- **`data/earthReturn.js`** (pure, tested) holds the whole return. It runs for 42 s of real time;
  SKIP CINEMATIC goes straight to the reentry. Steps by time:
  - **0 s, TEI preparation**: over the sunlit Moon at 110 km, nose retrograde; CAPCOM: "GO for TEI".
  - **4.5 s, turn**: a 180° RCS slew to prograde. The couple fires only while the rate changes:
    acceleration, coast, deceleration.
  - **12 s, ignition**: the SPS fires along the CSM's axis. The plume comes from the engine bell,
    down the axis, so thrust and nose agree. The CSM pulls ahead of its orbit with constant
    acceleration, and the camera lags.
  - **21 s, cutoff**: the engine tails off in 0.3 s and never fires again.
  - **24.5 s, transearth coast**: engine off, passive thermal control. The long axis is held
    broadside to the Sun (tested within 6°), 34° off the flight path, and rolls slowly. The
    attitude is held; it is not forced along the path.
  - **32.5 s, Earth approach**: the Earth grows at its true apparent size, from 70,000 to
    21,000 km.
  - **34.5 s, entry attitude**: the roll is stopped by the RCS, and a slew puts the nose along a
    flight path that skims the atmosphere at a 65 km perigee, with the Earth below. This is the
    attitude the reentry's EARTH APPROACH begins in.
  - **42 s**: hand-over to the reentry.
- **Every shot keeps the CSM travelling screen-left** (the reentry's own direction), with the
  camera on the sunlit side (tested). The HUD clock runs from T+139:47 through TEI at T+140:00 to
  entry interface at T+193 h.
- **MissionScene:**
  - the Director reads the return clock and draws only the planet the shot is about, at its true
    size;
  - VehicleLayer turns the CSM about its centre of mass, rolls it about its axis, moves it along
    the burn and passes the SPS level to SpacecraftStack;
  - SpacecraftStack gains a roll couple from the side thrusters;
  - the old broadside close shot and the dead wide-shot code are removed.
- **Mission.jsx:** the RETURN state runs on `returnRealRef`, with captions per step, Mission
  Control and sound cues (the SPS heard through the structure), `window.__lvReturnSeek` for
  tooling, and SKIP CINEMATIC (`skip-return`).
- **Reentry (unchanged physics).** The separated SM backs away along its own axis behind the
  capsule, drifting a little down and away from the camera. It leaves the frame and keeps
  drifting into ENTRY; it is never popped. The CM starts its turn to heat-shield-first 2.2 s
  after separation (`ATTITUDE_TURN`), when the SM is 1.3 capsule diameters clear. The APPROACH
  and PREP cameras moved to the sunlit front side, so the CSM flies screen-left as in the return
  shots.
- **Voice:** four new lines in EN/PT, rendered offline with the project's Kokoro pipeline:
  `return.goTei`, `return.teiIgnition`, `return.teiCutoff`, `return.coast`. "TEI" is respelled
  for the synthesiser.
- **Lineage:** the `return` step became `tei` (burn `sps`), `transearthCoast` and `earthApproach`.
  The SM still leaves in the reentry shot.
- **Verifier:** markers for the TEI burn, the PTC coast, the entry attitude and `skip-return`; the
  old shot's text must be gone. Markers containing "·" never matched the minified bundle (it
  escapes the dot as `\xb7`), so the new markers avoid it.

**Results in the browser** (production build; headless Chromium, not a phone). One CADET
mission at Tranquility, flown by the input-only harness: landing → ascent → docking (hard dock,
no contact) → return → reentry → splashdown. MISSION COMPLETE after 328 s, no page errors.
- The return passed through every step in order: teiPrep → teiTurn → teiBurn → teiCutoff →
  coast → approach → entryAttitude.
- The HUD read T+139:48 → T+140:00:01 at ignition → T+192:53. The SPS level was 1 only between
  12.1 s and 21 s and 0 in every later frame.
- The reentry took over at the end of the return, and the capsule entered heat shield first.


## 53. Phase 2: clouds, open sea, parachutes and splashdown (presentation only)

**Audit (why it looked artificial).**
- **Scale.** The capsule was drawn at 3.9 m per unit, but the low world (sea and clouds) at 25 m
  per unit. Next to its sea and clouds the capsule was 6.4× too big, and the waves, clouds and
  parachutes could never read at their true size.
- **Clouds.** 40 flat ellipses made from one radial-gradient texture, turned to face the camera,
  with no lighting, in one layer at 2.6 km.
- **Sea.** One flat 100 km plane with a three-sine colour shimmer: no wave geometry, normals,
  reflection or sun glint, and its edge was visible from altitude. During the parachute descent
  the camera looked up, so the sea first appeared at splashdown.
- **Splashdown.** A white ring and a foam disc. The capsule sat on the plane, the parachutes
  vanished, and MISSION COMPLETE remounted a frozen scene with a camera reset.

**What changed** (`data/descentScene.js` is pure and tested; the drawing is in
`components/scenes/descent/`). The reentry physics, controls, timings and success rules are
untouched: the descent only reads the simulation's state.
- **One scale** (1 unit = 3.9 m). The sea lies at −h/3.9 below the capsule, so the heat shield
  meets the waves exactly when the simulation's altitude reaches zero.
- **Ocean.js:**
  - a polar grid that follows the camera, from 1 unit to 450 km, curving with the Earth; its rim
    lies beyond the horizon, lost in the haze;
  - four Gerstner waves of a recovery sea state (Hs ≈ 1.2 m, swell 96 m), displaced near the
    camera; the floating capsule rides the same sum;
  - two scales of procedural detail normals, faded with distance;
  - Fresnel sky reflection, and a sun glint that widens into a glitter path far away;
  - deep-navy water;
  - the cumulus shadows, baked once into a 512² map;
  - beyond 18 km, the NASA Blue Marble cloud cover from the map the Earth already uses;
  - haze into the sky's own horizon colour;
  - the splash's ripple ring and broken foam.
- **CloudField.jsx:**
  - 52 cumulus formations, a little over 1,000 puffs, in one instanced draw, sorted back to front;
  - bases 650–950 m, tops 1.2–2.6 km;
  - each puff is shaded per pixel as a sphere of vapour lit by the scene's Sun in world space:
    lit tops, darker bases, flat condensation-level bases, a noise-broken edge;
  - its alpha reaches zero inside the quad, so no straight edges show;
  - haze with distance, and fades near the camera and at the field's rim, so nothing pops or
    fills the screen;
  - two formations are placed in shot so the capsule descends between them; its own path stays
    clear (tested).
- **Chutes.jsx:**
  - the drogues (5 m) and three ringsail mains (25.4 m, 32 orange and white gores, a dark band,
    a vent) on 41 m suspension lines converging on the riser above the apex;
  - inflation comes from the simulation's deployment times; the canopies breathe and sway;
  - at splashdown the mains are released, come down, collapse and lie wet on the sea, downwind.
- **Splash.jsx:**
  - starts only when the simulation reports the splashdown, at the heat shield's lowest point;
  - droplets thrown out ballistically under real gravity, and a ragged spray crown rising out of
    the water;
  - the ripple ring and the foam are on the sea.
- **Flotation:**
  - the capsule plunges 0.9 m, bobs and settles;
  - it floats apex up, its waterline 1.1 m above the heat shield's lowest point;
  - it follows the slope of the drawn waves.
- **Sky:** the dome gives the sea and the clouds their colours (one atmosphere) and has a soft
  glow around the Sun.
- **Cameras:**
  - under the parachutes, the camera keeps the canopies, the capsule, the clouds and the sea in
    shot, and stays above the waves;
  - the drogue framing hands over to the mains framing by a slow drift;
  - the recovery shot draws back slowly, and the MISSION COMPLETE scene continues it with no
    reset.
- **ReentryGame:** SPLASHDOWN CONFIRMED appears 0.6 s after contact and CREW SAFE at 2.4 s, only
  in the SPLASHED state. SPLASHED lasts 6.5 s (was 4 s) before MISSION COMPLETE. Houston's
  splashdown call still waits for that state.
- **Mission:** LUNAVIA — MISSION COMPLETE, over a lighter overlay that leaves the floating capsule
  visible.
- **AdaptiveResolution** (as in the other scenes) on the reentry canvas.
- **Tooling:** `window.__lvReentryView` (read-only): the camera, the sea level, the splash and the
  draw calls.

**Measured** (headless Chromium with SwiftShader, CPU rendering at 852 × 393, not an iPhone GPU):

| | Before | After |
|---|---|---|
| Draw calls (max) | 33 | 17 |
| Triangles (max) | 7.4k | 36k |
| JS heap | 13.6 MB | 14.5 MB |
| Median frame time, SwiftShader | 16.7 ms | 50 ms |

The frame-time increase is per-pixel shading on a CPU rasterizer: the sea shader covers half the
screen, and cloud puffs overlap. On a GPU this workload (17 draws, 36k triangles, about 6 texture
reads per sea pixel) is light, and AdaptiveResolution lowers the pixel ratio if a device cannot
hold 45 fps. There is no network use: the textures are procedural or the bundled NASA map.

## 54. Critical visual correction: cloud descent and ocean splashdown

**Why.** The iPhone review (IMG_6102 under the main parachutes at 1.8 km, IMG_6103 at
splashdown) still showed flat speckled cloud discs, a pale ring and disc round the floating
capsule, a tiny capsule in the recovery shot, the entry guidance (FPA, bank, roll, corridor) on
screen under the parachutes, and the splashdown caption over the middle of the picture.

**Clouds** (`descent/CloudField.jsx`, `data/descentScene.js cloudField`).
- Every puff is a volume: an ellipsoid of vapour whose bound (a low-poly icosahedron drawn by its
  back faces) only marks the pixels to trace. Each pixel traces its own ray through the ellipsoid
  analytically: entry and exit, clipped at the cloud's flat base, and the vapour crossed (the
  integral of a density highest at the centre) gives the opacity. A world-space noise erodes the
  edges into billows; lighting blends the puff's roundness with the whole cloud's, with folds,
  a darker lower cloud, grey flat bases and haze. No sprites, no camera-facing cards. Works with
  the camera beside or inside a puff.
- Cumulus are built as cumulus: base puffs cut flat at one condensation level (820 m ± 40 m for
  the whole field), two or three overlapping columns with broad rounded tops, and cauliflower
  turrets sunk into the upper puffs. About 800 puffs, one instanced draw.
- The capsule descends between placed formations (two behind it, two near cumulus either side of
  the main-chute shot); its column and the camera's column stay clear of cloud (tested).
- Drawn at 0.42× resolution into their own buffer, then composited over the sky and the sea and
  under the capsule and its parachutes (which the placement keeps in front of every cloud). The
  clouds carry their own ACES and sRGB encoding so the composite matches the frame.

**Continuous descent** (`chuteCamera`, `timeScaleFor`; the trajectory is unchanged).
- Drogues: an eased move from the entry side view up and back, looking down past the capsule
  at the cumulus below.
- Mains: over their 8 s inflation, round to the main-chute shot (canopies above, the cloud towers
  it falls between, the sea below).
- Shot A from 1.3 km: wider and a little below, the whole parachute system in frame.
- Last 400 m: round the column and in, coming down with the capsule (never faster than it) to
  meet the water close by (shot B).
- Pace under the mains (presentation only, fixed-step physics): 32× to the cloud tops, 20×
  between the clouds, easing to 6× at 150 m and 3× at the water (about 24 s on screen from main
  deployment, was about 12).

**Splashdown** (`Ocean.jsx`, `Splash.jsx`, `recoveryCamera`).
- No ring, no disc, no crown sheet. Spray: 520 streaks thrown out round the rim in ragged radial
  jets (the Apollo impact photograph), falling back under gravity, and a short mist.
- In the water itself: the surface pushed down and rebounding in a low ring, broken ripples that
  run out and die, white churn round the impact for a few seconds, then a ragged lace of foam
  hugging the hull and a lapping waterline.
- Released canopies deflate as they fall downwind, drape on the very swell that is drawn, and
  sink.
- Shot B held through the splash, then round and in to shot C, the hero shot (about 20 m, 2 m
  above the water, the capsule's lit face), circling slowly; MISSION COMPLETE runs on from it
  under the same clouds.

**Ocean.**
- The four swell waves plus four short wind waves (9 m to 2 m) and three detail scales, each
  kept only where the pixel resolves it (no moiré).
- Gust patches of rougher and smoother water, deeper blue water, sparse whitecaps on the highest
  crests, and anisotropic detail at grazing angles.

**Parachutes.**
- Canopy shader: the Sun on the outside and through the translucent fabric from below, ringsail
  slots, seams, sky light in the shadows, muted Apollo orange.
- 28 suspension lines per main.

**HUD** (`data/descentHud.js`, tested). Under the parachutes (no lift, so bank and roll do
nothing) the lift-vector dial, roll and trim buttons, corridor gauge and prediction go away.
- Left panel: altitude, descent rate, chute state (inflation %), time to splashdown, capsule
  condition, heat shield used.
- Right panel: SPLASHDOWN PREP in Apollo's order: drogues, mains 3/3, VHF recovery beacon, RCS
  propellant dump, main release armed, brace.
- PAUSE and ABORT stay. The EI clock keeps the final time after splashdown.

**Captions.** `setSubtitlePlacement("corner")` under the parachutes, over the splashdown and
MISSION COMPLETE: the same caption, type, languages and timing, in the upper-left corner under the
phase banner on a lighter backing.

**Measured** (headless Chromium with SwiftShader, CPU rendering at 852 × 393, the same descent from
6 km to 8 s after splashdown, both builds measured in the same session; not an iPhone GPU):

| | 53bffc0 | 9364896 |
|---|---|---|
| Mean frame time | 61 ms | 71–75 ms |
| Median frame time | 66.6 ms | 66.7 ms |
| 95th percentile | 83 ms | 100 ms |
| Draw calls (max) | 17 | 15–16 |
| Triangles (max) | 36k | 74k |
| JS heap (max) | 24.8 MB | 22–24.8 MB |

- **Where the time goes.** With neither clouds nor sea the scene runs at 16.7 ms. The sea adds
  about 33 ms. The clouds cost about 50 ms at full resolution (each puff traced per pixel,
  overlapping), and about 17 ms in their reduced-resolution buffer (0.42 × 0.42, 18% of the pixels).
- **What didn't help.** A depth pre-pass for the opaque cloud cores made it slower in software
  (shaders that can discard don't benefit from early depth rejection), so it was dropped.
- **Memory.** The cloud buffer adds one RGBA8 render target, about 2 MB at an iPhone's resolution.
- **Animation.** A recorded descent from 8 km to 16 s after splashdown, analysed frame by frame:
  no camera jumps. The fastest camera move is 7.9 units/s, the swing while the mains inflate; the
  drogue hand-over, which started at 15 units/s, is now eased.
- **Regression.** A full mission on the packaged build, docking to splashdown, ran with no page
  errors, and SPLASHDOWN CONFIRMED came 0.8 s after contact.

## 55. A faster descent, wind ripples, released canopies that go under as one sheet

**Why.** §54 left the descent about 15–20% slower than the release before it (software
rendering), the released canopies breaking up into separate islands as they sank, the distant
clouds lumpy, and the near water mottled.

**Where the time went (measured, not guessed).** A held frame (the simulation paused at one
altitude) rendered 30 times back to back, each forced to finish (`gl.finish` by a 1-pixel read),
gives the render's own cost without the 16.7 ms steps of the display. With parts hidden or their
shaders replaced at runtime, in one page:
- the sea costs most of the frame; most of that, in software rendering, is a fixed cost per sea
  pixel that any non-constant shader pays (interpolation), not the waves. At 5 km the new descent
  camera looks down on the clouds, so the sea fills about 75% of the frame (30% before): most of
  the remaining difference there.
- the sea's own shading: the swell and short waves (kept), the three detail lookups, the hull foam,
  and, from altitude, the cloud shadows plus the NASA cloud cover read by every distant pixel.
- the clouds: per pixel at 700 m (where they fill the frame), spread over all puffs at the
  floating shot.

**What changed (presentation only).**
- Sea: each swell and wind wave is computed only where `keep()` is not 0 (the pixel covers less
  than half its length): the same picture, none of the short waves from altitude. The NASA cloud
  cover beyond the field is read per vertex (`vCover`, `textureLod`), not by every distant pixel;
  the near shadow map only inside the field. The splash's ripples and churn end at 8 s (faded out
  from 5 s). Powers by multiplication.
- Wind ripples: the three detail scales are sampled in the wind's frame, stretched 2.2x across the
  wind, and their slope turned back into the world with the same stretch, so the near water tilts
  along the wind (streaks across it) instead of mottling.
- Clouds: the fine noise only where a pixel can hold it (`fineK`, from the buffer's pixel size
  `uPix`); far puffs (a few pixels wide) shaded as one mass (`farK`: less edge erosion, the
  cloud-scale normal, no fold ring); an indexed 20-face bound (scale 1.2585, 1 / the inradius:
  tested); the clouds' buffer drawn by `CloudPass`, mounted after the camera rig, before the main
  pass (on a phone's tile-based GPU a render-target switch in the middle of the frame writes the
  whole multisampled frame out and reads it back). Far clouds (beyond 9 km) are no taller than
  they are wide, their turrets on the dome's shoulders, not its crown.
- Released canopies: they lie down on the sea as they reach it (`flat` from 3.45 s, not in the
  air), bunched (45% of the spread), and go under as one sheet: the folds settle, deep water over
  it, fading out (`sink` 0..1 from 4.75 s, gone by 10.75 s). The sea never rises through the
  fabric, so no islands and no pale patch.

**What didn't help (software rendering).** Collapsing the sea grid's inner rings (~2.5 ms),
lower cloud resolution at the floating shot (no change: the cost there is not per pixel), drawing
the cloud buffer before the main pass (no change in software; kept for the phone), anisotropic
filtering 1x instead of 2x (~5 ms at the floating shot, not taken: the grazing detail blurs).

**Measured** (headless Chromium, SwiftShader CPU rendering at 852 × 393, both builds in the same
session; not an iPhone GPU):

| | 53bffc0 (before §54) | a0b5ec2 |
|---|---|---|
| Whole descent (6 km to 8 s after splashdown), mean | 57–59 ms | 65 ms |
| Median | 50 ms | 67 ms |
| 95th percentile | 83 ms | 100 ms |
| 6–3 km (drogues) | 46–47 ms | 65–66 ms |
| 3–1 km (mains, between the clouds) | 50–51 ms | 53–56 ms |
| Last kilometre | 71–76 ms | 63–65 ms |
| Floating (to 8 s) | 68–70 ms | 83–87 ms |
| Held frames, 160 m / 700 m / 1.8 km / 5 km / 9 s afloat | 60 / 73 / 55 / 44 / 67 ms | 58 / 67 / 51 / 60 / 76 ms |
| Held frames, average | 59.8 ms | 62.3 ms |

- Measured the same way earlier the same day, §54's build (9364896) was about 25% over 53bffc0 on
  the whole descent; this release is 12% over it (4% on the held frames), and faster than it from
  1.8 km down to the water.
- The two slower shots: at 5 km the camera looks down at the clouds, so the sea fills most of the
  frame; afloat, the volumetric clouds overhead and the near water's detail cost more than the old
  flat puffs and plain sea.
- The first version of the canopies' fade switched their material from opaque to transparent as
  they began to sink, which compiled a new shader program (three's OPAQUE define): a 180–250 ms
  frame 5 s after splashdown. They are now blended from the start (tested); in the final run no
  frame after the splash's first second was over 170 ms.
- The measuring probe read the scene's view state each second; with the renderer attached to it
  (for the held-frame renders) it serialised the whole scene and stalled the page for ~400 ms.
  The probe now reads only the two numbers it needs; the table is from runs without it.

- Against §54's build (9364896), the same held frames in one session: 5 km 72 → 60 ms, 1.8 km
  63 → 51 ms, 5 s afloat 94 → 82 ms, 9 s afloat 85 → 81 ms (13% faster on average).

**Regression.** A full mission on the packaged build (BUILD a0b5ec2, Sea of Tranquility, CADET):
docking on the first attempt, the return and reentry to the splashdown (8.5 m/s), MISSION
COMPLETE and the debrief (894/1000, GOLD), no page errors. 546 unit tests; `ios:verify` 126 checks.

The reentry scene keeps `AdaptiveResolution`: on a device that cannot hold about 45 fps the pixel
ratio steps down (to no lower than 1.25) rather than the frame rate dropping.
