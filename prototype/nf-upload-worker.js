/**
 * NF 上传采样 · Worker 核心（S1）
 *
 * 复刻参考管线（口径与 scripts/radial-s0-diagnose.py / s2a-candidates.py / s2b-thinning.py 一致）：
 *   ① 屏蔽  eligible = (OKLab L ≥ 0.19) ∧ (α ≥ 0.5)；质心取合格像素均值；R95 = 合格像素到质心距离的 p95
 *   ② 候选  合格像素上做拒绝采样（W(r)=0.2+0.8·e^(−2.5r)，P=W/Wmax，有放回），取 5×N，再做固定种子置换 = 细化顺序
 *   ③ 细化  dart-thinning：r_local = s0·√(Wmax/w)（像素单位），按顺序贪心接受；s0 二分校准到目标 N（±2%，≤4 轮）
 *   ④ 颜色  OKLab 中位切分 256 色（复用 painting/sample-browser.js 的同款实现），逐点取最近色
 *   count 拟合：pad/trim 到精确 N（多则截尾，少则尾部复制同坐标同色）
 *
 * 双环境：Worker（self.onmessage）与 Node（module.exports.runSampler）同一份代码 ——
 * 与规格 §9-A「Node 注入合成图跑同一 Worker 模块」一致。
 *
 * 不改动物理引擎 / 渲染器 / 三画资产。
 */
