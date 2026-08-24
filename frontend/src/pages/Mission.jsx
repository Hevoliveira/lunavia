import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { ArrowUpRight, RotateCcw } from "lucide-react";
import ControlRoomView from "@/components/scenes/ControlRoomView";
import AscentScene from "@/components/scenes/AscentScene";
import MissionScene from "@/components/MissionScene";
import DescentScene from "@/components/scenes/DescentScene";
import ReentryScene from "@/components/scenes/ReentryScene";

/**
 * Mission — cinematic state machine. Player sees mostly images, minimal text.
 * Two decision points: STAGE SEPARATION and LUNAR DESCENT.
 *
 * States:
 *   control      → sala de comando + countdown + LAUNCH button
 *   ascent       → foguete subindo, playing progress 0..1
 *   sep_prompt   → subida pausada, player must press SEPARATE
 *   sep_done     → estágio se separando (auto ~2.5s)
 *   space        → cruzeiro Terra→Lua (MissionScene wide shot, auto ~10s)
 *   orbit        → órbita lunar close-up (MissionScene close on Moon) with DESCEND prompt
 *   descent      → módulo descendo (auto ~8s)
 *   surface      → pouso concluído (auto ~4s)
 *   return       → retorno Moon→Earth (MissionScene wide, auto ~8s)
 *   reentry      → reentrada com plasma (auto ~9s)
 *   complete     → tela de missão completa
 */
const STATES = {
  CONTROL: "control",
  ASCENT: "ascent",
  SEP_PROMPT: "sep_prompt",
  SEP_DONE: "sep_done",
  SPACE: "space",
  ORBIT: "orbit",
  DESCENT: "descent",
  SURFACE: "surface",
  RETURN: "return",
  REENTRY: "reentry",
  COMPLETE: "complete",
};

// Human-readable event labels per state
const STATE_LABELS = {
  control: { code: "T-00:00:10", name: "MISSION CONTROL" },
  ascent: { code: "T+00:00:00", name: "ASCENT" },
  sep_prompt: { code: "T+00:02:30", name: "STAGE SEPARATION" },
  sep_done: { code: "T+00:02:32", name: "STAGE 1 DISCARDED" },
  space: { code: "T+03:00:00", name: "CISLUNAR CRUISE" },
  orbit: { code: "T+80:00:00", name: "LUNAR ORBIT" },
  descent: { code: "T+82:00:00", name: "POWERED DESCENT" },
  surface: { code: "T+82:12:00", name: "TRANQUILITY BASE" },
  return: { code: "T+140:00:00", name: "TRANS-EARTH INJECTION" },
  reentry: { code: "T+195:00:00", name: "REENTRY" },
  complete: { code: "T+195:15:00", name: "SPLASHDOWN · MISSION COMPLETE" },
};

