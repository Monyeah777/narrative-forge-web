/**
 * NF spring core for H1-⑤ (C2 firewall).
 * Byte-identical to live applySpring / integrateSpring / nearStop / lockTo.
 * SPRING 0.055 / DAMP 0.90 / VMAX 10 / STOP 0.6px / 0.06
 * One step() = one live physics() assemble-branch iteration (not scaled by dt).
 * Clock: caller uses DT=1/60 accumulator, MAX_STEPS=2 (live tick).
 */
(function (root) {
  "use strict";

  var SPRING = 0.055;
  var DAMP = 0.9;
  var VMAX = 10;
  var STOP_PX = 0.6;
  var STOP_V = 0.06;
  var DT = 1 / 60;
  var MAX_STEPS = 2;
  var FRAME_CLAMP = 0.25;
  var ASSEMBLE_S = 1.5;
  var ASSEMBLE_MIN_S = 1.2;

  /* C2 golden: three fixed particles, 1000 assemble steps. */
  var GOLDEN_INIT = [
    { x: 0, y: 0, vx: 0, vy: 0, tx: 120, ty: 40 },
    { x: 80, y: 300, vx: 2, vy: -1, tx: 200, ty: 160 },
    { x: 400, y: 10, vx: 0, vy: 8, tx: 40, ty: 220 }
  ];
  var GOLDEN_STEPS = 1000;

  /* Frozen C2 sequence sha256 (Float64 LE, 1000 steps × 3 pts × x,y). */
  var FROZEN_GOLDEN_SHA = "dc1f16092d775ee1462c94eb964bb95523470bd7fd7770b1efab02c6940f320a";

  function capSpeed(p, max) {
    var s = Math.sqrt(p.vx * p.vx + p.vy * p.vy);
    if (s > max && s > 0) {
      p.vx *= max / s;
      p.vy *= max / s;
    }
  }

  function stepParticle(p) {
    p.vx += (p.tx - p.x) * SPRING;
    p.vy += (p.ty - p.y) * SPRING;
    p.vx *= DAMP;
    p.vy *= DAMP;
    capSpeed(p, VMAX);
    p.x += p.vx;
    p.y += p.vy;
    if (
      Math.abs(p.tx - p.x) < STOP_PX &&
      Math.abs(p.ty - p.y) < STOP_PX &&
      Math.abs(p.vx) < STOP_V &&
      Math.abs(p.vy) < STOP_V
    ) {
      p.x = p.tx;
      p.y = p.ty;
      p.vx = 0;
      p.vy = 0;
    }
  }

  function cloneGolden() {
    return GOLDEN_INIT.map(function (p) {
      return { x: p.x, y: p.y, vx: p.vx, vy: p.vy, tx: p.tx, ty: p.ty };
    });
  }

  function runGolden(steps) {
    var n = steps == null ? GOLDEN_STEPS : steps;
    var pts = cloneGolden();
    var seq = new Float64Array(n * pts.length * 2);
    var i;
    var k;
    var o = 0;
    for (i = 0; i < n; i++) {
      for (k = 0; k < pts.length; k++) stepParticle(pts[k]);
      for (k = 0; k < pts.length; k++) {
        seq[o++] = pts[k].x;
        seq[o++] = pts[k].y;
      }
    }
    return { points: pts, seq: seq, steps: n };
  }

  function goldenBytes(seq) {
    return new Uint8Array(seq.buffer, seq.byteOffset, seq.byteLength);
  }

  function createAccumulator() {
    return { acc: 0 };
  }

  function drain(accState, elapsedS, onStep) {
    var ft = elapsedS;
    var steps = 0;
    if (ft > FRAME_CLAMP) ft = FRAME_CLAMP;
    accState.acc += ft;
    while (accState.acc >= DT && steps < MAX_STEPS) {
      onStep();
      accState.acc -= DT;
      steps++;
    }
    return steps;
  }

  var api = {
    SPRING: SPRING,
    DAMP: DAMP,
    VMAX: VMAX,
    STOP_PX: STOP_PX,
    STOP_V: STOP_V,
    DT: DT,
    MAX_STEPS: MAX_STEPS,
    FRAME_CLAMP: FRAME_CLAMP,
    ASSEMBLE_S: ASSEMBLE_S,
    ASSEMBLE_MIN_S: ASSEMBLE_MIN_S,
    GOLDEN_STEPS: GOLDEN_STEPS,
    GOLDEN_INIT: GOLDEN_INIT,
    FROZEN_GOLDEN_SHA: FROZEN_GOLDEN_SHA,
    capSpeed: capSpeed,
    stepParticle: stepParticle,
    cloneGolden: cloneGolden,
    runGolden: runGolden,
    goldenBytes: goldenBytes,
    createAccumulator: createAccumulator,
    drain: drain
  };
  root.NFSpring = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
