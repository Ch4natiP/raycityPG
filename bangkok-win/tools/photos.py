#!/usr/bin/env python3
"""Turn generated photos into game textures.

  python3 tools/photos.py <folder with 1.webp ... 9.webp>

For each photo: crop to the useful part, make it tile without seams (cross-fade the edges),
tone it so the game's per-building tint still works, and for facades find the windows and
make a night map where about half of them are lit. Writes assets/<name>.jpg and
assets/photos.js (window.PHOTOS = { name: data URL }), which the build embeds in the page.
Missing photos are skipped: the game falls back to its drawn textures.
"""
import base64
import io
import json
import os
import random
import sys
from collections import deque

import numpy as np
from PIL import Image

SRC = sys.argv[1] if len(sys.argv) > 1 else 'photos'
OUT = os.path.join(os.path.dirname(__file__), '..', 'assets')
os.makedirs(OUT, exist_ok=True)
rng = random.Random(7)


def load(n):
    for ext in ('webp', 'png', 'jpg', 'jpeg'):
        p = os.path.join(SRC, f'{n}.{ext}')
        if os.path.exists(p):
            return np.asarray(Image.open(p).convert('RGB')).astype(np.float32) / 255
    return None


def seam_x(a, w):
    """Cross-fade the right edge into the left so the image repeats sideways without a seam."""
    t = np.linspace(0, 1, w)[None, :, None]
    out = a[:, :-w].copy()
    out[:, :w] = a[:, -w:] * (1 - t) + a[:, :w] * t
    return out


def seam_y(a, w):
    return np.transpose(seam_x(np.transpose(a, (1, 0, 2)), w), (1, 0, 2))


def lum(a):
    return a[..., 0] * 0.299 + a[..., 1] * 0.587 + a[..., 2] * 0.114


def tone(a, desat=0.0, mean=None, contrast=1.0):
    """Pull colour towards grey (so the building tint shows), soften contrast, set the average brightness."""
    l = lum(a)[..., None]
    a = a * (1 - desat) + l * desat
    if contrast != 1.0:
        m = a.mean(axis=(0, 1), keepdims=True)
        a = m + (a - m) * contrast
    if mean is not None:
        a = a * (mean / max(1e-3, lum(a).mean()))
    return np.clip(a, 0, 1)


LIT = [(1, .84, .6), (1, .89, .72), (1, .95, .84), (1, .81, .53), (.9, .93, 1), (.81, .88, 1), (.62, .76, 1)]


def night_windows(a, pct=30, amin=12, amax=1200, fill=0.45, p=0.5, res=128):
    """Dark glass areas of a facade become rooms; about `p` of them light up at night.
    Works on a small copy, where window grilles blur into solid dark panes."""
    small = np.asarray(Image.fromarray((a * 255).astype(np.uint8)).resize((res, res), Image.BOX)).astype(np.float32) / 255
    l = lum(small)
    m = l < np.percentile(l, pct)
    lab = np.zeros(m.shape, np.int32)
    out = np.zeros(small.shape, np.float32)
    k = 0
    for y in range(res):
        for x in range(res):
            if not m[y, x] or lab[y, x]:
                continue
            k += 1
            q = deque([(y, x)])
            lab[y, x] = k
            pix = []
            while q:
                cy, cx = q.popleft()
                pix.append((cy, cx))
                for ny, nx in ((cy + 1, cx), (cy - 1, cx), (cy, cx + 1), (cy, cx - 1)):
                    if 0 <= ny < res and 0 <= nx < res and m[ny, nx] and not lab[ny, nx]:
                        lab[ny, nx] = k
                        q.append((ny, nx))
            ys = [p_[0] for p_ in pix]
            xs = [p_[1] for p_ in pix]
            area = len(pix)
            box = (max(ys) - min(ys) + 1) * (max(xs) - min(xs) + 1)
            if not (amin <= area <= amax) or area / box < fill:
                continue
            r = rng.random()
            if r < p:
                c = LIT[rng.randrange(len(LIT))]
                v = 0.6 + rng.random() * 0.4
            elif r < p + 0.06:
                c, v = (0.25, 0.38, 0.75), 0.8  # a TV
            else:
                continue
            # light the whole pane (its bounding box), not the ragged dark blob
            out[min(ys):max(ys) + 1, min(xs):max(xs) + 1] = (c[0] * v, c[1] * v, c[2] * v)
    img = Image.fromarray((out * 255).astype(np.uint8)).resize((512, 512), Image.BILINEAR)
    return np.asarray(img).astype(np.float32) / 255


