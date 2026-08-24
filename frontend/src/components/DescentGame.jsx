import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Stars, useTexture } from "@react-three/drei";
import { useRef, useState, useEffect, useMemo, Suspense } from "react";
import * as THREE from "three";
import LanderModel from "@/components/LanderModel";
import CockpitOverlay from "@/components/CockpitOverlay";
import AbortModal from "@/components/AbortModal";
import {
  MOON_G,
  DIFFICULTY,
  HAZARDS,
  SAFE_ZONES,
  evaluateGround,
  gradeLanding,
} from "@/data/landingPhysics";
import {
  ArrowUp, ArrowDown, ArrowLeft, ArrowRight,
  Pause, Play, X,
} from "lucide-react";

const MOON_MAP = "https://threejs.org/examples/textures/planets/moon_1024.jpg";
const EARTH_MAP = "https://threejs.org/examples/textures/planets/earth_atmos_2048.jpg";

/* ============================================================
 * 3D scene layer
 * ============================================================ */

function MoonSurface() {
  const [tex] = useTexture([MOON_MAP]);
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, 0, 0]}>
      <planeGeometry args={[300, 300, 1, 1]} />
      <meshStandardMaterial
        map={tex}
        bumpMap={tex}
        bumpScale={0.2}
        color="#c8c2b3"
        roughness={1}
      />
    </mesh>
  );
}

function LandingSiteMarkers() {
  return (
    <group>
      {SAFE_ZONES.map((z, i) => (
        <mesh
          key={i}
          rotation={[-Math.PI / 2, 0, 0]}
          position={[z.x, 0.02, 0]}
        >
          <ringGeometry args={[z.r - 0.4, z.r, 32]} />
          <meshBasicMaterial color={z.primary ? "#FF3B00" : "#4a90e2"} transparent opacity={0.9} />
        </mesh>
      ))}
      {HAZARDS.map((h, i) => (
        <group key={"h" + i}>
          <mesh rotation={[-Math.PI / 2, 0, 0]} position={[h.x, 0.02, 0]}>
            <circleGeometry args={[h.r, 32]} />
            <meshBasicMaterial color="#3a1a0a" transparent opacity={0.55} />
          </mesh>
          {h.kind === "crater" && (
            <mesh rotation={[-Math.PI / 2, 0, 0]} position={[h.x, 0.03, 0]}>
              <ringGeometry args={[h.r - 0.3, h.r, 32]} />
              <meshBasicMaterial color="#1a0a05" />
            </mesh>
          )}
          {h.kind === "boulders" &&
            Array.from({ length: 6 }).map((_, k) => {
              const a = (k / 6) * Math.PI * 2;
              return (
                <mesh
                  key={k}
                  position={[
                    h.x + Math.cos(a) * (h.r * 0.6),
                    0.5,
                    Math.sin(a) * (h.r * 0.6),
                  ]}
                >
                  <dodecahedronGeometry args={[0.8, 0]} />
                  <meshStandardMaterial color="#7a736a" roughness={1} />
                </mesh>
              );
            })}
        </group>
      ))}
    </group>
  );
}

function DistantEarth() {
  const [tex] = useTexture([EARTH_MAP]);
  const ref = useRef();
  useFrame((_, dt) => {
    if (ref.current) ref.current.rotation.y += dt * 0.02;
  });
  return (
    <mesh ref={ref} position={[-40, 45, -100]}>
      <sphereGeometry args={[10, 64, 64]} />
      <meshStandardMaterial map={tex} emissive="#0a1830" emissiveIntensity={0.15} />
    </mesh>
  );
}

function Lander({ physRef }) {
  const ref = useRef();
  useFrame(() => {
    if (ref.current && physRef.current) {
      const p = physRef.current;
      ref.current.position.set(p.xPos * 0.5, Math.max(0, p.alt * 0.05), 0);
      ref.current.rotation.z = -p.tilt * (Math.PI / 180);
    }
  });
  return (
    <group ref={ref}>
      <LanderModel thrust={0.6 /* visual constant, we scale flame via thrustRef */} scale={1.2} />
    </group>
  );
}

