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
  var container = null;
  var particles = [];
  var count = 0;
  var lastPointsId = "";
  var lastPalette = null;
  var tickHooked = false;
  var userTick = null;
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
  }

  function rebuild(state) {
    var n = state.n | 0;
    var palette = state.palette || [];
    var i;
    var p;
    var idx;
    clearParticles();
    container = new PIXI.ParticleContainer({
      texture: texture,
      dynamicProperties: { position: true, color: false }
    });
    container.boundsArea = new PIXI.Rectangle(0, 0, viewW, viewH);
    particles = new Array(n);
    for (i = 0; i < n; i++) {
      idx = state.pid ? state.pid[i] | 0 : 0;
      if (idx < 0) idx = 0;
      if (palette.length && idx >= palette.length) idx = idx % palette.length;
      p = new PIXI.Particle({
        texture: texture,
        x: state.x ? state.x[i] : 0,
        y: state.y ? state.y[i] : 0,
        tint: palette[idx] ? parseHex(palette[idx]) : 0xffffff,
        alpha: 1,
        anchorX: 0.5,
        anchorY: 0.5,
        scaleX: scale,
        scaleY: scale
      });
      container.addParticle(p);
      particles[i] = p;
    }
    container.update();
    app.stage.addChild(container);
    count = n;
    lastPalette = palette;
    lastPointsId = state.pointsId || "";
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
    if (!ready || contextLost || !state) return;
    n = state.n | 0;
    if (
      n !== count ||
      state.palette !== lastPalette ||
      (state.pointsId || "") !== lastPointsId
    ) {
      rebuild(state);
      return;
    }
    for (i = 0; i < n; i++) {
      particles[i].x = state.x[i];
      particles[i].y = state.y[i];
    }
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
      softDot: softSize
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
