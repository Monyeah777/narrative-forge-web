/* B4: 12k sprite blit off the main thread. Canvas 2D only. */
var oc = null;
var ctx = null;
var sprites = null;
var cell = 16;
var dpr = 1;
var W = 1;
var H = 1;

function ensureCanvas(w, h) {
  if (!oc || oc.width !== w || oc.height !== h) {
    oc = new OffscreenCanvas(w, h);
    ctx = oc.getContext("2d", { alpha: true });
  }
  W = w;
  H = h;
}

onmessage = function (e) {
  var d = e.data;
  var x, y, pid, i, n, half, dx, dy, spr, bmp, p;
  if (!d) return;
  if (d.t === "init") {
    dpr = d.dpr || 1;
    cell = d.cell || 16;
    sprites = d.sprites || null;
    ensureCanvas(d.w || 1, d.h || 1);
    postMessage({ t: "ready" });
    return;
  }
  if (d.t === "resize") {
    dpr = d.dpr || dpr;
    cell = d.cell || cell;
    ensureCanvas(d.w, d.h);
    return;
  }
  if (d.t === "sprites") {
    sprites = d.sprites || sprites;
    cell = d.cell || cell;
    return;
  }
  if (d.t !== "frame" || !ctx || !sprites) return;
  x = new Float32Array(d.x);
  y = new Float32Array(d.y);
  pid = new Uint16Array(d.pid);
  n = x.length;
  half = cell * 0.5;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, W, H);
  ctx.globalAlpha = 1;
  ctx.imageSmoothingEnabled = false;
  for (i = 0; i < n; i++) {
    p = pid[i];
    spr = sprites[p];
    if (!spr) continue;
    dx = (x[i] * dpr - half) | 0;
    dy = (y[i] * dpr - half) | 0;
    if (dx < -cell || dy < -cell || dx > W || dy > H) continue;
    ctx.drawImage(spr, dx, dy);
  }
  bmp = oc.transferToImageBitmap();
  postMessage({ t: "frame", bitmap: bmp }, [bmp]);
};
