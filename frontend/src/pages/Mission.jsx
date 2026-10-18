import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowUpRight, RotateCcw } from "lucide-react";
import ControlRoomView from "@/components/scenes/ControlRoomView";
import LaunchCinematic from "@/components/scenes/LaunchCinematic";
import MissionScene, { preloadMissionScene } from "@/components/MissionScene";
import ReentryScene from "@/components/scenes/ReentryScene";
import DescentGame from "@/components/DescentGame";
import ReentryGame from "@/components/ReentryGame";
import MissionSelect from "@/components/missions/MissionSelect";
import ModeMenu from "@/components/missions/ModeMenu";
import FarSideIntro from "@/components/training/FarSideIntro";
import PdiBriefing from "@/components/PdiBriefing";
import MissionResult from "@/components/MissionResult";
import LunarAscent from "@/components/LunarAscent";
import DockingOps from "@/components/DockingOps";
import AbortModal from "@/components/AbortModal";
import useMissionAudio from "@/hooks/useMissionAudio";
import MissionTitle from "@/components/MissionTitle";
import MissionDebrief from "@/components/scoring/MissionDebrief";
import { useAudioSettings } from "@/audio/audioSettings";
import { createFlightScoring } from "@/data/flightScoring";
import { applyDocking, applyFlightStart, applyLanding, applyMission, applyReentry, loadRecords, unlockedBy, updateRecords } from "@/lib/missionRecords";
import { goForPdi } from "@/data/lunarOrbitShot";
import { ORBIT_ENTRY, ORBIT_SEQ, RETURN_CLOSE_END, RETURN_SHOT, orbitClockAt, orbitShotAt } from "@/data/orbitSequence";
import { TD } from "@/data/transposition";
import { TITLE } from "@/data/titleReveal";
import { MODE, createMissionConfig } from "@/data/missionConfig";
import { loadMissionLog, loadSelection, logMissionComplete, logMissionDocking, logMissionFlown, logMissionLanding, logMissionReentry, logMissionScoring, logMissionStart, saveSelection } from "@/lib/missionSelection";

/*
 * Outbound flight is automatic: LAUNCH plays the Earth departure (terminal
 * count → liftoff → ascent → MECO → staging → upper stage → parking orbit →
 * TLI) without any input and ends 2 s after GUIDANCE's "Cutoff." Then the film
 * cuts straight to lunar orbit (ORBIT_ENTRY: the arrival, CAPCOM's welcome): no
 * translunar travel is shown. The three-day coast, the spent upper stage's
 * separation and the insertion burn happen across the cut; the outbound
 * assembly arrives integrated. There, and only there, the spacecraft deploy: the CSM docks with the lunar
 * module and pulls it off the carrier, then the LM undocks (data/orbitSequence).
 * After CAPCOM's go for powered descent the game's title is presented, once per
 * mission, over the lunar module moving away (data/titleReveal), and the title
 * screen (TITLE) waits, with no timer, for START MISSIONS: the first required
 * input after LAUNCH, which opens the descent briefing (BEGIN PDI). Every
 * cinematic can be skipped; skipping lunar orbit lands on the title screen,
 * never past it.
 *
 * Startup: opening LUNAVIA (/) shows THE ROAD TO THE MOON (mission control,
 * ControlRoomView) and waits, with no timer, for LAUNCH SEQUENCE — INITIATE. Only
 * that press starts the expedition: the launch, the cut to lunar orbit, the
 * deployment, the undocking, the go for powered descent, the title and the title screen. START
 * MISSIONS then opens the game menu (MENU): MISSIONS or TRAINING. The flight is
 * not replayed and nothing is reset; the lunar-orbit shot stays behind the menu.
 *
 * Official missions (data/missionConfig): MISSIONS shows the four destinations,
 * then the pilot difficulty; the choice becomes one frozen mission config and
 * the mission continues from lunar orbit at that destination: its briefing, its
 * descent (terrain, landing zones, hazards), its results, then the return,
 * reentry and splashdown. Silent Horizon (far side): after BEGIN PDI the
 * spacecraft go behind the Moon (FarSideIntro, loss of signal) and the descent
 * has no Earth link. After a successful landing: LUNAR SURFACE — ASCENT
 * PREPARATION (LunarAscent; nothing starts before INITIATE LUNAR ASCENT), the
 * lunar liftoff (the ascent stage leaves the descent stage on the Moon), orbit
 * insertion and the automatic rendezvous with the same CSM, then the player's
 * docking (DockingOps: the real docking simulation; a failed attempt retries
 * from the rendezvous checkpoint), hard dock, crew transfer and the ascent
 * stage's jettison; only then the return and reentry. A mission is complete at
 * splashdown, never on the landing alone. TRAINING opens the Flight Training Center. ABORT, the end
 * of a mission and the training's MAIN MENU all come back to the menu (/menu),
 * never through the opening again.
 *
 * Mission scoring (data/missionScoring, data/flightScoring): each official
 * flight is scored phase by phase from what the simulations measured — the
 * graded touchdown, the docking's capture, the entry that splashed down — and
 * kept on the device (lib/missionRecords: records and achievements; the
 * mission log: the history). After MISSION COMPLETE, and after END MISSION on a
 * failed mission, the MISSION DEBRIEF shows the scores, the medal, the
 * achievements and the personal record. Nothing scored is shown during flight.
 */
