"""Музыка и звуки рекламного ролика «Железной короны».

Синтез на numpy без сэмплов: бой барабанов, медь, щипковые, гул; звуки ставятся по событиям,
которые записал promo/render.js (promo/out/events.json): склейки, клики по стройке, стычка,
бегство врага, пролом стен, взятие города.

    python3 promo/music.py            → promo/out/music.wav
"""
import json
import os
import wave

import numpy as np

SR = 48000
HERE = os.path.dirname(os.path.abspath(__file__))
OUT = os.path.join(HERE, 'out')
rng = np.random.default_rng(7)

ev = json.load(open(os.path.join(OUT, 'events.json')))
DUR = float(ev['duration'])
N = int(SR * DUR)
events = ev['events']


def times(kind):
    return [e['t'] for e in events if e['type'] == kind]


scene_t = {e['key']: e['t'] for e in events if e['type'] == 'scene'}
CLASH = (times('clash') or [16.5])[0]
ROUT = (times('rout') or [19.8])[0]
BREACH = (times('breach') or [22.6])[0]
CAPTURE = (times('capture') or [23.4])[0]

L = np.zeros(N)
R = np.zeros(N)


def add(sig, t, gain=1.0, pan=0.0):
    i = int(round(t * SR))
    if i >= N or i + len(sig) <= 0:
        return
    s = sig
    if i < 0:
        s = s[-i:]
        i = 0
    j = min(N, i + len(s))
    s = s[:j - i] * gain
    L[i:j] += s * np.sqrt((1 - pan) / 2) * 1.4142
    R[i:j] += s * np.sqrt((1 + pan) / 2) * 1.4142


def tt(dur):
    return np.arange(int(dur * SR)) / SR


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


NOTE = {'C': 0, 'D': 2, 'E': 4, 'F': 5, 'G': 7, 'A': 9, 'B': 11}


def m(name):
    """'D4', 'Bb3', 'F#5' → номер MIDI."""
    n = NOTE[name[0]]
    rest = name[1:]
    if rest.startswith('b'):
        n -= 1
        rest = rest[1:]
    elif rest.startswith('#'):
        n += 1
        rest = rest[1:]
    return 12 * (int(rest) + 1) + n


def spectral(x, fn):
    """Фильтр в частотной области: fn(частоты) → множитель."""
    n = len(x)
    size = 1 << (n - 1).bit_length()
    X = np.fft.rfft(x, size)
    f = np.fft.rfftfreq(size, 1 / SR)
    return np.fft.irfft(X * fn(f), size)[:n]


def lowpass(x, fc, order=2):
    return spectral(x, lambda f: 1 / np.sqrt(1 + (f / fc) ** (2 * order)))


def highpass(x, fc, order=2):
    return spectral(x, lambda f: 1 / np.sqrt(1 + (fc / np.maximum(f, 1e-3)) ** (2 * order)))


def env_adsr(n, a, d, s, r):
    e = np.ones(n) * s
    na, nd, nr = int(a * SR), int(d * SR), int(r * SR)
    na = max(1, min(na, n))
    e[:na] = np.linspace(0, 1, na)
    if nd > 0 and na + nd < n:
        e[na:na + nd] = np.linspace(1, s, nd)
    if nr > 0:
        nr = min(nr, n)
        e[n - nr:] *= np.linspace(1, 0, nr)
    return e


# ---------- инструменты ----------
def brass(f, dur, bright=1.0):
    t = tt(dur)
    n = len(t)
    env = env_adsr(n, 0.07, 0.25, 0.75, 0.18)
    vib = 1 + 0.004 * np.sin(2 * np.pi * 5.2 * t) * np.clip((t - 0.25) / 0.3, 0, 1)
    ph = 2 * np.pi * f * np.cumsum(vib) / SR
    out = np.zeros(n)
    for k in range(1, 14):
        if f * k > 9000:
            break
        w = (1 / k ** 1.05) * np.exp(-k / (1.2 + 7 * env * bright))
        out += w * np.sin(k * ph + k * 0.3)
    return out * env * 0.5


def pad(freqs, dur, att=0.6, rel=0.8):
    t = tt(dur)
    n = len(t)
    env = env_adsr(n, att, 0.0, 1.0, rel)
    out = np.zeros(n)
    for f in freqs:
        for det in (-0.004, 0.0, 0.0045):
            ff = f * (1 + det)
            ph0 = rng.uniform(0, 2 * np.pi)
            for k in range(1, 9):
                out += np.sin(2 * np.pi * ff * k * t + ph0 * k) / k ** 1.4 * (0.6 if k > 1 else 1)
    return out * env / (len(freqs) * 3) * 0.6


