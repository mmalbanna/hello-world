"""Birds flying through the shots.

Each bird is a small 3D model (body, tail, two-segment wings) on a smooth
flight path through the scene. It flaps in bursts and glides between them,
banks into turns, and is projected through the shot's own camera for every
sub-frame, so its size, parallax and motion blur match the flythrough.
Drawn anti-aliased (4x supersampled) and faded toward the background colour
with distance.
"""
import math

import numpy as np
from PIL import Image, ImageDraw

KINDS = {
    "swallow": dict(span=0.32, body=0.55, chord=0.10, sweep=0.10, tail=0.10, fork=True, hz=8.0,
                    flap_on=0.45, flap_off=0.30, amp=38.0, glide=4.0, color=(0.07, 0.08, 0.10)),
    "dove": dict(span=0.62, body=0.50, chord=0.16, sweep=0.04, tail=0.11, fork=False, hz=5.0,
                 flap_on=0.9, flap_off=0.5, amp=40.0, glide=4.0, color=(0.17, 0.17, 0.20)),
    "gull": dict(span=1.1, body=0.42, chord=0.14, sweep=0.07, tail=0.10, fork=False, hz=3.2,
                 flap_on=1.0, flap_off=1.4, amp=30.0, glide=6.0, color=(0.09, 0.09, 0.12)),
    "raptor": dict(span=1.5, body=0.40, chord=0.22, sweep=0.02, tail=0.15, fork=False, hz=2.6,
                   flap_on=0.8, flap_off=2.8, amp=26.0, glide=8.0, color=(0.12, 0.10, 0.09)),
    "stork": dict(span=1.9, body=0.55, chord=0.27, sweep=0.0, tail=0.08, fork=False, hz=2.0,
                  flap_on=1.2, flap_off=2.5, amp=22.0, glide=3.0, color=(0.93, 0.93, 0.90),
                  color2=(0.07, 0.07, 0.07)),
}


def unit(v):
    n = np.linalg.norm(v)
    return v / n if n > 1e-9 else v


def rot(axis, ang, v):
    a = unit(axis)
    return v * math.cos(ang) + np.cross(a, v) * math.sin(ang) + a * np.dot(a, v) * (1 - math.cos(ang))


class Bird:
    def __init__(self, spec, sc):
        self.k = KINDS[spec["kind"]]
        self.phase = spec.get("phase", 0.0)
        self.sc = sc
        pts = []
        for t, u, v, z in spec["keys"]:
            u, v = u * sc.px, v * sc.px
            pts.append((t, np.array([(u - sc.cx) / sc.f * z, (v - sc.cy) / sc.f * z, z])))
        self.t = np.array([p[0] for p in pts])
        self.P = np.array([p[1] for p in pts])

    def pos(self, t):
        T, P = self.t, self.P
        if t <= T[0]:
            return P[0] + (P[1] - P[0]) / (T[1] - T[0]) * (t - T[0])
        if t >= T[-1]:
            return P[-1] + (P[-1] - P[-2]) / (T[-1] - T[-2]) * (t - T[-1])
        i = int(np.searchsorted(T, t) - 1)
        p0, p1, p2, p3 = P[max(i - 1, 0)], P[i], P[i + 1], P[min(i + 2, len(P) - 1)]
        s = (t - T[i]) / (T[i + 1] - T[i])
        return 0.5 * ((2 * p1) + (-p0 + p2) * s + (2 * p0 - 5 * p1 + 4 * p2 - p3) * s * s + (-p0 + 3 * p1 - 3 * p2 + p3) * s ** 3)

    def frame(self, t):
        """Position and orthonormal (right, up, forward) with banking."""
        dt = 0.04
        p = self.pos(t)
        f = unit(self.pos(t + dt) - self.pos(t - dt))
        f_prev = unit(self.pos(t) - self.pos(t - 2 * dt))
        f_next = unit(self.pos(t + 2 * dt) - self.pos(t))
        up_w = self.sc.U
        turn = float(np.dot(np.cross(f_prev, f_next), up_w)) / (2 * dt)
        r = unit(np.cross(f, up_w))
        u = np.cross(r, f)
        bank = max(-0.6, min(0.6, -0.35 * turn))
        return p, rot(f, bank, r), rot(f, bank, u), f

    def wings(self, t):
        k = self.k
        cyc = k["flap_on"] + k["flap_off"]
        x = (t + self.phase) % cyc
        env = min(1.0, x / 0.08, max(0.0, (k["flap_on"] - x) / 0.08)) if x < k["flap_on"] else 0.0
        ph = 2 * math.pi * k["hz"] * (t + self.phase)
        glide = math.radians(k["glide"])
        a1 = glide * (1 - env) + env * math.radians(k["amp"]) * math.sin(ph)
        a2 = a1 + env * math.radians(18) * math.sin(ph - 0.8)
        return a1, a2

    def polygons(self, t):
        k = self.k
        s, L = k["span"], k["span"] * k["body"]
        p, r, u, f = self.frame(t)
        a1, a2 = self.wings(t)
        P = lambda df, dr, du=0.0: p + f * df + r * dr + u * du
        body = [P(0.50 * L, 0), P(0.35 * L, 0.035 * s), P(0.12 * L, 0.06 * s), P(-0.15 * L, 0.045 * s), P(-0.25 * L, 0.03 * s)]
        if k["fork"]:
            tail = [P(-0.52 * L, 0.08 * s), P(-0.36 * L, 0.0), P(-0.52 * L, -0.08 * s)]
        else:
            tail = [P(-0.47 * L, k["tail"] * s), P(-0.50 * L, 0.0), P(-0.47 * L, -k["tail"] * s)]
        body = body + tail + [P(-0.25 * L, -0.03 * s), P(-0.15 * L, -0.045 * s), P(0.12 * L, -0.06 * s), P(0.35 * L, -0.035 * s)]
        polys = [(body, 0)]
        c = k["chord"] * s
        back_tone = 1 if "color2" in k else 0
        for sg in (1.0, -1.0):
            d1 = r * sg * math.cos(a1) + u * math.sin(a1)
            d2 = r * sg * math.cos(a2) + u * math.sin(a2)
            root = p + r * sg * 0.04 * s
            elbow = root + d1 * 0.24 * s
            tip = elbow + d2 * 0.24 * s - f * k["sweep"] * s
            front = [root + f * 0.10 * L, elbow + f * 0.5 * c, tip + f * 0.15 * c]
            back = [tip - f * 0.35 * c, elbow - f * 0.5 * c, root - f * 0.06 * L]
            mid = [(front[2] + back[0]) / 2, (front[1] + back[1]) / 2, (front[0] + back[2]) / 2]
            polys.append((front + mid, 0))
            polys.append(([mid[2], mid[1], mid[0]] + back, back_tone))
        return p, polys


