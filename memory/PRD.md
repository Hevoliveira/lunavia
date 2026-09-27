# LUNAVIA — PRD

## Vision (verbatim from user)
LUNAVIA — THE ROAD TO THE MOON. Simulação realista da viagem Terra → Espaço Cislunar → Lua com escala e fidelidade impossíveis em jogos que tentam cobrir o Sistema Solar inteiro. A viagem é o jogo.

## Fase 0 delivered — 2026-02
- **Landing marketing site** (/): hero R3F 3D com Terra + Lua + arco de trajetória; north-star manifesto; flight-plan das 9 fases; identity section; footer.
- **/mission**: simulador 3D full-screen com HUD estilo NASA — MET, telemetria (altitude/velocidade/moon-range/Δv/location), timeline lateral clicável das 9 fases, controles playback (play/pause, speed ×1..×14400, reset, scrub), painel de briefing lateral.
- **/manifesto**: visão / fantasia central / north star.
- **Backend FastAPI** com 6 endpoints (health, phases list, phase detail, streaming briefing, log create/list) + MongoDB.
- **Claude Sonnet 5** via emergentintegrations, streaming SSE em PT-BR (flight-director voice) para cada fase.
- **Trajetória Apollo-class**: LEO 185km, TLI Δv 3.14 km/s, cislunar 72h, LOI 0.91 km/s, órbita 100km, TEI 1.07 km/s, reentrada 10.9 km/s.

## Architecture
- Frontend: React 19 + React Router 7 + React Three Fiber (v9 rc) + Drei + Three.js 0.169 + Tailwind + shadcn/ui.
- Backend: FastAPI + Motor MongoDB + emergentintegrations (Claude Sonnet 5).
- Persistence: `mission_logs` collection for telemetry snapshots.
- `Mission.jsx` = master state machine (14 states). `DescentGame.jsx` = playable manual landing (60fps physics, 15Hz UI sync).

## Implemented since Fase 0 (see git history / test_reports 1-5)
- Cinematic overhaul: HD Earth/Moon textures, full scripted mission flow.
- Phase 1: playable manual lunar descent (physics, fuel, HUD, scoring 35Vy/15Vx/25Acc/15Tilt/10Fuel, 3 difficulties).
- Phase 2: PDI briefing card + dynamic descent warnings (validated iteration_5).
- **VISUAL FIDELITY PASS (2026-09-27, validated iteration_5, 9/9 PASS)**:
  - `RocketModel.jsx`: LV-001 multi-stage rebuild (5 engine bells, skirt, stringers, lattice interstage, CSM + escape tower), layered sea/vacuum plumes, gradual stage-1 drift + tumble + delayed S2 ignition.
  - `AscentScene.jsx`: launch complex (tower, umbilicals, masts, water tower), staged ignition (vapor → flash → instanced shader smoke → dust ring → liftoff), gradient sky dome, curved Earth, contrail, documentary cameras.
  - `MissionScene.jsx`: display-radius remap (craft no longer inside oversized Earth), cislunar camera language (departure chase / off-shoulder cruise / Earth→Moon pan / approach / orbit drift), sun (30,10,-20) for lit-Earth departure + crescent-Moon approach, burn-window engine glow, split trajectory legs, hemisphere fill.
  - `Mission.jsx`: dt cap 0.1s (anti-throttle), SEP_DONE ~4.5s pacing.

## Backlog (P1)
- Wire backend `mission_log` endpoint from frontend after completed descent.
- Real gameplay in one more phase (e.g., Lunar Orbit Insertion).
- Terrain heightfield with slope-based safe-zone checks (replace flat-plane hazard bands).

## Backlog (P2)
- Split `DescentGame.jsx` (~960 lines) into `<DescentScene>`, `<DescentHUD>`, `usePhysics()`.
- Lunar Ascent + Rendezvous gameplay phases.
- Mobile responsive layout (fixed `w-[300px]` HUD widths).

## Backlog (P3)
- Real 3D cockpit interior (replace 2D SVG overlay).
