"""Shot list for the Rev02 flythrough.

Units are meters. Camera positions are in a level rig frame: x right,
y down (world), z horizontal forward, origin at the render's own camera.
Targets are pixels of the source render; the rig looks at their 3D point
(plus an optional offset in meters). Cuts land on bar lines (80 BPM, 3 s
bars): 6, 12, 18 s, with a dissolve centred on 24 s.

Depth calibration (from measured disparity): d_shift pushes the model's
compressed far range (mountains, citadel) out to effectively infinite
distance; z_bottom is the metric distance of the bottom-centre ground.
"""

CUTS = [0.0, 6.0, 12.0, 18.0, 24.0, 30.0]

SHOTS = {
    "A": dict(
        image=1, hfov=62, pitch=40, d_shift=0.01, z_bottom=75.0, z_max=4000.0,
        reveal_px=40, edge_ratio=0.12, ext_px=30, flatten=0.08, relief=0.03, relief_zmax=500.0, water=None, clouds=False, grade="warm",
        veg=dict(zmax=400.0, meadow_vmin=0.30, sway_world=0.20), gust=dict(k=0.30, w=1.6, amount=0.07),
        pos0=(0.0, 0.0, 0.0), pos1=(2.0, 5.0, 26.0), zoom0=1.0, zoom1=1.04,
        tgt0=(1000, 571, (0, 0, 0)), tgt1=(1030, 660, (4.0, 0, 0)),
        roll0=0.0, roll1=-1.2, ease=0.35,
        outro=dict(kind="zoom", dur=0.45, dist=10.0),
    ),
    "B": dict(
        image=2, hfov=65, pitch=0, d_shift=0.02, z_bottom=2.4, z_max=4000.0,
        reveal_px=90, edge_ratio=0.12, water=(0, 610, 1700, 830), water_val=0.03, clouds=False, grade="warm",
        veg=dict(zmax=150.0, sway_world=0.035), ripple=dict(amp=0.007, caustic=0.16, glint=0.55),
        pos0=(-0.25, 0.0, 0.0), pos1=(0.3, -0.08, 0.7), zoom0=1.0, zoom1=1.06,
        tgt0=(1010, 600, (0, 0, 0)), tgt1=(1010, 600, (0, 0, 0)),
        roll0=0.0, roll1=0.0, ease=0.3,
        intro=dict(kind="zoom", dur=0.5, dist=0.5),
        outro=dict(kind="whip", dur=0.36, yaw=30.0),
    ),
    "C": dict(
        image=3, hfov=65, pitch=0, d_shift=0.04, z_bottom=3.0, z_max=4000.0,
        reveal_px=150, edge_ratio=0.12, water=None, clouds=True, cloud_speed=7.0, grade="warm",
        veg=dict(zmax=150.0, sway_world=0.05, lawn=[(470, 740, 1210, 905)]), gust=dict(k=2.0, w=3.0, amount=0.04),
        pos0=(0.0, 0.0, 0.0), pos1=(0.1, -0.12, 0.9), zoom0=1.0, zoom1=1.18,
        tgt0=(1000, 620, (0, 0, 0)), tgt1=(970, 540, (0, 0, 0)),
        roll0=0.0, roll1=0.0, ease=0.3,
        intro=dict(kind="whip", dur=0.36, yaw=26.0),
        outro=dict(kind="zoom", dur=0.45, dist=1.4),
    ),
    "D": dict(
        image=4, hfov=65, pitch=0, d_shift=0.015, z_bottom=2.2, z_max=4000.0,
        reveal_px=100, edge_ratio=0.12, water=(0, 740, 1600, 1060), water_fill=200000, clouds=False, grade="warm",
        veg=dict(zmax=150.0, sway_world=0.12), ripple=dict(amp=0.007, caustic=0.14, glint=0.4),
        pos0=(0.25, 0.0, 0.0), pos1=(-0.35, -0.12, 0.7), zoom0=1.0, zoom1=1.06,
        tgt0=(1000, 571, (0, 0, 0)), tgt1=(880, 565, (0, 0, 0)),
        roll0=0.0, roll1=0.0, ease=0.3,
        intro=dict(kind="zoom", dur=0.5, dist=0.5),
        outro=dict(kind="dissolve", dur=0.8),
    ),
    "E": dict(
        image=5, hfov=65, pitch=0, d_shift=0.02, z_bottom=3.5, z_max=4000.0,
        reveal_px=90, edge_ratio=0.12, water=(0, 820, 1300, 1120), water_sat=0.45, clouds=False, grade="dusk",
        veg=dict(zmax=150.0, sway_world=0.03), ripple=dict(amp=0.006, caustic=0.22, glint=0.25),
        pos0=(0.0, 0.25, 1.0), pos1=(0.0, 0.0, 0.0), zoom0=1.08, zoom1=1.0,
        tgt0=(1040, 660, (0, 0, 0)), tgt1=(1000, 571, (0, 0, 0)),
        roll0=0.0, roll1=0.0, ease=0.45,
        intro=dict(kind="dissolve", dur=0.8),
    ),
}

