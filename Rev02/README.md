# Bernard Doumit Master Plan | Rev02 film

Author: Motasem Albanna

30-second film presenting the vernacular Lebanese adaptation of the design, built from the five renders in `source/`.

## Deliverables

| File | Spec (measured with ffprobe / ebur128) |
|---|---|
| `BernardDoumit_Rev02_Vernacular_30s_1080p.mp4` | MP4, H.264 High@4.0, 1920x1080 (16:9), 30 fps, yuv420p, AAC-LC 48 kHz stereo 128 kbps, 30.000 s, 14.7 MB, fast-start, -16 LUFS |
| `BernardDoumit_Rev02_Score.wav` | Original score and SFX, 48 kHz 16-bit stereo, -16 LUFS |

## Edit

| Time | Shot | Camera | Caption | Sound |
|---|---|---|---|---|
| 0:00 to 0:07 | Aerial of the hamlet on the ridge | Push in to the cottage cluster | Bernard Doumit Master Plan / A Vernacular Lebanese Retreat | Mountain wind, birdsong, ney solo over a D drone |
| 0:06 to 0:13 | Stone wall and pool, mountain backdrop | Lateral pan toward the sun | Rubble-stone walls framing the pool terrace | Oud and darbuka enter, pool water |
| 0:12 to 0:19 | Village lane, citadel above | Tilt up to the citadel | Dressed limestone, stone-shingle roofs, timber balconies | Oud melody, birds |
| 0:18 to 0:25 | Cliffside pool terrace, cypresses | Slow push in | Arched openings and terraces beneath the cliffs | Melodic peak, cicadas, water |
| 0:24 to 0:30 | Dusk, lit cottages and pool | Pull out | End card: Vernacular Lebanese Adaptation, Rev02, Motasem Albanna | Final D resolution, ney, crickets |

1 s crossfades at 6, 12, 18 and 24 s. Music is maqam Hijaz on D at 80 BPM (one bar = 3 s, so bar lines land on the cuts); darbuka plays the maqsum rhythm. All music and SFX are synthesized in `src/make_audio.py`; no samples or third-party recordings.

Titles are set in Carlito because Aptos could not be obtained in the build environment.

## Rebuild

```
./render.sh
```
