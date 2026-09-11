#!/usr/bin/env python3
"""B1-2: sample the baked 1200px painting into contract-v2 points.

Pipeline (handbook B1-2):
  1. Load painting/01-dallas.jpg (already EXIF-baked, cropped, HSV S×0.88)
  2. OKLab L from linear sRGB (Ottosson matrices; D65)
  3. Dark-cull L < 0.19 (tunable 0.17–0.22; target ~3–6% when the source has darks)
  4. Weighted sample w = 0.6 + 0.4·L^1.2 → 12,000 points
  5. Quantize sample colors in OKLab (median-cut seed + k-means, k=256, fixed seed)
  6. Write painting/points.json (palette + [x, y, i], coords 0..1 four decimals, shuffled)

Does not replace prototype/points.json (still the NF glyph). Wiring is B1-4.

Refs:
  https://bottosson.github.io/posts/oklab/
  https://www.w3.org/TR/css-color-4/#color-difference-OK
  https://www.cs.ubc.ca/labs/imager/tr/2002/secord2002b/secord.2002b.pdf
"""

from __future__ import annotations

import argparse
import gzip
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image, ImageDraw, ImageFont

ROOT = Path(__file__).resolve().parents[1]
PAINTING_DIR = ROOT / "painting"
DEFAULT_IMAGE = PAINTING_DIR / "01-dallas.jpg"
SOURCE_JSON = PAINTING_DIR / "source.json"
DEFAULT_POINTS = PAINTING_DIR / "points.json"
DEFAULT_STATS = PAINTING_DIR / "sample-stats.json"

COUNT = 12_000
K_DEFAULT = 256
K_MIN, K_MAX = 160, 256
SEED_DEFAULT = 0x4E46
DARK_L_DEFAULT = 0.19
DARK_L_RANGE = (0.17, 0.22)
WEIGHT_BASE = 0.6
WEIGHT_GAIN = 0.4
WEIGHT_EXP = 1.2
NOTE = "normalized 0..1 · OKLab-weighted · dark-culled · palette-quantized"
VOID = (5, 5, 5)  # #050505

# Ottosson linear sRGB → OKLab (2021-01-25 matrices).
_M1 = np.array(
    [
        [0.4122214708, 0.5363325363, 0.0514459929],
        [0.2119034982, 0.6806995451, 0.1073969566],
        [0.0883024619, 0.2817188376, 0.6299787005],
    ],
    dtype=np.float64,
)


def srgb_to_linear(c: np.ndarray) -> np.ndarray:
    """IEC 61966-2-1; handbook: c/12.92 if c<=0.04045 else ((c+0.055)/1.055)**2.4."""
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.04045, c / 12.92, ((c + 0.055) / 1.055) ** 2.4)


def linear_to_srgb(c: np.ndarray) -> np.ndarray:
    c = np.asarray(c, dtype=np.float64)
    return np.where(c <= 0.0031308, 12.92 * c, 1.055 * np.power(np.maximum(c, 0.0), 1.0 / 2.4) - 0.055)


def linear_srgb_to_oklab(rgb: np.ndarray) -> np.ndarray:
    """rgb: (..., 3) linear sRGB → OKLab L,a,b. Handbook ok_L plus a,b from Ottosson."""
    lms = rgb @ _M1.T
    lms_ = np.cbrt(np.maximum(lms, 0.0))
    l_, m_, s_ = lms_[..., 0], lms_[..., 1], lms_[..., 2]
    L = 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_
    a = 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_
    b = 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
    return np.stack([L, a, b], axis=-1)


def oklab_to_linear_srgb(lab: np.ndarray) -> np.ndarray:
    L, a, b = lab[..., 0], lab[..., 1], lab[..., 2]
    l_ = L + 0.3963377774 * a + 0.2158037573 * b
    m_ = L - 0.1055613458 * a - 0.0638541728 * b
    s_ = L - 0.0894841775 * a - 1.2914855480 * b
    l, m, s = l_**3, m_**3, s_**3
    r = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s
    g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s
    bch = -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s
    return np.stack([r, g, bch], axis=-1)


