/*
 * LUNAVIA — the lunar EVA's close-range textures, drawn once on the device (no image files: the app
 * plays offline and the bundle stays small). Every map tiles. Sizes are capped at 512² so the whole
 * set is a few MB of GPU memory on a phone:
 *
 *   suit      Beta-cloth weave, quilted panel seams with stitching, soft folds   map + normalMap
 *   foil      crinkled thermal foil: flat facets at random tilts, creases       map + normalMap + roughnessMap
 *   paint     painted skin panels: recessed seams, rivet rows, light wear       map + normalMap
 *   regolith  the near ground: R = height (pebbles, craterlets, grain), G = albedo grain
 *   bootPrint the overboot's tread pressed into the regolith (decal, alpha)
 *   softDisc  a soft round shadow (contact shadows, alpha)
 */
import * as THREE from "three";

const rng = (seed) => {
  let s = seed;
  return () => ((s = (s * 16807) % 2147483647) / 2147483647);
};

/** Tileable value noise on an s×s lattice; returns f(u, v) for u, v in [0, 1). */
function lattice(s, seed) {
  const r = rng(seed);
  const a = new Float32Array(s * s);
  for (let i = 0; i < a.length; i++) a[i] = r();
  return (u, v) => {
    const fu = u * s;
    const fv = v * s;
    const i = Math.floor(fu);
    const j = Math.floor(fv);
    const tu = fu - i;
    const tv = fv - j;
    const su = tu * tu * (3 - 2 * tu);
    const sv = tv * tv * (3 - 2 * tv);
    const at = (p, q) => a[(((q % s) + s) % s) * s + (((p % s) + s) % s)];
    const A = at(i, j);
    const B = at(i + 1, j);
    const C = at(i, j + 1);
    const D = at(i + 1, j + 1);
    return A + (B - A) * su + (C - A) * sv + (A - B - C + D) * su * sv;
  };
}

function canvasOf(N, M = N) {
  const c = document.createElement("canvas");
  c.width = N;
  c.height = M;
  return c;
}

/** A height field (Float32Array N×N, wrapping) to a tangent-space normal map canvas. */
function normalCanvas(h, N, strength) {
  const c = canvasOf(N);
  const g = c.getContext("2d");
  const img = g.createImageData(N, N);
  const at = (x, y) => h[(((y % N) + N) % N) * N + (((x % N) + N) % N)];
  for (let y = 0; y < N; y++) {
    for (let x = 0; x < N; x++) {
      const dx = (at(x + 1, y) - at(x - 1, y)) * strength;
      const dy = (at(x, y + 1) - at(x, y - 1)) * strength;
      const l = Math.hypot(dx, dy, 1);
      const i = (y * N + x) * 4;
      img.data[i] = Math.round(255 * (0.5 - (0.5 * dx) / l));
      img.data[i + 1] = Math.round(255 * (0.5 + (0.5 * dy) / l));
      img.data[i + 2] = Math.round(255 * (0.5 + 0.5 / l));
      img.data[i + 3] = 255;
    }
  }
  g.putImageData(img, 0, 0);
  return c;
}

