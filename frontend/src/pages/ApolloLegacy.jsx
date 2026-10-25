import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { ArrowLeft, Check, ChevronRight, Play, RotateCcw } from "lucide-react";
import DescentGame from "@/components/DescentGame";
import LunarEva from "@/components/eva/LunarEva";
import BuildBadge from "@/components/BuildBadge";
import useMissionAudio from "@/hooks/useMissionAudio";
import { useAudioSettings } from "@/audio/audioSettings";
import { getSite } from "@/data/landingSites";
import { PILOT_DIFFICULTIES } from "@/data/missionConfig";
import { WORLD_X } from "@/data/touchdownFx";
import { freshEvaFor } from "@/data/evaMissions";
import {
  LEGACY_RECORDS_KEY,
  LEGACY_SCENARIOS,
  PRECISION_BANDS,
  applyLegacyResult,
  landingPrecision,
  legacyResult,
  legacyScenario,
  legacyText,
  readLegacyRecords,
  tx,
} from "@/data/apolloLegacy";
import { BUILD_COMMIT } from "@/lib/buildInfo";
import { LCP, legacyResumeAt, legacySaveStore, newLegacyAttemptId } from "@/lib/legacySave";

/**
 * APOLLO LEGACY: three historically inspired challenges (data/apolloLegacy) on LUNAVIA's own
 * landing (DescentGame) and EVA (LunarEva with a mission configuration), outside the campaign:
 *
 *   select → briefing → descent → landed (PREPARE EVA / RETRY) → eva → complete
 *
 * Its own checkpoint (lib/legacySave: DESCENT, LANDED, EVA) and its own records; the campaign's
 * save, score, medals and achievements are never read or written here.
 */
const loadRecords = () => {
  try {
    return readLegacyRecords(window.localStorage.getItem(LEGACY_RECORDS_KEY));
  } catch {
    return readLegacyRecords(null);
  }
};
const saveRecords = (r) => {
  try {
    window.localStorage.setItem(LEGACY_RECORDS_KEY, JSON.stringify(r));
  } catch {
    /* kept for this session only */
  }
};

function Backdrop() {
  return (
    <div aria-hidden className="absolute inset-0 overflow-hidden pointer-events-none">
      <div className="absolute inset-0 grid-bg opacity-30" />
      <div
        className="absolute rounded-full"
        style={{
          width: "220vmax",
          height: "220vmax",
          left: "50%",
          top: "72%",
          transform: "translateX(-50%)",
          background: "radial-gradient(circle at 50% 0%, #2a2620 0%, #11100e 16%, #050505 38%)",
          boxShadow: "0 -1px 0 rgba(230,215,190,0.45), 0 -10px 60px rgba(230,200,150,0.14)",
        }}
      />
    </div>
  );
}

const Label = ({ children, className = "" }) => <div className={`font-mono text-[9px] tracking-[0.3em] text-zinc-500 ${className}`}>{children}</div>;

