#!/usr/bin/env node
/**
 * Assembly volume v3.0 Phase A — migration pack + G1–G3.
 * Read-only: no bin rewrite, no live physics change.
 */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const VOL = "docs/NF_粒子装配模块_整合总卷_v3.0.md";
const physics = require("../prototype/pixi-physics/nf-radial-physics.js");

const INDEX = fs.readFileSync(path.join(ROOT, "prototype/index.html"), "utf8");
const RENDER = fs.readFileSync(path.join(ROOT, "prototype/renderer.pixi.js"), "utf8");
const PHYS = fs.readFileSync(path.join(ROOT, "prototype/pixi-physics/nf-radial-physics.js"), "utf8");
const U16 = path.join(ROOT, "painting/radial-s2b-dallas-50k.u16");
const U16_SHA = "f6df3397eb97fef511377cdf903a89544860086a78d07c1eb0191f6ff4f3add6";
const N_TRACE = 4000;
const W = 1200;
const H = 1540;
const CX = 0.5;
const CY = 0.5;
const R95 = 0.599042;
const STOP_PX = 0.6;
const STOP_V = 0.06;
const INTRO_S = 2.4;
const MIN_S = 1.2;

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function has(src, re) {
  return re.test(src);
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

function percentile(sorted, p) {
  if (!sorted.length) return 0;
  const i = (sorted.length - 1) * p;
  const lo = Math.floor(i);
  const hi = Math.ceil(i);
  if (lo === hi) return sorted[lo];
  return sorted[lo] * (hi - i) + sorted[hi] * (i - lo);
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
    const dx = Math.abs(world.tx[i] - world.x[i]);
    const dy = Math.abs(world.ty[i] - world.y[i]);
    if (dx < STOP_PX && dy < STOP_PX && Math.abs(world.vx[i]) < STOP_V && Math.abs(world.vy[i]) < STOP_V) n++;
  }
  return n / world.n;
}

function p99Step(world, prev) {
  const d = new Float64Array(world.n);
  for (let i = 0; i < world.n; i++) {
    d[i] = Math.hypot(world.x[i] - prev.x[i], world.y[i] - prev.y[i]);
  }
  const sorted = Array.from(d).sort((a, b) => a - b);
  return percentile(sorted, 0.99);
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
    const u = rng();
    const v = rng();
    const r = Math.sqrt(-2 * Math.log(Math.max(u, 1e-12))) * sig;
    const a = 2 * Math.PI * v;
    x[i] = CX * W + r * Math.cos(a);
    y[i] = CY * H + r * Math.sin(a);
  }
  return { x, y };
}

function makeWorld(xy, n, seedPos) {
  const tx = new Float64Array(n);
  const ty = new Float64Array(n);
  const normX = new Float64Array(n);
  const normY = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    normX[i] = xy[i * 2];
    normY[i] = xy[i * 2 + 1];
    tx[i] = normX[i] * W;
    ty[i] = normY[i] * H;
  }
  return physics.createWorld({
    n,
    width: W,
    height: H,
    cx: CX,
    cy: CY,
    R95,
    seed: 0x413331,
    phase: physics.PHASE.INTRO,
    switches: { handbookShape: true, drift: false, sleep: true },
    tx,
    ty,
    x: seedPos.x,
    y: seedPos.y,
    normX,
    normY,
  });
}

function cloneXY(world) {
  return { x: Float64Array.from(world.x), y: Float64Array.from(world.y) };
}

function snapAll(world) {
  for (let i = 0; i < world.n; i++) {
    world.x[i] = world.tx[i];
    world.y[i] = world.ty[i];
    world.vx[i] = 0;
    world.vy[i] = 0;
  }
}

