/**
 * NF radial physics for S3 (isolation only).
 *
 * Handbook §4: fixed h=1/60, k(r)/c(r) field, optional anisotropy,
 * Simplex drift (render-only), 64×64 @30Hz LUT, sleep, state gating.
 *
 * Does NOT replace live applySpring (0.055 / 0.90 / vmax 10 / C2 golden).
 * Do not load this from prototype/index.html unless a later gate wires a
 * default-off switch. This file is the isolated physics module.
 *
 * Clock: Gaffer accumulator + handbook 50ms clamp (not live 0.25s / MAX_STEPS=2).
 * k,c are 1/60-step coefficients. Never scale them by display dt.
 *
 * #5 settle: the handbook pair (k=0.10, c=0.92) is discrete-underdamped.
 * Default `criticalDamp` uses the unique c*(k)=1/(1+√k)² of THIS integrator
 * (discriminant of λ²−(1+c−ck)λ+c set to 0). Handbook c(r) stays as a switch.
 */
(function (root) {
  "use strict";

  var H = 1 / 60;
  var DT_CLAMP = 0.05;
  var LUT_N = 64;
  var LUT_HZ = 30;
  var SLEEP_V = 0.05;
  var SLEEP_X = 0.5;
  var FS = 0.006;
  var FT = 0.05;
  var A_MAX = 5;
  var S_LO = 0.5;
  var S_HI = 0.88;
  var A_LO = 0.55;
  var A_HI = 0.92;
  var K0 = 0.1;
  var K_SPAN = 0.08;
  var C0 = 0.92;
  var C_SPAN = 0.14;
  var DELTA0 = 0.04;
  var ANISO_EPS = 1e-6;
  var PATH_OX = 37.2;
  var PATH_OY = 19.1;
  var PATH_OZ = 5.3;

  var SWITCH_DEFAULTS = {
    field: true,
    anisotropy: true,
    criticalDamp: true,
    drift: true,
    noiseLut: true,
    sleep: true,
    gating: true,
    interpolate: true,
    reducedMotion: false
  };

  var PHASE = {
    INTRO: "INTRO",
    HANDOVER: "HANDOVER",
    DWELL: "DWELL",
    REPEL: "REPEL"
  };

  var GRAD3 = [
    1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1, 0,
    1, 0, 1, -1, 0, 1, 1, 0, -1, -1, 0, -1,
    0, 1, 1, 0, -1, 1, 0, 1, -1, 0, -1, -1
  ];

  function clamp01(x) {
    if (x <= 0) return 0;
    if (x >= 1) return 1;
    return x;
  }

  function smoothstep(edge0, edge1, x) {
    var t = clamp01((x - edge0) / (edge1 - edge0));
    return t * t * (3 - 2 * t);
  }

  function kOfS(s) {
    return K0 - K_SPAN * s;
  }

  function cOfS(s) {
    return C0 - C_SPAN * s;
  }

  /** Discrete-critical multiplier for v←(v+k·(T−x))·c at one fixed step. */
  function cCrit(k) {
    if (!(k > 0)) return 1;
    var s = Math.sqrt(k);
    return 1 / ((1 + s) * (1 + s));
  }

  function discKc(k, c) {
    var tr = 1 + c - c * k;
    return tr * tr - 4 * c;
  }

  function aOfR(r) {
    return A_MAX * smoothstep(A_LO, A_HI, r);
  }

  function mergeSwitches(src) {
    var out = {};
    var key;
    for (key in SWITCH_DEFAULTS) {
      if (Object.prototype.hasOwnProperty.call(SWITCH_DEFAULTS, key)) {
        out[key] = SWITCH_DEFAULTS[key];
      }
    }
    if (src) {
      for (key in SWITCH_DEFAULTS) {
        if (Object.prototype.hasOwnProperty.call(src, key) && src[key] != null) {
          out[key] = !!src[key];
        }
      }
    }
    return out;
  }

  function mulberry32(seed) {
    var a = seed >>> 0;
    return function rand() {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      var t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  /**
   * 3D simplex after Gustavson 2005 / public-domain SimplexNoise1234 (2011).
   * Seed only shuffles the permutation; lattice math is fixed.
   */
  function makeSimplex(seed) {
    var rand = mulberry32(seed);
    var p = new Uint8Array(256);
    var perm = new Uint16Array(512);
    var perm12 = new Uint16Array(512);
    var i;
    var j;
    var tmp;
    for (i = 0; i < 256; i++) p[i] = i;
    for (i = 255; i > 0; i--) {
      j = (rand() * (i + 1)) | 0;
      tmp = p[i];
      p[i] = p[j];
      p[j] = tmp;
    }
    for (i = 0; i < 512; i++) {
      perm[i] = p[i & 255];
      perm12[i] = perm[i] % 12;
    }

    function noise3(xin, yin, zin) {
      var F3 = 1 / 3;
      var G3 = 1 / 6;
      var s = (xin + yin + zin) * F3;
      var i = Math.floor(xin + s);
      var j = Math.floor(yin + s);
      var k = Math.floor(zin + s);
      var t = (i + j + k) * G3;
      var x0 = xin - (i - t);
      var y0 = yin - (j - t);
      var z0 = zin - (k - t);
      var i1;
      var j1;
      var k1;
      var i2;
      var j2;
      var k2;
      if (x0 >= y0) {
        if (y0 >= z0) {
          i1 = 1;
          j1 = 0;
          k1 = 0;
          i2 = 1;
          j2 = 1;
          k2 = 0;
        } else if (x0 >= z0) {
          i1 = 1;
          j1 = 0;
          k1 = 0;
          i2 = 1;
          j2 = 0;
          k2 = 1;
        } else {
          i1 = 0;
          j1 = 0;
          k1 = 1;
          i2 = 1;
          j2 = 0;
          k2 = 1;
        }
      } else if (y0 < z0) {
        i1 = 0;
        j1 = 0;
        k1 = 1;
        i2 = 0;
        j2 = 1;
        k2 = 1;
      } else if (x0 < z0) {
        i1 = 0;
        j1 = 1;
        k1 = 0;
        i2 = 0;
        j2 = 1;
        k2 = 1;
      } else {
        i1 = 0;
        j1 = 1;
        k1 = 0;
        i2 = 1;
        j2 = 1;
        k2 = 0;
      }
      var x1 = x0 - i1 + G3;
      var y1 = y0 - j1 + G3;
      var z1 = z0 - k1 + G3;
      var x2 = x0 - i2 + 2 * G3;
      var y2 = y0 - j2 + 2 * G3;
      var z2 = z0 - k2 + 2 * G3;
      var x3 = x0 - 1 + 3 * G3;
      var y3 = y0 - 1 + 3 * G3;
      var z3 = z0 - 1 + 3 * G3;
      var ii = i & 255;
      var jj = j & 255;
      var kk = k & 255;

      function contrib(x, y, z, gi) {
        var tt = 0.6 - x * x - y * y - z * z;
        var g;
        if (tt < 0) return 0;
        tt *= tt;
        g = perm12[gi] * 3;
        return tt * tt * (GRAD3[g] * x + GRAD3[g + 1] * y + GRAD3[g + 2] * z);
      }

      var n0 = contrib(x0, y0, z0, ii + perm[jj + perm[kk]]);
      var n1 = contrib(x1, y1, z1, ii + i1 + perm[jj + j1 + perm[kk + k1]]);
      var n2 = contrib(x2, y2, z2, ii + i2 + perm[jj + j2 + perm[kk + k2]]);
      var n3 = contrib(x3, y3, z3, ii + 1 + perm[jj + 1 + perm[kk + 1]]);
      return 32 * (n0 + n1 + n2 + n3);
    }

    return { noise3: noise3 };
  }

  function copyInto(dst, src, n) {
    var i;
    if (!src) return;
    for (i = 0; i < n; i++) dst[i] = src[i];
  }

  function createWorld(opts) {
    opts = opts || {};
    var n = opts.n | 0;
    if (n <= 0) throw new Error("NFRadialPhysics.createWorld: n > 0 required");
    var width = opts.width;
    var height = opts.height;
    if (!(width > 0) || !(height > 0)) {
      throw new Error("NFRadialPhysics.createWorld: width/height required");
    }
    var cx = opts.cx;
    var cy = opts.cy;
    var r95 = opts.R95;
    if (!(r95 > 0)) throw new Error("NFRadialPhysics.createWorld: R95 required");
    var seed = opts.seed == null ? 0x53335033 : opts.seed >>> 0;
    var sw = mergeSwitches(opts.switches);
    var phase = opts.phase || PHASE.DWELL;
    var i;

    var x = new Float64Array(n);
    var y = new Float64Array(n);
    var vx = new Float64Array(n);
    var vy = new Float64Array(n);
    var tx = new Float64Array(n);
    var ty = new Float64Array(n);
    var rr = new Float64Array(n);
    var asleep = new Uint8Array(n);
    var prevX = new Float64Array(n);
    var prevY = new Float64Array(n);
    var simplex = makeSimplex(seed);
    var lutDx = new Float64Array(LUT_N * LUT_N);
    var lutDy = new Float64Array(LUT_N * LUT_N);
    var lutSlice = -1;
    var acc = 0;
    var time = 0;

    copyInto(tx, opts.tx, n);
    copyInto(ty, opts.ty, n);
    copyInto(x, opts.x, n);
    copyInto(y, opts.y, n);
    copyInto(vx, opts.vx, n);
    copyInto(vy, opts.vy, n);
    if (!opts.x) {
      for (i = 0; i < n; i++) x[i] = tx[i];
    }
    if (!opts.y) {
      for (i = 0; i < n; i++) y[i] = ty[i];
    }
    prevX.set(x);
    prevY.set(y);

    function refreshR() {
      var k;
      var nx;
      var ny;
      var d;
      var v;
      for (k = 0; k < n; k++) {
        nx = tx[k] / width;
        ny = ty[k] / height;
        d = Math.hypot(nx - cx, ny - cy);
        v = d / r95;
        if (v < 0) v = 0;
        if (v > 1) v = 1;
        rr[k] = v;
      }
    }

    refreshR();

    function gateMul() {
      if (sw.reducedMotion) return 0;
      if (!sw.gating) return 1;
      if (phase === PHASE.INTRO || phase === PHASE.HANDOVER) return 0;
      if (phase === PHASE.REPEL) return 0.5;
      return 1;
    }

    function phaseWakes() {
      return phase === PHASE.INTRO || phase === PHASE.HANDOVER || phase === PHASE.REPEL;
    }

    function rebuildLut(tLut) {
      var gi;
      var gj;
      var px;
      var py;
      var o;
      for (gj = 0; gj < LUT_N; gj++) {
        py = ((gj + 0.5) / LUT_N) * height;
        for (gi = 0; gi < LUT_N; gi++) {
          px = ((gi + 0.5) / LUT_N) * width;
          o = gj * LUT_N + gi;
          lutDx[o] = simplex.noise3(px * FS, py * FS, tLut * FT);
          lutDy[o] = simplex.noise3(px * FS + PATH_OX, py * FS + PATH_OY, tLut * FT + PATH_OZ);
        }
      }
    }

    function maybeRebuildLut() {
      var slice = Math.floor(time * LUT_HZ + 1e-12);
      if (slice === lutSlice) return;
      lutSlice = slice;
      rebuildLut(slice / LUT_HZ);
    }

    function lutSample(lut, px, py) {
      var u = (px / width) * LUT_N - 0.5;
      var v = (py / height) * LUT_N - 0.5;
      var x0;
      var y0;
      var x1;
      var y1;
      var fu;
      var fv;
      var a;
      var b;
      var c;
      var d;
      if (u < 0) u = 0;
      if (v < 0) v = 0;
      if (u > LUT_N - 1) u = LUT_N - 1;
      if (v > LUT_N - 1) v = LUT_N - 1;
      x0 = Math.floor(u);
      y0 = Math.floor(v);
      x1 = x0 + 1;
      y1 = y0 + 1;
      if (x1 > LUT_N - 1) x1 = LUT_N - 1;
      if (y1 > LUT_N - 1) y1 = LUT_N - 1;
      fu = u - x0;
      fv = v - y0;
      a = lut[y0 * LUT_N + x0];
      b = lut[y0 * LUT_N + x1];
      c = lut[y1 * LUT_N + x0];
      d = lut[y1 * LUT_N + x1];
      return a * (1 - fu) * (1 - fv) + b * fu * (1 - fv) + c * (1 - fu) * fv + d * fu * fv;
    }

    function sampleNoise(px, py) {
      if (sw.noiseLut) {
        maybeRebuildLut();
        return [lutSample(lutDx, px, py), lutSample(lutDy, px, py)];
      }
      return [
        simplex.noise3(px * FS, py * FS, time * FT),
        simplex.noise3(px * FS + PATH_OX, py * FS + PATH_OY, time * FT + PATH_OZ)
      ];
    }

    function driftAt(px, py, rVal) {
      var amp;
      var ns;
      if (!sw.drift || sw.reducedMotion) return [0, 0];
      amp = aOfR(rVal) * gateMul();
      if (amp === 0) return [0, 0];
      ns = sampleNoise(px, py);
      return [amp * ns[0], amp * ns[1]];
    }

    function stepParticle(idx) {
      var S;
      var k;
      var c;
      var dx;
      var dy;
      var rx;
      var ry;
      var rl;
      var vrad;
      var vtx;
      var vty;
      var delta;
      var cr;
      var ct;
      var spd;
      if (sw.reducedMotion) return;
      if (phaseWakes()) asleep[idx] = 0;
      if (sw.sleep && asleep[idx]) {
        dx = tx[idx] - x[idx];
        dy = ty[idx] - y[idx];
        if (dx * dx + dy * dy < SLEEP_X * SLEEP_X) return;
        asleep[idx] = 0;
      }

      S = smoothstep(S_LO, S_HI, rr[idx]);
      if (sw.field) {
        k = kOfS(S);
        c = cOfS(S);
      } else {
        k = K0;
        c = C0;
      }
      if (sw.criticalDamp) c = cCrit(k);

      vx[idx] += (tx[idx] - x[idx]) * k;
      vy[idx] += (ty[idx] - y[idx]) * k;

      if (sw.anisotropy) {
        rx = x[idx] - cx * width;
        ry = y[idx] - cy * height;
        rl = Math.hypot(rx, ry);
        if (rl > ANISO_EPS) {
          rx /= rl;
          ry /= rl;
          vrad = vx[idx] * rx + vy[idx] * ry;
          vtx = vx[idx] - vrad * rx;
          vty = vy[idx] - vrad * ry;
          delta = DELTA0 * S;
          cr = c + delta;
          ct = c - delta;
          if (sw.criticalDamp) {
            var cc = cCrit(k);
            if (cr > cc) cr = cc;
            if (ct > cc) ct = cc;
          }
          vx[idx] = vrad * rx * cr + vtx * ct;
          vy[idx] = vrad * ry * cr + vty * ct;
        } else {
          vx[idx] *= c;
          vy[idx] *= c;
        }
      } else {
        vx[idx] *= c;
        vy[idx] *= c;
      }

      x[idx] += vx[idx];
      y[idx] += vy[idx];

      if (sw.sleep) {
        dx = tx[idx] - x[idx];
        dy = ty[idx] - y[idx];
        spd = Math.hypot(vx[idx], vy[idx]);
        if (spd < SLEEP_V && dx * dx + dy * dy < SLEEP_X * SLEEP_X) {
          asleep[idx] = 1;
          vx[idx] = 0;
          vy[idx] = 0;
        }
      }
    }

    function stepFixed() {
      var idx;
      prevX.set(x);
      prevY.set(y);
      for (idx = 0; idx < n; idx++) stepParticle(idx);
      time += H;
    }

    function drain(frameTime) {
      var ft = frameTime;
      var steps = 0;
      if (sw.reducedMotion) return 0;
      if (ft > DT_CLAMP) ft = DT_CLAMP;
      if (ft < 0) ft = 0;
      acc += ft;
      while (acc >= H) {
        stepFixed();
        acc -= H;
        steps += 1;
      }
      return steps;
    }

    function alpha() {
      return acc / H;
    }

    function renderXY(idx, out) {
      var a;
      var px;
      var py;
      var dlt;
      if (sw.reducedMotion) {
        out[0] = x[idx];
        out[1] = y[idx];
        return out;
      }
      if (sw.interpolate) {
        a = alpha();
        px = prevX[idx] * (1 - a) + x[idx] * a;
        py = prevY[idx] * (1 - a) + y[idx] * a;
      } else {
        px = x[idx];
        py = y[idx];
      }
      dlt = driftAt(px, py, rr[idx]);
      out[0] = px + dlt[0];
      out[1] = py + dlt[1];
      return out;
    }

    function driftXY(idx, out) {
      var dlt = driftAt(x[idx], y[idx], rr[idx]);
      out[0] = dlt[0];
      out[1] = dlt[1];
      return out;
    }

    function setPhase(next) {
      phase = next;
      if (phaseWakes()) {
        asleep.fill(0);
      }
    }

    function wakeAll() {
      asleep.fill(0);
    }

    function snapshotPhysics() {
      var buf = new Float64Array(n * 4);
      var k;
      for (k = 0; k < n; k++) {
        buf[k * 4] = x[k];
        buf[k * 4 + 1] = y[k];
        buf[k * 4 + 2] = vx[k];
        buf[k * 4 + 3] = vy[k];
      }
      return buf;
    }

    function snapshotRender() {
      var buf = new Float64Array(n * 2);
      var tmp = [0, 0];
      var k;
      for (k = 0; k < n; k++) {
        renderXY(k, tmp);
        buf[k * 2] = tmp[0];
        buf[k * 2 + 1] = tmp[1];
      }
      return buf;
    }

    return {
      n: n,
      width: width,
      height: height,
      cx: cx,
      cy: cy,
      R95: r95,
      seed: seed,
      switches: sw,
      x: x,
      y: y,
      vx: vx,
      vy: vy,
      tx: tx,
      ty: ty,
      r: rr,
      asleep: asleep,
      prevX: prevX,
      prevY: prevY,
      get phase() {
        return phase;
      },
      get time() {
        return time;
      },
      get acc() {
        return acc;
      },
      setPhase: setPhase,
      wakeAll: wakeAll,
      refreshR: refreshR,
      stepFixed: stepFixed,
      drain: drain,
      alpha: alpha,
      renderXY: renderXY,
      driftXY: driftXY,
      snapshotPhysics: snapshotPhysics,
      snapshotRender: snapshotRender,
      simplex: simplex
    };
  }

  var api = {
    H: H,
    DT_CLAMP: DT_CLAMP,
    LUT_N: LUT_N,
    LUT_HZ: LUT_HZ,
    SLEEP_V: SLEEP_V,
    SLEEP_X: SLEEP_X,
    FS: FS,
    FT: FT,
    A_MAX: A_MAX,
    SWITCH_DEFAULTS: SWITCH_DEFAULTS,
    PHASE: PHASE,
    clamp01: clamp01,
    smoothstep: smoothstep,
    kOfS: kOfS,
    cOfS: cOfS,
    cCrit: cCrit,
    discKc: discKc,
    aOfR: aOfR,
    mergeSwitches: mergeSwitches,
    makeSimplex: makeSimplex,
    createWorld: createWorld
  };

  root.NFRadialPhysics = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
