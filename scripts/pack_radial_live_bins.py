#!/usr/bin/env python3
"""Pack locked S2b u16 sets into live NFPT v3 bins. Do not rewrite 100k bins."""

from __future__ import annotations

import hashlib
import json
import struct
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

LIVE_SHA = {
    "prototype/pixi-cloud/dallas-100k.bin": "6406d7012e7f637ad2e31661a85f619ebd14b85bb48a6341a1ec9c3a2dbcea82",
    "prototype/pixi-hall/scotland-100k.bin": "bbeab899140521bad56e82766f92a3d63305b8bc8f802de22db804fad3bfcf5f",
    "prototype/pixi-community/met-100k.bin": "3144fdb9144d95cb0afe30f28629ec1e065bfa5022400a80e1c8e93129779a45",
}

U16_SHA = {
    "painting/radial-s2b-dallas-50k.u16": "f6df3397eb97fef511377cdf903a89544860086a78d07c1eb0191f6ff4f3add6",
    "painting/radial-s2b-scotland-50k.u16": "700e9d525a731766fd17f4c4872754138c81a09ca40db1928dfc5865b97d914f",
    "painting/radial-s2b-met-50k.u16": "a4f4a7a1579858445140595b08883829237f466df1eb781efaed02c12b1efc46",
}

JOBS = [
    {
        "name": "dallas",
        "u16": "painting/radial-s2b-dallas-50k.u16",
        "live_bin": "prototype/pixi-cloud/dallas-100k.bin",
        "live_meta": "prototype/pixi-cloud/meta.json",
        "out_bin": "prototype/pixi-cloud/dallas-radial-50k.bin",
        "out_meta": "prototype/pixi-cloud/meta-radial.json",
        "id": "poplars-dallas-radial-50k",
        "count": 50601,
        "R95": 0.599042,
        "s0": 2.667368,
        "role": "INTRO",
    },
    {
        "name": "scotland",
        "u16": "painting/radial-s2b-scotland-50k.u16",
        "live_bin": "prototype/pixi-hall/scotland-100k.bin",
        "live_meta": "prototype/pixi-hall/meta.json",
        "out_bin": "prototype/pixi-hall/scotland-radial-50k.bin",
        "out_meta": "prototype/pixi-hall/meta-radial.json",
        "id": "poplars-scotland-radial-50k",
        "count": 50441,
        "R95": 0.599053,
        "s0": 2.354579,
        "role": "HALL",
    },
    {
        "name": "met",
        "u16": "painting/radial-s2b-met-50k.u16",
        "live_bin": "prototype/pixi-community/met-100k.bin",
        "live_meta": "prototype/pixi-community/meta.json",
        "out_bin": "prototype/pixi-community/met-radial-50k.bin",
        "out_meta": "prototype/pixi-community/meta-radial.json",
        "id": "four-trees-met-radial-50k",
        "count": 50471,
        "R95": 0.592304,
        "s0": 2.315566,
        "role": "COMMUNITY",
    },
]


def sha256_path(rel: str) -> str:
    return hashlib.sha256((ROOT / rel).read_bytes()).hexdigest()


