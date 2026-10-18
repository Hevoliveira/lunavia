import { useState } from "react";
import { Link } from "react-router-dom";
import { ArrowLeft, Award, Play } from "lucide-react";
import DifficultySelect from "@/components/DifficultySelect";
import SitePreview, { SiteProfile } from "@/components/training/SitePreview";
import MedalEmblem from "@/components/scoring/MedalEmblem";
import { useAudioSettings } from "@/audio/audioSettings";
import { SITE_DEFS, getSite } from "@/data/landingSites";
import { OFFICIAL_MISSIONS } from "@/data/missionConfig";
import { betterMedal } from "@/data/missionScoring";
import { lastFlight } from "@/lib/missionSelection";
import { category, loadRecords } from "@/lib/missionRecords";

// A destination's best medal and score over the three pilot difficulties (the flight records).
function bestAt(records, siteId) {
  let medal = null;
  let score = null;
  ["CADET", "ASTRONAUT", "COMMANDER"].forEach((d) => {
    const c = category(records, siteId, d);
    medal = betterMedal(medal, c.bestMedal);
    if (c.bestTotal && (score === null || c.bestTotal.score > score)) score = c.bestTotal.score;
  });
  return { medal, score };
}

/*
 * MISSIONS: the four official lunar missions. Choose a destination (its
 * environmental challenge: the terrain, hazards, landing zones and
 * communications), then a pilot difficulty (CADET / ASTRONAUT / COMMANDER:
 * the same spacecraft and limits at every destination). Every mission is
 * open; nothing is unlocked. The choice holds for the whole expedition, from
 * launch to the descent and home.
 */

const ENV_TONE = {
  INTRODUCTORY: "border-emerald-400/60 text-emerald-300",
  INTERMEDIATE: "border-sky-400/60 text-sky-300",
  ADVANCED: "border-amber-400/60 text-amber-300",
  EXPERT: "border-[#FF3B00]/70 text-[#FF7A4D]",
};
const ENV_LEVEL = { INTRODUCTORY: 1, INTERMEDIATE: 2, ADVANCED: 3, EXPERT: 4 };

function lastText(f) {
  if (!f) return null;
  if (f.completed) return `LAST · ${f.difficulty} · MISSION COMPLETE`;
  if (f.landing) return `LAST · ${f.difficulty} · ${f.landing.success ? `LANDED${f.landing.grade ? ` · ${f.landing.grade}` : ""}` : "LANDING FAILED"}`;
  return `LAST · ${f.difficulty} · NOT LANDED`;
}

