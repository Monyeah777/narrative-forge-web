#!/usr/bin/env node
/** H1-⑪ live HALL 100k Scotland v3 bin; INTRO Dallas 100k kept; COMMUNITY 12k. */
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
const HALL_PAGE = path.join(PROTO, "pixi-hall/index.html");
const DALLAS = path.join(PROTO, "pixi-cloud/dallas-100k.bin");
const SCOTLAND = path.join(PROTO, "pixi-hall/scotland-100k.bin");
const VENDOR = path.join(PROTO, "vendor/pixi.min.js");
const GOLDEN = path.join(PROTO, "pixi-physics/golden-1000.f64");
const ART = "/opt/cursor/artifacts";
const PORT = Number(process.env.NF_BENCH_PORT || 8788);
const FROZEN_VENDOR = "9948591083793305468d73915a3ea85032dcf8e32eee7a1328585050d7a14d53";
const FROZEN_GOLDEN = "dc1f16092d775ee1462c94eb964bb95523470bd7fd7770b1efab02c6940f320a";
const FROZEN_DALLAS = "1499db850a9da7856763f974ec79ff1d14be42503a66ab7fb8193954711f1880";
const FROZEN_SCOTLAND = "4d161d39bbf9b500e423926017287db32b2133a1f40c06b4b6fd390c7a7f0571";
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

function binRecord(file, count, frozen) {
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
      sha === frozen &&
      (sidecarSha == null || sidecarSha === sha),
  };
}

function grepHallPage() {
  const src = fs.readFileSync(HALL_PAGE, "utf8");
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
    hook: /__nfPixiHall/.test(src),
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
    uses_dallas: /dallas-100k\.bin/.test(src),
    uses_scotland: /scotland-100k\.bin/.test(src),
    no_150k_live: !/dallas-150k\.bin/.test(src),
    no_250k_live: !/dallas-250k\.bin/.test(src),
    dataview_bridge: /NFPointsBin\.readPointsBin/.test(src),
    rollback: /get\("bin"\) !== "0"/.test(src),
    no_community_bin: !/fourtrees|met-100k|artwork_c\.bin/.test(src),
  };
  return {
    ...hits,
    pass: Object.values(hits).every(Boolean),
  };
}

async function waitLive(page, pred, ms) {
  const deadline = Date.now() + ms;
  let snap = null;
  while (Date.now() < deadline) {
    snap = await page.evaluate(() => ({
      live: window.__nfPixiLive || null,
      points: window.__nfPoints
        ? { id: window.__nfPoints.id, count: window.__nfPoints.count, source: window.__nfPoints.source, w: window.__nfPoints.w, h: window.__nfPoints.h }
        : null,
      target: window.__nfTarget || null,
      mode: (window.__nfRender && window.__nfRender.mode) || "",
      n: (window.__nfRender && window.__nfRender.n) || 0,
    }));
    if (pred(snap)) return snap;
    await new Promise((r) => setTimeout(r, 100));
  }
  return snap;
}

