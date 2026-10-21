import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { CHUTES } from "@/data/reentryPhysics";
import { DROGUE, MAIN, M_PER_UNIT, chuteRelease, mainCanopyCentres } from "@/data/descentScene";
import { SEA_HEIGHT_GLSL } from "@/components/scenes/descent/Ocean";

/*
 * The parachutes, at Apollo's sizes (data/descentScene MAIN, DROGUE), in the world: the canopies
 * hang above the capsule on long suspension lines that converge on the riser above its apex.
 * Deployment and inflation come from the reentry simulation (drogueT, mainT, CHUTES inflateTime):
 * nothing here changes when they open. Ringsail mains: 32 gores, orange and white, a darker band,
 * the ringsail's slots between its rings, an open vent; they breathe a little and sway.
 *
 * The fabric is lit as fabric: the Sun on the outside, and through it (nylon is translucent: seen
 * from below, a canopy with the Sun on its far side glows), the seams and slots darker, the sky's
 * light in the shadows. At splashdown the mains are released: they come down beside the capsule,
 * downwind, and settle on the sea, draped over the very swell that is drawn (the same waves),
 * crumpled, wet and partly awash. The drogues were cut away when the mains opened.
 */

const ORANGE = new THREE.Color("#cf5f2c");
const WHITE = new THREE.Color("#ebe7de");
const BAND = new THREE.Color("#5a4232");

