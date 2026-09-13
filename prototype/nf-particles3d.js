/**
 * NF 立体粒子引擎（WebGL2，零依赖）· 两种模式
 *
 * ① 浮雕模式（relief，主用）：把**原来的平面粒子画作**变成 3D —— 同一批粒子、同一套调色板配色；
 *    x/y = 画作归一坐标（等比，不拉伸），z = 该粒子颜色的亮度（明处凸起、暗处凹陷）→ 画作变成浮雕。
 *    动态：z 方向呼吸 + ±12° 轻微摆动（保持可读，不眩晕）；用户可拖拽自由环绕、滚轮缩放。
 * ② 抽象模式（abstract，独立演示页用）：涡旋 + 3D 正弦势场 curl 抖动（curl noise 同 Bridson 2007）。
 *
 * 共同技法：点精灵 + 尺寸衰减（gl_PointSize ∝ 1/w）、加法混合 + 片元软圆点（顺序无关、免排序）、
 *           深度雾；每帧只改 uniform、单次 draw call（CPU/帧≈0）。
 * 健壮性：上下文丢失时停绘，webglcontextrestored 里重建 program/buffer/uniform；
 *        切换画作/取消挂载都释放 WebGL 上下文。
 *
 * API：NF3D.mount(canvas, opts) → handle
 *      handle.setPainting(record|null)   传画作记录（{points, palette, w, h}，points 可为对象数组或扁平三元组）
 *      handle.setMode("relief"|"abstract")
 *      handle.setPaused(bool) / setDepth(v) / setSize(v) / state() / dispose()
 */
