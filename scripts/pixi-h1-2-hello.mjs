#!/usr/bin/env node
/** H1-② Hello empty scene: ticker clock + 5s 0-error dwell. */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { createHash } from "node:crypto";

const require = createRequire(import.meta.url);
const puppeteer = require("/tmp/node_modules/puppeteer-core");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PROTO = path.join(ROOT, "prototype");
const VENDOR = path.join(PROTO, "vendor/pixi.min.js");
const HELLO = path.join(PROTO, "pixi-hello/index.html");
const ART = "/opt/cursor/artifacts";
const PORT = Number(process.env.NF_BENCH_PORT || 8779);
const DWELL_MS = 5000;
const E0 = {
  sha256: "9948591083793305468d73915a3ea85032dcf8e32eee7a1328585050d7a14d53",
  bytes: 818871,
  gzip9: 230584,
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
};

function serve() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "pixi-hello/index.html";
      const file = path.resolve(PROTO, rel);
      if (!file.startsWith(PROTO)) {
        res.writeHead(403);
        res.end("forbidden");
        return;
      }
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        res.writeHead(404);
        res.end("not found");
        return;
      }
      const ext = path.extname(file).toLowerCase();
      res.writeHead(200, { "content-type": MIME[ext] || "application/octet-stream" });
      res.end(fs.readFileSync(file));
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

function hashGate() {
  const buf = fs.readFileSync(VENDOR);
  const sha = createHash("sha256").update(buf).digest("hex");
  const gz = spawnSync("gzip", ["-9", "-c", VENDOR], { encoding: "buffer", maxBuffer: 2e6 });
  const gzip9 = gz.stdout ? gz.stdout.length : -1;
  const ver = spawnSync("rg", ["-o", "PixiJS - v8\\.[0-9.]+", VENDOR], { encoding: "utf8" });
  return {
    command: {
      sha256sum: spawnSync("sha256sum", [VENDOR], { encoding: "utf8" }).stdout.trim(),
      wc: spawnSync("wc", ["-c", VENDOR], { encoding: "utf8" }).stdout.trim(),
      gzip9: String(gzip9),
      version: (ver.stdout || "").trim().split("\n")[0] || "",
    },
    sha256: sha,
    bytes: buf.length,
    gzip9,
    version: (ver.stdout || "").trim().split("\n")[0] || "",
    pass: sha === E0.sha256 && buf.length === E0.bytes && gzip9 === E0.gzip9,
  };
}

function grepPage() {
  const src = fs.readFileSync(HELLO, "utf8");
  const hits = {
    at_pixi: /@pixi\//.test(src),
    beginFill: /beginFill|endFill|lineStyle|drawRect\(|drawCircle\(/.test(src),
    app_view: /\bapp\.view\b/.test(src),
    base_texture: /BaseTexture/.test(src),
    ctor_options: /new PIXI\.Application\s*\(\s*\{/.test(src),
    second_raf: /requestAnimationFrame\s*\(/.test(src),
    set_interval: /setInterval\s*\(/.test(src),
    particle: /ParticleContainer|addParticle|new PIXI\.Particle\b/.test(src),
    sprite: /new PIXI\.Sprite\b|Sprite\.from/.test(src),
  };
  return {
    hits,
    pass: Object.values(hits).every((hit) => hit === false),
  };
}

async function main() {
  const hash = hashGate();
  const grep = grepPage();
  if (!hash.pass) throw new Error("E0 hash gate failed: " + JSON.stringify(hash));
  if (!grep.pass) throw new Error("H1-② grep failed: " + JSON.stringify(grep));
  const server = await serve();
  let browser;
  try {
    browser = await puppeteer.launch({
      executablePath: CHROME,
      headless: "new",
      args: ["--no-sandbox", "--ignore-gpu-blocklist"],
    });
    const page = await browser.newPage();
    await page.setViewport({ width: 800, height: 560, deviceScaleFactor: 1 });
    const pageErrors = [];
    page.on("pageerror", (err) => pageErrors.push(String(err)));
    await page.goto(`http://127.0.0.1:${PORT}/pixi-hello/index.html`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    const deadline = Date.now() + 8000;
    let hello = null;
    while (Date.now() < deadline) {
      hello = await page.evaluate(() => window.__nfPixiHello || null);
      if (hello && hello.ok !== undefined) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    const ticksAtReady = hello && hello.ticks != null ? hello.ticks : -1;
    await new Promise((r) => setTimeout(r, DWELL_MS));
    hello = await page.evaluate(() => window.__nfPixiHello || null);
    const shot = uniqueArt("pixi_h1_2_hello_empty.png");
    if (fs.existsSync(ART)) await page.screenshot({ path: shot, fullPage: false });
    const report = {
      task: "H1-② Hello empty scene",
      handbook: "docs/NF_PixiJS迁移总手册_整合版_v1_2026-09-11.md",
      timestamp: new Date().toISOString(),
      dwell_ms: DWELL_MS,
      ticksAtReady,
      hash,
      grep,
      hello,
      pageErrors,
      screenshot: shot,
      live_exhibit_untouched: !fs
        .readFileSync(path.join(PROTO, "index.html"), "utf8")
        .includes("pixi.min.js"),
      acceptance: {
        e0_sha: hash.sha256 === E0.sha256,
        grep_clean: grep.pass,
        hello_ok: !!(hello && hello.ok),
        hello_version: !!(hello && hello.version === "8.20.1"),
        no_pageerror: pageErrors.length === 0,
        ticker_started: !!(hello && hello.tickerStarted === true),
        ticks_advanced: !!(hello && hello.ticks > ticksAtReady && hello.ticks >= 20),
        scene_empty: !!(hello && hello.stageChildren === 0),
        used_canvas: !!(hello && hello.usedCanvas === true),
        webgl_backend: !!(hello && hello.rendererName === "webgl"),
        exhibit_untouched: true,
      },
    };
    report.acceptance.exhibit_untouched = report.live_exhibit_untouched;
    report.acceptance.pass = Object.values(report.acceptance).every(Boolean);
    fs.writeFileSync(path.join(ROOT, "painting/pixi-h1-2-hello.json"), JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report, null, 2));
    if (!report.acceptance.pass) throw new Error("H1-② acceptance failed");
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
