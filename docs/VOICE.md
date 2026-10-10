# LUNAVIA — Mission Control Voice

Mission control is a cast of five voices (FLIGHT, CAPCOM, GUIDANCE, the onboard
COMPUTER, and the crew). They speak from **telemetry**, through a restrained
**live radio chain**, one at a time, **in English or Brazilian Portuguese**, with
optional subtitles. It all runs offline, from clips bundled in the app.

## 1. Why the old voice sounded artificial

| Finding | Effect |
|---|---|
| `speechSynthesis` (the device's system TTS) for every line | Robotic or flat on many devices, and quality depended on which voices the phone had installed. Siri voices are not available to web views. |
| One fixed `rate` / `pitch` for all lines | No difference between calm, urgent or relieved. |
| Spellings hacked for the engine (`T. L. I.`, `max-Q`) | Odd pauses. |
| `speechSynthesis.cancel()` before every line | Calls cut each other off mid-word. |
| System TTS cannot be routed through Web Audio | No radio processing and no ducking were possible. |
| One voice for ground and crew; a single wording per event | No characters, and every flight repeated the same phrases. |
| Fixed altitude triggers (500/200/100/30 m) and phase-only reentry calls | The voice ignored what the pilot was actually doing. |
| No language setting and no subtitles | — |

## 2. Approach

| | Pre-generated neural (this build) | Human voice actors | Premium cloud neural TTS (pre-generated) | Device TTS (before) |
|---|---|---|---|---|
| Naturalness | Good prosody and clear diction. Emotion only through pacing and wording, no breaths. | Best: real emotion, breath, timing | Close to human, with some emotion control | Robotic to fair, device-dependent |
| Consistency | Fixed cast, identical on every device | Fixed cast | Fixed cast | Varies by device and iOS version |
| Offline | Yes (bundled) | Yes (bundled) | Yes once generated; needs the service and an API key to generate | Yes |
| Cost | Free (Apache-2.0 model, local CPU) | Paid studio sessions per actor and language | Paid subscription / API usage | Free |
| Pack size | 3.0 MB (196 clips, EN+PT) | About the same at this bitrate | About the same | 0 |
| Multilingual | EN strong; PT-BR usable but weaker (the model has only 3 PT voices and less PT training data) | Needs native actors per language | Strong in both | Depends on installed voices |
| Latency | ~0 (decoded locally in milliseconds) | ~0 | ~0 | Variable start delay |
| Radio processing / ducking | Yes | Yes | Yes | No |

**Recommendation.** Ship the pre-generated neural pack now. It is a large step
up from device TTS and adds a fixed cast, radio, ducking, priorities and
subtitles. It is **not** equivalent to human speech: there are no breaths,
emotion comes only from pacing, and the Portuguese voices are noticeably more
synthetic. For a premium human-sounding pack, record the script
(§9) with voice actors, or, with your approval, generate it with a paid
premium TTS service. The new files replace the bundled ones with **no code
change**.

## 3. Cast

| Role | Radio | EN voice (Kokoro) | PT-BR voice (Kokoro) | Speaks |
|---|---|---|---|---|
| CAPCOM | air-to-ground | `af_heart` (female, warm) | `pf_dora` | The only ground voice that talks to the crew: go/no-go, warnings, relief |
| FLIGHT | ground loop | `am_michael` (low, measured, 4 % slower) | `pm_alex`, −2 semitones | Decisions and the tone of the room: "go for powered descent", "hold your data" |
| GUIDANCE | ground loop | `am_fenrir` | `pm_santa` | Numbers and events: countdown, altitudes, staging, drogues |
| COMPUTER | onboard | `bf_emma` (even, flat) | `pf_dora`, +2 semitones | Alarms only: attitude, G load, heat shield, altitude increasing |
| CREW (LUNAVIA) | air-to-ground | `am_puck` | `pm_alex` | "Beginning powered descent", "Contact light", "We're climbing out" |

The roles are distinguished by voice, pitch, pacing and radio path: CAPCOM
routine calls carry Quindar tones, the ground loops are cleaner, and the
COMPUTER has a speaker-like sound with an attention chime.

**Moods** (`commsLines.json` → generator): calm 0.95×, focused 1.03×, urgent 1.12×,
relief 0.92× with longer beats, somber 0.86× with the longest beats, neutral
(COMPUTER). A `...` in a line is a deliberate pause, rendered as real silence
("Splashdown... Welcome home, LUNAVIA.").

## 4. Architecture

```
telemetry ─► monitor (descentComms / reentryComms, pure) ─► say(id) ─►
  comms director (priority queue, one channel) ─► transmit ─►
  voice pack (bundled MP3, decoded on demand) ─► radio chain ─► voice bus ─┐
                                          SFX ─► SFX bus ─► duck ──────────┴─► speakers
                                          └─► subtitles (event stream)
```

| File | Job |
|---|---|
| `frontend/src/audio/commsLines.json` | Line catalog: role, priority, cooldown, mood, verbosity flags, EN/PT variants. Shared by the app and the generator. |
| `frontend/src/audio/commsDirector.js` | Who speaks and when (pure, unit-tested). |
| `frontend/src/audio/descentComms.js`, `reentryComms.js` | What is worth saying, from telemetry (pure, unit-tested on the real physics). |
| `frontend/src/audio/radio.js` | Per-transmission Web Audio radio chain. |
| `frontend/src/audio/voicePack.js` | Manifest, offline clip loading, small decode cache. |
| `frontend/src/audio/comms.js` | The hub: director + pack + radio + settings + subtitles + speech fallback. |
| `frontend/src/audio/audioSettings.js` | Player settings, saved on the device. |
| `frontend/src/hooks/useMissionAudio.js` | AudioContext, SFX/voice buses, ducking, iOS unlock and interruption handling. |
| `frontend/src/components/CommsSubtitles.jsx`, `AudioSettings.jsx` | Subtitles; the AUDIO panel in the navigation bar. |
| `tools/voice/render.py` | Offline pack generator (Kokoro-82M). |

## 5. Telemetry-driven calls

**Descent** (fed at 15 Hz with the same `assessDescent` the HUD uses):

| Call | Trigger |
|---|---|
| go for landing | crossing 500 m |
| 200 m (+ "rate's good" when on profile) | crossing 200 m; skipped while the rate is critical |
| 100 m + fuel good / tight | crossing 100 m, from the fuel state |
| 30 m, dust | crossing 30 m |
| Descent rate high (CRITICAL) | descent-rate state DANGER held 0.35 s |
| Braking burn now (CADET) | braking burn due within 1 s while still coasting |
| Watch your drift | lateral state CAUTION or worse held 0.6 s |
| Drifting away from the LZ (CADET) | moving away from the LZ, more than 25 m off, high up |
| Rough terrain at touchdown point | projected touchdown on a hazard, held 0.6 s |
| Fuel tight / fuel critical | fuel state CAUTION / DANGER (once each) |
| Attitude warning (COMPUTER) | tilt state DANGER held 0.3 s |
| "That's better" (CADET) | after a warning, all states nominal for 2.5 s |
| Contact light (crew) | crossing 4 m |
| Touchdown + FLIGHT "Nice work" / loss of signal + "hold your data" | outcome |

Each warning re-checks its condition just before it is spoken. If the pilot has
already fixed the problem, it is never said.

**Reentry** (fed from the HUD snapshot):

- approach, separation
- prep corridor too shallow or steep, then "go for entry"
- entry interface
- "blackout expected"
- lift-vector calls from the look-ahead prediction, and "back in the corridor" when they work
- heating
- peak deceleration
- onboard heat, G and altitude-increasing alarms
- AOS
- drogues, mains, splashdown and FLIGHT
- skip-out, or loss of signal

## 6. Priority, interrupts and silence

| Priority | Examples | Gap before it | Max wait | Interrupts |
|---|---|---|---|---|
| CRITICAL | descent rate high, fuel critical, G load, heat shield | 0.25 s | 2 s | anything lower |
| HIGH | drift, hazard, lift vector, attitude | 0.45 s | 5 s | AMBIENT only; waits for a routine call to finish |
| NORMAL | milestones, events | 0.9 s | 8 s | — |
| AMBIENT | "Quiet night on the ground" | 4 s of silence, and nothing else waiting | 3 s | — |

- **One voice at a time.** Only a CRITICAL call cuts a speaker, with a
  squelch, as on a real loop. A HIGH warning waits for a routine call to
  finish; the queue is served by priority.
- **Spam control:**
  - per-line cooldowns (for example, descent rate high: 7 s);
  - shared cooldowns between alternates (shallow/steep);
  - a line already queued or on the air is never queued again;
  - variants rotate, so the same wording never plays twice in a row.
- **Verbosity by difficulty:**
  - CADET hears everything;
  - ASTRONAUT loses the extra help (`assist`);
  - COMMANDER also loses corrective advice (`coach`) and chatter.

  Status calls and alarms are for everyone.
- **Sustained conditions:** a warning fires once when its condition has held
  for a moment, then at most once per reminder interval while it persists. It
  is never requested on every frame.
- **Follow-ups keep their order:** FLIGHT's line after CAPCOM's touchdown or
  splashdown call, and the corridor-lost call after the crew's.
- **Pause / abort / app in background:** the call on the air is cut and the
  queue is dropped.

## 7. Radio, mix and blackout

- **Radio chain** (`radio.js`, built per transmission and disconnected after):
  - space loop: 300–3100 Hz band, a presence peak, light saturation,
    compression, a low static bed;
  - ground loops: wider and cleaner;
  - onboard: speaker-like, no static.

  Squelch click in and out. Quindar tones (2525 Hz in, 2475 Hz out) on
  CAPCOM's routine calls only. **CRITICAL calls get half the drive and
  less static.** RADIO EFFECTS off gives the clean voice at the same loudness.
- **Mix:** every sound effect goes to the SFX bus and voices to the voice bus.
  While someone speaks, the SFX bus ducks to 60 % (42 % for CRITICAL) and
  recovers over about 0.5 s. Effects are never silenced. Inside versus outside
  sound is unchanged: the launch roar's onboard/close/distant muffling still
  applies.
- **Blackout:**
  - As the plasma builds, the link quality drops with the heat rate: more
    static, a narrower band and brief dropouts. The last calls before LOS
    sound strained.
  - At LOS there is a burst of static, the call on the air is cut, and ground
    calls are refused.
  - The onboard COMPUTER alarms still sound.
  - Telemetry, HUD and guidance continue.
  - After AOS, CAPCOM comes back on a recovering link ("telemetry is back").

## 8. Languages, subtitles and settings

**AUDIO** in the navigation bar, saved on the device (`lunavia.audio.v1`):

- MISSION CONTROL VOICE on/off
- VOICE LANGUAGE (EN / PT-BR)
- SUBTITLES on/off
- SUBTITLE LANGUAGE (independent of the voice)
- VOICE VOLUME
- SOUND EFFECTS volume
- RADIO EFFECTS on/off
- RADIO CHECK, which plays a sample

The first launch defaults to Portuguese on a Portuguese device and English
otherwise. Subtitles show the role and the line while it is spoken. They sit
in the upper middle of the screen, never over the flight controls, and never
take touches. With the voice off, subtitles still run on the clip timings.
Training's MUTE INSTRUCTOR mutes mission control on that page only.

## 9. Voice pack: regenerate, or replace with human recordings

- `frontend/public/voice/<lang>/<line id>.<variant>.mp3` plus `manifest.json` (duration per clip).
- **Kokoro pack:**
  - mono, 24 kHz, 48 kbps;
  - 196 clips, 8.4 minutes of speech, 3.0 MB;
  - dry (the radio is added live).
- **Regenerate:** see the header of `tools/voice/render.py`.
  - The model files come from GitHub releases (Hugging Face is not needed).
  - About 2.5 minutes on 4 CPU cores.
  - `--only <ids>` re-renders single lines.
- **Human recording spec** (`tools/voice/RECORDING_SCRIPT.csv` has one row per file, with role, priority and mood):
  - dry, close-mic'd, no reverb, no effects;
  - 48 kHz WAV delivered, encoded to mono MP3 (24–44.1 kHz, 48–64 kbps);
  - trim to about 30 ms before and 90 ms after the voice;
  - level speech to about −19 dBFS RMS with peaks below −1 dBFS.

  Keep the file names, then update the `d` durations in `manifest.json`.
  Casting: a warm, steady CAPCOM; an older, slower FLIGHT; a crisp GUIDANCE;
  a flat, synthetic COMPUTER (it may stay synthetic); a crew voice. Native
  Brazilian Portuguese actors for PT.
- **Fallback:** if a clip is missing or cannot be decoded, the line is spoken
  by the device's speech synthesis in the selected language.

## 10. iPhone

- **Audio start:** audio starts from the first tap (WebKit autoplay rule), and
  `navigator.audioSession.type = "playback"` plays through the silent switch on
  iOS 17 and later.
- **Interruptions:** a call, Siri or an alarm moves the AudioContext to
  `interrupted`. The hook re-arms the tap-to-unlock listeners and resumes on
  return.
- **Background or lock:** the call on the air is cut and the queue dropped.
  Nothing stale plays when the player returns.
- **Memory:**
  - compressed clips of one language: about 1.5 MB;
  - decoded audio: at most 12 clips, a few MB;
  - each transmission's nodes are disconnected after it ends;
  - the AudioContext is closed when the page unmounts.
- **Offline:** everything is bundled in the app (Capacitor `public/`). There
  are no network requests, no API keys, and no paid services.

## 11. Validation

Validation levels, kept separate:

| Level | What was done |
|---|---|
| Code inspection | Audit of the old path (§1); review of every call site migrated (launch, mission, descent, reentry, training). |
| Automated tests | `src/audio/comms.test.js`, 20 tests: catalog and pack completeness (every line × variant × language), director rules (no overlap, interrupts, cooldowns, stale or irrelevant drop, AMBIENT gating, blackout, verbosity, keyed mic), descent monitor flown on the real lander physics (guided landing, free fall, low fuel, monitor+director over a crash), and reentry monitor flown on the real entry physics (nominal with blackout and AOS, shallow skip-out, steep overload, COMMANDER without advice). |
| Browser captures (headless Chromium) | The exact Web Audio mix the app sends to the speakers was recorded from inside the page: character, emotion, launch and blackout reels in EN and PT, radio on and off; and touch-driven Training flights (landing and reentry) with the comms timeline and on-screen subtitles logged. Signal checks found no overlap, no clipping, the band-limiting present and Quindar tones present. |
| Listening | **Not done by the developer**: the automated tools cannot judge how human a voice sounds. The reels are delivered for the human review this milestone requires. |
| Real iPhone | **Not done** (no device in this environment). Checklist in §12. |

## 12. Real-device checklist

1. Silent switch on: the voice and effects are heard.
2. Start a landing, take a call or trigger Siri mid-descent, return: tap once, and the audio resumes with no stale callouts.
3. Lock the phone during reentry and unlock: no backlog plays.
4. AUDIO → PT-BR voice with EN subtitles (and the reverse): the lines and subtitles match the selection.
5. RADIO EFFECTS off: same loudness, clean voice.
6. Twenty training retries: no growth in memory (Safari Web Inspector → Timelines → Memory).
7. Flight mode on, cold start: the voice works (fully offline).
