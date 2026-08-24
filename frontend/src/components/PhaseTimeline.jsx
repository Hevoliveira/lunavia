export default function PhaseTimeline({ phases, activePhaseId, onJump }) {
  return (
    <div
      className="hud-panel p-4 corners relative"
      data-testid="phase-timeline"
    >
      <div className="flex items-center justify-between mb-3">
        <span className="font-mono text-[9px] tracking-[0.3em] text-zinc-500">
          MISSION PHASES
        </span>
        <span className="font-mono text-[9px] tracking-[0.3em] text-zinc-500">
          {phases.length.toString().padStart(2, "0")} SEQ
        </span>
      </div>
      <ol className="space-y-1.5">
        {phases.map((p, idx) => {
          const active = p.id === activePhaseId;
          return (
            <li key={p.id}>
              <button
                onClick={() => onJump(p)}
                data-testid={`phase-jump-${p.id}`}
                className={`w-full text-left flex items-start gap-3 px-3 py-2 border transition-colors duration-200 ${
                  active
                    ? "bg-[#FF3B00]/10 border-[#FF3B00] text-white"
                    : "bg-transparent border-white/10 text-zinc-400 hover:border-white/40 hover:text-white"
                }`}
              >
                <span className="font-mono text-[10px] w-6 shrink-0 tabular">
                  {String(idx + 1).padStart(2, "0")}
                </span>
                <span className="flex-1">
                  <span className="block font-mono text-[10px] tracking-widest">
                    {p.code}
                  </span>
                  <span className="block font-display text-sm font-semibold mt-0.5">
                    {p.name}
                  </span>
                </span>
                {active && (
                  <span className="font-mono text-[9px] text-[#FF3B00] tracking-[0.2em] mt-1">
                    ● LIVE
                  </span>
                )}
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
