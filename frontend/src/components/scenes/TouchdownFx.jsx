import { useRef, useMemo, useEffect } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import LanderModel from "@/components/LanderModel";
import {
  DUST,
  LM,
  dustLevel,
  dustSpeed,
  legContact,
  padHeights,
  padOffsets,
  plumeCenter,
  probeBend,
  sceneAlt,
  settleLegs,
  settleStart,
  settleStep,
} from "@/data/touchdownFx";

/*
 * The final metres of the lunar descent, drawn from the authoritative descent
 * state (physRef) through data/touchdownFx. `fx` is one mutable object shared
 * by these components and the camera; nothing here feeds back into the
 * simulation or the grading.
 *
 *   LanderRig     the LM: stretched vertical scale near the ground, legs that
 *                 meet the surface, probes, and the settle after touchdown.
 *   RegolithSheet the blown regolith: straight, flat, fast streaks (vacuum),
 *                 one instanced draw call, all motion in the vertex shader.
 *   GroundMarks   plume scour on the surface, the blast zone left behind,
 *                 and contact shadows under the LM and each footpad.
 */

const DEG = Math.PI / 180;
export const WORLD_X = 0.5; // physics metres -> scene units (horizontal)

/** The shared presentation state for one descent. */
export function createTouchdownFx() {
  return {
    thrust: 0,
    comp: [0, 0, 0, 0],
    probe: [0, 0, 0, 0],
    padH: [1, 1, 1, 1], // footpad heights above ground (scene units)
    padY: 0, // footpad plane height on the axis (scene units)
    x: 0, // scene x of the LM
    tilt: 0, // drawn attitude (deg)
    dust: 0, // regolith sheet level 0..1 (smoothed)
    center: 0, // scene x where the plume meets the ground
    cut: 1e9, // scene clock (s) when emission stopped
    plan: null, // touchdownPlan once the simulation has captured touchdown
    settle: null,
    touchAt: null, // scene clock (s) at touchdown
  };
}

export function LanderRig({ physRef, fx, hidden = false }) {
  const ref = useRef();
  useFrame((state, delta) => {
    const p = physRef.current;
    const g = ref.current;
    if (!p || !g) return;
    window.__lvDescentFx = fx; // validation tooling (read-only)
    const now = state.clock.elapsedTime;
    const dt = Math.min(0.05, delta);
    let H;
    let tilt;
    let legs;
    let target;
    if (fx.plan) {
      // Touchdown has been captured and graded: play out the settle.
      if (!fx.settle) {
        fx.settle = settleStart(fx.plan, fx.padY);
        fx.touchAt = now;
        fx.cut = now + 0.22; // the footpads' kick-up is the last of the dust
      }
      settleStep(fx.settle, fx.plan, dt);
      legs = settleLegs(fx.settle, fx.plan);
      H = fx.settle.H + legs.lift;
      tilt = fx.settle.tilt;
      fx.thrust = Math.max(0, fx.thrust - dt / 0.08); // engine stop: the plume dies in a blink
      target = now < fx.cut ? Math.max(fx.dust, fx.plan.burst) : fx.dust;
    } else {
      H = sceneAlt(p.alt);
      tilt = p.tilt;
      legs = legContact(H, tilt);
      H += legs.lift;
      fx.thrust = p.fuel > 0 ? p.throttle : 0;
      target = dustLevel(p.alt, fx.thrust);
      fx.center = plumeCenter(p.xPos * WORLD_X, H, tilt);
    }
    // In vacuum nothing lingers: after the cut the grains already in flight
    // finish their straight run (the level is held), then there is nothing.
    if (now > fx.cut + DUST.life) fx.dust = 0;
    else if (now <= fx.cut) fx.dust += (target - fx.dust) * Math.min(1, dt / 0.12);
    const hs = padHeights(H, tilt);
    for (let k = 0; k < 4; k++) {
      fx.comp[k] = legs.comp[k];
      fx.padH[k] = Math.max(0, hs[k] + legs.comp[k]);
      fx.probe[k] = probeBend(fx.padH[k]);
    }
    fx.padY = H;
    fx.x = p.xPos * WORLD_X;
    fx.tilt = tilt;
    g.position.set(fx.x, H + LM.foot, 0);
    g.rotation.z = -tilt * DEG;
    g.visible = !hidden; // from the cockpit window the LM's own deck is not in view
  });
  return (
    <group ref={ref}>
      <LanderModel scale={LM.scale} fx={fx} />
    </group>
  );
}

