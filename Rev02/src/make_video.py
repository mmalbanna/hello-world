"""Renders the 30 s, 1920x1080, 30 fps picture as raw RGB frames on stdout.

Five shots (7,7,7,7,6 s) with 1 s crossfades at 6, 12, 18, 24 s.
Sub-pixel Ken Burns moves (bicubic affine), light grade, vignette, titles.
"""
import math
import sys

import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

W, H, FPS = 1920, 1080, 30
TOTAL = 30.0
XF = 1.0
IMG = sys.argv[1]
FONT_REG = "/usr/share/fonts/truetype/crosextra/Carlito-Regular.ttf"
FONT_BOLD = "/usr/share/fonts/truetype/crosextra/Carlito-Bold.ttf"

# (file, duration, (cx, cy, zoom) start, (cx, cy, zoom) end, grade)
SHOTS = [
    ("1.webp", 7.0, (0.50, 0.50, 1.00), (0.51, 0.57, 1.24), "warm"),
    ("2.webp", 7.0, (0.42, 0.52, 1.12), (0.58, 0.48, 1.14), "warm"),
    ("3.webp", 7.0, (0.50, 0.58, 1.12), (0.50, 0.44, 1.24), "warm"),
    ("4.webp", 7.0, (0.52, 0.56, 1.04), (0.42, 0.50, 1.20), "warm"),
    ("5.webp", 6.0, (0.46, 0.56, 1.22), (0.50, 0.50, 1.02), "dusk"),
]

CAPTIONS = [
    # start, end, kicker, line
    (0.8, 5.6, "BERNARD DOUMIT MASTER PLAN", "A Vernacular Lebanese Retreat"),
    (7.4, 11.6, "MATERIAL", "Rubble-stone walls framing the pool terrace"),
    (13.4, 17.6, "ARCHITECTURE", "Dressed limestone, stone-shingle roofs, timber balconies"),
    (19.4, 23.6, "PLACE", "Arched openings and terraces beneath the cliffs"),
]
END_CARD = (26.3, 30.0)


def grade(img, kind):
    a = np.asarray(img.convert("RGB"), dtype=np.float32) / 255.0
    if kind == "warm":
        a = a * np.array([1.03, 1.0, 0.95])
        sat = 1.06
    else:
        a = a * np.array([0.98, 1.0, 1.04])
        sat = 1.04
    lum = a @ np.array([0.2126, 0.7152, 0.0722])
    a = lum[..., None] + (a - lum[..., None]) * sat
    a = np.clip(a, 0, 1)
    a = a + 0.08 * (a - a ** 2) * (2 * a - 1) * -1  # gentle S-curve
    a = 0.5 + (a - 0.5) * 1.04
    return Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8))


def vignette():
    y, x = np.mgrid[0:H, 0:W].astype(np.float32)
    d = np.sqrt(((x - W / 2) / (W / 2)) ** 2 + ((y - H / 2) / (H / 2)) ** 2)
    return (1 - 0.28 * np.clip(d - 0.55, 0, 1) ** 1.6)[..., None].astype(np.float32)


def ease(u):
    return 0.5 - 0.5 * math.cos(math.pi * min(max(u, 0), 1))


def shot_frame(img, s0, p0, p1, u):
    e = ease(u) * 0.85 + u * 0.15
    cx, cy, z = (p0[i] + (p1[i] - p0[i]) * e for i in range(3))
    sw, sh = img.size
    sc = s0 * z
    vw, vh = W / sc, H / sc
    left = min(max(cx * sw - vw / 2, 0), sw - vw)
    top = min(max(cy * sh - vh / 2, 0), sh - vh)
    k = 1 / sc
    out = img.transform((W, H), Image.AFFINE, (k, 0, left, 0, k, top), resample=Image.BICUBIC)
    return np.asarray(out, dtype=np.float32)


