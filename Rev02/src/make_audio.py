"""Original score + SFX for the 30 s vernacular Lebanese film.

Maqam Hijaz on D, 80 BPM (one 4/4 bar = 3 s, so bar lines fall on the
shot crossfades at 6, 12, 18 and 24 s). Oud (Karplus-Strong), ney, drone,
darbuka (maqsum rhythm), plus wind, birds, pool water, cicadas, crickets
and transition whooshes. Output: 48 kHz 16-bit stereo WAV.
"""
import sys
import wave

import numpy as np

SR = 48000
T = 30.0
N = int(SR * T)
BEAT = 0.75
EIGHTH = BEAT / 2
D3 = 146.832
rng = np.random.default_rng(7)


def t_axis(n):
    return np.arange(n) / SR


def fft_filter(x, lo=None, hi=None, roll=0.15):
    X = np.fft.rfft(x)
    f = np.fft.rfftfreq(len(x), 1 / SR)
    g = np.ones_like(f)
    if lo:
        g *= np.clip((f - lo * (1 - roll)) / (lo * roll * 2 + 1e-9), 0, 1)
    if hi:
        g *= np.clip((hi * (1 + roll) - f) / (hi * roll * 2 + 1e-9), 0, 1)
    return np.fft.irfft(X * g, len(x))


def lfo(rate, n, lo=0.0, hi=1.0, seed=None):
    r = np.random.default_rng(seed)
    pts = int(T * rate) + 4
    v = r.random(pts)
    x = np.linspace(0, pts - 1, n)
    y = np.interp(x, np.arange(pts), v)
    k = max(1, int(SR / rate / 2))
    y = np.convolve(y, np.ones(k) / k, mode="same")
    y = (y - y.min()) / (y.max() - y.min() + 1e-9)
    return lo + (hi - lo) * y


def env_points(points, n=N):
    ts, vs = zip(*points)
    return np.interp(t_axis(n), ts, vs)


class Bus:
    def __init__(self):
        self.L = np.zeros(N)
        self.R = np.zeros(N)

    def add(self, sig, start, gain=1.0, pan=0.0):
        i = int(start * SR)
        if i >= N:
            return
        sig = sig[: N - i]
        a = (pan + 1) * np.pi / 4
        self.L[i : i + len(sig)] += sig * gain * np.cos(a)
        self.R[i : i + len(sig)] += sig * gain * np.sin(a)

    def add_stereo(self, l, r, gain=1.0):
        self.L += l * gain
        self.R += r * gain


# ---------------------------------------------------------------- instruments
def oud_pluck(freq, dur=2.2, vel=1.0, t60=1.6):
    n = int(SR * dur)
    p = max(2, int(round(SR / freq - 0.5)))
    burst = rng.uniform(-1, 1, p)
    burst = np.convolve(burst, [0.5, 0.5], mode="same")
    pick = int(p * 0.13)
    burst = burst - 0.6 * np.roll(burst, pick)
    d = 0.001 ** (1.0 / (t60 * freq))
    y = np.zeros(n + 1)
    y[1 : p + 1] = burst
    k = p + 1
    while k <= n:
        e = min(k + p, n + 1)
        y[k:e] = d * 0.5 * (y[k - p : e - p] + y[k - p - 1 : e - p - 1])
        k = e
    y = y[1:]
    att = np.minimum(1, t_axis(n) / 0.002)
    return y * att * vel


def ney(freq, dur, vel=1.0, attack=0.25, release=0.5):
    n = int(SR * dur)
    t = t_axis(n)
    vib = 1 + 0.006 * np.sin(2 * np.pi * 5.2 * t) * np.minimum(1, t / 0.6)
    ph = 2 * np.pi * np.cumsum(freq * vib) / SR
    tone = np.sin(ph) + 0.18 * np.sin(2 * ph) + 0.06 * np.sin(3 * ph)
    breath = fft_filter(rng.normal(0, 1, n), freq * 0.8, freq * 3.5) * 0.35
    env = np.minimum(1, t / attack) * np.minimum(1, (dur - t) / release)
    env = np.clip(env, 0, 1) ** 1.3
    return (tone + breath) * env * vel


