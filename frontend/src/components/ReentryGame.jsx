import { useEffect, useRef, useState, useCallback } from "react";
import { ArrowLeft, ArrowRight, ArrowUp, ArrowDown, Pause, Play, X, RotateCcw } from "lucide-react";
import ReentryScene from "@/components/scenes/ReentryScene";
import AbortModal from "@/components/AbortModal";
import HoldButton from "@/components/HoldButton";

const CTRL_BTN = "border border-white/40 hover:border-[#FF3B00] flex items-center justify-center text-white";
import {
  createEntryState,
  advance,
  predict,
  recommendBank,
  rollToward,
  classifyPrediction,
  CORRIDOR,
  LIMITS,
  OUTCOME,
  ROLL_RATE,
  EI_ALT,
} from "@/data/reentryPhysics";
import {
  ENTRY_DIFFICULTY,
  TARGET_FPA,
  TRIM_SENSITIVITY,
  TRIM_RATE,
  PREP_SECONDS,
  APPROACH_SECONDS,
  timeScaleFor,
  inBlackout,
  flightPhase,
} from "@/data/reentryGuidance";

const FAILURE_TEXT = {
  [OUTCOME.SKIP_OUT]: {
    title: "ENTRY CORRIDOR LOST",
    sub: "ATMOSPHERIC SKIP",
    detail: "The capsule did not penetrate deep enough to be captured and climbed back out of the atmosphere.",
  },
  [OUTCOME.THERMAL]: {
    title: "THERMAL LIMIT EXCEEDED",
    sub: "VEHICLE LOST",
    detail: "Heat rate exceeded the heat shield's design limit long enough to burn through the ablator.",
  },
  [OUTCOME.STRUCTURAL]: {
    title: "STRUCTURAL LOAD EXCEEDED",
    sub: "VEHICLE LOST",
    detail: "Aerodynamic deceleration exceeded the command module's structural load limit.",
  },
  [OUTCOME.CHUTE_FAILURE]: {
    title: "PARACHUTE SYSTEM FAILURE",
    sub: "VEHICLE LOST",
    detail: "The capsule reached the ocean without a full main-parachute descent.",
  },
};

const PRED_TEXT = {
  NOMINAL: { text: "NOMINAL CAPTURE", cls: "text-emerald-400" },
  SHALLOW: { text: "SKIP-OUT PREDICTED — LIFT DOWN", cls: "text-sky-300" },
  STEEP: { text: "OVERLOAD PREDICTED — LIFT UP", cls: "text-[#FF3B00]" },
};

const clamp = (x, a, b) => Math.min(b, Math.max(a, x));

function Readout({ label, value, unit, tone = "text-white", testId }) {
  return (
    <div className="flex flex-col gap-0.5" data-testid={testId}>
      <span className="font-mono text-[9px] tracking-[0.22em] text-zinc-500 uppercase">{label}</span>
      <div className="flex items-baseline gap-1.5">
        <span className={`font-mono tabular text-lg short:text-sm font-medium ${tone}`}>{value}</span>
        {unit && <span className="font-mono text-[10px] text-zinc-500">{unit}</span>}
      </div>
    </div>
  );
}

function Bar({ value, danger, warn }) {
  const color = danger ? "bg-[#FF3B00]" : warn ? "bg-amber-400" : "bg-white";
  return (
    <div className="h-1.5 w-full bg-white/10">
      <div className={`h-full ${color}`} style={{ width: `${clamp(value, 0, 1) * 100}%` }} />
    </div>
  );
}

// Horizontal entry-corridor gauge. FPA from -4.5° (left, shallow) to -8.5° (right, steep).
const G_MIN = -4.5;
const G_MAX = -8.5;
const gx = (fpa) => ((clamp(fpa, G_MAX, G_MIN) - G_MIN) / (G_MAX - G_MIN)) * 100;

