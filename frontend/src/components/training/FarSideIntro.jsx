import { Canvas, useFrame, useThree } from "@react-three/fiber";
import { Stars } from "@react-three/drei";
import { Suspense, useEffect, useMemo, useRef, useState } from "react";
import { PlanetEarth, PlanetMoon } from "@/components/planets/Planets";
import * as THREE from "three";
import { SkipForward } from "lucide-react";

/*
 * Silent Horizon: the far-side approach, before the descent.
 *
 * About 12 s, skippable. Seen from the spacecraft low over the Moon, the
 * Earth sinks behind the lunar horizon. Houston's last transmission fades
 * as the link degrades. At loss of signal the static burst cuts the radio
 * (comms blackout: only onboard voices from here on). Silence follows, the
 * onboard telemetry is confirmed, the far-side terrain comes into view, and
 * the descent briefing starts. Existing voice and textures only: no new
 * voices.
 */

const DEG = Math.PI / 180;
const LENGTH = 12.5; // s
const LOS = 6.6; // s: the Earth is fully behind the horizon
const smooth = (x) => {
  const c = Math.min(1, Math.max(0, x));
  return c * c * (3 - 2 * c);
};

// The Moon fills the lower view; its limb sits just below the line of sight.
const MOON = { r: 1000, c: new THREE.Vector3(0, -1060, -900) };
const EARTH_D = 8000;
const EARTH_R = EARTH_D * Math.tan(1.9 * DEG);
// Earth elevation (deg) over time: above the limb (-3.7°) at first, fully hidden by LOS.
const earthEl = (t) => 5 - 10.6 * smooth(t / LOS);

// The far side is in daylight, so the Sun is behind the spacecraft: a near-full Earth.
const SUN = [-3, 1.4, 4];
// The ground in view: beyond the western limb, where the spacecraft goes out of contact
// (data/missionConfig orbitViewFor), in the southern far-side highlands. The globe is turned
// so that point faces the camera, with the poles off to the side (no pinched seam in view).
const NADIR = { lat: -40, lon: -100 };
function farSideQuaternion() {
  const ll = (lat, lon) => {
    const phi = ((lon + 180) / 360) * Math.PI * 2;
    const th = ((90 - lat) * Math.PI) / 180;
    return new THREE.Vector3(-Math.cos(phi) * Math.sin(th), Math.cos(th), Math.sin(phi) * Math.sin(th));
  };
  const d = new THREE.Vector3(0, 0, 0).sub(MOON.c).normalize(); // from the Moon's centre towards the camera
  const q = new THREE.Quaternion().setFromUnitVectors(ll(NADIR.lat, NADIR.lon), d);
  // twist about d so the north pole lies towards +X (the side)
  const n = new THREE.Vector3(0, 1, 0).applyQuaternion(q);
  const want = new THREE.Vector3(1, 0, 0).projectOnPlane(d).normalize();
  const have = n.clone().projectOnPlane(d).normalize();
  const ang = Math.atan2(new THREE.Vector3().crossVectors(have, want).dot(d), have.dot(want));
  return new THREE.Quaternion().setFromAxisAngle(d, ang).multiply(q);
}

function Scene({ clock }) {
  const earth = useRef();
  const { camera } = useThree();
  const moonQ = useMemo(() => farSideQuaternion(), []);
  useFrame(() => {
    const t = clock.current;
    const e = earthEl(t) * DEG;
    if (earth.current) {
      earth.current.position.set(0, Math.sin(e) * EARTH_D, -Math.cos(e) * EARTH_D);
      earth.current.rotation.y = 0.6 + t * 0.01;
    }
    // After LOS the view tips down towards the far-side surface.
    const pitch = -18 * smooth((t - 8.6) / 3.4) * DEG;
    camera.position.set(0, 0, 0);
    camera.rotation.set(pitch, 0, 0);
  });
  return (
    <>
      <color attach="background" args={["#000000"]} />
      <Stars radius={4000} depth={500} count={2500} factor={60} saturation={0} fade={false} speed={0} />
      {/* The shared NASA Moon and Earth (components/planets), lit by the one Sun */}
      <PlanetMoon radius={MOON.r} sun={SUN} position={MOON.c} quaternion={moonQ} segments={160} detail={() => 0.35} />
      <group ref={earth}>
        <PlanetEarth radius={EARTH_R} sun={SUN} segments={64} small />
      </group>
    </>
  );
}

