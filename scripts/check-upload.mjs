#!/usr/bin/env node
/**
 * 上传采样冒烟（规格 §9-A）：Node 注入合成图，跑**同一份** Worker 模块
 *   ① count 拟合后 === 目标 N
 *   ② mask 率 ∈ (0,1)  ③ s0 > 0  ④ 无 NaN  ⑤ points.length === count
 * 另跑一张「真图口径」自检：用与 Dallas 同分辨率的合成图，检查 R95 / s0 落在预期量级。
 *
 * 用法：node scripts/check-upload.mjs           （默认 N=20000 快跑）
 *       node scripts/check-upload.mjs --n=50000
 * 失败即非 0 退出。无外部依赖。
 */
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const sampler = require(path.join(ROOT, "prototype/nf-upload-worker.js"));

const argv = process.argv.slice(2);
const argN = argv.find((a) => a.startsWith("--n="));
const N = argN ? parseInt(argN.slice(4), 10) || 20000 : 20000;

/* ---- 合成图：一半深色底（不可动）+ 一半浅色圆盘（可动），带渐变以产生色彩层次 ---- */
function synth(w, h) {
  const rgba = new Uint8ClampedArray(w * h * 4);
  const cx = w * 0.42;
  const cy = h * 0.56;
  const rMax = Math.min(w, h) * 0.34;
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      const d = Math.hypot(x - cx, y - cy) / rMax;
      if (d > 1) {
        rgba[i] = 8;
        rgba[i + 1] = 8;
        rgba[i + 2] = 12;
        rgba[i + 3] = 255;
        continue;
      }
      const t = 1 - d;
      rgba[i] = Math.round(120 + 120 * t);
      rgba[i + 1] = Math.round(90 + 140 * t);
      rgba[i + 2] = Math.round(80 + 100 * t);
      rgba[i + 3] = 255;
    }
  }
  return { rgba, width: w, height: h };
}

const failures = [];
const checks = [];

function check(name, ok, detail) {
  checks.push({ name, ok, detail });
  if (!ok) failures.push(name + " — " + detail);
}

const img = synth(600, 600);
const t0 = Date.now();
const rec = sampler.runSampler(img, { count: N });
const ms = Date.now() - t0;

check("count 拟合 === N", rec.count === N, `count=${rec.count} 期望 ${N}`);
check("points.length === count", rec.points.length === rec.count, `${rec.points.length} vs ${rec.count}`);
check("mask 率 ∈ (0,1)", rec.stats.eligibleN > 0 && rec.stats.eligibleN < img.width * img.height, `eligible=${rec.stats.eligibleN}`);
check("s0 > 0", rec.stats.s0 > 0 && Number.isFinite(rec.stats.s0), `s0=${rec.stats.s0}`);
check("R95 > 0", rec.stats.r95 > 0 && Number.isFinite(rec.stats.r95), `r95=${rec.stats.r95}`);
check("palette 全 6 位 hex", rec.palette.every((c) => /^#[0-9a-f]{6}$/.test(c)), `n=${rec.palette.length}`);
check("palette 长度 ≥ 2", rec.palette.length >= 2, `n=${rec.palette.length}`);
let nan = 0;
let outOfRange = 0;
for (const p of rec.points) {
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.i)) nan += 1;
  if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) outOfRange += 1;
}
check("无 NaN", nan === 0, `nan=${nan}`);
check("坐标在 [0,1]", outOfRange === 0, `outOfRange=${outOfRange}`);
check("s0 校准有记录", Array.isArray(rec.stats.calib) && rec.stats.calib.length >= 1, `rounds=${rec.stats.rounds}`);
check("id 形如 upload-xxxxxxxx", /^upload-[0-9a-f]{8}$/.test(rec.id), rec.id);

/* 口径量级自检：圆盘半径 0.34·min(w,h) → 在归一化坐标里 R95 应落在 (0.15, 0.45) */
check("R95 量级合理(0.15–0.45)", rec.stats.r95 > 0.15 && rec.stats.r95 < 0.45, `r95=${rec.stats.r95.toFixed(4)}`);
check("dark-cull ∈ (0,100)", rec.stats.darkCullPct > 0 && rec.stats.darkCullPct < 100, `${rec.stats.darkCullPct.toFixed(2)}%`);

const report = {
  task: "check-upload",
  N,
  ms,
  sampler: sampler.VERSION,
  stats: {
    s0: +rec.stats.s0.toFixed(4),
    r95: +rec.stats.r95.toFixed(6),
    darkCullPct: +rec.stats.darkCullPct.toFixed(2),
    eligibleN: rec.stats.eligibleN,
    candN: rec.stats.candN,
    rounds: rec.stats.rounds,
    ms: rec.stats.ms,
  },
  checks,
  pass: failures.length === 0,
  failures,
};
console.log(JSON.stringify(report, null, 2));
if (failures.length) {
  console.error("\n上传采样冒烟失败：");
  for (const f of failures) console.error(" - " + f);
  process.exit(1);
}
console.error(`上传采样冒烟通过（N=${N}，${ms}ms，s0=${rec.stats.s0.toFixed(3)} R95=${rec.stats.r95.toFixed(4)}）`);
