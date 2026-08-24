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

## Backlog (P1)
- Áudio: comms/beep/ambient loop no /mission (imersão).
- Delta-v real dinâmico com propelente e consumo em tempo real.
- Múltiplos "flight plans" (Apollo 8 free-return, Apollo 11 landing, Artemis-style).
- Compartilhamento: exportar screenshot do momento da chegada à Lua.
- Persistência de "sessions" e replay de trajetória gravada.

## Backlog (P2)
- Modelo 3D detalhado de nave (não cubo).
- Texturas fotorrealistas de Terra/Lua.
- Modo cockpit / IVA.
- Simulação de correções de curso (MCC) interativa.
