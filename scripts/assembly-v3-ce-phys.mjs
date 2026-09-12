#!/usr/bin/env node
/**
 * v3.0 modules 6–9: lifecycle / recycle / Q(r) / M0 / M3.
 * Isolation defaults stay off so S3 hashes do not move.
 */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import { Buffer } from "node:buffer";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const physics = require("../prototype/pixi-physics/nf-radial-physics.js");
const S3_DUAL = "cdff787751379eca069c205dbeb730f7b34a13e85c9902dee0959acee143aa19";
const SEED = 0x53335033;
const INDEX = fs.readFileSync(path.join(ROOT, "prototype/index.html"), "utf8");
const RENDER = fs.readFileSync(path.join(ROOT, "prototype/renderer.pixi.js"), "utf8");

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function bytesOf(float64) {
  return Buffer.from(float64.buffer, float64.byteOffset, float64.byteLength);
}

function field() {
  return { width: 1200, height: 1540, cx: 0.5, cy: 0.5, R95: 0.599042 };
}

function isolationDualHash() {
  const f = field();
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
  const run = () => {
    const world = physics.createWorld({
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
    for (let i = 0; i < 60; i++) world.drain(1 / 60);
    return sha256(bytesOf(world.snapshotPhysics()));
  };
  const a = run();
  const b = run();
  return { a, b, match: a === b && a === S3_DUAL };
}

function ringWorld(r, extra) {
  const f = field();
  const tx = (f.cx + r * f.R95) * f.width;
  const ty = f.cy * f.height;
  return physics.createWorld({
    n: 1,
    width: f.width,
    height: f.height,
    cx: f.cx,
    cy: f.cy,
    R95: f.R95,
    seed: 0x43453031,
    phase: physics.PHASE.DWELL,
    switches: extra || {},
    tx: [tx],
    ty: [ty],
    x: [tx],
    y: [ty],
    vx: [0],
    vy: [0],
  });
}

const failed = [];
const notes = [];

["lifecycle", "recycle", "boundaryQ", "ripple", "streak"].forEach((k) => {
  if (physics.SWITCH_DEFAULTS[k] !== false) failed.push(`default ${k}`);
});

const aIn = physics.lifeEnvelope(0.3, 80);
const aHold = physics.lifeEnvelope(20, 80);
const aOut = physics.lifeEnvelope(76, 80);
const aDead = physics.lifeEnvelope(80, 80);
if (!(aIn > 0.45 && aIn < 0.55)) failed.push(`fade-in ${aIn}`);
if (Math.abs(aHold - 1) > 1e-9) failed.push("hold");
if (!(aOut > 0 && aOut < 0.3)) failed.push(`fade-out ${aOut}`);
if (aDead !== 0) failed.push("dead alpha");
if (Math.abs(physics.dwellRamp(2) - 0.4) > 1e-9) failed.push("ramp 2s");
if (Math.abs(physics.dwellRamp(8) - 1) > 1e-9) failed.push("ramp 8s");
if (physics.qOfR(0.82) !== 0) failed.push("Q at 0.82");
if (physics.qOfR(0.98) !== 1) failed.push("Q at 0.98");
if (!(physics.qOfR(0.9) > 0.3 && physics.qOfR(0.9) < 0.7)) failed.push(`Q mid ${physics.qOfR(0.9)}`);
if (physics.weOfR(0.3) !== 0) failed.push("We center");
if (!(physics.weOfR(0.88) > 0.7)) failed.push(`We edge ${physics.weOfR(0.88)}`);

const centerKick = ringWorld(0.4, {
  boundaryQ: true,
  sleep: false,
  drift: false,
  field: false,
  anisotropy: false,
  criticalDamp: false,
});
const edgeKick = ringWorld(0.96, {
  boundaryQ: true,
  sleep: false,
  drift: false,
  field: false,
  anisotropy: false,
  criticalDamp: false,
});
centerKick.vx[0] = 1.5;
edgeKick.vx[0] = 1.5;
centerKick.stepFixed();
edgeKick.stepFixed();
if (!(Math.abs(edgeKick.vx[0]) < Math.abs(centerKick.vx[0]) - 0.02)) {
  failed.push(`Q did not soften edge vx c=${centerKick.vx[0]} e=${edgeKick.vx[0]}`);
}

const life = ringWorld(0.4, { lifecycle: true, sleep: false, drift: false });
life.lifeAge[0] = 0;
life.lifeTau[0] = 80;
for (let i = 0; i < 36; i++) life.stepFixed();
if (Math.abs(life.lifeA[0] - 1) > 0.05) failed.push(`life 0.6s ${life.lifeA[0]}`);

const rec = ringWorld(0.9, { lifecycle: true, recycle: true, sleep: false, drift: false });
rec.setPhase(physics.PHASE.DWELL);
rec.lifeAge[0] = rec.lifeTau[0];
rec.lifeA[0] = 0;
const beforeX = rec.x[0];
rec.stepFixed();
if (rec.n !== 1) failed.push("recycle lost slot");
if (!(rec.lifeAge[0] < 1e-9)) failed.push("recycle age");
const cxp = 0.5 * rec.width;
if (!(Math.abs(rec.x[0] - cxp) < Math.abs(beforeX - cxp) + 1e-6)) {
  failed.push("birth not upstream");
}

const vPhi = physics.RIPPLE_L / physics.RIPPLE_T;
if (Math.abs(vPhi - 7) > 1e-9) failed.push(`phase vel ${vPhi}`);
const dt = 0.25;
const r0 = 400;
const t0 = 3;
const phi = 0.31;
const phase0 = physics.ripplePhase(r0, t0, phi);
const phase1 = physics.ripplePhase(r0 + vPhi * dt, t0 + dt, phi);
if (Math.abs(phase1 - phase0) > 1e-9) failed.push(`crest not traveling ${phase1 - phase0}`);

const rippleC = ringWorld(0.02, { ripple: true, drift: false, sleep: false });
const rippleE = ringWorld(0.85, { ripple: true, drift: false, sleep: false });
rippleC.setPhase(physics.PHASE.DWELL);
rippleE.setPhase(physics.PHASE.DWELL);
for (let i = 0; i < 180; i++) {
  rippleC.stepFixed();
  rippleE.stepFixed();
}
const outC = [0, 0];
const outE = [0, 0];
rippleC.renderXY(0, outC);
rippleE.renderXY(0, outE);
const dC = Math.hypot(outC[0] - rippleC.x[0], outC[1] - rippleC.y[0]);
const dE = Math.hypot(outE[0] - rippleE.x[0], outE[1] - rippleE.y[0]);
const rPxE = Math.hypot(rippleE.x[0] - 0.5 * rippleE.width, rippleE.y[0] - 0.5 * rippleE.height);
const expectE = Math.abs(
  physics.rippleDisp(rPxE, 0.85, rippleE.time, rippleE.phi0, physics.dwellRamp(rippleE.time))
);
if (dC > 0.05) failed.push(`M0 center leak ${dC}`);
if (Math.abs(dE - expectE) > 1e-6) failed.push(`M0 closed form ${dE} != ${expectE}`);
if (expectE < 0.05) notes.push("M0 edge near a node at this t; formula still matched.");

const tintBefore = rippleE.tintA[0];
rippleE.renderXY(0, outE);
rippleE.renderXY(0, outE);
if (rippleE.tintA[0] !== tintBefore) failed.push("V2 accumulated in renderXY");
if (rippleE.lifeA[0] !== 1) failed.push("ripple mutated envelope");

const streakC = ringWorld(0.3, { streak: true, drift: false, sleep: false, noiseLut: true });
const streakE = ringWorld(0.88, { streak: true, drift: false, sleep: false, noiseLut: true });
streakC.setPhase(physics.PHASE.DWELL);
streakE.setPhase(physics.PHASE.DWELL);
for (let i = 0; i < 180; i++) {
  streakC.stepFixed();
  streakE.stepFixed();
}
const escC = Math.hypot(streakC.escX[0], streakC.escY[0]);
const escE = Math.hypot(streakE.escX[0], streakE.escY[0]);
if (escC > 0.5) failed.push(`M3 center escape ${escC}`);
if (escE < 2) failed.push(`M3 edge escape ${escE}`);
if (Math.abs(streakE.x[0] - streakE.tx[0]) > 1e-6 || Math.abs(streakE.y[0] - streakE.ty[0]) > 1e-6) {
  failed.push("M3 polluted physics x");
}

const dual = isolationDualHash();
if (!dual.match) failed.push(`S3 dual drifted ${dual.a}`);

if (!INDEX.includes("lifecycle: true")) failed.push("live lifecycle");
if (!INDEX.includes("ripple: true")) failed.push("live ripple");
if (!INDEX.includes("streak: true")) failed.push("live streak");
if (!INDEX.includes("radialWorld.tintA")) failed.push("live tintA");
if (!INDEX.includes('get("morph") !== "0"')) failed.push("morph rollback");
if (!RENDER.includes("alphaFrame")) failed.push("10Hz alpha");
if (!RENDER.includes("alphaFrame % 6 === 0")) failed.push("alpha not 10Hz");

const benchN = 8000;
const f = field();
const tx = new Float64Array(benchN);
const ty = new Float64Array(benchN);
for (let i = 0; i < benchN; i++) {
  const th = (i / benchN) * Math.PI * 2;
  const r = 0.15 + 0.9 * ((i * 17) % benchN) / benchN;
  tx[i] = (0.5 + r * f.R95 * Math.cos(th)) * f.width;
  ty[i] = (0.5 + r * f.R95 * Math.sin(th)) * f.height;
}
const off = physics.createWorld({
  n: benchN,
  ...f,
  seed: 1,
  phase: physics.PHASE.DWELL,
  switches: { handbookShape: true },
  tx,
  ty,
});
const on = physics.createWorld({
  n: benchN,
  ...f,
  seed: 1,
  phase: physics.PHASE.DWELL,
  switches: {
    handbookShape: true,
    lifecycle: true,
    recycle: true,
    boundaryQ: true,
    ripple: true,
    streak: true,
    noiseLut: true,
  },
  tx,
  ty,
});
on.setPhase(physics.PHASE.DWELL);
const tmp = [0, 0];
function cost(world, frames) {
  const t0 = process.hrtime.bigint();
  for (let k = 0; k < frames; k++) {
    world.drain(1 / 60);
    for (let i = 0; i < world.n; i++) world.renderXY(i, tmp);
  }
  return Number(process.hrtime.bigint() - t0) / 1e6 / frames;
}
cost(off, 4);
cost(on, 4);
const msOff = cost(off, 20);
const msOn = cost(on, 20);
const delta = msOn - msOff;
const scaled50k = (delta * 50000) / benchN;
notes.push({ msOff, msOn, delta, scaled50k });
const budget = { increment_8k_ms: delta, scaled_50k_ms: scaled50k, cap: 1.0 };
let petition = false;
if (scaled50k > 1.0) {
  petition = true;
  notes.push(
    "DWELL increment over +1.0ms at 50k scale — petition, not silent. Morph stays on; E/count cut still off."
  );
}

const out = {
  task: "assembly-v3-CE-phys",
  volume: "docs/NF_粒子装配模块_整合总卷_v3.0.md",
  sources: {
    reeves:
      "ACM TOG 2(2) 1983 §2.4: kill on lifetime=0, intensity below threshold, or leave region of interest. Frame loop: generate → attributes → extinguish → dynamics → render.",
    phase_velocity:
      "OpenStax University Physics 1 §16.1: v=λ/T=λf. Crest of u=A sin(2πt/T−2πr/λ+φ0) travels at v_φ=λ/T. Britannica cited by volume; bot-walled this run.",
    streakline:
      "Cambridge MDP node8 + MIT Unified Fluids Lect.8: streakline = particles that have passed a fixed point (continuous dye/smoke). NASA Glenn: streamline is instantaneous tangent; they coincide only in steady flow.",
    bridson:
      "Bridson, Hourihan, Nordenstam, SIGGRAPH 2007 §2.1: 2D v=(∂ψ/∂y,−∂ψ/∂x); ∇·∇×≡0, no gutters. Potential modulated, not raw Perlin velocity.",
  },
  isolation_defaults_off: true,
  s3_dual: dual.a,
  s3_dual_locked: dual.match,
  envelope: { aIn, aHold, aOut, aDead },
  Q: { center_vx: centerKick.vx[0], edge_vx: edgeKick.vx[0], q082: 0, q098: 1, q09: physics.qOfR(0.9) },
  M0: { center: dC, edge: dE, expect_edge: expectE, v_phase: vPhi, crest_phase_err: phase1 - phase0 },
  M3: { center_esc: escC, edge_esc: escE, physics_clean: true },
  budget,
  petition_E: petition,
  rollback: "?morph=0",
  pass: failed.length === 0,
  failed,
  notes,
};

fs.writeFileSync(path.join(ROOT, "painting/assembly-v3-ce.json"), JSON.stringify(out, null, 2) + "\n");
console.log(JSON.stringify({ pass: out.pass, failed, budget, s3: dual.match, petition }, null, 2));
if (failed.length) process.exit(1);
