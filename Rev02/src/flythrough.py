"""2.5D camera-projection flythrough renderer.

Each render becomes a layered 3D scene (metric depth + inpainted background
layer). A virtual camera flies through it: every source pixel is projected
into the moving camera (z-buffer), colour is resampled bicubically from the
source, and pixels the camera uncovers come from the background layer.
Adds pool-water ripples, cloud drift, sub-frame motion blur, automatic
framing that never exposes the image border, motion-matched transitions,
grade, bloom and titles.

  flythrough.py zoom                 framing pre-pass (writes build/zoom)

Rendering itself runs on the GPU path in glrender.py.
"""
import math
import os
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np

import titles
from shots import CAPTIONS, CUTS, END_CARD, INSERTS, ORDER, SHOTS

ROOT = Path(__file__).resolve().parent.parent
FPS = 30
DUR = 30.0
NFRAMES = int(DUR * FPS)
SHUTTER = 0.5 / FPS
CUT_HALF = 2.0 / FPS
SHOT_T = 6.0


def smootherstep(x):
    x = min(max(x, 0.0), 1.0)
    return x * x * x * (x * (6 * x - 15) + 10)


def ease(x, e):
    if x < 0:
        return (1 - e) * x
    if x > 1:
        return 1 + (1 - e) * (x - 1)
    return (1 - e) * x + e * smootherstep(x)


def unit(v):
    return v / np.linalg.norm(v)


def rodrigues(axis, ang):
    a = unit(np.asarray(axis, float))
    K = np.array([[0, -a[2], a[1]], [a[2], 0, -a[0]], [-a[1], a[0], 0]])
    return np.eye(3) + math.sin(ang) * K + (1 - math.cos(ang)) * (K @ K)


def grade(a, kind):
    if kind == "warm":
        a = a * np.array([1.03, 1.0, 0.95], np.float32)
        sat = 1.06
    else:
        a = a * np.array([0.98, 1.0, 1.04], np.float32)
        sat = 1.04
    lum = a @ np.array([0.2126, 0.7152, 0.0722], np.float32)
    a = lum[..., None] + (a - lum[..., None]) * sat
    a = np.clip(a, 0, 1)
    a = a - 0.08 * (a - a * a) * (2 * a - 1)
    return 0.5 + (a - 0.5) * 1.04


