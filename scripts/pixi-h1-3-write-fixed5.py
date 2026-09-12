#!/usr/bin/env python3
"""NF points.bin v3 contract (H2 / §2-B)

stride=5, little-endian <HHB, no padding, no file header
offset 0 = x(u16) / 2 = y(u16) / 4 = idx(u8)
x increases right; y increases down (painting source space)
quantize: floor(v + 0.5); out-of-range throws, never silent wrap
Python: struct.pack('<HHB', x, y, idx)
"""
from __future__ import annotations

import hashlib
import json
import struct
import sys
from pathlib import Path

FMT = "<HHB"
STRIDE = 5
# B10: three known points including boundaries 0 / 65535 / 255.
# P0.y = 1023 is the Q8 / B6 endian probe (LE ff 03, BE 03 ff).
POINTS = ((0, 1023, 0), (65535, 0, 1), (1, 65535, 255))

ROOT = Path(__file__).resolve().parent.parent
OUT = ROOT / "prototype" / "pixi-bridge"


def quantize_u16(v: float) -> int:
    q = int(v + 0.5)  # floor(v+0.5) for non-negative
    if q < 0 or q > 65535:
        raise ValueError(f"u16 out of range: {v} -> {q}")
    return q


def check_idx(idx: int) -> int:
    if idx < 0 or idx > 255:
        raise ValueError(f"idx out of range: {idx}")
    return idx


def main() -> None:
    le_size = struct.calcsize(FMT)
    native_hhb = struct.calcsize("@HHB")
    native_hbh = struct.calcsize("@HBH")
    le_hbh = struct.calcsize("<HBH")
    assert le_size == STRIDE, le_size
    # Official struct docs: no pad at end, so @HHB is 5 here.
    # The pad trap still shows on @HBH (B then H needs alignment).
    assert le_hbh == 5, le_hbh
    assert native_hbh != le_hbh, (native_hbh, le_hbh)
    probe = struct.pack("<h", 1023)
    assert probe == b"\xff\x03", probe

    buf = bytearray()
    for x, y, idx in POINTS:
        buf.extend(struct.pack(FMT, quantize_u16(x), quantize_u16(y), check_idx(idx)))
    data = bytes(buf)
    assert len(data) == len(POINTS) * STRIDE
    unpacked = list(struct.iter_unpack(FMT, data))
    assert unpacked == list(POINTS), unpacked
    assert data[2:4] == probe

    sha = hashlib.sha256(data).hexdigest()
    OUT.mkdir(parents=True, exist_ok=True)
    bin_path = OUT / "fixed5_3.bin"
    bin_path.write_bytes(data)
    (OUT / "fixed5_3.bin.sha256").write_text(f"{sha}  fixed5_3.bin\n", encoding="utf-8")
    meta = {
        "id": "fixed5_3",
        "w": 65535,
        "h": 65535,
        "count": 3,
        "stride": STRIDE,
        "format": FMT,
        "endian": "little",
        "fields": ["x", "y", "idx"],
        "headerBytes": 0,
        "yAxis": "down",
        "space": "painting-source-uint16",
        "quantize": "floor(v+0.5)",
        "paletteCount": 256,
        "palette": {"0": "#C9CFD8", "1": "#6F8FAF", "255": "#A33B2A"},
        "points": [{"x": x, "y": y, "idx": idx} for x, y, idx in POINTS],
        "endianProbe": {"offset": 2, "le": 1023, "be": 65283},
        "sha256": sha,
        "bytes": len(data),
    }
    (OUT / "meta.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {
                "byteorder": sys.byteorder,
                "calcsize_le": le_size,
                "calcsize_native_HHB": native_hhb,
                "calcsize_native_HBH": native_hbh,
                "calcsize_le_HBH": le_hbh,
                "sha256": sha,
                "bytes": len(data),
                "hex": data.hex(),
                "points": unpacked,
                "path": str(bin_path),
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
