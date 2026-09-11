#!/usr/bin/env node
/**
 * B2: 12k palette atlas, ImageBitmap, contain, FPS, settle/stop-rAF.
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
const PORT = Number(process.env.NF_BENCH_PORT || 8771);
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
    const ready = await waitReady(page, 20_000);
    await new Promise((r) => setTimeout(r, 800));
    const fps1 = await page.evaluate(async () => {
      const a = window.__nfRender.tickCount;
      const t0 = performance.now();
      await new Promise((r) => setTimeout(r, 1000));
      const b = window.__nfRender.tickCount;
      const dt = performance.now() - t0;
      return { ticks: b - a, ms: dt, fps: ((b - a) * 1000) / dt, n: window.__nfRender.n, running: window.__nfRender.running };
    });
    const homeShot = await snap(page, "b2_home_palette_dust.png");

    await page.click("#btn-intro");
    await page.evaluate(() => {
      var el = document.getElementById("void");
      if (el) el.dispatchEvent(new PointerEvent("pointerleave", { bubbles: true }));
    });
    const formedDeadline = Date.now() + 16_000;
    let formed = null;
    while (Date.now() < formedDeadline) {
      formed = await page.evaluate(() => {
        const lead = document.querySelector(".dossier .panel[data-panel=\"intro\"] .lead");
        return {
          mode: window.__nfRender.mode,
          running: window.__nfRender.running,
          activeCount: window.__nfRender.activeCount,
          n: window.__nfRender.n,
          atlasCtor: window.__nfRender.atlasCtor,
          atlasIsImageBitmap: window.__nfRender.atlasIsImageBitmap,
          contain: window.__nfRender.contain,
          dpr: window.__nfRender.dpr,
          leadText: lead && lead.textContent,
          leadOpacity: lead ? getComputedStyle(lead).opacity : "",
          stageMode: document.getElementById("stage") && document.getElementById("stage").getAttribute("data-mode"),
        };
      });
      if (formed.stageMode === "formed" && Number(formed.leadOpacity) >= 0.9 && formed.running === false) break;
      await new Promise((r) => setTimeout(r, 200));
    }
    const introShot = await snap(page, "b2_intro_formed_settled.png");
    const pairPath = path.join(ART, "b2_formed_vs_source.png");
    if (fs.existsSync(ART) && !fs.existsSync(pairPath) && fs.existsSync(introShot)) {
      execFileSync("python3", [
        "-c",
        "from PIL import Image; import sys; formed=Image.open(sys.argv[1]).convert('RGB'); src=Image.open(sys.argv[2]).convert('RGB'); h=800; src=src.resize((int(src.width*h/src.height), h)); formed=formed.resize((int(formed.width*h/formed.height), h)); out=Image.new('RGB', (formed.width+src.width+24, h), (5,5,5)); out.paste(src, (0,0)); out.paste(formed, (src.width+24, 0)); out.save(sys.argv[3], quality=92)",
        introShot,
        path.join(PAINTING, "01-dallas.jpg"),
        pairPath,
      ]);
    }
    const zoom = await page.evaluate(() => {
      const src = document.getElementById("void");
      const c = window.__nfRender.contain;
      const dpr = window.__nfRender.dpr;
      const z = document.createElement("canvas");
      z.width = 480;
      z.height = 480;
      const g = z.getContext("2d");
      const sx = Math.max(0, (c.x + c.w * 0.55) * dpr);
      const sy = Math.max(0, (c.y + c.h * 0.12) * dpr);
      g.imageSmoothingEnabled = true;
      g.drawImage(src, sx, sy, 90 * dpr, 90 * dpr, 0, 0, 480, 480);
      return z.toDataURL("image/png");
    });
    if (fs.existsSync(ART)) {
      const buf = Buffer.from(zoom.split(",")[1], "base64");
      const zoomPath = path.join(ART, "b2_sprite_zoom_sky.png");
      if (!fs.existsSync(zoomPath)) fs.writeFileSync(zoomPath, buf);
    }

    const ticksBefore = await page.evaluate(() => window.__nfRender.tickCount);
    await new Promise((r) => setTimeout(r, 5000));
    const idle = await page.evaluate((before) => {
      return {
        ticks: window.__nfRender.tickCount - before,
        running: window.__nfRender.running,
        activeCount: window.__nfRender.activeCount,
        mode: window.__nfRender.mode,
      };
    }, ticksBefore);

    await page.mouse.move(200, 400);
    await new Promise((r) => setTimeout(r, 200));
    const woke = await page.evaluate(() => window.__nfRender.running);

    const aspectSrc = ready.contain ? ready.contain.srcW / ready.contain.srcH : 0;
    const aspectFit = formed.contain.w / formed.contain.h;
    const report = {
      task: "B2",
      ready,
      chaos_fps: fps1,
      formed,
      idle_5s: idle,
      pointer_woke: woke,
      logs,
      screenshots: {
        home: homeShot,
        intro: introShot,
        zoom: path.join(ART, "b2_sprite_zoom_sky.png"),
        vs_source: path.join(ART, "b2_formed_vs_source.png"),
      },
      acceptance: {
        n_12000: ready.n === 12000,
        atlas_imagebitmap: ready.atlasIsImageBitmap === true,
        contain_aspect: Math.abs(aspectSrc - aspectFit) < 0.02,
        contain_margins: formed.contain.x > 1 || formed.contain.y > 1,
        intro_copy: formed.leadText === "把叙事，变成工程。" && Number(formed.leadOpacity) >= 0.9,
        settled_stop_raf: idle.running === false && idle.ticks <= 2,
        pointer_wakes: woke === true,
        fps_recorded: typeof fps1.fps === "number",
        dpr_le_2: formed.dpr <= 2,
      },
    };
    report.acceptance.pass = Object.values(report.acceptance).every(Boolean);
    fs.writeFileSync(path.join(PAINTING, "b2-render.json"), JSON.stringify(report, null, 2) + "\n");
    console.log(JSON.stringify(report, null, 2));
    if (!report.acceptance.pass) throw new Error("B2 acceptance failed");
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
