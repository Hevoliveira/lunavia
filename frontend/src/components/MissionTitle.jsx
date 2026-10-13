import { useEffect, useRef } from "react";
import { startLabel, titleCards } from "@/data/titleReveal";
import { useAudioSettings } from "@/audio/audioSettings";

/**
 * LUNAVIA · A LAJU PRODUCTIONS GAME, over the lunar-orbit shot that follows
 * the lunar module after the go for powered descent (data/titleReveal), then
 * the title screen: START MISSIONS (INICIAR MISSÕES in Portuguese), held with
 * no timer until it is pressed. It reads the mission's orbit clock every frame
 * and sets the opacities itself: no React render per frame. The button is the
 * only thing here that takes input, and only once `ready` (the mission's TITLE
 * state); `onStart` is called once.
 */
export default function MissionTitle({ clockRef, ready = false, onStart }) {
  const st = useAudioSettings();
  const root = useRef();
  const veil = useRef();
  const title = useRef();
  const credit = useRef();
  const button = useRef();
  const pressed = useRef(false);

  useEffect(() => {
    let raf;
    let last = "";
    const tick = () => {
      const c = titleCards(clockRef.current);
      const b = ready ? c.button : 0;
      const key = `${c.title.toFixed(3)}|${c.credit.toFixed(3)}|${b.toFixed(3)}`;
      if (key !== last && root.current) {
        last = key;
        root.current.style.visibility = c.veil > 0.001 ? "visible" : "hidden";
        root.current.dataset.title = c.title.toFixed(2);
        veil.current.style.opacity = c.veil;
        title.current.style.opacity = c.title;
        title.current.style.letterSpacing = `${0.42 - 0.16 * c.title}em`;
        credit.current.style.opacity = c.credit;
        if (button.current) {
          button.current.style.opacity = b;
          button.current.style.transform = `translateY(${(1 - b) * 8}px)`;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [clockRef, ready]);

  const start = () => {
    if (!ready || pressed.current) return;
    pressed.current = true;
    if (button.current) button.current.disabled = true;
    onStart && onStart();
  };

  return (
    <div ref={root} className="absolute inset-0 z-20 pointer-events-none select-none" style={{ visibility: "hidden" }} data-testid="title-reveal" data-ready={ready ? "1" : "0"}>
      <div ref={veil} className="absolute inset-y-0 left-0 w-[70%] md:w-[55%] bg-gradient-to-r from-black/70 via-black/35 to-transparent" style={{ opacity: 0 }} aria-hidden />
      <div className="absolute inset-y-0 left-0 w-[62%] md:w-[50%] flex flex-col items-center justify-center text-center px-6 safe-ml">
        <h1
          ref={title}
          className="title-reveal-name font-display font-black text-white leading-none"
          style={{ opacity: 0, letterSpacing: "0.42em", textShadow: "0 2px 24px rgba(0,0,0,0.65)" }}
          data-testid="title-reveal-name"
        >
          LUNAVIA
        </h1>
        <div
          ref={credit}
          className="font-mono text-[11px] short:text-[10px] tracking-[0.55em] text-zinc-200 mt-4 short:mt-3"
          style={{ opacity: 0, textShadow: "0 1px 12px rgba(0,0,0,0.8)" }}
          data-testid="title-reveal-credit"
        >
          A LAJU PRODUCTIONS GAME
        </div>
        {ready && (
          <button
            ref={button}
            type="button"
            onClick={start}
            data-testid="btn-start-missions"
            className="title-start pointer-events-auto mt-8 short:mt-5 min-h-[56px] min-w-[240px] px-8 font-mono text-[13px] short:text-[12px] tracking-[0.42em] text-white bg-[#FF3B00]/90 hover:bg-[#FF3B00] active:bg-[#d93200] border border-[#FF3B00] shadow-[0_0_28px_rgba(255,59,0,0.35)] touch-manipulation disabled:opacity-60"
            style={{ opacity: 0 }}
          >
            {startLabel(st.subLang)}
          </button>
        )}
      </div>
    </div>
  );
}
