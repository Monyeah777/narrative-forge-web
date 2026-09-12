#!/usr/bin/env node
/**
 * S5: isolation acceptance pack.
 * Re-reads locked S2c/S3/S4 evidence. Adds §8#9 phase machine,
 * 15s video, zoom crops, frame-time curve, rollback list.
 * Does not resample, retune, write live bins, wire ticker, or enable E.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const ART = "/opt/cursor/artifacts";
const HANDBOOK = "docs/NF_径向重映射_总结版最终方案_v2.0.md";
const SEED = 0x53335033;
const DWELL_DT = 1 / 30;
const VIDEO_S = 15;
const VIDEO_FPS = 30;
const VIDEO_SCALE = 3;
const RESET_OFFSET_PX = 24;
const RESET_LIMIT_S = 4;
const FROZEN_GOLDEN = "dc1f16092d775ee1462c94eb964bb95523470bd7fd7770b1efab02c6940f320a";
const DALLAS_U16 = "f6df3397eb97fef511377cdf903a89544860086a78d07c1eb0191f6ff4f3add6";
const SCOTLAND_U16 = "painting/radial-s2b-scotland-50k.u16";
const MET_U16 = "painting/radial-s2b-met-50k.u16";
const LIVE_SHA = {
  "prototype/pixi-cloud/dallas-100k.bin":
    "6406d7012e7f637ad2e31661a85f619ebd14b85bb48a6341a1ec9c3a2dbcea82",
  "prototype/pixi-hall/scotland-100k.bin":
    "bbeab899140521bad56e82766f92a3d63305b8bc8f802de22db804fad3bfcf5f",
  "prototype/pixi-community/met-100k.bin":
    "3144fdb9144d95cb0afe30f28629ec1e065bfa5022400a80e1c8e93129779a45",
  "painting/points.json":
    "d35cae4c65a1c17ebbb609176b908750ff7aef5479aa7c563e7a1faf4e68d134",
  "prototype/assets/points.json":
    "d35cae4c65a1c17ebbb609176b908750ff7aef5479aa7c563e7a1faf4e68d134",
};

const physics = require("../prototype/pixi-physics/nf-radial-physics.js");
const render = require("../prototype/pixi-physics/nf-radial-render.js");
const spring = require("../prototype/pixi-physics/nf-spring.js");

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function sha256Path(rel) {
  return sha256(fs.readFileSync(path.join(ROOT, rel)));
}

function liveFingerprint() {
  const out = {};
  for (const rel of Object.keys(LIVE_SHA)) out[rel] = sha256Path(rel);
  return out;
}

function assertLive(fp, label) {
  for (const [rel, expect] of Object.entries(LIVE_SHA)) {
    if (fp[rel] !== expect) {
      throw new Error(`${label}: ${rel} sha ${fp[rel]} != ${expect}`);
    }
  }
}

function readJson(rel) {
  return JSON.parse(fs.readFileSync(path.join(ROOT, rel), "utf8"));
}

function decodeU16(rel) {
  const raw = fs.readFileSync(path.join(ROOT, rel));
  if (raw.length % 4) throw new Error(`${rel} size ${raw.length} not multiple of 4`);
  const u16 = new Uint16Array(raw.buffer, raw.byteOffset, raw.length / 2);
  const n = u16.length / 2;
  const xy = new Float64Array(n * 2);
  for (let i = 0; i < n; i++) {
    xy[i * 2] = u16[i * 2] / 65535;
    xy[i * 2 + 1] = u16[i * 2 + 1] / 65535;
  }
  return { n, xy };
}

function fieldDallas() {
  return { width: 1200, height: 1540, cx: 0.5, cy: 0.5, R95: 0.599042 };
}

function loadDallas() {
  const f = fieldDallas();
  const u16Rel = "painting/radial-s2b-dallas-50k.u16";
  const got = sha256Path(u16Rel);
  if (got !== DALLAS_U16) throw new Error(`S2b Dallas u16 sha ${got} != ${DALLAS_U16}`);
  const { n, xy } = decodeU16(u16Rel);
  const tx = new Float64Array(n);
  const ty = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    tx[i] = xy[i * 2] * f.width;
    ty[i] = xy[i * 2 + 1] * f.height;
  }
  return { f, n, tx, ty, u16Rel, u16Sha: got };
}

function makeWorld(dallas, phase, extra) {
  return physics.createWorld({
    n: dallas.n,
    width: dallas.f.width,
    height: dallas.f.height,
    cx: dallas.f.cx,
    cy: dallas.f.cy,
    R95: dallas.f.R95,
    seed: SEED,
    phase,
    tx: dallas.tx,
    ty: dallas.ty,
    x: extra && extra.x ? extra.x : dallas.tx,
    y: extra && extra.y ? extra.y : dallas.ty,
  });
}

function makeRenderer(world) {
  return render.createRenderer({
    world,
    physics,
    cell: render.CELL,
    switches: render.SWITCH_DEFAULTS,
  });
}

function bandOf(r) {
  if (r < 0.3) return "center";
  if (r < 0.6) return "inner";
  if (r < 0.85) return "mid";
  return "edge";
}

function driftStats(world) {
  const dlt = [0, 0];
  let cN = 0;
  let eN = 0;
  let cAbs = 0;
  let eAbs = 0;
  let maxAbs = 0;
  for (let i = 0; i < world.n; i++) {
    world.driftXY(i, dlt);
    const mag = Math.hypot(dlt[0], dlt[1]);
    if (mag > maxAbs) maxAbs = mag;
    const band = bandOf(world.r[i]);
    if (band === "center") {
      cN += 1;
      cAbs += mag;
    }
    if (band === "edge") {
      eN += 1;
      eAbs += mag;
    }
  }
  return {
    max: maxAbs,
    center_mean: cN ? cAbs / cN : 0,
    edge_mean: eN ? eAbs / eN : 0,
    asleep: world.asleep.reduce((s, v) => s + v, 0),
  };
}

function runPhaseGating(dallas) {
  const intro = makeWorld(dallas, physics.PHASE.INTRO);
  intro.drain(1);
  const introS = driftStats(intro);

  const handover = makeWorld(dallas, physics.PHASE.HANDOVER);
  handover.drain(1);
  const handoverS = driftStats(handover);

  const dwell = makeWorld(dallas, physics.PHASE.DWELL);
  dwell.drain(1);
  const dwellS = driftStats(dwell);

  const repel = makeWorld(dallas, physics.PHASE.REPEL);
  repel.drain(1);
  const repelS = driftStats(repel);

  const ratio = dwellS.edge_mean > 0 ? repelS.edge_mean / dwellS.edge_mean : 0;
  return {
    intro: introS,
    handover: handoverS,
    dwell: dwellS,
    repel: repelS,
    repel_over_dwell: ratio,
    pass_intro_still: introS.max <= 1e-9,
    pass_handover_still: handoverS.max <= 1e-9,
    pass_dwell_edge: dwellS.edge_mean > 0 && dwellS.center_mean <= 0.3,
    pass_repel_half: ratio >= 0.4 && ratio <= 0.6,
  };
}

function runWake(dallas) {
  const world = makeWorld(dallas, physics.PHASE.DWELL);
  world.drain(0.5);
  const before = driftStats(world).asleep;
  world.setPhase(physics.PHASE.REPEL);
  const afterRepel = driftStats(world).asleep;
  world.setPhase(physics.PHASE.INTRO);
  const afterIntro = driftStats(world).asleep;
  return {
    asleep_after_dwell: before,
    asleep_after_repel: afterRepel,
    asleep_after_intro: afterIntro,
    pass: before > 0 && afterRepel === 0 && afterIntro === 0,
  };
}

function runReassemble(dallas) {
  const x = new Float64Array(dallas.n);
  const y = new Float64Array(dallas.n);
  for (let i = 0; i < dallas.n; i++) {
    x[i] = dallas.tx[i];
    y[i] = dallas.ty[i] + RESET_OFFSET_PX;
  }
  const world = makeWorld(dallas, physics.PHASE.DWELL, { x, y });
  const limit = Math.round(RESET_LIMIT_S * 60);
  let centerSleep = null;
  let edgeSleep = null;
  for (let s = 0; s < limit; s++) {
    world.stepFixed();
    let cNeed = 0;
    let cAsleep = 0;
    let eNeed = 0;
    let eAsleep = 0;
    for (let i = 0; i < world.n; i++) {
      const band = bandOf(world.r[i]);
      if (band === "center") {
        cNeed += 1;
        cAsleep += world.asleep[i];
      }
      if (band === "edge") {
        eNeed += 1;
        eAsleep += world.asleep[i];
      }
    }
    const t = (s + 1) / 60;
    if (centerSleep == null && cNeed && cAsleep === cNeed) centerSleep = t;
    if (edgeSleep == null && eNeed && eAsleep === eNeed) edgeSleep = t;
    if (centerSleep != null && edgeSleep != null) break;
  }
  return {
    offset_px: RESET_OFFSET_PX,
    center_sleep_s: centerSleep,
    edge_sleep_s: edgeSleep,
    pass:
      centerSleep != null &&
      edgeSleep != null &&
      centerSleep <= 1.0 &&
      edgeSleep <= 1.5,
  };
}

function scaleRgb24(pixels, w, h, scale) {
  const sw = Math.floor(w / scale) & ~1;
  const sh = Math.floor(h / scale) & ~1;
  const out = Buffer.alloc(sw * sh * 3);
  const bytes = new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength);
  let o = 0;
  for (let y = 0; y < sh; y++) {
    const sy = y * scale;
    for (let x = 0; x < sw; x++) {
      const i = (sy * w + x * scale) * 4;
      out[o++] = bytes[i];
      out[o++] = bytes[i + 1];
      out[o++] = bytes[i + 2];
    }
  }
  return { buf: out, w: sw, h: sh };
}

function cropZoomRgb24(pixels, w, h, cx, cy, src, zoom) {
  const dw = src * zoom;
  const dh = src * zoom;
  const x0 = Math.round(cx - src / 2);
  const y0 = Math.round(cy - src / 2);
  const out = Buffer.alloc(dw * dh * 3);
  const bytes = new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength);
  let o = 0;
  for (let y = 0; y < dh; y++) {
    const sy = y0 + Math.floor(y / zoom);
    for (let x = 0; x < dw; x++) {
      const sx = x0 + Math.floor(x / zoom);
      if (sx < 0 || sy < 0 || sx >= w || sy >= h) {
        out[o++] = 5;
        out[o++] = 5;
        out[o++] = 5;
      } else {
        const i = (sy * w + sx) * 4;
        out[o++] = bytes[i];
        out[o++] = bytes[i + 1];
        out[o++] = bytes[i + 2];
      }
    }
  }
  return { buf: out, w: dw, h: dh };
}

function runFfmpeg(args, input) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", args, { stdio: ["pipe", "ignore", "pipe"] });
    let err = "";
    child.stderr.on("data", (d) => {
      err += d.toString();
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg ${args.join(" ")} exited ${code}\n${err.slice(-800)}`));
    });
    if (input) {
      child.stdin.write(input);
      child.stdin.end();
    } else {
      child.stdin.end();
    }
  });
}

async function writePng(rgb, dest) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  await runFfmpeg(
    [
      "-y",
      "-f",
      "rawvideo",
      "-pix_fmt",
      "rgb24",
      "-s",
      `${rgb.w}x${rgb.h}`,
      "-i",
      "pipe:0",
      dest,
    ],
    rgb.buf
  );
}

function writeSvgCurve(values, dest, title) {
  const w = 720;
  const h = 220;
  const pad = 36;
  const max = Math.max(...values, 0.001);
  const pts = values
    .map((v, i) => {
      const x = pad + (i / Math.max(values.length - 1, 1)) * (w - pad * 2);
      const y = h - pad - (v / max) * (h - pad * 2);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(" ");
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="#111"/>
  <text x="${pad}" y="20" fill="#c9cfd8" font-size="12">${title}</text>
  <text x="${pad}" y="${h - 10}" fill="#888" font-size="10">0</text>
  <text x="${w - pad - 40}" y="${h - 10}" fill="#888" font-size="10">${values.length}f</text>
  <text x="8" y="${pad}" fill="#888" font-size="10">${max.toFixed(2)}ms</text>
  <polyline fill="none" stroke="#c9cfd8" stroke-width="1.2" points="${pts}"/>
</svg>
`;
  fs.writeFileSync(dest, svg);
}

function phaseAtFrame(i, fps) {
  const t = i / fps;
  if (t < 2) return physics.PHASE.INTRO;
  if (t < 4) return physics.PHASE.HANDOVER;
  if (t < 12) return physics.PHASE.DWELL;
  return physics.PHASE.REPEL;
}

async function recordVideo(dallas, dest) {
  const frames = VIDEO_S * VIDEO_FPS;
  const world = makeWorld(dallas, physics.PHASE.INTRO);
  const renderer = makeRenderer(world);
  renderer.prepare();
  const preview = scaleRgb24(renderer.pixels, renderer.width, renderer.height, VIDEO_SCALE);
  const args = [
    "-y",
    "-f",
    "rawvideo",
    "-pix_fmt",
    "rgb24",
    "-s",
    `${preview.w}x${preview.h}`,
    "-r",
    String(VIDEO_FPS),
    "-i",
    "pipe:0",
    "-c:v",
    "libx264",
    "-pix_fmt",
    "yuv420p",
    "-crf",
    "20",
    dest,
  ];
  const child = spawn("ffmpeg", args, { stdio: ["pipe", "ignore", "pipe"] });
  let err = "";
  child.stderr.on("data", (d) => {
    err += d.toString();
  });
  const done = new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg video exited ${code}\n${err.slice(-800)}`));
    });
  });
  const scriptMs = [];
  let lastPhase = world.phase;
  for (let i = 0; i < frames; i++) {
    const next = phaseAtFrame(i, VIDEO_FPS);
    if (next !== lastPhase) {
      world.setPhase(next);
      lastPhase = next;
    }
    const t0 = performance.now();
    world.drain(DWELL_DT);
    renderer.blit();
    scriptMs.push(performance.now() - t0);
    const rgb = scaleRgb24(renderer.pixels, renderer.width, renderer.height, VIDEO_SCALE);
    child.stdin.write(rgb.buf);
  }
  child.stdin.end();
  await done;
  return {
    frames,
    fps: VIDEO_FPS,
    seconds: VIDEO_S,
    width: preview.w,
    height: preview.h,
    script_ms: scriptMs,
  };
}

function hashPair(dallas) {
  const run = () => {
    const world = makeWorld(dallas, physics.PHASE.INTRO);
    const renderer = makeRenderer(world);
    renderer.prepare();
    const seq = [
      physics.PHASE.INTRO,
      physics.PHASE.HANDOVER,
      physics.PHASE.DWELL,
      physics.PHASE.REPEL,
      physics.PHASE.DWELL,
    ];
    for (const ph of seq) {
      world.setPhase(ph);
      world.drain(0.25);
      renderer.blit();
    }
    return sha256(renderer.bytes());
  };
  const a = run();
  const b = run();
  return { a, b, match: a === b };
}

async function main() {
  fs.mkdirSync(ART, { recursive: true });
  const before = liveFingerprint();
  assertLive(before, "pre");

  const golden = spring.runGolden();
  const goldenSha = sha256(spring.goldenBytes(golden.seq));
  if (goldenSha !== FROZEN_GOLDEN) {
    throw new Error(`C2 golden ${goldenSha} != ${FROZEN_GOLDEN}`);
  }

  const s2c = readJson("painting/radial-s2c.json");
  const s3 = readJson("painting/radial-s3.json");
  const s4 = readJson("painting/radial-s4.json");
  if (sha256Path("painting/radial-s2b-dallas-50k.u16") !== DALLAS_U16) {
    throw new Error("Dallas u16 drifted");
  }
  if (sha256Path(SCOTLAND_U16) !== "700e9d525a731766fd17f4c4872754138c81a09ca40db1928dfc5865b97d914f") {
    throw new Error("Scotland u16 drifted");
  }
  if (sha256Path(MET_U16) !== "a4f4a7a1579858445140595b08883829237f466df1eb781efaed02c12b1efc46") {
    throw new Error("Met u16 drifted");
  }

  const dallas = loadDallas();
  const gating = runPhaseGating(dallas);
  const wake = runWake(dallas);
  const reassemble = runReassemble(dallas);
  const dual = hashPair(dallas);

  const videoRel = "painting/radial-s5-dwell-15s.mp4";
  const videoPath = path.join(ROOT, videoRel);
  const video = await recordVideo(dallas, videoPath);

  const stillWorld = makeWorld(dallas, physics.PHASE.DWELL);
  stillWorld.drain(1);
  const stillRenderer = makeRenderer(stillWorld);
  stillRenderer.prepare();
  stillRenderer.blit();
  const full = scaleRgb24(stillRenderer.pixels, stillRenderer.width, stillRenderer.height, VIDEO_SCALE);
  const center = cropZoomRgb24(
    stillRenderer.pixels,
    stillRenderer.width,
    stillRenderer.height,
    stillRenderer.width * 0.5,
    stillRenderer.height * 0.5,
    160,
    4
  );
  const edge = cropZoomRgb24(
    stillRenderer.pixels,
    stillRenderer.width,
    stillRenderer.height,
    stillRenderer.width * 0.5 + stillRenderer.width * dallas.f.R95 * 0.92,
    stillRenderer.height * 0.5,
    160,
    4
  );
  const fullPng = path.join(ROOT, "painting/radial-s5-full.png");
  const centerPng = path.join(ROOT, "painting/radial-s5-zoom-center.png");
  const edgePng = path.join(ROOT, "painting/radial-s5-zoom-edge.png");
  const curveSvg = path.join(ROOT, "painting/radial-s5-frametime.svg");
  await writePng(full, fullPng);
  await writePng(center, centerPng);
  await writePng(edge, edgePng);
  writeSvgCurve(video.script_ms, curveSvg, "S5 isolation drain+blit ms @30Hz");

  for (const src of [videoPath, fullPng, centerPng, edgePng, curveSvg]) {
    fs.copyFileSync(src, path.join(ART, path.basename(src)));
  }

  const after = liveFingerprint();
  assertLive(after, "post");
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new Error("live fingerprint changed during S5");
  }

  const indexHasSharp =
    fs.readFileSync(path.join(ROOT, "prototype/index.html"), "utf8").indexOf(
      "var SPRING_SHARP = 0.055"
    ) !== -1;

  const pass9 =
    gating.pass_intro_still &&
    gating.pass_handover_still &&
    gating.pass_dwell_edge &&
    gating.pass_repel_half &&
    wake.pass &&
    reassemble.pass;

  const section8 = {
    "1_density": !!s2c.section8["1_density"],
    "2_holes": !!s2c.section8["2_holes"],
    "3_drift": !!s3.section8["3_drift"],
    "4_smear": !!s3.section8["4_smear"],
    "5_reset": !!s3.section8["5_reset"],
    "6_rate": !!s3.section8["6_rate"],
    "7_perf_under_budget": !!s4.section8["7_under_plus_1ms"],
    "7_perf_protocol": !!s4.section8["7_protocol"],
    "8_hash": !!(s2c.section8["8_hash"] && s3.section8["8_hash"] && s4.section8["8_hash"] && dual.match),
    "9_phases": pass9,
    "10_spectrum_optional": !!s2c.section8["10_spectrum_optional"],
  };

  const report = {
    task: "S5 总验收",
    handbook: HANDBOOK,
    timestamp_note:
      "isolation acceptance; re-read S2c/S3/S4; #9 phases; 15s video; no live write; E not enabled",
    seed: SEED,
    runner: "scripts/radial-s5-accept.mjs",
    live_count_unchanged: 100000,
    palette_unchanged: true,
    spring_unchanged: true,
    wired_into_live_ticker: false,
    live_pixi_replaced: false,
    menu_E_enabled: false,
    locked_sources: {
      s2c: "painting/radial-s2c.json",
      s3: "painting/radial-s3.json",
      s4: "painting/radial-s4.json",
      dallas_u16: dallas.u16Rel,
      dallas_u16_sha256: dallas.u16Sha,
    },
    section8,
    s2c_table: s2c.table,
    s3_highlights: {
      center_sleep_s: s3.reset.hz60.center.seconds_sleep,
      edge_sleep_s: s3.reset.hz60.edge.seconds_sleep,
      smear_p99: s3.dwell.smear.p99,
      dual: s3.dual_run && s3.dual_run.match,
    },
    s4_highlights: {
      abcd_script_p95_ms: s4.budget.abcd_script_p95_ms,
      increment_vs_b41_ms: s4.budget.increment_vs_b41_ms,
      petition_E: s4.petition_E,
    },
    phase9: { gating, wake, reassemble },
    dual_run: dual,
    artifacts: {
      video: videoRel,
      full: "painting/radial-s5-full.png",
      zoom_center: "painting/radial-s5-zoom-center.png",
      zoom_edge: "painting/radial-s5-zoom-edge.png",
      frametime: "painting/radial-s5-frametime.svg",
      video_meta: {
        seconds: video.seconds,
        fps: video.fps,
        frames: video.frames,
        size: `${video.width}x${video.height}`,
        script_p95_ms: [...video.script_ms].sort((a, b) => a - b)[
          Math.floor(video.script_ms.length * 0.95)
        ],
      },
    },
    rollback: [
      {
        key: "live.count",
        default: "100k bin",
        rollback: "keep 100k; ?bin=0 → 12k JSON. 50k isolation stays off live",
      },
      {
        key: "live.spring",
        default: "SPRING_SHARP=0.055",
        rollback: "do not load nf-radial-physics.js from index.html",
      },
      {
        key: "live.renderer",
        default: "Pixi ParticleContainer",
        rollback: "do not load nf-radial-render.js from index.html",
      },
      {
        key: "refine.mode",
        default: "thinning",
        rollback: "② WSE / ③ packing / ⑤ LEC stay dormant",
      },
      {
        key: "physics.criticalDamp",
        default: true,
        rollback: "false restores handbook c(r) (center rings)",
      },
      {
        key: "physics.drift / gating / sleep / interpolate",
        default: "on",
        rollback: "flip isolation switches only; live ticker unwired",
      },
      {
        key: "render.A-D",
        default: "all on in isolation",
        rollback: "isolation-only; live Pixi unchanged",
      },
      {
        key: "render.E",
        default: "petition, disabled",
        rollback: "do not cut N or swap live to Canvas2D without 拍板",
      },
    ],
    deviation: [
      {
        item: "count",
        handbook: "50k",
        isolation: "50k u16",
        live: "100k NFPT bin (unchanged)",
      },
      {
        item: "spring",
        handbook: "k(r)/c(r) field",
        isolation: "k(r) + discrete c*(k)",
        live: "0.055 / 0.90 / vmax 10",
      },
      {
        item: "clock",
        handbook: "h=1/60, clamp 50ms",
        isolation: "handbook 50ms",
        live: "0.25s clamp, MAX_STEPS=2",
      },
      {
        item: "render",
        handbook: "ImageData A–D",
        isolation: "software framebuffer A–D",
        live: "Pixi 8.20.1",
      },
      {
        item: "E",
        handbook: "拍板",
        isolation: "petition booked, disabled",
        live: "already WebGL; count not cut",
      },
    ],
    c2_golden: { sha256: goldenSha, match: true },
    live_sha256: after,
    live_index_spring_sharp_present: indexHasSharp,
    booked: {
      live_ticker: "S5 does not wire isolation physics/render into prototype/index.html",
      count: "50k stays isolation; live overwrite needs an extra explicit sentence",
      E: "S4 petition stands; S5 does not enable E",
      upgrade: "②/③/⑤ stay dormant",
    },
  };

  const out = path.join(ROOT, "painting/radial-s5.json");
  fs.writeFileSync(out, JSON.stringify(report, null, 2) + "\n");

  const failed = [];
  if (!section8["1_density"]) failed.push("#1");
  if (!section8["2_holes"]) failed.push("#2");
  if (!section8["3_drift"]) failed.push("#3");
  if (!section8["4_smear"]) failed.push("#4");
  if (!section8["5_reset"]) failed.push("#5");
  if (!section8["6_rate"]) failed.push("#6");
  if (!section8["7_perf_protocol"]) failed.push("#7 protocol");
  if (!section8["8_hash"]) failed.push("#8");
  if (!section8["9_phases"]) failed.push("#9");
  if (!indexHasSharp) failed.push("SPRING_SHARP");
  if (report.menu_E_enabled) failed.push("E enabled");

  console.log(
    JSON.stringify(
      {
        section8,
        phase9: {
          intro: gating.intro.max,
          dwell_edge: gating.dwell.edge_mean,
          repel_ratio: gating.repel_over_dwell,
          wake: wake.pass,
          reassemble,
        },
        dual: dual.a,
        video: report.artifacts.video_meta,
        petition_E: s4.petition_E.needed,
        failed,
      },
      null,
      2
    )
  );
  console.log(`wrote ${path.relative(ROOT, out)}`);
  if (failed.length) {
    console.error("S5 failures:", failed.join(", "));
    process.exit(1);
  }
}

main();
