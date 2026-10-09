import { useEffect, useState } from "react";

/**
 * ControlRoomView — 2D immersive mission control screen.
 * Uses the Unsplash mission control image as a backdrop, with layered HUD
 * elements: countdown clock, telemetry, and a giant LAUNCH button.
 */
export default function ControlRoomView({ onLaunch }) {
  // Starting the mission is the only input before the Moon: the terminal
  // count, ignition, ascent, staging, orbit and TLI then run automatically
  // in the launch cinematic.
  const [launching, setLaunching] = useState(false);

  useEffect(() => {
    if (!launching) return undefined;
    const t = setTimeout(() => onLaunch(), 1100);
    return () => clearTimeout(t);
  }, [launching, onLaunch]);

  const startCountdown = () => setLaunching(true);

  return (
    <div
      data-testid="control-room"
      className="absolute inset-0 overflow-hidden bg-black"
    >
      {/* Mission control backdrop */}
      <div
        className="absolute inset-0 bg-cover bg-center opacity-40"
        style={{
          backgroundImage:
            "url(https://images.unsplash.com/photo-1652145595413-0a79398e5888?crop=entropy&cs=srgb&fm=jpg&ixid=M3w4NjA1ODh8MHwxfHNlYXJjaHwyfHxzcGFjZWNyYWZ0JTIwbWlzc2lvbiUyMGNvbnRyb2wlMjBwYW5lbHxlbnwwfHx8fDE3ODc2MDQzNzV8MA&ixlib=rb-4.1.0&q=85)",
        }}
      />
      <div className="absolute inset-0 bg-gradient-to-b from-black/70 via-black/40 to-black" />

      {/* Grid overlay */}
      <div className="absolute inset-0 grid-bg opacity-40" />

      {/* Corner brackets */}
      <div className="absolute inset-6 safe-ml safe-mr safe-mb border border-white/10 pointer-events-none" />

      {/* Top strip */}
      <div className="absolute top-20 short:top-14 left-8 right-8 safe-ml safe-mr flex justify-between font-mono text-[10px] tracking-[0.35em] text-zinc-400 pointer-events-none">
        <div>
          <div className="text-white">MISSION CONTROL · LC-39A</div>
          <div className="text-zinc-600 mt-1">
            LAT 28.573°N · LON −80.649°W · WX GO
          </div>
        </div>
        <div className="text-right">
          <div className="text-[#FF3B00] blink">● SYSTEMS · ARMED</div>
          <div className="text-zinc-600 mt-1">RANGE · GO · WEATHER · GO</div>
        </div>
      </div>

      {/* Center: giant countdown or CTA */}
      <div className="absolute inset-0 flex flex-col items-center justify-center px-6">
        {!launching && (
          <>
            <div className="font-mono text-[11px] tracking-[0.4em] text-zinc-400 mb-4 short:mb-2 short:mt-10 scan-in">
              LV-001 · READY FOR LAUNCH
            </div>
            <h1
              className="font-display font-black text-6xl md:text-8xl short:text-5xl tracking-tight text-white text-center"
              data-testid="control-room-title"
            >
              THE ROAD<br />
              <span className="text-[#FF3B00]">TO THE MOON</span>
            </h1>
            <button
              onClick={startCountdown}
              data-testid="control-launch-btn"
              className="mt-12 short:mt-5 group relative z-10 inline-flex items-center gap-4 px-8 py-4 border-2 border-[#FF3B00] text-white bg-[#FF3B00]/10 hover:bg-[#FF3B00] transition-colors duration-200 font-mono tracking-[0.35em] text-sm"
            >
              <span className="inline-block w-3 h-3 rounded-full bg-[#FF3B00] blink" />
              LAUNCH SEQUENCE — INITIATE
              <span className="inline-block w-3 h-3 rounded-full bg-[#FF3B00] blink" />
            </button>
            <div className="mt-6 short:mt-3 font-mono text-[10px] tracking-[0.3em] text-zinc-500">
              PRESS TO BEGIN · TERMINAL COUNT, LAUNCH AND EARTH DEPARTURE ARE AUTOMATIC
            </div>
          </>
        )}

        {launching && (
          <div className="text-center scan-in" data-testid="control-go">
            <div className="font-mono text-[11px] tracking-[0.4em] text-[#FF3B00] blink mb-4">
              ● ALL STATIONS GO · TERMINAL COUNT
            </div>
            <div className="font-display font-black text-white text-8xl md:text-9xl short:text-7xl">
              GO
            </div>
          </div>
        )}
      </div>

      {/* Bottom telemetry strip */}
      <div className="absolute bottom-8 short:bottom-3 left-8 right-8 safe-ml safe-mr safe-mb grid grid-cols-4 gap-6 font-mono text-[10px] tracking-widest text-zinc-500 border-t border-white/10 pt-4 short:pt-2 pointer-events-none">
        <div>
          <div className="text-zinc-700">VEHICLE</div>
          <div className="text-white tabular mt-1">LV-001 ARTEMIS-CLASS</div>
        </div>
        <div>
          <div className="text-zinc-700">TOTAL Δv</div>
          <div className="text-white tabular mt-1">15,100 m/s</div>
        </div>
        <div>
          <div className="text-zinc-700">DISTANCE</div>
          <div className="text-white tabular mt-1">384,400 km</div>
        </div>
        <div>
          <div className="text-zinc-700">DURATION</div>
          <div className="text-white tabular mt-1">195 h</div>
        </div>
      </div>
    </div>
  );
}
