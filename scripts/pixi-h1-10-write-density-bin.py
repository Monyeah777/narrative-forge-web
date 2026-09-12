#!/usr/bin/env python3
"""H1-⑩: sample Dallas 150k / 250k points.bin v3 for isolated density bench.

Does not overwrite prototype/pixi-cloud/dallas-100k.bin.
Does not write painting/points.json or change live INTRO.
Same red lines as H1-④: master LANCZOS short side 2400, dark_L=0.19,
seed 0x4E46, k=256, relax=3, <HHB stride 5, NFPT header.
"""
from __future__ import annotations

import importlib.util
import json
import struct
import sys
import time
from pathlib import Path

from PIL import Image

from nf_points_bin import FMT, HEADER_BYTES, STRIDE, VERSION, parse_header, write_bin

ROOT = Path(__file__).resolve().parents[1]
MASTER = ROOT / "painting/masters/dallas_lespeupliers_5497x7054.jpg"
PREVIEW = ROOT / "painting/01-dallas.jpg"
CLOUD_BIN = ROOT / "prototype/pixi-cloud/dallas-100k.bin"
OUT = ROOT / "prototype/pixi-density"
SHORT_SIDE = 2400  # I-2: source sample ≥2200px
SEED = 0x4E46
DARK_L = 0.19
K = 256
RELAX = 3
TIERS = (150_000, 250_000)


def load_sampler():
    spec = importlib.util.spec_from_file_location(
        "sample_painting", ROOT / "scripts/sample-painting.py"
    )
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def quantize_u16(v: float) -> int:
    q = int(v * 65535 + 0.5)
    if q < 0 or q > 65535:
        raise ValueError(f"u16 out of range: {v} -> {q}")
    return q


def load_source() -> tuple[Image.Image, dict]:
    if MASTER.exists():
        im = Image.open(MASTER)
        im.load()
        src = MASTER
        note = "master LANCZOS to short side 2400"
    elif PREVIEW.exists():
        im = Image.open(PREVIEW)
        im.load()
        src = PREVIEW
        note = "preview 1200px (master missing)"
    else:
        raise SystemExit("no Dallas source")
    im = im.convert("RGB")
    w, h = im.size
    short = min(w, h)
    if short > SHORT_SIDE:
        if w <= h:
            nw, nh = SHORT_SIDE, round(h * SHORT_SIDE / w)
        else:
            nh, nw = SHORT_SIDE, round(w * SHORT_SIDE / h)
        im = im.resize((nw, nh), Image.Resampling.LANCZOS)
    return im, {"src": str(src.relative_to(ROOT)), "src_px": [w, h], "note": note}


def write_tier(im: Image.Image, src_meta: dict, sampler, count: int) -> dict:
    t0 = time.perf_counter()
    print(f"sampling n={count} {im.size} {src_meta}", file=sys.stderr, flush=True)
    payload, stats, _scatter = sampler.sample_image(
        im,
        count=count,
        k=K,
        seed=SEED,
        dark_L=DARK_L,
        relax_rounds=RELAX,
    )
    buf = bytearray()
    for x, y, idx in payload["points"]:
        if idx < 0 or idx > 255:
            raise ValueError(f"idx out of range: {idx}")
        buf.extend(struct.pack(FMT, quantize_u16(x), quantize_u16(y), idx))
    raw = bytes(buf)
    assert len(raw) == count * STRIDE
    stem = f"dallas-{count // 1000}k"
    OUT.mkdir(parents=True, exist_ok=True)
    bin_path = OUT / f"{stem}.bin"
    info = write_bin(bin_path, raw, count)
    sha = info["sha256"]
    meta = {
        "id": payload["id"],
        "w": payload["w"],
        "h": payload["h"],
        "count": count,
        "stride": STRIDE,
        "format": FMT,
        "endian": "little",
        "fields": ["x", "y", "idx"],
        "headerBytes": HEADER_BYTES,
        "header": {"magic": "NFPT", "version": VERSION, "count": count},
        "payloadSha256": info["payloadSha256"],
        "yAxis": "down",
        "space": "painting-source-uint16",
        "quantize": "floor(v*65535+0.5)",
        "palette": payload["palette"],
        "sha256": sha,
        "bytes": info["bytes"],
        "source": src_meta,
        "sample": {
            "dark_L": DARK_L,
            "weight": stats["weight"],
            "seed": SEED,
            "k": K,
            "relax": RELAX,
            "dark_cull_pct": stats["dark_cull_pct"],
        },
    }
    (OUT / f"meta-{count // 1000}k.json").write_text(
        json.dumps(meta, indent=2) + "\n", encoding="utf-8"
    )
    rec = {
        "sha256": sha,
        "bytes": info["bytes"],
        "count": count,
        "file": str(bin_path.relative_to(ROOT)),
        "sampled_wh": [payload["w"], payload["h"]],
        "source": src_meta,
        "dark_cull_pct": stats["dark_cull_pct"],
        "deltaE_ok_100_mean": stats["deltaE_ok_100"]["mean"],
        "holes_after": stats["holes_after"],
        "seconds": round(time.perf_counter() - t0, 3),
    }
    print(json.dumps(rec, indent=2), flush=True)
    return rec


def main() -> None:
    assert struct.calcsize(FMT) == STRIDE
    if CLOUD_BIN.exists():
        frozen = parse_header(CLOUD_BIN.read_bytes())
        print(
            f"frozen 100k left untouched sha256={frozen['sha256']} payload={frozen['payloadSha256']}",
            file=sys.stderr,
            flush=True,
        )
    sampler = load_sampler()
    im, src_meta = load_source()
    counts = [int(a) for a in sys.argv[1:]] if len(sys.argv) > 1 else list(TIERS)
    for count in counts:
        if count not in TIERS:
            raise SystemExit(f"unsupported count {count}; allowed {TIERS}")
        write_tier(im, src_meta, sampler, count)


if __name__ == "__main__":
    main()