function runSequence(xy, displayHz, doSnap) {
  const rng = mulberry(0x4e46);
  const seed = cloudSeed(N_TRACE, rng);
  const world = makeWorld(xy, N_TRACE, seed);
  const dt = 1 / displayHz;
  const frames = Math.round(3.2 * displayHz);
  const curve = [];
  const stepP99 = [];
  let snapped = false;
  let snapFrame = null;
  let rms0 = rmsToTarget(world);
  let prev = cloneXY(world);
  let acc = 0;
  const MAX_STEPS = 2;
  const FRAME_CLAMP = 0.25;
  for (let f = 0; f < frames; f++) {
    let ft = dt;
    if (ft > FRAME_CLAMP) ft = FRAME_CLAMP;
    acc += ft;
    let steps = 0;
    while (acc >= physics.H && steps < MAX_STEPS) {
      world.drain(physics.H);
      acc -= physics.H;
      steps += 1;
    }
    const phaseElapsed = world.time;
    const rms = rmsToTarget(world);
    const p = 1 - rms / Math.max(rms0, 1e-9);
    const settled = settledFrac(world);
    const d99 = p99Step(world, prev);
    stepP99.push(d99);
    curve.push({
      t: Math.round(phaseElapsed * 1000) / 1000,
      frame: f,
      steps,
      rms: Math.round(rms * 1000) / 1000,
      p: Math.round(p * 10000) / 10000,
      settled: Math.round(settled * 10000) / 10000,
      p99: Math.round(d99 * 1000) / 1000,
    });
    prev = cloneXY(world);
    if (doSnap && !snapped) {
      if (phaseElapsed >= INTRO_S || (phaseElapsed >= MIN_S && settled >= 0.97)) {
        const before = cloneXY(world);
        snapAll(world);
        const snapD99 = p99Step(world, before);
        snapped = true;
        snapFrame = {
          t: Math.round(phaseElapsed * 1000) / 1000,
          p99: Math.round(snapD99 * 1000) / 1000,
          p_before: Math.round(p * 10000) / 10000,
          settled_before: Math.round(settled * 10000) / 10000,
        };
        stepP99.push(snapD99);
        curve.push({
          t: snapFrame.t,
          frame: f + 0.5,
          rms: 0,
          p: 1,
          settled: 1,
          p99: snapFrame.p99,
          snap: true,
        });
        break;
      }
    }
  }
  const phys = curve.filter((c) => !c.snap);
  const median = percentile([...stepP99].filter((v) => v > 0).sort((a, b) => a - b), 0.5);
  const p99max = Math.max(...stepP99);
  let trailFail = false;
  let trailWorst = 0;
  for (let i = 0; i < phys.length; i++) {
    const t = phys[i].t;
    const win = phys.filter((c) => c.t < t && c.t >= t - 1 && c.p99 > 0).map((c) => c.p99);
    if (!win.length) continue;
    const med = percentile([...win].sort((a, b) => a - b), 0.5);
    const ratio = med > 0 ? phys[i].p99 / med : 0;
    if (ratio > trailWorst) trailWorst = ratio;
    if (ratio > 3) trailFail = true;
  }
  if (snapFrame && phys.length) {
    const win = phys.filter((c) => c.t >= snapFrame.t - 1 && c.p99 > 0).map((c) => c.p99);
    const med = win.length ? percentile([...win].sort((a, b) => a - b), 0.5) : 0;
    const ratio = med > 0 ? snapFrame.p99 / med : 999;
    if (ratio > trailWorst) trailWorst = ratio;
    if (ratio > 3) trailFail = true;
    snapFrame.trail_1s_median = Math.round(med * 1000) / 1000;
    snapFrame.trail_ratio = Math.round(ratio * 10) / 10;
  }
  const later = curve.filter((c) => c.p >= 0.6 && !c.snap);
  const first = curve.filter((c) => !c.snap);
  const laterSpan = later.length ? later[later.length - 1].t - later[0].t : 0;
  const fullSpan = first.length ? first[first.length - 1].t - first[0].t : 0;
  let mono = true;
  for (let i = 1; i < first.length; i++) {
    if (first[i].rms > first[i - 1].rms + 0.25) mono = false;
  }
  return {
    hz: displayHz,
    snap: snapFrame,
    rms0: Math.round(rms0 * 100) / 100,
    p99_max: Math.round(p99max * 1000) / 1000,
    p99_median_nonzero: Math.round(median * 1000) / 1000,
    spike_over_3x_median: Boolean(median > 0 && p99max > 3 * median),
    spike_over_3x_prev1s: trailFail,
    prev1s_worst_ratio: Math.round(trailWorst * 10) / 10,
    later_frac: fullSpan > 0 ? Math.round((laterSpan / fullSpan) * 1000) / 1000 : 0,
    rms_monotonic: mono,
    last: curve[curve.length - 1],
    curve_every_8: curve.filter((_, i) => i % 8 === 0 || curve[i].snap),
  };
}

