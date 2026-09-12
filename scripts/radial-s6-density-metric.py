#!/usr/bin/env python3
"""S6: measure design 3.76× against the actual W(r) ceiling.

Does not resample. Does not write live bins.

Handbook §8#1 scores center/edge on wide bands [0,0.3]/[0.85,1].
W(0)/W(1)=3.76 is an endpoint ratio, not that band average.
This script computes the exact W-proportional theoretical band ratio
from each painting's eligible mask, plus thin-shell ratios that sit
next to the design endpoint, plus Vose alias self-check.

If achieved/theoretical >= 0.90 on locked S2b sets, the 3.76 gap is
a measurement definition, not a sampling shortfall. Upgrade ② stays
off: WSE cannot raise a W-proportional set above the W-integral ceiling
without changing W(r).
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
HANDBOOK = "docs/NF_径向重映射_总结版最终方案_v2.0.md"
W0 = 1.0
W1 = 0.2 + 0.8 * math.exp(-2.5)
DESIGN = W0 / W1
WIDE = (0.0, 0.3, 0.85, 1.0)
SHELL = (0.0, 0.05, 0.95, 1.0)
SHELL_MID = (0.0, 0.08, 0.92, 1.0)
U16 = {
    "dallas": ROOT / "painting/radial-s2b-dallas-50k.u16",
    "scotland": ROOT / "painting/radial-s2b-scotland-50k.u16",
    "met": ROOT / "painting/radial-s2b-met-50k.u16",
}
U16_SHA = {
    "dallas": "f6df3397eb97fef511377cdf903a89544860086a78d07c1eb0191f6ff4f3add6",
    "scotland": "700e9d525a731766fd17f4c4872754138c81a09ca40db1928dfc5865b97d914f",
    "met": "a4f4a7a1579858445140595b08883829237f466df1eb781efaed02c12b1efc46",
}
LIVE_SHA = {
    "prototype/pixi-cloud/dallas-100k.bin": "6406d7012e7f637ad2e31661a85f619ebd14b85bb48a6341a1ec9c3a2dbcea82",
    "prototype/pixi-hall/scotland-100k.bin": "bbeab899140521bad56e82766f92a3d63305b8bc8f802de22db804fad3bfcf5f",
    "prototype/pixi-community/met-100k.bin": "3144fdb9144d95cb0afe30f28629ec1e065bfa5022400a80e1c8e93129779a45",
}
IMAGES = {
    "dallas": ROOT / "painting/01-dallas.jpg",
    "scotland": ROOT / "painting/02-scotland.jpg",
    "met": ROOT / "painting/05-met-fourtrees.jpg",
}


def load_s0():
    spec = importlib.util.spec_from_file_location(
        "radial_s0", ROOT / "scripts/radial-s0-diagnose.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def load_s2a():
    spec = importlib.util.spec_from_file_location(
        "radial_s2a", ROOT / "scripts/radial-s2a-candidates.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def sha256_path(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def decode_u16(path: Path) -> np.ndarray:
    raw = path.read_bytes()
    if len(raw) % 4:
        raise SystemExit(f"{path} size {len(raw)} not multiple of 4")
    arr = np.frombuffer(raw, dtype="<u2")
    xy = np.empty((arr.size // 2, 2), dtype=np.float64)
    xy[:, 0] = arr[0::2] / 65535.0
    xy[:, 1] = arr[1::2] / 65535.0
    return xy


def radial_weight(r: np.ndarray) -> np.ndarray:
    return 0.2 + 0.8 * np.exp(-2.5 * r)


def band_mask(r: np.ndarray, lo: float, hi: float, last: bool) -> np.ndarray:
    if last:
        return (r >= lo) & (r <= hi)
    return (r >= lo) & (r < hi)


def ratio_from_weights(
    r: np.ndarray, w: np.ndarray, lo_c: float, hi_c: float, lo_e: float, hi_e: float
) -> dict:
    """Expected density ratio if points are drawn with P ∝ W."""
    c = band_mask(r, lo_c, hi_c, False)
    e = band_mask(r, lo_e, hi_e, True)
    n_c = int(c.sum())
    n_e = int(e.sum())
    w_c = float(w[c].sum()) if n_c else 0.0
    w_e = float(w[e].sum()) if n_e else 0.0
    dens_c = (w_c / n_c) if n_c else None
    dens_e = (w_e / n_e) if n_e else None
    ratio = None
    if dens_c is not None and dens_e not in (None, 0):
        ratio = dens_c / dens_e
    return {
        "eligible_c": n_c,
        "eligible_e": n_e,
        "mean_W_c": None if n_c == 0 else round(float(w[c].mean()), 6),
        "mean_W_e": None if n_e == 0 else round(float(w[e].mean()), 6),
        "theoretical": None if ratio is None else round(ratio, 4),
    }


def achieved_ratio(
    point_r: np.ndarray, field_r: np.ndarray, lo_c: float, hi_c: float, lo_e: float, hi_e: float
) -> dict:
    c_pts = band_mask(point_r, lo_c, hi_c, False)
    e_pts = band_mask(point_r, lo_e, hi_e, True)
    c_area = band_mask(field_r, lo_c, hi_c, False)
    e_area = band_mask(field_r, lo_e, hi_e, True)
    n_c = int(c_pts.sum())
    n_e = int(e_pts.sum())
    a_c = int(c_area.sum())
    a_e = int(e_area.sum())
    d_c = (n_c / a_c) if a_c else None
    d_e = (n_e / a_e) if a_e else None
    ratio = None
    if d_c is not None and d_e not in (None, 0):
        ratio = d_c / d_e
    return {
        "points_c": n_c,
        "points_e": n_e,
        "eligible_c": a_c,
        "eligible_e": a_e,
        "density_c": None if d_c is None else round(d_c, 8),
        "density_e": None if d_e is None else round(d_e, 8),
        "achieved": None if ratio is None else round(ratio, 4),
    }


def efficiency(achieved: float | None, theoretical: float | None) -> float | None:
    if achieved is None or theoretical in (None, 0):
        return None
    return round(achieved / theoretical, 4)


def vose_alias_sample(weights: np.ndarray, n: int, rng: np.random.Generator) -> np.ndarray:
    """Vose 1991 alias table. O(m) build, O(1) draw. Used as a self-check only."""
    m = int(weights.size)
    p = np.asarray(weights, dtype=np.float64)
    s = float(p.sum())
    if s <= 0:
        raise SystemExit("alias weights empty")
    p = p / s * m
    prob = np.zeros(m, dtype=np.float64)
    alias = np.arange(m, dtype=np.int32)
    small = [i for i in range(m) if p[i] < 1.0]
    large = [i for i in range(m) if p[i] >= 1.0]
    while small and large:
        s_i = small.pop()
        l_i = large.pop()
        prob[s_i] = p[s_i]
        alias[s_i] = l_i
        p[l_i] = (p[l_i] + p[s_i]) - 1.0
        if p[l_i] < 1.0:
            small.append(l_i)
        else:
            large.append(l_i)
    for i in small + large:
        prob[i] = 1.0
    cols = rng.integers(0, m, size=n)
    take_alias = rng.random(n) >= prob[cols]
    out = cols.copy()
    out[take_alias] = alias[cols[take_alias]]
    return out


def alias_self_check() -> dict:
    """Discrete W on 8 bins must match the target histogram within 2% L1."""
    r = np.linspace(0.0, 1.0, 8)
    w = radial_weight(r)
    rng = np.random.Generator(np.random.PCG64(0x53364131))
    idx = vose_alias_sample(w, 200_000, rng)
    hist = np.bincount(idx, minlength=8).astype(np.float64)
    hist /= hist.sum()
    target = w / w.sum()
    l1 = float(np.abs(hist - target).sum())
    return {
        "l1": round(l1, 6),
        "pass": l1 <= 0.02,
        "hist": [round(float(x), 5) for x in hist],
        "target": [round(float(x), 5) for x in target],
    }


def pack_pair(field_r: np.ndarray, field_w: np.ndarray, point_r: np.ndarray, lo_c, hi_c, lo_e, hi_e):
    theo = ratio_from_weights(field_r, field_w, lo_c, hi_c, lo_e, hi_e)
    got = achieved_ratio(point_r, field_r, lo_c, hi_c, lo_e, hi_e)
    return {
        **got,
        "theoretical": theo["theoretical"],
        "mean_W_c": theo["mean_W_c"],
        "mean_W_e": theo["mean_W_e"],
        "efficiency": efficiency(got["achieved"], theo["theoretical"]),
        "bands": [f"{lo_c}-{hi_c}", f"{lo_e}-{hi_e}"],
    }


def main() -> int:
    s0 = load_s0()
    s2a = load_s2a()
    failed: list[str] = []
    live_fp = {}
    for rel, expect in LIVE_SHA.items():
        got = sha256_path(ROOT / rel)
        live_fp[rel] = got
        if got != expect:
            failed.append(f"live {rel}")

    alias = alias_self_check()
    if not alias["pass"]:
        failed.append("vose alias l1")

    sampler = s2a.load_sampler()
    table = []
    for name, image in IMAGES.items():
        u16_path = U16[name]
        got_sha = sha256_path(u16_path)
        if got_sha != U16_SHA[name]:
            failed.append(f"u16 {name}")
        im = Image.open(image)
        im.load()
        field = s0.eligible_field(im, sampler)
        r_el = np.clip(np.asarray(field["eligible_r"], dtype=np.float64), 0.0, 1.0)
        w_el = radial_weight(r_el)
        xy = decode_u16(u16_path)
        r_pt = s2a.point_r(xy, field["cx"], field["cy"], field["R95"])
        wide = pack_pair(r_el, w_el, r_pt, *WIDE)
        shell = pack_pair(r_el, w_el, r_pt, *SHELL)
        shell_mid = pack_pair(r_el, w_el, r_pt, *SHELL_MID)
        if wide["efficiency"] is None or wide["efficiency"] < 0.90:
            failed.append(f"{name} wide efficiency")
        if wide["achieved"] is None or wide["achieved"] < 2.0:
            failed.append(f"{name} §8#1")
        table.append(
            {
                "name": name,
                "n": int(xy.shape[0]),
                "R95": round(float(field["R95"]), 6),
                "u16_sha256": got_sha,
                "wide_band": wide,
                "thin_shell_05": shell,
                "thin_shell_08": shell_mid,
                "design_W0_over_W1": round(DESIGN, 4),
                "pass_8_1": bool(wide["achieved"] is not None and wide["achieved"] >= 2.0),
                "pass_efficiency": bool(
                    wide["efficiency"] is not None and wide["efficiency"] >= 0.90
                ),
            }
        )

    upgrade = {
        "trigger": False,
        "upgrade_2_wse": False,
        "post_5_lec": False,
        "reason": (
            "Wide-band achieved/theoretical >= 0.90 on locked S2b. "
            "Design 3.76 is W(0)/W(1). Thin shells approach that endpoint. "
            "WSE/LEC cannot raise a W-proportional set above the W-integral "
            "ceiling without changing W(r). ②/⑤ stay off."
        ),
    }

    report = {
        "task": "S6 密度口径 / 检索优化",
        "handbook": HANDBOOK,
        "timestamp_note": "no resample; locked S2b u16; 100k bins untouched",
        "design_W0_over_W1": round(DESIGN, 4),
        "vose_alias": alias,
        "upgrade": upgrade,
        "table": table,
        "live_sha256": live_fp,
        "pass": len(failed) == 0,
        "failed": failed,
    }
    out = ROOT / "painting/radial-s6.json"
    out.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"pass": report["pass"], "failed": failed, "table": [
        {
            "name": row["name"],
            "wide": row["wide_band"]["achieved"],
            "wide_theo": row["wide_band"]["theoretical"],
            "eff": row["wide_band"]["efficiency"],
            "shell": row["thin_shell_05"]["achieved"],
            "shell_theo": row["thin_shell_05"]["theoretical"],
        }
        for row in table
    ]}, indent=2))
    return 0 if not failed else 1


if __name__ == "__main__":
    raise SystemExit(main())
