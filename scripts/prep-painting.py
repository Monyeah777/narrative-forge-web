#!/usr/bin/env python3
"""B1-1: bake the unique in-repo painting preview.

Pipeline (handbook B1-1):
  1. ImageOps.exif_transpose — apply EXIF Orientation, then drop the tag
  2. Convert to RGB
  3. Dallas stand-in: crop the inner canvas (drop museum frame / easel)
  4. Resize to width=1200, aspect preserved, Image.Resampling.LANCZOS
  5. HSV saturation ×0.88 (hue and value untouched; allowed −10%…−15%)

The HD master is archive-only and must not be committed. If --input is omitted
and painting/ has no author file, the script fetches the public-domain
「01 达拉斯」preview (Monet, Poplars, Pink Effect, DMA 2019.67.14.McD).

Refs:
  https://pillow.readthedocs.io/en/stable/reference/ImageOps.html
  https://pillow.readthedocs.io/en/stable/reference/Image.html
  https://pillow.readthedocs.io/en/stable/reference/ImageEnhance.html
  https://commons.wikimedia.org/wiki/File:Claude_Monet_-_Poplars,_Pink_Effect_-_2019.67.14.McD_-_Dallas_Museum_of_Art.jpg
"""

from __future__ import annotations

import argparse
import colorsys
import io
import json
import math
import os
import sys
import tempfile
import urllib.parse
import urllib.request
from pathlib import Path

from PIL import ExifTags, Image, ImageDraw, ImageFont, ImageOps

ROOT = Path(__file__).resolve().parents[1]
PAINTING_DIR = ROOT / "painting"
DEFAULT_OUTPUT = PAINTING_DIR / "01-dallas.jpg"
SOURCE_JSON = PAINTING_DIR / "source.json"
TARGET_W = 1200
SAT_FACTOR = 0.88
JPEG_QUALITY = 92

DALLAS = {
    "id": "poplars-dallas",
    "title": "Poplars, Pink Effect",
    "artist": "Claude Monet",
    "year": 1891,
    "museum": "Dallas Museum of Art",
    "accession": "2019.67.14.McD",
    "objectUrl": "https://www.dma.org/art/collection/object/5327894",
    "commonsUrl": (
        "https://commons.wikimedia.org/wiki/File:"
        "Claude_Monet_-_Poplars,_Pink_Effect_-_2019.67.14.McD_-_Dallas_Museum_of_Art.jpg"
    ),
    "license": "Public domain",
    "standIn": True,
}

