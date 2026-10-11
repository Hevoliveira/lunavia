import {
  MOON_ROTATION,
  applyRotation,
  LZ_LAT,
  LZ_LON,
  LZ_SUN_ELEVATION,
  ORBIT,
  craftAlpha,
  craftPose,
  goForPdi,
  landingSite,
  orbitCamera,
  norm,
  smoother,
} from "./lunarOrbitShot";
import { trajectoryPosition } from "./missionPhases";

const DEG = Math.PI / 180;
const M = [14.4, 0, 13.9];
const R = 0.904;
const dot = (a, b) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const sub = (a, b) => [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
const cross = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const angle = (a, b) => Math.acos(Math.max(-1, Math.min(1, dot(norm(a), norm(b))))) / DEG;

/** Play the shot at 60 fps and measure what the viewer sees. */
function play(seconds) {
  const dt = 1 / 60;
  const out = [];
  let prev = null;
  for (let i = 0; i <= seconds * 60; i++) {
    const tau = i * dt;
    const cam = orbitCamera(tau, M, R);
    const sub0 = sub(cam.pos, M); // Moon does not rotate: this is the body-fixed direction
    const view = sub(cam.look, cam.pos);
    const right = norm(cross(view, cam.up));
    const row = { tau, cam, sub0, view, right };
    if (prev) {
      row.sweep = angle(prev.sub0, sub0) / dt; // surface point under the camera, deg/s
      row.pan = angle(prev.view, view) / dt; // picture panning, deg/s
      row.roll = angle(prev.right, right) / dt - row.pan * 0; // right vector turn (upper bound on roll)
      row.jump = Math.hypot(...sub(cam.pos, prev.cam.pos)) / dt / R; // camera speed, Moon radii per second
    }
    out.push(row);
    prev = row;
  }
  return out.slice(1);
}

describe("lunar orbit orientation", () => {
  test("the Moon is turned so the landing site is at the top (world +Y)", () => {
    const lz = [Math.cos(LZ_LAT) * Math.cos(LZ_LON), Math.sin(LZ_LAT), -Math.cos(LZ_LAT) * Math.sin(LZ_LON)];
    const w = applyRotation(MOON_ROTATION, lz);
    expect(w[1]).toBeCloseTo(1, 6);
    // a proper rotation: orthonormal rows, determinant +1
    const m = MOON_ROTATION;
    const rows = [m.slice(0, 3), m.slice(3, 6), m.slice(6, 9)];
    rows.forEach((r, i) => rows.forEach((q, j) => expect(dot(r, q)).toBeCloseTo(i === j ? 1 : 0, 9)));
    expect(dot(cross(rows[0], rows[1]), rows[2])).toBeCloseTo(1, 9);
  });

  test("the site is in low morning sunlight (Apollo-style)", () => {
    expect(LZ_SUN_ELEVATION).toBeGreaterThan(8);
    expect(LZ_SUN_ELEVATION).toBeLessThan(25);
  });
});

describe("spacecraft orbit", () => {
  test("the craft always moves forward, decelerating smoothly from arrival to a gentle drift", () => {
    let prev = craftAlpha(0);
    let prevRate = Infinity;
    for (let t = 0.05; t < 120; t += 0.05) {
      const a = craftAlpha(t);
      const rate = (a - prev) / 0.05 / DEG;
      expect(rate).toBeGreaterThan(0);
      expect(rate).toBeLessThanOrEqual(prevRate + 1e-9);
      prev = a;
      prevRate = rate;
    }
    // ~7 deg/s on arrival, 0.1 deg/s once settled (a 118 min orbit takes 0.05 deg/s in real time)
    expect((craftAlpha(0.05) - craftAlpha(0)) / 0.05 / DEG).toBeLessThan(8);
    expect((craftAlpha(20.05) - craftAlpha(20)) / 0.05 / DEG).toBeLessThan(0.15);
  });

  test("GO FOR PDI lights about ten seconds in and stays lit", () => {
    const first = [...Array(400).keys()].map((i) => i * 0.1).find((t) => goForPdi(t));
    expect(first).toBeGreaterThan(6);
    expect(first).toBeLessThan(13);
    for (let t = first; t < 600; t += 1) expect(goForPdi(t)).toBe(true);
  });

  test("the craft flies over the landing site from east to west", () => {
    const before = craftPose(8, M, R);
    const site = landingSite(M, R);
    expect(dot(before.fwd, norm(sub(site, before.pos)))).toBeGreaterThan(0.5); // heading towards it
    expect(before.alpha).toBeLessThan(0);
  });
});

describe("camera: no spinning Moon", () => {
  const rows = play(60);
  const settled = rows.filter((r) => r.tau > ORBIT.settleEnd + 0.5);
  const max = (rs, k) => Math.max(...rs.map((r) => r[k]));

  test("once settled the view of the surface barely changes (< 0.2 deg/s)", () => {
    expect(max(settled, "sweep")).toBeLessThan(0.2);
    expect(max(settled, "pan")).toBeLessThan(0.2);
  });

  test("the push-in is one gentle move: never more than 12 deg/s, no jumps", () => {
    expect(max(rows, "sweep")).toBeLessThan(12);
    expect(max(rows, "pan")).toBeLessThan(12);
    expect(max(rows, "jump")).toBeLessThan(0.8);
  });

  test("the camera never rolls (up is fixed) and stays well outside the Moon", () => {
    rows.forEach((r) => {
      expect(r.cam.up).toEqual([0, 1, 0]);
      expect(Math.hypot(...r.sub0)).toBeGreaterThan(R * 1.25);
    });
  });

  test("settled on a landscape iPhone: craft upper left moving right, site visible ahead and below", () => {
    const ASPECT = 852 / 393;
    const t = Math.tan((45 / 2) * DEG);
    const project = (cam, p) => {
      const f = norm(sub(cam.look, cam.pos));
      const r = norm(cross(f, cam.up));
      const u = cross(r, f);
      const d = sub(p, cam.pos);
      const z = dot(d, f);
      return [0.5 + dot(d, r) / z / (t * ASPECT) / 2, 0.5 - dot(d, u) / z / t / 2, z];
    };
    for (const r of settled.filter((_, i) => i % 60 === 0)) {
      const craft = craftPose(r.tau, M, R);
      const c = project(r.cam, craft.pos);
      expect(c[2]).toBeGreaterThan(0);
      expect(c[0]).toBeGreaterThan(0.1);
      expect(c[0]).toBeLessThan(0.45);
      expect(c[1]).toBeGreaterThan(0.12);
      expect(c[1]).toBeLessThan(0.45);
      expect(dot(norm(craft.fwd), r.right)).toBeGreaterThan(0.8); // flies left to right
      const site = landingSite(M, R);
      const l = project(r.cam, site);
      expect(l[2]).toBeGreaterThan(0);
      expect(l[0]).toBeGreaterThan(c[0]); // ahead of the craft
      expect(l[0]).toBeLessThan(0.65); // clear of the bottom-right prompt
      expect(l[1]).toBeGreaterThan(c[1]); // below it, on the surface
      expect(l[1]).toBeLessThan(0.9);
      expect(dot(sub(r.cam.pos, site), [0, 1, 0])).toBeGreaterThan(0); // on the visible side of the globe
    }
  });
});

describe("hand-over from the cruise", () => {
  test("the camera cranes from the approach shot into orbit in one gentle move (< 12 deg/s)", () => {
    // MissionScene geometry at the end of the cruise (missionTime 270000).
    const E = 384400;
    const SCALE = 20 / E;
    const MU = 1737 * SCALE * 10;
    const p = trajectoryPosition(270000);
    const Mc = [p.moonX * SCALE, 0, p.moonZ * SCALE];
    const dir = Math.atan2(p.z, p.x);
    const S = [Math.cos(dir) * 19.4, 0, Math.sin(dir) * 19.4]; // craft display radius at arrival
    const d = norm(sub(Mc, S));
    const from = { pos: [S[0] - d[0] * 1.1, 0.45, S[2] - d[2] * 1.1], look: Mc }; // approach camera
    const dt = 1 / 60;
    let prev = null;
    let maxSweep = 0;
    let maxPan = 0;
    for (let i = 0; i <= 60 * 8; i++) {
      const tau = i * dt;
      const k = smoother(tau / ORBIT.handover);
      const shot = orbitCamera(tau, Mc, MU);
      const pos = from.pos.map((x, j) => x + (shot.pos[j] - x) * k);
      const look = from.look.map((x, j) => x + (shot.look[j] - x) * k);
      const cur = { sub: sub(pos, Mc), view: sub(look, pos) };
      if (prev) {
        maxSweep = Math.max(maxSweep, angle(prev.sub, cur.sub) / dt);
        maxPan = Math.max(maxPan, angle(prev.view, cur.view) / dt);
      }
      prev = cur;
    }
    expect(maxSweep).toBeLessThan(12);
    expect(maxPan).toBeLessThan(12);
  });
});
