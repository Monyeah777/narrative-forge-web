#!/usr/bin/env python3
"""S2c: QC the locked S2b isolation sets.

Re-read the committed u16 files. Density + NN are the gate.
Spectrum is optional (目检为主): full-set FFT plus a mid-band window
so the intended W(r) falloff is not scored as a defect.
No resample, no live write, no upgrade unless #1/#2 fail.
"""
from __future__ import annotations

import importlib.util
import json
from pathlib import Path

import numpy as np
from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
HANDBOOK = "docs/NF_径向重映射_总结版最终方案_v2.0.md"
GRID = 256
ART = Path("/opt/cursor/artifacts")
CASES = (
    ("dallas", ROOT / "painting/01-dallas.jpg", ROOT / "painting/radial-s2b-dallas-50k.u16"),
    ("scotland", ROOT / "painting/02-scotland.jpg", ROOT / "painting/radial-s2b-scotland-50k.u16"),
    ("met", ROOT / "painting/05-met-fourtrees.jpg", ROOT / "painting/radial-s2b-met-50k.u16"),
)


def load_s2a():
    spec = importlib.util.spec_from_file_location(
        "radial_s2a", ROOT / "scripts/radial-s2a-candidates.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def decode_u16(path: Path) -> np.ndarray:
    raw = path.read_bytes()
    if len(raw) % 4:
        raise SystemExit(f"{path} size {len(raw)} not multiple of 4")
    arr = np.frombuffer(raw, dtype="<u2")
    xy = np.empty((arr.size // 2, 2), dtype=np.float64)
    xy[:, 0] = arr[0::2] / 65535.0
    xy[:, 1] = arr[1::2] / 65535.0
    return xy


def local_square_window(
    xy: np.ndarray, r: np.ndarray, r_lo: float, r_hi: float, span: float
) -> np.ndarray:
    """Filled square crop so FFT does not see an annular occupancy mask."""
    mid = xy[(r >= r_lo) & (r < r_hi)]
    if mid.size == 0:
        mid = xy
    cx, cy = float(mid[:, 0].mean()), float(mid[:, 1].mean())
    cx = min(max(cx, span + 0.02), 1.0 - span - 0.02)
    cy = min(max(cy, span + 0.02), 1.0 - span - 0.02)
    box = xy[
        (xy[:, 0] >= cx - span)
        & (xy[:, 0] < cx + span)
        & (xy[:, 1] >= cy - span)
        & (xy[:, 1] < cy + span)
    ]
    local = np.empty_like(box)
    local[:, 0] = (box[:, 0] - (cx - span)) / (2.0 * span)
    local[:, 1] = (box[:, 1] - (cy - span)) / (2.0 * span)
    keep = (
        (local[:, 0] >= 0.0)
        & (local[:, 0] < 1.0)
        & (local[:, 1] >= 0.0)
        & (local[:, 1] < 1.0)
    )
    return local[keep]


def hist2d(xy: np.ndarray, n: int = GRID) -> np.ndarray:
    x = np.clip(xy[:, 0], 0.0, 1.0 - 1e-12)
    y = np.clip(xy[:, 1], 0.0, 1.0 - 1e-12)
    ix = np.floor(x * n).astype(np.int32)
    iy = np.floor(y * n).astype(np.int32)
    h = np.zeros((n, n), dtype=np.float64)
    np.add.at(h, (iy, ix), 1.0)
    return h


def power_spectrum(h: np.ndarray) -> tuple[np.ndarray, np.ndarray, np.ndarray]:
    """Return (shifted power, kx, radial mean). DC removed before FFT."""
    z = h - h.mean()
    f = np.fft.fftshift(np.fft.fft2(z))
    p = np.real(f * np.conj(f))
    n = p.shape[0]
    c = n // 2
    yy, xx = np.ogrid[-c : n - c, -c : n - c]
    k = np.hypot(xx, yy)
    kmax = float(c)
    nbins = c
    rad = np.zeros(nbins, dtype=np.float64)
    cnt = np.zeros(nbins, dtype=np.float64)
    slot = np.clip(np.floor(k).astype(np.int32), 0, nbins - 1)
    np.add.at(rad, slot, p)
    np.add.at(cnt, slot, 1.0)
    rad = np.divide(rad, np.maximum(cnt, 1.0))
    rad[0] = 0.0  # DC bin
    return p, k, rad


def spectrum_metrics(p: np.ndarray, k: np.ndarray, rad: np.ndarray) -> dict:
    n = p.shape[0]
    c = n // 2
    knyq = float(c)
    # Skip DC. Low band vs mid band of the radial mean.
    ks = np.arange(rad.size, dtype=np.float64)
    low = (ks >= 1) & (ks < 0.12 * knyq)
    mid = (ks >= 0.18 * knyq) & (ks < 0.45 * knyq)
    low_m = float(rad[low].mean()) if low.any() else 0.0
    mid_m = float(rad[mid].mean()) if mid.any() else 1.0
    low_over_mid = low_m / mid_m if mid_m else None
    # Axis-aligned energy (grid) vs off-axis, excluding DC neighborhood.
    yy, xx = np.ogrid[-c : n - c, -c : n - c]
    ring = (k >= 4) & (k < 0.8 * knyq)
    axis = ring & ((np.abs(xx) <= 1) | (np.abs(yy) <= 1))
    off = ring & ~axis
    axis_m = float(p[axis].mean()) if axis.any() else 0.0
    off_m = float(p[off].mean()) if off.any() else 1.0
    axis_over_off = axis_m / off_m if off_m else None
    peak_k = int(np.argmax(rad[1:]) + 1) if rad.size > 1 else 0
    # Optional #10: fail only on a hard lattice spike. Low-freq from W(r) is expected.
    grid_ok = axis_over_off is not None and axis_over_off < 3.0
    return {
        "grid": n,
        "low_over_mid": None if low_over_mid is None else round(low_over_mid, 4),
        "axis_over_off": None if axis_over_off is None else round(axis_over_off, 4),
        "peak_k_bins": peak_k,
        "k_nyquist": knyq,
        "pass_no_grid_spike": bool(grid_ok),
        "note": "low_over_mid on the full set is raised by W(r); use mid-band window for blue-noise",
    }


def render_spectrum(p: np.ndarray, dest: Path) -> None:
    logp = np.log10(p + 1e-9)
    lo, hi = np.percentile(logp, 5), np.percentile(logp, 99.5)
    norm = np.clip((logp - lo) / max(hi - lo, 1e-9), 0.0, 1.0)
    img = np.stack(
        [
            np.rint(norm * 220 + 20).astype(np.uint8),
            np.rint(norm * 180 + 10).astype(np.uint8),
            np.rint((1.0 - norm) * 40 + 8).astype(np.uint8),
        ],
        axis=-1,
    )
    dest.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(img, "RGB").resize((384, 384), Image.Resampling.NEAREST).save(dest)


def render_radial(rad: np.ndarray, dest: Path) -> None:
    w, h = 480, 200
    canvas = np.full((h, w, 3), 18, dtype=np.uint8)
    yv = rad[3:].copy()
    if yv.size == 0:
        Image.fromarray(canvas, "RGB").save(dest)
        return
    yv = np.clip(yv, 0.0, np.percentile(yv, 99) * 1.15)
    yv = yv / max(float(yv.max()), 1e-12)
    xs = np.linspace(1, w - 2, yv.size)
    ys = (h - 2) - yv * (h - 8)
    for i in range(1, len(xs)):
        x0, x1 = int(xs[i - 1]), int(xs[i])
        y0, y1 = int(ys[i - 1]), int(ys[i])
        steps = max(abs(x1 - x0), abs(y1 - y0), 1)
        for t in range(steps + 1):
            x = x0 + (x1 - x0) * t // steps
            y = y0 + (y1 - y0) * t // steps
            if 0 <= x < w and 0 <= y < h:
                canvas[y, x] = (210, 200, 170)
    Image.fromarray(canvas, "RGB").save(dest)


def render_zoom(xy: np.ndarray, field: dict, dest: Path, r_lo: float, r_hi: float) -> None:
    """200px crop around a mid-band point, plus a 16px cell overlay hint."""
    r = np.hypot(xy[:, 0] - field["cx"], xy[:, 1] - field["cy"]) / field["R95"]
    pick = np.flatnonzero((r >= r_lo) & (r < r_hi))
    if pick.size == 0:
        pick = np.arange(xy.shape[0])
    i = int(pick[pick.size // 2])
    cx, cy = float(xy[i, 0]), float(xy[i, 1])
    span = 0.08
    w = h = 240
    canvas = np.zeros((h, w, 3), dtype=np.uint8)
    canvas[:] = (8, 8, 8)
    in_box = (
        (xy[:, 0] >= cx - span)
        & (xy[:, 0] <= cx + span)
        & (xy[:, 1] >= cy - span)
        & (xy[:, 1] <= cy + span)
    )
    local = xy[in_box]
    px = np.clip(((local[:, 0] - (cx - span)) / (2 * span) * (w - 1)).astype(np.int32), 0, w - 1)
    py = np.clip(((local[:, 1] - (cy - span)) / (2 * span) * (h - 1)).astype(np.int32), 0, h - 1)
    canvas[py, px] = (230, 230, 220)
    dest.parent.mkdir(parents=True, exist_ok=True)
    Image.fromarray(canvas, "RGB").save(dest)


def upgrade_if_failed(rows: list[dict]) -> dict:
    d_ok = all(c["radial"]["pass_ge_2x"] for c in rows)
    n_ok = all(c["nn_px"]["pass_p99_le_1_8_median"] for c in rows)
    if d_ok and n_ok:
        return {
            "trigger": False,
            "upgrade_2_wse": False,
            "post_5_lec": False,
            "reason": "§8#1 与 #2 复测仍过。②/⑤ 不触发。③ 仍休眠。",
        }
    if d_ok and not n_ok:
        return {
            "trigger": True,
            "upgrade_2_wse": False,
            "post_5_lec": True,
            "reason": "§8#2 复测失败。触发⑤ 空圆定点评估，不升③。",
        }
    return {
        "trigger": True,
        "upgrade_2_wse": True,
        "post_5_lec": False,
        "reason": "§8#1 复测失败。触发② 评估。",
    }


def main() -> None:
    s2a = load_s2a()
    s0 = s2a.load_s0()
    sampler = s2a.load_sampler()
    prior = json.loads((ROOT / "painting/radial-s2b.json").read_text(encoding="utf-8"))
    prior_u16 = {c["name"].split("-")[1]: c["hash"]["mid_u16"] for c in prior["cases"]}
    before = s2a.live_fingerprint()
    rows = []
    table = []

    for name, image, u16_path in CASES:
        raw = u16_path.read_bytes()
        got = s2a.sha256_bytes(raw)
        expect = prior_u16[name]
        if got != expect:
            raise SystemExit(f"{name}: u16 sha {got} != S2b {expect}")
        xy = decode_u16(u16_path)
        if s2a.sha256_bytes(s2a.encode_u16(xy)) != got:
            raise SystemExit(f"{name}: decode/encode drifted")

        im = Image.open(image)
        im.load()
        field = s0.eligible_field(im, sampler)
        row = s0.diagnose_one(
            f"s2c-{name}",
            xy,
            field,
            sampler,
            {
                "source_image": str(image.relative_to(ROOT)),
                "isolation_u16": str(u16_path.relative_to(ROOT)),
                "u16_sha256": got,
                "matches_s2b": True,
                "count_in_tol": bool(abs(xy.shape[0] - 50_000) <= 50_000 * 0.05),
            },
        )

        full_h = hist2d(xy)
        full_p, full_k, full_rad = power_spectrum(full_h)
        r = s2a.point_r(xy, field["cx"], field["cy"], field["R95"])
        local = local_square_window(xy, r, 0.3, 0.6, span=0.16)
        mid_h = hist2d(local)
        mid_p, mid_k, mid_rad = power_spectrum(mid_h)
        spec_full = spectrum_metrics(full_p, full_k, full_rad)
        spec_mid = spectrum_metrics(mid_p, mid_k, mid_rad)
        spec_mid["n_window"] = int(local.shape[0])
        spec_mid["note"] = "filled 0.32-square window inside r∈[0.3,0.6); not a donut mask"

        render_spectrum(full_p, ART / f"radial_s2c_{name}_fft_full.png")
        render_spectrum(mid_p, ART / f"radial_s2c_{name}_fft_mid.png")
        render_radial(mid_rad, ART / f"radial_s2c_{name}_radial_mid.png")
        if name == "dallas":
            s2a.write_band_preview(xy, field, ART / "radial_s2c_dallas_bands.png")
            render_zoom(xy, field, ART / "radial_s2c_dallas_zoom_center.png", 0.0, 0.3)
            render_zoom(xy, field, ART / "radial_s2c_dallas_zoom_edge.png", 0.85, 1.01)

        row["spectrum_full"] = spec_full
        row["spectrum_mid"] = spec_mid
        rows.append(row)
        table.append(
            {
                "name": name,
                "n": int(xy.shape[0]),
                "center_over_edge": row["radial"]["center_over_edge"],
                "pass_8_1": row["radial"]["pass_ge_2x"],
                "nn_p99_over_median": row["nn_px"]["p99_over_median"],
                "pass_8_2": row["nn_px"]["pass_p99_le_1_8_median"],
                "holes_16px": row["holes_16px"]["empty_eligible"],
                "hash_match_s2b": True,
                "mid_axis_over_off": spec_mid["axis_over_off"],
                "mid_pass_no_grid_spike": spec_mid["pass_no_grid_spike"],
            }
        )
        print(
            f"{name} n={xy.shape[0]} c/e {row['radial']['center_over_edge']} "
            f"nn {row['nn_px']['p99_over_median']} "
            f"holes {row['holes_16px']['empty_eligible']} "
            f"mid_grid {spec_mid['axis_over_off']}",
            flush=True,
        )

    after = s2a.live_fingerprint()
    if after != before:
        raise SystemExit(f"live files changed: {before} -> {after}")

    advice = upgrade_if_failed(rows)
    report = {
        "task": "S2c 质检",
        "handbook": HANDBOOK,
        "timestamp_note": "QC locked S2b u16; no resample; no live write",
        "qc_spectrum": "on (optional; visual primary)",
        "live_count_unchanged": 100000,
        "palette_unchanged": True,
        "spring_unchanged": True,
        "section8": {
            "1_density": all(t["pass_8_1"] for t in table),
            "2_holes": all(t["pass_8_2"] for t in table),
            "8_hash": True,
            "10_spectrum_optional": all(t["mid_pass_no_grid_spike"] for t in table),
            "3_to_7_and_9": "S3–S5 / 现网回归，本闸不做",
        },
        "upgrade": advice,
        "table": table,
        "live_sha256": after,
        "preview": {
            "bands": str(ART / "radial_s2c_dallas_bands.png"),
            "zoom_center": str(ART / "radial_s2c_dallas_zoom_center.png"),
            "zoom_edge": str(ART / "radial_s2c_dallas_zoom_edge.png"),
            "fft_mid": str(ART / "radial_s2c_dallas_fft_mid.png"),
            "radial_mid": str(ART / "radial_s2c_dallas_radial_mid.png"),
        },
        "cases": rows,
    }
    out = ROOT / "painting/radial-s2c.json"
    out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"section8": report["section8"], "upgrade": advice}, ensure_ascii=False))
    print(f"wrote {out.relative_to(ROOT)}", flush=True)


if __name__ == "__main__":
    main()
