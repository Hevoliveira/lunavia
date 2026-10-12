import { useEffect, useRef, useState } from "react";
import { SkipForward, Volume2 } from "lucide-react";
import OpeningScene from "@/components/opening/OpeningScene";
import useMissionAudio from "@/hooks/useMissionAudio";
import { OPENING, OPENING_SOUND, openingShotAt, titleCards } from "@/data/openingSequence";

/**
 * The main-menu opening: lunar orbit, the docked spacecraft, the lunar module
 * undocking, then LUNAVIA · A LAJU PRODUCTIONS GAME and the tagline
 * (data/openingSequence). About 52 s, SKIP at any time. It touches no game
 * state: no mission progress, no records, no descent.
 *
 * Sound needs a tap on iPhone (browsers start audio only after a gesture): the
 * first tap anywhere, or SOUND, starts it in step with the picture.
 */
const OPENING_KEY = "lunavia.opening.seen";
let seenThisSession = false;

/** Whether the opening should play by itself (only the first time, ever, on this device). */
export function openingDue() {
  if (seenThisSession) return false;
  try {
    return window.localStorage.getItem(OPENING_KEY) !== "1";
  } catch {
    return true;
  }
}
export function markOpeningSeen() {
  seenThisSession = true;
  try {
    window.localStorage.setItem(OPENING_KEY, "1");
  } catch {
    // not kept; it still won't replay this session
  }
}

const TAGLINE = ["MASTER THE DESCENT.", "EXPLORE THE MOON.", "RETURN TO EARTH."];

export default function OpeningCinematic({ onDone }) {
  const clockRef = useRef(0);
  const audio = useMissionAudio();
  const audioRef = useRef(audio);
  audioRef.current = audio;
  const [t, setT] = useState(0);
  const [sound, setSound] = useState(false);
  const soundRef = useRef(false);
  const fired = useRef(new Set());
  const done = useRef(false);

  const finish = () => {
    if (done.current) return;
    done.current = true;
    markOpeningSeen();
    audioRef.current.padStop(1.2);
    audioRef.current.commsFlush();
    onDone();
  };

  const fire = (c) => {
    const a = audioRef.current;
    if (c.cue === "pad") a.padStart();
    else if (c.cue === "padStop") a.padStop(2.2);
    else if (c.cue === "clank") a.clank(c.vol);
    else if (c.cue === "hiss") a.hiss(c.dur, c.vol);
    else if (c.cue === "say") a.say(c.id);
  };

  const enableSound = () => {
    if (soundRef.current) return;
    soundRef.current = true;
    setSound(true);
    audioRef.current.init();
    // Catch up with the picture: the music, if it should already be playing.
    const tt = clockRef.current;
    if (tt < OPENING.fadeOut - 1) audioRef.current.padStart();
  };

  useEffect(() => {
    let raf;
    let last = -1;
    const tick = () => {
      const tt = clockRef.current;
      if (Math.abs(tt - last) > 0.05) {
        last = tt;
        setT(tt);
      }
      OPENING_SOUND.forEach((c, i) => {
        if (tt >= c.t && !fired.current.has(i)) {
          fired.current.add(i);
          if (soundRef.current) fire(c);
        }
      });
      if (tt >= OPENING.length) {
        finish();
        return;
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      audioRef.current.padStop(0.6);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const cards = titleCards(t);
  const { shot } = openingShotAt(t);
  return (
    <div className="fixed inset-0 z-[80] bg-black select-none" data-testid="opening" data-shot={shot.id} onPointerDown={enableSound}>
      <OpeningScene clockRef={clockRef} mode="opening" />
      {/* Title reveal: on the left, the lunar module leaving on the right */}
      <div
        className="absolute inset-y-0 left-0 w-[70%] md:w-[55%] pointer-events-none bg-gradient-to-r from-black/70 via-black/35 to-transparent"
        style={{ opacity: Math.max(cards.title, cards.credit) }}
      />
      <div className="absolute inset-y-0 left-0 w-[62%] md:w-[50%] flex flex-col items-center justify-center text-center px-6 safe-ml pointer-events-none">
        <div
          className="font-display font-black text-white text-6xl md:text-8xl short:text-5xl leading-none"
          style={{ opacity: cards.title, letterSpacing: `${0.42 - 0.16 * cards.title}em`, textShadow: "0 2px 24px rgba(0,0,0,0.65)" }}
          data-testid="opening-title"
        >
          LUNAVIA
        </div>
        <div className="font-mono text-[11px] short:text-[10px] tracking-[0.55em] text-zinc-200 mt-4 short:mt-3" style={{ opacity: cards.credit, textShadow: "0 1px 12px rgba(0,0,0,0.8)" }} data-testid="opening-credit">
          A LAJU PRODUCTIONS GAME
        </div>
        <div className="mt-7 short:mt-4 font-mono text-[10px] short:text-[9px] tracking-[0.38em] text-[#FF3B00] space-y-1.5" data-testid="opening-tagline">
          {TAGLINE.map((line, i) => (
            <div key={line} style={{ opacity: cards.tagline[i] }}>
              {line}
            </div>
          ))}
        </div>
      </div>
      <div className="absolute inset-0 bg-black pointer-events-none" style={{ opacity: cards.black }} />
      <div className="absolute top-4 right-4 safe-mr flex gap-2 z-10">
        {!sound && (
          <button type="button" onClick={enableSound} className="btn-hud min-h-[44px] !px-3" data-testid="opening-sound" aria-label="Sound on">
            <Volume2 size={13} /> SOUND
          </button>
        )}
        <button
          type="button"
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            finish();
          }}
          className="btn-hud min-h-[44px]"
          data-testid="opening-skip"
        >
          SKIP INTRO <SkipForward size={13} />
        </button>
      </div>
    </div>
  );
}
