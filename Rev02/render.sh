#!/usr/bin/env bash
# Rebuilds the Rev02 flythrough from source/*.webp.
#
# Needs: python3 with numpy, Pillow, opencv-contrib-python-headless, onnxruntime, torch;
#        node with Playwright and its Chromium; ffmpeg with libx264.
# Models, downloaded once into $MODELS (default /home/user/models):
#   https://github.com/fabio-sim/Depth-Anything-ONNX/releases/download/v2.0.0/depth_anything_v2_vitl_dynamic.onnx
#   https://github.com/Sanster/models/releases/download/add_big_lama/big-lama.pt
set -euo pipefail
cd "$(dirname "$0")"
export MODELS=${MODELS:-/home/user/models}
OUT=BernardDoumit_Rev02_Flythrough_30s_1080p.mp4
VOPTS=(-c:v libx264 -preset slow -b:v 3800k -maxrate 5000k -bufsize 7600k -profile:v high -level:v 4.0
       -pix_fmt yuv420p -g 60 -keyint_min 30 -sc_threshold 0)

mkdir -p build/depth
python3 src/depth.py "$MODELS/depth_anything_v2_vitl_dynamic.onnx" build/depth source/{1,2,3,4,5}.webp
python3 src/prep_scenes.py
python3 src/flythrough.py zoom
python3 src/glrender.py export
python3 src/glrender.py render build/flythrough_master.mp4 2

python3 src/make_audio.py build/score.wav
python3 src/normalize_audio.py build/score.wav build/score_norm.wav

ffmpeg -hide_banner -loglevel error -y -i build/flythrough_master.mp4 "${VOPTS[@]}" -pass 1 \
  -passlogfile build/x264pass -an -f mp4 /dev/null
ffmpeg -hide_banner -loglevel error -y -i build/flythrough_master.mp4 -i build/score_norm.wav \
  -map 0:v:0 -map 1:a:0 "${VOPTS[@]}" -pass 2 -passlogfile build/x264pass \
  -c:a aac -b:a 128k -ar 48000 -ac 2 -shortest -movflags +faststart \
  -metadata title="Bernard Doumit Master Plan | Vernacular Lebanese Adaptation | Rev02" \
  -metadata artist="Motasem Albanna" "$OUT"
cp build/score_norm.wav BernardDoumit_Rev02_Score.wav
echo "done: $OUT"