/* ---- regolith sheet ---------------------------------------------------------- */
const DUST_VERT = /* glsl */ `
  attribute vec4 aSeed; // azimuth, speed, phase, height/size (all 0..1)
  uniform float uTime, uLife, uCut, uLevel, uSpeed, uR0, uClear, uMaxAlpha, uBias;
  uniform vec2 uCenter;
  varying vec2 vUv;
  varying float vAlpha;
  varying float vShade;
  void main() {
    float life = uLife * (0.75 + 0.5 * aSeed.w);
    float age = fract(uTime / life + aSeed.z);
    float birth = uTime - age * life;
    float born = step(birth, uCut);
    float az = aSeed.x * 6.2831853;
    vec2 dir = vec2(cos(az), sin(az));
    // the sheet is fuller on the side the plume leans towards
    float spd = uSpeed * (0.55 + 0.9 * aSeed.y) * (1.0 + uBias * -dir.x);
    float r = uR0 + spd * age * life;
    // flat ballistic flight: 1-3 degrees above the surface, no billowing
    float y = 0.015 + (0.012 + 0.04 * aSeed.w) * r;
    vec3 c = vec3(uCenter.x + dir.x * r, y, uCenter.y + dir.y * r);
    // fewer grains when the plume is weak, all of them at full effect
    float present = step(fract(aSeed.x * 91.7 + aSeed.y * 13.3), 0.3 + 0.7 * uLevel);
    vAlpha = uLevel * uMaxAlpha * born * present
      * pow(1.0 - age, 1.4) * smoothstep(0.0, 0.07, age)
      * smoothstep(uClear, uClear + 0.9, r) * (1.0 - smoothstep(9.0, 15.0, r));
    vShade = 0.82 + 0.3 * aSeed.w;
    // a streak stretched along its direction of flight, as the eye sees fast grains
    vec4 v = viewMatrix * vec4(c, 1.0);
    vec3 vel = (viewMatrix * vec4(dir.x, 0.03, dir.y, 0.0)).xyz;
    vec2 ax = normalize(vel.xy + vec2(1e-5));
    vec2 pp = vec2(-ax.y, ax.x);
    float len = 0.22 + spd * 0.075;
    float wid = 0.06 + 0.1 * aSeed.w;
    v.xy += ax * position.x * len + pp * position.y * wid;
    vUv = position.xy + 0.5;
    gl_Position = projectionMatrix * v;
  }
`;
const DUST_FRAG = /* glsl */ `
  uniform vec3 uColor;
  varying vec2 vUv;
  varying float vAlpha;
  varying float vShade;
  void main() {
    float across = 1.0 - abs(vUv.y * 2.0 - 1.0);
    float along = smoothstep(0.0, 0.35, vUv.x) * smoothstep(1.0, 0.55, vUv.x);
    float a = vAlpha * across * along;
    if (a < 0.004) discard;
    gl_FragColor = vec4(uColor * vShade, a);
  }
`;

