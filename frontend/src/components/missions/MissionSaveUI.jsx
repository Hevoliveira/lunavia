import { useEffect, useState } from "react";
import { ChevronRight } from "lucide-react";
import { getSite } from "@/data/landingSites";
import { RESUME_AT, checkpointText } from "@/lib/missionSave";

/*
 * The mission checkpoint's screens and notices (lib/missionSave), in English and
 * Brazilian Portuguese: the saved mission on the startup screen and in the game
 * menu, the confirmation before a new mission replaces it, MISSION CHECKPOINT
 * SAVED, MISSION RESUMED / RESUMED FROM LAST SAFE CHECKPOINT, and the note shown
 * when a saved mission cannot be restored.
 */
export const SAVE_TEXT = {
  en: {
    available: "SAVED MISSION AVAILABLE",
    checkpoint: "CHECKPOINT",
    saved: "SAVED",
    resume: "RESUME MISSION",
    confirmTitle: "START A NEW MISSION?",
    confirmBody: "Your unfinished mission checkpoint will be replaced.",
    cancel: "CANCEL",
    startNew: "START NEW MISSION",
    savedChip: "MISSION CHECKPOINT SAVED",
    resumed: "MISSION RESUMED",
    resumedSafe: "RESUMED FROM LAST SAFE CHECKPOINT",
    interruptedNote: "The maneuver in progress when the app closed must be flown again.",
    fallbackNote: "The latest save could not be read; the previous checkpoint was restored.",
    damagedTitle: "SAVED MISSION COULD NOT BE RESTORED",
    damagedBody: "The saved checkpoint is damaged and cannot be flown. Your records, medals and mission log are not affected.",
    unsupportedBody: "The saved checkpoint was made by a newer version of LUNAVIA and cannot be resumed by this one. It is kept until a new mission replaces it.",
    dismiss: "OK",
  },
  pt: {
    available: "MISSÃO SALVA DISPONÍVEL",
    checkpoint: "CHECKPOINT",
    saved: "SALVO EM",
    resume: "CONTINUAR MISSÃO",
    confirmTitle: "INICIAR UMA NOVA MISSÃO?",
    confirmBody: "O checkpoint da sua missão não concluída será substituído.",
    cancel: "CANCELAR",
    startNew: "INICIAR NOVA MISSÃO",
    savedChip: "CHECKPOINT DA MISSÃO SALVO",
    resumed: "MISSÃO RETOMADA",
    resumedSafe: "RETOMADA DO ÚLTIMO CHECKPOINT SEGURO",
    interruptedNote: "A manobra em andamento quando o app foi fechado precisa ser refeita.",
    fallbackNote: "O save mais recente não pôde ser lido; o checkpoint anterior foi restaurado.",
    damagedTitle: "NÃO FOI POSSÍVEL RESTAURAR A MISSÃO SALVA",
    damagedBody: "O checkpoint salvo está danificado e não pode ser usado. Seus recordes, medalhas e o histórico de missões não foram afetados.",
    unsupportedBody: "O checkpoint salvo foi criado por uma versão mais nova do LUNAVIA e não pode ser retomado por esta. Ele é mantido até uma nova missão substituí-lo.",
    dismiss: "OK",
  },
};
const T = (lang) => SAVE_TEXT[lang === "pt" ? "pt" : "en"];

/** "22 OCT 2026 · 14:32" (EN) / "22 OUT 2026 · 14:32" (PT), in the device's time zone. */
export function savedAtText(ms, lang = "en") {
  const d = new Date(ms);
  if (!Number.isFinite(d.getTime())) return "";
  const loc = lang === "pt" ? "pt-BR" : "en-GB";
  const day = d.toLocaleDateString(loc, { day: "2-digit", month: "short", year: "numeric" }).replace(/\./g, "").replace(/ de /g, " ");
  const time = d.toLocaleTimeString(loc, { hour: "2-digit", minute: "2-digit", hour12: false });
  return `${day} · ${time}`.toUpperCase();
}