def dum(vel=1.0):
    n = int(SR * 0.6)
    t = t_axis(n)
    f = 78 + 55 * np.exp(-t / 0.035)
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-t / 0.22)
    ring = 0.25 * np.sin(2 * np.pi * 168 * t) * np.exp(-t / 0.12)
    thump = fft_filter(rng.normal(0, 1, n), 60, 900) * np.exp(-t / 0.012) * 0.5
    return (body + ring + thump) * vel


def tek(vel=1.0, ka=False):
    n = int(SR * 0.18)
    t = t_axis(n)
    lo, hi = (1800, 5500) if ka else (2600, 8000)
    noise = fft_filter(rng.normal(0, 1, n), lo, hi) * np.exp(-t / (0.03 if ka else 0.022))
    ring = 0.5 * np.sin(2 * np.pi * (720 if ka else 960) * t) * np.exp(-t / 0.05)
    return (noise * 1.6 + ring) * vel


# ------------------------------------------------------------------- music
music = Bus()

# Drone: D2 + A2, gentle chorus
t = t_axis(N)
drone = np.zeros(N)
for f0, a0 in ((73.416, 1.0), (110.0, 0.55), (146.83, 0.25)):
    for det in (-0.12, 0.0, 0.13):
        for h in range(1, 6):
            drone += a0 / h ** 2 * np.sin(2 * np.pi * f0 * h * (1 + det / 100) * t + rng.random() * 6.28)
drone = fft_filter(drone, 40, 900)
drone *= env_points([(0, 0), (3.0, 0.85), (6, 0.6), (18, 0.6), (24, 0.75), (27.5, 0.5), (30, 0)])
drone *= lfo(0.3, N, 0.85, 1.0, seed=3)
music.add(drone / np.abs(drone).max(), 0, gain=0.16)

# Ney intro (D4-based Hijaz) and coda
D4 = D3 * 2
sem = lambda s, base=D4: base * 2 ** (s / 12)
for st, du, s, v in [
    (0.9, 1.7, 7, 0.9), (2.55, 0.42, 8, 0.8), (2.95, 0.42, 7, 0.8),
    (3.35, 0.42, 5, 0.75), (3.75, 2.6, 4, 0.85),
    (24.35, 0.35, 1, 0.35), (24.65, 4.4, 0, 0.42),
]:
    music.add(ney(sem(s), du, v, attack=0.12 if du < 1 else 0.35), st, gain=0.20, pan=0.15)

# Oud melody: 8 eighths per bar, bars 3..9 (start 6 s); "t" = tremolo (riysha)
bars = [
    "0 1 4 5 7 - - -",
    "8 7 5 4 5 4 1 0",
    "7 - 12 - 10 8 7 -",
    "8 10 8 7 5 4 5 -",
    "12 13 12 10 8 - 7 -",
    "10 8 7 5 4 5 t7 -",
    "5 4 1 - 0 - - -",
]
for bi, bar in enumerate(bars):
    b0 = 6.0 + bi * 3.0
    toks = bar.split()
    for ei, tok in enumerate(toks):
        if tok in ("-", "."):
            continue
        st = b0 + ei * EIGHTH + rng.normal(0, 0.004)
        trem = tok.startswith("t")
        s = int(tok.lstrip("t"))
        length = 1
        while ei + length < len(toks) and toks[ei + length] == "-":
            length += 1
        vel = 0.9 if ei % 2 == 0 else 0.7
        f = sem(s, D3)
        if trem:
            steps = int(length * 2 + 2)
            for k in range(steps):
                music.add(oud_pluck(f, 1.0, vel * (0.75 - 0.03 * k)), st + k * EIGHTH / 2, 0.5, -0.2)
        else:
            music.add(oud_pluck(f, 2.4, vel, t60=1.2 + 0.25 * length), st, 0.5, -0.2)
