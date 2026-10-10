import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { ArrowUpRight, RotateCcw } from "lucide-react";
import ControlRoomView from "@/components/scenes/ControlRoomView";
import LaunchCinematic from "@/components/scenes/LaunchCinematic";
import MissionScene from "@/components/MissionScene";
import DescentScene from "@/components/scenes/DescentScene";
import ReentryScene from "@/components/scenes/ReentryScene";
import DescentGame from "@/components/DescentGame";
import ReentryGame from "@/components/ReentryGame";
import DifficultySelect from "@/components/DifficultySelect";
import PdiBriefing from "@/components/PdiBriefing";
import MissionResult from "@/components/MissionResult";
import AbortModal from "@/components/AbortModal";
import useMissionAudio from "@/hooks/useMissionAudio";

/*
 * Outbound flight is automatic: LAUNCH plays the Earth departure (terminal
 * count → liftoff → ascent → MECO → staging → upper stage → parking orbit →
 * TLI) without any input, then the cislunar cruise runs to lunar orbit. The
 * first required input after LAUNCH is at the Moon (INITIATE DESCENT).
 */
const STATES = {
  CONTROL: "control",
  LAUNCH: "launch",
  SPACE: "space",
  ORBIT: "orbit",
  DIFFICULTY: "difficulty",
  BRIEFING: "briefing",        // Phase 2 - PDI readiness card, sim not yet live
  MANUAL_DESCENT: "manual_descent",
  RESULT: "result",
  DESCENT: "descent",       // cinematic auto-descent (skip path)
  SURFACE: "surface",
  RETURN: "return",
  REENTRY: "reentry",
  COMPLETE: "complete",
};

const STATE_LABELS = {
  control: { code: "T-00:00:10", name: "MISSION CONTROL" },
  launch: { code: "T-00:00:15", name: "LAUNCH" },
  space: { code: "T+03:00:00", name: "CISLUNAR CRUISE" },
  orbit: { code: "T+80:00:00", name: "LUNAR ORBIT" },
  difficulty: { code: "T+82:00:00", name: "DESCENT · SETUP" },
  briefing: { code: "T+82:00:00", name: "PDI · READINESS" },
  manual_descent: { code: "T+82:00:00", name: "POWERED DESCENT · MANUAL" },
  result: { code: "T+82:12:00", name: "MISSION RATING" },
  descent: { code: "T+82:00:00", name: "POWERED DESCENT" },
  surface: { code: "T+82:12:00", name: "TRANQUILITY BASE" },
  return: { code: "T+140:00:00", name: "TRANS-EARTH INJECTION" },
  reentry: { code: "T+195:00:00", name: "REENTRY" },
  complete: { code: "T+195:15:00", name: "SPLASHDOWN · MISSION COMPLETE" },
};

// Cruise picks up after the TLI burn shown in the launch cinematic.
const CRUISE_START = 12000;

const FLIGHT_STATES = new Set([
  STATES.LAUNCH,
  STATES.SPACE,
  STATES.ORBIT,
  STATES.MANUAL_DESCENT,
  STATES.DESCENT,
  STATES.SURFACE,
  STATES.RETURN,
  STATES.REENTRY,
]);

