import { formatMET } from "@/data/missionPhases";

function Field({ label, value, unit, testId }) {
  return (
    <div className="flex flex-col gap-1" data-testid={testId}>
      <span className="font-mono text-[9px] tracking-[0.22em] text-zinc-500 uppercase">
        {label}
      </span>
      <div className="flex items-baseline gap-1.5">
        <span className="font-mono tabular text-white text-lg md:text-xl font-medium">
          {value}
        </span>
        {unit && (
          <span className="font-mono text-[10px] text-zinc-500 tracking-wider">
            {unit}
          </span>
        )}
      </div>
    </div>
  );
}

export default function MissionHUD({ missionTime, phase, spacecraft }) {
  const met = formatMET(missionTime);
  const altStr = spacecraft.altitude.toLocaleString("en-US", {
    maximumFractionDigits: 0,
  });
  const velStr = spacecraft.velocity.toFixed(2);
  const moonDistStr = spacecraft.moonDistance.toLocaleString("en-US", {
    maximumFractionDigits: 0,
  });

  return (
    <>
      {/* Top-left: mission ident */}
      <div
        className="absolute top-20 left-4 md:left-8 hud-panel px-4 py-3 corners"
        data-testid="hud-mission-ident"
      >
        <div className="font-mono text-[9px] tracking-[0.3em] text-zinc-500">
          FLIGHT PLAN
        </div>
        <div className="font-display text-lg font-bold text-white mt-1">
          LV-001 ARTEMIS-CLASS
        </div>
        <div className="font-mono text-[10px] text-[#FF3B00] mt-1 tracking-widest">
          ● NOMINAL
        </div>
      </div>

      {/* Top-right: MET & phase */}
      <div
        className="absolute top-20 right-4 md:right-8 hud-panel px-5 py-3 min-w-[240px] corners"
        data-testid="hud-met"
      >
        <div className="font-mono text-[9px] tracking-[0.3em] text-zinc-500">
          MISSION ELAPSED TIME
        </div>
        <div className="font-mono tabular text-white text-2xl font-medium mt-1">
          {met}
        </div>
        <div className="font-mono text-[10px] text-zinc-400 mt-2 tracking-wider uppercase">
          Phase · <span className="text-white">{phase?.code}</span>
        </div>
      </div>

      {/* Bottom: telemetry strip */}
      <div
        className="absolute bottom-4 left-4 right-4 md:left-8 md:right-8 hud-panel px-6 py-4 corners"
        data-testid="hud-telemetry"
      >
        <div className="grid grid-cols-2 md:grid-cols-5 gap-6">
          <Field
            label="ALTITUDE"
            value={altStr}
            unit="km"
            testId="hud-altitude"
          />
          <Field
            label="VELOCITY"
            value={velStr}
            unit="km/s"
            testId="hud-velocity"
          />
          <Field
            label="MOON RANGE"
            value={moonDistStr}
            unit="km"
            testId="hud-moon-range"
          />
          <Field
            label="Δ-V USED"
            value={(phase?.delta_v_ms ?? 0).toLocaleString()}
            unit="m/s"
            testId="hud-delta-v"
          />
          <Field
            label="LOCATION"
            value={phase?.location ?? "—"}
            testId="hud-location"
          />
        </div>
      </div>
    </>
  );
}
