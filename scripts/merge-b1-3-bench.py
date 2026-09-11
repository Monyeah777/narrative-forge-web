#!/usr/bin/env python3
"""B1-3 merge Path A + Path B benches and check acceptance."""

from __future__ import annotations

import json
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
A = ROOT / "painting" / "b1-3-path-a-bench.json"
B = ROOT / "painting" / "b1-3-path-b-bench.json"
OUT = ROOT / "painting" / "b1-3-bench.json"
POINTS_A = ROOT / "painting" / "points.json"
POINTS_B = ROOT / "painting" / "points-path-b.json"


def main() -> int:
    a = json.loads(A.read_text())
    b = json.loads(B.read_text())
    pa = json.loads(POINTS_A.read_text()) if POINTS_A.exists() else None
    pb = json.loads(POINTS_B.read_text()) if POINTS_B.exists() else None

    a_count = a["runs"][0]["count"]
    b_count = b["count"]
    counts_match = a_count == b_count == 12000
    keys_a = ["id", "w", "h", "count", "note", "palette", "points"]
    keys_b = b.get("keys") or (list(pb.keys()) if pb else [])
    interface_match = list(keys_b) == keys_a or set(keys_b) == set(keys_a)

    report = {
        "task": "B1-3",
        "chosen_path": "A",
        "path_a": {
            "image_load_ms": a["image_load_ms"],
            "run1_sample_ms": a["runs"][0]["sample_ms"],
            "run2_sample_ms": a["runs"][1]["sample_ms"],
            "a_twice_identical": a["a_twice_identical"],
            "sha256": a["runs"][0]["sha256"],
            "gzip_bytes": a["runs"][0]["gzip_bytes"],
            "json_read_ms": (a.get("committed_points") or {}).get("read_ms"),
            "count": a_count,
        },
        "path_b": {
            "timing": b.get("timing"),
            "count": b_count,
            "points_len": b.get("points_len"),
            "palette_len": b.get("palette_len"),
            "getImageData_calls": (b.get("timing") or {}).get("getImageData_calls"),
            "willReadFrequently": (b.get("timing") or {}).get("willReadFrequently"),
        },
        "acceptance": {
            "load_timing_recorded": True,
            "a_twice_identical": bool(a["a_twice_identical"]),
            "b_count_equals_a_count": counts_match,
            "interface_keys_match": interface_match,
            "getImageData_once": (b.get("timing") or {}).get("getImageData_calls") == 1,
            "pass": bool(a["a_twice_identical"])
            and counts_match
            and interface_match
            and (b.get("timing") or {}).get("getImageData_calls") == 1,
        },
        "note": "Prototype fetch/preload wiring deferred to B1-4.",
    }
    if pa and pb:
        report["path_b"]["w"] = pb.get("w")
        report["path_b"]["h"] = pb.get("h")
        report["dims_match"] = pa.get("w") == pb.get("w") and pa.get("h") == pb.get("h")

    OUT.write_text(json.dumps(report, indent=2, ensure_ascii=True) + "\n")
    print(json.dumps(report, indent=2, ensure_ascii=True))
    if not report["acceptance"]["pass"]:
        raise SystemExit("B1-3 acceptance failed")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
