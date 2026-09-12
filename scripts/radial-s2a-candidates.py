#!/usr/bin/env python3
"""S2a: radial weighted candidates only.

Rejection sample W(r)=0.2+0.8·exp(-2.5·r) to 5×N=250k, then a seeded-shuffle
50k intermediate. Isolation artifacts only. No dart-thinning, no live bin write,
no palette/spring change.
"""
from __future__ import annotations

import hashlib
import importlib.util
import json
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

HANDBOOK = "docs/NF_径向重映射_总结版最终方案_v2.0.md"
SEED = 0x53324131  # S2A1
N = 50_000
CANDIDATE_RATIO = 5
N_CAND = N * CANDIDATE_RATIO
DARK_L = 0.19
WMAX = 1.0
BATCH = 65_536
LIVE_PATHS = (
    ROOT / "prototype/pixi-cloud/dallas-100k.bin",
    ROOT / "prototype/pixi-hall/scotland-100k.bin",
    ROOT / "prototype/pixi-community/met-100k.bin",
    ROOT / "painting/points.json",
    ROOT / "prototype/assets/points.json",
)
CASES = (
    {
        "name": "dallas",
        "image": ROOT / "painting/01-dallas.jpg",
        "live_bin": ROOT / "prototype/pixi-cloud/dallas-100k.bin",
        "role": "INTRO isolation",
    },
    {
        "name": "scotland",
        "image": ROOT / "painting/02-scotland.jpg",
        "live_bin": ROOT / "prototype/pixi-hall/scotland-100k.bin",
        "role": "HALL isolation",
    },
    {
        "name": "met",
        "image": ROOT / "painting/05-met-fourtrees.jpg",
        "live_bin": ROOT / "prototype/pixi-community/met-100k.bin",
        "role": "COMMUNITY isolation",
    },
)