function CorridorGauge({ fpa, cfg, label }) {
  const bandL = gx(TARGET_FPA + cfg.band);
  const bandR = gx(TARGET_FPA - cfg.band);
  return (
    <div className="w-[360px] short:w-[230px] narrow:w-[190px] max-w-[80vw]" data-testid="reentry-corridor">
      <div className="flex justify-between font-mono text-[9px] tracking-widest text-zinc-500 mb-1">
        <span><span className="short:hidden">TOO SHALLOW · </span>SKIP</span>
        <span>{label}</span>
        <span><span className="short:hidden">TOO STEEP · </span>OVERLOAD</span>
      </div>
      <div className="relative h-4 bg-white/5 border border-white/10">
        {cfg.corridorZones && (
          <>
            <div className="absolute inset-y-0 bg-sky-400/20" style={{ left: 0, width: `${gx(CORRIDOR.shallowEdge)}%` }} />
            <div
              className="absolute inset-y-0 bg-emerald-400/15"
              style={{ left: `${gx(CORRIDOR.shallowEdge)}%`, width: `${gx(CORRIDOR.steepEdge) - gx(CORRIDOR.shallowEdge)}%` }}
            />
            <div className="absolute inset-y-0 bg-[#FF3B00]/25" style={{ left: `${gx(CORRIDOR.steepEdge)}%`, right: 0 }} />
          </>
        )}
        <div className="absolute inset-y-0 border-x border-emerald-300/70 bg-emerald-300/20" style={{ left: `${bandL}%`, width: `${bandR - bandL}%` }} />
        <div className="absolute -top-1 -bottom-1 w-px bg-white/60" style={{ left: `${gx(TARGET_FPA)}%` }} />
        {fpa !== null && (
          <div className="absolute -top-1.5 -bottom-1.5 w-1 bg-[#FF3B00] -translate-x-1/2" style={{ left: `${gx(fpa)}%` }} data-testid="reentry-corridor-marker" />
        )}
      </div>
      <div className="flex justify-between font-mono text-[9px] text-zinc-600 mt-1 tabular">
        <span>-4.5°</span>
        <span>TARGET {TARGET_FPA.toFixed(1)}° ±{cfg.band.toFixed(1)}°</span>
        <span>-8.5°</span>
      </div>
    </div>
  );
}

function LiftDial({ bank, cue }) {
  return (
    <svg viewBox="-50 -50 100 100" className="w-24 h-24 short:w-[4.5rem] short:h-[4.5rem] shrink-0" data-testid="reentry-lift-dial">
      <circle r="44" fill="none" stroke="rgba(255,255,255,0.15)" />
      <text y="-34" textAnchor="middle" className="fill-zinc-500" style={{ font: "8px monospace" }}>UP</text>
      <text y="41" textAnchor="middle" className="fill-zinc-600" style={{ font: "8px monospace" }}>DN</text>
      {cue !== null && (
        <g transform={`rotate(${cue})`}>
          <line y1="0" y2="-38" stroke="rgba(52,211,153,0.6)" strokeWidth="3" strokeDasharray="4 3" />
        </g>
      )}
      <g transform={`rotate(${bank})`}>
        <line y1="6" y2="-36" stroke="#FF3B00" strokeWidth="3" />
        <path d="M0 -42 L-6 -32 L6 -32 Z" fill="#FF3B00" />
      </g>
      <circle r="5" fill="#0b0b0c" stroke="rgba(255,255,255,0.5)" />
    </svg>
  );
}

function newPrep(cfg) {
  const sign = Math.random() < 0.5 ? -1 : 1;
  const err = sign * cfg.initialError * (0.6 + 0.4 * Math.random());
  return { fpa: TARGET_FPA + err, rcs: cfg.rcsBudget, timeLeft: PREP_SECONDS, bank: 0 };
}