function svgRms(a60, a120, dest) {
  const w = 720;
  const h = 280;
  const pad = 36;
  function poly(seq, color) {
    const pts = seq.curve_every_8.filter((c) => !c.snap);
    if (!pts.length) return "";
    const t1 = Math.max(...pts.map((c) => c.t), 0.01);
    const r1 = Math.max(...pts.map((c) => c.rms), 1);
    return `<polyline fill="none" stroke="${color}" stroke-width="1.6" points="${pts
      .map((c) => {
        const x = pad + ((w - 2 * pad) * c.t) / t1;
        const y = h - pad - ((h - 2 * pad) * c.rms) / r1;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(" ")}" />`;
  }
  const svg = `<?xml version="1.0"?>
<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <rect width="${w}" height="${h}" fill="#050505"/>
  <text x="${pad}" y="22" fill="#c8d2dc" font-size="12">G1 RMS → target (Dallas 4k cloud seed)</text>
  ${poly(a60, "#6F8FAF")}
  ${poly(a120, "#c45c48")}
  <text x="${pad}" y="${h - 10}" fill="#8a96a3" font-size="10">blue 60Hz · red 120Hz · snap not drawn</text>
</svg>
`;
  fs.writeFileSync(dest, svg);
}

function moduleTable() {
  const rows = [
    {
      id: 1,
      name: "时间步进",
      want: "h=1/60 + 累积器 + 钳 50ms + 插值 α；时间源 deltaMS",
      have: has(PHYS, /var H = 1 \/ 60/) && has(PHYS, /DT_CLAMP = 0\.05/) && has(PHYS, /sw\.interpolate/),
      gap: has(INDEX, /ticker\.elapsedMS/)
        ? "现网 ticker.elapsedMS（未封顶）+ FRAME_CLAMP=0.25 + MAX_STEPS=2，不是卷面 deltaMS / 50ms / 不限步"
        : "",
    },
    {
      id: 2,
      name: "粒子积分",
      want: "半隐式欧拉 v←v+(f/m)h；x←x+vh",
      have: has(PHYS, /vx\[idx\] \+= \(tx\[idx\] - x\[idx\]\) \* k/) && has(PHYS, /x\[idx\] \+= vx\[idx\]/),
      gap: "",
    },
    {
      id: 3,
      name: "空间变阻尼",
      want: "k(r)=0.10−0.08S；c(r)=0.92−0.14S",
      have: has(PHYS, /K0 = 0\.1/) && has(PHYS, /C0 = 0\.92/) && has(INDEX, /handbookShape: true/),
      gap: "现网 handbookShape 把 c 改成 c* 形状混合，不是正文欠阻尼对",
    },
    {
      id: 4,
      name: "各向异性",
      want: "c_rad/c_tan = c ± 0.04·S",
      have: has(PHYS, /DELTA0 = 0\.04/) && has(PHYS, /sw\.anisotropy/),
      gap: "",
    },
    {
      id: 5,
      name: "无散度流场",
      want: "Curl-Noise w=∇×Ψ，上限 6px/s；LUT 64×64 @30Hz",
      have: has(PHYS, /LUT_N = 64/) && has(INDEX, /function curlVel/),
      gap: "径向世界 LUT 是 Simplex 位移，不是 Bridson curl 力项；旧 applySpring 才有 curl",
    },
    {
      id: 6,
      name: "生命周期",
      want: "渐入 0.6s → 保持 → 末 20%τ 渐出；τ∈[40,120]s",
      have: false,
      gap: "无 age / τ / 渐入渐出",
    },
    {
      id: 7,
      name: "稳态回收",
      want: "α≤0.01 或超 1.25·R95 → 回收重生",
      have: false,
      gap: "无回收队列",
    },
    {
      id: 8,
      name: "边界软化",
      want: "Q(r)=smoothstep(0.82,0.98)；β_max=8px/s",
      have: has(PHYS, /0\.82/) && has(PHYS, /0\.98/),
      gap: has(PHYS, /0\.82/) ? "" : "无 Q(r) 边界软化",
    },
    {
      id: 9,
      name: "驻留运动 M0–M3",
      want: "M0 涟漪 / M1 流场 / M2 尘埃 5% / M3 脉线逸散；渲染层叠加",
      have: has(INDEX, /dust: \{ enabled: true, n: 640/) && has(PHYS, /function driftAt/),
      gap: "有 Simplex drift + 640 尘埃（1.3% of 50k）。无 M0 涟漪公式，无 M3 脉线，无余韵斜坡",
    },
    {
      id: 10,
      name: "渲染合成",
      want: "x_render = x_phys + (x_target−c*)·s(t) + drift(t)；0→40%@2s→100%@8s",
      have: has(PHYS, /function renderXY/) && has(PHYS, /driftAt/),
      gap: "有插值+drift，无目标向心缩放余韵",
    },
  ];
  return rows.map((r) => ({
    ...r,
    have: !!r.have,
    pass: !!r.have && !r.gap,
  }));
}

function containerAudit() {
  return {
    ParticleContainer: has(RENDER, /new PIXI\.ParticleContainer/),
    dynamic_position: has(RENDER, /dynamicProperties: \{ position: true/),
    addParticle: has(RENDER, /container\.addParticle/),
    roundPixels_set: has(RENDER, /roundPixels:\s*true/),
    softDot_gradient: has(RENDER, /createRadialGradient/),
    clock: has(INDEX, /ticker\.elapsedMS \/ 1000/) ? "elapsedMS" : "other",
    volume_clock: "deltaMS",
    MAX_STEPS: 2,
    FRAME_CLAMP_s: 0.25,
    volume_MAX_FRAME_MS: 50,
    pixelBlock_default: 2,
    volume_pixel: 3,
    introRevealMs: 2400,
    ASSEMBLE_S: 1.5,
    snapAllToTargets: has(INDEX, /function snapAllToTargets/),
    snap_called_on_assemble_end: has(INDEX, /snapAllToTargets\(\);/),
    formed_lock: has(INDEX, /lockTo\(i, tx\[i\], ty\[i\]\)/),
    complete_neq_stop: false,
  };
}

function liveClockFacts() {
  return {
    pixi_docs: "deltaMS = capped/speed-scaled; elapsedMS = raw uncapped (PixiJS v8 Ticker)",
    live_uses: "ticker.elapsedMS / 1000 → tick() acc → physics() → radialWorld.drain(DT=1/60)",
    volume_legal: "const frameMS = Math.min(t.deltaMS, MAX_FRAME_MS); accMs += frameMS; while accMs>=FIXED_H_MS",
    mismatch: [
      "时间源名字是 elapsedMS 不是 deltaMS",
      "外层 FRAME_CLAMP=0.25s（卷面 50ms）",
      "MAX_STEPS=2 → 每帧最多推进 33ms 物理",
    ],
  };
}

function suspects(seqSnap) {
  return [
    {
      id: "X1",
      name: "包络截断写终态",
      verdict: "成立",
      evidence: "snapAllToTargets → lockTo(tx,ty) 单帧写终态；G2 snap p99=" + (seqSnap.snap && seqSnap.snap.p99),
    },
    {
      id: "X2",
      name: "状态机提前切 DWELL/formed",
      verdict: "成立",
      evidence: "phaseElapsed>=budget 或 (t>=1.2s 且 settled>=0.97) 就 snap + setMode(formed)，不是 p≥0.995",
    },
    {
      id: "X3",
      name: "帧依赖跳步",
      verdict: "部分",
      evidence: "phaseElapsed 跟物理步走，但 MAX_STEPS=2 会在掉帧时少步进",
    },
    {
      id: "X4",
      name: "交接只播一半",
      verdict: "本闸未测交接录像",
      evidence: "HANDOVER 仍走 §3 八条；本闸只测 INTRO 装配",
    },
    {
      id: "X5",
      name: "粒子池重建",
      verdict: "未在 INTRO 内触发",
      evidence: "formTargets 会 rebuildRadialWorld；同画 INTRO 不重建",
    },
    {
      id: "X6",
      name: "缓动后半冲线",
      verdict: "成立（由 snap 造成）",
      evidence: "后段不是 S 形收束，而是 snap 把 p 从 <1 拉到 1",
    },
  ];
}

function main() {
  const u16 = decodeU16(U16);
  if (u16.sha !== U16_SHA) throw new Error("dallas u16 mutated");
  const modules = moduleTable();
  const container = containerAudit();
  const clock = liveClockFacts();
  const noSnap60 = runSequence(u16.xy, 60, false);
  const snap60 = runSequence(u16.xy, 60, true);
  const snap120 = runSequence(u16.xy, 120, true);
  svgRms(snap60, snap120, path.join(ROOT, "painting/assembly-v3-a-rms.svg"));
  const hzDelta = Math.abs((snap60.snap?.t || 0) - (snap120.snap?.t || 0));
  const g = {
    G1: {
      want: "RMS 平滑单调",
      rms_monotonic_60_nosnap: noSnap60.rms_monotonic,
      later_frac_nosnap: noSnap60.later_frac,
      later_frac_want: 0.35,
      pass_nosnap_mono: noSnap60.rms_monotonic,
      pass_later: noSnap60.later_frac >= 0.35,
    },
    G2: {
      want: "单帧位移 P99 ≤ 3× 前一秒中位数",
      snap_p99_60: snap60.snap && snap60.snap.p99,
      snap_trail_ratio_60: snap60.snap && snap60.snap.trail_ratio,
      spike_60: snap60.spike_over_3x_prev1s,
      spike_120: snap120.spike_over_3x_prev1s,
      pass: !snap60.spike_over_3x_prev1s && !snap120.spike_over_3x_prev1s,
    },
    G3: {
      want: "代码审计 + 60/120 对比",
      snap_t_60: snap60.snap && snap60.snap.t,
      snap_t_120: snap120.snap && snap120.snap.t,
      snap_t_delta_s: Math.round(hzDelta * 1000) / 1000,
      suspects: suspects(snap60),
    },
  };
  const checked = modules.filter((m) => m.pass).length;
  const out = {
    task: "assembly-v3-A-migrate-G123",
    volume: VOL,
    n_trace: N_TRACE,
    modules,
    modules_pass: checked,
    modules_want: 10,
    container,
    clock,
    sequences: { noSnap60, snap60, snap120 },
    g,
    redlines_live: {
      glow_softDot: container.softDot_gradient,
      complete_eq_stop: !container.complete_neq_stop,
      pixel_2_not_3: container.pixelBlock_default === 2,
      snapAll: container.snap_called_on_assemble_end,
    },
  };
  fs.writeFileSync(
    path.join(ROOT, "painting/assembly-v3-a-migrate.json"),
    JSON.stringify(out, null, 2) + "\n"
  );
  console.log(
    JSON.stringify(
      {
        modules_pass: checked,
        G1_mono: g.G1.pass_nosnap_mono,
        G2_pass: g.G2.pass,
        snap60: snap60.snap,
        snap120: snap120.snap,
      },
      null,
      2
    )
  );
}

main();
