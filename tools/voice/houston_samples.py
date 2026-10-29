#!/usr/bin/env python3
"""LUNAVIA — Houston voice proposal: candidate auditions and the six sample transmissions.

Offline only (no network, no API key). Engines available in the build environment:
  * Kokoro-82M (kokoro-onnx, Apache-2.0 weights) — the engine of the current voice pack;
  * Piper VITS voices (piper-tts runtime, models from the sherpa-onnx GitHub releases), CC0
   datasets, fine-tuned from the "lessac" voice.

Direction (what the current pack does not do): every line is spoken as phrases, each phrase
with its own pace, joined by natural pauses (shorter inside a thought, longer between them),
the voice's own leading/trailing silence trimmed, then a light mastering (high-pass, gentle
levelling, loudness matched). No breaths, fillers or effects are added to the raw take; the
radio version is made by LUNAVIA's own radio chain (frontend/src/audio/radio.js) in a browser,
so what you hear is what the game plays.

  python tools/voice/houston_samples.py audition --out DIR      # one line, every candidate voice
  python tools/voice/houston_samples.py samples  --out DIR      # the six transmissions, EN + PT

Needs: kokoro-v1.0.onnx + voices-v1.0.bin (KOKORO_DIR), piper-tts + Piper models (PIPER_DIR),
numpy, scipy, soundfile, lameenc.
"""
import argparse
import json
import os
import re
import sys

import numpy as np
import soundfile as sf
from scipy import signal

KOKORO_DIR = os.environ.get("KOKORO_DIR", ".")
PIPER_DIR = os.environ.get("PIPER_DIR", ".")
SR = 24000

# ---- the six transmissions (Houston / CAPCOM), from the game's own lines and telemetry units ----
# "|" separates phrases inside a thought (short pause); "||" separates thoughts (longer pause).
SAMPLES = [
    ("1-prelaunch", "calm",
     "LUNAVIA, Houston. || Communications check is complete, | and we're looking good for launch.",
     "LUNAVIA, Houston. || Verificação de comunicações concluída, | e está tudo certo para o lançamento."),
    ("2-liftoff", "lift",
     "LUNAVIA, Houston. || We have liftoff. || All systems are looking good.",
     "LUNAVIA, Houston. || Temos a decolagem. || Todos os sistemas estão bem."),
    ("3-descent", "focused",
     "LUNAVIA, Houston. | One hundred meters. || Descent rate's good, | fuel's good.",
     "LUNAVIA, Houston. | Cem metros. || Razão de descida boa, | combustível bom."),
    ("4-low-fuel", "urgent",
     "LUNAVIA, Houston. | Fuel is getting low. || Watch your descent rate, | and bring it down now.",
     "LUNAVIA, Houston. | O combustível está acabando. || Cuidado com a razão de descida, | e desçam agora."),
    ("5-touchdown", "relief",
     "LUNAVIA, Houston. || We copy your touchdown. || Outstanding work.",
     "LUNAVIA, Houston. || Copiamos o pouso de vocês. || Trabalho excepcional."),
    ("6-splashdown", "warm",
     "LUNAVIA, Houston. || We copy splashdown. || Welcome home.",
     "LUNAVIA, Houston. || Copiamos a amerissagem. || Bem-vindos de volta."),
]

# Pace and pauses per delivery (seconds). Speed is the engine's rate (1 = its default).
DELIVERY = {
    "calm": {"speed": 0.94, "short": 0.16, "long": 0.42},
    "lift": {"speed": 1.0, "short": 0.12, "long": 0.30},
    "focused": {"speed": 0.98, "short": 0.12, "long": 0.30},
    "urgent": {"speed": 1.06, "short": 0.08, "long": 0.20},
    "relief": {"speed": 0.90, "short": 0.18, "long": 0.55},
    "warm": {"speed": 0.90, "short": 0.18, "long": 0.55},
}

