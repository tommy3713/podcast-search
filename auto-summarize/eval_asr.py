#!/usr/bin/env python3
"""
Compare Whisper configurations on short clips of an episode.

Usage:
    python eval_asr.py <episode.mp3> --out eval/ [--clip 0:180 --clip 1200:300] [--config turbo --config breeze]

For each clip, writes <out>/<start>-<dur>/<config>.txt (one "[m:ss] text" line per segment).
To score, hand-correct one of the outputs into <out>/<start>-<dur>/reference.txt (plain text,
timestamps optional) and re-run: a CER table is printed for every config with a reference.
"""
import argparse
import os
import re
import subprocess
import sys
import time

import mlx_whisper
import opencc

from main import WHISPER_PROMPT, normalize_transcript_text

# What the pipeline did before timestamps / s2tw / the new prompt, kept as the baseline
LEGACY_PROMPT = "股癌，謝孟恭，Gooaye，台股，美股，Fed，聯準會，ETF，殖利率，通膨，升息，降息，半導體，台積電，輝達，NVIDIA，蘋果，Google，Meta，特斯拉，股海，SiFive"
LEGACY_FIXES = {"聖風宮": "謝孟恭", "謝夢恭": "謝孟恭", "谷海": "股癌", "孫悟空": "謝孟恭"}
_s2twp = opencc.OpenCC("s2twp")
_s2tw = opencc.OpenCC("s2tw")


def legacy_normalize(text):
    text = _s2twp.convert(text)
    for wrong, correct in LEGACY_FIXES.items():
        text = text.replace(wrong, correct)
    return text


CONFIGS = {
    "baseline": ("mlx-community/whisper-large-v3-turbo", LEGACY_PROMPT, legacy_normalize),
    "turbo": ("mlx-community/whisper-large-v3-turbo", WHISPER_PROMPT, normalize_transcript_text),
    "large-v3": ("mlx-community/whisper-large-v3-mlx", WHISPER_PROMPT, normalize_transcript_text),
    # Community MLX conversion of MediaTek's Taiwanese-Mandarin fine-tune of Whisper
    "breeze": ("eoleedi/Breeze-ASR-25-mlx", WHISPER_PROMPT, normalize_transcript_text),
}


def fmt_ts(seconds):
    total = int(seconds)
    return f"{total // 60}:{total % 60:02d}"


def cut_clip(mp3_path, start, duration, wav_path):
    subprocess.run(
        ["ffmpeg", "-y", "-loglevel", "error", "-ss", str(start), "-t", str(duration),
         "-i", mp3_path, "-ac", "1", "-ar", "16000", wav_path],
        check=True,
    )


# Compare characters only: punctuation, spacing, case, 臺/台 and simplified forms don't count
def cer_normalize(text):
    text = re.sub(r"^\[\d+:\d{2}\]\s*", "", text, flags=re.M)
    text = _s2tw.convert(text).replace("臺", "台").lower()
    return re.sub(r"[^\w]|_", "", text)


def edit_distance(a, b):
    prev = list(range(len(b) + 1))
    for i, ca in enumerate(a, 1):
        cur = [i]
        for j, cb in enumerate(b, 1):
            cur.append(min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (ca != cb)))
        prev = cur
    return prev[-1]


def cer(hypothesis, reference):
    ref = cer_normalize(reference)
    return edit_distance(cer_normalize(hypothesis), ref) / max(len(ref), 1)


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("mp3")
    parser.add_argument("--out", required=True)
    parser.add_argument("--clip", action="append", help="start:duration in seconds (default 0:180)")
    parser.add_argument("--config", action="append", choices=list(CONFIGS), help="default: all")
    args = parser.parse_args()

    clips = [tuple(int(x) for x in c.split(":")) for c in (args.clip or ["0:180"])]
    configs = args.config or list(CONFIGS)

    for start, duration in clips:
        clip_dir = os.path.join(args.out, f"{start}-{duration}")
        os.makedirs(clip_dir, exist_ok=True)
        wav_path = os.path.join(clip_dir, "clip.wav")
        if not os.path.exists(wav_path):
            cut_clip(args.mp3, start, duration, wav_path)

        for name in configs:
            out_path = os.path.join(clip_dir, f"{name}.txt")
            if os.path.exists(out_path):
                continue
            model, prompt, normalize = CONFIGS[name]
            print(f"[{start}-{duration}] {name} ...", flush=True)
            t0 = time.time()
            result = mlx_whisper.transcribe(wav_path, path_or_hf_repo=model, language="zh", initial_prompt=prompt)
            elapsed = time.time() - t0
            lines = [f"[{fmt_ts(start + s['start'])}] {normalize(s['text'].strip())}" for s in result["segments"]]
            with open(out_path, "w", encoding="utf-8") as f:
                f.write("\n".join(lines) + "\n")
            print(f"  {len(lines)} segments in {elapsed:.0f}s", flush=True)

        ref_path = os.path.join(clip_dir, "reference.txt")
        if os.path.exists(ref_path):
            reference = open(ref_path, encoding="utf-8").read()
            print(f"\nCER for clip {start}-{duration}:")
            for name in configs:
                hyp = open(os.path.join(clip_dir, f"{name}.txt"), encoding="utf-8").read()
                print(f"  {name:<10} {cer(hyp, reference):.1%}")


if __name__ == "__main__":
    sys.exit(main())
