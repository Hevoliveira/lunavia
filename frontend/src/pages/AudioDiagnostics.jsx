import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import useMissionAudio from "@/hooks/useMissionAudio";
import { installAudioUnlock } from "@/audio/audioEngine";
import { voicePack } from "@/audio/comms";
import { useAudioSettings, setAudioSettings } from "@/audio/audioSettings";
import {
  audioStatus,
  diagnosticsReport,
  radioTraceRows,
  refreshNative,
  runHoustonTest,
  runMediaElementTest,
  runSfxTest,
  runToneTest,
  HOUSTON_TEST_ID,
} from "@/audio/audioDiagnostics";

/*
 * AUDIO DIAGNOSTICS (/audio-diagnostics; AUDIO panel → AUDIO DIAGNOSTICS, and TRAINING).
 * Three playback tests started by the player's own tap, the audio engine's live state, the
 * Houston radio trace of this session and COPY DIAGNOSTICS. Labels say what the audio system
 * reports; only the player can say whether the iPhone's speaker played it.
 */
const STATUS_COLOR = (s) =>
  /COMPLETED|STARTED/.test(s || "") ? "text-[#4fd1c5] border-[#4fd1c5]/50" : /RUNNING/.test(s || "") ? "text-zinc-300 border-white/30" : "text-[#ffb08a] border-[#ffb08a]/60";

function TestButton({ testId, title, hint, onClick, run, busy }) {
  return (
    <div className="border border-white/15 bg-white/[0.02] p-3 flex flex-col gap-2 min-w-0">
      <button
        data-testid={testId}
        onClick={onClick}
        disabled={busy}
        className="min-h-[52px] w-full border border-[#FF3B00] bg-[#FF3B00]/15 hover:bg-[#FF3B00]/30 disabled:opacity-50 text-white font-mono text-[11px] tracking-[0.25em]"
      >
        {busy ? "PLAYING…" : title}
      </button>
      <div className="font-mono text-[9px] tracking-wider text-zinc-500 leading-snug">{hint}</div>
      {run && (
        <div data-testid={`${testId}-result`} data-status={run.status} className="min-w-0">
          <div className={`inline-block border px-2 py-0.5 font-mono text-[10px] tracking-[0.18em] ${STATUS_COLOR(run.status)}`}>{run.status}</div>
          <ol className="mt-1.5 font-mono text-[9px] leading-snug text-zinc-400 break-words">
            {run.events.map((e, i) => (
              <li key={i}>
                <span className="text-zinc-600">+{e.ms}ms</span> <span className="text-zinc-200">{e.label}</span>
                {e.info ? ` — ${e.info}` : ""}
              </li>
            ))}
          </ol>
        </div>
      )}
    </div>
  );
}

function Stat({ k, v, warn }) {
  return (
    <div className="flex justify-between gap-3 border-b border-white/5 py-1 min-w-0">
      <span className="font-mono text-[9px] tracking-[0.18em] text-zinc-500 shrink-0">{k}</span>
      <span className={`font-mono text-[10px] text-right break-all ${warn ? "text-[#ffb08a]" : "text-zinc-200"}`}>{v}</span>
    </div>
  );
}