def save(name, a, size, q=82):
    im = Image.fromarray((np.clip(a, 0, 1) * 255).astype(np.uint8))
    if size:
        im = im.resize(size, Image.LANCZOS)
    path = os.path.join(OUT, f'{name}.jpg')
    im.save(path, 'JPEG', quality=q, optimize=True, progressive=True)
    return path


made = {}

# 1: old shophouse upper floors -> 'facade' (3 bays x 3 floors, about 12 m x 10 m)
a = load(1)
if a is not None:
    a = a[60:1020]                      # no sky
    a = seam_y(seam_x(a, 48), 40)
    made['facade'] = save('facade', tone(a, 0.55, 0.74, 0.8), (1024, 1024))
    made['facade_n'] = save('facade_n', night_windows(a, pct=28), None, 85)

# 2: glass curtain wall -> 'glass' (about 12 m x 14 m)
a = load(2)
if a is not None:
    a = seam_y(seam_x(a, 32), 32)
    made['glass'] = save('glass', tone(a, 0.35), (1024, 1024))
    # offices: lit floor by floor in blocks
    n = np.zeros((8, 8, 3), np.float32)
    for y in range(8):
        on = rng.random() < 0.7
        for x in range(8):
            if on and rng.random() < 0.5:
                c = LIT[rng.randrange(len(LIT))]
                b = 0.55 + rng.random() * 0.45
                n[y, x] = [v * b for v in c]
    nb = np.asarray(Image.fromarray((n * 255).astype(np.uint8)).resize((512, 512), Image.NEAREST)).astype(np.float32) / 255
    frame = np.asarray(Image.fromarray((a * 255).astype(np.uint8)).resize((512, 512))).astype(np.float32) / 255
    mull = (lum(frame) > 0.6)[..., None]  # aluminium mullions stay dark
    made['glass_n'] = save('glass_n', nb * (~mull), None, 85)

# 3: condominium -> 'condo' (3 bays x 6 floors, about 15 m x 18 m)
a = load(3)
if a is not None:
    a = seam_y(seam_x(a, 32), 24)
    made['condo'] = save('condo', tone(a, 0.3, 0.6), (1024, 1024))
    made['condo_n'] = save('condo_n', night_windows(a, pct=35, amin=10, fill=0.35, p=0.45), None, 85)

# 4: asphalt -> 'asphalt' (8 m)
a = load(4)
if a is not None:
    h = a.shape[0]
    x0 = (a.shape[1] - h) // 2
    a = seam_y(seam_x(a[:, x0:x0 + h], 40), 40)
    made['asphalt'] = save('asphalt', tone(a, 0.3, 0.36, 0.55), (512, 512))

# 5: pavement tiles -> 'pave' (the tile rows at the top of the photo, stacked; about 4 m)
a = load(5)
if a is not None:
    band = a[0:192]
    rows = [np.roll(band, k * 205, axis=1) for k in range(5)]
    a = seam_x(np.concatenate(rows, axis=0), 48)
    made['pave'] = save('pave', tone(a, 0.45, 0.6, 0.6), (512, 512))

# 6: weathered concrete -> 'concrete' (BTS pillars and deck)
a = load(6)
if a is not None:
    a = seam_y(seam_x(a, 40), 40)
    made['concrete'] = save('concrete', tone(a, 0.4, 0.62), (512, 512))

# 7: rolling shutter -> 'shutter'
a = load(7)
if a is not None:
    a = a[: int(a.shape[0] * 0.92)]  # no floor strip
    a = seam_x(a, 40)
    made['shutter'] = save('shutter', tone(a, 0.2), (512, 256))

# 8: grass -> 'grass'
a = load(8)
if a is not None:
    a = seam_y(seam_x(a, 40), 40)
    made['grass'] = save('grass', tone(a, 0.0), (512, 512))

# 9: key art for the start screen (not a texture)
a = load(9)
if a is not None:
    made['cover'] = save('cover', a, (1280, int(1280 * a.shape[0] / a.shape[1])), 78)

data = {}
for name, path in made.items():
    with open(path, 'rb') as f:
        data[name] = 'data:image/jpeg;base64,' + base64.b64encode(f.read()).decode()
with open(os.path.join(OUT, 'photos.js'), 'w') as f:
    f.write('// Generated by tools/photos.py: photo textures as data URLs (the build embeds this file).\n')
    f.write('window.PHOTOS = ' + json.dumps(data) + ';\n')
total = sum(len(v) for v in data.values())
print('made:', ', '.join(made), f'· photos.js {total / 1024:.0f} KB')