def load_s0():
    spec = importlib.util.spec_from_file_location(
        "radial_s0", ROOT / "scripts/radial-s0-diagnose.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def load_sampler():
    spec = importlib.util.spec_from_file_location(
        "sample_painting", ROOT / "scripts/sample-painting.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def sha256_bytes(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def sha256_path(path: Path) -> str:
    return sha256_bytes(path.read_bytes())


def live_fingerprint() -> dict[str, str]:
    out = {}
    for path in LIVE_PATHS:
        rel = str(path.relative_to(ROOT))
        if not path.exists():
            out[rel] = "MISSING"
            continue
        out[rel] = sha256_path(path)
    return out


def eligible_xy(field: dict) -> np.ndarray:
    h, w = field["h"], field["w"]
    yy, xx = np.divmod(np.flatnonzero(field["eligible_mask"].reshape(-1)), w)
    xs = (xx.astype(np.float64) + 0.5) / w
    ys = (yy.astype(np.float64) + 0.5) / h
    return np.stack([xs, ys], axis=1)


def radial_weight(r: np.ndarray) -> np.ndarray:
    return 0.2 + 0.8 * np.exp(-2.5 * r)


def reject_sample(
    xy: np.ndarray, weights: np.ndarray, n_accept: int, rng: np.random.Generator
) -> tuple[np.ndarray, dict]:
    """Uniform eligible pixels, accept with P=W(r)/Wmax. With replacement."""
    n_el = int(xy.shape[0])
    if n_el < 1:
        raise SystemExit("no eligible pixels")
    p = np.clip(weights / WMAX, 0.0, 1.0)
    buf = np.empty((n_accept, 2), dtype=np.float64)
    filled = 0
    draws = 0
    while filled < n_accept:
        take = min(BATCH, max(n_accept - filled, 1) * 4)
        idx = rng.integers(0, n_el, size=take, endpoint=False)
        u = rng.random(take)
        keep = u < p[idx]
        hit = idx[keep]
        if hit.size:
            room = n_accept - filled
            use = hit[:room]
            buf[filled : filled + use.size] = xy[use]
            filled += int(use.size)
        draws += int(take)
        if draws > n_accept * 80:
            raise SystemExit(f"rejection did not fill {n_accept} after {draws} draws")
    return buf, {
        "draws": draws,
        "accepts": n_accept,
        "accept_rate": round(n_accept / max(draws, 1), 6),
        "eligible_n": n_el,
        "mean_W": round(float(weights.mean()), 6),
        "max_W": round(float(weights.max()), 6),
        "Wmax_used": WMAX,
    }


def encode_u16(xy: np.ndarray) -> bytes:
    x = np.clip(np.rint(xy[:, 0] * 65535.0), 0, 65535).astype("<u2")
    y = np.clip(np.rint(xy[:, 1] * 65535.0), 0, 65535).astype("<u2")
    inter = np.empty(xy.shape[0] * 2, dtype="<u2")
    inter[0::2] = x
    inter[1::2] = y
    return inter.tobytes()


def hash_f64(xy: np.ndarray) -> str:
    return sha256_bytes(np.ascontiguousarray(xy, dtype="<f8").tobytes())


def sample_once(xy_el: np.ndarray, weights: np.ndarray, seed: int) -> dict:
    rng = np.random.Generator(np.random.PCG64(seed))
    cand, log = reject_sample(xy_el, weights, N_CAND, rng)
    perm = rng.permutation(N_CAND)
    mid = cand[perm[:N]]
    return {
        "candidates": cand,
        "intermediate": mid,
        "log": log,
        "pool_hash_f64": hash_f64(cand),
        "mid_hash_f64": hash_f64(mid),
        "mid_hash_u16": sha256_bytes(encode_u16(mid)),
        "perm_hash": sha256_bytes(np.ascontiguousarray(perm, dtype="<i8").tobytes()),
    }


def point_r(xy: np.ndarray, cx: float, cy: float, r95: float) -> np.ndarray:
    return np.clip(np.hypot(xy[:, 0] - cx, xy[:, 1] - cy) / r95, 0.0, 1.0)


def write_band_preview(xy: np.ndarray, field: dict, dest: Path) -> None:
    r = point_r(xy, field["cx"], field["cy"], field["R95"])
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


def main() -> None:
    s0 = load_s0()
    sampler = load_sampler()
    before = live_fingerprint()
    rows = []
    preview = Path("/opt/cursor/artifacts/radial_s2a_dallas_bands.png")

    for case in CASES:
        im = Image.open(case["image"])
        im.load()
        field = s0.eligible_field(im, sampler)
        xy_el = eligible_xy(field)
        if xy_el.shape[0] != field["eligible_r"].shape[0]:
            raise SystemExit(f"{case['name']}: eligible xy/r mismatch")
        weights = radial_weight(field["eligible_r"])
        run_a = sample_once(xy_el, weights, SEED)
        run_b = sample_once(xy_el, weights, SEED)
        if run_a["pool_hash_f64"] != run_b["pool_hash_f64"]:
            raise SystemExit(f"{case['name']}: pool dual-run hash mismatch")
        if run_a["mid_hash_f64"] != run_b["mid_hash_f64"]:
            raise SystemExit(f"{case['name']}: 50k dual-run hash mismatch")
        if run_a["mid_hash_u16"] != run_b["mid_hash_u16"]:
            raise SystemExit(f"{case['name']}: u16 dual-run hash mismatch")

        mid = run_a["intermediate"]
        cand = run_a["candidates"]
        mid_r = point_r(mid, field["cx"], field["cy"], field["R95"])
        cand_r = point_r(cand, field["cx"], field["cy"], field["R95"])
        radial_50k = s0.radial_profile(mid_r, field["eligible_r"])
        radial_250k = s0.radial_profile(cand_r, field["eligible_r"])
        u16 = encode_u16(mid)
        out_u16 = ROOT / f"painting/radial-s2a-{case['name']}-50k.u16"
        out_u16.write_bytes(u16)
        if sha256_bytes(u16) != run_a["mid_hash_u16"]:
            raise SystemExit(f"{case['name']}: wrote u16 hash drifted")

        live_bin = case["live_bin"]
        extra = {
            "role": case["role"],
            "source_image": str(case["image"].relative_to(ROOT)),
            "isolation_u16": str(out_u16.relative_to(ROOT)),
            "isolation_bytes": len(u16),
            "live_bin": str(live_bin.relative_to(ROOT)),
            "live_bin_sha256": sha256_path(live_bin) if live_bin.exists() else None,
            "seed": SEED,
            "bitgen": "numpy.random.PCG64",
            "weight": "0.2+0.8*exp(-2.5*r)",
            "refine": None,
            "candidate_ratio": CANDIDATE_RATIO,
            "rejection": run_a["log"],
            "hash": {
                "pool_f64": run_a["pool_hash_f64"],
                "mid_f64": run_a["mid_hash_f64"],
                "mid_u16": run_a["mid_hash_u16"],
                "perm": run_a["perm_hash"],
                "dual_run": True,
            },
            "radial_50k": radial_50k,
            "radial_250k": radial_250k,
            "nn_px_50k": s0.nn_stats(mid[:, 0], mid[:, 1], field["w"], field["h"]),
        }
        rows.append(
            s0.diagnose_one(
                f"s2a-{case['name']}-50k",
                mid,
                field,
                sampler,
                extra,
            )
        )
        if case["name"] == "dallas":
            write_band_preview(mid, field, preview)

        print(
            f"{case['name']} 50k center/edge {radial_50k['center_over_edge']} "
            f"250k {radial_250k['center_over_edge']} "
            f"accept {run_a['log']['accept_rate']} "
            f"hash {run_a['mid_hash_u16'][:12]}",
            flush=True,
        )

    after = live_fingerprint()
    if after != before:
        raise SystemExit(f"live files changed: {before} -> {after}")

    report = {
        "task": "S2a 带权候选",
        "handbook": HANDBOOK,
        "timestamp_note": "isolation only; no thinning; no live write",
        "seed": SEED,
        "N": N,
        "N_candidates": N_CAND,
        "weight": "W(r)=0.2+0.8*exp(-2.5*r)",
        "Wmax": WMAX,
        "order": "PCG64 rejection then seeded permutation[:50000]",
        "live_count_unchanged": 100000,
        "handbook_count": N,
        "refine": False,
        "palette_unchanged": True,
        "spring_unchanged": True,
        "live_sha256": after,
        "preview": str(preview),
        "cases": rows,
        "cause": {
            "s2a_scope": "stage-1 rejection only; S2b owns dart-thinning",
            "count_conflict": "50k isolation vs live 100k — author has not moved live count",
            "physics_conflict": "handbook §4 unused; spring stays 0.055/0.90",
        },
    }
    out = ROOT / "painting/radial-s2a.json"
    out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"wrote {out.relative_to(ROOT)}", flush=True)


if __name__ == "__main__":
    main()
