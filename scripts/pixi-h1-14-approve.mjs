#!/usr/bin/env node
/** H1-⑭ approved: native DPR ≤3 + NFPT header. Live count stays 100k. */
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
const READER = path.join(PROTO, "pixi-bridge/points-bin.js");
const DALLAS = path.join(PROTO, "pixi-cloud/dallas-100k.bin");
const SCOTLAND = path.join(PROTO, "pixi-hall/scotland-100k.bin");
const MET = path.join(PROTO, "pixi-community/met-100k.bin");
const D150 = path.join(PROTO, "pixi-density/dallas-150k.bin");
const D250 = path.join(PROTO, "pixi-density/dallas-250k.bin");
const FIXED = path.join(PROTO, "pixi-bridge/fixed5_3.bin");
const VENDOR = path.join(PROTO, "vendor/pixi.min.js");
const GOLDEN = path.join(PROTO, "pixi-physics/golden-1000.f64");
const ART = "/opt/cursor/artifacts";
const PORT = Number(process.env.NF_BENCH_PORT || 8791);
const FROZEN_VENDOR = "9948591083793305468d73915a3ea85032dcf8e32eee7a1328585050d7a14d53";
const FROZEN_GOLDEN = "dc1f16092d775ee1462c94eb964bb95523470bd7fd7770b1efab02c6940f320a";
const PAYLOAD = {
  dallas: "1499db850a9da7856763f974ec79ff1d14be42503a66ab7fb8193954711f1880",
  scotland: "4d161d39bbf9b500e423926017287db32b2133a1f40c06b4b6fd390c7a7f0571",
  met: "2e99463230c73af13e3a3b902ebe9f72034d681515a424a66afa914b52388c52",
  d150: "d7d709d5d3475050d6781aac63e750400e3d77c2960f195a4b98d0777a727e82",
  d250: "31abff9b19b7482ca4ad43a9e3a71170945bfc3712d2ebc0ea528e26fe26e0a2",
  fixed: "9690b47ff117733935b4fb60b2dc9fdb692434204c8856dccb9bc272237999f7",
};
const FILE = {
  dallas: "6406d7012e7f637ad2e31661a85f619ebd14b85bb48a6341a1ec9c3a2dbcea82",
  scotland: "bbeab899140521bad56e82766f92a3d63305b8bc8f802de22db804fad3bfcf5f",
  met: "3144fdb9144d95cb0afe30f28629ec1e065bfa5022400a80e1c8e93129779a45",
  d150: "78ef03ffbbe23ef5fb6d2ac1e03ed24ac610e56fb479455c519473618edf0da3",
  d250: "17b1ee07fdc82d43230f4533a68a95e9f43c3a43fbab042427e03f9337ed8650",
  fixed: "a335bec62073335e37aab67bf61304e4212568ad755be1e3ea0c66ebc1819ad1",
};
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

function binRecord(file, count, fileSha, payloadSha) {
  const buf = fs.readFileSync(file);
  const ab = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
  const header = NFPointsBin.readHeader(ab);
  const points = NFPointsBin.readPointsBin(ab, count);
  const gotPayload = createHash("sha256").update(buf.subarray(NFPointsBin.HEADER_BYTES)).digest("hex");
  const gotFile = createHash("sha256").update(buf).digest("hex");
  return {
    file: path.relative(ROOT, file),
    bytes: buf.length,
    header,
    count: points.length,
    sha: gotFile,
    payloadSha: gotPayload,
    pass:
      header.magic === "NFPT" &&
      header.version === 3 &&
      header.count === count &&
      buf.length === 9 + count * 5 &&
      points.length === count &&
      gotFile === fileSha &&
      gotPayload === payloadSha,
  };
}