RESPELL = {
    "en": [(r"\bLUNAVIA\b", "Loona-veeah")],
    "pt": [(r"\bLUNAVIA\b", "Lunavia"), (r"\bHouston\b", "Ríuston")],
}


def respell(text, lang):
    for a, b in RESPELL[lang]:
        text = re.sub(a, b, text)
    return text


# ---- engines -------------------------------------------------------------------------------------
_kokoro = None


def kokoro():
    global _kokoro
    if _kokoro is None:
        from kokoro_onnx import Kokoro
        _kokoro = Kokoro(os.path.join(KOKORO_DIR, "kokoro-v1.0.onnx"), os.path.join(KOKORO_DIR, "voices-v1.0.bin"))
    return _kokoro


def kokoro_voice(spec):
    """'am_michael' or a blend 'am_michael:0.6+am_fenrir:0.4' (a new synthetic identity, no real person)."""
    k = kokoro()
    if "+" not in spec and ":" not in spec:
        return spec
    style = None
    for part in spec.split("+"):
        name, w = part.split(":")
        v = k.get_voice_style(name) * float(w)
        style = v if style is None else style + v
    return style


_piper = {}


def piper(name):
    if name not in _piper:
        from piper import PiperVoice
        _piper[name] = PiperVoice.load(os.path.join(PIPER_DIR, f"vits-piper-{name}", f"{name}.onnx"))
    return _piper[name]


def synth(engine, voice, text, lang, speed):
    text = respell(text, lang)
    if engine == "kokoro":
        a, sr = kokoro().create(text, voice=kokoro_voice(voice), speed=speed, lang="en-us" if lang == "en" else "pt-br")
    else:
        from piper import SynthesisConfig
        v = piper(voice)
        chunks = list(v.synthesize(text, syn_config=SynthesisConfig(length_scale=1.0 / speed)))
        a, sr = np.concatenate([c.audio_float_array for c in chunks]), v.config.sample_rate
    a = np.asarray(a, dtype=np.float32)
    if sr != SR:
        a = signal.resample_poly(a, SR, sr).astype(np.float32)
    return a


# ---- assembly and mastering -----------------------------------------------------------------------
def trim(a, thr=0.012, pad=0.02):
    env = np.abs(a)
    idx = np.where(env > thr * max(1e-6, env.max()))[0]
    if not len(idx):
        return a
    p = int(pad * SR)
    return a[max(0, idx[0] - p): min(len(a), idx[-1] + p)]


