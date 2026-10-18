import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { Canvas, useFrame, useThree } from "@react-three/fiber";
import * as THREE from "three";
import LanderModel from "@/components/LanderModel";
import { SiteRocks, SiteSky, SiteSun, SiteTerrain } from "@/components/scenes/LunarSite";
import AdaptiveResolution from "@/components/scenes/AdaptiveResolution";
import { getSite } from "@/data/landingSites";
import { LM } from "@/data/touchdownFx";
import { ASCENT, COUNTDOWN, ascentAt } from "@/data/lunarAscent";

/**
 * LUNAR SURFACE — ASCENT PREPARATION, then the lunar liftoff (automatic).
 *
 * The scene is the landing site itself (the same terrain, rocks, sky and sun
 * as the descent) with the lunar module exactly where and how it came to rest
 * (the landing result's pose: position on the terrain, tilt, strut
 * compression). Nothing starts until the player presses INITIATE LUNAR
 * ASCENT. Then: systems checks, a short countdown, PROCEED: the ascent
 * engine fires, the ascent stage separates from the descent stage (which
 * stays on the Moon with its legs) and climbs vertically, pitches over and
 * leaves the surface below. The vacuum plume is short and faint, with no
 * smoke. The film ends ~22 s after ignition; the rest of the ascent to orbit
 * insertion is told by the next scene (rendezvous).
 *
 * Far side (Silent Horizon): no Earth link on the surface; only the crew talks.
 */
const SCENE_PER_M = 0.5; // scene units per metre (touchdownFx WORLD_X)
const MODEL_M = 4.8; // metres per lunar module model unit
const ASC_CENTRE = 0.6 * LM.scale; // ascent stage's centre above the LM origin (scene units)
const TABLE_DT = 0.05;
const TABLE = (() => {
  const out = [];
  for (let t = 0; t <= ASCENT.film + 1; t += TABLE_DT) out.push(ascentAt(t));
  return out;
})();
const at = (t) => {
  if (t <= 0) return TABLE[0];
  const i = Math.min(TABLE.length - 2, Math.floor(t / TABLE_DT));
  const a = TABLE[i];
  const b = TABLE[i + 1];
  const u = (t - i * TABLE_DT) / TABLE_DT;
  const mix = (k) => a[k] + (b[k] - a[k]) * u;
  return { t, alt: mix("alt"), x: mix("x"), vy: mix("vy"), vx: mix("vx"), pitch: mix("pitch") };
};
const smooth = (x) => {
  const u = Math.max(0, Math.min(1, x));
  return u * u * (3 - 2 * u);
};
const DEG = Math.PI / 180;
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();

function Director({ ctl, base, ascRef }) {
  const { camera } = useThree();
  const look = useRef(new THREE.Vector3());
  const pos = useRef(new THREE.Vector3());
  const ready = useRef(false);
  useFrame((state, delta) => {
    const c = ctl.current;
    const now = state.clock.elapsedTime;
    const t = c.ignitedAt != null ? now - c.ignitedAt : c.countAt != null ? now - c.countAt - COUNTDOWN : -1e3;
    const s = at(Math.max(0, t));
    // the ascent stage, in LanderModel's model units (the LM group is scaled by LM.scale)
    const a = ascRef.current;
    a.y = c.ignitedAt != null ? s.alt / MODEL_M : 0;
    a.x = c.ignitedAt != null ? s.x / MODEL_M : 0;
    a.rz = -s.pitch; // leaning towards +X, the direction of flight
    a.thrust = c.ignitedAt != null ? Math.min(1, t * 6) : 0;
    c.alt = c.ignitedAt != null ? s.alt : 0;
    c.vy = c.ignitedAt != null ? s.vy : 0;
    c.vx = c.ignitedAt != null ? s.vx : 0;
    c.t = t;
    // world positions (scene units)
    const P = base; // the LM origin on the ground
    const asc = _a.set(P[0] + s.x * SCENE_PER_M * (c.ignitedAt != null ? 1 : 0), P[1] + ASC_CENTRE + (c.ignitedAt != null ? s.alt * SCENE_PER_M : 0), P[2]);
    const lmC = _b.set(P[0], P[1] + 1.4, P[2]);
    let camP;
    let camL;
    if (c.ignitedAt == null && c.countAt == null) {
      // preparation: a slow drift around the lander
      const ang = 0.7 + now * 0.025;
      camP = _c.set(P[0] + Math.cos(ang) * 15, P[1] + 3.2, P[2] + Math.sin(ang) * 15);
      camL = lmC;
    } else if (t < 5.5) {
      // countdown and liftoff: low, from the regolith, looking up at the stage leaving
      camP = _c.set(P[0] + 9, P[1] + 0.7, P[2] + 7);
      camL = _b.copy(lmC).lerp(asc, smooth((t + 0.5) / 5));
    } else if (t < 14) {
      // climbing away: the camera rides above and behind, looking down past the ascent stage at
      // the site falling away below (the descent stage left on it)
      const u = smooth((t - 5.5) / 2);
      camP = _c.set(asc.x - 12 - 6 * u, asc.y + 5 + 4 * u, asc.z + 15 + 6 * u);
      camL = _b.set(P[0], P[1], P[2]).lerp(asc, 0.62);
    } else {
      // high and wide: the ascent stage small against the black sky, the site far below
      camP = _c.set(P[0] + 60, P[1] + 30, P[2] + 90);
      camL = asc;
    }
    if (!ready.current) {
      pos.current.copy(camP);
      look.current.copy(camL);
      ready.current = true;
    } else {
      const k = Math.min(1, delta * (t > 5.5 && t < 6.2 ? 30 : 4));
      pos.current.lerp(camP, k);
      look.current.lerp(camL, Math.min(1, delta * 6));
    }
    camera.position.copy(pos.current);
    camera.lookAt(look.current);
    if (typeof window !== "undefined") window.__lvAscent = { stage: c.stage, t, alt: c.alt, ascY: a.y, ascX: a.x, descentStays: true };
  });
  return null;
}