/** The saved mission's summary (destination, pilot difficulty, checkpoint, when) and RESUME MISSION. */
export function SavedMissionCard({ save, lang = "en", onResume, className = "", testId = "saved-mission" }) {
  const t = T(lang);
  let siteName = save.mission.siteId;
  try {
    siteName = getSite(save.mission.siteId).name;
  } catch {
    // the id itself
  }
  return (
    <div
      className={`pointer-events-auto bg-black/65 backdrop-blur-sm border-l-2 border-[#FF3B00] px-4 py-3 short:px-3 short:py-2 text-left veil-in ${className}`}
      data-testid={testId}
      data-checkpoint={save.checkpoint}
      data-site={save.mission.siteId}
      data-difficulty={save.mission.difficulty}
    >
      <div className="font-mono text-[9px] tracking-[0.32em] short:tracking-[0.22em] text-[#FF3B00]">● {t.available}</div>
      <div className="font-display font-black text-white text-lg short:text-[15px] leading-tight tracking-tight mt-1" data-testid="saved-mission-site">{siteName}</div>
      <div className="font-mono text-[10px] short:text-[9px] tracking-[0.25em] short:tracking-[0.18em] text-zinc-200 mt-0.5" data-testid="saved-mission-difficulty">{save.mission.difficulty}</div>
      <div className="font-mono text-[9px] short:text-[8px] tracking-[0.18em] short:tracking-[0.12em] text-zinc-300 mt-1.5 short:mt-1" data-testid="saved-mission-checkpoint">
        {t.checkpoint}: <span className="text-white">{checkpointText(save.checkpoint, lang)}</span>
      </div>
      <div className="font-mono text-[9px] short:text-[8px] tracking-[0.18em] short:tracking-[0.12em] text-zinc-500 mt-0.5" data-testid="saved-mission-date">
        {t.saved} {savedAtText(save.savedAt, lang)}
      </div>
      <button
        type="button"
        onClick={onResume}
        data-testid={testId === "saved-mission" ? "resume-mission-btn" : `${testId}-resume`}
        className="mt-3 short:mt-2 w-full min-h-[46px] short:min-h-[42px] px-3 flex items-center justify-between gap-3 font-mono text-[12px] short:text-[11px] tracking-[0.3em] short:tracking-[0.2em] text-white bg-[#FF3B00]/90 hover:bg-[#FF3B00] active:bg-[#d93200] border border-[#FF3B00] touch-manipulation"
      >
        {t.resume}
        <ChevronRight size={15} className="shrink-0" />
      </button>
    </div>
  );
}

