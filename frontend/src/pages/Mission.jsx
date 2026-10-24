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
import LmCabin from "@/components/cabin/LmCabin";
import ManualAscent from "@/components/ManualAscent";
import LunarEva from "@/components/eva/LunarEva";
import DockingOps from "@/components/DockingOps";
import AbortModal from "@/components/AbortModal";
import useMissionAudio from "@/hooks/useMissionAudio";
import MissionTitle from "@/components/MissionTitle";
import MissionDebrief from "@/components/scoring/MissionDebrief";
import { useAudioSettings } from "@/audio/audioSettings";
import { setSubtitlePlacement } from "@/components/CommsSubtitles";
import { createFlightScoring, restoreFlightScoring } from "@/data/flightScoring";
import { applyAscent, applyDocking, applyEva, applyFlightStart, applyLanding, applyMission, applyReentry, loadRecords, unlockedBy, updateRecords } from "@/lib/missionRecords";
import { goForPdi } from "@/data/lunarOrbitShot";
import { ORBIT_ENTRY, ORBIT_SEQ, orbitClockAt, orbitShotAt } from "@/data/orbitSequence";
import { RETURN_CAPTIONS, RETURN_CUES, RETURN_LEN, returnMissionTime, returnShotAt } from "@/data/earthReturn";
import { formatMET } from "@/data/missionPhases";
import { TD } from "@/data/transposition";
import { TITLE } from "@/data/titleReveal";
import { MODE, createMissionConfig, evaAvailableAt } from "@/data/missionConfig";
import { freshEva } from "@/data/evaMissions";
import { loadMissionLog, loadSelection, logMissionAscent, logMissionComplete, logMissionDocking, logMissionEva, logMissionFlown, logMissionLanding, logMissionReentry, logMissionResumed, logMissionScoring, logMissionStart, saveSelection } from "@/lib/missionSelection";
import { CP, canResume, cpRank, makeCheckpoint, makeClosing, missionSaveStore, resumePlan } from "@/lib/missionSave";
import { BUILD_COMMIT } from "@/lib/buildInfo";
import { MissionSaveNotice, NewMissionConfirm } from "@/components/missions/MissionSaveUI";

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
 *
 * Mission checkpoints (lib/missionSave): an official flight is saved on the device
 * at each safe checkpoint it reaches — LUNAR DESCENT READY (destination and pilot
 * difficulty chosen), LUNAR LANDING COMPLETE (a safe touchdown), DOCKING READY
 * (rendezvous flown), DOCKING COMPLETE (hard dock), EARTH REENTRY READY — and the
 * save is closed at splashdown, END MISSION, ABORT or when a new mission replaces
 * it. RESUME MISSION (startup screen, game menu) restores the latest checkpoint
 * directly: the destination and difficulty, the scoring measured so far, the
 * lunar module's pose, the docking's attempt history; nothing before it is
 * replayed and nothing after it is counted as done. Each checkpoint has its own
 * restore method below (restoreDescentReady … restoreReentryReady).
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
  CABIN: "cabin",              // LM CABIN (optional): inside the landed lunar module, before or after the EVA
  EVA: "eva",                  // the optional lunar EVA from the ascent preparation (every destination), back to it
  MANUAL_ASCENT: "manual_ascent", // MANUAL ASCENT (optional, from the ascent preparation): the player flies the ascent stage to orbit
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
  eva: { code: "T+102:30:00", name: "LUNAR EVA" },
  manual_ascent: { code: "T+103:00:00", name: "LUNAR ASCENT · MANUAL" },
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

