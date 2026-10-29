import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import {
  CABIN_LOOK,
  CABIN_PANELS,
  CHECKLIST,
  HATCH_CLOSE,
  PAD_SHOT,
  advance,
  checklistComplete,
  clampLook,
  confirmItem,
  countAt,
  createChecklist,
  createPreLaunch,
  dueCalls,
  nextItem,
  normalizeStage,
  prelaunchText,
  requestLaunch,
} from "@/data/preLaunch";
import { setSubtitlePlacement } from "@/components/CommsSubtitles";
import PadScene from "./PadScene";
import CmCabin from "./CmCabin";

/*
 * COUNTDOWN TO LAUNCH — the optional pre-launch experience (data/preLaunch): the launch complex,
 * a cut into the command module, the checklist and the terminal count. Its scenes, its
 * screen layer (stage, the few controls, captions that read with the sound off), its sound and
 * radio, and the one way out: the launch, requested once (the count reaching T-15, or SKIP
 * PRE-LAUNCH at any moment), which the mission turns into the existing launch film.
 *
 * Nothing here writes the mission's save, score or log: the launch that follows is the same as
 * after LAUNCH SEQUENCE — INITIATE.
 */
const GL = { antialias: true, alpha: false, toneMapping: THREE.ACESFilmicToneMapping, outputColorSpace: THREE.SRGBColorSpace, powerPreference: "high-performance" };

