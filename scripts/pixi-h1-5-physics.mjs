#!/usr/bin/env node
/** H1-⑤ isolated assemble-spring on Pixi ticker HIGH + C2 golden. */
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

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PROTO = path.join(ROOT, "prototype");
const PHYS = path.join(PROTO, "pixi-physics");
const GOLDEN = path.join(PHYS, "golden-1000.f64");
const BIN = path.join(PROTO, "pixi-cloud/dallas-100k.bin");
const VENDOR = path.join(PROTO, "vendor/pixi.min.js");
const LIVE = path.join(PROTO, "index.html");
const ART = "/opt/cursor/artifacts";
const PORT = Number(process.env.NF_BENCH_PORT || 8782);
const FROZEN_GOLDEN = "dc1f16092d775ee1462c94eb964bb95523470bd7fd7770b1efab02c6940f320a";
const FROZEN_BIN = "1499db850a9da7856763f974ec79ff1d14be42503a66ab7fb8193954711f1880";
const FROZEN_VENDOR = "9948591083793305468d73915a3ea85032dcf8e32eee7a1328585050d7a14d53";
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
};

function send(res, code, body, type) {
  res.writeHead(code, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}

function resolveFile(urlPath) {
  const rel = decodeURIComponent(urlPath).replace(/^\/+/, "") || "pixi-physics/index.html";
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
  const frozenSha = createHash("sha256").update(frozenBuf).digest("hex");
  const run = NFSpring.runGolden(1000);
  const runBuf = Buffer.from(run.seq.buffer, run.seq.byteOffset, run.seq.byteLength);
  const runSha = createHash("sha256").update(runBuf).digest("hex");
  const locked = run.points.every((p) => p.x === p.tx && p.y === p.ty && p.vx === 0 && p.vy === 0);
  const sameBytes = frozenBuf.equals(runBuf);
  return {
    command: {
      sha256sum: spawnSync("sha256sum", [GOLDEN], { encoding: "utf8" }).stdout.trim(),
      wc: spawnSync("wc", ["-c", GOLDEN], { encoding: "utf8" }).stdout.trim(),
    },
    frozenSha,
    runSha,
    bytes: frozenBuf.length,
    locked,
    sameBytes,
    spring: NFSpring.SPRING,
    damp: NFSpring.DAMP,
    vmax: NFSpring.VMAX,
    pass:
      frozenSha === FROZEN_GOLDEN &&
      runSha === FROZEN_GOLDEN &&
      frozenBuf.length === 48000 &&
      sameBytes &&
      locked,
  };
}

function grepPage() {
  const src = fs.readFileSync(path.join(PHYS, "index.html"), "utf8");
  const hits = {
    at_pixi: /@pixi\//.test(src),
    sprite: /new PIXI\.Sprite\b|Sprite\.from/.test(src),
    addChild_particle: /addChild\(\s*new PIXI\.Particle/.test(src),
    beginFill: /beginFill|endFill|lineStyle|drawRect\(/.test(src),
    app_view: /\bapp\.view\b/.test(src),
    ctor_options: /new PIXI\.Application\s*\(\s*\{/.test(src),
    second_raf: /requestAnimationFrame\s*\(/.test(src),
    set_interval: /setInterval\s*\(/.test(src),
  };
  const required = {
    addParticle: /addParticle\(/.test(src),
    particle: /new PIXI\.Particle\s*\(/.test(src),
    boundsArea: /boundsArea/.test(src),
    update: /container\.update\(\)/.test(src),
    ticker_high: /UPDATE_PRIORITY\.HIGH/.test(src),
    nf_spring: /NFSpring/.test(src),
    elapsed_ms: /ticker\.elapsedMS/.test(src),
    app_init: /await app\.init\(/.test(src),
    app_canvas: /app\.canvas/.test(src),
  };
  return {
    hits,
    required,
    pass: Object.values(hits).every((h) => h === false) && Object.values(required).every(Boolean),
  };
}

function liveUntouched() {
  const src = fs.readFileSync(LIVE, "utf8");
  return {
    no_pixi: !src.includes("pixi.min.js"),
    has_raf: /requestAnimationFrame\s*\(/.test(src),
    has_physics: /function physics\s*\(/.test(src),
    has_apply_spring: /function applySpring\s*\(/.test(src),
    spring: /SPRING_SHARP = 0\.055/.test(src),
    pass:
      !src.includes("pixi.min.js") &&
      /requestAnimationFrame\s*\(/.test(src) &&
      /function physics\s*\(/.test(src) &&
      /function applySpring\s*\(/.test(src) &&
      /SPRING_SHARP = 0\.055/.test(src),
  };
}

async function waitPhysics(page, pred, ms) {
  const deadline = Date.now() + ms;
  let snap = null;
  while (Date.now() < deadline) {
    snap = await page.evaluate(() => window.__nfPixiPhysics || null);
    if (snap && pred(snap)) return snap;
    await new Promise((r) => setTimeout(r, 50));
  }
  return snap;
}

async function main() {
  const golden = goldenGate();
  const grep = grepPage();
  const live = liveUntouched();
  const vendorSha = shaFile(VENDOR);
  const binSha = shaFile(BIN);
  if (!golden.pass) throw new Error("golden gate failed: " + JSON.stringify(golden));
  if (!grep.pass) throw new Error("grep failed: " + JSON.stringify(grep));
  if (!live.pass) throw new Error("live exhibit mutated: " + JSON.stringify(live));
  if (vendorSha !== FROZEN_VENDOR) throw new Error("vendor sha drift " + vendorSha);
  if (binSha !== FROZEN_BIN) throw new Error("100k bin sha drift " + binSha);

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
    await page.goto(`http://127.0.0.1:${PORT}/pixi-physics/index.html`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });

    let physics = await waitPhysics(
      page,
      (p) => p.goldenMatch === true && p.count === 100000 && p.ticks >= 1,
      15000
    );
    const shotAssemble = uniqueArt("pixi_h1_5_physics_assemble.png");
    if (fs.existsSync(ART) && physics && physics.mode === "assemble") {
      await page.screenshot({ path: shotAssemble, fullPage: false });
    }

    physics = await waitPhysics(page, (p) => p.mode === "formed", 30000);
    const shotFormed = uniqueArt("pixi_h1_5_physics_formed.png");
    if (fs.existsSync(ART)) await page.screenshot({ path: shotFormed, fullPage: false });

    const report = {
      task: "H1-⑤ physics on ticker",
      handbook: "docs/NF_PixiJS迁移总手册_整合版_v1_2026-09-11.md",
      timestamp: new Date().toISOString(),
      golden,
      grep,
      live,
      vendorSha,
      binSha,
      physics,
      pageErrors,
      screenshots: { assemble: shotAssemble, formed: shotFormed },
      live_exhibit_untouched: live.pass,
      acceptance: {
        golden_sha: golden.pass,
        grep_clean: grep.pass,
        vendor_lock: vendorSha === FROZEN_VENDOR,
        bin_reuse: binSha === FROZEN_BIN,
        physics_ok: !!(physics && physics.ok),
        golden_match: !!(physics && physics.goldenMatch),
        count_100k: !!(physics && physics.count === 100000),
        webgl: !!(physics && physics.rendererName === "webgl"),
        version: !!(physics && physics.version === "8.20.1"),
        priority_high: !!(physics && physics.priority === "HIGH"),
        phys_moved: !!(physics && physics.physSteps > 0),
        formed: !!(physics && physics.mode === "formed"),
        no_second_raf: !!(physics && physics.usedSecondRaf === false),
        no_pageerror: pageErrors.length === 0,
        exhibit_untouched: live.pass,
      },
    };
    report.acceptance.pass = Object.values(report.acceptance).every(Boolean);
    fs.writeFileSync(path.join(ROOT, "painting/pixi-h1-5-physics.json"), JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report, null, 2));
    if (!report.acceptance.pass) throw new Error("H1-⑤ acceptance failed");
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
