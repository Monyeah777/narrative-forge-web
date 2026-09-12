#!/usr/bin/env python3
"""One-shot blurred SSIM + ink histogram correlation for B4."""
from __future__ import annotations

import json
import math
import sys

from PIL import Image, ImageFilter


def luma(im: Image.Image) -> Image.Image:
    return im.convert("L")


def ssim_windows(a: Image.Image, b: Image.Image, win: int = 8, step: int = 4) -> float:
    pa = list(a.getdata())
    pb = list(b.getdata())
    w, h = a.size
    c1 = (0.01 * 255) ** 2
    c2 = (0.03 * 255) ** 2
    acc = 0.0
    n = 0
    y = 0
    while y + win <= h:
        x = 0
        while x + win <= w:
            sx = sy = sxx = syy = sxy = 0.0
            count = win * win
            for j in range(win):
                row = (y + j) * w + x
                for i in range(win):
                    va = pa[row + i]
                    vb = pb[row + i]
                    sx += va
                    sy += vb
                    sxx += va * va
                    syy += vb * vb
                    sxy += va * vb
            mx = sx / count
            my = sy / count
            vx = sxx / count - mx * mx
            vy = syy / count - my * my
            cxy = sxy / count - mx * my
            acc += ((2 * mx * my + c1) * (2 * cxy + c2)) / ((mx * mx + my * my + c1) * (vx + vy + c2))
            n += 1
            x += step
        y += step
    return acc / n if n else 0.0


def hist16(im: Image.Image) -> list[int]:
    hist = im.histogram()
    out = [0] * 48
    for ch in range(3):
        base = ch * 256
        for i in range(256):
            out[ch * 16 + (i >> 4)] += hist[base + i]
    return out


def pearson(a: list[int], b: list[int]) -> float:
    n = len(a)
    ma = sum(a) / n
    mb = sum(b) / n
    num = den_a = den_b = 0.0
    for i in range(n):
        da = a[i] - ma
        db = b[i] - mb
        num += da * db
        den_a += da * da
        den_b += db * db
    if den_a <= 0 or den_b <= 0:
        return 0.0
    return num / math.sqrt(den_a * den_b)


def ink_mask(im: Image.Image, void=(5, 5, 5), lim=18) -> Image.Image:
    px = im.load()
    w, h = im.size
    m = Image.new("L", (w, h), 0)
    mp = m.load()
    for y in range(h):
        for x in range(w):
            r, g, b = px[x, y][:3]
            if abs(r - void[0]) + abs(g - void[1]) + abs(b - void[2]) > lim:
                mp[x, y] = 255
    return m


def masked_mae(formed: Image.Image, src: Image.Image, mask: Image.Image) -> tuple[float, int]:
    fp = formed.load()
    sp = src.load()
    mp = mask.load()
    acc = 0.0
    n = 0
    w, h = formed.size
    for y in range(h):
        for x in range(w):
            if mp[x, y] < 128:
                continue
            fr, fg, fb = fp[x, y][:3]
            sr, sg, sb = sp[x, y][:3]
            acc += (abs(fr - sr) + abs(fg - sg) + abs(fb - sb)) / 3.0
            n += 1
    return (acc / n if n else 255.0, n)


def main() -> int:
    formed_path, src_path = sys.argv[1], sys.argv[2]
    formed = Image.open(formed_path).convert("RGB")
    src = Image.open(src_path).convert("RGB").resize(formed.size, Image.Resampling.LANCZOS)
    blur_f = formed.filter(ImageFilter.BoxBlur(4))
    blur_s = src.filter(ImageFilter.BoxBlur(4))
    ssim = ssim_windows(luma(blur_f), luma(blur_s))
    mask = ink_mask(formed)
    mae, ink_n = masked_mae(formed, src, mask)
    corr = pearson(hist16(formed), hist16(src))
    out = {
        "w": formed.size[0],
        "h": formed.size[1],
        "ssim_blur": round(ssim, 6),
        "ink_mae": round(mae, 3),
        "ink_n": ink_n,
        "hist_corr": round(corr, 6),
        "ink_frac": round(ink_n / (formed.size[0] * formed.size[1]), 6) if formed.size[0] else 0,
    }
    print(json.dumps(out))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
