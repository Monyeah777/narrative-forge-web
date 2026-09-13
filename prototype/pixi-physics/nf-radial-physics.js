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
 *              live default `recycleFar` instead recycles only **off-screen** (viewport +5%);
 *              `?recyclefar=0` / switches.recycleFar=false keeps the r>1.25·R95 circle.
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
  /* == 无边界逸散（作者 2026-09-13）== 出画回收的视口余量（占视口边长比）：粒子渲染位置越过
     视口 + 该余量才重生；旧口径 RECYCLE_R=1.25 保留为回退（switches.recycleFar=false）。 */
  var RECYCLE_OFF = 0.05;
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
  /* == 整幅流动（作者 2026-09-13 追加）== driftAll：丝缕带下沿放开到圆心，**全幅**参与外向流动。
     启动顺序按半径排（先外围后内）：lag(R) = driftLag·(1 − min(1, R/R_REF))，
     R 为到画作中心的盒半径（R=1 = 画作盒边），R_REF=1.5 ≈ 视口外缘一侧：
     外缘（R≥1.5）立即起、盒沿（R=1）等 1/3·driftLag、圆心（R=0）等满 driftLag。
     权重保留径向梯度并加下限 DRIFT_WE_FLOOR —— 圆心也在动，不再是「固定中心」。 */
  var DRIFT_LAG_S = 6;
  /* 内核速度下限：作者 2026-09-13「先把以前的速度改回来」→ 回到 0.45（第 4/5 轮那档；
     第 6 轮曾抬到 0.7 作为「喷泉」配套，已回退） */
  var DRIFT_WE_FLOOR = 0.45;
  var DRIFT_R_REF = 1.5;
  /* == 中间复原（作者 2026-09-13 追加）== 内核区（半径小）的复原节奏更快：
     生命推进速率 rate = 1 + RESTORE_INNER·(1 − min(1, R/R_REF))（R = 粒子所属半径，R_REF=1.5）
     → 内核粒子更早走完生命、更频繁回收重生；同时淡入时长按 1/rate 缩短 → 重生后更快回到画面。
     外圈（R≥R_REF）rate=1，与前一轮完全一致。?restore=0 关闭。 */
  var RESTORE_INNER = 0.6;
  /* == 喷泉回流（作者 2026-09-13 追加）== 画作主体（所属半径 R < FOUNTAIN_R_HI）的逸散位移**被拉回**：
     超出 reach（REACH_FRAC × 盒短半轴）后沿 esc 反向以 FOUNTAIN_RETURN_K·U0 回流 → 走出-拉回循环，
     中间不断被补回（不留洞），整体读作「喷泉」；最外圈（R≥FOUNTAIN_R_HI）不回流，照旧一路向外逸散。 */
  /* 回流范围的柔和退出：R ∈ [FOUNTAIN_R_LO, FOUNTAIN_R_HI] 内回流强度由 1 渐变到 0，
     R ≥ FOUNTAIN_R_HI（盒沿）完全退出 → 只有最外圈粒子继续一路向外逸散、喂外围光晕。 */
  var FOUNTAIN_R_LO = 0.8;
  var FOUNTAIN_R_HI = 1.0;
  /* == 中心源 + 临时上限（作者 2026-09-13 追加）== 除画作本身的 n 粒外，再给一段**临时容量** srcN：
     源槽只在「中心带缺氧」时从**画作中心**生成（不是把粒子拉回来），中心补满后按慢速率退役，
     于是总粒子数在 [n, n+srcN] 之间呼吸 —— 外围还没消失，中心已经在生成。 */
  /* 中心带（盒半径）：作者 2026-09-13「范围有点大」→ 0.25 → 0.18 → 0.14 → **0.10**
     （横向 ≈24px、纵向 ≈31px；页面池阈值按 SRC_FILL_R/2 自动跟随） */
  var SRC_FILL_R = 0.1;
  /* == 两段式（作者 2026-09-13「三版取优点」）== 目标值由下面的 SMOOTH/STRONG 两端插值给出
     （早期单档 0.7 已被取代）：前段低目标 → 丝滑铺开；后段高目标 → 补黑洞。
     前段（0→SRC_PHASE_T0）：低目标 + 低速率 → 粒子按中心带**丝滑铺开**（更像「更平」版）；
     过渡（T0→T0+RAMP）：目标与速率平滑升到强档；
     后段：高目标 + 高速率 → 把中心黑洞补齐（「更喷 + 生成更快」版的优点）。
     平滑插值（smoothstep）保证没有突变。 */
  /* 作者 2026-09-13「改成 1s」：5 → 3.5 → **1s** 起升档（满强档 = 1 + 10 = 11s） */
  var SRC_PHASE_T0 = 1;          /* 起始强化的停留秒数 */
  var SRC_PHASE_RAMP = 10;       /* 过渡时长（秒）*/
  var SRC_TARGET_SMOOTH = 0.4;   /* 前段目标（更平）*/
  /* 后段目标：作者 2026-09-13「画作态可以 0.85」→ **0.85** 定为默认
     （中心补到原密度的 85%；?sourcetarget=1 更强 / 0.6 更弱） */
  var SRC_TARGET_STRONG = 0.85;
  var SRC_RATE_SMOOTH = 160;     /* 前段生成速率（粒/秒）*/
  /* 后段生成速率：加上「边缘汇」后，源粒子出画即释放 → 生成速率要与流失速率平衡才能守住目标。
     600/s 时稳态停在填充 0.42（比例控制有稳态误差）；提到 1500/s 让目标 0.6 能真正达到。 */
  var SRC_RATE_STRONG = 1500;
  /* == 起步快、后段降速（作者 2026-09-13「生成太快了，到了后期都挤中间，可以一开始快，
     后面减低速度」）== 快档只在开头一小段用来补洞；随后按 smoothstep 降到维持速率，
     只补「流走的量」，不再往中间灌 → 中心不会越挤越亮。 */
  var SRC_FAST_S = 12;           /* 快档持续（从升档起点算，秒） */
  var SRC_TAPER_S = 12;          /* 降速过渡（秒） */
  /* 维持速率 = 强档 × 该比例（下限 120 粒/秒）。源粒子改成同速外逸后，带内驻留 ≈5s，
     维持档要 ≈400 粒/s 才能守住目标（0.15 档实测后期填充掉到 0.36）→ 取 0.30。 */
  var SRC_RATE_LATE_FRAC = 0.3;
  /* 源粒子的外逸权重下限：与**周围粒子同速**（不再吃内核 0.45 的慢档，否则会赖在中心挤成一坨） */
  var SRC_WE_MIN = 1.0;
  var SRC_SPAWN_MAX = 320;    /* 最大生成速率（粒/秒，缺氧时）*/
  var SRC_RETIRE = 70;        /* 退役速率（粒/秒，中心已满时）*/
  var SRC_LIFE0 = 7;          /* 源粒子寿命（秒）——短，所以生成-离开循环快 */
  var SRC_LIFE1 = 16;
  /* 出生抖动半径（盒半径）：0.06 时出生点太集中、中心会堆成亮斑（实测最内环密度比 11×）；
     放大到 0.12 ≈ 整个中心带 → 生成仍来自中心区，但铺得开，不结块。 */
  var SRC_BIRTH_R = 0.05;
  var SRC_TICK_HZ = 10;       /* 生成/退役决策频率 */
  /* reach（回流起点）按**所属半径成比例**：reach = fountain·(MIN + FRAC·R·盒短半轴)。
     固定 reach 会把中心带整体抽空（每个中心粒子都能跑出 R<0.25）；成比例振幅＝整场按比例伸缩，
     密度守恒 → 中间不留洞，仍然是持续的向外-回流循环（喷泉）。 */
  var FOUNTAIN_REACH_MIN = 8;
  var FOUNTAIN_REACH_FRAC = 0.25;
  var FOUNTAIN_RETURN_K = 3;
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
    streak: false,
    /* == §4#2（2026-09-13 授权）== 带内睡眠粒子参与丝缕累积；false = 回退批次 2 的 !asleep 门槛 */
    streakSleeping: true,
    /* == §4#2 成本评估闸 == 丝缕带下沿覆盖（null = 用 STREAK_WE_LO=0.72）；数值型，非布尔 */
    streakWeLo: null,
    /* == 圆环修正 == shapeBand=true 用方框（Chebyshev）口径做丝缕带；false 回退圆形口径 */
    shapeBand: true,
    /* == 无上限逸散（作者 2026-09-13）== true = 带内权重恒 1、不在 1.05 处截断（回退 ?streakcap=on） */
    streakUnbounded: true,
    /* == R1b（倾向档）== REPEL 是否保留余韵族（涟漪/丝缕/生命周期/回收/Q） */
    repelFamily: true,
    /* == §4#3 == 余韵斜坡前段时长（null = 模块常量 RAMP_A=2） */
    rampA: null,
    /* == §4#4 == 回收出生点内缩比（null = 模块常量 BIRTH_IN=0.08） */
    birthIn: null,
    /* == 无边界逸散（作者 2026-09-13）== 回收口径：true = 出画才回收（视口 +RECYCLE_OFF 余量）；
       false = 旧圆形口径 rOfPixel ≥ RECYCLE_R(1.25)（回退 ?recyclefar=0） */
    recycleFar: true,
    /* == 整幅流动（作者 2026-09-13 追加）== true = 丝缕带放开到圆心（全幅参与），按半径排序起（先外后内）；
       false = 只动带内（旧行为，回退 ?driftall=off） */
    driftAll: true,
    /* 圆心相对盒沿的启动延迟秒数（数值型；null = 模块常量 DRIFT_LAG_S=6；?driftlag=<0–60>） */
    driftLag: null,
    /* 逸散速度覆盖（px/s，数值型；null = 模块常量 STREAK_U0=5；?streaku0=<0.5–20>） */
    streakU0: null,
    /* == 中间复原 == 内核复原加速（0–2，数值型；null = 模块常量 RESTORE_INNER=0.6；?restore=0 关） */
    restore: null,
    /* == 喷泉回流 == 强度倍率（0–2，数值型；null = 1；?fountain=0 关） */
    fountain: null,
    /* == 中心源 == 生成速率（粒/秒，null = 常量 SRC_SPAWN_MAX）、源寿命（秒）、退役速率 */
    sourceRate: null,
    sourceLife: null,
    sourceRetire: null,
    /* == 中心源 == 中心补到原密度的多少（0.3–1.0；null = 常量 0.7） */
    sourceTarget: null,
    /* == 修-2（F1）== 恒定内推默认删（裁决 §2）；置 true 仅用于回退对照。 */
    betaPush: false
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

  /* == 中间复原 == inScale（>0，默认 1）缩放入生淡入时长：内核区传 1/rate，重生后更快回到画面。
     不传参数时与旧实现逐位一致（隔离/金测路径不受影响）。 */
  function lifeEnvelope(age, tau, inScale) {
    var lin = inScale > 0 && inScale !== 1 ? LIFE_IN * inScale : LIFE_IN;
    if (age <= 0) return 0;
    if (age < lin) return age / lin;
    if (!(tau > lin)) return 1;
    if (age >= tau) return 0;
    var outStart = tau * (1 - LIFE_OUT);
    if (age > outStart) return (tau - age) / (tau * LIFE_OUT);
    return 1;
  }

  /* == §4#3（已授权）== 前段可提前：a 默认 RAMP_A=2（0.4@2s）；页面传 a=1 即 0.4@1s。 */
  function dwellRamp(t, a) {
    var rA = a == null ? RAMP_A : a;
    if (t <= 0) return 0;
    if (t < rA) return 0.4 * (t / rA);
    if (t < RAMP_B) return 0.4 + 0.6 * (t - rA) / (RAMP_B - rA);
    return 1;
  }

  function qOfR(r) {
    return smoothstep(Q_LO, Q_HI, r);
  }

  /* == §4#2 成本评估闸 == 带下沿按参数传入（默认 STREAK_WE_LO），避免模块级可变状态跨 world 泄漏。
     == 无上限逸散（作者 2026-09-13）== noCut=true 时**去掉上端截断**：
     外围粒子只受下沿（入带）约束，带内权重恒为 1 → 逸散速度恒定、不再在 1.05 处停住（那正是「方形框」的来源）。
     出场由回收接管（见 stepLife 的 recycle 分支）：默认 recycleFar＝渲染位置出画才 respawn，
     ?recyclefar=0 回旧口径 rVis ≥ RECYCLE_R(1.25)。 */
  function weOfR(rVal, lo, noCut) {
    if (lo == null) lo = STREAK_WE_LO;
    if (rVal < lo) return 0;
    if (noCut) return smoothstep(lo, STREAK_WE_HI, rVal);
    if (rVal > STREAK_R_CUT) return 0;
    return smoothstep(lo, STREAK_WE_HI, rVal) * (1 - smoothstep(1, STREAK_R_CUT, rVal));
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
          /* 数值型参数（带下沿 / 余韵前段 / 回收内缩比）按数值处理，其余开关按布尔 */
          out[key] = key === "streakWeLo" || key === "rampA" || key === "birthIn" || key === "driftLag" ||
            key === "streakU0" || key === "restore" || key === "fountain" ||
            key === "sourceRate" || key === "sourceLife" || key === "sourceRetire" || key === "sourceTarget"
            ? Number(src[key])
            : !!src[key];
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
    var lim;
    if (!src) return;
    /* == 中心源 == 源槽位在容量区间内；若调用方数组只到 n（隔离/S3 或无源档），按实际长度收敛 */
    lim = typeof src.length === "number" && src.length < n ? src.length | 0 : n;
    for (i = 0; i < lim; i++) dst[i] = src[i];
  }

  function createWorld(opts) {
    opts = opts || {};
    var n = opts.n | 0;
    if (n <= 0) throw new Error("NFRadialPhysics.createWorld: n > 0 required");
    /* == 中心源 == 前 n 个槽是画作本身；后 srcN 个是「临时容量」源槽（初始为空） */
    var srcN = opts.sourceN | 0;
    if (srcN < 0) srcN = 0;
    var cap = n + srcN;
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

    var x = new Float64Array(cap);
    var y = new Float64Array(cap);
    var vx = new Float64Array(cap);
    var vy = new Float64Array(cap);
    var tx = new Float64Array(cap);
    var ty = new Float64Array(cap);
    var rr = new Float64Array(cap);
    var rPix = new Float64Array(cap);
    var urx = new Float64Array(cap);
    var ury = new Float64Array(cap);
    var wb = new Float64Array(cap);
    var asleep = new Uint8Array(cap);
    var prevX = new Float64Array(cap);
    var prevY = new Float64Array(cap);
    var lifeAge = new Float64Array(cap);
    var lifeTau = new Float64Array(cap);
    var lifeA = new Float64Array(cap);
    var escX = new Float64Array(cap);
    var escY = new Float64Array(cap);
    /* == 中心源 == 存活标志（源槽初始为 0 = 未生成）与计数 */
    var alive = new Uint8Array(cap);
    alive.fill(1);
    for (i = n; i < cap; i++) alive[i] = 0;
    var aliveCount = n;
    var sourceAlive = 0;
    var srcAcc = 0;
    var retireAcc = 0;
    var srcCursor = n;      /* 顺序扫描源槽用 */
    var retireCursor = n;
    var centerTargetN = 0;
    var centerNowN = 0;
    var centerFill = 1;
    var srcTickAcc = 0;
    /* == 圆环修正 == 每粒子的「带口径」半径（目标点；shapeBand 时用方框口径） */
    var rBand = new Float64Array(cap);
    var simplex = makeSimplex(seed);
    var lutDx = new Float64Array(LUT_N * LUT_N);
    var lutDy = new Float64Array(LUT_N * LUT_N);
    var lutFilX = new Float64Array(LUT_N * LUT_N);
    var lutFilY = new Float64Array(LUT_N * LUT_N);
    var lutPsi = new Float64Array(LUT_N * LUT_N);
    var tintA = new Float64Array(cap);
    var lutSlice = -1;
    var acc = 0;
    var time = 0;
    var dwellT0 = 0;
    var rampCache = 0;
    var tintClock = 0;
    var cxW = cx * width;
    var cyH = cy * height;
    /* == 无边界逸散 == 出画判定的视口余量（像素）：见 RECYCLE_OFF */
    var offX = RECYCLE_OFF * width;
    var offY = RECYCLE_OFF * height;
    /* == 整幅流动 == 复原（回收重生）计数：验收用「复原是否在跑」的直接读数 */
    var counters = { respawn: 0 };
    /* 验收计数：丝缕门槛通过次数与真正累积次数（逐帧累加，供「谁在动」的读数） */
    counters.gatePass = 0;
    counters.streakSteps = 0;
    /* 逐帧局部累加、帧末一次性回写（避免热路径里 5 万次属性自增） */
    var gateN = 0;
    var stepN = 0;
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

    copyInto(tx, opts.tx, cap);
    copyInto(ty, opts.ty, cap);
    copyInto(x, opts.x, cap);
    copyInto(y, opts.y, cap);
    copyInto(vx, opts.vx, cap);
    copyInto(vy, opts.vy, cap);
    if (!opts.x) {
      for (i = 0; i < cap; i++) x[i] = tx[i];
    }
    if (!opts.y) {
      for (i = 0; i < cap; i++) y[i] = ty[i];
    }
    prevX.set(x);
    prevY.set(y);

    var normX = opts.normX || null;
    var normY = opts.normY || null;
    /* == §4#2 成本评估闸 == sw.streakWeLo 可覆盖丝缕带下沿（默认 STREAK_WE_LO=0.72）。
       同时作用于门槛与 we 权重下沿，保证「收窄带」是一次干净的 A/B（默认不改变行为）。 */
    /* == §4#2 成本档（已授权）== 默认收窄到 0.82；?streakband=0.72 可回全带 */
    var streakWeLo = typeof sw.streakWeLo === "number" && sw.streakWeLo > 0 ? sw.streakWeLo : 0.82;
    /* == §4#3（已授权）== 余韵斜坡前段时长覆盖（默认 1s = 0.4@1s；回退传 2） */
    var rampA = typeof sw.rampA === "number" && sw.rampA > 0 ? sw.rampA : RAMP_A;
    /* == §4#4（已授权）== 回收出生点内缩比覆盖（默认 0.02；回退传 0.08） */
    var birthIn = typeof sw.birthIn === "number" && sw.birthIn >= 0 ? sw.birthIn : BIRTH_IN;
    /* == 整幅流动 == 圆心相对盒沿的启动延迟（秒）；0 = 全幅同时起 */
    var driftLag = typeof sw.driftLag === "number" && sw.driftLag >= 0 ? sw.driftLag : DRIFT_LAG_S;
    /* 逸散速度（px/s）：默认卷面 §7 的 U0=5；页面 ?streaku0= 可调（视觉档位用） */
    var streakU0 = typeof sw.streakU0 === "number" && sw.streakU0 > 0 ? sw.streakU0 : STREAK_U0;
    /* == 中间复原 == 内核复原加速系数（0 = 关；默认 RESTORE_INNER=0.6） */
    var restoreBoost = typeof sw.restore === "number" && sw.restore >= 0 ? sw.restore : RESTORE_INNER;
    /* == 喷泉回流 == 幅度倍率（0 = 关；默认 1）；换算尺度在 sceneW/sceneH 就位后再算 */
    var fountain = typeof sw.fountain === "number" && sw.fountain >= 0 ? sw.fountain : 1;
    /* == 中心源 == 生成/退役速率与源粒子寿命（页面 ?sourcerate= / ?sourcelife= 可调） */
    var srcRetireRate = typeof sw.sourceRetire === "number" && sw.sourceRetire > 0 ? sw.sourceRetire : SRC_RETIRE;
    var srcLife = typeof sw.sourceLife === "number" && sw.sourceLife > 0 ? sw.sourceLife : (SRC_LIFE0 + SRC_LIFE1) * 0.5;
    /* 强档值（可被 ?sourcetarget= / ?sourcerate= 覆盖）；前段值固定用 SRC_*_SMOOTH */
    var srcTargetStrong = typeof sw.sourceTarget === "number" && sw.sourceTarget > 0 ? sw.sourceTarget : SRC_TARGET_STRONG;
    var srcRateStrong = typeof sw.sourceRate === "number" && sw.sourceRate > 0 ? sw.sourceRate : SRC_RATE_STRONG;
    /* 后段维持速率：只补流失（可用 ?sourcerate= 成比例缩放） */
    var srcRateLate = Math.max(120, srcRateStrong * SRC_RATE_LATE_FRAC);
    var srcFillTarget = srcTargetStrong;
    var srcRateNow = srcRateStrong;
    var srcPhaseU = 0;
    var srcTaperU = 0;
    /* == 模式隔离 == 由页面按模式开关（首页混沌态关；画作态开）。默认 true 便于独立使用/对照。 */
    var srcEnabled = true;
    var fountainScale = 0;
    var fountainReach = 0;

    /* == 修-1（P0）== 画作盒（contain）口径参数：sceneW/sceneH = fitW/fitH，
       boxCx/boxCy = 盒中心（像素）。四者齐备才启用；否则 rOfPixel 走旧视口轴归一。
       注意 PAINT_CX = 0.35（非居中）与 PAINT_H = 0.70 由页面 layoutContain() 折算成盒。 */
    var sceneW = opts.sceneW;
    var sceneH = opts.sceneH;
    var boxCx = opts.boxCx;
    var boxCy = opts.boxCy;
    var useSceneBox =
      typeof sceneW === "number" && sceneW > 0 &&
      typeof sceneH === "number" && sceneH > 0 &&
      typeof boxCx === "number" && isFinite(boxCx) &&
      typeof boxCy === "number" && isFinite(boxCy);
    /* 盒（或视口）短半轴 = 1 个半径单位的像素尺度 */
    fountainScale = (useSceneBox ? (sceneW < sceneH ? sceneW : sceneH) : (width < height ? width : height)) * 0.5;
    fountainReach = FOUNTAIN_REACH_MIN; /* 每粒子的 reach 逐帧按所属半径算，这里只作外露参考值 */

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
        rBand[k] = rBandOfTarget(k);
      }
    }

    function setNorm(nextX, nextY) {
      normX = nextX || null;
      normY = nextY || null;
      refreshR();
    }

    refreshR();
    /* == 中心源 == 基础目标里落在中心带（< SRC_FILL_R，抽样 stride 8）的数量 = 中心带的「应有量」 */
    if (srcN > 0) {
      centerTargetN = 0;
      for (i = 0; i < n; i += 8) {
        if (rShapeOf(tx[i], ty[i]) < SRC_FILL_R) centerTargetN += 1;
      }
    }

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
      /* == 修-1（P0）== 画作盒口径（裁决 §1）：
           d = hypot((px − boxCx)/sceneW, (py − boxCy)/sceneH) / R95
         无 sceneW/sceneH/盒中心时**严格回退**旧视口轴归一 → 隔离页 / S3 dual / 金测逐位不动。
         与 rr 同盒：rr 走 normX/normY（画作盒坐标），rVis（=本函数）此前走视口轴归一，两者口径不一。 */
      var d = useSceneBox
        ? Math.hypot((px - boxCx) / sceneW, (py - boxCy) / sceneH)
        : Math.hypot(px / width - cx, py / height - cy);
      var v = d / r95;
      if (v < 0) v = 0;
      return v;
    }

    /* == 圆环修正 == Chebyshev（方框）半径：1 = 画作盒边缘 —— 四边与四角同时达 1。
       旧口径是圆形（hypot/r95），矩形画作的四角半径 ≈1.18 > 切点 1.05 → 四角 we≡0、不逸散，
       中边逸散 → 视觉上形成「圆环挤兑边角」。sw.shapeBand=false 时回退圆形口径。 */
    function rShapeOf(px, py) {
      var hw = sceneW * 0.5;
      var hh = sceneH * 0.5;
      var u;
      var v;
      if (!(hw > 0) || !(hh > 0)) return rOfPixel(px, py);
      u = Math.abs(px - boxCx) / hw;
      v = Math.abs(py - boxCy) / hh;
      return u > v ? u : v;
    }

    /* 丝缕带口径（门槛与权重共用同一函数，保证一致） */
    function rBandOf(px, py) {
      return sw.shapeBand ? rShapeOf(px, py) : rOfPixel(px, py);
    }

    /* 目标点的同口径带半径（在 refreshR 里预算一次，避免每帧每粒子重算） */
    function rBandOfTarget(k) {
      return sw.shapeBand ? rShapeOf(tx[k], ty[k]) : rr[k];
    }

    /* == R1b（倾向档）== REPEL 相位是否保留「余韵族」（涟漪/丝缕/生命周期/回收/Q）。
       默认 true（贴近看时画面仍活着）；sw.repelFamily=false 回退旧行为（REPEL 即暂停余韵族）。 */
    function dwellLike() {
      return phase === PHASE.DWELL || (sw.repelFamily && phase === PHASE.REPEL);
    }

    function morphRamp() {
      /* == R1b == dwellLike() 让 REPEL 也保留余韵族缓动（默认）；关掉时与原行为一致 */
      if (!dwellLike()) return 0;
      return dwellRamp(time - dwellT0, rampA);
    }

    function respawn(idx) {
      counters.respawn++;
      var cxp = cx * width;
      var cyp = cy * height;
      var rx = tx[idx] - cxp;
      var ry = ty[idx] - cyp;
      var rl = Math.hypot(rx, ry);
      if (idx >= n) {
        /* == 中心源 == 源槽从**画作中心**出生（带一点抖动），再被弹簧带到自己的目标位；
           寿命短（srcLife ±40%）→ 生成-外走-离开循环快，「中心一直在生成」。 */
        var ang = lifeRng() * TWO_PI;
        var rad = Math.sqrt(lifeRng()) * SRC_BIRTH_R * (useSceneBox ? (sceneW < sceneH ? sceneW : sceneH) : (width < height ? width : height));
        x[idx] = cxp + Math.cos(ang) * rad;
        y[idx] = cyp + Math.sin(ang) * rad;
        lifeTau[idx] = srcLife * (0.6 + lifeRng() * 0.8);
      } else if (rl > ANISO_EPS) {
        x[idx] = cxp + (1 - birthIn) * rx;
        y[idx] = cyp + (1 - birthIn) * ry;
        lifeTau[idx] = LIFE_TAU0 + lifeRng() * LIFE_TAU1;
      } else {
        x[idx] = tx[idx];
        y[idx] = ty[idx];
        lifeTau[idx] = LIFE_TAU0 + lifeRng() * LIFE_TAU1;
      }
      vx[idx] = 0;
      vy[idx] = 0;
      escX[idx] = 0;
      escY[idx] = 0;
      asleep[idx] = 0;
      lifeAge[idx] = 0;
      lifeA[idx] = 0;
    }

    /* == 中心源（作者 2026-09-13）== 源槽（idx ≥ n）的生成/退役。
       生成条件：中心带（盒半径 < SRC_FILL_R）里的**显示**粒子数低于「基础目标数」→ 缺氧越多生成越快；
       中心补满后按慢速率退役 → 总粒子数在 [n, n+srcN] 之间呼吸，外围还在飞、中心已经在生成。 */
    function srcSpawn() {
      var k;
      var tries = 0;
      while (tries < cap - n) {
        k = srcCursor;
        srcCursor += 1;
        if (srcCursor >= cap) srcCursor = n;
        tries += 1;
        if (!alive[k]) {
          alive[k] = 1;
          aliveCount += 1;
          sourceAlive += 1;
          respawn(k);
          return true;
        }
      }
      return false;
    }

    function srcRetire() {
      var k;
      var tries = 0;
      while (tries < cap - n && sourceAlive > 0) {
        k = retireCursor;
        retireCursor += 1;
        if (retireCursor >= cap) retireCursor = n;
        tries += 1;
        if (alive[k]) {
          srcFree(k);
          return true;
        }
      }
      return false;
    }

    /* 释放一个源槽（是「删除」不是「重生」）：位置挪到画面外、alpha=0、计数回落。
       == 边缘汇（作者 2026-09-13「没有边缘消失防止爆满的机制吗」）== 源粒子出画 / 生命到期时走这里，
       于是总粒子数只会「中心缺氧时涨、粒子出画时落」，不会一直堆到上限。 */
    function srcFree(k) {
      if (!alive[k]) return;
      alive[k] = 0;
      aliveCount -= 1;
      sourceAlive -= 1;
      tintA[k] = 0;
      lifeA[k] = 0;
      escX[k] = 0;
      escY[k] = 0;
      x[k] = -1e4;
      y[k] = -1e4;
      prevX[k] = -1e4;
      prevY[k] = -1e4;
    }

    function srcRetireAll() {
      var k;
      if (sourceAlive <= 0) return;
      for (k = n; k < cap; k++) srcFree(k);
    }

    function srcTick(dtTick) {
      var k;
      var now = 0;
      var def;
      if (srcN <= 0) return;
      /* == 模式隔离 == 页面在首页混沌态/过渡态关闭生成 → 立即释放全部源粒子 */
      if (!srcEnabled) {
        srcRetireAll();
        srcAcc = 0;
        retireAcc = 0;
        srcPhaseU = 0;
        return;
      }
      /* == 相位隔离（作者 2026-09-13「没有隔离机制吗」）==
         只在 dwell-like 状态（DWELL；REPEL 若保留余韵族）里生成；一旦离开（INTRO/HANDOVER 等），
         全部源粒子立即释放 → 换场景/换幅/进过渡时不会带着上一段的中心源继续生成。 */
      if (!dwellLike()) {
        srcRetireAll();
        srcAcc = 0;
        retireAcc = 0;
        srcPhaseU = 0;
        return;
      }
      /* == 两段式 == 前段轻、后段强，按 smoothstep 平滑过渡（丝滑，无突变） */
      srcPhaseU = smoothstep(SRC_PHASE_T0, SRC_PHASE_T0 + SRC_PHASE_RAMP, time - dwellT0);
      srcFillTarget = SRC_TARGET_SMOOTH + (srcTargetStrong - SRC_TARGET_SMOOTH) * srcPhaseU;
      /* 速率 = 升档到快档 → 再按 SRC_FAST_S/SRC_TAPER_S 降到维持速率（起步快、后段慢） */
      srcRateNow = SRC_RATE_SMOOTH + (srcRateStrong - SRC_RATE_SMOOTH) * srcPhaseU;
      srcTaperU = smoothstep(SRC_PHASE_T0 + SRC_FAST_S, SRC_PHASE_T0 + SRC_FAST_S + SRC_TAPER_S, time - dwellT0);
      srcRateNow = srcRateNow * (1 - srcTaperU) + srcRateLate * srcTaperU;
      /* 中心带里的显示粒子数（抽样，和 centerTargetN 同一 stride） */
      now = 0;
      for (k = 0; k < cap; k += 8) {
        if (!alive[k]) continue;
        if (rShapeOf(x[k] + escX[k], y[k] + escY[k]) < SRC_FILL_R) now += 1;
      }
      centerNowN = now;
      if (centerTargetN <= 0) return;
      centerFill = now / centerTargetN;
      def = srcFillTarget - centerFill;
      if (def < 0) def = 0;
      if (def > 1) def = 1;
      if (def > 0.03 && sourceAlive < srcN) {
        srcAcc += srcRateNow * def * dtTick;
        while (srcAcc >= 1) {
          srcAcc -= 1;
          if (!srcSpawn()) break;
        }
      } else {
        srcAcc = 0;
      }
      if (def <= 0.03 && sourceAlive > 0) {
        retireAcc += srcRetireRate * dtTick;
        while (retireAcc >= 1) {
          retireAcc -= 1;
          if (!srcRetire()) break;
        }
      } else {
        retireAcc = 0;
      }
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
          if (!(sw.boundaryQ && dwellLike() && rr[idx] >= Q_LO)) return;
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

      if (sw.boundaryQ && dwellLike() && rr[idx] >= Q_LO) {
        var qNow = qOfR(rr[idx]);
        if (qNow > 0) {
          rx = urx[idx];
          ry = ury[idx];
          vrad = vx[idx] * rx + vy[idx] * ry;
          /* == F1 去内推 == 卷面 §5.1#9：动在渲染通道，物理通道不做向内偏置。
             只保留「外向分量阻尼」（vrad > 0 时按 q 衰减），边界防外溢能力不变；
             原 (BETA_MAX·H)·q·(rx,ry) 恒定向内偏置删除。BETA_MAX 保留为卷面 §7 参数备查。 */
          if (vrad > 0) {
            vx[idx] -= vrad * qNow * rx;
            vy[idx] -= vrad * qNow * ry;
          }
          /* == 修-2（F1）回退开关 == switches.betaPush（页面 ?qpush=1）可恢复旧恒定内推；
             默认 false＝按裁决删除（伪平衡 s*=βq/((1−q)ck) 在 q→1 发散）。 */
          if (sw.betaPush) {
            vx[idx] -= (BETA_MAX * H) * qNow * rx;
            vy[idx] -= (BETA_MAX * H) * qNow * ry;
          }
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
      var pxr;
      var pyr;
      var rx;
      var ry;
      var rl;
      var ramp;
      var we;
      var filx;
      var fily;
      var fil;
      var speed;
      var bandLo;
      var lagNeed;
      var homeR;
      var lifeRate;
      var inScale;
      var fw;
      var escMag;
      var backK;
      var reachPx;
      homeR = -1;
      if (sw.lifecycle && dwellLike()) {
        /* == 中间复原（作者 2026-09-13）== 按**所属半径**（用物理位置 x,y，它被弹簧压在目标附近，
           不随 esc 外移）加速内核的复原节奏：lifeRate>1 → 更早回收重生；淡入时长 ×1/lifeRate →
           重生后更快回到画面。外圈 R≥R_REF 时 lifeRate=1，与前一轮逐项一致。 */
        lifeRate = 1;
        inScale = 1;
        if (restoreBoost > 0 || fountain > 0) {
          /* homeR：粒子**所属半径**（物理位置被弹簧压在目标附近，不随 esc 外移） */
          homeR = rBandOf(x[idx], y[idx]);
        }
        if (restoreBoost > 0 && homeR >= 0) {
          lifeRate = 1 + restoreBoost * (1 - (homeR > DRIFT_R_REF ? 1 : homeR / DRIFT_R_REF));
          inScale = 1 / lifeRate;
        }
        lifeAge[idx] += H * lifeRate;
        if (lifeAge[idx] <= LIFE_IN * inScale || lifeAge[idx] >= lifeTau[idx] * (1 - LIFE_OUT)) {
          a = lifeEnvelope(lifeAge[idx], lifeTau[idx], inScale);
          lifeA[idx] = a;
        } else {
          a = 1;
          lifeA[idx] = 1;
        }
      } else {
        a = 1;
        lifeA[idx] = 1;
      }
      /* == §4#2 已授权（2026-09-13）== 带内睡眠粒子恢复积累：只跳过「带外 / we=0」的粒子。
         sw.streakSleeping=false 时为旧门槛（批次 2 的 !asleep，省 ~0.85ms/帧，但砍掉约六成载体）。
         实测：放开门槛后 esc 自 2s 起累积（escP95 1.98→79.42px，2..30s）；代价 停留帧 +0.45~0.53ms。 */
      /* == 整幅流动（作者 2026-09-13 追加）== sw.driftAll=true 时门槛由「带内」放开到**全幅**，
         并**按粒子当前位置的半径**排序启动（先外围后内）：lagNeed = driftLag·(1 − min(1, R/R_REF))。
         为什么用实时半径 R 而不是 rBand[]：页面直接写 radialWorld.tx/ty 且从不调 refreshR()，
         rBand[] 只在建 world 时算过一次（本页 = 画作层 0.002–0.999），与屏幕上的实际半径
         （云铺满视口，0–3.8）脱节——用它会把全幅的启动延迟统一压到 ≈2s，看不出「先外后内」。
         实时半径同时也被 we 复用（同一次 rBandOf 调用），不额外增加开销。
         ?driftall=off 回旧「只动带内（rBand ≥ streakWeLo）」。 */
      if (sw.streak && (sw.streakSleeping || !asleep[idx]) && dwellLike()) {
        rVis = rBandOf(x[idx] + escX[idx], y[idx] + escY[idx]);
        lagNeed = sw.driftAll ? driftLag * (1 - (rVis > DRIFT_R_REF ? 1 : rVis / DRIFT_R_REF)) : 0;
        if (sw.driftAll ? time - dwellT0 >= lagNeed : rBand[idx] >= streakWeLo) {
          gateN += 1;
          ramp = rampCache > 0 ? rampCache : morphRamp();
          rx = x[idx] - cxW;
          ry = y[idx] - cyH;
          rl = Math.hypot(rx, ry);
          bandLo = sw.driftAll ? 0 : streakWeLo;
          we = weOfR(rVis, bandLo, sw.streakUnbounded);
          /* 全幅模式：权重保留下限，圆心也真正在动（否则 we(0)=0 又变成「固定中心」） */
          if (sw.driftAll) we = DRIFT_WE_FLOOR + (1 - DRIFT_WE_FLOOR) * we;
          /* == 同速外逸 == 源粒子不受内核慢档限制：至少按漂移标称速度往外走，
             于是它们不会在中心越积越密（作者 2026-09-13「和周围粒子相同速度」）。 */
          if (idx >= n && we < SRC_WE_MIN) we = SRC_WE_MIN;
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
            speed = streakU0 * H * we * ramp;
            stepN += 1;
            escX[idx] += speed * (rx + STREAK_FIL * filx);
            escY[idx] += speed * (ry + STREAK_FIL * fily);
          }
        }
      }
      /* == 喷泉回流（作者 2026-09-13 追加）== 内核区把逸散位移拉回：
         超出 reach 后沿 esc 反向回流，速度 = FOUNTAIN_RETURN_K·U0（恒定），
         fw 只决定成员度（R<0.8 全回流、0.8→1.0 柔和退出、≥1.0 不回）。
         走出-拉回成循环 → 中间不断被补回（不留洞），整体读作喷泉；外圈 fw=0 不回流，继续一路逸散。
         ?fountain=0 关；0–2 调强度。 */
      if (fountain > 0 && sw.driftAll && sw.streak && dwellLike()) {
        if (homeR < 0) homeR = rBandOf(x[idx], y[idx]);
        /* fw = 回流「成员度」：R<0.8 全回流；0.8→1.0 柔和退出；≥1.0 不回流（继续逸散）。
           注意 fw 只决定**是否回流**，不决定回流速度——否则中环粒子会因速度被削弱而跑很远，
           留下环状变薄。 */
        fw = 1 - smoothstep(FOUNTAIN_R_LO, FOUNTAIN_R_HI, homeR);
        if (fw > 0) {
          escMag = Math.sqrt(escX[idx] * escX[idx] + escY[idx] * escY[idx]);
          /* 成比例振幅：所属半径越大，允许的外移越多（整场按比例伸缩 → 密度守恒、不留洞） */
          reachPx = fountain * (FOUNTAIN_REACH_MIN + FOUNTAIN_REACH_FRAC * homeR * fountainScale);
          if (escMag > reachPx) {
            backK = (FOUNTAIN_RETURN_K * streakU0 * H) / escMag;
            if (backK > 1) backK = 1;
            escX[idx] -= escX[idx] * backK;
            escY[idx] -= escY[idx] * backK;
          }
        }
      }
      if (sw.recycle && dwellLike()) {
        if (a <= RECYCLE_A) {
          /* == 边缘汇 == 源粒子走完生命 → 释放槽位（不是重生）；基础粒子照旧重生 */
          if (idx >= n) srcFree(idx);
          else respawn(idx);
        } else if (escX[idx] * escX[idx] + escY[idx] * escY[idx] > 0 || rr[idx] > 0.95) {
          /* == 无边界逸散（作者 2026-09-13）== 回收只按「出画」判：粒子渲染位置越过视口 +RECYCLE_OFF
             余量才重生 → 外围粒子一路向外逸散、途中没有任何可见的停/消失界线。
             旧口径 rOfPixel ≥ RECYCLE_R(1.25) 是**圆形**界线，在本页几何（1440×900 / 盒 491×630 /
             r95=0.599）上换算为 x = 504 ± 368px —— 画作右缘外约 123px 处就回收；且盒角 rOfPixel≈1.18，
             几乎一入带就被回收，与方框带域（shapeBand）相互打架。
             ?recyclefar=0 回退旧圆形回收半径（对照档）。 */
          if (sw.recycleFar) {
            pxr = x[idx] + escX[idx];
            pyr = y[idx] + escY[idx];
            if (pxr < -offX || pxr > width + offX || pyr < -offY || pyr > height + offY) {
              /* == 边缘汇 == 源粒子出画即消失（释放槽位）→ 总粒子数不会堆到上限 */
              if (idx >= n) srcFree(idx);
              else respawn(idx);
            }
          } else {
            rVis = rOfPixel(x[idx] + escX[idx], y[idx] + escY[idx]);
            if (rVis >= RECYCLE_R) {
              if (idx >= n) srcFree(idx);
              else respawn(idx);
            }
          }
        }
      }
    }

    function refreshTint() {
      var idx;
      var a;
      if (!(sw.lifecycle || sw.ripple)) return;
      tintClock += 1;
      if (tintClock > 1 && tintClock % 6 !== 0) return;
      for (idx = 0; idx < cap; idx++) {
        if (!alive[idx]) {
          tintA[idx] = 0;
          continue;
        }
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
      /* == 中心源 == 10Hz 生成/退役决策 */
      if (srcN > 0) {
        srcTickAcc += H;
        if (srcTickAcc >= 1 / SRC_TICK_HZ) {
          srcTick(srcTickAcc);
          srcTickAcc = 0;
        }
      }
      if (sw.lifecycle || sw.recycle || sw.streak) {
        for (idx = 0; idx < cap; idx++) {
          if (!alive[idx]) continue;
          stepParticle(idx);
          stepLife(idx);
        }
      } else {
        for (idx = 0; idx < cap; idx++) {
          if (!alive[idx]) continue;
          stepParticle(idx);
        }
      }
      time += H;
      if (gateN || stepN) {
        counters.gatePass += gateN;
        counters.streakSteps += stepN;
        gateN = 0;
        stepN = 0;
      }
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

    /* == 指针驱离（模块内版本，作者 2026-09-13「滑动鼠标会顿住」）==
       页面原来每帧要把 x/y/vx/vy 四张 6 万粒的表拷进来、算完再拷回去；改成在模块内直接施加，
       省掉这 4 次整表拷贝（每次 6 万个元素）。力形与页面口径一致：
       old=false → 紧凑核 w=(1−d/R)²；old=true → 旧口径 1/d² + 硬截断 + 上限。
       只唤醒真正被波及的粒子（不再 wakeAll，睡眠优化得以保留）。返回被波及的粒子数。 */
    function repelAt(mx, my, radius, strength, oldOn, fmax) {
      var k;
      var dx;
      var dy;
      var d2;
      var dist;
      var u;
      var w;
      var f;
      var r2 = radius * radius;
      var hit = 0;
      for (k = 0; k < cap; k++) {
        if (!alive[k]) continue;
        dx = x[k] - mx;
        dy = y[k] - my;
        d2 = dx * dx + dy * dy;
        if (d2 >= r2 || d2 < 0.0001) continue;
        dist = Math.sqrt(d2);
        if (oldOn) {
          var dd = d2 < 4 ? 4 : d2;
          f = strength * (radius * radius) / dd;
          if (f > fmax) f = fmax;
        } else {
          u = dist / radius;
          w = 1 - u;
          f = strength * w * w;
          if (f > fmax) f = fmax;
        }
        vx[k] += (dx / dist) * f;
        vy[k] += (dy / dist) * f;
        asleep[k] = 0;
        hit += 1;
      }
      return hit;
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
      /* == 修-1（P0）== 半径口径与盒参数外露，供验收采样与证据记账 */
      radiusMode: useSceneBox ? "scene-box" : "viewport-axes",
      sceneBox: useSceneBox ? { w: sceneW, h: sceneH, cx: boxCx, cy: boxCy } : null,
      /* == 整幅流动 == 复原计数（回收重生次数）与生效延迟，供验收记账 */
      counters: counters,
      driftLag: driftLag,
      streakU0: streakU0,
      restore: restoreBoost,
      fountain: fountain,
      fountainReach: fountainReach,
      /* 停留已走时间（秒）：验收「先外围后内」的排序时间轴口径 */
      dwellElapsed: function () {
        return time - dwellT0;
      },
      rOfPixel: rOfPixel,
      weOfR: function (rVal) {
        return weOfR(rVal, streakWeLo, sw.streakUnbounded);
      },
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
      /* 丝缕带口径的每粒子半径（验收：确认门槛与显示半径同尺） */
      rBand: rBand,
      /* == 中心源 == 槽位与计数外露（验收：总粒子数在 [n, n+srcN] 之间呼吸） */
      cap: cap,
      baseN: n,
      sourceN: srcN,
      alive: alive,
      get aliveCount() {
        return aliveCount;
      },
      get sourceAlive() {
        return sourceAlive;
      },
      get centerFill() {
        return centerFill;
      },
      /* == 两段式 == 当前生效的目标/速率与过渡进度（验收读数） */
      get sourceTargetNow() {
        return srcFillTarget;
      },
      get sourceRateNow() {
        return srcRateNow;
      },
      get sourcePhase() {
        return srcPhaseU;
      },
      get sourceTaper() {
        return srcTaperU;
      },
      get sourceRateLate() {
        return srcRateLate;
      },
      centerTargetN: centerTargetN,
      get centerNowN() {
        return centerNowN;
      },
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
      /* == 模式隔离 == 页面按 mode 开关中心源（混沌/过渡关、画作态开） */
      setSourceEnabled: function (on) {
        srcEnabled = !!on;
        if (!srcEnabled) srcRetireAll();
      },
      get sourceEnabled() {
        return srcEnabled;
      },
      setNorm: setNorm,
      wakeAll: wakeAll,
      repelAt: repelAt,
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
    RECYCLE_OFF: RECYCLE_OFF,
    Q_LO: Q_LO,
    Q_HI: Q_HI,
    BETA_MAX: BETA_MAX,
    RIPPLE_L: RIPPLE_L,
    RIPPLE_T: RIPPLE_T,
    RIPPLE_A: RIPPLE_A,
    STREAK_U0: STREAK_U0,
    DRIFT_LAG_S: DRIFT_LAG_S,
    DRIFT_WE_FLOOR: DRIFT_WE_FLOOR,
    DRIFT_R_REF: DRIFT_R_REF,
    SRC_FILL_R: SRC_FILL_R,
    SRC_SPAWN_MAX: SRC_SPAWN_MAX,
    SRC_RETIRE: SRC_RETIRE,
    SRC_BIRTH_R: SRC_BIRTH_R,
    SRC_FAST_S: SRC_FAST_S,
    SRC_TAPER_S: SRC_TAPER_S,
    SRC_RATE_LATE_FRAC: SRC_RATE_LATE_FRAC,
    SRC_WE_MIN: SRC_WE_MIN,
    RESTORE_INNER: RESTORE_INNER,
    FOUNTAIN_R_LO: FOUNTAIN_R_LO,
    FOUNTAIN_R_HI: FOUNTAIN_R_HI,
    FOUNTAIN_REACH_MIN: FOUNTAIN_REACH_MIN,
    FOUNTAIN_REACH_FRAC: FOUNTAIN_REACH_FRAC,
    FOUNTAIN_RETURN_K: FOUNTAIN_RETURN_K,
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
