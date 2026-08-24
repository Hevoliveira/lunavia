import { RotateCcw, ArrowUpRight } from "lucide-react";
import { Link } from "react-router-dom";

/**
 * MissionResult — full-screen post-landing scoring screen.
 * Props: result = { grade, score, accuracy, touchdownSpeed, fuelRemaining, tilt, crewSafety, crashed }
 *        onRestart(), onExit()
 */
export default function MissionResult({ result, onRestart, onExit, difficulty }) {
  const isCrash = result.crashed;

  const gradeColor = {
    S: "text-[#FFD700]",
    A: "text-[#FF3B00]",
    B: "text-white",
    C: "text-zinc-400",
    D: "text-zinc-600",
  }[result.grade] || "text-white";

  return (
    <div
      data-testid="mission-result"
      className="absolute inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center px-6"
    >
      <div className="hud-panel corners relative max-w-3xl w-full p-8 md:p-12 fade-in">
        <div className="flex items-center justify-between mb-6">
          <div className="font-mono text-[10px] tracking-[0.4em] text-zinc-500">
            LM-1 · TRANQUILITY BASE · {difficulty}
          </div>
          <div className={`font-mono text-[10px] tracking-[0.4em] blink ${isCrash ? "text-[#FF3B00]" : "text-[#FF3B00]"}`}>
            ● {isCrash ? "MISSION FAILED" : "MISSION COMPLETE"}
          </div>
        </div>

        <h2
          data-testid="result-title"
          className="font-display font-black text-white text-5xl md:text-7xl leading-none tracking-tight mb-8"
        >
          {isCrash ? "HARD LANDING" : "THE EAGLE HAS LANDED"}
        </h2>

        {/* Big grade */}
        <div className="flex items-end gap-8 mb-8">
          <div className="flex flex-col">
            <span className="font-mono text-[10px] tracking-[0.4em] text-zinc-500 mb-1">
              MISSION RATING
            </span>
            <span
              data-testid="result-grade"
              className={`font-display font-black leading-none ${gradeColor}`}
              style={{ fontSize: "clamp(6rem, 14vw, 12rem)" }}
            >
              {result.grade}
            </span>
          </div>
          <div className="flex flex-col mb-4">
            <span className="font-mono text-[10px] tracking-[0.4em] text-zinc-500 mb-1">
              SCORE
            </span>
            <span className="font-mono tabular text-white text-4xl">
              {result.score}/100
            </span>
          </div>
        </div>

        {/* Metrics grid */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 border-t border-white/10 pt-6">
          <Metric label="LANDING ACCURACY" value={`${result.accuracy}%`} testId="result-accuracy" />
          <Metric label="TOUCHDOWN SPEED" value={`${result.touchdownSpeed.toFixed(2)} m/s`} testId="result-speed" />
          <Metric label="FUEL REMAINING" value={`${result.fuelRemaining}%`} testId="result-fuel" />
          <Metric label="TILT AT TOUCHDOWN" value={`${result.tilt.toFixed(0)}°`} testId="result-tilt" />
        </div>
        <div className="mt-4 font-mono text-[10px] tracking-widest text-zinc-500 flex items-center gap-3">
          <span>CREW SAFETY</span>
          <span className={isCrash ? "text-[#FF3B00]" : "text-white"} data-testid="result-crew">
            {result.crewSafety}
          </span>
        </div>

        <div className="mt-10 flex flex-wrap gap-3">
          <button
            onClick={onRestart}
            data-testid="result-restart"
            className="btn-hud btn-hud-primary"
          >
            <RotateCcw size={14} /> TRY AGAIN
          </button>
          <button
            onClick={onExit}
            data-testid="result-continue"
            className="btn-hud"
          >
            CONTINUE MISSION <ArrowUpRight size={14} />
          </button>
          <Link
            to="/manifesto"
            data-testid="result-manifesto"
            className="btn-hud"
          >
            MANIFESTO
          </Link>
        </div>
      </div>
    </div>
  );
}

function Metric({ label, value, testId }) {
  return (
    <div data-testid={testId}>
      <div className="font-mono text-[9px] tracking-[0.3em] text-zinc-500">{label}</div>
      <div className="font-mono tabular text-white text-xl md:text-2xl mt-1">{value}</div>
    </div>
  );
}