const CAPTIONS = [
  { from: 0.4, to: 3.4, big: "FAR SIDE APPROACH", small: "SILENT HORIZON · SOUTH POLE–AITKEN BASIN" },
  { from: 3.4, to: LOS, big: null, small: "THE EARTH IS SETTING BEHIND THE LUNAR HORIZON" },
  { from: LOS, to: 8.6, big: "LOSS OF SIGNAL", small: "EARTH LINK UNAVAILABLE" },
  { from: 8.6, to: 10.6, big: null, small: "RADIO SILENCE · ONBOARD TELEMETRY NOMINAL · GUIDANCE ACTIVE" },
];

export default function FarSideIntro({ audio, briefing, onDone }) {
  const clock = useRef(0);
  const [t, setT] = useState(0);
  const fired = useRef({});
  const done = useRef(false);
  const finish = () => {
    if (done.current) return;
    done.current = true;
    // Whatever was skipped, the descent starts with the link down and the radio quiet.
    if (audio) {
      if (audio.setRadioLink) audio.setRadioLink(1);
      if (audio.setEarthLink) audio.setEarthLink(false);
    }
    onDone();
  };

  useEffect(() => {
    let raf;
    let last = performance.now();
    const tick = (now) => {
      clock.current += Math.min(0.1, (now - last) / 1000);
      last = now;
      const tt = clock.current;
      setT(tt);
      const once = (k, fn) => {
        if (!fired.current[k]) {
          fired.current[k] = true;
          fn();
        }
      };
      if (audio) {
        // Houston's last transmission, on a link that fades as the Earth sets
        if (tt > 0.6) once("houston", () => audio.say && audio.say("cruise.ambient", { variant: 0 }));
        if (tt > 0.6 && tt < LOS && audio.setRadioLink) audio.setRadioLink(1 - 0.85 * smooth((tt - 0.6) / (LOS - 0.6)));
        if (tt >= LOS) once("los", () => audio.setBlackout && audio.setBlackout(true));
      }
      if (tt >= LENGTH) {
        finish();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cap = CAPTIONS.find((c) => t >= c.from && t < c.to);
  const fade = Math.max(1 - smooth(t / 0.8), smooth((t - (LENGTH - 0.9)) / 0.9));
  const showBriefing = t >= 10.6;
  return (
    <div className="absolute inset-0 z-50 bg-black" data-testid="farside-intro">
      <Canvas camera={{ fov: 42, near: 1, far: 20000, position: [0, 0, 0] }} dpr={[1, 1.5]} gl={{ antialias: true, toneMapping: THREE.ACESFilmicToneMapping, outputColorSpace: THREE.SRGBColorSpace }}>
        <Suspense fallback={null}>
          <Scene clock={clock} />
        </Suspense>
      </Canvas>
      <div className="absolute inset-0 bg-black pointer-events-none" style={{ opacity: fade }} />
      <div className="absolute inset-x-0 bottom-[16%] short:bottom-[12%] flex flex-col items-center text-center px-6 pointer-events-none" data-testid="farside-intro-caption">
        {cap && cap.big && <div className="font-display font-black text-white text-3xl short:text-2xl tracking-tight scan-in" key={cap.big}>{cap.big}</div>}
        {cap && cap.small && <div className="font-mono text-[10px] short:text-[9px] tracking-[0.35em] text-[#9fb6cc] mt-2" key={cap.small}>{cap.small}</div>}
        {showBriefing && (
          <div className="max-w-xl scan-in" data-testid="farside-intro-briefing">
            <div className="font-mono text-[9px] tracking-[0.4em] text-[#FF3B00]">DESCENT BRIEFING</div>
            <div className="text-white text-base short:text-sm mt-1.5">{briefing}</div>
          </div>
        )}
      </div>
      <button
        type="button"
        onClick={finish}
        className="absolute top-4 right-4 safe-mr btn-hud min-h-[44px] z-10"
        data-testid="farside-intro-skip"
      >
        SKIP <SkipForward size={13} />
      </button>
    </div>
  );
}
