"""Brings a cut-out portrait to life: a 2.5D facial rig driven by landmarks.

The portrait (RGB + alpha) gets a 3D head surface from the MediaPipe
landmark depths, so the head can nod and turn with real parallax (nose
moves against the ears, hair edge against the background). Eyelids, brows
and mouth corners are local deformations. Everything is expressed as one
forward displacement field per instant, inverted by fixed-point iteration
and applied as a single resample at 2x resolution.

Greeting choreography (seconds into the insert): small natural motion
throughout; brow flash at 0.30 to 0.80; a slow welcoming nod from 0.45,
peaking at 0.80 and settling by 1.25, with a slight turn toward the camera
that stays; a blink as the nod begins; the smile broadens from 0.6 to 1.0.
"""
import math

import cv2
import numpy as np

# MediaPipe face-mesh indices
L_UP, L_LO, L_IN, L_OUT = [159, 158, 160, 161, 157, 173], [145, 153, 144, 163, 154, 155], 133, 33
R_UP, R_LO, R_IN, R_OUT = [386, 385, 387, 388, 384, 398], [374, 380, 373, 390, 381, 382], 362, 263
L_BROW, R_BROW = [70, 63, 105, 66, 107, 46, 53, 52, 65, 55], [300, 293, 334, 296, 336, 276, 283, 282, 295, 285]
MOUTH_L, MOUTH_R, CHEEK_L, CHEEK_R = 61, 291, 50, 280
OVAL = [10, 338, 297, 332, 284, 251, 389, 356, 454, 323, 361, 288, 397, 365, 379, 378, 400, 377, 152,
        148, 176, 149, 150, 136, 172, 58, 132, 93, 234, 127, 162, 21, 54, 103, 67, 109]
EAR_L, EAR_R, CHIN, FOREHEAD = 234, 454, 152, 10


def smoothstep(x):
    x = min(max(x, 0.0), 1.0)
    return x * x * (3 - 2 * x)


def pulse(t, a, up, hold, down):
    """0 -> 1 over [a, a+up], hold, back to 0 by a+up+hold+down."""
    if t < a:
        return 0.0
    if t < a + up:
        return smoothstep((t - a) / up)
    if t < a + up + hold:
        return 1.0
    return 1.0 - smoothstep((t - a - up - hold) / down)