def taiko(f0=62, dur=1.1, hard=1.0):
    t = tt(dur)
    f = f0 * (1 + 1.2 * np.exp(-t * 28))
    ph = 2 * np.pi * np.cumsum(f) / SR
    body = np.sin(ph) * np.exp(-t * 4.2)
    skin = lowpass(rng.standard_normal(len(t)), 900) * np.exp(-t * 35) * 0.9 * hard
    return (body + skin) * 0.9


def tom(f0=150, dur=0.35):
    t = tt(dur)
    f = f0 * (1 + 0.6 * np.exp(-t * 40))
    ph = 2 * np.pi * np.cumsum(f) / SR
    return (np.sin(ph) * np.exp(-t * 11) + lowpass(rng.standard_normal(len(t)), 2500) * np.exp(-t * 60) * 0.5) * 0.6


def clang(f=1100, dur=0.9):
    t = tt(dur)
    out = np.zeros(len(t))
    for k, (r, d) in enumerate([(1, 6), (2.76, 9), (5.4, 14), (8.93, 20), (13.3, 28)]):
        out += np.sin(2 * np.pi * f * r * (1 + rng.uniform(-0.01, 0.01)) * t) * np.exp(-t * d) / (k + 1)
    hit = highpass(rng.standard_normal(len(t)), 2000) * np.exp(-t * 90) * 0.8
    return (out * 0.5 + hit) * 0.5


def boom(dur=2.4, f0=48):
    t = tt(dur)
    f = f0 * (1 + 1.6 * np.exp(-t * 12))
    sub = np.sin(2 * np.pi * np.cumsum(f) / SR) * np.exp(-t * 2.2)
    rumble = lowpass(rng.standard_normal(len(t)), 220) * np.exp(-t * 2.8) * 2.2
    crack = lowpass(rng.standard_normal(len(t)), 3500) * np.exp(-t * 30) * 0.7
    return (sub + rumble + crack) * 0.8


def whoosh(dur=0.6, peak=0.38):
    t = tt(dur)
    n = len(t)
    noise = rng.standard_normal(n)
    e = np.where(t < peak, (t / peak) ** 2, np.exp(-(t - peak) * 9))
    # тембр поднимается к пику
    lo = lowpass(noise, 700)
    hi = lowpass(noise, 3000)
    mixk = np.clip(t / peak, 0, 1)
    return (lo * (1 - mixk) + hi * mixk) * e * 0.35


def tock(dur=0.12):
    t = tt(dur)
    return (np.sin(2 * np.pi * 1250 * t) * np.exp(-t * 70) + highpass(rng.standard_normal(len(t)), 3000) * np.exp(-t * 160) * 0.5) * 0.35


def ding(f=1568, dur=1.2):
    t = tt(dur)
    out = np.zeros(len(t))
    for r, a, d in [(1, 1, 3.2), (2.01, 0.4, 5), (3.02, 0.25, 7), (4.17, 0.12, 9)]:
        out += a * np.sin(2 * np.pi * f * r * t) * np.exp(-t * d)
    return out * 0.18


def pluck(f, dur=0.6, bright=0.5):
    """Карплус — Стронг: щипковая струна."""
    n = int(dur * SR)
    p = max(2, int(SR / f))
    buf = lowpass(rng.uniform(-1, 1, p), 2000 + 6000 * bright)
    out = np.zeros(n)
    out[:p] = buf
    damp = 0.996
    for i in range(p, n):
        out[i] = damp * 0.5 * (out[i - p] + out[i - p + 1])
    return out * 0.5


def riser(dur):
    t = tt(dur)
    n = len(t)
    noise = rng.standard_normal(n)
    k = (t / dur) ** 2
    s = lowpass(noise, 600) * (1 - k) + lowpass(noise, 5000) * k
    tone = np.sin(2 * np.pi * np.cumsum(110 * 2 ** (2 * t / dur)) / SR)
    return (s * 0.4 + tone * 0.18) * k


