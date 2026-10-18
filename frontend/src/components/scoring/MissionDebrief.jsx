import { useEffect, useRef, useState } from "react";
import { Award, Check, ChevronRight, X } from "lucide-react";
import MedalEmblem, { MEDAL_TONE } from "@/components/scoring/MedalEmblem";
import { PHASES, recommendation } from "@/data/missionScoring";
import {
  DEDUCTION_HOW,
  RATING_RULE,
  achievementDesc,
  achievementName,
  componentText,
  gateName,
  medalName,
  phaseName,
  ratingName,
  recommendationText,
  siteName,
  statusName,
  ui,
} from "@/data/scoringText";

/*
 * LUNAVIA — MISSION DEBRIEF. After the splashdown's MISSION COMPLETE (which it
 * follows, over the same splashdown scene), and after a failed mission's END
 * MISSION (the partial score, no medal). It reveals, in order: the three phase
 * scores, the total, the medal, the achievements this flight unlocked and the
 * personal record, then one recommendation drawn from the flight's own numbers.
 * A tap shows everything at once; nothing here closes by itself. DETAILED
 * TELEMETRY lists every measured value, its points and how it is scored.
 *
 * data: { mission (scoreMission), status, prev, newBest, unlocked, records,
 *         number, at } — `live` false shows it at once (the mission log).
 */
const REVEAL = [500, 1250, 2000, 2800, 3700, 4500, 5300]; // ms: landing, docking, reentry, total, medal, achievements, record
const CHIPS_SHORT = 4; // achievements shown as chips on a landscape phone (all of them are in DETAILED TELEMETRY)
const reduced = () => {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
};