/** A grey canvas from values 0..1. */
function greyCanvas(v, N, M = N) {
  const c = canvasOf(N, M);
  const g = c.getContext("2d");
  const img = g.createImageData(N, M);
  for (let i = 0; i < N * M; i++) {
    const t = Math.max(0, Math.min(255, Math.round(255 * v[i])));
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = t;
    img.data[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return c;
}

function texture(c, { srgb = false, repeat = 1 } = {}) {
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.repeat.set(repeat, repeat);
  t.anisotropy = 4;
  return t;
}

const cache = {};
const once = (k, f) => cache[k] || (cache[k] = f());

/* ---- the suit's Beta cloth ------------------------------------------------------------------------ */
export const suitTextures = () =>
  once("suit", () => {
    const N = 512;
    const h = new Float32Array(N * N);
    const col = new Float32Array(N * N);
    const folds = [lattice(4, 31), lattice(9, 37)];
    const tone = lattice(6, 41);
    const r = rng(43);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const u = x / N;
        const v = y / N;
        // the weave: alternating over/under threads, 2 px
        const weave = ((x >> 1) + (y >> 1)) % 2 ? 0.06 : -0.06;
        // soft folds, stretched along the limb (v)
        const fold = 0.55 * folds[0](u, v * 0.35) + 0.45 * folds[1](u * 1.6, v * 0.5);
        h[y * N + x] = weave + 1.6 * fold;
        col[y * N + x] = 0.9 + 0.08 * tone(u, v);
      }
    }
    // quilted panels: seams every 128 px across, 170 px along, with stitches either side
    const seam = (x0, y0, horizontal, len) => {
      for (let k = 0; k < len; k++) {
        for (let w = -2; w <= 2; w++) {
          const x = horizontal ? x0 + k : x0 + w;
          const y = horizontal ? y0 + w : y0 + k;
          const i = (((y % N) + N) % N) * N + (((x % N) + N) % N);
          h[i] -= 0.55 * (1 - Math.abs(w) / 3);
          col[i] -= 0.07 * (1 - Math.abs(w) / 3);
        }
        if (k % 6 < 3) {
          for (const off of [-4, 4]) {
            const x = horizontal ? x0 + k : x0 + off;
            const y = horizontal ? y0 + off : y0 + k;
            const i = (((y % N) + N) % N) * N + (((x % N) + N) % N);
            h[i] += 0.25;
            col[i] -= 0.05;
          }
        }
      }
    };
    // two seams along the limb per tile, one round it (a 0.5 m tile: a seam every 25 cm)
    for (let x = 0; x < N; x += 256) seam(x, 0, false, N);
    seam(0, 0, true, N);
    // scuffs and lunar dust in the weave
    for (let k = 0; k < 140; k++) {
      const cx = r() * N;
      const cy = r() * N;
      const rad = 2 + r() * 9;
      const a = 0.03 + r() * 0.06;
      for (let dy = -rad; dy <= rad; dy++) {
        for (let dx = -rad; dx <= rad; dx++) {
          const d = Math.hypot(dx, dy) / rad;
          if (d > 1) continue;
          const i = ((Math.round(cy + dy) + N) % N) * N + ((Math.round(cx + dx) + N) % N);
          col[i] -= a * (1 - d);
        }
      }
    }
    const map = texture(greyCanvas(col, N), { srgb: true });
    const normalMap = texture(normalCanvas(h, N, 0.9));
    return { map, normalMap };
  });

/* ---- crinkled thermal foil -------------------------------------------------------------------------- */
/** Tileable Voronoi cells: for each pixel of an N×N image, its cell's index and how near a crease it is. */
function voronoi(N, G, seed, stretch = 1) {
  const r = rng(seed);
  const px = new Float32Array(G * G);
  const py = new Float32Array(G * G);
  for (let j = 0; j < G; j++) {
    for (let i = 0; i < G; i++) {
      px[j * G + i] = (i + 0.1 + 0.8 * r()) / G;
      py[j * G + i] = (j + 0.1 + 0.8 * r()) / G;
    }
  }
  const cell = new Int32Array(N * N);
  const edge = new Float32Array(N * N);
  for (let y = 0; y < N; y++) {
    const v = y / N;
    const cj = Math.floor(v * G);
    for (let x = 0; x < N; x++) {
      const u = x / N;
      const ci = Math.floor(u * G);
      let best = 9;
      let second = 9;
      let bi = 0;
      for (let dj = -1; dj <= 1; dj++) {
        const jj = cj + dj;
        const wj = jj < 0 ? -1 : jj >= G ? 1 : 0;
        const rj = (jj + G) % G;
        for (let di = -1; di <= 1; di++) {
          const ii = ci + di;
          const wi = ii < 0 ? -1 : ii >= G ? 1 : 0;
          const k = rj * G + ((ii + G) % G);
          const dx = (u - px[k] - wi) * stretch;
          const dy = v - py[k] - wj;
          const d = Math.sqrt(dx * dx + dy * dy);
          if (d < best) {
            second = best;
            best = d;
            bi = k;
          } else if (d < second) second = d;
        }
      }
      cell[y * N + x] = bi;
      edge[y * N + x] = Math.max(0, 1 - (second - best) * G * 7);
    }
  }
  return { cell, edge };
}