export function RegolithSheet({ fx }) {
  const mesh = useMemo(() => {
    const quad = new THREE.PlaneGeometry(1, 1);
    const g = new THREE.InstancedBufferGeometry();
    g.index = quad.index;
    g.setAttribute("position", quad.getAttribute("position"));
    const seeds = new Float32Array(DUST.count * 4);
    let s = 1234567;
    const rnd = () => ((s = (s * 16807) % 2147483647) / 2147483647);
    for (let i = 0; i < seeds.length; i++) seeds[i] = rnd();
    g.setAttribute("aSeed", new THREE.InstancedBufferAttribute(seeds, 4));
    g.instanceCount = DUST.count;
    const m = new THREE.ShaderMaterial({
      vertexShader: DUST_VERT,
      fragmentShader: DUST_FRAG,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uTime: { value: 0 },
        uLife: { value: DUST.life },
        uCut: { value: 1e9 },
        uLevel: { value: 0 },
        uSpeed: { value: 7 },
        uR0: { value: 0.4 },
        uClear: { value: DUST.clearRadius },
        uMaxAlpha: { value: DUST.maxAlpha },
        uBias: { value: 0 },
        uCenter: { value: new THREE.Vector2() },
        uColor: { value: new THREE.Color("#e9e2d3") },
      },
    });
    const mm = new THREE.Mesh(g, m);
    mm.frustumCulled = false;
    mm.renderOrder = 1;
    return mm;
  }, []);
  useEffect(() => () => {
    mesh.geometry.dispose();
    mesh.material.dispose();
  }, [mesh]);
  useFrame((state) => {
    const u = mesh.material.uniforms;
    u.uTime.value = state.clock.elapsedTime;
    u.uCut.value = fx.cut;
    u.uLevel.value = fx.dust;
    u.uSpeed.value = dustSpeed(fx.dust);
    u.uR0.value = 0.35 + 0.25 * fx.padY;
    u.uBias.value = Math.max(-0.5, Math.min(0.5, fx.tilt / 30));
    u.uCenter.value.set(fx.center, 0);
    mesh.visible = fx.dust > 0.002;
  });
  return <primitive object={mesh} />;
}

/* ---- marks on the ground ----------------------------------------------------- */
const SCOUR_FRAG = /* glsl */ `
  uniform float uLevel;
  uniform vec3 uColor;
  uniform float uStreaks;
  uniform float uFlow; // outward flow speed (uv radius per second), 0 = static
  uniform float uTime;
  uniform float uClear; // inner radius kept clear (uv radius)
  varying vec2 vUv;
  void main() {
    vec2 d = vUv - 0.5;
    float r = length(d) * 2.0;
    float a = atan(d.y, d.x);
    float rays = 0.55 + 0.45 * sin(a * 41.0 + sin(a * 7.0) * 3.0) * sin(a * 23.0 - 1.3);
    // bands of regolith racing outward along the rays
    float flow = uFlow > 0.0 ? 0.55 + 0.45 * sin(r * 26.0 - uTime * uFlow * 26.0 + rays * 4.0) : 1.0;
    float streak = mix(1.0, rays * flow, uStreaks);
    float fall = smoothstep(1.0, 0.25, r) * smoothstep(uClear, uClear + 0.14, r);
    gl_FragColor = vec4(uColor, uLevel * fall * streak);
  }
`;
const PLAIN_VERT = /* glsl */ `
  varying vec2 vUv;
  void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
`;

function blobTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  const grd = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  grd.addColorStop(0, "rgba(0,0,0,1)");
  grd.addColorStop(0.55, "rgba(0,0,0,0.55)");
  grd.addColorStop(1, "rgba(0,0,0,0)");
  g.fillStyle = grd;
  g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

const HAZE_R = 5.5; // scene units: the moving sheet's reach on the ground

// Sun direction of the descent scene's key light (position 30, 40, 20).
const SHADOW_DX = -30 / 40;
const SHADOW_DZ = -20 / 40;