def text_layer(kicker, line, big=False):
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    shade = Image.new("L", (W, H), 0)
    sd = ImageDraw.Draw(shade)
    sd.rectangle([0, H - 380, W, H], fill=150)
    shade = shade.filter(ImageFilter.GaussianBlur(120))
    layer.putalpha(shade)
    d = ImageDraw.Draw(layer)
    fk = ImageFont.truetype(FONT_BOLD, 30 if not big else 34)
    fl = ImageFont.truetype(FONT_REG, 64 if big else 50)
    x, y = 120, H - (230 if big else 190)
    tracked = " ".join(kicker) if big else kicker
    d.text((x, y), tracked, font=fk, fill=(232, 214, 178, 255))
    d.line([x, y + 52, x + 90, y + 52], fill=(232, 214, 178, 230), width=3)
    d.text((x, y + 72), line, font=fl, fill=(250, 247, 240, 255))
    return np.asarray(layer, dtype=np.float32) / 255.0


def end_layer():
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    shade = Image.new("L", (W, H), 0)
    ImageDraw.Draw(shade).rectangle([0, 0, W, H], fill=110)
    layer.putalpha(shade)
    d = ImageDraw.Draw(layer)
    f1 = ImageFont.truetype(FONT_BOLD, 40)
    f2 = ImageFont.truetype(FONT_REG, 72)
    f3 = ImageFont.truetype(FONT_REG, 34)
    lines = [
        (" ".join("BERNARD DOUMIT MASTER PLAN"), f1, (232, 214, 178, 255), H / 2 - 110),
        ("Vernacular Lebanese Adaptation", f2, (250, 247, 240, 255), H / 2 - 30),
        ("Rev02  |  Motasem Albanna", f3, (225, 225, 225, 255), H / 2 + 80),
    ]
    for txt, f, col, y in lines:
        w = d.textlength(txt, font=f)
        d.text(((W - w) / 2, y), txt, font=f, fill=col)
    return np.asarray(layer, dtype=np.float32) / 255.0


def over(frame, layer, alpha):
    if alpha <= 0:
        return frame
    a = layer[..., 3:4] * alpha
    return frame * (1 - a) + layer[..., :3] * 255.0 * a


def fade_in_out(t, a, b, f=0.6):
    return min(1, max(0, (t - a) / f), max(0, (b - t) / f))


def main():
    imgs, scales = [], []
    for f, *_rest in SHOTS:
        im = Image.open(f"{IMG}/{f}").convert("RGB")
        imgs.append(grade(im, _rest[3]))
        scales.append(max(W / im.width, H / im.height))
    starts = []
    t0 = 0.0
    for s in SHOTS:
        starts.append(t0)
        t0 += s[1] - XF
    vig = vignette()
    caps = [(a, b, text_layer(k, l, big=(i == 0))) for i, (a, b, k, l) in enumerate(CAPTIONS)]
    endl = end_layer()
    out = sys.stdout.buffer
    for fi in range(int(TOTAL * FPS)):
        t = fi / FPS
        frame = None
        for i, (f, dur, p0, p1, _) in enumerate(SHOTS):
            st = starts[i]
            if not (st <= t < st + dur):
                continue
            fr = shot_frame(imgs[i], scales[i], p0, p1, (t - st) / dur)
            w = 1.0
            if i > 0 and t < st + XF:
                w = ease((t - st) / XF)
            frame = fr if frame is None else frame * (1 - w) + fr * w
        frame = frame * vig
        for a, b, layer in caps:
            frame = over(frame, layer, fade_in_out(t, a, b))
        frame = over(frame, endl, fade_in_out(t, END_CARD[0], END_CARD[1] + 5, 0.9))
        g = min(1, t / 0.6, (TOTAL - t) / 0.8)
        frame = frame * max(0.0, g)
        out.write(np.clip(frame, 0, 255).astype(np.uint8).tobytes())


if __name__ == "__main__":
    main()
