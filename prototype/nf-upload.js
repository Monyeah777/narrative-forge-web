/**
 * NF 上传采样 · 主线程（S2）
 *
 * 职责：入口（拖拽 / 选择 / window.nfUpload / 控制台键）→ 校验 → 解码（EXIF + 长边 ≤cap 不放大）
 *       → 交给 nf-upload-worker.js 采样 → 把 record 交回页面注册目标 → 槽位与状态行。
 * 页面侧（index.html）持有：TARGETS / assemble / applyTarget / 放映状态机 —— 本模块不碰这些。
 * 零服务器、零持久化；刷新即清。?upload=0 时页面根本不加载本文件。
 */
(function (root) {
  "use strict";

  var LIMITS = { maxBytes: 20 * 1024 * 1024, minPx: 16, cap: 2400 };
  var slots = [];          /* { id, name, w, h, count, record, ms } */
  var opts = null;
  var worker = null;
  var pending = 0;
  var mode = "idle";       /* idle | sampling | single-stay | queue-ready | rotating */
  var panel = null;        /* 专业投放面板（可见入口：拖放区 + 择取键 + 槽位列表 + 进度条） */
  var slotRows = [];

  /* == 面板样式（单色纪律：只走灰阶 + 细虚线，不引品牌色）== */
  var CSS =
    "#nf-upload-panel{position:fixed;left:20px;bottom:18px;width:300px;z-index:60;display:none;" +
    "font:11px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace;color:rgba(238,236,232,.92);" +
    "background:rgba(10,10,12,.72);border:1px solid rgba(255,255,255,.14);backdrop-filter:blur(6px)}" +
    "#nf-upload-panel.is-open{display:block}" +
    "#nf-upload-panel h2{margin:0;padding:8px 10px;font:11px/1.4 inherit;letter-spacing:.16em;" +
    "border-bottom:1px solid rgba(255,255,255,.12);display:flex;justify-content:space-between;align-items:center}" +
    "#nf-upload-panel h2 button{all:unset;cursor:pointer;opacity:.6;padding:0 2px}" +
    "#nf-upload-panel h2 button:hover{opacity:1}" +
    ".nfu-zone{margin:10px;padding:16px 12px;border:1px dashed rgba(255,255,255,.34);text-align:center;cursor:pointer;" +
    "transition:border-color .15s ease-out,background-color .15s ease-out}" +
    ".nfu-zone[data-over='true']{border-color:rgba(255,255,255,.8);background:rgba(255,255,255,.06)}" +
    ".nfu-zone:focus-visible{outline:1px solid rgba(255,255,255,.7);outline-offset:2px}" +
    ".nfu-zone b{display:block;font-weight:500;letter-spacing:.06em}" +
    ".nfu-zone span{display:block;margin-top:6px;opacity:.62;font-size:10px}" +
    ".nfu-help{margin:0 10px 8px;opacity:.55;font-size:10px}" +
    ".nfu-list{list-style:none;margin:0;padding:0 10px;max-height:186px;overflow:auto}" +
    ".nfu-item{display:flex;gap:8px;align-items:center;padding:6px 0;border-top:1px solid rgba(255,255,255,.08)}" +
    ".nfu-item img{width:34px;height:34px;object-fit:cover;background:rgba(255,255,255,.06);flex:0 0 auto}" +
    ".nfu-info{flex:1 1 auto;min-width:0}" +
    ".nfu-name{display:block;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}" +
    ".nfu-size{opacity:.55;font-size:10px}" +
    ".nfu-bar{height:3px;background:rgba(255,255,255,.14);margin-top:5px}" +
    ".nfu-bar i{display:block;height:100%;width:0;background:rgba(255,255,255,.72);transition:width .2s ease-out}" +
    ".nfu-item.is-done .nfu-bar i{background:rgba(160,220,170,.85)}" +
    ".nfu-x{all:unset;cursor:pointer;opacity:.5;padding:2px 4px;flex:0 0 auto}" +
    ".nfu-x:hover{opacity:1}" +
    ".nfu-foot{display:flex;gap:8px;padding:10px;border-top:1px solid rgba(255,255,255,.12)}" +
    ".nfu-btn{all:unset;cursor:pointer;flex:1 1 0;text-align:center;padding:6px 8px;letter-spacing:.1em;" +
    "border:1px solid rgba(255,255,255,.28)}" +
    ".nfu-btn:hover{border-color:rgba(255,255,255,.62)}" +
    ".nfu-btn[disabled]{opacity:.35;cursor:default}" +
    "#nf-drop-hint{position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);padding:10px 18px;" +
    "border:1px solid rgba(255,255,255,.35);border-radius:999px;font:12px/1 ui-monospace,monospace;" +
    "letter-spacing:.14em;color:rgba(255,255,255,.86);background:rgba(0,0,0,.28);pointer-events:none;" +
    "z-index:99;opacity:0;transition:opacity .18s}";

  function injectCss() {
    if (document.getElementById("nf-upload-css")) return;
    var st = document.createElement("style");
    st.id = "nf-upload-css";
    st.textContent = CSS;
    document.head.appendChild(st);
  }

  function fmtSize(b) {
    if (b > 1024 * 1024) return (b / 1024 / 1024).toFixed(1) + " MB";
    if (b > 1024) return Math.round(b / 1024) + " KB";
    return b + " B";
  }

  function buildPanel() {
    if (panel) return panel;
    injectCss();
    panel = document.createElement("section");
    panel.id = "nf-upload-panel";
    panel.setAttribute("aria-label", "投放样本");
    panel.innerHTML =
      '<h2>投放样本<button type="button" id="nfu-close" aria-label="收起投放面板">✕</button></h2>' +
      '<div class="nfu-zone" id="nfu-zone" role="button" tabindex="0" aria-label="投放图片：拖入，或按回车选择文件">' +
      "<b>拖入图片，或点击选择</b><span>选择图片文件（可多选）</span></div>" +
      '<p class="nfu-help" id="nfu-help">图片 · ≤20MB · 短边 ≥16px · 长边自动缩到 2400 · 最多 3 张</p>' +
      '<ul class="nfu-list" id="nfu-list" aria-live="polite" aria-label="已投放的样本"></ul>' +
      '<p class="nfu-help" id="nfu-state" role="status" aria-live="polite">—</p>' +
      '<div class="nfu-foot">' +
      '<button type="button" class="nfu-btn" id="nfu-show" disabled>开始放映 ▶</button>' +
      '<button type="button" class="nfu-btn" id="nfu-clear">清空</button>' +
      "</div>";
    document.body.appendChild(panel);

    var zone = panel.querySelector("#nfu-zone");
    zone.addEventListener("click", function () {
      openPicker();
    });
    zone.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " " || e.key === "Spacebar") {
        e.preventDefault();
        openPicker();
      }
    });
    panel.querySelector("#nfu-close").addEventListener("click", function () {
      closePanel();
    });
    panel.querySelector("#nfu-clear").addEventListener("click", function () {
      clearAll();
    });
    panel.querySelector("#nfu-show").addEventListener("click", function () {
      if (opts && opts.onStartShow) opts.onStartShow();
    });
    return panel;
  }

  function openPanel() {
    buildPanel();
    panel.classList.add("is-open");
    if (opts && opts.onPanelToggle) opts.onPanelToggle(true);
  }

  function closePanel() {
    if (panel) panel.classList.remove("is-open");
    if (opts && opts.onPanelToggle) opts.onPanelToggle(false);
  }

  function togglePanel() {
    if (!panel || !panel.classList.contains("is-open")) openPanel();
    else closePanel();
  }

  function openPicker() {
    if (root.__nfUploadInput) root.__nfUploadInput.click();
  }

  /* 槽位行：缩略图 + 文件名/大小 + 进度条 + 移除（规格与 pattern 的「文件列表」） */
  function addSlotRow(slot) {
    var li = document.createElement("li");
    li.className = "nfu-item";
    li.innerHTML =
      '<img alt="" aria-hidden="true">' +
      '<div class="nfu-info"><span class="nfu-name"></span><span class="nfu-size"></span>' +
      '<div class="nfu-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><i></i></div></div>' +
      '<button type="button" class="nfu-x" aria-label="移除"></button>';
    var img = li.querySelector("img");
    var nameEl = li.querySelector(".nfu-name");
    var sizeEl = li.querySelector(".nfu-size");
    var bar = li.querySelector(".nfu-bar");
    var fill = li.querySelector(".nfu-bar i");
    var x = li.querySelector(".nfu-x");
    nameEl.textContent = slot.name;
    sizeEl.textContent = slot.pendingText || "";
    x.textContent = "✕";
    x.setAttribute("aria-label", "移除 " + slot.name);
    if (slot.url) img.src = slot.url;
    x.addEventListener("click", function () {
      removeSlot(slot.id);
    });
    panel.querySelector("#nfu-list").appendChild(li);
    slotRows.push({ id: slot.id, li: li, bar: bar, fill: fill, sizeEl: sizeEl, img: img, nameEl: nameEl });
    return slotRows[slotRows.length - 1];
  }

  function rowOf(id) {
    for (var i = 0; i < slotRows.length; i++) if (slotRows[i].id === id) return slotRows[i];
    return null;
  }

  function setProgress(id, pct, stage) {
    var r = rowOf(id);
    if (!r) return;
    var p = Math.max(0, Math.min(100, Math.round(pct)));
    r.fill.style.width = p + "%";
    r.bar.setAttribute("aria-valuenow", String(p));
    r.bar.setAttribute("aria-label", "采样 " + p + "%" + (stage ? "（" + stage + "）" : ""));
    r.sizeEl.textContent = "采样中 " + p + "%";
  }

  function doneRow(id, rec) {
    var r = rowOf(id);
    if (!r) return;
    r.li.classList.add("is-done");
    r.sizeEl.textContent =
      rec.w + "×" + rec.h + " · " + rec.count + " 粒 · s0 " + rec.stats.s0.toFixed(2) + " · " + rec.stats.ms.total + "ms";
    setProgress(id, 100, "");
  }

  function removeSlot(id) {
    var r = rowOf(id);
    var idx = -1;
    var i;
    /* 行键 = 本地 slotId；slots[i].id 是 record.id，两者不是一回事 */
    for (i = 0; i < slots.length; i++) {
      if (slots[i].slotId === id || slots[i].id === id) {
        idx = i;
        break;
      }
    }
    if (idx >= 0) {
      if (slots[idx].url) URL.revokeObjectURL(slots[idx].url);
      slots.splice(idx, 1);
    }
    if (r) {
      r.li.remove();
      slotRows.splice(slotRows.indexOf(r), 1);
      if (r.img && r.img.src) URL.revokeObjectURL(r.img.src);
    }
    publish();
    if (opts && opts.onRemove) opts.onRemove(id, slots.length);
  }

  function status(text) {
    if (opts && opts.status) opts.status(text);
  }

  function publish() {
    root.__nfUpload = {
      mode: mode,
      slots: slots.map(function (s) {
        return { id: s.id, name: s.name, w: s.w, h: s.h, count: s.count, ms: s.ms };
      }),
      max: opts ? opts.maxSlots : 3,
      pending: pending,
      sampler: root.NFUploadSampler ? root.NFUploadSampler.VERSION : "",
    };
  }

  function ensureWorker() {
    if (worker) return worker;
    worker = new Worker(opts.workerUrl);
    worker.onmessage = function (e) {
      var m = e.data || {};
      if (m.type === "done") onSampleDone(m);
      else if (m.type === "error") onSampleError(m);
      else if (m.type === "progress" && typeof m.pct === "number") setProgress(m.id, m.pct, m.stage);
    };
    worker.onerror = function (err) {
      onSampleError({ id: "", message: String((err && err.message) || err) });
    };
    return worker;
  }

  function fail(msg) {
    status("> 投放失败：" + msg);
    if (root.console && console.warn) console.warn("[nf-upload] " + msg);
  }

  function validate(file) {
    if (!file) return "空文件";
    if (file.type && file.type.indexOf("image/") !== 0) return "非图片（" + file.type + "）";
    if (file.size > LIMITS.maxBytes) return "超过 20MB";
    return "";
  }

  /* 解码：EXIF 方向 → 长边缩放到 ≤cap（不放大）→ ImageData */
  function decode(file) {
    return createImageBitmap(file, { imageOrientation: "from-image" }).then(function (bmp) {
      var w = bmp.width;
      var h = bmp.height;
      if (w < LIMITS.minPx || h < LIMITS.minPx) throw new Error("图片过小（" + w + "×" + h + "）");
      var long = Math.max(w, h);
      var scale = long > LIMITS.cap ? LIMITS.cap / long : 1;
      var tw = Math.max(1, Math.round(w * scale));
      var th = Math.max(1, Math.round(h * scale));
      var cv = document.createElement("canvas");
      cv.width = tw;
      cv.height = th;
      var cx = cv.getContext("2d", { willReadFrequently: true });
      cx.drawImage(bmp, 0, 0, tw, th);
      var img = cx.getImageData(0, 0, tw, th);
      if (bmp.close) bmp.close();
      return { rgba: img.data, width: tw, height: th, srcW: w, srcH: h };
    });
  }

  function addFile(file) {
    var bad = validate(file);
    if (bad) {
      fail(bad);
      return Promise.resolve(null);
    }
    if (slots.length >= opts.maxSlots) {
      fail("槽位已满（" + opts.maxSlots + "）· 先「清空投放」");
      return Promise.resolve(null);
    }
    var name = file.name || "sample";
    pending += 1;
    mode = "sampling";
    var sid = "p" + Date.now().toString(36) + Math.floor(Math.random() * 1e6).toString(36);
    var url = "";
    try {
      url = URL.createObjectURL(file);
    } catch {
      url = "";
    }
    /* 先占一行（缩略图 + 进度条），采样完成再回填读数 —— pattern 要求「始终显示所选文件」 */
    buildPanel();
    addSlotRow({ id: sid, name: name, url: url, pendingText: fmtSize(file.size) + " · 排队中" });
    status("> 采样中 · 解码 " + name);
    publish();
    return decode(file)
      .then(function (img) {
        status("> 采样中 · " + img.width + "×" + img.height);
        var id = sid;
        ensureWorker().postMessage(
          {
            type: "sample",
            id: id,
            rgba: img.rgba.buffer,
            width: img.width,
            height: img.height,
            opts: { count: opts.engineCount(), mode: opts.samplerMode },
          },
          [img.rgba.buffer]
        );
        return new Promise(function (resolve) {
          handlerById[id] = { resolve: resolve, name: name, srcW: img.srcW, srcH: img.srcH, url: url, size: file.size };
        });
      })
      .catch(function (err) {
        pending -= 1;
        mode = slots.length ? mode : "idle";
        fail(String((err && err.message) || err));
        publish();
        return null;
      });
  }

  var handlerById = {};

  function onSampleDone(m) {
    var h = handlerById[m.id];
    var rec = m.record;
    pending -= 1;
    if (!h) return;
    delete handlerById[m.id];
    slots.push({
      id: rec.id,
      slotId: m.id,
      name: h.name,
      url: h.url,
      size: h.size,
      w: rec.w,
      h: rec.h,
      count: rec.count,
      record: rec,
      ms: rec.stats.ms.total,
      srcW: h.srcW,
      srcH: h.srcH,
    });
    status("> 投放 " + slots.length + "/" + opts.maxSlots + " · 采样完成（s0=" + rec.stats.s0.toFixed(2) + "，r95=" + rec.stats.r95.toFixed(3) + "）");
    doneRow(m.id, rec);
    updateButtons();
    publish();
    h.resolve(rec);
    if (opts.onRecord) {
      opts.onRecord(rec, { index: slots.length - 1, name: h.name, slotCount: slots.length, slotId: m.id });
    }
  }

  function onSampleError(m) {
    var h = handlerById[m.id];
    pending -= 1;
    if (h) {
      delete handlerById[m.id];
      h.resolve(null);
    }
    removeSlot(m.id);
    fail(m.message || "采样失败");
    publish();
  }

  /* ---- 入口 ---- */

  function addFiles(list) {
    var arr = [];
    var i;
    for (i = 0; i < (list ? list.length : 0); i++) arr.push(list[i]);
    var chain = Promise.resolve(null);
    arr.forEach(function (f) {
      chain = chain.then(function () {
        return addFile(f);
      });
    });
    return chain;
  }

  function bindEntry() {
    var input = document.createElement("input");
    input.type = "file";
    input.accept = "image/*";
    input.multiple = true;
    input.style.display = "none";
    input.id = "nf-upload-input";
    document.body.appendChild(input);
    input.addEventListener("change", function () {
      addFiles(input.files);
      input.value = "";
    });

    var key = document.getElementById("btn-upload");
    if (key) {
      key.addEventListener("click", function () {
        /* 专业入口：控制台键打开**投放面板**（面板里再点「拖入/选择」），而不是直接弹文件框 */
        togglePanel();
      });
    }
    root.nfUpload = function (file) {
      if (file && typeof file.length === "number" && !file.type) return addFiles(file);
      return addFile(file);
    };
    root.nfUploadFiles = addFiles;
    input.__nfUploadInput = true;
    root.__nfUploadInput = input;

    var depth = 0;
    var hint = document.getElementById("nf-drop-hint");

    function showHint(on) {
      if (!hint) {
        hint = document.createElement("div");
        hint.id = "nf-drop-hint";
        hint.textContent = "投放样本 · 松开以采样";
        hint.style.cssText =
          "position:fixed;left:50%;top:50%;transform:translate(-50%,-50%);padding:10px 18px;" +
          "border:1px solid rgba(255,255,255,.35);border-radius:999px;font:12px/1 ui-monospace,monospace;" +
          "letter-spacing:.14em;color:rgba(255,255,255,.86);background:rgba(0,0,0,.28);" +
          "pointer-events:none;z-index:99;opacity:0;transition:opacity .18s";
        document.body.appendChild(hint);
      }
      hint.style.opacity = on ? "1" : "0";
    }

    window.addEventListener("dragenter", function (e) {
      if (!e.dataTransfer || !e.dataTransfer.types) return;
      if (Array.prototype.indexOf.call(e.dataTransfer.types, "Files") < 0) return;
      e.preventDefault();
      depth += 1;
      openPanel();
      showHint(true);
    });
    window.addEventListener("dragover", function (e) {
      if (!e.dataTransfer || !e.dataTransfer.types) return;
      if (Array.prototype.indexOf.call(e.dataTransfer.types, "Files") < 0) return;
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = "copy";
    });
    window.addEventListener("dragleave", function () {
      depth = Math.max(0, depth - 1);
      if (depth === 0) showHint(false);
    });
    window.addEventListener("drop", function (e) {
      if (!e.dataTransfer) return;
      var files = e.dataTransfer.files;
      if (!files || !files.length) return;
      e.preventDefault();
      depth = 0;
      showHint(false);
      addFiles(files);
    });
  }

  function init(o) {
    opts = o || {};
    opts.maxSlots = Math.max(1, Math.min(3, opts.maxSlots || 3));
    if (opts.query && opts.query.get("upmax")) {
      var m = parseInt(opts.query.get("upmax"), 10);
      if (m >= 1 && m <= 3) opts.maxSlots = m;
    }
    if (opts.query && opts.query.get("sampler") === "fast") opts.samplerMode = "fast";
    if (opts.query && opts.query.get("upstart") === "auto") opts.autoStart = true;
    bindEntry();
    mode = "idle";
    buildPanel();
    updateButtons();
    if (!opts.__stateTimer) {
      opts.__stateTimer = window.setInterval(tickState, 250);
    }
    publish();
    status("> 投放就绪 · 按 UPLOAD 打开投放面板");
    return root.__nfUpload;
  }

  function clearAll() {
    for (var i = 0; i < slots.length; i++) if (slots[i].url) URL.revokeObjectURL(slots[i].url);
    slots.length = 0;
    handlerById = {};
    pending = 0;
    mode = "idle";
    for (var j = 0; j < slotRows.length; j++) {
      if (slotRows[j].img && slotRows[j].img.src) URL.revokeObjectURL(slotRows[j].img.src);
      slotRows[j].li.remove();
    }
    slotRows.length = 0;
    updateButtons();
    status("> 投放已清空");
    publish();
    if (opts && opts.onClear) opts.onClear();
  }

  function setMode(m) {
    mode = m;
    updateButtons();
    publish();
  }

  /* 「开始放映 ▶」：槽 ≥2 可用（1 张按规格走停留，不入放映） */
  function updateButtons() {
    if (!panel) return;
    var btn = panel.querySelector("#nfu-show");
    if (!btn) return;
    var on = slots.length >= 2;
    btn.disabled = !on;
    btn.textContent = on ? "开始放映 ▶（" + slots.length + "）" : "再投一张即可放映";
  }

  /* 放映/停留状态行：把「现在放的是第几张、下一张还有几秒、是不是停着」说清楚 */
  function tickState() {
    if (!panel || !panel.classList.contains("is-open")) return;
    var el = panel.querySelector("#nfu-state");
    if (!el || !opts || !opts.getStatus) return;
    var s = opts.getStatus() || {};
    var text;
    if (!slots.length) text = "未投放 · 把图片拖进上面的框，或点击选择";
    else if (s.custom && s.total >= 2) {
      text =
        "自定义放映中 · 第 " + (s.index + 1) + "/" + s.total + " 张（" + (s.name || "") + "）" +
        (s.phase === "paused-hover" ? " · 悬停暂停" : s.phase === "manual" ? " · 手动暂停" : s.remain != null ? " · 下一张 " + s.remain + "s" : "");
    } else if (slots.length === 1) {
      text = "单图停留（不自动换）· 再投 ≥1 张后按「开始放映 ▶」即循环";
    } else {
      text = "队列就绪 " + slots.length + "/" + (opts.maxSlots || 3) + " · 按「开始放映 ▶」进入循环";
    }
    if (el.textContent !== text) el.textContent = text;
  }

  root.NFUpload = {
    init: init,
    addFiles: addFiles,
    clearAll: clearAll,
    setMode: setMode,
    slots: function () {
      return slots;
    },
    state: function () {
      return root.__nfUpload;
    },
  };
})(typeof window !== "undefined" ? window : this);
