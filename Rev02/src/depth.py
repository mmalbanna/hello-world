"""Monocular depth for each render with Depth Anything V2 Large (ONNX, CPU).

Two passes per image: 518 px (globally consistent) and 784 px (fine edges).
The fine pass is aligned to the coarse one and only its high frequencies
are kept. The fused disparity is upsampled to full resolution with a guided
filter so depth edges follow image edges. Output: <out>/<name>_disp.npy,
float32, relative inverse depth (larger = nearer), plus a preview PNG.
"""
import sys
from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort

MEAN = np.array([0.485, 0.456, 0.406], np.float32)
STD = np.array([0.229, 0.224, 0.225], np.float32)


def run(sess, rgb, h, w):
    x = cv2.resize(rgb, (w, h), interpolation=cv2.INTER_CUBIC)
    x = ((x - MEAN) / STD).transpose(2, 0, 1)[None].astype(np.float32)
    out = sess.run(None, {sess.get_inputs()[0].name: x})[0]
    return np.squeeze(out).astype(np.float32)


def guided_filter(guide, src, r, eps):
    mean = lambda a: cv2.boxFilter(a, -1, (2 * r + 1, 2 * r + 1))
    g = cv2.cvtColor(guide, cv2.COLOR_RGB2GRAY)
    mg, ms = mean(g), mean(src)
    a = (mean(g * src) - mg * ms) / (mean(g * g) - mg * mg + eps)
    b = ms - a * mg
    return mean(a) * g + mean(b)


def main(model, out_dir, images):
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)
    so = ort.SessionOptions()
    so.intra_op_num_threads = 4
    sess = ort.InferenceSession(model, so, providers=["CPUExecutionProvider"])
    for path in images:
        bgr = cv2.imread(path, cv2.IMREAD_COLOR)
        rgb = cv2.cvtColor(bgr, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
        H, W = rgb.shape[:2]
        coarse = run(sess, rgb, 518, 910)
        fine = run(sess, rgb, 784, 1372)
        coarse_up = cv2.resize(coarse, (1372, 784), interpolation=cv2.INTER_CUBIC)
        A = np.stack([fine.ravel(), np.ones(fine.size, np.float32)], 1)
        s, t = np.linalg.lstsq(A, coarse_up.ravel(), rcond=None)[0]
        fine_al = fine * s + t
        sig = 6.0
        fused = cv2.GaussianBlur(coarse_up, (0, 0), sig) + (fine_al - cv2.GaussianBlur(fine_al, (0, 0), sig))
        full = cv2.resize(fused, (W, H), interpolation=cv2.INTER_CUBIC)
        lo, hi = np.percentile(full, [0.2, 99.8])
        full = np.clip((full - lo) / (hi - lo), 0, 1).astype(np.float32)
        full = guided_filter(rgb, full, 4, 1e-4).astype(np.float32)
        full = np.clip(full, 0, 1)
        name = Path(path).stem
        np.save(out / f"{name}_disp.npy", full)
        cv2.imwrite(str(out / f"{name}_disp.png"), (full * 255).astype(np.uint8))
        print(name, "done", full.shape, flush=True)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2], sys.argv[3:])
