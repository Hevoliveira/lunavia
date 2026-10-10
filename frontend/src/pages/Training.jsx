import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ArrowLeft, Check, ChevronRight, Lock, Play, RotateCcw, Trophy, Volume2, VolumeX } from "lucide-react";
import DescentGame from "@/components/DescentGame";
import ReentryGame from "@/components/ReentryGame";
import BuildBadge from "@/components/BuildBadge";
import useMissionAudio from "@/hooks/useMissionAudio";
import { DIFFICULTY } from "@/data/landingPhysics";
import {
  DIFFICULTY_KEYS,
  LANDING_SCENARIOS,
  REENTRY_SCENARIOS,
  findScenario,
  difficultyFor,
} from "@/data/trainingScenarios";
import { landingCoach, createReentryCoach, COACH_LEVEL } from "@/data/trainingCoach";
import { landingDebrief, reentryDebrief } from "@/data/trainingDebrief";
import { loadProgress, recordAttempt, progressKey, totals, bestsFor } from "@/lib/trainingProgress";

/*
 * Flight Training Center: practise the two flight-control problems of the
 * mission on their own. Each attempt runs the mission's own DescentGame or
 * ReentryGame (same physics, controls, limits and grading) from a training
 * start, with an instructor whose detail depends on the difficulty.
 */

const DISCIPLINES = {
  landing: {
    title: "LUNAR LANDING SIMULATOR",
    craft: "LM-1 · POWERED DESCENT",
    blurb: "Practice descending and landing on the Moon.",
    scenarios: LANDING_SCENARIOS,
  },
  reentry: {
    title: "EARTH REENTRY SIMULATOR",
    craft: "CM-1 · LUNAR-RETURN ENTRY",
    blurb: "Practice surviving atmospheric reentry and landing safely in the ocean.",
    scenarios: REENTRY_SCENARIOS,
  },
};

const GUIDANCE_NOTE = {
  full: "Full instructor: frequent callouts with explanations.",
  key: "Concise instructor: warnings and key events.",
  minimal: "Minimal: objective and outcome only.",
};

const VOICE_KEY = "lunavia.training.voice";

const TOTAL_SLOTS =
  (LANDING_SCENARIOS.filter((s) => !s.lock).length + REENTRY_SCENARIOS.filter((s) => !s.lock).length) * DIFFICULTY_KEYS.length +
  LANDING_SCENARIOS.filter((s) => s.lock).length +
  REENTRY_SCENARIOS.filter((s) => s.lock).length;

function Backdrop() {
  return (
    <div aria-hidden className="absolute inset-0 overflow-hidden pointer-events-none">
      <div className="absolute inset-0 grid-bg opacity-40" />
      <div
        className="absolute rounded-full"
        style={{
          width: "240vmax",
          height: "240vmax",
          left: "50%",
          top: "68%",
          transform: "translateX(-50%)",
          background: "radial-gradient(circle at 50% 0%, #0d2036 0%, #060a10 18%, #050505 40%)",
          boxShadow: "0 -1px 0 rgba(140,190,255,0.55), 0 -10px 60px rgba(70,140,255,0.28)",
        }}
      />
      <div
        className="absolute rounded-full opacity-60"
        style={{
          width: "min(16vmin, 120px)",
          height: "min(16vmin, 120px)",
          right: "5%",
          top: "56%",
          backgroundImage: `url(${process.env.PUBLIC_URL}/textures/planets/moon_1024.jpg)`,
          backgroundSize: "cover",
          boxShadow: "inset -14px -6px 24px rgba(0,0,0,0.85)",
        }}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-black/50 via-transparent to-black/60" />
    </div>
  );
}

function Stat({ label, value }) {
  return (
    <div className="font-mono text-[9px] tracking-[0.25em] text-zinc-500">
      {label} <span className="text-white tabular ml-1">{value}</span>
    </div>
  );
}

