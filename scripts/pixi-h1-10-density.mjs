#!/usr/bin/env node
/** H1-⑩ isolated 100k / 150k / 250k density bench. Live INTRO stays 100k. */
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
const DENSITY = path.join(PROTO, "pixi-density");
const PAGE = path.join(DENSITY, "index.html");
const CLOUD_BIN = path.join(PROTO, "pixi-cloud/dallas-100k.bin");
const BIN_150 = path.join(DENSITY, "dallas-150k.bin");
const BIN_250 = path.join(DENSITY, "dallas-250k.bin");
const VENDOR = path.join(PROTO, "vendor/pixi.min.js");
const GOLDEN = path.join(PROTO, "pixi-physics/golden-1000.f64");
const ART = "/opt/cursor/artifacts";
const PORT = Number(process.env.NF_BENCH_PORT || 8787);
const FROZEN_VENDOR = "9948591083793305468d73915a3ea85032dcf8e32eee7a1328585050d7a14d53";
const FROZEN_GOLDEN = "dc1f16092d775ee1462c94eb964bb95523470bd7fd7770b1efab02c6940f320a";
const FROZEN_100K = "1499db850a9da7856763f974ec79ff1d14be42503a66ab7fb8193954711f1880";
const FROZEN_150K = "d7d709d5d3475050d6781aac63e750400e3d77c2960f195a4b98d0777a727e82";
const FROZEN_250K = "31abff9b19b7482ca4ad43a9e3a71170945bfc3712d2ebc0ea528e26fe26e0a2";
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

const TIERS = [
  { n: 100000, file: CLOUD_BIN, label: "100k", shot: "pixi_h1_10_density_100k.png" },
  { n: 150000, file: BIN_150, label: "150k", shot: "pixi_h1_10_density_150k.png" },
  { n: 250000, file: BIN_250, label: "250k", shot: "pixi_h1_10_density_250k.png" },
];