# Author 素材清单 (painting/masters/_素材清单.md). HD files stay out of git.
WORKS: list[dict] = [
    {
        "id": "poplars-dallas",
        "file": "01-dallas.jpg",
        "master": "dallas_lespeupliers_5497x7054.jpg",
        "title": "Les peupliers (Poplars, Pink Effect)",
        "artist": "Claude Monet",
        "year": 1891,
        "museum": "Dallas Museum of Art",
        "accession": "2019.67.14.McD",
        "objectUrl": "https://www.dma.org/art/collection/object/5327894",
        "commonsUrl": (
            "https://commons.wikimedia.org/wiki/File:"
            "Claude_Monet_-_Poplars,_Pink_Effect_-_2019.67.14.McD_-_Dallas_Museum_of_Art.jpg"
        ),
        "license": "Public domain",
        "note": "W1304 · three-tree composition · current engineering source",
        "primary": True,
    },
    {
        "id": "poplars-scotland",
        "file": "02-scotland.jpg",
        "master": "scotland_GAP_4001.jpg",
        "title": "Poplars on the Epte",
        "artist": "Claude Monet",
        "year": 1891,
        "museum": "National Galleries of Scotland",
        "accession": None,
        "objectUrl": "https://www.nationalgalleries.org/art-and-artists/8662",
        "commonsUrl": (
            "https://commons.wikimedia.org/wiki/File:"
            "Claude_Monet_-_Poplars_on_the_Epte_-_Google_Art_Project.jpg"
        ),
        "license": "Public domain",
        "note": "Google Art Project scan · square 4001×4001",
        "primary": False,
    },
    {
        "id": "poplars-philadelphia-gap",
        "file": "03-philadelphia-gap.jpg",
        "master": "philadelphia_GAP_4248x5353.jpg",
        "title": "Poplars (on the Bank of the Epte River)",
        "artist": "Claude Monet",
        "year": 1891,
        "museum": "Philadelphia Museum of Art",
        "accession": None,
        "objectUrl": "https://www.philamuseum.org/collection/object/104468",
        "commonsUrl": (
            "https://commons.wikimedia.org/wiki/File:"
            "Claude_Monet,_French_-_Poplars_-_Google_Art_Project.jpg"
        ),
        "license": "Public domain",
        "note": "Google Art Project scan",
        "primary": False,
    },
    {
        "id": "poplars-philadelphia-upload",
        "file": "04-philadelphia-upload.jpg",
        "master": "philadelphia_upload_4249x5490.jpg",
        "title": "Poplars (Philadelphia, community scan)",
        "artist": "Claude Monet",
        "year": 1891,
        "museum": "Philadelphia Museum of Art",
        "accession": None,
        "objectUrl": "https://www.philamuseum.org/collection/object/104468",
        "commonsUrl": (
            "https://commons.wikimedia.org/wiki/File:"
            "Claude_Monet_-_Poplars,_Philadelphia.JPG"
        ),
        "license": "Public domain",
        "note": "Same painting as 03 · different digitization · for对照",
        "primary": False,
    },
    {
        "id": "four-trees-met",
        "file": "05-met-fourtrees.jpg",
        "master": "met_fourtrees_3689x3658.jpg",
        "title": "The Four Trees",
        "artist": "Claude Monet",
        "year": 1891,
        "museum": "The Metropolitan Museum of Art",
        "accession": "29.100.110",
        "objectUrl": "https://www.metmuseum.org/art/collection/search/437122",
        "commonsUrl": "https://commons.wikimedia.org/wiki/File:The_Four_Trees_MET_DT832.jpg",
        "license": "CC0 / Public domain",
        "note": "Met CC0 donation · 81.3 × 81.6 cm",
        "primary": False,
    },
    {
        "id": "poplars-vertical-unverified",
        "file": "06-vertical.jpg",
        "master": "vertical_2589.jpg",
        "title": "Poplars on the River Epte (scan unverified)",
        "artist": "Claude Monet",
        "year": 1891,
        "museum": "unverified (Tate / NG London labels mixed)",
        "accession": None,
        "objectUrl": None,
        "commonsUrl": (
            "https://commons.wikimedia.org/wiki/File:"
            "Monet_Poplars_on_the_River_Epte.jpg"
        ),
        "license": "Public domain (source pending review)",
        "note": "2589×3297 vertical · provenance not yet verified by author",
        "primary": False,
    },
]
CATALOG_JSON = PAINTING_DIR / "catalog.json"
MASTERS_DIR = PAINTING_DIR / "masters"

COMMONS_API = "https://commons.wikimedia.org/w/api.php"
COMMONS_TITLE = (
    "File:Claude_Monet_-_Poplars,_Pink_Effect_-_2019.67.14.McD_-_Dallas_Museum_of_Art.jpg"
)

USER_AGENT = (
    "narrative-forge-web/1.0 (https://github.com/Monyeah777/narrative-forge-web; "
    "B1-1 painting preview)"
)

IMAGE_SUFFIXES = {".jpg", ".jpeg", ".png", ".webp", ".tif", ".tiff"}

# Normalized crop of the Commons installation photo → painting canvas only.
# Measured on the 1920×2362 thumb (left, top, right, bottom).
DALLAS_CROP_NORM = (0.1750, 0.1549, 0.8260, 0.8247)