function LanderThrust({ physRef }) {
  // Empty — thrust visual is handled inside LanderModel by prop.
  // We can't reactively update the thrust prop of LanderModel without state,
  // so we keep thrust visualization decoupled via the flame's own scale in
  // LanderModel which depends on thrust prop; here we live with a mid value.
  return null;
}

function Dust({ altitude, thrust }) {
  const ref = useRef();
  const N = 40;
  const parts = useMemo(() => {
    return Array.from({ length: N }, () => ({
      x: (Math.random() - 0.5) * 4,
      z: (Math.random() - 0.5) * 4,
      vx: (Math.random() - 0.5) * 2,
      vz: (Math.random() - 0.5) * 2,
      life: Math.random(),
    }));
  }, []);
  const visible = altitude < 8 && thrust > 0.15;
  useFrame((_, delta) => {
    if (!ref.current || !visible) return;
    ref.current.children.forEach((c, i) => {
      const p = parts[i];
      p.life += delta * 1.2;
      if (p.life > 1) {
        p.life = 0;
        p.x = 0;
        p.z = 0;
      }
      c.position.x = p.x + p.vx * p.life * 2;
      c.position.z = p.z + p.vz * p.life * 2;
      c.position.y = 0.05 + p.life * 0.3;
      c.material.opacity = (1 - p.life) * 0.6;
    });
  });
  if (!visible) return null;
  return (
    <group ref={ref} position={[0, 0, 0]}>
      {parts.map((_, i) => (
        <mesh key={i}>
          <sphereGeometry args={[0.15, 8, 8]} />
          <meshBasicMaterial color="#c8c2b3" transparent opacity={0.5} />
        </mesh>
      ))}
    </group>
  );
}

