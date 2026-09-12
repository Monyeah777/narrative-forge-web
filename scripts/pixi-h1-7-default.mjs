#!/usr/bin/env node
/** H1-⑦ default Pixi cut-over; ?pixi=0 rolls back to Canvas2D (C9). Physics/rAF kept. */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const puppeteer = require("/tmp/node_modules/puppeteer-core");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PROTO = path.join(ROOT, "prototype");
const LIVE = path.join(PROTO, "index.html");
const RENDERER = path.join(PROTO, "renderer.pixi.js");
const VENDOR = path.join(PROTO, "vendor/pixi.min.js");
const ART = "/opt/cursor/artifacts";
const PORT = Number(process.env.NF_BENCH_PORT || 8784);
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

function grepLive() {
  const src = fs.readFileSync(LIVE, "utf8");
  return {
    has_raf: /function tick\s*\(/.test(src) && /requestAnimationFrame\s*\(tick\)/.test(src),
    has_physics: /function physics\s*\(/.test(src),
    has_apply_spring: /function applySpring\s*\(/.test(src),
    spring: /SPRING_SHARP = 0\.055/.test(src),
    renderer_swap: /RENDERER-SWAP/.test(src),
    default_pixi: /get\("pixi"\) !== "0"/.test(src),
    rollback: /pixi=0/.test(src),
    no_static_vendor: !/<script[^>]+pixi\.min\.js/.test(src),
    pass:
      /function physics\s*\(/.test(src) &&
      /function applySpring\s*\(/.test(src) &&
      /requestAnimationFrame\s*\(tick\)/.test(src) &&
      /SPRING_SHARP = 0\.055/.test(src) &&
      /RENDERER-SWAP/.test(src) &&
      /get\("pixi"\) !== "0"/.test(src) &&
      !/<script[^>]+pixi\.min\.js/.test(src),
  };
}

function grepRenderer() {
  const src = fs.readFileSync(RENDERER, "utf8");
  const hits = {
    at_pixi: /@pixi\//.test(src),
    sprite: /new PIXI\.Sprite\b|Sprite\.from/.test(src),
    beginFill: /beginFill|endFill|lineStyle/.test(src),
    app_view: /\bapp\.view\b/.test(src),
    ctor_options: /new PIXI\.Application\s*\(\s*\{/.test(src),
    second_raf: /requestAnimationFrame\s*\(/.test(src),
    set_interval: /setInterval\s*\(/.test(src),
  };
  const required = {
    addParticle: /addParticle\(/.test(src),
    particle: /new PIXI\.Particle\s*\(/.test(src),
    boundsArea: /boundsArea/.test(src),
    ticker_high: /UPDATE_PRIORITY\.HIGH/.test(src),
    app_init: /await app\.init\(/.test(src),
    app_canvas: /app\.canvas/.test(src),
  };
  return {
    hits,
    required,
    pass: Object.values(hits).every((h) => h === false) && Object.values(required).every(Boolean),
  };
}

async function waitEval(page, fn, ms) {
  const deadline = Date.now() + ms;
  let snap = null;
  while (Date.now() < deadline) {
    snap = await page.evaluate(fn);
    if (snap && snap.ok) return snap;
    await new Promise((r) => setTimeout(r, 50));
  }
  return snap;
}

async function main() {
  const liveGrep = grepLive();
  const rendererGrep = grepRenderer();
  const vendorSha = shaFile(VENDOR);
  if (!liveGrep.pass) throw new Error("live grep failed: " + JSON.stringify(liveGrep));
  if (!rendererGrep.pass) throw new Error("renderer grep failed: " + JSON.stringify(rendererGrep));
  if (vendorSha !== FROZEN_VENDOR) throw new Error("vendor sha drift " + vendorSha);

  const server = await serve();
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: CHROME,
      headless: "new",
      args: ["--no-sandbox", "--ignore-gpu-blocklist"],
    });

    const def = await browser.newPage();
    await def.setViewport({ width: 800, height: 980, deviceScaleFactor: 1 });
    const defErrors = [];
    def.on("pageerror", (err) => defErrors.push(String(err)));
    await def.goto(`http://127.0.0.1:${PORT}/index.html?autoplay=0&dpr=1`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    let livePixi = await waitEval(
      def,
      () => {
        const p = window.__nfPixiLive;
        if (p && p.ready && p.count > 0) return Object.assign({ ok: true }, p);
        return p;
      },
      15000
    );
    await def.evaluate(() => {
      if (typeof window.assemble === "function") window.assemble();
    });
    let defMode = "";
    const formedUntil = Date.now() + 12000;
    while (Date.now() < formedUntil) {
      const snap = await def.evaluate(() => ({
        live: window.__nfPixiLive || null,
        mode: (window.__nfRender && window.__nfRender.mode) || "",
        n: (window.__nfRender && window.__nfRender.n) || 0,
      }));
      livePixi = snap.live || livePixi;
      defMode = snap.mode;
      if (snap.mode === "formed" && snap.n === 12000 && snap.live && snap.live.ready) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const defRuntime = await def.evaluate(() => ({
      pixi: typeof window.PIXI,
      version: window.PIXI && window.PIXI.VERSION,
      scripts: Array.prototype.map.call(document.scripts, (s) => s.src || ""),
      track: window.__nfPixiLive || null,
    }));
    const shotDefault = uniqueArt("pixi_h1_7_default_pixi_12k.png");
    if (fs.existsSync(ART)) await def.screenshot({ path: shotDefault, fullPage: false });

    const rb = await browser.newPage();
    await rb.setViewport({ width: 800, height: 980, deviceScaleFactor: 1 });
    const rbErrors = [];
    rb.on("pageerror", (err) => rbErrors.push(String(err)));
    await rb.goto(`http://127.0.0.1:${PORT}/index.html?pixi=0&autoplay=0&dpr=1`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    const rbReady = Date.now() + 15000;
    let rbN = 0;
    while (Date.now() < rbReady) {
      rbN = await rb.evaluate(() => (window.__nfRender && window.__nfRender.n) || 0);
      if (rbN === 12000) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    await rb.evaluate(() => {
      if (typeof window.assemble === "function") window.assemble();
    });
    const rbFormedUntil = Date.now() + 8000;
    let rbMode = "";
    let rbWorker = false;
    while (Date.now() < rbFormedUntil) {
      const snap = await rb.evaluate(() => ({
        n: (window.__nfRender && window.__nfRender.n) || 0,
        mode: (window.__nfRender && window.__nfRender.mode) || "",
        workerHasFrame: !!(window.__nfRender && window.__nfRender.workerHasFrame),
      }));
      rbN = snap.n;
      rbMode = snap.mode;
      rbWorker = snap.workerHasFrame;
      if (snap.mode === "formed" && snap.n === 12000 && snap.workerHasFrame) break;
      await new Promise((r) => setTimeout(r, 100));
    }
    const rbRuntime = await rb.evaluate(() => ({
      pixi: typeof window.PIXI,
      scripts: Array.prototype.map.call(document.scripts, (s) => s.src || ""),
      track: window.__nfPixiLive || null,
    }));
    const shotRollback = uniqueArt("pixi_h1_7_rollback_canvas_12k.png");
    if (fs.existsSync(ART)) await rb.screenshot({ path: shotRollback, fullPage: false });

    const report = {
      task: "H1-⑦ default Pixi cut-over",
      handbook: "docs/NF_PixiJS迁移总手册_整合版_v1_2026-09-11.md",
      timestamp: new Date().toISOString(),
      vendorSha,
      liveGrep,
      rendererGrep,
      default: {
        live: livePixi,
        mode: defMode,
        runtime: defRuntime,
        pageErrors: defErrors,
      },
      rollback: {
        n: rbN,
        mode: rbMode,
        workerHasFrame: rbWorker,
        runtime: rbRuntime,
        pageErrors: rbErrors,
      },
      screenshots: { default_pixi: shotDefault, rollback_canvas: shotRollback },
      acceptance: {
        vendor_lock: vendorSha === FROZEN_VENDOR,
        live_grep: liveGrep.pass,
        renderer_grep: rendererGrep.pass,
        default_pixi_loaded: defRuntime.pixi === "object",
        default_version: !!(livePixi && livePixi.version === "8.20.1"),
        default_webgl: !!(livePixi && livePixi.rendererName === "webgl"),
        default_high: !!(livePixi && livePixi.priority === "HIGH"),
        default_count: !!(livePixi && livePixi.count === 12000),
        default_formed: defMode === "formed",
        default_no_second_raf: !!(livePixi && livePixi.usedSecondRaf === false),
        default_no_pageerror: defErrors.length === 0,
        rollback_no_pixi: rbRuntime.pixi === "undefined",
        rollback_no_vendor_script: !rbRuntime.scripts.some((s) => s.includes("pixi.min.js")),
        rollback_n: rbN === 12000,
        rollback_formed: rbMode === "formed",
        rollback_worker: rbWorker === true,
        rollback_no_pageerror: rbErrors.length === 0,
        physics_kept: liveGrep.has_physics && liveGrep.has_apply_spring && liveGrep.has_raf,
      },
    };
    report.acceptance.pass = Object.values(report.acceptance).every(Boolean);
    fs.writeFileSync(path.join(ROOT, "painting/pixi-h1-7-default.json"), JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report, null, 2));
    if (!report.acceptance.pass) throw new Error("H1-⑦ acceptance failed");
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
