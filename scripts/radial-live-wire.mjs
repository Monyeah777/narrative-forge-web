#!/usr/bin/env node
/**
 * Live wire: handbook 50k + §4 physics on the Pixi exhibit.
 * Does not rewrite 100k bins, SPRING_SHARP, or load nf-radial-render.js.
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
const S3_DUAL = "cdff787751379eca069c205dbeb730f7b34a13e85c9902dee0959acee143aa19";
const FROZEN_GOLDEN = "dc1f16092d775ee1462c94eb964bb95523470bd7fd7770b1efab02c6940f320a";

const LIVE_SHA = {
  "prototype/pixi-cloud/dallas-100k.bin":
    "6406d7012e7f637ad2e31661a85f619ebd14b85bb48a6341a1ec9c3a2dbcea82",
  "prototype/pixi-hall/scotland-100k.bin":
    "bbeab899140521bad56e82766f92a3d63305b8bc8f802de22db804fad3bfcf5f",
  "prototype/pixi-community/met-100k.bin":
    "3144fdb9144d95cb0afe30f28629ec1e065bfa5022400a80e1c8e93129779a45",
};

const U16_SHA = {
  "painting/radial-s2b-dallas-50k.u16":
    "f6df3397eb97fef511377cdf903a89544860086a78d07c1eb0191f6ff4f3add6",
  "painting/radial-s2b-scotland-50k.u16":
    "700e9d525a731766fd17f4c4872754138c81a09ca40db1928dfc5865b97d914f",
  "painting/radial-s2b-met-50k.u16":
    "a4f4a7a1579858445140595b08883829237f466df1eb781efaed02c12b1efc46",
};

const RADIAL_BINS = [
  {
    name: "dallas",
    bin: "prototype/pixi-cloud/dallas-radial-50k.bin",
    meta: "prototype/pixi-cloud/meta-radial.json",
    u16: "painting/radial-s2b-dallas-50k.u16",
    count: 50601,
    R95: 0.599042,
  },
  {
    name: "scotland",
    bin: "prototype/pixi-hall/scotland-radial-50k.bin",
    meta: "prototype/pixi-hall/meta-radial.json",
    u16: "painting/radial-s2b-scotland-50k.u16",
    count: 50441,
    R95: 0.599053,
  },
  {
    name: "met",
    bin: "prototype/pixi-community/met-radial-50k.bin",
    meta: "prototype/pixi-community/meta-radial.json",
    u16: "painting/radial-s2b-met-50k.u16",
    count: 50471,
    R95: 0.592304,
  },
];

const physics = require("../prototype/pixi-physics/nf-radial-physics.js");
const spring = require("../prototype/pixi-physics/nf-spring.js");
const pointsBin = require("../prototype/pixi-bridge/points-bin.js");

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function sha256Path(rel) {
  return sha256(fs.readFileSync(path.join(ROOT, rel)));
}

function bytesOf(float64) {
  return Buffer.from(float64.buffer, float64.byteOffset, float64.byteLength);
}

function readU16(rel) {
  const raw = fs.readFileSync(path.join(ROOT, rel));
  if (raw.length % 4) throw new Error(`${rel} size ${raw.length} not multiple of 4`);
  const u16 = new Uint16Array(raw.buffer, raw.byteOffset, raw.length / 2);
  const n = u16.length / 2;
  const xs = new Uint16Array(n);
  const ys = new Uint16Array(n);
  for (let i = 0; i < n; i++) {
    xs[i] = u16[i * 2];
    ys[i] = u16[i * 2 + 1];
  }
  return { n, xs, ys };
}

function fieldDallas() {
  return { width: 1200, height: 1540, cx: 0.5, cy: 0.5, R95: 0.599042 };
}

function isolationDualHash() {
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
  const build = () =>
    physics.createWorld({
      n,
      width: f.width,
      height: f.height,
      cx: f.cx,
      cy: f.cy,
      R95: f.R95,
      seed: SEED,
      phase: physics.PHASE.INTRO,
      tx,
      ty,
      x,
      y,
    });
  const run = () => {
    const world = build();
    for (let i = 0; i < 60; i++) world.drain(1 / 60);
    return sha256(bytesOf(world.snapshotPhysics()));
  };
  const a = run();
  const b = run();
  return { a, b, match: a === b && a === S3_DUAL };
}

function normRDiffers() {
  const n = 4;
  const tx = new Float64Array([100, 200, 300, 400]);
  const ty = new Float64Array([80, 160, 240, 320]);
  const normX = new Float64Array([0.1, 0.2, 0.8, 0.9]);
  const normY = new Float64Array([0.1, 0.2, 0.8, 0.9]);
  const base = physics.createWorld({
    n,
    width: 1200,
    height: 1540,
    cx: 0.5,
    cy: 0.5,
    R95: 0.599042,
    seed: SEED,
    tx,
    ty,
  });
  const live = physics.createWorld({
    n,
    width: 1200,
    height: 1540,
    cx: 0.35,
    cy: 0.5,
    R95: 0.599042,
    seed: SEED,
    tx,
    ty,
    normX,
    normY,
  });
  let changed = false;
  for (let i = 0; i < n; i++) {
    if (Math.abs(base.r[i] - live.r[i]) > 1e-9) changed = true;
  }
  return { changed, base: Array.from(base.r), live: Array.from(live.r) };
}

const failed = [];
for (const [rel, expect] of Object.entries(LIVE_SHA)) {
  const got = sha256Path(rel);
  if (got !== expect) failed.push(`live ${rel}`);
}
for (const [rel, expect] of Object.entries(U16_SHA)) {
  const got = sha256Path(rel);
  if (got !== expect) failed.push(`u16 ${rel}`);
}

const cases = [];
for (const job of RADIAL_BINS) {
  const buf = fs.readFileSync(path.join(ROOT, job.bin));
  const meta = JSON.parse(fs.readFileSync(path.join(ROOT, job.meta), "utf8"));
  const pts = pointsBin.readPointsBin(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), meta.count);
  const u16 = readU16(job.u16);
  if (pts.length !== job.count) failed.push(`${job.name} count`);
  if (meta.count !== job.count) failed.push(`${job.name} meta.count`);
  if (meta.R95 !== job.R95) failed.push(`${job.name} R95`);
  if (meta.palette.length !== 256) failed.push(`${job.name} palette`);
  let coordMatch = true;
  for (let i = 0; i < pts.length; i++) {
    if (pts[i].x !== u16.xs[i] || pts[i].y !== u16.ys[i]) {
      coordMatch = false;
      break;
    }
  }
  if (!coordMatch) failed.push(`${job.name} coord copy`);
  cases.push({
    name: job.name,
    count: pts.length,
    sha256: sha256(buf),
    coord_copy: coordMatch,
    palette_n: meta.palette.length,
    R95: meta.R95,
  });
}

const indexSrc = fs.readFileSync(path.join(ROOT, "prototype/index.html"), "utf8");
const indexHasSharp = indexSrc.includes("var SPRING_SHARP = 0.055");
const loadsPhysics = indexSrc.includes('loadScriptOnce("pixi-physics/nf-radial-physics.js")');
const loadsRender = indexSrc.includes("nf-radial-render.js");
const hasRollback = indexSrc.includes('get("radial") !== "0"');
const keepsPixi = indexSrc.includes("NFPixiRenderer.draw");
if (!indexHasSharp) failed.push("SPRING_SHARP");
if (!loadsPhysics) failed.push("live does not load nf-radial-physics.js");
if (loadsRender) failed.push("live loads nf-radial-render.js");
if (!hasRollback) failed.push("?radial=0 missing");
if (!keepsPixi) failed.push("Pixi draw missing");

const dual = isolationDualHash();
if (!dual.match) failed.push("S3 isolation dual hash");

const golden = spring.runGolden();
const goldenSha = sha256(spring.goldenBytes(golden.seq));
if (goldenSha !== FROZEN_GOLDEN) failed.push("C2 golden");

const norm = normRDiffers();
if (!norm.changed) failed.push("normX/normY did not change r");

const report = {
  task: "现网径向重映射接线",
  handbook: HANDBOOK,
  timestamp_note:
    "live Pixi + S2b 50k NFPT + §4 physics; 100k bins kept; ImageData renderer not loaded; E off",
  seed: SEED,
  default_on: true,
  rollback: "?radial=0 → 100k + applySpring 0.055; ?bin=0 → 12k JSON",
  live_100k_unchanged: failed.filter((x) => x.startsWith("live ")).length === 0,
  spring_unchanged: indexHasSharp && goldenSha === FROZEN_GOLDEN,
  isolation_s3_hash: dual,
  norm_r: norm,
  cases,
  live_sha256: Object.fromEntries(Object.keys(LIVE_SHA).map((rel) => [rel, sha256Path(rel)])),
  u16_sha256: Object.fromEntries(Object.keys(U16_SHA).map((rel) => [rel, sha256Path(rel)])),
  index: {
    SPRING_SHARP: indexHasSharp,
    loads_nf_radial_physics: loadsPhysics,
    loads_nf_radial_render: loadsRender,
    radial_query_default_on: hasRollback,
    pixi_draw: keepsPixi,
  },
  booked: {
    E: "S4 petition stays booked; not enabled",
    render: "live stays Pixi ParticleContainer; no ImageData swap",
    egg: "NF glyph stays JSON / not radially remapped; live radial physics now covers egg/chaos/disperse",
    handbookShape: "live createWorld switches.handbookShape=true; isolation default false",
    imagedata: "A–D stay isolation; live Pixi maps A=sleep B=n/a C=LUT D=sleep-center; E booked",
  },
  pass: failed.length === 0,
  failed,
};

const out = path.join(ROOT, "painting/radial-live.json");
fs.writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ pass: report.pass, failed, cases, s3: dual.a }, null, 2));
if (failed.length) process.exit(1);
