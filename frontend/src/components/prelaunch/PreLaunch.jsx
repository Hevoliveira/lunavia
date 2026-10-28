import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { Canvas } from "@react-three/fiber";
import * as THREE from "three";
import {
  BRIEFING,
  CABIN_LOOK,
  CABIN_PANELS,
  CHECKLIST,
  HATCH_CLOSE,
  SUIT_STEPS,
  TOWER_RIDE,
  WALK_LOOK,
  advance,
  checklistComplete,
  clampLook,
  confirmItem,
  countAt,
  createChecklist,
  createPreLaunch,
  doSuitStep,
  dueCalls,
  helmetAt,
  nextItem,
  nextSuitStep,
  prelaunchText,
  requestLaunch,
} from "@/data/preLaunch";
import SuitRoom from "./SuitRoom";
import PadScene from "./PadScene";
import CmCabin from "./CmCabin";

/*
 * COUNTDOWN TO LAUNCH — the optional pre-launch experience (data/preLaunch): its scenes, its
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
  // "tower" | "walkway" | "cabin", read once): the earlier places are taken as done
  const jump = useRef(undefined);
  if (jump.current === undefined) {
    jump.current = typeof window !== "undefined" && ["tower", "walkway", "cabin"].includes(window.__lvPrelaunchJump) ? window.__lvPrelaunchJump : null;
    if (typeof window !== "undefined") window.__lvPrelaunchJump = null;
  }
  const [st, setSt] = useState(() => {
    const s0 = createPreLaunch();
    if (!jump.current) return s0;
    return { ...s0, suitDone: SUIT_STEPS.map((x) => x.id), briefing: true, stage: jump.current };
  });
  const stRef = useRef(st);
  stRef.current = st;
  const [, setTick] = useState(0);
  const [fade, setFade] = useState(1); // the dip to black between places (1 black .. 0 clear)
  const [scene, setScene] = useState(() => (jump.current === "cabin" ? "cabin" : jump.current ? "pad" : "suit")); // the canvas on screen: suit | pad | cabin
  const said = useRef(new Set());
  const say = (id) => {
    if (said.current.has(id)) return;
    said.current.add(id);
    if (audio && audio.say) audio.say(id);
  };
  const cue = (k, d) => audio && audio.prelaunchCue && audio.prelaunchCue(k, d);
  const bed = (k) => audio && audio.prelaunchBed && audio.prelaunchBed(k);

  // what the scenes read (and, for the pad, advance)
  const suitCtl = useRef({ step: null, stepT: 0, done: [], briefing: false, briefingT: 0 });
  const padCtl = useRef({ stage: jump.current === "walkway" ? "walkway" : "tower", towerT: 0, s: 0, stop: -1, paused: false, pauseT: 0, resume: false, boardT: null, look: { yaw: 0, pitch: 0 }, steps: 0, events: [], dip: 0, toWalk: null, onBoarded: null });
  const cabCtl = useRef({ look: { ...CABIN_LOOK.rest }, focus: null, ck: createChecklist(), now: 0, pick: null, counting: false });
  const countT = useRef(null);
  const last = useRef(performance.now());
  const stepsHeard = useRef(0);
  const elevatorCued = useRef(false);
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
    bed("room");
    const t0 = setTimeout(() => setFade(0), 200);
    return () => {
      clearTimeout(t0);
      if (audio && audio.prelaunchStop) audio.prelaunchStop(0.6);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // the experience's clock: steps, calls, cues and the count (the pad's walk keeps its own, per frame)
  useEffect(() => {
    const id = setInterval(() => {
      const now = performance.now();
      const dt = Math.min(0.25, (now - last.current) / 1000);
      last.current = now;
      const s = stRef.current;
      if (s.launched) return;
      const sc = suitCtl.current;
      if (s.stage === "suit") {
        if (sc.step) {
          sc.stepT += dt;
          const step = SUIT_STEPS.find((x) => x.id === sc.step);
          for (const c of step.calls) if (sc.stepT >= c.at) say(c.id);
          if (sc.step === "suitCheck") for (let i = 0; i < 3; i++) if (helmetAt(i, sc.stepT) >= 0.98) (said.current.has(`helmet${i}`) ? null : (said.current.add(`helmet${i}`), cue("helmet")));
          if (sc.stepT >= step.dur) {
            sc.done = [...sc.done, sc.step];
            sc.step = null;
            if (sc.done.length === SUIT_STEPS.length) sc.briefing = true;
          }
        } else if (sc.briefing) {
          sc.briefingT += dt;
          if (sc.briefingT >= BRIEFING.call.at) say(BRIEFING.call.id);
        }
      }
      const pc = padCtl.current;
      if (s.stage === "tower" && !elevatorCued.current && pc.towerT >= TOWER_RIDE.elevator[0] + 0.2) {
        elevatorCued.current = true;
        cue("elevator", TOWER_RIDE.elevator[1] - TOWER_RIDE.elevator[0] - 0.2);
        say("prelaunch.elevator");
      }
      if (s.stage === "walkway") {
        while (stepsHeard.current < pc.steps) {
          stepsHeard.current += 1;
          cue("step");
        }
        while (pc.events.length) {
          const e = pc.events.shift();
          if (e.call) say(e.call);
        }
      }
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

  // the pad's own transitions (from its frame loop)
  padCtl.current.toWalk = () => {
    if (stRef.current.stage !== "tower") return;
    const n = advance(stRef.current, "walkway");
    stRef.current = n;
    setSt(n);
    padCtl.current.stage = "walkway";
    bed("arm");
  };
  padCtl.current.onBoarded = padCtl.current.onBoarded || null;

  /* ---- the player's actions ---- */
  const suitStep = (id) => {
    const sc = suitCtl.current;
    if (sc.step) return;
    const n = doSuitStep(stRef.current, id);
    if (n === stRef.current) return;
    stRef.current = n;
    setSt(n);
    sc.step = id;
    sc.stepT = 0;
    cue("switch");
  };
  const toPad = () => {
    const n = advance(stRef.current, "tower");
    if (n === stRef.current) return;
    stRef.current = n;
    setSt(n);
    goTo("pad", () => bed("pad"));
  };
  const walkContinue = () => {
    padCtl.current.resume = true;
  };
  const board = () => {
    const pc = padCtl.current;
    if (pc.boardT != null) return;
    pc.boardT = 0;
    pc.onBoarded = () => {
      const n = advance(stRef.current, "cabin");
      stRef.current = n;
      setSt(n);
      setScene("cabin");
      setFade(1);
      setTimeout(() => setFade(0), 350);
      bed("cabin");
    };
  };
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

  /* ---- touch: drag to look (the arm, the cabin), tap a panel ---- */
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
    if (stRef.current.stage === "walkway") {
      const p = padCtl.current;
      p.look = clampLook({ yaw: p.look.yaw + dx * k, pitch: p.look.pitch + dy * k }, WALK_LOOK);
    } else if (stRef.current.stage === "cabin" || stRef.current.stage === "count") {
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
  const sc = suitCtl.current;
  const pc = padCtl.current;
  const cc = cabCtl.current;
  const stage = st.stage;
  const next = nextSuitStep(st);
  const nextCk = nextItem(cc.ck);
  const ckDone = checklistComplete(cc.ck);
  const briefDone = sc.briefing && sc.briefingT >= BRIEFING.dur;
  const panel = cc.focus ? CABIN_PANELS.find((p) => p.id === cc.focus) : null;
  const count = stage === "count" && countT.current != null ? countAt(countT.current) : null;
  const dip = Math.max(fade, stage === "tower" || stage === "walkway" ? pc.dip || 0 : 0, count ? count.dip : 0);
  const towerCap = stage === "tower" ? (pc.towerT < TOWER_RIDE.elevator[0] ? L.tower.arrival : L.tower.elevator) : null;
  const atStop = stage === "walkway" && pc.paused && pc.boardT == null ? pc.stop : -1;

  const btn = "pointer-events-auto font-mono text-[11px] short:text-[10px] tracking-[0.22em] px-4 py-2.5 touch:min-h-[44px] border transition-colors";
  return (
    <div className="absolute inset-0 bg-black overflow-hidden" data-testid="prelaunch-root" data-stage={stage} data-scene={scene}>
      {/* the scene of the moment (each built for its place, released when it is left) */}
      <div className="absolute inset-0" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={() => (drag.current = null)} style={{ touchAction: "none" }}>
        {scene === "suit" && (
          <Canvas key="suit" dpr={[1, 2]} camera={{ fov: 50, near: 0.05, far: 60 }} gl={GL} onCreated={({ gl }) => gl.setClearColor("#000000")}>
            <Suspense fallback={null}>
              <SuitRoom ctl={suitCtl} />
            </Suspense>
          </Canvas>
        )}
        {scene === "pad" && (
          <Canvas key="pad" dpr={[1, 2]} shadows camera={{ fov: 44, near: 0.0008, far: 300 }} gl={GL} onCreated={({ gl }) => gl.setClearColor("#000000")}>
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
      <div className="absolute top-[calc(var(--hud-top)+0.25rem)] left-[calc(var(--sal)+1rem)] md:left-[calc(var(--sal)+2rem)] bg-black/55 border-l-2 border-[#FF3B00] px-3 py-1.5 pointer-events-none" data-testid="prelaunch-title">
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

      {/* the suit room: the three preparations, then the briefing */}
      {stage === "suit" && !sc.briefing && (
        <div className="absolute bottom-6 short:bottom-2 left-[calc(var(--sal)+1rem)] md:left-[calc(var(--sal)+2rem)] safe-mb flex flex-col gap-2 short:gap-1.5 z-20 bg-black/70 border border-white/15 p-2.5 short:p-2 max-w-[calc(100vw-var(--sal)-var(--sar)-14rem)]" data-testid="suit-steps">
          <div className="font-mono text-[10px] tracking-[0.3em] text-zinc-200">{L.suit.hint}</div>
          <div className="flex flex-wrap gap-2">
            {SUIT_STEPS.map((s) => {
              const done = sc.done.includes(s.id);
              const playing = sc.step === s.id;
              const ready = !sc.step && next && next.id === s.id;
              return (
                <button
                  key={s.id}
                  type="button"
                  disabled={!ready}
                  onClick={() => suitStep(s.id)}
                  data-testid={`suit-step-${s.id}`}
                  data-state={done ? "done" : playing ? "playing" : ready ? "ready" : "locked"}
                  className={`${btn} ${done ? "border-[#4fd1c5] text-[#7ff0e4] bg-[#0f2a28]" : playing ? "border-white text-white bg-white/15" : ready ? "border-[#FF3B00] text-white bg-[#FF3B00]/85 hover:bg-[#FF3B00]" : "border-white/30 text-zinc-300 bg-black/60"}`}
                >
                  {done ? "✓ " : playing ? "● " : ""}
                  {L.suit[s.id]}
                </button>
              );
            })}
          </div>
          {sc.step && (
            <div className="font-mono text-[10px] tracking-[0.22em] text-white px-1 border-l-2 border-[#4fd1c5]" data-testid="suit-caption">
              {L.suit[sc.step]} …
            </div>
          )}
          {!sc.step && sc.done.length > 0 && (
            <div className="font-mono text-[10px] tracking-[0.22em] text-[#7ff0e4] px-1 border-l-2 border-[#4fd1c5]">✓ {L.suit.done[sc.done[sc.done.length - 1]]}</div>
          )}
        </div>
      )}
      {stage === "suit" && sc.briefing && (
        <div className="absolute top-[calc(var(--hud-top)+0.25rem)] right-6 md:right-10 safe-mr z-20 pointer-events-none">
          <div className="bg-black/60 backdrop-blur-sm border border-white/15 px-5 py-4 short:px-4 short:py-3 w-[300px] short:w-[260px]" data-testid="prelaunch-briefing">
            <div className="font-mono text-[10px] tracking-[0.35em] text-[#FF3B00] mb-2">● {L.suit.briefing}</div>
            {L.suit.briefingItems.map((it, i) =>
              sc.briefingT >= BRIEFING.itemFrom + i * BRIEFING.itemEvery ? (
                <div key={it} className="font-mono text-[10px] short:text-[9px] tracking-[0.22em] text-white py-1 border-b border-white/10 scan-in">
                  {it}
                </div>
              ) : null
            )}
            {briefDone && (
              <button type="button" onClick={toPad} data-testid="prelaunch-topad" className={`${btn} mt-3 w-full border-[#FF3B00] text-white bg-[#FF3B00]/15 hover:bg-[#FF3B00]`}>
                {L.suit.toPad} ›
              </button>
            )}
          </div>
        </div>
      )}

      {/* the tower and the walk: captions, CONTINUE at the view, BOARD at the hatch */}
      {towerCap && (
        <div className="absolute bottom-6 short:bottom-3 left-[calc(var(--sal)+1rem)] md:left-[calc(var(--sal)+2rem)] safe-mb bg-black/70 border-l-2 border-[#4fd1c5] px-3 py-1.5 font-mono text-[10px] tracking-[0.25em] text-white pointer-events-none" data-testid="prelaunch-caption">
          {towerCap}
        </div>
      )}
      {stage === "walkway" && (
        <div className="absolute bottom-6 short:bottom-2 left-[calc(var(--sal)+1rem)] md:left-[calc(var(--sal)+2rem)] safe-mb flex flex-col gap-2 z-20">
          <div className="bg-black/70 border-l-2 border-[#4fd1c5] px-3 py-1.5 font-mono text-[10px] tracking-[0.25em] text-white pointer-events-none" data-testid="prelaunch-caption">
            {atStop === 1 ? L.walk.whiteRoom : L.walk.walking}
            <div className="text-[9px] tracking-[0.25em] text-zinc-300 mt-0.5">{L.walk.look}</div>
          </div>
          {atStop === 0 && (
            <button type="button" onClick={walkContinue} data-testid="walk-continue" className={`${btn} self-start border-[#FF3B00] text-white bg-[#FF3B00]/15 hover:bg-[#FF3B00]`}>
              {L.walk.go} ›
            </button>
          )}
          {atStop === 1 && (
            <button type="button" onClick={board} data-testid="walk-board" className={`${btn} self-start border-[#FF3B00] text-white bg-[#FF3B00]/15 hover:bg-[#FF3B00]`}>
              {L.walk.board} ›
            </button>
          )}
        </div>
      )}

      {/* the cabin: the checklist (right), the panels to inspect (left), the count */}
      {(stage === "cabin" || stage === "count") && (
        <div className="absolute top-[calc(var(--hud-top)+0.25rem)] right-6 md:right-10 safe-mr bg-black/80 border border-white/20 px-4 py-3 short:py-2 w-[250px] short:w-[230px] z-20" data-testid="cabin-checklist">
          <div className="font-mono text-[10px] tracking-[0.35em] text-[#FF3B00] mb-1.5">● {L.cabin.checklist}</div>
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
                className={`pointer-events-auto w-full flex justify-between items-center font-mono text-[10.5px] short:text-[10px] tracking-[0.12em] py-1.5 short:py-1 touch:min-h-[38px] border-b border-white/10 text-left ${done ? "text-[#4fd1c5]" : isNext ? "text-white" : "text-zinc-500"}`}
              >
                <span className="min-w-0">
                  {done ? "✓ " : isNext ? "› " : "  "}
                  {name}
                </span>
                <span className={`shrink-0 pl-3 ${done ? "text-[#4fd1c5]" : isNext ? "text-[#FF3B00]" : ""}`}>{done ? val : isNext ? (pt ? "TOCAR" : "TAP") : "—"}</span>
              </button>
            );
          })}
          <div className="font-mono text-[8.5px] tracking-[0.15em] text-zinc-400 mt-1.5">{L.cabin.note}</div>
        </div>
      )}
      {stage === "cabin" && !panel && !ckDone && (
        <div className="absolute bottom-6 short:bottom-2 left-[calc(var(--sal)+1rem)] md:left-[calc(var(--sal)+2rem)] safe-mb flex flex-col gap-1.5 z-20 max-w-[calc(100vw-var(--sal)-var(--sar)-20rem)]" data-testid="cabin-panels">
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
        <div className="absolute bottom-6 short:bottom-2 left-[calc(var(--sal)+1rem)] md:left-[calc(var(--sal)+2rem)] safe-mb bg-black/80 border-l-2 border-[#4fd1c5] px-4 py-3 short:py-2 max-w-[min(26rem,calc(100vw-var(--sal)-var(--sar)-20rem))] z-20" data-testid="panel-info" data-panel={panel.id}>
          <div className="font-mono text-[10px] tracking-[0.3em] text-[#4fd1c5]">{(pt ? panel.pt : panel.en).name}</div>
          <div className="font-sans text-[12px] short:text-[11px] leading-snug text-zinc-200 mt-1">{(pt ? panel.pt : panel.en).body}</div>
          <button type="button" onClick={() => inspect(null)} data-testid="panel-back" className={`${btn} mt-2 py-1.5 border-white/45 text-white bg-black/75`}>
            ‹ {L.cabin.back}
          </button>
        </div>
      )}
      {stage === "cabin" && ckDone && (
        <div className="absolute left-[calc(var(--sal)+1rem)] right-[calc(var(--sar)+18rem)] top-[48%] short:top-[46%] flex flex-col items-center text-center z-20 pointer-events-none" data-testid="crew-ready-launch">
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