const STATES = {
  CONTROL: "control",          // startup: THE ROAD TO THE MOON, waiting for LAUNCH SEQUENCE — INITIATE
  LAUNCH: "launch",            // LV-001 from the pad to TLI
  MENU: "menu",                // after START MISSIONS: MISSIONS or TRAINING
  SELECT: "select",            // MISSIONS: destination, then pilot difficulty
  ORBIT: "orbit",
  TITLE: "title",              // the persistent title screen: START MISSIONS
  BRIEFING: "briefing",        // Phase 2 - PDI readiness card, sim not yet live
  FAR_SIDE: "far_side",        // Silent Horizon: loss of signal behind the Moon, before the descent
  MANUAL_DESCENT: "manual_descent",
  RESULT: "result",
  ASCENT: "ascent",            // LUNAR SURFACE — ASCENT PREPARATION, then the lunar liftoff
  DOCKING: "docking",          // orbit insertion, rendezvous, the player's docking, crew transfer
  RETURN: "return",
  REENTRY: "reentry",
  COMPLETE: "complete",
  DEBRIEF: "debrief",          // a failed mission's END MISSION: its partial score (no medal)
};

const STATE_LABELS = {
  control: { code: "T-00:00:10", name: "MISSION CONTROL" },
  menu: { code: "T+81:30:00", name: "LUNAVIA" },
  select: { code: "T+81:30:00", name: "MISSIONS" },
  launch: { code: "T-00:00:15", name: "LAUNCH" },
  orbit: { code: "T+80:00:00", name: "LUNAR ORBIT" },
  title: { code: "T+81:30:00", name: "LUNAR ORBIT" },
  briefing: { code: "T+82:00:00", name: "PDI · READINESS" },
  far_side: { code: "T+82:00:00", name: "LOSS OF SIGNAL" },
  manual_descent: { code: "T+82:00:00", name: "POWERED DESCENT · MANUAL" },
  result: { code: "T+82:12:00", name: "MISSION RATING" },
  ascent: { code: "T+103:00:00", name: "LUNAR ASCENT" },
  docking: { code: "T+104:30:00", name: "RENDEZVOUS & DOCKING" },
  return: { code: "T+140:00:00", name: "TRANS-EARTH INJECTION" },
  reentry: { code: "T+195:00:00", name: "REENTRY" },
  complete: { code: "T+195:15:00", name: "SPLASHDOWN · MISSION COMPLETE" },
  debrief: { code: "", name: "MISSION DEBRIEF" },
};

// Mission time on arrival in lunar orbit (T+80 h). The lunar-orbit scene runs on its own
// clock (orbitClockRef); only the return reads missionTime.
const ARRIVAL_TIME = 80 * 3600;

// Undocking sounds, seconds after the latches release (data/orbitSequence ORBIT_SEQ.undock).
const UNDOCK_SOUND = [
  { t: 0, cue: "clank", vol: 0.35 },
  { t: 0.08, cue: "hiss", dur: 1.4, vol: 0.18 },
  { t: 4.5, cue: "hiss", dur: 0.5, vol: 0.1 },
  { t: 13, cue: "hiss", dur: 2.6, vol: 0.16 },
];

