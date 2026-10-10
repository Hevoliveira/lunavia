import { useEffect, useRef, useState } from "react";
import { Headphones, X, Radio } from "lucide-react";
import { useAudioSettings, setAudioSettings } from "@/audio/audioSettings";
import comms from "@/audio/comms";

/*
 * AUDIO panel (navigation bar): mission-control voice, languages, subtitles,
 * volumes and radio effects. Saved on the device as soon as anything changes.
 */
function Row({ label, children, hint }) {
  return (
    <div className="flex items-center justify-between gap-4 py-2.5 short:py-1.5 border-b border-white/5">
      <div className="min-w-0">
        <div className="font-mono text-[10px] tracking-[0.25em] text-zinc-300">{label}</div>
        {hint && <div className="font-mono text-[9px] tracking-wider text-zinc-600 mt-0.5 short:hidden">{hint}</div>}
      </div>
      <div className="shrink-0">{children}</div>
    </div>
  );
}

function Toggle({ on, onChange, testId, label }) {
  return (
    <button
      role="switch"
      aria-checked={on}
      aria-label={label}
      data-testid={testId}
      onClick={() => onChange(!on)}
      className={`min-h-[40px] w-16 border font-mono text-[10px] tracking-[0.25em] ${on ? "border-[#FF3B00] text-white bg-[#FF3B00]/15" : "border-white/20 text-zinc-500"}`}
    >
      {on ? "ON" : "OFF"}
    </button>
  );
}

function Lang({ value, onChange, testId, label }) {
  return (
    <div className="flex" role="radiogroup" aria-label={label} data-testid={testId}>
      {[
        ["en", "EN"],
        ["pt", "PT-BR"],
      ].map(([k, l]) => (
        <button
          key={k}
          role="radio"
          aria-checked={value === k}
          data-testid={`${testId}-${k}`}
          onClick={() => onChange(k)}
          className={`min-h-[40px] px-3 border font-mono text-[10px] tracking-[0.2em] -ml-px first:ml-0 ${value === k ? "border-[#FF3B00] text-white bg-[#FF3B00]/15 relative z-10" : "border-white/20 text-zinc-500"}`}
        >
          {l}
        </button>
      ))}
    </div>
  );
}

function Volume({ value, onChange, testId, label }) {
  return (
    <div className="flex items-center gap-2">
      <input
        type="range"
        min="0"
        max="100"
        step="5"
        value={Math.round(value * 100)}
        aria-label={label}
        data-testid={testId}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        className="w-28 short:w-24 accent-[#FF3B00]"
      />
      <span className="font-mono text-[10px] text-zinc-400 tabular w-8 text-right">{Math.round(value * 100)}</span>
    </div>
  );
}

export default function AudioSettings() {
  const st = useAudioSettings();
  const [open, setOpen] = useState(false);
  const panelRef = useRef(null);
  const set = (patch) => setAudioSettings(patch);

  useEffect(() => {
    if (!open) return undefined;
    const close = (e) => {
      if (e.key === "Escape") setOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [open]);

  return (
    <>
      <button
        onClick={() => setOpen((o) => !o)}
        data-testid="nav-audio"
        aria-label="Audio settings"
        aria-expanded={open}
        className={`flex items-center gap-2 font-mono text-[11px] tracking-[0.22em] uppercase short:py-3.5 short:px-1 ${open ? "text-white" : "text-zinc-500 hover:text-white"}`}
      >
        <Headphones size={14} />
        <span className="short:hidden">Audio</span>
      </button>
      {open && (
        <>
          <div className="fixed inset-0 z-[60]" onClick={() => setOpen(false)} aria-hidden />
          <div
            ref={panelRef}
            data-testid="audio-settings"
            role="dialog"
            aria-label="Audio settings"
            className="fixed right-4 md:right-10 top-16 short:top-12 z-[61] hud-panel corners border border-white/10 w-[380px] max-w-[calc(100vw-2rem)] max-h-[calc(100vh-5rem)] short:max-h-[calc(100vh-3.5rem)] overflow-y-auto px-5 py-4 short:py-2 safe-mr"
          >
            <div className="flex items-center justify-between mb-1">
              <div className="font-mono text-[10px] tracking-[0.35em] text-[#FF3B00]">● AUDIO · MISSION CONTROL</div>
              <button onClick={() => setOpen(false)} aria-label="Close" className="text-zinc-500 hover:text-white min-h-[40px] w-10 flex items-center justify-center">
                <X size={14} />
              </button>
            </div>
            <Row label="MISSION CONTROL VOICE" hint="Flight, Capcom, Guidance, onboard computer">
              <Toggle on={st.voice} onChange={(v) => set({ voice: v })} testId="audio-voice" label="Mission control voice" />
            </Row>
            <Row label="VOICE LANGUAGE">
              <Lang value={st.voiceLang} onChange={(v) => set({ voiceLang: v })} testId="audio-voice-lang" label="Voice language" />
            </Row>
            <Row label="SUBTITLES">
              <Toggle on={st.subtitles} onChange={(v) => set({ subtitles: v })} testId="audio-subtitles" label="Subtitles" />
            </Row>
            <Row label="SUBTITLE LANGUAGE">
              <Lang value={st.subLang} onChange={(v) => set({ subLang: v })} testId="audio-sub-lang" label="Subtitle language" />
            </Row>
            <Row label="VOICE VOLUME">
              <Volume value={st.voiceVolume} onChange={(v) => set({ voiceVolume: v })} testId="audio-voice-volume" label="Voice volume" />
            </Row>
            <Row label="SOUND EFFECTS" hint="Engines, separations, ambience">
              <Volume value={st.sfxVolume} onChange={(v) => set({ sfxVolume: v })} testId="audio-sfx-volume" label="Sound effects volume" />
            </Row>
            <Row label="RADIO EFFECTS" hint="Band-limited radio, static, squelch, Quindar tones">
              <Toggle on={st.radioFx} onChange={(v) => set({ radioFx: v })} testId="audio-radio-fx" label="Radio effects" />
            </Row>
            <button
              onClick={() => comms.radioCheck()}
              data-testid="audio-radio-check"
              className="mt-3 short:mt-2 w-full min-h-[44px] border border-white/20 hover:border-[#FF3B00] text-zinc-300 hover:text-white font-mono text-[10px] tracking-[0.3em] flex items-center justify-center gap-2"
            >
              <Radio size={13} /> RADIO CHECK
            </button>
          </div>
        </>
      )}
    </>
  );
}