/** One official mission: number, name, description, terrain preview, environment level, piloting challenge, START MISSION. */
function MissionCard({ mission, site, active, last, best, onSelect, onStart }) {
  const [img, setImg] = useState(true);
  const level = ENV_LEVEL[mission.environment];
  return (
    <div
      role="option"
      aria-selected={active}
      tabIndex={0}
      onClick={onSelect}
      onKeyDown={(e) => (e.key === "Enter" || e.key === " ") && onSelect()}
      data-testid={`mission-card-${site.id}`}
      className={`group flex flex-col min-w-0 cursor-pointer border bg-black/55 transition-colors ${active ? "border-[#FF3B00] bg-[#FF3B00]/[0.07]" : "border-white/10 hover:border-white/30"}`}
    >
      <div className="relative w-full aspect-[2.1/1] short:aspect-[2.6/1] bg-[#0b0b0d] overflow-hidden">
        {img && (
          <img
            src={`${process.env.PUBLIC_URL}/missions/${site.id}.jpg`}
            alt={`${site.name}: the landing area`}
            onError={() => setImg(false)}
            className="absolute inset-0 w-full h-full object-cover"
            draggable={false}
            data-testid="mission-preview"
          />
        )}
        <span className="absolute top-1.5 left-1.5 bg-black/70 px-1.5 font-mono text-[9px] short:text-[8px] tracking-[0.2em] text-white" data-testid="mission-number">
          MISSION {mission.number}
        </span>
        {site.earthLink === false && (
          <span className="absolute top-1.5 right-1.5 border border-[#9fb6cc]/50 bg-black/60 px-1 font-mono text-[7px] tracking-wider text-[#9fb6cc]" data-testid="mission-no-link">NO EARTH LINK</span>
        )}
        {best && best.score !== null && (
          <span className="absolute bottom-1 left-1 flex items-center gap-1 bg-black/70 pr-1.5 font-mono tabular text-[9px] text-white" data-testid="mission-best" data-medal={best.medal || "none"}>
            <MedalEmblem medal={best.medal} size={22} />
            {best.score}
          </span>
        )}
      </div>
      <div className="p-2.5 short:p-2 flex flex-col flex-1 min-w-0">
        <div className="font-display font-black text-white text-[16px] short:text-[13px] leading-tight" data-testid="mission-title">{site.name}</div>
        <div className="font-mono text-[7.5px] tracking-[0.18em] text-zinc-500 mt-0.5 truncate">{site.ref}</div>
        <p className="text-[11px] short:text-[9.5px] text-zinc-300 leading-snug mt-1 line-clamp-3 short:line-clamp-2" data-testid="mission-summary">{mission.summary}</p>
        <div className="mt-1.5 short:mt-1 min-w-0" data-testid="mission-environment" aria-label={`Environmental difficulty ${mission.environment}, ${level} of 4`}>
          <div className="font-mono text-[7.5px] tracking-[0.2em] text-zinc-500">ENVIRONMENT</div>
          <div className="flex items-center gap-1.5 min-w-0 mt-0.5">
            <span className={`border px-1 font-mono text-[7.5px] tracking-wider truncate ${ENV_TONE[mission.environment]}`}>{mission.environment}</span>
            <span className="flex gap-0.5 ml-auto shrink-0">
              {[1, 2, 3, 4].map((k) => (
                <i key={k} className={`inline-block w-2.5 h-1.5 ${k <= level ? (level >= 4 ? "bg-[#FF3B00]" : "bg-white/80") : "bg-white/15"}`} />
              ))}
            </span>
          </div>
        </div>
        <div className="mt-1.5 short:mt-1">
          <div className="font-mono text-[7.5px] tracking-[0.2em] text-zinc-500">PILOTING CHALLENGE</div>
          <div className="text-[10.5px] short:text-[9px] text-white leading-snug line-clamp-2" data-testid="mission-challenge">{mission.challenge}</div>
        </div>
        {last && <div className="font-mono text-[7.5px] tracking-[0.15em] text-zinc-500 mt-1 truncate" data-testid="mission-last">{last}</div>}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onStart();
          }}
          className={`btn-hud justify-center whitespace-nowrap min-h-[44px] short:min-h-[40px] short:!px-2 short:!tracking-[0.14em] mt-auto ${active ? "btn-hud-primary" : ""}`}
          data-testid={`mission-start-${site.id}`}
          style={{ marginTop: "0.6rem" }}
        >
          <Play size={12} /> START MISSION
        </button>
      </div>
    </div>
  );
}

/**
 * selection: the current { siteId, difficulty }; log: the official missions' log;
 * onConfirm({ siteId, difficulty }): both chosen; onBack: leave without changing.
 */
