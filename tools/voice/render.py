#!/usr/bin/env python3
"""LUNAVIA mission-control voice pack generator.

Renders every line in frontend/src/audio/commsLines.json to a small mono MP3 with the
open-weight Kokoro-82M neural TTS model (Apache-2.0, runs locally on CPU, no network
or API key). Output goes to frontend/public/voice/<lang>/<line id>.<variant>.mp3 plus
frontend/public/voice/manifest.json, which the app reads at runtime.

The clips are deliberately "dry": no radio effect is baked in. The app adds the radio
chain live (band-limit, compression, static, quindar), so RADIO EFFECTS can be turned
off and a human-recorded pack can drop in later with the same file names.

Setup (once):
  python3 -m venv .venv && .venv/bin/pip install kokoro-onnx==0.6.1 soundfile lameenc scipy
  curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx
  curl -LO https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin

Usage:
  .venv/bin/python tools/voice/render.py --model kokoro-v1.0.onnx --voices voices-v1.0.bin
  [--lang en|pt] [--only id,id] [--wav DIR]   (--wav also writes uncompressed review copies)
  .venv/bin/python tools/voice/render.py --script tools/voice/RECORDING_SCRIPT.csv   (actor script only)
"""
import argparse, csv, json, os, re, sys, time

np = None  # numpy, imported in main() so --script needs only the standard library

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
CATALOG = os.path.join(ROOT, "frontend", "src", "audio", "commsLines.json")
OUT = os.path.join(ROOT, "frontend", "public", "voice")
SR = 24000
KBPS = 48

# Cast. pitch = semitone shift applied after synthesis (duration preserved), used to separate
# characters where the model has too few voices (Portuguese ships with only three).
CAST = {
    "en": {
        "lang": "en-us",
        "CAPCOM": {"voice": "af_heart", "pitch": 0.0},
        "FLIGHT": {"voice": "am_michael", "pitch": 0.0, "speed": 0.96},
        "GUIDANCE": {"voice": "am_fenrir", "pitch": 0.0},
        "COMPUTER": {"voice": "bf_emma", "pitch": 0.0},
        "CREW": {"voice": "am_puck", "pitch": 0.0},
    },
    "pt": {
        "lang": "pt-br",
        "CAPCOM": {"voice": "pf_dora", "pitch": 0.0},
        "FLIGHT": {"voice": "pm_alex", "pitch": -2.0, "speed": 0.96},
        "GUIDANCE": {"voice": "pm_santa", "pitch": 0.0},
        "COMPUTER": {"voice": "pf_dora", "pitch": 2.0},
        "CREW": {"voice": "pm_alex", "pitch": 0.0},
    },
}

# Pacing per mood: speaking rate and the pause rendered where the script has "...".
MOODS = {
    "calm": {"speed": 0.95, "pause": 0.45},
    "focused": {"speed": 1.03, "pause": 0.32},
    "urgent": {"speed": 1.12, "pause": 0.2},
    "relief": {"speed": 0.92, "pause": 0.6},
    "somber": {"speed": 0.86, "pause": 0.75},
    "lift": {"speed": 1.05, "pause": 0.35},
    "neutral": {"speed": 1.0, "pause": 0.25},
}

# Pronunciation respellings (subtitles keep the written form).
RESPELL = {
    "en": [(r"\bLUNAVIA\b", "Loona-veeah"), (r"\bLV-001\b", "L V zero zero one")],
    "pt": [
        (r"\bLUNAVIA\b", "Lunavia"),
        (r"\bHouston\b", "Ríuston"),
        (r"\bLV-001\b", "éle vê zero zero um"),
        (r"\bTLI\b", "tê éle i"),
        (r"\bRCS\b", "érre cê ésse"),
    ],
}


def respell(text, lang):
    for pat, rep in RESPELL[lang]:
        text = re.sub(pat, rep, text)
    return text


def segments(text):
    """Split on '...' (a deliberate beat). Each piece is closed as its own sentence."""
    parts = [p.strip() for p in text.split("...") if p.strip()]
    return [p if p[-1] in ".!?" else p + "." for p in parts]


def trim(x, floor_db=-42.0, head=0.03, tail=0.09):
    env = np.abs(x)
    thr = env.max() * 10 ** (floor_db / 20)
    idx = np.flatnonzero(env > thr)
    if not len(idx):
        return x
    a = max(0, idx[0] - int(head * SR))
    b = min(len(x), idx[-1] + int(tail * SR))
    return x[a:b]


def pitch_shift(x, semitones):
    """Resample so pitch moves by `semitones`; caller pre-stretches so duration is kept."""
    if not semitones:
        return x
    from scipy.signal import resample_poly

    r = 2 ** (semitones / 12)
    up, down = 1000, int(round(1000 * r))
    return resample_poly(x, up, down).astype(np.float32)


