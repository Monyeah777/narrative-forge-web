/**
 * NF radial physics (S3 isolation + live Pixi wire).
 *
 * Handbook §4: fixed h=1/60, k(r)/c(r) field, optional anisotropy,
 * Simplex drift (render-only), 64×64 @30Hz LUT, sleep, state gating.
 *
 * Isolation defaults are unchanged. Optional `normX`/`normY` (or setNorm)
 * let live compute r in painting-normalized 0–1 while x/T stay CSS pixels.
 * Without those arrays, r still uses tx/width and ty/height (S3 hashes).
 *
 * Live: prototype/index.html loads this when radial is on (default).
 * Rollback `?radial=0` keeps applySpring 0.055 / 100k bins / C2 golden.
 * Do not load nf-radial-render.js on the live path (S4 over budget; E off).
 *
 * Clock: Gaffer accumulator + handbook 50ms clamp (not live 0.25s / MAX_STEPS=2).
 * k,c are 1/60-step coefficients. Never scale them by display dt.
 *
 * #5 settle: the handbook pair (k=0.10, c=0.92) is discrete-underdamped.
 * Default `criticalDamp` uses the unique c*(k)=1/(1+√k)² of THIS integrator
 * (discriminant of λ²−(1+c−ck)λ+c set to 0). Handbook c(r) stays as a switch.
 *
 * Live may also set `handbookShape`: keep c*(k) at the stiff center (no
 * oscillation) and scale it by handbook c(r)/c(0) so the edge is overdamped
 * the way §4 wrote. Isolation default is off so S3 hashes stay put.
 *
 * v3.0 modules 6–9 (isolation default off; live `?morph=0` rollback):
 *   lifecycle  Reeves 1983 gen/dynamics/death; τ∈[40,120], fade-in 0.6s / last 20%
 *   recycle    intensity≤0.01 or leave r>1.25·R95 → reuse slot (N const); F5 birth
 *   boundaryQ  Q=smoothstep(0.82,0.98); kill outgoing radial·Q + β_max=8px/s inward
 *   ripple     M0 u=A·Wb·sin(2πt/T−2πr/λ+φ0); v_φ=λ/T (OpenStax 16.1); V3=V1+V2
 *   streak     M3 streakline = dye from a fixed point (Cambridge MDP / MIT 16);
 *              radial U0=5px/s + Bridson 2007 2D v=(∂ψ/∂y,−∂ψ/∂x); two crossed ψ
 */
