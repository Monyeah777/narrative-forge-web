#!/usr/bin/env python3
"""B1-3 Path A bench: two runs, byte-identical check, wall-clock load+sample timing."""

from __future__ import annotations

import gzip
import hashlib
import importlib.util
import json
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]


def load_sample_mod():
    spec = importlib.util.spec_from_file_location(
        "sample_painting", ROOT / "scripts" / "sample-painting.py"
    )
    mod = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(mod)
    return mod


def compact(payload: dict) -> bytes:
    return (json.dumps(payload, separators=(",", ":"), ensure_ascii=True) + "\n").encode(
        "utf-8"
    )


def main() -> int:
    from PIL import Image

    mod = load_sample_mod()
    if not mod.DEFAULT_IMAGE.exists():
        raise SystemExit(f"missing {mod.DEFAULT_IMAGE}")

    t_load0 = time.perf_counter()
    im = Image.open(mod.DEFAULT_IMAGE)
    im.load()
    rgb = im.convert("RGB")
    t_load1 = time.perf_counter()
    load_ms = (t_load1 - t_load0) * 1000.0

    t_json0 = time.perf_counter()
    committed = mod.DEFAULT_POINTS.read_bytes() if mod.DEFAULT_POINTS.exists() else b""
    t_json1 = time.perf_counter()
    json_read_ms = (t_json1 - t_json0) * 1000.0

    runs = []
    payloads = []
    for i in range(2):
        t0 = time.perf_counter()
        payload, _stats, _ = mod.sample_image(
            rgb,
            count=mod.COUNT,
            k=mod.K_DEFAULT,
            seed=mod.SEED_DEFAULT,
            dark_L=mod.DARK_L_DEFAULT,
            relax_rounds=mod.RELAX_DEFAULT,
        )
        t1 = time.perf_counter()
        raw = compact(payload)
        runs.append(
            {
                "run": i + 1,
                "sample_ms": round((t1 - t0) * 1000.0, 3),
                "bytes": len(raw),
                "gzip_bytes": len(gzip.compress(raw, compresslevel=9)),
                "sha256": hashlib.sha256(raw).hexdigest(),
                "count": payload["count"],
                "points_len": len(payload["points"]),
                "palette_len": len(payload["palette"]),
                "keys": list(payload.keys()),
            }
        )
        payloads.append(raw)

    identical = payloads[0] == payloads[1]
    committed_info = None
    if committed:
        committed_info = {
            "path": str(mod.DEFAULT_POINTS.relative_to(ROOT)),
            "bytes": len(committed),
            "read_ms": round(json_read_ms, 3),
            "sha256": hashlib.sha256(committed).hexdigest(),
            "matches_run": committed == payloads[0],
        }

    out = {
        "path": "A",
        "tool": "scripts/sample-painting.py (Pillow + numpy)",
        "image": str(mod.DEFAULT_IMAGE.relative_to(ROOT)),
        "image_load_ms": round(load_ms, 3),
        "runs": runs,
        "a_twice_identical": identical,
        "committed_points": committed_info,
        "acceptance": {
            "a_twice_identical": identical,
            "count_12000": runs[0]["count"] == 12000 and runs[1]["count"] == 12000,
        },
    }
    dest = ROOT / "painting" / "b1-3-path-a-bench.json"
    dest.write_text(json.dumps(out, indent=2, ensure_ascii=True) + "\n")
    print(json.dumps(out, indent=2))
    if not identical:
        raise SystemExit("Path A two runs diverged")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