def finish(x):
    from scipy.signal import butter, sosfilt

    x = sosfilt(butter(2, 80, "highpass", fs=SR, output="sos"), x)
    # loudness: RMS of speech frames to -19 dBFS, then a soft ceiling at about -1 dBFS
    frame = int(0.03 * SR)
    n = len(x) // frame
    rms = np.sqrt(np.mean(x[: n * frame].reshape(n, frame) ** 2, axis=1)) if n else np.array([np.sqrt(np.mean(x**2))])
    voiced = rms[rms > rms.max() * 0.1] if rms.max() > 0 else rms
    level = np.sqrt(np.mean(voiced**2)) or 1.0
    x = x * (10 ** (-19 / 20) / level)
    x = 0.89 * np.tanh(x / 0.89)
    fade_in, fade_out = int(0.004 * SR), int(0.02 * SR)
    x[:fade_in] *= np.linspace(0, 1, fade_in)
    x[-fade_out:] *= np.linspace(1, 0, fade_out)
    return x.astype(np.float32)


def encode_mp3(x):
    import lameenc

    enc = lameenc.Encoder()
    enc.set_bit_rate(KBPS)
    enc.set_in_sample_rate(SR)
    enc.set_channels(1)
    enc.set_quality(2)
    pcm = (np.clip(x, -1, 1) * 32767).astype("<i2").tobytes()
    return enc.encode(pcm) + enc.flush()


def render_line(k, lang, line, text):
    cast = CAST[lang][line["role"]]
    mood = MOODS[line.get("mood", "focused")]
    speed = mood["speed"] * cast.get("speed", 1.0)
    r = 2 ** (cast["pitch"] / 12)
    pieces = []
    for i, seg in enumerate(segments(respell(text, lang))):
        audio, sr = k.create(seg, voice=cast["voice"], speed=speed / r, lang=CAST[lang]["lang"])
        assert sr == SR, sr
        if i:
            pieces.append(np.zeros(int(mood["pause"] * SR), np.float32))
        pieces.append(trim(pitch_shift(np.asarray(audio, np.float32), cast["pitch"])))
    return finish(np.concatenate(pieces))


def write_script(path, catalog):
    with open(path, "w", newline="", encoding="utf-8") as f:
        w = csv.writer(f)
        w.writerow(["file", "role", "priority", "mood", "language", "line"])
        for line in catalog["lines"]:
            for n, v in enumerate(line["variants"]):
                for lang in ("en", "pt"):
                    w.writerow([f"{lang}/{line['id']}.{n}.mp3", line["role"], line["priority"], line.get("mood", "focused"), lang, v[lang]])
    print("wrote", path)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="kokoro-v1.0.onnx")
    ap.add_argument("--voices", default="voices-v1.0.bin")
    ap.add_argument("--lang", choices=["en", "pt"])
    ap.add_argument("--only", help="comma-separated line ids")
    ap.add_argument("--wav", help="also write review WAVs here")
    ap.add_argument("--script", help="write the voice-actor recording script (CSV) and exit")
    a = ap.parse_args()
    catalog = json.load(open(CATALOG, encoding="utf-8"))
    if a.script:
        return write_script(a.script, catalog)

    global np
    import numpy

    np = numpy
    from kokoro_onnx import Kokoro

    k = Kokoro(a.model, a.voices)
    langs = [a.lang] if a.lang else ["en", "pt"]
    only = set(a.only.split(",")) if a.only else None
    man_path = os.path.join(OUT, "manifest.json")
    manifest = json.load(open(man_path)) if os.path.exists(man_path) else {}
    manifest.update({
        "version": 1,
        "source": "Kokoro-82M v1.0 (Apache-2.0), synthesized offline by tools/voice/render.py",
        "format": f"mp3 mono {SR} Hz {KBPS} kbps, dry (radio added at runtime)",
    })
    manifest.setdefault("langs", {})
    t0, total, n_clips = time.time(), 0, 0
    for lang in langs:
        entry = manifest["langs"].setdefault(lang, {"clips": {}})
        entry["cast"] = {role: CAST[lang][role]["voice"] for role in catalog["roles"]}
        os.makedirs(os.path.join(OUT, lang), exist_ok=True)
        for line in catalog["lines"]:
            if only and line["id"] not in only:
                continue
            clips = []
            for n, v in enumerate(line["variants"]):
                x = render_line(k, lang, line, v[lang])
                rel = f"{lang}/{line['id']}.{n}.mp3"
                data = encode_mp3(x)
                with open(os.path.join(OUT, rel), "wb") as f:
                    f.write(data)
                if a.wav:
                    import soundfile as sf

                    os.makedirs(os.path.join(a.wav, lang), exist_ok=True)
                    sf.write(os.path.join(a.wav, lang, f"{line['id']}.{n}.wav"), x, SR)
                clips.append({"f": rel, "d": round(len(x) / SR, 2)})
                total += len(data)
                n_clips += 1
            entry["clips"][line["id"]] = clips
            print(f"{lang} {line['id']:28s} {len(clips)} clip(s) {clips[0]['d']:.2f}s", flush=True)
    with open(man_path, "w") as f:
        json.dump(manifest, f, indent=1, sort_keys=True)
    print(f"{n_clips} clips, {total / 1024:.0f} KB, {time.time() - t0:.0f}s")


if __name__ == "__main__":
    sys.exit(main())
