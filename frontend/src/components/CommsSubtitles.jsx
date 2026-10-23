import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import comms from "@/audio/comms";
import { useAudioSettings } from "@/audio/audioSettings";

/*
 * Mission-control subtitles. Shown while a call is on the air (and briefly
 * after), in the SUBTITLE language, which is independent of the voice
 * language. Placed in the upper middle of the screen, below the HUD's top
 * band and the training hold chip; on phones it stays inside the gap
 * between the left and right HUD columns, away from the flight controls in
 * the lower corners. Never intercepts touches.
 *
 * A scene can ask for the "corner" placement (setSubtitlePlacement): the same
 * caption, same type and timing, set in the upper-left corner under the phase
 * banner on a lighter backing, so it never covers what the shot is about (the
 * capsule under its parachutes, the splashdown and the recovery). The lunar EVA
 * asks for the "lane" placement while the astronaut walks: the top of the screen
 * between its objectives panel (upper left) and PAUSE (upper right), above the
 * astronaut's helmet.
 */
const ROLE_TONE = {
  CAPCOM: "text-[#FF3B00]",
  FLIGHT: "text-amber-300",
  GUIDANCE: "text-sky-300",
  COMPUTER: "text-emerald-300",
  CREW: "text-zinc-300",
};

let placement = "default";
const listeners = new Set();
/** "default" (upper middle), "corner" (upper left, restrained) or "lane" (the top, between a panel and PAUSE). */
export function setSubtitlePlacement(p) {
  const next = p === "corner" || p === "lane" ? p : "default";
  if (next === placement) return;
  placement = next;
  listeners.forEach((f) => f());
}
const subscribe = (f) => {
  listeners.add(f);
  return () => listeners.delete(f);
};
const getPlacement = () => placement;

/**
 * The upper lane between a scene's upper-left panel (at most min(260px, 42vw) wide, 1rem or, from
 * md, 2rem in) and its PAUSE button (upper right: 44 px, or "II PAUSE" from md). The lunar EVA puts
 * its subtitles and notices there.
 */
export const SUBTITLE_LANE =
  "left-[calc(var(--sal)+min(260px,42vw)+1.75rem)] md:left-[calc(var(--sal)+min(260px,42vw)+2.75rem)] right-[calc(var(--sar)+4.5rem)] md:right-[calc(var(--sar)+9rem)]";

const PLACE = {
  lane: `${SUBTITLE_LANE} flex justify-center top-[calc(var(--hud-top)+0.25rem)]`,
  default:
    "left-1/2 -translate-x-1/2 w-max max-w-[min(560px,64vw)] short:max-w-[32vw] top-[calc(var(--hud-top)+6.2rem)] short:top-[calc(var(--hud-top)+5.9rem)]",
  corner:
    "left-[calc(var(--sal)+1rem)] md:left-[calc(var(--sal)+2rem)] w-max max-w-[min(420px,40vw)] short:max-w-[36vw] top-[calc(var(--hud-top)+4.4rem)] short:top-[calc(var(--hud-top)+2.75rem)]",
};

export default function CommsSubtitles() {
  const st = useAudioSettings();
  const where = useSyncExternalStore(subscribe, getPlacement, getPlacement);
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
  const corner = where === "corner";
  return (
    <div className={`fixed z-[45] pointer-events-none ${PLACE[where]}`} data-testid="comms-subtitle" data-line={cur.id} data-placement={where} aria-live="polite">
      <div className={`${corner ? "bg-black/40" : "bg-black/65"} ${where === "lane" ? "min-w-0 max-w-full" : ""} border-l-2 border-white/25 px-3 py-1.5 short:px-2 short:py-1 text-left`}>
        <span className={`font-mono text-[9px] tracking-[0.3em] mr-2 ${ROLE_TONE[cur.role] || "text-zinc-400"}`}>{cur.label[lang]}</span>
        <span className="text-[13px] short:text-[11px] leading-snug text-white">{cur.text[lang]}</span>
      </div>
    </div>
  );
}
