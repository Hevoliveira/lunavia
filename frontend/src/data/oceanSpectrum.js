/*
 * LUNAVIA — the wind sea on the open ocean, from a wave spectrum (pure; tested).
 *
 * The sea's small waves are not a few sine waves (which line up into stripes) nor a noise
 * picture (which repeats): they are a random sea drawn from a directional wind-wave spectrum, the
 * way oceanographers describe it, by an inverse FFT (Tessendorf's method), in two bands:
 * - BAND_A, waves 1.8–25 m long on a 56 m tile (the chop seen from the air and round the capsule);
 * - BAND_B, ripples 8 cm–1.8 m on a 9.7 m tile (the texture of the water close by).
 * Longer swell is the analytic Gerstner swell of data/descentScene (WAVES), which the floating
 * capsule rides. Each band's tile wraps seamlessly; the shader samples it twice, at unrelated
 * scales and angles, so no repeat lines up.
 *
 * The slopes are calibrated to Cox & Munk's sun-glitter measurements of the real sea: for a
 * 6 m/s breeze the mean square slope is 0.003 + 0.00512·6 ≈ 0.034. The two bands carry most of it;
 * the rest (smaller than the finest texel) is the surface's roughness in the shader. Each texel
 * stores (sx, sz, height, sx² + sz²): mip-filtered, the mean slope and the mean square slope give
 * the slope variance a pixel can no longer resolve, which becomes roughness (the glitter path)
 * instead of shimmer or flat colour.
 */
export const WIND = { speed: 6, dir: 0.62 }; // m/s, radians (towards +x rotated by dir)
export const MSS_TOTAL = 0.003 + 0.00512 * WIND.speed; // Cox & Munk, clean sea surface
export const BAND_A = { N: 256, L: 56, lmin: 1.8, lmax: 25, mss: 0.012, seed: 11 };
export const BAND_B = { N: 256, L: 9.7, lmin: 0.08, lmax: 1.8, mss: 0.0125, seed: 23 };
/** What no texel resolves: the roughness the shader adds (the remainder of Cox & Munk's total). */
export const MSS_UNRESOLVED = MSS_TOTAL - BAND_A.mss - BAND_B.mss;

function rng(seed) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return (s + 0.5) / 4294967296;
  };
}
function gauss(R) {
  return Math.sqrt(-2 * Math.log(R())) * Math.cos(2 * Math.PI * R());
}

// in-place radix-2 complex FFT (inverse when inv), on interleaved re/im
function fft1(re, im, inv) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len <<= 1) {
    const ang = ((inv ? 2 : -2) * Math.PI) / len;
    const wr = Math.cos(ang);
    const wi = Math.sin(ang);
    for (let i = 0; i < n; i += len) {
      let cr = 1;
      let ci = 0;
      for (let k = 0; k < len / 2; k++) {
        const a = i + k;
        const b = a + len / 2;
        const tr = re[b] * cr - im[b] * ci;
        const ti = re[b] * ci + im[b] * cr;
        re[b] = re[a] - tr;
        im[b] = im[a] - ti;
        re[a] += tr;
        im[a] += ti;
        const nr = cr * wr - ci * wi;
        ci = cr * wi + ci * wr;
        cr = nr;
      }
    }
  }
}
function ifft2(re, im, N) {
  const r = new Float64Array(N);
  const i = new Float64Array(N);
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      r[x] = re[y * N + x];
      i[x] = im[y * N + x];
    }
    fft1(r, i, true);
    for (let x = 0; x < N; x++) {
      re[y * N + x] = r[x];
      im[y * N + x] = i[x];
    }
  }
  for (let x = 0; x < N; x++) {
    for (let y = 0; y < N; y++) {
      r[y] = re[y * N + x];
      i[y] = im[y * N + x];
    }
    fft1(r, i, true);
    for (let y = 0; y < N; y++) {
      re[y * N + x] = r[y];
      im[y * N + x] = i[y];
    }
  }
}

