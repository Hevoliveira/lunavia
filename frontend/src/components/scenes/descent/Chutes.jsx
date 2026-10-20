import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { CHUTES } from "@/data/reentryPhysics";
import { DROGUE, MAIN, chuteRelease, mainCanopyCentres } from "@/data/descentScene";

/*
 * The parachutes, at Apollo's sizes (data/descentScene MAIN, DROGUE), in the world: the canopies
 * hang above the capsule on long suspension lines that converge on the riser above its apex.
 * Deployment and inflation come from the reentry simulation (drogueT, mainT, CHUTES inflateTime):
 * nothing here changes when they open. Ringsail mains: 32 gores, orange and white, a darker band
 * and an open vent; they breathe a little and sway. At splashdown the mains are released: they
 * come down beside the capsule and lie spread on the sea, downwind; the drogues were cut away when
 * the mains opened.
 */

const ORANGE = new THREE.Color("#e2531f");
const WHITE = new THREE.Color("#f2efe8");
const BAND = new THREE.Color("#6b4a3a");

/** A canopy: skirt at y = 0 (radius 1), crown up to y = 1 (scaled by depth), gores bulging between seams. */
function canopyGeometry(gores, rings = 10, vent = 0.08) {
  const pos = [];
  const col = [];
  const nrm = [];
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
        const q = [pt(s0, a0), pt(s0, a1), pt(s1, a0), pt(s1, a1)];
        [q[0], q[2], q[1], q[1], q[2], q[3]].forEach((p) => {
          pos.push(...p);
          col.push(c.r, c.g, c.b);
          const l = Math.hypot(p[0], p[1] * 0.6, p[2]) || 1;
          nrm.push(p[0] / l, (p[1] * 0.6) / l, p[2] / l);
        });
      }
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(nrm, 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  return geo;
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
const LINES_PER = 16;

export default function Chutes({ simRef, viewRef, poseRef, atmo }) {
  const mains = useRef([]);
  const drogues = useRef([]);
  const lines = useRef();
  const mainGeo = useMemo(() => canopyGeometry(MAIN.gores), []);
  const drogueGeo = useMemo(() => canopyGeometry(DROGUE.gores, 6, 0.12), []);
  const mat = useMemo(() => new THREE.MeshStandardMaterial({ vertexColors: true, side: THREE.DoubleSide, roughness: 0.82, metalness: 0, emissive: new THREE.Color("#3a2015"), emissiveIntensity: 0.25 }), []);
  const lineGeo = useMemo(() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute("position", new THREE.BufferAttribute(new Float32Array((3 * LINES_PER + 2 * 8 + 3) * 2 * 3), 3));
    g.boundingSphere = new THREE.Sphere(new THREE.Vector3(), 1e6);
    return g;
  }, []);
  const lineMat = useMemo(() => new THREE.LineBasicMaterial({ color: "#ddd8cc", transparent: true, opacity: 0.55, depthWrite: false }), []);
  useEffect(() => () => [mainGeo, drogueGeo, mat, lineGeo, lineMat].forEach((x) => x.dispose()), [mainGeo, drogueGeo, mat, lineGeo, lineMat]);
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
        // released: down onto the sea beside the capsule, flattening, drifting downwind
        const r0 = released.current && released.current[i];
        if (r0) {
          const seaY = atmo.seaY + 0.05;
          // downwind: away from the recovery camera
          m.position.set(r0.p.x - rel.drift * 0.75 - i * 1.5, r0.p.y + (seaY - r0.p.y) * rel.drop, r0.p.z - rel.drift * 0.65);
          _q.setFromUnitVectors(UP, UP);
          m.quaternion.copy(r0.q).slerp(_q, Math.min(1, rel.drop * 1.2));
          // collapsing as it settles: the fabric lies in a smaller, flat, wet heap on the sea
          m.scale.set(MAIN.radius * (1 - 0.35 * rel.flat), Math.max(0.05, depth * (1 - 0.97 * rel.flat)), MAIN.radius * (1 - 0.3 * rel.flat));
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
    lineMat.opacity = 0.55 * lineFade;
  });

  return (
    <group name="parachutes">
      {[0, 1, 2].map((i) => (
        <mesh key={i} ref={(el) => (mains.current[i] = el)} geometry={mainGeo} material={mat} visible={false} />
      ))}
      {[0, 1].map((i) => (
        <mesh key={`d${i}`} ref={(el) => (drogues.current[i] = el)} geometry={drogueGeo} material={mat} visible={false} />
      ))}
      <lineSegments ref={lines} geometry={lineGeo} material={lineMat} frustumCulled={false} />
    </group>
  );
}