def load_rgb(path: Path) -> tuple[Image.Image, dict]:
    with Image.open(path) as im:
        exif = im.getexif()
        orientation = exif.get(ExifTags.Base.Orientation, None)
        info = {
            "mode": im.mode,
            "size": im.size,
            "exif_orientation": orientation,
            "format": im.format,
        }
        fixed = ImageOps.exif_transpose(im)
        rgb = fixed.convert("RGB")
        rgb.load()
    return rgb, info


def crop_norm(im: Image.Image, box: tuple[float, float, float, float]) -> Image.Image:
    w, h = im.size
    left, top, right, bottom = box
    return im.crop(
        (
            round(left * w),
            round(top * h),
            round(right * w),
            round(bottom * h),
        )
    )


def resize_width(im: Image.Image, width: int = TARGET_W) -> Image.Image:
    w, h = im.size
    if w == width:
        return im
    new_h = max(1, round(h * width / w))
    return im.resize((width, new_h), Image.Resampling.LANCZOS)


def desaturate(im: Image.Image, factor: float = SAT_FACTOR) -> Image.Image:
    """Scale HSV saturation by `factor`; leave hue and value untouched.

    ImageEnhance.Color(0.88) was the researched TV-style control, but it blends
    toward luma and measured ~S×0.90 on the Dallas preview — outside the
    handbook −10%…−15% band. HSV S×0.88 hits the spec directly.
    """
    hsv = im.convert("HSV")
    hue, sat, val = hsv.split()
    sat = sat.point([int(round(i * factor)) for i in range(256)])
    return Image.merge("HSV", (hue, sat, val)).convert("RGB")


def save_jpeg(im: Image.Image, path: Path) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    # 4:4:4 so later OKLab sampling does not inherit 4:2:0 chroma smear.
    im.save(
        path,
        format="JPEG",
        quality=JPEG_QUALITY,
        subsampling=0,
        optimize=True,
        icc_profile=None,
        exif=b"",
    )


def http_get(url: str, timeout: int = 90) -> tuple[bytes, str]:
    req = urllib.request.Request(url, headers={"User-Agent": USER_AGENT})
    with urllib.request.urlopen(req, timeout=timeout) as resp:
        return resp.read(), resp.headers.get("Content-Type", "")


def dallas_thumb_url(width: int = 1600) -> str:
    qs = urllib.parse.urlencode(
        {
            "action": "query",
            "titles": COMMONS_TITLE,
            "prop": "imageinfo",
            "iiprop": "url|size|mime",
            "iiurlwidth": str(width),
            "format": "json",
        }
    )
    raw, ctype = http_get(f"{COMMONS_API}?{qs}", timeout=30)
    if "json" not in ctype.lower() and not raw.startswith(b"{"):
        raise RuntimeError(f"Commons API did not return JSON ({ctype})")
    payload = json.loads(raw.decode("utf-8"))
    pages = payload["query"]["pages"]
    info = next(iter(pages.values()))["imageinfo"][0]
    url = info.get("thumburl") or info["url"]
    return url.split("?", 1)[0]


def fetch_dallas_thumb(dest: Path) -> Path:
    dest.parent.mkdir(parents=True, exist_ok=True)
    url = dallas_thumb_url(1600)
    data, ctype = http_get(url)
    if len(data) < 20_000 or "html" in ctype.lower():
        raise RuntimeError(
            f"Dallas thumb download looked wrong ({len(data)} bytes, {ctype})"
        )
    dest.write_bytes(data)
    return dest


