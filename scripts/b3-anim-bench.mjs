#!/usr/bin/env node
/**
 * B3: sharp spring, 1.5s interruptible assemble, SAVE freeze, SETTINGS feel.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PROTO = path.join(ROOT, "prototype");
const PAINTING = path.join(ROOT, "painting");
const ART = "/opt/cursor/artifacts";
const PORT = Number(process.env.NF_BENCH_PORT || 8772);
const CHROME =
  process.env.CHROME_PATH ||
  ["/usr/local/bin/google-chrome", "/usr/bin/google-chrome", "/usr/bin/chromium"].find((p) =>
    fs.existsSync(p)
  );

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".jpg": "image/jpeg",
  ".png": "image/png",
};

function send(res, code, body, type, extra = {}) {
  res.writeHead(code, { "content-type": type, "cache-control": "no-store", ...extra });
  res.end(body);
}

function serve() {
  return new Promise((resolve, reject) => {
    const server = http.createServer((req, res) => {
      const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
      if (req.method !== "GET" && req.method !== "HEAD") {
        send(res, 405, "method not allowed", "text/plain");
        return;
      }
      let rel = decodeURIComponent(url.pathname).replace(/^\/+/, "");
      if (!rel) rel = "index.html";
      const file = path.resolve(PROTO, rel);
      if (file !== PROTO && !file.startsWith(PROTO + path.sep)) {
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

async function waitMode(page, want, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await page.evaluate(() => ({
      mode: window.__nfRender && window.__nfRender.mode,
      running: window.__nfRender && window.__nfRender.running,
      frozen: window.__nfRender && window.__nfRender.frozen,
      anim: window.__nfAnim,
    }));
    if (last.mode === want) return last;
    await new Promise((r) => setTimeout(r, 40));
  }
  throw new Error("timeout waiting for mode=" + want + " last=" + JSON.stringify(last));
}

async function snap(page, name) {
  const dest = path.join(ART, name);
  if (fs.existsSync(ART) && !fs.existsSync(dest)) await page.screenshot({ path: dest, fullPage: false });
  return dest;
}

async function main() {
  const server = await serve();
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
    const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    const logs = [];
    page.on("pageerror", (err) => logs.push("PAGEERROR " + String(err)));
    await page.goto(`http://127.0.0.1:${PORT}/index.html`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await waitReady(page, 20_000);
    const homeShot = await snap(page, "b3_home_before_assemble.png");

    const tAssemble0 = Date.now();
    await page.click("#btn-intro");
    const formed = await waitMode(page, "formed", 4000);
    const assembleMs = Date.now() - tAssemble0;
    await page.evaluate(() => {
      const el = document.getElementById("void");
      if (el) el.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
    });
    const formedDeadline = Date.now() + 2500;
    let settled = null;
    while (Date.now() < formedDeadline) {
      settled = await page.evaluate(() => ({
        running: window.__nfRender.running,
        activeCount: window.__nfRender.activeCount,
        frozen: window.__nfRender.frozen,
        anim: Object.assign({}, window.__nfAnim),
        lead: document.querySelector('.dossier .panel[data-panel="intro"] .lead')?.textContent,
      }));
      if (settled.running === false && settled.activeCount === 0) break;
      await new Promise((r) => setTimeout(r, 50));
    }
    const introShot = await snap(page, "b3_intro_formed_1_5s.png");

    await page.click("#btn-save");
    await new Promise((r) => setTimeout(r, 80));
    const frozenA = await page.evaluate(() => ({
      frozen: window.__nfRender.frozen,
      running: window.__nfRender.running,
      pressed: document.getElementById("btn-save").getAttribute("aria-pressed"),
      checksum: window.__nfAnim.checksum,
      phaseElapsed: window.__nfAnim.phaseElapsed,
    }));
    await new Promise((r) => setTimeout(r, 400));
    const frozenB = await page.evaluate(() => ({
      frozen: window.__nfRender.frozen,
      running: window.__nfRender.running,
      checksum: window.__nfAnim.checksum,
      phaseElapsed: window.__nfAnim.phaseElapsed,
      tickCount: window.__nfRender.tickCount,
    }));

    await page.click("#btn-settings");
    await new Promise((r) => setTimeout(r, 50));
    await page.click("#btn-settings");
    await new Promise((r) => setTimeout(r, 80));
    const settingsB = await page.evaluate(() => ({
      feel: window.__nfAnim.feel,
      spring: window.__nfAnim.spring,
      damp: window.__nfAnim.damp,
      vmax: window.__nfAnim.vmax,
      line: document.getElementById("console-mode")?.textContent,
    }));

    await page.click("#btn-start");
    await new Promise((r) => setTimeout(r, 120));
    const afterStart = await page.evaluate(() => ({
      frozen: window.__nfRender.frozen,
      running: window.__nfRender.running,
      mode: window.__nfRender.mode,
      pressed: document.getElementById("btn-save").getAttribute("aria-pressed"),
    }));
    await waitMode(page, "formed", 4000);
    const startFormedShot = await snap(page, "b3_start_unfreeze_formed.png");

    let interruptOk = true;
    let interruptNan = 0;
    for (let i = 0; i < 5; i++) {
      await page.click("#btn-home");
      await new Promise((r) => setTimeout(r, 180));
      await page.click("#btn-intro");
      await new Promise((r) => setTimeout(r, 180));
      const st = await page.evaluate(() => ({
        nan: window.__nfAnim.nanHeals,
        finite: Number.isFinite(window.__nfAnim.checksum),
        mode: window.__nfRender.mode,
      }));
      interruptNan = st.nan;
      if (!st.finite) interruptOk = false;
    }
    await waitMode(page, "formed", 4000);

    await page.click("#btn-home");
    await waitMode(page, "chaos", 3000);
    const disperseShot = await snap(page, "b3_home_disperse.png");

    const reducedPage = await browser.newPage({ viewport: { width: 1280, height: 800 } });
    await reducedPage.emulateMedia({ reducedMotion: "reduce" });
    await reducedPage.goto(`http://127.0.0.1:${PORT}/index.html`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    await waitReady(reducedPage, 20_000);
    const tRed0 = Date.now();
    await reducedPage.click("#btn-intro");
    const reducedFormed = await waitMode(reducedPage, "formed", 1500);
    const reducedMs = Date.now() - tRed0;
    const reducedInfo = await reducedPage.evaluate(() => ({
      running: window.__nfRender.running,
      reduced: window.__nfAnim.reduced,
      mode: window.__nfRender.mode,
    }));
    const reducedShot = await snap(reducedPage, "b3_reduced_instant_formed.png");
    await reducedPage.close();

    const defaults = {
      spring: Math.abs(formed.anim.spring - 0.055) < 1e-9,
      damp: Math.abs(formed.anim.damp - 0.9) < 1e-9,
      vmax: formed.anim.vmax === 10,
      stop: formed.anim.stopPx === 0.6 && formed.anim.stopV === 0.06,
      repel: formed.anim.repelR === 100,
    };

    const report = {
      task: "B3",
      assemble_ms: assembleMs,
      formed,
      settled,
      freeze: { a: frozenA, b: frozenB },
      settingsB,
      afterStart,
      interrupt: { ok: interruptOk, nanHeals: interruptNan, rounds: 5 },
      reduced: { ms: reducedMs, ...reducedInfo },
      logs,
      screenshots: {
        home: homeShot,
        intro: introShot,
        start: startFormedShot,
        disperse: disperseShot,
        reduced: reducedShot,
      },
      acceptance: {
        assemble_window: assembleMs >= 1100 && assembleMs <= 2100,
        spring_sharp: defaults.spring && defaults.damp && defaults.vmax && defaults.stop && defaults.repel,
        freeze_sticky: frozenA.frozen === true && frozenA.pressed === "true" && frozenA.running === false,
        freeze_stable: frozenB.checksum === frozenA.checksum && frozenB.phaseElapsed === frozenA.phaseElapsed,
        settings_storm: settingsB.feel === "B" && Math.abs(settingsB.spring - 0.6) < 1e-9,
        start_unfreeze: afterStart.frozen === false && afterStart.pressed === "false",
        interrupt_finite: interruptOk && interruptNan === 0,
        reduced_instant: reducedMs < 400 && reducedFormed.mode === "formed" && reducedInfo.running === false,
        settled_stop: settled && settled.running === false,
      },
    };
    report.acceptance.pass = Object.values(report.acceptance).every(Boolean);
    fs.writeFileSync(path.join(PAINTING, "b3-anim.json"), JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report, null, 2));
    if (!report.acceptance.pass) throw new Error("B3 acceptance failed");
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
