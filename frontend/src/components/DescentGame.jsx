import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { PerformanceMonitor } from "@react-three/drei";
import { useRef, useState, useEffect, useMemo, useCallback, Suspense } from "react";
import * as THREE from "three";
import { LanderRig, RegolithSheet, GroundMarks, createTouchdownFx } from "@/components/scenes/TouchdownFx";
import { SiteTerrain, SiteRocks, SiteSky, SiteSun, SiteMarkers, LandingPoint } from "@/components/scenes/LunarSite";
import HoldButton from "@/components/HoldButton";
import { useCompact } from "@/hooks/useMediaQuery";
import { solveDistance } from "@/lib/cameraFraming";
import CockpitOverlay from "@/components/CockpitOverlay";
import AbortModal from "@/components/AbortModal";
import { DIFFICULTY } from "@/data/landingPhysics";
import { getSite, siteStart, MISSION_SITE_ID } from "@/data/landingSites";
import { buildTerrain } from "@/data/terrainMesh";
import {
  assessDescent,
  profileLabel,
  guidanceFor,
  predictTouchdownX,
  nominalDescent,
  OK,
  CAUTION,
  DANGER,
} from "@/data/descentProfile";
import { stepFrame, gradeTouchdown, CONTACT_ALT } from "@/data/landerSim";
import { LM, RESULT_DELAY, SHOT, WORLD_X, contactLit, touchdownCamera, touchdownPlan } from "@/data/touchdownFx";
import CoachCard from "@/components/training/CoachCard";
import { createDescentMonitor } from "@/audio/descentComms";
import { VERBOSITY } from "@/audio/commsDirector";
import {
  ArrowUp, ArrowDown, ArrowLeft, ArrowRight,
  Pause, Play, X,
} from "lucide-react";

/* ============================================================
 * 3D scene layer
 * ============================================================
 * The landing site itself (terrain, rocks, sky, Sun, landing zones, unsafe
 * ground and the landing point designator) is drawn by scenes/LunarSite from
 * the same site data the physics flies (data/landingSites). Physics metres
 * map to scene units at WORLD_X horizontally and through the site's vertical
 * scale (true proportion near the ground).
 */

/** Projected path to the LPD along the recommended descent: a faint dashed
 * arc from the lander to the touchdown point, so the trajectory stays readable
 * when the close chase camera cannot hold the LPD itself in frame. */
function TouchdownPath({ physRef, view, cfg, site, predict }) {
  const N = 40;
  const line = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array(N * 3), 3));
    const m = new THREE.LineDashedMaterial({ color: "#FFDD00", dashSize: 0.5, gapSize: 0.4, transparent: true, opacity: 0, depthWrite: false });
    const l = new THREE.Line(g, m);
    l.frustumCulled = false;
    l.renderOrder = 2;
    return l;
  }, []);
  useEffect(() => () => {
    line.geometry.dispose();
    line.material.dispose();
  }, [line]);
  useFrame(() => {
    const p = physRef.current;
    if (!p) return;
    line.visible = view !== "COCKPIT" && p.alt > 3;
    if (!line.visible) return;
    // down to the ground at the predicted touchdown point (landingSites contact)
    const g = site.contactGround(predict(p));
    const path = nominalDescent(Math.max(0, p.y - g - CONTACT_ALT), -p.vy, cfg, N - 1);
    const a = line.geometry.attributes.position.array;
    for (let i = 0; i < N; i++) {
      const [t, h] = path[i];
      a[i * 3] = (p.xPos + p.vx * t) * WORLD_X;
      a[i * 3 + 1] = site.scale.y(g + h + (i < N - 1 ? CONTACT_ALT : 0));
      a[i * 3 + 2] = 0;
    }
    line.geometry.attributes.position.needsUpdate = true;
    line.computeLineDistances();
    line.material.opacity = Math.max(0, Math.min(0.5, (800 - p.alt) / 400));
  });
  return <primitive object={line} />;
}

// LanderModel origin to footpad bottom: the pads, not the descent stage, meet
// the surface at altitude 0. The LM itself (legs, probes, settle) is drawn by
// LanderRig from data/touchdownFx.
const LANDER_FOOT = LM.foot;

/* ------------------------------------------------------------------
 * Descent camera. The HUD reports the screen rectangle it leaves
 * unobstructed (clearRef, CSS px) and a view offset moves the image centre
 * into it. Motion is exponentially smoothed so it never jumps.
 *
 * EXTERNAL is a pilot's chase view: the lander is sized first, at roughly
 * 15–22 % of the clear area's height, measured at the lander's own depth
 * (raised from 12–18 % after the first iPhone tests, for readability).
 * Within that zoom budget the camera leans towards
 * the projected touchdown point (LPD), so the immediate trajectory stays in
 * view, and brings the primary LZ in once it fits. A distant LZ never pulls
 * the camera back; the edge indicator points to it instead.
 * NAV is the top-down map and frames the lander, LPD and LZ together.
 * ------------------------------------------------------------------ */
// chase: behind the LM along its direction of flight (dir +1: flying towards +x), to the left, looking down
const extDirFor = (dir) => new THREE.Vector3(-11 * dir, 8, 12).normalize();
const NAV_DIR = new THREE.Vector3(0, 1, 0.0001).normalize(); // top-down map
const NAV_MIN = 30;
const NAV_MAX = 120;
const FRAME_MARGIN = 0.82;
// Lander height in scene units (footpads to antenna, 7 m at true scale).
const LANDER_H = LM.height;
// The camera never goes closer than this to the terrain (scene units).
const CAMERA_CLEARANCE = 1.2;
// Share of the clear area's height the lander occupies: closest / furthest
// (nominal, for a vertical view; the oblique chase view reads ~8 % smaller).
const LANDER_FRAC_NEAR = 0.225;
const LANDER_FRAC_FAR = 0.175;
const _q = new THREE.Vector3();
const _c = new THREE.Vector3();
const _v = new THREE.Vector3();
const _box = new THREE.Box3();

// Place an edge chip on the clear rectangle's border, in the direction of the
// screen point s (CSS px), its arrow rotated to point at it.
function placeEdgeChip(el, s, cr, halfW) {
  const cx = (cr.x0 + cr.x1) / 2;
  const cy = (cr.y0 + cr.y1) / 2;
  const dx = s.z < 1 ? s.x - cx : -(s.x - cx);
  const dy = s.z < 1 ? s.y - cy : -(s.y - cy);
  const sx = dx !== 0 ? (cr.x1 - cr.x0) / 2 - 34 : Infinity;
  const sy = dy !== 0 ? (cr.y1 - cr.y0) / 2 - 18 : Infinity;
  const k = Math.min(Math.abs(sx / (dx || 1e-6)), Math.abs(sy / (dy || 1e-6)));
  // Keep the whole chip inside the visibility area.
  const ex = THREE.MathUtils.clamp(cx + dx * k, cr.x0 + halfW, cr.x1 - halfW);
  const ey = THREE.MathUtils.clamp(cy + dy * k, cr.y0 + 14, cr.y1 - 14);
  el.style.display = "flex";
  el.style.transform = `translate(${ex}px, ${ey}px) translate(-50%, -50%)`;
  const arrow = el.firstChild;
  if (arrow) arrow.style.transform = `rotate(${Math.atan2(dy, dx)}rad)`;
  return { x: ex, y: ey };
}

const insideRect = (s, cr, pad) => s.z < 1 && s.x > cr.x0 + pad && s.x < cr.x1 - pad && s.y > cr.y0 + pad && s.y < cr.y1 - pad;