def discover_input(explicit: Path | None) -> tuple[Path, bool]:
    """Return (path, is_dallas_stand_in)."""
    if explicit:
        return explicit, False
    env = os.environ.get("PAINTING_INPUT")
    if env:
        return Path(env), False
    if PAINTING_DIR.is_dir():
        skip = {DEFAULT_OUTPUT.name.lower(), "source.json", "catalog.json", "b1-1-refs.json", "b1-1-batch.json"}
        found = sorted(
            p
            for p in PAINTING_DIR.iterdir()
            if p.is_file()
            and p.suffix.lower() in IMAGE_SUFFIXES
            and p.name.lower() not in skip
            and not p.name.startswith(".")
            and not p.name[:3].isdigit()  # baked 01-…06- previews
        )
        if found:
            return found[0], False
    tmp = Path(tempfile.gettempdir()) / "nf-dallas-1920.jpg"
    if not tmp.exists() or tmp.stat().st_size < 20_000:
        fetch_dallas_thumb(tmp)
    return tmp, True


def hsv_pixel(rgb: tuple[int, int, int]) -> tuple[float, float, float]:
    r, g, b = rgb
    return colorsys.rgb_to_hsv(r / 255.0, g / 255.0, b / 255.0)


def hsv_stats(im: Image.Image, step: int = 4) -> dict:
    px = im.load()
    w, h = im.size
    hues_x = 0.0
    hues_y = 0.0
    hue_n = 0
    sat_sum = 0.0
    val_sum = 0.0
    n = 0
    for y in range(0, h, step):
        for x in range(0, w, step):
            hh, ss, vv = hsv_pixel(px[x, y])
            sat_sum += ss
            val_sum += vv
            n += 1
            if ss >= 0.05 and vv >= 0.08:
                ang = hh * 2.0 * math.pi
                hues_x += math.cos(ang)
                hues_y += math.sin(ang)
                hue_n += 1
    mean_h = (
        (math.atan2(hues_y / hue_n, hues_x / hue_n) / (2.0 * math.pi)) % 1.0
        if hue_n
        else 0.0
    )
    return {
        "mean_h_deg": round(mean_h * 360.0, 3),
        "mean_s": round(sat_sum / n, 5),
        "mean_v": round(val_sum / n, 5),
        "samples": n,
        "hue_samples": hue_n,
    }


def paired_hue_delta(before: Image.Image, after: Image.Image, step: int = 4) -> dict:
    """Hue shift on pixels that were chromatic *before* S×0.88.

    Unpaired circular-mean hue is the wrong test here: desaturating the pale
    sky drops those samples under the S floor and the remaining greens pull
    the mean around, even when no pixel's hue actually moved.
    """
    pb = before.load()
    pa = after.load()
    w, h = before.size
    acc = 0.0
    n = 0
    worst = 0.0
    for y in range(0, h, step):
        for x in range(0, w, step):
            h0, s0, _ = hsv_pixel(pb[x, y])
            if s0 < 0.12:
                continue
            h1, _, _ = hsv_pixel(pa[x, y])
            d = abs(h1 - h0)
            d = min(d, 1.0 - d) * 360.0
            acc += d
            if d > worst:
                worst = d
            n += 1
    return {
        "mean_abs_hue_delta_deg": round(acc / n if n else 0.0, 4),
        "max_abs_hue_delta_deg": round(worst, 4),
        "chromatic_samples": n,
    }


def orientation_of(path: Path) -> int | None:
    with Image.open(path) as im:
        return im.getexif().get(ExifTags.Base.Orientation)


def work_for_output(out: Path) -> dict:
    name = out.name
    for work in WORKS:
        if work["file"] == name:
            return work
    return {**DALLAS, "file": name, "id": DALLAS["id"], "primary": name == DEFAULT_OUTPUT.name}


