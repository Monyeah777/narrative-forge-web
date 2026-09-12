#!/usr/bin/env node
/** H1-⑬ retire live Canvas2D particle blit / worker start. Physics kept. */
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
const LIVE = path.join(PROTO, "index.html");
const WORKER = path.join(PROTO, "render-worker.js");
const DALLAS = path.join(PROTO, "pixi-cloud/dallas-100k.bin");
const SCOTLAND = path.join(PROTO, "pixi-hall/scotland-100k.bin");
const MET = path.join(PROTO, "pixi-community/met-100k.bin");
const VENDOR = path.join(PROTO, "vendor/pixi.min.js");
const GOLDEN = path.join(PROTO, "pixi-physics/golden-1000.f64");
const ART = "/opt/cursor/artifacts";
const PORT = Number(process.env.NF_BENCH_PORT || 8790);
const FROZEN_VENDOR = "9948591083793305468d73915a3ea85032dcf8e32eee7a1328585050d7a14d53";
const FROZEN_GOLDEN = "dc1f16092d775ee1462c94eb964bb95523470bd7fd7770b1efab02c6940f320a";
const FROZEN_DALLAS = "1499db850a9da7856763f974ec79ff1d14be42503a66ab7fb8193954711f1880";
const FROZEN_SCOTLAND = "4d161d39bbf9b500e423926017287db32b2133a1f40c06b4b6fd390c7a7f0571";
const FROZEN_MET = "2e99463230c73af13e3a3b902ebe9f72034d681515a424a66afa914b52388c52";
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

