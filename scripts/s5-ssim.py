#!/usr/bin/env python3
"""§5 / U11: 32×32 luma Pearson + brightness histogram correlation.

Also keeps B4 blur-SSIM / RGB hist so the trial report can show both.
One-shot only. Never call from rAF.
"""
from __future__ import annotations

import json
import math
import sys

from PIL import Image, ImageFilter


def luma(im: Image.Image) -> Image.Image:
    return im.convert("L")


def pixels(im: Image.Image) -> list[int]:
    flat = getattr(im, "get_flattened_data", None)
    if callable(flat):
        return list(flat())
    return list(im.getdata())


def pearson(a: list[float] | list[int], b: list[float] | list[int]) -> float:
    n = len(a)
    if n == 0 or n != len(b):
        return 0.0
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


def luma_hist32(im: Image.Image) -> list[int]:
    hist = luma(im).histogram()
    out = [0] * 32
    for i, n in enumerate(hist[:256]):
        out[i >> 3] += n
    return out


def corr32(formed: Image.Image, src: Image.Image) -> float:
    a = luma(formed).resize((32, 32), Image.Resampling.BOX)
    b = luma(src).resize((32, 32), Image.Resampling.BOX)
    return pearson(pixels(a), pixels(b))


def ssim_windows(a: Image.Image, b: Image.Image, win: int = 8, step: int = 4) -> float:
    pa = pixels(a)
    pb = pixels(b)
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


def main() -> int:
    formed_path, src_path = sys.argv[1], sys.argv[2]
    formed = Image.open(formed_path).convert("RGB")
    src = Image.open(src_path).convert("RGB").resize(formed.size, Image.Resampling.LANCZOS)
    blur_f = formed.filter(ImageFilter.BoxBlur(4))
    blur_s = src.filter(ImageFilter.BoxBlur(4))
    out = {
        "w": formed.size[0],
        "h": formed.size[1],
        "corr32": round(corr32(blur_f, blur_s), 6),
        "luma_hist_corr": round(pearson(luma_hist32(blur_f), luma_hist32(blur_s)), 6),
        "ssim_blur": round(ssim_windows(luma(blur_f), luma(blur_s)), 6),
        "hist_corr": round(pearson(luma_hist32(formed), luma_hist32(src)), 6),
    }
    print(json.dumps(out))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
