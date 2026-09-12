#!/usr/bin/env node
/**
 * §9.5 B4.1 four-state gate + A/B comparison set.
 * Short puppeteer protocol (2–3s / phase). Pack's 30s×3 DevTools is documented, not required.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

const require = createRequire(import.meta.url);
const puppeteer = require("/tmp/node_modules/puppeteer-core");

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PROTO = path.join(ROOT, "prototype");
const PAINTING = path.join(ROOT, "painting");
const ART = "/opt/cursor/artifacts";
const PORT = Number(process.env.NF_BENCH_PORT || 8776);
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

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
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

async function snap(page, name) {
  const dest = uniqueArt(name);
  if (fs.existsSync(ART)) await page.screenshot({ path: dest, fullPage: false });
  return dest;
}

async function waitReady(page, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const info = await page.evaluate(() => window.__nfRender || null);
    if (info && info.n > 0 && info.atlasIsImageBitmap) return info;
    await sleep(50);
  }
  throw new Error("render atlas not ready");
}

async function leavePointer(page) {
  await page.evaluate(() => {
    const el = document.getElementById("void");
    if (el) el.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
    document.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
  });
}

async function waitFor(page, fn, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  let last = null;
  while (Date.now() < deadline) {
    last = await page.evaluate(fn);
    if (last && last.ok) return last;
    await sleep(40);
  }
  throw new Error(`timeout ${label}: ${JSON.stringify(last)}`);
}

async function openPage(browser, query) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  const logs = [];
  page.on("pageerror", (err) => logs.push(String(err)));
  await page.goto(`http://127.0.0.1:${PORT}/index.html${query}`, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await waitReady(page, 20_000);
  return { page, logs };
}

async function waitFormed(page, timeoutMs) {
  return waitFor(
    page,
    () => {
      const r = window.__nfRender;
      return { ok: !!(r && r.mode === "formed" && r.n > 0), mode: r && r.mode, running: r && r.running };
    },
    timeoutMs,
    "formed"
  );
}

async function samplePhase(page, ms) {
  await leavePointer(page);
  await page.evaluate(() => {
    if (window.__nfResetPerf) window.__nfResetPerf();
    const b = window.__nfB41;
    if (b) {
      b._mark = b.rafCount;
      b._sum0 = window.__nfAnim ? window.__nfAnim.checksum : 0;
    }
    if (window.__nfRender) window.__nfRender._tick0 = window.__nfRender.tickCount;
  });
  await sleep(ms);
  await leavePointer(page);
  return page.evaluate((elapsed) => {
    const perf = window.__nfGetPerf ? window.__nfGetPerf() : {};
    const b = window.__nfB41 || {};
    const r = window.__nfRender || {};
    const mark = b._mark || 0;
    const rafDelta = (b.rafCount || 0) - mark;
    return {
      mode: r.mode,
      phase: window.__nfExhibit && window.__nfExhibit.phase,
      running: r.running,
      stayQuiet: b.stayQuiet,
      discipline: b.discipline,
      rafDelta,
      hz: elapsed ? rafDelta / (elapsed / 1000) : 0,
      tickDelta: (r.tickCount || 0) - (r._tick0 || 0),
      checksumSame: window.__nfAnim ? window.__nfAnim.checksum === b._sum0 : false,
      lastPhysMs: perf.lastPhysMs,
      work: perf.work || {},
      raf: perf.raf || {},
      longtaskCount: perf.longtaskCount || 0,
      longTasks: perf.longTasks || [],
      spring: window.__nfAnim && window.__nfAnim.spring,
      contain: r.contain,
      pixel: window.__nfPixel,
    };
  }, ms);
}

async function launchBrowser() {
  const attempts = [
    { headless: false, args: ["--no-sandbox", "--ignore-gpu-blocklist"] },
    { headless: "new", args: ["--no-sandbox", "--ignore-gpu-blocklist"] },
    { headless: true, args: ["--no-sandbox", "--disable-gpu"] },
  ];
  let last = null;
  for (const opt of attempts) {
    try {
      return await puppeteer.launch({
        executablePath: CHROME,
        headless: opt.headless,
        args: opt.args,
      });
    } catch (err) {
      last = err;
    }
  }
  throw last || new Error("chrome launch failed");
}

async function main() {
  if (!CHROME) throw new Error("google-chrome not found");
  const server = await serve();
  let browser;
  try {
    browser = await launchBrowser();

    const trans = await openPage(browser, "?dpr=1&dwell=12000");
    await waitFor(
      trans.page,
      () => {
        const r = window.__nfRender;
        const e = window.__nfExhibit;
        return {
          ok: !!(r && (r.mode === "assemble" || e.phase === "intro" || e.phase === "handover")),
          mode: r && r.mode,
          phase: e && e.phase,
        };
      },
      8000,
      "transition"
    );
    const transition = await samplePhase(trans.page, 2000);
    const transShot = await snap(trans.page, "b41_transition_assemble.png");
    await waitFormed(trans.page, 8000);
    await leavePointer(trans.page);
    await sleep(200);
    const dwell = await samplePhase(trans.page, 2000);
    const dwellShot = await snap(trans.page, "b41_dwell_30hz.png");

    const raf0 = await trans.page.evaluate(() => window.__nfB41.rafCount);
    await trans.page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: function () { return true; } });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await sleep(600);
    const hidden = await trans.page.evaluate((before) => {
      const b = window.__nfB41;
      const e = window.__nfExhibit;
      return {
        rafBefore: before,
        rafAfter: b.rafCount,
        rafDelta: b.rafCount - before,
        running: window.__nfRender.running,
        hiddenAt: e.hiddenAt,
        phase: e.phase,
      };
    }, raf0);
    const clockBefore = await trans.page.evaluate(() => window.__nfExhibit.clockOffset);
    await trans.page.evaluate(() => {
      Object.defineProperty(document, "hidden", { configurable: true, get: function () { return false; } });
      document.dispatchEvent(new Event("visibilitychange"));
    });
    await sleep(200);
    const thawed = await trans.page.evaluate((offset0) => {
      const e = window.__nfExhibit;
      const b = window.__nfB41;
      return {
        running: window.__nfRender.running,
        b41running: !!(b && b.running),
        hiddenAt: e.hiddenAt,
        clockOffsetGrew: e.clockOffset > offset0,
        phase: e.phase,
      };
    }, clockBefore);
    await trans.page.close();

    const reduce = await openPage(browser, "?dpr=1");
    await reduce.page.emulateMediaFeatures([{ name: "prefers-reduced-motion", value: "reduce" }]);
    await reduce.page.reload({ waitUntil: "domcontentloaded" });
    await waitReady(reduce.page, 20_000);
    await waitFormed(reduce.page, 8000);
    const reduce0 = await reduce.page.evaluate(() => ({
      mode: window.__nfRender.mode,
      running: window.__nfRender.running,
      reduced: window.__nfAnim && window.__nfAnim.reduced,
      phase: window.__nfExhibit.phase,
      index: window.__nfExhibit.catalogIndex,
      rafCount: window.__nfB41.rafCount,
    }));
    await sleep(2500);
    const reduce1 = await reduce.page.evaluate(() => ({
      mode: window.__nfRender.mode,
      running: window.__nfRender.running,
      phase: window.__nfExhibit.phase,
      index: window.__nfExhibit.catalogIndex,
      rafCount: window.__nfB41.rafCount,
    }));
    const reduceShot = await snap(reduce.page, "b41_reduced_static.png");
    await reduce.page.close();

    const classic = await openPage(browser, "?dpr=1&autoplay=0&discipline=classic");
    await classic.page.click("#btn-intro");
    await leavePointer(classic.page);
    await waitFor(
      classic.page,
      () => {
        const r = window.__nfRender;
        return { ok: !!(r && r.mode === "formed" && r.running === false), mode: r && r.mode, running: r && r.running };
      },
      8000,
      "classic-idle"
    );
    const classicTicks = await classic.page.evaluate(() => window.__nfRender.tickCount);
    await sleep(400);
    const classicIdle = await classic.page.evaluate((held) => ({
      mode: window.__nfRender.mode,
      running: window.__nfRender.running,
      ticksBefore: held,
      ticksAfter: window.__nfRender.tickCount,
      held: window.__nfRender.tickCount === held && window.__nfRender.running === false,
      discipline: window.__nfB41 && window.__nfB41.discipline,
    }), classicTicks);
    await classic.page.close();

    async function formedShot(query, name) {
      const { page } = await openPage(browser, query);
      await page.click("#btn-intro");
      await leavePointer(page);
      await waitFormed(page, 8000);
      await leavePointer(page);
      await sleep(250);
      const info = await page.evaluate(() => ({
        contain: window.__nfRender.contain,
        pixel: window.__nfPixel,
        spring: window.__nfAnim && window.__nfAnim.spring,
        frameScale: window.__nfRender.frameScale,
      }));
      const shot = await snap(page, name);
      await page.close();
      return { shot, ...info };
    }

    const abSoft = await formedShot("?dpr=1&autoplay=0&block=0&dust=0", "b41_ab_soft.png");
    const abBlock2 = await formedShot("?dpr=1&autoplay=0", "b41_ab_block2.png");
    const abBlock3 = await formedShot("?dpr=1&autoplay=0&pixel=3", "b41_ab_block3.png");
    const abF09 = await formedShot("?dpr=1&autoplay=0&frame=0.9", "b41_ab_frame09.png");
    const abF10 = await formedShot("?dpr=1&autoplay=0&frame=1.0", "b41_ab_frame10.png");
    const abF11 = await formedShot("?dpr=1&autoplay=0&frame=1.1", "b41_ab_frame11.png");

    async function handoverMid(query, name) {
      const { page } = await openPage(browser, query);
      await waitFor(
        page,
        () => {
          const e = window.__nfExhibit;
          const a = window.__nfAnim;
          return {
            ok: !!(e && e.phase === "handover" && a && a.phaseElapsed >= 0.7 && a.phaseElapsed <= 2.2),
            phase: e && e.phase,
            t: a && a.phaseElapsed,
          };
        },
        12000,
        "handover-mid"
      );
      const info = await page.evaluate(() => ({
        phase: window.__nfExhibit.phase,
        group: window.__nfHandover && window.__nfHandover.group,
        t: window.__nfAnim.phaseElapsed,
      }));
      const shot = await snap(page, name);
      await page.close();
      return { shot, ...info };
    }

    const abDev = await handoverMid("?dpr=1&dwell=1400&group=develop", "b41_ab_develop_mid.png");
    const abSharp = await handoverMid("?dpr=1&dwell=1400&group=sharp", "b41_ab_sharp_mid.png");

    const cx09 = abF09.contain.x + abF09.contain.w * 0.5;
    const cx10 = abF10.contain.x + abF10.contain.w * 0.5;
    const cx11 = abF11.contain.x + abF11.contain.w * 0.5;
    const transLong = (transition.longTasks || []).some((t) => t.d > 50);
    const dwellHz = dwell.hz;
    const dwellWorkP95 = dwell.work.p95 || 99;
    const transWorkP95 = transition.work.p95 || 99;

    const bench = {
      task: "§9.5 B4.1",
      method: "short puppeteer 2–3s/phase (pack DevTools 30s×3 not run in this VM)",
      viewport: { w: 1440, h: 900, dpr: 1 },
      spring: { SPRING: dwell.spring, locked: dwell.spring === 0.055 },
      transition: {
        mode: transition.mode,
        phase: transition.phase,
        hz: transition.hz,
        work: transition.work,
        longtaskCount: transition.longtaskCount,
        longtask_gt_50: transLong,
      },
      dwell: {
        mode: dwell.mode,
        phase: dwell.phase,
        stayQuiet: dwell.stayQuiet,
        running: dwell.running,
        hz: dwellHz,
        work: dwell.work,
        tickDelta: dwell.tickDelta,
        checksumSame: dwell.checksumSame,
        lastPhysMs: dwell.lastPhysMs,
      },
      hidden: { ...hidden, thawed },
      reduce: { first: reduce0, later: reduce1 },
      classic: classicIdle,
      screenshots: {
        transition: transShot,
        dwell: dwellShot,
        reduce: reduceShot,
      },
      acceptance: {
        transition_work_p95_le_12: transWorkP95 <= 12,
        transition_no_longtask_50: transLong === false,
        dwell_hz_le_32: dwellHz <= 32,
        dwell_work_p95_le_2: dwellWorkP95 <= 2,
        dwell_zero_recompute: dwell.tickDelta === 0 && dwell.checksumSame === true && dwell.lastPhysMs === 0,
        hidden_raf_0: hidden.running === false && hidden.rafDelta === 0,
        thaw_no_catchup: thawed.clockOffsetGrew === true,
        reduce_static: reduce0.reduced === true && reduce0.running === false && reduce1.index === reduce0.index && reduce1.rafCount === reduce0.rafCount,
        thaw_resumes: thawed.b41running === true || thawed.running === true,
        classic_idle_stop: classicIdle.held === true,
        spring_locked: dwell.spring === 0.055,
      },
    };
    bench.acceptance.pass = Object.values(bench.acceptance).every(Boolean);

    const ab = {
      task: "§9.5 A/B",
      color: { version: "v1", v2_v3: "待拍板，未做" },
      soft_vs_block: {
        soft: { cell: abSoft.pixel && abSoft.pixel.cell, block: abSoft.pixel && abSoft.pixel.block, shot: abSoft.shot },
        block2: { cell: abBlock2.pixel && abBlock2.pixel.cell, size: abBlock2.pixel && abBlock2.pixel.size, shot: abBlock2.shot },
        block3: { cell: abBlock3.pixel && abBlock3.pixel.cell, size: abBlock3.pixel && abBlock3.pixel.size, shot: abBlock3.shot },
      },
      frame: {
        s09: { scale: abF09.frameScale, contain: abF09.contain, cx: cx09, shot: abF09.shot },
        s10: { scale: abF10.frameScale, contain: abF10.contain, cx: cx10, shot: abF10.shot },
        s11: { scale: abF11.frameScale, contain: abF11.contain, cx: cx11, shot: abF11.shot },
        center_delta_px: Math.max(Math.abs(cx09 - cx10), Math.abs(cx11 - cx10)),
      },
      group: {
        develop: abDev,
        sharp: abSharp,
      },
      acceptance: {
        soft_cell_16: !!(abSoft.pixel && abSoft.pixel.cell === 16 && abSoft.pixel.block === false),
        block2_cell_2: !!(abBlock2.pixel && abBlock2.pixel.cell === 2),
        block3_cell_3: !!(abBlock3.pixel && abBlock3.pixel.cell === 3),
        frame_center_stable: Math.max(Math.abs(cx09 - cx10), Math.abs(cx11 - cx10)) <= 1,
        frame_size_scales: abF09.contain.w < abF10.contain.w && abF10.contain.w < abF11.contain.w,
        groups_named: abDev.group === "develop" && abSharp.group === "sharp",
      },
    };
    ab.acceptance.pass = Object.values(ab.acceptance).every(Boolean);

    fs.writeFileSync(path.join(PAINTING, "b4-1-bench.json"), JSON.stringify(bench, null, 2) + "\n");
    fs.writeFileSync(path.join(PAINTING, "b4-1-ab.json"), JSON.stringify(ab, null, 2) + "\n");
    console.log(JSON.stringify({ bench, ab }, null, 2));
    if (!bench.acceptance.pass || !ab.acceptance.pass) {
      throw new Error("B4.1 / A/B acceptance failed");
    }
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
