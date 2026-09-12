#!/usr/bin/env python3
"""H1-④: sample Dallas ≥2200px → points.bin v3 (100k). Does not touch live 12k JSON."""
from __future__ import annotations

import hashlib
import importlib.util
import json
import struct
import sys
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parents[1]
MASTER = ROOT / "painting/masters/dallas_lespeupliers_5497x7054.jpg"
PREVIEW = ROOT / "painting/01-dallas.jpg"
OUT = ROOT / "prototype/pixi-cloud"
FMT = "<HHB"
STRIDE = 5
COUNT = 100_000
SHORT_SIDE = 2400  # I-2: source sample ≥2200px
SEED = 0x4E46
DARK_L = 0.19
K = 256
RELAX = 3


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


def main() -> None:
    assert struct.calcsize(FMT) == STRIDE
    sampler = load_sampler()
    im, src_meta = load_source()
    print("sampling", im.size, src_meta, file=sys.stderr)
    payload, stats, _scatter = sampler.sample_image(
        im,
        count=COUNT,
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
    data = bytes(buf)
    assert len(data) == COUNT * STRIDE
    sha = hashlib.sha256(data).hexdigest()
    OUT.mkdir(parents=True, exist_ok=True)
    (OUT / "dallas-100k.bin").write_bytes(data)
    (OUT / "dallas-100k.bin.sha256").write_text(f"{sha}  dallas-100k.bin\n", encoding="utf-8")
    meta = {
        "id": payload["id"],
        "w": payload["w"],
        "h": payload["h"],
        "count": COUNT,
        "stride": STRIDE,
        "format": FMT,
        "endian": "little",
        "fields": ["x", "y", "idx"],
        "headerBytes": 0,
        "yAxis": "down",
        "space": "painting-source-uint16",
        "quantize": "floor(v*65535+0.5)",
        "palette": payload["palette"],
        "sha256": sha,
        "bytes": len(data),
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
    (OUT / "meta.json").write_text(json.dumps(meta, indent=2) + "\n", encoding="utf-8")
    print(
        json.dumps(
            {
                "sha256": sha,
                "bytes": len(data),
                "count": COUNT,
                "sampled_wh": [payload["w"], payload["h"]],
                "source": src_meta,
                "dark_cull_pct": stats["dark_cull_pct"],
                "deltaE_ok_100_mean": stats["deltaE_ok_100"]["mean"],
                "holes_after": stats["holes_after"],
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    main()
