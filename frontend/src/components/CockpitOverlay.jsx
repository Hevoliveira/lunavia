import { Eye, EyeOff } from "lucide-react";

/**
 * CockpitOverlay — SVG window-frame overlay giving an "inside the capsule"
 * feel. Sits on top of an existing 3D scene without changing it. When
 * active, borders + rivets + HUD reticle draw a cockpit window over the
 * whole view.
 */
export default function CockpitOverlay({ active, onToggle, hint }) {
  return (
    <>
      {active && (
        <div
          data-testid="cockpit-overlay"
          className="absolute inset-0 pointer-events-none z-30"
        >
          {/* Dark frame — bezier "trapezoid" window using CSS clip-path */}
          <div
            className="absolute inset-0"
            style={{
              background:
                "radial-gradient(ellipse 65% 55% at 50% 55%, transparent 50%, rgba(0,0,0,0.55) 75%, #050505 92%)",
            }}
          />
          {/* Window frame outline (trapezoid) */}
          <svg
            className="absolute inset-0 w-full h-full"
            viewBox="0 0 100 100"
            preserveAspectRatio="none"
          >
            <polygon
              points="12,22 88,22 92,78 8,78"
              fill="none"
              stroke="rgba(255,255,255,0.15)"
              strokeWidth="0.15"
            />
            <polygon
              points="12.4,22.4 87.6,22.4 91.5,77.6 8.5,77.6"
              fill="none"
              stroke="rgba(255,255,255,0.05)"
              strokeWidth="0.1"
            />
          </svg>
          {/* Rivets around window */}
          <div className="absolute inset-0">
            {[
              [15, 22], [30, 22], [50, 22], [70, 22], [85, 22],
              [12, 40], [12, 55], [12, 70],
              [88, 40], [88, 55], [88, 70],
              [15, 78], [30, 78], [50, 78], [70, 78], [85, 78],
            ].map(([x, y], i) => (
              <div
                key={i}
                className="absolute rounded-full bg-zinc-500"
                style={{
                  width: 3,
                  height: 3,
                  left: `${x}%`,
                  top: `${y}%`,
                  transform: "translate(-50%, -50%)",
                  boxShadow: "inset 0 0 1px #000",
                }}
              />
            ))}
          </div>
          {/* Reticle */}
          <svg
            className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 opacity-70"
            width="120"
            height="120"
            viewBox="0 0 120 120"
          >
            <circle cx="60" cy="60" r="30" stroke="#FF3B00" strokeWidth="0.7" fill="none" />
            <line x1="60" y1="20" x2="60" y2="42" stroke="#FF3B00" strokeWidth="0.7" />
            <line x1="60" y1="78" x2="60" y2="100" stroke="#FF3B00" strokeWidth="0.7" />
            <line x1="20" y1="60" x2="42" y2="60" stroke="#FF3B00" strokeWidth="0.7" />
            <line x1="78" y1="60" x2="100" y2="60" stroke="#FF3B00" strokeWidth="0.7" />
            <circle cx="60" cy="60" r="1.5" fill="#FF3B00" />
          </svg>
          {/* Corner labels */}
          <div className="absolute top-24 left-8 font-mono text-[10px] tracking-[0.3em] text-zinc-400">
            IVA · WINDOW #2
          </div>
          <div className="absolute top-24 right-8 font-mono text-[10px] tracking-[0.3em] text-zinc-400 text-right">
            RETICLE · ARMED<br />
            <span className="text-[#FF3B00]">● RANGE MODE</span>
          </div>
          {hint && (
            <div className="absolute bottom-24 left-1/2 -translate-x-1/2 font-mono text-[10px] tracking-[0.3em] text-zinc-400">
              {hint}
            </div>
          )}
        </div>
      )}
      {/* Toggle button */}
      <button
        onClick={onToggle}
        data-testid="cockpit-toggle"
        className="absolute top-20 left-4 md:left-8 hud-panel px-3 py-2 flex items-center gap-2 text-zinc-400 hover:text-[#FF3B00] transition-colors duration-200 font-mono text-[10px] tracking-[0.3em] z-40"
      >
        {active ? <EyeOff size={12} /> : <Eye size={12} />}
        {active ? "EXTERIOR" : "COCKPIT"}
      </button>
    </>
  );
}
