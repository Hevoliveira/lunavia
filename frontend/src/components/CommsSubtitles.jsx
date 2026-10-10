import { useEffect, useRef, useState } from "react";
import comms from "@/audio/comms";
import { useAudioSettings } from "@/audio/audioSettings";

/*
 * Mission-control subtitles. Shown while a call is on the air (and briefly
 * after), in the SUBTITLE language, which is independent of the voice
 * language. Placed in the upper middle of the screen, below the HUD's top
 * band and away from the flight controls in the lower corners; never
 * intercepts touches.
 */
const ROLE_TONE = {
  CAPCOM: "text-[#FF3B00]",
  FLIGHT: "text-amber-300",
  GUIDANCE: "text-sky-300",
  COMPUTER: "text-emerald-300",
  CREW: "text-zinc-300",
};

export default function CommsSubtitles() {
  const st = useAudioSettings();
  const [cur, setCur] = useState(null);
  const hideRef = useRef(null);

  useEffect(() => {
    const off = comms.subscribe((e) => {
      if (e.type === "start") {
        clearTimeout(hideRef.current);
        setCur(e);
      } else if (e.type === "end") {
        clearTimeout(hideRef.current);
        hideRef.current = setTimeout(() => setCur((c) => (c && c.id === e.id ? null : c)), 650);
      }
    });
    return () => {
      off();
      clearTimeout(hideRef.current);
    };
  }, []);

  if (!st.subtitles || !cur) return null;
  const lang = st.subLang;
  return (
    <div
      className="fixed left-1/2 -translate-x-1/2 z-[45] pointer-events-none w-max max-w-[min(560px,64vw)] short:max-w-[50vw]"
      style={{ top: "calc(var(--hud-top) + 4.4rem)" }}
      data-testid="comms-subtitle"
      data-line={cur.id}
      aria-live="polite"
    >
      <div className="bg-black/65 border-l-2 border-white/25 px-3 py-1.5 short:px-2 short:py-1 text-left">
        <span className={`font-mono text-[9px] tracking-[0.3em] mr-2 ${ROLE_TONE[cur.role] || "text-zinc-400"}`}>{cur.label[lang]}</span>
        <span className="text-[13px] short:text-[11px] leading-snug text-white">{cur.text[lang]}</span>
      </div>
    </div>
  );
}