function DescentCamera({ physRef, cfg, view, clearRef, lzIndicatorRef, lpdIndicatorRef, fx, site, predict }) {
  const { camera, size } = useThree();
  const EXT_DIR = useMemo(() => extDirFor(site.approach.dir), [site]);
  const terrain = useMemo(() => buildTerrain(site), [site]);
  // keep the camera above the drawn ground
  const clampToGround = () => {
    const gy = site.scale.y(terrain.lookup(camera.position.x / WORLD_X, camera.position.z / WORLD_X)) + CAMERA_CLEARANCE;
    if (camera.position.y < gy) camera.position.y = gy;
  };
  const pos = useRef(null);
  const shot = useRef(null); // the post-touchdown shot, once started
  const lastCentre = useRef(null); // principal point last used (CSS px)
  const look = useRef(new THREE.Vector3());
  const includeLz = useRef(true);
  const keepLz = useRef(true);
  const pts = useMemo(
    () => ({
      lander: { pos: new THREE.Vector3(), rad: 2.8 },
      lpd: { pos: new THREE.Vector3(), rad: 2.6 },
      lean: { pos: new THREE.Vector3(), rad: 2.6 },
      lz: { pos: new THREE.Vector3(0, 0, 0), rad: 3.6 },
      sol: { ctr: new THREE.Vector3(), dist: 0 },
    }),
    []
  );

  useFrame((state, delta) => {
    if (!physRef.current) return;
    const p = physRef.current;
    const W = size.width;
    const H = size.height;
    const c = clearRef.current;
    const cr = c && c.x1 - c.x0 > 80 && c.y1 - c.y0 > 80 ? c : { x0: 0, y0: 0, x1: W, y1: H };
    const lx = p.xPos * WORLD_X;
    // The LM as drawn (the site's vertical scale, settle after touchdown).
    const ly = fx.padY;
    const k = 1 - Math.exp(-delta * 2.2);

    // After a landing (EXTERNAL view): one slow crane down and in to a low
    // three-quarter view of the LM resting on the surface (data/touchdownFx SHOT).
    if (view === "EXTERNAL" && fx.touchAt != null && fx.plan && !fx.plan.crashed && pos.current) {
      if (!shot.current) {
        const lc = lastCentre.current || { x: W / 2, y: H / 2 };
        shot.current = { from: { pos: pos.current.toArray(), look: look.current.toArray() }, cx: lc.x, cy: lc.y };
      }
      const sh = touchdownCamera(state.clock.elapsedTime - fx.touchAt, shot.current.from, [fx.x, fx.groundY, 0], SHOT.swing * site.approach.dir);
      pos.current.set(sh.pos[0], sh.pos[1], sh.pos[2]);
      look.current.set(sh.look[0], sh.look[1], sh.look[2]);
      camera.position.copy(pos.current);
      clampToGround();
      camera.lookAt(look.current);
      // The HUD fades away during the shot, so the picture recentres with it.
      const cx = shot.current.cx + (W / 2 - shot.current.cx) * sh.k;
      const cy = shot.current.cy + (H / 2 - shot.current.cy) * sh.k;
      camera.setViewOffset(W, H, W / 2 - cx, H / 2 - cy, W, H);
      camera.updateMatrixWorld();
      if (lzIndicatorRef.current) lzIndicatorRef.current.style.display = "none";
      if (lpdIndicatorRef.current) lpdIndicatorRef.current.style.display = "none";
      if (window.__lvDescentView) window.__lvDescentView.shot = sh.k;
      return;
    }

    if (view === "COCKPIT") {
      camera.clearViewOffset();
      _v.set(lx, ly + LANDER_FOOT + 1.5, 0);
      if (!pos.current) pos.current = _v.clone();
      pos.current.lerp(_v, Math.min(1, delta * 3));
      look.current.lerp(_c.set(lx + 6 * site.approach.dir, Math.max(fx.groundY, ly - 8), 0), Math.min(1, delta * 3));
      camera.position.copy(pos.current);
      camera.lookAt(look.current);
      if (lzIndicatorRef.current) lzIndicatorRef.current.style.display = "none";
      if (lpdIndicatorRef.current) lpdIndicatorRef.current.style.display = "none";
      window.__lvDescentView = null;
      return;
    }

    // Points of interest
    pts.lander.pos.set(lx, ly + LANDER_H / 2, 0);
    const xPred = predict(p);
    pts.lpd.pos.set(xPred * WORLD_X, site.scale.y(site.contactGround(xPred)), 0);
    const nav = view === "NAV";
    const dir = nav ? NAV_DIR : EXT_DIR;
    const tanHalf = Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
    const tanClearV = tanHalf * ((cr.y1 - cr.y0) / H);
    const tanV = tanClearV * FRAME_MARGIN;
    const tanH = tanHalf * ((cr.x1 - cr.x0) / H) * FRAME_MARGIN;
    const sol = pts.sol;
    // Camera distance (and centre, in sol) that frames `list` in the clear area.
    const frame = (list) => {
      _box.makeEmpty();
      list.forEach((q) => _box.expandByPoint(q.pos));
      _box.getCenter(sol.ctr);
      sol.dist = solveDistance(list, sol.ctr, dir, tanH, tanV);
      return sol.dist;
    };
    let dist;
    if (nav) {
      const withLz = frame([pts.lander, pts.lpd, pts.lz]);
      // Hysteresis so the LZ does not flicker in and out of the framing.
      if (includeLz.current && withLz > NAV_MAX * 1.12) includeLz.current = false;
      else if (!includeLz.current && withLz < NAV_MAX) includeLz.current = true;
      if (!includeLz.current) frame([pts.lander, pts.lpd]);
      dist = THREE.MathUtils.clamp(sol.dist, NAV_MIN, NAV_MAX);
    } else {
      // Distances from the camera to the lander that give it the near / far
      // screen share. The camera sits at ctr + dir * dist, so the lander's own
      // depth is dist - off, with off its offset from the framing centre.
      const dNear = LANDER_H / (2 * LANDER_FRAC_NEAR * tanClearV);
      const dFar = LANDER_H / (2 * LANDER_FRAC_FAR * tanClearV);
      const off = () => _q.copy(pts.lander.pos).sub(sol.ctr).dot(dir);
      const budget = () => dFar + off(); // furthest camera distance for sol.ctr
      // Priorities: the lander, then a nearby primary LZ, then as much of the
      // way to the touchdown point as the budget allows. Hysteresis keeps the
      // LZ from flickering in and out of the framing.
      const ratio = (list) => frame(list) / budget();
      const all = ratio([pts.lander, pts.lpd, pts.lz]);
      if (includeLz.current && all > 1.08) includeLz.current = false;
      else if (!includeLz.current && all < 0.95) includeLz.current = true;
      if (!includeLz.current) {
        const near = ratio([pts.lander, pts.lz]);
        if (keepLz.current && near > 1.08) keepLz.current = false;
        else if (!keepLz.current && near < 0.95) keepLz.current = true;
        const base = keepLz.current ? [pts.lander, pts.lz] : [pts.lander];
        if (frame([...base, pts.lpd]) > budget()) {
          // Lean towards the LPD as far as the zoom budget allows (bisection
          // on the fraction of the way from the lander to the LPD).
          let lo = 0;
          let hi = 1;
          for (let i = 0; i < 10; i++) {
            const t = (lo + hi) / 2;
            pts.lean.pos.lerpVectors(pts.lander.pos, pts.lpd.pos, t);
            if (frame([...base, pts.lean]) > budget()) hi = t;
            else lo = t;
          }
          pts.lean.pos.lerpVectors(pts.lander.pos, pts.lpd.pos, lo);
          frame([...base, pts.lean]);
        }
      }
      dist = THREE.MathUtils.clamp(sol.dist, dNear + off(), budget());
    }
    _v.copy(dir).multiplyScalar(dist).add(sol.ctr);
    if (!pos.current) {
      pos.current = _v.clone();
      look.current.copy(sol.ctr);
    } else {
      pos.current.lerp(_v, k);
      look.current.lerp(sol.ctr, k);
    }
    camera.position.copy(pos.current);
    clampToGround();
    camera.lookAt(look.current);
    // A failed landing: one short, restrained jolt of the camera.
    if (fx.touchAt != null && fx.plan && fx.plan.crashed) {
      const t = state.clock.elapsedTime - fx.touchAt;
      const a = 0.14 * Math.exp(-t / 0.18) * (t >= 0 ? 1 : 0);
      camera.position.x += a * Math.sin(t * 61);
      camera.position.y += a * Math.sin(t * 47 + 1.3);
    }
    // Shift the principal point into the clear rectangle's centre.
    const cx = (cr.x0 + cr.x1) / 2;
    const cy = (cr.y0 + cr.y1) / 2;
    lastCentre.current = { x: cx, y: cy };
    camera.setViewOffset(W, H, W / 2 - cx, H / 2 - cy, W, H);
    camera.updateMatrixWorld();

    // Screen positions (CSS px) for the edge indicators and validation tooling.
    const project = (v3) => {
      _q.copy(v3).project(camera);
      return { x: (_q.x * 0.5 + 0.5) * W, y: (-_q.y * 0.5 + 0.5) * H, z: _q.z };
    };
    const sLz = project(pts.lz.pos);
    const sLpd = project(pts.lpd.pos);
    const lpdShown = p.alt > 3 && p.alt < 800;
    window.__lvDescentView = {
      lander: project(pts.lander.pos),
      lpd: { ...sLpd, visible: lpdShown },
      lz: sLz,
      landerBox: { y0: project(_c.set(lx, ly + LANDER_H, 0)).y, y1: project(_c.set(lx, ly, 0)).y },
      camDist: +pos.current.distanceTo(look.current).toFixed(2),
      clear: { ...cr },
      x: p.xPos, // physics metres from the primary LZ (validation tooling)
    };
    // Off-frame primary LZ and projected touchdown: chips on the clear area's edge.
    let lzChip = null;
    const el = lzIndicatorRef.current;
    if (el) {
      if (insideRect(sLz, cr, 8) || p.alt <= 0.5) el.style.display = "none";
      else lzChip = placeEdgeChip(el, sLz, cr, 66);
    }
    const tel = lpdIndicatorRef.current;
    if (tel) {
      if (!lpdShown || insideRect(sLpd, cr, 8)) tel.style.display = "none";
      else {
        const at = placeEdgeChip(tel, sLpd, cr, 48);
        // Never stack on the LZ chip: step clear of it vertically.
        if (lzChip && Math.abs(at.y - lzChip.y) < 22 && Math.abs(at.x - lzChip.x) < 120) {
          const y = at.y + (at.y <= lzChip.y ? -24 : 24);
          tel.style.transform = `translate(${at.x}px, ${y}px) translate(-50%, -50%)`;
        }
      }
    }
  });
  return null;
}

