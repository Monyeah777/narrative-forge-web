#!/usr/bin/env node
/**
 * S6: strict handbook-term pass on live-wire.
 * Isolation defaults / 100k bins / C2 golden / S3 dual hash stay put.
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

const physics = require("../prototype/pixi-physics/nf-radial-physics.js");
const spring = require("../prototype/pixi-physics/nf-spring.js");

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function sha256Path(rel) {
  return sha256(fs.readFileSync(path.join(ROOT, rel)));
}

function bytesOf(float64) {
  return Buffer.from(float64.buffer, float64.byteOffset, float64.byteLength);
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

function resetTrace(r, offsetPx, displayHz, switches) {
  const f = fieldDallas();
  const tx = (f.cx + r * f.R95) * f.width;
  const ty = f.cy * f.height;
  const world = physics.createWorld({
    n: 1,
    width: f.width,
    height: f.height,
    cx: f.cx,
    cy: f.cy,
    R95: f.R95,
    seed: SEED,
    phase: physics.PHASE.INTRO,
    switches: switches || {},
    tx: [tx],
    ty: [ty],
    x: [tx],
    y: [ty + offsetPx],
    vx: [0],
    vy: [0],
  });
  const dt = 1 / displayHz;
  let wall = 0;
  let crosses = 0;
  let prevSigned = offsetPx;
  let tSleep = null;
  while (wall < 4) {
    world.drain(dt);
    wall += dt;
    const signed = world.y[0] - world.ty[0];
    if (prevSigned * signed < 0) crosses += 1;
    prevSigned = signed;
    if (tSleep == null && world.asleep[0]) tSleep = wall;
    if (tSleep != null && wall > tSleep + 0.25) break;
  }
  const S = physics.smoothstep(0.5, 0.88, r);
  const k = physics.kOfS(S);
  return {
    r,
    k,
    c_handbook: physics.cOfS(S),
    c_crit: physics.cCrit(k),
    c_shaped: physics.cShaped(k, S),
    crossings: crosses,
    seconds_sleep: tSleep,
    slept: tSleep != null,
    disc_handbook: physics.discKc(k, physics.cOfS(S)),
    disc_shaped: physics.discKc(k, physics.cShaped(k, S)),
    disc_crit: physics.discKc(k, physics.cCrit(k)),
  };
}

const failed = [];
for (const [rel, expect] of Object.entries(LIVE_SHA)) {
  if (sha256Path(rel) !== expect) failed.push(`live ${rel}`);
}

if (typeof physics.cShaped !== "function") failed.push("cShaped missing");
if (physics.SWITCH_DEFAULTS.handbookShape !== false) failed.push("isolation handbookShape default");

const c0 = physics.cShaped(0.1, 0);
const c1 = physics.cShaped(0.02, 1);
if (Math.abs(c0 - physics.cCrit(0.1)) > 1e-12) failed.push("center shape != c*");
if (!(c1 < physics.cCrit(0.02) - 1e-6)) failed.push("edge shape not overdamped");
if (physics.discKc(0.1, physics.cOfS(0)) >= 0) failed.push("handbook center should oscillate");
if (physics.discKc(0.1, c0) > 1e-9) failed.push("shaped center disc");

const handbook = resetTrace(0, 24, 60, { criticalDamp: false, handbookShape: false, anisotropy: false });
const crit = resetTrace(0, 24, 60, { criticalDamp: true, handbookShape: false, anisotropy: false });
const shaped = resetTrace(0, 24, 60, { criticalDamp: true, handbookShape: true, anisotropy: false });
const shapedEdge = resetTrace(1, 24, 60, { criticalDamp: true, handbookShape: true, anisotropy: false });
if (handbook.crossings < 4) failed.push("handbook pair did not oscillate");
if (crit.crossings !== 0) failed.push("c* oscillated");
if (shaped.crossings !== 0) failed.push("handbookShape center oscillated");
if (shapedEdge.crossings !== 0) failed.push("handbookShape edge oscillated");
if (!(shaped.seconds_sleep > 0 && shaped.seconds_sleep <= 1.0)) failed.push("shaped center settle");
if (!(shapedEdge.seconds_sleep > 0 && shapedEdge.seconds_sleep <= 1.5)) failed.push("shaped edge settle");

const dual = isolationDualHash();
if (!dual.match) failed.push("S3 isolation dual hash");

const golden = spring.runGolden();
const goldenSha = sha256(spring.goldenBytes(golden.seq));
if (goldenSha !== FROZEN_GOLDEN) failed.push("C2 golden");

const indexSrc = fs.readFileSync(path.join(ROOT, "prototype/index.html"), "utf8");
const checks = {
  SPRING_SHARP: indexSrc.includes("var SPRING_SHARP = 0.055"),
  handbookShape: indexSrc.includes("handbookShape: true"),
  sceneKey: indexSrc.includes("function radialSceneKey"),
  glyphScene: indexSrc.includes('return "glyph"'),
  chaosHomes: indexSrc.includes('mode === "chaos"'),
  handoverSync: indexSrc.includes("syncRadialFromLive(true)"),
  noImageDataLive: !indexSrc.includes("nf-radial-render.js"),
  pixiDraw: indexSrc.includes("NFPixiRenderer.draw"),
  rollback: indexSrc.includes('get("radial") !== "0"'),
  A_sleep: indexSrc.includes('A_centerBake: "sleep"'),
  E_booked: indexSrc.includes('E_petition: "booked-not-enabled"'),
};
for (const [name, ok] of Object.entries(checks)) {
  if (!ok) failed.push(`index ${name}`);
}

const s6 = JSON.parse(fs.readFileSync(path.join(ROOT, "painting/radial-s6.json"), "utf8"));
if (!s6.pass) failed.push("density metric report");
if (!s6.vose_alias || !s6.vose_alias.pass) failed.push("vose alias");
for (const row of s6.table || []) {
  if (!row.pass_8_1 || !row.pass_efficiency) failed.push(`density ${row.name}`);
}

const report = {
  task: "S6 最高严谨检索优化",
  handbook: HANDBOOK,
  timestamp_note:
    "second full §7 search; density ceiling; handbookShape; radial on chaos/egg; Pixi A–D map; no resample; no ImageData swap; E off",
  isolation_s3_hash: dual,
  live_100k_unchanged: failed.filter((x) => x.startsWith("live ")).length === 0,
  spring_unchanged: checks.SPRING_SHARP && goldenSha === FROZEN_GOLDEN,
  physics: {
    handbook_center: handbook,
    crit_center: crit,
    shaped_center: shaped,
    shaped_edge: shapedEdge,
    c_shaped_center: c0,
    c_shaped_edge: c1,
  },
  index: checks,
  density: {
    design: s6.design_W0_over_W1,
    upgrade: s6.upgrade,
    table: (s6.table || []).map((row) => ({
      name: row.name,
      wide: row.wide_band.achieved,
      wide_theo: row.wide_band.theoretical,
      efficiency: row.wide_band.efficiency,
      shell: row.thin_shell_05.achieved,
      shell_theo: row.thin_shell_05.theoretical,
    })),
  },
  live_sha256: Object.fromEntries(Object.keys(LIVE_SHA).map((rel) => [rel, sha256Path(rel)])),
  pass: failed.length === 0,
  failed,
};

const out = path.join(ROOT, "painting/radial-s6-strict.json");
fs.writeFileSync(out, JSON.stringify(report, null, 2) + "\n");
console.log(JSON.stringify({ pass: report.pass, failed, density: report.density.table, s3: dual.a }, null, 2));
if (failed.length) process.exit(1);
