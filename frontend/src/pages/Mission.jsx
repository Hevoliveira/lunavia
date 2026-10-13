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
import MissionTitle from "@/components/MissionTitle";
import { goForPdi } from "@/data/lunarOrbitShot";
import { APPROACH_SHOT, CISLUNAR, CRUISE_SHOT, DEEP_SHOT, ORBIT_SEQ, RETURN_CLOSE_END, RETURN_SHOT, coastShotAt, cruiseTime, mccLevel, orbitClockAt, orbitShotAt } from "@/data/orbitSequence";
import { TD } from "@/data/transposition";
import { TITLE } from "@/data/titleReveal";

/*
 * Outbound flight is automatic: LAUNCH plays the Earth departure (terminal
 * count → liftoff → ascent → MECO → staging → upper stage → parking orbit →
 * TLI → the spent upper stage separates) without any input, then the outbound
 * assembly coasts to the Moon and its transfer carrier fires into lunar orbit.
 * There, and only there, the spacecraft deploy: the CSM docks with the lunar
 * module and pulls it off the carrier, then the LM undocks (data/orbitSequence).
 * After CAPCOM's go for powered descent the game's title is presented, once per
 * mission, over the lunar module moving away (data/titleReveal), and the title
 * screen (TITLE) waits, with no timer, for START MISSIONS: the first required
 * input after LAUNCH, which opens the descent setup (difficulty, then BEGIN
 * PDI). Every cinematic can be skipped; skipping lunar orbit lands on the
 * title screen, never past it.
 */
const STATES = {
  CONTROL: "control",
  LAUNCH: "launch",
  SPACE: "space",
  ORBIT: "orbit",
  TITLE: "title",              // the persistent title screen: START MISSIONS
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
  title: { code: "T+81:30:00", name: "LUNAR ORBIT" },
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
const CRUISE_START = CISLUNAR.start;

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
  deepSpace: { kicker: "TRANSLUNAR COAST", title: DEEP_SHOT.caption, sub: DEEP_SHOT.sub },
  approachClose: { kicker: "TRANSLUNAR COAST", title: APPROACH_SHOT.caption, sub: APPROACH_SHOT.sub },
  returnClose: { kicker: "TRANS-EARTH INJECTION", title: RETURN_SHOT.caption, sub: RETURN_SHOT.sub },
};
const COAST_CAPTION = { depart: "cruiseClose", deep: "deepSpace", approach: "approachClose" };

// Lunar orbit's sound and comms, once each as the orbit clock passes them (and
// only if it is still near: SKIP jumps past them silently). The deployment's
// pyros, RCS and latches are felt through the structure (data/transposition TD).
const DEP = (x) => ORBIT_SEQ.deploy + x;
const ORBIT_CUES = [
  { t: ORBIT_SEQ.ignition, cue: "loiOn" },
  { t: ORBIT_SEQ.cutoff, cue: "loiOff" },
  { t: ORBIT_SEQ.arrive + 0.6, cue: "arrival" },
  { t: DEP(TD.sep), cue: "thud", vol: 0.3 },
  { t: DEP(TD.sep) + 0.02, cue: "clank", vol: 0.22 },
  { t: DEP(TD.sep) + 0.1, cue: "hiss", dur: 1.2, vol: 0.07 },
  { t: DEP(TD.panels.release), cue: "thud", vol: 0.18 },
  { t: DEP(TD.pitch.t0), cue: "hiss", dur: 0.7, vol: 0.06 },
  { t: DEP(TD.pitch.t1 - 1.2), cue: "hiss", dur: 0.7, vol: 0.06 },
  { t: DEP(TD.retract.t0), cue: "clank", vol: 0.32 },
  { t: DEP(TD.retract.t1), cue: "clank", vol: 0.45 },
  { t: DEP(TD.retract.t1) + 0.18, cue: "clank", vol: 0.25 },
  { t: DEP(TD.extract.t0), cue: "thud", vol: 0.24 },
  { t: DEP(TD.extract.t0) + 0.05, cue: "hiss", dur: 1.6, vol: 0.07 },
  { t: ORBIT_SEQ.swap + 0.6, cue: "hiss", dur: 2.0, vol: 0.06 },
  { t: TITLE.music, cue: "titleMusic" },
];