(function (root) {
  "use strict";

  var H = 1 / 60;
  var DT_CLAMP = 0.05;
  var LUT_N = 64;
  var LUT_HZ = 30;
  var FIL_LUT_HZ = 1;
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
  var LIFE_IN = 0.6;
  var LIFE_TAU0 = 40;
  var LIFE_TAU1 = 80;
  var LIFE_OUT = 0.2;
  var RECYCLE_A = 0.01;
  var RECYCLE_R = 1.25;
  var Q_LO = 0.82;
  var Q_HI = 0.98;
  var BETA_MAX = 8;
  var RIPPLE_L = 56;
  var RIPPLE_T = 8;
  var RIPPLE_A = 0.005;
  var WB_LO = 0.1;
  var WB_HI = 0.35;
  var V2_AMP = 0.03;
  var STREAK_U0 = 5;
  var STREAK_WE_LO = 0.72;
  var STREAK_WE_HI = 0.92;
  var STREAK_R_CUT = 1.05;
  var STREAK_FIL = 0.4;
  var FIL_S0 = 140;
  var FIL_S1 = 90;
  var COS60 = 0.5;
  var SIN60 = 0.8660254037844386;
  var RAMP_A = 2;
  var RAMP_B = 8;
  var BIRTH_IN = 0.08;
  var TWO_PI = Math.PI * 2;
  var SIN_N = 2048;
  var SIN_LUT = new Float64Array(SIN_N);
  (function fillSin() {
    var i;
    for (i = 0; i < SIN_N; i++) SIN_LUT[i] = Math.sin(TWO_PI * i / SIN_N);
  })();

  function sinTurn(phase) {
    var t = phase / TWO_PI;
    t -= Math.floor(t);
    if (t < 0) t += 1;
    return SIN_LUT[(t * SIN_N) | 0];
  }

  var SWITCH_DEFAULTS = {
    field: true,
    anisotropy: true,
    criticalDamp: true,
    handbookShape: false,
    drift: true,
    noiseLut: true,
    sleep: true,
    gating: true,
    interpolate: true,
    reducedMotion: false,
    lifecycle: false,
    recycle: false,
    boundaryQ: false,
    ripple: false,
    streak: false
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

  /**
   * Handbook c(r) as a shape on top of discrete-critical.
   * Center (S=0): c = c*(k) — unique non-oscillating pair.
   * Edge: extra overdamp toward c_handbook(S)/c_handbook(0).
   * Full shape (blend=1) sleeps the edge at 1.62s and misses §8#5 (≤1.5s).
   * SHAPE_BLEND=0.85 is the largest mix that still meets that budget (~1.47s).
   * Chou 2015 / Hallauer: do not paste the underdamped (k,c) pair verbatim.
   */
  var SHAPE_BLEND = 0.85;
  function cShaped(k, S) {
    var crit = cCrit(k);
    var shape = cOfS(S) / C0;
    if (shape < 0) shape = 0;
    if (shape > 1) shape = 1;
    return crit * (1 - SHAPE_BLEND + SHAPE_BLEND * shape);
  }

  function discKc(k, c) {
    var tr = 1 + c - c * k;
    return tr * tr - 4 * c;
  }

  function aOfR(r) {
    return A_MAX * smoothstep(A_LO, A_HI, r);
  }

  function lifeEnvelope(age, tau) {
    if (age <= 0) return 0;
    if (age < LIFE_IN) return age / LIFE_IN;
    if (!(tau > LIFE_IN)) return 1;
    if (age >= tau) return 0;
    var outStart = tau * (1 - LIFE_OUT);
    if (age > outStart) return (tau - age) / (tau * LIFE_OUT);
    return 1;
  }

  function dwellRamp(t) {
    if (t <= 0) return 0;
    if (t < RAMP_A) return 0.4 * (t / RAMP_A);
    if (t < RAMP_B) return 0.4 + 0.6 * (t - RAMP_A) / (RAMP_B - RAMP_A);
    return 1;
  }

  function qOfR(r) {
    return smoothstep(Q_LO, Q_HI, r);
  }

  function weOfR(rVal) {
    if (rVal < STREAK_WE_LO) return 0;
    if (rVal > STREAK_R_CUT) return 0;
    return smoothstep(STREAK_WE_LO, STREAK_WE_HI, rVal) * (1 - smoothstep(1, STREAK_R_CUT, rVal));
  }

  function ripplePhase(rPx, t, phi0) {
    return TWO_PI * t / RIPPLE_T - TWO_PI * rPx / RIPPLE_L + phi0;
  }

  /** Radial displacement (px). A=0.5% of local radius; Wb protects the tree. */
  function rippleDisp(rPx, rNorm, t, phi0, ramp) {
    var wb = smoothstep(WB_LO, WB_HI, rNorm);
    return RIPPLE_A * rPx * wb * sinTurn(ripplePhase(rPx, t, phi0)) * ramp;
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
    var rPix = new Float64Array(n);
    var urx = new Float64Array(n);
    var ury = new Float64Array(n);
    var wb = new Float64Array(n);
    var asleep = new Uint8Array(n);
    var prevX = new Float64Array(n);
    var prevY = new Float64Array(n);
    var lifeAge = new Float64Array(n);
    var lifeTau = new Float64Array(n);
    var lifeA = new Float64Array(n);
    var escX = new Float64Array(n);
    var escY = new Float64Array(n);
    var simplex = makeSimplex(seed);
    var lutDx = new Float64Array(LUT_N * LUT_N);
    var lutDy = new Float64Array(LUT_N * LUT_N);
    var lutFilX = new Float64Array(LUT_N * LUT_N);
    var lutFilY = new Float64Array(LUT_N * LUT_N);
    var lutPsi = new Float64Array(LUT_N * LUT_N);
    var tintA = new Float64Array(n);
    var lutSlice = -1;
    var acc = 0;
    var time = 0;
    var dwellT0 = 0;
    var rampCache = 0;
    var tintClock = 0;
    var cxW = cx * width;
    var cyH = cy * height;
    var lifeRng = mulberry32(seed ^ 0x4c494645);
    var phi0 = TWO_PI * mulberry32(seed ^ 0x4d302020)();
    var hold;
    for (i = 0; i < n; i++) {
      lifeTau[i] = LIFE_TAU0 + lifeRng() * LIFE_TAU1;
      hold = Math.max(0.01, lifeTau[i] * (1 - LIFE_OUT) - LIFE_IN);
      lifeAge[i] = LIFE_IN + 0.15 * hold + lifeRng() * 0.35 * hold;
      lifeA[i] = 1;
      tintA[i] = 1;
    }

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

    var normX = opts.normX || null;
    var normY = opts.normY || null;

    function refreshR() {
      var k;
      var nx;
      var ny;
      var d;
      var v;
      var dx;
      var dy;
      var rp;
      var useNorm = !!(normX && normY);
      for (k = 0; k < n; k++) {
        if (useNorm) {
          nx = normX[k];
          ny = normY[k];
          d = Math.hypot(nx - 0.5, ny - 0.5);
        } else {
          nx = tx[k] / width;
          ny = ty[k] / height;
          d = Math.hypot(nx - cx, ny - cy);
        }
        v = d / r95;
        if (v < 0) v = 0;
        if (v > 1) v = 1;
        rr[k] = v;
        dx = tx[k] - cxW;
        dy = ty[k] - cyH;
        rp = Math.hypot(dx, dy);
        rPix[k] = rp;
        if (rp > ANISO_EPS) {
          urx[k] = dx / rp;
          ury[k] = dy / rp;
        } else {
          urx[k] = 0;
          ury[k] = 0;
        }
        wb[k] = smoothstep(WB_LO, WB_HI, v);
      }
    }

    function setNorm(nextX, nextY) {
      normX = nextX || null;
      normY = nextY || null;
      refreshR();
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

    /**
     * Two crossed slow potentials (80–160px, T>10s) then one curl.
     * Bridson 2007 §2.1: 2D v=(∂ψ/∂y, −∂ψ/∂x) so ∇·v=0 (no gutters).
     */
    function psiAt(px, py, tLut) {
      var rx = px * COS60 + py * SIN60;
      var ry = -px * SIN60 + py * COS60;
      return (
        simplex.noise3(px / FIL_S0, py / FIL_S0, tLut / 16) +
        0.45 * simplex.noise3(px / FIL_S1 + 9.2, py / FIL_S1, tLut / 20) +
        simplex.noise3(rx / FIL_S0 + 17.4, ry / FIL_S0, tLut / 17) +
        0.45 * simplex.noise3(rx / FIL_S1 + 3.7, ry / FIL_S1, tLut / 21)
      );
    }

    function rebuildDriftLut(tLut) {
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

    /* == BATCH2-STREAK == F-05：FIL LUT 由「单帧整表重建」改为「分 4 步摊销」。
       实测单次重建 ~0.28ms、1Hz 出现，是其周期尖峰的来源；摊销后压到 ~0.07ms/步。
       psi 全表填完才重算梯度，避免同一张栅格里混两个时相。 */
    var FIL_BUILD_ROWS = 16;
    var filBuildRow = LUT_N;
    var filBuildSlice = -1;
    var filBuildPhase = 0;

    function fillFilPsiRows(rowFrom, rowTo, tLut) {
      var gi;
      var gj;
      var px;
      var py;
      for (gj = rowFrom; gj < rowTo; gj++) {
        py = ((gj + 0.5) / LUT_N) * height;
        for (gi = 0; gi < LUT_N; gi++) {
          px = ((gi + 0.5) / LUT_N) * width;
          lutPsi[gj * LUT_N + gi] = psiAt(px, py, tLut);
        }
      }
    }

    function fillFilGradients() {
      var gi;
      var gj;
      var o;
      var il;
      var ir;
      var jb;
      var jt;
      var dx;
      var dy;
      var cellX = width / LUT_N;
      var cellY = height / LUT_N;
      for (gj = 0; gj < LUT_N; gj++) {
        for (gi = 0; gi < LUT_N; gi++) {
          o = gj * LUT_N + gi;
          il = gi > 0 ? gi - 1 : gi;
          ir = gi < LUT_N - 1 ? gi + 1 : gi;
          jb = gj > 0 ? gj - 1 : gj;
          jt = gj < LUT_N - 1 ? gj + 1 : gj;
          dx = (ir - il) * cellX;
          dy = (jt - jb) * cellY;
          if (dx < 1e-9) dx = cellX;
          if (dy < 1e-9) dy = cellY;
          lutFilX[o] = (lutPsi[jt * LUT_N + gi] - lutPsi[jb * LUT_N + gi]) / dy;
          lutFilY[o] = -(lutPsi[gj * LUT_N + ir] - lutPsi[gj * LUT_N + il]) / dx;
        }
      }
    }

    function advanceFilLut() {
      var filSlice = Math.floor(time * FIL_LUT_HZ + 1e-12);
      var to;
      if (filSlice !== filBuildSlice) {
        filBuildSlice = filSlice;
        filBuildRow = 0;
        filBuildPhase = 0;
      }
      if (filBuildPhase === 0) {
        to = filBuildRow + FIL_BUILD_ROWS;
        if (to > LUT_N) to = LUT_N;
        fillFilPsiRows(filBuildRow, to, filBuildSlice / FIL_LUT_HZ);
        filBuildRow = to;
        if (filBuildRow >= LUT_N) filBuildPhase = 1;
        return;
      }
      if (filBuildPhase === 1) {
        fillFilGradients();
        filBuildPhase = 2;
      }
    }

    function maybeRebuildLut() {
      var slice = Math.floor(time * LUT_HZ + 1e-12);
      if (slice !== lutSlice) {
        lutSlice = slice;
        rebuildDriftLut(slice / LUT_HZ);
      }
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

    /* == BATCH2-ALLOC == F-01：噪声/漂移取样不再每次返回新数组（旧实现每帧 ~10 万次小数组分配）。
       调用方（renderXY / driftXY / snapshotRender）都是取完即刻拷贝，故共享 scratch 数值完全等价。 */
    var NOISE_SCRATCH = [0, 0];

    function sampleNoise(px, py) {
      if (sw.noiseLut) {
        maybeRebuildLut();
        NOISE_SCRATCH[0] = lutSample(lutDx, px, py);
        NOISE_SCRATCH[1] = lutSample(lutDy, px, py);
        return NOISE_SCRATCH;
      }
      NOISE_SCRATCH[0] = simplex.noise3(px * FS, py * FS, time * FT);
      NOISE_SCRATCH[1] = simplex.noise3(px * FS + PATH_OX, py * FS + PATH_OY, time * FT + PATH_OZ);
      return NOISE_SCRATCH;
    }

    var DRIFT_SCRATCH = [0, 0];

    function driftAt(px, py, rVal) {
      var amp;
      var ns;
      if (!sw.drift || sw.reducedMotion) {
        DRIFT_SCRATCH[0] = 0;
        DRIFT_SCRATCH[1] = 0;
        return DRIFT_SCRATCH;
      }
      amp = aOfR(rVal) * gateMul();
      if (amp === 0) {
        DRIFT_SCRATCH[0] = 0;
        DRIFT_SCRATCH[1] = 0;
        return DRIFT_SCRATCH;
      }
      ns = sampleNoise(px, py);
      DRIFT_SCRATCH[0] = amp * ns[0];
      DRIFT_SCRATCH[1] = amp * ns[1];
      return DRIFT_SCRATCH;
    }

    function rOfPixel(px, py) {
      var d = Math.hypot(px / width - cx, py / height - cy);
      var v = d / r95;
      if (v < 0) v = 0;
      return v;
    }

    function morphRamp() {
      if (phase !== PHASE.DWELL) return 0;
      return dwellRamp(time - dwellT0);
    }

    function respawn(idx) {
      var cxp = cx * width;
      var cyp = cy * height;
      var rx = tx[idx] - cxp;
      var ry = ty[idx] - cyp;
      var rl = Math.hypot(rx, ry);
      if (rl > ANISO_EPS) {
        x[idx] = cxp + (1 - BIRTH_IN) * rx;
        y[idx] = cyp + (1 - BIRTH_IN) * ry;
      } else {
        x[idx] = tx[idx];
        y[idx] = ty[idx];
      }
      vx[idx] = 0;
      vy[idx] = 0;
      escX[idx] = 0;
      escY[idx] = 0;
      asleep[idx] = 0;
      lifeTau[idx] = LIFE_TAU0 + lifeRng() * LIFE_TAU1;
      lifeAge[idx] = 0;
      lifeA[idx] = 0;
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
        if (dx * dx + dy * dy < SLEEP_X * SLEEP_X) {
          if (!(sw.boundaryQ && phase === PHASE.DWELL && rr[idx] >= Q_LO)) return;
        } else {
          asleep[idx] = 0;
        }
      }

      S = smoothstep(S_LO, S_HI, rr[idx]);
      if (sw.field) {
        k = kOfS(S);
        c = cOfS(S);
      } else {
        k = K0;
        c = C0;
      }
      if (sw.criticalDamp) c = sw.handbookShape ? cShaped(k, S) : cCrit(k);

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
            var cc = sw.handbookShape ? cShaped(k, S) : cCrit(k);
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

      if (sw.boundaryQ && phase === PHASE.DWELL && rr[idx] >= Q_LO) {
        var qNow = qOfR(rr[idx]);
        if (qNow > 0) {
          rx = urx[idx];
          ry = ury[idx];
          vrad = vx[idx] * rx + vy[idx] * ry;
          if (vrad > 0) {
            vx[idx] -= vrad * qNow * rx;
            vy[idx] -= vrad * qNow * ry;
          }
          vx[idx] -= (BETA_MAX * H) * qNow * rx;
          vy[idx] -= (BETA_MAX * H) * qNow * ry;
        }
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

    function stepLife(idx) {
      var a;
      var rVis;
      var rx;
      var ry;
      var rl;
      var ramp;
      var we;
      var filx;
      var fily;
      var fil;
      var speed;
      if (sw.lifecycle && phase === PHASE.DWELL) {
        lifeAge[idx] += H;
        if (lifeAge[idx] <= LIFE_IN || lifeAge[idx] >= lifeTau[idx] * (1 - LIFE_OUT)) {
          a = lifeEnvelope(lifeAge[idx], lifeTau[idx]);
          lifeA[idx] = a;
        } else {
          a = 1;
          lifeA[idx] = 1;
        }
      } else {
        a = 1;
        lifeA[idx] = 1;
      }
      /* == BATCH2-STREAK == F-05：睡眠粒子（已锁目标、速度为 0）不再推进丝缕。
         它们只贡献亚像素级 esc 增量（@50k 实测 escMean 0.028px / escMax 0.122px），跳过可省 ~0.85ms/帧。 */
      if (sw.streak && !asleep[idx] && phase === PHASE.DWELL && rr[idx] >= STREAK_WE_LO) {
        ramp = rampCache > 0 ? rampCache : morphRamp();
        rx = x[idx] - cxW;
        ry = y[idx] - cyH;
        rl = Math.hypot(rx, ry);
        rVis = rOfPixel(x[idx] + escX[idx], y[idx] + escY[idx]);
        we = weOfR(rVis);
        if (we > 0 && ramp > 0 && rl > ANISO_EPS) {
          filx = lutSample(lutFilX, x[idx], y[idx]);
          fily = lutSample(lutFilY, x[idx], y[idx]);
          fil = filx * filx + fily * fily;
          if (fil > 1) {
            fil = 1 / Math.sqrt(fil);
            filx *= fil;
            fily *= fil;
          }
          rx /= rl;
          ry /= rl;
          speed = STREAK_U0 * H * we * ramp;
          escX[idx] += speed * (rx + STREAK_FIL * filx);
          escY[idx] += speed * (ry + STREAK_FIL * fily);
        }
      }
      if (sw.recycle && phase === PHASE.DWELL) {
        if (a <= RECYCLE_A) {
          respawn(idx);
        } else if (escX[idx] * escX[idx] + escY[idx] * escY[idx] > 0 || rr[idx] > 0.95) {
          rVis = rOfPixel(x[idx] + escX[idx], y[idx] + escY[idx]);
          if (rVis >= RECYCLE_R) respawn(idx);
        }
      }
    }

    function refreshTint() {
      var idx;
      var a;
      if (!(sw.lifecycle || sw.ripple)) return;
      tintClock += 1;
      if (tintClock > 1 && tintClock % 6 !== 0) return;
      for (idx = 0; idx < n; idx++) {
        a = sw.lifecycle ? lifeA[idx] : 1;
        if (sw.ripple && rampCache > 0 && wb[idx] > 0) {
          a = clamp01(
            a * (1 + V2_AMP * wb[idx] * sinTurn(ripplePhase(rPix[idx], time, phi0)) * rampCache)
          );
        }
        tintA[idx] = a;
      }
    }

    function stepFixed() {
      var idx;
      prevX.set(x);
      prevY.set(y);
      rampCache = morphRamp();
      if (sw.streak) {
        maybeRebuildLut();
        advanceFilLut();
      }
      if (sw.lifecycle || sw.recycle || sw.streak) {
        for (idx = 0; idx < n; idx++) {
          stepParticle(idx);
          stepLife(idx);
        }
      } else {
        for (idx = 0; idx < n; idx++) stepParticle(idx);
      }
      time += H;
      rampCache = morphRamp();
      refreshTint();
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
      px += dlt[0] + escX[idx];
      py += dlt[1] + escY[idx];
      if (sw.ripple && rampCache > 0 && wb[idx] > 0) {
        var u = rippleDisp(rPix[idx], rr[idx], time, phi0, rampCache);
        px += u * urx[idx];
        py += u * ury[idx];
      }
      out[0] = px;
      out[1] = py;
      return out;
    }

    function driftXY(idx, out) {
      var dlt = driftAt(x[idx], y[idx], rr[idx]);
      out[0] = dlt[0];
      out[1] = dlt[1];
      return out;
    }

    function setPhase(next) {
      var prev = phase;
      phase = next;
      if (phaseWakes()) {
        asleep.fill(0);
      }
      if (phase === PHASE.DWELL && prev !== PHASE.DWELL) {
        dwellT0 = time;
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
      lifeA: lifeA,
      tintA: tintA,
      lifeAge: lifeAge,
      lifeTau: lifeTau,
      escX: escX,
      escY: escY,
      phi0: phi0,
      get phase() {
        return phase;
      },
      get time() {
        return time;
      },
      get acc() {
        return acc;
      },
      get dwellT0() {
        return dwellT0;
      },
      morphRamp: morphRamp,
      setPhase: setPhase,
      setNorm: setNorm,
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
    FIL_LUT_HZ: FIL_LUT_HZ,
    SLEEP_V: SLEEP_V,
    SLEEP_X: SLEEP_X,
    FS: FS,
    FT: FT,
    A_MAX: A_MAX,
    PATH_OX: PATH_OX,
    PATH_OY: PATH_OY,
    PATH_OZ: PATH_OZ,
    LIFE_IN: LIFE_IN,
    LIFE_TAU0: LIFE_TAU0,
    LIFE_TAU1: LIFE_TAU1,
    LIFE_OUT: LIFE_OUT,
    RECYCLE_A: RECYCLE_A,
    RECYCLE_R: RECYCLE_R,
    Q_LO: Q_LO,
    Q_HI: Q_HI,
    BETA_MAX: BETA_MAX,
    RIPPLE_L: RIPPLE_L,
    RIPPLE_T: RIPPLE_T,
    RIPPLE_A: RIPPLE_A,
    STREAK_U0: STREAK_U0,
    STREAK_FIL: STREAK_FIL,
    SWITCH_DEFAULTS: SWITCH_DEFAULTS,
    PHASE: PHASE,
    clamp01: clamp01,
    smoothstep: smoothstep,
    kOfS: kOfS,
    cOfS: cOfS,
    cCrit: cCrit,
    cShaped: cShaped,
    SHAPE_BLEND: SHAPE_BLEND,
    discKc: discKc,
    aOfR: aOfR,
    lifeEnvelope: lifeEnvelope,
    dwellRamp: dwellRamp,
    qOfR: qOfR,
    weOfR: weOfR,
    ripplePhase: ripplePhase,
    rippleDisp: rippleDisp,
    mergeSwitches: mergeSwitches,
    makeSimplex: makeSimplex,
    createWorld: createWorld
  };

  root.NFRadialPhysics = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
