import { useRef } from "react";
import { useFrame, useThree } from "@react-three/fiber";

/**
 * The launch cinematic's adaptive resolution, for the other spacecraft canvases
 * (mission cruise / lunar orbit / return, the opening, the title loop): if the
 * device cannot hold ~45 fps, step the pixel ratio down by 0.25 once per 2 s, to
 * no lower than 1.25, and never back up (no oscillation). Warm-up (shader
 * compiles) and app-switch pauses are ignored. __lvFixedDpr pins it for captures.
 */
export default function AdaptiveResolution() {
  const gl = useThree((s) => s.gl);
  const setDpr = useThree((s) => s.setDpr);
  const pf = useRef(null);
  useFrame((_, rawDelta) => {
    const p = pf.current || (pf.current = { acc: 0, n: 0, wall: 0, dpr: gl.getPixelRatio() });
    p.wall += Math.min(rawDelta, 1);
    if (p.wall < 1.5 || rawDelta >= 1) return;
    p.acc += rawDelta;
    p.n++;
    if (p.acc <= 2) return;
    const ft = p.acc / p.n;
    if (!(typeof window !== "undefined" && window.__lvFixedDpr) && ft > 1 / 45 && p.dpr > 1.25) {
      p.dpr = Math.max(1.25, p.dpr - 0.25);
      setDpr(p.dpr);
    }
    p.acc = 0;
    p.n = 0;
  });
  return null;
}
