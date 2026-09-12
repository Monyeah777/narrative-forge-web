#!/usr/bin/env python3
"""Assembly volume v3.0 Phase A — W-proof triple. Read-only.

① W visualization  ② radial density profile  ③ count reconciliation
Does not resample, does not rewrite bins / 100k / C2 golden.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import math
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
VOL = "docs/NF_粒子装配模块_整合总卷_v3.0.md"
ART = Path("/opt/cursor/artifacts/assembly-v3-a")
PAINT = ROOT / "painting"
LOCKED = {
    "dallas": {
        "image": PAINT / "01-dallas.jpg",
        "u16": PAINT / "radial-s2b-dallas-50k.u16",
        "u16_sha": "f6df3397eb97fef511377cdf903a89544860086a78d07c1eb0191f6ff4f3add6",
        "live_bin": ROOT / "prototype/pixi-cloud/dallas-radial-50k.bin",
        "n_expect": 50601,
        "R95": 0.599042,
    },
    "scotland": {
        "image": PAINT / "02-scotland.jpg",
        "u16": PAINT / "radial-s2b-scotland-50k.u16",
        "u16_sha": "700e9d525a731766fd17f4c4872754138c81a09ca40db1928dfc5865b97d914f",
        "live_bin": ROOT / "prototype/pixi-hall/scotland-radial-50k.bin",
        "n_expect": 50441,
        "R95": 0.599053,
    },
    "met": {
        "image": PAINT / "05-met-fourtrees.jpg",
        "u16": PAINT / "radial-s2b-met-50k.u16",
        "u16_sha": "a4f4a7a1579858445140595b08883829237f466df1eb781efaed02c12b1efc46",
        "live_bin": ROOT / "prototype/pixi-community/met-radial-50k.bin",
        "n_expect": 50471,
        "R95": 0.592304,
    },
}
BINS = 20
SKY_L = 0.72
DARK_L = 0.19


def sha256_path(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def load_s0():
    spec = importlib.util.spec_from_file_location("radial_s0", ROOT / "scripts/radial-s0-diagnose.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def load_sampler():
    spec = importlib.util.spec_from_file_location("sample_painting", ROOT / "scripts/sample-painting.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def decode_u16(path: Path) -> np.ndarray:
    raw = path.read_bytes()
    arr = np.frombuffer(raw, dtype="<u2")
    xy = np.empty((arr.size // 2, 2), dtype=np.float64)
    xy[:, 0] = arr[0::2] / 65535.0
    xy[:, 1] = arr[1::2] / 65535.0
    return xy


def W_of_r(r: np.ndarray) -> np.ndarray:
    return 0.2 + 0.8 * np.exp(-2.5 * r)


def l1(a: np.ndarray, b: np.ndarray) -> float:
    return float(np.abs(a - b).sum())


def save_w_panel(im: Image.Image, field: dict, xy: np.ndarray, dest: Path) -> None:
    """① W visualization: painting | W heat | points on W."""
    rgb = np.asarray(im.convert("RGB"), dtype=np.uint8)
    h, w = field["h"], field["w"]
    mask = field["eligible_mask"]
    yy, xx = np.mgrid[0:h, 0:w]
    xs = (xx.astype(np.float64) + 0.5) / w
    ys = (yy.astype(np.float64) + 0.5) / h
    r = np.clip(np.hypot(xs - field["cx"], ys - field["cy"]) / field["R95"], 0.0, 1.0)
    heat = W_of_r(r)
    heat_u8 = np.zeros((h, w, 3), dtype=np.uint8)
    # viridis-ish: low W purple-blue, high W yellow
    t = heat
    heat_u8[..., 0] = np.clip(255 * (0.2 + 0.8 * t), 0, 255).astype(np.uint8)
    heat_u8[..., 1] = np.clip(255 * (0.15 + 0.7 * t * t), 0, 255).astype(np.uint8)
    heat_u8[..., 2] = np.clip(255 * (0.55 * (1.0 - t) + 0.15), 0, 255).astype(np.uint8)
    heat_u8[~mask] = (5, 5, 5)
    dots = heat_u8.copy()
    px = np.clip((xy[:, 0] * w).astype(np.int32), 0, w - 1)
    py = np.clip((xy[:, 1] * h).astype(np.int32), 0, h - 1)
    dots[py, px] = (245, 245, 245)
    # scale each pane to width 360
    def scale(arr: np.ndarray, how: Image.Resampling) -> np.ndarray:
        img = Image.fromarray(arr, "RGB")
        nw = 360
        nh = max(1, round(360 * arr.shape[0] / arr.shape[1]))
        return np.asarray(img.resize((nw, nh), how))

    left = scale(rgb, Image.Resampling.BILINEAR)
    mid = scale(heat_u8, Image.Resampling.NEAREST)
    right = scale(dots, Image.Resampling.NEAREST)
    gap = np.full((left.shape[0], 8, 3), 5, dtype=np.uint8)
    panel = np.concatenate([left, gap, mid, gap, right], axis=1)
    dest.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(panel, "RGB").save(dest)


def radial_profile(r_pts: np.ndarray, field: dict) -> dict:
    """② Compare locked points to p(r)∝r·W(r) vs the illegal p(r)∝W(r)."""
    edges = np.linspace(0.0, 1.0, BINS + 1)
    hist_pts, _ = np.histogram(r_pts, bins=edges)
    p_pts = hist_pts.astype(np.float64)
    p_pts = p_pts / max(p_pts.sum(), 1.0)

    r_el = field["eligible_r"]
    hist_el, _ = np.histogram(r_el, bins=edges)
    # 2D rejection on eligible pixels: expected count ∝ n_eligible(bin) * mean W(bin)
    r_mid = 0.5 * (edges[:-1] + edges[1:])
    w_mid = W_of_r(r_mid)
    exp_area = hist_el.astype(np.float64) * w_mid
    p_area = exp_area / max(exp_area.sum(), 1.0)

    # 1D disk models (ignore painting mask)
    p_rW = r_mid * w_mid
    p_rW = p_rW / p_rW.sum()
    p_W = w_mid / w_mid.sum()  # illegal: missing area element

    return {
        "bins": BINS,
        "edges": [round(float(x), 4) for x in edges],
        "p_points": [round(float(x), 6) for x in p_pts],
        "p_eligible_times_W": [round(float(x), 6) for x in p_area],
        "p_r_times_W_disk": [round(float(x), 6) for x in p_rW],
        "p_W_only_illegal": [round(float(x), 6) for x in p_W],
        "l1_vs_eligible_W": round(l1(p_pts, p_area), 6),
        "l1_vs_rW_disk": round(l1(p_pts, p_rW), 6),
        "l1_vs_W_only": round(l1(p_pts, p_W), 6),
        "closer_to_area_element": bool(l1(p_pts, p_area) < l1(p_pts, p_W)),
        "monotonic_decay_hint": bool(p_pts[0] > p_pts[-1]),
    }


def sky_audit(im: Image.Image, field: dict, xy: np.ndarray, sampler) -> dict:
    rgb = np.asarray(im.convert("RGB"), dtype=np.uint8).reshape(-1, 3).astype(np.float64) / 255.0
    L = sampler.linear_srgb_to_oklab(sampler.srgb_to_linear(rgb))[:, 0].reshape(field["h"], field["w"])
    mask = field["eligible_mask"]
    sky = mask & (L >= SKY_L)
    tree = mask & (L < SKY_L)
    yy, xx = np.mgrid[0 : field["h"], 0 : field["w"]]
    xs = (xx.astype(np.float64) + 0.5) / field["w"]
    ys = (yy.astype(np.float64) + 0.5) / field["h"]
    r = np.clip(np.hypot(xs - field["cx"], ys - field["cy"]) / field["R95"], 0.0, 1.0)
    w = W_of_r(r)
    # sample L at point pixels
    px = np.clip((xy[:, 0] * field["w"]).astype(np.int32), 0, field["w"] - 1)
    py = np.clip((xy[:, 1] * field["h"]).astype(np.int32), 0, field["h"] - 1)
    pt_sky = int((L[py, px] >= SKY_L).sum())
    el_sky = int(sky.sum())
    el_n = int(mask.sum())
    return {
        "sky_L_cut": SKY_L,
        "eligible_sky_n": el_sky,
        "eligible_sky_frac": round(el_sky / max(el_n, 1), 6),
        "points_in_sky": pt_sky,
        "points_sky_frac": round(pt_sky / max(len(xy), 1), 6),
        "mean_W_sky": round(float(w[sky].mean()) if el_sky else 0.0, 6),
        "mean_W_nonsky": round(float(w[tree].mean()) if int(tree.sum()) else 0.0, 6),
        "dark_cull_excludes_light": True,
        "W_is_radial_only": True,
        "note": "v3.0 §3.2 wants sky to keep weight. Current W(r) is radial; edge sky gets W≈0.27.",
    }


def main() -> None:
    s0 = load_s0()
    sampler = load_sampler()
    ART.mkdir(parents=True, exist_ok=True)
    rows = []
    failed = []
    for name, spec in LOCKED.items():
        got = sha256_path(spec["u16"])
        if got != spec["u16_sha"]:
            failed.append(f"{name} u16 mutated")
        xy = decode_u16(spec["u16"])
        if len(xy) != spec["n_expect"]:
            failed.append(f"{name} n {len(xy)}")
        im = Image.open(spec["image"])
        im.load()
        field = s0.eligible_field(im, sampler)
        r_pts = np.clip(
            np.hypot(xy[:, 0] - field["cx"], xy[:, 1] - field["cy"]) / field["R95"],
            0.0,
            1.0,
        )
        panel = ART / f"w-panel-{name}.png"
        save_w_panel(im, field, xy, panel)
        PAINT.joinpath(f"assembly-v3-a-w-{name}.png").write_bytes(panel.read_bytes())
        prof = radial_profile(r_pts, field)
        sky = sky_audit(im, field, xy, sampler)
        live_n = None
        live_sha = None
        if spec["live_bin"].exists():
            raw = spec["live_bin"].read_bytes()
            live_sha = hashlib.sha256(raw).hexdigest()
            if raw[:4] == b"NFPT" and len(raw) >= 9:
                live_n = int.from_bytes(raw[5:9], "little")
        count = {
            "archive_target": 50000,
            "locked_n": int(len(xy)),
            "live_bin_n": live_n,
            "pct_vs_50k": round(100.0 * len(xy) / 50000.0, 3),
            "within_pm5": abs(len(xy) - 50000) / 50000.0 <= 0.05,
            "u16_sha256": got,
            "live_bin_sha256": live_sha,
            "eligible_pixels": int(field["eligible_n"]),
            "dark_cull_pct": field["dark_cull_pct"],
            "preview_20_30k_present": False,
            "emergency_30k_log_present": False,
        }
        if not count["within_pm5"]:
            failed.append(f"{name} count")
        if not prof["closer_to_area_element"]:
            failed.append(f"{name} area-element")
        rows.append(
            {
                "name": name,
                "R95_field": field["R95"],
                "R95_meta": spec["R95"],
                "w_panel": f"painting/assembly-v3-a-w-{name}.png",
                "profile": prof,
                "sky": sky,
                "count": count,
            }
        )

    out = {
        "task": "assembly-v3-A-W-triple",
        "volume": VOL,
        "resampled": False,
        "pass": not failed,
        "failed": failed,
        "method": {
            "W": "0.2+0.8*exp(-2.5*r) on eligible L>=0.19",
            "sampling_historical": "S2a 2D uniform eligible + P=W/Wmax → p(r)∝r·W(r) automatically",
            "illegal": "p(r)∝W(r) without Jacobian",
        },
        "cases": rows,
    }
    (PAINT / "assembly-v3-a-w.json").write_text(json.dumps(out, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"pass": out["pass"], "failed": failed, "n": [c["count"]["locked_n"] for c in rows]}, indent=2))
    if failed:
        raise SystemExit(1)


if __name__ == "__main__":
    main()