export default function PreLaunch({ audio = null, lang = "en", onLaunch }) {
  const L = prelaunchText(lang);
  const pt = lang === "pt";
  // validation tooling may open the experience at a later place (window.__lvPrelaunchJump =
  // "pad" | "cabin", read once; older names map through normalizeStage)
  const jump = useRef(undefined);
  if (jump.current === undefined) {
    const j = typeof window !== "undefined" ? normalizeStage(window.__lvPrelaunchJump) : null;
    jump.current = j === "cabin" ? "cabin" : null;
    if (typeof window !== "undefined") window.__lvPrelaunchJump = null;
  }
  const [st, setSt] = useState(() => createPreLaunch(jump.current || "pad"));
  const stRef = useRef(st);
  stRef.current = st;
  const [, setTick] = useState(0);
  const [fade, setFade] = useState(1); // the dip to black between places (1 black .. 0 clear)
  const [scene, setScene] = useState(() => (jump.current === "cabin" ? "cabin" : "pad")); // the canvas on screen: pad | cabin
  const said = useRef(new Set());
  const say = (id) => {
    if (said.current.has(id)) return;
    said.current.add(id);
    if (audio && audio.say) audio.say(id);
  };
  const cue = (k) => audio && audio.prelaunchCue && audio.prelaunchCue(k);
  const bed = (k) => audio && audio.prelaunchBed && audio.prelaunchBed(k);

  // what the scenes read (and, for the pad, advance)
  const padCtl = useRef({ t: 0, onDone: null });
  const cabCtl = useRef({ look: { ...CABIN_LOOK.rest }, focus: null, ck: createChecklist(), now: 0, pick: null, counting: false });
  const countT = useRef(null);
  const last = useRef(performance.now());
  const launchedRef = useRef(false);

  const launch = useCallback(() => {
    const r = requestLaunch(stRef.current);
    if (!r.launch || launchedRef.current) return;
    launchedRef.current = true;
    stRef.current = r.state;
    setSt(r.state);
    if (audio && audio.prelaunchStop) audio.prelaunchStop(0.5);
    if (onLaunch) onLaunch();
  }, [audio, onLaunch]);

  // change place behind a short dip to black
  const goTo = (sceneId, then) => {
    setFade(1);
    setTimeout(() => {
      setScene(sceneId);
      if (then) then();
      setTimeout(() => setFade(0), 250);
    }, 450);
  };

  useEffect(() => {
    if (audio && audio.init) audio.init();
    bed(jump.current === "cabin" ? "cabin" : "pad");
    const t0 = setTimeout(() => setFade(0), 200);
    return () => {
      clearTimeout(t0);
      if (audio && audio.prelaunchStop) audio.prelaunchStop(0.6);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // the experience's clock: the count and its calls (the pad shot keeps its own, per frame)
  useEffect(() => {
    const id = setInterval(() => {
      const now = performance.now();
      const dt = Math.min(0.25, (now - last.current) / 1000);
      last.current = now;
      const s = stRef.current;
      if (s.launched) return;
      if (s.stage === "pad" && padCtl.current.t >= PAD_SHOT.call.at) say(PAD_SHOT.call.id);
      if (s.stage === "count" && countT.current != null) {
        countT.current += dt;
        for (const c of dueCalls(countT.current, said.current)) say(c.id);
        const k = countAt(countT.current);
        if (k.handoff) launch();
      }
      setTick((x) => (x + 1) % 1e6);
    }, 100);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [launch]);

  /* ---- the cut from the launch complex into the cabin (no boarding is played) ---- */
  const toCabin = () => {
    if (stRef.current.stage !== "pad") return;
    const n = advance(stRef.current, "cabin");
    if (n === stRef.current) return;
    stRef.current = n;
    setSt(n);
    padCtl.current.onDone = null;
    goTo("cabin", () => bed("cabin"));
  };
  padCtl.current.onDone = stRef.current.stage === "pad" ? toCabin : null;

  /* ---- the player's actions ---- */
  const check = (id) => {
    const cc = cabCtl.current;
    const ck = confirmItem(cc.ck, id, cc.now);
    if (ck === cc.ck) return;
    cc.ck = ck;
    cc.focus = null;
    const item = CHECKLIST.find((c) => c.id === id);
    cue("switch");
    say(item.call);
    if (id === "hatch") setTimeout(() => cue("hatch"), (HATCH_CLOSE - 0.9) * 1000);
    if (checklistComplete(ck)) setTimeout(() => say("prelaunch.crewReadyLaunch"), 2600);
    setTick((x) => x + 1);
  };
  const beginCount = () => {
    const n = advance(stRef.current, "count", { checklistDone: checklistComplete(cabCtl.current.ck) });
    if (n === stRef.current) return;
    stRef.current = n;
    setSt(n);
    cabCtl.current.counting = true;
    cabCtl.current.focus = null;
    countT.current = 0;
  };
  const inspect = (id) => {
    cabCtl.current.focus = id;
    setTick((x) => x + 1);
  };

  /* ---- touch: drag to look (the cabin), tap a panel ---- */
  const drag = useRef(null);
  const onDown = (e) => {
    drag.current = { x: e.clientX, y: e.clientY, moved: 0 };
  };
  const onMove = (e) => {
    const d = drag.current;
    if (!d) return;
    const dx = e.clientX - d.x;
    const dy = e.clientY - d.y;
    d.x = e.clientX;
    d.y = e.clientY;
    d.moved += Math.abs(dx) + Math.abs(dy);
    const k = 0.006;
    if (stRef.current.stage === "cabin" || stRef.current.stage === "count") {
      const c = cabCtl.current;
      if (c.focus) return;
      c.look = clampLook({ yaw: c.look.yaw + dx * k, pitch: c.look.pitch + dy * k }, CABIN_LOOK);
    }
  };
  const onUp = (e) => {
    const d = drag.current;
    drag.current = null;
    if (!d || d.moved > 8) return;
    if (stRef.current.stage === "cabin" && cabCtl.current.pick && !cabCtl.current.focus) {
      const r = e.currentTarget.getBoundingClientRect();
      const id = cabCtl.current.pick(e.clientX - r.left, e.clientY - r.top);
      if (id) inspect(id);
    }
  };

  /* ---- what is on screen ---- */
  const pc = padCtl.current;
  const cc = cabCtl.current;
  const stage = st.stage;
  const nextCk = nextItem(cc.ck);
  const ckDone = checklistComplete(cc.ck);
  // in the cabin the subtitles keep to the left of the checklist; everywhere else, as always
  const subSide = stage === "cabin" || stage === "count";
  useEffect(() => {
    setSubtitlePlacement(subSide ? "side" : "default");
  }, [subSide]);
  useEffect(() => () => setSubtitlePlacement("default"), []);
  const panel = cc.focus ? CABIN_PANELS.find((p) => p.id === cc.focus) : null;
  const count = stage === "count" && countT.current != null ? countAt(countT.current) : null;
  const dip = Math.max(fade, count ? count.dip : 0);

  const btn = "pointer-events-auto font-mono text-[11px] short:text-[10px] tracking-[0.22em] px-4 py-2.5 touch:min-h-[44px] border transition-colors";
  return (
    <div className="absolute inset-0 bg-black overflow-hidden" data-testid="prelaunch-root" data-stage={stage} data-scene={scene}>
      {/* the scene of the moment (each built for its place, released when it is left) */}
      <div className="absolute inset-0" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => (drag.current = null)} style={{ touchAction: "none" }}>
        {scene === "pad" && (
          <Canvas key="pad" dpr={[1, 2]} shadows camera={{ fov: 46, near: 0.01, far: 300 }} gl={GL} onCreated={({ gl }) => gl.setClearColor("#000000")}>
            <Suspense fallback={null}>
              <PadScene ctl={padCtl} />
            </Suspense>
          </Canvas>
        )}
        {scene === "cabin" && (
          <Canvas key="cabin" dpr={[1, 2]} camera={{ fov: 70, near: 0.02, far: 30 }} gl={GL} onCreated={({ gl }) => gl.setClearColor("#000000")}>
            <Suspense fallback={null}>
              <CmCabin ctl={cabCtl} />
            </Suspense>
          </Canvas>
        )}
      </div>
      <div className="absolute inset-0 bg-black pointer-events-none transition-opacity duration-300" style={{ opacity: dip }} />

      {/* the title and the stage, top left */}
      <div className="absolute top-[calc(var(--hud-top)+0.25rem)] left-[calc(var(--sal)+1rem)] md:left-[calc(var(--sal)+2rem)] bg-black/55 border-l-2 border-[#FF3B00] px-3 py-1.5 pointer-events-none max-w-[calc(100vw-var(--sal)-var(--sar)-19rem)]" data-testid="prelaunch-title">
        <div className="font-mono text-[10px] tracking-[0.35em] text-[#FF3B00]">● {L.title}</div>
        <div className="font-mono text-[10px] tracking-[0.3em] text-white mt-0.5" data-testid="prelaunch-stage">
          {L.stages[stage]}
        </div>
        <div className="font-mono text-[9px] tracking-[0.18em] text-zinc-300 mt-0.5">{L.dramatized}</div>
      </div>

      {/* SKIP PRE-LAUNCH: straight to the launch, at any moment */}
      <button type="button" onClick={launch} data-testid="prelaunch-skip" className={`${btn} absolute bottom-6 short:bottom-2 right-6 md:right-10 safe-mr safe-mb text-white bg-black/75 border-white/45 hover:border-white z-30`}>
        {L.skip} ›
      </button>

      {/* the launch complex: the caption, and the way into the cabin (it also follows by itself) */}
      {stage === "pad" && (
        <div className="absolute bottom-6 short:bottom-2 left-[calc(var(--sal)+1rem)] md:left-[calc(var(--sal)+2rem)] safe-mb flex flex-col items-start gap-2 z-20 max-w-[calc(100vw-var(--sal)-var(--sar)-18.5rem)]">
          <div className="bg-black/70 border-l-2 border-[#4fd1c5] px-3 py-1.5 font-mono text-[10px] tracking-[0.25em] text-white pointer-events-none" data-testid="prelaunch-caption">
            {L.pad.arrival}
          </div>
          {pc.t >= PAD_SHOT.cta && (
            <button type="button" onClick={toCabin} data-testid="pad-to-cabin" className={`${btn} self-start border-[#FF3B00] text-white bg-[#FF3B00]/15 hover:bg-[#FF3B00]`}>
              {L.pad.toCabin} ›
            </button>
          )}
        </div>
      )}

      {/* the cabin: the checklist (right), the panels to inspect (left), the count */}
      {(stage === "cabin" || stage === "count") && (
        <div className="absolute top-[calc(var(--hud-top)+0.25rem)] right-6 md:right-10 safe-mr bg-black/80 border border-white/20 px-4 short:px-3 py-3 short:py-2 w-[260px] short:w-[250px] z-20" data-testid="cabin-checklist">
          <div className="font-mono text-[10px] tracking-[0.3em] short:tracking-[0.18em] whitespace-nowrap text-[#FF3B00] mb-1.5">● {L.cabin.checklist}</div>
          {CHECKLIST.map((c) => {
            const done = cc.ck.done.includes(c.id);
            const isNext = nextCk && nextCk.id === c.id && stage === "cabin";
            const [name, val] = pt ? c.pt : c.en;
            return (
              <button
                key={c.id}
                type="button"
                disabled={!isNext}
                onClick={() => check(c.id)}
                data-testid={`check-${c.id}`}
                data-state={done ? "done" : isNext ? "next" : "locked"}
                className={`pointer-events-auto w-full flex justify-between items-center font-mono text-[10.5px] short:text-[10px] tracking-[0.12em] short:tracking-[0.06em] py-1.5 short:py-1 touch:min-h-[38px] short:touch:min-h-[34px] border-b border-white/10 text-left ${done ? "text-[#4fd1c5]" : isNext ? "text-white" : "text-zinc-500"}`}
              >
                <span className="min-w-0">
                  {done ? "✓ " : isNext ? "› " : "  "}
                  {name}
                </span>
                <span className={`shrink-0 pl-3 ${done ? "text-[#4fd1c5]" : isNext ? "text-[#FF3B00]" : ""}`}>{done ? val : isNext ? (pt ? "TOCAR" : "TAP") : "—"}</span>
              </button>
            );
          })}
          <div className="font-mono text-[8.5px] short:text-[8px] tracking-[0.15em] short:tracking-[0.06em] leading-snug text-zinc-400 mt-1.5">{L.cabin.note}</div>
        </div>
      )}
      {stage === "cabin" && !panel && !ckDone && (
        <div className="absolute bottom-6 short:bottom-2 left-[calc(var(--sal)+1rem)] md:left-[calc(var(--sal)+2rem)] safe-mb flex flex-col gap-1.5 z-20 max-w-[calc(100vw-var(--sal)-var(--sar)-21.5rem)]" data-testid="cabin-panels">
          <div className="font-mono text-[10px] tracking-[0.25em] text-zinc-100 bg-black/70 px-2 py-1 pointer-events-none">
            {L.cabin.seat} · {L.cabin.look}
          </div>
          <div className="grid grid-cols-3 gap-1.5 w-max max-w-full">
            {CABIN_PANELS.map((p) => (
              <button key={p.id} type="button" onClick={() => inspect(p.id)} data-testid={`cabin-panel-${p.id}`} aria-label={(pt ? p.pt : p.en).name} className={`${btn} py-1.5 px-2.5 border-white/35 text-white bg-black/75 hover:border-white/60 whitespace-nowrap`}>
                {(pt ? p.pt : p.en).tag}
              </button>
            ))}
          </div>
        </div>
      )}
      {panel && (
        <div className="absolute bottom-6 short:bottom-2 left-[calc(var(--sal)+1rem)] md:left-[calc(var(--sal)+2rem)] safe-mb bg-black/80 border-l-2 border-[#4fd1c5] px-4 py-3 short:py-2 max-w-[min(26rem,calc(100vw-var(--sal)-var(--sar)-21.5rem))] z-20" data-testid="panel-info" data-panel={panel.id}>
          <div className="font-mono text-[10px] tracking-[0.3em] text-[#4fd1c5]">{(pt ? panel.pt : panel.en).name}</div>
          <div className="font-sans text-[12px] short:text-[11px] leading-snug text-zinc-200 mt-1">{(pt ? panel.pt : panel.en).body}</div>
          <button type="button" onClick={() => inspect(null)} data-testid="panel-back" className={`${btn} mt-2 py-1.5 border-white/45 text-white bg-black/75`}>
            ‹ {L.cabin.back}
          </button>
        </div>
      )}
      {stage === "cabin" && ckDone && (
        <div className="absolute left-[calc(var(--sal)+1rem)] right-[calc(var(--sar)+19.5rem)] top-[48%] short:top-[46%] flex flex-col items-center text-center z-20 pointer-events-none" data-testid="crew-ready-launch">
          <div className="font-display font-black text-white text-3xl md:text-4xl short:text-2xl tracking-tight drop-shadow-[0_2px_14px_rgba(0,0,0,0.7)] scan-in">{L.cabin.ready}</div>
          {cc.now - (cc.ck.at.launchControl || 0) > 2.5 && (
            <button type="button" onClick={beginCount} data-testid="begin-count" className={`${btn} mt-4 border-2 border-[#FF3B00] text-white bg-[#FF3B00]/20 hover:bg-[#FF3B00]`}>
              {L.cabin.begin} ›
            </button>
          )}
        </div>
      )}
      {count && (
        <div className="absolute left-1/2 -translate-x-1/2 w-max bottom-10 short:bottom-4 flex flex-col items-center pointer-events-none z-20" data-testid="count-display" data-t={count.shown}>
          <div className="font-mono text-[10px] tracking-[0.35em] text-zinc-200">{L.count.tminus}</div>
          <div className="font-display font-black text-white text-6xl short:text-5xl tabular-nums drop-shadow-[0_2px_14px_rgba(0,0,0,0.7)]">{count.shown}</div>
        </div>
      )}
    </div>
  );
}