def pushpull(x, w):
    """Fill values where weight w is low from a smooth multiscale average."""
    w = w.astype(np.float32)
    x = x.astype(np.float32)
    ch = x.ndim == 3
    pyr = []
    a, b = x * (w[..., None] if ch else w), w
    while True:
        pyr.append((a, b))
        if min(a.shape[:2]) <= 2:
            break
        size = ((a.shape[1] + 1) // 2, (a.shape[0] + 1) // 2)
        a, b = cv2.resize(a, size, interpolation=cv2.INTER_AREA), cv2.resize(b, size, interpolation=cv2.INTER_AREA)
    a, b = pyr[-1]
    bb = np.maximum(b, 1e-6)[..., None] if ch else np.maximum(b, 1e-6)
    cur = a / bb
    for a, b in reversed(pyr[:-1]):
        up = cv2.resize(cur, (a.shape[1], a.shape[0]), interpolation=cv2.INTER_LINEAR)
        bb = np.maximum(b, 1e-6)[..., None] if ch else np.maximum(b, 1e-6)
        wt = np.clip(b, 0, 1)[..., None] if ch else np.clip(b, 0, 1)
        cur = np.where(wt > 1e-4, a / bb, up) * wt + up * (1 - wt)
    return cur


class Scene:
    def __init__(self, name, scale=1.0):
        self.name, self.cfg = name, SHOTS[name]
        d = np.load(ROOT / "build" / "scene" / f"{name}.npz")
        get = lambda k: d[k] if d[k].size else None
        rgb, z, bg, zb = d["rgb"], d["z"], d["bg"], d["zb"]
        water, sky, skyplate = get("water"), get("sky"), get("skyplate")
        if scale != 1.0:
            H0, W0 = z.shape
            size = (int(round(W0 * scale)), int(round(H0 * scale)))
            area = lambda a: None if a is None else cv2.resize(a, size, interpolation=cv2.INTER_AREA)
            rgb, bg, water, sky, skyplate = map(area, (rgb, bg, water, sky, skyplate))
            z = cv2.resize(z, size, interpolation=cv2.INTER_NEAREST)
            zb = cv2.resize(zb, size, interpolation=cv2.INTER_NEAREST)
        self.rgb, self.z, self.bg, self.zb = rgb, z, bg, zb
        self.water, self.sky, self.skyplate = water, sky, skyplate
        self.H, self.W = z.shape
        self.px = self.W / 2000.0
        self.f = (self.W / 2) / math.tan(math.radians(self.cfg["hfov"]) / 2)
        self.cx, self.cy = (self.W - 1) / 2, (self.H - 1) / 2
        th = math.radians(self.cfg["pitch"])
        self.M = np.array([[1, 0, 0], [0, math.cos(th), -math.sin(th)], [0, math.sin(th), math.cos(th)]])
        self.U = self.M @ np.array([0.0, -1.0, 0.0])
        v, u = np.mgrid[0 : self.H, 0 : self.W].astype(np.float32)
        P = np.stack([(u - self.cx) / self.f * z, (v - self.cy) / self.f * z, z], -1)
        self.P = P.reshape(-1, 3)
        rng = np.random.default_rng(1)
        solid = np.flatnonzero(self.z.ravel() < self.cfg["z_max"] * 0.5)
        self.samples = self.P[rng.choice(solid, 500, replace=False)]
        self.zoom_curve = None
        zf = ROOT / "build" / "zoom" / f"{name}.npz"
        if zf.exists():
            zc = np.load(zf)
            self.zoom_curve = (zc["tau"], zc["zoom"])

    # ---------------------------------------------------------------- camera
    def point(self, u, v, off):
        u, v = u * self.px, v * self.px
        r = max(2, int(8 * self.px))
        zz = float(np.median(self.z[int(v) - r : int(v) + r, int(u) - r : int(u) + r]))
        P = np.array([(u - self.cx) / self.f * zz, (v - self.cy) / self.f * zz, zz])
        return P + self.M @ np.asarray(off, float)

    def camera(self, tau, whip=True):
        c = self.cfg
        s = ease(tau / c.get("dur", SHOT_T), c["ease"])
        p0, p1 = np.asarray(c["pos0"], float), np.asarray(c["pos1"], float)
        C = self.M @ (p0 + (p1 - p0) * s)
        T0, T1 = self.point(*c["tgt0"]), self.point(*c["tgt1"])
        tgt = T0 + (T1 - T0) * s
        roll = math.radians(c["roll0"] + (c["roll1"] - c["roll0"]) * s)
        z0, z1 = c.get("zoom0", 1.0), c.get("zoom1", 1.0)
        yaw, fx = 0.0, {"radial": 0.0, "hblur": 0.0, "zoom": z0 + (z1 - z0) * s}
        intro, outro = c.get("intro"), c.get("outro")
        if intro and intro["kind"] == "zoom":
            fwd = unit(T0 - self.M @ p0)
            x = min(max(tau / intro["dur"], 0.0), 1.0)
            g = 1 - (1 - x) ** 3
            C, tgt = C + fwd * intro["dist"] * g, tgt + fwd * intro["dist"] * g
            fx["radial"] = max(fx["radial"], (1 - x) ** 2)
        if outro and outro["kind"] == "zoom":
            fwd = unit(T1 - self.M @ p1)
            x = (tau - (c.get("dur", SHOT_T) - outro["dur"])) / outro["dur"]
            if x > 0:
                C, tgt = C + fwd * outro["dist"] * x ** 3, tgt + fwd * outro["dist"] * x ** 3
                fx["radial"] = max(fx["radial"], min(x, 1.2) ** 2)
        if intro and intro["kind"] == "whip":
            x = max(tau / intro["dur"], 0.0)
            if x < 1:
                yaw = -math.radians(intro["yaw"]) * (1 - x) ** 2.5
                fx["hblur"] = (1 - x) ** 2
        if outro and outro["kind"] == "whip":
            x = (tau - (c.get("dur", SHOT_T) - outro["dur"])) / outro["dur"]
            if x > 0:
                yaw = math.radians(outro["yaw"]) * x ** 2.5
                fx["hblur"] = min(x, 1.2) ** 2
        fwd = unit(tgt - C)
        right = unit(np.cross(fwd, self.U))
        down = np.cross(fwd, right)
        R = np.stack([right, down, fwd], 1)
        if roll:
            R = rodrigues(fwd, roll) @ R
        if yaw and whip:
            R = rodrigues(-self.U, yaw) @ R
        return C, R, fx

    def zoom(self, tau):
        if self.zoom_curve is None:
            return 1.0
        return float(np.interp(tau, *self.zoom_curve))

    # ---------------------------------------------------------------- render
    def _splat(self, C, R, ft, cxo, cyo, Wo, Ho):
        """Z-buffer of the scene in the target view. Gaps left by magnification
        are filled from a min/max depth pyramid: a coarse cell with one depth
        layer gives that surface, a cell spanning a depth edge gives the far
        layer (a disocclusion). Returns target-camera depth."""
        Pc = (self.P - C.astype(np.float32)) @ R.astype(np.float32)
        z = Pc[:, 2]
        ok = z > 0.3
        Pc, z = Pc[ok], z[ok]
        xi = np.rint(ft * Pc[:, 0] / z + cxo).astype(np.int32)
        yi = np.rint(ft * Pc[:, 1] / z + cyo).astype(np.int32)
        inb = (xi >= 0) & (xi < Wo) & (yi >= 0) & (yi < Ho)
        xi, yi, z = xi[inb], yi[inb], z[inb]
        zt = np.full(Wo * Ho, np.inf, np.float32)
        np.minimum.at(zt, yi * Wo + xi, z)
        zt = zt.reshape(Ho, Wo)
        kind = np.zeros((Ho, Wo), np.uint8)
        yy, xx = np.nonzero(~np.isfinite(zt))
        for lv in (1, 2, 3, 4, 5):
            if yy.size == 0:
                break
            Wl, Hl = (Wo + (1 << lv) - 1) >> lv, (Ho + (1 << lv) - 1) >> lv
            fl = (yi >> lv) * Wl + (xi >> lv)
            zmin = np.full(Wl * Hl, np.inf, np.float32)
            zmax = np.zeros(Wl * Hl, np.float32)
            np.minimum.at(zmin, fl, z)
            np.maximum.at(zmax, fl, z)
            cl = (yy >> lv) * Wl + (xx >> lv)
            a, b = zmin[cl], zmax[cl]
            good = np.isfinite(a)
            smooth = b < a * 1.2
            zt[yy[good], xx[good]] = np.where(smooth, a, b)[good]
            kind[yy[good], xx[good]] = np.where(smooth, 1, 2)[good]
            yy, xx = yy[~good], xx[~good]
        if yy.size:
            zt[yy, xx] = self.cfg["z_max"]
            kind[yy, xx] = 3
        return zt, kind

    def _sample_z(self, u, v):
        n = u.size
        cols = 1024
        rows = (n + cols - 1) // cols
        pad = rows * cols - n
        mu = np.pad(u, (0, pad)).reshape(rows, cols).astype(np.float32)
        mv = np.pad(v, (0, pad)).reshape(rows, cols).astype(np.float32)
        return cv2.remap(self.z, mu, mv, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE).ravel()[:n]

    def maps(self, C, R, zoom, Wo, Ho):
        """Per target pixel: source coords (u, v), 3D point, disocclusion flag.
        Directly projected pixels are exact. Pixels stretched by magnification
        are refined along their ray onto the source depth surface (bounded
        steps). Pixels filled from the far side of a depth edge are hidden in
        the source: they are flagged and later take the background layer."""
        ft = self.f * (Wo / self.W) * zoom
        cxo, cyo = (Wo - 1) / 2, (Ho - 1) / 2
        zt, kind = self._splat(C, R, ft, cxo, cyo, Wo, Ho)
        R32, C32 = R.astype(np.float32), C.astype(np.float32)
        xs = (np.arange(Wo, dtype=np.float32) - cxo) / ft
        ys = (np.arange(Ho, dtype=np.float32) - cyo) / ft
        dw = [R32[i, 0] * xs[None, :] + R32[i, 1] * ys[:, None] + R32[i, 2] for i in range(3)]
        idx = np.flatnonzero(kind == 1)
        if idx.size:
            zf = zt.ravel()
            zs_ = zf[idx]
            d = [dw[i].ravel()[idx] for i in range(3)]
            dz = np.where(np.abs(d[2]) < 1e-3, 1e-3, d[2])
            for _ in range(2):
                P = [C32[i] + zs_ * d[i] for i in range(3)]
                pz = np.maximum(P[2], 1e-3)
                zsrc = self._sample_z(self.f * P[0] / pz + self.cx, self.f * P[1] / pz + self.cy)
                zs_ = np.clip((zsrc - C32[2]) / dz, zs_ * 0.85, zs_ * 1.15).astype(np.float32)
            zf[idx] = zs_
            zt = zf.reshape(Ho, Wo)
        Pw = [C32[i] + zt * dw[i] for i in range(3)]
        pz = np.maximum(Pw[2], 1e-3)
        u = (self.f * Pw[0] / pz + self.cx).astype(np.float32)
        v = (self.f * Pw[1] / pz + self.cy).astype(np.float32)
        return u, v, Pw, kind >= 2

    def motion(self, tau, Wo):
        """90th percentile screen motion (px) of scene points across the shutter."""
        pts = []
        for dt in (-SHUTTER / 2, SHUTTER / 2):
            C, R, fxd = self.camera(tau + dt)
            ft = self.f * (Wo / self.W) * self.zoom(tau + dt) * fxd["zoom"]
            p = (self.samples - C) @ R
            ok = p[:, 2] > 0.3
            pts.append(np.where(ok[:, None], ft * p[:, :2] / np.maximum(p[:, 2:3], 0.3), np.nan))
        d = np.linalg.norm(pts[1] - pts[0], axis=1)
        d = d[np.isfinite(d)]
        return float(np.percentile(d, 90)) if d.size else 0.0


# -------------------------------------------------------------------- timeline
def tau_range(name):
    """Local time span in which a shot is actually rendered."""
    c = SHOTS[name]
    if "dur" in c:
        return -CUT_HALF, c["dur"] + CUT_HALF
    lo = -(c["intro"]["dur"] / 2 if c.get("intro", {}).get("kind") == "dissolve" else CUT_HALF) if c.get("intro") else 0.0
    hi = SHOT_T + ((c["outro"]["dur"] / 2 if c["outro"]["kind"] == "dissolve" else CUT_HALF) if c.get("outro") else 0.0)
    return lo, hi


def segments(t):
    """(shot, tau, weight) list for time t."""
    out = []
    for i, name in enumerate(ORDER):
        a, b = CUTS[i], CUTS[i + 1]
        lo, hi = a, b
        w = 1.0
        if i > 0:
            prev = SHOTS[ORDER[i - 1]]["outro"]
            h = prev["dur"] / 2 if prev["kind"] == "dissolve" else CUT_HALF
            lo = a - h
            if t < a + h:
                w *= smootherstep((t - (a - h)) / (2 * h))
        if i < len(ORDER) - 1:
            o = SHOTS[name]["outro"]
            h = o["dur"] / 2 if o["kind"] == "dissolve" else CUT_HALF
            hi = b + h
            if t > b - h:
                w *= 1 - smootherstep((t - (b - h)) / (2 * h))
        if lo <= t < hi and w > 1e-4:
            out.append((name, t - a, w))
    for name, a, b in INSERTS:  # hard cuts on the beat
        if a - 1e-6 <= t < b - 1e-6:
            out = [(name, t - a, 1.0)]
    return out


def radial_blur(img, amt, n=10):
    if amt < 0.004:
        return img
    H, W = img.shape[:2]
    acc = np.zeros_like(img)
    for k in range(n):
        s = 1 + amt * k / (n - 1)
        M = cv2.getRotationMatrix2D(((W - 1) / 2, (H - 1) / 2), 0, s)
        acc += cv2.warpAffine(img, M, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT_101)
    return acc / n


def hblur(img, amt):
    L = int(amt * img.shape[1] * 0.14)
    if L < 3:
        return img
    return cv2.blur(img, (L, 1), borderType=cv2.BORDER_REFLECT_101)


class Post:
    """Finishing applied to every composited frame (1920x1080 float RGB)."""

    def __init__(self, Wo=1920, Ho=1080):
        self.Wo, self.Ho = Wo, Ho
        yy, xx = np.mgrid[0:Ho, 0:Wo].astype(np.float32)
        d = np.sqrt(((xx - Wo / 2) / (Wo / 2)) ** 2 + ((yy - Ho / 2) / (Ho / 2)) ** 2)
        self.vig = (1 - 0.25 * np.clip(d - 0.55, 0, 1) ** 1.6)[..., None].astype(np.float32)
        self.caps = [(c[0], c[1], titles.text_layer(Wo, Ho, c[2], c[3], big=(i == 0)), c[4] if len(c) > 4 else 0.6)
                     for i, c in enumerate(CAPTIONS)]
        self.endl = titles.end_layer(Wo, Ho)
        self.rng = np.random.default_rng(5)

    def layer(self, img, shot, radial, hb):
        img = radial_blur(img, 0.12 * radial)
        img = hblur(img, hb)
        return grade(img, SHOTS[shot]["grade"])

    def finish(self, out, t):
        for c in (CUTS[1], CUTS[3]):
            out = out * (1 + 0.16 * math.exp(-(((t - c) / 0.045) ** 2)))
        small = cv2.resize(out, (self.Wo // 4, self.Ho // 4), interpolation=cv2.INTER_AREA)
        br = np.clip((small - 0.72) / 0.28, 0, 1) ** 2 * small
        bl = 0.6 * cv2.GaussianBlur(br, (0, 0), 3) + 0.4 * cv2.GaussianBlur(br, (0, 0), 12)
        out = out + 0.3 * cv2.resize(bl, (self.Wo, self.Ho), interpolation=cv2.INTER_LINEAR)
        out = out + 0.3 * (out - cv2.GaussianBlur(out, (0, 0), 1.1))
        out = out * self.vig
        for a, b, layer, fade in self.caps:
            out = titles.over(out, layer, titles.fade_in_out(t, a, b, fade))
        out = titles.over(out, self.endl, titles.fade_in_out(t, END_CARD[0], END_CARD[1] + 5, 0.9))
        out = out * max(0.0, min(1.0, t / 0.5, (DUR - t) / 0.8))
        dither = (self.rng.random(out.shape[:2], np.float32) - self.rng.random(out.shape[:2], np.float32))[..., None]
        return np.clip(out * 255 + dither * 0.6 + 0.5, 0, 255).astype(np.uint8)


# -------------------------------------------------------------------- commands
def cmd_zoom():
    out = ROOT / "build" / "zoom"
    out.mkdir(parents=True, exist_ok=True)
    Wo, Ho = 384, 216
    for name in ORDER + [n for n, _, _ in INSERTS]:
        sc = Scene(name, 0.2)
        sc.zoom_curve = None
        lo, hi = tau_range(name)
        taus = np.arange(lo - 2 / FPS, hi + 2 / FPS + 1e-6, 1 / FPS)
        req = []
        for tau in taus:
            C, R, fxz = sc.camera(tau, whip=False)
            lo, hi = 1.0, 1.8
            for it in range(12):
                z = lo if it == 0 else (lo + hi) / 2
                u, v, _, _ = sc.maps(C, R, z * fxz["zoom"], Wo, Ho)
                m = 1.0
                bad = (u < m) | (u > sc.W - 1 - m) | (v < m) | (v > sc.H - 1 - m)
                ok = bad.mean() < 0.0003
                if it == 0:
                    if ok:
                        hi = 1.0
                        break
                    continue
                if ok:
                    hi = z
                else:
                    lo = z
            req.append(hi)
        req = np.array(req)
        n = int(0.35 * FPS)
        mx = np.array([req[max(0, j - n) : j + n + 1].max() for j in range(len(req))])
        g = cv2.getGaussianKernel(int(FPS * 1.2) | 1, 0.22 * FPS).ravel()
        sm = np.convolve(np.pad(mx, len(g) // 2, mode="edge"), g, mode="valid")
        sm = np.maximum(sm, req) * 1.01
        np.savez(out / f"{name}.npz", tau=taus, zoom=sm, req=req)
        print(name, "zoom max %.3f mean %.3f" % (sm.max(), sm.mean()), flush=True)


if __name__ == "__main__":
    if sys.argv[1] == "zoom":
        cmd_zoom()
