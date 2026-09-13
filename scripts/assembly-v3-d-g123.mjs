#!/usr/bin/env node
/**
 * Assembly volume v3.0 Phase D — 生成序列 G1–G3 复跑（批次 3 / T3.3）。
 *
 * 与 Phase A（scripts/assembly-v3-a-audit.mjs）的差别：
 *   A 记录的是「到点 snapAll 写终态」的旧规则，本闸复刻现网新规则
 *   （p = 1 − rms/rms0，固定步长驱动；切换需 p ≥ 0.995 且 rms ≤ 3px；不写终态）。
 * 只读：不改 bin、不改现网物理；输出 painting/assembly-v3-d-g123.json 与 rms svg。
 */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VOL = "docs/NF_粒子装配模块_整合总卷_v3.0.md";
const INDEX = fs.readFileSync(path.join(ROOT, "prototype/index.html"), "utf8");
const physics = require("../prototype/pixi-physics/nf-radial-physics.js");

const U16 = path.join(ROOT, "painting/radial-s2b-dallas-50k.u16");
const U16_SHA = "f6df3397eb97fef511377cdf903a89544860086a78d07c1eb0191f6ff4f3add6";
const N_TRACE = 4000;
const W = 1200;
const H = 1540;
const R95 = 0.599042;
const STOP_PX = 0.6;
const STOP_V = 0.06;
const BUDGET_S = 2.4; /* introRevealMs 2400 / 1000 */
const MIN_S = 1.2;
const CLOSE_RMS = 3.0;
const CLOSE_CAP_S = 1.5;
const POST_S = 0.6; /* 切换后再追一段曲线，确认尾部连续 */

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}
function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  return lo === hi ? sorted[lo] : sorted[lo] * (hi - i) + sorted[hi] * (i - lo);
}
function decodeU16(rel) {
  const raw = fs.readFileSync(rel);
  const u16 = new Uint16Array(raw.buffer, raw.byteOffset, raw.length / 2);
  const n = u16.length / 2;
  const xy = new Float64Array(n * 2);
  for (let i = 0; i < n; i++) {
    xy[i * 2] = u16[i * 2] / 65535;
    xy[i * 2 + 1] = u16[i * 2 + 1] / 65535;
  }
  return { n, xy, sha: sha256(raw) };
}
function mulberry(seed) {
  let t = seed >>> 0;
  return function () {
    t += 0x6d2b79f5;
    let x = t;
    x = Math.imul(x ^ (x >>> 15), x | 1);
    x ^= x + Math.imul(x ^ (x >>> 7), x | 61);
    return ((x ^ (x >>> 14)) >>> 0) / 4294967296;
  };
}
function cloudSeed(n, rng) {
  const x = new Float64Array(n);
  const y = new Float64Array(n);
  const sig = 0.26 * Math.min(W, H);
  for (let i = 0; i < n; i++) {
    const r = Math.sqrt(-2 * Math.log(Math.max(rng(), 1e-12))) * sig;
    const a = 2 * Math.PI * rng();
    x[i] = 0.5 * W + r * Math.cos(a);
    y[i] = 0.5 * H + r * Math.sin(a);
  }
  return { x, y };
}
function makeWorld(xy, n, seedPos) {
  const tx = new Float64Array(n);
  const ty = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    tx[i] = xy[i * 2] * W;
    ty[i] = xy[i * 2 + 1] * H;
  }
  return physics.createWorld({
    n,
    width: W,
    height: H,
    cx: 0.5,
    cy: 0.5,
    R95,
    seed: 0x413331,
    phase: physics.PHASE.INTRO,
    switches: { handbookShape: true, drift: false, sleep: true },
    tx,
    ty,
    x: seedPos.x,
    y: seedPos.y,
  });
}
function rmsToTarget(world) {
  let s = 0;
  for (let i = 0; i < world.n; i++) {
    const dx = world.tx[i] - world.x[i];
    const dy = world.ty[i] - world.y[i];
    s += dx * dx + dy * dy;
  }
  return Math.sqrt(s / world.n);
}
function settledFrac(world) {
  let n = 0;
  for (let i = 0; i < world.n; i++) {
    if (
      Math.abs(world.tx[i] - world.x[i]) < STOP_PX &&
      Math.abs(world.ty[i] - world.y[i]) < STOP_PX &&
      Math.abs(world.vx[i]) < STOP_V &&
      Math.abs(world.vy[i]) < STOP_V
    )
      n++;
  }
  return n / world.n;
}
function p99Step(world, px, py) {
  const d = new Float64Array(world.n);
  for (let i = 0; i < world.n; i++) d[i] = Math.hypot(world.x[i] - px[i], world.y[i] - py[i]);
  return percentile(Array.from(d).sort((a, b) => a - b), 0.99);
}
function snapAll(world) {
  for (let i = 0; i < world.n; i++) {
    world.x[i] = world.tx[i];
    world.y[i] = world.ty[i];
    world.vx[i] = 0;
    world.vy[i] = 0;
  }
}

