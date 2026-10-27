import { useEffect, useMemo, useRef } from "react";
import { useFrame } from "@react-three/fiber";
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";
import { DOOR_LOCAL, HELI, HOIST_LOCAL } from "@/data/oceanRecovery";

/*
 * The recovery helicopter (OCEAN RECOVERY), after the Sikorsky SH-3 Sea King that recovered the
 * Apollo crews: a boat hull with a stepped planing bottom, the stub sponsons that carry the main
 * wheels, the twin engines on the cabin roof, a five-blade main rotor (18.9 m), the upswept tail
 * boom and pylon with a five-blade tail rotor on the port side, the starboard cargo door with the
 * rescue hoist above it. LUNAVIA's own recovery markings (no real unit's).
 *
 * Metres, nose +x, up +y, starboard +z; the origin is the body's middle (data/oceanRecovery).
 * A few merged, vertex-coloured meshes; the rotors are separate groups that spin.
 */

const SEC = (x) => {
  // the fuselage's cross-section at station x: half width, top, bottom (m)
  if (x >= 5.0) {
    const k = (x - 5.0) / 2.2; // the nose
    const c = Math.sqrt(Math.max(0, 1 - k * k));
    return { w: 0.98 * (0.25 + 0.75 * c), top: 0.05 + 0.95 * Math.sqrt(Math.max(0, 1 - Math.pow(k, 1.6))), bot: -1.18 + 0.7 * k * k, keel: 0.16 * (1 - k) };
  }
  if (x >= -2.9) return { w: 1.0, top: 1.0 + 0.06 * Math.sin(((x + 2.9) / 7.9) * Math.PI), bot: -1.22, keel: 0.2 };
  const k = (x + 2.9) / -6.5; // the tail boom, 0 .. 1 (x = -9.4)
  return { w: 1.0 - 0.7 * k, top: 1.06 + 0.1 * k, bot: -1.22 + (1.22 + 0.45) * Math.pow(k, 0.75), keel: 0.2 * (1 - k) };
};
const PAINT = {
  body: new THREE.Color("#7a8591"),
  belly: new THREE.Color("#a3a9ad"),
  dark: new THREE.Color("#22272c"),
  glass: new THREE.Color("#1a242c"),
  orange: new THREE.Color("#e2652d"),
  white: new THREE.Color("#e6e7e3"),
};