/** The ignition flash on the descent stage's deck: the ascent engine fires into it (fire in the hole). */
function IgnitionFlash({ ctl, base }) {
  const ref = useRef();
  useFrame((state) => {
    const c = ctl.current;
    if (!ref.current) return;
    const t = c.ignitedAt != null ? state.clock.elapsedTime - c.ignitedAt : -1;
    ref.current.intensity = t >= 0 && t < 1.2 ? 30 * Math.exp(-t * 4) : 0;
  });
  return <pointLight ref={ref} position={[base[0], base[1] + 0.95, base[2] + 0.2]} color="#ffb070" intensity={0} distance={10} decay={2} />;
}

const CHECKS = (farSide) => [
  ["ASCENT ENGINE", "ARMED"],
  ["ABORT STAGE", "SET"],
  ["GUIDANCE", "ALIGNED"],
  ["RENDEZVOUS RADAR", "CSM ACQUIRED"],
  ["EARTH LINK", farSide ? "UNAVAILABLE · FAR SIDE" : "HOUSTON · GO"],
];

export default function LunarAscent({ siteId, pose = null, audio = null, farSide = false, onComplete }) {
  const site = useMemo(() => getSite(siteId), [siteId]);
  const p = pose || { x: 0, padY: site.contactGround ? site.scale.y(site.contactGround(0)) : 0, tilt: 0, pitch: 0, comp: [0, 0, 0, 0], probe: [0, 0, 0, 0] };
  const base = useMemo(() => [p.x, p.padY + LM.foot, 0], [p.x, p.padY]);
  const fx = useMemo(() => ({ thrust: 0, comp: (p.comp || [0, 0, 0, 0]).slice(), probe: (p.probe || [0, 0, 0, 0]).slice() }), [p.comp, p.probe]);
  const ascRef = useRef({ x: 0, y: 0, z: 0, rx: 0, rz: 0, thrust: 0 });
  const ctl = useRef({ stage: "prep", countAt: null, ignitedAt: null, t: -1e3, alt: 0, vy: 0, vx: 0 });
  const clockRef = useRef(null); // the canvas clock, to stamp the countdown and ignition
  const [stage, setStage] = useState("prep"); // prep | countdown | liftoff
  const [tick, setTick] = useState(0);
  const [checks, setChecks] = useState(0);
  const doneRef = useRef(false);

  // The far side has no line of sight to the Earth while on the surface.
  useEffect(() => {
    if (!audio) return undefined;
    if (farSide) audio.setEarthLink(false);
    else audio.say("ascent.goLiftoff", { delay: 1.2 });
    return () => {
      audio.stopRumble();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Systems checks tick in during the preparation.
  useEffect(() => {
    if (checks >= 5) return undefined;
    const t = setTimeout(() => setChecks((n) => n + 1), checks === 0 ? 700 : 450);
    return () => clearTimeout(t);
  }, [checks]);

  // Overlay clock: the countdown and the liftoff telemetry (read from the director's state).
  useEffect(() => {
    if (stage === "prep") return undefined;
    const id = setInterval(() => setTick((n) => n + 1), 100);
    return () => clearInterval(id);
  }, [stage]);

  const finish = () => {
    if (doneRef.current) return;
    doneRef.current = true;
    if (audio) audio.stopRumble();
    onComplete && onComplete();
  };

  // Countdown → ignition → end of the film.
  useEffect(() => {
    if (stage === "prep") return undefined;
    const c = ctl.current;
    const now = () => (clockRef.current ? clockRef.current.elapsedTime : performance.now() / 1000);
    const timers = [];
    if (stage === "countdown") {
      c.countAt = now();
      if (audio) audio.say("ascent.armed"); // the count itself is on screen; the crew calls the engine on
      timers.push(
        setTimeout(() => {
          c.ignitedAt = now();
          c.stage = "liftoff";
          setStage("liftoff");
          if (audio) {
            audio.say("ascent.proceed");
            audio.thud && audio.thud(0.5); // the stages' pyros and the engine's start, through the structure
            audio.startRumble(0.35);
          }
        }, COUNTDOWN * 1000)
      );
    }
    if (stage === "liftoff") {
      if (audio && !farSide) timers.push(setTimeout(() => audio.say("ascent.liftoff"), 3500));
      if (audio && !farSide) timers.push(setTimeout(() => audio.say("ascent.pitchover"), (ASCENT.vertical + 0.5) * 1000));
      timers.push(setTimeout(() => audio && audio.setRumble(0.22), 9000));
      timers.push(setTimeout(finish, (ASCENT.film + 0.4) * 1000));
    }
    return () => timers.forEach(clearTimeout);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stage]);

  const initiate = () => {
    if (stage !== "prep") return;
    ctl.current.stage = "countdown";
    setStage("countdown");
  };

  const c = ctl.current;
  const left = c.countAt != null && c.ignitedAt == null ? Math.max(0, Math.ceil(-c.t)) : null;
  const phase = c.ignitedAt == null ? null : c.t < 1.5 ? "STAGE SEPARATION · ASCENT ENGINE ON" : c.t < ASCENT.vertical ? "VERTICAL RISE" : c.t < ASCENT.pitchEnd ? "PITCHOVER" : "CLIMBING TO ORBIT";
  void tick;

  return (
    <div className="absolute inset-0 bg-[#050505]" data-testid="lunar-ascent" data-stage={stage}>
      <div className="absolute inset-0 canvas-host">
        <Canvas
          camera={{ position: [p.x + 15, p.padY + 4, 12], fov: 45, near: 0.1, far: 6000 }}
          dpr={[1, 2]}
          shadows={{ type: THREE.PCFShadowMap }}
          gl={{ antialias: true, alpha: false, toneMapping: THREE.ACESFilmicToneMapping, outputColorSpace: THREE.SRGBColorSpace }}
          onCreated={({ gl, clock }) => {
            gl.setClearColor("#050505");
            clockRef.current = clock;
          }}
        >
          <Suspense fallback={null}>
            <color attach="background" args={["#050505"]} />
            <SiteSky site={site} />
            <SiteSun site={site} focus={() => base} />
            <SiteTerrain site={site} />
            <SiteRocks site={site} />
            <group position={base} rotation={[(p.pitch || 0) * DEG, 0, -(p.tilt || 0) * DEG]}>
              <LanderModel scale={LM.scale} fx={fx} ascent={ascRef.current} />
            </group>
            <IgnitionFlash ctl={ctl} base={base} />
            <Director ctl={ctl} base={base} ascRef={ascRef} />
          </Suspense>
          <AdaptiveResolution />
        </Canvas>
      </div>

      {/* Preparation: the checklist and the button; nothing starts by itself */}
      {stage === "prep" && (
        <div className="absolute inset-0 z-30 flex items-end pointer-events-none safe-ml safe-mb" data-testid="ascent-prep">
          <div className="pointer-events-auto ml-6 md:ml-12 short:ml-3 mb-6 short:mb-2 w-[min(400px,86vw)] short:w-[min(300px,40vw)] bg-black/60 backdrop-blur-sm border-l-2 border-[#FF3B00] px-5 py-4 short:px-3 short:py-2.5 veil-in">
            <div className="font-mono text-[10px] short:text-[9px] tracking-[0.4em] text-[#FF3B00]">● {site.name}</div>
            <h2 className="font-display font-black text-white text-2xl md:text-3xl short:text-[15px] short:leading-tight tracking-tight mt-1" data-testid="ascent-title">
              LUNAR SURFACE — ASCENT PREPARATION
            </h2>
            <ul className="mt-3 short:mt-1.5 space-y-1 short:space-y-0.5 font-mono text-[10px] short:text-[8px] tracking-[0.18em] short:tracking-[0.1em]">
              {CHECKS(farSide).map(([k, v], i) => (
                <li key={k} className={`flex justify-between gap-4 transition-opacity duration-300 ${i < checks ? "opacity-100" : "opacity-25"}`} data-testid="ascent-check">
                  <span className="text-zinc-400">{k}</span>
                  <span className={farSide && k === "EARTH LINK" ? "text-[#9fb6cc]" : "text-white"}>{i < checks ? v : "…"}</span>
                </li>
              ))}
            </ul>
            <div className="mt-2 short:mt-1 font-mono text-[9px] short:text-[7px] tracking-[0.15em] short:tracking-[0.08em] text-zinc-500">THE DESCENT STAGE STAYS ON THE MOON AS THE LAUNCH PAD.</div>
            <button
              type="button"
              onClick={initiate}
              disabled={checks < 5}
              data-testid="ascent-initiate"
              className="mt-4 short:mt-2 w-full min-h-[52px] short:min-h-[46px] font-mono text-[12px] short:text-[11px] tracking-[0.35em] short:tracking-[0.2em] text-white bg-[#FF3B00]/90 hover:bg-[#FF3B00] active:bg-[#d93200] border border-[#FF3B00] disabled:opacity-40 touch-manipulation"
            >
              INITIATE LUNAR ASCENT
            </button>
          </div>
        </div>
      )}

      {/* Countdown */}
      {stage === "countdown" && left != null && (
        <div className="absolute inset-0 z-30 flex flex-col items-center justify-center pointer-events-none" data-testid="ascent-countdown">
          <div className="font-mono text-[10px] tracking-[0.4em] text-[#FF3B00]">● ASCENT · {left > 5 ? "SYSTEMS GO" : "COUNTDOWN"}</div>
          <div className="font-display font-black text-white text-7xl short:text-6xl mt-1 tabular">{left > 5 ? "GO" : left}</div>
        </div>
      )}

      {/* Liftoff telemetry (from the trajectory the scene flies) */}
      {stage === "liftoff" && (
        <div className="absolute top-16 short:top-[var(--hud-top)] left-6 md:left-10 safe-ml z-30 pointer-events-none bg-black/45 backdrop-blur-sm border-l-2 border-[#FF3B00] px-3 py-2 font-mono" data-testid="ascent-telemetry">
          <div className="text-[9px] tracking-[0.4em] text-[#FF3B00]">● LUNAR ASCENT · T+{Math.max(0, c.t).toFixed(0).padStart(2, "0")} s</div>
          <div className="text-white text-[12px] short:text-[11px] tracking-[0.2em] mt-0.5" data-testid="ascent-phase">{phase}</div>
          <div className="mt-1 grid grid-cols-3 gap-x-4 text-[10px] tracking-[0.15em] text-zinc-300 tabular">
            <span>ALT <span className="text-white" data-testid="ascent-alt">{c.alt.toFixed(0)}</span> m</span>
            <span>V/S <span className="text-white">{c.vy.toFixed(1)}</span></span>
            <span>H/S <span className="text-white">{c.vx.toFixed(1)}</span></span>
          </div>
        </div>
      )}
      {stage === "liftoff" && (
        <button
          type="button"
          onClick={finish}
          data-testid="ascent-skip"
          className="absolute bottom-6 short:bottom-2 right-6 md:right-10 safe-mr safe-mb z-30 font-mono text-[10px] tracking-[0.3em] text-zinc-400 hover:text-white px-3 py-2 touch:min-h-[44px] touch:px-4 bg-black/30 border border-white/10"
        >
          SKIP CINEMATIC ›
        </button>
      )}
      {farSide && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-30 pointer-events-none font-mono text-[9px] tracking-[0.3em] text-[#9fb6cc] bg-black/40 border border-[#9fb6cc]/40 px-2 py-1 whitespace-nowrap" data-testid="earth-link">
          ○ EARTH LINK UNAVAILABLE
        </div>
      )}
    </div>
  );
}