/** rule: "gate" = 现网新规则（完成度门控，不写终态）；"snap" = 旧规则（到点 snapAll）。 */
function runSequence(xy, displayHz, rule) {
  const seed = cloudSeed(N_TRACE, mulberry(0x4e46));
  const world = makeWorld(xy, N_TRACE, seed);
  const dt = 1 / displayHz;
  const rms0 = rmsToTarget(world);
  const curve = [];
  const stepP99 = [];
  const prevX = Float64Array.from(world.x);
  const prevY = Float64Array.from(world.y);
  let switched = null;
  let capHit = 0;
  let acc = 0;
  const frames = Math.round((BUDGET_S + CLOSE_CAP_S + POST_S) * displayHz);
  for (let f = 0; f < frames; f++) {
    /* == O1④ 时钟对齐 == 与现网一致：时间源 deltaMS、钳到 MAX_FRAME_MS=50ms、不限步。 */
    let ft = dt;
    if (ft > 0.05) ft = 0.05;
    acc += ft;
    let steps = 0;
    while (acc >= physics.H) {
      world.drain(physics.H);
      acc -= physics.H;
      steps += 1;
    }
    const t = world.time;
    const rms = rmsToTarget(world);
    const p = 1 - rms / Math.max(rms0, 1e-9);
    const settled = settledFrac(world);
    const d99 = p99Step(world, prevX, prevY);
    prevX.set(world.x);
    prevY.set(world.y);
    stepP99.push(d99);
    curve.push({
      t: Math.round(t * 1000) / 1000,
      frame: f,
      steps,
      rms: Math.round(rms * 1000) / 1000,
      p: Math.round(p * 10000) / 10000,
      settled: Math.round(settled * 10000) / 10000,
      p99: Math.round(d99 * 1000) / 1000,
      post: !!switched,
    });
    if (switched) continue;
    const due = t >= BUDGET_S || (t >= Math.min(MIN_S, BUDGET_S) && settled >= 0.97);
    if (!due) continue;
    if (rule === "snap") {
      const before = { x: Float64Array.from(world.x), y: Float64Array.from(world.y) };
      snapAll(world);
      const d = p99Step(world, before.x, before.y);
      stepP99.push(d);
      switched = {
        t: Math.round(t * 1000) / 1000,
        frame: f,
        rule: "snap",
        p99: Math.round(d * 1000) / 1000,
        p_before: Math.round(p * 10000) / 10000,
        rms_before: Math.round(rms * 1000) / 1000,
        settled_before: Math.round(settled * 10000) / 10000,
      };
      curve.push({ t: switched.t, frame: f + 0.5, rms: 0, p: 1, settled: 1, p99: switched.p99, snap: true, post: true });
      break;
    }
    if (t >= BUDGET_S + CLOSE_CAP_S) {
      capHit++;
      switched = { t: Math.round(t * 1000) / 1000, frame: f, rule: "cap", p99: Math.round(d99 * 1000) / 1000, p: Math.round(p * 10000) / 10000, rms: Math.round(rms * 1000) / 1000 };
      continue;
    }
    if (p >= 0.995 && rms <= CLOSE_RMS) {
      switched = {
        t: Math.round(t * 1000) / 1000,
        frame: f,
        rule: "gate",
        p99: Math.round(d99 * 1000) / 1000,
        p: Math.round(p * 10000) / 10000,
        rms: Math.round(rms * 1000) / 1000,
        settled: Math.round(settled * 10000) / 10000,
      };
    }
  }
  const phys = curve.filter((c) => !c.snap);
  const nonZero = [...stepP99].filter((v) => v > 0).sort((a, b) => a - b);
  const median = percentile(nonZero, 0.5);
  const p99max = stepP99.length ? Math.max(...stepP99) : 0;
  let trailFail = false;
  let trailWorst = 0;
  for (const c of phys) {
    const win = phys.filter((x) => x.t < c.t && x.t >= c.t - 1 && x.p99 > 0).map((x) => x.p99);
    if (!win.length) continue;
    const med = percentile([...win].sort((a, b) => a - b), 0.5);
    const ratio = med > 0 ? c.p99 / med : 0;
    if (ratio > trailWorst) trailWorst = ratio;
    if (ratio > 3) trailFail = true;
  }
  if (switched && switched.rule !== "snap" && phys.length) {
    const win = phys.filter((c) => c.t > switched.t - 1 && c.t < switched.t).map((c) => c.p99);
    const med = win.length ? percentile([...win].sort((a, b) => a - b), 0.5) : 0;
    const ratio = med > 0 ? switched.p99 / med : 0;
    if (ratio > trailWorst) trailWorst = ratio;
    if (ratio > 3) trailFail = true;
    switched.prev1s_median = Math.round(med * 1000) / 1000;
    switched.prev1s_ratio = Math.round(ratio * 10) / 10;
  }
  if (switched && switched.rule === "snap" && phys.length) {
    const win = phys.filter((c) => c.t >= switched.t - 1 && c.p99 > 0).map((c) => c.p99);
    const med = win.length ? percentile([...win].sort((a, b) => a - b), 0.5) : 0;
    const ratio = med > 0 ? switched.p99 / med : 999;
    if (ratio > trailWorst) trailWorst = ratio;
    if (ratio > 3) trailFail = true;
    switched.prev1s_median = Math.round(med * 1000) / 1000;
    switched.prev1s_ratio = Math.round(ratio * 10) / 10;
  }
  const later = phys.filter((c) => c.p >= 0.6);
  const span = phys.length ? phys[phys.length - 1].t - phys[0].t : 0;
  const laterSpan = later.length ? later[later.length - 1].t - later[0].t : 0;
  let mono = true;
  for (let i = 1; i < phys.length; i++) if (phys[i].rms > phys[i - 1].rms + 0.25) mono = false;
  let tailMono = true;
  const preTail = phys.filter((c) => c.t <= (switched ? switched.t : 0));
  for (let i = 1; i < preTail.length; i++) if (preTail[i].rms > preTail[i - 1].rms + 0.25) tailMono = false;
  return {
    hz: displayHz,
    rule,
    rms0: Math.round(rms0 * 100) / 100,
    switched,
    capHit,
    p99_max: Math.round(p99max * 1000) / 1000,
    p99_median_nonzero: Math.round(median * 1000) / 1000,
    spike_over_3x_median: Boolean(median > 0 && p99max > 3 * median),
    spike_over_3x_prev1s: trailFail,
    prev1s_worst_ratio: Math.round(trailWorst * 10) / 10,
    later_frac: span > 0 ? Math.round((laterSpan / span) * 1000) / 1000 : 0,
    rms_monotonic: mono,
    rms_monotonic_until_switch: tailMono,
    post_switch_frames: phys.filter((c) => c.post).length,
    last: curve[curve.length - 1],
    curve_every_8: curve.filter((_, i) => i % 8 === 0 || curve[i].snap || (switched && curve[i].frame === switched.frame)),
  };
}