/** A canopy: skirt at y = 0 (radius 1), crown up to y = 1 (scaled by depth), gores bulging between seams. */
function canopyGeometry(gores, rings = 10, vent = 0.08) {
  const pos = [];
  const col = [];
  const nrm = [];
  const uvs = [];
  const pt = (s, th) => {
    // s: 0 at the vent .. 1 at the skirt
    const a = (s * Math.PI) / 2;
    const f = (th * gores) / (Math.PI * 2);
    const bulge = 1 + 0.045 * Math.sin(Math.PI * (f - Math.floor(f)));
    const r = (vent + (1 - vent) * Math.sin(a)) * bulge;
    return [Math.cos(th) * r, Math.cos(a) * (1 - 0.1 * s), Math.sin(th) * r];
  };
  for (let g = 0; g < gores; g++) {
    const t0 = (g / gores) * Math.PI * 2;
    const t1 = ((g + 1) / gores) * Math.PI * 2;
    for (let i = 0; i < rings; i++) {
      const s0 = i / rings;
      const s1 = (i + 1) / rings;
      const c = (s0 + s1) / 2 > 0.36 && (s0 + s1) / 2 < 0.44 ? BAND : g % 2 ? WHITE : ORANGE;
      const steps = 3; // subdivide the gore so its bulge is round
      for (let k = 0; k < steps; k++) {
        const a0 = t0 + ((t1 - t0) * k) / steps;
        const a1 = t0 + ((t1 - t0) * (k + 1)) / steps;
        const u0 = k / steps;
        const u1 = (k + 1) / steps;
        const q = [
          [pt(s0, a0), s0, u0, a0],
          [pt(s0, a1), s0, u1, a1],
          [pt(s1, a0), s1, u0, a0],
          [pt(s1, a1), s1, u1, a1],
        ];
        [q[0], q[2], q[1], q[1], q[2], q[3]].forEach(([p, s, u, th]) => {
          pos.push(...p);
          col.push(c.r, c.g, c.b);
          const l = Math.hypot(p[0], p[1] * 0.6, p[2]) || 1;
          nrm.push(p[0] / l, (p[1] * 0.6) / l, p[2] / l);
          // s along the gore (vent 0 .. skirt 1), across the gore (0..1), and the angle round
          uvs.push(s, u, th);
        });
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  geo.setAttribute("aGore", new THREE.Float32BufferAttribute(uvs, 3));
  return geo;
}

const canopyVertex = `
attribute vec3 color;
attribute vec3 aGore;
uniform float uFlat;    // 0 flying .. 1 lying on the sea
uniform float uSeaY;
uniform vec2 uDrift;
uniform float uTime;
uniform float uRings;
uniform float uSink;
varying vec3 vCol;
varying vec3 vN;
varying vec3 vW;
varying vec3 vGore;
varying float vWet;
${SEA_HEIGHT_GLSL}
void main() {
  vec4 w = modelMatrix * vec4(position, 1.0);
  vec3 n = normalize(mat3(modelMatrix) * normal);
  if (uFlat > 0.0) {
    // released: the fabric settles on the swell, crumpled into folds, partly awash
    vec2 m = (w.xz + uDrift) * ${M_PER_UNIT.toFixed(2)};
    float sea = uSeaY + seaHeight(m, uTime) / ${M_PER_UNIT.toFixed(2)};
    // folds and trapped air lift the fabric in ridges; the rest lies on the water
    float fold = max(0.0, sin(aGore.z * 16.0 + aGore.x * 9.0)) * 0.05 + max(0.0, sin(aGore.x * 13.0 + aGore.z * 5.0)) * 0.04 + (0.5 + 0.5 * sin(aGore.z * 3.0 + 1.3)) * 0.03;
    // (a little proud of the drawn surface, which the grid interpolates and the crests crowd)
    float y = sea + fold * (0.5 + 0.5 * aGore.x) + 0.07 - uSink;
    w.y = mix(w.y, y, uFlat);
    n = normalize(mix(n, vec3(0.0, 1.0, 0.0) + vec3(cos(aGore.z * 16.0), 0.0, sin(aGore.x * 23.0)) * 0.35, uFlat));
  }
  vWet = uFlat;
  vCol = color;
  vN = n;
  vW = w.xyz;
  vGore = aGore;
  gl_Position = projectionMatrix * viewMatrix * w;
}`;

const canopyFragment = `
uniform vec3 uSun;
uniform vec3 uSkyTop;
uniform vec3 uSkyHor;
uniform float uRings;
varying vec3 vCol;
varying vec3 vN;
varying vec3 vW;
varying vec3 vGore;
varying float vWet;
void main() {
  vec3 n = normalize(vN);
  if (!gl_FrontFacing) n = -n;
  vec3 v = normalize(cameraPosition - vW);
  // the ringsail: narrow slots between its rings, seams between the gores, the vent open
  float ring = fract(vGore.x * uRings);
  float slot = smoothstep(0.06, 0.0, ring) * step(0.12, vGore.x);
  float seam = smoothstep(0.05, 0.0, min(vGore.y, 1.0 - vGore.y));
  vec3 albedo = vCol * (1.0 - 0.35 * seam);
  float ndl = dot(n, uSun);
  // the outside in the Sun, and the Sun through the fabric seen from the other side (translucent nylon)
  float lit = max(ndl, 0.0);
  float through = max(-ndl, 0.0) * (1.0 - 0.6 * slot);
  vec3 sunCol = vec3(1.0, 0.96, 0.9);
  vec3 sky = mix(uSkyHor, uSkyTop, clamp(n.y * 0.5 + 0.5, 0.0, 1.0)) * 0.55 + vec3(0.08);
  vec3 col = albedo * (sky * 0.7 + sunCol * (lit * 0.95 + through * 0.55 * (0.6 + 0.4 * vCol.r)));
  // a slot shows the sky (or the fabric beyond) through it: darker against the light
  col *= 1.0 - 0.45 * slot;
  // a soft sheen across the fabric's curve
  col += sunCol * pow(max(dot(reflect(-uSun, n), v), 0.0), 12.0) * 0.06;
  // wet on the sea: the orange darker, the white nylon still white (a little of the water's blue)
  col = mix(col, col * mix(vec3(0.6, 0.66, 0.74), vec3(0.92, 0.96, 1.0), smoothstep(0.5, 0.85, vCol.g)), vWet * 0.8);
  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}`;

function canopyMaterial(atmo, rings) {
  return new THREE.ShaderMaterial({
    uniforms: {
      uSun: { value: atmo.sun },
      uSkyTop: { value: atmo.top },
      uSkyHor: { value: atmo.hor },
      uFlat: { value: 0 },
      uSeaY: { value: 0 },
      uDrift: { value: new THREE.Vector2() },
      uTime: { value: 0 },
      uRings: { value: rings },
      uSink: { value: 0 },
    },
    vertexShader: canopyVertex,
    fragmentShader: canopyFragment,
    side: THREE.DoubleSide,
  });
}

const inflation = (s, which) => {
  const t0 = which === "main" ? s.mainT : s.drogueT;
  if (t0 === null || t0 === undefined) return 0;
  return Math.min(1, Math.max(0, (s.t - t0) / CHUTES[which].inflateTime));
};

const UP = new THREE.Vector3(0, 1, 0);
const _a = new THREE.Vector3();
const _b = new THREE.Vector3();
const _c = new THREE.Vector3();
const _q = new THREE.Quaternion();
const LINES_PER = 28;

export default function Chutes({ simRef, viewRef, poseRef, atmo }) {
  const mains = useRef([]);
  const drogues = useRef([]);
  const lines = useRef();
  const mainGeo = useMemo(() => canopyGeometry(MAIN.gores), []);
  const drogueGeo = useMemo(() => canopyGeometry(DROGUE.gores, 6, 0.12), []);
  const mat = useMemo(() => canopyMaterial(atmo, 10), [atmo]);
  const drogueMat = useMemo(() => canopyMaterial(atmo, 6), [atmo]);
  const lineGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array((3 * LINES_PER + 2 * 8 + 3) * 2 * 3), 3));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    return g;
  }, []);
  const lineMat = useMemo(() => new THREE.LineBasicMaterial({ color: "#e4e0d6", transparent: true, opacity: 0.5, depthWrite: false }), []);
  useEffect(() => () => [mainGeo, drogueGeo, mat, drogueMat, lineGeo, lineMat].forEach((x) => x.dispose()), [mainGeo, drogueGeo, mat, drogueMat, lineGeo, lineMat]);
  const released = useRef(null); // the canopies' places at splashdown

  useFrame((state) => {
    const s = simRef.current;
    const v = viewRef.current;
    const pose = poseRef.current;
    if (!s || !pose) return;
    const t = state.clock.elapsedTime;
    const dU = inflation(s, "drogue");
    const mU = inflation(s, "main");
    const splashed = v.phase === "SPLASHED";
    const failed = v.phase === "FAILED";
    // the riser's confluence above the apex
    const conf = _c.set(0, 0.77 + MAIN.confluence, 0).applyQuaternion(pose.quat).add(pose.pos);
    const P = lineGeo.attributes.position.array;
    let n = 0;
    const seg = (a, b) => {
      P[n++] = a.x; P[n++] = a.y; P[n++] = a.z;
      P[n++] = b.x; P[n++] = b.y; P[n++] = b.z;
    };

    // ---- mains
    const showMain = s.mainT !== null && !failed;
    const rel = splashed ? chuteRelease(v.phaseT || 0) : null;
    const centres = mainCanopyCentres(mU);
    if (splashed && !released.current) {
      // where each canopy hung at contact (computed, so a scene that opens on the sea has them too)
      released.current = centres.map((c) => {
        const p = new THREE.Vector3(conf.x + c[0], conf.y + c[1], conf.z + c[2]);
        const q = new THREE.Quaternion().setFromUnitVectors(UP, _a.copy(p).sub(conf).normalize());
        return { p, q };
      });
    }
    if (!splashed) released.current = null;
    const U = mat.uniforms;
    U.uFlat.value = rel ? rel.flat : 0;
    U.uSink.value = rel ? rel.sink : 0;
    U.uSeaY.value = atmo.seaY;
    U.uDrift.value.set(atmo.drift, 0);
    U.uTime.value = t;
    const R = MAIN.radius * (0.12 + 0.88 * Math.pow(mU, 1.5));
    const depth = R * (0.62 + 0.55 * (1 - mU));
    let lineFade = 1;
    mains.current.forEach((m, i) => {
      if (!m) return;
      m.visible = showMain;
      if (!showMain) return;
      const breathe = 1 + 0.022 * Math.sin(t * 1.25 + i * 2.1);
      if (!rel) {
        const c = centres[i];
        const sway = 0.35 * Math.sin(t * 0.37 + i * 1.7);
        m.position.set(conf.x + c[0] + sway, conf.y + c[1], conf.z + c[2] + 0.3 * Math.cos(t * 0.29 + i));
        // the canopy's axis points away from the confluence (its mouth towards the capsule)
        _a.copy(m.position).sub(conf).normalize();
        m.quaternion.setFromUnitVectors(UP, _a);
        m.scale.set(R * breathe, depth, R * breathe);
      } else {
        // released: down onto the sea beside the capsule, drifting downwind, settling on the swell
        const r0 = released.current && released.current[i];
        if (r0) {
          const seaY = atmo.seaY + 0.05;
          // downwind: away from the recovery camera
          m.position.set(r0.p.x - rel.drift * 0.75 - i * 1.5, r0.p.y + (seaY - r0.p.y) * rel.drop, r0.p.z - rel.drift * 0.65);
          _q.setFromUnitVectors(UP, UP);
          m.quaternion.copy(r0.q).slerp(_q, Math.min(1, rel.drop * 1.2));
          // collapsing as it settles: the fabric spread smaller on the sea, draped over the waves (shader)
          // falling, the canopy deflates into a long streamer; on the sea it spreads again
          const fall = rel.drop * (1 - rel.flat);
          const rad = MAIN.radius * (1 - 0.6 * fall) * (1 - 0.3 * rel.flat);
          m.scale.set(rad, Math.max(0.05, depth * (1 + 0.8 * fall) * (1 - 0.9 * rel.flat)), rad * (1 + 0.05 * rel.flat));
        }
        lineFade = Math.max(0, 1 - rel.drop * 1.6);
      }
      // suspension lines: skirt to the confluence
      if (lineFade > 0.01) {
        for (let k = 0; k < LINES_PER; k++) {
          const th = (k / LINES_PER) * Math.PI * 2;
          _b.set(Math.cos(th), 0, Math.sin(th)).multiply(m.scale).applyQuaternion(m.quaternion).add(m.position);
          seg(_b, rel ? _b : conf);
        }
      }
    });
    if (showMain && !rel) {
      // the risers: confluence to the apex
      _a.set(0, 0.77, 0).applyQuaternion(pose.quat).add(pose.pos);
      for (let k = 0; k < 3; k++) seg(conf, _a);
    }

    // ---- drogues (cut away when the mains open)
    const showDrogue = s.drogueT !== null && mU < 0.15 && !failed && !splashed;
    drogues.current.forEach((m, i) => {
      if (!m) return;
      m.visible = showDrogue;
      if (!showDrogue) return;
      const R2 = DROGUE.radius * (0.25 + 0.75 * dU);
      const a = i * Math.PI + 0.6;
      const lat = Math.sin(DROGUE.spread) * DROGUE.lineLen;
      m.position.set(conf.x + Math.cos(a) * lat + 0.15 * Math.sin(t * 2.1 + i), conf.y + Math.cos(DROGUE.spread) * DROGUE.lineLen, conf.z + Math.sin(a) * lat);
      _a.copy(m.position).sub(conf).normalize();
      m.quaternion.setFromUnitVectors(UP, _a);
      m.scale.set(R2, R2 * 1.1, R2);
      for (let k = 0; k < 8; k++) {
        const th = (k / 8) * Math.PI * 2;
        _b.set(Math.cos(th), 0, Math.sin(th)).multiply(m.scale).applyQuaternion(m.quaternion).add(m.position);
        seg(_b, conf);
      }
    });

    while (n < P.length) P[n++] = 0;
    lineGeo.attributes.position.needsUpdate = true;
    if (lines.current) lines.current.visible = (showMain || showDrogue) && lineFade > 0.01;
    lineMat.opacity = 0.5 * lineFade;
  });

  return (
    <group name="parachutes">
      {[0, 1, 2].map((i) => (
        <mesh key={i} ref={(el) => (mains.current[i] = el)} geometry={mainGeo} material={mat} visible={false} />
      ))}
      {[0, 1].map((i) => (
        <mesh key={`d${i}`} ref={(el) => (drogues.current[i] = el)} geometry={drogueGeo} material={drogueMat} visible={false} />
      ))}
      <lineSegments ref={lines} geometry={lineGeo} material={lineMat} frustumCulled={false} />
    </group>
  );
}