function loft() {
  const X0 = -9.4;
  const X1 = 7.2;
  const NX = 70;
  const NA = 40;
  const pos = [];
  const col = [];
  const idx = [];
  const n = 3; // superellipse exponent: a boxy section with rounded corners
  for (let i = 0; i <= NX; i++) {
    const x = X0 + ((X1 - X0) * i) / NX;
    const s = SEC(x);
    for (let j = 0; j < NA; j++) {
      const a = (j / NA) * Math.PI * 2;
      const c = Math.cos(a);
      const sn = Math.sin(a);
      const z = s.w * Math.sign(c) * Math.pow(Math.abs(c), 2 / n);
      let y = sn > 0 ? s.top * Math.pow(sn, 2 / n) : s.bot * Math.pow(-sn, 2 / n);
      if (sn < 0) y += s.keel * Math.pow(Math.abs(c), 1.5); // the V of the planing bottom
      pos.push(x, y, z);
      // the paint: grey upper, pale lower hull, an orange band round the boom, dark glazing on the nose
      let cc = y < -0.35 ? PAINT.belly : PAINT.body;
      if (x < -5.4 && x > -6.6) cc = PAINT.orange;
      if (x > 4.6 && x < 6.75 && y > 0.12) cc = PAINT.glass; // the cockpit's glazing
      if (x > 6.75 && y > 0.1 && Math.abs(z) < 0.5) cc = PAINT.dark; // the anti-glare nose
      if (x > 4.6 && x < 4.85 && y > 0.1) cc = PAINT.dark; // the windscreen frame
      col.push(cc.r, cc.g, cc.b);
    }
  }
  for (let i = 0; i < NX; i++) {
    for (let j = 0; j < NA; j++) {
      const a = i * NA + j;
      const b = i * NA + ((j + 1) % NA);
      const c = (i + 1) * NA + j;
      const d = (i + 1) * NA + ((j + 1) % NA);
      idx.push(a, c, b, b, c, d);
    }
  }
  // the end caps (nose tip and tail)
  const cap = (i, flip) => {
    const ctr = pos.length / 3;
    const base = i * NA;
    let cx = 0;
    let cy = 0;
    for (let j = 0; j < NA; j++) cy += pos[(base + j) * 3 + 1];
    cx = pos[base * 3];
    pos.push(cx, cy / NA, 0);
    const cc = i === 0 ? PAINT.body : PAINT.dark;
    col.push(cc.r, cc.g, cc.b);
    for (let j = 0; j < NA; j++) {
      const a = base + j;
      const b = base + ((j + 1) % NA);
      if (flip) idx.push(ctr, b, a);
      else idx.push(ctr, a, b);
    }
  };
  cap(0, false);
  cap(NX, true);
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute("color", new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

const paint = (g, c) => {
  const n = g.attributes.position.count;
  const a = new Float32Array(n * 3);
  for (let i = 0; i < n; i++) {
    a[i * 3] = c.r;
    a[i * 3 + 1] = c.g;
    a[i * 3 + 2] = c.b;
  }
  g.setAttribute("color", new THREE.BufferAttribute(a, 3));
  return g;
};
const clean = (g) => {
  const o = g.index ? g.toNonIndexed() : g;
  ["uv", "uv1", "uv2"].forEach((k) => o.deleteAttribute(k));
  return o;
};
const rod = (a, b, r, seg = 6) => {
  const A = new THREE.Vector3(...a);
  const B = new THREE.Vector3(...b);
  const g = new THREE.CylinderGeometry(r, r, A.distanceTo(B), seg, 1);
  g.applyQuaternion(new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), B.clone().sub(A).normalize()));
  return g.translate((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, (a[2] + b[2]) / 2);
};

function buildBody() {
  const parts = [clean(loft())]; // all non-indexed, or mergeGeometries gives null
  const add = (g, c) => parts.push(paint(clean(g), c));
  // the sponsons (stub floats with the main wheels), either side of the lower cabin
  for (const z of [-1, 1]) {
    add(new THREE.SphereGeometry(1, 16, 10).scale(1.45, 0.42, 0.42).translate(-0.4, -0.72, z * 1.32), PAINT.body);
    add(new THREE.CylinderGeometry(0.33, 0.33, 0.22, 14).rotateX(Math.PI / 2).translate(-0.4, -1.1, z * 1.38), PAINT.dark); // wheel
    add(rod([-0.4, -0.5, z * 0.95], [-0.4, -0.55, z * 1.2], 0.08), PAINT.body);
  }
  // the engine nacelles on the roof, the intakes forward, the exhausts aft
  for (const z of [-1, 1]) {
    add(new THREE.CapsuleGeometry(0.34, 2.6, 6, 12).rotateZ(Math.PI / 2).translate(1.0, 1.32, z * 0.42), PAINT.body);
    add(new THREE.CylinderGeometry(0.22, 0.22, 0.12, 12).rotateZ(Math.PI / 2).translate(2.7, 1.32, z * 0.42), PAINT.dark);
    add(new THREE.CylinderGeometry(0.2, 0.24, 0.5, 10).rotateZ(Math.PI / 2 + 0.35).translate(-0.6, 1.36, z * 0.62), PAINT.dark);
  }
  // the rotor pylon and mast fairing
  add(new THREE.CylinderGeometry(0.45, 0.7, 0.9, 14).translate(0.4, 1.75, 0), PAINT.body);
  add(new THREE.CylinderGeometry(0.16, 0.2, 0.45, 10).translate(0.4, 2.25, 0), PAINT.dark);
  // the tail pylon (fin) at the end of the boom, swept, and the starboard stabilizer
  const fin = new THREE.Shape();
  fin.moveTo(0, 0);
  fin.lineTo(-1.25, 0);
  fin.lineTo(-1.15, 2.2);
  fin.lineTo(-0.55, 2.35);
  fin.lineTo(0.25, 0.7);
  fin.closePath();
  const finG = new THREE.ExtrudeGeometry(fin, { depth: 0.22, bevelEnabled: false }).translate(0, 0, -0.11).translate(-8.15, 0.95, 0);
  add(finG, PAINT.body);
  add(new THREE.BoxGeometry(1.0, 0.08, 1.7).translate(-8.75, 2.6, 0.95), PAINT.body);
  // the cabin windows (dark), both sides, and the starboard door's frame
  for (const z of [-1, 1]) {
    for (const x of [-1.6, -0.6, 2.4, 3.4]) add(new THREE.BoxGeometry(0.42, 0.38, 0.02).translate(x, 0.42, z * 1.0), PAINT.glass);
    add(new THREE.BoxGeometry(0.62, 0.55, 0.02).translate(4.15, 0.45, z * 0.99), PAINT.glass); // the cockpit's side window
  }
  // the hoist: its boom over the door, the winch housing
  const hk = HOIST_LOCAL;
  add(rod([hk[0] + 0.25, hk[1] - 0.12, 0.85], [hk[0], hk[1], hk[2] - 0.12], 0.06), PAINT.white);
  add(new THREE.CylinderGeometry(0.13, 0.13, 0.36, 10).rotateZ(Math.PI / 2).translate(hk[0], hk[1] + 0.05, hk[2] - 0.12), PAINT.white);
  // the tail wheel
  add(rod([-6.9, -0.25, 0], [-6.9, -0.75, 0], 0.05), PAINT.dark);
  add(new THREE.CylinderGeometry(0.18, 0.18, 0.12, 10).rotateX(Math.PI / 2).translate(-6.9, -0.8, 0), PAINT.dark);
  // the radar / antenna dome under the cabin (ASW), and the nose pitot
  add(new THREE.SphereGeometry(0.32, 12, 8).scale(1, 0.45, 1).translate(1.2, -1.28, 0), PAINT.belly);
  add(rod([7.0, 0.3, 0.4], [7.6, 0.32, 0.4], 0.025, 4), PAINT.dark);
  return mergeGeometries(parts);
}

function buildMainRotor() {
  const blades = [];
  for (let i = 0; i < 5; i++) {
    const g = new THREE.BoxGeometry(HELI.rotorR - 0.35, 0.05, 0.46).translate((HELI.rotorR - 0.35) / 2 + 0.35, 0, 0);
    // a slight droop and twist
    g.rotateZ(-0.03);
    g.rotateY((i / 5) * Math.PI * 2);
    blades.push(clean(g));
  }
  const hub = clean(new THREE.CylinderGeometry(0.42, 0.42, 0.22, 14));
  return { blades: mergeGeometries(blades), hub };
}
function buildTailRotor() {
  const blades = [];
  for (let i = 0; i < 5; i++) {
    const g = new THREE.BoxGeometry(0.2, HELI.tailRotorR - 0.1, 0.03).translate(0, (HELI.tailRotorR - 0.1) / 2 + 0.1, 0);
    g.rotateZ((i / 5) * Math.PI * 2);
    blades.push(clean(g));
  }
  return mergeGeometries(blades);
}

// the spinning disc's faint blur (a ring of tone, densest towards the tips)
function blurTexture() {
  const c = document.createElement("canvas");
  c.width = c.height = 128;
  const g = c.getContext("2d");
  const gr = g.createRadialGradient(64, 64, 6, 64, 64, 64);
  gr.addColorStop(0, "rgba(40,44,48,0)");
  gr.addColorStop(0.15, "rgba(40,44,48,0.5)");
  gr.addColorStop(0.9, "rgba(40,44,48,0.9)");
  gr.addColorStop(1, "rgba(40,44,48,0)");
  g.fillStyle = gr;
  g.fillRect(0, 0, 128, 128);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}
// the boom's recovery markings (LUNAVIA's own)
function markTexture() {
  const c = document.createElement("canvas");
  c.width = 512;
  c.height = 64;
  const g = c.getContext("2d");
  g.clearRect(0, 0, 512, 64);
  g.fillStyle = "#e9eaea";
  g.font = "bold 40px Helvetica, Arial, sans-serif";
  g.textBaseline = "middle";
  g.fillText("LUNAVIA  RECOVERY  1", 8, 34);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

/**
 * The helicopter. stateRef.current: { pos [scene], yaw, pitch, roll, door (0..1), rotor (rev/s),
 * visible, scale } — written each frame by the recovery director (it is drawn in metres, scaled).
 */
export default function HelicopterModel({ stateRef }) {
  const root = useRef();
  const rotor = useRef();
  const tail = useRef();
  const doorPanel = useRef();
  const doorHole = useRef();
  const blurM = useRef();
  const g = useMemo(() => {
    const body = buildBody();
    const main = buildMainRotor();
    const tailR = buildTailRotor();
    return { body, main, tailR, blur: blurTexture(), mark: markTexture() };
  }, []);
  const mats = useMemo(
    () => ({
      body: new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.55, metalness: 0.05 }),
      blade: new THREE.MeshStandardMaterial({ color: "#2a2d30", roughness: 0.45, metalness: 0.3 }),
      bladeTip: new THREE.MeshStandardMaterial({ color: "#2a2d30", roughness: 0.45, metalness: 0.3, transparent: true, opacity: 0.55 }),
      blur: new THREE.MeshBasicMaterial({ map: g.blur, transparent: true, opacity: 0.16, depthWrite: false, side: THREE.DoubleSide }),
      door: new THREE.MeshStandardMaterial({ color: PAINT.body, roughness: 0.55, metalness: 0.05 }),
      hole: new THREE.MeshBasicMaterial({ color: "#0b0d0f" }),
      mark: new THREE.MeshBasicMaterial({ map: g.mark, transparent: true, depthWrite: false, toneMapped: true }),
    }),
    [g]
  );
  useEffect(
    () => () => {
      [g.body, g.main.blades, g.main.hub, g.tailR, g.blur, g.mark].forEach((x) => x && x.dispose());
      Object.values(mats).forEach((m) => m.dispose());
    },
    [g, mats]
  );
  useFrame((state, dt) => {
    const s = stateRef.current;
    const r = root.current;
    if (!r || !s) return;
    r.visible = !!s.visible;
    if (!s.visible) return;
    r.position.set(s.pos[0], s.pos[1], s.pos[2]);
    r.rotation.set(s.roll, s.yaw, s.pitch, "YXZ");
    r.scale.setScalar(s.scale || 1);
    const rev = s.rotor == null ? 3.4 : s.rotor;
    if (rotor.current) rotor.current.rotation.y -= rev * Math.PI * 2 * dt * 0.97; // a hair under the frame rate's alias
    if (tail.current) tail.current.rotation.z += rev * 4.6 * Math.PI * 2 * dt * 0.97;
    // the sliding door, aft along the hull
    const d = s.door || 0;
    if (doorPanel.current) doorPanel.current.position.x = DOOR_LOCAL[0] + 0.25 - d * 1.35;
    if (doorHole.current) doorHole.current.visible = d > 0.02;
    if (blurM.current) blurM.current.opacity = 0.16;
  });
  return (
    <group ref={root} visible={false}>
      <mesh geometry={g.body} material={mats.body} />
      {/* the markings on the boom, both sides */}
      <mesh position={[-4.55, 0.55, 0.83]} rotation={[0, 0, 0.04]} material={mats.mark}>
        <planeGeometry args={[3.2, 0.4]} />
      </mesh>
      <mesh position={[-4.55, 0.55, -0.83]} rotation={[0, Math.PI, -0.04]} material={mats.mark}>
        <planeGeometry args={[3.2, 0.4]} />
      </mesh>
      {/* the starboard door: the opening, and the panel that slides aft */}
      <mesh ref={doorHole} position={[DOOR_LOCAL[0] + 0.25, DOOR_LOCAL[1] + 0.2, 1.012]} material={mats.hole} visible={false}>
        <planeGeometry args={[1.3, 1.35]} />
      </mesh>
      <mesh ref={doorPanel} position={[DOOR_LOCAL[0] + 0.25, DOOR_LOCAL[1] + 0.2, 1.03]} material={mats.door}>
        <boxGeometry args={[1.32, 1.37, 0.03]} />
      </mesh>
      {/* the main rotor, on its mast */}
      <group position={[0.4, HELI.mastH, 0]}>
        <group ref={rotor}>
          <mesh geometry={g.main.hub} material={mats.blade} />
          <mesh geometry={g.main.blades} material={mats.blade} />
        </group>
        <mesh rotation={[-Math.PI / 2, 0, 0]} material={mats.blur} ref={(m) => (blurM.current = m ? m.material : null)}>
          <circleGeometry args={[HELI.rotorR, 48]} />
        </mesh>
      </group>
      {/* the tail rotor, port side of the pylon */}
      <group position={[-9.05, 2.75, -0.24]}>
        <group ref={tail}>
          <mesh geometry={g.tailR} material={mats.blade} />
        </group>
        <mesh material={mats.blur}>
          <circleGeometry args={[HELI.tailRotorR, 24]} />
        </mesh>
      </group>
    </group>
  );
}
