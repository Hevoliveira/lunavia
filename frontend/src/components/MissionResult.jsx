import { RotateCcw, ArrowUpRight, XCircle, CheckCircle2, Home } from "lucide-react";
import { Link } from "react-router-dom";

/**
 * MissionResult — post-touchdown explanation.
 * All values are captured touchdown-frame quantities from the simulation.
 */
export default function MissionResult({ result, onRestart, onContinue, onEndMission, difficulty }) {
  const isCrash = !!result.crashed;
  const b = result.breakdown;

  const gradeColor = {
    S: "text-[#FFD700]",
    A: "text-[#FF3B00]",
    B: "text-white",
    C: "text-zinc-400",
    D: "text-zinc-600",
    F: "text-[#FF3B00]",
  }[result.grade] || "text-white";

  return (
    <div
      data-testid="mission-result"
      className="absolute inset-0 z-50 bg-black/85 backdrop-blur-md flex items-center justify-center px-4 md:px-6 py-6 overflow-y-auto"
    >
      <div className="hud-panel corners relative max-w-4xl w-full p-6 md:p-10 fade-in">
        <div className="flex items-center justify-between mb-4">
          <div className="font-mono text-[10px] tracking-[0.4em] text-zinc-500">
            LM-1 · {result.zone} · {difficulty}
          </div>
          <div
            className={`font-mono text-[10px] tracking-[0.4em] blink ${
              isCrash ? "text-[#FF3B00]" : "text-[#FF3B00]"
            }`}
          >
            ● {isCrash ? "MISSION FAILED · CREW LOST" : "MISSION COMPLETE · CREW SAFE"}
          </div>
        </div>

        <h2
          data-testid="result-title"
          className="font-display font-black text-white text-4xl md:text-6xl leading-none tracking-tight mb-4"
        >
          {isCrash ? "HARD LANDING" : "THE EAGLE HAS LANDED"}
        </h2>

        {/* Big grade + score */}
        <div className="flex items-end gap-6 md:gap-8 mb-6">
          <div className="flex flex-col">
            <span className="font-mono text-[10px] tracking-[0.4em] text-zinc-500 mb-1">
              MISSION RATING
            </span>
            <span
              data-testid="result-grade"
              className={`font-display font-black leading-none ${gradeColor}`}
              style={{ fontSize: "clamp(4.5rem, 11vw, 9rem)" }}
            >
              {result.grade}
            </span>
          </div>
          <div className="flex flex-col mb-3">
            <span className="font-mono text-[10px] tracking-[0.4em] text-zinc-500 mb-1">
              TOTAL SCORE
            </span>
            <span className="font-mono tabular text-white text-3xl md:text-4xl" data-testid="result-total-score">
              {result.score} <span className="text-zinc-500 text-xl">/100</span>
            </span>
          </div>
        </div>

        {/* Failure reasons */}
        {isCrash && result.failureReasons?.length > 0 && (
          <div
            data-testid="failure-reasons"
            className="border border-[#FF3B00] bg-[#FF3B00]/10 p-4 mb-6"
          >
            <div className="font-mono text-[10px] tracking-[0.35em] text-[#FF3B00] mb-2">
              FAILURE MODE
            </div>
            <ul className="font-mono text-[11px] tracking-widest text-white space-y-1">
              {result.failureReasons.map((r) => (
                <li key={r} data-testid={`fail-${r.replace(/[^A-Z]/g, "").toLowerCase()}`}>
                  ● {r}
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Breakdown grid */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3 md:gap-4 border-t border-white/10 pt-6">
          <BreakRow
            label="TOUCHDOWN VERTICAL SPEED"
            value={`${b.vy.value.toFixed(2)} m/s`}
            limit={`LIMIT ${b.vy.limit} m/s`}
            safe={b.vy.safe}
            score={b.vy.score}
            max={b.vy.max}
            testId="row-vy"
          />
          <BreakRow
            label="HORIZONTAL SPEED"
            value={`${b.vx.value.toFixed(2)} m/s`}
            limit={`LIMIT ${b.vx.limit} m/s`}
            safe={b.vx.safe}
            testId="row-vx"
          />
          <BreakRow
            label="DISTANCE FROM PRIMARY LZ"
            value={`${b.accuracy.distance.toFixed(1)} m`}
            limit={b.accuracy.label}
            safe={["EXCELLENT", "GOOD", "ACCEPTABLE"].includes(b.accuracy.label)}
            score={b.accuracy.score}
            max={b.accuracy.max}
            testId="row-accuracy"
          />
          <BreakRow
            label="ATTITUDE / TILT"
            value={`${b.tilt.value.toFixed(1)}°`}
            limit={`LIMIT ${b.tilt.limit}°`}
            safe={b.tilt.safe}
            score={b.tilt.score}
            max={b.tilt.max}
            testId="row-tilt"
          />
          <BreakRow
            label="FUEL REMAINING"
            value={`${b.fuel.pct}%`}
            limit={""}
            safe={b.fuel.pct > 0}
            score={b.fuel.score}
            max={b.fuel.max}
            testId="row-fuel"
          />
          <BreakRow
            label="CREW SAFETY"
            value={result.crewSafety}
            limit={""}
            safe={!isCrash}
            testId="row-crew"
          />
        </div>

        {/* Actions — CONTINUE is only offered when landing succeeded. */}
        <div className="mt-8 flex flex-wrap gap-3">
          <button
            onClick={onRestart}
            data-testid="result-restart"
            className="btn-hud btn-hud-primary"
          >
            <RotateCcw size={14} /> RETRY DESCENT
          </button>
          {isCrash ? (
            <button
              onClick={onEndMission}
              data-testid="result-end-mission"
              className="btn-hud"
            >
              <Home size={14} /> END MISSION · REVIEW FLIGHT
            </button>
          ) : (
            <button
              onClick={onContinue}
              data-testid="result-continue"
              className="btn-hud"
            >
              CONTINUE MISSION <ArrowUpRight size={14} />
            </button>
          )}
          <Link to="/manifesto" data-testid="result-manifesto" className="btn-hud">
            MANIFESTO
          </Link>
        </div>
      </div>
    </div>
  );
}

function BreakRow({ label, value, limit, safe, score, max, testId }) {
  return (
    <div
      data-testid={testId}
      className="flex items-center justify-between gap-4 border border-white/10 px-4 py-3 bg-black/30"
    >
      <div className="min-w-0">
        <div className="font-mono text-[9px] tracking-[0.3em] text-zinc-500 truncate">
          {label}
        </div>
        <div className="font-mono tabular text-white text-lg md:text-xl mt-1">
          {value}
        </div>
        {limit && (
          <div className="font-mono text-[9px] tracking-widest text-zinc-600 mt-1">
            {limit}
          </div>
        )}
      </div>
      <div className="flex flex-col items-end gap-1 shrink-0">
        <div className={`flex items-center gap-1 font-mono text-[10px] tracking-widest ${safe ? "text-white" : "text-[#FF3B00]"}`}>
          {safe ? <CheckCircle2 size={12} /> : <XCircle size={12} />}
          {safe ? "SAFE" : "UNSAFE"}
        </div>
        {typeof score === "number" && (
          <div className="font-mono tabular text-[10px] text-zinc-400">
            +{score}<span className="text-zinc-600">/{max}</span>
          </div>
        )}
      </div>
    </div>
  );
}