def write_source_json(out: Path, meta: dict, work: dict | None = None) -> None:
    work = work or work_for_output(out)
    payload = {
        "id": work.get("id", DALLAS["id"]),
        "title": work.get("title", DALLAS["title"]),
        "artist": work.get("artist", "Claude Monet"),
        "year": work.get("year", 1891),
        "museum": work.get("museum"),
        "accession": work.get("accession"),
        "objectUrl": work.get("objectUrl"),
        "commonsUrl": work.get("commonsUrl"),
        "license": work.get("license", "Public domain"),
        "standIn": bool(meta.get("dallas_stand_in")),
        "file": out.name,
        "w": meta["w"],
        "h": meta["h"],
        "saturationFactor": SAT_FACTOR,
        "saturationSpace": "HSV",
        "resample": "LANCZOS",
        "exifTranspose": True,
        "cropNorm": meta.get("crop_norm"),
        "inputOrientation": meta.get("input_orientation"),
        "outputOrientation": meta.get("output_orientation"),
        "primary": bool(work.get("primary")),
        "workNote": work.get("note"),
        "note": (
            "Unique in-repo 1200px source after EXIF bake + S×0.88. "
            "Author painting/ folder was not in the cloud clone; this is the "
            "handbook Dallas stand-in. Re-run scripts/prep-painting.py --input "
            "<master> to replace."
            if meta.get("dallas_stand_in")
            else (
                "1200px engineering preview after EXIF bake + S×0.88. "
                f"Baked from {meta.get('input')} ({meta.get('input_size')}); "
                "HD master stays out of git."
            )
        ),
    }
    if not meta.get("dallas_stand_in"):
        payload["master"] = meta.get("input")
        payload["masterSize"] = meta.get("input_size")
    if work.get("primary", out.name == DEFAULT_OUTPUT.name):
        SOURCE_JSON.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n")
    return payload


def upsert_catalog(entry: dict) -> None:
    catalog = {"saturationFactor": SAT_FACTOR, "width": TARGET_W, "works": []}
    if CATALOG_JSON.exists():
        try:
            catalog = json.loads(CATALOG_JSON.read_text())
        except json.JSONDecodeError:
            pass
    works = catalog.setdefault("works", [])
    works = [w for w in works if w.get("id") != entry.get("id")]
    works.append(entry)
    order = {w["id"]: i for i, w in enumerate(WORKS)}
    works.sort(key=lambda w: order.get(w.get("id", ""), 99))
    catalog["works"] = works
    catalog["count"] = len(works)
    CATALOG_JSON.write_text(json.dumps(catalog, indent=2, ensure_ascii=False) + "\n")


def label_font(size: int):
    for name in ("DejaVuSans.ttf", "/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf"):
        try:
            return ImageFont.truetype(name, size=size)
        except OSError:
            continue
    return ImageFont.load_default()


