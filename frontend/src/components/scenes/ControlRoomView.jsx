import { useEffect, useState } from "react";
import { NewMissionConfirm, SaveProblemNote, SavedMissionCard } from "@/components/missions/MissionSaveUI";
import useMediaQuery from "@/hooks/useMediaQuery";

/**
 * ControlRoomView — 2D immersive mission control screen.
 * Uses the Unsplash mission control image as a backdrop, with layered HUD
 * elements: countdown clock, telemetry, and a giant LAUNCH button.
 *
 * With an unfinished official mission saved on the device (lib/missionSave), its
 * summary and RESUME MISSION sit beside the launch (`saved`); nothing resumes,
 * launches or is discarded by itself. LAUNCH SEQUENCE — INITIATE then first asks
 * START A NEW MISSION? (the checkpoint would be replaced: onReplaceSave).
 *
 * Under it, smaller, PRE-LAUNCH EXPERIENCE (onPreLaunch): COUNTDOWN TO LAUNCH, optional, which
 * ends in the same launch; it asks START A NEW MISSION? first in the same way.
 */
export default function ControlRoomView({ onLaunch, onPreLaunch = null, saved = null, saveProblem = null, lang = "en", onResume, onReplaceSave }) {
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
  const [confirming, setConfirming] = useState(false);
  const [problemSeen, setProblemSeen] = useState(false);
  const pressLaunch = () => (saved ? setConfirming(true) : startCountdown());
  // PRE-LAUNCH EXPERIENCE asks the same question before an unfinished mission would be replaced
  const [preConfirm, setPreConfirm] = useState(false);
  const pressPreLaunch = () => (saved ? setPreConfirm(true) : onPreLaunch && onPreLaunch());
  // the shortest phones (375 px tall and less): beside a saved mission, PRE-LAUNCH EXPERIENCE goes
  // under that card (the column beside it has no room left)
  const tiny = useMediaQuery("(max-height: 380px)");
  // the right-hand panel: the saved mission, or why a saved mission cannot be restored
  const problemShown = !saved && !!saveProblem && !problemSeen;
  const panel = !launching && (!!saved || problemShown);

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

      {/* Center: giant countdown or CTA (beside a saved mission, centred in the space left of it) */}
      <div className={`absolute inset-0 flex flex-col items-center justify-center px-6 ${panel ? "control-beside-save" : ""}`}>
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
              onClick={pressLaunch}
              data-testid="control-launch-btn"
              className="mt-12 short:mt-5 group relative z-10 inline-flex items-center gap-4 px-8 py-4 border-2 border-[#FF3B00] text-white bg-[#FF3B00]/10 hover:bg-[#FF3B00] transition-colors duration-200 font-mono tracking-[0.35em] text-sm"
            >
              <span className="inline-block w-3 h-3 rounded-full bg-[#FF3B00] blink" />
              LAUNCH SEQUENCE — INITIATE
              <span className="inline-block w-3 h-3 rounded-full bg-[#FF3B00] blink" />
            </button>
            {onPreLaunch && !(tiny && panel) && (
              <button
                onClick={pressPreLaunch}
                data-testid="control-prelaunch-btn"
                className={
                  // 44 px to the touch (the invisible margin round it), 36 px to the eye on a phone; on the
                  // shortest phones (iPhone SE-class, 375 px and less) it sits to the right, under the
                  // RANGE · GO line, so the centred column keeps clear of the telemetry strip
                  "mt-3 short:mt-1 relative z-10 inline-flex items-center gap-2 px-4 py-2 short:py-1.5 min-h-[36px] touch:min-h-[44px] short:touch:min-h-[36px] after:content-[''] after:absolute after:inset-x-0 after:-inset-y-1 border border-white/25 text-zinc-300 hover:text-white hover:border-white/60 bg-black/30 short:bg-black/80 transition-colors duration-200 font-mono tracking-[0.3em] text-[10px] " +
                  "[@media(max-height:380px)]:absolute [@media(max-height:380px)]:mt-0 [@media(max-height:380px)]:top-[6.6rem] [@media(max-height:380px)]:right-[calc(var(--sar)+2rem)] [@media(max-height:380px)]:max-w-[8.5rem] [@media(max-height:380px)]:text-left [@media(max-height:380px)]:leading-relaxed [@media(max-height:380px)]:tracking-[0.22em]"
                }
              >
                {lang === "pt" ? "EXPERIÊNCIA PRÉ-LANÇAMENTO" : "PRE-LAUNCH EXPERIENCE"} ›
              </button>
            )}
            {/* on a short (phone landscape) screen the hint gives its place to PRE-LAUNCH EXPERIENCE */}
            <div className={`mt-6 short:mt-3 font-mono text-[10px] tracking-[0.3em] text-zinc-500 ${panel || onPreLaunch ? "short:hidden" : ""} ${onPreLaunch && !panel ? "lv-hint-keep-space" : ""}`}>
              PRESS TO BEGIN · TERMINAL COUNT, LAUNCH AND EARTH DEPARTURE ARE AUTOMATIC
            </div>
          </>
        )}

        {/* a narrow portrait screen: the saved mission under the launch */}
        {!launching && saved && (
          <div className="sm:hidden mt-5 w-full max-w-[300px]">
            <SavedMissionCard save={saved} lang={lang} onResume={onResume} testId="saved-mission-stacked" />
          </div>
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

      {/* The saved mission, beside the launch (landscape phones, tablets, desktop) */}
      {!launching && saved && (
        <div className="hidden sm:flex absolute inset-y-0 right-8 short:right-4 narrow:right-3 safe-mr items-center pointer-events-none z-20">
          <div className="relative">
            <SavedMissionCard save={saved} lang={lang} onResume={onResume} className="w-[260px] short:w-[196px] narrow:w-[176px]" />
            {onPreLaunch && tiny && (
            <button
              onClick={pressPreLaunch}
              data-testid="control-prelaunch-btn"
              className="pointer-events-auto absolute top-full right-0 mt-1 w-full min-h-[26px] px-2 py-1 after:content-[''] after:absolute after:inset-x-0 after:-inset-y-2 border border-white/25 text-zinc-300 hover:text-white bg-black/80 font-mono text-[9px] tracking-[0.08em] text-center"
            >
              {lang === "pt" ? "EXPERIÊNCIA PRÉ-LANÇAMENTO" : "PRE-LAUNCH EXPERIENCE"} ›
            </button>
          )}
          </div>
        </div>
      )}
      {!launching && problemShown && (
        <div className="absolute inset-y-0 right-8 short:right-4 narrow:right-3 safe-mr flex items-center pointer-events-none z-20">
          <div className="relative">
            <SaveProblemNote status={saveProblem} lang={lang} onDismiss={() => setProblemSeen(true)} className="w-[260px] short:w-[196px] narrow:w-[176px]" />
            {onPreLaunch && tiny && (
            <button
              onClick={pressPreLaunch}
              data-testid="control-prelaunch-btn"
              className="pointer-events-auto absolute top-full right-0 mt-1 w-full min-h-[26px] px-2 py-1 after:content-[''] after:absolute after:inset-x-0 after:-inset-y-2 border border-white/25 text-zinc-300 hover:text-white bg-black/80 font-mono text-[9px] tracking-[0.08em] text-center"
            >
              {lang === "pt" ? "EXPERIÊNCIA PRÉ-LANÇAMENTO" : "PRE-LAUNCH EXPERIENCE"} ›
            </button>
          )}
          </div>
        </div>
      )}
      <NewMissionConfirm
        open={confirming}
        lang={lang}
        onCancel={() => setConfirming(false)}
        onConfirm={() => {
          setConfirming(false);
          if (onReplaceSave) onReplaceSave();
          startCountdown();
        }}
      />
      <NewMissionConfirm
        open={preConfirm}
        lang={lang}
        onCancel={() => setPreConfirm(false)}
        onConfirm={() => {
          setPreConfirm(false);
          if (onReplaceSave) onReplaceSave();
          if (onPreLaunch) onPreLaunch();
        }}
      />

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