function ScenarioCard({ sc, L, lang, rec, saved, onStart, onResume }) {
  const done = !!(rec && rec.completed);
  const resumable = saved && saved.status === "active" && saved.scenario === sc.id;
  return (
    <div className="hud-panel corners relative bg-black/60 border border-white/10 p-5 short:p-3 flex flex-col min-w-0" data-testid={`legacy-card-${sc.id}`} data-completed={done ? "1" : "0"}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="font-mono text-[9px] tracking-[0.3em] text-[#e9c98f]">{tx(sc.date, lang)}</div>
          <div className="font-display font-black text-white text-3xl short:text-xl leading-none mt-1">{tx(sc.title, lang)}</div>
          <div className="font-mono text-[10px] short:text-[9px] tracking-[0.22em] text-zinc-300 mt-1 truncate">{tx(sc.subtitle, lang)}</div>
        </div>
        <div className="font-display font-black text-[44px] short:text-[30px] leading-none text-white/10 shrink-0" aria-hidden>
          {sc.number}
        </div>
      </div>
      <div className="mt-3 short:mt-1.5 font-mono text-[10px] short:text-[9px] tracking-[0.2em] text-[#FF3B00] truncate">
        {tx(sc.destination, lang)} · LM {sc.lm}
      </div>
      <p className="text-[13px] short:text-[11px] text-zinc-300 leading-snug mt-2 short:mt-1">{tx(sc.summary, lang)}</p>
      <div className="mt-2 short:mt-1">
        <Label>{L.science}</Label>
        <ul className="mt-1 space-y-0.5">
          {tx(sc.science, lang).map((t) => (
            <li key={t} className="font-mono text-[10px] short:text-[9px] tracking-[0.08em] text-zinc-300">
              · {t}
            </li>
          ))}
        </ul>
      </div>
      <div className="mt-auto pt-3 short:pt-2">
        <div className={`font-mono text-[9px] tracking-[0.25em] flex items-center gap-1.5 ${done ? "text-emerald-400" : "text-zinc-500"}`} data-testid={`legacy-status-${sc.id}`}>
          {done ? <Check size={11} /> : <span className="w-[11px] text-center">·</span>}
          {done ? `${L.completed}${rec.completions > 1 ? ` ×${rec.completions}` : ""}` : L.notYet}
          {done && rec.best && rec.best.dTarget != null && (
            <span className="text-zinc-400">
              {" "}
              · {L.best} {rec.best.dTarget.toFixed(0)} m
            </span>
          )}
        </div>
        {resumable && (
          <button type="button" onClick={onResume} className="btn-hud w-full justify-center min-h-[44px] mt-2" data-testid={`legacy-resume-${sc.id}`}>
            <RotateCcw size={13} /> {L.resume} · {L.checkpointAt[saved.checkpoint] || ""}
          </button>
        )}
        <button type="button" onClick={onStart} className="btn-hud btn-hud-primary w-full justify-center min-h-[44px] mt-2" data-testid={`legacy-start-${sc.id}`}>
          <Play size={13} /> {L.start}
        </button>
      </div>
    </div>
  );
}

function Sources({ sc, L, lang }) {
  return (
    <div data-testid="legacy-sources">
      <Label>{L.sources}</Label>
      <ul className="mt-1 space-y-0.5">
        {sc.sources.map((s) => (
          <li key={s} className="font-mono text-[9px] tracking-[0.04em] text-zinc-400 leading-snug">
            · {s}
          </li>
        ))}
      </ul>
      <p className="mt-2 font-mono text-[8.5px] tracking-[0.18em] text-[#9fb6cc] leading-snug" data-testid="legacy-dramatized">
        ◌ {L.dramatized}
      </p>
      <p className="mt-1 text-[11px] short:text-[10px] text-zinc-400 leading-snug" data-testid="legacy-gameplay-note">
        {tx(sc.gameplay, lang)}
      </p>
    </div>
  );
}

function Quote({ sc, L }) {
  if (!sc.quote) return null;
  return (
    <figure className="border-l-2 border-[#e9c98f]/70 pl-3 py-0.5" data-testid="legacy-quote">
      <blockquote className="font-display text-white text-base short:text-sm leading-snug">“{sc.quote.text}”</blockquote>
      <figcaption className="font-mono text-[8.5px] tracking-[0.2em] text-zinc-400 mt-1">
        — {sc.quote.by} · {L.quoteNote}
      </figcaption>
    </figure>
  );
}

