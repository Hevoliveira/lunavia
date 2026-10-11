"""LUNAVIA voice QA: analyse captures from reels.js / in-game runs and encode them to MP3.

  python3 tools/voice/qa/analyze.py <capture dir>     (needs numpy, scipy, lameenc)

Per capture: length, RMS and peak level, clipped samples, share of energy above
4 kHz and below 250 Hz (radio band-limiting), energy in the Quindar band
(2450-2550 Hz), voice overlap from the comms log (must be False) and capture
buffers lost to a blocked main thread (a capture artefact, not playback).
"""
import json, glob, os, sys, numpy as np, lameenc
from scipy.signal import welch
d = sys.argv[1]
def band_energy(x, sr, lo, hi):
    f, p = welch(x, sr, nperseg=4096); m = (f >= lo) & (f < hi); return p[m].sum() / p.sum()
for f in sorted(glob.glob(f"{d}/*.pcm16")):
    name = os.path.basename(f)[:-6]
    meta = json.load(open(f[:-6] + ".json"))
    sr = meta["sr"]; x = np.frombuffer(open(f, "rb").read(), "<i2").astype(np.float32) / 32767
    log = meta["log"]; t0 = None
    # align log to the recording: first 'start' is when audio began; use wall clock deltas
    starts = [e for e in log if e["type"] == "start"]; ends = [e for e in log if e["type"] in ("end", "cut")]
    rms = np.sqrt(np.mean(x**2)); peak = np.abs(x).max(); clip = np.mean(np.abs(x) > 0.98) * 100
    hi = band_energy(x, sr, 4000, 12000) * 100; lo = band_energy(x, sr, 0, 250) * 100
    q = band_energy(x, sr, 2450, 2550) * 100
    # overlap check from the log: each start after previous end
    seq = sorted([(e["wall"], e["type"], e["id"]) for e in log if e["type"] in ("start", "end", "cut")])
    on = 0; overlap = False
    for _, ty, _id in seq:
        on += 1 if ty == "start" else -1
        if on > 1: overlap = True
    print(f"{name:20s} {len(x)/sr:5.1f}s rms {20*np.log10(rms+1e-9):6.1f} dBFS peak {20*np.log10(peak+1e-9):5.1f} clip {clip:.3f}% >4k {hi:4.1f}% <250 {lo:4.1f}% quindar-band {q:4.2f}% overlap {overlap} gaps {meta.get('gaps')}")
    enc = lameenc.Encoder(); enc.set_bit_rate(96); enc.set_in_sample_rate(sr); enc.set_channels(1); enc.set_quality(2)
    open(f"{d}/{name}.mp3", "wb").write(enc.encode((np.clip(x, -1, 1) * 32767).astype("<i2").tobytes()) + enc.flush())