def draw(img, sc, taus, cam_fn, specs, ss=4):
    """Composite the shot's birds onto img (float RGB). taus are the times
    sampled across the shutter (motion blur); cam_fn(tau) -> (C, R, ft)."""
    if not specs:
        return img
    H, W = img.shape[:2]
    cxo, cyo = (W - 1) / 2, (H - 1) / 2
    K = len(taus)
    cams = [(t, *cam_fn(t)) for t in taus]
    for spec in specs:
        bird = Bird(spec, sc)
        tones = 2 if "color2" in bird.k else 1
        acc = np.zeros((tones, H, W), np.float32)
        dist = []
        for tau, C, R, ft in cams:
            centre, polys = bird.polygons(tau)
            zs = centre[2]
            if zs > 0.5:
                us, vs = sc.f * centre[0] / zs + sc.cx, sc.f * centre[1] / zs + sc.cy
                if 0 <= us < sc.W and 0 <= vs < sc.H and sc.z[int(vs), int(us)] < 0.92 * zs:
                    continue
            pc = (np.array([q for poly, _ in polys for q in poly]) - C) @ R
            if (pc[:, 2] < 0.5).any():
                continue
            xy = np.stack([ft * pc[:, 0] / pc[:, 2] + cxo, ft * pc[:, 1] / pc[:, 2] + cyo], 1)
            x0, y0 = np.floor(xy.min(0)).astype(int) - 2
            x1, y1 = np.ceil(xy.max(0)).astype(int) + 3
            if x1 < 0 or y1 < 0 or x0 >= W or y0 >= H or (x1 - x0) > 600 or (y1 - y0) > 600:
                continue
            dist.append(float(np.linalg.norm(centre - C)))
            ax0, ay0, ax1, ay1 = max(x0, 0), max(y0, 0), min(x1, W), min(y1, H)
            for tone in range(tones):
                patch = Image.new("L", ((x1 - x0) * ss, (y1 - y0) * ss), 0)
                d = ImageDraw.Draw(patch)
                n = 0
                for poly, pt in polys:
                    m = len(poly)
                    if pt == tone:
                        d.polygon([((xy[n + i, 0] - x0) * ss, (xy[n + i, 1] - y0) * ss) for i in range(m)], fill=255)
                    n += m
                a = np.asarray(patch.resize((x1 - x0, y1 - y0), Image.BOX), np.float32) / 255.0
                acc[tone, ay0:ay1, ax0:ax1] += a[ay0 - y0 : ay1 - y0, ax0 - x0 : ax1 - x0] / K
        if not dist:
            continue
        cover = acc.sum(0)
        ys, xs = np.nonzero(cover > 0.002)
        if not len(ys):
            continue
        y0, y1, x0, x1 = ys.min(), ys.max() + 1, xs.min(), xs.max() + 1
        pad = 12
        bg = img[max(y0 - pad, 0) : y1 + pad, max(x0 - pad, 0) : x1 + pad].reshape(-1, 3).mean(0)
        haze = 1 - math.exp(-np.mean(dist) / 700.0)
        for tone, key in enumerate(("color", "color2")[:tones]):
            col = np.array(bird.k[key], np.float32) * (1 - haze) + bg * haze
            a = np.clip(acc[tone, y0:y1, x0:x1], 0, 1)[..., None]
            img[y0:y1, x0:x1] = img[y0:y1, x0:x1] * (1 - a) + col * a
    return img
