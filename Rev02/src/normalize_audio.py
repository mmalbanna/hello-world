"""Two-pass EBU R128 normalisation to -16 LUFS via ffmpeg loudnorm, then a
-5 dBFS peak limiter: the AAC encoder overshoots the synthesized drum and
transition hits by about 2.5 dB, and this keeps the delivered file below
-1 dBTP."""
import json
import re
import subprocess
import sys

src, dst = sys.argv[1], sys.argv[2]
base = "loudnorm=I=-16:TP=-1.5:LRA=11"
probe = subprocess.run(
    ["ffmpeg", "-hide_banner", "-nostats", "-i", src, "-af", base + ":print_format=json", "-f", "null", "-"],
    capture_output=True, text=True, check=True,
).stderr
m = json.loads(re.search(r"\{[^{}]*\}", probe, re.S).group(0))
af = (
    f"{base}:measured_I={m['input_i']}:measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}"
    f":measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true"
    ",alimiter=limit=0.56:attack=1:release=60:level=false"
)
subprocess.run(
    ["ffmpeg", "-hide_banner", "-loglevel", "error", "-y", "-i", src, "-af", af, "-ar", "48000", "-c:a", "pcm_s16le", dst],
    check=True,
)
print("wrote", dst)
