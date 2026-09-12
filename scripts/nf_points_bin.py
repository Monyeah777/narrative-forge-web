"""NF points.bin v3 on-disk header (H2, approved 2026-09-12).

Header (9 bytes):
  0..3 magic   ASCII NFPT
  4     version uint8 = 3  (payload contract v3)
  5..8  count   uint32 little-endian
Payload: count * 5 bytes little-endian <HHB, no padding.
Do not add fields beyond magic / version / count.
Do not resample payload when wrapping a header.
"""
from __future__ import annotations

import hashlib
import struct
from pathlib import Path

MAGIC = b"NFPT"
VERSION = 3
HEADER_BYTES = 9
STRIDE = 5
FMT = "<HHB"


def pack_header(count: int) -> bytes:
    if count < 0 or count > 0xFFFFFFFF:
        raise ValueError(f"count out of range: {count}")
    return MAGIC + bytes([VERSION]) + struct.pack("<I", count)


def wrap_payload(payload: bytes, count: int | None = None) -> bytes:
    if len(payload) % STRIDE != 0:
        raise ValueError(f"payload {len(payload)} not multiple of {STRIDE}")
    n = len(payload) // STRIDE
    if count is not None and n != count:
        raise ValueError(f"count {count} != payload points {n}")
    return pack_header(n) + payload


def parse_header(buf: bytes) -> dict:
    if len(buf) < HEADER_BYTES:
        raise ValueError(f"short header {len(buf)}")
    if buf[:4] != MAGIC:
        raise ValueError(f"bad magic {buf[:4]!r}")
    version = buf[4]
    if version != VERSION:
        raise ValueError(f"bad version {version}")
    count = struct.unpack_from("<I", buf, 5)[0]
    expected = HEADER_BYTES + count * STRIDE
    if len(buf) != expected:
        raise ValueError(f"byteLength {len(buf)} !== HEADER+count*STRIDE {expected}")
    return {
        "magic": MAGIC.decode("ascii"),
        "version": version,
        "count": count,
        "headerBytes": HEADER_BYTES,
        "payloadSha256": hashlib.sha256(buf[HEADER_BYTES:]).hexdigest(),
        "sha256": hashlib.sha256(buf).hexdigest(),
        "bytes": len(buf),
    }


def write_bin(path: Path, payload: bytes, count: int) -> dict:
    data = wrap_payload(payload, count)
    info = parse_header(data)
    path.write_bytes(data)
    path.with_name(path.name + ".sha256").write_text(
        f"{info['sha256']}  {path.name}\n", encoding="utf-8"
    )
    return info