def write_compare(
    before: Image.Image,
    after: Image.Image,
    dest_dir: Path,
    prefix: str = "b1_1_canvas",
) -> None:
    dest_dir.mkdir(parents=True, exist_ok=True)
    save_jpeg(before, dest_dir / f"{prefix}_before.jpg")
    save_jpeg(after, dest_dir / f"{prefix}_after.jpg")

    gap = 16
    bar = 40
    w, h = before.size
    canvas = Image.new("RGB", (w * 2 + gap, h + bar), (12, 12, 12))
    canvas.paste(before, (0, bar))
    canvas.paste(after, (w + gap, bar))
    draw = ImageDraw.Draw(canvas)
    font = label_font(18)
    draw.text((8, 10), "BEFORE  resize 1200  (hue check)", fill=(220, 220, 220), font=font)
    draw.text(
        (w + gap + 8, 10),
        "AFTER  HSV S×0.88",
        fill=(220, 220, 220),
        font=font,
    )
    canvas.save(dest_dir / f"{prefix}_before_after.jpg", quality=90, optimize=True)

    cw, ch = min(360, w), min(280, h)
    ox, oy = max(0, w // 2 - cw // 2), min(max(0, int(h * 0.18)), max(0, h - ch))
    crop_b = before.crop((ox, oy, ox + cw, oy + ch))
    crop_a = after.crop((ox, oy, ox + cw, oy + ch))
    detail = Image.new("RGB", (cw * 2 + gap, ch + bar), (12, 12, 12))
    detail.paste(crop_b, (0, bar))
    detail.paste(crop_a, (cw + gap, bar))
    d = ImageDraw.Draw(detail)
    d.text((8, 10), "BEFORE crop", fill=(220, 220, 220), font=font)
    d.text((cw + gap + 8, 10), "AFTER crop  S×0.88", fill=(220, 220, 220), font=font)
    detail.save(dest_dir / f"{prefix}_sat_crop.jpg", quality=92, optimize=True)


def self_test_exif_rotate() -> None:
    """Orientation 6 (90 CW) must become a real pixel rotate, tag stripped."""
    src = Image.new("RGB", (40, 20), (255, 0, 0))
    src.putpixel((0, 0), (0, 255, 0))
    buf = io.BytesIO()
    exif = Image.Exif()
    exif[ExifTags.Base.Orientation] = 6
    src.save(buf, format="PNG", exif=exif.tobytes())
    buf.seek(0)
    tmp = Path(tempfile.gettempdir()) / "nf-exif-orient6.png"
    tmp.write_bytes(buf.getvalue())
    rgb, info = load_rgb(tmp)
    if info["exif_orientation"] != 6:
        raise AssertionError(f"fixture orientation not 6: {info}")
    if rgb.size != (20, 40):
        raise AssertionError(f"orientation 6 should swap sides, got {rgb.size}")
    corners = {
        "0,0": rgb.getpixel((0, 0)),
        "w-1,0": rgb.getpixel((rgb.size[0] - 1, 0)),
        "0,h-1": rgb.getpixel((0, rgb.size[1] - 1)),
        "w-1,h-1": rgb.getpixel((rgb.size[0] - 1, rgb.size[1] - 1)),
    }
    if (0, 255, 0) not in corners.values():
        raise AssertionError(f"green corner lost after transpose: {corners}")
    if corners["0,0"] == (0, 255, 0) and rgb.size == (40, 20):
        raise AssertionError("pixels were not rotated")
    out = Path(tempfile.gettempdir()) / "nf-exif-orient6-out.jpg"
    save_jpeg(rgb, out)
    if orientation_of(out) not in (None, 1):
        raise AssertionError(f"output still tagged orientation={orientation_of(out)}")


def bake_one(
    src: Path,
    out: Path,
    *,
    width: int,
    saturation: float,
    crop: tuple[float, float, float, float] | None,
    dallas_stand_in: bool,
    work: dict | None,
    compare_dir: Path | None,
    compare_prefix: str,
) -> dict:
    rgb, info = load_rgb(src)
    if crop:
        rgb = crop_norm(rgb, crop)
    before = resize_width(rgb, width)
    after = desaturate(before, saturation)
    save_jpeg(after, out)

    out_orient = orientation_of(out)
    stats_b = hsv_stats(before)
    stats_a = hsv_stats(after)
    sat_ratio = stats_a["mean_s"] / stats_b["mean_s"] if stats_b["mean_s"] else 0
    hue = paired_hue_delta(before, after)
    hue_delta = hue["mean_abs_hue_delta_deg"]

    try:
        input_rel = str(src.resolve().relative_to(ROOT))
    except ValueError:
        input_rel = str(src)
    meta = {
        "id": (work or {}).get("id"),
        "file": out.name,
        "w": after.size[0],
        "h": after.size[1],
        "input_orientation": info["exif_orientation"],
        "output_orientation": out_orient,
        "dallas_stand_in": dallas_stand_in,
        "crop_norm": list(crop) if crop else None,
        "input": input_rel,
        "input_size": list(info["size"]),
        "hsv_before": stats_b,
        "hsv_after": stats_a,
        "sat_ratio": round(sat_ratio, 4),
        "hue_paired": hue,
        "hue_delta_deg": round(hue_delta, 4),
        "checks": {
            "width_1200": after.size[0] == width,
            "sat_0_85_0_90": 0.85 <= sat_ratio <= 0.90,
            "hue_delta_le_2": hue_delta <= 2.0,
            "exif_stripped": out_orient in (None, 1),
            "v_unchanged": abs(stats_a["mean_v"] - stats_b["mean_v"]) < 1e-6,
        },
    }
    payload = write_source_json(out, meta, work)
    upsert_catalog({**payload, "checks": meta["checks"], "sat_ratio": meta["sat_ratio"], "hue_delta_deg": meta["hue_delta_deg"]})
    if compare_dir is not None:
        write_compare(before, after, compare_dir, prefix=compare_prefix)

    if not meta["checks"]["sat_0_85_0_90"]:
        raise SystemExit(f"{out.name}: saturation ratio {sat_ratio} outside 0.85–0.90")
    if not meta["checks"]["hue_delta_le_2"]:
        raise SystemExit(f"{out.name}: hue delta {hue_delta}° exceeds 2°")
    if not meta["checks"]["width_1200"]:
        raise SystemExit(f"{out.name}: width {after.size[0]} != {width}")
    if not meta["checks"]["exif_stripped"]:
        raise SystemExit(f"{out.name}: output EXIF orientation still set: {out_orient}")
    return meta


def run(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--input", type=Path, default=None)
    parser.add_argument("--output", type=Path, default=DEFAULT_OUTPUT)
    parser.add_argument("--width", type=int, default=TARGET_W)
    parser.add_argument("--saturation", type=float, default=SAT_FACTOR)
    parser.add_argument("--compare", type=Path, default=None)
    parser.add_argument("--self-test", action="store_true")
    parser.add_argument(
        "--all-masters",
        action="store_true",
        help="bake every work in WORKS from painting/masters/<master>",
    )
    parser.add_argument(
        "--no-crop",
        action="store_true",
        help="keep the full frame (Dallas stand-in crops the canvas by default)",
    )
    args = parser.parse_args(argv)

    if args.self_test:
        self_test_exif_rotate()
        print("exif_transpose fixture: ok")
        return 0

    compare_dir = None
    if args.compare:
        compare_dir = args.compare if args.compare.is_absolute() else ROOT / args.compare

    if args.all_masters:
        results = []
        for work in WORKS:
            src = MASTERS_DIR / work["master"]
            if not src.exists():
                raise SystemExit(f"master not found: {src}")
            out = PAINTING_DIR / work["file"]
            prefix = f"b1_1_{work['id']}"
            meta = bake_one(
                src,
                out,
                width=args.width,
                saturation=args.saturation,
                crop=None,
                dallas_stand_in=False,
                work=work,
                compare_dir=compare_dir,
                compare_prefix=prefix,
            )
            results.append(meta)
            print(json.dumps({k: meta[k] for k in ("id", "file", "w", "h", "sat_ratio", "hue_delta_deg", "checks")}, ensure_ascii=False))
        (PAINTING_DIR / "b1-1-batch.json").write_text(
            json.dumps({"count": len(results), "results": results}, indent=2, ensure_ascii=False) + "\n"
        )
        failed = [r["file"] for r in results if not all(r["checks"].values())]
        if failed:
            raise SystemExit(f"B1-1 batch checks failed: {failed}")
        return 0

    src, dallas = discover_input(args.input)
    if not src.exists():
        raise SystemExit(f"input not found: {src}")

    crop = DALLAS_CROP_NORM if dallas and not args.no_crop else None
    out = args.output if args.output.is_absolute() else ROOT / args.output
    work = work_for_output(out)
    meta = bake_one(
        src,
        out,
        width=args.width,
        saturation=args.saturation,
        crop=crop,
        dallas_stand_in=dallas,
        work=work,
        compare_dir=compare_dir,
        compare_prefix="b1_1_canvas",
    )
    print(json.dumps(meta, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(run())
