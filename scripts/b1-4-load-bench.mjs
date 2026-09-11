#!/usr/bin/env node
/**
 * B1-4: gzip size + prototype load timing list (preload + fetch + parse).
 * Serves prototype/ with gzip for .json when the client accepts it.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PROTO = path.join(ROOT, "prototype");
const PAINTING = path.join(ROOT, "painting");
const ART = "/opt/cursor/artifacts";
const PORT = Number(process.env.NF_BENCH_PORT || 8770);
const CHROME =
  process.env.CHROME_PATH ||
  ["/usr/local/bin/google-chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find((p) =>
    fs.existsSync(p)
  );

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

const CONTRACT_KEYS = ["id", "w", "h", "count", "note", "palette", "points"];

function send(res, code, body, type = "text/plain; charset=utf-8", extra = {}) {
  const headers = { "content-type": type, "cache-control": "no-store", ...extra };
  res.writeHead(code, headers);
  res.end(body);
}

function sha256(buf) {
  return createHash("sha256").update(buf).digest("hex");
}

function fileStats() {
  const asset = fs.readFileSync(path.join(PROTO, "assets", "points.json"));
  const painted = fs.readFileSync(path.join(PAINTING, "points.json"));
  const gzNode = zlib.gzipSync(asset, { level: 9 }).length;
  const gzPy = Number(
    execFileSync(
      "python3",
      [
        "-c",
        "import gzip,sys; print(len(gzip.compress(sys.stdin.buffer.read(), compresslevel=9)))",
      ],
      { input: asset }
    )
      .toString()
      .trim()
  );
  return {
    path: "prototype/assets/points.json",
    bytes: asset.length,
    gzip_bytes: gzPy,
    gzip_bytes_node: gzNode,
    gzip_lt_120kb: gzPy < 120 * 1024,
    sha256: sha256(asset),
    sha256_match_painting: sha256(asset) === sha256(painted),
  };
}

function servePrototype() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
      if (req.method !== "GET" && req.method !== "HEAD") {
        send(res, 405, "method not allowed");
        return;
      }
      let rel = decodeURIComponent(url.pathname);
      if (rel === "/") rel = "index.html";
      rel = rel.replace(/^\/+/, "");
      const file = path.resolve(PROTO, rel);
      if (file !== PROTO && !file.startsWith(PROTO + path.sep)) {
        send(res, 403, "forbidden");
        return;
      }
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        send(res, 404, "not found");
        return;
      }
      const ext = path.extname(file).toLowerCase();
      const type = MIME[ext] || "application/octet-stream";
      const buf = fs.readFileSync(file);
      const ae = String(req.headers["accept-encoding"] || "");
      const extra = {};
      if (ext === ".json") extra["cache-control"] = "public, max-age=60";
      extra["access-control-allow-origin"] = "*";
      if (ext === ".json" && ae.includes("gzip")) {
        const gz = zlib.gzipSync(buf, { level: 9 });
        send(res, 200, gz, type, { ...extra, "content-encoding": "gzip", vary: "Accept-Encoding" });
        return;
      }
      send(res, 200, buf, type, extra);
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
    server.on("error", reject);
  });
}

async function waitPoints(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const ready = await page.evaluate(() => !!(window.__nfPoints && window.__nfLoadTimings));
    if (ready) return;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("window.__nfPoints not set within timeout");
}

async function snap(page, name) {
  const dest = path.join(ART, name);
  if (fs.existsSync(ART) && !fs.existsSync(dest)) await page.screenshot({ path: dest, fullPage: false });
  return dest;
}

async function runPage(browser, query) {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  const logs = [];
  page.on("console", (msg) => logs.push(msg.text()));
  page.on("pageerror", (err) => logs.push("PAGEERROR " + String(err)));
  await page.goto(`http://127.0.0.1:${PORT}/${query}`, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await waitPoints(page, 15_000);
  const payload = await page.evaluate(() => {
    const rec = window.__nfPoints;
    return {
      id: rec.id,
      w: rec.w,
      h: rec.h,
      count: rec.count,
      palette_len: rec.palette.length,
      points_len: rec.points.length,
      triple0: rec.points[0],
      keys: Object.keys(rec),
      source: rec.source,
      note: rec.note,
      timings: rec.timings,
    };
  });
  return { page, payload, logs };
}

function timingList(timings) {
  const link = timings.resource && timings.resource.link;
  const fetch = timings.resource && timings.resource.fetch;
  return [
    { step: "t_fetch_start_ms", ms: timings.t_fetch_start_ms },
    { step: "fetch_ms", ms: timings.fetch_ms },
    { step: "parse_ms", ms: timings.parse_ms },
    { step: "total_ms", ms: timings.total_ms },
    { step: "preload_link_duration_ms", ms: link ? link.duration_ms : null },
    { step: "fetch_resource_duration_ms", ms: fetch ? fetch.duration_ms : null },
    { step: "encodedBodySize", bytes: timings.encodedBodySize },
    { step: "decodedBodySize", bytes: timings.decodedBodySize },
    { step: "transferSize", bytes: timings.transferSize },
  ];
}

async function main() {
  const disk = fileStats();
  if (!disk.gzip_lt_120kb) throw new Error("gzip " + disk.gzip_bytes + " >= 120KB");
  if (!disk.sha256_match_painting) throw new Error("asset json sha mismatch vs painting/points.json");

  const server = await servePrototype();
  if (!CHROME) {
    server.close();
    throw new Error("google-chrome not found");
  }
  let browser;
  try {
    browser = await chromium.launch({
      executablePath: CHROME,
      headless: true,
      args: ["--no-sandbox", "--disable-gpu"],
    });

    const live = await runPage(browser, "index.html");
    await new Promise((r) => setTimeout(r, 800));
    const homeShot = await snap(live.page, "b1_4_home_starfield.png");
    await live.page.click("#btn-intro");
    await new Promise((r) => setTimeout(r, 2800));
    const introShot = await snap(live.page, "b1_4_intro_copy_and_form.png");
    const afterIntro = await live.page.evaluate(() => {
      var lead = document.querySelector('.dossier .panel[data-panel="intro"] .lead');
      var sub = document.querySelector('.dossier .panel[data-panel="intro"] .sub');
      return {
        ariaCurrent: document.getElementById("btn-intro") && document.getElementById("btn-intro").getAttribute("aria-current"),
        dossierView: document.getElementById("dossier") && document.getElementById("dossier").dataset.view,
        dossierAriaHidden: document.getElementById("dossier") && document.getElementById("dossier").getAttribute("aria-hidden"),
        stageMode: document.getElementById("stage") && document.getElementById("stage").getAttribute("data-mode"),
        leadText: lead && lead.textContent,
        subText: sub && sub.textContent,
        leadOpacity: lead ? getComputedStyle(lead).opacity : "",
        subOpacity: sub ? getComputedStyle(sub).opacity : ""
      };
    });
    await live.page.close();

    const ph = await runPage(browser, "index.html?nf-points=placeholder");
    const phShot = await snap(ph.page, "b1_4_placeholder_random.png");
    await ph.page.close();

    const hasKeys = (keys) => CONTRACT_KEYS.every((k) => keys.includes(k));
    const report = {
      task: "B1-4",
      disk,
      load_timing_list: timingList(live.payload.timings),
      live: {
        id: live.payload.id,
        w: live.payload.w,
        h: live.payload.h,
        count: live.payload.count,
        palette_len: live.payload.palette_len,
        points_len: live.payload.points_len,
        triple0: live.payload.triple0,
        keys: live.payload.keys,
        source: live.payload.source,
        timings: live.payload.timings,
        after_intro: afterIntro,
        console: live.logs.filter((l) => l.indexOf("[nf-load]") === 0 || l.indexOf("PAGEERROR") === 0),
      },
      placeholder: {
        id: ph.payload.id,
        count: ph.payload.count,
        source: ph.payload.source,
        keys: ph.payload.keys,
        reason: ph.payload.timings.reason,
      },
      screenshots: { home: homeShot, intro: introShot, placeholder: phShot },
      acceptance: {
        gzip_lt_120kb: disk.gzip_lt_120kb,
        sha_match: disk.sha256_match_painting,
        keys_frozen: hasKeys(live.payload.keys),
        live_id_dallas: live.payload.id === "poplars-dallas",
        live_count_12000: live.payload.count === 12000,
        live_source_fetch: live.payload.source === "fetch",
        placeholder_same_keys: hasKeys(ph.payload.keys),
        placeholder_source: ph.payload.source === "placeholder",
        intro_formed: afterIntro.stageMode === "formed" && afterIntro.dossierView === "intro",
        intro_copy_visible: afterIntro.leadText === "把叙事，变成工程。" && Number(afterIntro.leadOpacity) >= 0.9,
        load_timing_recorded: typeof live.payload.timings.total_ms === "number",
        gzip_on_wire: live.payload.timings.encodedBodySize > 0 && live.payload.timings.encodedBodySize < 120 * 1024,
        preload_reused: live.payload.timings.preload_reused === true,
      },
    };
    report.acceptance.pass = Object.values(report.acceptance).every(Boolean);

    fs.writeFileSync(path.join(PAINTING, "b1-4-load.json"), JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report, null, 2));
    if (!report.acceptance.pass) throw new Error("B1-4 acceptance failed");
    return 0;
  } finally {
    if (browser) await browser.close().catch(() => {});
    server.close();
  }
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