function grepLive() {
  const live = fs.readFileSync(LIVE, "utf8");
  const reader = fs.readFileSync(READER, "utf8");
  const hits = {
    has_physics: /function physics\s*\(/.test(live),
    has_apply_spring: /function applySpring\s*\(/.test(live),
    spring: /SPRING_SHARP = 0\.055/.test(live),
    no_raf_tick: !/requestAnimationFrame\s*\(\s*tick\s*\)/.test(live),
    dpr_cap3: /if \(q > 3\) return 3;/.test(live),
    dpr_query: /dprOverride <= 3/.test(live),
    uses_dallas: /dallas-100k\.bin/.test(live),
    uses_scotland: /scotland-100k\.bin/.test(live),
    uses_met: /met-100k\.bin/.test(live),
    no_live_150k: !/dallas-150k\.bin/.test(live),
    no_live_250k: !/dallas-250k\.bin/.test(live),
    pixi_draw: /NFPixiRenderer\.draw/.test(live),
    header_nfpt: /MAGIC = "NFPT"/.test(reader),
    header_bytes_9: /HEADER_BYTES = 9/.test(reader),
    header_version_3: /VERSION = 3/.test(reader),
  };
  return { ...hits, pass: Object.values(hits).every(Boolean) };
}

async function waitLive(page, pred, ms) {
  const deadline = Date.now() + ms;
  let snap = null;
  while (Date.now() < deadline) {
    snap = await page.evaluate(() => ({
      live: window.__nfPixiLive || null,
      render: window.__nfRender
        ? { dpr: window.__nfRender.dpr, n: window.__nfRender.n, mode: window.__nfRender.mode }
        : null,
      points: window.__nfPoints
        ? { id: window.__nfPoints.id, count: window.__nfPoints.count, source: window.__nfPoints.source }
        : null,
      target: window.__nfTarget || null,
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
  const bins = {
    dallas: binRecord(DALLAS, 100000, FILE.dallas, PAYLOAD.dallas),
    scotland: binRecord(SCOTLAND, 100000, FILE.scotland, PAYLOAD.scotland),
    met: binRecord(MET, 100000, FILE.met, PAYLOAD.met),
    d150: binRecord(D150, 150000, FILE.d150, PAYLOAD.d150),
    d250: binRecord(D250, 250000, FILE.d250, PAYLOAD.d250),
    fixed: binRecord(FIXED, 3, FILE.fixed, PAYLOAD.fixed),
  };
  if (!golden.pass) throw new Error("C2 golden failed: " + JSON.stringify(golden));
  if (vendorSha !== FROZEN_VENDOR) throw new Error("vendor sha drift " + vendorSha);
  if (!liveGrep.pass) throw new Error("live grep failed: " + JSON.stringify(liveGrep));
  for (const [name, rec] of Object.entries(bins)) {
    if (!rec.pass) throw new Error("bin failed " + name + " " + JSON.stringify(rec));
  }

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

    await page.goto(`http://127.0.0.1:${PORT}/index.html?autoplay=0&dpr=3`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    const intro = await waitLive(
      page,
      (s) =>
        s.live &&
        s.live.ready &&
        s.points &&
        s.points.count === 100000 &&
        s.render &&
        s.render.dpr === 3,
      20000
    );
    await page.evaluate(() => {
      if (typeof window.assemble === "function") window.assemble(window.TARGETS.INTRO);
    });
    const introFormed = await waitLive(
      page,
      (s) =>
        s.render &&
        s.render.mode === "formed" &&
        s.points &&
        s.points.id === "poplars-dallas" &&
        s.points.count === 100000,
      25000
    );
    const shotIntro = uniqueArt("pixi_h1_14_live_dpr3_intro.png");
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
        s.render &&
        s.render.mode === "formed",
      25000
    );
    const shotHall = uniqueArt("pixi_h1_14_live_hall_100k.png");
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
        s.render &&
        s.render.mode === "formed",
      25000
    );
    const shotCommunity = uniqueArt("pixi_h1_14_live_community_100k.png");
    if (fs.existsSync(ART)) await page.screenshot({ path: shotCommunity, fullPage: false });

    await page.goto(`http://127.0.0.1:${PORT}/index.html?autoplay=0&dpr=1`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    const dpr1 = await waitLive(
      page,
      (s) => s.live && s.live.ready && s.render && s.render.dpr === 1 && s.points && s.points.count === 100000,
      20000
    );

    await page.setViewport({ width: 800, height: 980, deviceScaleFactor: 3 });
    await page.goto(`http://127.0.0.1:${PORT}/index.html?autoplay=0`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    const native3 = await waitLive(
      page,
      (s) => s.live && s.live.ready && s.render && s.render.dpr === 3 && s.live.resolution === 3,
      20000
    );
    const shotNative = uniqueArt("pixi_h1_14_native_dpr3.png");
    if (fs.existsSync(ART)) await page.screenshot({ path: shotNative, fullPage: false });

    await page.goto(`http://127.0.0.1:${PORT}/index.html?autoplay=0&bin=0&dpr=1`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    const json12k = await waitLive(
      page,
      (s) => s.points && s.points.count === 12000 && s.points.source !== "bin",
      20000
    );

    const report = {
      task: "H1-⑭ DPR≤3 + NFPT header; live stays 100k",
      handbook: "docs/NF_PixiJS迁移总手册_整合版_v1_2026-09-11.md",
      timestamp: new Date().toISOString(),
      vendorSha,
      golden,
      bins,
      liveGrep,
      live: { intro, introFormed, hall, community, dpr1, native3, json12k, pageErrors },
      screenshots: {
        intro: shotIntro,
        hall: shotHall,
        community: shotCommunity,
        native3: shotNative,
      },
      note: {
        approved: "native DPR≤3, header magic+version+count, 60fps 定档 rule",
        notDone: "live count still 100k; author PC+phone 60fps numbers required to raise 150k/250k",
        payload: "old headerless sha frozen as payloadSha256; C2 golden untouched",
      },
      acceptance: {
        vendor_lock: vendorSha === FROZEN_VENDOR,
        golden_sha: golden.pass,
        dallas_payload: bins.dallas.pass,
        scotland_payload: bins.scotland.pass,
        met_payload: bins.met.pass,
        density_payload: bins.d150.pass && bins.d250.pass,
        fixed_payload: bins.fixed.pass,
        live_grep: liveGrep.pass,
        intro_100k: !!(introFormed && introFormed.points && introFormed.points.count === 100000),
        hall_100k: !!(hall && hall.points && hall.points.count === 100000),
        community_100k: !!(community && community.points && community.points.count === 100000),
        dpr3_query: !!(intro && intro.render && intro.render.dpr === 3 && intro.live && intro.live.resolution === 3),
        dpr1_query: !!(dpr1 && dpr1.render && dpr1.render.dpr === 1),
        native_dpr3: !!(native3 && native3.render && native3.render.dpr === 3 && native3.live && native3.live.resolution === 3),
        bin0_12k: !!(json12k && json12k.points && json12k.points.count === 12000),
        pixi_ready: !!(community && community.live && community.live.ready && community.live.version === "8.20.1"),
        no_pageerror: pageErrors.length === 0,
        physics_kept: liveGrep.has_physics && liveGrep.has_apply_spring,
        spring_lock: liveGrep.spring,
        live_not_150k: liveGrep.no_live_150k && liveGrep.no_live_250k,
      },
    };
    report.acceptance.pass = Object.values(report.acceptance).every(Boolean);
    fs.writeFileSync(path.join(ROOT, "painting/pixi-h1-14-approve.json"), JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report, null, 2));
    if (!report.acceptance.pass) throw new Error("H1-⑭ acceptance failed");
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
