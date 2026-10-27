import { useEffect, useRef, useState } from "react";
import { RECOVERY, RECOVERY_CALLS, RECOVERY_CUES, T, cameraAt, captionAt, crewAboard, dipAt, finaleAt, heliAt } from "@/data/oceanRecovery";

/*
 * OCEAN RECOVERY's screen layer over the cinematic: the stage caption (it reads with the sound
 * off), the crew count during the hoist, the montage's dip to black, the closing words (CREW
 * RECOVERED · WELCOME HOME · MISSION ACCOMPLISHED) and SKIP RECOVERY. It also drives the sound:
 * the dramatized radio calls at their times and the rotor's loudness from the helicopter's
 * distance to the camera. The clock is the scene's (recRef.current.t).
 */

export const RECOVERY_TEXT = {
  en: {
    watch: "WATCH RECOVERY",
    skip: "SKIP RECOVERY",
    title: "OCEAN RECOVERY",
    dramatized: "DRAMATIZED RADIO · SYNTHETIC VOICES",
    aboard: (n) => `CREW ABOARD ${n}/3`,
    montage: "CREW RECOVERY · 2/3 · 3/3",
    captions: {
      afloat: "COMMAND MODULE AFLOAT · PACIFIC RECOVERY AREA",
      inbound: "RECOVERY HELICOPTER INBOUND",
      swimmers: "RECOVERY SWIMMERS DEPLOYED",
      collar: "FLOTATION COLLAR",
      raft: "LIFE RAFT ALONGSIDE",
      egress: "HATCH OPEN · CREW EGRESS",
      hoist: "CREW RECOVERY · RESCUE BASKET",
      allAboard: "ALL CREW ABOARD · RETURNING TO THE SHIP",
    },
    words: { crewRecovered: "CREW RECOVERED", welcomeHome: "WELCOME HOME", accomplished: "MISSION ACCOMPLISHED" },
  },
  pt: {
    watch: "ASSISTIR AO RESGATE",
    skip: "PULAR RESGATE",
    title: "RESGATE NO OCEANO",
    dramatized: "RÁDIO DRAMATIZADO · VOZES SINTÉTICAS",
    aboard: (n) => `TRIPULAÇÃO A BORDO ${n}/3`,
    montage: "RESGATE DA TRIPULAÇÃO · 2/3 · 3/3",
    captions: {
      afloat: "MÓDULO DE COMANDO FLUTUANDO · ÁREA DE RESGATE NO PACÍFICO",
      inbound: "HELICÓPTERO DE RESGATE A CAMINHO",
      swimmers: "MERGULHADORES DE RESGATE NA ÁGUA",
      collar: "COLAR DE FLUTUAÇÃO",
      raft: "BOTE SALVA-VIDAS AO LADO",
      egress: "ESCOTILHA ABERTA · SAÍDA DA TRIPULAÇÃO",
      hoist: "RESGATE DA TRIPULAÇÃO · CESTO DE RESGATE",
      allAboard: "TRIPULAÇÃO A BORDO · RETORNANDO AO NAVIO",
    },
    words: { crewRecovered: "TRIPULAÇÃO RESGATADA", welcomeHome: "BEM-VINDOS DE VOLTA", accomplished: "MISSÃO CUMPRIDA" },
  },
};
export const recoveryText = (lang) => RECOVERY_TEXT[lang === "pt" ? "pt" : "en"];