# ---------- гармония ----------
BEAT = 0.6  # 100 ударов в минуту
CHORDS = [  # (начало, ноты)
    (0.0, ['D2', 'A2', 'D3', 'F3']),
    (3.6, ['D2', 'A2', 'D3', 'F3']),
    (7.0, ['Bb1', 'F2', 'Bb2', 'D3']),
    (9.1, ['F2', 'C3', 'F3', 'A3']),
    (11.2, ['C2', 'G2', 'C3', 'E3']),
    (13.1, ['A1', 'E2', 'A2', 'C#3']),
    (15.0, ['D2', 'A2', 'D3', 'F3']),
    (17.7, ['Bb1', 'F2', 'Bb2', 'D3']),
    (20.4, ['G1', 'D2', 'G2', 'Bb2']),
    (22.6, ['A1', 'E2', 'A2', 'C#3']),
    (23.4, ['D2', 'A2', 'D3', 'F#3']),
    (25.0, ['Bb1', 'F2', 'Bb2', 'D3']),
    (26.6, ['C2', 'G2', 'C3', 'E3']),
    (28.2, ['D2', 'A2', 'D3', 'F3', 'A3']),
]
for i, (t0, notes) in enumerate(CHORDS):
    t1 = CHORDS[i + 1][0] if i + 1 < len(CHORDS) else DUR
    if 27.9 <= t0 < 28.2:
        continue
    end = min(t1, 27.95) if t0 < 28.2 else t1
    dur = end - t0 + 0.9
    add(highpass(pad([hz(m(n)) for n in notes], dur, att=0.9 if i == 0 else 0.25, rel=0.9), 110), t0, 0.42 if t0 >= 28.2 else 0.3)

# гул в заставке
add(lowpass(rng.standard_normal(int(3.8 * SR)), 120) * env_adsr(int(3.8 * SR), 1.2, 0, 1, 1.0) * 0.8, 0.0, 0.3)


# ---------- барабаны ----------
def drum_bar(t0, intense=0):
    """Такт из четырёх долей."""
    add(taiko(58), t0, 0.9)
    add(tom(140), t0 + BEAT * 1.5, 0.45, -0.3)
    add(taiko(66, hard=0.7), t0 + BEAT * 2, 0.7)
    add(tom(170), t0 + BEAT * 3, 0.4, 0.3)
    add(tom(185), t0 + BEAT * 3.5, 0.35, 0.3)
    if intense:
        for k in range(8):
            add(tom(120 + 25 * (k % 3), 0.25), t0 + k * BEAT / 2 + BEAT / 4, 0.22 * intense, (-1) ** k * 0.4)


t = 3.6
while t < 27.8:
    intense = 1 if 15.0 <= t < 25.0 else 0
    drum_bar(t, intense)
    t += BEAT * 4
# ускорение перед финалом
k = 0
t = 26.6
while t < 27.85:
    add(tom(150 + k * 4, 0.2), t, 0.35 + 0.02 * k, (-1) ** k * 0.35)
    step = max(0.075, BEAT / 2 * (1 - (t - 26.6) / 1.6))
    t += step
    k += 1
add(riser(2.9), 25.05, 0.9)

# ---------- медь ----------
def phrase(t0, notes, gain=0.5, pan=0.0):
    t = t0
    for name, beats in notes:
        d = beats * BEAT
        if name:
            add(brass(hz(m(name)), d * 1.02 + 0.12), t, gain * 1.45, pan)
        t += d


phrase(1.0, [('D4', 0.5), ('A4', 1.5), ('G4', 0.5), ('F4', 0.5), ('E4', 1.0), ('D4', 1.4)], 0.42)
phrase(1.0, [('D3', 0.5), ('F3', 1.5), ('E3', 0.5), ('D3', 0.5), ('C#3', 1.0), ('D3', 1.4)], 0.22, -0.2)
phrase(ROUT + 0.05, [('A4', 0.35), ('D5', 1.2)], 0.36)
phrase(CAPTURE + 0.02, [('D4', 0.25), ('F#4', 0.25), ('A4', 0.25), ('D5', 1.6)], 0.4)
phrase(CAPTURE + 0.02, [('D3', 0.25), ('A3', 0.25), ('D4', 0.25), ('F#4', 1.6)], 0.2, 0.2)
phrase(28.45, [('F4', 0.5), ('G4', 0.5), ('A4', 1.5), ('C5', 0.5), ('D5', 2.6)], 0.44)
phrase(28.45, [('D4', 0.5), ('E4', 0.5), ('F4', 1.5), ('G4', 0.5), ('A4', 2.6)], 0.24, 0.25)

