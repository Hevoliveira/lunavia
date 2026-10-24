import { useMemo, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, Award, ChevronRight, Lock, X } from "lucide-react";
import MedalEmblem from "@/components/scoring/MedalEmblem";
import MissionDebrief from "@/components/scoring/MissionDebrief";
import { useAudioSettings } from "@/audio/audioSettings";
import { OFFICIAL_MISSIONS } from "@/data/missionConfig";
import { ACHIEVEMENTS, ACHIEVEMENT_GROUPS, MEDALS, achievementProgress, scoreMission } from "@/data/missionScoring";
import { achievementDesc, achievementName, groupName, medalName, siteName, statusName, ui } from "@/data/scoringText";
import { category, loadRecords, unlockedBy } from "@/lib/missionRecords";
import { loadMissionLog } from "@/lib/missionSelection";

/*
 * FLIGHT RECORDS: the official missions' medals and personal records (the
 * twelve destination × pilot difficulty categories), the achievements (earned
 * and locked, with their exact requirements and progress), and the MISSION
 * LOG (every official flight: destination, difficulty, score, medal, how it
 * ended, its debrief again). Everything is read from this device; training
 * flights are not here. All four destinations stay open: nothing here is a
 * condition for flying.
 */
const DIFFS = ["CADET", "ASTRONAUT", "COMMANDER"];
const TABS = ["medals", "achievements", "log"];
const fmtDate = (ms, lang) => (ms ? new Date(ms).toLocaleDateString(lang === "pt" ? "pt-BR" : "en-GB", { day: "2-digit", month: "short", year: "numeric" }) : "—");

function Rules({ t, lang }) {
  return (
    <div className="hud-panel border border-white/10 px-3 py-2 flex flex-wrap items-center gap-x-5 gap-y-1.5" data-testid="records-rules">
      <div className="flex items-center gap-2">
        {[...MEDALS].reverse().map((m) => (
          <span key={m.id} className="inline-flex items-center gap-1 font-mono text-[10px] tracking-[0.12em] text-zinc-200">
            <MedalEmblem medal={m.id} size={22} />
            {medalName(m.id, lang)} {m.min}
          </span>
        ))}
      </div>
      <div className="text-[11px] leading-snug text-zinc-400 min-w-0 flex-1 basis-[18rem]">
        {t.medalGate} <span className="text-zinc-200">{t.medalCap}</span>
      </div>
    </div>
  );
}

