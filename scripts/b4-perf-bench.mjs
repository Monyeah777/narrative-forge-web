#!/usr/bin/env node
/**
 * B4: 60fps work budget, longtask=0 after warmup, formed similarity.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";
import { chromium } from "playwright-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PROTO = path.join(ROOT, "prototype");
const PAINTING = path.join(ROOT, "painting");
const ART = "/opt/cursor/artifacts";
const PORT = Number(process.env.NF_BENCH_PORT || 8773);
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

function send(res, code, body, type, extra = {}) {
  res.writeHead(code, { "content-type": type, "cache-control": "no-store", ...extra });
  res.end(body);
}

function resolveFile(urlPath) {
  const rel = decodeURIComponent(urlPath).replace(/^\/+/, "") || "index.html";
  if (rel === "painting" || rel.startsWith("painting/")) {
    const file = path.resolve(ROOT, rel);
    if (file === PAINTING || file.startsWith(PAINTING + path.sep)) return file;
    return null;
  }
  const file = path.resolve(PROTO, rel);
  if (file === PROTO || file.startsWith(PROTO + path.sep)) return file;
  return null;
}

function serve() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
      if (req.method !== "GET" && req.method !== "HEAD") {
        send(res, 405, "method not allowed", "text/plain");
        return;
      }
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

async function waitReady(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const info = await page.evaluate(() => window.__nfRender || null);
    if (info && info.n > 0 && info.atlasIsImageBitmap) return info;
    await new Promise((r) => setTimeout(r, 50));
  }
  throw new Error("render atlas not ready");
}

async function canvasInkFrac(page) {
  return page.evaluate(() => {
    const canvas = document.getElementById("void");
    if (!canvas || !canvas.width) return 0;
    const g = canvas.getContext("2d");
    const data = g.getImageData(0, 0, canvas.width, canvas.height).data;
    let ink = 0;
    let n = 0;
    for (let i = 0; i < data.length; i += 64) {
      n++;
      const r = data[i];
      const gg = data[i + 1];
      const b = data[i + 2];
      const a = data[i + 3];
      if (a > 8 && Math.abs(r - 5) + Math.abs(gg - 5) + Math.abs(b - 5) > 18) ink++;
    }
    return n ? ink / n : 0;
  });
}

async function waitPainted(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let frac = 0;
  while (Date.now() < deadline) {
    const info = await page.evaluate(() => window.__nfRender || null);
    frac = await canvasInkFrac(page);
    if (frac > 0.002 && info && (info.workerHasFrame || info.workerBlit === false)) return frac;
    await new Promise((r) => setTimeout(r, 40));
  }
  return frac;
}

async function snap(page, name) {
  const dest = path.join(ART, name);
  if (fs.existsSync(ART)) await page.screenshot({ path: dest, fullPage: false });
  return dest;
}

function engineHasGetImageDataInTick() {
  const src = fs.readFileSync(path.join(PROTO, "index.html"), "utf8");
  const tickAt = src.indexOf("function tick(");
  const nextFn = src.indexOf("\n      function ", tickAt + 10);
  const body = tickAt >= 0 ? src.slice(tickAt, nextFn > tickAt ? nextFn : tickAt + 2500) : "";
  return /getImageData/.test(body);
}

async function main() {
  const server = await serve();
  if (!CHROME) {
    server.close();
    throw new Error("google-chrome not found");
  }
  let browser;
  try {
    const launches = [
      { headless: false, args: ["--no-sandbox", "--ignore-gpu-blocklist"] },
      { headless: true, args: ["--no-sandbox", "--ignore-gpu-blocklist"] },
      { headless: true, args: ["--no-sandbox", "--disable-gpu"] },
    ];
    let launchErr = null;
    for (const opt of launches) {
      try {
        browser = await chromium.launch({
          executablePath: CHROME,
          headless: opt.headless,
          args: opt.args,
        });
        launchErr = null;
        break;
      } catch (err) {
        launchErr = err;
      }
    }
    if (!browser) throw launchErr || new Error("chrome launch failed");
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const logs = [];
    page.on("pageerror", (err) => logs.push("PAGEERROR " + String(err)));
    await page.goto(`http://127.0.0.1:${PORT}/index.html?dpr=1&autoplay=0&discipline=classic`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    const ready = await waitReady(page, 20_000);
    const chaosInk = await waitPainted(page, 4000);
    await new Promise((r) => setTimeout(r, 200));
    await page.evaluate(() => {
      if (window.__nfResetPerf) window.__nfResetPerf();
    });
    await new Promise((r) => setTimeout(r, 2000));
    const chaos = await page.evaluate(() => ({
      n: window.__nfRender.n,
      running: window.__nfRender.running,
      mode: window.__nfRender.mode,
      dpr: window.__nfRender.dpr,
      workerBlit: window.__nfRender.workerBlit,
      workerHasFrame: window.__nfRender.workerHasFrame,
      perf: window.__nfGetPerf ? window.__nfGetPerf() : window.__nfPerf,
    }));
    chaos.ink_frac = await waitPainted(page, 2000);
    const homeShot = await snap(page, "b4_chaos_60fps.png");

    await page.evaluate(() => {
      if (window.__nfResetPerf) window.__nfResetPerf();
    });
    const t0 = Date.now();
    await page.click("#btn-intro");
    await page.evaluate(() => {
      const el = document.getElementById("void");
      if (el) el.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
    });
    const formedDeadline = Date.now() + 5000;
    let formed = null;
    while (Date.now() < formedDeadline) {
      formed = await page.evaluate(() => ({
        mode: window.__nfRender.mode,
        running: window.__nfRender.running,
        activeCount: window.__nfRender.activeCount,
        contain: window.__nfRender.contain,
        perf: window.__nfGetPerf ? window.__nfGetPerf() : window.__nfPerf,
      }));
      if (formed.mode === "formed" && formed.running === false) break;
      await new Promise((r) => setTimeout(r, 40));
    }
    const assembleMs = Date.now() - t0;
    await page.evaluate(() => {
      const el = document.getElementById("void");
      if (el) el.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
    });
    await new Promise((r) => setTimeout(r, 200));
    await waitPainted(page, 2000);
    const introShot = await snap(page, "b4_formed_similarity.png");

    const crop = await page.evaluate(() => {
      const canvas = document.getElementById("void");
      const c = window.__nfRender.contain;
      const dpr = window.__nfRender.dpr || 1;
      const off = document.createElement("canvas");
      off.width = Math.max(1, Math.round(c.w));
      off.height = Math.max(1, Math.round(c.h));
      const g = off.getContext("2d");
      g.drawImage(canvas, c.x * dpr, c.y * dpr, c.w * dpr, c.h * dpr, 0, 0, off.width, off.height);
      return { w: off.width, h: off.height, dataUrl: off.toDataURL("image/png") };
    });
    const cropPath = path.join(ART, "b4_formed_contain_crop.png");
    if (fs.existsSync(ART)) {
      fs.writeFileSync(cropPath, Buffer.from(crop.dataUrl.split(",")[1], "base64"));
    }
    const srcPath = path.join(PAINTING, "01-dallas.jpg");
    const simRaw = execFileSync("python3", [path.join(ROOT, "scripts/b4-ssim.py"), cropPath, srcPath], {
      encoding: "utf8",
    });
    const similarity = JSON.parse(simRaw);
    const pairPath = path.join(ART, "b4_formed_vs_source.png");
    if (fs.existsSync(ART)) {
      execFileSync("python3", [
        "-c",
        "from PIL import Image; import sys; a=Image.open(sys.argv[1]).convert('RGB'); b=Image.open(sys.argv[2]).convert('RGB').resize(a.size); h=a.size[1]; out=Image.new('RGB', (a.size[0]*2+24, h), (5,5,5)); out.paste(b,(0,0)); out.paste(a,(a.size[0]+24,0)); out.save(sys.argv[3], quality=92)",
        cropPath,
        srcPath,
        pairPath,
      ]);
    }

    const benchPage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await benchPage.goto(`http://127.0.0.1:${PORT}/bench.html?auto=1`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await benchPage.waitForFunction(() => {
      const s = document.getElementById("status");
      return s && /PASS|FAIL/.test(s.textContent || "");
    }, { timeout: 25_000 });
    const benchShot = await snap(benchPage, "b4_bench_harness.png");
    await benchPage.close();

    const work = chaos.perf && chaos.perf.work ? chaos.perf.work : { p95: 99, mean: 99, fps: 0, n: 0 };
    const raf = chaos.perf && chaos.perf.raf ? chaos.perf.raf : { fps: 0, p95: 99 };
    const report = {
      task: "B4",
      ready: { n: ready.n, atlasIsImageBitmap: ready.atlasIsImageBitmap, dpr: ready.dpr },
      chaos,
      assemble_ms: assembleMs,
      formed,
      similarity,
      logs,
      screenshots: {
        home: homeShot,
        intro: introShot,
        crop: cropPath,
        vs_source: pairPath,
        bench: benchShot,
      },
      acceptance: {
        n_12000: chaos.n === 12000,
        atlas_imagebitmap: ready.atlasIsImageBitmap === true,
        work_p95_le_16_67: work.p95 <= 16.67,
        chaos_longtask_0: (chaos.perf && chaos.perf.longtaskCount) === 0,
        formed_idle: formed && formed.mode === "formed" && formed.running === false,
        chaos_visible: (chaos.ink_frac || 0) > 0.002,
        ssim_blur_ge_0_35: similarity.ssim_blur >= 0.35,
        hist_corr_ge_0_70: similarity.hist_corr >= 0.7,
        no_getImageData_in_tick: !engineHasGetImageDataInTick(),
        dpr_le_2: chaos.dpr <= 2,
      },
      notes: {
        raf_fps_headless: raf.fps,
        work_mean_ms: work.mean,
        work_p95_ms: work.p95,
        chaos_ink_frac: chaos.ink_frac,
        chaos_ink_warmup: chaosInk,
        gate: "60fps is work p95 ≤ 16.67ms; headless rAF Hz is informational",
      },
    };
    report.acceptance.pass = Object.values(report.acceptance).every(Boolean);
    fs.writeFileSync(path.join(PAINTING, "b4-perf.json"), JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report, null, 2));
    if (!report.acceptance.pass) throw new Error("B4 acceptance failed");
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
