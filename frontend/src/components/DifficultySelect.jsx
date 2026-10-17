import { DIFFICULTY } from "@/data/landingPhysics";

/**
 * DifficultySelect — the pilot difficulty (CADET / ASTRONAUT / COMMANDER).
 * The official missions choose it before launch (MissionSelect: kicker,
 * title, text, the current choice highlighted, back); with onSkip it also
 * offers the cinematic auto-landing.
 */
export default function DifficultySelect({
  onSelect,
  onSkip = null,
  onBack = null,
  backLabel = "BACK",
  selected = null,
  kicker = "● MANUAL DESCENT — SELECT DIFFICULTY",
  title = "YOU'RE FLYING IT",
  text = "A partir de agora o pouso é sua responsabilidade. Escolha o nível de assistência e combustível. Você pode reiniciar a fase a qualquer momento.",
}) {
  return (
    <div
      data-testid="difficulty-select"
      className="absolute inset-0 z-40 bg-black/80 backdrop-blur-md flex items-center justify-center pl-[max(1.5rem,var(--sal))] pr-[max(1.5rem,var(--sar))] short:items-start short:overflow-y-auto short:pt-14 short:pb-4"
    >
      <div className="max-w-4xl w-full short:my-auto">
        <div className="text-center mb-8 short:mb-4">
          <div className="font-mono text-[10px] short:text-[9px] tracking-[0.4em] short:tracking-[0.25em] text-[#FF3B00] mb-3 short:mb-1" data-testid="difficulty-kicker">
            {kicker}
          </div>
          <h2 className="font-display font-black text-white text-4xl md:text-6xl short:text-3xl leading-none">
            {title}
          </h2>
          <p className="text-zinc-400 mt-4 short:mt-1.5 short:text-xs max-w-xl mx-auto text-sm leading-relaxed">
            {text}
          </p>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 short:grid-cols-3 gap-4 short:gap-2">
          {Object.values(DIFFICULTY).map((d) => (
            <button
              key={d.key}
              onClick={() => onSelect(d.key)}
              data-testid={`difficulty-${d.key.toLowerCase()}`}
              aria-pressed={selected === d.key}
              className={`hud-panel corners relative p-6 short:p-3 text-left group hover:border-[#FF3B00] transition-colors duration-200 border ${selected === d.key ? "border-[#FF3B00]/80" : "border-white/10"}`}
            >
              <div className="font-mono text-[10px] tracking-[0.4em] text-[#FF3B00] mb-2">
                LEVEL · 0{Object.keys(DIFFICULTY).indexOf(d.key) + 1}
              </div>
              <div className="font-display font-black text-white text-3xl short:text-2xl mb-3 short:mb-1">
                {d.label}
              </div>
              <div className="text-sm short:text-xs text-zinc-400 mb-4 short:mb-2 leading-relaxed">
                {d.desc}
              </div>
              <div className="grid grid-cols-2 gap-2 font-mono text-[9px] tracking-widest text-zinc-500">
                <div>ALT<br/><span className="text-white tabular">{d.initialAlt} m</span></div>
                <div>FUEL<br/><span className="text-white tabular">{d.initialFuel} kg</span></div>
                <div>MAX Vy<br/><span className="text-white tabular">{d.safeVy} m/s</span></div>
                    <div>MAX Vx<br/><span className="text-white tabular">{d.safeVx} m/s</span></div>
                <div>MAX TILT<br/><span className="text-white tabular">{d.safeTilt}°</span></div>
              </div>
              <div className="mt-6 short:mt-3 font-mono text-[10px] tracking-[0.3em] text-zinc-500 group-hover:text-[#FF3B00]">
                SELECT →
              </div>
            </button>
          ))}
        </div>
        <div className="mt-6 short:mt-2 flex items-center justify-center gap-4">
          {onBack && (
            <button
              type="button"
              onClick={onBack}
              data-testid="difficulty-back"
              className="btn-hud min-h-[44px]"
            >
              ← {backLabel}
            </button>
          )}
          {onSkip && (
            <button
              onClick={onSkip}
              data-testid="difficulty-skip"
              className="font-mono text-[10px] tracking-[0.3em] text-zinc-500 hover:text-white transition-colors py-3 px-2"
            >
              SKIP — WATCH CINEMATIC AUTO-LANDING
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