function Count({ to, run, dur = 650 }) {
  const [v, setV] = useState(run ? 0 : to);
  useEffect(() => {
    if (!run) {
      setV(to);
      return undefined;
    }
    let raf;
    const t0 = performance.now();
    const tick = (t) => {
      const u = Math.min(1, (t - t0) / dur);
      setV(Math.round(to * (1 - (1 - u) ** 3)));
      if (u < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [to, run, dur]);
  return <>{v}</>;
}

const RATING_TONE = { OUTSTANDING: "text-[#CFE6F7] border-[#A9C8E0]/60", EXCELLENT: "text-[#F5D06A] border-[#C99A2E]/60", GOOD: "text-zinc-200 border-white/30", FAIR: "text-zinc-400 border-white/20", "NEEDS WORK": "text-[#FF7A4D] border-[#FF3B00]/50" };

function PhaseRow({ phase, s, shown, live, lang }) {
  const done = !!s;
  const scored = done && (s.safe || s.success || s.splashdown);
  const share = done ? s.score / s.max : 0;
  return (
    <div data-testid={`debrief-phase-${phase}`} data-score={done ? s.score : ""} className={`transition-opacity duration-500 ${shown ? "opacity-100" : "opacity-0"}`}>
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-mono text-[10px] short:text-[9.5px] tracking-[0.28em] text-zinc-300 truncate">{phaseName(phase, lang)}</span>
        <span className="flex items-baseline gap-2 shrink-0">
          {done ? (
            <span className={`border px-1.5 font-mono text-[9px] tracking-[0.18em] ${scored ? RATING_TONE[s.rating] || "text-zinc-300 border-white/20" : "text-[#FF7A4D] border-[#FF3B00]/60"}`}>{ratingName(s.rating, lang)}</span>
          ) : (
            <span className="border border-white/15 px-1.5 font-mono text-[9px] tracking-[0.18em] text-zinc-500">{ui(lang).notFlown}</span>
          )}
          <span className="font-mono tabular text-white text-xl short:text-lg leading-none">
            {done ? <Count to={s.score} run={live && shown} /> : "—"}
            <span className="text-zinc-500 text-[11px]">/{phase === "landing" ? 400 : 300}</span>
          </span>
        </span>
      </div>
      <div className="h-1 mt-1 bg-white/10 relative overflow-hidden">
        <div className="absolute inset-y-0 left-0 bg-[#FF3B00]" style={{ width: `${shown ? share * 100 : 0}%`, transition: live ? "width 650ms cubic-bezier(0.2,0.7,0.2,1)" : "none" }} />
        {[0.5, 0.7, 0.85, 0.95].map((x) => (
          <i key={x} className="absolute inset-y-0 w-px bg-black/70" style={{ left: `${x * 100}%` }} />
        ))}
      </div>
    </div>
  );
}

function Details({ m, lang, unlocked = [], onClose }) {
  const t = ui(lang);
  const [tab, setTab] = useState(PHASES.find((p) => m[p]) || "landing");
  const s = m[tab];
  return (
    <div className="absolute inset-0 z-10 bg-[rgba(5,5,5,0.97)] backdrop-blur-md flex flex-col safe-px" data-testid="debrief-details">
      <div className="flex items-center gap-2 px-4 pt-3 short:pt-2">
        <span className="font-mono text-[10px] tracking-[0.35em] text-[#FF3B00] mr-auto">● {t.details}</span>
        <button type="button" onClick={onClose} className="btn-hud min-h-[44px] !px-3" data-testid="debrief-details-close" aria-label={t.close}>
          <X size={14} /> {t.close}
        </button>
      </div>
      <div className="flex gap-2 px-4 mt-2" role="tablist">
        {PHASES.map((p) => (
          <button key={p} type="button" role="tab" aria-selected={tab === p} disabled={!m[p]} onClick={() => setTab(p)} data-testid={`debrief-tab-${p}`} className={`min-h-[40px] px-3 border font-mono text-[10px] tracking-[0.2em] ${tab === p ? "border-[#FF3B00] text-white bg-[#FF3B00]/10" : "border-white/15 text-zinc-400"} disabled:opacity-30`}>
            {phaseName(p, lang)} {m[p] ? `· ${m[p].score}` : ""}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0 overflow-y-auto px-4 py-2 grid grid-cols-1 md:grid-cols-2 short:grid-cols-2 gap-x-4 gap-y-1.5 content-start">
        {s &&
          s.components.map((c) => {
            const w = componentText(tab, c, s.snapshot, lang);
            return (
              <div key={c.id} className="border border-white/10 bg-black/40 px-3 py-1.5" data-testid={`debrief-row-${c.id}`}>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-mono text-[9.5px] tracking-[0.2em] text-zinc-400 truncate">{w.label}</span>
                  <span className="font-mono tabular text-[12px] text-white shrink-0">
                    {c.points}
                    <span className="text-zinc-500">/{c.max}</span>
                  </span>
                </div>
                <div className="flex items-baseline justify-between gap-2">
                  <span className="font-mono tabular text-[13px] text-white">{w.value}</span>
                </div>
                <div className="text-[10.5px] leading-snug text-zinc-400">{w.how}</div>
              </div>
            );
          })}
        {s &&
          s.deductions.map((d) => (
            <div key={d.id} className="border border-[#FF3B00]/40 bg-[#FF3B00]/5 px-3 py-1.5" data-testid="debrief-row-attempts">
              <div className="flex items-baseline justify-between gap-2">
                <span className="font-mono text-[9.5px] tracking-[0.2em] text-zinc-300">{t.deduction}</span>
                <span className="font-mono tabular text-[12px] text-[#FF7A4D]">{d.points}</span>
              </div>
              <div className="font-mono tabular text-[13px] text-white">
                {s.snapshot.attempts} {t.attempts}
              </div>
              <div className="text-[10.5px] leading-snug text-zinc-400">{DEDUCTION_HOW[lang] || DEDUCTION_HOW.en}</div>
            </div>
          ))}
        <div className="md:col-span-2 short:col-span-2 border border-white/10 bg-black/40 px-3 py-2 mt-1" data-testid="debrief-rules">
          <div className="font-mono text-[9.5px] tracking-[0.25em] text-zinc-400">{t.gates}</div>
          <div className="flex flex-wrap gap-x-4 gap-y-1 mt-1">
            {m.gates.map((g) => (
              <span key={g.id} className={`font-mono text-[10px] tracking-[0.12em] ${g.ok ? "text-white" : "text-[#FF7A4D]"}`} data-testid={`debrief-gate-${g.id}`} data-ok={g.ok ? "1" : "0"}>
                {g.ok ? "✓" : "✕"} {gateName(g.id, lang)}
              </span>
            ))}
          </div>
          <div className="text-[10.5px] text-zinc-400 mt-1 leading-snug">
            {t.medalRules}. {t.medalGate} {t.medalCap} {RATING_RULE[lang] || RATING_RULE.en}
          </div>
        </div>
        {unlocked.length > 0 && (
          <div className="md:col-span-2 short:col-span-2 border border-[#FF3B00]/40 bg-black/40 px-3 py-2" data-testid="debrief-details-achievements">
            <div className="font-mono text-[9.5px] tracking-[0.25em] text-zinc-400">{t.unlocked}</div>
            {unlocked.map((id) => (
              <div key={id} className="mt-1 text-[11px] leading-snug text-zinc-300">
                <span className="font-mono text-[10px] tracking-[0.12em] text-white">{achievementName(id, lang)}</span> — {achievementDesc(id, lang)}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export default function MissionDebrief({ data, lang = "en", live = true, onMissions, onRecords, onMenu, onClose }) {
  const t = ui(lang);
  const m = data.mission;
  const animate = live && !reduced();
  // step k: the first k parts are shown (REVEAL.length: all of them)
  const [step, setStep] = useState(animate ? 0 : REVEAL.length);
  const [details, setDetails] = useState(false);
  const timers = useRef([]);
  useEffect(() => {
    if (!animate) return undefined;
    timers.current = REVEAL.map((ms, i) => setTimeout(() => setStep((s) => Math.max(s, i + 1)), ms));
    return () => timers.current.forEach(clearTimeout);
  }, [animate]);
  const showAll = () => {
    timers.current.forEach(clearTimeout);
    setStep(REVEAL.length);
  };
  const at = (i) => step > i;
  const rec = recommendation(m, data.records || null);
  const status = data.status;
  const title = status === "complete" || status === "complete-after-loss" ? t.complete : status === "aborted" ? t.aborted : t.failed;
  const subtitle = status === "complete" ? null : status === "complete-after-loss" ? t.lossNote : statusName(status, lang);
  const tone = m.medal ? MEDAL_TONE[m.medal] : null;
  const date = data.at ? new Date(data.at) : null;
  const unlocked = data.unlocked || [];
  const prev = data.prev;

  return (
    <div
      className={`fixed inset-0 z-[60] bg-gradient-to-b from-black/80 via-black/70 to-black/85 backdrop-blur-[3px] game-surface ${live ? "veil-in" : ""}`}
      data-testid="mission-debrief"
      data-status={status}
      data-total={m.total}
      data-medal={m.medal || "none"}
      data-version={m.version}
      onClick={step < REVEAL.length ? showAll : undefined}
    >
      <div className="relative h-full w-full max-w-[1020px] mx-auto flex flex-col px-5 short:px-3 pt-4 short:pt-2 pb-3 short:pb-1.5 safe-px" style={{ paddingTop: "max(env(safe-area-inset-top, 0px), 0.5rem)", paddingBottom: "max(env(safe-area-inset-bottom, 0px), 0.4rem)" }}>
        {/* header: the mission */}
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="font-mono text-[10px] short:text-[9px] tracking-[0.4em] text-[#FF3B00] truncate">● {t.debrief}</div>
            <h2 className="font-display font-black text-white text-4xl md:text-5xl short:text-[26px] leading-none tracking-tight mt-1 short:mt-0.5" data-testid="debrief-title">
              {title}
            </h2>
            {subtitle && (
              <div className="font-mono text-[10px] short:text-[9.5px] tracking-[0.2em] text-[#FF7A4D] mt-1" data-testid="debrief-subtitle">
                {subtitle}
              </div>
            )}
          </div>
          <div className="text-right shrink-0 font-mono text-[9.5px] short:text-[9px] tracking-[0.18em] text-zinc-400 leading-relaxed">
            <div className="text-white" data-testid="debrief-mission">
              {data.number ? `${lang === "pt" ? "MISSÃO" : "MISSION"} ${data.number} · ` : ""}
              {siteName(m.siteId, lang)}
            </div>
            <div data-testid="debrief-difficulty">
              {m.difficulty}
              {date ? ` · ${date.toLocaleDateString(lang === "pt" ? "pt-BR" : "en-GB", { day: "2-digit", month: "short", year: "numeric" })}` : ""}
            </div>
            {step < REVEAL.length && (
              <button type="button" onClick={showAll} className="mt-1 min-h-[36px] px-2 border border-white/20 text-zinc-300 tracking-[0.2em]" data-testid="debrief-skip">
                {t.skip} ›
              </button>
            )}
          </div>
        </div>

        {/* the scores (left), the medal and what it means (right) */}
        <div className="grid grid-cols-1 md:grid-cols-[1.12fr_1fr] short:grid-cols-[1fr_1.12fr] gap-4 short:gap-3 mt-4 short:mt-2 flex-1 min-h-0">
          <div className="hud-panel corners relative px-4 py-3 short:px-3 short:py-2 flex flex-col gap-3 short:gap-2 min-h-0">
            {PHASES.map((p, i) => (
              <PhaseRow key={p} phase={p} s={m[p]} shown={at(i)} live={animate} lang={lang} />
            ))}
            <div className={`border-t border-white/10 pt-2 short:pt-1.5 mt-auto flex items-end justify-between transition-opacity duration-500 ${at(3) ? "opacity-100" : "opacity-0"}`}>
              <span className="font-mono text-[10px] tracking-[0.35em] text-zinc-400">{t.total}</span>
              <span className="font-mono tabular text-white text-4xl short:text-[30px] leading-none" data-testid="debrief-total">
                <Count to={m.total} run={animate && at(3)} dur={900} />
                <span className="text-zinc-500 text-base">/1000</span>
              </span>
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                showAll();
                setDetails(true);
              }}
              className="btn-hud justify-center min-h-[40px] !py-1.5 !text-[10px]"
              data-testid="debrief-open-details"
            >
              {t.details} <ChevronRight size={12} />
            </button>
          </div>

          <div className="flex flex-col gap-2.5 short:gap-1.5 min-h-0 min-w-0 overflow-y-auto overscroll-contain" data-testid="debrief-right">
            <div className={`flex items-center gap-4 short:gap-3 transition-all duration-700 ${at(4) ? "opacity-100 scale-100" : "opacity-0 scale-90"}`} data-testid="debrief-medal" data-medal={m.medal || "none"} data-eligible={m.eligible ? "1" : "0"}>
              <MedalEmblem medal={m.medal} label={m.medal ? medalName(m.medal, lang) : null} size={92} glow={!!m.medal} className="shrink-0 short:w-[60px] short:h-[60px]" />
              <div className="min-w-0">
                <div className="font-mono text-[9.5px] tracking-[0.3em] text-zinc-400">{t.medal}</div>
                <div className="font-display font-black text-3xl short:text-xl leading-none mt-0.5" style={{ color: tone ? tone.text : "#a1a1aa" }} data-testid="debrief-medal-name">
                  {medalName(m.medal, lang)}
                </div>
                <div className={`text-[11px] short:text-[10px] leading-snug text-zinc-300 mt-1 ${m.completed && m.eligible && !m.capped ? "short:hidden" : ""}`} data-testid="debrief-eligibility">
                  {!m.completed ? t.partial : !m.eligible ? t.lossNote : m.capped ? t.capped(m.tier) : t.medalRules}
                </div>
              </div>
            </div>

            <div className={`transition-opacity duration-500 ${at(5) ? "opacity-100" : "opacity-0"}`} data-testid="debrief-achievements">
              <div className="font-mono text-[9.5px] tracking-[0.3em] text-zinc-400">{unlocked.length ? t.unlocked : t.noneUnlocked}</div>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {unlocked.map((id, k) => (
                  <span
                    key={id}
                    className={`items-center gap-1 border border-[#FF3B00]/60 bg-[#FF3B00]/10 px-2 short:px-1.5 py-0.5 short:py-0 font-mono text-[10px] short:text-[9px] tracking-[0.14em] short:tracking-[0.02em] text-white ${k >= CHIPS_SHORT ? "inline-flex short:hidden" : "inline-flex"}`}
                    style={{ animation: at(5) && animate ? `fade-in 600ms ease-out ${k * 160}ms both` : undefined }}
                    data-testid={`debrief-achievement-${id}`}
                  >
                    <Award size={11} className="text-[#FF3B00]" /> {achievementName(id, lang)}
                  </span>
                ))}
                {unlocked.length > CHIPS_SHORT && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation();
                      showAll();
                      setDetails(true);
                    }}
                    className="hidden short:inline-flex items-center border border-white/30 px-1.5 py-0.5 font-mono text-[9px] text-white"
                    data-testid="debrief-achievements-more"
                  >
                    +{unlocked.length - CHIPS_SHORT}
                  </button>
                )}
              </div>
            </div>

            <div className={`flex flex-wrap items-center gap-x-3 gap-y-1 transition-opacity duration-500 ${at(6) ? "opacity-100" : "opacity-0"}`} data-testid="debrief-record">
              {data.newBest ? (
                <div className="inline-flex items-center gap-2 bg-[#FF3B00] text-black px-2 py-0.5 font-mono text-[10.5px] short:text-[9.5px] tracking-[0.25em] short:tracking-[0.15em]" data-testid="debrief-new-best">
                  <Check size={12} /> {t.newBest}
                </div>
              ) : null}
              <div className="font-mono text-[10px] short:text-[9.5px] tracking-[0.18em] short:tracking-[0.1em] text-zinc-300" data-testid="debrief-prev">
                {prev
                  ? `${data.newBest ? t.prevBest : t.best} · ${prev.score}/1000${prev.medal ? ` · ${medalName(prev.medal, lang)}` : ""}`
                  : data.newBest
                  ? t.noPrev
                  : t.noBestYet}
              </div>
            </div>

            <div className={`border-l-2 border-[#FF3B00] bg-black/40 px-3 py-1.5 transition-opacity duration-500 ${at(6) ? "opacity-100" : "opacity-0"}`} data-testid="debrief-recommendation" data-rec={rec.id}>
              <div className="font-mono text-[9px] tracking-[0.3em] text-[#FF3B00]">{t.recommendation}</div>
              <div className="text-[12px] short:text-[10.5px] leading-snug text-white">{recommendationText(rec, lang)}</div>
            </div>
          </div>
        </div>

        {/* continue */}
        <div className="flex flex-wrap items-center gap-2 short:gap-1.5 mt-3 short:mt-1.5" onClick={(e) => e.stopPropagation()}>
          {onClose ? (
            <button type="button" onClick={onClose} className="btn-hud btn-hud-primary min-h-[44px]" data-testid="debrief-close">
              <X size={14} /> {t.close}
            </button>
          ) : (
            <>
              <button type="button" onClick={onMissions} className="btn-hud btn-hud-primary min-h-[44px]" data-testid="debrief-missions">
                {t.missions} <ChevronRight size={14} />
              </button>
              <button type="button" onClick={onRecords} className="btn-hud min-h-[44px]" data-testid="debrief-records">
                {t.records}
              </button>
              <button type="button" onClick={onMenu} className="btn-hud min-h-[44px]" data-testid="debrief-menu">
                {t.menu}
              </button>
            </>
          )}
          <span className="ml-auto font-mono text-[9px] tracking-[0.16em] text-zinc-500 hidden md:inline short:inline" data-testid="debrief-status">
            {statusName(status, lang)}
          </span>
        </div>
      </div>
      {details && <Details m={m} lang={lang} unlocked={unlocked} onClose={() => setDetails(false)} />}
    </div>
  );
}