function grepLive() {
  const src = fs.readFileSync(LIVE, "utf8");
  const hits = {
    has_physics: /function physics\s*\(/.test(src),
    has_apply_spring: /function applySpring\s*\(/.test(src),
    spring: /SPRING_SHARP = 0\.055/.test(src),
    no_raf_tick: !/requestAnimationFrame\s*\(\s*tick\s*\)/.test(src),
    no_worker_ctor: !/new Worker\s*\(\s*["']render-worker\.js["']/.test(src),
    no_ctx_drawimage: !/ctx\.drawImage/.test(src),
    no_paint_stage: !/function paintStage\s*\(/.test(src),
    no_draw_dust: !/function drawDust\s*\(/.test(src),
    uses_dallas: /dallas-100k\.bin/.test(src),
    uses_scotland: /scotland-100k\.bin/.test(src),
    uses_met: /met-100k\.bin/.test(src),
    pixi_draw: /NFPixiRenderer\.draw/.test(src),
  };
  return { ...hits, pass: Object.values(hits).every(Boolean) };
}

async function waitLive(page, pred, ms) {
  const deadline = Date.now() + ms;
  let snap = null;
  while (Date.now() < deadline) {
    snap = await page.evaluate(() => ({
      live: window.__nfPixiLive || null,
      points: window.__nfPoints
        ? { id: window.__nfPoints.id, count: window.__nfPoints.count, source: window.__nfPoints.source }
        : null,
      target: window.__nfTarget || null,
      mode: (window.__nfRender && window.__nfRender.mode) || "",
      n: (window.__nfRender && window.__nfRender.n) || 0,
      workerBlit: !!(window.__nfRender && window.__nfRender.workerBlit),
    }));
    if (pred(snap)) return snap;
    await new Promise((r) => setTimeout(r, 100));
  }
  return snap;
}

async function main() {
  const golden = goldenGate();
  const vendorSha = shaFile(VENDOR);
  const liveGrep = grepLive();
  const dallas = shaFile(DALLAS);
  const scotland = shaFile(SCOTLAND);
  const met = shaFile(MET);
  if (!golden.pass) throw new Error("C2 golden failed: " + JSON.stringify(golden));
  if (vendorSha !== FROZEN_VENDOR) throw new Error("vendor sha drift " + vendorSha);
  if (dallas !== FROZEN_DALLAS) throw new Error("Dallas drifted");
  if (scotland !== FROZEN_SCOTLAND) throw new Error("Scotland drifted");
  if (met !== FROZEN_MET) throw new Error("Met drifted");
  if (!liveGrep.pass) throw new Error("live grep failed: " + JSON.stringify(liveGrep));
  if (!fs.existsSync(WORKER)) throw new Error("render-worker.js missing; file stays in repo");

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
    await page.goto(`http://127.0.0.1:${PORT}/index.html?autoplay=0&dpr=1`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await waitLive(page, (s) => s.live && s.live.ready && s.points && s.points.count === 100000, 20000);
    await page.evaluate(() => {
      if (typeof window.assemble === "function") window.assemble(window.TARGETS.INTRO);
    });
    const intro = await waitLive(
      page,
      (s) =>
        s.mode === "formed" &&
        s.points &&
        s.points.id === "poplars-dallas" &&
        s.points.count === 100000 &&
        s.live &&
        s.live.ready,
      25000
    );
    const shotIntro = uniqueArt("pixi_h1_13_live_intro_100k.png");
    if (fs.existsSync(ART)) await page.screenshot({ path: shotIntro, fullPage: false });

    await page.evaluate(() => {
      if (typeof window.assemble === "function") window.assemble(window.TARGETS.HALL);
    });
    const hall = await waitLive(
      page,
      (s) =>
        s.target &&
        s.target.key === "HALL" &&
        s.points &&
        s.points.id === "poplars-scotland" &&
        s.points.count === 100000 &&
        s.mode === "formed",
      25000
    );
    const shotHall = uniqueArt("pixi_h1_13_live_hall_100k.png");
    if (fs.existsSync(ART)) await page.screenshot({ path: shotHall, fullPage: false });

    await page.evaluate(() => {
      if (typeof window.assemble === "function") window.assemble(window.TARGETS.COMMUNITY);
    });
    const community = await waitLive(
      page,
      (s) =>
        s.target &&
        s.target.key === "COMMUNITY" &&
        s.points &&
        s.points.id === "four-trees-met" &&
        s.points.count === 100000 &&
        s.mode === "formed",
      25000
    );
    const shotCommunity = uniqueArt("pixi_h1_13_live_community_100k.png");
    if (fs.existsSync(ART)) await page.screenshot({ path: shotCommunity, fullPage: false });

    const report = {
      task: "H1-⑬ retire live Canvas2D blit / worker start",
      handbook: "docs/NF_PixiJS迁移总手册_整合版_v1_2026-09-11.md",
      timestamp: new Date().toISOString(),
      vendorSha,
      golden,
      bins: { dallas, scotland, met },
      liveGrep,
      workerFileKept: fs.existsSync(WORKER),
      live: { intro, hall, community, pageErrors },
      screenshots: { intro: shotIntro, hall: shotHall, community: shotCommunity },
      note: {
        kept: "physics() / applySpring / SPRING 0.055 / render-worker.js file",
        removed: "live ctx.drawImage particle blit, paintStage, drawDust, new Worker(render-worker.js)",
      },
      acceptance: {
        vendor_lock: vendorSha === FROZEN_VENDOR,
        golden_sha: golden.pass,
        dallas_frozen: dallas === FROZEN_DALLAS,
        scotland_frozen: scotland === FROZEN_SCOTLAND,
        met_frozen: met === FROZEN_MET,
        live_grep: liveGrep.pass,
        worker_file_kept: fs.existsSync(WORKER),
        intro_formed: !!(intro && intro.mode === "formed" && intro.points && intro.points.id === "poplars-dallas"),
        hall_formed: !!(hall && hall.mode === "formed" && hall.points && hall.points.id === "poplars-scotland"),
        community_formed: !!(community && community.mode === "formed" && community.points && community.points.id === "four-trees-met"),
        no_worker_blit: !!(intro && intro.workerBlit === false && hall && hall.workerBlit === false),
        pixi_ready: !!(community && community.live && community.live.ready && community.live.version === "8.20.1"),
        no_pageerror: pageErrors.length === 0,
        physics_kept: liveGrep.has_physics && liveGrep.has_apply_spring,
        spring_lock: liveGrep.spring,
      },
    };
    report.acceptance.pass = Object.values(report.acceptance).every(Boolean);
    fs.writeFileSync(path.join(ROOT, "painting/pixi-h1-13-ctx.json"), JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report, null, 2));
    if (!report.acceptance.pass) throw new Error("H1-⑬ acceptance failed");
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
