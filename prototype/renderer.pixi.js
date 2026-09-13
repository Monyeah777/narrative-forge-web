/**
 * NF Pixi renderer (C10 / D.1).
 * Interface: init / resize / draw / start / stop
 * Consumes a frame snapshot only. Does not import physics.
 * Official PixiJS 8.20.1: Application.init, Particle + addParticle, app.canvas.
 */
(function (root) {
  "use strict";

  var app = null;
  var texture = null;
  /* == O2-A == 哑光方块贴图（实心、无渐变）与尘埃容器。卷面 §5.2 M2：尘埃低 alpha、无装配职责。 */
  var blockTexture = null;
  var BLOCK_TEX = 32;
  var dustContainer = null;
  var dustParticles = [];
  var dustBuilt = 0;
  var dustTex = null;
  var DUST_DOT_CSS = 1.6;
  var blockMode = false;
  var container = null;
  var particles = [];
  var count = 0;
  /* == BATCH2-REBUILD == F-04：整柱重建改为分帧摊销；pending 保存未完成的重建游标。
     == BATCH4-DEAD == lastPointsId / lastPalette 已被内容键 lastContentKey 取代，删除。 */
  var pending = null;
  var lastContentKey = "";
  /* 自适应分片：按上一片实测耗时调整片大小，目标单片 ≤ REBUILD_TARGET_MS。
     慢机（软件光栅 / 低端 GPU）自动切小片，快机自动合并，避免写死片长在别的机器上又变成长任务。 */
  var REBUILD_MIN = 1500;
  var REBUILD_MAX = 8000;
  var REBUILD_TARGET_MS = 6;
  var rebuildChunk = 1500;
  var REBUILD_ALPHA0 = 0.35;
  var tickHooked = false;
  var userTick = null;
  var alphaFrame = 0;
  var viewW = 1;
  var viewH = 1;
  var softSize = 128;
  var scale = 3 / 128;
  var contextLost = false;
  var ready = false;

  function parseHex(hex) {
    return parseInt(String(hex).replace("#", ""), 16);
  }

  function makeSoftDot(size) {
    var c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    var ctx = c.getContext("2d");
    var mid = size * 0.5;
    var g = ctx.createRadialGradient(mid, mid, 0, mid, mid, mid);
    g.addColorStop(0, "rgba(255,255,255,1)");
    g.addColorStop(0.35, "rgba(255,255,255,0.85)");
    g.addColorStop(1, "rgba(255,255,255,0)");
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, size, size);
    return PIXI.Texture.from(c);
  }

  /** == O2-A == 哑光方块：实心填充、无渐变；纹理 nearest 采样，配合整数对齐得到硬边像素块。 */
  function makeSquareDot(size) {
    var c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    var ctx = c.getContext("2d");
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, size, size);
    var tex = PIXI.Texture.from(c);
    if (tex.source && "scaleMode" in tex.source) tex.source.scaleMode = "nearest";
    return tex;
  }

  function ensureBlockTexture() {
    if (!blockTexture) blockTexture = makeSquareDot(BLOCK_TEX);
    return blockTexture;
  }

  function clearDust() {
    if (dustContainer) {
      if (typeof dustContainer.removeParticles === "function") {
        dustContainer.removeParticles(0, dustContainer.particleChildren ? dustContainer.particleChildren.length : 0);
      }
      if (app && app.stage && dustContainer.parent) app.stage.removeChild(dustContainer);
      if (typeof dustContainer.destroy === "function") dustContainer.destroy({ children: false, texture: false });
    }
    dustContainer = null;
    dustParticles = [];
    dustBuilt = 0;
  }

  /** 尘埃：独立容器（一次建、之后只写位置）；alpha 用 placeDust 的静态 A，无装配职责。 */
  function ensureDust(state) {
    var dust = state.dust;
    var n = dust.n | 0;
    var i;
    var p;
    if (n <= 0) {
      clearDust();
      return null;
    }
    if (dustContainer && dustBuilt === n) return dustContainer;
    clearDust();
    dustContainer = new PIXI.ParticleContainer({
      texture: texture,
      dynamicProperties: { position: true, color: false }
    });
    dustContainer.boundsArea = new PIXI.Rectangle(0, 0, viewW, viewH);
    dustParticles = new Array(n);
    for (i = 0; i < n; i++) {
      p = new PIXI.Particle({
        texture: texture,
        x: dust.x ? dust.x[i] : 0,
        y: dust.y ? dust.y[i] : 0,
        tint: dust.tint == null ? 0xd6d2c8 : dust.tint,
        alpha: dust.a ? dust.a[i] : 0.12,
        anchorX: 0.5,
        anchorY: 0.5,
        scaleX: DUST_DOT_CSS / softSize,
        scaleY: DUST_DOT_CSS / softSize
      });
      dustContainer.addParticle(p);
      dustParticles[i] = p;
    }
    dustContainer.update();
    app.stage.addChild(dustContainer);
    dustBuilt = n;
    return dustContainer;
  }

  function updateDust(state) {
    var dust = state && state.dust;
    var i;
    if (!dust || !(dust.n > 0)) {
      if (dustContainer) clearDust();
      return;
    }
    if (!ensureDust(state)) return;
    for (i = 0; i < dust.n; i++) {
      dustParticles[i].x = dust.x[i];
      dustParticles[i].y = dust.y[i];
    }
  }

  function clearParticles() {
    if (container) {
      if (typeof container.removeParticles === "function") {
        container.removeParticles(0, container.particleChildren ? container.particleChildren.length : 0);
      }
      if (app && app.stage && container.parent) app.stage.removeChild(container);
      if (typeof container.destroy === "function") container.destroy({ children: false, texture: false });
    }
    container = null;
    particles = [];
    count = 0;
    pending = null;
    lastContentKey = "";
  }

  /* == BATCH2-REBUILD == F-04：内容键 = 点数 + pointsId + 调色板指纹。
     旧实现比较 palette 引用，导致「同画往返」也整柱重建（实测一次 162.7ms 单帧）。 */
  function paletteSig(palette) {
    if (!palette || !palette.length) return "0";
    return palette.length + ":" + palette[0] + ":" + palette[palette.length >> 1] + ":" + palette[palette.length - 1];
  }

  function contentKey(state) {
    /* == O2-A == 方块模式进内容键：?block / ?pixel 现在真的影响贴图与缩放，切换必须重建。 */
    return (state.n | 0) + "|" + (state.pointsId || "") + "|" + paletteSig(state.palette) + "|" + (state.block ? "b" + (state.blockSize || 3) : "s");
  }

  function beginRebuild(state) {
    var n = state.n | 0;
    var palette = state.palette || [];
    /* == O2-A == 哑光方块：实心贴图 + 整数缩放（blockSize 设备像素 / BLOCK_TEX）+ roundPixels。 */
    var useBlock = !!state.block;
    var tex = useBlock ? ensureBlockTexture() : texture;
    var pScale = useBlock ? (state.blockSize || 3) / BLOCK_TEX : scale;
    blockMode = useBlock;
    clearParticles();
    container = new PIXI.ParticleContainer({
      texture: tex,
      dynamicProperties: { position: true, color: false },
      roundPixels: useBlock
    });
    container.boundsArea = new PIXI.Rectangle(0, 0, viewW, viewH);
    container.alpha = REBUILD_ALPHA0;
    app.stage.addChild(container);
    particles = new Array(n);
    count = n;
    lastContentKey = contentKey(state);
    pending = { state: state, n: n, built: 0, tex: tex, pScale: pScale };
  }

  function stepRebuild() {
    var palette;
    var i;
    var p;
    var idx;
    var to;
    var t0;
    var dt;
    var next;
    if (!pending) return;
    palette = pending.state.palette || [];
    to = pending.built + rebuildChunk;
    if (to > pending.n) to = pending.n;
    t0 = performance.now();
    for (i = pending.built; i < to; i++) {
      idx = pending.state.pid ? pending.state.pid[i] | 0 : 0;
      if (idx < 0) idx = 0;
      if (palette.length && idx >= palette.length) idx = idx % palette.length;
      p = new PIXI.Particle({
        texture: pending.tex,
        x: pending.state.x ? pending.state.x[i] : 0,
        y: pending.state.y ? pending.state.y[i] : 0,
        tint: palette[idx] ? parseHex(palette[idx]) : 0xffffff,
        alpha: 1,
        anchorX: 0.5,
        anchorY: 0.5,
        scaleX: pending.pScale,
        scaleY: pending.pScale
      });
      container.addParticle(p);
      particles[i] = p;
    }
    dt = performance.now() - t0;
    if (dt > 0.2) {
      next = (rebuildChunk * REBUILD_TARGET_MS) / dt;
      rebuildChunk = Math.max(REBUILD_MIN, Math.min(REBUILD_MAX, Math.round(next)));
    }
    pending.built = to;
    container.update();
    if (pending.built >= pending.n) {
      /* 首帧降透明 → 收尾一次性回满，避免整柱重建的 150ms+ 单帧尖峰。 */
      container.alpha = 1;
      pending = null;
    }
  }

  function finishRebuild() {
    while (pending) stepRebuild();
  }

  function onContextLost(e) {
    if (e && e.preventDefault) e.preventDefault();
    contextLost = true;
  }

  function onContextRestored() {
    contextLost = false;
  }

  async function init(opts) {
    var parent;
    if (!root.PIXI || !PIXI.Application || !PIXI.ParticleContainer || !PIXI.UPDATE_PRIORITY) {
      throw new Error("PIXI Application / ParticleContainer / UPDATE_PRIORITY missing");
    }
    if (PIXI.UPDATE_PRIORITY.HIGH == null) throw new Error("UPDATE_PRIORITY.HIGH missing");
    opts = opts || {};
    viewW = Math.max(1, opts.width | 0);
    viewH = Math.max(1, opts.height | 0);
    parent = opts.parent;
    app = new PIXI.Application();
    await app.init({
      width: viewW,
      height: viewH,
      backgroundColor: opts.background == null ? 0x050505 : opts.background,
      preference: "webgl",
      antialias: false,
      autoStart: false,
      resolution: opts.resolution || 1,
      autoDensity: true
    });
    if (!app.canvas) throw new Error("app.canvas missing");
    app.canvas.setAttribute("role", "img");
    app.canvas.setAttribute("aria-label", "深空粒子场");
    if (parent) {
      if (opts.before && opts.before.parentNode === parent) parent.insertBefore(app.canvas, opts.before);
      else parent.appendChild(app.canvas);
    }
    app.canvas.addEventListener("webglcontextlost", onContextLost, false);
    app.canvas.addEventListener("webglcontextrestored", onContextRestored, false);
    texture = makeSoftDot(softSize);
    ready = true;
    return api;
  }

  function resize(w, h, resolution) {
    viewW = Math.max(1, w | 0);
    viewH = Math.max(1, h | 0);
    if (!app || !app.renderer) return;
    if (resolution && app.renderer.resolution !== resolution) {
      app.renderer.resolution = resolution;
    }
    app.renderer.resize(viewW, viewH);
    if (container) container.boundsArea = new PIXI.Rectangle(0, 0, viewW, viewH);
  }

  function draw(state) {
    var i;
    var n;
    var built;
    var res;
    var useBlock;
    if (!ready || contextLost || !state) return;
    n = state.n | 0;
    if (pending) {
      /* 重建进行中：先推进这一段，再只刷新已建好的前缀。 */
      stepRebuild();
      built = pending ? pending.built : n;
      for (i = 0; i < built; i++) {
        particles[i].x = state.x[i];
        particles[i].y = state.y[i];
      }
      updateDust(state);
      return;
    }
    if (contentKey(state) !== lastContentKey) {
      beginRebuild(state);
      stepRebuild();
      updateDust(state);
      return;
    }
    /* == O2-A == 方块模式按设备像素整数对齐（resolution = dpr），硬边不做亚像素插值。 */
    useBlock = !!state.block;
    res = app && app.renderer && app.renderer.resolution ? app.renderer.resolution : 1;
    if (useBlock) {
      for (i = 0; i < n; i++) {
        particles[i].x = Math.round(state.x[i] * res) / res;
        particles[i].y = Math.round(state.y[i] * res) / res;
      }
    } else {
      for (i = 0; i < n; i++) {
        particles[i].x = state.x[i];
        particles[i].y = state.y[i];
      }
    }
    /* Volume §9-8: static color + ≤10Hz update() for alpha / tint. */
    if (state.a && container && typeof container.update === "function") {
      alphaFrame += 1;
      if (alphaFrame % 6 === 0) {
        for (i = 0; i < n; i++) particles[i].alpha = state.a[i];
        container.update();
      }
    }
    updateDust(state);
  }

  function onTick(fn) {
    if (!app || !app.ticker) return;
    userTick = fn;
    if (!tickHooked) {
      app.ticker.add(fn, undefined, PIXI.UPDATE_PRIORITY.HIGH);
      tickHooked = true;
    }
  }

  function start() {
    if (app && typeof app.start === "function") app.start();
  }

  function stop() {
    /* == BATCH2-REBUILD == 停表前把未完成的分帧重建一次性收尾，
       避免冻结 / reduced-motion 停 ticker 时留下半柱 + 降透明的画面。 */
    if (pending) finishRebuild();
    if (app && typeof app.stop === "function") app.stop();
  }

  function info() {
    return {
      ready: ready,
      version: root.PIXI && PIXI.VERSION ? PIXI.VERSION : "",
      rendererName: app && app.renderer && app.renderer.name ? String(app.renderer.name) : "",
      count: count,
      tickerStarted: !!(app && app.ticker && app.ticker.started),
      fps: app && app.ticker ? app.ticker.FPS : 0,
      priority: "HIGH",
      contextLost: contextLost,
      usedCanvas: !!(app && app.canvas),
      softDot: softSize,
      /* == O2-A == 像素块 / 尘埃上屏状态（供证据面读取）。 */
      blockMode: blockMode,
      blockTex: BLOCK_TEX,
      dustN: dustBuilt,
      dustDot: DUST_DOT_CSS,
      resolution: app && app.renderer ? app.renderer.resolution : 0
    };
  }

  var api = {
    init: init,
    resize: resize,
    draw: draw,
    onTick: onTick,
    start: start,
    stop: stop,
    info: info,
    get ready() {
      return ready;
    },
    get canvas() {
      return app ? app.canvas : null;
    }
  };

  root.NFPixiRenderer = api;
  if (typeof module !== "undefined" && module.exports) {
    module.exports = api;
  }
})(typeof globalThis !== "undefined" ? globalThis : this);
