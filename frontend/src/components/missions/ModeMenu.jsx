import { ChevronRight } from "lucide-react";

/**
 * The game menu, after the opening: START MISSIONS on the title screen opens it,
 * over the same lunar-orbit shot and in the title's place (LUNAVIA / A LAJU
 * PRODUCTIONS GAME stay on screen). Two choices: the four official lunar
 * missions, or the Flight Training Center.
 */
export default function ModeMenu({ onMissions, onTraining }) {
  const choice = (testId, onClick, title, sub, primary) => (
    <button
      type="button"
      onClick={onClick}
      data-testid={testId}
      className={`pointer-events-auto w-full min-h-[56px] px-5 py-3 short:py-2 flex items-center justify-between gap-4 text-left border touch-manipulation transition-colors duration-200 ${
        primary
          ? "bg-[#FF3B00]/90 hover:bg-[#FF3B00] active:bg-[#d93200] border-[#FF3B00] shadow-[0_0_28px_rgba(255,59,0,0.3)]"
          : "bg-black/45 hover:bg-white/10 border-white/40 backdrop-blur-sm"
      }`}
    >
      <span className="min-w-0">
        <span className="block font-mono text-[13px] short:text-[12px] tracking-[0.42em] text-white">{title}</span>
        <span className="block font-mono text-[9px] tracking-[0.22em] text-white/75 mt-1 truncate">{sub}</span>
      </span>
      <ChevronRight size={16} className="text-white shrink-0" />
    </button>
  );

  return (
    <div className="absolute inset-0 z-30 pointer-events-none select-none veil-in" data-testid="mode-menu">
      <div className="absolute inset-y-0 left-0 w-[70%] md:w-[55%] bg-gradient-to-r from-black/70 via-black/35 to-transparent" aria-hidden />
      <div className="absolute inset-y-0 left-0 w-[62%] md:w-[50%] flex flex-col items-center justify-center text-center px-6 safe-ml">
        <h1
          className="title-reveal-name font-display font-black text-white leading-none"
          style={{ letterSpacing: "0.42em", textShadow: "0 2px 24px rgba(0,0,0,0.65)" }}
          data-testid="mode-menu-name"
        >
          LUNAVIA
        </h1>
        <div className="font-mono text-[11px] short:text-[10px] tracking-[0.55em] text-zinc-200 mt-4 short:mt-3" style={{ textShadow: "0 1px 12px rgba(0,0,0,0.8)" }}>
          A LAJU PRODUCTIONS GAME
        </div>
        <div className="mt-7 short:mt-4 w-full max-w-[320px] flex flex-col gap-3 short:gap-2">
          {choice("mode-missions", onMissions, "MISSIONS", "FOUR OFFICIAL LUNAR MISSIONS", true)}
          {choice("mode-training", onTraining, "TRAINING", "FLIGHT TRAINING CENTER", false)}
        </div>
      </div>
    </div>
  );
}
