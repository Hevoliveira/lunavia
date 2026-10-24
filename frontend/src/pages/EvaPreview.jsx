import { useMemo } from "react";
import LunarEva from "@/components/eva/LunarEva";
import LunarAscent from "@/components/LunarAscent";
import useMissionAudio from "@/hooks/useMissionAudio";
import { getSite, SITE_IDS } from "@/data/landingSites";

/**
 * Development only (App.js mounts it at /dev/eva when NODE_ENV is development): one lunar EVA on
 * its own. ?site=tranquillitatis|hadley|tycho|far-side (default the Sea of Tranquility), ?x=<m>
 * lands the LM that far along the track (default the primary zone), ?at=ladder starts at the foot
 * of the ladder (the first steps done), ?done=a,b marks those objectives done (Tranquility:
 * ?sample=1 and ?photo=1 as before), ?lang=pt for Portuguese, ?ascent=1 the liftoff screen.
 */
export default function EvaPreview() {
  const q = useMemo(() => new URLSearchParams(window.location.search), []);
  const audio = useMissionAudio();
  const siteId = SITE_IDS.includes(q.get("site")) ? q.get("site") : "tranquillitatis";
  const pose = useMemo(() => {
    if (q.get("x") == null) return null;
    const xm = Number(q.get("x")) || 0;
    const site = getSite(siteId);
    return { x: xm * 0.5, padY: site.contactGround ? site.scale.y(site.contactGround(xm)) : 0, tilt: 0, pitch: 0, comp: [0, 0, 0, 0], probe: [0, 0, 0, 0] };
  }, [q, siteId]);
  const resume = useMemo(() => {
    if (q.get("at") !== "ladder") return null;
    const progress = { firstSteps: true, sample: q.get("sample") === "1", photo: q.get("photo") === "1" };
    (q.get("done") || "")
      .split(",")
      .filter(Boolean)
      .forEach((k) => (progress[k] = true));
    return { progress };
  }, [q]);
  if (q.get("ascent") === "1") {
    return (
      <main className="fixed inset-0 bg-black" data-testid="eva-preview">
        <LunarAscent siteId={siteId} />
      </main>
    );
  }
  return (
    <main className="fixed inset-0 bg-black" data-testid="eva-preview">
      <LunarEva
        siteId={siteId}
        pose={pose}
        audio={audio}
        lang={q.get("lang") === "pt" ? "pt" : "en"}
        resume={resume}
        onCheckpoint={(e) => (window.__lvEvaCheckpoints = [...(window.__lvEvaCheckpoints || []), e])}
        onComplete={(e) => (window.__lvEvaComplete = e)}
        onAbort={() => (window.__lvEvaAborted = true)}
      />
    </main>
  );
}
