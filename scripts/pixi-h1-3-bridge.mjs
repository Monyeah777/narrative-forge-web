#!/usr/bin/env node
/** H1-③ data bridge: Python write + JS DataView read + golden compare. */
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
const BRIDGE = path.join(PROTO, "pixi-bridge");
const BIN = path.join(BRIDGE, "fixed5_3.bin");
const ART = "/opt/cursor/artifacts";
const PORT = Number(process.env.NF_BENCH_PORT || 8780);
const FROZEN_SHA = "9690b47ff117733935b4fb60b2dc9fdb692434204c8856dccb9bc272237999f7";
const FROZEN_HEX = "0000ff0300ffff0000010100ffffff";
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
};

function serve() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
      const rel = decodeURIComponent(url.pathname).replace(/^\/+/, "") || "pixi-bridge/index.html";
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

function pythonRoundTrip() {
  const py = spawnSync("python3", [path.join(ROOT, "scripts/pixi-h1-3-write-fixed5.py")], {
    encoding: "utf8",
  });
  if (py.status !== 0) {
    throw new Error("python writer failed: " + (py.stderr || py.stdout));
  }
  const report = JSON.parse(py.stdout);
  const buf = fs.readFileSync(BIN);
  const sha = createHash("sha256").update(buf).digest("hex");
  const hex = buf.toString("hex");
  const nodePoints = NFPointsBin.readPointsBin(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength), 3);
  const probe = NFPointsBin.endianProbe1023(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength));
  return {
    command: "python3 scripts/pixi-h1-3-write-fixed5.py",
    stdout: report,
    sha256sum: spawnSync("sha256sum", [BIN], { encoding: "utf8" }).stdout.trim(),
    sha,
    hex,
    nodePoints,
    probe,
    pass:
      sha === FROZEN_SHA &&
      hex === FROZEN_HEX &&
      report.sha256 === FROZEN_SHA &&
      probe.le === 1023 &&
      probe.be === 65283 &&
      nodePoints[0].x === 0 &&
      nodePoints[0].y === 1023 &&
      nodePoints[2].idx === 255,
  };
}

function grepBridge() {
  const files = ["index.html", "points-bin.js"].map((n) =>
    fs.readFileSync(path.join(BRIDGE, n), "utf8")
  );
  const src = files.join("\n");
  const u16Calls = src.match(/getUint16\s*\([^)]*\)/g) || [];
  const hits = {
    at_pixi: /@pixi\//.test(src),
    typed_u16: /new\s+(Uint16|Float32|Uint32)Array\s*\(/.test(src),
    pixi_script: /pixi\.min\.js/.test(src),
    header_magic: /magic\s*\+|NFPT/.test(src),
    getUint16_missing_true: u16Calls.some((c) => !c.includes("true") && !c.includes("false")),
  };
  return { hits, u16Calls, pass: Object.values(hits).every((hit) => hit === false) };
}

async function main() {
  const roundtrip = pythonRoundTrip();
  const grep = grepBridge();
  if (!roundtrip.pass) throw new Error("roundtrip failed: " + JSON.stringify(roundtrip));
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
    await page.setViewport({ width: 800, height: 560, deviceScaleFactor: 1 });
    const pageErrors = [];
    const logs = [];
    page.on("pageerror", (err) => pageErrors.push(String(err)));
    page.on("console", (msg) => logs.push(msg.text()));
    await page.goto(`http://127.0.0.1:${PORT}/pixi-bridge/index.html`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    const deadline = Date.now() + 8000;
    let bridge = null;
    while (Date.now() < deadline) {
      bridge = await page.evaluate(() => window.__nfPixiBridge || null);
      if (bridge && bridge.ok !== undefined) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    const shot = uniqueArt("pixi_h1_3_bridge.png");
    if (fs.existsSync(ART)) await page.screenshot({ path: shot, fullPage: false });
    const report = {
      task: "H1-③ data bridge",
      handbook: "docs/NF_PixiJS迁移总手册_整合版_v1_2026-09-11.md",
      timestamp: new Date().toISOString(),
      roundtrip,
      grep,
      bridge,
      pageErrors,
      console: logs.filter((l) => l.startsWith("[H1-3]")),
      screenshot: shot,
      live_exhibit_untouched: !fs
        .readFileSync(path.join(PROTO, "index.html"), "utf8")
        .includes("pixi.min.js"),
      live_points_still_json: fs.existsSync(path.join(PROTO, "assets/points.json")),
      acceptance: {
        frozen_sha: roundtrip.sha === FROZEN_SHA,
        frozen_hex: roundtrip.hex === FROZEN_HEX,
        grep_clean: grep.pass,
        bridge_ok: !!(bridge && bridge.ok),
        points_match: !!(bridge && bridge.match),
        endian_le: !!(bridge && bridge.endianProbe && bridge.endianProbe.le === 1023),
        endian_be_trap: !!(bridge && bridge.endianProbe && bridge.endianProbe.be === 65283),
        no_header: !!(bridge && bridge.headerBytes === 0),
        no_pixi: !!(bridge && bridge.loadedPixi === false),
        no_pageerror: pageErrors.length === 0,
        exhibit_untouched: true,
      },
    };
    report.acceptance.exhibit_untouched = report.live_exhibit_untouched;
    report.acceptance.pass = Object.values(report.acceptance).every(Boolean);
    fs.writeFileSync(path.join(ROOT, "painting/pixi-h1-3-bridge.json"), JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report, null, 2));
    if (!report.acceptance.pass) throw new Error("H1-③ acceptance failed");
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.close();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
