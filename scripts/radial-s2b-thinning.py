#!/usr/bin/env python3
"""S2b: default dart-thinning on the S2a 250k pool.

Grid + real R_local distance. Calibrate s0 to 50k ± 5% (2–3 rounds).
Isolation only. No upgrade to WSE/circle packing. No live bin write.
"""
from __future__ import annotations

import importlib.util
import json
import math
import sys
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))

HANDBOOK = "docs/NF_径向重映射_总结版最终方案_v2.0.md"
N = 50_000
TOL = 0.05
S0_FACTOR = 0.54
ARTIFACT = Path("/opt/cursor/artifacts/radial_s2b_dallas_bands.png")


def load_s2a():
    spec = importlib.util.spec_from_file_location(
        "radial_s2a", ROOT / "scripts/radial-s2a-candidates.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def dart_thin(px: np.ndarray, py: np.ndarray, r_local: np.ndarray, order: np.ndarray):
    """Accept if dist to every kept point >= R_local(candidate). cell = s_max."""
    s_max = float(r_local.max())
    if s_max <= 1e-12:
        raise SystemExit("s_max collapsed")
    inv = 1.0 / s_max
    gx = np.floor(px * inv).astype(np.int32)
    gy = np.floor(py * inv).astype(np.int32)
    grid: dict[tuple[int, int], list[int]] = {}
    acc_x: list[float] = []
    acc_y: list[float] = []
    acc_i: list[int] = []
    for raw in order:
        i = int(raw)
        x = float(px[i])
        y = float(py[i])
        ri = float(r_local[i])
        ri2 = ri * ri
        cgi = int(gx[i])
        cgy = int(gy[i])
        rad = int(ri * inv) + 1
        ok = True
        for ox in range(-rad, rad + 1):
            for oy in range(-rad, rad + 1):
                bucket = grid.get((cgi + ox, cgy + oy))
                if bucket is None:
                    continue
                for j in bucket:
                    dx = x - acc_x[j]
                    dy = y - acc_y[j]
                    if dx * dx + dy * dy < ri2:
                        ok = False
                        break
                if not ok:
                    break
            if not ok:
                break
        if ok:
            grid.setdefault((cgi, cgy), []).append(len(acc_i))
            acc_x.append(x)
            acc_y.append(y)
            acc_i.append(i)
    return np.asarray(acc_i, dtype=np.int32)


def r_local_px(weights: np.ndarray, s0: float, wmax: float) -> np.ndarray:
    w = np.maximum(weights, 1e-9)
    return s0 * np.sqrt(wmax / w)


def thin_count(px, py, weights, order, s0, wmax):
    rl = r_local_px(weights, s0, wmax)
    kept = dart_thin(px, py, rl, order)
    return kept


def calibrate(px, py, weights, order, s0_init, wmax, n_target, n_cand):
    """2–3 binary-search rounds. Lock the last s0 into meta."""
    log = []

    def run(s0, note):
        kept = thin_count(px, py, weights, order, s0, wmax)
        rec = {
            "s0_px": round(float(s0), 6),
            "candidates": int(n_cand),
            "accepted": int(kept.size),
            "accept_rate": round(kept.size / max(n_cand, 1), 6),
            "delta_pct": round(100.0 * (kept.size - n_target) / n_target, 3),
            "note": note,
        }
        log.append(rec)
        return kept, rec

    kept, rec = run(s0_init, "初值 0.54·√(A_mask/N)，A_mask=合格像素数")
    if abs(rec["accepted"] - n_target) <= n_target * TOL:
        rec["note"] += "；一轮已在 ±5%，锁定"
        return kept, s0_init, log

    # Bracket: more accepts → s0 too small; fewer → s0 too large.
    if rec["accepted"] > n_target:
        lo, hi = s0_init, s0_init * 2.0
        while True:
            k_hi, r_hi = run(hi, "抬高上界")
            if r_hi["accepted"] <= n_target or hi > s0_init * 32:
                break
            lo, hi = hi, hi * 2.0
    else:
        hi, lo = s0_init, s0_init * 0.5
        while True:
            k_lo, r_lo = run(lo, "压低下界")
            if r_lo["accepted"] >= n_target or lo < s0_init / 32:
                break
            hi, lo = lo, lo * 0.5

    # Larger s0 → fewer accepts. lo = too many points; hi = too few.
    def update_bracket(s0, accepted):
        nonlocal lo, hi
        if accepted > n_target:
            lo = s0
        else:
            hi = s0

    s_cur = 0.5 * (lo + hi)
    kept, rec = run(s_cur, "二分第 2 轮")
    update_bracket(s_cur, rec["accepted"])
    s_cur = 0.5 * (lo + hi)
    kept, rec = run(s_cur, "二分第 3 轮")
    update_bracket(s_cur, rec["accepted"])
    extra = 0
    while abs(rec["accepted"] - n_target) > n_target * TOL and extra < 5:
        extra += 1
        s_cur = 0.5 * (lo + hi)
        kept, rec = run(s_cur, f"续二分至 ±5%（+{extra}）")
        update_bracket(s_cur, rec["accepted"])
    rec["locked"] = True
    rec["note"] += "；锁定"
    return kept, s_cur, log


def upgrade_advice(rows: list[dict]) -> dict:
    dens_ok = all(c["radial"]["pass_ge_2x"] for c in rows)
    nn_ok = all(c["nn_px"]["pass_p99_le_1_8_median"] for c in rows)
    count_ok = all(abs(c["count"] - N) <= N * TOL for c in rows)
    if dens_ok and nn_ok and count_ok:
        return {
            "upgrade_2_wse": False,
            "upgrade_3_circle": False,
            "post_5_lec": False,
            "reason": "① 计数、§8#1、§8#2 都过。②/③ 继续休眠。",
        }
    if dens_ok and count_ok and not nn_ok:
        return {
            "upgrade_2_wse": False,
            "upgrade_3_circle": False,
            "post_5_lec": True,
            "reason": "密度与计数过、NN 未过。先评休眠⑤ 空圆定点，不升③（无公开实现）。② 仅当⑤仍不够再评。",
        }
    if not dens_ok:
        return {
            "upgrade_2_wse": True,
            "upgrade_3_circle": False,
            "post_5_lec": False,
            "reason": "细化后 §8#1 掉了。评②（精确 N + 自定义权），不升③。",
        }
    return {
        "upgrade_2_wse": True,
        "upgrade_3_circle": False,
        "post_5_lec": False,
        "reason": "计数未进 ±5%。先下调 s0 或把候选池加到 10×N，再评②。③ 仍休眠。",
    }


def main() -> None:
    s2a = load_s2a()
    s0 = s2a.load_s0()
    sampler = s2a.load_sampler()
    prior = json.loads((ROOT / "painting/radial-s2a.json").read_text(encoding="utf-8"))
    prior_hash = {c["name"].split("-")[1]: c["hash"]["pool_f64"] for c in prior["cases"]}
    before = s2a.live_fingerprint()
    rows = []

    for case in s2a.CASES:
        im = Image.open(case["image"])
        im.load()
        field = s0.eligible_field(im, sampler)
        xy_el = s2a.eligible_xy(field)
        weights_el = s2a.radial_weight(field["eligible_r"])
        rng = np.random.Generator(np.random.PCG64(s2a.SEED))
        cand, _rej = s2a.reject_sample(xy_el, weights_el, s2a.N_CAND, rng)
        order = rng.permutation(s2a.N_CAND)
        pool_hash = s2a.hash_f64(cand)
        expected = prior_hash[case["name"]]
        if pool_hash != expected:
            raise SystemExit(f"{case['name']}: pool hash {pool_hash} != S2a {expected}")

        cand_r = s2a.point_r(cand, field["cx"], field["cy"], field["R95"])
        cand_w = s2a.radial_weight(cand_r)
        w_px, h_px = field["w"], field["h"]
        px = cand[:, 0] * w_px
        py = cand[:, 1] * h_px
        a_mask = float(field["eligible_n"])
        s0_init = S0_FACTOR * math.sqrt(a_mask / N)

        kept_idx, s0_lock, cal = calibrate(
            px, py, cand_w, order, s0_init, s2a.WMAX, N, s2a.N_CAND
        )
        # Dual-run locked s0 only.
        kept_b = thin_count(px, py, cand_w, order, s0_lock, s2a.WMAX)
        if kept_idx.size != kept_b.size or not np.array_equal(kept_idx, kept_b):
            raise SystemExit(f"{case['name']}: thinning dual-run mismatch")

        mid = cand[kept_idx]
        u16 = s2a.encode_u16(mid)
        out_u16 = ROOT / f"painting/radial-s2b-{case['name']}-50k.u16"
        out_u16.write_bytes(u16)
        mid_r = s2a.point_r(mid, field["cx"], field["cy"], field["R95"])
        radial = s0.radial_profile(mid_r, field["eligible_r"])
        extra = {
            "role": case["role"],
            "source_image": str(case["image"].relative_to(ROOT)),
            "isolation_u16": str(out_u16.relative_to(ROOT)),
            "isolation_bytes": len(u16),
            "live_bin": str(case["live_bin"].relative_to(ROOT)),
            "live_bin_sha256": s2a.sha256_path(case["live_bin"]),
            "seed": s2a.SEED,
            "bitgen": "numpy.random.PCG64",
            "weight": "0.2+0.8*exp(-2.5*r)",
            "refine": "dart-thinning",
            "metric": "pixel Euclidean; A_mask=eligible pixel count",
            "s0_init_px": round(s0_init, 6),
            "s0_locked_px": round(float(s0_lock), 6),
            "A_mask_px": field["eligible_n"],
            "candidate_ratio": s2a.CANDIDATE_RATIO,
            "pool_hash_f64": pool_hash,
            "pool_matches_s2a": True,
            "calibration": cal,
            "count_in_tol": bool(abs(mid.shape[0] - N) <= N * TOL),
            "hash": {
                "mid_f64": s2a.hash_f64(mid),
                "mid_u16": s2a.sha256_bytes(u16),
                "dual_run": True,
            },
        }
        row = s0.diagnose_one(
            f"s2b-{case['name']}-thin",
            mid,
            field,
            sampler,
            extra,
        )
        # diagnose_one already computed radial/nn on mid; keep calibration radial too
        row["radial_from_profile"] = radial
        rows.append(row)
        if case["name"] == "dallas":
            s2a.write_band_preview(mid, field, ARTIFACT)
        last = cal[-1]
        print(
            f"{case['name']} n={mid.shape[0]} s0={s0_lock:.4f}px "
            f"c/e {row['radial']['center_over_edge']} "
            f"nn {row['nn_px']['p99_over_median']} "
            f"cal_n={last['accepted']} hash {extra['hash']['mid_u16'][:12]}",
            flush=True,
        )

    after = s2a.live_fingerprint()
    if after != before:
        raise SystemExit(f"live files changed: {before} -> {after}")

    advice = upgrade_advice(rows)
    report = {
        "task": "S2b 默认 dart-thinning",
        "handbook": HANDBOOK,
        "timestamp_note": "isolation only; default tier ①; no live write",
        "seed": s2a.SEED,
        "N": N,
        "tolerance": TOL,
        "refine_mode": "thinning",
        "order": "same PCG64 seeded permutation as S2a",
        "live_count_unchanged": 100000,
        "handbook_count": N,
        "palette_unchanged": True,
        "spring_unchanged": True,
        "upgrade": advice,
        "live_sha256": after,
        "preview": str(ARTIFACT),
        "cases": rows,
        "cause": {
            "s2b_scope": "default dart-thinning only; S2c owns formal QC table",
            "count_conflict": "50k isolation vs live 100k — author has not moved live count",
            "physics_conflict": "handbook §4 unused; spring stays 0.055/0.90",
        },
    }
    out = ROOT / "painting/radial-s2b.json"
    out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps(advice, ensure_ascii=False), flush=True)
    print(f"wrote {out.relative_to(ROOT)}", flush=True)


if __name__ == "__main__":
    main()