export default function Mission() {
  const [state, setState] = useState(STATES.CONTROL);
  const [progress, setProgress] = useState(0);
  const [descentAlt, setDescentAlt] = useState(8);
  const [spaceTime, setSpaceTime] = useState(CRUISE_START);
  const [orbitTime, setOrbitTime] = useState(288000);
  const [returnTime, setReturnTime] = useState(504000);
  const [difficulty, setDifficulty] = useState("ASTRONAUT");
  const [descentResult, setDescentResult] = useState(null);
  const [showAbort, setShowAbort] = useState(false);
  const rafRef = useRef(null);
  const lastTsRef = useRef(0);
  const stateRef = useRef(state);
  const orbitAngleRef = useRef(0);

  const audio = useMissionAudio();

  useEffect(() => {
    stateRef.current = state;
    setProgress(0);
    lastTsRef.current = 0;
  }, [state]);

  // Master animation loop
  useEffect(() => {
    const tick = (ts) => {
      if (!lastTsRef.current) lastTsRef.current = ts;
      // Cap dt so throttled rAF (background tab, headless) can't skip cinematics
      const dt = Math.min((ts - lastTsRef.current) / 1000, 0.1);
      lastTsRef.current = ts;
      const s = stateRef.current;

      if (s === STATES.SPACE) {
        setSpaceTime((t) => {
          const next = t + dt * 30000;
          if (next >= 270000) {
            setState(STATES.ORBIT);
            orbitAngleRef.current = 0;
            return 270000;
          }
          return next;
        });
      } else if (s === STATES.ORBIT) {
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
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLaunch = () => {
    audio.init();
    setState(STATES.LAUNCH);
  };

  // End of the Earth departure (or SKIP): straight into the cislunar cruise.
  // Skipping only shortens the film; the mission states are the same.
  const handleLaunchComplete = () => {
    setSpaceTime(CRUISE_START);
    setState(STATES.SPACE);
  };

  const handleSkipLaunch = () => {
    audio.roarStop(0.3);
    audio.ambienceStop(0.5);
    audio.padStart();
    handleLaunchComplete();
  };

  const handleDescend = () => {
    audio.stopRumble();
    setState(STATES.DIFFICULTY);
  };

  // Phase 2 - selecting a difficulty no longer drops the player straight into a
  // live descent. It opens the readiness card; the simulation starts only when
  // BEGIN PDI is pressed, so the comms call moves there too.
  const handleDifficulty = (key) => {
    setDifficulty(key);
    setState(STATES.BRIEFING);
  };

  const handleBeginPdi = () => {
    setState(STATES.MANUAL_DESCENT);
    audio.comms("Houston, beginning powered descent.", 400);
  };

  const handleSkipDifficulty = () => {
    setState(STATES.DESCENT);
    setDescentAlt(8);
    audio.startRumble(0.8);
  };

  const handleDescentSuccess = (result) => {
    setDescentResult(result);
    setState(STATES.RESULT);
  };

  const handleDescentCrash = (result) => {
    setDescentResult(result);
    setState(STATES.RESULT);
  };

  const handleRestartDescent = () => {
    setDescentResult(null);
    setState(STATES.DIFFICULTY);
  };

  const handleContinueFromResult = () => {
    // Only allow the mission to continue if the landing was successful.
    // A failed landing (crew lost) must NOT progress to TEI / reentry / splashdown.
    if (!descentResult || descentResult.crashed) return;
    setDescentResult(null);
    setState(STATES.RETURN);
  };

  const resetMission = () => {
    audio.stopRumble();
    audio.roarStop(0.3);
    audio.ambienceStop(0.5);
    audio.padStop(1);
    setState(STATES.CONTROL);
    setProgress(0);
    setDescentAlt(8);
    setSpaceTime(CRUISE_START);
    setOrbitTime(288000);
    setReturnTime(504000);
    setDescentResult(null);
    orbitAngleRef.current = 0;
  };

  const overLandingZone = Math.sin(orbitAngleRef.current) > 0.7;

  // Engine sound belongs to the launch cinematic; the space music fades out
  // as the crew reaches lunar orbit and takes control.
  useEffect(() => {
    if (state === STATES.SPACE || state === STATES.ORBIT) {
      audio.stopRumble();
    }
    if (state === STATES.ORBIT) audio.padStop(5);
    if (state === STATES.COMPLETE) {
      audio.stopRumble();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // Active flight (not menus, results or the control room): lets phones hide
  // the website navbar so the flight view and HUD get the full screen.
  useEffect(() => {
    document.documentElement.dataset.flight = FLIGHT_STATES.has(state) ? "1" : "";
  }, [state]);
  useEffect(() => () => {
    delete document.documentElement.dataset.flight;
  }, []);

  const label = STATE_LABELS[state] || { code: "", name: "" };

  return (
    <main
      className="relative w-full h-screen overflow-hidden bg-[#050505] game-surface"
      data-testid="mission-page"
    >
      {/* --- Scene layer --- */}
      {state === STATES.CONTROL && <ControlRoomView onLaunch={handleLaunch} />}

      {state === STATES.LAUNCH && (
        <LaunchCinematic audio={audio} onComplete={handleLaunchComplete} onSkip={handleSkipLaunch} />
      )}

      {state === STATES.SPACE && (
        <MissionScene missionTime={spaceTime} cinematic={true} />
      )}

      {state === STATES.ORBIT && (
        <MissionScene missionTime={orbitTime} cinematic={true} />
      )}

      {state === STATES.DIFFICULTY && (
        <>
          {/* Keep orbit in background */}
          <MissionScene missionTime={orbitTime} cinematic={true} />
          <DifficultySelect
            onSelect={handleDifficulty}
            onSkip={handleSkipDifficulty}
          />
        </>
      )}

      {state === STATES.BRIEFING && (
        <>
          {/* Orbit stays in the background, same as the difficulty screen */}
          <MissionScene missionTime={orbitTime} cinematic={true} />
          <PdiBriefing
            difficulty={difficulty}
            onBegin={handleBeginPdi}
            onBack={() => setState(STATES.DIFFICULTY)}
          />
        </>
      )}

      {state === STATES.MANUAL_DESCENT && (
        <DescentGame
          difficulty={difficulty}
          audio={audio}
          onSuccess={handleDescentSuccess}
          onCrash={handleDescentCrash}
          onAbort={resetMission}
        />
      )}

      {state === STATES.RESULT && descentResult && (
        <>
          {/* Backdrop: keep the landed lander scene visible */}
          <DescentScene altitude={0} thrust={0} dust={false} />
          <MissionResult
            result={descentResult}
            difficulty={difficulty}
            onRestart={handleRestartDescent}
            onContinue={handleContinueFromResult}
            onEndMission={resetMission}
          />
        </>
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

      {state === STATES.REENTRY && (
        <ReentryGame
          difficulty={difficulty}
          audio={audio}
          onComplete={() => setState(STATES.COMPLETE)}
          onAbort={resetMission}
        />
      )}

      {state === STATES.COMPLETE && <ReentryScene final />}

      {/* --- Minimal HUD overlay (hidden in control room & during manual descent which has its own HUD) --- */}
      {state !== STATES.CONTROL && state !== STATES.LAUNCH && state !== STATES.MANUAL_DESCENT && state !== STATES.DIFFICULTY && state !== STATES.BRIEFING && state !== STATES.REENTRY && (
        <div
          data-testid="mission-hud-min"
          className="absolute top-20 short:top-[var(--hud-top)] left-1/2 -translate-x-1/2 hud-panel px-5 py-2 flex items-center gap-4 z-30"
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

      {/* --- Interaction gate: lunar arrival is the first required input after LAUNCH --- */}
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
          className="absolute inset-0 flex items-center justify-center bg-black/50 backdrop-blur-md z-50"
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

      {/* Global abort button — not shown during control, complete, or manual descent (which has its own) */}
      {state !== STATES.CONTROL &&
        state !== STATES.COMPLETE &&
        state !== STATES.MANUAL_DESCENT &&
        state !== STATES.DIFFICULTY &&
        state !== STATES.BRIEFING &&
        state !== STATES.REENTRY &&
        state !== STATES.RESULT && (
          <button
            onClick={() => setShowAbort(true)}
            data-testid="btn-abort"
            className="absolute top-20 short:top-[var(--hud-top)] right-4 md:right-8 safe-mr hud-panel px-3 py-2 touch:py-3 flex items-center gap-2 text-zinc-400 hover:text-[#FF3B00] transition-colors duration-200 font-mono text-[10px] tracking-[0.3em] z-30"
          >
            <RotateCcw size={12} /> ABORT
          </button>
        )}

      <AbortModal
        open={showAbort}
        onCancel={() => setShowAbort(false)}
        onConfirm={() => {
          setShowAbort(false);
          resetMission();
        }}
      />
    </main>
  );
}