// The return's HUD name, by shot (data/earthReturn).
const RETURN_HUD = { tei: "TRANS-EARTH INJECTION", coast: "TRANSEARTH COAST", approach: "EARTH APPROACH" };

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
  STATES.CABIN,
  STATES.EVA,
  STATES.MANUAL_ASCENT,
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
  // The return to Earth: real seconds since it began (data/earthReturn), read by the scene
  // every frame; returnTime is the mission clock it shows.
  const returnRealRef = useRef(0);
  const returnCueRef = useRef(new Set());
  const [returnTime, setReturnTime] = useState(returnMissionTime(0));
  const [descentResult, setDescentResult] = useState(null);
  const [showAbort, setShowAbort] = useState(false);
  const rafRef = useRef(null);
  const lastTsRef = useRef(0);
  const stateRef = useRef(state);

  const audio = useMissionAudio();

  // The mission checkpoint (lib/missionSave): the store (the device's two slots), what it
  // holds, and what this flight's next checkpoint carries over (its pose, docking history).
  const saveStore = useMemo(() => missionSaveStore(), []);
  const [saveState, setSaveState] = useState(() => saveStore.state());
  // a saved mission is offered once every copy has been read (the app's files are read asynchronously)
  const resumable = canResume(saveState) && saveState.ready ? saveState.save : null;
  const ckRef = useRef(null); // { id, checkpoint, pose, docking, createdAt, activity }
  const [notice, setNotice] = useState(null); // MISSION CHECKPOINT SAVED / MISSION RESUMED
  const [confirmNew, setConfirmNew] = useState(null); // { sel }: START A NEW MISSION? before MISSIONS replaces a save
  const [dockResume, setDockResume] = useState(null); // a resumed docking's attempt history (DockingOps resume)
  // The lunar EVA (optional, from the ascent preparation): done on this flight (BEGIN EVA gives
  // way to the ascent alone), and the record a resumed EVA carries on from.
  const [evaDone, setEvaDone] = useState(false);
  // the ascent preparation was completed in the LM CABIN: the surface checklist shows it done
  const [ascentPrimed, setAscentPrimed] = useState(false);
  const [evaResume, setEvaResume] = useState(null);
  // MANUAL ASCENT: the attempt on screen (a retry remounts it), and the orbit the pilot flew,
  // which the rendezvous is planned from (null: the guided ascent's insertion)
  const [manualKey, setManualKey] = useState(0);
  const [manualAttempt, setManualAttempt] = useState(1); // the attempt on the pad (ignitions so far + 1)
  const [insertion, setInsertion] = useState(null);
  useEffect(() => {
    const off = saveStore.subscribe(setSaveState);
    saveStore.refresh().then(setSaveState);
    return off;
  }, [saveStore]);

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
        // TEI, the coast and the Earth approach (data/earthReturn), then the reentry.
        returnRealRef.current += dt;
        const seek = window.__lvReturnSeek; // validation tooling, as __lvOrbitSeek
        if (seek != null) {
          window.__lvReturnSeek = null;
          if (seek > returnRealRef.current) returnRealRef.current = seek;
        }
        const rt = returnRealRef.current;
        RETURN_CUES.forEach((c, i) => {
          if (rt < c.t || returnCueRef.current.has(i)) return;
          returnCueRef.current.add(i);
          if (rt - c.t > 0.5 && c.sound !== "burnStop") return; // skipped past (a burn always stops)
          if (c.line) audio.say(c.line);
          else if (c.sound === "hiss") audio.hiss(c.dur, c.vol);
          else if (c.sound === "thud") audio.thud?.(c.vol);
          else if (c.sound === "burn") {
            // The SPS heard through the structure (in vacuum nothing else carries it).
            audio.roarStart({ onboard: true });
            audio.roarSet(0.32, 0.9);
          } else if (c.sound === "burnStop") audio.roarStop(0.3);
        });
        const { step } = returnShotAt(rt);
        if (step !== captionRef.current) {
          captionRef.current = step;
          setCaption({ id: step, ...RETURN_CAPTIONS[step] });
        }
        setReturnTime(returnMissionTime(rt));
        if (rt >= RETURN_LEN) {
          captionRef.current = null;
          setCaption(null);
          setState(STATES.REENTRY);
        }
      }
      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* ---- mission checkpoints ------------------------------------------------------------------ */
  /**
   * Save this flight at `checkpoint` (or, with null, at its current checkpoint with what
   * changed: the activity, the scoring, the docking history). Only the store's validated
   * documents are written; MISSION CHECKPOINT SAVED shows when a later checkpoint is reached.
   */
  const persist = (checkpoint, patch = {}) => {
    const sc = scoringRef.current;
    const id = flightIdRef.current;
    if (!sc || !id) return false;
    const prev = ckRef.current && ckRef.current.id === id ? ckRef.current : null;
    const next = { id, checkpoint: null, pose: null, docking: null, eva: null, ascent: null, createdAt: Date.now(), activity: null, ...(prev || {}), ...patch };
    if (checkpoint) next.checkpoint = checkpoint;
    if (!next.checkpoint) return false;
    const res = saveStore.write(makeCheckpoint({ checkpoint: next.checkpoint, flight: sc.flight, activity: next.activity, pose: next.pose, docking: next.docking, eva: next.eva, ascent: next.ascent, createdAt: next.createdAt, build: BUILD_COMMIT }));
    if (!res.ok) {
      // eslint-disable-next-line no-console
      console.warn("[LUNAVIA] mission checkpoint not written:", res.reason);
      return false;
    }
    ckRef.current = next;
    if (!prev || cpRank(next.checkpoint) > cpRank(prev.checkpoint)) setNotice({ kind: "saved", checkpoint: next.checkpoint, at: Date.now() });
    return true;
  };
  const dockHistory = () => (ckRef.current && ckRef.current.docking) || { attempts: 1, restarts: 0, contacts: 0 };
  /** Close this flight's save (splashdown, END MISSION, ABORT): RESUME goes away; the history stays. */
  const closeSave = (status) => {
    const id = flightIdRef.current;
    const st = saveStore.state();
    if (id && st.save && st.save.attemptId === id && st.save.status === "active") {
      saveStore.write(makeClosing({ attemptId: id, status, checkpoint: st.save.checkpoint, mission: st.save.mission, build: BUILD_COMMIT }));
    }
    ckRef.current = null;
  };
  /**
   * START NEW MISSION (after the confirmation): the unfinished mission is closed. Flown, it ends
   * in the log as ABORTED with its partial score, exactly as leaving a flight always has; its
   * records, achievements and history entry are kept.
   */
  const abandonStoredMission = () => {
    const st = saveStore.state();
    if (!canResume(st)) return;
    const save = st.save;
    if (save.attemptId === flightIdRef.current) {
      endFlight("aborted");
      closeSave("abandoned");
      return;
    }
    if (save.flight.flown) {
      const sc = restoreFlightScoring(save.flight);
      const status = sc.status("aborted");
      sc.flight.ended = status;
      setMissionLog(logMissionScoring(save.attemptId, sc.summary(status)));
    }
    saveStore.write(makeClosing({ attemptId: save.attemptId, status: "abandoned", checkpoint: save.checkpoint, mission: save.mission, build: BUILD_COMMIT }));
  };

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
    // an unfinished mission is replaced (the player confirmed it when it had been flown or came
    // from an earlier session): closed first, so it can never come back in its place
    abandonStoredMission();
    endFlight("aborted"); // a flight left unfinished (CHANGE MISSION after a descent) ends as ABORTED
    closeSave("abandoned");
    flightIdRef.current = logMissionStart(next);
    scoringRef.current = createFlightScoring({ id: flightIdRef.current, ...next });
    setDockResume(null);
    setEvaDone(false);
    setAscentPrimed(false);
    setEvaResume(null);
    // checkpoint A — LUNAR DESCENT READY: the destination and difficulty, before powered descent
    persist(CP.DESCENT_READY, { activity: { phase: "briefing" }, createdAt: Date.now() });
    setDescentResult(null);
    setState(STATES.BRIEFING);
  };
  // MISSIONS → START MISSION: replacing an unfinished mission asks first (START A NEW MISSION?)
  const requestConfirmMission = (sel) => {
    const st = saveStore.state();
    if (canResume(st) && (st.save.attemptId !== flightIdRef.current || st.save.flight.flown)) {
      setConfirmNew({ sel });
      return;
    }
    handleConfirmMission(sel);
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
      persist(null, { activity: { phase: "descent" } }); // still checkpoint A: a descent cut short is flown again
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
      // checkpoint B — LUNAR LANDING COMPLETE, on a safe touchdown only (with where the LM rests)
      if (!result.crashed) persist(CP.LANDING_COMPLETE, { pose: result.pose || null, activity: { phase: "result" } });
      else persist(null, { activity: { phase: "result" } });
    }
    setState(STATES.RESULT);
  };

  // RESTART on the results: the descent again, same destination and pilot difficulty.
  const handleRestartDescent = () => {
    audio.commsFlush();
    setDescentResult(null);
    persist(CP.DESCENT_READY, { pose: null, activity: { phase: "briefing" } }); // the landing is flown again
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
    // F — MISSION COMPLETE: the results are in the records and the log; the save is closed
    closeSave("completed");
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
    persist(null, { activity: { phase: "reentry" } }); // the loss stays on the flight's record
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
    closeSave("abandoned");
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
  // INITIATE LUNAR ASCENT: the liftoff is under way (cut short, it is flown again from B)
  const handleAscentInitiate = () => {
    const a = ckRef.current && ckRef.current.ascent;
    // the guided ascent (after manual attempts, if any: they stay on the record)
    persist(null, { activity: { phase: "ascent" }, ...(a ? { ascent: { ...a, mode: "guided", outcome: null } } : {}) });
  };

  /* ---- MANUAL ASCENT ------------------------------------------------------------------------ */
  // the ascent record so far (attempts ignited), from the flight's checkpoint
  const ascentRecord = () => (ckRef.current && ckRef.current.ascent) || { mode: "manual", attempts: 0, outcome: null };
  // MANUAL ASCENT on the ascent preparation: the pad, engine armed (nothing burns until ignition)
  const handleManualAscent = () => {
    if (stateRef.current !== STATES.ASCENT) return;
    setManualAttempt(ascentRecord().attempts + 1);
    setManualKey((k) => k + 1);
    setState(STATES.MANUAL_ASCENT);
  };
  // ENGINE IGNITION: an attempt under way — counted at once, so closing the app cannot hide it
  // (it resumes at the ascent preparation, the attempt spent)
  const handleManualStart = () => {
    const a = ascentRecord();
    persist(null, { ascent: { mode: "manual", attempts: a.attempts + 1, outcome: null }, activity: { phase: "manualAscent" } });
  };
  // the attempt failed (impact, premature cutoff, no orbit, …): the logbook's record of it; the
  // checkpoint stays the ascent preparation
  const handleManualFailed = (r) => {
    const a = ascentRecord();
    if (flightIdRef.current) setMissionLog(logMissionAscent(flightIdRef.current, { ...r, attempts: a.attempts }));
    persist(null, { activity: { phase: "result" } });
  };
  // RETRY ASCENT: the ascent stage back on the descent stage, a fresh attempt from the checkpoint
  const handleManualRetry = () => {
    if (stateRef.current !== STATES.MANUAL_ASCENT) return;
    persist(null, { activity: { phase: "result" } });
    setManualAttempt(ascentRecord().attempts + 1);
    setManualKey((k) => k + 1);
  };
  // RETURN TO MENU: the game menu, the mission kept at its checkpoint (RESUME MISSION brings it back)
  const handleManualMenu = () => {
    if (stateRef.current !== STATES.MANUAL_ASCENT) return;
    persist(null, { activity: { phase: "result" } });
    resetMission({ keepSave: true });
  };
  // CONTINUE TO RENDEZVOUS: checkpoint ORBITAL INSERTION COMPLETE (the orbit flown, judged), the
  // logbook and the ascent's achievements (never points), then the guidance's rendezvous from it
  const handleManualInsertion = (r) => {
    if (stateRef.current !== STATES.MANUAL_ASCENT || !r || !r.success || !r.cut) return;
    const a = ascentRecord();
    const outcome = { success: true, apo: r.apo, peri: r.peri, fuelKg: r.fuelKg, fuelPct: r.fuelPct, accuracy: r.accuracy, cutoffBy: r.cutoffBy, burn: r.burn, rendezvousDv: r.rendezvousDv, cut: r.cut };
    const ascent = { mode: "manual", attempts: Math.max(1, a.attempts), outcome };
    persist(CP.ORBIT_INSERTION, { ascent, activity: { phase: "rendezvous" } });
    const sc = scoringRef.current;
    if (flightIdRef.current) setMissionLog(logMissionAscent(flightIdRef.current, { ...r, attempts: ascent.attempts }));
    if (sc && flightIdRef.current) updateRecords((rec) => applyAscent(rec, sc.flight, { mode: "manual", success: true, accuracy: r.accuracy }));
    setInsertion(r.cut);
    setDockResume(null);
    setState(STATES.DOCKING);
  };

  /* ---- LM CABIN (optional) --------------------------------------------------------------- */
  // ENTER CABIN on a safe landing's results or on the ascent preparation (before or after the
  // EVA): the inside of the landed LM. The checkpoint stays what it was (LANDING COMPLETE or EVA
  // COMPLETE); the save notes the player is in the cabin, so a resume reopens it.
  const handleEnterCabin = () => {
    const s0 = stateRef.current;
    if (s0 === STATES.RESULT) {
      if (!descentResult || descentResult.crashed) return;
      landingRef.current = descentResult;
      setDescentResult(null);
    } else if (s0 !== STATES.ASCENT) return;
    setAscentPrimed(false);
    persist(null, { activity: { phase: "cabin" } });
    setState(STATES.CABIN);
  };
  // EXIT CABIN, or CONTINUE TO ASCENT once the ascent preparation is done: the approved ascent
  // preparation on the surface (GUIDED or MANUAL ASCENT, BEGIN EVA if it is still to come)
  const handleCabinExit = (primed = false) => {
    if (stateRef.current !== STATES.CABIN) return;
    setAscentPrimed(!!primed);
    persist(null, { activity: { phase: "result" } });
    setState(STATES.ASCENT);
  };

  // BEGIN EVA on the ascent preparation (every destination its own expedition: data/evaMissions;
  // optional, never forced): the lunar EVA, the LM where it landed. EVA READY is saved at once and
  // with each objective done; back aboard with the hatch closed (EVA COMPLETE) the ascent
  // preparation returns, BEGIN EVA gone.
  const handleBeginEva = () => {
    if ((stateRef.current !== STATES.ASCENT && stateRef.current !== STATES.CABIN) || evaDone || !evaAvailableAt(missionRef.current.siteId)) return;
    persist(CP.EVA_READY, { eva: freshEva(missionRef.current.siteId), activity: { phase: "eva" } });
    setEvaResume(null);
    setState(STATES.EVA);
  };
  const handleEvaCheckpoint = (eva) => persist(CP.EVA_READY, { eva: { ...eva, completed: false }, activity: { phase: "eva" } });
  const handleEvaComplete = (eva) => {
    if (stateRef.current !== STATES.EVA) return;
    const done = { ...eva, completed: true };
    persist(CP.EVA_COMPLETE, { eva: done, activity: { phase: "eva" } });
    const sc = scoringRef.current;
    if (flightIdRef.current) setMissionLog(logMissionEva(flightIdRef.current, done));
    // the expedition's achievements only: the 1,000-point score does not include the EVA
    if (sc && flightIdRef.current) updateRecords((r) => applyEva(r, sc.flight, done));
    setEvaDone(true);
    setEvaResume(null);
    setState(STATES.ASCENT);
  };
  // Liftoff film over (or skipped): orbit insertion, rendezvous, docking.
  const handleAscentComplete = () => {
    if (stateRef.current !== STATES.ASCENT) return;
    persist(null, { activity: { phase: "rendezvous" } });
    setState(STATES.DOCKING);
  };
  // The docking's phases: RENDEZVOUS COMPLETE is checkpoint C — DOCKING READY; a retry after a
  // failed attempt is a new attempt; the crew transfer follows the hard dock (D).
  const handleDockPhase = (p) => {
    if (p === "handover") persist(CP.DOCKING_READY, { docking: dockHistory(), activity: { phase: "docking", engaged: false } });
    else if (p === "docking") {
      const ck = ckRef.current;
      if (ck && ck.activity && ck.activity.phase === "dockFailed") {
        const d = dockHistory();
        persist(null, { docking: { attempts: d.attempts + 1, restarts: d.restarts + 1, contacts: d.contacts }, activity: { phase: "docking", engaged: false } });
      }
    } else if (p === "transfer") persist(null, { activity: { phase: "transfer" } });
  };
  // the player's first input in a docking attempt: closing the app from here counts as a restart
  const handleDockEngaged = () => {
    const ck = ckRef.current;
    if (ck && ck.checkpoint === CP.DOCKING_READY) persist(null, { activity: { phase: "docking", engaged: true } });
  };
  // Hard dock, crew transfer, ascent stage jettisoned: the CSM heads home (the existing return).
  const handleDockingComplete = () => {
    if (stateRef.current !== STATES.DOCKING) return;
    setDockResume(null);
    returnRealRef.current = 0;
    returnCueRef.current = new Set();
    captionRef.current = null;
    setReturnTime(returnMissionTime(0));
    setState(STATES.RETURN);
  };
  // SKIP CINEMATIC on the way home: straight to the reentry's EARTH APPROACH (the engine,
  // if it is burning, stops).
  const handleSkipReturn = () => {
    if (stateRef.current !== STATES.RETURN) return;
    returnRealRef.current = RETURN_LEN;
    returnCueRef.current = new Set(RETURN_CUES.map((_, i) => i));
    audio.roarStop(0.2);
    captionRef.current = null;
    setCaption(null);
    setState(STATES.REENTRY);
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
    if (!r || !sc) return;
    const hist = { attempts: r.attempts || 1, restarts: r.restarts || 0, contacts: r.contacts || 0 };
    // checkpoint D — DOCKING COMPLETE at the hard dock (its telemetry, score and attempt history)
    if (r.success) persist(CP.DOCKING_COMPLETE, { docking: hist, activity: { phase: "transfer" } });
    else if (r.failure === "restart") persist(null, { docking: { ...hist, attempts: hist.attempts + 1 }, activity: { phase: "docking", engaged: false } });
    else persist(null, { docking: hist, activity: { phase: "dockFailed" } });
  };

  // ABORT, END MISSION, MAIN MENU: back to the game menu, over lunar orbit as left by
  // the opening (the title screen's shot). The opening is not replayed; the next
  // mission is chosen afresh on MISSIONS.
  const resetMission = (opts = {}) => {
    // RETURN TO MENU from the manual ascent keeps the flight at its checkpoint (resumable)
    if (!(opts && opts.keepSave === true)) {
      endFlight("aborted"); // a flight still under way ends as ABORTED (nothing if it already ended)
      closeSave("abandoned"); // and its checkpoint with it (nothing if it was already closed)
    }
    setDockResume(null);
    setInsertion(null);
    setEvaDone(false);
    setEvaResume(null);
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
    returnRealRef.current = 0;
    setReturnTime(returnMissionTime(0));
    setDescentResult(null);
    landingRef.current = null;
    captionRef.current = null;
    setCaption(null);
    undockSoundRef.current = new Set(UNDOCK_SOUND.map((_, i) => i));
    orbitCueRef.current = new Set(ORBIT_CUES.map((_, i) => i));
    setState(STATES.MENU);
  };

  /* ---- RESUME MISSION ----------------------------------------------------------------------- */
  // Each checkpoint's own restore: the phase it reopens, from the state the checkpoint kept.
  // A — LUNAR DESCENT READY: the descent briefing over lunar orbit (BEGIN PDI), as after MISSIONS.
  const restoreDescentReady = () => {
    preloadMissionScene();
    persist(null, { activity: { phase: "briefing" } });
    setState(STATES.BRIEFING);
  };
  // B — LUNAR LANDING COMPLETE: the lunar surface, ascent preparation, the LM where it landed
  // (an unusable pose was already dropped by the store: the site's landing point is used).
  const restoreLandingComplete = (save) => {
    landingRef.current = { pose: save.landing ? save.landing.pose : null };
    // EVA COMPLETE resumes here too: the EVA is done (BEGIN EVA does not come back)
    setEvaDone(!!(save.eva && save.eva.completed));
    persist(null, { activity: { phase: "result" } });
    setState(STATES.ASCENT);
  };
  // LANDING / EVA COMPLETE with the player in the LM CABIN: the cabin again, from its start
  // (the window station, its checklists fresh: a short preparation is simply done again)
  const restoreCabin = (save) => {
    landingRef.current = { pose: save.landing ? save.landing.pose : null };
    setEvaDone(!!(save.eva && save.eva.completed));
    persist(null, { activity: { phase: "cabin" } });
    setState(STATES.CABIN);
  };
  // EVA READY: the lunar EVA again, the LM where it landed, the objectives already done kept (at
  // the foot of the ladder once the first steps are taken, otherwise from the hatch).
  const restoreEvaReady = (save, plan) => {
    landingRef.current = { pose: save.landing ? save.landing.pose : null };
    setEvaDone(false);
    setEvaResume(plan.eva);
    persist(null, { activity: { phase: "eva" } });
    setState(STATES.EVA);
  };
  // C — DOCKING READY: the playable docking at its checkpoint, with the attempt history (an
  // attempt the interruption cut short is reported as a restart first, as RESTART DOCKING does).
  const restoreDockingReady = (save, plan) => {
    // a manual ascent's rendezvous was planned from the orbit flown (the docking itself is the same)
    setInsertion(save.ascent && save.ascent.outcome ? save.ascent.outcome.cut : null);
    if (plan.restartReport) handleDockingResult(plan.restartReport);
    persist(null, { docking: plan.docking, activity: { phase: "docking", engaged: false } });
    setDockResume(plan.docking);
    setState(STATES.DOCKING);
  };
  // ORBITAL INSERTION COMPLETE: the manual ascent's orbit, as flown; the guidance's rendezvous from
  // it again (a film: nothing of the player's is replayed), then the docking checkpoint
  const restoreOrbitInsertion = (save) => {
    setInsertion(save.ascent.outcome.cut);
    setDockResume(null);
    persist(null, { activity: { phase: "rendezvous" } });
    setState(STATES.DOCKING);
  };
  // D — DOCKING COMPLETE: the CSM alone, the crew aboard, on the way home (no docking, no ascent stage).
  const restoreDockingComplete = () => {
    returnRealRef.current = 0;
    returnCueRef.current = new Set();
    captionRef.current = null;
    setReturnTime(returnMissionTime(0));
    setState(STATES.RETURN);
  };
  // E — EARTH REENTRY READY: the reentry from its start (EARTH APPROACH).
  const restoreReentryReady = () => setState(STATES.REENTRY);
  const RESTORE = { briefing: restoreDescentReady, ascent: restoreLandingComplete, cabin: restoreCabin, eva: restoreEvaReady, insertion: restoreOrbitInsertion, docking: restoreDockingReady, return: restoreDockingComplete, reentry: restoreReentryReady };

  /**
   * RESUME MISSION (startup screen or game menu, never automatic): the saved flight carries on
   * from its latest valid checkpoint — same flight id (history, records marks), destination,
   * pilot difficulty and scoring; nothing before the checkpoint is replayed (no launch, lunar
   * orbit film, title or selection) and no cinematic or reward is triggered again.
   */
  const handleResume = () => {
    const s0 = stateRef.current;
    if (s0 !== STATES.CONTROL && s0 !== STATES.MENU) return;
    const st = saveStore.state();
    if (!canResume(st)) return;
    const save = st.save;
    const plan = resumePlan(save);
    if (!plan || !RESTORE[plan.state]) return;
    stateRef.current = plan.state; // once
    audio.init();
    audio.padStop(0.5);
    const sel = saveSelection(save.mission);
    setSelection(sel);
    missionRef.current = createMissionConfig({ mode: MODE.OFFICIAL, ...sel });
    flightIdRef.current = save.attemptId;
    const sc = restoreFlightScoring(save.flight);
    scoringRef.current = sc;
    setMissionLog(logMissionResumed(save.attemptId, { siteId: sel.siteId, difficulty: sel.difficulty, at: save.createdAt, flown: !!save.flight.flown }));
    if (sc.flight.flown) updateRecords((r) => applyFlightStart(r, sc.flight)); // once per flight id: a no-op unless the records were lost
    // an EVA the save says was completed: its achievement and its log entry, if the web view's
    // storage lost them (both are no-ops when they are already there)
    if (save.eva && save.eva.completed) {
      updateRecords((r) => applyEva(r, sc.flight, save.eva));
      const entry = loadMissionLog().find((x) => x.id === save.attemptId);
      if (entry && !entry.eva) setMissionLog(logMissionEva(save.attemptId, save.eva));
    }
    // a manual insertion the save holds: its achievements and its log entry, if the web view lost them
    if (save.ascent && save.ascent.outcome) {
      const o = save.ascent.outcome;
      updateRecords((r) => applyAscent(r, sc.flight, { mode: "manual", success: true, accuracy: o.accuracy }));
      const entry = loadMissionLog().find((x) => x.id === save.attemptId);
      if (entry && !(entry.ascent && entry.ascent.success)) setMissionLog(logMissionAscent(save.attemptId, { ...o, attempts: save.ascent.attempts, difficulty: sel.difficulty }));
    }
    ckRef.current = { id: save.attemptId, checkpoint: save.checkpoint, pose: save.landing ? save.landing.pose : null, docking: save.docking, eva: save.eva || null, ascent: save.ascent || null, createdAt: save.createdAt, activity: save.activity };
    // the opening is behind this flight: lunar orbit as left at the title screen, every cue spent
    orbitRealRef.current = Math.max(orbitRealRef.current, ORBIT_SEQ.titleScreen);
    orbitClockRef.current = orbitClockAt(orbitRealRef.current);
    goPdiRef.current = true;
    setGoPdi(true);
    titleRef.current = true;
    startedRef.current = true;
    undockSoundRef.current = new Set(UNDOCK_SOUND.map((_, i) => i));
    orbitCueRef.current = new Set(ORBIT_CUES.map((_, i) => i));
    setOrbitAhead(false);
    setDebrief(null);
    setDebriefOpen(false);
    setDescentResult(null);
    setDockResume(null);
    setInsertion(null);
    RESTORE[plan.state](save, plan);
    setNotice({ kind: "resumed", checkpoint: save.checkpoint, interrupted: plan.interrupted, fallback: !!st.fallback, cabin: plan.state === "cabin", at: Date.now() });
  };

  // The way home and the reentry, however they are reached (the return's end, SKIP, a resume):
  // RETURN is the latest return checkpoint (D); the reentry is checkpoint E — EARTH REENTRY READY.
  useEffect(() => {
    if (state === STATES.RETURN) persist(null, { activity: { phase: "return" } });
    if (state === STATES.REENTRY) persist(CP.REENTRY_READY, { activity: { phase: "reentry" } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state]);

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

  // Over the splashdown and MISSION COMPLETE, a caption still on the air stays in its corner (CommsSubtitles).
  useEffect(() => {
    if (state !== STATES.COMPLETE) return undefined;
    setSubtitlePlacement("corner");
    return () => setSubtitlePlacement("default");
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

  const label =
    state === STATES.RETURN
      ? { code: formatMET(returnTime), name: RETURN_HUD[returnShotAt(returnRealRef.current).shot] }
      : STATE_LABELS[state] || { code: "", name: "" };
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

      {state === STATES.CONTROL && (
        <ControlRoomView
          onLaunch={handleLaunch}
          saved={resumable}
          saveProblem={saveState.ready && (saveState.status === "damaged" || saveState.status === "unsupported") ? saveState.status : null}
          lang={lang}
          onResume={handleResume}
          onReplaceSave={abandonStoredMission}
        />
      )}

      {/* START MISSIONS: the game menu, in the title's place over the same shot */}
      {state === STATES.MENU && <ModeMenu onMissions={() => setState(STATES.SELECT)} onTraining={handleTraining} saved={resumable} lang={lang} onResume={handleResume} />}

      {/* MISSIONS: the four official destinations, then the pilot difficulty */}
      {state === STATES.SELECT && (
        <div className="absolute inset-0 z-40" data-testid="mission-select-layer">
          <MissionSelect selection={selection} log={missionLog} onConfirm={requestConfirmMission} onBack={() => setState(STATES.MENU)} />
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
            onEnterCabin={handleEnterCabin}
            lang={lang}
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
          onInitiate={handleAscentInitiate}
          lang={lang}
          evaAvailable={evaAvailableAt(mission.siteId) && !evaDone}
          onBeginEva={handleBeginEva}
          onManual={handleManualAscent}
          onEnterCabin={handleEnterCabin}
          cabinAgain={evaDone}
          primed={ascentPrimed}
        />
      )}

      {/* LM CABIN: inside the landed lunar module (optional); out to the EVA or to the ascent preparation */}
      {state === STATES.CABIN && (
        <LmCabin
          siteId={mission.siteId}
          pose={landingRef.current && landingRef.current.pose}
          result={landingRef.current && landingRef.current.touchdownSpeed !== undefined ? landingRef.current : null}
          audio={audio}
          lang={lang}
          farSide={mission.comms.farSide}
          evaAvailable={evaAvailableAt(mission.siteId)}
          evaDone={evaDone}
          onBeginEva={handleBeginEva}
          onAscent={() => handleCabinExit(true)}
          onExit={() => handleCabinExit(false)}
        />
      )}

      {/* MANUAL ASCENT: the ascent stage flown by the player into lunar orbit (a retry remounts it) */}
      {state === STATES.MANUAL_ASCENT && (
        <ManualAscent
          key={`manual-${manualKey}`}
          siteId={mission.siteId}
          pose={landingRef.current && landingRef.current.pose}
          difficulty={difficulty}
          farSide={mission.comms.farSide}
          audio={audio}
          lang={lang}
          attempt={manualAttempt}
          onStart={handleManualStart}
          onFailed={handleManualFailed}
          onInsertion={handleManualInsertion}
          onRetry={handleManualRetry}
          onMenu={handleManualMenu}
        />
      )}

      {/* The lunar EVA (the destination's expedition): the LM where it landed; back aboard, the ascent preparation */}
      {state === STATES.EVA && (
        <LunarEva
          siteId={mission.siteId}
          pose={landingRef.current && landingRef.current.pose}
          audio={audio}
          lang={lang}
          resume={evaResume}
          onCheckpoint={handleEvaCheckpoint}
          onComplete={handleEvaComplete}
          onAbort={() => setShowAbort(true)}
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
          resume={dockResume}
          onPhase={handleDockPhase}
          onEngaged={handleDockEngaged}
          insertion={insertion}
        />
      )}

      {state === STATES.RETURN && (
        <MissionScene missionTime={returnTime} cinematic={true} returnClock={returnRealRef} />
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
      {state !== STATES.CONTROL && state !== STATES.SELECT && state !== STATES.MENU && state !== STATES.LAUNCH && state !== STATES.TITLE && state !== STATES.MANUAL_DESCENT && state !== STATES.RESULT && state !== STATES.FAR_SIDE && state !== STATES.BRIEFING && state !== STATES.REENTRY && state !== STATES.ASCENT && state !== STATES.CABIN && state !== STATES.EVA && state !== STATES.MANUAL_ASCENT && state !== STATES.DOCKING && state !== STATES.DEBRIEF && (
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

      {/* The way home can be skipped to the reentry's EARTH APPROACH. */}
      {state === STATES.RETURN && (
        <button
          type="button"
          data-testid="skip-return"
          onClick={handleSkipReturn}
          className="absolute bottom-6 short:bottom-2 right-6 md:right-10 safe-mr safe-mb z-30 font-mono text-[10px] tracking-[0.3em] text-zinc-400 hover:text-white px-3 py-2 touch:min-h-[44px] touch:px-4 bg-black/30 border border-white/10"
        >
          SKIP CINEMATIC ›
        </button>
      )}

      {state === STATES.COMPLETE && !debriefOpen && (
        <div
          data-testid="complete-overlay"
          className="absolute inset-0 flex items-center justify-center bg-gradient-to-b from-black/10 via-black/35 to-black/55 z-50"
        >
          <div className="text-center max-w-2xl px-8 scan-in">
            <div className="font-mono text-[10px] tracking-[0.4em] text-[#FF3B00] blink mb-4">
              ● SPLASHDOWN · CREW SAFE
            </div>
            <div className="font-display font-bold text-zinc-300 text-xl md:text-2xl tracking-[0.3em] mb-1">LUNAVIA —</div>
            <h2 className="font-display font-black text-white text-6xl md:text-7xl short:text-5xl mb-6">
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

      {/* Global abort button — not shown during control, complete, or manual descent (which has its own);
          the lunar EVA has its own too (PAUSE → ABORT MISSION) */}
      {state !== STATES.CONTROL &&
        state !== STATES.EVA &&
        state !== STATES.CABIN &&
        state !== STATES.MANUAL_ASCENT &&
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

      {/* MISSION CHECKPOINT SAVED / MISSION RESUMED (top centre, brief, nothing to tap) */}
      <MissionSaveNotice notice={notice} lang={lang} below={state === STATES.EVA ? "lane" : state === STATES.MANUAL_ASCENT || state === STATES.DOCKING || state === STATES.REENTRY || state === STATES.MANUAL_DESCENT || state === STATES.RETURN ? "hud" : "nav"} />
      {/* START A NEW MISSION? — MISSIONS replacing an unfinished mission */}
      <NewMissionConfirm
        open={!!confirmNew}
        lang={lang}
        onCancel={() => setConfirmNew(null)}
        onConfirm={() => {
          const sel = confirmNew && confirmNew.sel;
          setConfirmNew(null);
          if (sel) handleConfirmMission(sel);
        }}
      />

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