export function GroundMarks({ fx }) {
  const scour = useRef();
  const residue = useRef();
  const body = useRef();
  const pads = useRef([]);
  const { scourMat, residueMat, blobMat, padMats, tex } = useMemo(() => {
    const mk = (color, streaks, flow, clear) =>
      new THREE.ShaderMaterial({
        vertexShader: PLAIN_VERT,
        fragmentShader: SCOUR_FRAG,
        transparent: true,
        depthWrite: false,
        uniforms: {
          uLevel: { value: 0 },
          uColor: { value: new THREE.Color(color) },
          uStreaks: { value: streaks },
          uFlow: { value: flow },
          uTime: { value: 0 },
          uClear: { value: clear },
        },
      });
    const t = blobTexture();
    return {
      // the moving sheet: light regolith racing outward, clear of the footpads
      scourMat: mk("#f1ebde", 1, 1.1, DUST.clearRadius / HAZE_R),
      // the blast zone left behind: a slightly brighter, swept patch
      residueMat: mk("#e8e2d4", 0.6, 0, 0.08),
      blobMat: new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, opacity: 0 }),
      padMats: [0, 1, 2, 3].map(() => new THREE.MeshBasicMaterial({ map: t, transparent: true, depthWrite: false, opacity: 0 })),
      tex: t,
    };
  }, []);
  useEffect(() => () => {
    [scourMat, residueMat, blobMat, ...padMats].forEach((m) => m.dispose());
    tex.dispose();
  }, [scourMat, residueMat, blobMat, padMats, tex]);
  const offsets = useMemo(() => padOffsets(), []);

  useFrame((state) => {
    // plume scour, following the impingement point
    if (scour.current) {
      scour.current.position.set(fx.center, 0.004, 0);
      scourMat.uniforms.uLevel.value = 0.5 * fx.dust;
      scourMat.uniforms.uTime.value = state.clock.elapsedTime;
      scour.current.visible = fx.dust > 0.002;
    }
    // the blast zone stays where the LM came down
    if (residue.current) {
      const since = fx.touchAt == null ? -1 : state.clock.elapsedTime - fx.touchAt;
      residue.current.visible = since >= 0;
      if (since >= 0) {
        residue.current.position.set(fx.center, 0.003, 0);
        residueMat.uniforms.uLevel.value = 0.16 * Math.min(1, since / 0.4);
      }
    }
    // contact shadows: the LM's, offset away from the sun, and one under each footpad
    const h = fx.padY;
    if (body.current) {
      body.current.position.set(fx.x + SHADOW_DX * (h + 0.6), 0.006, SHADOW_DZ * (h + 0.6));
      const s = 2.2 + 0.25 * h;
      body.current.scale.set(s, s * 0.8, 1);
      blobMat.opacity = 0.42 * (1 - Math.min(1, h / 6));
      body.current.visible = blobMat.opacity > 0.01; // no draw call when there is nothing to see
    }
    const cos = Math.cos(fx.tilt * DEG);
    for (let k = 0; k < 4; k++) {
      const m = pads.current[k];
      if (!m) continue;
      m.position.set(fx.x + offsets[k][0] * cos + SHADOW_DX * fx.padH[k], 0.008, offsets[k][1] + SHADOW_DZ * fx.padH[k]);
      padMats[k].opacity = 0.6 * (1 - Math.min(1, fx.padH[k] / 0.45));
      m.visible = padMats[k].opacity > 0.01;
    }
  });

  return (
    <group>
      <mesh ref={scour} rotation={[-Math.PI / 2, 0, 0]} renderOrder={0}>
        <circleGeometry args={[HAZE_R, 64]} />
        <primitive object={scourMat} attach="material" />
      </mesh>
      <mesh ref={residue} rotation={[-Math.PI / 2, 0, 0]} renderOrder={0} visible={false}>
        <circleGeometry args={[2.4, 48]} />
        <primitive object={residueMat} attach="material" />
      </mesh>
      <mesh ref={body} rotation={[-Math.PI / 2, 0, 0]} renderOrder={0}>
        <planeGeometry args={[1, 1]} />
        <primitive object={blobMat} attach="material" />
      </mesh>
      {[0, 1, 2, 3].map((k) => (
        <mesh key={k} ref={(m) => (pads.current[k] = m)} rotation={[-Math.PI / 2, 0, 0]} scale={[0.42, 0.42, 1]} renderOrder={0}>
          <planeGeometry args={[1, 1]} />
          <primitive object={padMats[k]} attach="material" />
        </mesh>
      ))}
    </group>
  );
}
