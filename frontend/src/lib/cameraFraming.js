import * as THREE from "three";

/*
 * Camera framing shared by the ascent/staging and lunar-descent cameras.
 *
 * Given points of interest (world position + radius), a view direction and
 * the angular size of the screen rectangle they must stay inside, find the
 * smallest camera distance that keeps every point in view. Exact for a
 * perspective camera looking at `center` along -dir.
 */

const UP = new THREE.Vector3(0, 1, 0);
const _f = new THREE.Vector3();
const _r = new THREE.Vector3();
const _u = new THREE.Vector3();
const _q = new THREE.Vector3();
const _box = new THREE.Box3();

const _t = new THREE.Vector3();

// Camera basis for a view along -dir, optionally rolled about the view axis.
function basis(dir, roll) {
  _f.copy(dir).negate();
  _r.crossVectors(_f, UP);
  if (_r.lengthSq() < 1e-8) _r.set(1, 0, 0);
  _r.normalize();
  _u.crossVectors(_r, _f).normalize();
  if (roll) {
    const c = Math.cos(roll);
    const s = Math.sin(roll);
    _t.copy(_r);
    _r.multiplyScalar(c).addScaledVector(_u, s);
    _u.multiplyScalar(c).addScaledVector(_t, -s);
  }
}

export function solveDistance(points, center, dir, tanH, tanV, roll = 0) {
  basis(dir, roll);
  let d = 0;
  for (const pt of points) {
    _q.copy(pt.pos).sub(center);
    const x = Math.abs(_q.dot(_r)) + pt.rad;
    const y = Math.abs(_q.dot(_u)) + pt.rad;
    const z = _q.dot(_f);
    d = Math.max(d, z + x / tanH, z + y / tanV);
  }
  return d;
}

/**
 * Frame `points` inside a screen rectangle.
 * rect: fractions of the viewport, { x0, x1, y0, y1 } with y0 at the top.
 * Returns { center, dist } — the camera sits at center + dir * dist.
 */
export function framePoints(points, dir, fovDeg, aspect, rect, margin = 0.85, out = { center: new THREE.Vector3(), dist: 0 }, roll = 0) {
  _box.makeEmpty();
  points.forEach((p) => _box.expandByPoint(p.pos));
  _box.getCenter(out.center);
  const t = Math.tan(THREE.MathUtils.degToRad(fovDeg / 2));
  const tanV = t * (rect.y1 - rect.y0) * margin;
  const tanH = t * aspect * (rect.x1 - rect.x0) * margin;
  out.dist = solveDistance(points, out.center, dir, tanH, tanV, roll);
  return out;
}

/** Move the image centre to the middle of `rect` (fractions of the viewport). */
export function centreViewOn(camera, width, height, rect) {
  const cx = ((rect.x0 + rect.x1) / 2) * width;
  const cy = ((rect.y0 + rect.y1) / 2) * height;
  camera.setViewOffset(width, height, width / 2 - cx, height / 2 - cy, width, height);
}
