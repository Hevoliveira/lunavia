import { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { Play, Pause, RotateCcw, FastForward, Film, Square } from "lucide-react";
import MissionScene from "@/components/MissionScene";
import MissionHUD from "@/components/MissionHUD";
import PhaseTimeline from "@/components/PhaseTimeline";
import BriefingPanel from "@/components/BriefingPanel";
import PhaseTransition from "@/components/PhaseTransition";
import {
  EARTH_RADIUS_KM,
  MOON_RADIUS_KM,
  trajectoryPosition,
} from "@/data/missionPhases";
import { toast } from "sonner";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const MAX_TIME = 702000; // reentry
const SPEED_STEPS = [1, 60, 600, 3600, 14400];
// Cinematic mode: dynamic speed per phase — slow during burns, fast during cruise.
const CINEMATIC_SPEED = (t) => {
  if (t < 690) return 60;          // countdown + launch: 1 min per sec
  if (t < 9840) return 600;        // LEO parking: 10 min/s
  if (t < 10200) return 60;        // TLI burn: slow to 1 min/s
  if (t < 273360) return 14400;    // cruise: 4h/s
  if (t < 273800) return 60;       // LOI burn: 1 min/s
  if (t < 504000) return 3600;     // lunar orbit: 1h/s
  if (t < 504300) return 60;       // TEI burn: 1 min/s
  if (t < 700000) return 14400;    // return: 4h/s
  return 60;                        // reentry: 1 min/s
};

export default function Mission() {
  const [phases, setPhases] = useState([]);
  const [missionTime, setMissionTime] = useState(-600);
  const [playing, setPlaying] = useState(true);
  const [speedIdx, setSpeedIdx] = useState(3);
  const [cinematic, setCinematic] = useState(false);
  const [transitionPhase, setTransitionPhase] = useState(null);
  const [error, setError] = useState(null);
  const rafRef = useRef(null);
  const lastTsRef = useRef(0);
  const prevPhaseIdRef = useRef(null);

  useEffect(() => {
    (async () => {
      try {
        const r = await axios.get(`${API}/mission/phases`);
        setPhases(r.data);
      } catch (e) {
        setError("Não foi possível carregar as fases da missão.");
      }
    })();
  }, []);

  const activePhase = useMemo(() => {
    if (!phases.length) return null;
    let current = phases[0];
    for (const p of phases) {
      if (missionTime >= p.t_plus_seconds) current = p;
    }
    return current;
  }, [missionTime, phases]);

  // Detect phase change during cinematic to trigger transition overlay
  useEffect(() => {
    if (!activePhase) return;
    if (prevPhaseIdRef.current === null) {
      prevPhaseIdRef.current = activePhase.id;
      return;
    }
    if (prevPhaseIdRef.current !== activePhase.id) {
      prevPhaseIdRef.current = activePhase.id;
      if (cinematic) {
        setTransitionPhase(activePhase);
      }
    }
  }, [activePhase, cinematic]);

  // Animation loop
  useEffect(() => {
    const tick = (ts) => {
      if (!lastTsRef.current) lastTsRef.current = ts;
      const dt = (ts - lastTsRef.current) / 1000;
      lastTsRef.current = ts;
      if (playing) {
        setMissionTime((t) => {
          const speed = cinematic ? CINEMATIC_SPEED(t) : SPEED_STEPS[speedIdx];
          const next = t + dt * speed;
          if (next >= MAX_TIME) {
            setPlaying(false);
            if (cinematic) {
              toast.success("Splashdown. Missão completa.", {
                description: "T+195:00:00 · Pacífico",
                duration: 6000,
              });
              setCinematic(false);
            }
            return MAX_TIME;
          }
          return next;
        });
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, speedIdx, cinematic]);

  const pos = trajectoryPosition(missionTime);
  const distFromEarth = Math.sqrt(pos.x ** 2 + pos.z ** 2);
  const distFromMoon = Math.sqrt(
    (pos.x - pos.moonX) ** 2 + (pos.z - pos.moonZ) ** 2
  );
  const altitude = Math.max(0, distFromEarth - EARTH_RADIUS_KM);
  const posNext = trajectoryPosition(missionTime + 1);
  const velocity = Math.sqrt(
    (posNext.x - pos.x) ** 2 + (posNext.z - pos.z) ** 2
  );

  const spacecraft = {
    altitude,
    velocity,
    moonDistance: Math.max(0, distFromMoon - MOON_RADIUS_KM),
  };

  const jumpTo = (phase) => {
    setMissionTime(phase.t_plus_seconds);
    toast.message(`JUMP → ${phase.name}`, {
      description: phase.code,
      duration: 2000,
    });
  };

  const reset = () => {
    setMissionTime(-600);
    setPlaying(true);
    setSpeedIdx(3);
    setCinematic(false);
    prevPhaseIdRef.current = null;
  };

  const startCinematic = () => {
    setCinematic(true);
    setMissionTime(-600);
    setPlaying(true);
    prevPhaseIdRef.current = null;
    if (phases.length) setTransitionPhase(phases[0]);
    toast.message("CINEMATIC MODE — LV-001", {
      description: "A viagem completa. Terra → Lua → Terra.",
      duration: 4000,
    });
  };

  const stopCinematic = () => {
    setCinematic(false);
    setTransitionPhase(null);
  };

  return (
    <main
      className="relative w-full h-screen overflow-hidden bg-[#050505]"
      data-testid="mission-page"
    >
      {/* Fullscreen 3D scene */}
      <MissionScene missionTime={missionTime} cinematic={cinematic} />

      {/* Phase transition overlay */}
      <PhaseTransition
        phase={transitionPhase}
        onDone={() => setTransitionPhase(null)}
      />

      {/* HUD overlays */}
      {activePhase && (
        <MissionHUD
          missionTime={missionTime}
          phase={activePhase}
          spacecraft={spacecraft}
        />
      )}

      {/* Left side panel — timeline (hidden in cinematic to keep frame clean) */}
      {!cinematic && (
        <aside
          className="absolute top-36 left-4 md:left-8 w-[320px] max-h-[62vh] overflow-y-auto"
          data-testid="mission-left-panel"
        >
          {phases.length > 0 && (
            <PhaseTimeline
              phases={phases}
              activePhaseId={activePhase?.id}
              onJump={jumpTo}
            />
          )}
        </aside>
      )}

      {/* Right side panel — briefing (hidden in cinematic) */}
      {!cinematic && (
        <aside
          className="absolute top-36 right-4 md:right-8 w-[360px]"
          data-testid="mission-right-panel"
        >
          <BriefingPanel phase={activePhase} />
        </aside>
      )}

      {/* Cinematic corner label */}
      {cinematic && (
        <div
          data-testid="cinematic-badge"
          className="absolute top-20 left-1/2 -translate-x-1/2 hud-panel px-4 py-2 relative corners"
        >
          <div className="font-mono text-[10px] tracking-[0.4em] text-[#FF3B00] blink">
            ● CINEMATIC MODE · AUTO-PILOT ENGAGED
          </div>
        </div>
      )}

      {/* Playback controls */}
      <div
        className="absolute bottom-32 left-1/2 -translate-x-1/2 hud-panel px-5 py-3 flex items-center gap-4 corners"
        data-testid="mission-controls"
      >
        <button
          onClick={() => setPlaying((p) => !p)}
          data-testid="ctrl-play"
          className="flex items-center gap-2 px-3 py-1.5 text-white hover:text-[#FF3B00] transition-colors duration-200"
        >
          {playing ? <Pause size={14} /> : <Play size={14} />}
          <span className="font-mono text-[10px] tracking-widest">
            {playing ? "PAUSE" : "RESUME"}
          </span>
        </button>

        <div className="w-px h-6 bg-white/10" />

        {!cinematic ? (
          <button
            onClick={() => setSpeedIdx((i) => (i + 1) % SPEED_STEPS.length)}
            data-testid="ctrl-speed"
            className="flex items-center gap-2 px-3 py-1.5 text-white hover:text-[#FF3B00] transition-colors duration-200"
          >
            <FastForward size={14} />
            <span className="font-mono text-[10px] tracking-widest tabular">
              ×{SPEED_STEPS[speedIdx].toLocaleString()}
            </span>
          </button>
        ) : (
          <div className="flex items-center gap-2 px-3 py-1.5 text-zinc-400">
            <FastForward size={14} />
            <span className="font-mono text-[10px] tracking-widest tabular">
              AUTO ×{CINEMATIC_SPEED(missionTime).toLocaleString()}
            </span>
          </div>
        )}

        <div className="w-px h-6 bg-white/10" />

        <button
          onClick={reset}
          data-testid="ctrl-reset"
          className="flex items-center gap-2 px-3 py-1.5 text-white hover:text-[#FF3B00] transition-colors duration-200"
        >
          <RotateCcw size={14} />
          <span className="font-mono text-[10px] tracking-widest">RESET</span>
        </button>

        <div className="w-px h-6 bg-white/10" />

        {!cinematic ? (
          <button
            onClick={startCinematic}
            data-testid="ctrl-cinematic"
            className="flex items-center gap-2 px-3 py-1.5 text-[#FF3B00] hover:text-white transition-colors duration-200"
          >
            <Film size={14} />
            <span className="font-mono text-[10px] tracking-widest">
              PLAY MOVIE
            </span>
          </button>
        ) : (
          <button
            onClick={stopCinematic}
            data-testid="ctrl-cinematic-stop"
            className="flex items-center gap-2 px-3 py-1.5 text-[#FF3B00] hover:text-white transition-colors duration-200"
          >
            <Square size={14} />
            <span className="font-mono text-[10px] tracking-widest">
              EXIT MOVIE
            </span>
          </button>
        )}

        {!cinematic && (
          <>
            <div className="w-px h-6 bg-white/10" />
            <input
              type="range"
              min={-600}
              max={MAX_TIME}
              value={missionTime}
              onChange={(e) => setMissionTime(Number(e.target.value))}
              className="lv-slider w-[220px]"
              data-testid="ctrl-scrub"
            />
          </>
        )}
      </div>

      {error && (
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 hud-panel px-6 py-4 border-[#FF3B00]">
          <div className="font-mono text-[10px] text-[#FF3B00] tracking-widest">
            SYSTEM ERROR
          </div>
          <div className="text-sm mt-2">{error}</div>
        </div>
      )}
    </main>
  );
}
