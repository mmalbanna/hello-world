"""Builds the layered scene for every shot: metric depth, background plate.

1. Disparity -> metric depth (per-shot far offset and scale), depth edges
   snapped so no pixel floats between foreground and background.
2. The shot's camera path is simulated; every target pixel the camera
   uncovers is traced back to the source, giving the exact area whose
   hidden background must be invented (the reveal mask).
3. LaMa fills that area. The occluding object is masked a little beyond the
   reveal so the fill continues the real background, not the object.
Also writes a water mask (pool shimmer) and sky mask/plate (cloud drift).
Output: build/scene/<shot>.npz
"""
import os
import sys
from pathlib import Path

import cv2
import numpy as np
import torch

from flythrough import pushpull
from shots import SHOTS

ROOT = Path(__file__).resolve().parent.parent
torch.set_num_threads(4)


def approx_baseline(cfg):
    """Camera travel over the shot (m), from the rig keyframes."""
    p0, p1 = np.asarray(cfg["pos0"], float), np.asarray(cfg["pos1"], float)
    extra = sum(t.get("dist", 0.0) for t in (cfg.get("intro") or {}, cfg.get("outro") or {}))
    return float(np.linalg.norm(p1 - p0) + extra)


def clamp_relief(z, cfg):
    """Cap how far objects stand proud of the ground (aerial shot).

    The depth model exaggerates small buildings seen from far away. A smooth
    ground surface is fitted to the meadow in inverse depth (planar ground is
    affine in inverse depth; a quadratic term follows the ridge), excluding
    the objects as outliers, and nothing may come nearer than
    cfg['relief'] (fraction) above it."""
    rel = cfg.get("relief")
    if not rel:
        return z
    H, W = z.shape
    w = 1.0 / z.astype(np.float64)
    meadow = z < cfg["relief_zmax"]
    vv, uu = np.mgrid[0:H, 0:W].astype(np.float64)
    uu /= W
    vv /= H
    A = np.stack([uu, vv, uu * uu, vv * vv, uu * vv, np.ones_like(uu)], -1)
    sel = meadow.copy()
    for _ in range(4):
        coef = np.linalg.lstsq(A[sel][::7], w[sel][::7], rcond=None)[0]
        ground = A @ coef
        r = w - ground
        sel = meadow & (r < 1.5 * np.std(r[sel]))
    w = np.where(meadow, np.minimum(w, ground * (1 + rel)), w)
    return (1.0 / w).astype(np.float32)


def flatten_water(z, water, box=None):
    """Put pool water on the terrace plane around it.

    The model reads a pool as a deep hole (about 35% farther than its
    coping); physically the water is a few centimetres below the paving. A
    plane is fitted in inverse depth to the paving ring around the pool
    (robustly, so walls and furniture drop out) and the water takes that
    plane, 1% farther. Inside the pool box nothing may lie deeper than that
    plane either (shadowed water and reflections the colour mask misses)."""
    if water is None:
        return z
    m = (water > 0.2).astype(np.uint8)
    pool = cv2.dilate(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (25, 25))) > 0
    ring = (cv2.dilate(m, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (161, 161))) > 0) & ~pool
    H, W = z.shape
    vv, uu = np.mgrid[0:H, 0:W].astype(np.float64)
    A = np.stack([uu / W, vv / H, np.ones_like(uu)], -1)
    w = 1.0 / z.astype(np.float64)
    sel = ring.copy()
    for _ in range(5):
        coef = np.linalg.lstsq(A[sel][::5], w[sel][::5], rcond=None)[0]
        r = np.abs(w - A @ coef)
        sel = ring & (r < 2.0 * np.median(r[sel]) + 1e-6)
    plane = np.maximum(A @ coef, 1e-4)
    zp = np.maximum(1.01 / plane, 0.3).astype(np.float32)
    soft = cv2.GaussianBlur(pool.astype(np.float32), (0, 0), 3.0)
    z = np.exp(np.log(z) * (1 - soft) + np.log(zp) * soft).astype(np.float32)
    x0, y0, x1, y1 = box
    region = np.zeros_like(z)
    region[y0:y1, x0:x1] = 1
    region = cv2.GaussianBlur(region, (0, 0), 6.0)
    deeper = np.clip((np.log(z) - np.log(zp)) / 0.02, 0, 1) * region
    return np.exp(np.log(z) * (1 - deeper) + np.log(zp) * deeper).astype(np.float32)


