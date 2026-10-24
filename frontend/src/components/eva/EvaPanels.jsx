/**
 * The expeditions' HUD panels (EN/PT), on the right of the screen clear of the astronaut (centre),
 * the objectives (upper left), the subtitles (top lane) and the actions (lower corners):
 *  - InfoCard: the science of what was just surveyed or deployed (data/evaMissions texts);
 *  - DataPanel: the far side's radio receiver, its own interface: the status of the antenna and
 *    the receiver, the first data block recording, and CONFIRM DATA once it is stored. Qualitative
 *    only: there is no radio model behind it, so it shows no invented measurements.
 */
export function InfoCard({ card, T, onClose }) {
  if (!card) return null;
  return (
    <div className="absolute right-[calc(var(--sar)+1rem)] md:right-[calc(var(--sar)+2rem)] top-[30%] short:top-[26%] z-30 w-[min(300px,38vw)] hud-panel border-l-2 px-3 py-2.5 short:py-2 veil-in" style={{ borderLeftColor: card.color || "#b5e06b" }} data-testid="eva-info-card" data-kind={card.kind}>
      <div className="font-mono text-[8.5px] tracking-[0.3em]" style={{ color: card.color || "#b5e06b" }}>
        ● {T.science} · {card.tag}
      </div>
      <div className="mt-1 font-mono text-[11px] short:text-[10px] tracking-[0.12em] text-white leading-tight">{card.title}</div>
      <p className="mt-1.5 text-[11px] short:text-[10px] leading-snug text-zinc-200 max-h-[34vh] overflow-y-auto pr-1">{card.body}</p>
      <button type="button" onClick={onClose} data-testid="eva-info-close" className="mt-2 min-h-[40px] w-full font-mono text-[9.5px] tracking-[0.25em] text-white bg-black/40 border border-white/25 touch-manipulation">
        {T.close}
      </button>
    </div>
  );
}

export function DataPanel({ T, u, ready, confirmed, onConfirm, onClose }) {
  const D = T.data;
  const row = (k, v, ok = true, testid) => (
    <div className="flex items-baseline justify-between gap-2 py-0.5 border-b border-white/10" data-testid={testid}>
      <span className="text-zinc-400 shrink-0">{k}</span>
      <span className={`text-right ${ok ? "text-[#5be37a]" : "text-[#f5c451]"}`}>{v}</span>
    </div>
  );
  return (
    <div className="absolute right-[calc(var(--sar)+1rem)] md:right-[calc(var(--sar)+2rem)] top-[27%] short:top-[25%] z-30 w-[min(330px,42vw)] hud-panel border-l-2 border-[#6aa8ff] px-3 py-2.5 short:py-2 veil-in" data-testid="eva-data-panel" data-ready={ready ? "1" : "0"} data-confirmed={confirmed ? "1" : "0"}>
      <div className="font-mono text-[8.5px] tracking-[0.3em] text-[#6aa8ff]">● {D.title}</div>
      <div className="font-mono text-[8px] tracking-[0.25em] text-zinc-400 mt-0.5">{D.sub}</div>
      <div className="mt-1.5 font-mono text-[9.5px] short:text-[9px] tracking-[0.1em]">
        {row(D.antennas, `${D.antennasOk} ✓`)}
        {row(D.power, `${D.powerOk} ✓`)}
        {row(D.rf, `${D.rfOk} ✓`)}
        {row(D.block, ready ? `${D.recorded} ✓` : `${D.recording} ${Math.floor(Math.min(0.99, u) * 100)}%`, ready, "eva-data-block")}
        {!ready && (
          <div className="mt-1.5 h-1 bg-white/15">
            <div className="h-1 bg-[#f5c451]" style={{ width: `${Math.min(100, u * 100)}%` }} />
          </div>
        )}
      </div>
      {confirmed ? (
        <div className="mt-2 font-mono text-[9.5px] tracking-[0.18em] leading-snug text-[#5be37a]" data-testid="eva-data-confirmed">
          ✓ {D.confirmed}
        </div>
      ) : (
        <>
          {!ready && <p className="mt-1.5 text-[10.5px] leading-snug text-zinc-300">{D.wait}</p>}
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button type="button" onClick={onClose} data-testid="eva-data-close" className="min-h-[44px] font-mono text-[9.5px] tracking-[0.2em] text-white bg-black/40 border border-white/25 touch-manipulation">
              {T.close}
            </button>
            <button type="button" onClick={onConfirm} disabled={!ready} data-testid="eva-data-confirm" className="min-h-[44px] font-mono text-[9.5px] tracking-[0.2em] text-white bg-[#2c5aa0] border border-[#6aa8ff] disabled:opacity-35 touch-manipulation">
              {D.confirm}
            </button>
          </div>
        </>
      )}
    </div>
  );
}