export default function ReentryGame({ difficulty = "ASTRONAUT", audio, onComplete, onAbort }) {
  const cfg = ENTRY_DIFFICULTY[difficulty] || ENTRY_DIFFICULTY.ASTRONAUT;
  const simRef = useRef(createEntryState());
  const viewRef = useRef({ phase: "APPROACH", phaseT: 0, sepT: 0, attitudeU: 0, prepBank: 0, approachAlt: 1500e3, approachFpa: -0.11, failT: 0 });
  const prepRef = useRef(newPrep(cfg));
  const inputRef = useRef({ left: false, right: false, up: false, down: false });
  const guideRef = useRef({ cue: null, pred: null, lastCue: -1, lastPred: -1 });
  const commitRef = useRef(false);
  const doneRef = useRef(false);
  const eventsRef = useRef({});
  const realTRef = useRef(0);

  const [phase, setPhase] = useState("APPROACH");
  const [ui, setUi] = useState(null);
  const [paused, setPaused] = useState(false);
  const [showAbort, setShowAbort] = useState(false);
  const [assist, setAssist] = useState(cfg.liftAssist);
  const [failure, setFailure] = useState(null);

  const pausedRef = useRef(false);
  const assistRef = useRef(assist);
  useEffect(() => {
    pausedRef.current = paused || showAbort || !!failure;
  }, [paused, showAbort, failure]);
  useEffect(() => {
    assistRef.current = assist;
  }, [assist]);

  const say = useCallback((text, delay) => audio && audio.comms && audio.comms(text, delay), [audio]);

  const startEntry = useCallback(() => {
    const p = prepRef.current;
    simRef.current = createEntryState({ fpaDeg: p.fpa, bankDeg: p.bank });
    const v = viewRef.current;
    v.phase = "ENTRY";
    v.phaseT = 0;
    guideRef.current = { cue: null, pred: null, lastCue: -1, lastPred: -1 };
    eventsRef.current = {};
    commitRef.current = false;
    setPhase("ENTRY");
    if (audio) audio.startRumble && audio.startRumble(0.12);
    say("Entry interface. Four hundred thousand feet. Stand by for blackout.", 200);
  }, [audio, say]);

  const retryEntry = useCallback(() => {
    prepRef.current = newPrep(cfg);
    simRef.current = createEntryState();
    Object.assign(viewRef.current, { phase: "PREP", phaseT: 0, sepT: 8, attitudeU: 1, prepBank: 0, approachAlt: 250e3, failT: 0 });
    doneRef.current = false;
    setFailure(null);
    setPhase("PREP");
    if (audio && audio.stopRumble) audio.stopRumble();
  }, [cfg, audio]);

  // Keyboard
  useEffect(() => {
    const set = (code, on) => {
      const i = inputRef.current;
      switch (code) {
        case "KeyA":
        case "KeyQ":
        case "ArrowLeft":
          i.left = on;
          return true;
        case "KeyD":
        case "KeyE":
        case "ArrowRight":
          i.right = on;
          return true;
        case "KeyW":
        case "ArrowUp":
          i.up = on;
          return true;
        case "KeyS":
        case "ArrowDown":
          i.down = on;
          return true;
        default:
          return false;
      }
    };
    const down = (e) => {
      if (set(e.code, true)) {
        e.preventDefault();
        return;
      }
      if (e.repeat) return;
      if (e.code === "Enter" || e.code === "Space") {
        commitRef.current = true;
        e.preventDefault();
      } else if (e.code === "KeyP") {
        setPaused((p) => !p);
      } else if (e.code === "KeyG" && cfg.liftAssist) {
        setAssist((a) => !a);
      }
    };
    const up = (e) => {
      set(e.code, false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, [cfg.liftAssist]);

  // Main loop: presentation time → fixed-step simulation time
  useEffect(() => {
    let raf;
    let last = 0;
    let syncAcc = 0;
    const tick = (ts) => {
      if (!last) last = ts;
      const dt = Math.min(0.1, (ts - last) / 1000);
      last = ts;
      const v = viewRef.current;
      const inp = inputRef.current;

      if (!pausedRef.current) {
        realTRef.current += dt;
        v.phaseT += dt;
        if (v.phase === "APPROACH") {
          const u = Math.min(1, v.phaseT / APPROACH_SECONDS);
          v.approachAlt = 1500e3 * (1 - u) + 250e3 * u;
          if (v.phaseT >= APPROACH_SECONDS) {
            v.phase = "PREP";
            v.phaseT = 0;
            v.sepT = 0;
            setPhase("PREP");
            say("CM/SM separation confirmed. Maneuver to entry attitude.", 100);
          }
        } else if (v.phase === "PREP") {
          const p = prepRef.current;
          v.sepT += dt;
          v.attitudeU = Math.min(1, Math.max(0, (v.sepT - 1.2) / 3.2));
          p.timeLeft -= dt;
          v.approachAlt = 250e3 * Math.max(0, p.timeLeft / PREP_SECONDS);
          const trim = (inp.up ? 1 : 0) - (inp.down ? 1 : 0);
          if (trim && p.rcs > 0) {
            const dv = Math.min(p.rcs, TRIM_RATE * dt);
            p.rcs -= dv;
            p.fpa += trim * dv * TRIM_SENSITIVITY;
          }
          const roll = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
          if (roll) {
            p.bank += roll * ROLL_RATE * 3 * dt;
            if (p.bank > 180) p.bank -= 360;
            if (p.bank <= -180) p.bank += 360;
          }
          v.prepBank = p.bank;
          v.approachFpa = (p.fpa * Math.PI) / 180;
          if (p.timeLeft <= 0 || (commitRef.current && v.attitudeU >= 1)) startEntry();
          commitRef.current = false;
        } else if (v.phase === "ENTRY") {
          const s = simRef.current;
          const g = guideRef.current;
          const manual = (inp.right ? 1 : 0) - (inp.left ? 1 : 0);
          if (manual) s.rollInput = manual;
          else if (assistRef.current && g.cue !== null && s.v > 3000) s.rollInput = rollToward(s.bank, g.cue);
          else s.rollInput = 0;

          advance(s, dt * timeScaleFor(s));

          // Look-ahead guidance (cheap fixed-step predictions, throttled)
          if (!s.outcome && s.v > 3000 && s.drogueT === null) {
            if (cfg.bankCue && realTRef.current - g.lastCue > 0.6) {
              g.cue = recommendBank(s).bank;
              g.lastCue = realTRef.current;
            }
            if (cfg.prediction && realTRef.current - g.lastPred > 0.35) {
              g.pred = classifyPrediction(predict(s));
              g.lastPred = realTRef.current;
            }
          } else if (s.v <= 3000) {
            g.cue = null;
            g.pred = s.outcome ? g.pred : "NOMINAL";
          }

          // Mission events → comms
          const ev = eventsRef.current;
          const bo = inBlackout(s);
          if (bo && !ev.blackout) {
            ev.blackout = true;
            if (audio && audio.squelch) audio.squelch();
          }
          if (!bo && ev.blackout && !ev.aos && !s.outcome) {
            ev.aos = true;
            say("LUNAVIA, Houston. We have you through blackout.", 100);
          }
          if (s.drogueT !== null && !ev.drogue) {
            ev.drogue = true;
            say("Drogues deployed.", 100);
          }
          if (s.mainT !== null && !ev.main) {
            ev.main = true;
            say("Three good chutes.", 100);
          }

          if (s.outcome) {
            if (s.outcome === OUTCOME.SPLASHDOWN) {
              v.phase = "SPLASHED";
              v.phaseT = 0;
              setPhase("SPLASHED");
              if (audio) {
                audio.stopRumble && audio.stopRumble();
                audio.splash && audio.splash();
              }
              say("Splashdown. LUNAVIA is home.", 400);
            } else {
              v.phase = "FAILED";
              v.phaseT = 0;
              v.failT = 0;
              setPhase("FAILED");
              if (audio) {
                audio.stopRumble && audio.stopRumble();
                if (s.outcome !== OUTCOME.SKIP_OUT) audio.boom && audio.boom(0.35);
              }
              say(s.outcome === OUTCOME.SKIP_OUT ? "Houston, we are climbing out. Entry corridor lost." : "Houston, loss of signal. No telemetry.", 300);
            }
          }
        } else if (v.phase === "SPLASHED") {
          if (v.phaseT > 4 && !doneRef.current) {
            doneRef.current = true;
            const s = simRef.current;
            onComplete && onComplete({ peakG: s.peak.g, peakHeatRate: s.peak.heatRate, splashV: s.splashV });
          }
        } else if (v.phase === "FAILED") {
          v.failT += dt;
          if (v.failT > 2.6 && !doneRef.current) {
            doneRef.current = true;
            setFailure(simRef.current.outcome);
          }
        }
      }

      syncAcc += dt;
      if (syncAcc > 1 / 15) {
        syncAcc = 0;
        const s = simRef.current;
        const p = prepRef.current;
        if (audio && audio.setRumble && v.phase === "ENTRY") {
          audio.setRumble(clamp(0.08 + s.gLoad / 10 + (s.heatRate / 250) * 0.3, 0, 0.9));
        }
        setUi({
          phase: v.phase,
          label:
            v.phase === "APPROACH" ? "EARTH APPROACH" : v.phase === "PREP" ? "ENTRY PREP" : v.phase === "SPLASHED" ? "SPLASHDOWN" : v.phase === "FAILED" ? "LOSS OF SIGNAL" : flightPhase(s),
          alt: v.phase === "ENTRY" || v.phase === "FAILED" || v.phase === "SPLASHED" ? s.h : EI_ALT + v.approachAlt,
          vel: s.v,
          fpa: (s.gamma * 180) / Math.PI,
          bank: v.phase === "PREP" || v.phase === "APPROACH" ? p.bank : s.bank,
          g: s.gLoad,
          q: s.heatRate,
          shield: Math.max(s.heatLoad / LIMITS.heatLoadCapacity, s.overheat / LIMITS.overheatBudget),
          overheat: s.overheat,
          heatLoad: s.heatLoad,
          prepFpa: p.fpa,
          rcs: p.rcs,
          timeLeft: p.timeLeft,
          attitudeReady: v.attitudeU >= 1,
          blackout: v.phase === "ENTRY" && inBlackout(s),
          cue: guideRef.current.cue,
          pred: guideRef.current.pred,
          simT: s.t,
          ts: v.phase === "ENTRY" ? timeScaleFor(s) : 1,
          climbing: s.gamma > 0 && s.v > 7800,
          ei: s.ei,
          peak: { ...s.peak },
          drogue: s.drogue,
          main: s.main,
          splashV: s.splashV,
          outcome: s.outcome,
          realT: realTRef.current,
        });
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const audioRef = useRef(audio);
  audioRef.current = audio;
  useEffect(() => () => audioRef.current && audioRef.current.stopRumble && audioRef.current.stopRumble(), []);

  const hold = (key) => (on) => {
    inputRef.current[key] = on;
  };

  const u = ui;
  const prepDelta = u ? u.prepFpa - TARGET_FPA : 0;
  const prepZone = !u
    ? "NOMINAL"
    : u.prepFpa > CORRIDOR.shallowEdge
    ? "SHALLOW"
    : u.prepFpa < CORRIDOR.steepEdge
    ? "STEEP"
    : "NOMINAL";
  const inBand = u && Math.abs(prepDelta) <= cfg.band;
  const gWarn = u && u.g > 7;
  const gDanger = u && u.g > 10;
  const shieldWarn = u && u.shield > 0.5;
  const shieldDanger = u && (u.overheat > 0 || u.shield > 0.8);
  const inEntry = phase === "ENTRY";
  const pred = u && u.pred ? PRED_TEXT[u.pred] : null;

  let status = { text: "", cls: "text-zinc-400" };
  if (u && inEntry) {
    if (u.overheat > 0) status = { text: "HEAT SHIELD OVER DESIGN LIMIT", cls: "text-[#FF3B00] blink" };
    else if (gDanger) status = { text: "G-LOAD NEAR STRUCTURAL LIMIT", cls: "text-[#FF3B00] blink" };
    else if (cfg.climbWarning && u.climbing) status = { text: "CLIMBING — SKIP-OUT RISK", cls: "text-sky-300 blink" };
    else if (gWarn) status = { text: "HIGH G", cls: "text-amber-400" };
    else status = { text: u.vel < 3000 ? "ENTRY COMPLETE · DESCENDING" : "IN CORRIDOR", cls: "text-emerald-400" };
  }

  const clock = u && inEntry ? `EI+${String(Math.floor(u.simT / 60)).padStart(2, "0")}:${String(Math.floor(u.simT % 60)).padStart(2, "0")}` : u && phase === "PREP" ? `EI−00:${String(Math.max(0, Math.ceil(u.timeLeft))).padStart(2, "0")}` : "EI−--:--";
  const failText = failure ? FAILURE_TEXT[failure] : null;

  return (
    <div className="absolute inset-0" data-testid="reentry-game">
      <ReentryScene simRef={simRef} viewRef={viewRef} />

      {/* Machine-readable telemetry for validation tooling */}
      <div hidden data-testid="reentry-telemetry" data-json={u ? JSON.stringify(u) : "{}"} />

      {/* Top banner */}
      <div className="absolute top-20 short:top-14 left-1/2 -translate-x-1/2 short:left-4 short:translate-x-0 safe-ml hud-panel px-5 py-2 short:px-3 flex items-center gap-4 short:gap-3 whitespace-nowrap z-30">
        <span className="font-mono text-[10px] tracking-[0.35em] text-zinc-500 tabular">{clock}</span>
        <span className="w-px h-4 bg-white/15" />
        <span className="font-mono text-[11px] tracking-[0.3em] text-white" data-testid="reentry-phase">
          {u ? u.label : "EARTH APPROACH"}
        </span>
        {u && u.blackout && (
          <>
            <span className="w-px h-4 bg-white/15" />
            <span className="font-mono text-[10px] tracking-[0.3em] text-amber-400 blink" data-testid="reentry-blackout">
              COMM BLACKOUT
            </span>
          </>
        )}
      </div>

      <div className="absolute top-20 short:top-14 right-4 md:right-8 safe-mr flex gap-2 z-30">
        <button onClick={() => setPaused((p) => !p)} className="hud-panel px-3 py-2 touch:py-3 flex items-center gap-2 text-zinc-400 hover:text-white font-mono text-[10px] tracking-[0.3em]" data-testid="reentry-pause">
          {paused ? <Play size={12} /> : <Pause size={12} />} {paused ? "RESUME" : "PAUSE"}
        </button>
        <button onClick={() => setShowAbort(true)} className="hud-panel px-3 py-2 touch:py-3 flex items-center gap-2 text-zinc-400 hover:text-[#FF3B00] font-mono text-[10px] tracking-[0.3em]" data-testid="reentry-abort">
          <X size={12} /> ABORT
        </button>
      </div>

      {/* LEFT: primary telemetry */}
      {u && phase !== "SPLASHED" && (
        <div className="absolute bottom-6 short:bottom-2 safe-mb left-4 md:left-8 safe-ml hud-panel corners px-5 py-4 short:px-3 short:py-2 w-[300px] short:w-[210px] narrow:w-[190px] z-30" data-testid="reentry-hud-left">
          <div className="font-mono text-[10px] tracking-[0.3em] text-zinc-500 mb-3 short:hidden">CM-1 · ENTRY · {difficulty}</div>
          <div className="grid grid-cols-2 gap-3 short:gap-x-2 short:gap-y-1">
            <Readout label="ALTITUDE" value={(u.alt / 1000).toFixed(1)} unit="km" testId="reentry-alt" />
            <Readout label="VELOCITY" value={Math.round(u.vel).toLocaleString("en-US")} unit="m/s" testId="reentry-vel" />
            <Readout
              label={inEntry ? "FLIGHT PATH" : "EI FLIGHT PATH"}
              value={(inEntry ? u.fpa : u.prepFpa).toFixed(2) + "°"}
              tone={!inEntry && !inBand ? "text-amber-400" : "text-white"}
              testId="reentry-fpa"
            />
            <Readout label="TARGET FPA" value={TARGET_FPA.toFixed(2) + "°"} tone="text-zinc-300" testId="reentry-target-fpa" />
          </div>
          {inEntry && (
            <>
              <div className="mt-3 short:mt-1.5">
                <div className="font-mono text-[9px] tracking-widest text-zinc-500 mb-1 flex justify-between">
                  <span>G-FORCE</span>
                  <span className={gDanger ? "text-[#FF3B00]" : gWarn ? "text-amber-400" : "text-white"} data-testid="reentry-g">
                    {u.g.toFixed(1)} G <span className="text-zinc-600">/ {LIMITS.structuralG} LIMIT</span>
                  </span>
                </div>
                <Bar value={u.g / LIMITS.structuralG} warn={gWarn} danger={gDanger} />
              </div>
              <div className="mt-2">
                <div className="font-mono text-[9px] tracking-widest text-zinc-500 mb-1 flex justify-between">
                  <span>HEAT SHIELD</span>
                  <span className={shieldDanger ? "text-[#FF3B00]" : shieldWarn ? "text-amber-400" : "text-white"} data-testid="reentry-heat">
                    {Math.round(u.q)} W/cm² · {Math.round(u.shield * 100)}%
                  </span>
                </div>
                <Bar value={u.shield} warn={shieldWarn} danger={shieldDanger} />
              </div>
            </>
          )}
          {phase === "PREP" && (
            <div className="mt-3 short:mt-1.5 space-y-1 short:space-y-0.5 font-mono text-[9px] short:text-[8px] tracking-widest" data-testid="reentry-checklist">
              <div className="text-emerald-400">✓ CM/SM SEPARATION</div>
              <div className={u.attitudeReady ? "text-emerald-400" : "text-amber-400"}>{u.attitudeReady ? "✓" : "…"} ENTRY ATTITUDE · HEAT SHIELD FORWARD</div>
              <div className={inBand ? "text-emerald-400" : "text-amber-400"}>
                {inBand ? "✓" : "!"} EI ANGLE {inBand ? "IN GUIDANCE BAND" : "OFF TARGET — TRIM"}
              </div>
              <div className={Math.abs(u.bank) < 30 ? "text-emerald-400" : "text-zinc-400"}>
                {Math.abs(u.bank) < 30 ? "✓" : "·"} LIFT VECTOR UP (RECOMMENDED)
              </div>
              <div className="text-zinc-500 pt-1">RCS TRIM Δv {u.rcs.toFixed(1)} m/s</div>
            </div>
          )}
        </div>
      )}

      {/* RIGHT: lift vector + controls */}
      {u && (phase === "PREP" || phase === "ENTRY") && (
        <div className="absolute bottom-6 short:bottom-2 safe-mb right-4 md:right-8 safe-mr hud-panel corners px-5 py-4 short:px-3 short:py-2 z-30 w-[230px] short:w-[200px] narrow:w-[188px]" data-testid="reentry-hud-right">
          <div className="font-mono text-[10px] tracking-[0.3em] text-zinc-500 mb-2 short:hidden">LIFT VECTOR</div>
          <div className="flex items-center gap-3">
            <LiftDial bank={u.bank} cue={cfg.bankCue && inEntry ? u.cue : null} />
            <div className="font-mono text-[10px] tracking-widest text-zinc-400 space-y-1">
              <div data-testid="reentry-bank">
                BANK <span className="text-white tabular">{Math.round(u.bank)}°</span>
              </div>
              <div>{Math.abs(u.bank) < 60 ? "LIFT UP" : Math.abs(u.bank) > 120 ? "LIFT DOWN" : "LIFT SIDE"}</div>
              {cfg.bankCue && inEntry && u.cue !== null && <div className="text-emerald-400">CUE {Math.round(u.cue)}°</div>}
              {cfg.liftAssist && inEntry && (
                <button
                  type="button"
                  onClick={() => setAssist((a) => !a)}
                  aria-pressed={assist}
                  data-testid="reentry-assist"
                  className={`touch-ctrl -mx-2 px-2 py-3 border ${assist ? "text-emerald-400 border-emerald-400/40" : "text-zinc-500 border-white/15"}`}
                >
                  ASSIST {assist ? "ON" : "OFF"}<span className="touch:hidden"> (G)</span>
                </button>
              )}
            </div>
          </div>
          <div className="grid grid-cols-3 gap-2 mt-3 short:mt-1.5 place-items-center">
            <HoldButton className={CTRL_BTN + " w-14 h-14 short:w-12 short:h-12"} onHold={hold("left")} data-testid="reentry-roll-left" aria-label="Roll left">
              <ArrowLeft size={18} />
            </HoldButton>
            {phase === "PREP" ? (
              <div className="flex flex-col gap-1">
                <HoldButton className={CTRL_BTN + " w-14 h-11 short:h-10"} onHold={hold("up")} data-testid="reentry-trim-shallow" aria-label="Trim shallower">
                  <ArrowUp size={16} />
                </HoldButton>
                <HoldButton className={CTRL_BTN + " w-14 h-11 short:h-10"} onHold={hold("down")} data-testid="reentry-trim-steep" aria-label="Trim steeper">
                  <ArrowDown size={16} />
                </HoldButton>
              </div>
            ) : (
              <span className="font-mono text-[9px] text-zinc-600">ROLL</span>
            )}
            <HoldButton className={CTRL_BTN + " w-14 h-14 short:w-12 short:h-12"} onHold={hold("right")} data-testid="reentry-roll-right" aria-label="Roll right">
              <ArrowRight size={18} />
            </HoldButton>
          </div>
          <div className="font-mono text-[9px] tracking-widest text-zinc-600 mt-3 leading-relaxed touch:hidden">
            {phase === "PREP" ? (
              <>
                W/S · ↑/↓ TRIM ENTRY ANGLE
                <br />A/D · ←/→ SET LIFT VECTOR
                <br />ENTER · COMMIT TO ENTRY
              </>
            ) : (
              <>
                A/D · ←/→ · Q/E ROLL LIFT VECTOR
                <br />UP = SHALLOWER · DOWN = STEEPER
                <br />P PAUSE
              </>
            )}
          </div>
          <div className="hidden touch:block font-mono text-[9px] short:text-[8px] tracking-widest text-zinc-600 mt-2 short:mt-1 leading-relaxed">
            {phase === "PREP" ? "↑ SHALLOWER · ↓ STEEPER · ←/→ LIFT VECTOR" : "←/→ ROLL · LIFT UP = SHALLOWER"}
          </div>
        </div>
      )}

      {/* Bottom centre: corridor + status */}
      {u && (phase === "PREP" || phase === "ENTRY") && (
        <div className="absolute bottom-6 short:bottom-2 safe-mb left-1/2 -translate-x-1/2 z-30 flex flex-col items-center gap-2 short:gap-1 short:max-w-[240px] narrow:max-w-[195px] text-center">
          <CorridorGauge fpa={phase === "PREP" ? u.prepFpa : u.ei.fpa} cfg={cfg} label={phase === "PREP" ? "PLANNED EI ANGLE" : "FLOWN EI ANGLE"} />
          {phase === "PREP" && (
            <>
              <div
                className={`font-mono text-[11px] tracking-[0.25em] ${
                  !cfg.corridorZones ? "text-zinc-300" : prepZone === "SHALLOW" ? "text-sky-300" : prepZone === "STEEP" ? "text-[#FF3B00]" : inBand ? "text-emerald-400" : "text-amber-400"
                }`}
                data-testid="reentry-status"
              >
                {!cfg.corridorZones
                  ? `EI ANGLE ${u.prepFpa.toFixed(2)}° · TARGET ${TARGET_FPA.toFixed(1)}°`
                  : prepZone === "SHALLOW"
                  ? "TOO SHALLOW — CAPSULE WILL SKIP OFF THE ATMOSPHERE"
                  : prepZone === "STEEP"
                  ? "TOO STEEP — HEATING AND G-LOAD BEYOND LIMITS"
                  : inBand
                  ? "IN CORRIDOR — GO FOR ENTRY"
                  : "MARGINAL — TRIM TOWARD TARGET"}
              </div>
              <button
                onClick={() => (commitRef.current = true)}
                disabled={!u.attitudeReady}
                className="btn-hud btn-hud-primary disabled:opacity-40"
                data-testid="reentry-commit"
              >
                COMMIT TO ENTRY
              </button>
            </>
          )}
          {inEntry && (
            <div className="flex flex-col items-center gap-1">
              <div className={`font-mono text-[11px] tracking-[0.25em] ${status.cls}`} data-testid="reentry-status">
                {status.text}
              </div>
              {cfg.prediction && pred && u.vel > 3000 && (
                <div className={`font-mono text-[10px] tracking-[0.25em] ${pred.cls}`} data-testid="reentry-prediction">
                  PREDICTION · {pred.text}
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {phase === "APPROACH" && (
        <div className="absolute inset-x-0 bottom-24 flex justify-center z-30 pointer-events-none">
          <div className="text-center scan-in">
            <div className="font-mono text-[10px] tracking-[0.4em] text-[#FF3B00] mb-2">● EARTH APPROACH</div>
            <div className="font-display font-black text-white text-4xl md:text-5xl">RETURN TO EARTH</div>
            <div className="font-mono text-[11px] tracking-widest text-zinc-400 mt-2">11.0 KM/S · ENTRY INTERFACE 120 KM</div>
          </div>
        </div>
      )}

      {paused && !showAbort && !failure && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/50 z-40">
          <button className="btn-hud btn-hud-primary" onClick={() => setPaused(false)} data-testid="reentry-resume">
            <Play size={14} /> RESUME
          </button>
        </div>
      )}

      {failText && u && (
        <div className="absolute inset-0 flex items-center justify-center bg-black/60 backdrop-blur-sm z-50" data-testid="reentry-result">
          <div className="hud-panel corners px-10 py-8 max-w-xl text-center scan-in">
            <div className="font-mono text-[10px] tracking-[0.4em] text-[#FF3B00] mb-3">● MISSION FAILED · {failText.sub}</div>
            <div className="font-display font-black text-white text-4xl md:text-5xl mb-3" data-testid="reentry-result-title">
              {failText.title}
            </div>
            <p className="font-mono text-[11px] tracking-wide text-zinc-400 mb-5">{failText.detail}</p>
            <div className="grid grid-cols-3 gap-4 font-mono text-[10px] tracking-widest text-zinc-500 mb-6">
              <div>
                EI ANGLE
                <div className="text-white text-base tabular">{u.ei.fpa.toFixed(2)}°</div>
              </div>
              <div>
                PEAK G
                <div className="text-white text-base tabular">{u.peak.g.toFixed(1)}</div>
              </div>
              <div>
                PEAK HEAT
                <div className="text-white text-base tabular">{Math.round(u.peak.heatRate)} W/cm²</div>
              </div>
            </div>
            <div className="flex gap-3 justify-center">
              <button className="btn-hud btn-hud-primary" onClick={retryEntry} data-testid="reentry-retry">
                <RotateCcw size={14} /> RETRY ENTRY
              </button>
              <button className="btn-hud" onClick={() => onAbort && onAbort()} data-testid="reentry-end">
                END MISSION
              </button>
            </div>
          </div>
        </div>
      )}

      <AbortModal
        open={showAbort}
        onCancel={() => setShowAbort(false)}
        onConfirm={() => {
          setShowAbort(false);
          onAbort && onAbort();
        }}
      />
    </div>
  );
}