def fade(a, ms=8):
    n = min(len(a) // 2, int(SR * ms / 1000))
    if n > 0:
        a = a.copy()
        a[:n] *= np.linspace(0, 1, n)
        a[-n:] *= np.linspace(1, 0, n)
    return a


def master(a, target_rms_db=-19.0):
    b, aa = signal.butter(2, 70 / (SR / 2), "highpass")
    a = signal.lfilter(b, aa, a)
    # gentle levelling: a slow RMS follower, ratio ~2:1 above the threshold
    win = int(0.03 * SR)
    rms = np.sqrt(np.convolve(a * a, np.ones(win) / win, mode="same") + 1e-9)
    thr = 10 ** (-24 / 20)
    gain = np.where(rms > thr, (thr / rms) ** 0.5, 1.0)
    gain = signal.lfilter([0.02], [1, -0.98], gain)
    a = a * gain
    cur = 20 * np.log10(np.sqrt(np.mean(a * a)) + 1e-9)
    a = a * 10 ** ((target_rms_db - cur) / 20)
    peak = np.abs(a).max()
    if peak > 0.89:
        a = a * 0.89 / peak
    return a.astype(np.float32)


def render_line(engine, voice, text, lang, mood, directed=True):
    d = DELIVERY[mood]
    if not directed:  # the current pack's way: the whole line at once
        return master(trim(synth(engine, voice, text.replace("||", "").replace("|", ""), lang, d["speed"])))
    out = [np.zeros(int(0.12 * SR), np.float32)]
    thoughts = [t.strip() for t in text.split("||") if t.strip()]
    for ti, thought in enumerate(thoughts):
        phrases = [p.strip() for p in thought.split("|") if p.strip()]
        for pi, ph in enumerate(phrases):
            # a touch faster inside a thought, settling on its last phrase
            sp = d["speed"] * (1.02 if pi < len(phrases) - 1 else 0.98)
            seg = fade(trim(synth(engine, voice, ph, lang, sp)))
            out.append(seg)
            if pi < len(phrases) - 1:
                out.append(np.zeros(int(d["short"] * SR), np.float32))
        if ti < len(thoughts) - 1:
            out.append(np.zeros(int(d["long"] * SR), np.float32))
    out.append(np.zeros(int(0.15 * SR), np.float32))
    return master(np.concatenate(out))


def write(path, a):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    sf.write(path + ".wav", a, SR, subtype="PCM_16")
    import lameenc
    enc = lameenc.Encoder()
    enc.set_bit_rate(64)
    enc.set_in_sample_rate(SR)
    enc.set_channels(1)
    enc.set_quality(2)
    pcm = (np.clip(a, -1, 1) * 32767).astype(np.int16).tobytes()
    with open(path + ".mp3", "wb") as f:
        f.write(enc.encode(pcm) + enc.flush())
    return len(a) / SR


AUDITION = {
    "en": [("kokoro", "am_michael"), ("kokoro", "am_fenrir"), ("kokoro", "am_puck"), ("kokoro", "am_onyx"), ("kokoro", "am_eric"), ("kokoro", "am_michael:0.6+am_fenrir:0.4"), ("piper", "en_US-joe-medium")],
    "pt": [("kokoro", "pm_alex"), ("kokoro", "pm_santa"), ("kokoro", "pm_alex:0.6+pm_santa:0.4"), ("piper", "pt_BR-faber-medium"), ("piper", "pt_BR-cadu-medium"), ("piper", "pt_BR-jeff-medium")],
}


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("mode", choices=["audition", "samples"])
    ap.add_argument("--out", required=True)
    ap.add_argument("--en", default="kokoro:am_michael")
    ap.add_argument("--pt", default="kokoro:pm_alex")
    ap.add_argument("--only", default="")
    args = ap.parse_args()
    meta = []
    if args.mode == "audition":
        _, mood, en, pt = SAMPLES[4]
        for lang, text in (("en", en), ("pt", pt)):
            for engine, voice in AUDITION[lang]:
                tag = f"{lang}-{engine}-{voice.replace(':', '').replace('+', '_')}"
                d = write(os.path.join(args.out, tag), render_line(engine, voice, text, lang, mood))
                meta.append({"file": tag, "lang": lang, "engine": engine, "voice": voice, "text": text.replace("|", "").replace("  ", " "), "dur": round(d, 2)})
                print(tag, round(d, 2), flush=True)
    else:
        picks = {"en": args.en.split(":", 1), "pt": args.pt.split(":", 1)}
        for sid, mood, en, pt in SAMPLES:
            if args.only and sid not in args.only.split(","):
                continue
            for lang, text in (("en", en), ("pt", pt)):
                engine, voice = picks[lang]
                tag = f"{sid}-{lang}"
                d = write(os.path.join(args.out, "raw", tag), render_line(engine, voice, text, lang, mood))
                meta.append({"id": sid, "file": tag, "lang": lang, "engine": engine, "voice": voice, "mood": mood, "text": re.sub(r"\s*\|+\s*", " ", text).strip(), "dur": round(d, 2)})
                print(tag, round(d, 2), flush=True)
    with open(os.path.join(args.out, "meta.json"), "w") as f:
        json.dump(meta, f, indent=1, ensure_ascii=False)


if __name__ == "__main__":
    sys.exit(main())
