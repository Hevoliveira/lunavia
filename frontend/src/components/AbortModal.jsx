import { X, AlertTriangle } from "lucide-react";

export default function AbortModal({ open, onCancel, onConfirm }) {
  if (!open) return null;
  return (
    <div
      data-testid="abort-modal"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-md"
    >
      <div className="hud-panel corners relative max-w-3xl w-full mx-6 p-8 fade-in border-2 border-[#FF3B00]">
        <div className="flex items-center gap-3 mb-4">
          <AlertTriangle size={18} className="text-[#FF3B00]" />
          <span className="font-mono text-[10px] tracking-[0.4em] text-[#FF3B00] blink">
            ● ABORT MISSION
          </span>
        </div>
        <h3 className="font-display font-black text-white text-3xl md:text-4xl mb-3">
          ARE YOU SURE?
        </h3>
        <p className="text-zinc-300 text-sm leading-relaxed mb-8">
          All mission progress will be lost. The vehicle will return to the launch pad
          and the countdown will need to be reinitiated.
        </p>
        <div className="flex gap-3">
          <button
            onClick={onCancel}
            data-testid="abort-cancel"
            className="btn-hud flex-1 justify-center"
          >
            <X size={12} /> CANCEL — CONTINUE MISSION
          </button>
          <button
            onClick={onConfirm}
            data-testid="abort-confirm"
            className="btn-hud btn-hud-primary flex-1 justify-center"
          >
            ABORT · RETURN TO PAD
          </button>
        </div>
      </div>
    </div>
  );
}
