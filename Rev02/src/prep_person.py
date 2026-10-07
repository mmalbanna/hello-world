"""Prepares Mr. Bernard's portrait for the facial rig.

Cut-out: ISNet salient-object segmentation, refined with a guided filter
and fringe-cleaned by taking edge colours from the nearest solid pixels.
Landmarks: MediaPipe Face Landmarker (478 points with depth).
Models in $MODELS: isnet-general-use.onnx, face_landmarker.task.

  prep_person.py source/bernard.jpg build/bernard
"""
import os
import sys
from pathlib import Path

import cv2
import numpy as np
import onnxruntime as ort

MODELS = Path(os.environ.get("MODELS", "/home/user/models"))


def cutout(img):
    s = ort.InferenceSession(str(MODELS / "isnet-general-use.onnx"), providers=["CPUExecutionProvider"])
    H, W = img.shape[:2]
    x = cv2.resize(img, (1024, 1024), interpolation=cv2.INTER_AREA).astype(np.float32) / 255.0
    x = ((x - 0.5) / 1.0).transpose(2, 0, 1)[None].astype(np.float32)
    m = np.squeeze(s.run(None, {s.get_inputs()[0].name: x})[0])
    if m.ndim == 3:
        m = m[0]
    m = (m - m.min()) / (m.max() - m.min() + 1e-9)
    m = cv2.resize(m.astype(np.float32), (W, H), interpolation=cv2.INTER_LINEAR)
    a = np.clip((m - 0.25) / 0.5, 0, 1).astype(np.float32)
    a = np.clip(cv2.ximgproc.guidedFilter(img, a, 3, 1e-3), 0, 1)
    solid = (a > 0.97).astype(np.uint8)
    fill = cv2.inpaint(img, 1 - solid, 3, cv2.INPAINT_TELEA)
    rgb = np.where(solid[..., None] > 0, img, fill).astype(np.float32) / 255.0
    return rgb, a


def landmarks(img):
    import mediapipe as mp
    from mediapipe.tasks.python import BaseOptions, vision

    opts = vision.FaceLandmarkerOptions(base_options=BaseOptions(model_asset_path=str(MODELS / "face_landmarker.task")), num_faces=1)
    lm = vision.FaceLandmarker.create_from_options(opts)
    res = lm.detect(mp.Image(image_format=mp.ImageFormat.SRGB, data=img))
    H, W = img.shape[:2]
    return np.array([[p.x * W, p.y * H, p.z * W] for p in res.face_landmarks[0]], np.float32)


def main(src, out):
    out = Path(out)
    out.mkdir(parents=True, exist_ok=True)
    img = cv2.cvtColor(cv2.imread(src), cv2.COLOR_BGR2RGB)
    rgb, a = cutout(img)
    np.savez(out / "card.npz", rgb=rgb, alpha=a)
    np.save(out / "landmarks.npy", landmarks(img))
    print("prepared", out)


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
