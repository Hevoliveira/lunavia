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
import { APPROACH, goForPdi } from "@/data/lunarOrbitShot";
import { APPROACH_CLOSE, APPROACH_SHOT, CRUISE, CRUISE_SHOT, ORBIT_SEQ, RETURN_CLOSE_END, RETURN_SHOT, orbitShotAt } from "@/data/orbitSequence";

/*
 * Outbound flight is automatic: LAUNCH plays the Earth departure (terminal
 * count → liftoff → ascent → MECO → staging → upper stage → parking orbit →
 * TLI) without any input, then the cislunar cruise runs to lunar orbit, where
 * the lunar module undocks (data/orbitSequence). The first required input
 * after LAUNCH is the descent setup (difficulty, then BEGIN PDI) once the
 * lunar module has separated. Every cinematic can be skipped.
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

// Undocking sounds, seconds after the latches release (data/orbitSequence ORBIT_SEQ.undock).
const UNDOCK_SOUND = [
  { t: 0, cue: "clank", vol: 0.35 },
  { t: 0.08, cue: "hiss", dur: 1.4, vol: 0.18 },
  { t: 4.5, cue: "hiss", dur: 0.5, vol: 0.1 },
  { t: 13, cue: "hiss", dur: 2.6, vol: 0.16 },
];

// Shot captions (lower third), keyed by shot.
const SHOT_CAPTIONS = {
  cruiseClose: { kicker: "TRANSLUNAR COAST", title: CRUISE_SHOT.caption, sub: CRUISE_SHOT.sub },
  approachClose: { kicker: "TRANSLUNAR COAST", title: APPROACH_SHOT.caption, sub: APPROACH_SHOT.sub },
  returnClose: { kicker: "TRANS-EARTH INJECTION", title: RETURN_SHOT.caption, sub: RETURN_SHOT.sub },
};

// Loss of signal at the end of the cruise: fade to black, then open on the
// lunar orbit (data/lunarOrbitShot APPROACH.los).
const LOS_FADE_OUT_MS = 450;
const LOS_FADE_IN_MS = 1100;

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
  const cruiseRef = useRef(CRUISE_START); // same clock, for the loop
  const losRef = useRef(false);
  const losTimerRef = useRef(null);
  // Lunar orbit presentation (ORBIT, DIFFICULTY, BRIEFING): real seconds since
  // orbit began, read every frame by the scene through the ref.
  const orbitClockRef = useRef(0);
  const [goPdi, setGoPdi] = useState(false);
  const goPdiRef = useRef(false);
  const [orbitPrompt, setOrbitPrompt] = useState(false); // the undocking sequence has handed over to the descent setup
  const promptRef = useRef(false);
  // Lower-third caption of the current shot (cruise close shot, lunar orbit, return).
  const [caption, setCaption] = useState(null);
  const captionRef = useRef(null);
  const undockSoundRef = useRef(new Set());
  // Fade through black: loss of signal into lunar orbit, and orbit into the descent.
  const [fade, setFade] = useState({ o: 0, ms: 650 });
  const fadingRef = useRef(false);
  const [returnTime, setReturnTime] = useState(504000);
  const [difficulty, setDifficulty] = useState("ASTRONAUT");
  const [descentResult, setDescentResult] = useState(null);
  const [showAbort, setShowAbort] = useState(false);
  const rafRef = useRef(null);
  const lastTsRef = useRef(0);
  const stateRef = useRef(state);

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
        // The cruise never shows the craft reaching the drawn Moon: at loss of
        // signal it fades to black and lunar orbit opens from black.
        // Slower over the first, close shot of the docked spacecraft, then the 3-day coast at full compression.
        // ... and slower again over the close shot of the stack closing on the Moon.
        const c0 = cruiseRef.current;
        const rate = c0 < CRUISE.closeEnd ? CRUISE.slowRate : c0 >= APPROACH_CLOSE.start && c0 < APPROACH.los ? APPROACH_CLOSE.rate : 30000;
        const next = Math.min(c0 < APPROACH_CLOSE.start ? Math.min(c0 + dt * rate, APPROACH_CLOSE.start) : c0 + dt * rate, APPROACH.losEnd);
        const cap = next < CRUISE.closeEnd ? "cruiseClose" : next >= APPROACH_CLOSE.start && next < APPROACH.los ? "approachClose" : null;
        if (cap !== captionRef.current) {
          captionRef.current = cap;
          setCaption(cap ? { id: cap, ...SHOT_CAPTIONS[cap] } : null);
        }
        cruiseRef.current = next;
        setSpaceTime(next);
        if (next >= APPROACH.los && !losRef.current) {
          losRef.current = true;
          setFade({ o: 1, ms: LOS_FADE_OUT_MS });
          losTimerRef.current = setTimeout(() => {
            losTimerRef.current = null;
            orbitClockRef.current = 0;
            cruiseRef.current = 270000;
            setSpaceTime(270000);
            setState(STATES.ORBIT);
            requestAnimationFrame(() => requestAnimationFrame(() => setFade({ o: 0, ms: LOS_FADE_IN_MS })));
          }, LOS_FADE_OUT_MS + 80);
        }
      } else if (s === STATES.ORBIT || s === STATES.DIFFICULTY || s === STATES.BRIEFING) {
        // The orbit keeps flying while the player reads; no React render per frame.
        orbitClockRef.current += dt;
        const tau = orbitClockRef.current;
        if (!goPdiRef.current && goForPdi(tau)) {
          goPdiRef.current = true;
          setGoPdi(true);
        }
        // Undocking done: straight into the descent setup (no button in between).
        if (s === STATES.ORBIT && !promptRef.current && tau >= ORBIT_SEQ.end) {
          promptRef.current = true;
          setOrbitPrompt(true);
          setState(STATES.DIFFICULTY);
        }
        // Undocking sounds: the latches let go, then the RCS (the same cues as the opening).
        if (s === STATES.ORBIT) {
          UNDOCK_SOUND.forEach((c, i) => {
            const at = ORBIT_SEQ.undock + c.t;
            if (tau >= at && !undockSoundRef.current.has(i)) {
              undockSoundRef.current.add(i);
              if (tau - at < 0.5) (c.cue === "clank" ? audio.clank(c.vol) : audio.hiss(c.dur, c.vol));
            }
          });
        }
        const { shot } = orbitShotAt(tau);
        const cap = s === STATES.ORBIT && shot.caption ? shot.id : null;
        if (cap !== captionRef.current) {
          captionRef.current = cap;
          setCaption(cap ? { id: cap, kicker: "LUNAR ORBIT", title: shot.caption, sub: shot.sub } : null);
        }
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
          // Slower over the close shot of the CSM leaving the Moon.
          const next = t + dt * (t < RETURN_CLOSE_END ? 12000 : 25000);
          const cap = next < RETURN_CLOSE_END ? "returnClose" : null;
          if (cap !== captionRef.current) {
            captionRef.current = cap;
            setCaption(cap ? { id: cap, ...SHOT_CAPTIONS[cap] } : null);
          }
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
    return () => {
      cancelAnimationFrame(rafRef.current);
      clearTimeout(losTimerRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleLaunch = () => {
    audio.init();
    setState(STATES.LAUNCH);
  };

  // End of the Earth departure (or SKIP): straight into the cislunar cruise.
  // Skipping only shortens the film; the mission states are the same.
  const handleLaunchComplete = () => {
    cruiseRef.current = CRUISE_START;
    losRef.current = false;
    setSpaceTime(CRUISE_START);
    setState(STATES.SPACE);
  };

  const handleSkipLaunch = () => {
    audio.commsFlush();
    audio.roarStop(0.3);
    audio.ambienceStop(0.5);
    audio.padStart();
    handleLaunchComplete();
  };

  // SKIP in lunar orbit: to the end of the undocking (the LM separated), then the descent setup.
  const handleSkipOrbit = () => {
    audio.commsFlush();
    orbitClockRef.current = Math.max(orbitClockRef.current, ORBIT_SEQ.end);
  };

  // Phase 2 - selecting a difficulty no longer drops the player straight into a
  // live descent. It opens the readiness card; the simulation starts only when
  // BEGIN PDI is pressed, so the comms call moves there too.
  const handleDifficulty = (key) => {
    setDifficulty(key);
    setState(STATES.BRIEFING);
  };

  // BEGIN PDI: a short fade through black into the descent view (the descent
  // itself starts exactly as before, from its own initial state).
  const handleBeginPdi = () => {
    if (fadingRef.current) return;
    fadingRef.current = true;
    setFade({ o: 1, ms: 360 });
    setTimeout(() => {
      setState(STATES.MANUAL_DESCENT);
      audio.say("descent.pdiStart", { delay: 0.4 });
      requestAnimationFrame(() => requestAnimationFrame(() => {
        setFade({ o: 0, ms: 650 });
        fadingRef.current = false;
      }));
    }, 380);
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
    audio.commsFlush();
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
    audio.commsReset();
    audio.stopRumble();
    audio.roarStop(0.3);
    audio.ambienceStop(0.5);
    audio.padStop(1);
    setState(STATES.CONTROL);
    setProgress(0);
    setDescentAlt(8);
    clearTimeout(losTimerRef.current);
    losTimerRef.current = null;
    losRef.current = false;
    cruiseRef.current = CRUISE_START;
    setSpaceTime(CRUISE_START);
    setFade({ o: 0, ms: 0 });
    orbitClockRef.current = 0;
    goPdiRef.current = false;
    setGoPdi(false);
    promptRef.current = false;
    setOrbitPrompt(false);
    setReturnTime(504000);
    setDescentResult(null);
    captionRef.current = null;
    setCaption(null);
    undockSoundRef.current = new Set();
  };

  // GO FOR PDI: the lunar module has undocked and separated (data/lunarOrbitShot
  // goForPdi); FLIGHT's call comes just before the descent setup opens.
  const overLandingZone = goPdi;
  const inLunarOrbit = state === STATES.ORBIT || state === STATES.DIFFICULTY || state === STATES.BRIEFING;

  // Mission control between the scripted flight and the manual phases:
  // a word during the cruise, arrival at the Moon, and FLIGHT's go for
  // powered descent the first time the orbit brings the landing zone up.
  const goPdiCalledRef = useRef(false);
  useEffect(() => {
    if (state === STATES.SPACE) audio.say("cruise.ambient", { delay: 3 });
    if (state === STATES.ORBIT) {
      goPdiCalledRef.current = false;
      audio.say("orbit.arrival", { delay: 1.2 });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);
  useEffect(() => {
    if (state === STATES.ORBIT && overLandingZone && !goPdiCalledRef.current) {
      goPdiCalledRef.current = true;
      audio.say("orbit.goPdi");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state, overLandingZone]);

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

      {/* One scene for the cruise, lunar orbit and the descent-prep screens:
          kept mounted across them so the camera never cuts or snaps. */}
      {(state === STATES.SPACE || inLunarOrbit) && (
        <MissionScene missionTime={spaceTime} cinematic={true} orbitClock={inLunarOrbit ? orbitClockRef : null} />
      )}

      {state === STATES.DIFFICULTY && (
        <>
          <DifficultySelect
            onSelect={handleDifficulty}
            onSkip={handleSkipDifficulty}
          />
        </>
      )}

      {state === STATES.BRIEFING && (
        <>
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

      {/* Shot caption, lower third (cruise close shot, lunar orbit and undocking, return) */}
      {caption && (state === STATES.SPACE || state === STATES.ORBIT || state === STATES.RETURN) && (
        <div
          key={caption.id}
          data-testid="mission-caption"
          data-shot={caption.id}
          className="absolute bottom-10 short:bottom-3 left-6 md:left-10 safe-ml safe-mb z-30 pointer-events-none scan-in bg-black/45 backdrop-blur-sm border-l-2 border-[#FF3B00] px-3 py-2 short:py-1.5 max-w-[min(30rem,62vw)]"
        >
          <div className="flex items-center gap-2 font-mono text-[9px] tracking-[0.4em] text-[#FF3B00]">
            <span className="w-1.5 h-1.5 rounded-full bg-[#FF3B00]" /> {caption.kicker}
          </div>
          <div className="font-display font-black text-white text-2xl md:text-3xl short:text-xl tracking-tight mt-0.5">{caption.title}</div>
          <div className="font-mono text-[10px] short:text-[9px] tracking-[0.22em] text-zinc-300 mt-0.5">{caption.sub}</div>
        </div>
      )}

      {/* Lunar orbit plays on its own (arrival, the docked spacecraft, undocking) and hands over
          to the descent setup; it can be skipped to the end of the undocking. */}
      {state === STATES.ORBIT && !orbitPrompt && (
        <button
          type="button"
          data-testid="skip-orbit"
          onClick={handleSkipOrbit}
          className="absolute bottom-6 short:bottom-2 right-6 md:right-10 safe-mr safe-mb z-30 font-mono text-[10px] tracking-[0.3em] text-zinc-400 hover:text-white px-3 py-2 touch:min-h-[44px] touch:px-4 bg-black/30 border border-white/10"
        >
          SKIP TO DESCENT ›
        </button>
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
      {/* Fade through black: loss of signal into lunar orbit, orbit into the descent */}
      <div
        aria-hidden
        data-testid="descent-fade"
        className="fixed inset-0 z-[70] bg-black pointer-events-none"
        style={{ opacity: fade.o, transition: `opacity ${fade.ms}ms ease-${fade.o ? "in" : "out"}` }}
      />
    </main>
  );
}