/* ============================================================
 * HUD components (JSX, not R3F)
 * ============================================================ */

function Gauge({ label, value, unit, warn = false, danger = false, testId }) {
  const color = danger ? "text-[#FF3B00]" : warn ? "text-amber-400" : "text-white";
  return (
    <div className="flex flex-col gap-0.5" data-testid={testId}>
      <span className="font-mono text-[9px] tracking-[0.22em] text-zinc-500 uppercase">
        {label}
      </span>
      <div className="flex items-baseline gap-1.5">
        <span className={`font-mono tabular text-lg md:text-xl short:text-base font-medium ${color} ${danger ? "blink" : ""}`}>
          {value}
        </span>
        {unit && <span className="font-mono text-[10px] text-zinc-500">{unit}</span>}
      </div>
    </div>
  );
}

function Bar({ value, warn = false, danger = false }) {
  const color = danger ? "bg-[#FF3B00]" : warn ? "bg-amber-400" : "bg-white";
  return (
    <div className="h-1.5 bg-white/10 relative overflow-hidden">
      <div
        className={`absolute inset-y-0 left-0 ${color} transition-[width] duration-150`}
        style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }}
      />
    </div>
  );
}

/* ------------------------------------------------------------------
 * Compact HUD for landscape phones. Telemetry is one slim panel on the lower
 * left; all flight controls (tilt, RCS, throttle) form one cluster in the
 * lower-right corner, within reach of the right thumb and multi-touch capable.
 * Everything between them, under the slim top band, is the protected gameplay
 * area that the descent camera frames into.
 * ------------------------------------------------------------------ */
const PAD_BTN = "border border-white/30 bg-black/30 flex items-center justify-center text-white font-mono";

function CompactRow({ label, value, unit, tone = "text-white", testId, big = false }) {
  return (
    <div className="flex items-baseline justify-between gap-2" data-testid={testId}>
      <span className="font-mono text-[8px] tracking-[0.2em] text-zinc-400">{label}</span>
      <span className="flex items-baseline gap-1">
        <span className={`font-mono tabular ${big ? "text-[17px]" : "text-[13px]"} font-medium ${tone}`}>{value}</span>
        {unit && <span className="font-mono text-[8px] text-zinc-500">{unit}</span>}
      </span>
    </div>
  );
}

function BarRow({ label, value, text, warn = false, danger = false, active = false, testId }) {
  const color = danger ? "bg-[#FF3B00]" : warn ? "bg-amber-400" : active ? "bg-[#FF3B00]" : "bg-white";
  return (
    <div className="flex items-center gap-1.5" data-testid={testId}>
      <span className="font-mono text-[8px] tracking-[0.15em] text-zinc-400 w-7">{label}</span>
      <span className="flex-1 h-1 bg-white/10 relative overflow-hidden">
        <span className={`absolute inset-y-0 left-0 ${color}`} style={{ width: `${Math.max(0, Math.min(100, value * 100))}%` }} />
      </span>
      <span className={`font-mono tabular text-[11px] w-8 text-right ${tone(warn, danger, false)}`}>{text}</span>
    </div>
  );
}

const tone = (warn, danger, blink = true) => (danger ? `text-[#FF3B00] ${blink ? "blink" : ""}` : warn ? "text-amber-400" : "text-white");

/* ------------------------------------------------------------------
 * Guidance readouts, all from assessDescent (descentProfile):
 *  TGT V/S  recommended descent-rate band at this altitude
 *  BRAKE    countdown to the latest prudent braking burn while coasting;
 *           spare height over a full-thrust stop once braking
 *  RESERVE  seconds of hover the tank holds beyond the least fuel that can
 *           still land from here
 * ------------------------------------------------------------------ */
const fmtRate = (v) => (v < 9.95 ? v.toFixed(1) : v.toFixed(0));

function guidanceReadouts(profile, vy) {
  const rate = Math.max(0, -vy);
  const env = profile.envelope;
  const tgt = {
    text: `−${fmtRate(env.lo)}…−${fmtRate(env.hi)}`,
    cls: rate > env.hi ? (profile.vyState === DANGER ? "text-[#FF3B00]" : "text-amber-400") : rate >= env.lo ? "text-emerald-400" : "text-zinc-300",
  };
  let brake;
  if (profile.brakeTime <= 12) {
    const now = profile.brakeTime < 0.05;
    brake = {
      text: now ? "NOW" : `IN ${Math.ceil(profile.brakeTime)} s`,
      cls: now ? "text-[#FF3B00] blink" : profile.brakeTime < 3 ? "text-amber-400" : "text-white",
    };
  } else {
    const m = profile.margin;
    brake = {
      text: `${m >= 0 ? "+" : "−"}${Math.abs(m) >= 10 ? Math.round(Math.abs(m)) : Math.abs(m).toFixed(1)} m`,
      cls: profile.vyState === DANGER && m < 0 ? "text-[#FF3B00] blink" : m < 0 ? "text-amber-400" : "text-white",
    };
  }
  const r = profile.reserve;
  const reserve = {
    text: r < 0 ? "BINGO" : `${Math.round(r)} s`,
    cls: r < 3 ? "text-[#FF3B00] blink" : r < 10 ? "text-amber-400" : "text-white",
  };
  return { tgt, brake, reserve };
}

function GuideRow({ label, value, testId }) {
  return (
    <div className="flex items-baseline justify-between gap-2" data-testid={testId}>
      <span className="font-mono text-[8px] tracking-[0.2em] text-zinc-400">{label}</span>
      <span className={`font-mono tabular text-[11px] ${value.cls}`}>{value.text}</span>
    </div>
  );
}

const guidanceTone = (g) => (g.level === DANGER ? "text-[#FF3B00]" : g.level === OK ? "text-zinc-300" : "text-amber-400");

/**
 * Touchdown annunciators, lit like the LM's panel lamps: CONTACT LIGHT (blue)
 * when a probe reaches the surface, ENGINE STOP when the descent engine is
 * shut down at touchdown. Steady, not blinking: they report, they don't alarm.
 */
function Lamps({ contact, engineStop, small = false }) {
  const base = `font-mono tracking-widest border px-2 lamp-on ${small ? "py-0.5 text-[9px]" : "py-1 text-[10px]"}`;
  return (
    <>
      {contact && (
        <div data-testid="warn-contact" className={`${base} bg-[#06223d]/85 border-[#6cc0ff]/80 text-[#d6eeff] shadow-[0_0_14px_rgba(108,192,255,0.6)]`}>
          ● CONTACT LIGHT
        </div>
      )}
      {engineStop && (
        <div data-testid="lamp-engine-stop" className={`${base} bg-[#2e2206]/85 border-amber-200/80 text-amber-50 shadow-[0_0_12px_rgba(253,230,138,0.45)]`}>
          ● ENGINE STOP
        </div>
      )}
    </>
  );
}