function Confirm({ title, sub, yes, no, onYes, onNo, testId }) {
  return (
    <div className="absolute inset-0 z-[60] bg-black/70 flex items-center justify-center px-4" data-testid={testId}>
      <div className="hud-panel max-w-sm w-full px-5 py-4 border-l-2 border-[#f5c451] bg-black/85">
        <div className="font-mono text-[10px] tracking-[0.3em] text-[#f5c451]">● {title}</div>
        <p className="mt-2 text-[13px] text-zinc-200 leading-snug">{sub}</p>
        <div className="mt-4 grid grid-cols-2 gap-2">
          <button type="button" onClick={onNo} data-testid={`${testId}-no`} className="min-h-[46px] font-mono text-[10px] tracking-[0.2em] text-white bg-black/40 border border-white/25">
            {no}
          </button>
          <button type="button" onClick={onYes} data-testid={`${testId}-yes`} className="min-h-[46px] font-mono text-[10px] tracking-[0.2em] text-white bg-[#FF3B00]/90 border border-[#FF3B00]">
            {yes}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ApolloLegacy() {
  const navigate = useNavigate();
  const audio = useMissionAudio();
  const audioRef = useRef(audio);
  audioRef.current = audio;
  const lang = useAudioSettings().subLang === "pt" ? "pt" : "en";
  const L = legacyText(lang);
  const store = useMemo(() => legacySaveStore(), []);
  const [saved, setSaved] = useState(() => store.state().save);
  const [records, setRecords] = useState(() => loadRecords());
  const [view, setView] = useState("select"); // select | briefing | descent | landed | eva | complete
  const [scId, setScId] = useState(null);
  const [difficulty, setDifficulty] = useState("ASTRONAUT");
  const [runKey, setRunKey] = useState(0);
  const [landing, setLanding] = useState(null); // { safe, pose, precision, touchdownSpeed, fuelPct } or { crashed, reason }
  const [evaResume, setEvaResume] = useState(null);
  const [result, setResult] = useState(null);
  const [flown, setFlown] = useState(false); // the descent was flown in this session (its scene is under the touchdown panel)
  const [confirm, setConfirm] = useState(null); // { kind: "replace", id } | { kind: "leave" }
  const attemptRef = useRef(null); // { attemptId, createdAt, scenario, difficulty }
  const landingRef = useRef(null);

  const sc = scId ? legacyScenario(scId) : null;
  const site = useMemo(() => (sc ? getSite(sc.siteId) : null), [sc]);

  // the iOS app's own copy of the checkpoint, once (newer than the web view's: adopted)
  useEffect(() => {
    let live = true;
    store.loadNative().then((s) => live && setSaved(s.save));
    return () => {
      live = false;
    };
  }, [store]);

  const flying = view === "descent" || view === "eva" || view === "landed";
  useEffect(() => {
    document.documentElement.dataset.flight = flying ? "1" : "";
  }, [flying]);
  useEffect(
    () => () => {
      delete document.documentElement.dataset.flight;
    },
    []
  );

  const stopSounds = () => {
    const a = audioRef.current;
    a.commsReset();
    a.stopRumble();
    a.roarStop(0.2);
    a.ambienceStop(0.3);
    a.padStop(0.5);
  };

  /** A checkpoint of the active attempt (validated by the store: nothing inconsistent is written). */
  const persist = (checkpoint, extra = {}) => {
    const A = attemptRef.current;
    if (!A) return;
    const L0 = landingRef.current;
    const body = { status: "active", attemptId: A.attemptId, scenario: A.scenario, difficulty: A.difficulty, checkpoint, createdAt: A.createdAt, build: BUILD_COMMIT, ...extra };
    if (checkpoint !== LCP.DESCENT && L0 && L0.safe) body.landing = { safe: true, pose: L0.pose, precision: L0.precision || undefined, touchdownSpeed: L0.touchdownSpeed, fuelPct: L0.fuelPct };
    const r = store.write(body);
    if (r.ok) setSaved(store.state().save);
    return r;
  };

  // ---- select ----
  const openBriefing = (id) => {
    setScId(id);
    setResult(null);
    setLanding(null);
    landingRef.current = null;
    setEvaResume(null);
    attemptRef.current = null;
    setView("briefing");
  };
  const requestStart = (id) => {
    const s = store.state().save;
    // an unfinished historical mission is never discarded silently
    if (s && s.status === "active") {
      setConfirm({ kind: "replace", id, name: tx(legacyScenario(s.scenario).title, lang) });
      return;
    }
    openBriefing(id);
  };
  const confirmReplace = () => {
    const id = confirm.id;
    store.close("abandoned");
    setSaved(store.state().save);
    setConfirm(null);
    openBriefing(id);
  };

  const resume = () => {
    const s = store.state().save;
    const at = legacyResumeAt(s);
    if (!at) return;
    const S = legacyScenario(s.scenario);
    setScId(S.id);
    setDifficulty(s.difficulty);
    attemptRef.current = { attemptId: s.attemptId, createdAt: s.createdAt, scenario: s.scenario, difficulty: s.difficulty };
    setResult(null);
    if (at === "briefing") {
      landingRef.current = null;
      setLanding(null);
      setView("briefing");
      return;
    }
    landingRef.current = s.landing;
    setLanding(s.landing);
    audio.init();
    audio.commsReset();
    setFlown(false);
    if (at === "landed") setView("landed");
    else {
      setEvaResume(s.eva);
      setRunKey((k) => k + 1);
      setView("eva");
    }
  };

  // ---- briefing → descent ----
  const begin = () => {
    audio.init();
    audio.commsReset();
    if (!attemptRef.current || attemptRef.current.scenario !== sc.id) {
      attemptRef.current = { attemptId: newLegacyAttemptId(), createdAt: Date.now(), scenario: sc.id, difficulty };
    } else attemptRef.current = { ...attemptRef.current, difficulty };
    landingRef.current = null;
    setLanding(null);
    persist(LCP.DESCENT);
    setFlown(true);
    setRunKey((k) => k + 1);
    setView("descent");
    audio.say(sc.descent.voice.start, { delay: 1.2 });
  };

  const onLanding = useCallback(
    (r) => {
      const S = legacyScenario(attemptRef.current.scenario);
      const st = getSite(S.siteId);
      if (r.crashed) {
        setLanding({ crashed: true, reason: (r.failureReasons && r.failureReasons[0]) || "", touchdownSpeed: r.touchdownSpeed });
        landingRef.current = null;
        setView("landed");
        return;
      }
      const pose = r.pose || null;
      const xm = pose && Number.isFinite(pose.xPos) ? pose.xPos : pose ? pose.x / WORLD_X : 0;
      const precision = landingPrecision(S, { x: xm }, st);
      const L0 = { safe: true, pose, precision: precision || undefined, touchdownSpeed: +(r.touchdownSpeed || 0).toFixed(2), fuelPct: Math.round(r.fuelPct || 0) };
      landingRef.current = L0;
      setLanding(L0);
      persist(LCP.LANDED);
      audioRef.current.say(S.descent.voice.landed, { delay: 0.6 });
      setView("landed");
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    []
  );

  const retryDescent = () => {
    stopSounds();
    begin();
  };

  const prepareEva = () => {
    stopSounds();
    const eva = freshEvaFor(sc.eva);
    persist(LCP.EVA, { eva });
    setEvaResume(null);
    setRunKey((k) => k + 1);
    setView("eva");
  };

  const onEvaCheckpoint = useCallback((e) => {
    persist(LCP.EVA, { eva: e });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const onEvaComplete = useCallback((e) => {
    const A = attemptRef.current;
    const S = legacyScenario(A.scenario);
    const res = legacyResult(S, { landing: landingRef.current, eva: e });
    const next = applyLegacyResult(loadRecords(), A.attemptId, A.difficulty, res);
    saveRecords(next);
    setRecords(next);
    store.close(res.completed ? "completed" : "abandoned");
    setSaved(store.state().save);
    setResult({ ...res, distance: e.distance || 0 });
    stopSounds();
    setView("complete");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const leaveEva = () => {
    setConfirm(null);
    stopSounds();
    setView("select");
  };
  const toSelect = () => {
    stopSounds();
    setConfirm(null);
    setView("select");
  };
  const toMenu = () => {
    stopSounds();
    navigate("/menu");
  };

  const rec = (id) => (records.scenarios || {})[id] || null;
  const bandText = (id) => {
    const b = PRECISION_BANDS.find((x) => x.id === id);
    return b ? tx(b.text, lang) : id;
  };

  return (
    <main className="relative w-full h-screen overflow-hidden bg-[#050505] game-surface" data-testid="legacy-page" data-view={view} data-scenario={scId || ""}>
      {(view === "select" || view === "briefing" || view === "complete") && <Backdrop />}

      {/* ---- the three historical missions ---- */}
      {view === "select" && (
        <div className="relative z-10 h-full overflow-y-auto safe-px" data-testid="legacy-select">
          <div className="max-w-[1180px] mx-auto px-6 md:px-10 pt-24 pb-10 short:pt-14 short:pb-4 short:px-4">
            <div className="flex items-end justify-between gap-4 flex-wrap">
              <div className="min-w-0">
                <div className="font-mono text-[10px] tracking-[0.4em] text-[#e9c98f] scan-in short:hidden">● LUNAVIA · {L.modeSub}</div>
                <h1 className="font-display font-black text-white text-4xl md:text-5xl short:text-2xl tracking-tight mt-2 short:mt-0">{L.mode}</h1>
                <p className="text-zinc-400 text-sm short:text-[11px] mt-2 short:mt-0.5 max-w-2xl short:max-w-none">{L.intro}</p>
              </div>
              <BuildBadge className="!py-0 !min-h-0 !text-[8px] !text-zinc-600" />
            </div>
            <div className="grid md:grid-cols-3 short:grid-cols-3 gap-5 short:gap-2.5 mt-6 short:mt-2">
              {LEGACY_SCENARIOS.map((s) => (
                <ScenarioCard key={s.id} sc={s} L={L} lang={lang} rec={rec(s.id)} saved={saved} onStart={() => requestStart(s.id)} onResume={resume} />
              ))}
            </div>
            <p className="mt-4 short:mt-2 font-mono text-[9px] tracking-wider text-zinc-500">{L.separate}</p>
            <div className="mt-4 short:mt-2 flex flex-wrap gap-3">
              <button type="button" onClick={toMenu} className="btn-hud min-h-[44px]" data-testid="legacy-menu">
                <ArrowLeft size={14} /> {L.menu}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ---- the historical briefing ---- */}
      {view === "briefing" && sc && (
        <div className="relative z-10 h-full overflow-y-auto safe-px" data-testid="legacy-briefing">
          <div className="max-w-[1180px] mx-auto px-6 md:px-10 pt-20 pb-8 short:pt-14 short:pb-3 short:px-4">
            <button type="button" onClick={toSelect} className="touch-ctrl font-mono text-[10px] tracking-[0.3em] text-zinc-400 hover:text-white flex items-center gap-1.5 py-2" data-testid="legacy-back">
              <ArrowLeft size={12} /> {L.mode}
            </button>
            <div className="grid md:grid-cols-[1.25fr_1fr] short:grid-cols-[1.25fr_1fr] gap-6 short:gap-3 mt-1">
              <div className="min-w-0 space-y-3 short:space-y-2">
                <div>
                  <div className="font-mono text-[9px] tracking-[0.3em] text-[#e9c98f]">
                    {tx(sc.date, lang)} · {tx(sc.destination, lang)}
                  </div>
                  <div className="font-display font-black text-white text-4xl short:text-2xl leading-none mt-1" data-testid="legacy-title">
                    {tx(sc.title, lang)}
                  </div>
                  <div className="font-mono text-[10px] tracking-[0.25em] text-zinc-300 mt-1">{tx(sc.subtitle, lang)}</div>
                </div>
                <div className="grid grid-cols-2 gap-3 short:gap-2">
                  <div className="min-w-0">
                    <Label>{L.crew}</Label>
                    <ul className="mt-1 space-y-0.5" data-testid="legacy-crew">
                      {sc.crew.map((c) => (
                        <li key={c.name} className="text-[12px] short:text-[10.5px] text-white leading-tight">
                          {c.name} <span className="text-zinc-500 text-[10px] short:text-[9px]">· {tx(c.role, lang)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                  <div className="min-w-0">
                    <Label>{L.lm}</Label>
                    <div className="font-display font-bold text-white text-xl short:text-base mt-0.5" data-testid="legacy-lm">
                      {sc.lm}
                    </div>
                    <div className="font-mono text-[9px] tracking-[0.2em] text-zinc-500">CSM {sc.cm}</div>
                  </div>
                </div>
                <div>
                  <Label>{L.objective}</Label>
                  <div className="font-mono text-[11px] short:text-[10px] tracking-[0.18em] text-[#FF3B00] mt-0.5" data-testid="legacy-objective">
                    {tx(sc.challenge, lang)}
                  </div>
                  <p className="text-[12px] short:text-[10.5px] text-zinc-300 leading-snug mt-1">{sc.eva.text[lang].briefing}</p>
                  {sc.id === "apollo15" && <p className="font-mono text-[9px] tracking-[0.12em] text-zinc-500 mt-1">{L.roverNote}</p>}
                </div>
                <div data-testid="legacy-history">
                  <Label>{L.history}</Label>
                  {tx(sc.history, lang).map((p) => (
                    <p key={p.slice(0, 24)} className="text-[12px] short:text-[10.5px] text-zinc-300 leading-snug mt-1">
                      {p}
                    </p>
                  ))}
                </div>
                <Quote sc={sc} L={L} />
              </div>
              <div className="hud-panel corners relative bg-black/60 border border-white/10 p-5 short:p-3 flex flex-col gap-3 short:gap-2 min-w-0 self-start">
                <div>
                  <Label>{L.difficulty}</Label>
                  <div className="grid grid-cols-3 gap-1.5 mt-1.5" role="radiogroup" aria-label={L.difficulty}>
                    {PILOT_DIFFICULTIES.map((k) => (
                      <button
                        key={k}
                        type="button"
                        role="radio"
                        aria-checked={difficulty === k}
                        onClick={() => setDifficulty(k)}
                        data-testid={`legacy-difficulty-${k}`}
                        className={`h-11 border font-mono text-[10px] tracking-[0.2em] ${difficulty === k ? "border-[#FF3B00] bg-[#FF3B00] text-black" : "border-white/20 text-zinc-300 hover:border-white/50"}`}
                      >
                        {k}
                      </button>
                    ))}
                  </div>
                </div>
                <button type="button" onClick={begin} className="btn-hud btn-hud-primary w-full justify-center min-h-[48px]" data-testid="legacy-begin">
                  <Play size={14} /> {L.begin}
                </button>
                <Sources sc={sc} L={L} lang={lang} />
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ---- the descent: LUNAVIA's own landing from the historical start ---- */}
      {view === "landed" && !flown && <Backdrop />}
      {(view === "descent" || (view === "landed" && flown)) && sc && site && (
        <DescentGame
          key={runKey}
          difficulty={attemptRef.current ? attemptRef.current.difficulty : difficulty}
          audio={audio}
          site={sc.siteId}
          init={sc.descent.init(attemptRef.current ? attemptRef.current.difficulty : difficulty, site)}
          holdSeconds={0}
          onSuccess={onLanding}
          onCrash={onLanding}
          onAbort={toSelect}
        />
      )}

      {/* ---- touchdown: confirmation, precision, the history, PREPARE EVA ---- */}
      {view === "landed" && sc && landing && (
        <div className="absolute inset-0 z-50 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 short:p-2 safe-px" data-testid="legacy-landed" data-safe={landing.safe ? "1" : "0"}>
          <div className="hud-panel corners relative bg-black/80 border border-white/10 w-full max-w-3xl max-h-full overflow-y-auto p-6 short:p-3 scan-in">
            <div className="font-mono text-[9px] tracking-[0.3em] text-zinc-500">
              {tx(sc.title, lang)} · {tx(sc.destination, lang)} · {attemptRef.current && attemptRef.current.difficulty}
            </div>
            <div className={`font-display font-black text-3xl short:text-xl mt-1 ${landing.safe ? "text-emerald-400" : "text-[#FF3B00]"}`} data-testid="legacy-landed-title">
              {landing.safe ? L.landed : L.crashed}
            </div>
            {landing.safe ? (
              <>
                <div className="font-mono text-[10px] tracking-[0.25em] text-white mt-0.5">
                  {sc.lm} · {L.landedSub}
                </div>
                <div className="grid grid-cols-2 md:grid-cols-4 short:grid-cols-4 gap-x-5 gap-y-1 mt-3 short:mt-2">
                  <div className="border-b border-white/10 py-1 min-w-0">
                    <Label>{L.touchdown}</Label>
                    <div className="font-mono tabular text-white text-sm">{(landing.touchdownSpeed || 0).toFixed(1)} m/s</div>
                  </div>
                  <div className="border-b border-white/10 py-1 min-w-0">
                    <Label>{L.fuel}</Label>
                    <div className="font-mono tabular text-white text-sm">{landing.fuelPct ?? "–"}%</div>
                  </div>
                  {landing.precision && (
                    <>
                      <div className="border-b border-white/10 py-1 min-w-0" data-testid="legacy-precision">
                        <Label>{L.precision}</Label>
                        <div className="font-mono tabular text-[#e9c98f] text-sm truncate" data-band={landing.precision.band}>
                          {bandText(landing.precision.band)} · {landing.precision.dTarget.toFixed(0)} m
                        </div>
                      </div>
                      <div className="border-b border-white/10 py-1 min-w-0" data-testid="legacy-object-distance">
                        <Label>{L.toObject}</Label>
                        <div className="font-mono tabular text-white text-sm">{landing.precision.dObject != null ? `${landing.precision.dObject} m` : "–"}</div>
                      </div>
                    </>
                  )}
                </div>
                <p className="text-[12.5px] short:text-[10.5px] text-zinc-300 leading-snug mt-3 short:mt-2 border-l-2 border-[#e9c98f]/60 pl-3" data-testid="legacy-history-card">
                  {tx(sc.history, lang)[0]}
                </p>
                <div className="grid grid-cols-3 gap-2 mt-4 short:mt-2">
                  <button type="button" onClick={prepareEva} className="btn-hud btn-hud-primary justify-center !px-2 min-h-[48px]" data-testid="legacy-prepare-eva">
                    <ChevronRight size={14} /> {L.prepareEva}
                  </button>
                  <button type="button" onClick={retryDescent} className="btn-hud justify-center !px-2 min-h-[48px]" data-testid="legacy-retry">
                    <RotateCcw size={13} /> {L.retry}
                  </button>
                  <button type="button" onClick={toSelect} className="btn-hud justify-center !px-2 min-h-[48px]" data-testid="legacy-to-select">
                    {L.others}
                  </button>
                </div>
              </>
            ) : (
              <>
                {landing.reason && (
                  <div className="font-mono text-[10px] tracking-wider text-zinc-300 mt-1" data-testid="legacy-crash-reason">
                    {L.reason} · {landing.reason}
                  </div>
                )}
                <div className="grid grid-cols-2 gap-2 mt-4 short:mt-2">
                  <button type="button" onClick={retryDescent} className="btn-hud btn-hud-primary justify-center !px-2 min-h-[48px]" data-testid="legacy-retry">
                    <RotateCcw size={13} /> {L.retry}
                  </button>
                  <button type="button" onClick={toSelect} className="btn-hud justify-center !px-2 min-h-[48px]" data-testid="legacy-to-select">
                    {L.others}
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ---- the EVA: LUNAVIA's EVA engine with the scenario's configuration ---- */}
      {view === "eva" && sc && landing && landing.safe && (
        <LunarEva
          key={runKey}
          siteId={sc.siteId}
          mission={sc.eva}
          pose={landing.pose}
          audio={audio}
          lang={lang}
          resume={evaResume}
          onCheckpoint={onEvaCheckpoint}
          onComplete={onEvaComplete}
          onAbort={() => setConfirm({ kind: "leave" })}
        />
      )}

      {/* ---- the result ---- */}
      {view === "complete" && sc && result && (
        <div className="relative z-10 h-full overflow-y-auto safe-px" data-testid="legacy-complete" data-completed={result.completed ? "1" : "0"}>
          <div className="max-w-[1080px] mx-auto px-6 md:px-10 pt-20 pb-8 short:pt-14 short:pb-3 short:px-4">
            <div className="font-mono text-[9px] tracking-[0.3em] text-zinc-500">
              {L.results} · {tx(sc.title, lang)} · {attemptRef.current && attemptRef.current.difficulty}
            </div>
            <div className={`font-display font-black text-4xl short:text-2xl mt-1 ${result.completed ? "text-emerald-400" : "text-amber-400"}`} data-testid="legacy-complete-title">
              {result.completed ? L.complete : L.incomplete}
            </div>
            <div className="grid md:grid-cols-[1fr_1fr] short:grid-cols-[1fr_1fr] gap-6 short:gap-3 mt-3 short:mt-2">
              <div className="min-w-0">
                <div className="grid grid-cols-2 gap-x-5">
                  {[
                    [L.objectivesDone, `${result.done}/${result.total}`, "legacy-r-objectives"],
                    result.precision ? [L.precision, `${bandText(result.precision.band)} · ${result.precision.dTarget.toFixed(0)} m`, "legacy-r-precision"] : null,
                    [L.touchdown, `${(result.touchdownSpeed || 0).toFixed(1)} m/s`, "legacy-r-touchdown"],
                    sc.eva.samples.length ? [L.samples, `${result.samples}/${sc.eva.samples.length}`, "legacy-r-samples"] : null,
                    [L.photos, result.photos ? "✓" : "–", "legacy-r-photo"],
                    sc.eva.retrieve ? [L.retrieved, result.retrieved ? "✓" : "–", "legacy-r-retrieved"] : null,
                    sc.eva.instrument ? [L.instrument, result.instruments ? "✓" : "–", "legacy-r-instrument"] : null,
                    [L.walked, `${Math.round(result.distance)} m`, "legacy-r-walked"],
                    [L.backInLM, result.backInLM ? "✓" : "–", "legacy-r-back"],
                  ]
                    .filter(Boolean)
                    .map(([k, v, id]) => (
                      <div key={id} className="flex items-baseline justify-between gap-2 border-b border-white/10 py-1.5 short:py-[3px] min-w-0" data-testid={id}>
                        <span className="font-mono text-[9px] tracking-[0.15em] text-zinc-500 truncate min-w-0">{k}</span>
                        <span className="font-mono tabular text-sm short:text-[11px] text-white shrink-0">{v}</span>
                      </div>
                    ))}
                </div>
                <p className="font-mono text-[9px] tracking-wider text-zinc-500 mt-2" data-testid="legacy-separate">
                  {L.separate}
                </p>
                {rec(sc.id) && rec(sc.id).completed && (
                  <div className="mt-2 font-mono text-[9px] tracking-[0.25em] text-emerald-400 flex items-center gap-1.5" data-testid="legacy-badge">
                    <Check size={11} /> {tx(sc.title, lang)} · {L.completed} · {L.completions} {rec(sc.id).completions}
                  </div>
                )}
                <div className="grid grid-cols-3 gap-2 mt-4 short:mt-2">
                  <button type="button" onClick={() => openBriefing(sc.id)} className="btn-hud btn-hud-primary justify-center !px-2 min-h-[46px]" data-testid="legacy-again">
                    <RotateCcw size={13} /> {L.again}
                  </button>
                  <button type="button" onClick={toSelect} className="btn-hud justify-center !px-2 min-h-[46px]" data-testid="legacy-complete-select">
                    {L.others}
                  </button>
                  <button type="button" onClick={toMenu} className="btn-hud justify-center !px-2 min-h-[46px]" data-testid="legacy-complete-menu">
                    {L.menu}
                  </button>
                </div>
              </div>
              <div className="min-w-0 space-y-2">
                <Label>{L.history}</Label>
                <p className="text-[12px] short:text-[10.5px] text-zinc-300 leading-snug">{tx(sc.history, lang)[1]}</p>
                <Quote sc={sc} L={L} />
                <Sources sc={sc} L={L} lang={lang} />
              </div>
            </div>
          </div>
        </div>
      )}

      {confirm && confirm.kind === "replace" && (
        <Confirm testId="legacy-replace" title={L.replaceTitle} sub={L.replaceSub(confirm.name)} yes={L.replace} no={L.keep} onYes={confirmReplace} onNo={() => setConfirm(null)} />
      )}
      {confirm && confirm.kind === "leave" && <Confirm testId="legacy-leave" title={L.leaveTitle} sub={L.leaveSub} yes={L.leave} no={L.stay} onYes={leaveEva} onNo={() => setConfirm(null)} />}
    </main>
  );
}
