#!/usr/bin/env node
/** H1-⑨ live INTRO default 100k v3 bin; ?bin=0 keeps 12k JSON. */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const puppeteer = require("/tmp/node_modules/puppeteer-core");
const NFSpring = require("../prototype/pixi-physics/nf-spring.js");
const NFPointsBin = require("../prototype/pixi-bridge/points-bin.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PROTO = path.join(ROOT, "prototype");
const LIVE = path.join(PROTO, "index.html");
const BIN = path.join(PROTO, "pixi-cloud/dallas-100k.bin");
const VENDOR = path.join(PROTO, "vendor/pixi.min.js");
const GOLDEN = path.join(PROTO, "pixi-physics/golden-1000.f64");
const ART = "/opt/cursor/artifacts";
const PORT = Number(process.env.NF_BENCH_PORT || 8786);
const FROZEN_VENDOR = "9948591083793305468d73915a3ea85032dcf8e32eee7a1328585050d7a14d53";
const FROZEN_BIN = "1499db850a9da7856763f974ec79ff1d14be42503a66ab7fb8193954711f1880";
const FROZEN_GOLDEN = "dc1f16092d775ee1462c94eb964bb95523470bd7fd7770b1efab02c6940f320a";
const CHROME =
  process.env.CHROME_PATH ||
  ["/usr/local/bin/google-chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find((p) =>
    fs.existsSync(p)
  );

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".bin": "application/octet-stream",
  ".f64": "application/octet-stream",
  ".css": "text/css; charset=utf-8",
  ".jpg": "image/jpeg",
  ".png": "image/png",
  ".woff2": "font/woff2",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
};

function send(res, code, body, type) {
  res.writeHead(code, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}

function resolveFile(urlPath) {
  const rel = decodeURIComponent(urlPath).replace(/^\/+/, "") || "index.html";
  const painting = path.resolve(ROOT, rel);
  if (rel.startsWith("painting/") && painting.startsWith(path.join(ROOT, "painting"))) return painting;
  const file = path.resolve(PROTO, rel);
  if (file.startsWith(PROTO)) return file;
  return null;
}

function serve() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
      const file = resolveFile(url.pathname);
      if (!file) {
        send(res, 403, "forbidden", "text/plain");
        return;
      }
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        send(res, 404, "not found", "text/plain");
        return;
      }
      const ext = path.extname(file).toLowerCase();
      send(res, 200, fs.readFileSync(file), MIME[ext] || "application/octet-stream");
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
    server.on("error", reject);
  });
}

function uniqueArt(name) {
  const dest = path.join(ART, name);
  if (!fs.existsSync(dest)) return dest;
  const ext = path.extname(name);
  const stem = name.slice(0, -ext.length);
  let i = 2;
  while (fs.existsSync(path.join(ART, `${stem}_${i}${ext}`))) i++;
  return path.join(ART, `${stem}_${i}${ext}`);
}

function shaFile(file) {
  return createHash("sha256").update(fs.readFileSync(file)).digest("hex");
}

function goldenGate() {
  const frozenBuf = fs.readFileSync(GOLDEN);
  const run = NFSpring.runGolden(1000);
  const runBuf = Buffer.from(run.seq.buffer, run.seq.byteOffset, run.seq.byteLength);
  const frozenSha = createHash("sha256").update(frozenBuf).digest("hex");
  const runSha = createHash("sha256").update(runBuf).digest("hex");
  return {
    command: spawnSync("sha256sum", [GOLDEN], { encoding: "utf8" }).stdout.trim(),
    frozenSha,
    runSha,
    pass: frozenSha === FROZEN_GOLDEN && runSha === FROZEN_GOLDEN,
  };
}

function binGate() {
  const buf = fs.readFileSync(BIN);
  const sha = shaFile(BIN);
  const points = NFPointsBin.readPointsBin(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    100000
  );
  return {
    command: spawnSync("sha256sum", [BIN], { encoding: "utf8" }).stdout.trim(),
    sha,
    bytes: buf.length,
    count: points.length,
    pass: sha === FROZEN_BIN && buf.length === 500000 && points.length === 100000,
  };
}

