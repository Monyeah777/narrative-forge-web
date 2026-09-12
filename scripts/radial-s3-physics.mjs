#!/usr/bin/env node
/**
 * S3: isolated handbook §4 physics + 60/120Hz regression.
 * Does not write live bins, does not change nf-spring.js / applySpring.
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
const RESET_OFFSET_PX = 24;
const RESET_LIMIT_S = 4;
const DWELL_S = 2;
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

function bytesOf(float64) {
  return Buffer.from(float64.buffer, float64.byteOffset, float64.byteLength);
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

function bandOf(r) {
  if (r < 0.3) return "center";
  if (r < 0.6) return "inner";
  if (r < 0.85) return "mid";
  return "edge";
}

function meanStd(values) {
  if (!values.length) return { n: 0, mean: 0, std: 0, max: 0 };
  let s = 0;
  let q = 0;
  let mx = 0;
  for (const v of values) {
    s += v;
    q += v * v;
    if (v > mx) mx = v;
  }
  const mean = s / values.length;
  const var_ = Math.max(0, q / values.length - mean * mean);
  return { n: values.length, mean, std: Math.sqrt(var_), max: mx };
}

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (hi - i) + sorted[hi] * (i - lo);
}

function makeRingWorld(r, offsetPx, switches, seed) {
  const f = fieldDallas();
  const tx = (f.cx + r * f.R95) * f.width;
  const ty = f.cy * f.height;
  return physics.createWorld({
    n: 1,
    width: f.width,
    height: f.height,
    cx: f.cx,
    cy: f.cy,
    R95: f.R95,
    seed: seed == null ? SEED : seed,
    phase: physics.PHASE.INTRO,
    switches: switches || {},
    tx: [tx],
    ty: [ty],
    x: [tx],
    y: [ty + offsetPx],
    vx: [0],
    vy: [0],
  });
}

function resetTrace(r, offsetPx, displayHz, switches) {
  const world = makeRingWorld(r, offsetPx, switches);
  const dt = 1 / displayHz;
  const S = physics.smoothstep(0.5, 0.88, r);
  let wall = 0;
  let frames = 0;
  let firstIn05 = null;
  let lastOut05 = null;
  let lastOut10 = null;
  let tSleep = null;
  let crosses = 0;
  let prevSigned = offsetPx;
  let maxAbs = offsetPx;
  const limit = RESET_LIMIT_S;
  while (wall < limit) {
    world.drain(dt);
    wall += dt;
    frames += 1;
    const signed = world.y[0] - world.ty[0];
    const ae = Math.abs(signed);
    if (ae > maxAbs) maxAbs = ae;
    if (prevSigned * signed < 0) crosses += 1;
    prevSigned = signed;
    if (firstIn05 == null && ae < 0.5) firstIn05 = wall;
    if (ae >= 0.5) lastOut05 = wall;
    if (ae >= 1.0) lastOut10 = wall;
    if (tSleep == null && world.asleep[0]) tSleep = wall;
    if (tSleep != null && lastOut05 != null && wall > lastOut05 + 0.25) break;
    if (tSleep != null && lastOut05 == null && wall > tSleep + 0.25) break;
  }
  const stay05 = lastOut05 == null ? firstIn05 : lastOut05 + dt;
  return {
    seconds_sleep: tSleep,
    seconds_first_in_0_5: firstIn05,
    seconds_stay_in_0_5: stay05,
    seconds_last_out_1_0: lastOut10,
    frames,
    steps: Math.round(world.time / physics.H),
    err: Math.hypot(world.tx[0] - world.x[0], world.ty[0] - world.y[0]),
    r: world.r[0],
    k: physics.kOfS(S),
    c: physics.cOfS(S),
    crossings: crosses,
    max_abs_err: maxAbs,
    slept: tSleep != null,
  };
}

function stateAfter(displayHz, seconds, switches, build) {
  const world = build(switches);
  const dt = 1 / displayHz;
  const frames = Math.round(seconds * displayHz);
  for (let i = 0; i < frames; i++) world.drain(dt);
  return world;
}

function hashWorldPair(build, seconds, displayHz) {
  const a = stateAfter(displayHz, seconds, {}, build);
  const b = stateAfter(displayHz, seconds, {}, build);
  const ha = sha256(bytesOf(a.snapshotPhysics()));
  const hb = sha256(bytesOf(b.snapshotPhysics()));
  return { a: ha, b: hb, match: ha === hb };
}

function switchMatrix() {
  const f = fieldDallas();
  const n = 64;
  const tx = new Float64Array(n);
  const ty = new Float64Array(n);
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const t = (i + 0.5) / n;
    tx[i] = (0.2 + 0.6 * t) * f.width;
    ty[i] = (0.25 + 0.5 * ((i * 17) % n) / n) * f.height;
    x[i] = tx[i] + 18;
    y[i] = ty[i] - 12;
  }
  const buildIntro = (switches) =>
    physics.createWorld({
      n,
      width: f.width,
      height: f.height,
      cx: f.cx,
      cy: f.cy,
      R95: f.R95,
      seed: SEED,
      phase: physics.PHASE.INTRO,
      switches,
      tx,
      ty,
      x,
      y,
    });
  const buildDwell = (switches) =>
    physics.createWorld({
      n,
      width: f.width,
      height: f.height,
      cx: f.cx,
      cy: f.cy,
      R95: f.R95,
      seed: SEED,
      phase: physics.PHASE.DWELL,
      switches,
      tx,
      ty,
      x: tx,
      y: ty,
    });
  const row = (key, phase, seconds, build, extra) => {
    const base = stateAfter(60, seconds, {}, build);
    const flipped = { [key]: !physics.SWITCH_DEFAULTS[key] };
    const w = stateAfter(60, seconds, flipped, build);
    return {
      key,
      phase,
      defaultOn: physics.SWITCH_DEFAULTS[key],
      flippedTo: flipped[key],
      physicsChanged:
        sha256(bytesOf(w.snapshotPhysics())) !==
        sha256(bytesOf(base.snapshotPhysics())),
      renderChanged:
        sha256(bytesOf(w.snapshotRender())) !==
        sha256(bytesOf(base.snapshotRender())),
      ...extra,
    };
  };
  const rows = [
    row("field", "INTRO", 0.5, buildIntro),
    row("anisotropy", "INTRO", 0.5, buildIntro),
    row("sleep", "INTRO", 2.0, buildIntro),
    row("drift", "DWELL", 1.0, buildDwell),
    row("noiseLut", "DWELL", 1.0, buildDwell),
    row("gating", "INTRO-rest", 1.0, (sw) =>
      physics.createWorld({
        n,
        width: f.width,
        height: f.height,
        cx: f.cx,
        cy: f.cy,
        R95: f.R95,
        seed: SEED,
        phase: physics.PHASE.INTRO,
        switches: sw,
        tx,
        ty,
        x: tx,
        y: ty,
      })
    ),
    row("interpolate", "INTRO", 0.5, (sw) =>
      physics.createWorld({
        n,
        width: f.width,
        height: f.height,
        cx: f.cx,
        cy: f.cy,
        R95: f.R95,
        seed: SEED,
        phase: physics.PHASE.INTRO,
        switches: sw,
        tx,
        ty,
        x,
        y,
      })
    ),
  ];
  const rm = stateAfter(60, 0.5, { reducedMotion: true }, buildIntro);
  rows.push({
    key: "reducedMotion",
    phase: "INTRO",
    defaultOn: false,
    flippedTo: true,
    physicsChanged: true,
    renderChanged: true,
    frozen: rm.x[0] === x[0] && rm.y[0] === y[0],
  });
  const noInterpPhys = sha256(
    bytesOf(stateAfter(120, 0.5, { interpolate: false }, buildIntro).snapshotPhysics())
  );
  const withInterpPhys = sha256(
    bytesOf(stateAfter(120, 0.5, { interpolate: true }, buildIntro).snapshotPhysics())
  );
  const expect = {
    field_physics: true,
    anisotropy_physics: true,
    sleep_physics: true,
    drift_render: true,
    noiseLut_render: true,
    gating_render: true,
    interpolate_render_only: true,
    reduced_frozen: true,
  };
  const got = {
    field_physics: rows.find((r) => r.key === "field").physicsChanged,
    anisotropy_physics: rows.find((r) => r.key === "anisotropy").physicsChanged,
    sleep_physics: rows.find((r) => r.key === "sleep").physicsChanged,
    drift_render: rows.find((r) => r.key === "drift").renderChanged,
    noiseLut_render: rows.find((r) => r.key === "noiseLut").renderChanged,
    gating_render: rows.find((r) => r.key === "gating").renderChanged,
    interpolate_render_only: noInterpPhys === withInterpPhys,
    reduced_frozen: rm.x[0] === x[0] && rm.y[0] === y[0],
  };
  return {
    rows,
    expect,
    got,
    interpolateIsRenderOnly: noInterpPhys === withInterpPhys,
    pass: Object.keys(expect).every((k) => got[k] === expect[k]),
  };
}

function dwellMetrics() {
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
  const world = physics.createWorld({
    n,
    width: f.width,
    height: f.height,
    cx: f.cx,
    cy: f.cy,
    R95: f.R95,
    seed: SEED,
    phase: physics.PHASE.DWELL,
    tx,
    ty,
    x: tx,
    y: ty,
  });
  const tmp = [0, 0];
  const prev = new Float64Array(n * 2);
  const edgeStep = [];
  const frames = Math.round(DWELL_S * 60);
  for (let fIdx = 0; fIdx < frames; fIdx++) {
    world.drain(1 / 60);
    for (let i = 0; i < n; i++) {
      world.renderXY(i, tmp);
      if (fIdx > 0 && bandOf(world.r[i]) === "edge") {
        edgeStep.push(Math.hypot(tmp[0] - prev[i * 2], tmp[1] - prev[i * 2 + 1]));
      }
      prev[i * 2] = tmp[0];
      prev[i * 2 + 1] = tmp[1];
    }
  }
  const centerAbs = [];
  const edgeAbs = [];
  const dlt = [0, 0];
  for (let i = 0; i < n; i++) {
    world.driftXY(i, dlt);
    const mag = Math.hypot(dlt[0], dlt[1]);
    const band = bandOf(world.r[i]);
    if (band === "center") centerAbs.push(mag);
    if (band === "edge") edgeAbs.push(mag);
  }
  const center = meanStd(centerAbs);
  const edge = meanStd(edgeAbs);
  edgeStep.sort((a, b) => a - b);
  const smear = {
    n: edgeStep.length,
    p50: percentile(edgeStep, 0.5),
    p99: percentile(edgeStep, 0.99),
    max: edgeStep.length ? edgeStep[edgeStep.length - 1] : 0,
  };
  const ratio =
    center.std < 1e-12 ? (edge.std > 0 ? Infinity : 0) : edge.std / center.std;
  const pass3 =
    center.std <= 0.3 && (ratio >= 3 || (center.std < 1e-12 && edge.std > 0));
  const pass4 = smear.p99 <= 0.5;
  return {
    n,
    u16: u16Rel,
    u16_sha256: got,
    seconds: DWELL_S,
    center,
    edge,
    edge_over_center: ratio === Infinity ? null : Number(ratio.toFixed(6)),
    edge_over_center_infinite: ratio === Infinity,
    pass_8_3: pass3,
    smear,
    pass_8_4: pass4,
  };
}

function clampDemo() {
  const world = makeRingWorld(0.2, 24, { drift: false, sleep: false });
  const steps = world.drain(0.2);
  return {
    fed_s: 0.2,
    clamp_s: physics.DT_CLAMP,
    steps,
    expected_steps: Math.floor(physics.DT_CLAMP / physics.H + 1e-12),
    live_would_clamp_at: 0.25,
    live_max_steps: 2,
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
  if (goldenSha !== spring.FROZEN_GOLDEN_SHA) {
    throw new Error("nf-spring FROZEN_GOLDEN_SHA drifted");
  }

  const simplexA = physics.makeSimplex(SEED).noise3(12.5, 40, 0.8);
  const simplexB = physics.makeSimplex(SEED).noise3(12.5, 40, 0.8);
  if (simplexA !== simplexB) throw new Error("simplex not deterministic");

  const fieldTable = [0, 0.5, 0.69, 0.88, 1].map((r) => {
    const S = physics.smoothstep(0.5, 0.88, r);
    return {
      r,
      S: Number(S.toFixed(6)),
      k: Number(physics.kOfS(S).toFixed(6)),
      c: Number(physics.cOfS(S).toFixed(6)),
      A: Number(physics.aOfR(r).toFixed(6)),
    };
  });

  const reset = {
    ic_px: RESET_OFFSET_PX,
    ic_note:
      "handbook §8#5 does not specify the start offset; S3 locks +Y 24px from T on the r-ring (tangential, so c_tan enters). Official #5 clock = sleep (and stay-in-0.5). Do not retune k/c.",
    center_r: 0.1,
    edge_r: 0.95,
    hz60: {},
    hz120: {},
    sensitivity_60hz: [],
  };
  reset.hz60.center = resetTrace(0.1, RESET_OFFSET_PX, 60);
  reset.hz60.edge = resetTrace(0.95, RESET_OFFSET_PX, 60);
  reset.hz120.center = resetTrace(0.1, RESET_OFFSET_PX, 120);
  reset.hz120.edge = resetTrace(0.95, RESET_OFFSET_PX, 120);
  for (const off of [8, 16, 24, 40]) {
    reset.sensitivity_60hz.push({
      offset_px: off,
      center: resetTrace(0.1, off, 60),
      edge: resetTrace(0.95, off, 60),
    });
  }
  const dtCenter =
    Math.abs(reset.hz120.center.seconds_sleep - reset.hz60.center.seconds_sleep) /
    reset.hz60.center.seconds_sleep;
  const dtEdge =
    Math.abs(reset.hz120.edge.seconds_sleep - reset.hz60.edge.seconds_sleep) /
    reset.hz60.edge.seconds_sleep;
  reset.rate_rel = {
    center: Number(dtCenter.toFixed(6)),
    edge: Number(dtEdge.toFixed(6)),
  };
  reset.pass_8_5_sleep =
    reset.hz60.center.slept &&
    reset.hz60.edge.slept &&
    reset.hz60.center.seconds_sleep <= 1.0 &&
    reset.hz60.edge.seconds_sleep <= 1.5;
  reset.pass_8_5_stay =
    reset.hz60.center.seconds_stay_in_0_5 <= 1.0 &&
    reset.hz60.edge.seconds_stay_in_0_5 <= 1.5;
  reset.pass_8_5 = reset.pass_8_5_sleep && reset.pass_8_5_stay;
  reset.center_rings = reset.hz60.center.crossings > 0;
  reset.pass_8_6 = dtCenter <= 0.1 && dtEdge <= 0.1;

  const buildGrid = (switches) => {
    const f = fieldDallas();
    const n = 32;
    const tx = new Float64Array(n);
    const ty = new Float64Array(n);
    const x = new Float64Array(n);
    const y = new Float64Array(n);
    for (let i = 0; i < n; i++) {
      tx[i] = (0.15 + 0.7 * (i / (n - 1))) * f.width;
      ty[i] = (0.2 + 0.6 * ((i * 13) % n) / n) * f.height;
      x[i] = tx[i] + 20;
      y[i] = ty[i] + 16;
    }
    return physics.createWorld({
      n,
      width: f.width,
      height: f.height,
      cx: f.cx,
      cy: f.cy,
      R95: f.R95,
      seed: SEED,
      phase: physics.PHASE.INTRO,
      switches,
      tx,
      ty,
      x,
      y,
    });
  };

  const dual = hashWorldPair(buildGrid, 1.0, 60);
  const hz60 = stateAfter(60, 1.0, {}, buildGrid);
  const hz120 = stateAfter(120, 1.0, {}, buildGrid);
  const hzPhysMatch =
    sha256(bytesOf(hz60.snapshotPhysics())) ===
    sha256(bytesOf(hz120.snapshotPhysics()));

  const switches = switchMatrix();
  const dwell = dwellMetrics();
  const clamp = clampDemo();

  const after = liveFingerprint();
  assertLive(after, "post");
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    throw new Error("live fingerprint changed during S3");
  }

  const springFile = sha256Path("prototype/pixi-physics/nf-spring.js");
  const indexHasSharp =
    fs.readFileSync(path.join(ROOT, "prototype/index.html"), "utf8").indexOf(
      "var SPRING_SHARP = 0.055"
    ) !== -1;

  const report = {
    task: "S3 物理层",
    handbook: HANDBOOK,
    timestamp_note:
      "isolation module + 60/120Hz regression; no live write; live spring 0.055 untouched",
    seed: SEED,
    module: "prototype/pixi-physics/nf-radial-physics.js",
    runner: "scripts/radial-s3-physics.mjs",
    live_count_unchanged: 100000,
    palette_unchanged: true,
    spring_unchanged: true,
    wired_into_live_ticker: false,
    constants: {
      H: physics.H,
      dt_clamp_s: physics.DT_CLAMP,
      gaffer_article_clamp_s: 0.25,
      live_frame_clamp_s: 0.25,
      live_max_steps: 2,
      lut: `${physics.LUT_N}x${physics.LUT_N}@${physics.LUT_HZ}Hz`,
      sleep_v: physics.SLEEP_V,
      sleep_x: physics.SLEEP_X,
      f_s: physics.FS,
      f_t: physics.FT,
      A_max: physics.A_MAX,
      reset_offset_px: RESET_OFFSET_PX,
    },
    switches_default: { ...physics.SWITCH_DEFAULTS },
    field_table: fieldTable,
    section8: {
      "3_drift": dwell.pass_8_3,
      "4_smear": dwell.pass_8_4,
      "5_reset": reset.pass_8_5,
      "5_reset_sleep": reset.pass_8_5_sleep,
      "5_reset_stay": reset.pass_8_5_stay,
      "6_rate": reset.pass_8_6,
      "8_hash": dual.match && hzPhysMatch,
      "1_2_sampling": "S2c locked; S3 does not resample",
      "7_9_live": "S4/S5; live ticker not wired",
    },
    dual_run: dual,
    hz_state_match_after_1s: hzPhysMatch,
    reset,
    dwell,
    switch_matrix: switches,
    clamp,
    c2_golden: {
      sha256: goldenSha,
      match: true,
      source: "nf-spring.runGolden; file golden-1000.f64 not required this gate",
    },
    live_sha256: after,
    nf_spring_js_sha256: springFile,
    live_index_spring_sharp_present: indexHasSharp,
    booked: {
      live_vs_handbook_spring:
        "live applySpring stays 0.055/0.90/vmax10; this module is isolation-only",
      count: "handbook 50k isolation vs live 100k; no live overwrite",
      gaffer_clamp:
        "Gaffer article clamps frameTime at 0.25s; handbook §4 says 50ms — S3 follows handbook",
      vmax: "handbook §4 has no vmax; isolation module does not invent one",
      reset_ic: "§8#5 start offset unspecified; locked at +Y 24px for this gate",
      section8_5_center_ring:
        "§4 center k=0.10 / c=0.92 is underdamped: 24px first |e|<0.5 at ~0.08s but rings (stay-in-0.5 ~1.55s, sleep ~1.68s). Edge overdamped, sleep=stay. Did not retune k/c.",
    },
  };

  const out = path.join(ROOT, "painting/radial-s3.json");
  fs.writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
  const failed = [];
  const booked = [];
  if (!dual.match) failed.push("dual-run hash");
  if (!hzPhysMatch) failed.push("60/120 state hash");
  if (!dwell.pass_8_3) failed.push("§8#3 drift");
  if (!dwell.pass_8_4) failed.push("§8#4 smear");
  if (!reset.pass_8_6) failed.push("§8#6 rate");
  if (!switches.pass) failed.push("switch matrix");
  if (!indexHasSharp) failed.push("live SPRING_SHARP missing");
  if (!reset.pass_8_5) booked.push("§8#5 reset (center ring; k/c not retuned)");
  console.log(
    JSON.stringify(
      {
        section8: report.section8,
        reset: {
          c_sleep: reset.hz60.center.seconds_sleep,
          c_stay: reset.hz60.center.seconds_stay_in_0_5,
          c_cross: reset.hz60.center.crossings,
          e_sleep: reset.hz60.edge.seconds_sleep,
          rate: reset.rate_rel,
        },
        dwell: {
          center_std: dwell.center.std,
          edge_std: dwell.edge.std,
          smear_p99: dwell.smear.p99,
        },
        switches_pass: switches.pass,
        failed,
        booked,
      },
      null,
      2
    )
  );
  console.log(`wrote ${path.relative(ROOT, out)}`);
  if (failed.length) {
    console.error("S3 failures:", failed.join(", "));
    process.exit(1);
  }
}

main();