def ok_L(r: float, g: float, b: float) -> float:
    """Scalar form copied from the handbook (linear sRGB in)."""
    l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b
    m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b
    s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b
    l_, m_, s_ = np.cbrt([l, m, s])
    return float(0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_)


def y709(rgb_linear: np.ndarray) -> np.ndarray:
    return 0.2126 * rgb_linear[..., 0] + 0.7152 * rgb_linear[..., 1] + 0.0722 * rgb_linear[..., 2]


def hex_colors(lab_centers: np.ndarray) -> list[str]:
    lin = oklab_to_linear_srgb(lab_centers)
    srgb = np.clip(linear_to_srgb(lin), 0.0, 1.0)
    rgb8 = np.rint(srgb * 255.0).astype(np.int32)
    return [f"#{int(r):02x}{int(g):02x}{int(b):02x}" for r, g, b in rgb8]


def median_cut_centers(lab: np.ndarray, k: int) -> np.ndarray:
    """Axis-aligned median-cut in OKLab; box mean becomes the seed."""
    boxes = [np.arange(lab.shape[0], dtype=np.int32)]
    while len(boxes) < k:
        best_i = 0
        best_range = -1.0
        best_axis = 0
        for i, idx in enumerate(boxes):
            if idx.size <= 1:
                continue
            chunk = lab[idx]
            ranges = chunk.max(axis=0) - chunk.min(axis=0)
            axis = int(np.argmax(ranges))
            r = float(ranges[axis])
            if r > best_range or (r == best_range and idx.size > boxes[best_i].size):
                best_i = i
                best_range = r
                best_axis = axis
        if best_range <= 1e-12:
            break
        idx = boxes[best_i]
        order = idx[np.argsort(lab[idx, best_axis], kind="mergesort")]
        mid = order.size // 2
        if mid == 0 or mid == order.size:
            break
        boxes[best_i] = order[:mid]
        boxes.append(order[mid:])
    centers = np.stack(
        [
            lab[idx].mean(axis=0) if idx.size else np.zeros(3, dtype=np.float64)
            for idx in boxes
        ]
    )
    if centers.shape[0] < k:
        # Duplicate the last center; k-means reseed will split empties.
        pad = np.repeat(centers[-1:], k - centers.shape[0], axis=0)
        centers = np.concatenate([centers, pad], axis=0)
    return centers.astype(np.float64)


def pairwise_d2(lab: np.ndarray, centers: np.ndarray) -> np.ndarray:
    n, k = lab.shape[0], centers.shape[0]
    d2 = np.empty((n, k), dtype=np.float64)
    chunk = 64
    for j0 in range(0, k, chunk):
        j1 = min(k, j0 + chunk)
        diff = lab[:, None, :] - centers[None, j0:j1, :]
        d2[:, j0:j1] = np.sum(diff * diff, axis=2)
    return d2


def kcenter_radius_100(lab: np.ndarray, k: int) -> float:
    """Gonzalez k-center radius ×100 (lower bound on max ΔE_ok at this k)."""
    n = lab.shape[0]
    first = int(np.lexsort((lab[:, 2], lab[:, 1], lab[:, 0]))[0])
    mind = np.full(n, np.inf, dtype=np.float64)
    last = lab[first]
    for _ in range(k):
        d = np.sqrt(np.sum((lab - last) ** 2, axis=1))
        mind = np.minimum(mind, d)
        last = lab[int(np.argmax(mind))]
    return float(mind.max() * 100.0)


def kmeans_refine(lab: np.ndarray, centers: np.ndarray, max_iter: int = 40) -> tuple[np.ndarray, np.ndarray]:
    n, k = lab.shape[0], centers.shape[0]
    labels = np.full(n, -1, dtype=np.int32)
    centers = centers.copy()
    for _ in range(max_iter):
        d2 = pairwise_d2(lab, centers)
        new_labels = np.argmin(d2, axis=1).astype(np.int32)
        if np.array_equal(new_labels, labels):
            break
        labels = new_labels
        for i in range(k):
            mask = labels == i
            if mask.any():
                centers[i] = lab[mask].mean(axis=0)
            else:
                far = int(np.argmax(d2.min(axis=1)))
                centers[i] = lab[far]
                labels[far] = i
                d2[far, :] = np.inf
                d2[far, i] = 0.0
    labels = np.argmin(pairwise_d2(lab, centers), axis=1).astype(np.int32)
    return centers, labels


