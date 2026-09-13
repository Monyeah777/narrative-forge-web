#!/usr/bin/env node
/**
 * 守门哈希轻量守卫（批次 4 / T4.3）。
 *
 * 覆盖卷面 §1 守门哈希表里可在 CI 离线复算的四项：
 *   1) C2 golden（nf-spring 1000 步浮点序列 + golden-1000.f64 文件）
 *   2) points.bin 契约（NFPT + u8=3 + u32le count，三支现网 50k）
 *   3) S3 dual（隔离径向物理 60 步双跑一致性）
 *   4) vendor pixi.min.js（sha256 + 字节数）
 *
 * 用法：node scripts/check-goldens.mjs   （失败即非 0 退出）
 * 无外部依赖；不写任何文件；不改现网物理。
 */
import { createHash } from "node:crypto";
import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const FROZEN = {
  c2: "dc1f16092d775ee1462c94eb964bb95523470bd7fd7770b1efab02c6940f320a",
  s3dual: "cdff787751379eca069c205dbeb730f7b34a13e85c9902dee0959acee143aa19",
  vendor: "9948591083793305468d73915a3ea85032dcf8e32eee7a1328585050d7a14d53",
  vendorBytes: 818871,
};
const BINS = [
  { file: "prototype/pixi-cloud/dallas-radial-50k.bin", count: 50601 },
  { file: "prototype/pixi-hall/scotland-radial-50k.bin", count: 50441 },
  { file: "prototype/pixi-community/met-radial-50k.bin", count: 50471 },
];

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");
const failures = [];

/* 1. C2 golden -------------------------------------------------------- */
const nfSpring = require(path.join(ROOT, "prototype/pixi-physics/nf-spring.js"));
const goldenPath = path.join(ROOT, "prototype/pixi-physics/golden-1000.f64");
const goldenBuf = fs.readFileSync(goldenPath);
const runResult = nfSpring.runGolden(1000);
const runBuf = Buffer.from(runResult.seq.buffer, runResult.seq.byteOffset, runResult.seq.byteLength);
const c2 = {
  fileSha: sha256(goldenBuf),
  runSha: sha256(runBuf),
  bytes: goldenBuf.length,
  sameBytes: goldenBuf.equals(runBuf),
  locked: runResult.points.every((p) => p.x === p.tx && p.y === p.ty && p.vx === 0 && p.vy === 0),
};
if (c2.fileSha !== FROZEN.c2 || c2.runSha !== FROZEN.c2 || c2.bytes !== 48000 || !c2.sameBytes || !c2.locked) {
  failures.push("C2 golden 漂移: " + JSON.stringify(c2));
}

/* 2. points.bin 契约 -------------------------------------------------- */
const bins = BINS.map(({ file, count }) => {
  const abs = path.join(ROOT, file);
  const buf = fs.readFileSync(abs);
  const magic = buf.subarray(0, 4).toString("ascii");
  const version = buf[4];
  const declared = buf.readUInt32LE(5);
  const ok = magic === "NFPT" && version === 3 && declared === count && buf.length === 9 + 5 * declared;
  if (!ok) failures.push("NFPT 契约不符: " + file + " magic=" + magic + " ver=" + version + " count=" + declared + " bytes=" + buf.length);
  return { file, magic, version, count: declared, bytes: buf.length, ok };
});

/* 3. S3 dual ---------------------------------------------------------- */
const physics = require(path.join(ROOT, "prototype/pixi-physics/nf-radial-physics.js"));
const field = { width: 1200, height: 1540, cx: 0.5, cy: 0.5, R95: 0.599042 };
const n = 32;
const tx = new Float64Array(n);
const ty = new Float64Array(n);
const x = new Float64Array(n);
const y = new Float64Array(n);
for (let i = 0; i < n; i++) {
  tx[i] = (0.15 + 0.7 * (i / (n - 1))) * field.width;
  ty[i] = (0.2 + (0.6 * ((i * 13) % n)) / n) * field.height;
  x[i] = tx[i] + 20;
  y[i] = ty[i] + 16;
}
const runDual = () => {
  const world = physics.createWorld({ n, ...field, seed: 0x53335033, phase: physics.PHASE.INTRO, tx, ty, x, y });
  for (let i = 0; i < 60; i++) world.drain(1 / 60);
  const snap = world.snapshotPhysics();
  return sha256(Buffer.from(snap.buffer, snap.byteOffset, snap.byteLength));
};
const dualA = runDual();
const dualB = runDual();
if (dualA !== dualB || dualA !== FROZEN.s3dual) failures.push("S3 dual 漂移: a=" + dualA + " b=" + dualB + " frozen=" + FROZEN.s3dual);

/* 4. vendor ----------------------------------------------------------- */
const vendorPath = path.join(ROOT, "prototype/vendor/pixi.min.js");
const vendorBuf = fs.readFileSync(vendorPath);
const vendor = { sha: sha256(vendorBuf), bytes: vendorBuf.length };
if (vendor.sha !== FROZEN.vendor || vendor.bytes !== FROZEN.vendorBytes) {
  failures.push("vendor 漂移: " + JSON.stringify(vendor) + " 期望 " + FROZEN.vendor + " / " + FROZEN.vendorBytes);
}

const report = {
  task: "check-goldens",
  c2,
  bins,
  s3dual: { a: dualA, b: dualB, frozen: FROZEN.s3dual, ok: dualA === dualB && dualA === FROZEN.s3dual },
  vendor: { ...vendor, frozen: FROZEN.vendor, ok: vendor.sha === FROZEN.vendor && vendor.bytes === FROZEN.vendorBytes },
  pass: failures.length === 0,
  failures,
};
console.log(JSON.stringify(report, null, 2));
if (failures.length) {
  console.error("\n守门哈希守卫失败：");
  for (const f of failures) console.error(" - " + f);
  process.exit(1);
}
console.error("守门哈希守卫通过（C2 / NFPT / S3 dual / vendor）");