// Shot captions (lower third), keyed by shot.
const SHOT_CAPTIONS = {
  returnClose: { kicker: "TRANS-EARTH INJECTION", title: RETURN_SHOT.caption, sub: RETURN_SHOT.sub },
};

// Lunar orbit's sound and comms, once each as the orbit clock passes them (and
// only if it is still near: SKIP jumps past them silently). The deployment's
// pyros, RCS and latches are felt through the structure (data/transposition TD).
const DEP = (x) => ORBIT_SEQ.deploy + x;
const ORBIT_CUES = [
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

// Lunar orbit stays on screen (one scene, one clock) through these: the opening's orbit,
// the title screen, the menu, MISSIONS and the descent briefing.
const ORBIT_STATES = new Set([STATES.ORBIT, STATES.TITLE, STATES.MENU, STATES.SELECT, STATES.BRIEFING]);

const FLIGHT_STATES = new Set([
  STATES.LAUNCH,
  STATES.ORBIT,
  STATES.TITLE,
  STATES.MENU,
  STATES.FAR_SIDE,
  STATES.MANUAL_DESCENT,
  STATES.ASCENT,
  STATES.DOCKING,
  STATES.RETURN,
  STATES.REENTRY,
]);

// Where the game opens: the startup screen (/), the menu (/menu) or MISSIONS (/missions).
// The menu and MISSIONS are shown over lunar orbit as left by the opening (the LM
// undocked, at the title screen).
const ENTRY_STATE = { opening: STATES.CONTROL, menu: STATES.MENU, missions: STATES.SELECT };

export default function Mission({ entry = "opening" }) {
  const navigate = useNavigate();
  const opening = (ENTRY_STATE[entry] || STATES.CONTROL) === STATES.CONTROL;
  const [state, setState] = useState(() => ENTRY_STATE[entry] || STATES.CONTROL);
  // The official mission: destination and pilot difficulty, chosen on MISSIONS and
  // held, frozen, for the rest of the expedition (to splashdown).
  const [selection, setSelection] = useState(() => loadSelection());
  const mission = useMemo(() => createMissionConfig({ mode: MODE.OFFICIAL, ...selection }), [selection]);
  const missionRef = useRef(mission);
  missionRef.current = mission;
  const difficulty = mission.difficulty;
  const flightIdRef = useRef(null); // this flight's entry in the official missions' log
  const [missionLog, setMissionLog] = useState(() => loadMissionLog());
  // This flight's scoring (data/flightScoring) and, once it has ended, its debrief.
  const scoringRef = useRef(null);
  const [debrief, setDebrief] = useState(null);
  const [debriefOpen, setDebriefOpen] = useState(false);
  const lang = useAudioSettings().subLang === "pt" ? "pt" : "en";
  // Lunar orbit presentation (ORBIT, TITLE, BRIEFING): the orbit
  // clock, read every frame by the scene through the ref. It is real seconds
  // since orbit began until the title screen, then slows to a near stop
  // (data/orbitSequence orbitClockAt) while the screen waits for the player.
  const orbitRealRef = useRef(opening ? 0 : ORBIT_SEQ.titleScreen);
  const orbitClockRef = useRef(opening ? 0 : orbitClockAt(ORBIT_SEQ.titleScreen));
  const [goPdi, setGoPdi] = useState(!opening);
  // From GUIDANCE's "Cutoff." the lunar-orbit scene is mounted under the launch, held on the
  // arrival, so that it is already drawn when the film cuts to it.
  const [orbitAhead, setOrbitAhead] = useState(false);
  const goPdiRef = useRef(!opening);
  const titleRef = useRef(!opening); // the opening has reached its title screen
  const startedRef = useRef(!opening); // START MISSIONS pressed (once per opening)
  // Lower-third caption of the current shot (lunar orbit, return).
  const [caption, setCaption] = useState(null);
  const captionRef = useRef(null);
  const undockSoundRef = useRef(new Set(opening ? [] : UNDOCK_SOUND.map((_, i) => i)));
  const orbitCueRef = useRef(new Set(opening ? [] : ORBIT_CUES.map((_, i) => i)));
  // Fade through black: lunar orbit into the descent.
  const [fade, setFade] = useState({ o: 0, ms: 650 });
  const fadingRef = useRef(false);
  const [returnTime, setReturnTime] = useState(504000);
  const [descentResult, setDescentResult] = useState(null);
  const [showAbort, setShowAbort] = useState(false);
  const rafRef = useRef(null);
  const lastTsRef = useRef(0);
  const stateRef = useRef(state);

  const audio = useMissionAudio();

  useEffect(() => {
    stateRef.current = state;
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

      if (ORBIT_STATES.has(s)) {
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
          // Houston's welcome on arrival, the deployment's sounds, the title's music.
          ORBIT_CUES.forEach((c, i) => {
            if (tau >= c.t && !orbitCueRef.current.has(i)) {
              orbitCueRef.current.add(i);
              if (tau - c.t >= 0.5) return;
              if (c.cue === "arrival") audio.say("orbit.arrival");
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

  // LAUNCH SEQUENCE — INITIATE on the startup screen: the only way the launch starts
  // (no timer, no autoplay). Once: the button gives way to GO, and only the startup
  // state can launch.
  const handleLaunch = () => {
    if (stateRef.current !== STATES.CONTROL) return;
    stateRef.current = STATES.LAUNCH;
    audio.init();
    preloadMissionScene(); // lunar orbit follows the launch directly
    setState(STATES.LAUNCH);
  };

  // "Cutoff.": mount lunar orbit under the launch, its clock held on the arrival.
  const handleCutAhead = () => {
    if (stateRef.current !== STATES.LAUNCH) return;
    orbitRealRef.current = ORBIT_ENTRY;
    orbitClockRef.current = orbitClockAt(ORBIT_ENTRY);
    setOrbitAhead(true);
  };

  // MISSIONS: the destination and pilot difficulty. The flight continues from lunar
  // orbit to that destination's briefing (no second launch); it is logged from here.
  const handleConfirmMission = (sel) => {
    const next = saveSelection(sel);
    audio.padStop(2.5);
    setSelection(next);
    endFlight("aborted"); // a flight left unfinished (CHANGE MISSION after a descent) ends as ABORTED
    flightIdRef.current = logMissionStart(next);
    scoringRef.current = createFlightScoring({ id: flightIdRef.current, ...next });
    setDescentResult(null);
    setState(STATES.BRIEFING);
  };

  // End of the Earth departure (2 s after "Cutoff.", or SKIP): a cinematic time jump
  // straight to lunar orbit, on the arrival (ORBIT_ENTRY), where CAPCOM welcomes the crew.
  // The coast, the upper stage's separation and the insertion burn are behind the cut:
  // the orbit clock starts at the arrival, and the deployment, the undocking and the
  // title follow on it as before. Skipping only shortens the film; the states are the same.
  const handleLaunchComplete = () => {
    if (stateRef.current !== STATES.LAUNCH) return;
    audio.roarStop(0.3);
    orbitRealRef.current = ORBIT_ENTRY;
    orbitClockRef.current = orbitClockAt(ORBIT_ENTRY);
    orbitCueRef.current = new Set(ORBIT_CUES.flatMap((c, i) => (c.t < ORBIT_ENTRY ? [i] : [])));
    setState(STATES.ORBIT);
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

  // START MISSIONS on the title screen: once, the game menu (MISSIONS or TRAINING),
  // over the same shot (nothing relaunched or reset).
  const handleStartMissions = () => {
    if (stateRef.current !== STATES.TITLE || startedRef.current) return;
    startedRef.current = true;
    setState(STATES.MENU);
  };

  const handleTraining = () => {
    audio.padStop(0.5);
    navigate("/training");
  };

  // The descent itself, after the fade (or, on the far side, after loss of signal).
  const enterDescent = () => {
    // a new scored attempt of the flight: nothing of an earlier descent is kept
    const sc = scoringRef.current;
    if (sc && flightIdRef.current) {
      sc.beginDescent();
      sc.flight.flown = true;
      logMissionFlown(flightIdRef.current);
      updateRecords((r) => applyFlightStart(r, sc.flight));
    }
    setState(STATES.MANUAL_DESCENT);
    // the crew's call to Houston: not on the far side (no link)
    if (!missionRef.current.comms.farSide) audio.say("descent.pdiStart", { delay: 0.4 });
  };

  // BEGIN PDI: a short fade through black into the descent view (the descent
  // itself starts exactly as before, from its site's own initial state). On the far
  // side the spacecraft first go behind the Moon: loss of signal (FarSideIntro).
  const handleBeginPdi = () => {
    if (fadingRef.current) return;
    fadingRef.current = true;
    setFade({ o: 1, ms: 360 });
    setTimeout(() => {
      if (missionRef.current.comms.farSide) setState(STATES.FAR_SIDE);
      else enterDescent();
      requestAnimationFrame(() => requestAnimationFrame(() => {
        setFade({ o: 0, ms: 650 });
        fadingRef.current = false;
      }));
    }, 380);
  };

  const handleDescentEnd = (result) => {
    setDescentResult(result);
    if (flightIdRef.current) setMissionLog(logMissionLanding(flightIdRef.current, result));
    // the landing's score, from this touchdown only (a safe one sets its records and achievements)
    const sc = scoringRef.current;
    if (sc && flightIdRef.current) {
      const L = sc.landed(result);
      updateRecords((r) => applyLanding(r, sc.flight, L));
      setMissionLog(logMissionScoring(flightIdRef.current, sc.summary(null)));
    }
    setState(STATES.RESULT);
  };

  // RESTART on the results: the descent again, same destination and pilot difficulty.
  const handleRestartDescent = () => {
    audio.commsFlush();
    setDescentResult(null);
    setState(STATES.BRIEFING);
  };

  const handleMissionComplete = (data) => {
    // Splashdown: the reentry's score, then the mission's (gates, medal), the records and achievements.
    const sc = scoringRef.current;
    const id = flightIdRef.current;
    let d = null;
    if (sc && id && data && !sc.flight.ended) {
      const R = sc.splashdown(data);
      const M = sc.mission();
      const status = sc.status();
      sc.flight.ended = status;
      const { records, out } = updateRecords((rec) => {
        applyReentry(rec, sc.flight, R);
        return applyMission(rec, sc.flight, M);
      });
      logMissionReentry(id, sc.flight.reentry);
      const prevBest = out.prev ? { score: out.prev.score, medal: out.prev.medal || null } : null;
      logMissionScoring(id, { ...sc.summary(status), newBest: out.newBest, prevBest });
      d = { mission: M, status, prev: prevBest, newBest: out.newBest, unlocked: unlockedBy(records, id), records, number: missionRef.current.number, at: Date.now() };
    }
    if (flightIdRef.current) setMissionLog(logMissionComplete(flightIdRef.current));
    setDebrief(d);
    setDebriefOpen(false);
    setState(STATES.COMPLETE);
  };

  // A capsule lost on entry (the failure panel follows; RETRY ENTRY may finish the flight).
  const handleEntryLost = (data) => {
    const sc = scoringRef.current;
    if (!sc || !flightIdRef.current || !data) return;
    sc.entryLost(data);
    logMissionReentry(flightIdRef.current, { splashdown: false, outcome: data.outcome, attempts: data.attempts, losses: data.losses, eiFpa: data.eiFpa, peakG: data.peakG, peakHeatRate: data.peakHeatRate });
  };

  // A failed or aborted flight ends: its partial score goes to the log (no medal, no mission record).
  const endFlight = (how) => {
    const sc = scoringRef.current;
    const id = flightIdRef.current;
    if (!sc || !id || !sc.flight.flown || sc.flight.ended) return null;
    const status = sc.status(how);
    sc.flight.ended = status;
    setMissionLog(logMissionScoring(id, sc.summary(status)));
    const records = loadRecords();
    const best = (records.categories[`${sc.flight.siteId}|${sc.flight.difficulty}`] || {}).bestTotal || null;
    return { mission: sc.mission(), status, prev: best ? { score: best.score, medal: best.medal || null } : null, newBest: false, unlocked: unlockedBy(records, id), records, number: missionRef.current.number, at: Date.now() };
  };
  // END MISSION after a crash, a failed docking or a lost capsule: the partial debrief, then the menu.
  const handleEndFailedMission = () => {
    const d = endFlight("ended");
    if (!d) {
      resetMission();
      return;
    }
    audio.commsReset();
    audio.stopRumble();
    audio.roarStop(0.3);
    audio.ambienceStop(0.5);
    setDebrief(d);
    setState(STATES.DEBRIEF);
  };
  // The docking's and the reentry's own ABORT, or END MISSION on their failure panels.
  const handlePhaseAbort = (reason) => (reason === "failed" ? handleEndFailedMission() : resetMission());

  // CONTINUE MISSION after a successful landing: the lunar surface, ascent preparation.
  // A failed landing (crew lost) must NOT progress to the ascent, TEI, reentry or splashdown.
  const landingRef = useRef(null); // the landing result (and the LM's pose) the ascent starts from
  const handleContinueFromResult = () => {
    if (!descentResult || descentResult.crashed) return;
    landingRef.current = descentResult;
    setDescentResult(null);
    setState(STATES.ASCENT);
  };
  // Liftoff film over (or skipped): orbit insertion, rendezvous, docking.
  const handleAscentComplete = () => {
    if (stateRef.current !== STATES.ASCENT) return;
    setState(STATES.DOCKING);
  };
  // Hard dock, crew transfer, ascent stage jettisoned: the CSM heads home (the existing return).
  const handleDockingComplete = () => {
    if (stateRef.current !== STATES.DOCKING) return;
    setState(STATES.RETURN);
  };
  const handleDockingResult = (r) => {
    if (flightIdRef.current) setMissionLog(logMissionDocking(flightIdRef.current, r));
    // restarts and failed attempts are kept as the attempt history; the hard dock is scored from its capture
    const sc = scoringRef.current;
    const D = sc && flightIdRef.current ? sc.docking(r) : null;
    if (D) {
      updateRecords((rec) => applyDocking(rec, sc.flight, D));
      setMissionLog(logMissionScoring(flightIdRef.current, sc.summary(null)));
    }
  };

  // ABORT, END MISSION, MAIN MENU: back to the game menu, over lunar orbit as left by
  // the opening (the title screen's shot). The opening is not replayed; the next
  // mission is chosen afresh on MISSIONS.
  const resetMission = () => {
    endFlight("aborted"); // a flight still under way ends as ABORTED (nothing if it already ended)
    scoringRef.current = null;
    setDebrief(null);
    setDebriefOpen(false);
    audio.commsReset();
    audio.stopRumble();
    audio.roarStop(0.3);
    audio.ambienceStop(0.5);
    audio.padStop(1);
    setOrbitAhead(false);
    flightIdRef.current = null;
    setFade({ o: 0, ms: 0 });
    fadingRef.current = false;
    orbitRealRef.current = Math.max(orbitRealRef.current, ORBIT_SEQ.titleScreen);
    orbitClockRef.current = orbitClockAt(orbitRealRef.current);
    goPdiRef.current = true;
    setGoPdi(true);
    titleRef.current = true;
    startedRef.current = true;
    setReturnTime(504000);
    setDescentResult(null);
    landingRef.current = null;
    captionRef.current = null;
    setCaption(null);
    undockSoundRef.current = new Set(UNDOCK_SOUND.map((_, i) => i));
    orbitCueRef.current = new Set(ORBIT_CUES.map((_, i) => i));
    setState(STATES.MENU);
  };

  // GO FOR PDI: the lunar module has undocked and separated (data/lunarOrbitShot
  // goForPdi); FLIGHT's call comes just before the descent setup opens.
  const overLandingZone = goPdi;
  const inLunarOrbit = ORBIT_STATES.has(state);

  // Mission control between the scripted flight and the manual phases:
  // the welcome on arrival in lunar orbit (ORBIT_CUES), and CAPCOM's go for
  // powered descent once the lunar module has separated, before the title.
  const goPdiCalledRef = useRef(false);
  useEffect(() => {
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
    if (state === STATES.ORBIT) {
      audio.stopRumble();
    }
    if (state === STATES.ORBIT) audio.padStop(5);
    if (state === STATES.COMPLETE) {
      audio.stopRumble();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

  // MISSION COMPLETE holds for 5 s over the splashdown, then the debrief takes over (MISSION DEBRIEF opens it at once).
  useEffect(() => {
    if (state !== STATES.COMPLETE || !debrief || debriefOpen) return undefined;
    const id = setTimeout(() => setDebriefOpen(true), 5000);
    return () => clearTimeout(id);
  }, [state, debrief, debriefOpen]);

  // Active flight (not menus, results or the control room): lets phones hide
  // the website navbar so the flight view and HUD get the full screen.
  useEffect(() => {
    document.documentElement.dataset.flight = FLIGHT_STATES.has(state) ? "1" : "";
  }, [state]);
  useEffect(() => () => {
    delete document.documentElement.dataset.flight;
  }, []);

  const label = STATE_LABELS[state] || { code: "", name: "" };
  const landedOn = mission.base; // TRANQUILITY BASE, HADLEY · SURFACE, …

  return (
    <main
      className="relative w-full h-screen overflow-hidden bg-[#050505] game-surface"
      data-testid="mission-page"
      data-opening={opening ? "1" : "0"}
    >
      {/* --- Scene layer --- */}

      {/* One scene for lunar orbit and the descent-prep screens: kept mounted
          across them so the camera never cuts or snaps. It is mounted under the
          launch from "Cutoff." (held on the arrival), so the cut lands on a drawn frame. */}
      {(inLunarOrbit || (state === STATES.LAUNCH && orbitAhead)) && (
        <MissionScene missionTime={ARRIVAL_TIME} cinematic={true} orbitClock={orbitClockRef} orbitReal={orbitRealRef} />
      )}

      {state === STATES.LAUNCH && (
        <LaunchCinematic audio={audio} onComplete={handleLaunchComplete} onSkip={handleSkipLaunch} onCutAhead={handleCutAhead} />
      )}

      {/* The title, once per mission: over the LM moving away after the go for powered descent,
          then held as the title screen until START MISSIONS */}
      {(state === STATES.ORBIT || state === STATES.TITLE) && (
        <MissionTitle clockRef={orbitClockRef} ready={state === STATES.TITLE} onStart={handleStartMissions} />
      )}

      {state === STATES.CONTROL && <ControlRoomView onLaunch={handleLaunch} />}

      {/* START MISSIONS: the game menu, in the title's place over the same shot */}
      {state === STATES.MENU && <ModeMenu onMissions={() => setState(STATES.SELECT)} onTraining={handleTraining} />}

      {/* MISSIONS: the four official destinations, then the pilot difficulty */}
      {state === STATES.SELECT && (
        <div className="absolute inset-0 z-40" data-testid="mission-select-layer">
          <MissionSelect selection={selection} log={missionLog} onConfirm={handleConfirmMission} onBack={() => setState(STATES.MENU)} />
        </div>
      )}

      {/* The descent briefing opens over the same shot: the destination and pilot
          difficulty just chosen on MISSIONS (CHANGE MISSION goes back there) */}
      {state === STATES.BRIEFING && (
        <div className="absolute inset-0 z-40 veil-in" data-testid="descent-setup" data-site={mission.siteId} data-difficulty={mission.difficulty}>
          <PdiBriefing difficulty={difficulty} mission={mission} onBegin={handleBeginPdi} onBack={() => setState(STATES.SELECT)} />
        </div>
      )}

      {/* Silent Horizon: the spacecraft go behind the Moon; loss of signal, then the descent */}
      {state === STATES.FAR_SIDE && (
        <div className="absolute inset-0 z-40" data-testid="far-side-los">
          <FarSideIntro audio={audio} briefing={mission.briefing} onDone={enterDescent} />
        </div>
      )}

      {/* The descent at the mission's destination (its terrain, landing zones and hazards);
          the results are shown over the landed lunar module at that site */}
      {(state === STATES.MANUAL_DESCENT || state === STATES.RESULT) && (
        <DescentGame
          difficulty={difficulty}
          site={mission.siteId}
          audio={audio}
          onSuccess={handleDescentEnd}
          onCrash={handleDescentEnd}
          onAbort={resetMission}
        />
      )}

      {state === STATES.RESULT && descentResult && (
        <div className="absolute inset-0 z-50" data-testid="mission-result-layer" data-site={mission.siteId}>
          <MissionResult
            result={descentResult}
            difficulty={difficulty}
            siteName={mission.name}
            onRestart={handleRestartDescent}
            onContinue={handleContinueFromResult}
            onEndMission={handleEndFailedMission}
          />
        </div>
      )}

      {/* Lunar surface: ascent preparation and liftoff, at the site and pose of the landing */}
      {state === STATES.ASCENT && (
        <LunarAscent
          siteId={mission.siteId}
          pose={landingRef.current && landingRef.current.pose}
          audio={audio}
          farSide={mission.comms.farSide}
          onComplete={handleAscentComplete}
        />
      )}

      {/* Lunar orbit: insertion, the automatic rendezvous, then the player's docking with the CSM */}
      {state === STATES.DOCKING && (
        <DockingOps
          difficulty={difficulty}
          farSide={mission.comms.farSide}
          audio={audio}
          onComplete={handleDockingComplete}
          onAbort={handlePhaseAbort}
          onResult={handleDockingResult}
        />
      )}

      {state === STATES.RETURN && (
        <MissionScene missionTime={returnTime} cinematic={true} />
      )}

      {state === STATES.REENTRY && (
        <ReentryGame
          difficulty={difficulty}
          audio={audio}
          onComplete={handleMissionComplete}
          onFailed={handleEntryLost}
          onAbort={handlePhaseAbort}
        />
      )}

      {state === STATES.COMPLETE && <ReentryScene final />}

      {/* --- Minimal HUD overlay (hidden in control room & during manual descent which has its own HUD) --- */}
      {state !== STATES.CONTROL && state !== STATES.SELECT && state !== STATES.MENU && state !== STATES.LAUNCH && state !== STATES.TITLE && state !== STATES.MANUAL_DESCENT && state !== STATES.RESULT && state !== STATES.FAR_SIDE && state !== STATES.BRIEFING && state !== STATES.REENTRY && state !== STATES.ASCENT && state !== STATES.DOCKING && state !== STATES.DEBRIEF && (
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

      {/* Shot caption, lower third (lunar orbit and undocking, return) */}
      {caption && (state === STATES.ORBIT || state === STATES.RETURN) && (
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

      {state === STATES.COMPLETE && !debriefOpen && (
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
              LV-001 · MISSION {mission.number} · {landedOn} · {difficulty} · PACIFIC SPLASHDOWN
            </p>
            <div className="flex flex-wrap gap-4 short:gap-3 justify-center">
              {debrief && (
                <button onClick={() => setDebriefOpen(true)} data-testid="btn-debrief" className="btn-hud btn-hud-primary">
                  {lang === "pt" ? "RELATÓRIO DA MISSÃO" : "MISSION DEBRIEF"} <ArrowUpRight size={14} />
                </button>
              )}
              <button
                onClick={resetMission}
                data-testid="btn-restart"
                className={`btn-hud ${debrief ? "" : "btn-hud-primary"}`}
              >
                <RotateCcw size={14} /> MAIN MENU
              </button>
              <Link to="/manifesto" className="btn-hud" data-testid="btn-manifesto">
                READ MANIFESTO <ArrowUpRight size={14} />
              </Link>
            </div>
          </div>
        </div>
      )}

      {/* LUNAVIA — MISSION DEBRIEF: after MISSION COMPLETE (over the splashdown), or a failed mission's END MISSION */}
      {((state === STATES.COMPLETE && debriefOpen) || state === STATES.DEBRIEF) && debrief && (
        <MissionDebrief
          data={debrief}
          lang={lang}
          onMissions={() => {
            resetMission();
            setState(STATES.SELECT);
          }}
          onRecords={() => {
            // straight to FLIGHT RECORDS (the flight has already ended): no reset to the menu first, which
            // would mount the lunar-orbit scene only to remove it in the same moment
            audio.commsReset();
            audio.stopRumble();
            navigate("/records");
          }}
          onMenu={resetMission}
        />
      )}

      {/* Global abort button — not shown during control, complete, or manual descent (which has its own) */}
      {state !== STATES.CONTROL &&
        state !== STATES.SELECT &&
        state !== STATES.MENU &&
        state !== STATES.TITLE &&
        state !== STATES.COMPLETE &&
        state !== STATES.MANUAL_DESCENT &&
        state !== STATES.FAR_SIDE &&
        state !== STATES.BRIEFING &&
        state !== STATES.REENTRY &&
        state !== STATES.DOCKING &&
        state !== STATES.RESULT &&
        state !== STATES.DEBRIEF && (
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
