"""A person standing in a shot, from one cut-out portrait.

The portrait, animated by the facial rig in face_rig.py (nod, turn, blink,
brow flash, smile), stands as a card in the scene (world metres) and is
projected through the shot's camera for every shutter sample like the
birds, so its size, parallax and motion blur match the flythrough. The
card breathes a little and leans very slightly toward the camera.
"""
import math
from pathlib import Path

import cv2
import numpy as np

ROOT = Path(__file__).resolve().parent.parent
_cache = {}


def load_card(cfg):
    """The animated portrait rig plus its placement geometry."""
    key = cfg["card"]
    if key in _cache:
        return _cache[key]
    from face_rig import FaceRig

    rig = FaceRig(str(ROOT / cfg["card"]), str(ROOT / cfg["landmarks"]), mirror=cfg.get("mirror", True))
    # match the renders: a touch warmer, a little more contrast and crispness
    rgb = 0.45 + (rig.rgb - 0.45) * 1.06
    rgb = rgb * np.array([1.015, 1.0, 0.975], np.float32)
    rgb = rgb + 0.25 * (rgb - cv2.GaussianBlur(rgb, (0, 0), 2.0))
    rig.rgb = np.clip(rgb, 0, 1).astype(np.float32)
    rows = np.nonzero(rig.alpha.max(1) > 0.02)[0]
    m_per_px = cfg["height_m"] / rig.H
    card = dict(rig=rig, w=rig.W * m_per_px, h=rig.H * m_per_px, head_top=cfg["top_m"] - rows[0] * m_per_px)
    _cache[key] = card
    return card


def draw(img, sc, taus, cam_fn, cfg):
    card = load_card(cfg)
    H, W = img.shape[:2]
    cxo, cyo = (W - 1) / 2, (H - 1) / 2
    th, tw = card["rig"].H, card["rig"].W
    ground_y = sc.cfg["z_bottom"] * math.tan(math.radians(sc.cfg["hfov"]) / 2) * (sc.H / sc.W)
    top_y = ground_y - card["head_top"]
    acc = np.zeros((H, W, 4), np.float32)
    K = len(taus)
    for tau in taus:
        C, R, ft = cam_fn(tau)
        s = min(max(tau / sc.cfg.get("dur", 1.5), 0.0), 1.0)
        lean = cfg.get("lean", 0.0) * (s * s * (3 - 2 * s))
        breathe = 1 + 0.006 * math.sin(2 * math.pi * 0.27 * tau + 1.0)
        sway = 0.004 * math.sin(2 * math.pi * 0.31 * tau) + 0.002 * math.sin(2 * math.pi * 0.73 * tau + 2.0)
        x0 = cfg["x"] - card["w"] / 2 + sway
        z = cfg["z"] - lean
        bottom = top_y + card["h"]
        hh = card["h"] * breathe
        corners = np.array([[x0, bottom - hh, z], [x0 + card["w"], bottom - hh, z], [x0 + card["w"], bottom, z], [x0, bottom, z]])
        corners = (sc.M @ corners.T).T
        pc = (corners - C) @ R
        if (pc[:, 2] < 0.3).any():
            continue
        xy = np.stack([ft * pc[:, 0] / pc[:, 2] + cxo, ft * pc[:, 1] / pc[:, 2] + cyo], 1).astype(np.float32)
        src = np.array([[0, 0], [tw, 0], [tw, th], [0, th]], np.float32)
        Hm = cv2.getPerspectiveTransform(src, xy)
        rgb_t, a_t = card["rig"].frame(tau)
        tex = np.dstack([rgb_t, a_t]).astype(np.float32)
        warped = cv2.warpPerspective(tex, Hm, (W, H), flags=cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
        acc += warped / K
    a = np.clip(acc[..., 3:4], 0, 1)
    return img * (1 - a) + acc[..., :3]
