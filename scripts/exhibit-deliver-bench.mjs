#!/usr/bin/env node
/**
 * §9.6 closeout: re-check §3 handover, rollback queries, manifest sync, R1–R3 leftovers.
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
const PORT = Number(process.env.NF_BENCH_PORT || 8777);
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

function extractInlineManifest(src) {
  const marker = "var exhibitManifest = {";
  const i = src.indexOf(marker);
  if (i < 0) throw new Error("inline exhibitManifest missing");
  const start = i + "var exhibitManifest = ".length;
  let depth = 0;
  let end = -1;
  for (let k = start; k < src.length; k++) {
    if (src[k] === "{") depth++;
    else if (src[k] === "}") {
      depth--;
      if (depth === 0) {
        end = k + 1;
        break;
      }
    }
  }
  if (end < 0) throw new Error("inline exhibitManifest unclosed");
  return Function('"use strict"; return (' + src.slice(start, end) + ")")();
}

function jsonFetchedInPrototype(src) {
  return /exhibit-manifest\.json/.test(src);
}

function auditConflicts() {
  const allow = new Set([
    "docs/NF_自动放映_修订包_v1.0.md",
    "docs/NF_自动放映_交付_v1.0.md",
    "HANDOFF.md",
    "scripts/exhibit-deliver-bench.mjs",
  ]);
  const roots = ["docs", "prototype", "scripts", "src", "."];
  const files = [];
  function walk(dir, depth) {
    if (depth > 4) return;
    let ents;
    try {
      ents = fs.readdirSync(dir, { withFileTypes: true });
    } catch (err) {
      return;
    }
    for (const ent of ents) {
      if (ent.name === "node_modules" || ent.name === ".git") continue;
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) walk(p, depth + 1);
      else if (/\.(md|html|js|mjs|tsx|ts)$/.test(ent.name)) files.push(p);
    }
  }
  walk(ROOT, 0);
  const re = /没有自动呼吸轮播|成画即停 rAF|不要加（自动）轮播|散点到装配/;
  const hits = [];
  for (const file of files) {
    const rel = path.relative(ROOT, file).replace(/\\/g, "/");
    const text = fs.readFileSync(file, "utf8");
    if (!re.test(text)) continue;
    hits.push({ file: rel, allowed: allow.has(rel) });
  }
  const stray = hits.filter((h) => !h.allowed);
  return { hits, stray, pass: stray.length === 0 };
}

function manifestDiff() {
  const html = fs.readFileSync(path.join(PROTO, "index.html"), "utf8");
  const json = JSON.parse(fs.readFileSync(path.join(PROTO, "assets/exhibit-manifest.json"), "utf8"));
  const inline = extractInlineManifest(html);
  const skip = new Set(["note"]);
  const keys = Array.from(new Set([...Object.keys(json), ...Object.keys(inline)])).sort();
  const diffs = [];
  for (const key of keys) {
    if (skip.has(key)) continue;
    const a = JSON.stringify(json[key]);
    const b = JSON.stringify(inline[key]);
    if (a !== b) diffs.push({ key, json: json[key], inline: inline[key] });
  }
  return {
    runtime_authority: "inline exhibitManifest in prototype/index.html",
    json_fetched: jsonFetchedInPrototype(html),
    json_only: ["note"],
    seed_equal: (json.seed >>> 0) === (inline.seed >>> 0),
    diffs,
    inline,
    json,
    pass: diffs.length === 0 && (json.seed >>> 0) === (inline.seed >>> 0) && !jsonFetchedInPrototype(html),
  };
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
    await sleep(50);
  }
  throw new Error(`timeout ${label}: ${JSON.stringify(last)}`);
}

async function openPage(browser, query) {
  const page = await browser.newPage();
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto(`http://127.0.0.1:${PORT}/index.html${query}`, {
    waitUntil: "domcontentloaded",
    timeout: 30_000,
  });
  await waitReady(page, 20_000);
  await leavePointer(page);
  return page;
}

async function readSwitch(page) {
  return page.evaluate(() => {
    const m = window.__nfManifest;
    return {
      autoplay: !!(m.autoplay && m.autoplay.enabled),
      discipline: m.motion && m.motion.discipline,
      group: m.transition && m.transition.group,
      arc: m.transition && m.transition.arc,
      handover: m.transition && m.transition.handover,
      seedMode: m.seedMode,
      block: !!(m.pixelBlock && m.pixelBlock.enabled),
      pixel: m.pixelBlock && m.pixelBlock.size,
      dust: !!(m.dust && m.dust.enabled),
      frameScale: m.frameScale,
      colorVersion: m.colorVersion || "v1",
      interlude: m.interlude,
      pause: m.control && m.control.pause,
    };
  });
}

async function main() {
  if (!CHROME) throw new Error("google-chrome not found");
  const conflicts = auditConflicts();
  const manifest = manifestDiff();
  const prior = {
    seed: JSON.parse(fs.readFileSync(path.join(PAINTING, "seed-cloud.json"), "utf8")),
    handover: JSON.parse(fs.readFileSync(path.join(PAINTING, "handover-invariants.json"), "utf8")),
    pixel: JSON.parse(fs.readFileSync(path.join(PAINTING, "pixel-block-dust.json"), "utf8")),
    b41: JSON.parse(fs.readFileSync(path.join(PAINTING, "b4-1-bench.json"), "utf8")),
    ab: JSON.parse(fs.readFileSync(path.join(PAINTING, "b4-1-ab.json"), "utf8")),
  };

  const server = await serve();
  let browser;
  try {
    browser = await launchBrowser();

    const defaults = await openPage(browser, "?dpr=1");
    const defaultSw = await readSwitch(defaults);
    await defaults.close();

    const cases = [
      { q: "?dpr=1&autoplay=0", key: "autoplay", expect: (s) => s.autoplay === false },
      { q: "?dpr=1&discipline=classic", key: "discipline", expect: (s) => s.discipline === "classic" },
      { q: "?dpr=1&group=sharp", key: "group", expect: (s) => s.group === "sharp" },
      { q: "?dpr=1&arc=off", key: "arc", expect: (s) => s.arc === "off" },
      { q: "?dpr=1&handover=0", key: "handover", expect: (s) => s.handover === "off" },
      { q: "?dpr=1&seed=uniform", key: "seed", expect: (s) => s.seedMode === "uniform" },
      { q: "?dpr=1&block=0", key: "block", expect: (s) => s.block === false },
      { q: "?dpr=1&pixel=3", key: "pixel", expect: (s) => s.pixel === 3 && s.block === true },
      { q: "?dpr=1&dust=0", key: "dust", expect: (s) => s.dust === false },
      { q: "?dpr=1&frame=0.9", key: "frame", expect: (s) => s.frameScale === 0.9 },
    ];
    const switches = [];
    for (const c of cases) {
      const page = await openPage(browser, c.q);
      const got = await readSwitch(page);
      const ok = c.expect(got);
      switches.push({ query: c.q, key: c.key, ok, got });
      await page.close();
    }

    const hoPage = await openPage(browser, "?dpr=1&dwell=1600");
    await waitFor(
      hoPage,
      () => {
        const e = window.__nfExhibit;
        const h = window.__nfHandover;
        return {
          ok: !!(h && h.done && e && e.catalogIndex === 1 && window.__nfRender.mode === "formed"),
          phase: e && e.phase,
          done: !!(h && h.done),
          index: e && e.catalogIndex,
          pass: h && h.pass,
        };
      },
      16000,
      "handover-done"
    );
    const handover = await hoPage.evaluate(() => {
      const h = window.__nfHandover || {};
      return {
        pass: h.pass,
        measured: {
          a_core_release_s: h.a_core_release_s,
          b_core_start_s: h.b_core_start_s,
          core_delta_s: h.core_delta_s,
          overlap_s: h.overlap_s,
          empty_frames: h.empty_frames,
          snapAll_calls: h.snapAll_calls,
          max_step_px: h.max_step_px,
          max_drift: h.max_drift,
          waveN: h.waveN,
          tail_locks: h.tail_locks,
          T: h.T,
          group: h.group,
        },
        spring: window.__nfAnim && window.__nfAnim.spring,
      };
    });
    const hallShot = uniqueArt("ex_deliver_hall_formed.png");
    if (fs.existsSync(ART)) await hoPage.screenshot({ path: hallShot, fullPage: false });
    await hoPage.click("#btn-home");
    await leavePointer(hoPage);
    await waitFor(
      hoPage,
      () => {
        const mode = window.__nfRender && window.__nfRender.mode;
        return { ok: mode === "chaos" || mode === "disperse", mode };
      },
      2000,
      "home-disperse"
    );
    await sleep(1200);
    const home = await hoPage.evaluate(() => ({
      mode: window.__nfRender.mode,
      view: document.getElementById("dossier") && document.getElementById("dossier").getAttribute("aria-hidden"),
    }));
    await hoPage.close();

    const dwellPage = await openPage(browser, "?dpr=1");
    await waitFor(
      dwellPage,
      () => {
        const r = window.__nfRender;
        const b = window.__nfB41;
        return { ok: !!(r && r.mode === "formed" && b && b.stayQuiet), mode: r && r.mode, quiet: b && b.stayQuiet };
      },
      8000,
      "dwell-quiet"
    );
    await leavePointer(dwellPage);
    await dwellPage.evaluate(() => {
      if (window.__nfResetPerf) window.__nfResetPerf();
      const b = window.__nfB41;
      if (b) {
        b._mark = b.rafCount;
        b._sum0 = window.__nfAnim ? window.__nfAnim.checksum : 0;
      }
      if (window.__nfRender) window.__nfRender._tick0 = window.__nfRender.tickCount;
    });
    await sleep(1500);
    const dwell = await dwellPage.evaluate(() => {
      const b = window.__nfB41 || {};
      const r = window.__nfRender || {};
      const perf = window.__nfGetPerf ? window.__nfGetPerf() : {};
      const rafDelta = (b.rafCount || 0) - (b._mark || 0);
      return {
        hz: rafDelta / 1.5,
        tickDelta: (r.tickCount || 0) - (r._tick0 || 0),
        checksumSame: window.__nfAnim ? window.__nfAnim.checksum === b._sum0 : false,
        lastPhysMs: perf.lastPhysMs,
        workP95: perf.work && perf.work.p95,
        stayQuiet: b.stayQuiet,
        spring: window.__nfAnim && window.__nfAnim.spring,
      };
    });
    const dwellShot = uniqueArt("ex_deliver_intro_dwell.png");
    if (fs.existsSync(ART)) await dwellPage.screenshot({ path: dwellShot, fullPage: false });
    await dwellPage.close();

    const report = {
      task: "§9.6 exhibit-deliver",
      verdict: "NF-EXHIBIT-DELIVER-20260912",
      viewport: { w: 1440, h: 900, dpr: 1 },
      manifest,
      defaults: defaultSw,
      switches,
      handover,
      home,
      dwell,
      conflicts,
      prior_pass: {
        seed: !!(prior.seed.acceptance && prior.seed.acceptance.pass),
        handover: !!(prior.handover.acceptance && prior.handover.acceptance.pass),
        pixel: !!(prior.pixel.acceptance && prior.pixel.acceptance.pass),
        b41: !!(prior.b41.acceptance && prior.b41.acceptance.pass),
        ab: !!(prior.ab.acceptance && prior.ab.acceptance.pass),
      },
      screenshots: { hall: hallShot, dwell: dwellShot },
      acceptance: {
        manifest_sync: manifest.pass === true,
        json_not_fetched: manifest.json_fetched === false,
        conflicts_clean: conflicts.pass === true,
        switches_all: switches.every((s) => s.ok),
        section3_pass: !!(handover.pass && handover.pass.all),
        no_snap: handover.measured && handover.measured.snapAll_calls === 0,
        no_empty: handover.measured && handover.measured.empty_frames === 0,
        home_chaos: home.mode === "chaos",
        dwell_hz_le_32: dwell.hz <= 32,
        dwell_zero_recompute: dwell.tickDelta === 0 && dwell.checksumSame === true && dwell.lastPhysMs === 0,
        spring_locked: handover.spring === 0.055 && dwell.spring === 0.055,
        prior_logs_pass:
          prior.seed.acceptance.pass &&
          prior.handover.acceptance.pass &&
          prior.pixel.acceptance.pass &&
          prior.b41.acceptance.pass &&
          prior.ab.acceptance.pass,
      },
    };
    report.acceptance.pass = Object.values(report.acceptance).every(Boolean);
    fs.writeFileSync(path.join(PAINTING, "exhibit-deliver.json"), JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report, null, 2));
    if (!report.acceptance.pass) throw new Error("§9.6 delivery acceptance failed");
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