class FaceRig:
    def __init__(self, card_path, landmarks_path, mirror=True, scale=2, z_scale=1.2):
        d = np.load(card_path)
        rgb, a = d["rgb"].astype(np.float32), d["alpha"].astype(np.float32)
        pts = np.load(landmarks_path).astype(np.float32)
        if mirror:
            rgb, a = rgb[:, ::-1], a[:, ::-1]
            pts[:, 0] = rgb.shape[1] - 1 - pts[:, 0]
        self.s = scale
        H, W = a.shape[0] * scale, a.shape[1] * scale
        self.H, self.W = H, W
        self.rgb = cv2.resize(rgb, (W, H), interpolation=cv2.INTER_LANCZOS4)
        self.alpha = np.clip(cv2.resize(a, (W, H), interpolation=cv2.INTER_LINEAR), 0, 1)
        self.p = pts[:, :2] * scale
        self.pz = -pts[:, 2] * scale * z_scale  # toward the camera is positive
        self.face_h = float(self.p[CHIN, 1] - self.p[FOREHEAD, 1])
        yy, xx = np.mgrid[0:H, 0:W].astype(np.float32)
        self.xx, self.yy = xx, yy
        self._build_surface()
        self._build_regions()

    # ------------------------------------------------------------- geometry
    def _build_surface(self):
        """Head depth: landmark depths interpolated over the face, extended
        behind the face oval for hair, ears and neck."""
        step = 8
        gx, gy = np.meshgrid(np.arange(0, self.W, step, dtype=np.float32), np.arange(0, self.H, step, dtype=np.float32))
        px, py, pz = self.p[:, 0], self.p[:, 1], self.pz
        d2 = (gx[..., None] - px) ** 2 + (gy[..., None] - py) ** 2
        wgt = 1.0 / (d2 + (6 * self.s) ** 2)
        z = (wgt * pz).sum(-1) / wgt.sum(-1)
        z = cv2.resize(z.astype(np.float32), (self.W, self.H), interpolation=cv2.INTER_CUBIC)
        oval = np.zeros((self.H, self.W), np.uint8)
        cv2.fillPoly(oval, [self.p[OVAL].astype(np.int32)], 1)
        dist = cv2.distanceTransform(1 - oval, cv2.DIST_L2, 5)
        back = 0.6 * self.face_h
        z_out = z - back * (1 - np.exp(-dist / (0.35 * self.face_h)))
        self.z = np.where(oval > 0, z, z_out).astype(np.float32)
        ear = 0.5 * (self.p[EAR_L] + self.p[EAR_R])
        self.pivot = np.array([ear[0], ear[1] + 0.22 * self.face_h, 0.5 * (self.pz[EAR_L] + self.pz[EAR_R]) - 0.15 * self.face_h], np.float32)

    def _build_regions(self):
        yy, xx = self.yy, self.xx
        chin_y = self.p[CHIN, 1]
        neck = 0.45 * self.face_h
        self.w_head = np.clip(1 - (yy - (chin_y + 0.05 * self.face_h)) / neck, 0, 1).astype(np.float32)
        self.w_head = self.w_head * self.w_head * (3 - 2 * self.w_head)
        blob = lambda idx, sig: np.exp(-(((xx[..., None] - self.p[idx, 0]) ** 2 + (yy[..., None] - self.p[idx, 1]) ** 2) / (2 * sig ** 2))).max(-1)
        self.g_brow = blob(L_BROW + R_BROW, 12 * self.s)
        self.g_mouth_l = blob([MOUTH_L], 16 * self.s)
        self.g_mouth_r = blob([MOUTH_R], 16 * self.s)
        self.g_cheek = blob([CHEEK_L, CHEEK_R], 22 * self.s)
        self.eyes = [self._eye(L_UP, L_LO, L_IN, L_OUT), self._eye(R_UP, R_LO, R_IN, R_OUT)]

    def _eye(self, up, lo, inner, outer):
        pts_u = self.p[[outer] + up + [inner]]
        pts_l = self.p[[outer] + lo + [inner]]
        order_u, order_l = np.argsort(pts_u[:, 0]), np.argsort(pts_l[:, 0])
        xs = np.arange(self.W, dtype=np.float32)
        x0, x1 = min(pts_u[:, 0].min(), pts_l[:, 0].min()), max(pts_u[:, 0].max(), pts_l[:, 0].max())
        yu = np.interp(xs, pts_u[order_u, 0], pts_u[order_u, 1]).astype(np.float32)
        yl = np.interp(xs, pts_l[order_l, 0], pts_l[order_l, 1]).astype(np.float32)
        opening = np.clip(yl - yu, 0, None)
        margin = 0.12 * (x1 - x0)
        win = np.clip(np.minimum(xs - (x0 - margin), (x1 + margin) - xs) / (margin + 1e-6), 0, 1)
        win = win * win * (3 - 2 * win)
        return dict(yu=yu, yl=yl, o=opening, win=win.astype(np.float32), hb=0.9 * opening.max() + 4 * self.s)

    # ------------------------------------------------------------- motion
    def pose(self, t):
        """Pitch (nod down positive), yaw (toward the camera positive), brow,
        blink, smile and the slow body sway, in degrees / units."""
        micro_p = 0.35 * math.sin(2 * math.pi * 0.43 * t + 0.7) + 0.2 * math.sin(2 * math.pi * 1.1 * t)
        micro_y = 0.3 * math.sin(2 * math.pi * 0.37 * t + 2.1) + 0.15 * math.sin(2 * math.pi * 0.9 * t + 1.0)
        nod = pulse(t, 0.45, 0.35, 0.0, 0.45)
        pitch = micro_p + 5.5 * nod
        yaw = micro_y + 3.5 * smoothstep((t - 0.45) / 0.55)
        brow = pulse(t, 0.30, 0.15, 0.17, 0.18)
        blink = pulse(t, 0.52, 0.10, 0.03, 0.14)
        smile = smoothstep((t - 0.6) / 0.4)
        return pitch, yaw, brow, blink, smile

    def forward_field(self, t):
        pitch, yaw, brow, blink, smile = self.pose(t)
        xx, yy, z = self.xx, self.yy, self.z
        px, py, pz = self.pivot
        th, ph = math.radians(pitch), math.radians(yaw)
        # rigid head rotation about the pivot: pitch about x, then yaw about y
        y1 = (yy - py) * math.cos(th) + (z - pz) * math.sin(th)
        w1 = -(yy - py) * math.sin(th) + (z - pz) * math.cos(th)
        x2 = (xx - px) * math.cos(ph) - w1 * math.sin(ph)
        w2 = (xx - px) * math.sin(ph) + w1 * math.cos(ph)
        persp = 1.0 / (1.0 - (w2 - (z - pz)) / (2.5 / 0.55 * self.H))
        dx = ((x2 * persp + px) - xx) * self.w_head
        dy = ((y1 * persp + py) - yy) * self.w_head
        # brow flash (eyes follow a little)
        dy = dy - brow * 3.0 * self.s * self.g_brow
        # smile: corners out and up, cheeks up
        sm = smile * 2.4 * self.s
        dx = dx - sm * 0.7 * self.g_mouth_l + sm * 0.7 * self.g_mouth_r
        dy = dy - sm * (self.g_mouth_l + self.g_mouth_r) - 0.5 * sm * self.g_cheek
        # blink: upper lid comes down over the eye, lower lid rises a quarter
        if blink > 0.001:
            r = 0.25
            for e in self.eyes:
                yu, yl, o, win, hb = e["yu"][None, :], e["yl"][None, :], e["o"][None, :], e["win"][None, :], e["hb"]
                above = (yy >= yu - hb) & (yy < yu)
                inside = (yy >= yu) & (yy <= yl)
                below = (yy > yl) & (yy <= yl + hb)
                d_above = blink * o * (1 - r) * (1 - (yu - yy) / hb)
                d_inside = blink * (o * (1 - r) - (yy - yu))
                d_below = -blink * o * r * (1 - (yy - yl) / hb)
                dy = dy + win * (np.where(above, d_above, 0) + np.where(inside, d_inside, 0) + np.where(below, d_below, 0))
        return dx.astype(np.float32), dy.astype(np.float32)

    def frame(self, t, iters=4):
        """Deformed premultiplied RGB and alpha at 2x for time t."""
        dx, dy = self.forward_field(t)
        sx, sy = self.xx.copy(), self.yy.copy()
        for _ in range(iters):
            ex = cv2.remap(dx, sx, sy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
            ey = cv2.remap(dy, sx, sy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_REPLICATE)
            sx, sy = self.xx - ex, self.yy - ey
        rgb = cv2.remap(self.rgb, sx, sy, cv2.INTER_CUBIC, borderMode=cv2.BORDER_REPLICATE)
        a = cv2.remap(self.alpha, sx, sy, cv2.INTER_LINEAR, borderMode=cv2.BORDER_CONSTANT, borderValue=0)
        a = np.clip(a, 0, 1)
        return np.clip(rgb, 0, 1) * a[..., None], a