/**
 * The foil: broad wrinkles (large cells, stretched) carrying fine crinkles (small cells), each
 * facet tilted at random, so the metal catches the black sky or the bright ground facet by facet.
 * The colour barely changes (a little darker in the creases): the look comes from the reflections.
 */
export const foilTextures = () =>
  once("foil", () => {
    const N = 512;
    const big = voronoi(N, 9, 53, 1.7);
    const fine = voronoi(N, 34, 59, 1.25);
    const r = rng(61);
    const tilt = (n, lo, hi) => {
      const a = [];
      for (let k = 0; k < n; k++) {
        const t = lo + r() * (hi - lo);
        const az = r() * Math.PI * 2;
        a.push([Math.cos(az) * t, Math.sin(az) * t, r(), r()]);
      }
      return a;
    };
    const TB = tilt(81, 0.08, 0.3);
    const TF = tilt(34 * 34, 0.06, 0.3);
    const nrm = canvasOf(N);
    const ng = nrm.getContext("2d");
    const nimg = ng.createImageData(N, N);
    const col = new Float32Array(N * N);
    const rough = new Float32Array(N * N);
    for (let i = 0; i < N * N; i++) {
      const b = TB[big.cell[i]];
      const f = TF[fine.cell[i]];
      const eb = big.edge[i];
      const ef = fine.edge[i];
      const nx = b[0] * (1 - 0.6 * eb) + f[0] * (1 - 0.5 * ef);
      const ny = b[1] * (1 - 0.6 * eb) + f[1] * (1 - 0.5 * ef);
      const l = Math.hypot(nx, ny, 1);
      nimg.data[i * 4] = Math.round(255 * (0.5 + (0.5 * nx) / l));
      nimg.data[i * 4 + 1] = Math.round(255 * (0.5 + (0.5 * ny) / l));
      nimg.data[i * 4 + 2] = Math.round(255 * (0.5 + 0.5 / l));
      nimg.data[i * 4 + 3] = 255;
      col[i] = 0.9 + 0.08 * f[2] - 0.1 * ef - 0.16 * eb;
      rough[i] = 0.22 + 0.3 * f[3] + 0.18 * ef + 0.2 * eb;
    }
    ng.putImageData(nimg, 0, 0);
    return {
      map: texture(greyCanvas(col, N), { srgb: true, repeat: 2.2 }),
      normalMap: texture(nrm, { repeat: 2.2 }),
      roughnessMap: texture(greyCanvas(rough, N), { repeat: 2.2 }),
    };
  });