(function (root) {
  "use strict";

  var VS_ABS = "#version 300 es\n" +
    "precision highp float;\n" +
    "layout(location=0) in vec2 aGrid;\n" +
    "layout(location=1) in vec2 aRand;\n" +
    "uniform mat4 uVP;\n" +
    "uniform float uTime;\n" +
    "uniform float uSize;\n" +
    "uniform float uPR;\n" +
    "uniform float uPaused;\n" +
    "out vec3 vColor;\n" +
    "out float vAlpha;\n" +
    "vec3 curlNoise(vec3 p, float t) {\n" +
    "  float k = 1.35;\n" +
    "  vec3 q = p * k + vec3(t * 0.25, t * 0.19, t * 0.31);\n" +
    "  return vec3(cos(q.z), cos(q.x), cos(q.y)) * k;\n" +
    "}\n" +
    "void main() {\n" +
    "  float t = uTime * (1.0 - uPaused);\n" +
    "  float ringR = 1.15 + aGrid.x * 0.95;\n" +
    "  float ringA = aGrid.y + aRand.x * 0.6;\n" +
    "  float lift = aRand.y * 2.0 - 1.0;\n" +
    "  lift = sign(lift) * pow(abs(lift), 1.6) * 1.05;\n" +
    "  vec3 base = vec3(cos(ringA) * ringR, lift, sin(ringA) * ringR);\n" +
    "  float spin = (0.55 / (0.55 + ringR * 0.55) + 0.12 * lift) * 1.25;\n" +
    "  float a2 = ringA + t * spin;\n" +
    "  vec3 p = vec3(cos(a2) * ringR, lift, sin(a2) * ringR);\n" +
    "  float breath = 0.55 + 0.45 * sin(t * 0.6);\n" +
    "  p += curlNoise(base, t) * (0.16 + 0.20 * aGrid.x) * breath;\n" +
    "  p.y += 0.10 * sin(t * 0.4 + ringA * 2.0);\n" +
    "  vec4 clip = uVP * vec4(p, 1.0);\n" +
    "  gl_Position = clip;\n" +
    "  float w = max(clip.w, 0.001);\n" +
    "  gl_PointSize = clamp(uSize * uPR / w, 0.7, 7.0 * uPR);\n" +
    "  float hue = clamp((ringR - 1.0) / 1.6, 0.0, 1.0);\n" +
    "  vec3 col = mix(vec3(1.0, 0.62, 0.34), vec3(0.36, 0.74, 1.00), hue);\n" +
    "  col = mix(col, vec3(1.0), 0.35 * smoothstep(0.65, 1.0, abs(lift)));\n" +
    "  vColor = col;\n" +
    "  float fog = smoothstep(9.0, 3.0, w);\n" +
    "  vAlpha = (0.030 + 0.115 * fog) * (0.45 + 0.55 * aRand.x);\n" +
    "}\n";

  /* 浮雕：同批粒子 + 原配色；z = 亮度（明凸暗凹）→ 平面画作立体化 */
  var VS_RELIEF = "#version 300 es\n" +
    "precision highp float;\n" +
    "layout(location=0) in vec3 aPos;\n" +
    "layout(location=1) in vec4 aCol;\n" +
    "uniform mat4 uVP;\n" +
    "uniform float uTime;\n" +
    "uniform float uSize;\n" +
    "uniform float uPR;\n" +
    "uniform float uPaused;\n" +
    "uniform float uDepth;\n" +
    "uniform float uFlip;\n" +   /* 浮雕极性：+1 = 明凸暗凹，-1 = 明凹暗凸（周期性交叠） */
    "out vec3 vColor;\n" +
    "out float vAlpha;\n" +
    "void main() {\n" +
    "  float t = uTime * (1.0 - uPaused);\n" +
    "  vec3 p = aPos;\n" +
    "  p.z *= uFlip;\n" +                       /* 极性交叠：明凸暗凹 ⇄ 明凹暗凸 */
    "  p.z += uDepth * 0.22 * sin(t * 0.55 + aPos.x * 3.1 + aPos.y * 2.3);\n" +
    "  float swing = 0.22 * sin(t * 0.18);\n" +
    "  float cs = cos(swing);\n" +
    "  float sn = sin(swing);\n" +
    "  p = vec3(p.x * cs + p.z * sn, p.y, -p.x * sn + p.z * cs);\n" +
    "  vec4 clip = uVP * vec4(p, 1.0);\n" +
    "  gl_Position = clip;\n" +
    "  float w = max(clip.w, 0.001);\n" +
    /* 浮雕明暗 + 尺寸：凸起（z 大）更亮、点也更大 —— 加强立体读感 */
    "  float lumN = clamp(aPos.z * uFlip / max(uDepth, 0.001) + 0.5, 0.0, 1.0);\n" +
    /* 凸起处点更大一点：进一步强化立体读感 */
    "  gl_PointSize = clamp(uSize * uPR * (0.85 + 0.5 * lumN) / w, 0.6, 5.0 * uPR);\n" +
    "  vColor = aCol.rgb * (0.62 + 0.62 * lumN);\n" +
    "  vAlpha = aCol.a * (0.42 + 0.58 * smoothstep(4.2, 1.5, w));\n" +
    "}\n";

  var FS = "#version 300 es\n" +
    "precision highp float;\n" +
    "in vec3 vColor;\n" +
    "in float vAlpha;\n" +
    "out vec4 outColor;\n" +
    "void main() {\n" +
    "  vec2 d = gl_PointCoord - vec2(0.5);\n" +
    "  float r2 = dot(d, d);\n" +
    "  if (r2 > 0.25) discard;\n" +
    "  float a = smoothstep(0.25, 0.02, r2) * vAlpha;\n" +
    "  outColor = vec4(vColor * a, a);\n" +
    "}\n";

  function hexToRgb(hex) {
    var h = String(hex || "").replace("#", "");
    if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    var v = parseInt(h, 16);
    if (!isFinite(v)) return [0.6, 0.6, 0.6];
    return [((v >> 16) & 255) / 255, ((v >> 8) & 255) / 255, (v & 255) / 255];
  }

  function mount(canvas, opts) {
    opts = opts || {};
    var gl = canvas.getContext("webgl2", { antialias: false, alpha: false });
    if (!gl) throw new Error("WebGL2 unavailable");
    var diag = [];
    function chk(tag) {
      var e = gl.getError();
      if (e) diag.push(tag + ":" + e);
      root.__nfP3dDiag = diag;
    }
    var ctxLost = false;
    var disposed = false;
    var mode = opts.mode === "abstract" ? "abstract" : "relief";
    var painting = null;          /* {points(flat), palette, w, h, id, count} */
    var lastRecord = null;        /* 最近一次喂入的画作（改深度时按新幅度重传缓冲） */
    var nAbs = Math.max(1000, Math.min(400000, opts.count || 120000));
    var nRelief = 0;

    /* ---- 抽象模式数据 ---- */
    var grid = new Float32Array(nAbs * 2);
    var rand = new Float32Array(nAbs * 2);
    var rngState = 0x9e3779b9;
    function rnd() {
      rngState ^= rngState << 13;
      rngState ^= rngState >>> 17;
      rngState ^= rngState << 5;
      return ((rngState >>> 0) % 100000) / 100000;
    }
    var i;
    for (i = 0; i < nAbs; i++) {
      grid[i * 2] = Math.pow(rnd(), 0.65);
      grid[i * 2 + 1] = rnd() * Math.PI * 2;
      rand[i * 2] = rnd();
      rand[i * 2 + 1] = rnd();
    }

    /* ---- 浮雕模式数据（由 setPainting 填） ---- */
    var pos = null;
    var col = null;

    function sh(type, src) {
      var s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error("shader: " + gl.getShaderInfoLog(s));
      return s;
    }
    function link(vs) {
      var p = gl.createProgram();
      gl.attachShader(p, sh(gl.VERTEX_SHADER, vs));
      gl.attachShader(p, sh(gl.FRAGMENT_SHADER, FS));
      gl.linkProgram(p);
      if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error("link: " + gl.getProgramInfoLog(p));
      return p;
    }
    function attr(buf, loc, comps, data) {
      var b = gl.createBuffer();
      gl.bindBuffer(gl.ARRAY_BUFFER, b);
      if (data) gl.bufferData(gl.ARRAY_BUFFER, data, gl.STATIC_DRAW);
      gl.enableVertexAttribArray(loc);
      gl.vertexAttribPointer(loc, comps, gl.FLOAT, false, 0, 0);
      return b;
    }
    var progAbs = null;
    var progRelief = null;
    var UAbs = null;
    var UR = null;
    var bGrid = null;
    var bRand = null;
    var bPos = null;
    var bCol = null;

    function buildGL() {
      progAbs = link(VS_ABS);
      progRelief = link(VS_RELIEF);
      gl.useProgram(progAbs);
      bGrid = attr(null, 0, 2, grid);
      bRand = attr(null, 1, 2, rand);
      UAbs = {
        vp: gl.getUniformLocation(progAbs, "uVP"),
        time: gl.getUniformLocation(progAbs, "uTime"),
        size: gl.getUniformLocation(progAbs, "uSize"),
        pr: gl.getUniformLocation(progAbs, "uPR"),
        paused: gl.getUniformLocation(progAbs, "uPaused")
      };
      gl.useProgram(progRelief);
      bPos = attr(null, 0, 3, pos);
      bCol = attr(null, 1, 4, col);
      UR = {
        vp: gl.getUniformLocation(progRelief, "uVP"),
        time: gl.getUniformLocation(progRelief, "uTime"),
        size: gl.getUniformLocation(progRelief, "uSize"),
        pr: gl.getUniformLocation(progRelief, "uPR"),
        paused: gl.getUniformLocation(progRelief, "uPaused"),
        depth: gl.getUniformLocation(progRelief, "uDepth"),
        flip: gl.getUniformLocation(progRelief, "uFlip")
      };
      gl.disable(gl.DEPTH_TEST);
      gl.enable(gl.BLEND);
      gl.blendFunc(gl.ONE, gl.ONE);
      gl.clearColor(0.02, 0.024, 0.039, 1);
      chk("build");
    }
    function onLost(e) {
      e.preventDefault();
      ctxLost = true;
      handle.lost += 1;
    }
    function onRestored() {
      ctxLost = false;
      handle.restored += 1;
      buildGL();
    }
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);
    buildGL();

    /* 画作记录 → 浮雕缓冲：x/y 等比（不拉伸），z = 亮度 */
    function setPainting(rec) {
      if (!rec || !rec.points || !rec.points.length) {
        painting = null;
        nRelief = 0;
        return 0;
      }
      var pts = rec.points;
      var pal = rec.palette || [];
      var cnt = rec.count || pts.length;
      /* 三种载体都要认：① [x,y,i] 三元组数组（window.__nfPoints.points 就是这种）② 扁平数字数组
         ③ {x,y,i} 对象数组。★ 之前只按扁平解析 → pts[k].x 全 undefined → 坐标/z 变 NaN、浮雕是平的。 */
      var first = pts[0];
      var flat = typeof first === "number";
      var packed = !flat && first != null && typeof first.length === "number";
      var n = flat ? Math.floor(pts.length / 3) : pts.length;
      var ar = rec.w > 0 && rec.h > 0 ? rec.w / rec.h : 0.78;
      var P = new Float32Array(n * 3);
      var C = new Float32Array(n * 4);
      var k;
      var x;
      var y;
      var pi;
      var rgb;
      var lum;
      for (k = 0; k < n; k++) {
        if (flat) {
          x = pts[k * 3];
          y = pts[k * 3 + 1];
          pi = pts[k * 3 + 2] | 0;
        } else if (packed) {
          x = pts[k][0];
          y = pts[k][1];
          pi = pts[k][2] | 0;
        } else {
          x = pts[k].x;
          y = pts[k].y;
          pi = pts[k].i | 0;
        }
        rgb = hexToRgb(pal[pi]);
        lum = 0.2126 * rgb[0] + 0.7152 * rgb[1] + 0.0722 * rgb[2];
        /* 世界坐标：高 1 单位、宽按画作纵横比；z 由亮度给出（-0.5→+0.5 归一，实际深度由 uDepth 缩放） */
        P[k * 3] = (x - 0.5) * ar;
        P[k * 3 + 1] = (0.5 - y);
        /* 浮雕高度：明处凸起 / 暗处凹陷；幅度由 depth 缩放（?p3ddepth= 可调） */
        P[k * 3 + 2] = (lum - 0.5) * depth;
        C[k * 4] = rgb[0];
        C[k * 4 + 1] = rgb[1];
        C[k * 4 + 2] = rgb[2];
        /* 加法混合：单点 alpha 压低（粒子多、叠加快），亮度靠密度堆 */
        C[k * 4 + 3] = 0.30;
      }
      painting = { id: rec.id, w: rec.w, h: rec.h, count: cnt, points: n };
      lastRecord = rec;
      pos = P;
      col = C;
      nRelief = n;
      if (gl && !ctxLost) {
        gl.bindBuffer(gl.ARRAY_BUFFER, bPos);
        gl.bufferData(gl.ARRAY_BUFFER, pos, gl.STATIC_DRAW);
        gl.bindBuffer(gl.ARRAY_BUFFER, bCol);
        gl.bufferData(gl.ARRAY_BUFFER, col, gl.STATIC_DRAW);
        chk("paint");
      }
      return n;
    }

    /* 视角：作者 2026-09-13 先要环绕、随后「还是不环绕了吧」→ 默认 autoYaw=0（不自己转，可拖拽），
       动态交给浮雕极性交叠（明凸暗凹 ⇄ 明凹暗凸）+ 呼吸/轻摆。?p3dorbit= 可再开环绕。 */
    var cam = { yaw: 0.62, pitch: 0.34, dist: 2.45, autoYaw: opts.orbit == null ? 0 : opts.orbit };
    var paused = 0;
    var depth = opts.depth == null ? 0.95 : opts.depth;
    var pointSize = opts.pointSize == null ? 3.6 : opts.pointSize;
    /* 浮雕极性交叠周期（秒）：默认 18s（9s 正向 / 9s 反向）；0 = 固定明凸暗凹 */
    var flipPeriod = opts.flipSeconds == null ? 18 : opts.flipSeconds;
    var flipNow = 1;
    var dragging = false;
    var lastX = 0;
    var lastY = 0;
    function onDown(e) {
      dragging = true;
      lastX = e.clientX;
      lastY = e.clientY;
      if (canvas.setPointerCapture) canvas.setPointerCapture(e.pointerId);
    }
    function onUp() {
      dragging = false;
    }
    function onMove(e) {
      if (!dragging) return;
      cam.yaw -= (e.clientX - lastX) * 0.005;
      cam.pitch = Math.max(-1.1, Math.min(1.1, cam.pitch + (e.clientY - lastY) * 0.004));
      lastX = e.clientX;
      lastY = e.clientY;
    }
    function onWheel(e) {
      if (!opts.captureWheel) return;
      e.preventDefault();
      cam.dist = Math.max(1.2, Math.min(7, cam.dist * (1 + Math.sign(e.deltaY) * 0.08)));
    }
    canvas.addEventListener("pointerdown", onDown);
    canvas.addEventListener("pointerup", onUp);
    canvas.addEventListener("pointermove", onMove);
    canvas.addEventListener("wheel", onWheel, { passive: false });

    function perspective(fovy, aspect, near, far) {
      var f = 1 / Math.tan(fovy / 2);
      return new Float32Array([
        f / aspect, 0, 0, 0,
        0, f, 0, 0,
        0, 0, (far + near) / (near - far), -1,
        0, 0, (2 * far * near) / (near - far), 0
      ]);
    }
    function lookAt(eye, target, up) {
      var zx = eye[0] - target[0];
      var zy = eye[1] - target[1];
      var zz = eye[2] - target[2];
      var zl = Math.hypot(zx, zy, zz) || 1;
      zx /= zl; zy /= zl; zz /= zl;
      var xx = up[1] * zz - up[2] * zy;
      var xy = up[2] * zx - up[0] * zz;
      var xz = up[0] * zy - up[1] * zx;
      var xl = Math.hypot(xx, xy, xz) || 1;
      xx /= xl; xy /= xl; xz /= xl;
      var yx = zy * xz - zz * xy;
      var yy = zz * xx - zx * xz;
      var yz = zx * xy - zy * xx;
      return new Float32Array([
        xx, yx, zx, 0,
        xy, yy, zy, 0,
        xz, yz, zz, 0,
        -(xx * eye[0] + xy * eye[1] + xz * eye[2]),
        -(yx * eye[0] + yy * eye[1] + yz * eye[2]),
        -(zx * eye[0] + zy * eye[1] + zz * eye[2]),
        1
      ]);
    }
    function mul(a, b) {
      var o = new Float32Array(16);
      for (var r = 0; r < 4; r++) {
        for (var c = 0; c < 4; c++) {
          var s = 0;
          for (var k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k];
          o[c * 4 + r] = s;
        }
      }
      return o;
    }
    function camMat() {
      var cy = Math.cos(cam.pitch);
      var eye = [
        Math.sin(cam.yaw) * cy * cam.dist,
        Math.sin(cam.pitch) * cam.dist,
        Math.cos(cam.yaw) * cy * cam.dist
      ];
      var target = mode === "relief" ? [0, 0, depth * 0.05] : [0, 0, 0];
      return mul(perspective(0.85, canvas.width / canvas.height, 0.1, 60), lookAt(eye, target, [0, 1, 0]));
    }

    var dpr = 1;
    function resize() {
      dpr = Math.min(2, root.devicePixelRatio || 1);
      var w = Math.max(1, Math.floor(canvas.clientWidth * dpr));
      var h = Math.max(1, Math.floor(canvas.clientHeight * dpr));
      if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
      }
    }

    var t0 = performance.now();
    var last = t0;
    var fpsAcc = 0;
    var fpsN = 0;
    var rafId = 0;
    function frame(now) {
      if (disposed) return;
      var dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      var t = (now - t0) / 1000;
      if (ctxLost) {
        rafId = requestAnimationFrame(frame);
        return;
      }
      if (!dragging && cam.autoYaw) cam.yaw += cam.autoYaw * dt * (1 - paused);
      resize();
      gl.viewport(0, 0, canvas.width, canvas.height);
      gl.clear(gl.COLOR_BUFFER_BIT);
      var vp = camMat();
      if (mode === "relief" && nRelief > 0) {
        gl.useProgram(progRelief);
        gl.bindBuffer(gl.ARRAY_BUFFER, bPos);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 3, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, bCol);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 4, gl.FLOAT, false, 0, 0);
        gl.uniformMatrix4fv(UR.vp, false, vp);
        gl.uniform1f(UR.time, t);
        gl.uniform1f(UR.size, pointSize);
        gl.uniform1f(UR.pr, dpr);
        gl.uniform1f(UR.paused, paused);
        gl.uniform1f(UR.depth, depth);
        flipNow = flipPeriod > 0 ? Math.cos((2 * Math.PI * t) / flipPeriod) : 1;
        gl.uniform1f(UR.flip, flipNow);
        gl.drawArrays(gl.POINTS, 0, nRelief);
      } else {
        gl.useProgram(progAbs);
        gl.bindBuffer(gl.ARRAY_BUFFER, bGrid);
        gl.enableVertexAttribArray(0);
        gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
        gl.bindBuffer(gl.ARRAY_BUFFER, bRand);
        gl.enableVertexAttribArray(1);
        gl.vertexAttribPointer(1, 2, gl.FLOAT, false, 0, 0);
        gl.uniformMatrix4fv(UAbs.vp, false, vp);
        gl.uniform1f(UAbs.time, t);
        gl.uniform1f(UAbs.size, 14);
        gl.uniform1f(UAbs.pr, dpr);
        gl.uniform1f(UAbs.paused, paused);
        gl.drawArrays(gl.POINTS, 0, nAbs);
      }
      fpsAcc += dt;
      fpsN += 1;
      if (fpsAcc >= 0.5) {
        handle.fps = fpsN / fpsAcc;
        fpsAcc = 0;
        fpsN = 0;
      }
      rafId = requestAnimationFrame(frame);
    }
    rafId = requestAnimationFrame(frame);

    var handle = {
      n: nAbs,
      fps: 0,
      lost: 0,
      restored: 0,
      diag: diag,
      setPainting: function (rec) {
        var n = setPainting(rec);
        if (n > 0) mode = "relief";
        return n;
      },
      setMode: function (m) {
        mode = m === "abstract" ? "abstract" : "relief";
        cam.yaw = mode === "relief" ? 0.62 : 0.6;
        cam.pitch = mode === "relief" ? 0.34 : 0.34;
        cam.dist = mode === "relief" ? 2.45 : 5.2;
        /* 浮雕默认不自动环绕（作者 2026-09-13「还是不环绕了吧」）；抽象模式仍慢转 */
        cam.autoYaw = mode === "relief" ? 0 : 0.045;
        return mode;
      },
      setPaused: function (p) {
        paused = p ? 1 : 0;
      },
      setDepth: function (d) {
        depth = Math.max(0, Math.min(1.5, +d || 0));
        /* 浮雕高度是烘进顶点缓冲的 → 改幅度要重传（50k×3 float ≈ 2ms） */
        if (lastRecord) setPainting(lastRecord);
        return depth;
      },
      setSize: function (s) {
        pointSize = Math.max(0.5, Math.min(12, +s || 0));
        return pointSize;
      },
      /* 环绕速度（rad/s；0 = 静止，仅手动拖拽）。?p3dorbit=<°/s> 亦可 */
      setOrbit: function (radPerSec) {
        cam.autoYaw = Math.max(-2, Math.min(2, +radPerSec || 0));
        return cam.autoYaw;
      },
      /* 浮雕极性交叠周期（秒）：0 = 固定明凸暗凹；?p3dflip=<s> 同效 */
      setFlip: function (sec) {
        flipPeriod = Math.max(0, +sec || 0);
        return flipPeriod;
      },
      state: function () {
        return {
          mode: mode,
          paintingId: painting ? painting.id : "",
          reliefN: nRelief,
          absN: nAbs,
          fps: +handle.fps.toFixed(1),
          paused: paused,
          depth: depth,
          yaw: cam.yaw,
          orbit: cam.autoYaw,
          flipPeriod: flipPeriod,
          flipNow: +flipNow.toFixed(3),
          dist: cam.dist,
          lost: handle.lost,
          restored: handle.restored,
          diag: diag
        };
      },
      dispose: function () {
        disposed = true;
        if (rafId) cancelAnimationFrame(rafId);
        canvas.removeEventListener("webglcontextlost", onLost);
        canvas.removeEventListener("webglcontextrestored", onRestored);
        canvas.removeEventListener("pointerdown", onDown);
        canvas.removeEventListener("pointerup", onUp);
        canvas.removeEventListener("pointermove", onMove);
        canvas.removeEventListener("wheel", onWheel);
        var lose = gl.getExtension("WEBGL_lose_context");
        if (lose) lose.loseContext();
      }
    };
    if (mode === "abstract") handle.setMode("abstract");
    else handle.setMode("relief");
    return handle;
  }

  root.NF3D = { mount: mount, VERSION: "nf-particles3d-v2" };
  if (typeof module !== "undefined" && module.exports) module.exports = root.NF3D;
})(typeof window !== "undefined" ? window : this);
