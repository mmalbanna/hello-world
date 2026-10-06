"""Title, caption and end-card layers (RGBA float 0..1) for the film."""
import numpy as np
from PIL import Image, ImageDraw, ImageFilter, ImageFont

FONT_REG = "/usr/share/fonts/truetype/crosextra/Carlito-Regular.ttf"
FONT_BOLD = "/usr/share/fonts/truetype/crosextra/Carlito-Bold.ttf"


def text_layer(W, H, kicker, line, big=False):
    s = W / 1920
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    shade = Image.new("L", (W, H), 0)
    ImageDraw.Draw(shade).rectangle([0, H - int(380 * s), W, H], fill=140)
    layer.putalpha(shade.filter(ImageFilter.GaussianBlur(120 * s)))
    d = ImageDraw.Draw(layer)
    fk = ImageFont.truetype(FONT_BOLD, int((34 if big else 30) * s))
    fl = ImageFont.truetype(FONT_REG, int((64 if big else 50) * s))
    x, y = int(120 * s), H - int((230 if big else 190) * s)
    d.text((x, y), " ".join(kicker) if big else kicker, font=fk, fill=(232, 214, 178, 255))
    d.line([x, y + int(52 * s), x + int(90 * s), y + int(52 * s)], fill=(232, 214, 178, 230), width=max(1, int(3 * s)))
    d.text((x, y + int(72 * s)), line, font=fl, fill=(250, 247, 240, 255))
    return np.asarray(layer, dtype=np.float32) / 255.0


def end_layer(W, H):
    s = W / 1920
    layer = Image.new("RGBA", (W, H), (0, 0, 0, 0))
    shade = Image.new("L", (W, H), 0)
    ImageDraw.Draw(shade).rectangle([0, 0, W, H], fill=115)
    layer.putalpha(shade)
    d = ImageDraw.Draw(layer)
    rows = [
        (" ".join("BERNARD DOUMIT MASTER PLAN"), ImageFont.truetype(FONT_BOLD, int(40 * s)), (232, 214, 178, 255), H / 2 - 110 * s),
        ("Vernacular Lebanese Adaptation", ImageFont.truetype(FONT_REG, int(72 * s)), (250, 247, 240, 255), H / 2 - 30 * s),
        ("Rev02  |  Motasem Albanna", ImageFont.truetype(FONT_REG, int(34 * s)), (225, 225, 225, 255), H / 2 + 80 * s),
    ]
    for txt, f, col, y in rows:
        d.text(((W - d.textlength(txt, font=f)) / 2, y), txt, font=f, fill=col)
    return np.asarray(layer, dtype=np.float32) / 255.0


def over(frame, layer, alpha):
    if alpha <= 0:
        return frame
    a = layer[..., 3:4] * alpha
    return frame * (1 - a) + layer[..., :3] * a


def fade_in_out(t, a, b, f=0.6):
    return min(1.0, max(0.0, (t - a) / f), max(0.0, (b - t) / f))