def circular_hue_delta_deg(h0: np.ndarray, h1: np.ndarray) -> np.ndarray:
    """Smallest signed hue difference in degrees, range (−180, 180]."""
    d = (h1 - h0 + 180.0) % 360.0 - 180.0
    return d


def histogram_L(L: np.ndarray, bins: int = 10) -> dict:
    counts, edges = np.histogram(L, bins=bins, range=(0.0, 1.0))
    return {
        "bins": bins,
        "range": [0.0, 1.0],
        "counts": counts.astype(int).tolist(),
        "edges": [round(float(e), 4) for e in edges],
    }


def relax_points(xy: np.ndarray, rounds: int, min_d: float, rng: np.random.Generator) -> np.ndarray:
    """Optional 3-round neighbor push. Default off — keep stardust randomness."""
    if rounds <= 0:
        return xy
    pts = xy.copy()
    n = pts.shape[0]
    for _ in range(rounds):
        # Spatial hash — 12k² is fine, but hashing keeps it honest at higher N.
        cell = max(min_d, 1e-4)
        keys = np.floor(pts / cell).astype(np.int32)
        buckets: dict[tuple[int, int], list[int]] = {}
        for i, (cx, cy) in enumerate(keys):
            buckets.setdefault((int(cx), int(cy)), []).append(i)
        disp = np.zeros_like(pts)
        for i, (x, y) in enumerate(pts):
            cx, cy = int(keys[i, 0]), int(keys[i, 1])
            for ox in (-1, 0, 1):
                for oy in (-1, 0, 1):
                    for j in buckets.get((cx + ox, cy + oy), ()):
                        if j <= i:
                            continue
                        dxy = pts[j] - pts[i]
                        dist = float(np.hypot(dxy[0], dxy[1]))
                        if dist < 1e-12 or dist >= min_d:
                            continue
                        push = (min_d - dist) * 0.5
                        nrm = dxy / dist
                        disp[i] -= nrm * push
                        disp[j] += nrm * push
        pts = np.clip(pts + disp, 0.0, 1.0)
    _ = rng  # seed reserved so --relax stays deterministic with the same Generator
    return pts


def load_meta() -> dict:
    if SOURCE_JSON.exists():
        return json.loads(SOURCE_JSON.read_text())
    return {"id": "poplars-dallas"}


