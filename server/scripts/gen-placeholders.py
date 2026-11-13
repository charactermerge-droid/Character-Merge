"""
Generate placeholder assets for every row in fixtures/characters.csv and fixtures/merges.csv:

  local-storage/thumbs/<thumb_blob>   512x512 PNG card (colour + name + tier)
  local-storage/merges/<video_blob>   3 s H.264 MP4: "A + B" -> crossfade -> result name

Requires Pillow and imageio-ffmpeg (bundled ffmpeg). Run from anywhere:
  python scripts/gen-placeholders.py [--out DIR] [--fixtures DIR]
"""
import argparse
import csv
import hashlib
import os
import subprocess
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

try:
    import imageio_ffmpeg
    FFMPEG = imageio_ffmpeg.get_ffmpeg_exe()
except ImportError:
    FFMPEG = "ffmpeg"

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent

PALETTE = {
    "tiger": (235, 120, 30),
    "rabbit": (190, 190, 210),
    "frog": (70, 170, 80),
    "owl": (110, 80, 160),
    "dragon": (200, 40, 60),
}
TIER_COLOURS = {"common": (120, 120, 120), "rare": (40, 120, 220), "legendary": (230, 170, 20)}

FPS = 24
SECONDS = 3
SIZE = 640


def colour_for(char_id):
    if char_id in PALETTE:
        return PALETTE[char_id]
    h = hashlib.md5(char_id.encode()).digest()
    return (80 + h[0] % 150, 80 + h[1] % 150, 80 + h[2] % 150)


def font(size, bold=True):
    candidates = ["segoeuib.ttf" if bold else "segoeui.ttf", "arialbd.ttf" if bold else "arial.ttf"]
    fonts_dir = Path(os.environ.get("WINDIR", "C:/Windows")) / "Fonts"
    for name in candidates:
        p = fonts_dir / name
        if p.exists():
            return ImageFont.truetype(str(p), size)
    try:
        return ImageFont.load_default(size=size)
    except TypeError:  # very old Pillow
        return ImageFont.load_default()


def lerp(a, b, t):
    return tuple(int(round(a[i] + (b[i] - a[i]) * t)) for i in range(3))


def mix(a, b):
    return lerp(a, b, 0.5)


def text_centered(draw, xy, text, fnt, fill, anchor="mm"):
    draw.text(xy, text, font=fnt, fill=fill, anchor=anchor)


def read_rows(path):
    with open(path, newline="", encoding="utf-8-sig") as f:
        return list(csv.DictReader(f))


# ---------------------------------------------------------------- thumbnails

def make_thumb(char, out):
    s = 512
    bg = colour_for(char["id"])
    img = Image.new("RGB", (s, s), (24, 24, 30))
    d = ImageDraw.Draw(img)
    d.rounded_rectangle((16, 16, s - 16, s - 16), radius=48, fill=bg)
    d.rounded_rectangle((16, 16, s - 16, s - 16), radius=48, outline=(255, 255, 255), width=6)
    text_centered(d, (s / 2, s / 2 - 40), char["display_name"][:1].upper(), font(260), (255, 255, 255))
    text_centered(d, (s / 2, s - 110), char["display_name"], font(56), (255, 255, 255))
    tier = char.get("tier", "common").strip().lower()
    tc = TIER_COLOURS.get(tier, TIER_COLOURS["common"])
    d.rounded_rectangle((s / 2 - 90, s - 70, s / 2 + 90, s - 30), radius=20, fill=tc)
    text_centered(d, (s / 2, s - 50), tier.upper(), font(24), (255, 255, 255))
    img.save(out, "PNG", optimize=True)


# -------------------------------------------------------------------- videos