ORDER = ["A", "B", "C", "D", "E"]

# Insert shots cut into the timeline over the main shots: (shot, start, end) s.
# "W": Mr. Bernard welcoming the camera on the terrace, cut into the aerial
# on the bar line at 3.0 s and out on the beat at 4.5 s.
SHOTS["W"] = dict(
    image=4, hfov=65, pitch=0, d_shift=0.015, z_bottom=2.2, z_max=4000.0, dur=1.5,
    reveal_px=100, edge_ratio=0.12, water=None, clouds=False, grade="warm",
    veg=dict(zmax=150.0, sway_world=0.12),
    pos0=(0.0, -0.75, 0.0), pos1=(0.0, -0.75, 0.30), zoom0=3.6, zoom1=3.6,
    tgt0=(1000, 571, (0, -0.75, 0)), tgt1=(1000, 571, (0, -0.75, 0)),
    roll0=0.0, roll1=0.0, ease=0.5, defocus=3.5,
    person=dict(card="build/bernard/card.npz", landmarks="build/bernard/landmarks.npy", height_m=0.55, x=0.19, top_m=1.675, z=2.5, lean=0.04),
)
INSERTS = [("W", 3.0, 4.5)]

# Birds: each flies through 3D points given as (source pixel u, v, distance m)
# at shot-local times (s). kind sets size, wing shape and flight style.
BIRDS = {
    "A": [
        dict(kind="stork", keys=[(0.3, 1560, 470, 100), (1.8, 1290, 620, 95), (3.4, 1020, 760, 97), (5.0, 790, 690, 101), (6.2, 640, 560, 104)]),
        dict(kind="stork", keys=[(0.8, 240, 960, 74), (2.6, 520, 840, 72), (4.4, 830, 880, 71), (6.2, 1060, 1010, 70)], phase=1.3),
    ],
    "B": [
        dict(kind="swallow", keys=[(0.9, 2060, 330, 34), (1.8, 1500, 260, 32), (2.8, 960, 340, 35), (3.8, 380, 290, 33), (4.6, -80, 320, 34)]),
        dict(kind="swallow", keys=[(1.3, 2060, 250, 40), (2.2, 1560, 300, 38), (3.1, 1040, 230, 41), (4.1, 470, 280, 39), (4.9, -80, 250, 40)], phase=0.7),
        dict(kind="swallow", keys=[(2.4, -80, 380, 28), (3.2, 520, 330, 27), (4.0, 1120, 390, 29), (4.8, 1700, 340, 28), (5.6, 2080, 360, 28)], phase=2.1),
    ],
    "C": [
        dict(kind="dove", keys=[(0.6, -100, 150, 42), (1.9, 560, 110, 40), (3.2, 1180, 150, 41), (4.5, 1760, 110, 43), (5.6, 2100, 130, 44)]),
        dict(kind="dove", keys=[(0.9, -100, 200, 46), (2.2, 520, 170, 44), (3.5, 1150, 205, 45), (4.8, 1740, 165, 47), (5.9, 2100, 185, 48)], phase=1.9),
    ],
    "D": [
        dict(kind="raptor", keys=[(0.2, 1480, 70, 62), (1.7, 1720, 40, 60), (3.2, 1930, 110, 58), (4.7, 1790, 190, 59), (6.2, 1560, 130, 62)]),
    ],
    "E": [
        dict(kind="gull", keys=[(0.4, 2080, 300, 66), (2.0, 1450, 240, 64), (3.6, 820, 270, 66), (5.2, 180, 230, 68), (6.2, -120, 250, 69)]),
        dict(kind="gull", keys=[(0.7, 2080, 340, 72), (2.3, 1480, 290, 70), (3.9, 860, 310, 72), (5.5, 230, 280, 73), (6.4, -120, 300, 74)], phase=2.4),
    ],
}

CAPTIONS = [
    (0.8, 2.8, "BERNARD DOUMIT MASTER PLAN", "A Vernacular Lebanese Retreat"),
    (3.1, 4.45, "WELCOME", "Mr. Bernard Doumit", 0.3),
    (7.0, 11.0, "MATERIAL", "Rubble-stone walls framing the pool terrace"),
    (13.0, 17.0, "ARCHITECTURE", "Dressed limestone, stone-shingle roofs, timber balconies"),
    (19.2, 23.0, "PLACE", "Arched openings and terraces beneath the cliffs"),
]
END_CARD = (26.3, 30.0)