export default function RecoveryOverlay({ recRef, lang = "en", audio = null, onSkip }) {
  const L = recoveryText(lang);
  const [t, setT] = useState(0);
  const said = useRef(new Set());
  useEffect(() => {
    if (audio && audio.recoveryStart) audio.recoveryStart();
    const id = setInterval(() => {
      const r = recRef.current;
      if (!r || !r.active) return;
      const now = r.t;
      setT(now);
      // the dramatized calls, once each, when their moment comes (none if skipped past)
      for (const c of RECOVERY_CALLS) {
        if (now >= c.t && now < c.t + 2 && !said.current.has(c.id)) {
          said.current.add(c.id);
          if (audio && audio.say) audio.say(c.id);
        }
      }
      // the equipment's sounds, each once at its moment
      RECOVERY_CUES.forEach((c, i) => {
        if (now >= c.t && now < c.t + 1 && !said.current.has(`cue${i}`)) {
          said.current.add(`cue${i}`);
          if (audio && audio.recoveryCue) audio.recoveryCue(c.id, c.dur);
        }
      });
      // the rotor's loudness from the helicopter's distance to the camera (silent before it appears)
      if (audio && audio.recoverySet) {
        const h = heliAt(now);
        const cam = cameraAt(now);
        const d = Math.hypot(h.pos[0] - cam.pos[0], h.pos[1] - cam.pos[1], h.pos[2] - cam.pos[2]);
        audio.recoverySet({ rotor: h.visible ? Math.min(1, 28 / Math.max(28, d)) : 0, sea: 1 - Math.min(1, 28 / Math.max(28, d)) * 0.5 });
      }
    }, 100);
    return () => {
      clearInterval(id);
      if (audio && audio.recoveryStop) audio.recoveryStop(1.0);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cap = captionAt(t);
  const words = finaleAt(t);
  const dip = dipAt(t);
  const aboard = crewAboard(t);
  const hoisting = t >= T.lower[0] && t < T.depart;
  const progress = Math.min(1, t / RECOVERY.duration);
  return (
    <div className="absolute inset-0 z-40 pointer-events-none select-none" data-testid="recovery-overlay" data-t={t.toFixed(1)}>
      {/* the montage's dip to black */}
      <div className="absolute inset-0 bg-black" style={{ opacity: dip }} />
      {dip > 0.6 && (
        <div className="absolute inset-0 flex items-center justify-center" data-testid="recovery-montage">
          <div className="font-mono text-[11px] tracking-[0.4em] text-zinc-300">{L.montage}</div>
        </div>
      )}
      {/* the title and the radio note, top left */}
      <div className="absolute top-[calc(var(--hud-top)+0.25rem)] left-[calc(var(--sal)+1rem)] md:left-[calc(var(--sal)+2rem)] bg-black/40 backdrop-blur-sm border-l-2 border-[#FF3B00] px-3 py-1.5" data-testid="recovery-title">
        <div className="font-mono text-[9px] tracking-[0.4em] text-[#FF3B00]">● {L.title}</div>
        <div className="font-mono text-[7.5px] tracking-[0.2em] text-zinc-400 mt-0.5">{L.dramatized}</div>
        <div className="mt-1 h-px w-28 bg-white/15">
          <div className="h-px bg-white/60" style={{ width: `${progress * 100}%` }} />
        </div>
      </div>
      {/* the stage caption, lower left */}
      {cap && !words.length && (
        <div key={cap} className="absolute bottom-6 short:bottom-3 left-[calc(var(--sal)+1rem)] md:left-[calc(var(--sal)+2rem)] scan-in bg-black/45 backdrop-blur-sm border-l-2 border-[#4fd1c5] px-3 py-1.5 max-w-[min(30rem,62vw)]" data-testid="recovery-caption" data-caption={cap}>
          <div className="font-mono text-[10px] short:text-[9px] tracking-[0.28em] text-white">{L.captions[cap]}</div>
          {hoisting && cap === "hoist" && (
            <div className="font-mono text-[9px] tracking-[0.25em] text-[#4fd1c5] mt-0.5" data-testid="recovery-aboard">
              {L.aboard(aboard)}
            </div>
          )}
        </div>
      )}
      {/* the closing words */}
      {words.length > 0 && (
        <div className="absolute inset-x-0 top-[41%] short:top-[40%] flex flex-col items-center text-center px-4" data-testid="recovery-finale" data-words={words.join(",")}>
          {words.includes("crewRecovered") && <div className="font-mono text-[11px] short:text-[10px] tracking-[0.5em] text-[#4fd1c5] scan-in">{L.words.crewRecovered}</div>}
          {words.includes("welcomeHome") && (
            <div className="font-display font-black text-white text-5xl md:text-6xl short:text-4xl tracking-tight mt-2 scan-in drop-shadow-[0_2px_14px_rgba(0,0,0,0.6)]">{L.words.welcomeHome}</div>
          )}
          {words.includes("accomplished") && <div className="font-mono text-[10px] short:text-[9px] tracking-[0.45em] text-zinc-200 mt-3 scan-in">LUNAVIA — {L.words.accomplished}</div>}
        </div>
      )}
      {/* SKIP RECOVERY: straight to the mission's results (nothing is lost) */}
      <button
        type="button"
        onClick={onSkip}
        data-testid="recovery-skip"
        className="pointer-events-auto absolute bottom-6 short:bottom-2 right-6 md:right-10 safe-mr safe-mb font-mono text-[10px] tracking-[0.3em] text-zinc-300 hover:text-white px-3 py-2 touch:min-h-[44px] touch:px-4 bg-black/35 border border-white/15"
      >
        {L.skip} ›
      </button>
    </div>
  );
}