/**
 * One band of the wind sea: { N, L, sx, sz, h } (Float32Array N², slopes and height in metres per
 * metre and metres), periodic on the tile, its mean square slope scaled to band.mss.
 * The spectrum: a Phillips-type wind-sea spectrum (k⁻⁴, the peak set by the wind, a
 * small-wave cut-off) with a broad cos²ˢ spreading round the wind (s = 3), a little energy against
 * it, cut to the band's wavelengths.
 */
export function oceanBand(band) {
  const { N, L, lmin, lmax, seed } = band;
  const R = rng(seed);
  const g = 9.81;
  const Lw = (WIND.speed * WIND.speed) / g; // the largest wave the wind makes
  const wx = Math.cos(WIND.dir);
  const wz = Math.sin(WIND.dir);
  const hr = new Float64Array(N * N);
  const hi = new Float64Array(N * N);
  const xr = new Float64Array(N * N);
  const xi = new Float64Array(N * N);
  const zr = new Float64Array(N * N);
  const zi = new Float64Array(N * N);
  const kmin = (2 * Math.PI) / lmax;
  const kmax = (2 * Math.PI) / lmin;
  for (let j = 0; j < N; j++)
    for (let i = 0; i < N; i++) {
      const n = i < N / 2 ? i : i - N;
      const m = j < N / 2 ? j : j - N;
      const kx = (2 * Math.PI * n) / L;
      const kz = (2 * Math.PI * m) / L;
      const k = Math.hypot(kx, kz);
      const a = gauss(R);
      const b = gauss(R);
      if (k < kmin || k > kmax || k === 0) continue;
      const c = (kx * wx + kz * wz) / k;
      // broad spreading round the wind (cos^2s of half the angle), a little against it
      const half = Math.sqrt(Math.max(0, (1 + c) / 2));
      const spread = Math.pow(half, 6) + 0.04;
      const P = (Math.exp(-1 / (k * Lw * k * Lw)) / (k * k * k * k)) * spread;
      // the band's soft edges (no sharp ring in the spectrum)
      const edge = Math.min(1, (k - kmin) / (kmin * 0.4)) * Math.min(1, (kmax - k) / (kmax * 0.2));
      const amp = Math.sqrt(P * Math.max(0, edge)) / Math.SQRT2;
      const re = a * amp;
      const im = b * amp;
      const o = j * N + i;
      hr[o] = re;
      hi[o] = im;
      // slopes: i·k·h
      xr[o] = -kx * im;
      xi[o] = kx * re;
      zr[o] = -kz * im;
      zi[o] = kz * re;
    }
  ifft2(hr, hi, N);
  ifft2(xr, xi, N);
  ifft2(zr, zi, N);
  // the real parts are the fields; calibrate the slopes' mean square to the band's share
  let ss = 0;
  for (let o = 0; o < N * N; o++) ss += xr[o] * xr[o] + zr[o] * zr[o];
  const s = Math.sqrt(band.mss / (ss / (N * N)));
  const sx = new Float32Array(N * N);
  const sz = new Float32Array(N * N);
  const h = new Float32Array(N * N);
  for (let o = 0; o < N * N; o++) {
    sx[o] = xr[o] * s;
    sz[o] = zr[o] * s;
    h[o] = hr[o] * s;
  }
  return { N, L, sx, sz, h };
}

/** Mean square slope of a band (for the tests). */
export function meanSquareSlope(b) {
  let ss = 0;
  for (let o = 0; o < b.sx.length; o++) ss += b.sx[o] * b.sx[o] + b.sz[o] * b.sz[o];
  return ss / b.sx.length;
}

/** The band packed for a texture: Float32Array RGBA (sx, sz, h, sx² + sz²). */
export function packBand(b) {
  const out = new Float32Array(b.N * b.N * 4);
  for (let o = 0; o < b.N * b.N; o++) {
    out[o * 4] = b.sx[o];
    out[o * 4 + 1] = b.sz[o];
    out[o * 4 + 2] = b.h[o];
    out[o * 4 + 3] = b.sx[o] * b.sx[o] + b.sz[o] * b.sz[o];
  }
  return out;
}