function CategoryPanel({ siteId, difficulty, records, lang, onClose }) {
  const t = ui(lang);
  const c = category(records, siteId, difficulty);
  const row = (label, value, testId) => (
    <div className="flex items-baseline justify-between gap-3 border-b border-white/5 py-1" data-testid={testId}>
      <span className="font-mono text-[9.5px] tracking-[0.2em] text-zinc-400">{label}</span>
      <span className="font-mono tabular text-[12px] text-white text-right">{value}</span>
    </div>
  );
  const b = (x, max) => (x ? `${x.score}/${max}` : "—");
  return (
    <div className="fixed inset-0 z-[60] bg-black/70 backdrop-blur-sm flex items-center justify-center px-4 safe-px" onClick={onClose} data-testid="records-category">
      <div className="hud-panel corners relative w-full max-w-[560px] max-h-[92vh] overflow-y-auto p-4 short:p-3" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start gap-3">
          <MedalEmblem medal={c.bestMedal} label={c.bestMedal ? medalName(c.bestMedal, lang) : null} size={64} />
          <div className="min-w-0 flex-1">
            <div className="font-mono text-[9.5px] tracking-[0.3em] text-[#FF3B00]">● {difficulty}</div>
            <div className="font-display font-black text-white text-xl leading-tight">{siteName(siteId, lang)}</div>
            <div className="font-mono text-[10px] tracking-[0.18em] text-zinc-400 mt-0.5">{c.bestMedal ? medalName(c.bestMedal, lang) : t.noMedal}</div>
          </div>
          <button type="button" onClick={onClose} className="btn-hud min-h-[44px] !px-3" aria-label={t.close} data-testid="records-category-close">
            <X size={14} />
          </button>
        </div>
        <div className="mt-3 grid grid-cols-1 short:grid-cols-2 md:grid-cols-2 gap-x-5">
          {row(t.bestScore, c.bestTotal ? `${c.bestTotal.score}/1000` : "—", "cat-best-total")}
          {row(t.bestLanding, b(c.bestLanding, 400), "cat-best-landing")}
          {row(t.bestDocking, b(c.bestDocking, 300), "cat-best-docking")}
          {row(t.bestDockingClean, b(c.bestFirstAttemptDocking, 300), "cat-best-docking-clean")}
          {row(t.bestReentry, b(c.bestReentry, 300), "cat-best-reentry")}
          {row(t.successes, c.successes, "cat-successes")}
          {row(t.missionAttempts, c.attempts, "cat-attempts")}
          {row(t.firstAttemptDockings, c.firstAttemptDockings, "cat-dockings-clean")}
          {row(t.restartedDockings, c.restartedDockings, "cat-dockings-restarted")}
          {c.legacyCompleted > 0 && row(t.legacy, c.legacyCompleted, "cat-legacy")}
        </div>
        <div className="mt-2">
          <div className="font-mono text-[9.5px] tracking-[0.25em] text-zinc-400">{t.earnedHere}</div>
          <div className="flex flex-wrap gap-1.5 mt-1">
            {c.achievements.length ? (
              c.achievements.map((id) => (
                <span key={id} className="inline-flex items-center gap-1 border border-[#FF3B00]/50 px-1.5 py-0.5 font-mono text-[9.5px] tracking-[0.12em] text-white">
                  <Award size={10} className="text-[#FF3B00]" /> {achievementName(id, lang)}
                </span>
              ))
            ) : (
              <span className="text-[11px] text-zinc-500">—</span>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

function MedalsTab({ records, lang, onOpen }) {
  const t = ui(lang);
  return (
    <div className="flex flex-col gap-2.5">
      <div className="grid grid-cols-2 lg:grid-cols-4 short:grid-cols-4 gap-2" data-testid="records-grid">
        {OFFICIAL_MISSIONS.map((m) => (
          <div key={m.siteId} className="border border-white/10 bg-black/50 min-w-0" data-testid={`records-site-${m.siteId}`}>
            <div className="px-2 py-1.5 border-b border-white/10">
              <div className="font-mono text-[8.5px] tracking-[0.25em] text-zinc-500">{lang === "pt" ? "MISSÃO" : "MISSION"} {m.number}</div>
              <div className="font-display font-black text-white text-[14px] short:text-[12.5px] leading-tight truncate">{siteName(m.siteId, lang)}</div>
            </div>
            {DIFFS.map((d) => {
              const c = category(records, m.siteId, d);
              return (
                <button
                  key={d}
                  type="button"
                  onClick={() => onOpen({ siteId: m.siteId, difficulty: d })}
                  className="w-full min-h-[46px] short:min-h-[42px] flex items-center gap-2 px-2 py-1 text-left border-b border-white/5 last:border-b-0 hover:bg-white/5 active:bg-white/10"
                  data-testid={`records-cell-${m.siteId}-${d}`}
                  data-medal={c.bestMedal || "none"}
                  data-best={c.bestTotal ? c.bestTotal.score : ""}
                >
                  <MedalEmblem medal={c.bestMedal} size={30} className="shrink-0" />
                  <span className="min-w-0 flex-1">
                    <span className="block font-mono text-[9px] tracking-[0.18em] text-zinc-400">{d}</span>
                    <span className="block font-mono tabular text-[12px] text-white leading-tight">{c.bestTotal ? `${c.bestTotal.score}` : "—"}<span className="text-zinc-500 text-[10px]"> · {c.successes}/{c.attempts}</span></span>
                  </span>
                  <ChevronRight size={12} className="text-zinc-600 shrink-0" />
                </button>
              );
            })}
          </div>
        ))}
      </div>
      <div className="font-mono text-[9px] tracking-[0.16em] text-zinc-500">{t.successes} / {t.missionAttempts} · {t.open4} {t.training}</div>
      <Rules t={t} lang={lang} />
    </div>
  );
}

function AchievementsTab({ records, lang }) {
  const t = ui(lang);
  const earned = ACHIEVEMENTS.filter((a) => records.achievements[a.id]).length;
  return (
    <div className="flex flex-col gap-3">
      <div className="font-mono text-[10px] tracking-[0.25em] text-zinc-300" data-testid="achievements-count">
        {earned} / {ACHIEVEMENTS.length} {t.earned}
      </div>
      {ACHIEVEMENT_GROUPS.map((g) => (
        <div key={g}>
          <div className="font-mono text-[9.5px] tracking-[0.3em] text-[#FF3B00] mb-1">● {groupName(g, lang)}</div>
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 short:grid-cols-3 gap-2">
            {ACHIEVEMENTS.filter((a) => a.group === g).map((a) => {
              const u = records.achievements[a.id];
              const p = achievementProgress(a.id, records);
              return (
                <div key={a.id} className={`border px-2.5 py-2 min-w-0 ${u ? "border-[#FF3B00]/60 bg-[#FF3B00]/[0.07]" : "border-white/10 bg-black/40"}`} data-testid={`achievement-${a.id}`} data-earned={u ? "1" : "0"}>
                  <div className="flex items-center gap-1.5">
                    {u ? <Award size={13} className="text-[#FF3B00] shrink-0" /> : <Lock size={12} className="text-zinc-600 shrink-0" />}
                    <span className={`font-mono text-[10.5px] tracking-[0.14em] truncate ${u ? "text-white" : "text-zinc-300"}`}>{achievementName(a.id, lang)}</span>
                  </div>
                  <div className="text-[11px] leading-snug text-zinc-400 mt-1">{achievementDesc(a.id, lang)}</div>
                  <div className="font-mono text-[9px] tracking-[0.16em] mt-1 text-zinc-500">
                    {u ? (
                      <span className="text-zinc-300">
                        {t.earned} · {fmtDate(u.at, lang)}
                        {u.siteId ? ` · ${siteName(u.siteId, lang)} · ${u.difficulty}` : ""}
                      </span>
                    ) : (
                      <span>{t.locked}</span>
                    )}
                    {p && !u ? (
                      <span className="block text-zinc-300" data-testid={`achievement-progress-${a.id}`}>
                        {t.progress} · {p.of && p.done != null ? `${p.done}/${p.of}` : `${p.best}/${p.of} (${p.goal})`}
                      </span>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

function LogTab({ log, records, lang, onReview }) {
  const t = ui(lang);
  const flights = log.filter((e) => e && (e.flown || e.landing)).slice().reverse();
  if (!flights.length) return <div className="text-[12px] text-zinc-400" data-testid="log-empty">{t.emptyLog}</div>;
  return (
    <div className="flex flex-col gap-1.5" data-testid="mission-log">
      {flights.map((e) => {
        const s = e.scoring || null;
        const mission = OFFICIAL_MISSIONS.find((m) => m.siteId === e.siteId);
        const status = s && s.status ? statusName(s.status, lang) : s ? t.inFlight : e.completed ? `${statusName("complete", lang)} · ${t.unscored}` : t.unscored;
        const tags = [];
        if (s) {
          const ab = lang === "pt" ? ["P", "A", "R"] : ["L", "D", "R"];
          if (s.landing != null) tags.push(`${ab[0]} ${s.landing}`);
          if (s.docking != null) {
            const dk = s.snaps && s.snaps.docking;
            tags.push(`${ab[1]} ${s.docking}${dk ? (dk.attempts === 1 && dk.restarts === 0 && !(dk.failures || []).length ? ` (${t.firstTry})` : ` (${dk.attempts} ${t.attempts})`) : ""}`);
          }
          if (s.reentry != null) tags.push(`${ab[2]} ${s.reentry}`);
          if (e.landing && e.landing.attempts > 1) tags.push(t.landingAttempts(e.landing.attempts));
          if (s.newBest) tags.push(t.newBest);
        } else if (e.landing) tags.push(`${e.landing.success ? `LANDED ${e.landing.grade || ""}` : "LANDING FAILED"}`);
        // the lunar EVA: its own category (objectives done, the science brought back), never points
        if (e.eva && e.eva.completed) {
          const total = e.eva.total || 3;
          const done = e.eva.total ? e.eva.done : [e.eva.firstSteps, e.eva.sample, e.eva.photo].filter(Boolean).length;
          tags.push(`EVA ${done}/${total}${e.eva.samples ? ` · ${e.eva.samples} ${t.evaSamples}` : ""}`);
        }
        // the manual ascent: its own record (the orbit flown, the attempts), never points
        if (e.ascent && e.ascent.mode === "manual") {
          const a = e.ascent;
          const word = lang === "pt" ? "ASC MANUAL" : "MANUAL ASC";
          const tries = a.attempts > 1 ? ` · ${a.attempts} ${lang === "pt" ? "TENT." : "ATT."}` : "";
          tags.push(a.success ? `${word} ${a.apoKm}×${a.periKm} KM${a.accuracy ? ` ${a.accuracy.grade}` : ""}${tries}` : `${word} ✗${tries}`);
        }
        const canReview = !!(s && s.snaps && s.snaps.landing);
        return (
          <button
            key={e.id}
            type="button"
            disabled={!canReview}
            onClick={() => onReview(e)}
            className="w-full grid grid-cols-[5.5rem_minmax(0,1fr)_3.2rem_auto] short:grid-cols-[5rem_minmax(0,1fr)_3rem_auto] items-center gap-2 border border-white/10 bg-black/45 px-2.5 py-1.5 min-h-[48px] text-left enabled:hover:border-white/30 enabled:active:bg-white/5"
            data-testid={`log-row-${e.id}`}
            data-status={s ? s.status || "in-flight" : "unscored"}
          >
            <span className="font-mono text-[9.5px] tracking-[0.1em] text-zinc-400 leading-tight">
              {fmtDate(e.at, lang)}
              <span className="block text-zinc-500">{e.difficulty}</span>
            </span>
            <span className="min-w-0">
              <span className="block font-mono text-[10.5px] tracking-[0.12em] text-white truncate">
                {mission ? `${mission.number} · ` : ""}
                {siteName(e.siteId, lang)}
              </span>
              <span className="block font-mono text-[9px] tracking-[0.12em] text-zinc-400 truncate">
                {status}
                {tags.length ? ` · ${tags.join(" · ")}` : ""}
              </span>
            </span>
            <span className="font-mono tabular text-[13px] text-white text-right">{s ? s.total : "—"}</span>
            <span className="flex items-center gap-1">
              <MedalEmblem medal={s ? s.medal : null} size={30} />
              {canReview ? <ChevronRight size={12} className="text-zinc-500" /> : <span className="w-3" />}
            </span>
          </button>
        );
      })}
    </div>
  );
}

export default function Records() {
  const navigate = useNavigate();
  const location = useLocation();
  const lang = useAudioSettings().subLang === "pt" ? "pt" : "en";
  const t = ui(lang);
  const records = useMemo(() => loadRecords(), []);
  const log = useMemo(() => loadMissionLog(), []);
  const [tab, setTab] = useState(() => (TABS.includes((location.hash || "").slice(1)) ? location.hash.slice(1) : "medals"));
  const [cell, setCell] = useState(null);
  const [review, setReview] = useState(null);
  const label = { medals: t.medals, achievements: t.achievements, log: t.log };

  const openReview = (e) => {
    const s = e.scoring;
    const mission = scoreMission({ siteId: e.siteId, difficulty: e.difficulty, ...s.snaps });
    const number = (OFFICIAL_MISSIONS.find((m) => m.siteId === e.siteId) || {}).number;
    setReview({ mission, status: s.status || "aborted", prev: s.prevBest || null, newBest: !!s.newBest, unlocked: unlockedBy(records, e.id), records, number, at: e.at });
  };

  return (
    <main className="relative min-h-screen bg-[#050505] safe-px" data-testid="records-page" data-tab={tab}>
      <div aria-hidden className="absolute inset-0 grid-bg opacity-30 pointer-events-none" />
      <div className="relative max-w-[1180px] mx-auto px-6 md:px-10 pt-24 pb-10 short:pt-14 short:pb-4 short:px-3">
        <div className="flex items-center gap-3">
          <div className="font-mono text-[10px] short:text-[8px] tracking-[0.4em] short:tracking-[0.25em] text-[#FF3B00] truncate min-w-0 flex-1">● LUNAVIA · {t.offline}</div>
          <button type="button" onClick={() => navigate("/missions")} className="btn-hud min-h-[44px] short:min-h-[40px] short:!py-1 short:!px-3 shrink-0" data-testid="records-back">
            <ArrowLeft size={14} /> {t.back}
          </button>
        </div>
        <div className="flex items-center gap-2 flex-wrap mt-1 short:mt-0">
          <h1 className="font-display font-black text-white text-4xl md:text-5xl short:text-xl tracking-tight mr-3 short:mr-1" data-testid="records-title">
            {t.records}
          </h1>
          <div className="flex gap-2 short:gap-1.5" role="tablist">
            {TABS.map((k) => (
              <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)} className={`min-h-[44px] px-3 short:px-2 border font-mono text-[10.5px] short:text-[9.5px] tracking-[0.2em] short:tracking-[0.1em] ${tab === k ? "border-[#FF3B00] text-white bg-[#FF3B00]/10" : "border-white/15 text-zinc-400 hover:text-white"}`} data-testid={`records-tab-${k}`}>
                {label[k]}
              </button>
            ))}
          </div>
        </div>
        <div className="mt-3 short:mt-2">
          {tab === "medals" && <MedalsTab records={records} lang={lang} onOpen={setCell} />}
          {tab === "achievements" && <AchievementsTab records={records} lang={lang} />}
          {tab === "log" && <LogTab log={log} records={records} lang={lang} onReview={openReview} />}
        </div>
      </div>
      {cell && <CategoryPanel {...cell} records={records} lang={lang} onClose={() => setCell(null)} />}
      {review && <MissionDebrief data={review} lang={lang} live={false} onClose={() => setReview(null)} />}
    </main>
  );
}