/* ---- painted panels (the ascent stage, equipment) -------------------------------------------------- */
export const paintTextures = () =>
  once("paint", () => {
    const N = 512;
    const h = new Float32Array(N * N);
    const col = new Float32Array(N * N);
    const r = rng(61);
    const cols = [0, 140, 300, 512];
    const rows = [0, 190, 360, 512];
    const tone = lattice(5, 67);
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const pi = cols.findIndex((c, k) => x >= c && x < cols[k + 1]);
        const pj = rows.findIndex((c, k) => y >= c && y < rows[k + 1]);
        col[y * N + x] = 0.86 + 0.06 * Math.sin(pi * 7.1 + pj * 3.7) + 0.04 * tone(x / N, y / N);
      }
    }
    const line = (x0, y0, horizontal) => {
      for (let k = 0; k < N; k++) {
        for (let w = -2; w <= 2; w++) {
          const x = horizontal ? k : x0 + w;
          const y = horizontal ? y0 + w : k;
          const i = (((y % N) + N) % N) * N + (((x % N) + N) % N);
          h[i] -= 0.9 * (1 - Math.abs(w) / 3);
          col[i] -= 0.22 * (1 - Math.abs(w) / 3);
        }
      }
    };
    cols.slice(0, 3).forEach((x) => line(x, 0, false));
    rows.slice(0, 3).forEach((y) => line(0, y, true));
    // rivet rows beside the seams
    const rivet = (cx, cy) => {
      for (let dy = -3; dy <= 3; dy++) {
        for (let dx = -3; dx <= 3; dx++) {
          const d = Math.hypot(dx, dy) / 3;
          if (d > 1) continue;
          const i = (((cy + dy) % N + N) % N) * N + (((cx + dx) % N + N) % N);
          h[i] += 0.6 * (1 - d * d);
          col[i] -= 0.04;
        }
      }
    };
    rows.slice(0, 3).forEach((y) => {
      for (let x = 6; x < N; x += 16) rivet(x, y + 9);
    });
    cols.slice(0, 3).forEach((x) => {
      for (let y = 6; y < N; y += 16) rivet(x + 9, y);
    });
    // wear: faint streaks and scuffs
    for (let k = 0; k < 90; k++) {
      const x0 = Math.floor(r() * N);
      const y0 = Math.floor(r() * N);
      const len = 20 + r() * 90;
      const a = 0.02 + r() * 0.05;
      for (let k2 = 0; k2 < len; k2++) col[(((y0 + k2) % N) * N + x0) % (N * N)] -= a;
    }
    return { map: texture(greyCanvas(col, N), { srgb: true, repeat: 2 }), normalMap: texture(normalCanvas(h, N, 1.2), { repeat: 2 }) };
  });

/* ---- the near regolith: R = height, G = albedo grain (sampled by the terrain shader) ---------------- */
export const regolithNearTexture = () =>
  once("regolith", () => {
    const N = 512;
    const h = new Float32Array(N * N);
    const a = new Float32Array(N * N);
    const o = [lattice(16, 71), lattice(48, 73), lattice(128, 79)];
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const u = x / N;
        const v = y / N;
        h[y * N + x] = 0.5 * o[0](u, v) + 0.32 * o[1](u, v) + 0.18 * o[2](u, v);
        a[y * N + x] = 0.55 * o[1](u + 0.3, v + 0.7) + 0.45 * o[2](u + 0.1, v + 0.2);
      }
    }
    const r = rng(83);
    // pebbles and clods: little domes, darker or lighter than the dust round them
    for (let k = 0; k < 900; k++) {
      const cx = r() * N;
      const cy = r() * N;
      const rad = 1.2 + Math.pow(r(), 3) * 7;
      const tone = (r() - 0.45) * 0.5;
      for (let dy = -rad; dy <= rad; dy++) {
        for (let dx = -rad; dx <= rad; dx++) {
          const d = Math.hypot(dx, dy) / rad;
          if (d > 1) continue;
          const i = ((Math.round(cy + dy) + N) % N) * N + ((Math.round(cx + dx) + N) % N);
          h[i] += 0.5 * Math.sqrt(1 - d * d);
          a[i] += tone * (1 - d);
        }
      }
    }
    // craterlets: a dished floor and a raised rim
    for (let k = 0; k < 60; k++) {
      const cx = r() * N;
      const cy = r() * N;
      const rad = 4 + Math.pow(r(), 2) * 26;
      for (let dy = -rad * 1.5; dy <= rad * 1.5; dy++) {
        for (let dx = -rad * 1.5; dx <= rad * 1.5; dx++) {
          const d = Math.hypot(dx, dy) / rad;
          if (d > 1.5) continue;
          const i = ((Math.round(cy + dy) + N) % N) * N + ((Math.round(cx + dx) + N) % N);
          h[i] += d < 1 ? -0.5 * (1 - d * d) : 0.35 * (1.5 - d) / 0.5 * (d < 1.2 ? (d - 1) / 0.2 : 1);
        }
      }
    }
    const c = canvasOf(N);
    const g = c.getContext("2d");
    const img = g.createImageData(N, N);
    let lo = Infinity;
    let hi = -Infinity;
    for (let i = 0; i < N * N; i++) {
      lo = Math.min(lo, h[i]);
      hi = Math.max(hi, h[i]);
    }
    for (let i = 0; i < N * N; i++) {
      img.data[i * 4] = Math.round((255 * (h[i] - lo)) / (hi - lo));
      img.data[i * 4 + 1] = Math.max(0, Math.min(255, Math.round(255 * a[i])));
      img.data[i * 4 + 2] = 0;
      img.data[i * 4 + 3] = 255;
    }
    g.putImageData(img, 0, 0);
    const t = texture(c);
    t.generateMipmaps = true;
    return t;
  });