def metric_depth(disp, cfg, rgb, water=None):
    """Metric depth, simplified the way a compositor would for 2.5D work.

    Small depth steps (paving joints, coping lips, roofs a few metres above
    the ground in the aerial) make no useful parallax but tear when meshed,
    so an edge-preserving bilateral filter on log depth flattens anything
    below ~cfg['flatten'] while keeping real occlusions (house against lane,
    wall against mountains). Those remaining edges are then snapped to a
    clean one-pixel step."""
    d = disp - cfg["d_shift"]
    d_ref = np.median(disp[-30:, disp.shape[1] // 3 : 2 * disp.shape[1] // 3]) - cfg["d_shift"]
    z = cfg["z_bottom"] * d_ref / np.maximum(d, 1e-4)
    z = clamp_relief(np.minimum(z, cfg["z_max"]).astype(np.float32), cfg)
    z = flatten_water(z, water, cfg.get("water"))
    L = np.log(z).astype(np.float32)
    sig = cfg.get("flatten", 0.06)
    for _ in range(2):
        L = cv2.bilateralFilter(L, 0, sig, 6)
    z = np.exp(L).astype(np.float32)
    k = np.ones((5, 5), np.uint8)
    zmin, zmax = cv2.erode(z, k), cv2.dilate(z, k)
    big = zmax / zmin > 1.15
    mid = np.sqrt(zmin * zmax)
    return np.where(big, np.where(z < mid, zmin, zmax), z).astype(np.float32)


def lama_fill(model, rgb, mask, max_side=2000):
    H, W = mask.shape
    s = min(1.0, max_side / max(H, W))
    h8, w8 = int(np.ceil(H * s / 8)) * 8, int(np.ceil(W * s / 8)) * 8
    img = cv2.resize(rgb, (w8, h8), interpolation=cv2.INTER_AREA)
    m = cv2.resize(mask.astype(np.float32), (w8, h8), interpolation=cv2.INTER_LINEAR) > 0.01
    ti = torch.from_numpy(np.ascontiguousarray(img.transpose(2, 0, 1)))[None].float()
    tm = torch.from_numpy(m.astype(np.float32))[None, None]
    with torch.inference_mode():
        out = model(ti, tm)[0].permute(1, 2, 0).numpy()
    out = out / 255.0 if out.max() > 1.5 else out
    out = cv2.resize(np.clip(out, 0, 1).astype(np.float32), (W, H), interpolation=cv2.INTER_CUBIC)
    soft = cv2.GaussianBlur(mask.astype(np.float32), (0, 0), 1.5)[..., None]
    return (rgb * (1 - soft) + out * soft).astype(np.float32)


def water_mask(rgb, cfg):
    """Pool water: blue hues (dark water included) inside the shot's pool box,
    gaps from reflections closed, holes smaller than a lounger filled; large
    non-water objects standing in the pool stay out."""
    if not cfg.get("water"):
        return None
    hsv = cv2.cvtColor((rgb * 255).astype(np.uint8), cv2.COLOR_RGB2HSV).astype(np.float32)
    hue, sat, val = hsv[..., 0], hsv[..., 1] / 255, hsv[..., 2] / 255
    m = ((hue > 80) & (hue < 130) & (sat > cfg.get("water_sat", 0.2)) & (val > cfg.get("water_val", 0.08))).astype(np.uint8)
    x0, y0, x1, y1 = cfg["water"]
    box = np.zeros_like(m)
    box[y0:y1, x0:x1] = 1
    m = cv2.morphologyEx(m * box, cv2.MORPH_CLOSE, cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (15, 15)))
    m = cv2.morphologyEx(m, cv2.MORPH_OPEN, np.ones((5, 5), np.uint8))
    n, lab, stats, _ = cv2.connectedComponentsWithStats(m)
    keep = np.zeros_like(m)
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] > 4000:
            keep[lab == i] = 1
    n, lab, stats, _ = cv2.connectedComponentsWithStats(1 - keep)
    for i in range(1, n):
        if stats[i, cv2.CC_STAT_AREA] < cfg.get("water_fill", 30000):
            keep[lab == i] = 1
    keep = cv2.erode(keep, np.ones((5, 5), np.uint8))
    return cv2.GaussianBlur(keep.astype(np.float32), (0, 0), 3.0)


def reveal_mask(name, H, W):
    """Source pixels whose hidden background becomes visible along the path."""
    from flythrough import Scene, tau_range

    sc = Scene(name, 0.25)
    sc.zoom_curve = None
    Wo, Ho = 480, 270
    acc = np.zeros((sc.H, sc.W), np.float32)
    lo, hi = tau_range(name)
    for tau in np.append(np.arange(lo, hi, 0.1), hi):
        C, R, _ = sc.camera(tau, whip=False)
        u, v, Pw, holes = sc.maps(C, R, 1.0, Wo, Ho)
        zsrc = cv2.remap(sc.z, u, v, cv2.INTER_NEAREST, borderMode=cv2.BORDER_REPLICATE)
        dis = holes | (Pw[2] > zsrc * (1 + SHOTS[name]["edge_ratio"]))
        inb = (u >= 0) & (u <= sc.W - 1) & (v >= 0) & (v <= sc.H - 1)
        sel = dis & inb
        np.add.at(acc, (np.rint(v[sel]).astype(int), np.rint(u[sel]).astype(int)), 1.0)
    m = (acc > 0).astype(np.uint8)
    m = cv2.morphologyEx(m, cv2.MORPH_CLOSE, np.ones((5, 5), np.uint8))
    m = cv2.resize(m, (W, H), interpolation=cv2.INTER_NEAREST)
    return cv2.dilate(m, np.ones((9, 9), np.uint8))