function grepLive() {
  const src = fs.readFileSync(LIVE, "utf8");
  return {
    has_physics: /function physics\s*\(/.test(src),
    has_apply_spring: /function applySpring\s*\(/.test(src),
    spring: /SPRING_SHARP = 0\.055/.test(src),
    no_raf_tick: !/requestAnimationFrame\s*\(\s*tick\s*\)/.test(src),
    uses_bin: /dallas-100k\.bin/.test(src),
    dataview_bridge: /NFPointsBin\.readPointsBin/.test(src),
    rollback: /get\("bin"\) !== "0"/.test(src),
    pass:
      /function physics\s*\(/.test(src) &&
      /function applySpring\s*\(/.test(src) &&
      /SPRING_SHARP = 0\.055/.test(src) &&
      !/requestAnimationFrame\s*\(\s*tick\s*\)/.test(src) &&
      /dallas-100k\.bin/.test(src) &&
      /NFPointsBin\.readPointsBin/.test(src) &&
      /get\("bin"\) !== "0"/.test(src),
  };
}

async function runPage(browser, qs, expectN) {
  const page = await browser.newPage();
  await page.setViewport({ width: 800, height: 980, deviceScaleFactor: 1 });
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  await page.goto(`http://127.0.0.1:${PORT}/index.html?${qs}`, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  const readyUntil = Date.now() + 20000;
  let live = null;
  while (Date.now() < readyUntil) {
    live = await page.evaluate(() => window.__nfPixiLive || null);
    if (live && live.ready && live.n === expectN) break;
    await new Promise((r) => setTimeout(r, 50));
  }
  await page.evaluate(() => {
    if (typeof window.assemble === "function") window.assemble();
  });
  let mode = "";
  const formedUntil = Date.now() + 20000;
  while (Date.now() < formedUntil) {
    const snap = await page.evaluate(() => ({
      live: window.__nfPixiLive || null,
      mode: (window.__nfRender && window.__nfRender.mode) || "",
      n: (window.__nfRender && window.__nfRender.n) || 0,
    }));
    live = snap.live || live;
    mode = snap.mode;
    if (snap.mode === "formed" && snap.n === expectN && snap.live && snap.live.ready) break;
    await new Promise((r) => setTimeout(r, 100));
  }
  return { page, live, mode, pageErrors };
}

async function main() {
  const golden = goldenGate();
  const bin = binGate();
  const liveGrep = grepLive();
  const vendorSha = shaFile(VENDOR);
  if (!golden.pass) throw new Error("C2 golden failed: " + JSON.stringify(golden));
  if (!bin.pass) throw new Error("bin gate failed: " + JSON.stringify(bin));
  if (!liveGrep.pass) throw new Error("live grep failed: " + JSON.stringify(liveGrep));
  if (vendorSha !== FROZEN_VENDOR) throw new Error("vendor sha drift " + vendorSha);

  const server = await serve();
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: CHROME,
      headless: "new",
      args: ["--no-sandbox", "--ignore-gpu-blocklist"],
    });
    const def = await runPage(browser, "autoplay=0&dpr=1", 100000);
    const shot100k = uniqueArt("pixi_h1_9_live_100k.png");
    if (fs.existsSync(ART)) await def.page.screenshot({ path: shot100k, fullPage: false });

    const rb = await runPage(browser, "bin=0&autoplay=0&dpr=1", 12000);
    const shot12k = uniqueArt("pixi_h1_9_live_bin0_12k.png");
    if (fs.existsSync(ART)) await rb.page.screenshot({ path: shot12k, fullPage: false });

    const report = {
      task: "H1-⑨ live INTRO 100k v3 bin",
      handbook: "docs/NF_PixiJS迁移总手册_整合版_v1_2026-09-11.md",
      timestamp: new Date().toISOString(),
      vendorSha,
      golden,
      bin,
      liveGrep,
      default100k: { live: def.live, mode: def.mode, pageErrors: def.pageErrors },
      rollback12k: { live: rb.live, mode: rb.mode, pageErrors: rb.pageErrors },
      screenshots: { live_100k: shot100k, bin0_12k: shot12k },
      acceptance: {
        vendor_lock: vendorSha === FROZEN_VENDOR,
        golden_sha: golden.pass,
        bin_reuse: bin.pass,
        live_grep: liveGrep.pass,
        default_n: !!(def.live && def.live.n === 100000),
        default_count: !!(def.live && def.live.count === 100000),
        default_formed: def.mode === "formed",
        default_webgl: !!(def.live && def.live.rendererName === "webgl"),
        default_version: !!(def.live && def.live.version === "8.20.1"),
        default_high: !!(def.live && def.live.priority === "HIGH"),
        default_no_pageerror: def.pageErrors.length === 0,
        rollback_n: !!(rb.live && rb.live.n === 12000),
        rollback_formed: rb.mode === "formed",
        rollback_no_pageerror: rb.pageErrors.length === 0,
        physics_kept: liveGrep.has_physics && liveGrep.has_apply_spring,
        spring_lock: liveGrep.spring,
      },
    };
    report.acceptance.pass = Object.values(report.acceptance).every(Boolean);
    fs.writeFileSync(path.join(ROOT, "painting/pixi-h1-9-100k.json"), JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report, null, 2));
    if (!report.acceptance.pass) throw new Error("H1-⑨ acceptance failed");
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
