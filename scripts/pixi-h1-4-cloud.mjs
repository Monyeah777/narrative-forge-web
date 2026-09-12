#!/usr/bin/env node
/** H1-④ 100k ParticleContainer gate + 12k live reference shot. */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const puppeteer = require("/tmp/node_modules/puppeteer-core");
const NFPointsBin = require("../prototype/pixi-bridge/points-bin.js");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PROTO = path.join(ROOT, "prototype");
const CLOUD = path.join(PROTO, "pixi-cloud");
const BIN = path.join(CLOUD, "dallas-100k.bin");
const ART = "/opt/cursor/artifacts";
const PORT = Number(process.env.NF_BENCH_PORT || 8781);
const FROZEN_SHA = "1499db850a9da7856763f974ec79ff1d14be42503a66ab7fb8193954711f1880";
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
  ".css": "text/css; charset=utf-8",
  ".jpg": "image/jpeg",
  ".png": "image/png",
};

function send(res, code, body, type) {
  res.writeHead(code, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}

function resolveFile(urlPath) {
  const rel = decodeURIComponent(urlPath).replace(/^\/+/, "") || "pixi-cloud/index.html";
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

function binGate() {
  const buf = fs.readFileSync(BIN);
  const sha = createHash("sha256").update(buf).digest("hex");
  const gz = spawnSync("gzip", ["-9", "-c", BIN], { encoding: "buffer", maxBuffer: 2e6 });
  const points = NFPointsBin.readPointsBin(
    buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength),
    100000
  );
  return {
    command: {
      sha256sum: spawnSync("sha256sum", [BIN], { encoding: "utf8" }).stdout.trim(),
      wc: spawnSync("wc", ["-c", BIN], { encoding: "utf8" }).stdout.trim(),
      gzip9: String(gz.stdout ? gz.stdout.length : -1),
    },
    sha,
    bytes: buf.length,
    gzip9: gz.stdout ? gz.stdout.length : -1,
    count: points.length,
    pass: sha === FROZEN_SHA && buf.length === 500000 && points.length === 100000,
  };
}

function grepCloud() {
  const src = fs.readFileSync(path.join(CLOUD, "index.html"), "utf8");
  const hits = {
    at_pixi: /@pixi\//.test(src),
    sprite: /new PIXI\.Sprite\b|Sprite\.from/.test(src),
    addChild_particle: /addChild\(\s*new PIXI\.Particle/.test(src),
    beginFill: /beginFill|drawRect\(/.test(src),
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
  };
  return {
    hits,
    required,
    pass: Object.values(hits).every((h) => h === false) && Object.values(required).every(Boolean),
  };
}

async function waitCloud(page) {
  const deadline = Date.now() + 20000;
  let cloud = null;
  while (Date.now() < deadline) {
    cloud = await page.evaluate(() => window.__nfPixiCloud || null);
    if (cloud && cloud.count === 100000) return cloud;
    await new Promise((r) => setTimeout(r, 50));
  }
  return cloud;
}

async function main() {
  const bin = binGate();
  const grep = grepCloud();
  if (!bin.pass) throw new Error("bin gate failed: " + JSON.stringify(bin));
  if (!grep.pass) throw new Error("grep failed: " + JSON.stringify(grep));
  const server = await serve();
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: CHROME,
      headless: "new",
      args: ["--no-sandbox", "--ignore-gpu-blocklist"],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 800, height: 980, deviceScaleFactor: 1 });
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(String(err)));
    await page.goto(`http://127.0.0.1:${PORT}/pixi-cloud/index.html`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    let cloud = await waitCloud(page);
    await new Promise((r) => setTimeout(r, 2000));
    cloud = (await page.evaluate(() => window.__nfPixiCloud || null)) || cloud;
    const shot100k = uniqueArt("pixi_h1_4_cloud_100k.png");
    if (fs.existsSync(ART)) await page.screenshot({ path: shot100k, fullPage: false });

    const live = await browser.newPage();
    live.setViewport({ width: 800, height: 980, deviceScaleFactor: 1 });
    await live.goto(`http://127.0.0.1:${PORT}/index.html?autoplay=0&dpr=1`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    const liveReady = Date.now() + 15000;
    while (Date.now() < liveReady) {
      const n = await live.evaluate(() => (window.__nfRender && window.__nfRender.n) || 0);
      if (n === 12000) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    await live.evaluate(() => {
      if (typeof window.assemble === "function") window.assemble();
    });
    const formedUntil = Date.now() + 8000;
    let liveMode = "";
    let liveN = 0;
    while (Date.now() < formedUntil) {
      const snap = await live.evaluate(() => ({
        n: (window.__nfRender && window.__nfRender.n) || 0,
        mode: (window.__nfRender && window.__nfRender.mode) || "",
        workerHasFrame: !!(window.__nfRender && window.__nfRender.workerHasFrame),
      }));
      liveN = snap.n;
      liveMode = snap.mode;
      if (snap.mode === "formed" && snap.n === 12000 && snap.workerHasFrame) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    await new Promise((r) => setTimeout(r, 250));
    const shot12k = uniqueArt("pixi_h1_4_live_12k_ref.png");
    if (fs.existsSync(ART)) await live.screenshot({ path: shot12k, fullPage: false });

    const report = {
      task: "H1-④ 100k cloud",
      handbook: "docs/NF_PixiJS迁移总手册_整合版_v1_2026-09-11.md",
      timestamp: new Date().toISOString(),
      bin,
      grep,
      cloud,
      pageErrors,
      screenshots: { pixi_100k: shot100k, live_12k: shot12k },
      live_n: liveN,
      live_mode: liveMode,
      live_exhibit_untouched: !fs
        .readFileSync(path.join(PROTO, "index.html"), "utf8")
        .includes("pixi.min.js"),
      acceptance: {
        frozen_sha: bin.sha === FROZEN_SHA,
        bytes_500k: bin.bytes === 500000,
        grep_clean: grep.pass,
        cloud_ok: !!(cloud && cloud.ok),
        count_100k: !!(cloud && cloud.count === 100000),
        webgl: !!(cloud && cloud.rendererName === "webgl"),
        version: !!(cloud && cloud.version === "8.20.1"),
        no_pageerror: pageErrors.length === 0,
        live_still_12k: liveN === 12000,
        live_formed: liveMode === "formed",
        exhibit_untouched: true,
      },
    };
    report.acceptance.exhibit_untouched = report.live_exhibit_untouched;
    report.acceptance.pass = Object.values(report.acceptance).every(Boolean);
    fs.writeFileSync(path.join(ROOT, "painting/pixi-h1-4-cloud.json"), JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report, null, 2));
    if (!report.acceptance.pass) throw new Error("H1-④ acceptance failed");
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