# Bar 10: final D arpeggio, let ring
for k, s in enumerate((-12, 0, 7, 12)):
    music.add(oud_pluck(sem(s, D3), 3.5, 0.8, t60=2.6), 27.0 + k * 0.06, 0.5, -0.2 + 0.1 * k)

# Darbuka, maqsum (D T . T D . T .) bars 3..8, downbeat dum at 24 s
perc = Bus()
pattern = ["D", "T", ".", "T", "D", ".", "T", "."]
for bi in range(6):
    b0 = 6.0 + bi * 3.0
    for ei, h in enumerate(pattern):
        st = b0 + ei * EIGHTH + rng.normal(0, 0.003)
        v = rng.uniform(0.85, 1.0) * (0.75 if bi == 0 else 1.0)
        if h == "D":
            perc.add(dum(v), st, 0.36, 0.05)
        elif h == "T":
            perc.add(tek(v * 0.8), st, 0.32, 0.25)
        if bi >= 2 and h == "." and rng.random() < 0.55:
            perc.add(tek(v * 0.45, ka=True), st, 0.3, -0.25)
    if bi == 5:  # fill into the dusk shot
        for k in range(4):
            perc.add(tek(0.55 + 0.1 * k, ka=k % 2 == 1), b0 + 2.25 + k * EIGHTH / 2, 0.3, 0.2)
perc.add(dum(1.0), 24.0, 0.4, 0.0)

# ------------------------------------------------------------------- SFX
sfx = Bus()

# Wind (strong on the aerial, thinning out)
wl = fft_filter(rng.normal(0, 1, N), 80, 900)
wr = fft_filter(rng.normal(0, 1, N), 80, 900)
gust = lfo(0.35, N, 0.35, 1.0, seed=11)
wenv = env_points([(0, 0), (1.2, 1.0), (6.0, 0.9), (7.5, 0.3), (12, 0.22), (13.5, 0.12), (24, 0.1), (27, 0.18), (30, 0)])
wl, wr = wl * gust * wenv, wr * np.roll(gust, SR // 3) * wenv
sc = np.abs(np.concatenate([wl, wr])).max()
sfx.add_stereo(wl / sc, wr / sc, 0.22)


def chirp(f0, f1, dur):
    n = int(SR * dur)
    tt = t_axis(n)
    f = np.geomspace(f0, f1, n)
    ph = 2 * np.pi * np.cumsum(f) / SR
    e = np.sin(np.pi * tt / dur) ** 2
    return (np.sin(ph) + 0.2 * np.sin(2 * ph)) * e


def bird_call(kind):
    out = []
    if kind == 0:
        for _ in range(rng.integers(3, 6)):
            out.append(chirp(rng.uniform(3200, 3800), rng.uniform(4600, 5400), rng.uniform(0.05, 0.08)))
            out.append(np.zeros(int(SR * rng.uniform(0.04, 0.08))))
    else:
        out.append(chirp(5200, 2900, 0.18))
        out.append(np.zeros(int(SR * 0.06)))
        out.append(chirp(3000, 4200, 0.12))
    return np.concatenate(out)


bt = 1.4
while bt < 21.5:
    g = 0.05 if bt < 7 else 0.035
    sfx.add(bird_call(int(rng.integers(0, 2))), bt, g, rng.uniform(-0.8, 0.8))
    bt += rng.uniform(0.9, 2.2)

# Pool water lapping (shots 2, 4, 5) + rare drips
water = np.zeros(N)
lt = 5.8
while lt < 29.5:
    d = rng.uniform(0.35, 0.9)
    n = int(SR * d)
    tt = t_axis(n)
    burst = fft_filter(rng.normal(0, 1, n), 150, 1400) * np.sin(np.pi * tt / d) ** 1.5
    i = int(lt * SR)
    water[i : i + n] += burst[: N - i] * rng.uniform(0.5, 1.0)
    lt += rng.uniform(0.25, 0.6)
water *= env_points([(0, 0), (5.8, 0), (7.2, 1), (12.2, 0.9), (13.2, 0.05), (17.8, 0.05), (19.2, 1), (24, 0.8), (25, 0.5), (29.5, 0.45), (30, 0)])
water /= np.abs(water).max() + 1e-9
sfx.add(water, 0, 0.12, 0.1)
for dt in (8.3, 10.9, 20.4, 22.8, 26.1):
    n = int(SR * 0.09)
    tt = t_axis(n)
    f = np.geomspace(1100, 1900, n)
    drip = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-tt / 0.025)
    sfx.add(drip, dt, 0.05, rng.uniform(-0.4, 0.4))

