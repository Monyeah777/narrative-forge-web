/**
 * NF radial render for S4 (isolation only).
 *
 * Handbook §5 Canvas2D ImageData menu A–D, modeled as a software
 * framebuffer (Node has no canvas). Pixel block: matte, integer-round,
 * no smoothing, no glow. Default cell = 2 device px.
 *
 * Does NOT replace live Pixi ParticleContainer (prototype/renderer.pixi.js).
 * Do not load this from prototype/index.html. Menu E (cut N / WebGL) is
 * a petition only — this file never enables it.
 *
 * A  bake r<0.55 (A(r)=0) into a static layer
 * B  dirty rect = union of erased+drawn blocks (MDN source-relative)
 * C  blit samples physics LUT via renderXY; off = per-particle Simplex
 * D  edge r>=0.85 even/odd alternate; hold last drawn position
 */
(function (root) {
  "use strict";

  var CELL = 2;
  var BAKE_R = 0.55;
  var EDGE_R = 0.85;
  var INK_R = 0xc9;
  var INK_G = 0xcf;
  var INK_B = 0xd8;
  var INK_A = 0xff;
  var BG_R = 0x05;
  var BG_G = 0x05;
  var BG_B = 0x05;
  var BG_A = 0xff;

  var ROLE_STATIC = 0;
  var ROLE_MOVE = 1;
  var ROLE_EDGE = 2;

  var SWITCH_DEFAULTS = {
    bakeCenter: true,
    dirtyRect: true,
    noiseLut: true,
    edgeStagger: true
  };

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

  function packRGBA(r, g, b, a) {
    var buf = new ArrayBuffer(4);
    var bytes = new Uint8Array(buf);
    var u32 = new Uint32Array(buf);
    bytes[0] = r;
    bytes[1] = g;
    bytes[2] = b;
    bytes[3] = a;
    return u32[0];
  }

  function createRenderer(opts) {
    opts = opts || {};
    var world = opts.world;
    if (!world || !world.n) {
      throw new Error("NFRadialRender.createRenderer: world required");
    }
    var phys = opts.physics || root.NFRadialPhysics;
    if (!phys) throw new Error("NFRadialRender.createRenderer: NFRadialPhysics required");
    var n = world.n;
    var w = world.width | 0;
    var h = world.height | 0;
    if (w <= 0 || h <= 0) throw new Error("NFRadialRender: world width/height required");
    var cell = opts.cell == null ? CELL : opts.cell | 0;
    if (cell < 1) cell = CELL;
    var half = cell >> 1;
    var sw = mergeSwitches(opts.switches);
    var ink = packRGBA(
      opts.inkR == null ? INK_R : opts.inkR,
      opts.inkG == null ? INK_G : opts.inkG,
      opts.inkB == null ? INK_B : opts.inkB,
      opts.inkA == null ? INK_A : opts.inkA
    );
    var bg = packRGBA(
      opts.bgR == null ? BG_R : opts.bgR,
      opts.bgG == null ? BG_G : opts.bgG,
      opts.bgB == null ? BG_B : opts.bgB,
      opts.bgA == null ? BG_A : opts.bgA
    );

    var pixels = new Uint32Array(w * h);
    var base = new Uint32Array(w * h);
    var role = new Uint8Array(n);
    var lastX = new Float64Array(n);
    var lastY = new Float64Array(n);
    var lastIx = new Int32Array(n);
    var lastIy = new Int32Array(n);
    var seeded = new Uint8Array(n);
    var tmp = [0, 0];
    var frameIndex = 0;
    var ready = false;
    var nStatic = 0;
    var nMove = 0;
    var nEdge = 0;
    var dirtyX0 = 0;
    var dirtyY0 = 0;
    var dirtyX1 = w;
    var dirtyY1 = h;
    var lastStats = {
      drew: 0,
      erased: 0,
      sampled: 0,
      held: 0,
      dirtyX: 0,
      dirtyY: 0,
      dirtyW: w,
      dirtyH: h,
      upload_px: w * h,
      full_px: w * h
    };

    function classify() {
      var i;
      var r;
      nStatic = 0;
      nMove = 0;
      nEdge = 0;
      for (i = 0; i < n; i++) {
        r = world.r[i];
        if (sw.bakeCenter && r < BAKE_R) {
          role[i] = ROLE_STATIC;
          nStatic += 1;
        } else if (r >= EDGE_R) {
          role[i] = ROLE_EDGE;
          nEdge += 1;
        } else {
          role[i] = ROLE_MOVE;
          nMove += 1;
        }
      }
    }

    function gateMul() {
      var psw = world.switches;
      var phase = world.phase;
      if (psw.reducedMotion) return 0;
      if (!psw.gating) return 1;
      if (phase === phys.PHASE.INTRO || phase === phys.PHASE.HANDOVER) return 0;
      if (phase === phys.PHASE.REPEL) return 0.5;
      return 1;
    }

    function sampleDirect(idx, out) {
      var a;
      var px;
      var py;
      var amp;
      var nx;
      var ny;
      if (world.switches.reducedMotion) {
        out[0] = world.x[idx];
        out[1] = world.y[idx];
        return out;
      }
      if (world.switches.interpolate) {
        a = world.alpha();
        px = world.prevX[idx] * (1 - a) + world.x[idx] * a;
        py = world.prevY[idx] * (1 - a) + world.y[idx] * a;
      } else {
        px = world.x[idx];
        py = world.y[idx];
      }
      amp = phys.aOfR(world.r[idx]) * gateMul();
      if (amp === 0 || !world.switches.drift) {
        out[0] = px;
        out[1] = py;
        return out;
      }
      nx = world.simplex.noise3(px * phys.FS, py * phys.FS, world.time * phys.FT);
      ny = world.simplex.noise3(
        px * phys.FS + phys.PATH_OX,
        py * phys.FS + phys.PATH_OY,
        world.time * phys.FT + phys.PATH_OZ
      );
      out[0] = px + amp * nx;
      out[1] = py + amp * ny;
      return out;
    }

    function sampleXY(idx, out) {
      if (sw.noiseLut) return world.renderXY(idx, out);
      return sampleDirect(idx, out);
    }

    function resetDirtyFull() {
      dirtyX0 = 0;
      dirtyY0 = 0;
      dirtyX1 = w;
      dirtyY1 = h;
    }

    function resetDirtyEmpty() {
      dirtyX0 = w;
      dirtyY0 = h;
      dirtyX1 = 0;
      dirtyY1 = 0;
    }

    function addDirty(ix, iy) {
      var x0 = ix;
      var y0 = iy;
      var x1 = ix + cell;
      var y1 = iy + cell;
      if (x0 < 0) x0 = 0;
      if (y0 < 0) y0 = 0;
      if (x1 > w) x1 = w;
      if (y1 > h) y1 = h;
      if (x1 <= x0 || y1 <= y0) return;
      if (x0 < dirtyX0) dirtyX0 = x0;
      if (y0 < dirtyY0) dirtyY0 = y0;
      if (x1 > dirtyX1) dirtyX1 = x1;
      if (y1 > dirtyY1) dirtyY1 = y1;
    }

    function blockOrigin(px, py) {
      return [Math.round(px) - half, Math.round(py) - half];
    }

    function stampColor(ix, iy, color) {
      var yy;
      var xx;
      var row;
      var y;
      var x;
      for (y = 0; y < cell; y++) {
        yy = iy + y;
        if (yy < 0 || yy >= h) continue;
        row = yy * w;
        for (x = 0; x < cell; x++) {
          xx = ix + x;
          if (xx < 0 || xx >= w) continue;
          pixels[row + xx] = color;
        }
      }
    }

    function restoreStamp(ix, iy) {
      var yy;
      var xx;
      var row;
      var y;
      var x;
      for (y = 0; y < cell; y++) {
        yy = iy + y;
        if (yy < 0 || yy >= h) continue;
        row = yy * w;
        for (x = 0; x < cell; x++) {
          xx = ix + x;
          if (xx < 0 || xx >= w) continue;
          pixels[row + xx] = base[row + xx];
        }
      }
    }

    function finishDirty() {
      var dw;
      var dh;
      if (!sw.dirtyRect) {
        lastStats.dirtyX = 0;
        lastStats.dirtyY = 0;
        lastStats.dirtyW = w;
        lastStats.dirtyH = h;
        lastStats.upload_px = w * h;
        lastStats.full_px = w * h;
        return;
      }
      if (dirtyX1 <= dirtyX0 || dirtyY1 <= dirtyY0) {
        lastStats.dirtyX = 0;
        lastStats.dirtyY = 0;
        lastStats.dirtyW = 0;
        lastStats.dirtyH = 0;
        lastStats.upload_px = 0;
        lastStats.full_px = w * h;
        return;
      }
      dw = dirtyX1 - dirtyX0;
      dh = dirtyY1 - dirtyY0;
      lastStats.dirtyX = dirtyX0;
      lastStats.dirtyY = dirtyY0;
      lastStats.dirtyW = dw;
      lastStats.dirtyH = dh;
      lastStats.upload_px = dw * dh;
      lastStats.full_px = w * h;
    }

    function bakeStatics() {
      var i;
      var origin;
      pixels.fill(bg);
      for (i = 0; i < n; i++) {
        if (role[i] !== ROLE_STATIC) continue;
        sampleXY(i, tmp);
        origin = blockOrigin(tmp[0], tmp[1]);
        stampColor(origin[0], origin[1], ink);
        lastX[i] = tmp[0];
        lastY[i] = tmp[1];
        lastIx[i] = origin[0];
        lastIy[i] = origin[1];
        seeded[i] = 1;
      }
      base.set(pixels);
    }

    function shouldSample(idx) {
      if (role[idx] === ROLE_STATIC) return false;
      if (!sw.edgeStagger || role[idx] !== ROLE_EDGE) return true;
      return (frameIndex & 1) === (idx & 1);
    }

    function seedDynamics() {
      var i;
      var origin;
      lastStats.drew = 0;
      lastStats.erased = 0;
      lastStats.sampled = 0;
      lastStats.held = 0;
      if (sw.dirtyRect) resetDirtyEmpty();
      else resetDirtyFull();
      for (i = 0; i < n; i++) {
        if (role[i] === ROLE_STATIC) continue;
        sampleXY(i, tmp);
        origin = blockOrigin(tmp[0], tmp[1]);
        stampColor(origin[0], origin[1], ink);
        lastX[i] = tmp[0];
        lastY[i] = tmp[1];
        lastIx[i] = origin[0];
        lastIy[i] = origin[1];
        seeded[i] = 1;
        lastStats.drew += 1;
        lastStats.sampled += 1;
        if (sw.dirtyRect) addDirty(origin[0], origin[1]);
      }
      finishDirty();
    }

    function prepare() {
      classify();
      if (sw.bakeCenter) bakeStatics();
      else {
        pixels.fill(bg);
        base.fill(bg);
      }
      seedDynamics();
      ready = true;
      frameIndex = 0;
      return lastStats;
    }

    function blitFull() {
      var i;
      var origin;
      pixels.fill(bg);
      lastStats.drew = 0;
      lastStats.erased = 0;
      lastStats.sampled = 0;
      lastStats.held = 0;
      resetDirtyFull();
      for (i = 0; i < n; i++) {
        if (shouldSample(i) || !seeded[i]) {
          sampleXY(i, tmp);
          lastStats.sampled += 1;
        } else {
          tmp[0] = lastX[i];
          tmp[1] = lastY[i];
          lastStats.held += 1;
        }
        origin = blockOrigin(tmp[0], tmp[1]);
        stampColor(origin[0], origin[1], ink);
        lastX[i] = tmp[0];
        lastY[i] = tmp[1];
        lastIx[i] = origin[0];
        lastIy[i] = origin[1];
        seeded[i] = 1;
        lastStats.drew += 1;
      }
      finishDirty();
    }

    function blitIncremental() {
      var i;
      var origin;
      lastStats.drew = 0;
      lastStats.erased = 0;
      lastStats.sampled = 0;
      lastStats.held = 0;
      if (sw.dirtyRect) resetDirtyEmpty();
      else resetDirtyFull();
      for (i = 0; i < n; i++) {
        if (role[i] === ROLE_STATIC) continue;
        if (!seeded[i]) continue;
        restoreStamp(lastIx[i], lastIy[i]);
        lastStats.erased += 1;
        if (sw.dirtyRect) addDirty(lastIx[i], lastIy[i]);
      }
      for (i = 0; i < n; i++) {
        if (role[i] === ROLE_STATIC) continue;
        if (shouldSample(i) || !seeded[i]) {
          sampleXY(i, tmp);
          lastStats.sampled += 1;
        } else {
          tmp[0] = lastX[i];
          tmp[1] = lastY[i];
          lastStats.held += 1;
        }
        origin = blockOrigin(tmp[0], tmp[1]);
        stampColor(origin[0], origin[1], ink);
        lastX[i] = tmp[0];
        lastY[i] = tmp[1];
        lastIx[i] = origin[0];
        lastIy[i] = origin[1];
        seeded[i] = 1;
        lastStats.drew += 1;
        if (sw.dirtyRect) addDirty(origin[0], origin[1]);
      }
      finishDirty();
    }

    function blit() {
      if (!ready) prepare();
      else if (!sw.bakeCenter) blitFull();
      else blitIncremental();
      frameIndex += 1;
      return lastStats;
    }

    function inkCount() {
      var i;
      var c = 0;
      for (i = 0; i < pixels.length; i++) {
        if (pixels[i] === ink) c += 1;
      }
      return c;
    }

    classify();

    return {
      n: n,
      width: w,
      height: h,
      cell: cell,
      switches: sw,
      pixels: pixels,
      base: base,
      role: role,
      ink: ink,
      bg: bg,
      get frameIndex() {
        return frameIndex;
      },
      get ready() {
        return ready;
      },
      counts: function counts() {
        return { static: nStatic, move: nMove, edge: nEdge };
      },
      lastStats: lastStats,
      classify: classify,
      prepare: prepare,
      blit: blit,
      sampleXY: sampleXY,
      inkCount: inkCount,
      bytes: function bytes() {
        return new Uint8Array(pixels.buffer, pixels.byteOffset, pixels.byteLength);
      }
    };
  }

  var api = {
    CELL: CELL,
    BAKE_R: BAKE_R,
    EDGE_R: EDGE_R,
    INK_R: INK_R,
    INK_G: INK_G,
    INK_B: INK_B,
    BG_R: BG_R,
    BG_G: BG_G,
    BG_B: BG_B,
    SWITCH_DEFAULTS: SWITCH_DEFAULTS,
    mergeSwitches: mergeSwitches,
    packRGBA: packRGBA,
    createRenderer: createRenderer
  };

  root.NFRadialRender = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
