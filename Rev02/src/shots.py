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
        pos0=(0.0, 0.0, 0.0), pos1=(2.0, 5.0, 26.0), zoom0=1.0, zoom1=1.04,
        tgt0=(1000, 571, (0, 0, 0)), tgt1=(1030, 660, (4.0, 0, 0)),
        roll0=0.0, roll1=-1.2, ease=0.35,
        outro=dict(kind="zoom", dur=0.45, dist=10.0),
    ),
    "B": dict(
        image=2, hfov=65, pitch=0, d_shift=0.02, z_bottom=2.4, z_max=4000.0,
        reveal_px=90, edge_ratio=0.12, water=(0, 610, 1700, 830), water_val=0.03, clouds=False, grade="warm",
        pos0=(-0.25, 0.0, 0.0), pos1=(0.3, -0.08, 0.7), zoom0=1.0, zoom1=1.06,
        tgt0=(1010, 600, (0, 0, 0)), tgt1=(1010, 600, (0, 0, 0)),
        roll0=0.0, roll1=0.0, ease=0.3,
        intro=dict(kind="zoom", dur=0.5, dist=0.5),
        outro=dict(kind="whip", dur=0.36, yaw=30.0),
    ),
    "C": dict(
        image=3, hfov=65, pitch=0, d_shift=0.04, z_bottom=3.0, z_max=4000.0,
        reveal_px=150, edge_ratio=0.12, water=None, clouds=True, cloud_speed=7.0, grade="warm",
        pos0=(0.0, 0.0, 0.0), pos1=(0.1, -0.12, 0.9), zoom0=1.0, zoom1=1.18,
        tgt0=(1000, 620, (0, 0, 0)), tgt1=(970, 540, (0, 0, 0)),
        roll0=0.0, roll1=0.0, ease=0.3,
        intro=dict(kind="whip", dur=0.36, yaw=26.0),
        outro=dict(kind="zoom", dur=0.45, dist=1.4),
    ),
    "D": dict(
        image=4, hfov=65, pitch=0, d_shift=0.015, z_bottom=2.2, z_max=4000.0,
        reveal_px=100, edge_ratio=0.12, water=(0, 740, 1600, 1060), water_fill=200000, clouds=False, grade="warm",
        pos0=(0.25, 0.0, 0.0), pos1=(-0.35, -0.12, 0.7), zoom0=1.0, zoom1=1.06,
        tgt0=(1000, 571, (0, 0, 0)), tgt1=(880, 565, (0, 0, 0)),
        roll0=0.0, roll1=0.0, ease=0.3,
        intro=dict(kind="zoom", dur=0.5, dist=0.5),
        outro=dict(kind="dissolve", dur=0.8),
    ),
    "E": dict(
        image=5, hfov=65, pitch=0, d_shift=0.02, z_bottom=3.5, z_max=4000.0,
        reveal_px=90, edge_ratio=0.12, water=(0, 820, 1300, 1120), water_sat=0.45, clouds=False, grade="dusk",
        pos0=(0.0, 0.25, 1.0), pos1=(0.0, 0.0, 0.0), zoom0=1.08, zoom1=1.0,
        tgt0=(1040, 660, (0, 0, 0)), tgt1=(1000, 571, (0, 0, 0)),
        roll0=0.0, roll1=0.0, ease=0.45,
        intro=dict(kind="dissolve", dur=0.8),
    ),
}

ORDER = ["A", "B", "C", "D", "E"]

CAPTIONS = [
    (0.8, 5.2, "BERNARD DOUMIT MASTER PLAN", "A Vernacular Lebanese Retreat"),
    (7.0, 11.0, "MATERIAL", "Rubble-stone walls framing the pool terrace"),
    (13.0, 17.0, "ARCHITECTURE", "Dressed limestone, stone-shingle roofs, timber balconies"),
    (19.2, 23.0, "PLACE", "Arched openings and terraces beneath the cliffs"),
]
END_CARD = (26.3, 30.0)