(function (root) {
  "use strict";

  var VERSION = "nf-upload-sampler-v1";

  /* ---- 口径常量（规格 §4；与参考脚本一致） ---- */
  var DARK_L = 0.19;
  var ALPHA_CULL = 0.5;
  var CAND_RATIO = 5;
  var W_A = 0.2;
  var W_B = 0.8;
  var W_K = 2.5;
  var WMAX = W_A + W_B; /* r=0 处最大 → 1.0 */
  var S0_FACTOR = 0.54;
  var S0_TOL = 0.02; /* ±2%（规格 §4；参考脚本为 ±5%） */
  var S0_MAX_ROUNDS = 4;
  var PAL_K_DEFAULT = 256;
  var SEED = 0x53324131; /* 规格 §12：seed 0x53324131（十进制 1395802417） */

  /* ---- RNG（mulberry32，固定种子；与 Python PCG64 不同属预期，规格 §9-B 已注） ---- */
  function mulberry32(a) {
    return function () {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /* ---- sRGB → OKLab（与 painting/sample-browser.js 同式） ---- */
  function srgbToLinear(c) {
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  }
  function oklabL(r, g, b) {
    var lr = srgbToLinear(r);
    var lg = srgbToLinear(g);
    var lb = srgbToLinear(b);
    var l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
    var m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
    var s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;
    l = Math.cbrt(l);
    m = Math.cbrt(m);
    s = Math.cbrt(s);
    return 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
  }
  function oklabFull(r, g, b, out) {
    var lr = srgbToLinear(r);
    var lg = srgbToLinear(g);
    var lb = srgbToLinear(b);
    var l = 0.4122214708 * lr + 0.5363325363 * lg + 0.0514459929 * lb;
    var m = 0.2119034982 * lr + 0.6806995451 * lg + 0.1073969566 * lb;
    var s = 0.0883024619 * lr + 0.2817188376 * lg + 0.6299787005 * lb;
    l = Math.cbrt(l);
    m = Math.cbrt(m);
    s = Math.cbrt(s);
    out[0] = 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s;
    out[1] = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
    out[2] = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
    return out;
  }
  function oklabToHex(L, A, B2) {
    var l_ = L + 0.3963377774 * A + 0.2158037573 * B2;
    var m_ = L - 0.1055613458 * A - 0.0638541728 * B2;
    var s_ = L - 0.0894841775 * A - 1.291485548 * B2;
    var l = l_ * l_ * l_;
    var m = m_ * m_ * m_;
    var s = s_ * s_ * s_;
    var lr = +4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
    var lg = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
    var lb = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
    var out = "#";
    var ch = [lr, lg, lb];
    for (var i = 0; i < 3; i++) {
      var v = ch[i];
      if (v <= 0.0031308) v = v * 12.92;
      else v = 1.055 * Math.pow(Math.max(v, 0), 1 / 2.4) - 0.055;
      v = Math.round(Math.max(0, Math.min(1, v)) * 255);
      out += (v < 16 ? "0" : "") + v.toString(16);
    }
    return out;
  }

  function radialWeight(r) {
    return W_A + W_B * Math.exp(-W_K * r);
  }

  /* ---- ① 屏蔽场：合格像素 + 质心 + R95 ---- */
  function eligibleField(rgba, w, h, out) {
    var n = w * h;
    var xs = new Float64Array(n);
    var ys = new Float64Array(n);
    var rs = new Float64Array(n);
    var labs = new Float32Array(n * 3);
    var eligible = 0;
    var dark = 0;
    var i;
    var p;
    var a;
    var L;
    var tmp = [0, 0, 0];
    for (i = 0; i < n; i++) {
      p = i * 4;
      a = rgba[p + 3] / 255;
      if (a < ALPHA_CULL) {
        dark += 1;
        continue;
      }
      L = oklabL(rgba[p] / 255, rgba[p + 1] / 255, rgba[p + 2] / 255);
      if (L < DARK_L) {
        dark += 1;
        continue;
      }
      oklabFull(rgba[p] / 255, rgba[p + 1] / 255, rgba[p + 2] / 255, tmp);
      labs[eligible * 3] = tmp[0];
      labs[eligible * 3 + 1] = tmp[1];
      labs[eligible * 3 + 2] = tmp[2];
      xs[eligible] = ((i % w) + 0.5) / w;
      ys[eligible] = (((i / w) | 0) + 0.5) / h;
      eligible += 1;
    }
    if (eligible < 1) {
      out.err = "no eligible pixels";
      return out;
    }
    var cx = 0;
    var cy = 0;
    for (i = 0; i < eligible; i++) {
      cx += xs[i];
      cy += ys[i];
    }
    cx /= eligible;
    cy /= eligible;
    /* R95：合格像素到质心距离的 p95（线性插值分位，同 numpy.percentile 默认） */
    var dist = new Float64Array(eligible);
    for (i = 0; i < eligible; i++) {
      dist[i] = Math.hypot(xs[i] - cx, ys[i] - cy);
    }
    var sorted = Float64Array.from(dist);
    sorted.sort();
    var pos = 0.95 * (eligible - 1);
    var lo = Math.floor(pos);
    var hi = Math.min(eligible - 1, lo + 1);
    var r95 = sorted[lo] + (sorted[hi] - sorted[lo]) * (pos - lo);
    if (!(r95 > 1e-12)) r95 = 0.6;
    for (i = 0; i < eligible; i++) {
      var r = dist[i] / r95;
      rs[i] = r > 1 ? 1 : r;
    }
    out.xs = xs;
    out.ys = ys;
    out.rs = rs;
    out.labs = labs;
    out.eligible = eligible;
    out.cx = cx;
    out.cy = cy;
    out.r95 = r95;
    out.darkCullPct = (100 * dark) / n;
    return out;
  }

  /* ---- ② 候选：W(r) 拒绝采样 5×N（有放回）+ 固定种子置换 ---- */
  function candidates(field, target, rng) {
    var nCand = Math.round(target * CAND_RATIO);
    var nEl = field.eligible;
    var cx = new Float64Array(nCand);
    var cy = new Float64Array(nCand);
    var cw = new Float64Array(nCand);
    var idx = new Int32Array(nCand);
    var filled = 0;
    var draws = 0;
    var guard = nCand * 80;
    while (filled < nCand && draws < guard) {
      var k = (rng() * nEl) | 0;
      if (k >= nEl) k = nEl - 1;
      draws += 1;
      if (rng() < radialWeight(field.rs[k]) / WMAX) {
        cx[filled] = field.xs[k];
        cy[filled] = field.ys[k];
        idx[filled] = k;
        filled += 1;
      }
    }
    if (filled < nCand) {
      /* 兜底：把剩余槽用合格像素补齐（仍保持同分布口径的近似） */
      while (filled < nCand) {
        var k2 = (rng() * nEl) | 0;
        if (k2 >= nEl) k2 = nEl - 1;
        cx[filled] = field.xs[k2];
        cy[filled] = field.ys[k2];
        idx[filled] = k2;
        filled += 1;
      }
    }
    /* 候选权重 W（按候选自身半径，口径同参考 s2b：cand_w = W(cand_r)） */
    var i;
    for (i = 0; i < nCand; i++) {
      var r = Math.hypot(cx[i] - field.cx, cy[i] - field.cy) / field.r95;
      cw[i] = radialWeight(r > 1 ? 1 : r);
    }
    /* 置换 = 细化顺序（Fisher–Yates，同一 rng） */
    var order = new Int32Array(nCand);
    for (i = 0; i < nCand; i++) order[i] = i;
    for (i = nCand - 1; i > 0; i--) {
      var j = (rng() * (i + 1)) | 0;
      var t = order[i];
      order[i] = order[j];
      order[j] = t;
    }
    return { n: nCand, x: cx, y: cy, w: cw, order: order, srcIdx: idx, draws: draws };
  }

  /* ---- ③ 细化：dart-thinning（网格加速，cell = s_max） ---- */
  function dartThin(cand, s0, wPx, hPx) {
    var n = cand.n;
    var i;
    var px = new Float64Array(n);
    var py = new Float64Array(n);
    var rl = new Float64Array(n);
    var sMax = 0;
    for (i = 0; i < n; i++) {
      px[i] = cand.x[i] * wPx;
      py[i] = cand.y[i] * hPx;
      rl[i] = s0 * Math.sqrt(WMAX / Math.max(cand.w[i], 1e-9));
      if (rl[i] > sMax) sMax = rl[i];
    }
    if (!(sMax > 1e-12)) return [];
    var inv = 1 / sMax;
    /* 网格键用**整数**（gx·K+gy）而不是字符串拼接：字符串键在 25 万候选下是主要瓶颈 */
    var grid = new Map();
    var KSTRIDE = 1 << 20;
    var accX = [];
    var accY = [];
    var accI = [];
    for (var oi = 0; oi < n; oi++) {
      var i2 = cand.order[oi];
      var x = px[i2];
      var y = py[i2];
      var ri = rl[i2];
      var ri2 = ri * ri;
      var gx = Math.floor(x * inv);
      var gy = Math.floor(y * inv);
      var rad = Math.floor(ri * inv) + 1;
      var ok = true;
      for (var ox = -rad; ox <= rad && ok; ox++) {
        for (var oy = -rad; oy <= rad && ok; oy++) {
          var bucket = grid.get((gx + ox) * KSTRIDE + (gy + oy));
          if (!bucket) continue;
          for (var b = 0; b < bucket.length; b++) {
            var j = bucket[b];
            var dx = x - accX[j];
            var dy = y - accY[j];
            if (dx * dx + dy * dy < ri2) {
              ok = false;
              break;
            }
          }
        }
      }
      if (ok) {
        var key = gx * KSTRIDE + gy;
        var arr = grid.get(key);
        if (!arr) {
          arr = [];
          grid.set(key, arr);
        }
        arr.push(accI.length);
        accX.push(x);
        accY.push(y);
        accI.push(i2);
      }
    }
    return accI;
  }

  /* ---- ③ 校准：s0 二分到 目标 N（±2%，≤4 轮） ---- */
  function calibrate(cand, target, aMask, wPx, hPx, mode) {
    var s0 = S0_FACTOR * Math.sqrt(aMask / target);
    var rounds = [];
    var kept = dartThin(cand, s0, wPx, hPx);
    rounds.push({ s0: s0, accepted: kept.length });
    var tol = S0_TOL;
    if (mode === "fast") {
      return { s0: s0, kept: kept, rounds: rounds, mode: "fast" };
    }
    /* 夹逼区间（不变式：f(lo) ≥ target > f(hi)，f = 接受数，随 s0 单调不增）。
       各侧最多探 2 步（×2 / ÷2），随后二分 ≤4 轮、命中 ±2% 早停。 */
    var lo;
    var hi;
    var probe;
    var steps;
    if (kept.length > target) {
      lo = s0;
      hi = s0;
      probe = s0;
      steps = 0;
      while (steps < 2) {
        probe = probe * 2;
        hi = probe;
        kept = dartThin(cand, probe, wPx, hPx);
        rounds.push({ s0: probe, accepted: kept.length });
        steps += 1;
        if (kept.length <= target) break;
      }
      if (kept.length > target) {
        /* 仍太多：把当前点当 lo，hi 再放大一档（保证夹住） */
        lo = probe;
        hi = probe * 2;
      }
    } else {
      hi = s0;
      lo = s0;
      probe = s0;
      steps = 0;
      while (steps < 2) {
        probe = probe / 2;
        lo = probe;
        kept = dartThin(cand, probe, wPx, hPx);
        rounds.push({ s0: probe, accepted: kept.length });
        steps += 1;
        if (kept.length >= target) break;
      }
      if (kept.length < target) {
        hi = probe;
        lo = probe / 2;
      }
    }
    /* 二分（≤4 轮，命中 ±2% 即早停） */
    var r = 0;
    while (r < S0_MAX_ROUNDS) {
      var mid = (lo + hi) / 2;
      var kMid = dartThin(cand, mid, wPx, hPx);
      rounds.push({ s0: mid, accepted: kMid.length });
      var rel = Math.abs(kMid.length - target) / target;
      if (rel <= tol) {
        return { s0: mid, kept: kMid, rounds: rounds, mode: "full" };
      }
      if (kMid.length > target) lo = mid;
      else hi = mid;
      r += 1;
    }
    var best = dartThin(cand, (lo + hi) / 2, wPx, hPx);
    return { s0: (lo + hi) / 2, kept: best, rounds: rounds, mode: "full" };
  }

  /* ---- ④ 调色板：OKLab 中位切分（复用 sample-browser.js 同款思路） ---- */
  function paletteOf(cand, kept, field, k, rng) {
    var sampleN = Math.min(cand.n, 32768);
    var cols = [];
    for (var i = 0; i < sampleN; i++) {
      var s = cand.srcIdx[(rng() * cand.n) | 0];
      cols.push([field.labs[s * 3], field.labs[s * 3 + 1], field.labs[s * 3 + 2], s]);
    }
    var centers = medianCut(cols, k);
    var palette = [];
    for (var c = 0; c < centers.length; c++) {
      palette.push(oklabToHex(centers[c][0], centers[c][1], centers[c][2]));
    }
    if (!palette.length) palette.push("#808080");
    return { palette: palette, centers: centers };
  }

  function medianCut(cols, k) {
    var boxes = [cols];
    while (boxes.length < k) {
      var bi = -1;
      var bestRange = -1;
      for (var i = 0; i < boxes.length; i++) {
        var b = boxes[i];
        if (b.length < 2) continue;
        var mn = [Infinity, Infinity, Infinity];
        var mx = [-Infinity, -Infinity, -Infinity];
        for (var j = 0; j < b.length; j++) {
          for (var c = 0; c < 3; c++) {
            if (b[j][c] < mn[c]) mn[c] = b[j][c];
            if (b[j][c] > mx[c]) mx[c] = b[j][c];
          }
        }
        var range = Math.max(mx[0] - mn[0], mx[1] - mn[1], mx[2] - mn[2]);
        if (range > bestRange) {
          bestRange = range;
          bi = i;
        }
      }
      if (bi < 0) break;
      var box = boxes[bi];
      var mn2 = [Infinity, Infinity, Infinity];
      var mx2 = [-Infinity, -Infinity, -Infinity];
      for (var q = 0; q < box.length; q++) {
        for (var c2 = 0; c2 < 3; c2++) {
          if (box[q][c2] < mn2[c2]) mn2[c2] = box[q][c2];
          if (box[q][c2] > mx2[c2]) mx2[c2] = box[q][c2];
        }
      }
      var dim = 0;
      var dr = mx2[0] - mn2[0];
      if (mx2[1] - mn2[1] > dr) {
        dim = 1;
        dr = mx2[1] - mn2[1];
      }
      if (mx2[2] - mn2[2] > dr) dim = 2;
      box.sort(function (p, q2) {
        return p[dim] - q2[dim];
      });
      var half = box.length >> 1;
      boxes.splice(bi, 1, box.slice(0, half), box.slice(half));
    }
    var out = [];
    for (var b2 = 0; b2 < boxes.length; b2++) {
      var bb = boxes[b2];
      if (!bb.length) continue;
      var s = [0, 0, 0];
      for (var m = 0; m < bb.length; m++) {
        s[0] += bb[m][0];
        s[1] += bb[m][1];
        s[2] += bb[m][2];
      }
      out.push([s[0] / bb.length, s[1] / bb.length, s[2] / bb.length]);
    }
    return out;
  }

  function nearestPalette(centers, L, A, B2) {
    var best = 0;
    var bestD = Infinity;
    for (var i = 0; i < centers.length; i++) {
      var dl = L - centers[i][0];
      var da = A - centers[i][1];
      var db = B2 - centers[i][2];
      var d = dl * dl + da * da + db * db;
      if (d < bestD) {
        bestD = d;
        best = i;
      }
    }
    return best;
  }

  /* ---- 主流程 ---- */
  function runSampler(input, opts) {
    opts = opts || {};
    var t0 = Date.now();
    var onp = typeof opts.onProgress === "function" ? opts.onProgress : null;
    function stage(name, pct) {
      if (onp) onp(name, pct);
    }
    var w = input.width | 0;
    var h = input.height | 0;
    var target = Math.max(1, opts.count | 0);
    var k = Math.max(2, Math.min(256, opts.palette | 0 || PAL_K_DEFAULT));
    var mode = opts.mode === "fast" ? "fast" : "full";
    var rng = mulberry32(opts.seed == null ? SEED : opts.seed >>> 0);
    stage("mask", 2);
    var field = eligibleField(input.rgba, w, h, {});
    if (field.err) throw new Error(field.err);
    stage("mask", 12);
    var tMask = Date.now();
    var cand = candidates(field, target, rng);
    stage("cand", 18);
    var tCand = Date.now();
    var cal = calibrate(cand, target, field.eligible, w, h, mode);
    stage("thin", 88);
    var tThin = Date.now();
    var pal = paletteOf(cand, cal.kept, field, k, rng);
    stage("palette", 96);
    var tPal = Date.now();

    var kept = cal.kept;
    var points = [];
    var i;
    for (i = 0; i < kept.length; i++) {
      var ci = cand.srcIdx[kept[i]];
      var L = field.labs[ci * 3];
      var A = field.labs[ci * 3 + 1];
      var B2 = field.labs[ci * 3 + 2];
      points.push({ x: cand.x[kept[i]], y: cand.y[kept[i]], i: nearestPalette(pal.centers, L, A, B2) });
    }
    /* count 拟合：多则截尾，少则尾部复制（同坐标同色，不可辨） */
    if (points.length > target) points = points.slice(0, target);
    var dupFrom = 0;
    while (points.length < target) {
      var src = points[dupFrom % Math.max(1, points.length)];
      points.push({ x: src.x, y: src.y, i: src.i });
      dupFrom += 1;
    }
    var t1 = Date.now();
    stage("done", 100);
    return {
      id: "upload-" + hash8(input.rgba, w, h),
      w: w,
      h: h,
      count: points.length,
      note: "upload · browser-sampled",
      palette: pal.palette,
      points: points,
      source: "upload",
      stats: {
        s0: cal.s0,
        r95: field.r95,
        darkCullPct: field.darkCullPct,
        eligibleN: field.eligible,
        candN: cand.n,
        rounds: cal.rounds.length,
        calib: cal.rounds,
        mode: mode,
        res: { w: w, h: h },
        ms: { mask: tMask - t0, cand: tCand - tMask, thin: tThin - tCand, palette: tPal - tThin, total: t1 - t0 },
        sampler: VERSION,
      },
    };
  }

  function hash8(buf, w, h) {
    /* 轻量指纹（非加密）：与规格的 sha256 前 8 位**不同**，仅用于会话内 id 区分；
       真机若需与导出产物对账，可在主线程用 crypto.subtle 覆盖。 */
    var hsh = 0x811c9dc5;
    var step = Math.max(1, ((buf.length / 4096) | 0) + 1);
    for (var i = 0; i < buf.length; i += step) {
      hsh ^= buf[i];
      hsh = Math.imul(hsh, 0x01000193);
    }
    hsh ^= w * 73856093;
    hsh ^= h * 19349663;
    var s = (hsh >>> 0).toString(16);
    while (s.length < 8) s = "0" + s;
    return s.slice(0, 8);
  }

  var api = { runSampler: runSampler, VERSION: VERSION, DARK_L: DARK_L, SEED: SEED };
  root.NFUploadSampler = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;

  /* ---- Worker 外壳 ---- */
  if (typeof self !== "undefined" && typeof self.postMessage === "function" && !self.__nfUploadNoWorker) {
    self.onmessage = function (e) {
      var m = e.data || {};
      if (m.type !== "sample") return;
      try {
        var o = {};
        var oo = m.opts || {};
        var kk;
        for (kk in oo) if (Object.prototype.hasOwnProperty.call(oo, kk)) o[kk] = oo[kk];
        o.onProgress = function (nm, pct) {
          self.postMessage({ type: "progress", id: m.id, stage: nm, pct: pct });
        };
        var rec = runSampler({ rgba: new Uint8ClampedArray(m.rgba), width: m.width, height: m.height }, o);
        self.postMessage({ type: "done", id: m.id, record: rec });
      } catch (err) {
        self.postMessage({ type: "error", id: m.id, message: String((err && err.message) || err) });
      }
    };
  }
})(typeof self !== "undefined" ? self : this);