function send(res, code, body, type) {
  res.writeHead(code, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}

function resolveFile(urlPath) {
  const rel = decodeURIComponent(urlPath).replace(/^\/+/, "") || "pixi-density/index.html";
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

function binRecord(file, count) {
  const buf = fs.readFileSync(file);
  const sha = shaFile(file);
  const gz = spawnSync("gzip", ["-9", "-c", file], { encoding: "buffer", maxBuffer: 8e6 });
  const points = NFPointsBin.readPointsBin(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    count
  );
  const sidecar = file + ".sha256";
  const sidecarSha = fs.existsSync(sidecar)
    ? fs.readFileSync(sidecar, "utf8").trim().split(/\s+/)[0]
    : null;
  return {
    file: path.relative(ROOT, file),
    command: {
      sha256sum: spawnSync("sha256sum", [file], { encoding: "utf8" }).stdout.trim(),
      wc: spawnSync("wc", ["-c", file], { encoding: "utf8" }).stdout.trim(),
      gzip9: String(gz.stdout ? gz.stdout.length : -1),
    },
    sha,
    sidecarSha,
    bytes: buf.length,
    gzip9: gz.stdout ? gz.stdout.length : -1,
    count: points.length,
    pass:
      buf.length === count * 5 &&
      points.length === count &&
      (sidecarSha == null || sidecarSha === sha),
  };
}

function grepDensity() {
  const src = fs.readFileSync(PAGE, "utf8");
  const hits = {
    at_pixi: /@pixi\//.test(src),
    sprite: /new PIXI\.Sprite\b|Sprite\.from/.test(src),
    addChild_particle: /addChild\(\s*new PIXI\.Particle/.test(src),
    beginFill: /beginFill/.test(src),
    app_view: /\bapp\.view\b/.test(src),
    ctor_options: /new PIXI\.Application\s*\(\s*\{/.test(src),
    second_raf: /requestAnimationFrame\s*\(/.test(src),
  };
  const required = {
    addParticle: /addParticle\(/.test(src),
    particle: /new PIXI\.Particle\s*\(/.test(src),
    boundsArea: /boundsArea/.test(src),
    update: /container\.update\(\)/.test(src),
    soft128: /makeSoftDot\(128\)/.test(src),
    scale_3_128: /3 \/ 128/.test(src),
    hook: /__nfPixiDensity/.test(src),
    reuse_100k: /pixi-cloud\/dallas-100k\.bin/.test(src),
  };
  return {
    hits,
    required,
    pass: Object.values(hits).every((h) => h === false) && Object.values(required).every(Boolean),
  };
}

function grepLive() {
  const src = fs.readFileSync(LIVE, "utf8");
  const hits = {
    has_physics: /function physics\s*\(/.test(src),
    has_apply_spring: /function applySpring\s*\(/.test(src),
    spring: /SPRING_SHARP = 0\.055/.test(src),
    no_raf_tick: !/requestAnimationFrame\s*\(\s*tick\s*\)/.test(src),
    uses_100k: /dallas-100k\.bin/.test(src),
    no_150k_live: !/dallas-150k\.bin/.test(src),
    no_250k_live: !/dallas-250k\.bin/.test(src),
    dataview_bridge: /NFPointsBin\.readPointsBin/.test(src),
    rollback: /get\("bin"\) !== "0"/.test(src),
  };
  return {
    ...hits,
    pass: Object.values(hits).every(Boolean),
  };
}

async function waitDensity(page, n, ms) {
  const deadline = Date.now() + ms;
  let snap = null;
  while (Date.now() < deadline) {
    snap = await page.evaluate(() => window.__nfPixiDensity || null);
    if (snap && snap.count === n && snap.ok && snap.ticks >= 1) return snap;
    if (snap && snap.ok === false && snap.error) return snap;
    await new Promise((r) => setTimeout(r, 100));
  }
  return snap;
}

async function runTier(browser, tier) {
  const page = await browser.newPage();
  await page.setViewport({ width: 800, height: 980, deviceScaleFactor: 1 });
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  await page.goto(`http://127.0.0.1:${PORT}/pixi-density/index.html?n=${tier.n}`, {
    waitUntil: "domcontentloaded",
    timeout: 60_000,
  });
  const waitMs = tier.n >= 250000 ? 90_000 : tier.n >= 150000 ? 60_000 : 30_000;
  let density = await waitDensity(page, tier.n, waitMs);
  const fpsSamples = [];
  const dwellUntil = Date.now() + 3000;
  while (Date.now() < dwellUntil) {
    const snap = await page.evaluate(() => window.__nfPixiDensity || null);
    if (snap && typeof snap.fps === "number") fpsSamples.push(snap.fps);
    density = snap || density;
    await new Promise((r) => setTimeout(r, 200));
  }
  const shot = uniqueArt(tier.shot);
  if (fs.existsSync(ART)) await page.screenshot({ path: shot, fullPage: false });
  await page.close().catch(() => {});
  const fpsMean =
    fpsSamples.length > 0 ? fpsSamples.reduce((a, b) => a + b, 0) / fpsSamples.length : 0;
  return {
    n: tier.n,
    density,
    pageErrors,
    screenshot: shot,
    fpsSamples,
    fpsMean,
    fpsNote: "this-VM software GL; do not fail the gate on low FPS; do not cut count",
  };
}

async function main() {
  const golden = goldenGate();
  const vendorSha = shaFile(VENDOR);
  const bin100 = binRecord(CLOUD_BIN, 100000);
  bin100.pass = bin100.pass && bin100.sha === FROZEN_100K;
  const bin150 = binRecord(BIN_150, 150000);
  bin150.pass = bin150.pass && bin150.sha === FROZEN_150K;
  const bin250 = binRecord(BIN_250, 250000);
  bin250.pass = bin250.pass && bin250.sha === FROZEN_250K;
  const grepPage = grepDensity();
  const liveGrep = grepLive();
  if (!golden.pass) throw new Error("C2 golden failed: " + JSON.stringify(golden));
  if (vendorSha !== FROZEN_VENDOR) throw new Error("vendor sha drift " + vendorSha);
  if (!bin100.pass) throw new Error("100k frozen bin drifted: " + JSON.stringify(bin100));
  if (!bin150.pass) throw new Error("150k bin failed: " + JSON.stringify(bin150));
  if (!bin250.pass) throw new Error("250k bin failed: " + JSON.stringify(bin250));
  if (!grepPage.pass) throw new Error("density grep failed: " + JSON.stringify(grepPage));
  if (!liveGrep.pass) throw new Error("live grep failed: " + JSON.stringify(liveGrep));

  const server = await serve();
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: CHROME,
      headless: "new",
      args: ["--no-sandbox", "--ignore-gpu-blocklist"],
    });
    const tiers = {};
    for (const tier of TIERS) {
      tiers[tier.label] = await runTier(browser, tier);
    }

    const livePage = await browser.newPage();
    await livePage.setViewport({ width: 800, height: 980, deviceScaleFactor: 1 });
    const liveErrors = [];
    livePage.on("pageerror", (err) => liveErrors.push(String(err)));
    await livePage.goto(`http://127.0.0.1:${PORT}/index.html?autoplay=0&dpr=1`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    const liveUntil = Date.now() + 20000;
    let live = null;
    while (Date.now() < liveUntil) {
      live = await livePage.evaluate(() => window.__nfPixiLive || null);
      if (live && live.ready && live.n === 100000) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    await livePage.close().catch(() => {});

    const report = {
      task: "H1-⑩ isolated density 100k / 150k / 250k",
      handbook: "docs/NF_PixiJS迁移总手册_整合版_v1_2026-09-11.md",
      timestamp: new Date().toISOString(),
      vendorSha,
      golden,
      bins: { "100k": bin100, "150k": bin150, "250k": bin250 },
      grepPage,
      liveGrep,
      tiers,
      liveStill100k: { live, pageErrors: liveErrors },
      note: {
        live_default: "INTRO stays dallas-100k.bin; 150k/250k are isolated bench only",
        fps: "this-VM software GL is not the author-device 60fps bar",
        volume: "uint16 coords stay high-entropy; do not shrink bins to fake ≤200KB br",
      },
      acceptance: {
        vendor_lock: vendorSha === FROZEN_VENDOR,
        golden_sha: golden.pass,
        frozen_100k: bin100.pass && bin100.sha === FROZEN_100K,
        bin_150k: bin150.pass && bin150.count === 150000 && bin150.bytes === 750000,
        bin_250k: bin250.pass && bin250.count === 250000 && bin250.bytes === 1250000,
        grep_page: grepPage.pass,
        live_grep: liveGrep.pass,
        live_still_100k: !!(live && live.n === 100000),
        tier_100k: !!(tiers["100k"].density && tiers["100k"].density.count === 100000 && tiers["100k"].density.ok),
        tier_150k: !!(tiers["150k"].density && tiers["150k"].density.count === 150000 && tiers["150k"].density.ok),
        tier_250k: !!(tiers["250k"].density && tiers["250k"].density.count === 250000 && tiers["250k"].density.ok),
        webgl_100k: !!(tiers["100k"].density && tiers["100k"].density.rendererName === "webgl"),
        webgl_150k: !!(tiers["150k"].density && tiers["150k"].density.rendererName === "webgl"),
        webgl_250k: !!(tiers["250k"].density && tiers["250k"].density.rendererName === "webgl"),
        version_100k: !!(tiers["100k"].density && tiers["100k"].density.version === "8.20.1"),
        version_150k: !!(tiers["150k"].density && tiers["150k"].density.version === "8.20.1"),
        version_250k: !!(tiers["250k"].density && tiers["250k"].density.version === "8.20.1"),
        no_pageerror_100k: tiers["100k"].pageErrors.length === 0,
        no_pageerror_150k: tiers["150k"].pageErrors.length === 0,
        no_pageerror_250k: tiers["250k"].pageErrors.length === 0,
        physics_kept: liveGrep.has_physics && liveGrep.has_apply_spring,
        spring_lock: liveGrep.spring,
        no_live_150_250: liveGrep.no_150k_live && liveGrep.no_250k_live,
        count_not_cut: true,
      },
    };
    report.acceptance.pass = Object.values(report.acceptance).every(Boolean);
    fs.writeFileSync(path.join(ROOT, "painting/pixi-h1-10-density.json"), JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report, null, 2));
    if (!report.acceptance.pass) throw new Error("H1-⑩ acceptance failed");
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
