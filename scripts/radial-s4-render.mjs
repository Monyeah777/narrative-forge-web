#!/usr/bin/env node
/**
 * S4: isolated handbook §5 render menu A→D + per-step bench.
 * Does not write live bins, does not change nf-spring.js / applySpring,
 * does not replace live Pixi, does not enable menu E.
 */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const HANDBOOK = "docs/NF_径向重映射_总结版最终方案_v2.0.md";
const SEED = 0x53335033;
const DWELL_DT = 1 / 30;
const WARM_FRAMES = 8;
const BENCH_FRAMES = 40;
const HASH_FRAMES = 16;
const B41_DWELL_P95_MS = 0.2;
const BUDGET_INCREMENT_MS = 1.0;
const BUDGET_REV_DWELL_MS = 2.0;
const FROZEN_GOLDEN = "dc1f16092d775ee1462c94eb964bb95523470bd7fd7770b1efab02c6940f320a";
const DALLAS_U16 = "f6df3397eb97fef511377cdf903a89544860086a78d07c1eb0191f6ff4f3add6";
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

const MENUS = [
  {
    id: "none",
    bakeCenter: false,
    dirtyRect: false,
    noiseLut: false,
    edgeStagger: false,
  },
  {
    id: "A",
    bakeCenter: true,
    dirtyRect: false,
    noiseLut: false,
    edgeStagger: false,
  },
  {
    id: "A+B",
    bakeCenter: true,
    dirtyRect: true,
    noiseLut: false,
    edgeStagger: false,
  },
  {
    id: "A+B+C",
    bakeCenter: true,
    dirtyRect: true,
    noiseLut: true,
    edgeStagger: false,
  },
  {
    id: "A+B+C+D",
    bakeCenter: true,
    dirtyRect: true,
    noiseLut: true,
    edgeStagger: true,
  },
];

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
  return {
    width: 1200,
    height: 1540,
    cx: 0.5,
    cy: 0.5,
    R95: 0.599042,
  };
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (hi - i) + sorted[hi] * (i - lo);
}