# ---------- щипковые: хозяйство и оборона ----------
ARP = {7.0: ['Bb3', 'D4', 'F4', 'D4'], 9.1: ['F3', 'A3', 'C4', 'A3'], 11.2: ['C4', 'E4', 'G4', 'E4'], 13.1: ['A3', 'C#4', 'E4', 'C#4']}
for t0, notes in ARP.items():
    t1 = t0 + 2.1 if t0 < 13 else 15.0
    k = 0
    t = t0 + 0.05
    while t < t1 - 0.05:
        add(pluck(hz(m(notes[k % 4]) + (12 if k % 8 >= 4 else 0)), 0.5), t, 0.75, -0.35 + 0.7 * (k % 2))
        t += BEAT / 2
        k += 1
# блеск букв в заставке
for i, n in enumerate(['D5', 'F5', 'A5', 'D6', 'F6']):
    add(pluck(hz(m(n)), 1.0, 0.9), 0.78 + i * 0.12, 0.28, -0.5 + i * 0.25)

# ---------- звуки событий ----------
add(boom(2.6), 0.66, 1.0)
add(boom(3.0, 44), 28.25, 1.1)
for key in ('world', 'eco', 'def', 'battle', 'siege', 'grow'):
    if key in scene_t:
        add(whoosh(), scene_t[key] + 0.02, 0.8, 0.2)
for cut in (7.0, 15.0, 20.4):
    add(taiko(52, 1.4), cut, 0.6)
for c in times('click'):
    add(tock(), c, 0.9)
# готово: стройка занимает около секунды после клика
for c in times('click'):
    sc = 'def' if c >= scene_t.get('def', 99) else 'eco'
    add(ding(1568 if sc == 'eco' else 1318), c + (0.92 if sc == 'eco' else 1.12), 0.9, 0.3)
# сражение: звон мечей от стычки до бегства
t = CLASH
add(clang(900), CLASH, 0.9, -0.2)
add(clang(1250), CLASH + 0.04, 0.7, 0.3)
while t < ROUT:
    add(clang(rng.uniform(800, 1500)), t, rng.uniform(0.25, 0.55), rng.uniform(-0.7, 0.7))
    t += rng.uniform(0.09, 0.26)
# осада: удары камней до пролома, пролом и взятие
t = scene_t.get('siege', 20.4) + 0.9
while t < BREACH - 0.1:
    add(taiko(44, 1.0, 1.2), t, 0.55, rng.uniform(-0.3, 0.3))
    t += 0.42
add(boom(2.2, 40), BREACH, 1.0)
add(clang(700, 1.4), BREACH + 0.03, 0.4)
add(boom(1.8, 52), CAPTURE, 0.7)

# ---------- реверберация и сведение ----------
def reverb(x, secs=1.9, mixk=0.22):
    n = int(secs * SR)
    t = np.arange(n) / SR
    ir = rng.standard_normal(n) * np.exp(-t * 3.4)
    ir = lowpass(ir, 4000)
    ir[:int(0.012 * SR)] = 0
    size = 1 << (len(x) + n).bit_length()
    y = np.fft.irfft(np.fft.rfft(x, size) * np.fft.rfft(ir, size), size)[:len(x)]
    y *= np.std(x) / (np.std(y) + 1e-9)
    return x + mixk * y


L = reverb(L)
R = reverb(R)
st = np.stack([L, R], 1)
def tilt(x):
    return spectral(x, lambda f: (1 / np.sqrt(1 + (28 / np.maximum(f, 1e-3)) ** 4)) * (0.5 + 0.5 * f / (f + 140)))


st = np.stack([tilt(st[:, 0]), tilt(st[:, 1])], 1)
st /= np.max(np.abs(st)) + 1e-9
st = np.tanh(st * 1.6) / np.tanh(1.6)
fade = int(0.8 * SR)
st[-fade:] *= np.linspace(1, 0, fade)[:, None]
st[:int(0.02 * SR)] *= np.linspace(0, 1, int(0.02 * SR))[:, None]
st *= 0.89

pcm = (st * 32767).astype('<i2')
with wave.open(os.path.join(OUT, 'music.wav'), 'wb') as w:
    w.setnchannels(2)
    w.setsampwidth(2)
    w.setframerate(SR)
    w.writeframes(pcm.tobytes())
print('music.wav', round(DUR, 2), 'с')
