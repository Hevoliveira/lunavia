# Houston Mission Control — audio restoration and voice proposal

Branch `claude/houston-radio-voice` (from `claude/simplified-countdown` 7616fa0, BUILD 830164e).
Listening page (samples, comparisons, auditions): https://claude.ai/artifact/SVC7aSBqcc931ZjaKAYytK
— the same audio files are in this folder.

## 1. What the evidence showed

Browser traces of the real game (Chromium + SwiftShader, the comms log enabled, voice ON):

* **Triggers**: every mission event requests its call — 218 catalogue lines, all referenced by the
  game (the countdown's eight through `launch.count${n}`), every clip present in EN and PT.
* **Files and decoding**: the voice pack loads (`/voice/...`, bundled), MP3s decode (3.9 s clip in 13 ms).
* **Playback**: with the game's default settings the calls play in Chromium.
* So the silence on the iPhone comes from conditions this browser does not create. The code had
  no recovery for them:
  1. a call made while the AudioContext was not `running` — iOS marks it `suspended` /
     `interrupted` after a notification sound, Siri, a call, an app switch or the lock — became a
     **silent subtitle**, with no attempt to resume; only a later tap re-armed audio, and the
     cinematics (launch, orbit, reentry, recovery) have no taps;
  2. every page (and RADIO CHECK) created and **closed its own AudioContext**;
  3. the first tap **primed speech synthesis**, which shares the iOS audio session with Web Audio;
  4. **the launch mix**: from ignition to tower clear the ducked engine roar sat about level with
     the voice (speech only 5–7 dB above it) — hard to follow even when playing.
* Not reproducible here, and therefore **not confirmed on a device**: which of (1)–(3) the iPhone
  hits, and the effect of the Ring/Silent switch (the game already asks WebKit to play as media
  where the Audio Session API exists, iOS 17+; whether WKWebView honours it is unverified).
  TEST RADIO now reports which case occurs.

## 2. What changed (code)

* `src/audio/audioEngine.js`: one AudioContext for the app, created inside the first gesture and
  kept; resumed by any later tap, on return to the app (visibility, pageshow, focus) and by
  retries after an interruption; a voice leveller (compressor + makeup) on the radio bus.
  Speech-synthesis priming removed.
* `src/audio/comms.js`: before each call a stopped context is asked to resume (≤ 0.7 s); if the
  system refuses, the call runs as a subtitle and the reason is recorded (`diagnose()`).
  Speech synthesis is used only on a device without Web Audio.
* Mix: effects ducked −9 dB while Houston speaks (−12 dB for a critical call), back to full
  after each transmission. Measured during the launch (speech p80 vs effects median):

| Call | before | after |
|---|---|---|
| T−4 … T−1 | +5.0 … +6.7 dB | +9.6 … +11.1 dB |
| Liftoff | +7.3 dB | +13.5 dB |
| Tower clear | +6.3 dB | +12.5 dB |
| Max-Q | +15.3 dB | +19.3 dB |

  Outside transmissions the effects are untouched (peak −12 dB, same as before).
* **TEST RADIO** (AUDIO panel, EN/PT): a short Houston call through the mission's own engine,
  radio chain and voice pack, then the result: played, voice off, the device did not start audio
  (tap again, check volume and Silent mode), or recording missing.

## 3. Coverage — trigger and playback (browser, offline iOS bundle BUILD 37b3847)

"Playback verified" means decoded and started through the game's radio chain in Chromium. **No
audible playback has been verified on a physical iPhone.**

| Mission stage | Audio event (line) | Voice asset | Trigger verified | Playback verified |
|---|---|---|---|---|
| Pre-launch | prelaunch.briefing | en/prelaunch.briefing.0.mp3 | yes (PRE-LAUNCH (EN)) | yes, browser: decoded and played through the radio chain |
| Pre-launch | prelaunch.ckPressure | en/prelaunch.ckPressure.0.mp3 | yes (PRE-LAUNCH (EN)) | yes, browser: decoded and played through the radio chain |
| Pre-launch | prelaunch.ckGuidance | en/prelaunch.ckGuidance.0.mp3 | yes (PRE-LAUNCH (EN)) | yes, browser: decoded and played through the radio chain |
| Pre-launch | prelaunch.ckComms | en/prelaunch.ckComms.0.mp3 | yes (PRE-LAUNCH (EN)) | yes, browser: decoded and played through the radio chain |
| Pre-launch | prelaunch.ckRestraints | en/prelaunch.ckRestraints.0.mp3 | yes (PRE-LAUNCH (EN)) | yes, browser: decoded and played through the radio chain |
| Pre-launch | prelaunch.ckHatch | en/prelaunch.ckHatch.0.mp3 | yes (PRE-LAUNCH (EN)) | yes, browser: decoded and played through the radio chain |
| Pre-launch | prelaunch.ckLaunchControl | en/prelaunch.ckLaunchControl.0.mp3 | yes (PRE-LAUNCH (EN)) | yes, browser: decoded and played through the radio chain |
| Pre-launch | prelaunch.crewReadyLaunch | en/prelaunch.crewReadyLaunch.0.mp3 | yes (PRE-LAUNCH (EN)) | yes, browser: decoded and played through the radio chain |
| Pre-launch | prelaunch.t45 | en/prelaunch.t45.0.mp3 | yes (PRE-LAUNCH (EN)) | yes, browser: decoded and played through the radio chain |
| Pre-launch | prelaunch.t30 | en/prelaunch.t30.0.mp3 | yes (PRE-LAUNCH (EN)) | yes, browser: decoded and played through the radio chain |
| Pre-launch | prelaunch.t20 | en/prelaunch.t20.0.mp3 | yes (PRE-LAUNCH (EN)) | yes, browser: decoded and played through the radio chain |
| Pre-launch | prelaunch.guidanceInternal | en/prelaunch.guidanceInternal.0.mp3 | yes (PRE-LAUNCH (EN)) | yes, browser: decoded and played through the radio chain |
| Earth launch / orbit / TLI | launch.count10 | en/launch.count10.0.mp3 | yes (PRE-LAUNCH (EN)) | yes, browser: decoded and played through the radio chain |
| Earth launch / orbit / TLI | launch.count9 | en/launch.count9.0.mp3 | yes (PRE-LAUNCH (EN)) | yes, browser: decoded and played through the radio chain |
| Earth launch / orbit / TLI | launch.count8 | en/launch.count8.0.mp3 | yes (PRE-LAUNCH (EN)) | yes, browser: decoded and played through the radio chain |
| Earth launch / orbit / TLI | launch.count7 | en/launch.count7.0.mp3 | yes (PRE-LAUNCH (EN)) | yes, browser: decoded and played through the radio chain |
| Earth launch / orbit / TLI | launch.engineStart | en/launch.engineStart.0.mp3 | yes (PRE-LAUNCH (EN)) | yes, browser: decoded and played through the radio chain |
| Earth launch / orbit / TLI | launch.count4 | en/launch.count4.0.mp3 | yes (PRE-LAUNCH (EN)) | yes, browser: decoded and played through the radio chain |
| Earth launch / orbit / TLI | launch.count3 | en/launch.count3.0.mp3 | yes (PRE-LAUNCH (EN)) | yes, browser: decoded and played through the radio chain |
| Earth launch / orbit / TLI | launch.count2 | en/launch.count2.0.mp3 | yes (PRE-LAUNCH (EN)) | yes, browser: decoded and played through the radio chain |
| Earth launch / orbit / TLI | launch.count1 | en/launch.count1.0.mp3 | yes (PRE-LAUNCH (EN)) | yes, browser: decoded and played through the radio chain |
| Earth launch / orbit / TLI | launch.liftoff | en/launch.liftoff.0.mp3 | yes (PRE-LAUNCH (EN)) | yes, browser: decoded and played through the radio chain |
| Earth launch / orbit / TLI | launch.towerClear | en/launch.towerClear.0.mp3 | yes (LAUNCH → LANDING) | yes, browser: decoded and played through the radio chain |
| Earth launch / orbit / TLI | launch.maxQ | en/launch.maxQ.0.mp3 | yes (LAUNCH → LANDING) | yes, browser: decoded and played through the radio chain |
| Earth launch / orbit / TLI | launch.meco | en/launch.meco.0.mp3 | yes (LAUNCH → LANDING) | yes, browser: decoded and played through the radio chain |
| Earth launch / orbit / TLI | launch.staging | en/launch.staging.0.mp3 | yes (LAUNCH → LANDING) | yes, browser: decoded and played through the radio chain |
| Earth launch / orbit / TLI | launch.usIgnition | en/launch.usIgnition.0.mp3 | yes (LAUNCH → LANDING) | yes, browser: decoded and played through the radio chain |
| Earth launch / orbit / TLI | launch.orbit | en/launch.orbit.0.mp3 | yes (LAUNCH → LANDING) | yes, browser: decoded and played through the radio chain |
| Earth launch / orbit / TLI | launch.finalPass | en/launch.finalPass.0.mp3 | yes (LAUNCH → LANDING) | yes, browser: decoded and played through the radio chain |
| Earth launch / orbit / TLI | launch.goTli | en/launch.goTli.0.mp3 | yes (LAUNCH → LANDING) | yes, browser: decoded and played through the radio chain |
| Earth launch / orbit / TLI | launch.tliIgnition | en/launch.tliIgnition.0.mp3 | yes (LAUNCH → LANDING) | yes, browser: decoded and played through the radio chain |
| Earth launch / orbit / TLI | launch.tliCutoff | en/launch.tliCutoff.0.mp3 | yes (LAUNCH → LANDING) | yes, browser: decoded and played through the radio chain |
| Lunar orbit | orbit.arrival | en/orbit.arrival.0.mp3 | yes (LAUNCH → LANDING) | yes, browser: decoded and played through the radio chain |
| Lunar orbit | orbit.goPdi | en/orbit.goPdi.0.mp3 | yes (LAUNCH → LANDING) | yes, browser: decoded and played through the radio chain |
| Lunar descent & landing | descent.pdiStart | en/descent.pdiStart.0.mp3 | yes (LAUNCH → LANDING) | yes, browser: decoded and played through the radio chain |
| Lunar descent & landing | descent.alt100fuelGood | en/descent.alt100fuelGood.0.mp3 | yes (LAUNCH → LANDING) | yes, browser: decoded and played through the radio chain |
| Lunar descent & landing | descent.alt30 | en/descent.alt30.0.mp3 | yes (LAUNCH → LANDING) | yes, browser: decoded and played through the radio chain |
| Lunar descent & landing | descent.contact | en/descent.contact.0.mp3 | yes (LAUNCH → LANDING) | yes, browser: decoded and played through the radio chain |
| Lunar descent & landing | descent.touchdown | en/descent.touchdown.0.mp3 | yes (LAUNCH → LANDING) | yes, browser: decoded and played through the radio chain |
| Lunar descent & landing | descent.touchdownFlight | en/descent.touchdownFlight.0.mp3 | yes (LAUNCH → LANDING) | yes, browser: decoded and played through the radio chain |
| Lunar ascent | ascent.goLiftoff | en/ascent.goLiftoff.0.mp3 | yes (LAUNCH → LANDING) | yes, browser: decoded and played through the radio chain |
| Lunar EVA | eva.firstStep | en/eva.firstStep.0.mp3 | yes (EVA) | yes, browser: decoded and played through the radio chain |
| Lunar EVA | eva.firstStepsCapcom | en/eva.firstStepsCapcom.0.mp3 | yes (EVA) | yes, browser: decoded and played through the radio chain |
| Lunar EVA | eva.goSample | en/eva.goSample.0.mp3 | yes (EVA) | yes, browser: decoded and played through the radio chain |
| Lunar ascent | ascent.armed | en/ascent.armed.0.mp3 | yes (ASCENT → RECOVERY) | yes, browser: decoded and played through the radio chain |
| Lunar ascent | ascent.proceed | en/ascent.proceed.0.mp3 | yes (ASCENT → RECOVERY) | yes, browser: decoded and played through the radio chain |
| Lunar ascent | ascent.liftoff | en/ascent.liftoff.0.mp3 | yes (ASCENT → RECOVERY) | yes, browser: decoded and played through the radio chain |
| Lunar ascent | ascent.pitchover | en/ascent.pitchover.0.mp3 | yes (ASCENT → RECOVERY) | yes, browser: decoded and played through the radio chain |
| Lunar ascent | ascent.insertion | en/ascent.insertion.0.mp3 | yes (ASCENT → RECOVERY) | yes, browser: decoded and played through the radio chain |
| Rendezvous | rdv.tpi | en/rdv.tpi.0.mp3 | yes (ASCENT → RECOVERY) | yes, browser: decoded and played through the radio chain |
| Rendezvous | rdv.mcc | en/rdv.mcc.0.mp3 | yes (ASCENT → RECOVERY) | yes, browser: decoded and played through the radio chain |
| Rendezvous | rdv.braking | en/rdv.braking.0.mp3 | yes (ASCENT → RECOVERY) | yes, browser: decoded and played through the radio chain |
| Rendezvous | rdv.handover | en/rdv.handover.0.mp3 | yes (ASCENT → RECOVERY) | yes, browser: decoded and played through the radio chain |
| Rendezvous | rdv.handoverCrew | en/rdv.handoverCrew.0.mp3 | yes (ASCENT → RECOVERY) | yes, browser: decoded and played through the radio chain |
| Docking | dock.g.acquired | en/dock.g.acquired.0.mp3 | yes (ASCENT → RECOVERY) | yes, browser: decoded and played through the radio chain |
| Docking | dock.contact | en/dock.contact.0.mp3 | yes (ASCENT → RECOVERY) | yes, browser: decoded and played through the radio chain |
| Docking | dock.capture | en/dock.capture.0.mp3 | yes (ASCENT → RECOVERY) | yes, browser: decoded and played through the radio chain |
| Docking | dock.hardCrew | en/dock.hardCrew.0.mp3 | yes (ASCENT → RECOVERY) | yes, browser: decoded and played through the radio chain |
| Docking | dock.hard | en/dock.hard.0.mp3 | yes (ASCENT → RECOVERY) | yes, browser: decoded and played through the radio chain |
| Docking | dock.transfer | en/dock.transfer.0.mp3 | yes (ASCENT → RECOVERY) | yes, browser: decoded and played through the radio chain |
| Docking | dock.jettison | en/dock.jettison.0.mp3 | yes (ASCENT → RECOVERY) | yes, browser: decoded and played through the radio chain |
| Reentry & splashdown | reentry.approach | en/reentry.approach.0.mp3 | yes (ASCENT → RECOVERY) | yes, browser: decoded and played through the radio chain |
| Reentry & splashdown | reentry.separation | en/reentry.separation.0.mp3 | yes (ASCENT → RECOVERY) | yes, browser: decoded and played through the radio chain |
| Reentry & splashdown | reentry.ei | en/reentry.ei.0.mp3 | yes (ASCENT → RECOVERY) | yes, browser: decoded and played through the radio chain |
| Reentry & splashdown | reentry.heating | en/reentry.heating.0.mp3 | yes (ASCENT → RECOVERY) | yes, browser: decoded and played through the radio chain |
| Reentry & splashdown | reentry.heatWarning | en/reentry.heatWarning.0.mp3 | yes (ASCENT → RECOVERY) | yes, browser: decoded and played through the radio chain |
| Reentry & splashdown | reentry.gWarning | en/reentry.gWarning.0.mp3 | yes (ASCENT → RECOVERY) | yes, browser: decoded and played through the radio chain |
| Reentry & splashdown | reentry.climbWarning | en/reentry.climbWarning.0.mp3 | yes (ASCENT → RECOVERY) | yes, browser: decoded and played through the radio chain |
| Reentry & splashdown | reentry.aos | en/reentry.aos.0.mp3 | yes (ASCENT → RECOVERY) | yes, browser: decoded and played through the radio chain |
| Reentry & splashdown | reentry.peakDecel | en/reentry.peakDecel.0.mp3 | yes (ASCENT → RECOVERY) | yes, browser: decoded and played through the radio chain |
| Reentry & splashdown | reentry.drogues | en/reentry.drogues.0.mp3 | yes (ASCENT → RECOVERY) | yes, browser: decoded and played through the radio chain |
| Reentry & splashdown | reentry.mains | en/reentry.mains.0.mp3 | yes (ASCENT → RECOVERY) | yes, browser: decoded and played through the radio chain |
| Reentry & splashdown | reentry.splashdown | en/reentry.splashdown.0.mp3 | yes (ASCENT → RECOVERY) | yes, browser: decoded and played through the radio chain |
| Reentry & splashdown | reentry.splashFlight | en/reentry.splashFlight.0.mp3 | yes (ASCENT → RECOVERY) | yes, browser: decoded and played through the radio chain |
| Ocean Recovery | recovery.ready | en/recovery.ready.0.mp3 | yes (ASCENT → RECOVERY) | yes, browser: decoded and played through the radio chain |
| Ocean Recovery | recovery.visual | en/recovery.visual.0.mp3 | yes (ASCENT → RECOVERY) | yes, browser: decoded and played through the radio chain |
| Ocean Recovery | recovery.located | en/recovery.located.0.mp3 | yes (ASCENT → RECOVERY) | yes, browser: decoded and played through the radio chain |
| Ocean Recovery | recovery.deploying | en/recovery.deploying.0.mp3 | yes (ASCENT → RECOVERY) | yes, browser: decoded and played through the radio chain |
| Lunar orbit | cruise.ambient | en/cruise.ambient.0.mp3 | yes (FAR SIDE (SILENT HORIZON)) | yes, browser: decoded and played through the radio chain |
| Lunar descent & landing | descent.alt100fuelGood | en/descent.alt100fuelGood.0.mp3 | yes (FAR SIDE (SILENT HORIZON)) | correctly withheld: blackout / no line of sight to Earth |
| Lunar descent & landing | descent.alt30 | en/descent.alt30.0.mp3 | yes (FAR SIDE (SILENT HORIZON)) | correctly withheld: blackout / no line of sight to Earth |
| Lunar descent & landing | descent.touchdown | en/descent.touchdown.0.mp3 | yes (FAR SIDE (SILENT HORIZON)) | correctly withheld: blackout / no line of sight to Earth |
| Lunar descent & landing | descent.touchdownFlight | en/descent.touchdownFlight.0.mp3 | yes (FAR SIDE (SILENT HORIZON)) | correctly withheld: blackout / no line of sight to Earth |
| TEST RADIO | settings.radioCheck | en/settings.radioCheck.0.mp3 | yes (AUDIO panel) | yes, browser |

### Not voiced (no recording and no trigger in the game)
* Lunar orbit: LM preparation and undocking (the game shows them; no call exists).
* EVA: per-objective calls exist for every destination; the automated run reached the surface and
  four calls (`p-eva`), the walk back to the ladder is beyond the test script (also on BUILD 1317851).

## 4. Voice proposal (not applied: the library is unchanged)

| | |
|---|---|
| Engine | Kokoro-82M (kokoro-onnx), offline, CPU — Apache-2.0 weights: commercial use and bundling allowed, /bin/bash |
| EN Houston | blend am_michael 0.6 + am_fenrir 0.4 (synthetic identity, no real person) |
| PT-BR Houston | blend pm_alex 0.6 + pm_santa 0.4 (synthetic identity) |
| Direction | phrase-by-phrase synthesis, paced pauses per delivery (calm / lift / focused / urgent / relief / warm), trimmed, high-passed, levelled to one loudness; no breaths or fillers added |
| Radio | the game's own chain (`radio.js`), rendered offline in a browser |
| Files | `proposed/raw`, `proposed/radio`, MP3 mono 64 kbps; `current/` = today's clips for the matching calls |
| Script | `tools/voice/houston_samples.py` |

Evaluated, by actual audio (auditions in `audition/`, objective checks with Whisper-small):

| Option | Result |
|---|---|
| Kokoro male EN voices (michael, fenrir, puck, onyx, eric, blend) | fenrir, puck, eric, blend: all words recognised; michael/onyx swallowed the callsign |
| Kokoro PT (alex, santa, blend) | santa and blend: WER 0.11 (spelling only); alex 0.44 |
| Piper en_US joe; pt_BR faber, cadu, jeff | joe garbles "LUNAVIA"; faber/jeff mispronounce; cadu good. Fine-tuned from the "lessac" voice: commercial use must be cleared |
| Piper en_US ryan | CC BY-NC-SA: not usable commercially (not rendered) |
| Chatterbox, XTTS, F5-TTS (open models) | weights on Hugging Face — blocked by this environment's network policy |
| ElevenLabs, Azure, Google, OpenAI TTS | APIs and pricing pages unreachable here; no prices verified, nothing paid |
| Professional voice actors | `tools/voice/RECORDING_SCRIPT.csv` is ready; same file names drop in |

**Assessment**: the proposed takes differ from today's pack in being a male Houston directed phrase
by phrase; they were chosen on recognition and pitch measurements, not by ear (the build
environment cannot play audio to a listener). They come from the same class of offline model as
today's pack, so expect them to remain recognisably synthetic. A convincingly human Houston most
likely needs a recorded actor pair (EN American male, PT-BR male) or an authorised commercial
voice service — your listening decides.
