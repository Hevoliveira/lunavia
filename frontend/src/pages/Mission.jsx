import { useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { Play, Pause, RotateCcw, FastForward } from "lucide-react";
import MissionScene from "@/components/MissionScene";
import MissionHUD from "@/components/MissionHUD";
import PhaseTimeline from "@/components/PhaseTimeline";
import BriefingPanel from "@/components/BriefingPanel";
import {
  EARTH_RADIUS_KM,
  MOON_RADIUS_KM,
  trajectoryPosition,
} from "@/data/missionPhases";
import { toast } from "sonner";

const BACKEND_URL = process.env.REACT_APP_BACKEND_URL;
const API = `${BACKEND_URL}/api`;

const MAX_TIME = 702000; // reentry
const SPEED_STEPS = [1, 60, 600, 3600, 14400]; // realtime, ×60, ×10min, ×1h, ×4h per sec

export default function Mission() {
  const [phases, setPhases] = useState([]);
  const [missionTime, setMissionTime] = useState(-600);
  const [playing, setPlaying] = useState(true);
  const [speedIdx, setSpeedIdx] = useState(3);
  const [error, setError] = useState(null);
  const rafRef = useRef(null);
  const lastTsRef = useRef(0);

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

  // Animation loop
  useEffect(() => {
    const tick = (ts) => {
      if (!lastTsRef.current) lastTsRef.current = ts;
      const dt = (ts - lastTsRef.current) / 1000;
      lastTsRef.current = ts;
      if (playing) {
        setMissionTime((t) => {
          const next = t + dt * SPEED_STEPS[speedIdx];
          if (next >= MAX_TIME) {
            setPlaying(false);
            return MAX_TIME;
          }
          return next;
        });
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, [playing, speedIdx]);

  const pos = trajectoryPosition(missionTime);
  const distFromEarth = Math.sqrt(pos.x ** 2 + pos.z ** 2);
  const distFromMoon = Math.sqrt(
    (pos.x - pos.moonX) ** 2 + (pos.z - pos.moonZ) ** 2
  );
  const altitude = Math.max(0, distFromEarth - EARTH_RADIUS_KM);
  // Naive velocity: use derivative in km per second at scaled step
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
  };

  return (
    <main
      className="relative w-full h-screen overflow-hidden bg-[#050505]"
      data-testid="mission-page"
    >
      {/* Fullscreen 3D scene */}
      <MissionScene missionTime={missionTime} />

      {/* HUD overlays */}
      {activePhase && (
        <MissionHUD
          missionTime={missionTime}
          phase={activePhase}
          spacecraft={spacecraft}
        />
      )}

      {/* Left side panel — timeline */}
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

      {/* Right side panel — briefing */}
      <aside
        className="absolute top-36 right-4 md:right-8 w-[360px]"
        data-testid="mission-right-panel"
      >
        <BriefingPanel phase={activePhase} />
      </aside>

      {/* Playback controls (center-bottom above telemetry) */}
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

        <button
          onClick={() =>
            setSpeedIdx((i) => (i + 1) % SPEED_STEPS.length)
          }
          data-testid="ctrl-speed"
          className="flex items-center gap-2 px-3 py-1.5 text-white hover:text-[#FF3B00] transition-colors duration-200"
        >
          <FastForward size={14} />
          <span className="font-mono text-[10px] tracking-widest tabular">
            ×{SPEED_STEPS[speedIdx].toLocaleString()}
          </span>
        </button>

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

        <input
          type="range"
          min={-600}
          max={MAX_TIME}
          value={missionTime}
          onChange={(e) => setMissionTime(Number(e.target.value))}
          className="lv-slider w-[220px]"
          data-testid="ctrl-scrub"
        />
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
