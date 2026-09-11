/**
 * B1-3 Path B — one-shot browser sampler (Canvas 2D getImageData).
 * Contract v2: { id, w, h, count, note, palette, points:[[x,y,i]] }.
 * Sample once only — never from rAF. Prototype fetch is B1-4.
 */
(() => {
  const COUNT = 12000;
  const K = 256;
  const SEED = 0x4e46;
  const DARK_L = 0.19;
  const WEIGHT_BASE = 0.6;
  const WEIGHT_GAIN = 0.4;
  const WEIGHT_EXP = 1.2;
  const NOTE =
    "normalized 0..1 · OKLab-weighted · dark-culled · palette-quantized";
  const IMAGE_URL = "./01-dallas.jpg";
  const META_URL = "./source.json";
  const M1 = [
    [0.4122214708, 0.5363325363, 0.0514459929],
    [0.2119034982, 0.6806995451, 0.1073969566],
    [0.0883024619, 0.2817188376, 0.6299787005],
  ];

  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function srgbToLinear(c) {
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  function linearToSrgb(c) {
    return c <= 0.0031308
      ? 12.92 * c
      : 1.055 * Math.pow(Math.max(c, 0), 1 / 2.4) - 0.055;
  }
  function linearToOklab(r, g, b) {
    const l = M1[0][0] * r + M1[0][1] * g + M1[0][2] * b;
    const m = M1[1][0] * r + M1[1][1] * g + M1[1][2] * b;
    const s = M1[2][0] * r + M1[2][1] * g + M1[2][2] * b;
    const l_ = Math.cbrt(Math.max(l, 0));
    const m_ = Math.cbrt(Math.max(m, 0));
    const s_ = Math.cbrt(Math.max(s, 0));
    return [
      0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
      1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
      0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_,
    ];
  }
  function oklabToLinear(L, a, b) {
    const l_ = L + 0.3963377774 * a + 0.2158037573 * b;
    const m_ = L - 0.1055613458 * a - 0.0638541728 * b;
    const s_ = L - 0.0894841775 * a - 1.2914855480 * b;
    const l = l_ * l_ * l_;
    const m = m_ * m_ * m_;
    const s = s_ * s_ * s_;
    return [
      +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
      -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
      -0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s,
    ];
  }
  function hexFromLab(L, a, b) {
    const lin = oklabToLinear(L, a, b);
    const r = Math.round(Math.min(1, Math.max(0, linearToSrgb(lin[0]))) * 255);
    const g = Math.round(Math.min(1, Math.max(0, linearToSrgb(lin[1]))) * 255);
    const bl = Math.round(Math.min(1, Math.max(0, linearToSrgb(lin[2]))) * 255);
    return (
      "#" +
      r.toString(16).padStart(2, "0") +
      g.toString(16).padStart(2, "0") +
      bl.toString(16).padStart(2, "0")
    );
  }

  function weightedSample(eligible, weights, count, rnd) {
    const heapKey = new Float64Array(count);
    const heapIdx = new Int32Array(count);
    let size = 0;
    const siftUp = (i) => {
      while (i > 0) {
        const p = (i - 1) >> 1;
        if (heapKey[p] <= heapKey[i]) break;
        let tk = heapKey[p];
        heapKey[p] = heapKey[i];
        heapKey[i] = tk;
        let ti = heapIdx[p];
        heapIdx[p] = heapIdx[i];
        heapIdx[i] = ti;
        i = p;
      }
    };
    const siftDown = (i) => {
      for (;;) {
        let s = i;
        const l = i * 2 + 1;
        const r = l + 1;
        if (l < size && heapKey[l] < heapKey[s]) s = l;
        if (r < size && heapKey[r] < heapKey[s]) s = r;
        if (s === i) break;
        let tk = heapKey[s];
        heapKey[s] = heapKey[i];
        heapKey[i] = tk;
        let ti = heapIdx[s];
        heapIdx[s] = heapIdx[i];
        heapIdx[i] = ti;
        i = s;
      }
    };
    for (let i = 0; i < eligible.length; i++) {
      const u = Math.max(rnd(), 1e-12);
      const key = Math.pow(u, 1 / weights[i]);
      if (size < count) {
        heapKey[size] = key;
        heapIdx[size] = eligible[i];
        siftUp(size++);
      } else if (key > heapKey[0]) {
        heapKey[0] = key;
        heapIdx[0] = eligible[i];
        siftDown(0);
      }
    }
    return heapIdx.slice(0, count);
  }

  function medianCutCenters(lab, k) {
    const n = lab.length / 3;
    let boxes = [Array.from({ length: n }, (_, i) => i)];
    while (boxes.length < k) {
      let bestI = 0,
        bestRange = -1,
        bestAxis = 0;
      for (let bi = 0; bi < boxes.length; bi++) {
        const idx = boxes[bi];
        if (idx.length <= 1) continue;
        let minL = Infinity,
          maxL = -Infinity,
          minA = Infinity,
          maxA = -Infinity,
          minB = Infinity,
          maxB = -Infinity;
        for (const i of idx) {
          const L = lab[i * 3],
            a = lab[i * 3 + 1],
            b = lab[i * 3 + 2];
          if (L < minL) minL = L;
          if (L > maxL) maxL = L;
          if (a < minA) minA = a;
          if (a > maxA) maxA = a;
          if (b < minB) minB = b;
          if (b > maxB) maxB = b;
        }
        const ranges = [maxL - minL, maxA - minA, maxB - minB];
        let axis = 0;
        if (ranges[1] > ranges[axis]) axis = 1;
        if (ranges[2] > ranges[axis]) axis = 2;
        if (
          ranges[axis] > bestRange ||
          (ranges[axis] === bestRange && idx.length > boxes[bestI].length)
        ) {
          bestI = bi;
          bestRange = ranges[axis];
          bestAxis = axis;
        }
      }
      if (bestRange <= 1e-12) break;
      const idx = boxes[bestI]
        .slice()
        .sort((i, j) => lab[i * 3 + bestAxis] - lab[j * 3 + bestAxis]);
      const mid = Math.floor(idx.length / 2);
      if (mid === 0 || mid === idx.length) break;
      boxes[bestI] = idx.slice(0, mid);
      boxes.push(idx.slice(mid));
    }
    const centers = new Float64Array(k * 3);
    for (let c = 0; c < boxes.length; c++) {
      const idx = boxes[c];
      let sL = 0,
        sA = 0,
        sB = 0;
      for (const i of idx) {
        sL += lab[i * 3];
        sA += lab[i * 3 + 1];
        sB += lab[i * 3 + 2];
      }
      const inv = 1 / Math.max(idx.length, 1);
      centers[c * 3] = sL * inv;
      centers[c * 3 + 1] = sA * inv;
      centers[c * 3 + 2] = sB * inv;
    }
    for (let c = boxes.length; c < k; c++) {
      centers[c * 3] = centers[(boxes.length - 1) * 3];
      centers[c * 3 + 1] = centers[(boxes.length - 1) * 3 + 1];
      centers[c * 3 + 2] = centers[(boxes.length - 1) * 3 + 2];
    }
    return centers;
  }

  function assignLabels(lab, centers) {
    const n = lab.length / 3;
    const k = centers.length / 3;
    const labels = new Int32Array(n);
    for (let i = 0; i < n; i++) {
      const L = lab[i * 3],
        a = lab[i * 3 + 1],
        b = lab[i * 3 + 2];
      let best = 0,
        bestD = Infinity;
      for (let c = 0; c < k; c++) {
        const dL = L - centers[c * 3];
        const dA = a - centers[c * 3 + 1];
        const dB = b - centers[c * 3 + 2];
        const d = dL * dL + dA * dA + dB * dB;
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      labels[i] = best;
    }
    return labels;
  }

  function log(msg) {
    const el = document.getElementById("log");
    if (el) el.textContent += msg + "\n";
    console.log(msg);
  }

  async function runOnce() {
    if (window.__nfPathBRan) {
      throw new Error("Path B already ran this page load (one-shot red line)");
    }
    window.__nfPathBRan = true;
    const timing = {};
    const tAll0 = performance.now();
    const meta = await fetch(META_URL)
      .then((r) => r.json())
      .catch(() => ({ id: "poplars-dallas" }));

    const tImg0 = performance.now();
    const img = await new Promise((resolve, reject) => {
      const im = new Image();
      im.onload = () => resolve(im);
      im.onerror = () => reject(new Error("image load failed"));
      im.src = IMAGE_URL;
    });
    timing.image_load_ms = +(performance.now() - tImg0).toFixed(3);

    const w = img.naturalWidth;
    const h = img.naturalHeight;
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("2d context unavailable");
    ctx.drawImage(img, 0, 0);

    const tRead0 = performance.now();
    const imageData = ctx.getImageData(0, 0, w, h); // ONE readback
    timing.getImageData_ms = +(performance.now() - tRead0).toFixed(3);
    const data = imageData.data;
    const n = w * h;

    const tSample0 = performance.now();
    const eligible = [];
    const weights = [];
    const allLab = new Float64Array(n * 3);
    let darkCull = 0;
    for (let i = 0; i < n; i++) {
      const o = i * 4;
      const lab = linearToOklab(
        srgbToLinear(data[o] / 255),
        srgbToLinear(data[o + 1] / 255),
        srgbToLinear(data[o + 2] / 255)
      );
      allLab[i * 3] = lab[0];
      allLab[i * 3 + 1] = lab[1];
      allLab[i * 3 + 2] = lab[2];
      if (lab[0] < DARK_L) {
        darkCull++;
        continue;
      }
      eligible.push(i);
      weights.push(WEIGHT_BASE + WEIGHT_GAIN * Math.pow(lab[0], WEIGHT_EXP));
    }
    if (eligible.length < COUNT) throw new Error(`eligible ${eligible.length} < ${COUNT}`);

    const rnd = mulberry32(SEED);
    const picked = weightedSample(eligible, weights, COUNT, rnd);
    const sampleLab = new Float64Array(COUNT * 3);
    const xs = new Float64Array(COUNT);
    const ys = new Float64Array(COUNT);
    for (let i = 0; i < COUNT; i++) {
      const pix = picked[i];
      xs[i] = ((pix % w) + 0.5) / w;
      ys[i] = (((pix / w) | 0) + 0.5) / h;
      sampleLab[i * 3] = allLab[pix * 3];
      sampleLab[i * 3 + 1] = allLab[pix * 3 + 1];
      sampleLab[i * 3 + 2] = allLab[pix * 3 + 2];
    }

    const centers = medianCutCenters(sampleLab, K);
    const labels = assignLabels(sampleLab, centers);
    const order = Array.from({ length: K }, (_, i) => i).sort((i, j) => {
      const dL = centers[i * 3] - centers[j * 3];
      if (dL) return dL;
      const dA = centers[i * 3 + 1] - centers[j * 3 + 1];
      if (dA) return dA;
      return centers[i * 3 + 2] - centers[j * 3 + 2];
    });
    const remap = new Int32Array(K);
    const sorted = new Float64Array(K * 3);
    for (let ni = 0; ni < K; ni++) {
      const oi = order[ni];
      sorted[ni * 3] = centers[oi * 3];
      sorted[ni * 3 + 1] = centers[oi * 3 + 1];
      sorted[ni * 3 + 2] = centers[oi * 3 + 2];
      remap[oi] = ni;
    }
    for (let i = 0; i < COUNT; i++) labels[i] = remap[labels[i]];
    const palette = [];
    for (let c = 0; c < K; c++) {
      palette.push(hexFromLab(sorted[c * 3], sorted[c * 3 + 1], sorted[c * 3 + 2]));
    }
    const perm = Array.from({ length: COUNT }, (_, i) => i);
    for (let i = COUNT - 1; i > 0; i--) {
      const j = (rnd() * (i + 1)) | 0;
      const tmp = perm[i];
      perm[i] = perm[j];
      perm[j] = tmp;
    }
    const points = [];
    for (const i of perm) {
      points.push([+xs[i].toFixed(4), +ys[i].toFixed(4), labels[i] | 0]);
    }
    timing.sample_ms = +(performance.now() - tSample0).toFixed(3);
    timing.total_ms = +(performance.now() - tAll0).toFixed(3);
    const payload = {
      id: meta.id || "poplars-dallas",
      w,
      h,
      count: COUNT,
      note: NOTE,
      palette,
      points,
    };
    timing.json_bytes = JSON.stringify(payload).length;
    timing.dark_cull_pct = +((darkCull / n) * 100).toFixed(4);
    timing.getImageData_calls = 1;
    timing.willReadFrequently = true;
    return { payload, timing };
  }

  async function postResult(bundle) {
    try {
      const res = await fetch("/__path_b_result", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          path: "B",
          tool: "painting/sample-browser.js (Canvas2D getImageData once)",
          count: bundle.payload.count,
          points_len: bundle.payload.points.length,
          palette_len: bundle.payload.palette.length,
          w: bundle.payload.w,
          h: bundle.payload.h,
          id: bundle.payload.id,
          keys: Object.keys(bundle.payload),
          timing: bundle.timing,
          payload: bundle.payload,
        }),
      });
      return res.ok;
    } catch {
      return false;
    }
  }

  async function main() {
    const btn = document.getElementById("run");
    const out = document.getElementById("out");
    const status = document.getElementById("status");
    async function go() {
      if (btn) btn.disabled = true;
      if (status) status.textContent = "running one-shot sample…";
      log("Path B start");
      const bundle = await runOnce();
      log(
        `done count=${bundle.payload.count} getImageData=${bundle.timing.getImageData_ms}ms sample=${bundle.timing.sample_ms}ms total=${bundle.timing.total_ms}ms`
      );
      if (out)
        out.textContent = JSON.stringify(
          {
            count: bundle.payload.count,
            points_len: bundle.payload.points.length,
            palette_len: bundle.payload.palette.length,
            keys: Object.keys(bundle.payload),
            timing: bundle.timing,
          },
          null,
          2
        );
      const posted = await postResult(bundle);
      if (status)
        status.textContent = posted ? "posted to harness ✓" : "done (open via scripts/run-path-b.mjs)";
      window.__nfPathBResult = {
        count: bundle.payload.count,
        points_len: bundle.payload.points.length,
        timing: bundle.timing,
      };
    }
    if (btn)
      btn.addEventListener("click", () =>
        go().catch((e) => {
          log(String((e && e.stack) || e));
          if (status) status.textContent = "error";
        })
      );
    if (new URLSearchParams(location.search).get("autorun") === "1") await go();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", () => main().catch(console.error));
  } else {
    main().catch(console.error);
  }
})();