/** START A NEW MISSION? — before LAUNCH SEQUENCE — INITIATE (or MISSIONS) replaces an unfinished mission. */
export function NewMissionConfirm({ open, lang = "en", onCancel, onConfirm }) {
  const t = T(lang);
  useEffect(() => {
    if (!open) return undefined;
    const key = (e) => e.key === "Escape" && onCancel();
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [open, onCancel]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/70 backdrop-blur-sm px-6" role="dialog" aria-modal="true" aria-labelledby="new-mission-title" data-testid="new-mission-confirm">
      <div className="w-full max-w-lg short:max-w-[30rem] bg-[#0a0a0a] border border-white/15 border-l-2 border-l-[#FF3B00] px-6 py-5 short:px-5 short:py-4 scan-in">
        <div className="font-mono text-[9px] tracking-[0.4em] text-[#FF3B00]">● LV-001</div>
        <h2 id="new-mission-title" className="font-display font-black text-white text-2xl short:text-xl tracking-tight mt-1">{t.confirmTitle}</h2>
        <p className="font-mono text-[11px] short:text-[10px] tracking-[0.08em] leading-relaxed text-zinc-300 mt-2">{t.confirmBody}</p>
        <div className="mt-5 short:mt-4 flex flex-wrap gap-3 justify-end">
          <button type="button" onClick={onCancel} data-testid="new-mission-cancel" className="btn-hud min-h-[44px]" autoFocus>
            {t.cancel}
          </button>
          <button type="button" onClick={onConfirm} data-testid="new-mission-confirm-btn" className="btn-hud btn-hud-primary min-h-[44px]">
            {t.startNew}
          </button>
        </div>
      </div>
    </div>
  );
}

/** A saved mission that cannot be resumed (damaged, or from a newer version): said once, plainly. */
export function SaveProblemNote({ status, lang = "en", onDismiss, className = "" }) {
  const t = T(lang);
  return (
    <div className={`pointer-events-auto bg-black/70 backdrop-blur-sm border-l-2 border-[#f5c451] px-4 py-3 short:px-3 short:py-2 text-left ${className}`} data-testid="save-problem" data-status={status}>
      <div className="font-mono text-[9px] tracking-[0.28em] text-[#f5c451]">● {t.damagedTitle}</div>
      <p className="font-mono text-[9px] short:text-[8px] tracking-[0.08em] leading-relaxed text-zinc-300 mt-1.5">{status === "unsupported" ? t.unsupportedBody : t.damagedBody}</p>
      <button type="button" onClick={onDismiss} data-testid="save-problem-ok" className="mt-2 font-mono text-[10px] tracking-[0.3em] text-zinc-300 hover:text-white px-3 py-1.5 border border-white/20 min-h-[36px]">
        {t.dismiss}
      </button>
    </div>
  );
}

/**
 * The mission's notices: MISSION CHECKPOINT SAVED (brief, once per checkpoint) and, after a
 * resume, MISSION RESUMED with the phase restored (or RESUMED FROM LAST SAFE CHECKPOINT with
 * why). Small, at the top centre, never over the flight controls; nothing to tap.
 */
export function MissionSaveNotice({ notice, lang = "en", below = "nav" }) {
  const t = T(lang);
  const [shown, setShown] = useState(null);
  useEffect(() => {
    if (!notice) return undefined;
    setShown(notice);
    const id = setTimeout(() => setShown(null), notice.kind === "saved" ? 2600 : 5200);
    return () => clearTimeout(id);
  }, [notice]);
  if (!shown) return null;
  // under the site's navigation bar (--hud-top), or, in a phase with a top HUD bar (docking,
  // reentry), under that bar too: never over an instrument or a control
  const top = "absolute left-1/2 -translate-x-1/2 z-[75] pointer-events-none safe-mt";
  const topStyle = { top: below === "hud" ? "calc(var(--hud-top) + 3.1rem)" : "calc(var(--hud-top) + 0.35rem)" };
  if (shown.kind === "saved") {
    return (
      <div key={shown.at} style={topStyle} className={`${top} scan-in bg-black/55 backdrop-blur-sm border border-[#4fd1c5]/40 px-3 py-1.5 short:py-1 whitespace-nowrap`} data-testid="checkpoint-saved" data-checkpoint={shown.checkpoint}>
        <span className="font-mono text-[9px] short:text-[8px] tracking-[0.3em] short:tracking-[0.2em] text-[#4fd1c5]">✓ {t.savedChip}</span>
        <span className="font-mono text-[9px] short:text-[8px] tracking-[0.2em] short:tracking-[0.12em] text-zinc-300"> · {checkpointText(shown.checkpoint, lang)}</span>
      </div>
    );
  }
  const safe = shown.interrupted || shown.fallback;
  return (
    <div key={shown.at} style={topStyle} className={`${top} scan-in bg-black/65 backdrop-blur-sm border-l-2 ${safe ? "border-[#f5c451]" : "border-[#4fd1c5]"} px-4 py-2 short:px-3 short:py-1.5 max-w-[min(34rem,86vw)] text-center`} data-testid="mission-resumed" data-checkpoint={shown.checkpoint} data-interrupted={shown.interrupted ? "1" : "0"}>
      <div className={`font-mono text-[10px] short:text-[9px] tracking-[0.32em] short:tracking-[0.22em] ${safe ? "text-[#f5c451]" : "text-[#4fd1c5]"}`}>● {safe ? t.resumedSafe : t.resumed}</div>
      <div className="font-mono text-[10px] short:text-[9px] tracking-[0.22em] short:tracking-[0.14em] text-white mt-0.5">{RESUME_AT[shown.checkpoint] ? RESUME_AT[shown.checkpoint].text[lang === "pt" ? "pt" : "en"] : ""}</div>
      {shown.interrupted && <div className="font-mono text-[9px] short:text-[8px] tracking-[0.06em] text-zinc-300 mt-0.5">{t.interruptedNote}</div>}
      {!shown.interrupted && shown.fallback && <div className="font-mono text-[9px] short:text-[8px] tracking-[0.06em] text-zinc-300 mt-0.5">{t.fallbackNote}</div>}
    </div>
  );
}