def frame(t, a, b, result_name):
    """Render one frame at time t (seconds)."""
    ca, cb = colour_for(a["id"]), colour_for(b["id"])
    cm = mix(ca, cb)
    img = Image.new("RGB", (SIZE, SIZE), (18, 18, 24))
    d = ImageDraw.Draw(img)
    big, mid, small = font(120), font(64), font(36)

    if t < 1.0:                       # two halves, "+"
        d.rectangle((0, 0, SIZE // 2, SIZE), fill=ca)
        d.rectangle((SIZE // 2, 0, SIZE, SIZE), fill=cb)
        text_centered(d, (SIZE / 4, SIZE / 2), a["display_name"], mid, (255, 255, 255))
        text_centered(d, (3 * SIZE / 4, SIZE / 2), b["display_name"], mid, (255, 255, 255))
        text_centered(d, (SIZE / 2, SIZE / 2), "+", big, (255, 255, 255))
    elif t < 2.0:                     # halves collapse toward the centre, colours blend
        p = t - 1.0
        d.rectangle((0, 0, SIZE, SIZE), fill=lerp((18, 18, 24), cm, p))
        gap = int((SIZE // 2) * (1 - p))
        d.rectangle((0, 0, gap, SIZE), fill=lerp(ca, cm, p))
        d.rectangle((SIZE - gap, 0, SIZE, SIZE), fill=lerp(cb, cm, p))
        fade = int(255 * (1 - p))
        text_centered(d, (SIZE / 2, SIZE / 2), "merging...", small, (fade, fade, fade))
    else:                             # reveal
        p = min(1.0, (t - 2.0) * 3)   # quick pop in
        d.rectangle((0, 0, SIZE, SIZE), fill=cm)
        d.ellipse((SIZE / 2 - 220, SIZE / 2 - 220, SIZE / 2 + 220, SIZE / 2 + 220),
                  fill=lerp(cm, (255, 255, 255), 0.25 * p))
        name_font = font(int(40 + 56 * p))
        text_centered(d, (SIZE / 2, SIZE / 2 - 10), result_name, name_font, (255, 255, 255))
        text_centered(d, (SIZE / 2, SIZE / 2 + 80), f"{a['display_name']} + {b['display_name']}", small, (240, 240, 240))
    text_centered(d, (SIZE / 2, SIZE - 30), "PLACEHOLDER", font(22, bold=False), (255, 255, 255))
    return img


def make_video(a, b, result_name, out):
    cmd = [
        FFMPEG, "-y", "-loglevel", "error",
        "-f", "rawvideo", "-pix_fmt", "rgb24", "-s", f"{SIZE}x{SIZE}", "-r", str(FPS), "-i", "-",
        "-c:v", "libx264", "-pix_fmt", "yuv420p", "-profile:v", "baseline", "-level", "3.1",
        "-crf", "23", "-movflags", "+faststart", str(out),
    ]
    proc = subprocess.Popen(cmd, stdin=subprocess.PIPE)
    for i in range(FPS * SECONDS):
        proc.stdin.write(frame(i / FPS, a, b, result_name).tobytes())
    proc.stdin.close()
    if proc.wait() != 0:
        raise SystemExit(f"ffmpeg failed for {out}")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=str(ROOT / "local-storage"))
    ap.add_argument("--fixtures", default=str(ROOT / "fixtures"))
    args = ap.parse_args()

    out = Path(args.out)
    (out / "thumbs").mkdir(parents=True, exist_ok=True)
    (out / "merges").mkdir(parents=True, exist_ok=True)

    chars = {r["id"].strip(): r for r in read_rows(Path(args.fixtures) / "characters.csv") if r["id"].strip()}
    merges = [r for r in read_rows(Path(args.fixtures) / "merges.csv") if r["char_a"].strip()]

    for c in chars.values():
        dest = out / "thumbs" / c["thumb_blob"].strip()
        make_thumb(c, dest)
        print(f"thumb  {dest.name}")

    for m in merges:
        a, b = chars.get(m["char_a"].strip()), chars.get(m["char_b"].strip())
        if not a or not b:
            print(f"skip   {m['video_blob']}: unknown character", file=sys.stderr)
            continue
        dest = out / "merges" / m["video_blob"].strip()
        make_video(a, b, m["result_name"].strip() or m["result_id"].strip(), dest)
        print(f"video  {dest.name}  ({dest.stat().st_size // 1024} KB)")


if __name__ == "__main__":
    main()