# Cicadas on the cliff terrace (shot 4)
cn = fft_filter(rng.normal(0, 1, N), 4200, 7200)
puls = 0.5 + 0.5 * np.sign(np.sin(2 * np.pi * 42 * t))
cic = cn * puls * lfo(0.6, N, 0.4, 1.0, seed=5)
cic *= env_points([(0, 0), (17.6, 0), (19.0, 1), (23.6, 0.9), (24.8, 0), (30, 0)])
cic /= np.abs(cic).max() + 1e-9
sfx.add(cic, 0, 0.035, -0.3)

# Crickets at dusk (shot 5)
for c, (pan, f0, period, off) in enumerate(((-0.6, 4650, 0.82, 24.4), (0.55, 4380, 0.95, 24.9))):
    ct = off
    while ct < 29.6:
        for k in range(3):
            n = int(SR * 0.022)
            tt = t_axis(n)
            p = np.sin(2 * np.pi * f0 * tt) * np.sin(np.pi * tt / 0.022)
            fade = np.interp(ct, [24.4, 25.4, 29.0, 29.8], [0, 1, 1, 0])
            sfx.add(p, ct + k * 0.05, 0.05 * fade, pan)
        ct += period + rng.uniform(-0.05, 0.05)

# Transition whooshes centred on each crossfade
for c in (6.5, 12.5, 18.5, 24.5):
    d = 1.6
    n = int(SR * d)
    tt = t_axis(n)
    w = fft_filter(rng.normal(0, 1, n), 300, 3000)
    e = np.exp(-((tt - d * 0.55) / 0.32) ** 2)
    sfx.add(w * e / (np.abs(w).max() + 1e-9), c - d * 0.55, 0.06, 0.0)

# ------------------------------------------------------------------- reverb + mix
def reverb(l, r, seconds=2.2, wet=0.25):
    n = int(SR * seconds)
    tt = t_axis(n)
    out = []
    for ch, x in enumerate((l, r)):
        ir = np.random.default_rng(100 + ch).normal(0, 1, n) * np.exp(-6.9 * tt / seconds)
        ir = fft_filter(ir, 120, 7000)
        ir[: int(SR * 0.012)] = 0
        ir /= np.sqrt(np.sum(ir ** 2))
        m = len(x) + n
        y = np.fft.irfft(np.fft.rfft(x, m) * np.fft.rfft(ir, m), m)[: len(x)]
        out.append(x * (1 - wet) + y * wet)
    return out


ml, mr = reverb(music.L, music.R, 2.4, 0.28)
pl, pr = reverb(perc.L, perc.R, 1.4, 0.15)
sl, sr_ = reverb(sfx.L, sfx.R, 1.6, 0.12)
L = ml + pl * 0.9 + sl
R = mr + pr * 0.9 + sr_

fade = env_points([(0, 0), (0.15, 1), (28.6, 1), (30, 0)])
L, R = L * fade, R * fade
L, R = fft_filter(L, 35), fft_filter(R, 35)
peak = max(np.abs(L).max(), np.abs(R).max())
L, R = np.tanh(1.6 * L / peak) / np.tanh(1.6), np.tanh(1.6 * R / peak) / np.tanh(1.6)
L, R = L * 0.89, R * 0.89

out = sys.argv[1] if len(sys.argv) > 1 else "score.wav"
pcm = (np.stack([L, R], axis=1) * 32767).astype("<i2")
with wave.open(out, "wb") as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print("wrote", out)
