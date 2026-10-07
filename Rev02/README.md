# Bernard Doumit Master Plan | Rev02 flythrough

Author: Motasem Albanna

A 30-second camera flythrough presenting the vernacular Lebanese adaptation of the design, built from the five renders in `source/`.

## Deliverables

| File | Spec (measured with ffprobe / ebur128) |
|---|---|
| `BernardDoumit_Rev02_Flythrough_30s_1080p.mp4` | MP4, H.264 High@4.0, 1920x1080 (16:9), 30 fps, yuv420p, 3.9 Mbps two-pass; AAC-LC 48 kHz stereo 128 kbps; 30.000 s; 15.24 MB; fast-start; -16.1 LUFS, -2.2 dBTP |
| `BernardDoumit_Rev02_Score.wav` | Original score and sound effects, 48 kHz 16-bit stereo, -16.0 LUFS, -4.5 dBTP |

## How the flythrough is made

Each render becomes a small 3D scene, and a virtual camera flies through it (2.5D camera projection, the technique used in VFX when only stills exist):

1. **Depth**: Depth Anything V2 Large estimates per-pixel depth, which is calibrated to metres per shot. Pool water is levelled onto its terrace and small reliefs are flattened where they would only tear.
2. **Layers**: the camera path of each shot is simulated to find exactly what it will uncover behind buildings and walls; LaMa inpaints that hidden background.
3. **Rendering**: two triangle meshes per shot (foreground, cut at occlusion edges, and the inpainted background) are rasterised in WebGL2 (headless Chromium). Each frame averages 4 to 12 jittered sub-frames over a 180-degree shutter for anti-aliasing and real motion blur. Pool water ripples and clouds drift in the shader.
4. **Life**: pool water ripples with moving caustic light and sun glints; trees, shrubs and flowers sway in the breeze (anchored at the base, stronger at the tips); wind rolls across the meadow and the lawn; birds fly through every shot as small 3D models with flapping and gliding wings, projected through the shot's camera so they keep correct size, parallax and motion blur (white storks over the hamlet, swallows over the pool, doves above the village, a raptor along the cliffs, gulls at dusk).
5. **Mr. Bernard**: his portrait (`source/bernard.jpg`) is cut out with ISNet and tracked with MediaPipe (478 facial landmarks with depth). A 2.5D facial rig (`src/face_rig.py`) gives the head a 3D surface from the landmark depths and animates him: natural micro-motion, a brow flash, a blink as he begins a welcoming nod, a slight turn toward the camera, the smile broadening, breathing. He stands as a card at true scale in the terrace scene (image 4), projected through the insert's camera for every shutter sample. The background is rendered at a portrait focal length and defocused.
6. **Edit**: cuts land on the music's bar lines: welcome insert at 0:03 to 0:04.5, zoom-through at 0:06, whip pan at 0:12, zoom-through at 0:18, dissolve to dusk at 0:24.

| Time | Shot | Camera |
|---|---|---|
| 0:00 to 0:06 | Aerial over the ridge hamlet | Drone glide forward and down with a slight bank, ends in a zoom-through |
| 0:03 to 0:04.5 | Mr. Bernard welcomes the camera (insert) | Cut in on the bar line to a head-and-shoulders shot of Mr. Bernard Doumit on the terrace, camera pushing in, cut back on the beat |
| 0:06 to 0:12 | Stone wall and pool | Arc around the wall with a slow push, ends in a whip pan |
| 0:12 to 0:18 | Village lane | Push between the two houses toward the citadel, ends in a zoom-through |
| 0:18 to 0:24 | Cliffside pool terrace | Arc across the pool toward the house |
| 0:24 to 0:30 | Dusk | Pull back and rise to the full view, end card |

Limits: the camera can only move as far as each single image supports (about a metre at eye level, tens of metres in the aerial). Areas never seen in a render are inpainted, so surfaces seen edge-on (the village houses' side walls) stretch slightly during the push.

Music: maqam Hijaz on D at 80 BPM (oud, ney, drone, darbuka maqsum), with wind, birds, pool water, rustling leaves, cicadas, crickets and transition effects, all synthesized in `src/make_audio.py`.

Titles are set in Carlito because Aptos could not be obtained in the build environment.

## Rebuild

```
./render.sh
```