def fill_mask(reveal, z, ext_px):
    """Reveal area plus the occluding object around it (same depth band)."""
    zr = np.where(reveal > 0, z, np.inf).astype(np.float32)
    k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * ext_px + 1, 2 * ext_px + 1))
    zfg = cv2.erode(zr, k)
    near = cv2.dilate(reveal, k) > 0
    with np.errstate(invalid="ignore"):
        ext = near & (z <= zfg * 1.25)
    return ((reveal > 0) | ext).astype(np.uint8)


def mirror_fill(img, fill, source):
    """Fill by reflecting the background across the nearest occluder edge.

    Every pixel to fill takes the colour found by mirroring its position
    through its nearest allowed source pixel (background side of the edge);
    where that lands outside the source, the nearest source colour is used."""
    src = (source > 0).astype(np.uint8)
    _, labels = cv2.distanceTransformWithLabels(1 - src, cv2.DIST_L2, 5, labelType=cv2.DIST_LABEL_PIXEL)
    ys, xs = np.nonzero(src)
    lut_x = np.zeros(labels.max() + 1, np.float32)
    lut_y = np.zeros(labels.max() + 1, np.float32)
    lut_x[labels[ys, xs]] = xs
    lut_y[labels[ys, xs]] = ys
    nx, ny = lut_x[labels], lut_y[labels]
    H, W = fill.shape
    yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
    mx, my = np.clip(2 * nx - xx, 0, W - 1), np.clip(2 * ny - yy, 0, H - 1)
    ok = src[my.astype(int), mx.astype(int)] > 0
    mirrored = cv2.remap(img, mx, my, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REFLECT)
    nearest = img[ny.astype(int), nx.astype(int)]
    filled = np.where(ok[..., None], mirrored, nearest)
    soft = cv2.GaussianBlur(fill.astype(np.float32), (0, 0), 1.5)[..., None]
    return (img * (1 - soft) + filled * soft).astype(np.float32)


def main(names):
    model = torch.jit.load(os.path.join(os.environ.get("MODELS", "/home/user/models"), "big-lama.pt"), map_location="cpu").eval()
    out = ROOT / "build" / "scene"
    out.mkdir(parents=True, exist_ok=True)
    for name in names:
        cfg = SHOTS[name]
        bgr = cv2.imread(str(ROOT / "source" / f"{cfg['image']}.webp"))
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
        disp = np.load(ROOT / "build" / "depth" / f"{cfg['image']}_disp.npy")
        wm = water_mask(rgb, cfg)
        z = metric_depth(disp, cfg, rgb, wm)
        H, W = z.shape
        sky = skyplate = None
        if cfg.get("clouds"):
            s = cv2.erode((z >= cfg["z_max"] * 0.98).astype(np.uint8), np.ones((9, 9), np.uint8))
            sky = cv2.GaussianBlur(s.astype(np.float32), (0, 0), 2.0)
            skyplate = lama_fill(model, rgb, cv2.dilate(1 - s, np.ones((15, 15), np.uint8)))
        save = lambda bg: np.savez(
            out / f"{name}.npz", rgb=rgb, z=z, bg=bg, zb=z,
            water=wm if wm is not None else np.zeros(0, np.float32),
            sky=sky if sky is not None else np.zeros(0, np.float32),
            skyplate=skyplate if skyplate is not None else np.zeros(0, np.float32),
        )
        save(rgb)
        rev = reveal_mask(name, H, W)
        fm = fill_mask(rev, z, cfg.get("ext_px", 60))
        outside = 1 - cv2.dilate(fm, np.ones((5, 5), np.uint8)).astype(np.float32)
        k = cv2.getStructuringElement(cv2.MORPH_ELLIPSE, (2 * cfg.get("ext_px", 60) + 41,) * 2)
        zocc = cv2.erode(np.where(fm > 0, z, np.float32(1e9)).astype(np.float32), k)
        far_side = outside * (z > 1.15 * zocc)
        if cfg.get("bg_fill") == "mirror":
            bg = mirror_fill(rgb, fm, far_side if far_side.sum() > 100 else outside)
        else:
            bg = lama_fill(model, rgb, fm)
        zb = np.exp(pushpull(np.log(z), np.where(far_side.sum() > 100, far_side, outside))).astype(np.float32)
        zb = np.where(outside > 0.5, z, np.maximum(zb, z * 1.02)).astype(np.float32)
        save(bg)
        d = dict(np.load(out / f"{name}.npz"))
        d["zb"], d["fm"] = zb, fm
        np.savez(out / f"{name}.npz", **d)
        vis = np.hstack([rgb, bg, np.dstack([fm, rev, rev]).astype(np.float32)])
        cv2.imwrite(str(out / f"{name}_layers.jpg"),
                    cv2.cvtColor((cv2.resize(vis, None, fx=0.4, fy=0.4) * 255).astype(np.uint8), cv2.COLOR_RGB2BGR))
        print(name, "reveal %.1f%% fill %.1f%%" % (rev.mean() * 100, fm.mean() * 100), flush=True)


if __name__ == "__main__":
    main(sys.argv[1:] or list(SHOTS))