export default function Mission() {
  const [state, setState] = useState(STATES.CONTROL);
  const [progress, setProgress] = useState(0);
  const [descentAlt, setDescentAlt] = useState(8);
  const [spaceTime, setSpaceTime] = useState(9840); // starts at TLI
  const [orbitTime, setOrbitTime] = useState(288000); // lunar orbit
  const [returnTime, setReturnTime] = useState(504000); // TEI
  const [reentryProg, setReentryProg] = useState(0);
  const rafRef = useRef(null);
  const lastTsRef = useRef(0);
  const stateRef = useRef(state);
  const orbitAngleRef = useRef(0);

  useEffect(() => {
    stateRef.current = state;
    setProgress(0);
    lastTsRef.current = 0;
  }, [state]);

  // Master animation loop
  useEffect(() => {
    const tick = (ts) => {
      if (!lastTsRef.current) lastTsRef.current = ts;
      const dt = (ts - lastTsRef.current) / 1000;
      lastTsRef.current = ts;
      const s = stateRef.current;

      if (s === STATES.ASCENT) {
        setProgress((p) => {
          const next = p + dt * 0.09; // ~11s to reach 1.0
          if (next >= 0.35) {
            setState(STATES.SEP_PROMPT);
            return 0.35;
          }
          return next;
        });
      } else if (s === STATES.SEP_DONE) {
        setProgress((p) => {
          const next = p + dt * 0.45;
          if (next >= 1) {
            setState(STATES.SPACE);
            return 1;
          }
          return next;
        });
      } else if (s === STATES.SPACE) {
        // Advance the cislunar cruise position over time
        setSpaceTime((t) => {
          const next = t + dt * 30000; // fast time
          if (next >= 270000) {
            setState(STATES.ORBIT);
            orbitAngleRef.current = 0;
            return 270000;
          }
          return next;
        });
      } else if (s === STATES.ORBIT) {
        // Orbit around the Moon; player decides when to descend
        setOrbitTime((t) => t + dt * 300);
        orbitAngleRef.current += dt * 0.6;
      } else if (s === STATES.DESCENT) {
        setDescentAlt((a) => {
          const next = a - dt * 1.2;
          if (next <= 0) {
            setState(STATES.SURFACE);
            return 0;
          }
          return next;
        });
      } else if (s === STATES.SURFACE) {
        setProgress((p) => {
          const next = p + dt * 0.25;
          if (next >= 1) {
            setState(STATES.RETURN);
            return 1;
          }
          return next;
        });
      } else if (s === STATES.RETURN) {
        setReturnTime((t) => {
          const next = t + dt * 25000;
          if (next >= 695000) {
            setState(STATES.REENTRY);
            return 695000;
          }
          return next;
        });
      } else if (s === STATES.REENTRY) {
        setReentryProg((p) => {
          const next = p + dt * 0.11;
          if (next >= 1) {
            setState(STATES.COMPLETE);
            return 1;
          }
          return next;
        });
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
  }, []);

  const handleLaunch = () => {
    setState(STATES.ASCENT);
    toast.message("LIFTOFF", {
      description: "Todas as âncoras liberadas. Empuxo nominal.",
      duration: 3000,
    });
  };

  const handleSeparate = () => {
    setState(STATES.SEP_DONE);
    toast.message("STAGE 1 SEP", {
      description: "Estágio 1 descartado. Ignição do segundo estágio.",
      duration: 3000,
    });
  };

  const handleDescend = () => {
    setState(STATES.DESCENT);
    setDescentAlt(8);
    toast.message("DESCENT — PDI", {
      description: "Powered Descent Initiation. Motor de pouso ligado.",
      duration: 3000,
    });
  };

  const resetMission = () => {
    setState(STATES.CONTROL);
    setProgress(0);
    setDescentAlt(8);
    setSpaceTime(9840);
    setOrbitTime(288000);
    setReturnTime(504000);
    setReentryProg(0);
    orbitAngleRef.current = 0;
  };

  // Compute whether the ship is over the "landing zone" — used to signal
  // the player when it's a good moment to press DESCEND. Purely visual —
  // player can press whenever.
  const overLandingZone =
    Math.sin(orbitAngleRef.current) > 0.7;

  const label = STATE_LABELS[state];

  return (
    <main
      className="relative w-full h-screen overflow-hidden bg-[#050505]"
      data-testid="mission-page"
    >
      {/* --- Scene layer --- */}
      {state === STATES.CONTROL && <ControlRoomView onLaunch={handleLaunch} />}

      {state === STATES.ASCENT && (
        <AscentScene progress={progress} separated={false} thrust={1} />
      )}
      {state === STATES.SEP_PROMPT && (
        <AscentScene progress={0.35} separated={false} thrust={0.15} />
      )}
      {state === STATES.SEP_DONE && (
        <AscentScene
          progress={0.35 + progress * 0.4}
          separated={true}
          thrust={1}
        />
      )}

      {state === STATES.SPACE && (
        <MissionScene missionTime={spaceTime} cinematic={true} />
      )}

      {state === STATES.ORBIT && (
        <MissionScene missionTime={orbitTime} cinematic={true} />
      )}

      {state === STATES.DESCENT && (
        <DescentScene altitude={descentAlt} thrust={1} dust={descentAlt < 1.5} />
      )}
      {state === STATES.SURFACE && (
        <DescentScene altitude={0} thrust={0} dust={false} />
      )}

      {state === STATES.RETURN && (
        <MissionScene missionTime={returnTime} cinematic={true} />
      )}

      {state === STATES.REENTRY && <ReentryScene progress={reentryProg} />}

      {state === STATES.COMPLETE && <ReentryScene progress={1} />}

      {/* --- Minimal HUD overlay (hidden in control room) --- */}
      {state !== STATES.CONTROL && (
        <div
          data-testid="mission-hud-min"
          className="absolute top-20 left-1/2 -translate-x-1/2 hud-panel px-5 py-2 flex items-center gap-4"
        >
          <span className="font-mono text-[10px] tracking-[0.35em] text-zinc-500">
            {label.code}
          </span>
          <span className="w-px h-4 bg-white/15" />
          <span className="font-mono text-[11px] tracking-[0.3em] text-white">
            {label.name}
          </span>
        </div>
      )}

      {/* --- Prompts / interaction gates --- */}

      {state === STATES.SEP_PROMPT && (
        <div
          data-testid="prompt-separate"
          className="absolute inset-0 pointer-events-none flex items-end justify-center pb-32"
        >
          <div className="pointer-events-auto text-center scan-in">
            <div className="font-mono text-[10px] tracking-[0.4em] text-[#FF3B00] blink mb-3">
              ● MISSION EVENT · CREW ACTION REQUIRED
            </div>
            <div className="font-display font-black text-white text-4xl md:text-5xl mb-2">
              STAGE SEPARATION
            </div>
            <div className="font-mono text-[11px] tracking-widest text-zinc-400 mb-6">
              STAGE 1 EXHAUSTED · PRESS TO JETTISON
            </div>
            <button
              onClick={handleSeparate}
              data-testid="btn-separate"
              className="group inline-flex items-center gap-3 px-8 py-3 border-2 border-[#FF3B00] text-white bg-[#FF3B00]/10 hover:bg-[#FF3B00] transition-colors duration-200 font-mono tracking-[0.3em] text-sm"
            >
              <span className="w-2 h-2 rounded-full bg-[#FF3B00] blink" />
              SEPARATE
              <span className="w-2 h-2 rounded-full bg-[#FF3B00] blink" />
            </button>
          </div>
        </div>
      )}

      {state === STATES.ORBIT && (
        <div
          data-testid="prompt-descend"
          className="absolute inset-0 pointer-events-none flex items-end justify-center pb-32"
        >
          <div className="pointer-events-auto text-center">
            <div
              className={`font-mono text-[10px] tracking-[0.4em] mb-3 ${
                overLandingZone ? "text-[#FF3B00] blink" : "text-zinc-500"
              }`}
            >
              ● {overLandingZone ? "OVER LANDING ZONE — GO FOR PDI" : "STANDBY · WAITING FOR LANDING ZONE"}
            </div>
            <div className="font-display font-black text-white text-4xl md:text-5xl mb-2">
              LUNAR DESCENT
            </div>
            <div className="font-mono text-[11px] tracking-widest text-zinc-400 mb-6">
              MARE TRANQUILLITATIS · WAIT UNTIL "GO FOR PDI"
            </div>
            <button
              onClick={handleDescend}
              data-testid="btn-descend"
              className={`inline-flex items-center gap-3 px-8 py-3 border-2 font-mono tracking-[0.3em] text-sm transition-colors duration-200 ${
                overLandingZone
                  ? "border-[#FF3B00] text-white bg-[#FF3B00]/10 hover:bg-[#FF3B00]"
                  : "border-zinc-600 text-zinc-500 bg-transparent"
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${overLandingZone ? "bg-[#FF3B00] blink" : "bg-zinc-600"}`} />
              INITIATE DESCENT
              <span className={`w-2 h-2 rounded-full ${overLandingZone ? "bg-[#FF3B00] blink" : "bg-zinc-600"}`} />
            </button>
          </div>
        </div>
      )}

      {state === STATES.SURFACE && (
        <div
          data-testid="surface-overlay"
          className="absolute inset-0 pointer-events-none flex items-center justify-center"
        >
          <div className="text-center scan-in bg-black/30 backdrop-blur-sm px-10 py-6">
            <div className="font-mono text-[10px] tracking-[0.4em] text-[#FF3B00] blink mb-3">
              ● CONTACT LIGHT
            </div>
            <div className="font-display font-black text-white text-5xl md:text-6xl">
              THE EAGLE HAS LANDED
            </div>
            <div className="font-mono text-[11px] tracking-widest text-zinc-400 mt-3">
              MARE TRANQUILLITATIS · 0°41′15″N 23°26′00″E
            </div>
          </div>
        </div>
      )}

      {state === STATES.COMPLETE && (
        <div
          data-testid="complete-overlay"
          className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-md"
        >
          <div className="text-center max-w-2xl px-8 scan-in">
            <div className="font-mono text-[10px] tracking-[0.4em] text-[#FF3B00] blink mb-4">
              ● SPLASHDOWN · CREW SAFE
            </div>
            <h2 className="font-display font-black text-white text-6xl md:text-7xl mb-6">
              MISSION COMPLETE
            </h2>
            <p className="font-mono text-[11px] tracking-widest text-zinc-400 mb-10">
              LV-001 · 195 HOURS · 384,400 KM · TRANQUILITY BASE · PACIFIC SPLASHDOWN
            </p>
            <div className="flex gap-4 justify-center">
              <button
                onClick={resetMission}
                data-testid="btn-restart"
                className="btn-hud btn-hud-primary"
              >
                <RotateCcw size={14} /> RELAUNCH
              </button>
              <Link to="/manifesto" className="btn-hud" data-testid="btn-manifesto">
                READ MANIFESTO <ArrowUpRight size={14} />
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* Quick restart button always visible (except in control) */}
      {state !== STATES.CONTROL && state !== STATES.COMPLETE && (
        <button
          onClick={resetMission}
          data-testid="btn-abort"
          className="absolute top-20 right-4 md:right-8 hud-panel px-3 py-2 flex items-center gap-2 text-zinc-400 hover:text-[#FF3B00] transition-colors duration-200 font-mono text-[10px] tracking-[0.3em]"
        >
          <RotateCcw size={12} /> ABORT
        </button>
      )}
    </main>
  );
}
