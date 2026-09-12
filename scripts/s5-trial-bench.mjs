#!/usr/bin/env node
/**
 * §5 真机试炼：U10 (longtask / 1% low / 停帧) + U11 (32×32 + 亮度直方图) + 打断×20。
 * 不改视觉档。不做轨道 B。
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
const PORT = Number(process.env.NF_BENCH_PORT || 8774);
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
  ".ico": "text/plain",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

function send(res, code, body, type) {
  res.writeHead(code, { "content-type": type, "cache-control": "no-store" });
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

function leavePointer(page) {
  return page.evaluate(() => {
    const el = document.getElementById("void");
    if (el) el.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
    document.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
  });
}

async function launchBrowser() {
  const launches = [
    { headless: false, args: ["--no-sandbox", "--ignore-gpu-blocklist"] },
    { headless: true, args: ["--no-sandbox", "--ignore-gpu-blocklist"] },
    { headless: true, args: ["--no-sandbox", "--disable-gpu"] },
  ];
  let launchErr = null;
  for (const opt of launches) {
    try {
      return await chromium.launch({
        executablePath: CHROME,
        headless: opt.headless,
        args: opt.args,
      });
    } catch (err) {
      launchErr = err;
    }
  }
  throw launchErr || new Error("chrome launch failed");
}

async function measureChaos(page) {
  await waitReady(page, 20_000);
  const inkWarm = await waitPainted(page, 4000);
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
    spring: window.__nfAnim && window.__nfAnim.spring,
    damp: window.__nfAnim && window.__nfAnim.damp,
    contain: window.__nfRender.contain,
    perf: window.__nfGetPerf ? window.__nfGetPerf() : {},
  }));
  chaos.ink_frac = await waitPainted(page, 1500);
  chaos.ink_warmup = inkWarm;
  return chaos;
}

async function assembleFormed(page) {
  await page.evaluate(() => {
    if (window.__nfResetPerf) window.__nfResetPerf();
  });
  const t0 = Date.now();
  await page.click("#btn-intro");
  await leavePointer(page);
  const deadline = Date.now() + 5000;
  let formed = null;
  while (Date.now() < deadline) {
    formed = await page.evaluate(() => ({
      mode: window.__nfRender.mode,
      running: window.__nfRender.running,
      activeCount: window.__nfRender.activeCount,
      tickCount: window.__nfRender.tickCount,
      contain: window.__nfRender.contain,
      nanHeals: window.__nfAnim ? window.__nfAnim.nanHeals : -1,
    }));
    if (formed.mode === "formed" && formed.running === false) break;
    await new Promise((r) => setTimeout(r, 40));
  }
  await leavePointer(page);
  await waitPainted(page, 2000);
  const ticks = formed ? formed.tickCount : 0;
  await new Promise((r) => setTimeout(r, 400));
  const after = await page.evaluate(() => ({
    running: window.__nfRender.running,
    tickCount: window.__nfRender.tickCount,
    mode: window.__nfRender.mode,
  }));
  return {
    assemble_ms: Date.now() - t0,
    formed,
    stop_frame: {
      ticks_before: ticks,
      ticks_after: after.tickCount,
      running: after.running,
      mode: after.mode,
      held: after.tickCount === ticks && after.running === false,
    },
  };
}

async function cropFormed(page) {
  return page.evaluate(() => {
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
}

async function interruptDrill(page) {
  return page.evaluate(() => {
    const start = document.getElementById("btn-start");
    const home = document.getElementById("btn-home");
    const save = document.getElementById("btn-save");
    const nan0 = window.__nfAnim ? window.__nfAnim.nanHeals : 0;
    let i;
    for (i = 0; i < 20; i++) {
      start.click();
      home.click();
      save.click();
    }
    if (window.__nfRender.frozen) save.click();
    const el = document.getElementById("void");
    if (el) el.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
    document.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
    return {
      cycles: 20,
      nan0: nan0,
      nanHeals: window.__nfAnim ? window.__nfAnim.nanHeals : -1,
      n: window.__nfRender.n,
      mode: window.__nfRender.mode,
      frozen: window.__nfRender.frozen,
      alive: typeof window.assemble === "function" && window.__nfRender.n === 12000,
    };
  });
}

async function visibilityPause(page) {
  return page.evaluate(() => {
    const before = window.__nfRender.running;
    Object.defineProperty(document, "hidden", { configurable: true, get: function () { return true; } });
    document.dispatchEvent(new Event("visibilitychange"));
    const hiddenRunning = window.__nfRender.running;
    Object.defineProperty(document, "hidden", { configurable: true, get: function () { return false; } });
    document.dispatchEvent(new Event("visibilitychange"));
    return {
      wasRunning: before,
      hiddenRunning: hiddenRunning,
      afterHidden: window.__nfRender.running,
      paused: before === true && hiddenRunning === false,
    };
  });
}

async function main() {
  const server = await serve();
  if (!CHROME) {
    server.close();
    throw new Error("google-chrome not found");
  }
  let browser;
  try {
    browser = await launchBrowser();
    const logs = [];
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    page.on("pageerror", (err) => logs.push("PAGEERROR " + String(err)));
    await page.goto(`http://127.0.0.1:${PORT}/index.html?dpr=1`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    const ready = await waitReady(page, 20_000);
    const chaos = await measureChaos(page);
    const vis = await visibilityPause(page);
    await new Promise((r) => setTimeout(r, 200));
    const homeShot = await snap(page, "s5_desktop_chaos.png");
    const assembled = await assembleFormed(page);
    const introShot = await snap(page, "s5_desktop_formed.png");
    const crop = await cropFormed(page);
    const cropPath = path.join(ART, "s5_formed_crop.png");
    if (fs.existsSync(ART)) {
      fs.writeFileSync(cropPath, Buffer.from(crop.dataUrl.split(",")[1], "base64"));
    }
    const srcPath = path.join(PAINTING, "01-dallas.jpg");
    const similarity = JSON.parse(
      execFileSync("python3", [path.join(ROOT, "scripts/s5-ssim.py"), cropPath, srcPath], {
        encoding: "utf8",
      })
    );
    const interrupt = await interruptDrill(page);
    await new Promise((r) => setTimeout(r, 200));
    const afterInterrupt = await page.evaluate(() => ({
      n: window.__nfRender.n,
      nanHeals: window.__nfAnim ? window.__nfAnim.nanHeals : -1,
      mode: window.__nfRender.mode,
    }));

    const mobilePage = await browser.newPage({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 3,
      isMobile: true,
      hasTouch: true,
    });
    mobilePage.on("pageerror", (err) => logs.push("MOBILE " + String(err)));
    await mobilePage.goto(`http://127.0.0.1:${PORT}/index.html`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    const mobileReady = await waitReady(mobilePage, 20_000);
    const mobileChaos = await measureChaos(mobilePage);
    const mobileShot = await snap(mobilePage, "s5_mobile_chaos.png");
    await mobilePage.click("#btn-intro");
    await leavePointer(mobilePage);
    const mobileDeadline = Date.now() + 5000;
    let mobileFormed = null;
    while (Date.now() < mobileDeadline) {
      mobileFormed = await mobilePage.evaluate(() => ({
        mode: window.__nfRender.mode,
        running: window.__nfRender.running,
        dpr: window.__nfRender.dpr,
      }));
      if (mobileFormed.mode === "formed" && mobileFormed.running === false) break;
      await new Promise((r) => setTimeout(r, 40));
    }
    await leavePointer(mobilePage);
    await waitPainted(mobilePage, 2000);
    const mobileFormedShot = await snap(mobilePage, "s5_mobile_formed.png");
    await mobilePage.close();

    const benchPage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await benchPage.goto(`http://127.0.0.1:${PORT}/bench.html?auto=1`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await benchPage.waitForFunction(() => {
      const s = document.getElementById("status");
      return s && /PASS|FAIL/.test(s.textContent || "");
    }, { timeout: 40_000 });
    const benchShot = await snap(benchPage, "s5_bench_harness.png");
    await benchPage.close();

    const work = chaos.perf && chaos.perf.work ? chaos.perf.work : { p95: 99 };
    const workLow = chaos.perf && chaos.perf.workPct1Low ? chaos.perf.workPct1Low : { meanMs: 99, fps: 0 };
    const rafLow = chaos.perf && chaos.perf.rafPct1Low ? chaos.perf.rafPct1Low : { fps: 0, meanMs: 99 };
    const report = {
      task: "S5",
      ready: { n: ready.n, atlasIsImageBitmap: ready.atlasIsImageBitmap, dpr: ready.dpr },
      chaos,
      assemble_ms: assembled.assemble_ms,
      formed: assembled.formed,
      stop_frame: assembled.stop_frame,
      similarity,
      visibility: vis,
      interrupt,
      afterInterrupt,
      mobile: {
        ready: { n: mobileReady.n, dpr: mobileReady.dpr },
        chaos: mobileChaos,
        formed: mobileFormed,
      },
      logs,
      screenshots: {
        desktop_chaos: homeShot,
        desktop_formed: introShot,
        crop: cropPath,
        mobile_chaos: mobileShot,
        mobile_formed: mobileFormedShot,
        bench: benchShot,
      },
      acceptance: {
        n_12000: chaos.n === 12000,
        work_p95_le_16_67: work.p95 <= 16.67,
        work_1pct_low_le_16_67: workLow.meanMs <= 16.67,
        chaos_longtask_0: (chaos.perf && chaos.perf.longtaskCount) === 0,
        formed_idle: assembled.formed && assembled.formed.mode === "formed" && assembled.formed.running === false,
        stop_frame: assembled.stop_frame.held === true,
        corr32_ge_0_35: similarity.corr32 >= 0.35,
        luma_hist_ge_0_70: similarity.luma_hist_corr >= 0.70,
        interrupt_20_no_nan: interrupt.cycles === 20 && interrupt.nanHeals === interrupt.nan0 && interrupt.alive,
        visibility_pauses: vis.paused === true,
        mobile_n_12000: mobileChaos.n === 12000,
        mobile_dpr_le_2: mobileChaos.dpr <= 2,
        mobile_visible: (mobileChaos.ink_frac || 0) > 0.002,
        mobile_work_p95_le_16_67: mobileChaos.perf && mobileChaos.perf.work && mobileChaos.perf.work.p95 <= 16.67,
        visual_档_locked:
          chaos.spring === 0.055 &&
          chaos.damp === 0.9 &&
          chaos.contain &&
          chaos.contain.cx === 0.35 &&
          chaos.contain.hFrac === 0.7,
      },
      notes: {
        raf_1pct_low_fps: rafLow.fps,
        raf_1pct_low_ms: rafLow.meanMs,
        work_1pct_low_fps: workLow.fps,
        work_1pct_low_ms: workLow.meanMs,
        gate: "Desktop 60fps is work p95 and work 1% low ≤ 16.67ms. rAF 1% low follows the display.",
      },
    };
    report.acceptance.pass = Object.values(report.acceptance).every(Boolean);
    fs.writeFileSync(path.join(PAINTING, "s5-trial.json"), JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report, null, 2));
    if (!report.acceptance.pass) throw new Error("S5 acceptance failed");
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
