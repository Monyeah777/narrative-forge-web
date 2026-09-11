#!/usr/bin/env node
/**
 * B1-3 Path B harness: static server + headless Chrome + POST result.
 * Does not wire prototype/ — that is B1-4.
 */
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright-core";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PAINTING = path.join(ROOT, "painting");
const PORT = 8769;
const CHROME =
  process.env.CHROME_PATH ||
  [
    "/usr/local/bin/google-chrome",
    "/usr/bin/google-chrome",
    "/usr/bin/chromium",
  ].find((p) => fs.existsSync(p));

const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".png": "image/png",
};

function send(res, code, body, type = "text/plain; charset=utf-8") {
  res.writeHead(code, { "content-type": type, "cache-control": "no-store" });
  res.end(body);
}

function main() {
  return new Promise((resolve, reject) => {
    let resultBody = null;
    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url || "/", `http://127.0.0.1:${PORT}`);
      if (req.method === "POST" && url.pathname === "/__path_b_result") {
        const chunks = [];
        for await (const c of req) chunks.push(c);
        resultBody = Buffer.concat(chunks).toString("utf8");
        const parsed = JSON.parse(resultBody);
        const payload = parsed.payload;
        delete parsed.payload;
        fs.writeFileSync(
          path.join(PAINTING, "b1-3-path-b-bench.json"),
          JSON.stringify(parsed, null, 2) + "\n"
        );
        fs.writeFileSync(
          path.join(PAINTING, "points-path-b.json"),
          JSON.stringify(payload) + "\n"
        );
        send(res, 200, JSON.stringify({ ok: true }));
        return;
      }
      if (req.method !== "GET" && req.method !== "HEAD") {
        send(res, 405, "method not allowed");
        return;
      }
      let rel = decodeURIComponent(url.pathname);
      if (rel === "/") rel = "/sample-browser.html";
      const file = path.normalize(path.join(PAINTING, rel));
      if (!file.startsWith(PAINTING)) {
        send(res, 403, "forbidden");
        return;
      }
      if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) {
        send(res, 404, "not found");
        return;
      }
      const ext = path.extname(file).toLowerCase();
      send(res, 200, fs.readFileSync(file), MIME[ext] || "application/octet-stream");
    });

    server.listen(PORT, "127.0.0.1", async () => {
      console.log(`Path B harness http://127.0.0.1:${PORT}/sample-browser.html?autorun=1`);
      if (!CHROME) {
        server.close();
        reject(new Error("google-chrome not found"));
        return;
      }
      let browser;
      try {
        browser = await chromium.launch({
          executablePath: CHROME,
          headless: true,
          args: ["--no-sandbox", "--disable-gpu"],
        });
        const page = await browser.newPage();
        page.on("console", (msg) => console.log("[page]", msg.text()));
        page.on("pageerror", (err) => console.error("[pageerror]", err));
        await page.goto(`http://127.0.0.1:${PORT}/sample-browser.html?autorun=1`, {
          waitUntil: "domcontentloaded",
          timeout: 60_000,
        });
        const deadline = Date.now() + 180_000;
        while (!resultBody && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 400));
        }
        if (!resultBody) throw new Error("Path B did not POST result within 180s");
        const summary = JSON.parse(resultBody);
        delete summary.payload;
        console.log(JSON.stringify(summary, null, 2));
        resolve(0);
      } catch (err) {
        reject(err);
      } finally {
        if (browser) await browser.close().catch(() => {});
        server.close();
      }
    });
  });
}

main()
  .then((code) => process.exit(code))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
