"""GPU render path for the flythrough.

Each shot is exported as two triangle meshes built from the depth map: the
foreground (cut wherever depth jumps, so objects separate cleanly) and a
background layer that carries the inpainted plate behind them. Headless
Chromium rasterises them with WebGL2 (src/gl). Every output frame is the
average of jittered sub-frames spread over a 180-degree shutter, which gives
anti-aliasing and true motion blur. Python then fills any uncovered pixel,
applies transition blurs, grade, bloom, titles, and encodes.

  glrender.py export                   meshes and textures -> build/gl
  glrender.py stills OUTDIR T...        frames at the given seconds -> PNG
  glrender.py render OUT.mp4 [PARTS]    the full film (PARTS parallel renderers)
  glrender.py part A B OUT.mp4          frames A..B-1 (used by render)
"""
import json
import math
import shutil
import subprocess
import sys
from pathlib import Path

import cv2
import numpy as np

from flythrough import FPS, NFRAMES, SHUTTER, Post, Scene, pushpull, segments, tau_range
import birds
import person
from shots import BIRDS, INSERTS, ORDER, SHOTS

ROOT = Path(__file__).resolve().parent.parent
GL = ROOT / "build" / "gl"
W_OUT, H_OUT = 1920, 1080
STEP = 2
STEP_BG = 2
NEAR, FAR = 0.2, 20000.0


def halton(i, b):
    f, r = 1.0, 0.0
    while i > 0:
        f /= b
        r += f * (i % b)
        i //= b
    return r


JITTER = [(halton(i, 2) - 0.5, halton(i, 3) - 0.5) for i in range(1, 33)]


def axis(n, step):
    a = np.arange(0, n, step)
    return a if a[-1] == n - 1 else np.append(a, n - 1)


def baseline(name):
    """Largest distance between two camera positions within the shot (m)."""
    sc = Scene(name, 0.1)
    lo, hi = tau_range(name)
    P = np.array([sc.camera(t, whip=False)[0] for t in np.linspace(lo, hi, 40)])
    return float(np.max(np.linalg.norm(P[:, None] - P[None], axis=-1)))


def build_mesh(z, cx, cy, f, step, B):
    """Grid mesh over the depth map. Quads spanning a depth jump (log-depth
    range far above the local norm, and enough parallax for this shot's
    camera travel to stretch them visibly) go to a separate 'edge' list that
    the renderer fades out as it stretches."""
    H, W = z.shape
    us, vs = axis(W, step), axis(H, step)
    U, V = np.meshgrid(us, vs)
    ny, nx = U.shape
    Z = z[V, U].astype(np.float64)
    pos = np.stack([(U - cx) / f * Z, (V - cy) / f * Z, Z], -1).reshape(-1, 3).astype(np.float32)
    uv = np.stack([(U + 0.5) / W, (V + 0.5) / H], -1).reshape(-1, 2).astype(np.float32)
    L = np.log(Z)
    corners = np.stack([L[:-1, :-1], L[:-1, 1:], L[1:, :-1], L[1:, 1:]])
    rng = (corners.max(0) - corners.min(0)).astype(np.float32)
    local = cv2.blur(rng, (9, 9))
    zc = np.exp(np.stack([corners.min(0), corners.max(0)]))
    parallax = f * B * (1 / zc[0] - 1 / zc[1])
    edge = ((rng > 2.5 * local + 0.003) & (parallax > 2.0)).ravel()
    j, i = np.mgrid[0 : ny - 1, 0 : nx - 1]
    a = (j * nx + i).ravel()
    t1 = np.stack([a, a + 1, a + nx], 1)
    t2 = np.stack([a + 1, a + nx + 1, a + nx], 1)
    solid = np.concatenate([t1[~edge], t2[~edge]]).astype(np.uint32)
    edges = np.concatenate([t1[edge], t2[edge]]).astype(np.uint32)
    return pos, uv, solid, edges


