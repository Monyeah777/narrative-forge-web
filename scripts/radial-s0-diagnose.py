#!/usr/bin/env python3
"""S0 diagnosis only. Reads current bins / JSON. Does not resample or write points."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from nf_points_bin import HEADER_BYTES, parse_header  # noqa: E402

BANDS = ((0.0, 0.3), (0.3, 0.6), (0.6, 0.85), (0.85, 1.0))
DARK_L = 0.19
HOLE_CELL = 16
W0 = 1.0
W1 = 0.2 + 0.8 * math.exp(-2.5)  # ≈0.266
DESIGN_RATIO = W0 / W1


def load_sampler():
    spec = importlib.util.spec_from_file_location(
        "sample_painting", ROOT / "scripts/sample-painting.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def eligible_field(im: Image.Image, sampler) -> dict:
    rgb8 = np.asarray(im.convert("RGB"), dtype=np.uint8)
    h, w = rgb8.shape[0], rgb8.shape[1]
    rgb = rgb8.reshape(-1, 3).astype(np.float64) / 255.0
    lin = sampler.srgb_to_linear(rgb)
    lab = sampler.linear_srgb_to_oklab(lin)
    L = lab[:, 0]
    dark = L < DARK_L
    eligible = ~dark
    yy, xx = np.divmod(np.flatnonzero(eligible), w)
    xs = (xx.astype(np.float64) + 0.5) / w
    ys = (yy.astype(np.float64) + 0.5) / h
    cx = float(xs.mean())
    cy = float(ys.mean())
    dist = np.hypot(xs - cx, ys - cy)
    r95 = float(np.percentile(dist, 95))
    if r95 <= 1e-12:
        raise SystemExit("R95 collapsed")
    r = np.clip(dist / r95, 0.0, 1.0)
    return {
        "w": w,
        "h": h,
        "cx": cx,
        "cy": cy,
        "R95": r95,
        "eligible_n": int(eligible.sum()),
        "dark_cull_pct": round(float(dark.mean() * 100.0), 4),
        "eligible_mask": eligible.reshape(h, w),
        "eligible_r": r,
    }


def band_counts(r: np.ndarray) -> list[int]:
    out = []
    for i, (a, b) in enumerate(BANDS):
        if i == len(BANDS) - 1:
            out.append(int(((r >= a) & (r <= b)).sum()))
        else:
            out.append(int(((r >= a) & (r < b)).sum()))
    return out


def radial_profile(point_r: np.ndarray, field_r: np.ndarray) -> dict:
    n_pts = band_counts(point_r)
    n_area = band_counts(field_r)
    dens = []
    for p, a in zip(n_pts, n_area):
        dens.append(None if a == 0 else p / a)
    center = dens[0]
    edge = dens[-1]
    ratio = None if (center is None or edge in (None, 0)) else center / edge
    return {
        "bands": [f"{a}-{b}" for a, b in BANDS],
        "points": n_pts,
        "eligible_px": n_area,
        "density_pts_per_eligible_px": [
            None if d is None else round(d, 8) for d in dens
        ],
        "center_over_edge": None if ratio is None else round(ratio, 4),
        "design_W0_over_W1": round(DESIGN_RATIO, 4),
        "pass_ge_2x": bool(ratio is not None and ratio >= 2.0),
    }


def nn_stats(xs: np.ndarray, ys: np.ndarray, w: int, h: int) -> dict:
    """Approximate 1-NN via spatial hash. Distances in painting pixels."""
    n = int(xs.size)
    px = xs * w
    py = ys * h
    area = float(w * h)
    cell = max(math.sqrt(area / n) * 0.45, 1.0)
    gx = np.floor(px / cell).astype(np.int32)
    gy = np.floor(py / cell).astype(np.int32)
    buckets: dict[tuple[int, int], list[int]] = {}
    for i in range(n):
        buckets.setdefault((int(gx[i]), int(gy[i])), []).append(i)
    best = np.full(n, 1e18, dtype=np.float64)
    for i in range(n):
        cx, cy = int(gx[i]), int(gy[i])
        for ox in range(-2, 3):
            for oy in range(-2, 3):
                for j in buckets.get((cx + ox, cy + oy), ()):
                    if j == i:
                        continue
                    d2 = (px[i] - px[j]) ** 2 + (py[i] - py[j]) ** 2
                    if d2 < best[i]:
                        best[i] = d2
    dist = np.sqrt(best)
    finite = dist[np.isfinite(dist) & (dist < 1e9)]
    if finite.size == 0:
        raise SystemExit("NN empty")
    med = float(np.median(finite))
    p99 = float(np.percentile(finite, 99))
    return {
        "n": n,
        "cell_px": round(cell, 4),
        "mean": round(float(finite.mean()), 4),
        "median": round(med, 4),
        "p95": round(float(np.percentile(finite, 95)), 4),
        "p99": round(p99, 4),
        "max": round(float(finite.max()), 4),
        "p99_over_median": round(p99 / med, 4) if med else None,
        "pass_p99_le_1_8_median": bool(med and p99 <= 1.8 * med),
        "note": "5x5 hash neighborhood; distances in source pixels of the analysis image",
    }


def load_bin_norm(path: Path, count: int) -> np.ndarray:
    raw = path.read_bytes()
    info = parse_header(raw)
    if info["count"] != count:
        raise SystemExit(f"{path} count {info['count']} != {count}")
    payload = raw[HEADER_BYTES:]
    xs = np.empty(count, dtype=np.float64)
    ys = np.empty(count, dtype=np.float64)
    for i in range(count):
        o = i * 5
        x = payload[o] | (payload[o + 1] << 8)
        y = payload[o + 2] | (payload[o + 3] << 8)
        xs[i] = x / 65535.0
        ys[i] = y / 65535.0
    return np.stack([xs, ys], axis=1)


def load_json_norm(path: Path) -> tuple[np.ndarray, int]:
    rec = json.loads(path.read_text(encoding="utf-8"))
    pts = rec["points"]
    xy = np.array([[p[0], p[1]] for p in pts], dtype=np.float64)
    return xy, int(rec["count"])


def diagnose_one(name: str, xy: np.ndarray, field: dict, sampler, extra: dict) -> dict:
    r = np.clip(
        np.hypot(xy[:, 0] - field["cx"], xy[:, 1] - field["cy"]) / field["R95"],
        0.0,
        1.0,
    )
    holes = sampler.hole_metrics(
        xy[:, 0],
        xy[:, 1],
        field["eligible_mask"],
        field["w"],
        field["h"],
        cell=HOLE_CELL,
    )
    return {
        "name": name,
        "count": int(xy.shape[0]),
        "field": {
            "analysis_wh": [field["w"], field["h"]],
            "c_star": [round(field["cx"], 6), round(field["cy"], 6)],
            "R95": round(field["R95"], 6),
            "eligible_n": field["eligible_n"],
            "dark_L": DARK_L,
            "dark_cull_pct": field["dark_cull_pct"],
        },
        "radial": radial_profile(r, field["eligible_r"]),
        "nn_px": nn_stats(xy[:, 0], xy[:, 1], field["w"], field["h"]),
        "holes_16px": holes,
        **extra,
    }


def main() -> None:
    sampler = load_sampler()
    cases = [
        {
            "name": "intro-dallas-100k-bin",
            "kind": "bin",
            "bin": ROOT / "prototype/pixi-cloud/dallas-100k.bin",
            "image": ROOT / "painting/01-dallas.jpg",
            "count": 100000,
            "live_default": True,
        },
        {
            "name": "hall-scotland-100k-bin",
            "kind": "bin",
            "bin": ROOT / "prototype/pixi-hall/scotland-100k.bin",
            "image": ROOT / "painting/02-scotland.jpg",
            "count": 100000,
            "live_default": True,
        },
        {
            "name": "community-met-100k-bin",
            "kind": "bin",
            "bin": ROOT / "prototype/pixi-community/met-100k.bin",
            "image": ROOT / "painting/05-met-fourtrees.jpg",
            "count": 100000,
            "live_default": True,
        },
        {
            "name": "intro-dallas-12k-json",
            "kind": "json",
            "json": ROOT / "prototype/assets/points_poplars.json",
            "image": ROOT / "painting/01-dallas.jpg",
            "live_default": False,
        },
    ]
    rows = []
    for case in cases:
        im = Image.open(case["image"])
        im.load()
        field = eligible_field(im, sampler)
        extra = {
            "source_image": str(case["image"].relative_to(ROOT)),
            "live_default": case["live_default"],
            "kind": case["kind"],
        }
        if case["kind"] == "bin":
            extra["bin"] = str(case["bin"].relative_to(ROOT))
            extra["fileSha256"] = sha256(case["bin"])
            extra["payloadSha256"] = parse_header(case["bin"].read_bytes())["payloadSha256"]
            xy = load_bin_norm(case["bin"], case["count"])
        else:
            extra["json"] = str(case["json"].relative_to(ROOT))
            extra["fileSha256"] = sha256(case["json"])
            xy, _n = load_json_norm(case["json"])
        rows.append(diagnose_one(case["name"], xy, field, sampler, extra))

    current_weight = "0.6 + 0.4*L^1.2"
    report = {
        "task": "S0 现状诊断",
        "handbook": "docs/NF_径向重映射_总结版最终方案_v2.0.md",
        "timestamp_note": "read-only; no resample",
        "current_pipeline": {
            "weight": current_weight,
            "radial_W_r": None,
            "refine": "3-round L-scaled repulsion + 16px eligible hole fill",
            "dart_thinning": False,
            "live_count": 100000,
            "handbook_count": 50000,
            "palette": "k=256 OKLab, unchanged this step",
            "physics_live": "SPRING 0.055 / DAMP 0.90 / vmax 10 (Pixi H1 lock)",
            "physics_handbook_s3": "k(r)/c(r) smoothstep field — not applied",
        },
        "frame_baseline_existing": {
            "b4_1_dwell_12k_p95_ms": 0.20,
            "b4_1_dwell_hz": 24,
            "b4_chaos_12k_work_p95_ms": 5.30,
            "this_vm_pixi_100k_fps": "4-15 software GL; not author-device bar",
            "author_pc_100k": "prior session claimed 60fps; not re-measured this step",
            "handbook_dwell_budget_delta_ms": 1.0,
        },
        "cases": rows,
        "cause": {
            "weight_mismatch": "live samples by luminance, not W(r)=0.2+0.8*exp(-2.5*r)",
            "refine_mismatch": "no dart-thinning / WSE / circle packing",
            "hole_metric_mismatch": "live hole = empty 16px eligible cells; handbook hole = NN p99 and visible empty circles",
            "count_conflict": "handbook S2 output 50k vs live/Pixi I-2 baseline 100k — S0 does not change count",
            "physics_conflict": "handbook §4 is not the locked spring; S3 must not silently retune 0.055",
        },
    }
    preview = Path("/opt/cursor/artifacts/radial_s0_dallas_bands.png")
    write_band_preview(
        ROOT / "prototype/pixi-cloud/dallas-100k.bin",
        100000,
        next(c for c in cases if c["name"] == "intro-dallas-100k-bin"),
        preview,
        sampler,
    )
    report["preview"] = str(preview)
    out = ROOT / "painting/radial-s0.json"
    out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(report, indent=2))


def write_band_preview(bin_path: Path, count: int, case: dict, dest: Path, sampler) -> None:
    im = Image.open(case["image"])
    im.load()
    field = eligible_field(im, sampler)
    xy = load_bin_norm(bin_path, count)
    r = np.clip(
        np.hypot(xy[:, 0] - field["cx"], xy[:, 1] - field["cy"]) / field["R95"],
        0.0,
        1.0,
    )
    w, h = 480, max(1, round(480 * field["h"] / field["w"]))
    canvas = np.zeros((h, w, 3), dtype=np.uint8)
    canvas[:] = (5, 5, 5)
    colors = np.array(
        [[201, 207, 216], [111, 143, 175], [163, 59, 42], [80, 80, 80]],
        dtype=np.uint8,
    )
    band_i = np.digitize(r, [0.3, 0.6, 0.85], right=False)
    px = np.clip((xy[:, 0] * w).astype(np.int32), 0, w - 1)
    py = np.clip((xy[:, 1] * h).astype(np.int32), 0, h - 1)
    canvas[py, px] = colors[band_i]
    dest.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(canvas, "RGB").save(dest)


if __name__ == "__main__":
    main()