const FLIGHT_STATES = new Set([
  STATES.LAUNCH,
  STATES.SPACE,
  STATES.ORBIT,
  STATES.TITLE,
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
  const losRef = useRef(false); // the coast has handed over to lunar orbit
  const mccRef = useRef(false); // the midcourse correction burn is on
  const cruiseClockRef = useRef(0); // real seconds into the coast (data/orbitSequence cruiseTime)
  // Lunar orbit presentation (ORBIT, TITLE, DIFFICULTY, BRIEFING): the orbit
  // clock, read every frame by the scene through the ref. It is real seconds
  // since orbit began until the title screen, then slows to a near stop
  // (data/orbitSequence orbitClockAt) while the screen waits for the player.
  const orbitClockRef = useRef(0);
  const orbitRealRef = useRef(0);
  const [goPdi, setGoPdi] = useState(false);
  const goPdiRef = useRef(false);
  const titleRef = useRef(false); // this mission has reached its title screen
  const startedRef = useRef(false); // START MISSIONS pressed (once per mission)
  // Lower-third caption of the current shot (cruise close shot, lunar orbit, return).
  const [caption, setCaption] = useState(null);
  const captionRef = useRef(null);
  const undockSoundRef = useRef(new Set());
  const orbitCueRef = useRef(new Set());
  // Fade through black: lunar orbit into the descent.
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
        // The coast on its own clock: departure, deep space, the approach
        // (data/orbitSequence CISLUNAR), then lunar orbit opens on the
        // insertion burn, with no fade.
        const c = Math.min(cruiseClockRef.current + dt, CISLUNAR.s.end);
        cruiseClockRef.current = c;
        const next = cruiseTime(c);
        const coastShot = coastShotAt(next);
        // The midcourse correction on the main engine, felt aboard (one short burn; the rest is a coast).
        const mcc = coastShot.id === "deep" && mccLevel(coastShot.u) > 0.05;
        if (mcc !== mccRef.current) {
          mccRef.current = mcc;
          if (mcc) audio.startRumble(0.16);
          else audio.stopRumble();
        }
        const cap = COAST_CAPTION[coastShot.id];
        if (cap !== captionRef.current) {
          captionRef.current = cap;
          setCaption({ id: cap, ...SHOT_CAPTIONS[cap] });
        }
        cruiseRef.current = next;
        setSpaceTime(next);
        if (c >= CISLUNAR.s.end && !losRef.current) {
          losRef.current = true;
          orbitClockRef.current = 0;
          orbitRealRef.current = 0;
          orbitCueRef.current = new Set();
          setState(STATES.ORBIT);
        }
      } else if (s === STATES.ORBIT || s === STATES.TITLE || s === STATES.DIFFICULTY || s === STATES.BRIEFING) {
        // The orbit keeps flying while the player reads; no React render per frame.
        orbitRealRef.current += dt;
        // Seek (validation tooling): jump the orbit clock forward, as the launch's __lvLaunchSeek does.
        const seek = window.__lvOrbitSeek;
        if (seek != null) {
          window.__lvOrbitSeek = null;
          if (seek > orbitRealRef.current) orbitRealRef.current = seek;
        }
        orbitClockRef.current = orbitClockAt(orbitRealRef.current);
        const tau = orbitClockRef.current;
        if (!goPdiRef.current && goForPdi(tau)) {
          goPdiRef.current = true;
          setGoPdi(true);
        }
        // The title is up: the title screen, which waits for START MISSIONS (no timer).
        if (s === STATES.ORBIT && !titleRef.current && tau >= ORBIT_SEQ.titleScreen) {
          titleRef.current = true;
          setState(STATES.TITLE);
        }
        // Undocking sounds: the latches let go, then the RCS.
        if (s === STATES.ORBIT) {
          UNDOCK_SOUND.forEach((c, i) => {
            const at = ORBIT_SEQ.undock + c.t;
            if (tau >= at && !undockSoundRef.current.has(i)) {
              undockSoundRef.current.add(i);
              if (tau - at < 0.5) (c.cue === "clank" ? audio.clank(c.vol) : audio.hiss(c.dur, c.vol));
            }
          });
          // The insertion burn felt aboard, Houston on reacquiring the signal, the title's music.
          ORBIT_CUES.forEach((c, i) => {
            if (tau >= c.t && !orbitCueRef.current.has(i)) {
              orbitCueRef.current.add(i);
              if (tau - c.t >= 0.5) return;
              if (c.cue === "loiOn") audio.startRumble(0.32);
              else if (c.cue === "loiOff") audio.stopRumble();
              else if (c.cue === "arrival") audio.say("orbit.arrival");
              else if (c.cue === "titleMusic") audio.padStart();
              else if (c.cue === "thud") audio.thud?.(c.vol);
              else if (c.cue === "clank") audio.clank(c.vol);
              else if (c.cue === "hiss") audio.hiss(c.dur, c.vol);
            }
          });
        }
        const { shot } = orbitShotAt(tau);
        const cap = s === STATES.ORBIT && shot.caption ? shot.id : null;
        if (cap !== captionRef.current) {
          captionRef.current = cap;
          setCaption(cap ? { id: cap, kicker: shot.kicker || "LUNAR ORBIT", title: shot.caption, sub: shot.sub } : null);
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
    cruiseRef.current = CRUISE_START;
    cruiseClockRef.current = 0;
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

  // SKIP in lunar orbit: past the deployment and the undocking to the title screen,
  // never past it (the LM separated; nothing reset, the destination kept).
  const handleSkipOrbit = () => {
    if (stateRef.current !== STATES.ORBIT || titleRef.current) return;
    audio.commsFlush();
    audio.stopRumble();
    orbitRealRef.current = Math.max(orbitRealRef.current, ORBIT_SEQ.titleScreen);
    orbitClockRef.current = orbitClockAt(orbitRealRef.current);
    orbitCueRef.current = new Set(ORBIT_CUES.map((_, i) => i)); // the skipped sounds stay skipped
    UNDOCK_SOUND.forEach((_, i) => undockSoundRef.current.add(i));
    audio.padStart();
    titleRef.current = true;
    setState(STATES.TITLE);
  };

  // START MISSIONS on the title screen: once, into the descent setup (the existing mission
  // interface; the destination chosen before launch is kept, nothing relaunched or reset).
  const handleStartMissions = () => {
    if (stateRef.current !== STATES.TITLE || startedRef.current) return;
    startedRef.current = true;
    audio.padStop(2.5);
    setState(STATES.DIFFICULTY);
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
    losRef.current = false;
    cruiseClockRef.current = 0;
    cruiseRef.current = CRUISE_START;
    setSpaceTime(CRUISE_START);
    setFade({ o: 0, ms: 0 });
    orbitClockRef.current = 0;
    orbitRealRef.current = 0;
    goPdiRef.current = false;
    setGoPdi(false);
    titleRef.current = false;
    startedRef.current = false;
    setReturnTime(504000);
    setDescentResult(null);
    captionRef.current = null;
    setCaption(null);
    undockSoundRef.current = new Set();
    orbitCueRef.current = new Set();
  };

  // GO FOR PDI: the lunar module has undocked and separated (data/lunarOrbitShot
  // goForPdi); FLIGHT's call comes just before the descent setup opens.
  const overLandingZone = goPdi;
  const inLunarOrbit = state === STATES.ORBIT || state === STATES.TITLE || state === STATES.DIFFICULTY || state === STATES.BRIEFING;

  // Mission control between the scripted flight and the manual phases:
  // a word during the cruise, arrival at the Moon once the signal is back after
  // the insertion burn (ORBIT_CUES), and CAPCOM's go for powered descent once
  // the lunar module has separated, before the title.
  const goPdiCalledRef = useRef(false);
  useEffect(() => {
    if (state === STATES.SPACE) audio.say("cruise.ambient", { delay: 3 });
    if (state === STATES.ORBIT) goPdiCalledRef.current = false;
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
        <MissionScene missionTime={spaceTime} cinematic={true} orbitClock={inLunarOrbit ? orbitClockRef : null} orbitReal={inLunarOrbit ? orbitRealRef : null} />
      )}

      {/* The title, once per mission: over the LM moving away after the go for powered descent,
          then held as the title screen until START MISSIONS */}
      {(state === STATES.ORBIT || state === STATES.TITLE) && (
        <MissionTitle clockRef={orbitClockRef} ready={state === STATES.TITLE} onStart={handleStartMissions} />
      )}

      {/* The descent setup opens over the same shot */}
      {state === STATES.DIFFICULTY && (
        <div className="absolute inset-0 z-40 veil-in" data-testid="descent-setup">
          <DifficultySelect
            onSelect={handleDifficulty}
            onSkip={handleSkipDifficulty}
          />
        </div>
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
      {state !== STATES.CONTROL && state !== STATES.LAUNCH && state !== STATES.TITLE && state !== STATES.MANUAL_DESCENT && state !== STATES.DIFFICULTY && state !== STATES.BRIEFING && state !== STATES.REENTRY && (
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

      {/* Lunar orbit plays on its own (insertion, the deployment, undocking, the title) up to the
          title screen; it can be skipped to the title screen, never past it. */}
      {state === STATES.ORBIT && (
        <button
          type="button"
          data-testid="skip-orbit"
          onClick={handleSkipOrbit}
          className="absolute bottom-6 short:bottom-2 right-6 md:right-10 safe-mr safe-mb z-30 font-mono text-[10px] tracking-[0.3em] text-zinc-400 hover:text-white px-3 py-2 touch:min-h-[44px] touch:px-4 bg-black/30 border border-white/10"
        >
          SKIP CINEMATIC ›
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
      {/* Fade through black: lunar orbit into the descent */}
      <div
        aria-hidden
        data-testid="descent-fade"
        className="fixed inset-0 z-[70] bg-black pointer-events-none"
        style={{ opacity: fade.o, transition: `opacity ${fade.ms}ms ease-${fade.o ? "in" : "out"}` }}
      />
    </main>
  );
}