function VoiceToggle({ on, onToggle, className = "" }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={!on}
      data-testid="training-voice"
      className={`min-h-[44px] px-3 border font-mono text-[9px] tracking-[0.2em] flex items-center gap-1.5 ${
        on ? "border-white/20 text-zinc-300" : "border-[#FF3B00]/50 text-[#FF3B00]"
      } ${className}`}
    >
      {on ? <Volume2 size={12} /> : <VolumeX size={12} />}
      {on ? "INSTRUCTOR VOICE ON" : "INSTRUCTOR MUTED"}
    </button>
  );
}

const fmt = (x, d = 0, unit = "") => (x === null || x === undefined ? "—" : `${x.toFixed(d)}${unit}`);

function RecordsPanel({ progress }) {
  const landingIds = LANDING_SCENARIOS.map((s) => s.id);
  const reentryIds = REENTRY_SCENARIOS.map((s) => s.id);
  const th = "font-mono text-[8px] tracking-[0.2em] text-zinc-500 text-left font-normal py-1 pr-2";
  const td = "font-mono text-[11px] short:text-[10px] text-white tabular py-1 pr-2 border-t border-white/10";
  return (
    <div className="grid md:grid-cols-2 short:grid-cols-2 gap-4 short:gap-2.5 mt-6 short:mt-2" data-testid="training-records">
      <div className="hud-panel corners relative bg-black/60 border border-white/10 p-4 short:p-2.5">
        <div className="font-mono text-[9px] tracking-[0.3em] text-[#FF3B00] mb-1">LUNAR LANDING · PERSONAL BESTS</div>
        <table className="w-full">
          <thead>
            <tr><th className={th}>LEVEL</th><th className={th}>RUNS</th><th className={th}>GRADE</th><th className={th}>FUEL</th><th className={th}>LZ DIST</th></tr>
          </thead>
          <tbody>
            {DIFFICULTY_KEYS.map((k) => {
              const b = bestsFor(progress, "landing", k, landingIds);
              return (
                <tr key={k} data-testid={`records-landing-${k}`}>
                  <td className={td}>{k}</td>
                  <td className={td}>{b.successes}/{b.attempts}</td>
                  <td className={td}>{b.bestGrade || "—"}</td>
                  <td className={td}>{fmt(b.bestFuel, 0, " %")}</td>
                  <td className={td}>{fmt(b.bestAccuracy, 1, " m")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="hud-panel corners relative bg-black/60 border border-white/10 p-4 short:p-2.5">
        <div className="font-mono text-[9px] tracking-[0.3em] text-[#FF3B00] mb-1">EARTH REENTRY · PERSONAL BESTS</div>
        <table className="w-full">
          <thead>
            <tr><th className={th}>LEVEL</th><th className={th}>RUNS</th><th className={th}>SCENARIOS</th><th className={th}>LOWEST G</th></tr>
          </thead>
          <tbody>
            {DIFFICULTY_KEYS.map((k) => {
              const b = bestsFor(progress, "reentry", k, reentryIds);
              const avail = REENTRY_SCENARIOS.filter((s) => !s.lock || s.lock === k).length;
              return (
                <tr key={k} data-testid={`records-reentry-${k}`}>
                  <td className={td}>{k}</td>
                  <td className={td}>{b.successes}/{b.attempts}</td>
                  <td className={td}>{b.passed.length}/{avail}</td>
                  <td className={td}>{fmt(b.bestPeakG, 1, " g")}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="md:col-span-2 short:col-span-2 font-mono text-[9px] tracking-wider text-zinc-500">
        Kept on this device only, separate from the full mission. Removed if the app is deleted.
      </p>
    </div>
  );
}

export default function Training() {
  const navigate = useNavigate();
  const audio = useMissionAudio();
  const [discipline, setDiscipline] = useState(null);
  const [showRecords, setShowRecords] = useState(false);
  const [scenarioId, setScenarioId] = useState("standard");
  const [chosenDiff, setChosenDiff] = useState("CADET");
  const [view, setView] = useState("center"); // center | run | debrief
  const [runKey, setRunKey] = useState(0);
  const [debrief, setDebrief] = useState(null);
  const [progress, setProgress] = useState(() => loadProgress());
  const [voiceOn, setVoiceOn] = useState(() => {
    try {
      return window.localStorage.getItem(VOICE_KEY) !== "off";
    } catch {
      return true;
    }
  });
  // The selection a run was started with (callbacks read it, not the UI state).
  const runRef = useRef(null);
  const voiceRef = useRef(voiceOn);
  voiceRef.current = voiceOn;

  const scenario = discipline ? findScenario(discipline, scenarioId) : null;
  const difficulty = scenario ? difficultyFor(scenario, chosenDiff) : chosenDiff;
  const sum = totals(progress);

  // Flight views get the whole screen (the phone layout hides the site navbar).
  const flying = view !== "center";
  useEffect(() => {
    document.documentElement.dataset.flight = flying ? "1" : "";
  }, [flying]);
  useEffect(() => () => {
    delete document.documentElement.dataset.flight;
  }, []);

  // The audio hook returns a new object each render; read it through a ref.
  // (It stops everything itself when the page unmounts.)
  const audioRef = useRef(audio);
  audioRef.current = audio;
  const stopSounds = () => {
    const a = audioRef.current;
    a.stopRumble();
    a.roarStop(0.2);
    a.ambienceStop(0.3);
    a.padStop(0.5);
  };

  const toggleVoice = () => {
    setVoiceOn((v) => {
      const next = !v;
      try {
        window.localStorage.setItem(VOICE_KEY, next ? "on" : "off");
      } catch {
        // not kept; the choice still applies to this session
      }
      return next;
    });
  };

  const chooseDiscipline = (d) => {
    setDiscipline(d);
    setShowRecords(false);
    setScenarioId(DISCIPLINES[d].scenarios[0].id);
  };

  const start = () => {
    audio.init();
    runRef.current = { discipline, scenarioId: scenario.id, difficulty };
    setDebrief(null);
    setRunKey((k) => k + 1);
    setView("run");
  };

  const finish = useCallback((db) => {
    const r = runRef.current;
    setProgress(recordAttempt(r.discipline, r.scenarioId, r.difficulty, db.record));
    setDebrief(db);
    setView("debrief");
  }, []);

  const onLanding = useCallback(
    (result) => {
      const r = runRef.current;
      const cfg = DIFFICULTY[r.difficulty];
      const init = findScenario("landing", r.scenarioId).init(r.difficulty);
      finish(landingDebrief(result, r.scenarioId, cfg, init ? init.fuel / cfg.initialFuel : 1));
    },
    [finish]
  );
  const onReentry = useCallback((data) => finish(reentryDebrief(data)), [finish]);

  const retry = () => {
    stopSounds();
    setDebrief(null);
    setRunKey((k) => k + 1);
    setView("run");
  };
  const toScenarios = () => {
    stopSounds();
    setDebrief(null);
    setView("center");
  };
  const toCenter = () => {
    toScenarios();
    setDiscipline(null);
  };
  const toMenu = () => {
    stopSounds();
    navigate("/");
  };

  // Desktop shortcut on the debrief: R retries.
  useEffect(() => {
    if (view !== "debrief") return undefined;
    const key = (e) => {
      if (e.code === "KeyR") retry();
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  });

  const run = runRef.current;
  // A fresh instructor for every attempt. The optional voice speaks a short
  // phrase when the callout changes: on-device speech, never over another
  // call (Houston's comms win), at most one phrase every 4 s.
  const coach = useMemo(() => {
    if (!run) return null;
    const base = run.discipline === "reentry" ? createReentryCoach(run.scenarioId, run.difficulty) : (d) => landingCoach(d, run.scenarioId, run.difficulty);
    const speaks = COACH_LEVEL[run.difficulty] !== "minimal";
    let lastTitle = null;
    let lastSpoke = -Infinity;
    return (input) => {
      const l = base(input);
      const title = l ? l.title : null;
      if (title !== lastTitle) {
        lastTitle = title;
        const synth = window.speechSynthesis;
        const now = performance.now();
        if (l && l.say && speaks && voiceRef.current && now - lastSpoke > 4000 && !(synth && synth.speaking)) {
          lastSpoke = now;
          audioRef.current.speak(l.say, { rate: 1.05, pitch: 1.1 });
        }
      }
      return l;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runKey]);

  return (
    <main className="relative w-full h-screen overflow-hidden bg-[#050505] game-surface" data-testid="training-page">
      {view === "center" && (
        <>
          <Backdrop />
          <div className="relative z-10 h-full overflow-y-auto safe-px" data-testid="training-center">
            <div className="max-w-[1180px] mx-auto px-6 md:px-10 pt-24 pb-10 short:pt-14 short:pb-4 short:px-4">
              {/* Header */}
              <div className="flex items-end justify-between gap-4 flex-wrap">
                <div>
                  <div className={`font-mono text-[10px] tracking-[0.4em] text-[#FF3B00] scan-in ${discipline ? "short:hidden" : ""}`}>● LUNAVIA · ASTRONAUT TRAINING</div>
                  <h1 className={`font-display font-black text-white text-4xl md:text-5xl short:text-2xl tracking-tight mt-2 ${discipline ? "short:mt-0 short:text-xl" : "short:mt-1"}`}>
                    FLIGHT TRAINING CENTER
                  </h1>
                </div>
                <div className="flex flex-col items-end">
                  <div className="flex gap-5 short:gap-3" data-testid="training-progress">
                    <Stat label="ATTEMPTS" value={sum.attempts} />
                    <Stat label="SUCCESSFUL" value={sum.successes} />
                    <Stat label="COMPLETED" value={`${sum.completed}/${TOTAL_SLOTS}`} />
                  </div>
                  {!discipline && <BuildBadge className="!py-0 !min-h-0 !text-[8px] !text-zinc-600 mt-1" />}
                </div>
              </div>

              {!discipline && showRecords && (
                <>
                  <RecordsPanel progress={progress} />
                  <div className="mt-4 short:mt-2">
                    <button type="button" onClick={() => setShowRecords(false)} className="btn-hud min-h-[44px]" data-testid="records-back">
                      <ArrowLeft size={14} /> SIMULATORS
                    </button>
                  </div>
                </>
              )}

              {!discipline && !showRecords && (
                <>
                  <p className="text-zinc-400 text-sm short:text-xs mt-4 short:mt-2 max-w-2xl">
                    Practise the mission&apos;s two flight-control challenges on their own, with the same physics, controls and
                    limits as the full mission. No launch, no cruise: straight to the problem.
                  </p>
                  <div className="grid md:grid-cols-2 short:grid-cols-2 gap-5 short:gap-3 mt-8 short:mt-3">
                    {Object.entries(DISCIPLINES).map(([key, d]) => (
                      <button
                        key={key}
                        type="button"
                        onClick={() => chooseDiscipline(key)}
                        data-testid={`training-discipline-${key}`}
                        className="group text-left hud-panel corners relative bg-black/55 border border-white/10 hover:border-[#FF3B00]/70 p-6 short:p-3.5 transition-colors"
                      >
                        <div className="font-mono text-[10px] tracking-[0.3em] text-zinc-500">{d.craft}</div>
                        <div className="font-display font-black text-white text-2xl md:text-3xl short:text-lg mt-2 short:mt-1 leading-tight">{d.title}</div>
                        <div className="text-sm short:text-[11px] text-zinc-400 mt-2 short:mt-1 leading-relaxed">{d.blurb}</div>
                        <div className="mt-4 short:mt-2 flex items-center justify-between font-mono text-[10px] tracking-[0.25em]">
                          <span className="text-zinc-500">{d.scenarios.length} SCENARIOS · 3 LEVELS</span>
                          <span className="text-[#FF3B00] flex items-center gap-1 group-hover:gap-2 transition-all">
                            SELECT <ChevronRight size={12} />
                          </span>
                        </div>
                      </button>
                    ))}
                  </div>
                  <div className="mt-8 short:mt-3 flex flex-wrap gap-3">
                    <Link to="/" className="btn-hud min-h-[44px]" data-testid="training-menu">
                      <ArrowLeft size={14} /> MAIN MENU
                    </Link>
                    <button type="button" onClick={() => setShowRecords(true)} className="btn-hud min-h-[44px]" data-testid="training-records-open">
                      <Trophy size={14} /> TRAINING RECORDS
                    </button>
                  </div>
                </>
              )}

              {discipline && (
                <div className="grid md:grid-cols-[1.1fr_1fr] short:grid-cols-[1.05fr_1fr] gap-6 short:gap-3 mt-6 short:mt-1.5">
                  {/* Scenario list */}
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <button type="button" onClick={() => setDiscipline(null)} className="touch-ctrl font-mono text-[10px] tracking-[0.3em] text-zinc-400 hover:text-white flex items-center gap-1.5 py-2" data-testid="training-back">
                        <ArrowLeft size={12} /> TRAINING CENTER
                      </button>
                      <span className="font-mono text-[10px] tracking-[0.3em] text-[#FF3B00]">{DISCIPLINES[discipline].title}</span>
                    </div>
                    <div className="space-y-2 short:space-y-1.5" role="listbox" aria-label="Scenario">
                      {DISCIPLINES[discipline].scenarios.map((sc) => {
                        const diffs = sc.lock ? [sc.lock] : DIFFICULTY_KEYS;
                        const done = diffs.filter((k) => (progress[progressKey(discipline, sc.id, k)] || {}).successes > 0);
                        const active = sc.id === scenarioId;
                        return (
                          <button
                            key={sc.id}
                            type="button"
                            role="option"
                            aria-selected={active}
                            onClick={() => setScenarioId(sc.id)}
                            data-testid={`training-scenario-${sc.id}`}
                            className={`w-full text-left border px-4 py-3 short:px-3 short:py-2 flex items-center gap-3 transition-colors ${
                              active ? "border-[#FF3B00] bg-[#FF3B00]/10" : "border-white/10 bg-black/50 hover:border-white/30"
                            }`}
                          >
                            <div className="flex-1 min-w-0">
                              <div className="font-mono text-[9px] tracking-[0.3em] text-zinc-500">{sc.tag}</div>
                              <div className="font-display font-bold text-white text-base short:text-sm truncate">{sc.title}</div>
                            </div>
                            <div className="flex gap-1 shrink-0" aria-label="Completed difficulties">
                              {diffs.map((k) => (
                                <span
                                  key={k}
                                  title={k}
                                  className={`h-5 px-1 border flex items-center gap-0.5 font-mono text-[7px] tracking-wider ${
                                    done.includes(k) ? "border-emerald-400/70 text-emerald-400" : "border-white/15 text-zinc-600"
                                  }`}
                                >
                                  {done.includes(k) && <Check size={8} />}
                                  {{ CADET: "CDT", ASTRONAUT: "AST", COMMANDER: "CMD" }[k]}
                                </span>
                              ))}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  {/* Briefing + difficulty + start */}
                  <div className="hud-panel corners relative bg-black/60 border border-white/10 p-5 short:p-3 flex flex-col" data-testid="training-briefing">
                    <div className="font-mono text-[9px] tracking-[0.3em] text-zinc-500">BRIEFING · {scenario.tag}</div>
                    <div className="font-display font-black text-white text-2xl short:text-base mt-1" data-testid="training-scenario-title">{scenario.title}</div>
                    <p className="text-sm short:text-[11px] text-zinc-300 mt-2 short:mt-1 leading-snug">{scenario.summary}</p>
                    <p className="font-mono text-[10px] short:text-[9px] tracking-wider text-[#FF3B00] mt-2 short:mt-1" data-testid="training-objective">
                      OBJECTIVE · {scenario.objective}
                    </p>
                    <div className="font-mono text-[9px] tracking-widest text-zinc-500 mt-2 short:mt-1 short:hidden">
                      PRACTISES · {scenario.teaches.join(" · ")}
                    </div>

                    <div className="mt-4 short:mt-1.5">
                      <div className="font-mono text-[9px] tracking-[0.3em] text-zinc-500 mb-1.5 short:mb-1">DIFFICULTY</div>
                      <div className="grid grid-cols-3 gap-1.5" role="radiogroup" aria-label="Difficulty">
                        {DIFFICULTY_KEYS.map((k) => {
                          const locked = !!scenario.lock && scenario.lock !== k;
                          const on = difficulty === k;
                          return (
                            <button
                              key={k}
                              type="button"
                              role="radio"
                              aria-checked={on}
                              disabled={locked}
                              onClick={() => setChosenDiff(k)}
                              data-testid={`training-difficulty-${k}`}
                              className={`h-11 border font-mono text-[10px] tracking-[0.2em] flex items-center justify-center gap-1 ${
                                on ? "border-[#FF3B00] bg-[#FF3B00] text-black" : locked ? "border-white/5 text-zinc-700" : "border-white/20 text-zinc-300 hover:border-white/50"
                              }`}
                            >
                              {locked && <Lock size={10} />} {k}
                            </button>
                          );
                        })}
                      </div>
                      <div className="font-mono text-[9px] tracking-wider text-zinc-500 mt-1.5" data-testid="training-guidance-note">
                        {scenario.lock ? "Locked to COMMANDER. " : ""}
                        {GUIDANCE_NOTE[COACH_LEVEL[difficulty]]}
                      </div>
                      {(() => {
                        const e = progress[progressKey(discipline, scenario.id, difficulty)];
                        return e ? (
                          <div className="font-mono text-[9px] tracking-wider text-zinc-400 mt-1" data-testid="training-best">
                            {e.attempts} ATTEMPTS · {e.successes} SUCCESSFUL{e.best ? ` · BEST ${e.best.label}` : ""}
                          </div>
                        ) : null;
                      })()}
                    </div>

                    <div className="flex gap-2 mt-4 short:mt-2">
                      <button type="button" onClick={start} className="btn-hud btn-hud-primary flex-1 justify-center min-h-[44px]" data-testid="training-start">
                        <Play size={14} /> START TRAINING
                      </button>
                      <button
                        type="button"
                        onClick={toggleVoice}
                        aria-label={voiceOn ? "Mute instructor" : "Unmute instructor"}
                        aria-pressed={!voiceOn}
                        data-testid="training-voice"
                        className={`min-h-[44px] w-12 border flex items-center justify-center ${voiceOn ? "border-white/20 text-zinc-300" : "border-[#FF3B00]/60 text-[#FF3B00]"}`}
                        title={voiceOn ? "MUTE INSTRUCTOR" : "INSTRUCTOR MUTED"}
                      >
                        {voiceOn ? <Volume2 size={16} /> : <VolumeX size={16} />}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>
        </>
      )}

      {view !== "center" && run && run.discipline === "landing" && (
        <DescentGame
          key={runKey}
          difficulty={run.difficulty}
          audio={audio}
          init={findScenario("landing", run.scenarioId).init(run.difficulty)}
          coach={coach}
          holdSeconds={3}
          onSuccess={onLanding}
          onCrash={onLanding}
          onAbort={toScenarios}
        />
      )}
      {view !== "center" && run && run.discipline === "reentry" && (
        <ReentryGame
          key={runKey}
          difficulty={run.difficulty}
          audio={audio}
          scenario={findScenario("reentry", run.scenarioId).start()}
          coach={coach}
          holdSeconds={3}
          onResult={onReentry}
          onAbort={toScenarios}
        />
      )}

      {view === "debrief" && debrief && run && (
        <div className="absolute inset-0 z-50 bg-black/65 backdrop-blur-sm flex items-center justify-center p-4 short:p-2 safe-px" data-testid="training-debrief">
          <div className="hud-panel corners relative bg-black/80 border border-white/10 w-full max-w-3xl max-h-full overflow-y-auto p-6 short:p-3 scan-in">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-mono text-[9px] tracking-[0.3em] text-zinc-500 truncate">
                  TRAINING DEBRIEF · {findScenario(run.discipline, run.scenarioId).title} · {run.difficulty}
                </div>
                <div
                  className={`font-display font-black text-3xl short:text-xl mt-1 ${debrief.success ? "text-emerald-400" : debrief.landed ? "text-amber-400" : "text-[#FF3B00]"}`}
                  data-testid="debrief-title"
                >
                  {debrief.title}
                </div>
                <div className="font-mono text-[10px] short:text-[9px] tracking-wider text-zinc-300 mt-1" data-testid="debrief-reason">
                  MAIN REASON · {debrief.reason}
                </div>
              </div>
              {debrief.grade && (
                <div className="text-right shrink-0">
                  <div className="font-mono text-[9px] tracking-[0.3em] text-zinc-500">GRADE</div>
                  <div className={`font-display font-black text-4xl short:text-2xl ${debrief.landed ? "text-white" : "text-[#FF3B00]"}`}>{debrief.grade}</div>
                </div>
              )}
            </div>

            <div className="grid md:grid-cols-2 short:grid-cols-2 gap-x-6 gap-y-0 mt-2 short:mt-1.5">
              {debrief.rows.map((r) => (
                <div key={r.label} className="flex items-baseline justify-between gap-2 border-b border-white/10 py-1.5 short:py-[3px]" data-testid={r.testId}>
                  <span className="font-mono text-[9px] tracking-[0.15em] text-zinc-500 whitespace-nowrap">{r.label}</span>
                  <span className="text-right min-w-0 truncate">
                    <span className={`font-mono tabular text-sm short:text-[11px] ${r.ok ? "text-white" : "text-[#FF3B00]"}`}>{r.value}</span>
                    {r.limit && <span className="font-mono text-[9px] text-zinc-600 ml-1.5">{r.limit}</span>}
                  </span>
                </div>
              ))}
            </div>

            <div className="mt-3 short:mt-2 border-l-2 border-emerald-400 bg-white/[0.03] px-3 py-2 short:py-1.5" data-testid="debrief-recommendation">
              <div className="font-mono text-[9px] tracking-[0.3em] text-emerald-400">NEXT ATTEMPT</div>
              {debrief.recommendations.map((t) => (
                <div key={t} className="text-sm short:text-[11px] text-zinc-200 mt-0.5 leading-snug">• {t}</div>
              ))}
            </div>

            <div className="grid grid-cols-4 gap-2 mt-3 short:mt-2">
              <button type="button" onClick={retry} className="btn-hud btn-hud-primary justify-center !px-2 min-h-[44px]" data-testid="debrief-retry">
                <RotateCcw size={13} /> RETRY
              </button>
              <button type="button" onClick={toScenarios} className="btn-hud justify-center !px-2 min-h-[44px]" data-testid="debrief-change">
                CHANGE SCENARIO
              </button>
              <button type="button" onClick={toCenter} className="btn-hud justify-center !px-2 min-h-[44px]" data-testid="debrief-center">
                TRAINING CENTER
              </button>
              <button type="button" onClick={toMenu} className="btn-hud justify-center !px-2 min-h-[44px]" data-testid="debrief-menu">
                MAIN MENU
              </button>
            </div>
            <div className="mt-2 flex justify-end">
              <VoiceToggle on={voiceOn} onToggle={toggleVoice} />
            </div>
          </div>
        </div>
      )}
    </main>
  );
}