def read_u16(rel: str) -> tuple[list[int], list[int]]:
    raw = (ROOT / rel).read_bytes()
    if len(raw) % 4:
        raise SystemExit(f"{rel} size {len(raw)} not multiple of 4")
    xs: list[int] = []
    ys: list[int] = []
    for i in range(len(raw) // 4):
        x, y = struct.unpack_from("<HH", raw, i * 4)
        xs.append(x)
        ys.append(y)
    return xs, ys


def read_nfpt(rel: str) -> list[tuple[int, int, int]]:
    raw = (ROOT / rel).read_bytes()
    if raw[:4] != b"NFPT":
        raise SystemExit(f"{rel} bad magic")
    ver, count = struct.unpack_from("<BI", raw, 4)
    if ver != 3:
        raise SystemExit(f"{rel} version {ver}")
    expected = 9 + count * 5
    if len(raw) != expected:
        raise SystemExit(f"{rel} size {len(raw)} != {expected}")
    pts: list[tuple[int, int, int]] = []
    off = 9
    for _ in range(count):
        x, y, pal = struct.unpack_from("<HHB", raw, off)
        pts.append((x, y, pal))
        off += 5
    return pts


def nearest_palette(
    xs: list[int], ys: list[int], live: list[tuple[int, int, int]], cell: int = 256
) -> tuple[list[int], list[float]]:
    buckets: dict[tuple[int, int], list[tuple[int, int, int]]] = {}
    for x, y, pal in live:
        buckets.setdefault((x // cell, y // cell), []).append((x, y, pal))
    pals: list[int] = []
    dists: list[float] = []
    for x, y in zip(xs, ys):
        cx, cy = x // cell, y // cell
        best_pal = 0
        best_d: float | None = None
        for ring in range(0, 24):
            for dy in range(-ring, ring + 1):
                for dx in range(-ring, ring + 1):
                    if ring and abs(dx) != ring and abs(dy) != ring:
                        continue
                    bucket = buckets.get((cx + dx, cy + dy))
                    if not bucket:
                        continue
                    for px, py, pal in bucket:
                        d = (px - x) * (px - x) + (py - y) * (py - y)
                        if best_d is None or d < best_d:
                            best_d = d
                            best_pal = pal
            if best_d is not None:
                break
        if best_d is None:
            raise SystemExit(f"no palette neighbor for ({x},{y})")
        pals.append(best_pal)
        dists.append(best_d ** 0.5)
    return pals, dists


def write_nfpt(rel: str, xs: list[int], ys: list[int], pals: list[int]) -> bytes:
    n = len(xs)
    buf = bytearray()
    buf += b"NFPT"
    buf += struct.pack("<BI", 3, n)
    for i in range(n):
        buf += struct.pack("<HHB", xs[i], ys[i], pals[i])
    path = ROOT / rel
    path.write_bytes(buf)
    return bytes(buf)


def main() -> None:
    for rel, expect in LIVE_SHA.items():
        got = sha256_path(rel)
        if got != expect:
            raise SystemExit(f"live bin mutated: {rel} {got}")
    for rel, expect in U16_SHA.items():
        got = sha256_path(rel)
        if got != expect:
            raise SystemExit(f"S2b u16 mutated: {rel} {got}")

    report = {"task": "pack live radial 50k NFPT", "cases": []}
    for job in JOBS:
        xs, ys = read_u16(job["u16"])
        if len(xs) != job["count"]:
            raise SystemExit(f"{job['name']} count {len(xs)} != {job['count']}")
        live = read_nfpt(job["live_bin"])
        pals, dists = nearest_palette(xs, ys, live)
        raw = write_nfpt(job["out_bin"], xs, ys, pals)
        replay = read_nfpt(job["out_bin"])
        for i, (x, y, _pal) in enumerate(replay):
            if x != xs[i] or y != ys[i]:
                raise SystemExit(f"{job['name']} coord rewrite at {i}")
        live_meta = json.loads((ROOT / job["live_meta"]).read_text())
        dists_sorted = sorted(dists)
        meta = {
            "id": job["id"],
            "w": live_meta["w"],
            "h": live_meta["h"],
            "count": job["count"],
            "stride": 5,
            "format": "<HHB",
            "endian": "little",
            "fields": ["x", "y", "idx"],
            "headerBytes": 9,
            "yAxis": "down",
            "space": "painting-source-uint16",
            "quantize": "copy S2b u16 bytes; do not re-quantize",
            "palette": live_meta["palette"],
            "sampling": "dart-thinning",
            "refine": "thinning",
            "source_u16": job["u16"],
            "source_live_bin": job["live_bin"],
            "R95": job["R95"],
            "s0_locked_px": job["s0"],
            "role": job["role"],
            "header": {"magic": "NFPT", "version": 3, "count": job["count"]},
            "bytes": len(raw),
            "sha256": hashlib.sha256(raw).hexdigest(),
            "u16_sha256": U16_SHA[job["u16"]],
            "palette_nn": {
                "cell": 256,
                "mean": round(sum(dists) / len(dists), 4),
                "p95": round(dists_sorted[int((len(dists_sorted) - 1) * 0.95)], 4),
                "max": round(dists_sorted[-1], 4),
            },
        }
        (ROOT / job["out_meta"]).write_text(json.dumps(meta, indent=2) + "\n")
        report["cases"].append(
            {
                "name": job["name"],
                "count": job["count"],
                "out_bin": job["out_bin"],
                "sha256": meta["sha256"],
                "u16_sha256": meta["u16_sha256"],
                "palette_nn": meta["palette_nn"],
            }
        )
        print(f"{job['name']} n={job['count']} sha={meta['sha256'][:16]} nn_mean={meta['palette_nn']['mean']}")

    for rel, expect in LIVE_SHA.items():
        if sha256_path(rel) != expect:
            raise SystemExit(f"live bin changed while packing {rel}")
    print(json.dumps(report, indent=2))


if __name__ == "__main__":
    main()