def export_shot(name):
    d = np.load(ROOT / "build" / "scene" / f"{name}.npz")
    rgb, z, bg, zb = d["rgb"], d["z"], d["bg"], d["zb"]
    sc = Scene(name, 0.1)
    H, W = z.shape
    f = (W / 2) / math.tan(math.radians(SHOTS[name]["hfov"]) / 2)
    cx, cy = (W - 1) / 2, (H - 1) / 2
    B = baseline(name)
    out = GL / name
    out.mkdir(parents=True, exist_ok=True)
    counts = {}
    for layer, zz, step in (("fg", z, STEP), ("bg", zb, STEP_BG)):
        pos, uv, solid, edges = build_mesh(zz, cx, cy, f, step, B)
        pos.tofile(out / f"{layer}_pos.bin")
        uv.tofile(out / f"{layer}_uv.bin")
        solid.tofile(out / f"{layer}_solid.bin")
        edges.tofile(out / f"{layer}_edge.bin")
        counts[layer] = (len(solid), len(edges))
    rgba = lambda x: np.dstack([np.clip(x * 255 + 0.5, 0, 255).astype(np.uint8), np.full(x.shape[:2], 255, np.uint8)])
    rgba(rgb).tofile(out / "rgb.raw")
    rgba(bg).tofile(out / "bg.raw")
    has_water, has_sky = d["water"].size > 0, d["sky"].size > 0
    if has_water:
        np.clip(d["water"] * 255 + 0.5, 0, 255).astype(np.uint8).tofile(out / "water.raw")
    if has_sky:
        np.clip(d["sky"] * 255 + 0.5, 0, 255).astype(np.uint8).tofile(out / "sky.raw")
        rgba(d["skyplate"]).tofile(out / "skyplate.raw")
    has_sway = "sway" in d and d["sway"].max() > 0.01
    has_gust = "gust" in d and d["gust"].max() > 0.01
    if has_sway:
        np.clip(d["sway"] * 255 + 0.5, 0, 255).astype(np.uint8).tofile(out / "sway.raw")
    if has_gust:
        np.clip(d["gust"] * 255 + 0.5, 0, 255).astype(np.uint8).tofile(out / "gust.raw")
    cfg = SHOTS[name]
    rip, gust = cfg.get("ripple", {}), cfg.get("gust", {})
    meta = dict(W=W, H=H, f=f, water=bool(has_water), sky=bool(has_sky),
                cloud_uv_per_s=cfg.get("cloud_speed", 0.0) * (W / 2000) / W,
                sway=bool(has_sway), gust=bool(has_gust),
                gust_k=gust.get("k", 0.0), gust_w=gust.get("w", 0.0), gust_amount=gust.get("amount", 0.0),
                water_amp=rip.get("amp", 0.0028), caustic=rip.get("caustic", 0.0), glint=rip.get("glint", 0.0))
    (out / "meta.json").write_text(json.dumps(meta))
    print(name, "baseline %.2f m" % B, "fg solid/edge", counts["fg"], "bg solid/edge", counts["bg"], flush=True)


def vp(C, R, ft, jx, jy):
    V = np.eye(4)
    V[:3, :3] = R.T
    V[:3, 3] = -R.T @ C
    P = np.zeros((4, 4))
    P[0, 0], P[0, 2] = 2 * ft / W_OUT, 2 * jx / W_OUT
    P[1, 1], P[1, 2] = -2 * ft / H_OUT, -2 * jy / H_OUT
    P[2, 2], P[2, 3] = (FAR + NEAR) / (FAR - NEAR), -2 * FAR * NEAR / (FAR - NEAR)
    P[3, 2] = 1.0
    return [float(x) for x in (P @ V).T.ravel()]


def frame_job(fi, scenes):
    t = fi / FPS
    layers = []
    for name, tau, w in segments(t):
        sc = scenes[name]
        _, _, fx = sc.camera(tau)
        k = int(min(max(math.ceil(sc.motion(tau, W_OUT) / 1.0), 4), 12))
        if fx["radial"] > 0.05 or fx["hblur"] > 0.05:
            k = 4
        subs = []
        for j in range(k):
            tj = tau + ((j + 0.5) / k - 0.5) * SHUTTER
            C, R, fj = sc.camera(tj)
            ft = sc.f * (W_OUT / sc.W) * sc.zoom(tj) * fj["zoom"]
            jx, jy = JITTER[j]
            subs.append({"vp": vp(C, R, ft, jx, jy), "tau": tj})
        layers.append({"shot": name, "w": w, "radial": fx["radial"], "hblur": fx["hblur"], "subs": subs})
    return {"fi": fi, "layers": layers}


def fill_holes(rgb, a):
    col = rgb / np.maximum(a, 1e-3)[..., None]
    if a.min() > 0.998:
        return col
    filled = pushpull(col, a)
    return col * a[..., None] + filled * (1 - a[..., None])


def run(frames, consume, tag):
    names = ORDER + [n for n, _, _ in INSERTS]
    scenes = {n: Scene(n) for n in names if any(n == L for fi in frames for L, _, _ in segments(fi / FPS))}
    jobs = {"frames": [frame_job(fi, scenes) for fi in frames]}
    jf = GL / f"jobs_{tag}.json"
    jf.write_text(json.dumps(jobs))
    proc = subprocess.Popen(["node", str(ROOT / "src" / "gl" / "render.mjs"), str(GL), jf.name], stdout=subprocess.PIPE)
    post = Post(W_OUT, H_OUT)
    n = W_OUT * H_OUT * 4
    for job in jobs["frames"]:
        out = None
        for L in job["layers"]:
            buf = proc.stdout.read(n)
            if len(buf) != n:
                raise SystemExit(f"renderer stopped at frame {job['fi']}")
            img = np.frombuffer(buf, np.uint8).reshape(H_OUT, W_OUT, 4)[::-1].astype(np.float32) / 255.0
            rgb = fill_holes(img[..., :3], img[..., 3])
            sc = scenes[L["shot"]]
            tc = float(np.mean([sb["tau"] for sb in L["subs"]]))
            taus = tc + ((np.arange(16) + 0.5) / 16 - 0.5) * SHUTTER

            def cam_fn(t, sc=sc):
                C, R, fj = sc.camera(t)
                return C, R, sc.f * (W_OUT / sc.W) * sc.zoom(t) * fj["zoom"]

            rgb = birds.draw(rgb, sc, taus, cam_fn, BIRDS.get(L["shot"]))
            if SHOTS[L["shot"]].get("person"):
                blur = SHOTS[L["shot"]].get("defocus", 0)
                if blur:
                    rgb = cv2.GaussianBlur(rgb, (0, 0), blur) * 0.95
                rgb = person.draw(rgb, sc, taus, cam_fn, SHOTS[L["shot"]]["person"])
            rgb = post.layer(rgb, L["shot"], L["radial"], L["hblur"])
            out = rgb * L["w"] if out is None else out + rgb * L["w"]
        consume(job["fi"], post.finish(out, job["fi"] / FPS))
    if proc.wait() != 0:
        raise SystemExit("renderer failed")


