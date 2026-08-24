import { useEffect, useState } from "react";

export default function PhaseTransition({ phase, onDone }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!phase) return;
    setVisible(true);
    const hide = setTimeout(() => setVisible(false), 3200);
    const done = setTimeout(() => onDone && onDone(), 3600);
    return () => {
      clearTimeout(hide);
      clearTimeout(done);
    };
  }, [phase, onDone]);

  if (!phase) return null;

  return (
    <div
      data-testid="phase-transition"
      className={`fixed inset-0 z-40 pointer-events-none flex items-center justify-center transition-opacity duration-500 ${
        visible ? "opacity-100" : "opacity-0"
      }`}
    >
      <div className="absolute inset-0 bg-black/50 backdrop-blur-sm" />
      <div className="relative max-w-3xl px-8 text-center scan-in">
        <div className="font-mono text-[10px] tracking-[0.4em] text-[#FF3B00] mb-3 blink">
          ● MISSION EVENT
        </div>
        <div className="font-mono text-[11px] tracking-[0.3em] text-zinc-400 mb-2">
          {phase.code}
        </div>
        <h2 className="font-display font-black text-5xl md:text-6xl tracking-tight text-white">
          {phase.name}
        </h2>
        <div className="mt-3 font-mono text-[11px] tracking-[0.3em] text-zinc-500">
          {phase.location}
        </div>
        <div className="mt-6 text-zinc-300 text-sm max-w-xl mx-auto leading-relaxed">
          {phase.objective}
        </div>
      </div>
    </div>
  );
}