function svgRms(gate60, snap60, dest) {
  const w = 760;
  const h = 300;
  const pad = 40;
  const seqs = [
    { seq: gate60, color: "#6F8FAF", label: "new: completion gate (no snap)" },
    { seq: snap60, color: "#c45c48", label: "old: snapAll at budget" },
  ];
  const t1 = Math.max(...seqs.flatMap((s) => s.seq.curve_every_8.map((c) => c.t)), 0.01);
  const r1 = Math.max(...seqs.flatMap((s) => s.seq.curve_every_8.map((c) => c.rms)), 1);
  const poly = (s) =>
    `<polyline fill="none" stroke="${s.color}" stroke-width="1.6" points="${s.seq.curve_every_8
      .filter((c) => !c.snap || c.snap)
      .map((c) => {
        const x = pad + ((w - 2 * pad) * c.t) / t1;
        const y = h - pad - ((h - 2 * pad) * c.rms) / r1;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ")}" />`;
  const svg = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="#050505"/>
  <text x="${pad}" y="22" fill="#c8d2dc" font-size="12">G1 RMS to target · Dallas 4k cloud seed</text>
  ${seqs.map(poly).join("\n  ")}
  <text x="${pad}" y="${h - 10}" fill="#8a96a3" font-size="10">blue ${seqs[0].label} · red ${seqs[1].label}</text>
</svg>
`;
  fs.writeFileSync(dest, svg);
}

function main() {
  const u16 = decodeU16(U16);
  if (u16.sha !== U16_SHA) throw new Error("dallas u16 mutated");
  const gate60 = runSequence(u16.xy, 60, "gate");
  const gate120 = runSequence(u16.xy, 120, "gate");
  const snap60 = runSequence(u16.xy, 60, "snap");
  const snap120 = runSequence(u16.xy, 120, "snap");
  const hzDeltaGate = Math.abs((gate60.switched?.t || 0) - (gate120.switched?.t || 0));
  const hzDeltaSnap = Math.abs((snap60.switched?.t || 0) - (snap120.switched?.t || 0));
  const tailPct = Math.round(gate60.later_frac * 1000) / 10;
  const g = {
    G1: {
      want: "RMS 平滑单调；后段（p≥0.6）时长 ≥ 全程 35%",
      rms_monotonic_60: gate60.rms_monotonic,
      rms_monotonic_until_switch_60: gate60.rms_monotonic_until_switch,
      later_frac_60: gate60.later_frac,
      later_pct: tailPct,
      pass: gate60.rms_monotonic && gate60.rms_monotonic_until_switch && gate60.later_frac >= 0.35,
    },
    G2: {
      want: "单帧位移 P99 ≤ 3× 前一秒中位数（禁 snap 冲线）",
      gate_p99_max_60: gate60.p99_max,
      gate_switch_p99_60: gate60.switched?.p99,
      gate_prev1s_ratio_60: gate60.prev1s_worst_ratio,
      snap_p99_60: snap60.switched?.p99,
      snap_prev1s_ratio_60: snap60.prev1s_worst_ratio,
      spike_gate_60: gate60.spike_over_3x_prev1s,
      spike_gate_120: gate120.spike_over_3x_prev1s,
      spike_snap_60: snap60.spike_over_3x_prev1s,
      pass: !gate60.spike_over_3x_prev1s && !gate120.spike_over_3x_prev1s,
    },
    G3: {
      want: "代码审计 + 60/120Hz 一致",
      live_rule_in_index: /assembleCloseReady\(/.test(INDEX),
      snap_call_removed_from_assemble: !/snapAllToTargets\(\);\s*\n\s*setMode\("formed"\)/.test(INDEX),
      snap_still_defined: /function snapAllToTargets/.test(INDEX),
      switch_t_60: gate60.switched?.t,
      switch_t_120: gate120.switched?.t,
      switch_t_delta_s: Math.round(hzDeltaGate * 1000) / 1000,
      old_switch_t_delta_s: Math.round(hzDeltaSnap * 1000) / 1000,
      dual_rate_pass: hzDeltaGate <= 0.05,
      pass: /assembleCloseReady\(/.test(INDEX) && hzDeltaGate <= 0.05,
    },
  };
  const out = {
    task: "assembly-v3-D-g123",
    volume: VOL,
    batch: "Codex 批次 3 / T3.3 生成序列修复",
    n_trace: N_TRACE,
    rule: {
      budget_s: BUDGET_S,
      min_s: MIN_S,
      close_rms_px: CLOSE_RMS,
      close_cap_s: CLOSE_CAP_S,
      p_floor: 0.995,
      terminal_write: "none（F3）",
    },
    sequences: { gate60, gate120, snap60, snap120 },
    g,
  };
  svgRms(gate60, snap60, path.join(ROOT, "painting/assembly-v3-d-rms.svg"));
  fs.writeFileSync(path.join(ROOT, "painting/assembly-v3-d-g123.json"), JSON.stringify(out, null, 2) + "\n");
  console.log(
    JSON.stringify(
      {
        G1_pass: g.G1.pass,
        G2_pass: g.G2.pass,
        G3_pass: g.G3.pass,
        gate60_switch: gate60.switched,
        gate120_switch: gate120.switched,
        snap60_switch: snap60.switched,
        tail_pct: tailPct,
      },
      null,
      2
    )
  );
}

main();
