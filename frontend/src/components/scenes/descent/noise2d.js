import * as THREE from "three";

/** A tileable 128² value-noise texture (procedural, shared): spray and foam break-up. */
let NOISE = null;
export function noiseTexture() {
  if (NOISE) return NOISE;
  const N = 128;
  const data = new Uint8Array(N * N * 4);
  let s = 777;
  const r = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const waves = [];
  for (let i = 0; i < 40; i++) {
    const f = 1 + Math.floor(Math.pow(r(), 1.4) * 14);
    const a = r() * Math.PI * 2;
    waves.push({ fx: Math.round(Math.cos(a) * f), fy: Math.round(Math.sin(a) * f), ph: r() * Math.PI * 2, amp: 1 / f });
  }
  let mn = Infinity;
  let mx = -Infinity;
  const h = new Float32Array(N * N);
  for (let y = 0; y < N; y++)
    for (let x = 0; x < N; x++) {
      let v = 0;
      for (const w of waves) v += w.amp * Math.sin(((w.fx * x + w.fy * y) / N) * Math.PI * 2 + w.ph);
      h[y * N + x] = v;
      mn = Math.min(mn, v);
      mx = Math.max(mx, v);
    }
  for (let i = 0; i < N * N; i++) {
    const v = Math.round(((h[i] - mn) / (mx - mn)) * 255);
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  const t = new THREE.DataTexture(data, N, N, THREE.RGBAFormat);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.magFilter = THREE.LinearFilter;
  t.minFilter = THREE.LinearMipmapLinearFilter;
  t.generateMipmaps = true;
  t.needsUpdate = true;
  NOISE = t;
  return t;
}
