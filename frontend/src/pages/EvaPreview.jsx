import { useMemo } from "react";
import LunarEva from "@/components/eva/LunarEva";
import LunarAscent from "@/components/LunarAscent";
import useMissionAudio from "@/hooks/useMissionAudio";

/**
 * Development only (App.js mounts it at /dev/eva when NODE_ENV is development): the lunar EVA
 * at the Sea of Tranquility on its own. ?at=ladder starts at the foot of the ladder (the first
 * steps done), ?sample=1 and ?photo=1 mark those done, ?lang=pt for Portuguese.
 */
export default function EvaPreview() {
  const q = useMemo(() => new URLSearchParams(window.location.search), []);
  const audio = useMissionAudio();
  const resume = q.get("at") === "ladder" ? { progress: { firstSteps: true, sample: q.get("sample") === "1", photo: q.get("photo") === "1" } } : null;
  if (q.get("ascent") === "1") {
    return (
      <main className="fixed inset-0 bg-black" data-testid="eva-preview">
        <LunarAscent siteId="tranquillitatis" />
      </main>
    );
  }
  return (
    <main className="fixed inset-0 bg-black" data-testid="eva-preview">
      <LunarEva
        siteId="tranquillitatis"
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
