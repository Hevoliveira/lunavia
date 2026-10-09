import React from "react";
import { ArrowUp, ArrowLeft, ArrowRight } from "lucide-react";
import { DIFFICULTY } from "@/data/landingPhysics";

/**
 * PHASE 2 - PDI readiness card.
 *
 * Deliberately not a tutorial: one screen, read in a few seconds, shown once
 * before the simulation is live. Every number on it is read straight from the
 * DIFFICULTY entry the integrator and gradeLanding use, so the briefing cannot
 * drift away from the rules it is describing.
 */

function KeyCap({ children, wide = false }) {
  return (
    <span
      className={`inline-flex items-center justify-center border border-white/25 text-white font-mono text-[10px] tracking-widest ${
        wide ? "px-3 h-7" : "w-7 h-7"
      }`}
    >
      {children}
    </span>
  );
}

function Limit({ label, value, unit }) {
  return (
    <div className="flex items-baseline justify-between border-b border-white/10 py-2">
      <span className="font-mono text-[9px] tracking-widest text-zinc-500">{label}</span>
      <span className="font-mono text-sm text-white tabular">
        ≤ {value} <span className="text-zinc-500 text-[10px]">{unit}</span>
      </span>
    </div>
  );
}

export default function PdiBriefing({ difficulty = "CADET", onBegin, onBack }) {
  const cfg = DIFFICULTY[difficulty] || DIFFICULTY.CADET;

  return (
    <div
      data-testid="pdi-briefing"
      className="absolute inset-0 z-40 bg-black/80 backdrop-blur-md flex items-center justify-center pl-[max(1.5rem,var(--sal))] pr-[max(1.5rem,var(--sar))] short:items-start short:overflow-y-auto short:pt-14 short:pb-4"
    >
      <div className="max-w-4xl w-full short:my-auto">
        <div className="text-center mb-6 short:mb-3">
          <div className="font-mono text-[10px] tracking-[0.4em] text-[#FF3B00] blink mb-3">
            ● POWERED DESCENT INITIATION
          </div>
          <h2 className="font-display font-black text-white text-4xl md:text-6xl short:text-4xl leading-none">
            {cfg.label} · PDI READY
          </h2>
          <p className="text-zinc-400 mt-4 short:mt-2 max-w-xl mx-auto text-sm leading-relaxed">
            <span className="font-mono text-[10px] tracking-widest text-zinc-500 block mb-1">
              MISSION OBJECTIVE
            </span>
            Land the Lunar Module safely inside or near the designated landing area.
          </p>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Controls, laid out to mirror the in-flight control cluster */}
          <div className="hud-panel corners p-6 short:p-4" data-testid="pdi-controls">
            <div className="font-mono text-[10px] tracking-[0.4em] text-[#FF3B00] mb-4">CONTROLS</div>

            <div className="flex items-center gap-4 mb-4">
              <div className="grid grid-cols-3 gap-1 place-items-center shrink-0">
                <div />
                <span className="w-9 h-9 border border-white/25 flex items-center justify-center text-white">
                  <ArrowUp size={16} />
                </span>
                <div />
                <span className="w-9 h-9 border border-white/25 flex items-center justify-center text-white">
                  <ArrowLeft size={16} />
                </span>
                <span className="w-9 h-9 border border-white/15 flex items-center justify-center font-mono text-[8px] text-zinc-500">
                  RCS
                </span>
                <span className="w-9 h-9 border border-white/25 flex items-center justify-center text-white">
                  <ArrowRight size={16} />
                </span>
              </div>
              <p className="font-mono text-[9px] tracking-widest text-zinc-500 leading-relaxed touch:hidden">
                THE ON-SCREEN CLUSTER
                <br />
                MIRRORS THESE KEYS
              </p>
              <p className="hidden touch:block font-mono text-[9px] tracking-widest text-zinc-500 leading-relaxed">
                HOLD THE ON-SCREEN
                <br />
                CONTROLS · BOTTOM RIGHT
              </p>
            </div>

            <div className="hidden touch:block space-y-2 font-mono text-[10px] tracking-widest text-white" data-testid="pdi-touch-controls">
              <div>↑ · HOLD · MAIN ENGINE THROTTLE</div>
              <div>← → · TAP TO TRIM · HOLD · ATTITUDE / TILT</div>
              <div>◄ RCS · RCS ► · TAP TO TRIM · HOLD · LATERAL TRANSLATION</div>
              <div>EXTERNAL · COCKPIT · NAV · CAMERA</div>
              <div>PAUSE · TOP RIGHT</div>
            </div>
            <div className="space-y-2 touch:hidden">
              <div className="flex items-center gap-3">
                <KeyCap wide>SPACE</KeyCap>
                <span className="font-mono text-[10px] tracking-widest text-white">MAIN ENGINE THROTTLE</span>
              </div>
              <div className="flex items-center gap-3">
                <KeyCap>A</KeyCap>
                <KeyCap>D</KeyCap>
                <span className="font-mono text-[10px] tracking-widest text-white">ATTITUDE / TILT</span>
              </div>
              <div className="flex items-center gap-3">
                <KeyCap>Q</KeyCap>
                <KeyCap>E</KeyCap>
                <span className="font-mono text-[10px] tracking-widest text-white">LATERAL TRANSLATION</span>
              </div>
              <div className="flex items-center gap-3">
                <KeyCap>C</KeyCap>
                <span className="font-mono text-[10px] tracking-widest text-white">CYCLE CAMERA</span>
              </div>
              <div className="flex items-center gap-3">
                <KeyCap>P</KeyCap>
                <span className="font-mono text-[10px] tracking-widest text-white">PAUSE</span>
              </div>
            </div>
          </div>

          {/* Safety envelope, read from the same cfg the simulation uses */}
          <div className="hud-panel corners p-6 short:p-4" data-testid="pdi-envelope">
            <div className="font-mono text-[10px] tracking-[0.4em] text-[#FF3B00] mb-4">SAFE TOUCHDOWN</div>
            <Limit label="VERTICAL SPEED" value={cfg.safeVy} unit="m/s" />
            <Limit label="HORIZONTAL SPEED" value={cfg.safeVx} unit="m/s" />
            <Limit label="TILT" value={cfg.safeTilt} unit="deg" />

            <div className="font-mono text-[10px] tracking-[0.4em] text-zinc-500 mt-6 short:mt-3 mb-3">ENTRY STATE</div>
            <div className="grid grid-cols-2 gap-2 font-mono text-[9px] tracking-widest text-zinc-500">
              <div>
                ALTITUDE
                <br />
                <span className="text-white tabular">{cfg.initialAlt} m</span>
              </div>
              <div>
                FUEL
                <br />
                <span className="text-white tabular">{cfg.initialFuel} kg</span>
              </div>
              <div>
                VERTICAL SPEED
                <br />
                <span className="text-white tabular">{Math.abs(cfg.initialVy).toFixed(1)} m/s</span>
              </div>
              <div>
                HORIZONTAL SPEED
                <br />
                <span className="text-white tabular">{Math.abs(cfg.initialVx).toFixed(1)} m/s</span>
              </div>
            </div>
            <p className="text-zinc-500 text-[11px] leading-relaxed mt-4">
              The engine is cold and the vehicle is already descending. Nothing flies itself.
            </p>
          </div>
        </div>

        <div className="mt-6 short:mt-3 flex flex-col items-center gap-3 short:gap-1">
          <button
            onClick={onBegin}
            data-testid="begin-pdi"
            className="hud-panel corners px-10 py-4 font-mono text-sm tracking-[0.3em] text-white border border-[#FF3B00] hover:bg-[#FF3B00]/20 transition-colors duration-200"
          >
            ● BEGIN PDI ●
          </button>
          <button
            onClick={onBack}
            data-testid="pdi-back"
            className="font-mono text-[10px] tracking-[0.3em] text-zinc-500 hover:text-white transition-colors py-3 px-2"
          >
            CHANGE DIFFICULTY
          </button>
        </div>
      </div>
    </div>
  );
}
