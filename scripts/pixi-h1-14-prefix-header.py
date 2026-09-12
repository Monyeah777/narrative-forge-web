#!/usr/bin/env python3
"""Prefix approved H2 header onto existing headerless bins. Payload bytes stay identical."""
from __future__ import annotations

import hashlib
import json
import sys
from pathlib import Path

from nf_points_bin import HEADER_BYTES, MAGIC, VERSION, wrap_payload, parse_header

ROOT = Path(__file__).resolve().parents[1]

BINS = (
    (ROOT / "prototype/pixi-bridge/fixed5_3.bin", ROOT / "prototype/pixi-bridge/meta.json", 3),
    (ROOT / "prototype/pixi-cloud/dallas-100k.bin", ROOT / "prototype/pixi-cloud/meta.json", 100000),
    (ROOT / "prototype/pixi-hall/scotland-100k.bin", ROOT / "prototype/pixi-hall/meta.json", 100000),
    (ROOT / "prototype/pixi-community/met-100k.bin", ROOT / "prototype/pixi-community/meta.json", 100000),
    (ROOT / "prototype/pixi-density/dallas-150k.bin", ROOT / "prototype/pixi-density/meta-150k.json", 150000),
    (ROOT / "prototype/pixi-density/dallas-250k.bin", ROOT / "prototype/pixi-density/meta-250k.json", 250000),
)


def prefix_one(bin_path: Path, meta_path: Path, count: int) -> dict:
    raw = bin_path.read_bytes()
    if raw[:4] == MAGIC:
        info = parse_header(raw)
        if info["count"] != count:
            raise SystemExit(f"{bin_path}: header count {info['count']} != {count}")
        return {"path": str(bin_path.relative_to(ROOT)), "already": True, **info}
    if len(raw) != count * 5:
        raise SystemExit(f"{bin_path}: headerless length {len(raw)} != {count}*5")
    payload_sha = hashlib.sha256(raw).hexdigest()
    data = wrap_payload(raw, count)
    assert data[HEADER_BYTES:] == raw
    bin_path.write_bytes(data)
    info = parse_header(data)
    if info["payloadSha256"] != payload_sha:
        raise SystemExit(f"{bin_path}: payload drifted")
    bin_path.with_name(bin_path.name + ".sha256").write_text(
        f"{info['sha256']}  {bin_path.name}\n", encoding="utf-8"
    )
    meta = json.loads(meta_path.read_text(encoding="utf-8"))
    if meta.get("count") != count:
        raise SystemExit(f"{meta_path}: count {meta.get('count')} != {count}")
    old_sha = meta.get("sha256")
    if old_sha and old_sha != payload_sha:
        raise SystemExit(f"{meta_path}: meta sha {old_sha} != payload {payload_sha}")
    meta["headerBytes"] = HEADER_BYTES
    meta["header"] = {"magic": "NFPT", "version": VERSION, "count": count}
    meta["payloadSha256"] = payload_sha
    meta["sha256"] = info["sha256"]
    meta["bytes"] = info["bytes"]
    if "endianProbe" in meta:
        meta["endianProbe"]["offset"] = HEADER_BYTES + 2
    meta_path.write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    return {
        "path": str(bin_path.relative_to(ROOT)),
        "already": False,
        "payloadSha256": payload_sha,
        **info,
    }


def main() -> None:
    rows = [prefix_one(bin_path, meta_path, count) for bin_path, meta_path, count in BINS]
    print(json.dumps({"version": VERSION, "headerBytes": HEADER_BYTES, "files": rows}, indent=2))


if __name__ == "__main__":
    main()