async function openLive(browser, qs) {
  const page = await browser.newPage();
  await page.setViewport({ width: 800, height: 980, deviceScaleFactor: 1 });
  const pageErrors = [];
  page.on("pageerror", (err) => pageErrors.push(String(err)));
  await page.goto(`http://127.0.0.1:${PORT}/index.html?${qs}`, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  return { page, pageErrors };
}

async function main() {
  const golden = goldenGate();
  const vendorSha = shaFile(VENDOR);
  const dallas = binRecord(DALLAS, 100000, FROZEN_DALLAS);
  const scotland = binRecord(SCOTLAND, 100000, FROZEN_SCOTLAND);
  const grepPage = grepHallPage();
  const liveGrep = grepLive();
  if (!golden.pass) throw new Error("C2 golden failed: " + JSON.stringify(golden));
  if (vendorSha !== FROZEN_VENDOR) throw new Error("vendor sha drift " + vendorSha);
  if (!dallas.pass) throw new Error("Dallas 100k drifted: " + JSON.stringify(dallas));
  if (!scotland.pass) throw new Error("Scotland 100k failed: " + JSON.stringify(scotland));
  if (!grepPage.pass) throw new Error("hall page grep failed: " + JSON.stringify(grepPage));
  if (!liveGrep.pass) throw new Error("live grep failed: " + JSON.stringify(liveGrep));

  const server = await serve();
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: CHROME,
      headless: "new",
      args: ["--no-sandbox", "--ignore-gpu-blocklist"],
    });

    const iso = await browser.newPage();
    await iso.setViewport({ width: 800, height: 980, deviceScaleFactor: 1 });
    const isoErrors = [];
    iso.on("pageerror", (err) => isoErrors.push(String(err)));
    await iso.goto(`http://127.0.0.1:${PORT}/pixi-hall/index.html`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    const isoUntil = Date.now() + 30000;
    let hall = null;
    while (Date.now() < isoUntil) {
      hall = await iso.evaluate(() => window.__nfPixiHall || null);
      if (hall && hall.ok && hall.count === 100000) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    await new Promise((r) => setTimeout(r, 1500));
    hall = (await iso.evaluate(() => window.__nfPixiHall || null)) || hall;
    const shotIso = uniqueArt("pixi_h1_11_hall_iso_100k.png");
    if (fs.existsSync(ART)) await iso.screenshot({ path: shotIso, fullPage: false });
    await iso.close().catch(() => {});

    const intro = await openLive(browser, "autoplay=0&dpr=1");
    const introSnap = await waitLive(
      intro.page,
      (s) => s.live && s.live.ready && s.points && s.points.id === "poplars-dallas" && s.points.count === 100000,
      20000
    );
    await intro.page.evaluate(() => {
      if (typeof window.assemble === "function") window.assemble();
    });
    const introFormed = await waitLive(
      intro.page,
      (s) =>
        s.mode === "formed" &&
        s.points &&
        s.points.id === "poplars-dallas" &&
        s.points.count === 100000 &&
        s.live &&
        s.live.ready,
      20000
    );
    const shotIntro = uniqueArt("pixi_h1_11_live_intro_100k.png");
    if (fs.existsSync(ART)) await intro.page.screenshot({ path: shotIntro, fullPage: false });

    await intro.page.evaluate(() => {
      if (typeof window.assemble === "function") window.assemble(window.TARGETS.HALL);
    });
    const hallLive = await waitLive(
      intro.page,
      (s) =>
        s.target &&
        s.target.key === "HALL" &&
        s.points &&
        s.points.id === "poplars-scotland" &&
        s.points.count === 100000 &&
        s.points.source === "bin" &&
        s.mode === "formed",
      25000
    );
    const shotHall = uniqueArt("pixi_h1_11_live_hall_100k.png");
    if (fs.existsSync(ART)) await intro.page.screenshot({ path: shotHall, fullPage: false });

    await intro.page.evaluate(() => {
      if (typeof window.assemble === "function") window.assemble(window.TARGETS.COMMUNITY);
    });
    const community = await waitLive(
      intro.page,
      (s) =>
        s.target &&
        s.target.key === "COMMUNITY" &&
        s.points &&
        s.points.count === 12000 &&
        s.points.source === "fetch" &&
        s.mode === "formed",
      20000
    );
    const shotCommunity = uniqueArt("pixi_h1_11_live_community_12k.png");
    if (fs.existsSync(ART)) await intro.page.screenshot({ path: shotCommunity, fullPage: false });
    await intro.page.close().catch(() => {});

    const rb = await openLive(browser, "bin=0&autoplay=0&dpr=1");
    await waitLive(
      rb.page,
      (s) => s.live && s.live.ready && s.points && s.points.count === 12000,
      20000
    );
    await rb.page.evaluate(() => {
      if (typeof window.assemble === "function") window.assemble(window.TARGETS.HALL);
    });
    const rbHall = await waitLive(
      rb.page,
      (s) =>
        s.target &&
        s.target.key === "HALL" &&
        s.points &&
        s.points.id === "poplars-scotland" &&
        s.points.count === 12000 &&
        s.points.source === "fetch" &&
        s.mode === "formed",
      20000
    );
    const shotRb = uniqueArt("pixi_h1_11_live_bin0_hall_12k.png");
    if (fs.existsSync(ART)) await rb.page.screenshot({ path: shotRb, fullPage: false });
    await rb.page.close().catch(() => {});

    const report = {
      task: "H1-⑪ live HALL 100k Scotland v3 bin",
      handbook: "docs/NF_PixiJS迁移总手册_整合版_v1_2026-09-11.md",
      timestamp: new Date().toISOString(),
      vendorSha,
      golden,
      bins: { dallas: dallas, scotland: scotland },
      grepPage,
      liveGrep,
      isolated: { hall, pageErrors: isoErrors, screenshot: shotIso },
      live: {
        intro: introFormed || introSnap,
        hall: hallLive,
        community,
        rollbackHall: rbHall,
        introErrors: intro.pageErrors,
        rollbackErrors: rb.pageErrors,
      },
      screenshots: {
        iso_100k: shotIso,
        live_intro_100k: shotIntro,
        live_hall_100k: shotHall,
        live_community_12k: shotCommunity,
        live_bin0_hall_12k: shotRb,
      },
      note: {
        intro: "Dallas 100k bin unchanged",
        hall: "Scotland 100k bin is live default; ?bin=0 keeps 12k JSON",
        community: "still 12k JSON",
        fps: "this-VM software GL is not the author-device 60fps bar",
      },
      acceptance: {
        vendor_lock: vendorSha === FROZEN_VENDOR,
        golden_sha: golden.pass,
        dallas_frozen: dallas.pass,
        scotland_bin: scotland.pass,
        grep_page: grepPage.pass,
        live_grep: liveGrep.pass,
        iso_ok: !!(hall && hall.ok && hall.count === 100000 && hall.id === "poplars-scotland"),
        iso_webgl: !!(hall && hall.rendererName === "webgl"),
        iso_version: !!(hall && hall.version === "8.20.1"),
        iso_no_pageerror: isoErrors.length === 0,
        intro_dallas: !!(introFormed && introFormed.points && introFormed.points.id === "poplars-dallas" && introFormed.points.count === 100000),
        intro_formed: !!(introFormed && introFormed.mode === "formed"),
        hall_scotland: !!(hallLive && hallLive.points && hallLive.points.id === "poplars-scotland" && hallLive.points.count === 100000 && hallLive.points.source === "bin"),
        hall_formed: !!(hallLive && hallLive.mode === "formed"),
        hall_target: !!(hallLive && hallLive.target && hallLive.target.key === "HALL"),
        community_12k: !!(community && community.points && community.points.count === 12000 && community.points.source === "fetch"),
        community_target: !!(community && community.target && community.target.key === "COMMUNITY"),
        rollback_hall_12k: !!(rbHall && rbHall.points && rbHall.points.count === 12000 && rbHall.points.source === "fetch" && rbHall.points.id === "poplars-scotland"),
        no_pageerror_live: intro.pageErrors.length === 0,
        no_pageerror_rollback: rb.pageErrors.length === 0,
        physics_kept: liveGrep.has_physics && liveGrep.has_apply_spring,
        spring_lock: liveGrep.spring,
      },
    };
    report.acceptance.pass = Object.values(report.acceptance).every(Boolean);
    fs.writeFileSync(path.join(ROOT, "painting/pixi-h1-11-hall.json"), JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report, null, 2));
    if (!report.acceptance.pass) throw new Error("H1-⑪ acceptance failed");
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