/** External chase-cam that follows the lander. Reads from physRef directly for 60fps smoothness. */
function ExternalCamera({ physRef, view }) {
  const { camera } = useThree();
  const desired = useRef(new THREE.Vector3());
  const look = useRef(new THREE.Vector3());

  useFrame((_, delta) => {
    if (!physRef.current) return;
    const p = physRef.current;
    const x = p.xPos * 0.5;
    const y = Math.max(0, p.alt * 0.05);
    if (view === "COCKPIT") {
      desired.current.set(x, y + 0.7, 0);
      look.current.set(x + 6, Math.max(0, y - 8), 0);
    } else if (view === "NAV") {
      desired.current.set(0, 60, 0);
      look.current.set(0, 0, 0);
    } else {
      // EXTERNAL chase — camera behind & slightly above lander, looking down
      desired.current.set(x - 10, y + 5, 12);
      look.current.set(x + 1, y - 3, 0);
    }
    camera.position.lerp(desired.current, Math.min(1, delta * 3));
    camera.lookAt(look.current);
    camera.updateProjectionMatrix();
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
        <span className={`font-mono tabular text-lg md:text-xl font-medium ${color} ${danger ? "blink" : ""}`}>
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

/* ============================================================
 * Main DescentGame component
 * ============================================================ */

/**
 * Props:
 *  - difficulty: DIFFICULTY key
 *  - audio: useMissionAudio() instance (optional)
 *  - onSuccess(result), onCrash(result), onAbort()
 */
export default function DescentGame({ difficulty = "ASTRONAUT", audio, onSuccess, onCrash, onAbort }) {
  const cfg = DIFFICULTY[difficulty] || DIFFICULTY.ASTRONAUT;

  const [alt, setAlt] = useState(cfg.initialAlt);
  const [vy, setVy] = useState(cfg.initialVy);
  const [vx, setVx] = useState(cfg.initialVx);
  const [xPos, setXPos] = useState(-cfg.initialAlt * 0.3);
  const [tilt, setTilt] = useState(0);
  const [throttle, setThrottle] = useState(0);
  const [fuel, setFuel] = useState(cfg.initialFuel);
  const [ended, setEnded] = useState(null); // { landed | crashed, result }
  const [paused, setPaused] = useState(false);
  const [view, setView] = useState("EXTERNAL"); // EXTERNAL | COCKPIT | NAV
  const [showAbort, setShowAbort] = useState(false);
  const [contactLight, setContactLight] = useState(false);

  const inputRef = useRef({
    throttle: false,
    left: false,
    right: false,
    strafeLeft: false,
    strafeRight: false,
  });
  const rafRef = useRef(null);
  const lastTsRef = useRef(0);
  const lastAudioAltRef = useRef(alt);
  const commsFiredRef = useRef({});

  // Physics refs — the source of truth. State is only for HUD display.
  const phys = useRef({
    alt: cfg.initialAlt,
    vy: cfg.initialVy,
    vx: cfg.initialVx,
    xPos: -cfg.initialAlt * 0.3,
    tilt: 0,
    throttle: 0,
    fuel: cfg.initialFuel,
  });
  const pausedRef = useRef(false);
  const endedRef = useRef(false);
  useEffect(() => { pausedRef.current = paused; }, [paused]);
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
          inputRef.current.throttle = false; break;
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
      // Cap at 0.25s to avoid huge jumps on tab-defocus, but do multiple sub-steps.
      const totalDt = Math.min(0.25, rawDt);
      const subSteps = Math.max(1, Math.ceil(totalDt / 0.033));
      const dt = totalDt / subSteps;

      if (endedRef.current || pausedRef.current) {
        rafRef.current = requestAnimationFrame(tick);
        return;
      }

      const inp = inputRef.current;
      const p = phys.current;

      // Multi-step integration to preserve determinism under variable frame rate.
      for (let s = 0; s < subSteps; s++) {
      // Throttle ramp
      const throttleTarget = inp.throttle && p.fuel > 0 ? 1 : 0;
      p.throttle += (throttleTarget - p.throttle) * Math.min(1, dt * 3.0);

      // Tilt input
      let dTilt = 0;
      if (inp.left) dTilt -= cfg.tiltRate * dt;
      if (inp.right) dTilt += cfg.tiltRate * dt;
      if (!inp.left && !inp.right && cfg.tiltAssist) {
        dTilt -= Math.sign(p.tilt) * Math.min(Math.abs(p.tilt), 15 * dt);
      }
      p.tilt = Math.max(-45, Math.min(45, p.tilt + dTilt));

      // RCS strafe
      if (inp.strafeLeft) p.vx -= 3 * dt;
      if (inp.strafeRight) p.vx += 3 * dt;

      // Fuel consumption
      const usage = p.throttle * cfg.fuelRate * dt;
      p.fuel = Math.max(0, p.fuel - usage);
      const effThrottle = p.fuel > 0 ? p.throttle : 0;

      // Integrate (semi-implicit Euler)
      const thrustAcc = effThrottle * cfg.maxThrust;
      const rad = p.tilt * (Math.PI / 180);
      const ax = thrustAcc * Math.sin(rad);
      const ay = thrustAcc * Math.cos(rad) - MOON_G;
      p.vy += ay * dt;
      p.vx += ax * dt;
      p.alt += p.vy * dt;
      p.xPos += p.vx * dt;
      if (p.alt <= 0) break; // stop sub-stepping once we hit the ground
      }

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
        setThrottle(p.throttle);
        setFuel(p.fuel);
      }

      // Comms cues
      const prev = lastAudioAltRef.current;
      if (audio) {
        if (prev > 500 && p.alt <= 500 && !commsFiredRef.current.a500) {
          commsFiredRef.current.a500 = true;
          audio.comms("Altitude 500 meters. You are go for landing.");
        } else if (prev > 200 && p.alt <= 200 && !commsFiredRef.current.a200) {
          commsFiredRef.current.a200 = true;
          audio.comms("200 meters. Descent rate looking good.");
        } else if (prev > 100 && p.alt <= 100 && !commsFiredRef.current.a100) {
          commsFiredRef.current.a100 = true;
          audio.comms("100 meters. Fuel " + Math.round((p.fuel / cfg.initialFuel) * 100) + " percent.");
        } else if (prev > 30 && p.alt <= 30 && !commsFiredRef.current.a30) {
          commsFiredRef.current.a30 = true;
          audio.comms("30 meters. Picking up dust.");
        }
        if (p.fuel / cfg.initialFuel < 0.2 && !commsFiredRef.current.lowFuel) {
          commsFiredRef.current.lowFuel = true;
          audio.comms("Fuel low. 60 seconds remaining.");
        }
      }
      lastAudioAltRef.current = p.alt;

      // Contact light
      setContactLight(p.alt < 5 && p.alt > 0.05);

      // Touchdown
      if (p.alt <= 0) {
        const finalVy = p.vy;
        const finalVx = p.vx;
        const finalTilt = p.tilt;
        const g = evaluateGround(p.xPos);
        const crashConditions =
          Math.abs(finalVy) > cfg.safeVy ||
          Math.abs(finalVx) > cfg.safeVx ||
          Math.abs(finalTilt) > cfg.safeTilt ||
          !!g.hazard;
        const result = gradeLanding({
          vy: finalVy,
          vx: finalVx,
          tilt: finalTilt,
          fuel: p.fuel,
          initialFuel: cfg.initialFuel,
          xPos: p.xPos,
          safeZone: g.safeZone,
          hazard: g.hazard,
          crashed: crashConditions,
        });
        p.alt = 0;
        p.vy = 0;
        p.vx = 0;
        p.throttle = 0;
        setAlt(0); setVy(0); setVx(0); setThrottle(0);
        endedRef.current = true;
        setEnded({ crashed: crashConditions, result });
        if (audio) {
          audio.stopRumble();
          if (crashConditions) {
            audio.boom(0.55);
            audio.comms(
              g.hazard ? "Ground contact... hazard detected. Structural damage."
              : Math.abs(finalVy) > cfg.safeVy ? "Hard landing. Structural failure."
              : "Landing failure. Attitude out of limits."
            );
            setTimeout(() => onCrash && onCrash(result), 2200);
          } else {
            audio.boom(0.25);
            audio.comms("Contact light. Engine stop. Tranquility Base here.");
            setTimeout(() => onSuccess && onSuccess(result), 2800);
          }
        } else {
          setTimeout(() => (crashConditions ? onCrash?.(result) : onSuccess?.(result)), 2200);
        }
      }

      rafRef.current = requestAnimationFrame(tick);
    };
    rafRef.current = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafRef.current);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  // Derived values
  const fuelPct = (fuel / cfg.initialFuel) * 100;
  const distanceToLZ = Math.abs(xPos);
  const warnFuelLow = fuelPct < 25;
  const dangerFuelCritical = fuelPct < 10;
  const warnVy = vy < -6;
  const dangerVy = vy < -10;
  const warnTilt = Math.abs(tilt) > cfg.safeTilt * 0.7;
  const dangerTilt = Math.abs(tilt) > cfg.safeTilt;

  const scenePos = { x: xPos * 0.5, y: alt * 0.05 }; // scene scaled

  return (
    <div
      data-testid="descent-game"
      className="absolute inset-0 bg-[#050505]"
    >
      {/* 3D scene */}
      <div className="absolute inset-0 canvas-host">
        <Canvas
          camera={{ position: [-8, 20, 14], fov: 45 }}
          dpr={[1, 2]}
          gl={{ antialias: true, alpha: false, toneMapping: THREE.ACESFilmicToneMapping, outputColorSpace: THREE.SRGBColorSpace }}
          onCreated={({ gl }) => gl.setClearColor("#050505")}
        >
          <Suspense fallback={null}>
            <color attach="background" args={["#050505"]} />
            <Stars radius={100} depth={50} count={4000} factor={2.5} saturation={0} fade speed={0.05} />
            <ambientLight intensity={0.18} />
            <directionalLight position={[30, 40, 20]} intensity={2.6} color="#ffffff" />
            <directionalLight position={[-10, 6, -20]} intensity={0.2} color="#3a5a8a" />
            <MoonSurface />
            <LandingSiteMarkers />
            <DistantEarth />
            <Lander physRef={phys} />
            <Dust altitude={alt} thrust={throttle} />
            <ExternalCamera physRef={phys} view={view} />
          </Suspense>
        </Canvas>
      </div>

      {/* Cockpit overlay */}
      <CockpitOverlay
        active={view === "COCKPIT"}
        onToggle={() => setView((v) => (v === "COCKPIT" ? "EXTERNAL" : "COCKPIT"))}
        hint="RETICLE ALIGNED WITH DESCENT VECTOR"
      />

      {/* View mode selector */}
      <div className="absolute top-20 left-1/2 -translate-x-1/2 hud-panel px-3 py-2 flex items-center gap-1 z-40" data-testid="view-selector">
        {["EXTERNAL", "COCKPIT", "NAV"].map((v) => (
          <button
            key={v}
            onClick={() => setView(v)}
            data-testid={`view-${v.toLowerCase()}`}
            className={`px-3 py-1 font-mono text-[10px] tracking-[0.3em] transition-colors duration-150 ${
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
        className="absolute top-20 right-4 md:right-8 hud-panel px-3 py-2 flex items-center gap-2 text-zinc-400 hover:text-[#FF3B00] transition-colors duration-200 font-mono text-[10px] tracking-[0.3em] z-40"
      >
        <X size={12} /> ABORT
      </button>

      {/* Pause button */}
      <button
        onClick={() => setPaused((p) => !p)}
        data-testid="descent-pause"
        className="absolute top-20 right-32 md:right-36 hud-panel px-3 py-2 flex items-center gap-2 text-zinc-400 hover:text-[#FF3B00] transition-colors duration-200 font-mono text-[10px] tracking-[0.3em] z-40"
      >
        {paused ? <Play size={12} /> : <Pause size={12} />}
        {paused ? "RESUME" : "PAUSE"}
      </button>

      {/* Warnings strip (top center-ish) */}
      <div className="absolute top-36 left-1/2 -translate-x-1/2 flex gap-2 z-40">
        {warnFuelLow && (
          <div className={`hud-panel px-3 py-1 font-mono text-[10px] tracking-widest ${dangerFuelCritical ? "text-[#FF3B00] blink" : "text-amber-400"}`} data-testid="warn-fuel">
            ● FUEL LOW
          </div>
        )}
        {dangerVy && (
          <div className="hud-panel px-3 py-1 font-mono text-[10px] tracking-widest text-[#FF3B00] blink" data-testid="warn-descent">
            ● DESCENT RATE HIGH
          </div>
        )}
        {dangerTilt && (
          <div className="hud-panel px-3 py-1 font-mono text-[10px] tracking-widest text-[#FF3B00] blink" data-testid="warn-tilt">
            ● TILT EXCEEDS LIMIT
          </div>
        )}
        {contactLight && (
          <div className="hud-panel px-3 py-1 font-mono text-[10px] tracking-widest text-[#FF3B00] blink" data-testid="warn-contact">
            ● CONTACT LIGHT
          </div>
        )}
      </div>

      {/* LEFT: primary instrument HUD */}
      <div className="absolute bottom-6 left-4 md:left-8 hud-panel corners px-5 py-4 w-[300px] z-30" data-testid="descent-hud-left">
        <div className="font-mono text-[10px] tracking-[0.3em] text-zinc-500 mb-3">
          LM-1 · GUIDANCE · {cfg.label}
        </div>
        <div className="grid grid-cols-2 gap-3">
          <Gauge label="ALTITUDE" value={alt.toFixed(0)} unit="m" testId="gauge-altitude" />
          <Gauge label="V·SPEED" value={vy.toFixed(1)} unit="m/s" warn={warnVy} danger={dangerVy} testId="gauge-vspeed" />
          <Gauge label="H·SPEED" value={vx.toFixed(1)} unit="m/s" testId="gauge-hspeed" />
          <Gauge label="TILT" value={tilt.toFixed(0) + "°"} warn={warnTilt} danger={dangerTilt} testId="gauge-tilt" />
        </div>
        <div className="mt-3">
          <div className="font-mono text-[9px] tracking-widest text-zinc-500 mb-1 flex justify-between">
            <span>FUEL</span>
            <span className={dangerFuelCritical ? "text-[#FF3B00]" : warnFuelLow ? "text-amber-400" : "text-white"}>
              {fuelPct.toFixed(0)}%
            </span>
          </div>
          <Bar value={fuel / cfg.initialFuel} warn={warnFuelLow} danger={dangerFuelCritical} />
        </div>
        <div className="mt-2">
          <div className="font-mono text-[9px] tracking-widest text-zinc-500 mb-1 flex justify-between">
            <span>THROTTLE</span>
            <span className="text-white">{(throttle * 100).toFixed(0)}%</span>
          </div>
          <Bar value={throttle} />
        </div>
        <div className="mt-3 font-mono text-[9px] tracking-widest text-zinc-500 flex justify-between">
          <span>DISTANCE TO PRIMARY LZ</span>
          <span className="text-white tabular">{distanceToLZ.toFixed(1)} m</span>
        </div>
      </div>

      {/* RIGHT: keys / touch controls */}
      <div className="absolute bottom-6 right-4 md:right-8 hud-panel corners px-5 py-4 z-30" data-testid="descent-hud-right">
        <div className="font-mono text-[10px] tracking-[0.3em] text-zinc-500 mb-3">
          FLIGHT CONTROLS
        </div>
        <div className="grid grid-cols-3 gap-2 place-items-center">
          <div />
          <button
            onMouseDown={() => (inputRef.current.throttle = true)}
            onMouseUp={() => (inputRef.current.throttle = false)}
            onMouseLeave={() => (inputRef.current.throttle = false)}
            onTouchStart={(e) => { e.preventDefault(); inputRef.current.throttle = true; }}
            onTouchEnd={() => (inputRef.current.throttle = false)}
            data-testid="ctrl-throttle"
            className="w-14 h-14 border border-white/25 hover:border-[#FF3B00] hover:bg-[#FF3B00]/20 flex items-center justify-center text-white"
          >
            <ArrowUp size={20} />
          </button>
          <div />
          <button
            onMouseDown={() => (inputRef.current.left = true)}
            onMouseUp={() => (inputRef.current.left = false)}
            onMouseLeave={() => (inputRef.current.left = false)}
            onTouchStart={(e) => { e.preventDefault(); inputRef.current.left = true; }}
            onTouchEnd={() => (inputRef.current.left = false)}
            data-testid="ctrl-left"
            className="w-14 h-14 border border-white/25 hover:border-white flex items-center justify-center text-white"
          >
            <ArrowLeft size={20} />
          </button>
          <div className="w-14 h-14 border border-white/10 flex items-center justify-center font-mono text-[9px] text-zinc-500">
            RCS
          </div>
          <button
            onMouseDown={() => (inputRef.current.right = true)}
            onMouseUp={() => (inputRef.current.right = false)}
            onMouseLeave={() => (inputRef.current.right = false)}
            onTouchStart={(e) => { e.preventDefault(); inputRef.current.right = true; }}
            onTouchEnd={() => (inputRef.current.right = false)}
            data-testid="ctrl-right"
            className="w-14 h-14 border border-white/25 hover:border-white flex items-center justify-center text-white"
          >
            <ArrowRight size={20} />
          </button>
          <button
            onMouseDown={() => (inputRef.current.strafeLeft = true)}
            onMouseUp={() => (inputRef.current.strafeLeft = false)}
            onTouchStart={(e) => { e.preventDefault(); inputRef.current.strafeLeft = true; }}
            onTouchEnd={() => (inputRef.current.strafeLeft = false)}
            data-testid="ctrl-strafe-left"
            className="w-14 h-10 border border-white/25 hover:border-white flex items-center justify-center text-zinc-400 text-[10px] font-mono"
          >
            ◄ RCS
          </button>
          <div className="w-14 h-10 border border-white/10 flex items-center justify-center font-mono text-[8px] text-zinc-600 leading-tight text-center">
            Q · E<br/>STRAFE
          </div>
          <button
            onMouseDown={() => (inputRef.current.strafeRight = true)}
            onMouseUp={() => (inputRef.current.strafeRight = false)}
            onTouchStart={(e) => { e.preventDefault(); inputRef.current.strafeRight = true; }}
            onTouchEnd={() => (inputRef.current.strafeRight = false)}
            data-testid="ctrl-strafe-right"
            className="w-14 h-10 border border-white/25 hover:border-white flex items-center justify-center text-zinc-400 text-[10px] font-mono"
          >
            RCS ►
          </button>
        </div>
        <div className="mt-3 font-mono text-[9px] tracking-widest text-zinc-500 leading-relaxed">
          SPACE · THROTTLE<br/>
          A/D · TILT · Q/E · STRAFE<br/>
          P · PAUSE · C · CYCLE VIEW
        </div>
      </div>

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
