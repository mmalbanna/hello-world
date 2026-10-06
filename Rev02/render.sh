#!/usr/bin/env bash
# Rebuilds the Rev02 film from source/*.webp. Needs python3 (numpy, Pillow) and ffmpeg with libx264.
set -euo pipefail
cd "$(dirname "$0")"
mkdir -p build
OUT=BernardDoumit_Rev02_Vernacular_30s_1080p.mp4
VOPTS=(-c:v libx264 -preset slow -b:v 3800k -maxrate 5000k -bufsize 7600k -profile:v high -level:v 4.0
       -pix_fmt yuv420p -g 60 -keyint_min 30 -sc_threshold 0)

python3 src/make_audio.py build/score.wav
python3 src/normalize_audio.py build/score.wav build/score_norm.wav
python3 src/make_video.py source | ffmpeg -hide_banner -loglevel error -y -f rawvideo -pix_fmt rgb24 \
  -s 1920x1080 -r 30 -i - -c:v libx264 -preset medium -crf 10 -pix_fmt yuv420p build/picture_master.mp4

ffmpeg -hide_banner -loglevel error -y -i build/picture_master.mp4 "${VOPTS[@]}" -pass 1 \
  -passlogfile build/x264pass -an -f mp4 /dev/null
ffmpeg -hide_banner -loglevel error -y -i build/picture_master.mp4 -i build/score_norm.wav \
  -map 0:v:0 -map 1:a:0 "${VOPTS[@]}" -pass 2 -passlogfile build/x264pass \
  -c:a aac -b:a 128k -ar 48000 -ac 2 -shortest -movflags +faststart \
  -metadata title="Bernard Doumit Master Plan | Vernacular Lebanese Adaptation | Rev02" \
  -metadata artist="Motasem Albanna" "$OUT"
cp build/score_norm.wav BernardDoumit_Rev02_Score.wav
echo "done: $OUT"