export default function AudioDiagnostics() {
  const audio = useMissionAudio();
  const st = useAudioSettings();
  const [results, setResults] = useState({});
  const [busy, setBusy] = useState(null);
  const [status, setStatus] = useState(() => audioStatus());
  const [copied, setCopied] = useState(null);
  const [showText, setShowText] = useState(false);
  const textRef = useRef(null);

  useEffect(() => {
    // Nothing is started here: the engine starts inside the player's first tap (iOS rule).
    installAudioUnlock();
    voicePack.ready(); // the media-player test then knows its file inside the tap
    refreshNative().then(() => setStatus(audioStatus()));
    const iv = setInterval(() => setStatus(audioStatus()), 500);
    const nv = setInterval(() => refreshNative(), 3000);
    return () => {
      clearInterval(iv);
      clearInterval(nv);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Each test starts synchronously inside the tap (the engine is created / resumed there).
  const start = (key, fn) => {
    if (busy) return;
    setBusy(key);
    const p = fn();
    setResults((r) => ({ ...r, [key]: { name: "", status: "RUNNING", events: [] } }));
    p.then((run) => {
      setResults((r) => ({ ...r, [key]: run }));
      setBusy(null);
      refreshNative().then(() => setStatus(audioStatus()));
    });
  };

  const report = () => diagnosticsReport(results);
  const copy = () => {
    const text = report();
    const fallback = () => {
      setShowText(true);
      setTimeout(() => {
        const el = textRef.current;
        if (!el) return;
        el.value = text;
        el.focus();
        el.select();
        let ok = false;
        try {
          ok = document.execCommand("copy");
        } catch (e) {}
        setCopied(ok ? "COPIED" : "SELECT THE TEXT BELOW AND COPY IT");
      }, 30);
    };
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => setCopied("COPIED"), fallback);
        return;
      }
    } catch (e) {}
    fallback();
  };

  const rows = radioTraceRows();
  const n = status.nativeSession;
  const nObj = n && typeof n === "object" ? n : null;
  const voiced = rows.filter((r) => r.result === "PLAYBACK STARTED").length;
  const silent = rows.filter((r) => /^SILENT/.test(r.result || "")).length;

  return (
    <div data-testid="audio-diagnostics" className="min-h-screen bg-[#050505] text-white pt-20 short:pt-14 pb-10 safe-px">
      <div className="max-w-[1200px] mx-auto px-4 md:px-8 flex flex-col gap-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <div className="font-mono text-[10px] tracking-[0.35em] text-[#FF3B00]">● AUDIO DIAGNOSTICS</div>
            <div data-testid="diag-build" className="font-mono text-[11px] tracking-[0.2em] text-zinc-300 mt-1">
              {status.build} · {status.platform}
            </div>
          </div>
          <div className="flex gap-2">
            <button data-testid="diag-copy" onClick={copy} className="min-h-[44px] px-4 border border-white/30 hover:border-[#FF3B00] font-mono text-[10px] tracking-[0.25em]">
              COPY DIAGNOSTICS
            </button>
            <Link to="/training" className="min-h-[44px] px-4 border border-white/15 text-zinc-400 font-mono text-[10px] tracking-[0.25em] flex items-center">
              BACK
            </Link>
          </div>
        </div>
        {copied && <div data-testid="diag-copied" className="font-mono text-[10px] tracking-[0.2em] text-[#4fd1c5]">{copied}</div>}
        {showText && <textarea ref={textRef} readOnly data-testid="diag-text" className="w-full h-48 bg-black border border-white/20 font-mono text-[9px] text-zinc-300 p-2" />}

        <div className="font-mono text-[9px] tracking-wider text-zinc-500 leading-relaxed max-w-[70ch]">
          Turn the iPhone's volume up first. Each button plays a sound through the game's own audio output. The labels say what the audio system reports
          — they cannot prove the speaker played it; only you can. Listen for each one.
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <TestButton
            testId="diag-tone"
            title="PLAY TEST TONE"
            hint="Three short beeps (880 Hz), on the game's master output."
            busy={busy === "tone"}
            run={results.tone}
            onClick={() => start("tone", runToneTest)}
          />
          <TestButton
            testId="diag-sfx"
            title="PLAY SOUND EFFECT"
            hint="The launch hold-down release (clank), through the sound-effects channel."
            busy={busy === "sfx"}
            run={results.sfx}
            onClick={() =>
              start("sfx", () =>
                runSfxTest(() => {
                  audio.init();
                  audio.clank(0.7);
                })
              )
            }
          />
          <TestButton
            testId="diag-houston"
            title="PLAY HOUSTON VOICE"
            hint={`Houston's liftoff call (${HOUSTON_TEST_ID}, ${st.voiceLang.toUpperCase()}), the bundled recording through the mission radio.`}
            busy={busy === "houston"}
            run={results.houston}
            onClick={() => start("houston", () => runHoustonTest())}
          />
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          <TestButton
            testId="diag-media"
            title="EXTRA · HOUSTON VIA MEDIA PLAYER"
            hint="The same recording through the iPhone's media player instead of the game engine — for comparison only."
            busy={busy === "media"}
            run={results.media}
            onClick={() => start("media", () => runMediaElementTest())}
          />
          <div className="sm:col-span-2 border border-white/15 p-3 flex flex-col gap-2">
            <div className="font-mono text-[10px] tracking-[0.25em] text-zinc-300">SILENT MODE</div>
            <div className="flex gap-2">
              {[
                ["play", "PLAY SOUND"],
                ["follow", "FOLLOW IPHONE"],
              ].map(([k, l]) => (
                <button
                  key={k}
                  data-testid={`diag-silent-${k}`}
                  onClick={() => setAudioSettings({ silentMode: k })}
                  className={`min-h-[44px] px-3 border font-mono text-[10px] tracking-[0.2em] ${st.silentMode === k ? "border-[#FF3B00] bg-[#FF3B00]/15 text-white" : "border-white/20 text-zinc-500"}`}
                >
                  {l}
                </button>
              ))}
            </div>
            <div className="font-mono text-[9px] tracking-wider text-zinc-500 leading-snug">
              PLAY SOUND: LUNAVIA's audio plays even with the iPhone's Silent Mode on. FOLLOW IPHONE: it is muted while the iPhone is silenced. The volume
              buttons always set the level.
            </div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="border border-white/15 p-3 min-w-0" data-testid="diag-status">
            <div className="font-mono text-[10px] tracking-[0.3em] text-zinc-300 mb-1">AUDIO ENGINE STATUS</div>
            <Stat k="BUILD" v={`${status.build} · ${status.bundle}`} />
            <Stat k="WEB AUDIO" v={status.webAudio ? "available" : "NOT AVAILABLE"} warn={!status.webAudio} />
            <Stat k="AUDIO SYSTEM" v={status.engine} />
            <Stat k="AUDIO CONTEXT" v={status.ctxState} warn={status.ctxState !== "running"} />
            <Stat k="SAMPLE RATE · LATENCY" v={`${status.sampleRate || "-"} Hz · ${status.baseLatency || "-"}`} />
            <Stat k="STARTED BY · TAPS · RESUMES" v={`${status.createdBy || "-"} · ${status.gestures} · ${status.resumes} (${status.resumeFailures} failed) · ${status.interruptions} interruptions`} />
            <Stat k="MASTER (GAME)" v={status.masterGain ?? "-"} />
            <Stat k="RADIO VOLUME" v={`${Math.round(st.voiceVolume * 100)} · bus ${status.voiceBusGain ?? "-"}`} warn={st.voiceVolume === 0} />
            <Stat k="SOUND-EFFECTS VOLUME" v={`${Math.round(st.sfxVolume * 100)} · bus ${status.sfxBusGain ?? "-"}`} warn={st.sfxVolume === 0} />
            <Stat k="MISSION CONTROL VOICE" v={`${st.voice ? "ON" : "OFF"} · ${st.voiceLang.toUpperCase()}`} warn={!st.voice} />
            <Stat k="WEB AUDIO SESSION" v={status.webSession ? `${status.webSession.type} · ${status.webSession.state}` : "not in this web view"} />
            <Stat
              k="IPHONE AUDIO SESSION"
              v={nObj ? `${nObj.category || "-"}${nObj.error ? " · " + nObj.error : ""}` : String(n || "reading…")}
              warn={nObj ? /Ambient|SoloAmbient/.test(nObj.category || "") && st.silentMode === "play" : false}
            />
            {nObj && <Stat k="IPHONE MEDIA VOLUME" v={nObj.outputVolume != null ? `${Math.round(nObj.outputVolume * 100)}%` : "-"} warn={nObj.outputVolume === 0} />}
            {nObj && <Stat k="OUTPUT ROUTE" v={nObj.outputs || "-"} />}
            <Stat k="VOICE FILES" v={status.voicePack} />
          </div>

          <div className="border border-white/15 p-3 min-w-0" data-testid="diag-trace">
            <div className="font-mono text-[10px] tracking-[0.3em] text-zinc-300 mb-1">HOUSTON RADIO THIS SESSION</div>
            <div className="font-mono text-[9px] text-zinc-500 mb-2">
              {rows.length} calls · {voiced} playback started · {silent} silent (subtitle only). Fly the launch, then come back here and COPY DIAGNOSTICS.
            </div>
            <div className="overflow-x-auto max-h-[320px] overflow-y-auto">
              <table className="font-mono text-[9px] text-zinc-300 w-full">
                <tbody>
                  {rows.slice(-60).reverse().map((r, i) => (
                    <tr key={i} className="border-b border-white/5 align-top">
                      <td className="pr-2 text-zinc-500 whitespace-nowrap">{r.queued || r.requested ? new Date(r.queued || r.requested).toISOString().slice(11, 19) : ""}</td>
                      <td className="pr-2 whitespace-nowrap">{r.id}</td>
                      <td className="pr-2">{r.lang || ""}</td>
                      <td className={`pr-2 whitespace-nowrap ${r.result === "PLAYBACK STARTED" ? "text-[#4fd1c5]" : "text-[#ffb08a]"}`}>{r.result}</td>
                      <td className="pr-2 whitespace-nowrap text-zinc-500">{r.end || ""}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
