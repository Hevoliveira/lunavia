import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Suspense, useEffect, useMemo } from "react";
import * as THREE from "three";
import LanderModel from "@/components/LanderModel";
import { SiteMarkers, SiteRocks, SiteSky, SiteSun, SiteTerrain, groundY } from "@/components/scenes/LunarSite";
import { DIFFICULTY } from "@/data/landingPhysics";
import { getSite, hazardMap, siteStart } from "@/data/landingSites";
import { LM, WORLD_X } from "@/data/touchdownFx";

/*
 * Landing-site preview for the Training Center: the site exactly as the
 * descent draws it (terrain, rocks, Sun, sky, landing zones and the unsafe
 * ground marked), an LM standing on the primary LZ for scale, and the
 * approach coming in from the site's side. The camera drifts slowly round
 * the LZ from behind the approach.
 */

const DEG = Math.PI / 180;

function ApproachPath({ site }) {
  const line = useMemo(() => {
    const p = siteStart(site, DIFFICULTY.ASTRONAUT);
    const sy = site.scale.y;
    const x0 = p.xPos * WORLD_X;
    const curve = new THREE.CubicBezierCurve3(
      new THREE.Vector3(x0, sy(p.y), 0),
      new THREE.Vector3(x0 * 0.45, sy(p.y * 0.6), 0),
      new THREE.Vector3(x0 * 0.08, sy(60), 0),
      new THREE.Vector3(0, sy(3), 0)
    );
    const g = new THREE.BufferGeometry().setFromPoints(curve.getPoints(80));
    const l = new THREE.Line(g, new THREE.LineDashedMaterial({ color: "#FFDD00", dashSize: 1.2, gapSize: 0.8, transparent: true, opacity: 0.7, depthWrite: false }));
    l.computeLineDistances();
    l.renderOrder = 3;
    return l;
  }, [site]);
  useEffect(() => () => {
    line.geometry.dispose();
    line.material.dispose();
  }, [line]);
  return <primitive object={line} />;
}

function PreviewCamera({ site }) {
  const { camera } = useThree();
  const d = site.approach.dir;
  const base = Math.atan2(12, -11 * d); // the descent's chase direction, behind the approach
  const centre = useMemo(() => new THREE.Vector3(0, 2.5, 0), []);
  useFrame((state) => {
    const t = state.clock.elapsedTime;
    const az = base + 0.38 * Math.sin(t / 7);
    const el = (27 + 4 * Math.sin(t / 11)) * DEG;
    const r = 72;
    camera.position.set(r * Math.cos(el) * Math.cos(az), r * Math.sin(el), r * Math.cos(el) * Math.sin(az));
    const gy = groundY(site, camera.position.x / WORLD_X, camera.position.z / WORLD_X) + 2;
    if (camera.position.y < gy) camera.position.y = gy;
    camera.lookAt(centre);
  });
  return null;
}

const STANDING = { thrust: 0, comp: [0.05, 0.05, 0.05, 0.05], probe: [1.2, 0, 1.2, 1.2] };

export default function SitePreview({ siteId, className = "" }) {
  const site = useMemo(() => getSite(siteId), [siteId]);
  const lmY = groundY(site, 0, 0) + LM.foot - 0.05;
  return (
    <div className={`relative overflow-hidden bg-black ${className}`} data-testid="site-preview">
      <Canvas
        key={site.id}
        camera={{ position: [-30, 18, 30], fov: 40, near: 0.1, far: 5000 }}
        dpr={[1, 1.5]}
        shadows={{ type: THREE.PCFShadowMap }}
        gl={{ antialias: true, alpha: false, toneMapping: THREE.ACESFilmicToneMapping, outputColorSpace: THREE.SRGBColorSpace }}
        onCreated={({ gl }) => gl.setClearColor("#050505")}
      >
        <Suspense fallback={null}>
          <color attach="background" args={["#050505"]} />
          <SiteSky site={site} />
          <SiteSun site={site} focus={() => [0, 0, 0]} />
          <SiteTerrain site={site} />
          <SiteRocks site={site} />
          <SiteMarkers site={site} />
          <ApproachPath site={site} />
          <group position={[0, lmY, 0]}>
            <LanderModel scale={LM.scale} fx={STANDING} />
          </group>
          <PreviewCamera site={site} />
        </Suspense>
      </Canvas>
    </div>
  );
}

/**
 * The ground along the descent track, from the same terrain the physics uses:
 * elevation (one schematic scale for every site, so their relief compares),
 * the unsafe stretches (red), the landing zones (orange: primary, blue:
 * alternates) and the side the approach comes from.
 */
export function SiteProfile({ siteId, className = "" }) {
  const site = useMemo(() => getSite(siteId), [siteId]);
  const W = 300;
  const H = 50;
  const X0 = -150;
  const X1 = 150;
  const k = 0.42; // vertical units per metre (horizontal: 1): a schematic profile, the same for every site
  const sx = (x) => ((x - X0) / (X1 - X0)) * W;
  const base = 36;
  const sy = (h) => Math.max(2, Math.min(H - 6, base - h * k * (W / (X1 - X0))));
  const { path, hazards } = useMemo(() => {
    let d = "";
    for (let x = X0; x <= X1; x += 1) d += `${x === X0 ? "M" : "L"}${sx(x).toFixed(1)},${sy(site.height(x, 0)).toFixed(1)}`;
    const hz = hazardMap(site, 0.5).filter((h) => h.x1 > X0 && h.x0 < X1);
    return { path: d, hazards: hz };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [site]);
  const fromLeft = site.approach.dir > 0;
  return (
    <div className={className} data-testid="site-profile">
      <div className="flex items-center justify-between font-mono text-[8px] tracking-[0.2em] text-zinc-500">
        <span>GROUND ALONG THE TRACK</span>
        <span className="flex items-center gap-2">
          <span className="flex items-center gap-1"><i className="inline-block w-2 h-1 bg-[#ff1f3d]" /> UNSAFE</span>
          <span className="flex items-center gap-1"><i className="inline-block w-2 h-1 bg-[#FF3B00]" /> LZ</span>
          <span className="text-[#FFDD00]">{fromLeft ? "APPROACH ►" : "◄ APPROACH"}</span>
        </span>
      </div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="w-full h-[30px] short:h-[22px] mt-0.5 block" role="img" aria-label={`${site.name}: elevation along the approach`}>
        <path d={`${path}L${W},${H}L0,${H}Z`} fill="rgba(255,255,255,0.07)" />
        <path d={path} fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="1" vectorEffect="non-scaling-stroke" />
        {hazards.map((h, i) => (
          <rect key={i} x={sx(Math.max(X0, h.x0))} y={H - 4} width={Math.max(0.8, sx(Math.min(X1, h.x1)) - sx(Math.max(X0, h.x0)))} height="4" fill="#ff1f3d" opacity="0.85" />
        ))}
        {site.zones.map((z) => (
          <rect key={z.label} x={sx(z.x - z.r)} y={H - 9} width={sx(z.x + z.r) - sx(z.x - z.r)} height="4" fill={z.primary ? "#FF3B00" : "#4a90e2"} />
        ))}
      </svg>
    </div>
  );
}