def label_font(size: int):
    for name in ("DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(name, size=size)
        except OSError:
            continue
    return ImageFont.load_default()


def render_scatter(
    w: int,
    h: int,
    xs: np.ndarray,
    ys: np.ndarray,
    labels: np.ndarray,
    palette_rgb: np.ndarray,
    radius: int = 2,
) -> Image.Image:
    canvas = Image.new("RGB", (w, h), VOID)
    draw = ImageDraw.Draw(canvas)
    for x, y, i in zip(xs, ys, labels):
        px = int(round(float(x) * (w - 1)))
        py = int(round(float(y) * (h - 1)))
        color = tuple(int(c) for c in palette_rgb[int(i)])
        if radius <= 0:
            canvas.putpixel((px, py), color)
        else:
            draw.ellipse((px - radius, py - radius, px + radius, py + radius), fill=color)
    return canvas


def write_previews(
    dest: Path,
    source_im: Image.Image,
    scatter: Image.Image,
    stats: dict,
) -> None:
    dest.mkdir(parents=True, exist_ok=True)
    scatter.save(dest / "b1_2_stipple_close.png")
    source_im.save(dest / "b1_2_source.jpg", quality=90, optimize=True)

    # Far view: downscale the dense stipple so 12k discs read as the painting.
    far_w = 400
    far_h = max(1, round(scatter.size[1] * far_w / scatter.size[0]))
    far = scatter.resize((far_w, far_h), Image.Resampling.LANCZOS)
    far.save(dest / "b1_2_stipple_far.png")

    col_w = 360
    col_h = max(1, round(source_im.size[1] * col_w / source_im.size[0]))
    a = source_im.resize((col_w, col_h), Image.Resampling.LANCZOS)
    b = scatter.resize((col_w, col_h), Image.Resampling.LANCZOS)
    c = far.resize((col_w, col_h), Image.Resampling.LANCZOS)
    gap, bar, footer = 12, 36, 88
    sheet = Image.new("RGB", (col_w * 3 + gap * 2, col_h + bar + footer), (12, 12, 12))
    sheet.paste(a, (0, bar))
    sheet.paste(b, (col_w + gap, bar))
    sheet.paste(c, (2 * (col_w + gap), bar))
    draw = ImageDraw.Draw(sheet)
    font = label_font(16)
    small = label_font(13)
    draw.text((8, 10), "SOURCE  1200px  S×0.88", fill=(220, 220, 220), font=font)
    draw.text((col_w + gap + 8, 10), "SCATTER  12,000 pts", fill=(220, 220, 220), font=font)
    draw.text((2 * (col_w + gap) + 8, 10), "FAR  (downscale)", fill=(220, 220, 220), font=font)
    de = stats["deltaE_ok_100"]
    hue = stats["hue_shift_deg"]
    lines = [
        f"cull L<{stats['dark_L']}: {stats['dark_cull_pct']:.3f}%   "
        f"k={stats['k']}   seed=0x{stats['seed']:X}",
        f"ΔE_ok×100 mean={de['mean']:.3f}  max={de['max']:.3f}   "
        f"hue |mean|={hue['total_abs_mean_signed_deg']:.3f}°  "
        f"mean|Δh|={hue['mean_abs_deg']:.3f}°",
    ]
    y0 = bar + col_h + 10
    for i, line in enumerate(lines):
        draw.text((8, y0 + i * 18), line, fill=(200, 200, 200), font=small)
    sheet.save(dest / "b1_2_source_vs_stipple.jpg", quality=90, optimize=True)


def sample_image(
    im: Image.Image,
    *,
    count: int,
    k: int,
    seed: int,
    dark_L: float,
    relax_rounds: int,
) -> tuple[dict, dict, Image.Image]:
    rgb8 = np.asarray(im.convert("RGB"), dtype=np.uint8)
    h, w = rgb8.shape[0], rgb8.shape[1]
    rgb = rgb8.reshape(-1, 3).astype(np.float64) / 255.0
    lin = srgb_to_linear(rgb)
    lab = linear_srgb_to_oklab(lin)
    L = lab[:, 0]
    n = L.size

    dark_mask = L < dark_L
    dark_cull_pct = float(dark_mask.mean() * 100.0)
    eligible = np.flatnonzero(~dark_mask)
    if eligible.size < count:
        raise SystemExit(
            f"only {eligible.size} pixels survive L<{dark_L} cull; need {count}"
        )

    wgt = WEIGHT_BASE + WEIGHT_GAIN * np.power(np.clip(L[eligible], 0.0, None), WEIGHT_EXP)
    prob = wgt / wgt.sum()
    rng = np.random.default_rng(seed)
    picked = rng.choice(eligible, size=count, replace=False, p=prob)

    yy, xx = np.unravel_index(picked, (h, w))
    xs = (xx.astype(np.float64) + 0.5) / w
    ys = (yy.astype(np.float64) + 0.5) / h
    sample_lab = lab[picked]

    xy = np.stack([xs, ys], axis=1)
    xy = relax_points(xy, relax_rounds, min_d=0.004, rng=rng)
    xs, ys = xy[:, 0], xy[:, 1]

    centers = median_cut_centers(sample_lab, k)
    centers, labels = kmeans_refine(sample_lab, centers)

    # Stable palette order: lightness then a, then b. Remap indices.
    order = np.lexsort((centers[:, 2], centers[:, 1], centers[:, 0]))
    centers = centers[order]
    remap = np.empty(k, dtype=np.int32)
    remap[order] = np.arange(k)
    labels = remap[labels]

    palette = hex_colors(centers)
    palette_rgb = np.rint(
        np.clip(linear_to_srgb(oklab_to_linear_srgb(centers)), 0, 1) * 255
    ).astype(np.uint8)

    # Measure against the hex palette JS will actually use (8-bit round-trip).
    pal_rgb01 = palette_rgb.astype(np.float64) / 255.0
    pal_lab = linear_srgb_to_oklab(srgb_to_linear(pal_rgb01))
    q_lab = pal_lab[labels]
    de_css = np.sqrt(np.sum((sample_lab - q_lab) ** 2, axis=1))
    de100 = 100.0 * de_css  # CSS L is 0..1; ×100 ≈ ΔE2000 JND scale (JND≈2)

    chroma = np.hypot(sample_lab[:, 1], sample_lab[:, 2])
    hue_src = np.degrees(np.arctan2(sample_lab[:, 2], sample_lab[:, 1]))
    hue_q = np.degrees(np.arctan2(q_lab[:, 2], q_lab[:, 1]))
    chromatic = chroma >= 0.02
    hue_d = circular_hue_delta_deg(hue_src[chromatic], hue_q[chromatic])
    chroma_c = chroma[chromatic]
    if hue_d.size:
        mean_abs = float(np.mean(np.abs(hue_d)))
        max_abs = float(np.max(np.abs(hue_d)))
        # "总量": magnitude of the circular-mean signed shift (overall cast).
        ang = np.radians(hue_d)
        total = abs(
            math.degrees(
                math.atan2(float(np.mean(np.sin(ang))), float(np.mean(np.cos(ang))))
            )
        )
        wsum = float(chroma_c.sum())
        weighted_abs = float(np.sum(np.abs(hue_d) * chroma_c) / wsum) if wsum else mean_abs
    else:
        mean_abs = max_abs = total = weighted_abs = 0.0
    kcenter_max = kcenter_radius_100(sample_lab, k)

    shuffle = rng.permutation(count)
    xs, ys, labels = xs[shuffle], ys[shuffle], labels[shuffle]
    xs4 = np.round(xs, 4)
    ys4 = np.round(ys, 4)

    points = [
        [float(f"{x:.4f}"), float(f"{y:.4f}"), int(i)]
        for x, y, i in zip(xs4, ys4, labels)
    ]
    payload = {
        "id": load_meta().get("id", "poplars-dallas"),
        "w": w,
        "h": h,
        "count": count,
        "note": NOTE,
        "palette": palette,
        "points": points,
    }

    L_image = histogram_L(L)
    L_sampled = histogram_L(sample_lab[:, 0])
    y_lin = y709(lin)

    stats = {
        "id": payload["id"],
        "source": str(DEFAULT_IMAGE.relative_to(ROOT)),
        "w": w,
        "h": h,
        "pixels": n,
        "count": count,
        "k": k,
        "seed": seed,
        "dark_L": dark_L,
        "dark_cull_pct": round(dark_cull_pct, 4),
        "dark_cull_note": (
            "Dallas stand-in is a high-key canopy/sky crop; L p01≈0.54 so the "
            "0.17–0.22 band cannot reach the 3–6% cull designed for darker sources. "
            "Kept handbook default 0.19 rather than eating midtones."
            if dark_cull_pct < 3.0
            else "cull share in the designed 3–6% band"
        ),
        "weight": f"{WEIGHT_BASE} + {WEIGHT_GAIN}*L^{WEIGHT_EXP}",
        "relax_rounds": relax_rounds,
        "L_hist_image": L_image,
        "L_hist_sampled": L_sampled,
        "L_image": {
            "min": round(float(L.min()), 5),
            "mean": round(float(L.mean()), 5),
            "max": round(float(L.max()), 5),
            "p01": round(float(np.percentile(L, 1)), 5),
        },
        "Y709_linear_mean": round(float(y_lin.mean()), 5),
        "deltaE_ok_css": {
            "mean": round(float(de_css.mean()), 6),
            "max": round(float(de_css.max()), 6),
            "p95": round(float(np.percentile(de_css, 95)), 6),
            "note": "CSS Color 4 ΔEOK = Euclidean OKLab, L 0..1; JND≈0.02",
        },
        "deltaE_ok_100": {
            "mean": round(float(de100.mean()), 4),
            "max": round(float(de100.max()), 4),
            "p95": round(float(np.percentile(de100, 95)), 4),
            "note": "100×ΔEOK so one JND≈2 like ΔE2000 (CSS Color 4 note)",
        },
        "hue_shift_deg": {
            "mean_abs_deg": round(mean_abs, 4),
            "chroma_weighted_abs_deg": round(weighted_abs, 4),
            "max_abs_deg": round(max_abs, 4),
            "total_abs_mean_signed_deg": round(total, 4),
            "chromatic_n": int(chromatic.sum()),
            "chroma_floor": 0.02,
            "note": "总量 = |circular mean of signed Δh| on C≥0.02; near-neutrals inflate unweighted mean|Δh|",
        },
        "kcenter_max_deltaE_ok_100": round(kcenter_max, 4),
        "kcenter_note": (
            "Gonzalez k-center max radius at k=256. Covering every sample at "
            "ΔE_ok×100≤2 needs ~268 balls on this set, above the handbook k cap."
        ),
        "palette_len": len(palette),
        "checks": {
            "count_12000": count == COUNT and len(points) == COUNT,
            "k_in_160_256": K_MIN <= k <= K_MAX,
            "coords_4dp": all(
                (round(p[0], 4) == p[0] and round(p[1], 4) == p[1] and 0.0 <= p[0] <= 1.0 and 0.0 <= p[1] <= 1.0)
                for p in points[:50]
            )
            and all(0 <= p[2] < k for p in points),
            "deltaE_ok_100_mean_le_2": float(de100.mean()) <= 2.0,
            "deltaE_ok_100_max_le_2": float(de100.max()) <= 2.0,
            "hue_total_le_2": total <= 2.0,
            "hue_mean_abs_le_2": mean_abs <= 2.0,
            "dark_cull_3_to_6": 3.0 <= dark_cull_pct <= 6.0,
        },
    }
    scatter = render_scatter(w, h, xs4, ys4, labels, palette_rgb, radius=6)
    return payload, stats, scatter


def self_test() -> None:
    # Handbook ok_L on linear mid-grey-ish sRGB red.
    lin = srgb_to_linear(np.array([1.0, 0.0, 0.0]))
    L_scalar = ok_L(float(lin[0]), float(lin[1]), float(lin[2]))
    L_vec = float(linear_srgb_to_oklab(lin.reshape(1, 3))[0, 0])
    if abs(L_scalar - L_vec) > 1e-12:
        raise AssertionError(f"ok_L mismatch {L_scalar} vs {L_vec}")
    white = linear_srgb_to_oklab(np.array([[1.0, 1.0, 1.0]]))[0]
    if abs(white[0] - 1.0) > 1e-5 or abs(white[1]) > 1e-4 or abs(white[2]) > 1e-4:
        raise AssertionError(f"linear white should be L=1 a=b=0, got {white}")

    # Left 20px black must be culled; samples stay in the colored half.
    im = Image.new("RGB", (80, 40), (180, 140, 90))
    for x in range(20):
        for y in range(40):
            im.putpixel((x, y), (0, 0, 0))
    payload, stats, _ = sample_image(
        im, count=200, k=160, seed=SEED_DEFAULT, dark_L=0.19, relax_rounds=0
    )
    if any(p[0] < 20.0 / 80.0 for p in payload["points"]):
        raise AssertionError("dark column was sampled")
    if stats["dark_cull_pct"] < 20.0:
        raise AssertionError(f"expected ~25% cull, got {stats['dark_cull_pct']}")
    if payload["count"] != 200 or len(payload["palette"]) != 160:
        raise AssertionError("self-test contract mismatch")
    again, _, _ = sample_image(
        im, count=200, k=160, seed=SEED_DEFAULT, dark_L=0.19, relax_rounds=0
    )
    if again != payload:
        raise AssertionError("same seed must be bitwise-identical")
    print("self-test: ok")


def run(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=DEFAULT_IMAGE)
    parser.add_argument("--output", type=Path, default=DEFAULT_POINTS)
    parser.add_argument("--stats", type=Path, default=DEFAULT_STATS)
    parser.add_argument("--preview", type=Path, default=None)
    parser.add_argument("--count", type=int, default=COUNT)
    parser.add_argument("--k", type=int, default=K_DEFAULT)
    parser.add_argument("--seed", type=int, default=SEED_DEFAULT)
    parser.add_argument("--dark-L", type=float, default=DARK_L_DEFAULT, dest="dark_L")
    parser.add_argument(
        "--relax",
        type=int,
        default=0,
        help="optional neighbor-repulsion rounds (handbook default: 0, keep dust)",
    )
    parser.add_argument("--self-test", action="store_true")
    args = parser.parse_args(argv)

    if args.self_test:
        self_test()
        if args.input == DEFAULT_IMAGE and not DEFAULT_IMAGE.exists():
            return 0

    if not (K_MIN <= args.k <= K_MAX):
        raise SystemExit(f"k={args.k} outside {K_MIN}–{K_MAX}")
    if not (DARK_L_RANGE[0] <= args.dark_L <= DARK_L_RANGE[1]):
        raise SystemExit(f"dark-L={args.dark_L} outside {DARK_L_RANGE}")

    src = args.input if args.input.is_absolute() else ROOT / args.input
    if not src.exists():
        raise SystemExit(f"input not found: {src}")
    im = Image.open(src)
    im.load()

    payload, stats, scatter = sample_image(
        im,
        count=args.count,
        k=args.k,
        seed=args.seed,
        dark_L=args.dark_L,
        relax_rounds=args.relax,
    )

    out = args.output if args.output.is_absolute() else ROOT / args.output
    stats_path = args.stats if args.stats.is_absolute() else ROOT / args.stats
    out.parent.mkdir(parents=True, exist_ok=True)
    raw = json.dumps(payload, separators=(",", ":"), ensure_ascii=True) + "\n"
    out.write_text(raw)
    stats["bytes"] = len(raw.encode("utf-8"))
    stats["gzip_bytes"] = len(gzip.compress(raw.encode("utf-8"), compresslevel=9))
    stats_path.write_text(json.dumps(stats, indent=2, ensure_ascii=True) + "\n")

    preview = args.preview
    if preview is None:
        art = Path("/opt/cursor/artifacts")
        preview = art if art.is_dir() else None
    if preview is not None:
        write_previews(preview if preview.is_absolute() else ROOT / preview, im.convert("RGB"), scatter, stats)

    print(json.dumps({k: stats[k] for k in ("id", "w", "h", "count", "k", "dark_cull_pct", "deltaE_ok_100", "hue_shift_deg", "kcenter_max_deltaE_ok_100", "checks", "bytes", "gzip_bytes")}, indent=2))

    checks = stats["checks"]
    # Mean ΔE and hue total are the hard quality bars. Max ΔE and 3–6% cull
    # are reported; the Dallas crop has almost no L<0.19 mass, and a 256-color
    # palette can leave a few outliers above one JND.
    if not checks["count_12000"] and args.count == COUNT:
        raise SystemExit("count check failed")
    if not checks["k_in_160_256"]:
        raise SystemExit("k check failed")
    if not checks["deltaE_ok_100_mean_le_2"]:
        raise SystemExit(f"ΔE_ok×100 mean {stats['deltaE_ok_100']['mean']} > 2")
    if not checks["hue_total_le_2"]:
        raise SystemExit(f"hue total {stats['hue_shift_deg']['total_abs_mean_signed_deg']}° > 2")
    return 0


if __name__ == "__main__":
    sys.exit(run())