export default function MissionSelect({ selection, log = [], onConfirm, onBack }) {
  const [siteId, setSiteId] = useState(selection.siteId);
  const [step, setStep] = useState("destination"); // destination | pilot
  const mission = OFFICIAL_MISSIONS.find((m) => m.siteId === siteId);
  const site = SITE_DEFS.find((s) => s.id === siteId);
  const [records] = useState(() => loadRecords());
  const pt = useAudioSettings().subLang === "pt";

  if (step === "pilot") {
    return (
      <div className="absolute inset-0 bg-black" data-testid="mission-pilot-step">
        <DifficultySelect
          kicker={`MISSION ${mission.number} · ${site.name} · ${mission.environment} ENVIRONMENT`}
          title="PILOT DIFFICULTY"
          text="Your piloting level: entry state, fuel and touchdown limits. The same spacecraft at every destination; the destination sets the terrain."
          selected={selection.siteId === siteId ? selection.difficulty : null}
          onSelect={(difficulty) => onConfirm({ siteId, difficulty })}
          onBack={() => setStep("destination")}
          backLabel="MISSIONS"
        />
      </div>
    );
  }

  return (
    <div className="absolute inset-0 overflow-y-auto bg-[#050505] safe-px" data-testid="mission-select">
      <div aria-hidden className="absolute inset-0 grid-bg opacity-30 pointer-events-none" />
      <div className="relative max-w-[1180px] mx-auto px-6 md:px-10 pt-24 pb-8 short:pt-12 short:pb-3 short:px-3">
        <div className="flex items-end justify-between gap-3 flex-wrap">
          <div className="min-w-0">
            <div className="font-mono text-[10px] short:text-[8px] tracking-[0.4em] text-[#FF3B00]">● LUNAVIA · OFFICIAL LUNAR MISSIONS</div>
            <h1 className="font-display font-black text-white text-4xl md:text-5xl short:text-xl tracking-tight mt-1 short:mt-0" data-testid="mission-select-title">MISSIONS</h1>
          </div>
          <div className="font-mono text-[9px] short:text-[8px] tracking-[0.2em] text-zinc-500 text-right max-w-[26rem] short:max-w-[19rem] short:tracking-[0.12em]">
            CHOOSE A DESTINATION · THEN YOUR PILOT DIFFICULTY · THE FULL EXPEDITION FROM EARTH LAUNCH TO SPLASHDOWN
          </div>
        </div>
        <div className="grid grid-cols-2 lg:grid-cols-4 short:grid-cols-4 gap-3 short:gap-2 mt-5 short:mt-2" role="listbox" aria-label="Official lunar mission" data-testid="mission-cards">
          {OFFICIAL_MISSIONS.map((m) => {
            const s = SITE_DEFS.find((x) => x.id === m.siteId);
            return (
              <MissionCard
                key={m.siteId}
                mission={m}
                site={s}
                active={m.siteId === siteId}
                last={lastText(lastFlight(log, m.siteId))}
                best={bestAt(records, m.siteId)}
                onSelect={() => setSiteId(m.siteId)}
                onStart={() => {
                  setSiteId(m.siteId);
                  setStep("pilot");
                }}
              />
            );
          })}
        </div>
        {/* Larger screens: the selected destination, live, as the descent draws it */}
        <div className="hidden md:grid short:hidden grid-cols-[1.4fr_1fr] mt-4 hud-panel corners relative bg-black/60 border border-white/10 overflow-hidden" data-testid="mission-site-briefing">
          <SitePreview siteId={siteId} className="h-[240px] w-full" />
          <div className="p-4 flex flex-col min-w-0">
            <div className="font-mono text-[8px] tracking-[0.25em] text-zinc-500 truncate">{site.coords} · {site.ref}</div>
            <div className="font-display font-black text-white text-xl leading-tight mt-0.5">MISSION {mission.number} · {site.name}</div>
            <p className="text-[12px] text-zinc-300 leading-snug mt-1">{site.blurb}</p>
            <SiteProfile siteId={siteId} className="w-full mt-2" />
            <div className="grid grid-cols-2 gap-x-3 gap-y-1 mt-2 font-mono text-[10px] text-white">
              <div><div className="text-[8px] tracking-[0.25em] text-zinc-500">APPROACH</div>{site.approach.text}</div>
              <div><div className="text-[8px] tracking-[0.25em] text-zinc-500">PRIMARY LZ</div>{getSite(siteId).primary.r} m radius</div>
              <div><div className="text-[8px] tracking-[0.25em] text-zinc-500">TERRAIN</div>{site.terrainText}</div>
              <div><div className="text-[8px] tracking-[0.25em] text-zinc-500">EARTH LINK</div>{site.earthLink === false ? "UNAVAILABLE (FAR SIDE)" : "DIRECT"}</div>
            </div>
          </div>
        </div>
        <div className="mt-4 short:mt-2 flex flex-wrap items-center gap-3">
          {onBack ? (
            <button type="button" onClick={onBack} className="btn-hud min-h-[44px]" data-testid="mission-select-back">
              <ArrowLeft size={14} /> MAIN MENU
            </button>
          ) : (
            <Link to="/menu" className="btn-hud min-h-[44px]" data-testid="mission-select-menu">
              <ArrowLeft size={14} /> MAIN MENU
            </Link>
          )}
          <Link to="/records" className="btn-hud min-h-[44px]" data-testid="mission-select-records">
            <Award size={14} /> {pt ? "REGISTROS DE VOO" : "FLIGHT RECORDS"}
          </Link>
          <span className="font-mono text-[8px] tracking-[0.2em] text-zinc-600">
            ENVIRONMENT = THE DESTINATION&apos;S TERRAIN · PILOT DIFFICULTY = YOUR SPACECRAFT&apos;S MARGINS
          </span>
        </div>
      </div>
    </div>
  );
}
