import { useEffect, useRef } from "react";
import { titleCards } from "@/data/titleReveal";

/**
 * LUNAVIA · A LAJU PRODUCTIONS GAME, over the lunar-orbit shot that follows
 * the lunar module after the go for powered descent (data/titleReveal). It
 * reads the mission's orbit clock every frame and sets the opacities itself:
 * no React render per frame, and nothing here touches the mission's state.
 * On the left of the frame, the lunar module held in the right third.
 */
export default function MissionTitle({ clockRef }) {
  const root = useRef();
  const veil = useRef();
  const title = useRef();
  const credit = useRef();

  useEffect(() => {
    let raf;
    let last = "";
    const tick = () => {
      const c = titleCards(clockRef.current);
      const key = `${c.title.toFixed(3)}|${c.credit.toFixed(3)}`;
      if (key !== last && root.current) {
        last = key;
        root.current.style.visibility = c.veil > 0.001 ? "visible" : "hidden";
        root.current.dataset.title = c.title.toFixed(2);
        veil.current.style.opacity = c.veil;
        title.current.style.opacity = c.title;
        title.current.style.letterSpacing = `${0.42 - 0.16 * c.title}em`;
        credit.current.style.opacity = c.credit;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [clockRef]);

  return (
    <div ref={root} className="absolute inset-0 z-20 pointer-events-none select-none" style={{ visibility: "hidden" }} data-testid="title-reveal" aria-hidden>
      <div ref={veil} className="absolute inset-y-0 left-0 w-[70%] md:w-[55%] bg-gradient-to-r from-black/70 via-black/35 to-transparent" style={{ opacity: 0 }} />
      <div className="absolute inset-y-0 left-0 w-[62%] md:w-[50%] flex flex-col items-center justify-center text-center px-6 safe-ml">
        <div
          ref={title}
          className="title-reveal-name font-display font-black text-white leading-none"
          style={{ opacity: 0, letterSpacing: "0.42em", textShadow: "0 2px 24px rgba(0,0,0,0.65)" }}
          data-testid="title-reveal-name"
        >
          LUNAVIA
        </div>
        <div
          ref={credit}
          className="font-mono text-[11px] short:text-[10px] tracking-[0.55em] text-zinc-200 mt-4 short:mt-3"
          style={{ opacity: 0, textShadow: "0 1px 12px rgba(0,0,0,0.8)" }}
          data-testid="title-reveal-credit"
        >
          A LAJU PRODUCTIONS GAME
        </div>
      </div>
    </div>
  );
}