function summarizeMs(values) {
  const sorted = values.slice().sort((a, b) => a - b);
  let s = 0;
  for (const v of values) s += v;
  return {
    n: values.length,
    mean: values.length ? s / values.length : 0,
    p50: percentile(sorted, 0.5),
    p95: percentile(sorted, 0.95),
    max: sorted.length ? sorted[sorted.length - 1] : 0,
  };
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

function makeWorld(dallas) {
  return physics.createWorld({
    n: dallas.n,
    width: dallas.f.width,
    height: dallas.f.height,
    cx: dallas.f.cx,
    cy: dallas.f.cy,
    R95: dallas.f.R95,
    seed: SEED,
    phase: physics.PHASE.DWELL,
    tx: dallas.tx,
    ty: dallas.ty,
    x: dallas.tx,
    y: dallas.ty,
  });
}

function makeRenderer(world, menu) {
  return render.createRenderer({
    world,
    physics,
    cell: render.CELL,
    switches: {
      bakeCenter: menu.bakeCenter,
      dirtyRect: menu.dirtyRect,
      noiseLut: menu.noiseLut,
      edgeStagger: menu.edgeStagger,
    },
  });
}

function hashRun(dallas, menu, frames) {
  const world = makeWorld(dallas);
  const renderer = makeRenderer(world, menu);
  renderer.prepare();
  for (let i = 0; i < frames; i++) {
    world.drain(DWELL_DT);
    renderer.blit();
  }
  return {
    sha256: sha256(renderer.bytes()),
    ink: renderer.inkCount(),
    counts: renderer.counts(),
    last: { ...renderer.lastStats },
  };
}

function benchMenu(dallas, menu) {
  const world = makeWorld(dallas);
  const renderer = makeRenderer(world, menu);
  const tPrep0 = performance.now();
  renderer.prepare();
  const prepareMs = performance.now() - tPrep0;
  for (let i = 0; i < WARM_FRAMES; i++) {
    world.drain(DWELL_DT);
    renderer.blit();
  }
  const phys = [];
  const blit = [];
  const script = [];
  const uploads = [];
  for (let i = 0; i < BENCH_FRAMES; i++) {
    const t0 = performance.now();
    world.drain(DWELL_DT);
    const t1 = performance.now();
    const stats = renderer.blit();
    const t2 = performance.now();
    phys.push(t1 - t0);
    blit.push(t2 - t1);
    script.push(t2 - t0);
    uploads.push(stats.upload_px);
  }
  const uploadSorted = uploads.slice().sort((a, b) => a - b);
  return {
    id: menu.id,
    switches: {
      bakeCenter: menu.bakeCenter,
      dirtyRect: menu.dirtyRect,
      noiseLut: menu.noiseLut,
      edgeStagger: menu.edgeStagger,
    },
    counts: renderer.counts(),
    prepare_ms: prepareMs,
    phys_ms: summarizeMs(phys),
    blit_ms: summarizeMs(blit),
    script_ms: summarizeMs(script),
    upload_px: {
      p50: percentile(uploadSorted, 0.5),
      p95: percentile(uploadSorted, 0.95),
      last: renderer.lastStats.upload_px,
      full: renderer.lastStats.full_px,
    },
    last: { ...renderer.lastStats },
    ink: renderer.inkCount(),
  };
}

function main() {
  const before = liveFingerprint();
  assertLive(before, "pre");

  const golden = spring.runGolden();
  const goldenSha = sha256(spring.goldenBytes(golden.seq));
  if (goldenSha !== FROZEN_GOLDEN) {
    throw new Error(`C2 golden ${goldenSha} != ${FROZEN_GOLDEN}`);
  }

  const dallas = loadDallas();
  const steps = [];
  for (const menu of MENUS) steps.push(benchMenu(dallas, menu));

  const dualA = hashRun(dallas, MENUS[4], HASH_FRAMES);
  const dualB = hashRun(dallas, MENUS[4], HASH_FRAMES);
  const dualNoneA = hashRun(dallas, MENUS[0], HASH_FRAMES);
  const dualNoneB = hashRun(dallas, MENUS[0], HASH_FRAMES);

  const after = liveFingerprint();
  assertLive(after, "post");
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new Error("live fingerprint changed during S4");
  }

  const indexSrc = fs.readFileSync(path.join(ROOT, "prototype/index.html"), "utf8");
  const indexHasSharp = indexSrc.indexOf("var SPRING_SHARP = 0.055") !== -1;
  const pixiUnchanged =
    fs.readFileSync(path.join(ROOT, "prototype/renderer.pixi.js"), "utf8").indexOf(
      "ParticleContainer"
    ) !== -1;

  const abcd = steps[steps.length - 1];
  const incrementVsB41 = abcd.script_ms.p95 - B41_DWELL_P95_MS;
  const underIncrement = incrementVsB41 <= BUDGET_INCREMENT_MS;
  const underRev = abcd.script_ms.p95 <= BUDGET_REV_DWELL_MS;
  const petitionE = !(underIncrement && underRev);
  const dualMatch = dualA.sha256 === dualB.sha256;
  const dualNoneMatch = dualNoneA.sha256 === dualNoneB.sha256;

  const report = {
    task: "S4 渲染",
    handbook: HANDBOOK,
    timestamp_note:
      "isolation ImageData A→D bench; no live Pixi rewrite; no live write; live 0.055 untouched; E not enabled",
    seed: SEED,
    module: "prototype/pixi-physics/nf-radial-render.js",
    physics: "prototype/pixi-physics/nf-radial-physics.js",
    runner: "scripts/radial-s4-render.mjs",
    live_count_unchanged: 100000,
    palette_unchanged: true,
    spring_unchanged: true,
    wired_into_live_ticker: false,
    live_pixi_replaced: false,
    menu_E_enabled: false,
    pixel_block: {
      cell: render.CELL,
      matte: true,
      integer_round: true,
      smoothing: false,
      glow: false,
      ink: "#C9CFD8",
      bg: "#050505",
      note: "isolation monochrome; live 256 palette unused",
    },
    field: dallas.f,
    n: dallas.n,
    u16: dallas.u16Rel,
    u16_sha256: dallas.u16Sha,
    clock: {
      dwell_hz: 30,
      dt_s: DWELL_DT,
      warm_frames: WARM_FRAMES,
      bench_frames: BENCH_FRAMES,
      hash_frames: HASH_FRAMES,
      note: "B4.1 dwell ≤30Hz; handbook §5 + 修订包 stay-quiet",
    },
    search: {
      putImageData:
        "https://developer.mozilla.org/en-US/docs/Web/API/CanvasRenderingContext2D/putImageData",
      offscreen:
        "https://developer.mozilla.org/en-US/docs/Web/API/OffscreenCanvasRenderingContext2D",
      gecko_dirty_full_convert:
        "https://bugzilla.mozilla.org/show_bug.cgi?id=1081887",
      offscreen_webdev: "https://web.dev/articles/offscreen-canvas",
      dirty_source_relative: true,
    },
    switches_default: { ...render.SWITCH_DEFAULTS },
    steps,
    dual_run: {
      menu: "A+B+C+D",
      frames: HASH_FRAMES,
      a: dualA.sha256,
      b: dualB.sha256,
      match: dualMatch,
      ink: dualA.ink,
      counts: dualA.counts,
    },
    dual_run_none: {
      menu: "none",
      a: dualNoneA.sha256,
      b: dualNoneB.sha256,
      match: dualNoneMatch,
    },
    section8: {
      "7_perf_increment_ms": Number(incrementVsB41.toFixed(4)),
      "7_under_plus_1ms": underIncrement,
      "7_under_rev_2ms": underRev,
      "7_protocol": true,
      "8_hash": dualMatch && dualNoneMatch,
      "1_2_sampling": "S2c locked; S4 does not resample",
      "3_6_physics": "S3 locked; S4 does not retune k(r)/c*",
      "9_live": "S5; live ticker not wired",
    },
    budget: {
      b41_dwell_p95_ms: B41_DWELL_P95_MS,
      increment_ms: BUDGET_INCREMENT_MS,
      rev_dwell_ms: BUDGET_REV_DWELL_MS,
      abcd_script_p95_ms: abcd.script_ms.p95,
      abcd_blit_p95_ms: abcd.blit_ms.p95,
      increment_vs_b41_ms: incrementVsB41,
      vm_note:
        "this cloud VM is software framebuffer / not the author-device bar (same as S0)",
    },
    petition_E: {
      needed: petitionE,
      enabled: false,
      options: ["cut isolation count", "WebGL / keep live Pixi"],
      reason: petitionE
        ? "A–D still over §5 +1.0ms increment and/or 修订包 2ms dwell on this VM; needs author 拍板. Did not cut N. Did not enable E. Did not rewrite live Pixi."
        : "A–D under both budgets on this run; E stays dormant",
    },
    c2_golden: {
      sha256: goldenSha,
      match: true,
      source: "nf-spring.runGolden",
    },
    live_sha256: after,
    nf_spring_js_sha256: sha256Path("prototype/pixi-physics/nf-spring.js"),
    live_index_spring_sharp_present: indexHasSharp,
    live_pixi_particle_container_present: pixiUnchanged,
    booked: {
      live_vs_handbook_spring:
        "live applySpring stays 0.055/0.90/vmax10; S4 does not touch it",
      count: "handbook 50k isolation vs live 100k; no live overwrite",
      gecko_dirty:
        "Firefox 1081887: dirty args historically still converted the full ImageData; B reports both upload_px and full_px",
      E: "menu E is petition-only; this gate never enables it",
    },
  };

  const out = path.join(ROOT, "painting/radial-s4.json");
  fs.writeFileSync(out, JSON.stringify(report, null, 2) + "\n");

  const failed = [];
  if (!dualMatch) failed.push("dual-run hash A+B+C+D");
  if (!dualNoneMatch) failed.push("dual-run hash none");
  if (!indexHasSharp) failed.push("live SPRING_SHARP missing");
  if (!pixiUnchanged) failed.push("live ParticleContainer missing");
  if (dualA.ink <= 0) failed.push("framebuffer has no ink");
  if (report.menu_E_enabled) failed.push("menu E silently enabled");

  const summary = {
    section8: report.section8,
    counts: dualA.counts,
    steps: steps.map((s) => ({
      id: s.id,
      script_p95: Number(s.script_ms.p95.toFixed(4)),
      blit_p95: Number(s.blit_ms.p95.toFixed(4)),
      upload_p95: s.upload_px.p95,
    })),
    dual: dualA.sha256,
    petition_E: report.petition_E.needed,
    failed,
  };
  console.log(JSON.stringify(summary, null, 2));
  console.log(`wrote ${path.relative(ROOT, out)}`);
  if (failed.length) {
    console.error("S4 failures:", failed.join(", "));
    process.exit(1);
  }
}

main();