function CompactDescentHud({
  cfg, alt, vy, vx, tilt, fuel, fuelPct, throttle, throttleCmd, setThrottleCmd, inputRef,
  view, setView, paused, setPaused, setShowAbort, chip, guidance, distanceToLZ,
  projectedZoneLabel, projectedHazard, contactLight, engineStop = false, hudFade = false, flags, readouts, tip,
}) {
  const { warnFuelLow, dangerFuelCritical, warnVy, dangerVy, warnVx, dangerVx, warnTilt, dangerTilt } = flags;
  const chipTone = chip.level === DANGER ? "text-[#FF3B00]" : chip.level === CAUTION ? "text-amber-400" : "text-emerald-400";
  const warnings = [
    warnFuelLow && { id: "warn-fuel", text: "FUEL LOW", danger: dangerFuelCritical },
    warnVy && { id: "warn-descent", text: dangerVy ? "DESCENT RATE CRITICAL" : "DESCENT RATE HIGH", danger: dangerVy },
    warnVx && { id: "warn-lateral", text: dangerVx ? "LATERAL DRIFT EXCESSIVE" : "LATERAL DRIFT", danger: dangerVx },
    dangerTilt && { id: "warn-tilt", text: "TILT EXCEEDS LIMIT", danger: true },
    projectedHazard && alt > 5 && { id: "warn-terrain", text: "TERRAIN AHEAD — DIVERT", danger: true },
  ].filter(Boolean);
  return (
    <>
      {/* Top band: profile, camera, pause / abort */}
      <div
        data-hud-block="top"
        data-hud-reserve="26"
        className="absolute top-2 left-3 right-3 safe-ml safe-mr z-40 flex items-start justify-between gap-2 pointer-events-none"
      >
        <div className="pointer-events-auto bg-black/45 backdrop-blur-sm border border-white/10 px-2.5 py-1 w-[176px]" data-testid="descent-profile">
          <div className="font-mono text-[8px] tracking-[0.25em] text-zinc-500">LM-1 · {cfg.label}</div>
          <div className={`font-mono text-[10px] tracking-widest ${chipTone}`}>{chip.text}</div>
          <div className="font-mono text-[8px] tracking-widest h-3 truncate" data-testid="descent-guidance">
            {guidance && <span className={guidanceTone(guidance)}>{guidance.text}</span>}
          </div>
        </div>
        <div className="pointer-events-auto bg-black/45 backdrop-blur-sm border border-white/10 flex" data-testid="view-selector">
          {["EXTERNAL", "COCKPIT", "NAV"].map((v) => (
            <button
              key={v}
              type="button"
              onClick={() => setView(v)}
              data-testid={`view-${v.toLowerCase()}`}
              className={`touch-ctrl h-11 px-2.5 font-mono text-[9px] tracking-[0.2em] ${view === v ? "bg-[#FF3B00] text-black" : "text-zinc-300"}`}
            >
              {v}
            </button>
          ))}
        </div>
        <div className="pointer-events-auto flex gap-2">
          <button
            type="button"
            onClick={() => setPaused((p) => !p)}
            data-testid="descent-pause"
            aria-label={paused ? "Resume" : "Pause"}
            className="touch-ctrl w-11 h-11 bg-black/45 backdrop-blur-sm border border-white/15 flex items-center justify-center text-zinc-200"
          >
            {paused ? <Play size={14} /> : <Pause size={14} />}
          </button>
          <button
            type="button"
            onClick={() => setShowAbort(true)}
            data-testid="descent-abort"
            className="touch-ctrl h-11 px-3 bg-black/45 backdrop-blur-sm border border-white/15 flex items-center gap-1.5 text-zinc-300 font-mono text-[9px] tracking-[0.25em]"
          >
            <X size={12} /> ABORT
          </button>
        </div>
      </div>

      {/* Warnings: one slim row inside the reserved strip under the top band */}
      <div className="absolute top-[3.55rem] left-1/2 -translate-x-1/2 z-40 flex gap-1.5 whitespace-nowrap pointer-events-none">
        <Lamps contact={contactLight} engineStop={engineStop} small />
        {!engineStop && warnings.map((w) => (
          <div
            key={w.id}
            data-testid={w.id}
            className={`bg-black/55 border border-white/10 px-2 py-0.5 font-mono text-[9px] tracking-widest ${w.danger ? "text-[#FF3B00] blink" : "text-amber-400"}`}
          >
            ● {w.text}
          </div>
        ))}
      </div>

      {/* Lower left: telemetry */}
      <div
        data-hud-block="left"
        data-testid="descent-hud-left"
        className="absolute bottom-2 left-3 safe-mb safe-ml z-30 w-[132px] bg-black/40 backdrop-blur-sm border border-white/10 px-2 py-1.5 space-y-px transition-opacity duration-700"
        style={hudFade ? { opacity: 0, pointerEvents: "none" } : undefined}
      >
        <CoachCard tip={tip} className="-mx-2 -mt-1.5 mb-1" />
        <CompactRow label="ALT" value={alt.toFixed(0)} unit="m" big testId="gauge-altitude" />
        <CompactRow label="V/S" value={vy.toFixed(1)} unit="m/s" tone={tone(warnVy, dangerVy)} testId="gauge-vspeed" />
        <GuideRow label="TGT V/S" value={readouts.tgt} testId="guide-target" />
        <GuideRow label="BRAKE" value={readouts.brake} testId="guide-brake" />
        <CompactRow label="H/S" value={vx.toFixed(1)} unit="m/s" tone={tone(warnVx, dangerVx)} testId="gauge-hspeed" />
        <CompactRow label="TILT" value={tilt.toFixed(0) + "°"} tone={tone(warnTilt, dangerTilt)} testId="gauge-tilt" />
        <BarRow label="FUEL" value={fuel / cfg.initialFuel} text={`${fuelPct.toFixed(0)}%`} warn={warnFuelLow} danger={dangerFuelCritical} testId="gauge-fuel" />
        <GuideRow label="RESERVE" value={readouts.reserve} testId="guide-reserve" />
        <BarRow label="THR" value={throttle} text={`${(throttle * 100).toFixed(0)}%`} active={throttleCmd} testId="gauge-throttle" />
        <div className="pt-0.5 border-t border-white/10 font-mono text-[8px] tracking-[0.15em] text-zinc-400">
          <div className="flex items-baseline justify-between">
            <span>TO LZ</span>
            <span className="whitespace-nowrap"><span className="text-[12px] text-white tabular" data-testid="lz-distance">{distanceToLZ.toFixed(0)}</span> <span className="text-zinc-500">m</span></span>
          </div>
          <div className={`text-[8px] tracking-[0.12em] truncate ${projectedHazard ? "text-[#FF3B00] blink" : "text-zinc-200"}`} data-testid="projected-lz" title="Projected touchdown">
            ▾ {projectedZoneLabel}
          </div>
        </div>
      </div>

      {/* Lower right: one flight-control cluster (tilt + RCS pairs, throttle at the edge) */}
      <div
        data-hud-block="right"
        data-testid="descent-controls"
        className="absolute bottom-2 right-3 safe-mb safe-mr z-30 flex gap-1.5 transition-opacity duration-700"
        style={hudFade ? { opacity: 0, pointerEvents: "none" } : undefined}
      >
        <div className="grid grid-cols-2 gap-1.5">
          <HoldButton onHold={(on) => (inputRef.current.left = on)} data-testid="ctrl-left" aria-label="Tilt left" className={`${PAD_BTN} w-[50px] h-[46px] flex-col text-[7px] tracking-[0.2em] text-zinc-300`}>
            <ArrowLeft size={16} className="text-white" />TILT
          </HoldButton>
          <HoldButton onHold={(on) => (inputRef.current.right = on)} data-testid="ctrl-right" aria-label="Tilt right" className={`${PAD_BTN} w-[50px] h-[46px] flex-col text-[7px] tracking-[0.2em] text-zinc-300`}>
            <ArrowRight size={16} className="text-white" />TILT
          </HoldButton>
          <HoldButton onHold={(on) => (inputRef.current.strafeLeft = on)} data-testid="ctrl-strafe-left" aria-label="RCS strafe left" className={`${PAD_BTN} w-[50px] h-[46px] text-[9px] text-zinc-200`}>
            ◄ RCS
          </HoldButton>
          <HoldButton onHold={(on) => (inputRef.current.strafeRight = on)} data-testid="ctrl-strafe-right" aria-label="RCS strafe right" className={`${PAD_BTN} w-[50px] h-[46px] text-[9px] text-zinc-200`}>
            RCS ►
          </HoldButton>
        </div>
        <HoldButton
          onHold={(on) => { inputRef.current.throttle = on; setThrottleCmd(on); }}
          data-testid="ctrl-throttle"
          aria-label="Throttle"
          className={`${PAD_BTN} relative w-[58px] overflow-hidden flex-col gap-1`}
        >
          <span className="absolute inset-x-0 bottom-0 bg-[#FF3B00]/35 pointer-events-none" style={{ height: `${Math.round(throttle * 100)}%` }} />
          <ArrowUp size={18} className="relative" />
          <span className="relative text-[8px] tracking-[0.2em]">THR</span>
          <span className={`relative text-[10px] tabular ${throttleCmd ? "text-white font-semibold" : "text-zinc-300"}`} data-testid="throttle-cmd">{(throttle * 100).toFixed(0)}%</span>
        </HoldButton>
      </div>
    </>
  );
}