/* ---- the overboot's print -------------------------------------------------------------------------- */
export const bootPrintTexture = () =>
  once("print", () => {
    const W = 128;
    const H = 256;
    const c = canvasOf(W, H);
    const g = c.getContext("2d");
    g.clearRect(0, 0, W, H);
    // the print's outline (the texture's top is the heel, its bottom the wider toe): the pressed
    // regolith is darker and smoother than the dust round it
    const outline = () => {
      g.beginPath();
      g.ellipse(64, 66, 38, 54, 0, Math.PI, 0);
      g.lineTo(108, 186);
      g.ellipse(64, 186, 44, 62, 0, 0, Math.PI);
      g.closePath();
    };
    g.save();
    outline();
    g.clip();
    g.fillStyle = "rgba(40,37,33,0.55)";
    g.fillRect(0, 0, W, H);
    // the tread: chevron ribs, each with a lit edge (the Sun low and ahead) and a shaded one
    for (let y = 18; y < 250; y += 15) {
      g.strokeStyle = "rgba(200,190,174,0.34)";
      g.lineWidth = 3;
      g.beginPath();
      g.moveTo(14, y + 6);
      g.lineTo(64, y);
      g.lineTo(114, y + 6);
      g.stroke();
      g.strokeStyle = "rgba(18,16,14,0.45)";
      g.lineWidth = 2.5;
      g.beginPath();
      g.moveTo(14, y + 10);
      g.lineTo(64, y + 4);
      g.lineTo(114, y + 10);
      g.stroke();
    }
    g.restore();
    // the rim of pushed-up regolith round the print: faint, soft
    g.strokeStyle = "rgba(196,186,170,0.2)";
    g.lineWidth = 4;
    g.filter = "blur(1.5px)";
    outline();
    g.stroke();
    g.filter = "none";
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  });

/* ---- a soft round shadow ------------------------------------------------------------------------- */
export const softDiscTexture = () =>
  once("disc", () => {
    const N = 64;
    const c = canvasOf(N);
    const g = c.getContext("2d");
    const gr = g.createRadialGradient(N / 2, N / 2, 0, N / 2, N / 2, N / 2);
    gr.addColorStop(0, "rgba(0,0,0,1)");
    gr.addColorStop(0.45, "rgba(0,0,0,0.7)");
    gr.addColorStop(1, "rgba(0,0,0,0)");
    g.fillStyle = gr;
    g.fillRect(0, 0, N, N);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.NoColorSpace;
    return t;
  });

/* ---- the LUNAVIA emblem (the suit's patches, the LM's descent stage) ----------------------------- */
/** Draws the emblem, radius ~61 px, centred at (cx, cy). */
export function drawEmblem(g, cx, cy, k = 1) {
  const TAU = Math.PI * 2;
  g.save();
  g.translate(cx, cy);
  g.scale(k, k);
  g.fillStyle = "#1c2847";
  g.beginPath();
  g.arc(0, 0, 61, 0, TAU);
  g.fill();
  g.save();
  g.beginPath();
  g.arc(0, 0, 55, 0, TAU);
  g.clip();
  g.fillStyle = "#06080f";
  g.fillRect(-60, -60, 120, 120);
  for (let i = 0; i < 26; i++) {
    g.fillStyle = "rgba(255,255,255,0.8)";
    g.fillRect(((i * 37) % 100) - 50, ((i * 53) % 60) - 52, 1.6, 1.6);
  }
  g.fillStyle = "#a8a296";
  g.beginPath();
  g.arc(0, 128, 96, 0, TAU);
  g.fill();
  g.fillStyle = "#3f78c8";
  g.beginPath();
  g.arc(-24, -22, 10, 0, TAU);
  g.fill();
  g.restore();
  g.strokeStyle = "#e2531f";
  g.lineWidth = 5;
  g.beginPath();
  g.ellipse(4, 2, 50, 15, -0.42, 0, TAU);
  g.stroke();
  g.strokeStyle = "#ece9e2";
  g.lineWidth = 5;
  g.beginPath();
  g.arc(0, 0, 58, 0, TAU);
  g.stroke();
  g.fillStyle = "#ffffff";
  g.font = "bold 15px Helvetica, Arial, sans-serif";
  g.textAlign = "center";
  g.textBaseline = "middle";
  g.fillText("LUNAVIA", 0, 44);
  g.restore();
}