def cmd_export():
    GL.mkdir(parents=True, exist_ok=True)
    shutil.copy(ROOT / "src" / "gl" / "renderer.html", GL / "renderer.html")
    for name in ORDER + [n for n, _, _ in INSERTS]:
        export_shot(name)


def cmd_stills(outdir, times):
    out = Path(outdir)
    out.mkdir(parents=True, exist_ok=True)
    frames = [int(round(float(t) * FPS)) for t in times]
    save = lambda fi, img: cv2.imwrite(str(out / f"f{fi:04d}.png"), cv2.cvtColor(img, cv2.COLOR_RGB2BGR))
    run(frames, save, "stills")


def cmd_anim(shot, tau_cam, outdir, times):
    """Test: camera frozen at tau_cam, animation clock at each time (layer only)."""
    out = Path(outdir)
    out.mkdir(parents=True, exist_ok=True)
    sc = Scene(shot)
    C, R, fx = sc.camera(float(tau_cam), whip=False)
    ft = sc.f * (W_OUT / sc.W) * sc.zoom(float(tau_cam)) * fx["zoom"]
    jobs = {"frames": [{"fi": i, "layers": [{"shot": shot, "w": 1.0, "radial": 0.0, "hblur": 0.0,
             "subs": [{"vp": vp(C, R, ft, *JITTER[j]), "tau": float(t)} for j in range(4)]}]}
             for i, t in enumerate(times)]}
    jf = GL / "jobs_anim.json"
    jf.write_text(json.dumps(jobs))
    proc = subprocess.Popen(["node", str(ROOT / "src" / "gl" / "render.mjs"), str(GL), jf.name], stdout=subprocess.PIPE)
    n = W_OUT * H_OUT * 4
    for i, t in enumerate(times):
        img = np.frombuffer(proc.stdout.read(n), np.uint8).reshape(H_OUT, W_OUT, 4)[::-1]
        cv2.imwrite(str(out / f"{shot}_{i:02d}.png"), cv2.cvtColor(img[..., :3], cv2.COLOR_RGB2BGR))
    proc.wait()


def cmd_part(a, b, path):
    enc = subprocess.Popen(
        ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "rawvideo", "-pix_fmt", "rgb24",
         "-s", f"{W_OUT}x{H_OUT}", "-r", str(FPS), "-i", "-", "-c:v", "libx264", "-preset", "veryfast",
         "-crf", "8", "-pix_fmt", "yuv420p", str(path)],
        stdin=subprocess.PIPE)
    run(list(range(a, b)), lambda fi, img: enc.stdin.write(img.tobytes()), f"{a}_{b}")
    enc.stdin.close()
    if enc.wait() != 0:
        raise SystemExit("encoder failed")


def cmd_render(path, parts=2):
    seg = ROOT / "build" / "segments"
    seg.mkdir(parents=True, exist_ok=True)
    bounds = np.linspace(0, NFRAMES, parts + 1).astype(int)
    procs = [subprocess.Popen([sys.executable, __file__, "part", str(bounds[k]), str(bounds[k + 1]), str(seg / f"seg{k}.mp4")])
             for k in range(parts)]
    if any(p.wait() != 0 for p in procs):
        raise SystemExit("a render part failed")
    lst = seg / "list.txt"
    lst.write_text("".join(f"file '{seg / f'seg{k}.mp4'}'\n" for k in range(parts)))
    subprocess.run(["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-f", "concat", "-safe", "0",
                    "-i", str(lst), "-c", "copy", str(path)], check=True)


if __name__ == "__main__":
    cmd = sys.argv[1]
    if cmd == "export":
        cmd_export()
    elif cmd == "stills":
        cmd_stills(sys.argv[2], sys.argv[3:])
    elif cmd == "anim":
        cmd_anim(sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5:])
    elif cmd == "part":
        cmd_part(int(sys.argv[2]), int(sys.argv[3]), sys.argv[4])
    elif cmd == "render":
        cmd_render(sys.argv[2], int(sys.argv[3]) if len(sys.argv) > 3 else 2)