/* ============================================================
 * Main DescentGame component
 * ============================================================ */

/**
 * Props:
 *  - difficulty: DIFFICULTY key
 *  - audio: useMissionAudio() instance (optional)
 *  - onSuccess(result), onCrash(result), onAbort()
 *  - init: optional flight-state override for the Training Center (alt, vy,
 *    vx, xPos, fuel). The vehicle, limits and grading stay the difficulty's.
 *  - site: landing site id (data/landingSites); the mission's own by default.
 *  - coach(d): optional Training Center instructor; returns a line or null.
 *  - holdSeconds: optional "starts in" hold before the physics runs (training).
 */
export default function DescentGame({ difficulty = "ASTRONAUT", audio, onSuccess, onCrash, onAbort, init = null, site: siteId = MISSION_SITE_ID, coach = null, holdSeconds = 0 }) {
  const cfg = DIFFICULTY[difficulty] || DIFFICULTY.ASTRONAUT;
  const site = useMemo(() => getSite(siteId), [siteId]);
  // Projected touchdown point over the site's terrain (descentProfile).
  const predict = useCallback((p) => predictTouchdownX(p, cfg, site), [cfg, site]);
  // Physics state, created once: the site's mission start or a training start.
  const startRef = useRef(null);
  // window.__lvDescentInit: validation tooling only (start the final approach at a set state).
  if (!startRef.current) {
    const tool = (typeof window !== "undefined" && window.__lvDescentInit) || null;
    startRef.current = siteStart(site, cfg, init || tool ? { ...(init || {}), ...(tool || {}) } : null);
  }
  const start = startRef.current;

  const [alt, setAlt] = useState(start.alt);
  const [vy, setVy] = useState(start.vy);
  const [vx, setVx] = useState(start.vx);
  const [xPos, setXPos] = useState(start.xPos);
  const [tilt, setTilt] = useState(0);
  const [throttle, setThrottle] = useState(start.throttle || 0);
  const [fuel, setFuel] = useState(start.fuel);
  const holdRef = useRef(holdSeconds);
  const [holdLeft, setHoldLeft] = useState(Math.ceil(holdSeconds));
  // Phase 2 - what the player has ASKED for, mirrored straight off the key
  // event so the HUD acknowledges input on the same frame the engine begins
  // to spool. Display only; the integrator still reads inputRef.
  const [throttleCmd, setThrottleCmd] = useState(false);
  const [ended, setEnded] = useState(null); // { landed | crashed, result }
  const [paused, setPaused] = useState(false);
  const [view, setView] = useState("EXTERNAL"); // EXTERNAL | COCKPIT | NAV
  const [showAbort, setShowAbort] = useState(false);
  const [contactLight, setContactLight] = useState(false);
  const [projectedHazard, setProjectedHazard] = useState(false);
  const [projectedZoneLabel, setProjectedZoneLabel] = useState("PRIMARY LZ");
  const compact = useCompact();
  // Rendering quality steps down if the device cannot hold its frame rate:
  // pixel ratio first (2 → 1.5 → 1.25), then the real-time shadows. Never back up
  // during a descent (no flip-flopping in the final metres).
  // window.__lvQuality: validation tooling only (pin a quality step for screenshots and measurements).
  const pinned = typeof window !== "undefined" && Number.isInteger(window.__lvQuality) ? window.__lvQuality : null;
  const [quality, setQuality] = useState(pinned ?? 0);
  const baseDpr = Math.min(2, (typeof window !== "undefined" && window.devicePixelRatio) || 1);
  const dpr = [baseDpr, Math.min(baseDpr, 1.5), Math.min(baseDpr, 1.25), Math.min(baseDpr, 1.25)][quality];
  useEffect(() => {
    window.__lvDescentQualityNow = quality; // validation tooling (read-only)
  }, [quality]);
  const gameRef = useRef(null);
  const sabProbeRef = useRef(null);
  const clearRef = useRef(null); // unobstructed screen rectangle (CSS px)
  const lzIndicatorRef = useRef(null);
  const lpdIndicatorRef = useRef(null);

  const inputRef = useRef({
    throttle: false,
    left: false,
    right: false,
    strafeLeft: false,
    strafeRight: false,
  });
  const rafRef = useRef(null);
  const lastTsRef = useRef(0);
  // Mission-control calls, decided from telemetry (src/audio/descentComms)
  const commsRef = useRef(null);
  if (!commsRef.current) commsRef.current = createDescentMonitor();

  // Physics refs — the source of truth. State is only for HUD display.
  const phys = useRef(start);
  // Touchdown presentation (dust, legs, settle, shot): reads the physics, never writes it.
  const fxRef = useRef(null);
  if (!fxRef.current) fxRef.current = createTouchdownFx();
  const contactRef = useRef(false);
  if (typeof window !== "undefined") window.__lvDescentPhys = phys.current; // validation tooling (read-only)
  const pausedRef = useRef(false);
  const endedRef = useRef(false);
  // Combine user pause + any modal into a single physics pause.
  // showAbort suspends physics so the LM cannot fall while the confirm dialog is open.
  useEffect(() => { pausedRef.current = paused || showAbort; }, [paused, showAbort]);
  useEffect(() => { endedRef.current = !!ended; }, [ended]);

  // Keyboard
  useEffect(() => {
    const down = (e) => {
      if (e.repeat) return;
      switch (e.code) {
        case "Space":
        case "KeyW":
        case "ArrowUp":
          inputRef.current.throttle = true;
            setThrottleCmd(true);
          break;
        case "KeyA":
        case "ArrowLeft":
          inputRef.current.left = true;
          break;
        case "KeyD":
        case "ArrowRight":
          inputRef.current.right = true;
          break;
        case "KeyQ":
          inputRef.current.strafeLeft = true;
          break;
        case "KeyE":
          inputRef.current.strafeRight = true;
          break;
        case "KeyP":
          setPaused((p) => !p);
          break;
        case "KeyC":
          setView((v) => (v === "EXTERNAL" ? "COCKPIT" : v === "COCKPIT" ? "NAV" : "EXTERNAL"));
          break;
        default:
          return;
      }
      e.preventDefault();
    };
    const up = (e) => {
      switch (e.code) {
        case "Space":
        case "KeyW":
        case "ArrowUp":
          inputRef.current.throttle = false; setThrottleCmd(false); break;
        case "KeyA":
        case "ArrowLeft":
          inputRef.current.left = false; break;
        case "KeyD":
        case "ArrowRight":
          inputRef.current.right = false; break;
        case "KeyQ":
          inputRef.current.strafeLeft = false; break;
        case "KeyE":
          inputRef.current.strafeRight = false; break;
        default: return;
      }
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
    };
  }, []);

  // Physics + audio loop — runs ONCE on mount using refs to avoid useEffect thrash.
  useEffect(() => {
    let stateSyncAccum = 0;
    const tick = (ts) => {
      if (!lastTsRef.current) lastTsRef.current = ts;
      const rawDt = (ts - lastTsRef.current) / 1000;
      lastTsRef.current = ts;
      // stepFrame caps a frame at 0.25 s (tab defocus) and sub-steps it.
      const totalDt = Math.min(0.25, rawDt);

      // window.__lvDescentFreeze: validation tooling (hold the physics for an exact screenshot).
      if (endedRef.current || pausedRef.current || window.__lvDescentFreeze) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }
      // Training "starts in" hold: physics frozen, inputs may already be held.
      if (holdRef.current > 0) {
        holdRef.current -= totalDt;
        const n = Math.max(0, Math.ceil(holdRef.current));
        setHoldLeft(n);
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      const inp = inputRef.current;
      const p = phys.current;

      // Sub-stepped integration (landerSim) over the site's terrain, shared with the balance tests.
      stepFrame(p, inp, cfg, rawDt, site);

      // Throttle state sync to ~15 Hz to avoid 7 setStates per frame
      stateSyncAccum += totalDt;
      const shouldSync = stateSyncAccum > (1 / 15);
      if (shouldSync) {
        stateSyncAccum = 0;
        setAlt(p.alt);
        setVy(p.vy);
        setVx(p.vx);
        setXPos(p.xPos);
        setTilt(p.tilt);
        // Show the thrust the integrator is actually using: with dry tanks the
        // command is still live but produces nothing, and the bar must say so.
        setThrottle(p.fuel > 0 ? p.throttle : 0);
        setFuel(p.fuel);
      }

      // CONTACT LIGHT: a probe has reached the surface (data/touchdownFx PROBE_ALT).
      if (!contactRef.current && contactLit(p.alt)) {
        contactRef.current = true;
        setContactLight(true);
        if (audio && audio.contactLight) audio.contactLight();
      }

      // Projected touchdown assessment (drives TERRAIN AHEAD warning + LPD label)
      if (shouldSync) {
        // the ground under the LM's footprint at the projected touchdown point
        const g = site.evaluate(predict(p));
        // Mission control reads the same assessment the HUD shows.
        if (audio && audio.say && p.alt > CONTACT_ALT) {
          const profile = assessDescent({ ...p, throttle: p.fuel > 0 ? p.throttle : 0, cfg });
          commsRef.current({ t: p.t, alt: p.alt, vx: p.vx, xPos: p.xPos, profile, hazard: !!g.hazard, distanceToLZ: Math.abs(p.xPos), outcome: null })
            .forEach((r) => audio.say(r.id, r));
        }
        setProjectedHazard(!!g.hazard);
        setProjectedZoneLabel(
          g.hazard ? g.hazard.label :
          g.safeZone ? g.safeZone.label || (g.safeZone.primary ? "PRIMARY LZ" : "SAFE ZONE") :
          "UNMAPPED TERRAIN"
        );
      }

      // Touchdown — trigger at CONTACT_ALT (0.5 m) so the LM can never hover
      // indefinitely just above the surface. endedRef.current locks all further
      // physics + controls so the outcome cannot be undone.
      if (!endedRef.current && p.alt <= CONTACT_ALT) {
        const finalTilt = p.tilt;
        const finalFuel = p.fuel;
        const result = gradeTouchdown(p, cfg, site);
        // The drawing plays out the graded touchdown (it does not decide it),
        // settling onto the plane of the ground under the footpads.
        const tr = result.terrain;
        const plane = { tilt: (-Math.atan(tr.sx) * 180) / Math.PI, pitch: (-Math.atan(tr.sz) * 180) / Math.PI };
        fxRef.current.plan = touchdownPlan({ vy: p.vy, vx: p.vx, tilt: p.tilt }, result, cfg, plane);
        const impact = Math.min(1, Math.abs(p.vy) / cfg.safeVy);
        contactRef.current = true;
        setContactLight(true);
        p.alt = 0; p.vy = 0; p.vx = 0; p.throttle = 0;
        inputRef.current.throttle = false;
        inputRef.current.left = false;
        inputRef.current.right = false;
        inputRef.current.strafeLeft = false;
        inputRef.current.strafeRight = false;
        setAlt(0); setVy(0); setVx(0); setThrottle(0); setTilt(finalTilt); setFuel(finalFuel);
        endedRef.current = true;
        setEnded({ crashed: result.crashed, result });
        if (audio) {
          // ENGINE STOP: the descent engine is shut down at touchdown.
          if (audio.engineStop) audio.engineStop();
          else audio.stopRumble();
          if (audio.say) {
            commsRef.current({ t: p.t, alt: 0, vx: 0, xPos: p.xPos, profile: null, hazard: false, distanceToLZ: Math.abs(p.xPos), outcome: result.crashed ? "crashed" : "landed" })
              .forEach((r) => audio.say(r.id, r));
          }
          if (result.crashed) {
            audio.boom(0.55);
            if (audio.clank) audio.clank(0.45);
            setTimeout(() => onCrash && onCrash(result), RESULT_DELAY.crashed);
          } else {
            if (audio.touchdown) audio.touchdown(impact);
            else audio.boom(0.25);
            setTimeout(() => onSuccess && onSuccess(result), RESULT_DELAY.landed);
          }
        } else {
          setTimeout(() => (result.crashed ? onCrash?.(result) : onSuccess?.(result)), result.crashed ? RESULT_DELAY.crashed : RESULT_DELAY.landed);
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Comms verbosity follows the difficulty (COMMANDER: no coaching). Pausing
  // or the abort dialog silences the loop; stale calls are not kept.
  useEffect(() => {
    if (audio && audio.setVerbosity) audio.setVerbosity(VERBOSITY[difficulty] || "full");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [difficulty]);
  useEffect(() => {
    if ((paused || showAbort) && audio && audio.commsFlush) audio.commsFlush();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paused, showAbort]);

  // Engine rumble tied to throttle
  useEffect(() => {
    if (!audio) return;
    if (throttle > 0.05 && !ended) {
      audio.startRumble(throttle);
      audio.setRumble(throttle);
    } else {
      audio.stopRumble();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [throttle > 0.05, ended]);

  useEffect(() => {
    if (!audio) return;
    audio.setRumble(throttle);
  }, [throttle, audio]);

  // Gameplay visibility area: everything not covered by the HUD columns and
  // the top band. The camera keeps the lander, LPD and LZ inside it.
  useEffect(() => {
    const measure = () => {
      const root = gameRef.current;
      if (!root) return;
      const R = root.getBoundingClientRect();
      let x0 = 0;
      let x1 = R.width;
      let y0 = 0;
      root.querySelectorAll("[data-hud-block]").forEach((el) => {
        const r = el.getBoundingClientRect();
        if (!r.width || !r.height) return;
        const kind = el.dataset.hudBlock;
        if (kind === "left") x0 = Math.max(x0, r.right - R.left);
        else if (kind === "right") x1 = Math.min(x1, r.left - R.left);
        else if (kind === "top") y0 = Math.max(y0, r.bottom - R.top + Number(el.dataset.hudReserve || 0));
      });
      const sab = sabProbeRef.current ? sabProbeRef.current.offsetHeight : 0;
      clearRef.current = { x0: x0 + 6, x1: x1 - 6, y0: y0 + 4, y1: R.height - sab - 6 };
    };
    measure();
    const id = setInterval(measure, 500);
    window.addEventListener("resize", measure);
    return () => {
      clearInterval(id);
      window.removeEventListener("resize", measure);
    };
  }, [compact, view]);

  // Derived values
  const fuelPct = (fuel / cfg.initialFuel) * 100;
  const distanceToLZ = Math.abs(xPos);
  // Phase 2 - every cue below is derived from one live assessment rather than
  // fixed velocity thresholds, so the warning strip, the gauge colours, the
  // profile chip and the guidance line can never contradict each other.
  const profile = assessDescent({ alt, vy, vx, tilt, throttle, fuel, cfg });
  // After contact there is nothing left to fly: no corrective guidance.
  const guidance = ended ? null : guidanceFor(profile, projectedHazard);
  const chip = profileLabel(profile, projectedHazard);
  const readouts = guidanceReadouts(profile, vy);
  const tip = coach
    ? coach({
        t: phys.current.t || 0, alt, vy, vx, tilt, cfg, profile, projectedHazard, distanceToLZ,
        projectedZone: projectedZoneLabel, outcome: ended ? (ended.crashed ? "crashed" : "landed") : null,
      })
    : null;

  const warnFuelLow = profile.fuelState >= CAUTION;
  const dangerFuelCritical = profile.fuelState >= DANGER;
  const warnVy = profile.vyState >= CAUTION;
  const dangerVy = profile.vyState >= DANGER;
  const warnVx = profile.vxState >= CAUTION;
  const dangerVx = profile.vxState >= DANGER;
  const warnTilt = profile.tiltState >= CAUTION;
  const dangerTilt = profile.tiltState >= DANGER;

  // After a landing the HUD steps aside for the touchdown shot (EXTERNAL view).
  const hudFade = !!ended && !ended.crashed && view === "EXTERNAL";

  return (
    <div
      ref={gameRef}
      data-testid="descent-game"
      className="absolute inset-0 bg-[#050505]"
    >
      <div ref={sabProbeRef} aria-hidden className="absolute left-0 bottom-0 w-px pointer-events-none" style={{ height: "var(--sab)" }} />
      {/* 3D scene */}
      <div className="absolute inset-0 canvas-host">
        <Canvas
          camera={{ position: [-8, 20, 14], fov: 45, near: 0.1, far: 5000 }}
          dpr={dpr}
          shadows={quality < 3 ? { type: THREE.PCFShadowMap } : false}
          gl={{ antialias: true, alpha: false, toneMapping: THREE.ACESFilmicToneMapping, outputColorSpace: THREE.SRGBColorSpace }}
          onCreated={({ gl, scene }) => {
            gl.setClearColor("#050505");
            window.__lvDescentGl = gl; // validation tooling: renderer.info draw calls
            window.__lvDescentScene = scene; // validation tooling (read-only)
          }}
        >
          {pinned === null && (
            <PerformanceMonitor bounds={(hz) => [Math.min(45, hz * 0.75), hz]} flipflops={1} onDecline={() => setQuality((q) => Math.min(3, q + 1))} />
          )}
          <Suspense fallback={null}>
            <color attach="background" args={["#050505"]} />
            <SiteSky site={site} />
            <SiteSun site={site} focus={() => [fxRef.current.x, fxRef.current.groundY, 0]} />
            <SiteTerrain site={site} />
            <SiteRocks site={site} />
            <SiteMarkers site={site} physRef={phys} />
            <LandingPoint site={site} physRef={phys} predict={predict} />
            <TouchdownPath physRef={phys} view={view} cfg={cfg} site={site} predict={predict} />
            <LanderRig physRef={phys} fx={fxRef.current} site={site} hidden={view === "COCKPIT"} />
            <GroundMarks fx={fxRef.current} site={site} />
            <RegolithSheet fx={fxRef.current} />
            <DescentCamera physRef={phys} cfg={cfg} view={view} clearRef={clearRef} lzIndicatorRef={lzIndicatorRef} lpdIndicatorRef={lpdIndicatorRef} fx={fxRef.current} site={site} predict={predict} />
          </Suspense>
        </Canvas>
      </div>

      {/* Cockpit overlay */}
      <CockpitOverlay
        active={view === "COCKPIT"}
        onToggle={() => setView((v) => (v === "COCKPIT" ? "EXTERNAL" : "COCKPIT"))}
        hint="RETICLE ALIGNED WITH DESCENT VECTOR"
      />

      {holdLeft > 0 && (
        <div className="absolute top-[4.6rem] short:top-[5.1rem] left-1/2 -translate-x-1/2 z-40 pointer-events-none bg-black/60 border border-[#FF3B00]/50 px-3 py-1 font-mono text-[10px] tracking-[0.3em] text-white" data-testid="training-hold">
          {site.name} · STARTS IN <span className="text-[#FF3B00] tabular">{holdLeft}</span>
        </div>
      )}

      {/* Off-screen primary LZ: chevron on the edge of the visibility area */}
      <div
        ref={lzIndicatorRef}
        data-testid="lz-indicator"
        className="absolute left-0 top-0 z-20 hidden items-center gap-1.5 pointer-events-none font-mono text-[9px] tracking-[0.2em] text-[#FF3B00]"
      >
        <span className="inline-block text-[13px] leading-none">➤</span>
        <span className="bg-black/50 px-1.5 py-0.5 border border-[#FF3B00]/50">LZ {distanceToLZ.toFixed(0)} m</span>
      </div>
      {/* Projected touchdown outside the visibility area: same treatment, in the LPD's yellow */}
      <div
        ref={lpdIndicatorRef}
        data-testid="lpd-indicator"
        className="absolute left-0 top-0 z-20 hidden items-center gap-1.5 pointer-events-none font-mono text-[9px] tracking-[0.2em] text-[#FFDD00]"
      >
        <span className="inline-block text-[13px] leading-none">➤</span>
        <span className="bg-black/50 px-1.5 py-0.5 border border-[#FFDD00]/40">TOUCHDOWN</span>
      </div>

      {compact ? (
        <CompactDescentHud
          cfg={cfg} alt={alt} vy={vy} vx={vx} tilt={tilt} fuel={fuel} fuelPct={fuelPct}
          throttle={throttle} throttleCmd={throttleCmd} setThrottleCmd={setThrottleCmd} inputRef={inputRef}
          view={view} setView={setView} paused={paused} setPaused={setPaused} setShowAbort={setShowAbort}
          chip={chip} guidance={guidance} distanceToLZ={distanceToLZ}
          projectedZoneLabel={projectedZoneLabel} projectedHazard={projectedHazard} contactLight={contactLight}
          engineStop={!!ended} hudFade={hudFade}
          flags={{ warnFuelLow, dangerFuelCritical, warnVy, dangerVy, warnVx, dangerVx, warnTilt, dangerTilt }}
          readouts={readouts}
          tip={tip}
        />
      ) : (
      <>
      {/* View mode selector */}
      <div className="absolute top-20 short:top-[var(--hud-top)] left-1/2 -translate-x-1/2 hud-panel px-3 py-2 touch:py-1 flex items-center gap-1 z-40" data-testid="view-selector" data-hud-block="top" data-hud-reserve="40">
        {["EXTERNAL", "COCKPIT", "NAV"].map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            data-testid={`view-${v.toLowerCase()}`}
            className={`px-3 short:px-2 py-1 touch:py-3.5 font-mono text-[10px] tracking-[0.3em] transition-colors duration-150 ${
              view === v ? "bg-[#FF3B00] text-black" : "text-zinc-400 hover:text-white"
            }`}
          >
            {v}
          </button>
        ))}
      </div>

      {/* Abort button (top-right) */}
      <button
        onClick={() => setShowAbort(true)}
        data-testid="descent-abort"
        className="absolute top-20 short:top-[var(--hud-top)] right-4 md:right-8 safe-mr hud-panel px-3 py-2 touch:py-3 flex items-center gap-2 text-zinc-400 hover:text-[#FF3B00] transition-colors duration-200 font-mono text-[10px] tracking-[0.3em] z-40"
      >
        <X size={12} /> ABORT
      </button>

      {/* Pause button */}
      <button
        onClick={() => setPaused((p) => !p)}
        data-testid="descent-pause"
        aria-label={paused ? "Resume" : "Pause"}
        className="absolute top-20 short:top-[var(--hud-top)] right-32 md:right-36 safe-mr hud-panel px-3 py-2 touch:py-3 touch:min-w-[44px] touch:min-h-[44px] justify-center flex items-center gap-2 text-zinc-400 hover:text-[#FF3B00] transition-colors duration-200 font-mono text-[10px] tracking-[0.3em] z-40"
      >
        {paused ? <Play size={12} /> : <Pause size={12} />}
        <span className="narrow:hidden">{paused ? "RESUME" : "PAUSE"}</span>
      </button>

      {/* Warnings strip (top center-ish) */}
      <div className="absolute top-36 short:top-[7.5rem] left-1/2 -translate-x-1/2 flex gap-2 short:flex-col short:items-center short:gap-1 short:whitespace-nowrap z-40">
        {warnFuelLow && (
          <div className={`hud-panel px-3 py-1 font-mono text-[10px] tracking-widest ${dangerFuelCritical ? "text-[#FF3B00] blink" : "text-amber-400"}`} data-testid="warn-fuel">
            ● FUEL LOW
          </div>
        )}
        {warnVy && (
          <div className={`hud-panel px-3 py-1 font-mono text-[10px] tracking-widest ${dangerVy ? "text-[#FF3B00] blink" : "text-amber-400"}`} data-testid="warn-descent">
            ● {dangerVy ? "DESCENT RATE CRITICAL" : "DESCENT RATE HIGH"}
          </div>
        )}
        {warnVx && (
            <div
              className={`hud-panel px-3 py-1 font-mono text-[10px] tracking-widest ${dangerVx ? "text-[#FF3B00] blink" : "text-amber-400"}`}
              data-testid="warn-lateral"
            >
              ● {dangerVx ? "LATERAL DRIFT EXCESSIVE" : "LATERAL DRIFT"}
            </div>
          )}
          {dangerTilt && (
          <div className="hud-panel px-3 py-1 font-mono text-[10px] tracking-widest text-[#FF3B00] blink" data-testid="warn-tilt">
            ● TILT EXCEEDS LIMIT
          </div>
        )}
        <Lamps contact={contactLight} engineStop={!!ended} />
        {projectedHazard && alt > 5 && (
          <div className="hud-panel px-3 py-1 font-mono text-[10px] tracking-widest text-[#FF3B00] blink" data-testid="warn-terrain">
            ● TERRAIN AHEAD — DIVERT
          </div>
        )}
      </div>

      {/* LEFT: primary instrument HUD */}
      <div className="absolute bottom-6 short:bottom-2 safe-mb left-4 md:left-8 safe-ml hud-panel corners px-5 py-4 short:px-4 short:py-2 w-[300px] short:w-[240px] narrow:w-[215px] z-30 transition-opacity duration-700" style={hudFade ? { opacity: 0, pointerEvents: "none" } : undefined} data-testid="descent-hud-left" data-hud-block="left">
        <CoachCard tip={tip} className="-mx-2 mb-3 short:mb-1.5" />
        <div className="font-mono text-[10px] tracking-[0.3em] text-zinc-500 mb-3 short:hidden">
          LM-1 · GUIDANCE · {cfg.label}
        </div>
        <div className="grid grid-cols-2 gap-3 short:gap-x-3 short:gap-y-1">
          <Gauge label="ALTITUDE" value={alt.toFixed(0)} unit="m" testId="gauge-altitude" />
          <Gauge label="V·SPEED" value={vy.toFixed(1)} unit="m/s" warn={warnVy} danger={dangerVy} testId="gauge-vspeed" />
          <Gauge label="H·SPEED" value={vx.toFixed(1)} unit="m/s" testId="gauge-hspeed" />
          <Gauge label="TILT" value={tilt.toFixed(0) + "°"} warn={warnTilt} danger={dangerTilt} testId="gauge-tilt" />
        </div>
        <div className="mt-3 short:mt-1.5 grid grid-cols-3 gap-2 border-t border-white/10 pt-2 short:pt-1">
          {[["TGT V/S", readouts.tgt, "guide-target"], ["BRAKE", readouts.brake, "guide-brake"], ["RESERVE", readouts.reserve, "guide-reserve"]].map(([label, v, id]) => (
            <div key={id} data-testid={id}>
              <div className="font-mono text-[9px] tracking-[0.22em] text-zinc-500">{label}</div>
              <div className={`font-mono tabular text-sm short:text-xs ${v.cls}`}>{v.text}</div>
            </div>
          ))}
        </div>
        <div className="mt-3 short:mt-2">
          <div className="font-mono text-[9px] tracking-widest text-zinc-500 mb-1 flex justify-between">
            <span>FUEL</span>
            <span className={dangerFuelCritical ? "text-[#FF3B00]" : warnFuelLow ? "text-amber-400" : "text-white"}>
              {fuelPct.toFixed(0)}%
            </span>
          </div>
          <Bar value={fuel / cfg.initialFuel} warn={warnFuelLow} danger={dangerFuelCritical} />
        </div>
        <div className="mt-2 short:mt-1">
          <div className="font-mono text-[9px] tracking-widest text-zinc-500 mb-1 flex justify-between">
            <span>
                  THROTTLE
                  <span className={`ml-2 ${throttleCmd ? "text-[#FF3B00]" : "text-zinc-700"}`} data-testid="throttle-cmd">
                    ● CMD
                  </span>
                </span>
            <span className={throttleCmd ? "text-[#FF3B00]" : "text-white"}>{(throttle * 100).toFixed(0)}%</span>
          </div>
          <Bar value={throttle} />
        </div>
        <div className="mt-3 short:mt-2 flex items-center justify-between gap-2" data-testid="descent-profile">
                <span className="font-mono text-[9px] tracking-widest text-zinc-500">PROFILE</span>
                <span
                  className={`font-mono text-[10px] tracking-widest ${
                    chip.level === DANGER ? "text-[#FF3B00]" : chip.level === CAUTION ? "text-amber-400" : "text-emerald-400"
                  }`}
                >
                  {chip.text}
                </span>
              </div>
              <div className="mt-1 font-mono text-[9px] tracking-widest h-3" data-testid="descent-guidance">
                {guidance && (
                  <span className={guidanceTone(guidance)}>{guidance.text}</span>
                )}
              </div>
              <div className="mt-3 short:mt-1.5 font-mono text-[9px] tracking-widest text-zinc-500 flex justify-between">
          <span>DISTANCE TO PRIMARY LZ</span>
          <span className="text-white tabular">{distanceToLZ.toFixed(1)} m</span>
        </div>
        <div className="mt-1 font-mono text-[9px] tracking-widest flex justify-between" data-testid="projected-lz">
          <span className="text-zinc-500">PROJECTED TOUCHDOWN</span>
          <span className={projectedHazard ? "text-[#FF3B00] blink" : "text-white"}>
            {projectedZoneLabel}
          </span>
        </div>
      </div>

      {/* RIGHT: keys / touch controls */}
      <div className="absolute bottom-6 short:bottom-2 safe-mb right-4 md:right-8 safe-mr hud-panel corners px-5 py-4 short:px-3 short:py-2.5 z-30 transition-opacity duration-700" style={hudFade ? { opacity: 0, pointerEvents: "none" } : undefined} data-testid="descent-hud-right" data-hud-block="right">
        <div className="font-mono text-[10px] tracking-[0.3em] text-zinc-500 mb-3 short:mb-2">
          FLIGHT CONTROLS
        </div>
        <div className="grid grid-cols-3 gap-2 place-items-center">
          <div />
          <HoldButton
            onHold={(on) => { inputRef.current.throttle = on; setThrottleCmd(on); }}
            data-testid="ctrl-throttle"
            aria-label="Throttle"
            className="w-14 h-14 border border-white/25 hover:border-[#FF3B00] hover:bg-[#FF3B00]/20 flex items-center justify-center text-white"
          >
            <ArrowUp size={20} />
          </HoldButton>
          <div />
          <HoldButton
            onHold={(on) => (inputRef.current.left = on)}
            data-testid="ctrl-left"
            aria-label="Tilt left"
            className="w-14 h-14 border border-white/25 hover:border-white flex items-center justify-center text-white"
          >
            <ArrowLeft size={20} />
          </HoldButton>
          <div className="w-14 h-14 border border-white/10 flex items-center justify-center font-mono text-[9px] text-zinc-500">
            RCS
          </div>
          <HoldButton
            onHold={(on) => (inputRef.current.right = on)}
            data-testid="ctrl-right"
            aria-label="Tilt right"
            className="w-14 h-14 border border-white/25 hover:border-white flex items-center justify-center text-white"
          >
            <ArrowRight size={20} />
          </HoldButton>
          <HoldButton
            onHold={(on) => (inputRef.current.strafeLeft = on)}
            data-testid="ctrl-strafe-left"
            aria-label="RCS strafe left"
            className="w-14 h-12 border border-white/25 hover:border-white flex items-center justify-center text-zinc-400 text-[10px] font-mono"
          >
            ◄ RCS
          </HoldButton>
          <div className="w-14 h-12 border border-white/10 flex items-center justify-center font-mono text-[8px] text-zinc-600 leading-tight text-center">
            <span className="touch:hidden">Q · E<br/></span>STRAFE
          </div>
          <HoldButton
            onHold={(on) => (inputRef.current.strafeRight = on)}
            data-testid="ctrl-strafe-right"
            aria-label="RCS strafe right"
            className="w-14 h-12 border border-white/25 hover:border-white flex items-center justify-center text-zinc-400 text-[10px] font-mono"
          >
            RCS ►
          </HoldButton>
        </div>
        <div className="mt-3 font-mono text-[9px] tracking-widest text-zinc-500 leading-relaxed touch:hidden">
          SPACE · THROTTLE<br/>
          A/D · TILT · Q/E · STRAFE<br/>
          P · PAUSE · C · CYCLE VIEW
        </div>
      </div>

      </>
      )}

      {/* Paused overlay */}
      {paused && !ended && (
        <div className="absolute inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-40" data-testid="pause-overlay">
          <div className="text-center">
            <div className="font-mono text-[10px] tracking-[0.4em] text-[#FF3B00] blink mb-3">● PAUSED</div>
            <div className="font-display font-black text-white text-5xl md:text-6xl mb-6">HOLDING</div>
            <button
              onClick={() => setPaused(false)}
              data-testid="btn-resume"
              className="btn-hud btn-hud-primary"
            >
              <Play size={12} /> RESUME
            </button>
          </div>
        </div>
      )}

      {/* Abort modal */}
      <AbortModal
        open={showAbort}
        onCancel={() => setShowAbort(false)}
        onConfirm={() => { setShowAbort(false); if (audio) audio.stopRumble(); onAbort && onAbort(); }}
      />
    </div>
  );
}