/* ---- the LM's close-range decals: the plaque, the equipment box stencil, the wordmark, the emblem */
/** rects: data/lmDesign LM_DECALS ([x, y, w, h] px of 512 × 256). */
export const lmDecalTexture = (rects) =>
  once("lmDecals", () => {
    const c = canvasOf(512, 256);
    const g = c.getContext("2d");
    g.clearRect(0, 0, 512, 256);
    const font = (px) => `bold ${px}px Helvetica, Arial, sans-serif`;
    // the plaque: brushed steel, a rolled border, engraved lines
    {
      const [x, y, w, h] = rects.plaque;
      const gr = g.createLinearGradient(x, y, x + w, y + h);
      gr.addColorStop(0, "#c9ccd1");
      gr.addColorStop(0.5, "#e6e8eb");
      gr.addColorStop(1, "#b9bcc2");
      g.fillStyle = gr;
      g.fillRect(x, y, w, h);
      for (let k = 0; k < h; k += 2) {
        g.fillStyle = `rgba(255,255,255,${0.05 + 0.05 * Math.sin(k * 1.7)})`;
        g.fillRect(x, y + k, w, 1);
      }
      g.strokeStyle = "#6f737a";
      g.lineWidth = 4;
      g.strokeRect(x + 6, y + 6, w - 12, h - 12);
      g.fillStyle = "#2a2c30";
      g.textAlign = "center";
      g.textBaseline = "middle";
      // two hemispheres
      [-38, 38].forEach((dx) => {
        g.strokeStyle = "#2a2c30";
        g.lineWidth = 2;
        g.beginPath();
        g.arc(x + w / 2 + dx, y + 46, 26, 0, Math.PI * 2);
        g.stroke();
        g.beginPath();
        g.ellipse(x + w / 2 + dx, y + 46, 10, 26, 0, 0, Math.PI * 2);
        g.stroke();
      });
      g.font = font(13);
      g.fillText("HERE THE LUNAVIA CREW", x + w / 2, y + 92);
      g.fillText("FIRST SET FOOT UPON THE MOON", x + w / 2, y + 110);
      g.font = font(11);
      g.fillText("MARE TRANQUILLITATIS", x + w / 2, y + 132);
      g.fillText("WE CAME IN PEACE", x + w / 2, y + 148);
    }
    // the equipment box's stencil and the cabin's wordmark: black letters
    {
      const [x, y, w, h] = rects.mesa;
      g.fillStyle = "#151619";
      g.font = font(30);
      g.textAlign = "left";
      g.textBaseline = "middle";
      g.fillText("MESA", x + 8, y + h / 2 + 2);
      g.font = font(16);
      g.textAlign = "right";
      g.fillText("LUNAVIA  EQ-2", x + w - 8, y + h / 2 + 2);
    }
    {
      const [x, y, w, h] = rects.wordmark;
      g.fillStyle = "#17181b";
      g.font = font(46);
      g.textAlign = "center";
      g.textBaseline = "middle";
      g.fillText("LUNAVIA", x + w / 2, y + h / 2 + 3);
    }
    {
      const [x, y, w] = rects.emblem;
      drawEmblem(g, x + w / 2, y + w / 2, w / 128);
    }
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace;
    t.anisotropy = 4;
    return t;
  });
