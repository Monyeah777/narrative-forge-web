# 交接：NarrativeForge 展示站 + 首屏原型

把本文件整份丢进新对话框（或 `@HANDOFF.md`），并附上：

> 读 `HANDOFF.md`，按里面的锁死约定继续。先求证代码，不要凭记忆改。未明确要求不要 commit。UI 改完要在浏览器里点一遍。

上一会话：[宇宙像素档案原型](ec3b0955-b215-4fb7-a7a3-0fb68475fc6a)

日期：2026-09-11。用户身份：Student，倾向直接改代码迭代。界面与回复用中文。

## 当前进度（云端 Track A）

手册 **§5 已完成**（真机试炼 / bench.html 协议）。B4 / B4.1 已过闸。自动放映修订包 §9.0–§9.6 已交付。作者点名《PixiJS v8 迁移总手册》最高严谨模式：现网默认 Pixi + ticker。现网三幅画作默认都是 **100k bin**（介绍 Dallas / 大厅 Scotland / 社区 Met）。NF 彩蛋仍 12k JSON。`?bin=0` 回滚介绍+大厅+社区 12k。弹簧 / physics **未改**。现网 Canvas2D 粒子 blit / worker 启动已拆除（`render-worker.js` 文件仍留仓）。150k/250k 仍只在隔离对照页。2026-09-12 已批准：原生 DPR≤3、`points.bin` 文件头 9B（`NFPT` + u8=3 + u32le count）、点数终值按作者 PC+手机双端 60fps 定档。现网仍 100k，不以云 VM 软件 GL 改档。径向重映射 **S0–S3 已落盘**。S2c：§8#1/#2/#8 过。S3：隔离模块全开关 + 60/120Hz；#3/#4/#5/#6/#8 过。#5 默认走离散临界 `c*=1/(1+√k)²`（手册 `k(r)` 未改；手册 `c(r)` 仍可开关回退）。未挂现网 ticker。现网仍 100k / 弹簧 0.055。下一刀须作者说「继续」才开 **S4**（渲染）。50k 改现网仍须作者点名。其它待点名：§0.9 白名单 / 无 WebGL 文案 / PC 实验性 API / 作者机双端 60fps 数字后改现网点数量。

- 凌厉弹簧 0.055 / 阻尼 0.90 / vmax 10；临界停止 0.6px / 0.06；驱离 100px 平方反比
- 成画 1.5s（最早 1.2s）、回退 1.1s；相位时间走固定步长，冻结不计入
- START / 介绍 = assemble（可打断、不重置数组）；首页 = 软解构
- SAVE 冻结（aria-pressed 常亮）；SETTINGS 循环 A/B/C（LOW DRIFT / STORM / STILL）
- `prefers-reduced-motion` → 直接静态成画；自动放映不轮换
- **自动放映**（《自动放映 · 修订包》v1.0 修宪 R1–R3，替代「不要加轮播」）：加载开演，catalog 固定顺序；停留 8–12s（默认 10）、过渡 2.5–3.5s（默认 3.0）；hover 暂停、离开 +1.5s 恢复；点击/导航进手动、静置 30s 恢复；键盘焦点即停且不自动恢复；图注级『放映启停』持久暂停；回退 `?autoplay=0` / `autoplay.enabled=false`
- 本条分支：`cursor/b3-assemble-spring-52ec`（叠在 `cursor/b2-render-atlas-52ec` 上）
- B2 仍有效：12k ImageBitmap 分桶绘制
- CRT 微调：画布 100vw×100vh；成画 70vh、中心偏左 15%；报章无底板；`.crt-shell` 是**空的全屏叠层**（不要拿带 `transform` 的外壳去包 canvas，否则 `position:fixed` 不再相对视口）；厚边框+微曲面（无 WebGL / Pixi / fragment shader）
- `ntx/nty` 永远是画作源空间 0–1；`tx/ty` 才是屏幕像素。`toNorm()` 不得回写 `ntx/nty`
- 本条分支：`cursor/crt-fullscreen-tube-52ec`（叠在 `cursor/b3-assemble-spring-52ec` 上）
- B4：主线程只做物理 + 把 x/y/pid 交给 `prototype/render-worker.js`（OffscreenCanvas）；worker 帧未到时**不要** `clearRect`。闸：work p95 ≤ 16.67ms、热身后 longtask=0、模糊 SSIM ≥ 0.35。数字在 `painting/b4-perf.json`
- 本条分支：`cursor/b4-perf-gate-52ec`（叠在 `cursor/crt-fullscreen-tube-52ec` 上）
- §5：`prototype/bench.html` 试炼场。U10 = longtask + 工作 1% low + 成画停帧；U11 = 32×32 亮度相关 + 亮度直方图；打断 START/首页/SAVE ×20。数字在 `painting/s5-trial.json`
- 本条分支：`cursor/s5-device-trial-52ec`（叠在 `cursor/b4-perf-gate-52ec` 上）
- 多画作路由：`TARGETS` 绑定介绍/大厅/社区/NF；本条分支 `cursor/multi-target-routes-52ec`（叠在 `cursor/s5-device-trial-52ec` 上）
- 自动放映：本条分支 `cursor/autoplay-exhibit-52ec`（叠在 `cursor/multi-target-routes-52ec` 上）。§9.0+§9.3 先落地。
- 画区云 seeding：本条分支 `cursor/seed-cloud-52ec`（叠在 `cursor/autoplay-exhibit-52ec` 上）。`seed.mode` / `seedMode` = `cloud`（默认）/`uniform`（回滚）；查询 `?seed=uniform`。`window.__nfSeedStats()` / `window.__nfSeedAudit`。首页 `disperse()` 仍全屏均匀混沌，不改 `scatterHomes`。
- 交接不变式：本条分支 `cursor/handover-invariants-52ec`（叠在 `cursor/seed-cloud-52ec` 上）。展览 catalog 换幅走 §3 交接（边缘先散、B 核先凝、外漂、分波、轻弧、禁 snapAll）。回滚 `?handover=0`。`?arc=off` / `?group=sharp`。`window.__nfHandover`。手动介绍/START 仍走原 assemble。
- 像素块 + 外围尘埃：本条分支 `cursor/pixel-block-dust-52ec`（叠在 `cursor/handover-invariants-52ec` 上）。默认哑光方块 2 设备像素；`?block=0` 回软边；`?pixel=3` 对照。尘埃低 alpha、无装配职责；`?dust=0` 关。`window.__nfPixel`。
- B4.1 四态纪律 + A/B：本条分支 `cursor/b41-perf-ab-52ec`（叠在 `cursor/pixel-block-dust-52ec` 上）。v2 停留 ≤30Hz（尘埃微动、零 12k 重算）；classic 仍成画停 rAF（S5 用 `?discipline=classic`）。画区 `?frame=0.9|1|1.1`。`window.__nfB41`。彩度 v2/v3 待拍板，未做。数字在 `painting/b4-1-bench.json`。
- 自动放映交付：本条分支 `cursor/exhibit-deliver-52ec`（叠在 `cursor/b41-perf-ab-52ec` 上）。汇总在 `docs/NF_自动放映_交付_v1.0.md`，复测在 `painting/exhibit-deliver.json`。裁决号 `NF-EXHIBIT-DELIVER-20260912`。
- Pixi H1-①：分支 `cursor/pixi-h1-vendor-52ec`（叠在 `cursor/exhibit-deliver-52ec` 上）。vendor 8.20.1 / sha256 `994859…4d53`。证据 `painting/pixi-h1-1-vendor.json`。
- Pixi H1-②：分支 `cursor/pixi-h1-hello-52ec`。隔离空场景 `prototype/pixi-hello/index.html`。证据 `painting/pixi-h1-2-hello.json`。
- Pixi H1-③：分支 `cursor/pixi-h1-bridge-52ec`。契约 v3 黄金样本 `fixed5_3.bin`。证据 `painting/pixi-h1-3-bridge.json`。
- Pixi H1-④：分支 `cursor/pixi-h1-cloud-52ec`。隔离 100k `ParticleContainer`：`prototype/pixi-cloud/`。证据 `painting/pixi-h1-4-cloud.json`。
- Pixi H1-⑤：分支 `cursor/pixi-h1-physics-52ec`。隔离 assemble 弹簧挂 `app.ticker` `UPDATE_PRIORITY.HIGH`；C2 黄金 `prototype/pixi-physics/golden-1000.f64`。证据 `painting/pixi-h1-5-physics.json`。
- 现网双轨切轨：分支 `cursor/pixi-h1-live-52ec`。`?pixi=1` 才走 Pixi。证据 `painting/pixi-h1-6-live.json`。
- 默认切轨：分支 `cursor/pixi-h1-default-52ec`。证据 `painting/pixi-h1-7-default.json`。
- 拆除旧轨：分支 `cursor/pixi-h1-teardown-52ec`。证据 `painting/pixi-h1-8-teardown.json`。
- INTRO 100k：分支 `cursor/pixi-h1-100k-52ec`（叠在 `cursor/pixi-h1-teardown-52ec` 上）。介绍默认读 `prototype/pixi-cloud/dallas-100k.bin`（v3 DataView）。`?bin=0` 回 12k JSON。大厅/社区/NF 未改。证据 `painting/pixi-h1-9-100k.json`。
- 点数档对照：分支 `cursor/pixi-h1-density-52ec`（叠在 `cursor/pixi-h1-100k-52ec` 上）。隔离页 `prototype/pixi-density/index.html?n=100000|150000|250000`。100k 复用现成 bin，不重采样。150k/250k 新采样，不进现网。证据 `painting/pixi-h1-10-density.json`。
- HALL 100k：分支 `cursor/pixi-h1-hall-52ec`（叠在 `cursor/pixi-h1-density-52ec` 上）。大厅默认读 `prototype/pixi-hall/scotland-100k.bin`。证据 `painting/pixi-h1-11-hall.json`。
- COMMUNITY 100k：分支 `cursor/pixi-h1-community-52ec`（叠在 `cursor/pixi-h1-hall-52ec` 上）。社区默认读 `prototype/pixi-community/met-100k.bin`。证据 `painting/pixi-h1-12-community.json`。
- 清 ctx 死代码：分支 `cursor/pixi-h1-ctx-dead-52ec`（叠在 `cursor/pixi-h1-community-52ec` 上）。现网 `render()` 只走 Pixi。已删 `paintStage` / `drawDust` / `new Worker(render-worker.js)`。`physics()` / `applySpring` 仍在。`render-worker.js` 文件仍留仓。证据 `painting/pixi-h1-13-ctx.json`。
- DPR≤3 + H2 文件头：分支 `cursor/pixi-h1-dpr-header-52ec`（叠在 `cursor/pixi-h1-ctx-dead-52ec` 上）。`quantizeDpr` 原生整数 ≤3；`?dpr=` 仍是实验闸。所有 tracked `points.bin` 前缀 9B 头，payload 字节未改（旧 sha 记在 `payloadSha256`）。C2 golden 未动。现网点数仍 100k。证据 `painting/pixi-h1-14-approve.json`。
- 径向重映射 S0：分支 `cursor/radial-s0-diag-52ec`（叠在 `cursor/pixi-h1-dpr-header-52ec` 上）。只诊断，不重采样。现网三幅中心/边缘密度 ≈1.00×（设计 3.76×）。NN p99 已 ≤1.8×median。手册 50k 与现网 100k、手册 §4 与弹簧 0.055 均未改。证据 `painting/radial-s0.json`。
- 径向重映射 S1：分支 `cursor/radial-s1-research-84d9`（叠在 `cursor/radial-s0-diag-52ec` 上）。§7 六搜、八条引用。档① 默认可离线做；档② Yuksel/cySampleElim 已核、升级才开；档③ 论文已核，**公开 GitHub 本闸未找到**，保持休眠。备忘 `docs/research/径向重映射-备忘.md`。
- 径向重映射 S2a：分支 `cursor/radial-s2a-candidates-84d9`（叠在 `cursor/radial-s1-research-84d9` 上）。`W(r)` 拒绝采样 250k → 洗牌 50k，隔离 u16，无 NFPT。三幅 50k 中心/边缘 2.40 / 2.45 / 2.57。证据 `painting/radial-s2a.json`。
- 径向重映射 S2b：分支 `cursor/radial-s2b-thinning-84d9`（叠在 `cursor/radial-s2a-candidates-84d9` 上）。默认 dart-thinning。Dallas/Scotland/Met n=50601/50441/50471。证据 `painting/radial-s2b.json`。
- 径向重映射 S2c：分支 `cursor/radial-s2c-qc-84d9`（叠在 `cursor/radial-s2b-thinning-84d9` 上）。复读 S2b u16。§8#1/#2/#8 过；可选频谱中带方窗无栅格峰。不触发 ②/⑤。现网 sha 未变。证据 `painting/radial-s2c.json`。
- 径向重映射 S3：本条分支 `cursor/radial-s3-physics-84d9`（叠在 `cursor/radial-s2c-qc-84d9` 上）。隔离 `nf-radial-physics.js`，全开关，60/120Hz。#3/#4/#5/#6/#8 过。#5 用离散临界 `c*(k)`；手册 `c(r)` 对照仍振荡。现网弹簧 / ticker / 100k 未动。证据 `painting/radial-s3.json`。

---

## 仓库与预览

| 项 | 值 |
|---|---|
| 本仓 | `C:\Users\mon_7\Downloads\narrative-forge-web` |
| GitHub | `Monyeah777/narrative-forge-web` |
| 当前分支 | 云端叠 PR 在 `cursor/s5-device-trial-52ec` |
| 原型路径 | `prototype/index.html`（live fetch：`assets/points.json`；`gen-points.mjs` 仍写同目录字形 `points.json`） |
| 画作预览 | `painting/01-dallas.jpg`（primary）+ `02`–`06`；`painting/points.json`（B1-2 v2）；高清不进 git |
| NF 主仓 | `C:\Users\mon_7\Downloads\NarrativeForge-main` |
| 规格 | `C:\Users\mon_7\Downloads\NF首屏_执行清单_v3.0_2026-09-10.md` |
| Next 预览 | `npm run dev` → http://localhost:3000 |
| 原型预览 | 在 `prototype/` 下 `python -m http.server 8768` → http://localhost:8768/ |

Next.js 16，API 与训练记忆可能不同。改 Next 代码前读 `node_modules/next/dist/docs/`。仓库根 `AGENTS.md` 会被 `next dev` 重写，以 `node_modules` 里那份为准。

**不要** commit / push / stash / reset，除非用户明确说。高危 git（stash、reset --hard、restore、force push）必须先说明影响，等用户回复「确认/可以/执行」。不要读 `.env`、密钥文件。

---

## 两轨

**轨道 A（进行中，优先）**：零依赖单文件 `prototype/index.html`。Canvas 2D only。不进 Next 构建。

**轨道 B（未开始）**：原型验收后 1:1 移植进 Next（`src/app/page.tsx` + 组件拆分），Fusion Pixel 子集化，`points.json` 入 `public/data/`。

当前主战场是轨道 A。站点（Next）已有一期导航与大厅裁剪，和原型是两套 UI。

---

## 轨道 A · 锁死视觉

- 深空 `#050505`，禁 `#000`。
- Canvas：`position:fixed; inset 0; 100vw/100vh; z-index:1`。禁 WebGL / Three.js。禁每帧 `ctx.arc()`。软边精灵 `drawImage`。
- 报章 `.paper`：全透明，无黑板/渐变底板。`position:absolute; right:8%; top:15%; z-index` 高于画布。字用 text-shadow，不用填色底。
- 报头：粗 Courier New，`letter-spacing:0.2em`，`clamp(32px, 4.4vw, 54px)`。
- GitHub / Gitee：Google Fonts Press Start 2P。无边框无填充。opacity 0.7→1，hover 细白下划线。`rel="noopener noreferrer"`。
- 导航：雅黑/苹方。`::before` 画 `>`，不要 HTML 里写勾。只有 hover / `aria-current`。离开立刻隐藏。同时只有一个 `aria-current`。序号 `data-idx` 01–04 用 `::after`。
- **不要**再加盒装 CTA / 测试按钮。访客控件：四项导航 + GitHub/Gitee + 文案里那颗彩蛋 NF + 图注级『放映启停』（修订包 R1，不是盒装 CTA）。
- 十字准星已删除。画布恢复普通指针。不要加回 `#sight` / `cursor:none`。
- 左上角 HUD `NF · VOID / 050505`、胶片颗粒 overlay 仍在；径向 veil 已关掉（`display:none`），不要加回深色文字遮罩。颗粒是静态 CSS，不要用 feTurbulence 当实时粒子噪声。
- 禁：backdrop-filter、双色故障、发光、渐变背景、`filter:blur()`。

### 文案（锁）

- 报头：`NarrativeForge`（两行 Narrative / Forge）
- VOL：`COSMIC PIXEL ARCHIVE · VOL. 01`（启动时 scramble）
- 介绍主句：把叙事，变成工程。
- 介绍副句：质量不是猜出来的，是校验出来的。
- 页脚：`NF · 内容契约层 · 定内容，不定模型`

### 必须保留的 ID / API

`#stage` `#void` `#dossier` `#btn-home` `#btn-intro` `#btn-hall` `#btn-community` `#btn-egg`

`window.assemble()` → 等同点「介绍」；`window.assemble(TARGETS.*)` 走对应数据源；`window.disperse()` → 等同点「首页」。

事件架构保留：Pointer Events、`prefers-reduced-motion`、`visibilitychange`、resize debounce ~150ms、固定步长 1/60 + 累加器（每帧最多 2 步）。

---

## 轨道 A · 状态机（现状，不是规格原文）

规格原文只有「首页混沌 / 介绍成画」。实现已扩成四视图：

| 动作 | 粒子 | 右侧 |
|---|---|---|
| 首页 | `disperse()` → `chaos` | 报头+导航，dossier 隐藏 |
| 介绍 | `assemble(TARGETS.INTRO)` → `points_poplars.json`（Dallas 白杨） | 介绍两句 |
| 数据大厅 | `assemble(TARGETS.HALL)` → `points_artwork_b.json`（Scotland 白杨） | 官方 13 模块 + P00/P01/P90 + 三资产键 +「打开完整大厅」 |
| 社区 | `assemble(TARGETS.COMMUNITY)` → `points_artwork_c.json`（Met 四树） | 货架说明 +「打开社区页」 |
| 彩蛋 NF | `assemble(TARGETS.EGG)` → `points_nf.json`，银白/钢蓝，**不改导航** | 若人在首页，仍不显示介绍文案 |

已 formed 再点另一个导航也会换数据源并重新 assemble。image 用该 json 调色板；text 强制 `#C9CFD8` / `#6F8FAF`。

**R1（替代「不要加（自动）轮播」，被《自动放映 · 修订包》v1.0 写入）：** 深空档案馆艺术区启用『自动放映』：加载自动开演，catalog 固定顺序轮换；停留 8–12s、过渡 2.5–3.5s（入 manifest，确定性可复现）。任意交互即接管：hover 暂停（离开 +1.5s 恢复）；点击/导航进入手动，静置 30s 恢复；键盘焦点进入即停且不自动恢复（仅显式操作恢复）；提供图注级文本『放映启停』（持久暂停、不自动恢复）；prefers-reduced-motion 不轮换。不设重放按钮；可见控件以导航为主，放映启停为注记级文本。

**R2（修订「散点到装配·仅一次」）：** 装配纪律：每幅作品每次登场仅装配一次；停留期不重播、不重算；任何操作不触发二次装配（无重放）。轮换『交接』过渡不属于重放。既有显式交互（点击重组/驱离/彩蛋）权限不变，自动放映不得调用。

**R3（修订「成画即停 rAF」→ 三态性能纪律 v2）：** ①过渡态：全速 rAF，目标 60fps，脚本 ≤10ms/帧；②停留态：低耗微动 ≤30Hz，脚本 ≤2ms/帧，零重算、零每帧分配；③不可见态：rAF=0、计时冻结、恢复不追赶；④reduced-motion：静态、无装配动画。回退 `motion.discipline=classic`。

旧句「没有自动呼吸轮播（不要加）」移入变更历史，标注被《自动放映 · 修订包》v1.0 替代。

`currentView`：`home | intro | hall | community`。`setMode` 不再抢导航；导航只由 `openArchive` / 彩蛋处理。

独立预览（非 3000 端口）时，`#go-hall` / `#go-community` 写成 `http://localhost:3000/hall` 与 `/community`。Next 没开就会 404，这是已知的。

### 彩蛋（刚纠正过，不要再弄错）

- **点击对象**：页脚「**NF** · 内容契约层 · 定内容，不定模型」里、内容契约层**左边**那颗 NF（`#btn-egg`）。
- **不是**视口角落另放的小字 NF（已删，不要加回 `.egg-mark`）。
- **不是**点「社区」。社区只换面板/成画，不是彩蛋入口。
- 已 formed 时再点 NF：轻微打散再收一次（`burstFromGlyph` + `assemble`）。
- 热区用 padding + 负 margin 加大；`.paper` z-index 200，避免画布挡住点击。

---

## 轨道 A · 粒子

文件：

- `prototype/index.html` 引擎
- `prototype/assets/points.json` 仍保留 Dallas 12k（与 `painting/points.json` 同字节，兼容旧链接）
- `prototype/assets/points_poplars.json` INTRO；`points_artwork_b.json` HALL；`points_artwork_c.json` COMMUNITY；`points_nf.json` EGG（v2，`#C9CFD8`/`#6F8FAF`）
- `prototype/points.json` 仍是 NF 字形生成物（约 1630 `{x,y}`），**不再被 live fetch**
- `prototype/gen-points.mjs` 确定性栅格 **N / F**（mulberry32 seed `0x4e46`）

规格要作者选定的 Monet 英雄图。B1-1 六张 1200px 已齐；B1-2 采成 12k；B1-4 接到 fetch；B2 已 12k 调色盘上屏（contain）；B3 已改凌厉弹簧与可打断时序。

数量：默认 **12,000** 全量；`?fx=lite` 才降到 2000 做评测对照。

物理常量（B3 凌厉组 · 默认）：

```
SPRING 0.055  DAMP 0.90  VMAX 10
GAMMA0 0.042  KT0 0.0018  V_TERM 0.01
CURL_AMP 20  CURL_K 0.0036  REPEL_R 100  REPEL 1.1
STOP_PX 0.6  STOP_V 0.06  ASSEMBLE 1.5s  DISPERSE 1.1s
POINTER_LERP 0.2  SIZES [2,3,4]
```

成画停留：自动放映开启且 `motion.discipline=v2` 时按三态纪律（停留用超时器推进、可见才走 rAF）；classic / 手动且无指针时仍可停 rAF。指针靠近仍驱离（半径 100px，冻结关闭）。混沌态环面包裹。SETTINGS 可切 A/B/C。

精灵：调色板软边图集（中心 α≈0.85），ImageBitmap，按亮度 2/3/4px，按色分桶绘制。

---

## 轨道 B / Next 站点（已做，未做首屏移植）

全局 `SiteNav`：首页 / NF 是什么 / 数据大厅 / 社区。`src/components/SiteNav.tsx`，挂在 `src/app/layout.tsx`。

首页 StatBar 已删，只留 Hero。

`/concepts`：mapping 表不给访客看（`content/concepts.mdx` 已注明）。

`/hall`：`listHallItems()` 只出官方核心——13 模块 + 管线 P00/P01/P90 + 资产 STYLE_DNA / TECH_RULES / TECH_TEMPLATES。数据在 `content/generated/`，入口 `src/lib/data/index.ts`。不要发明协议号。

`/community`：`src/app/community/page.tsx`，货架 official / community / experimental 占位，不承诺开放日期。

`content/generated/` 由 `scripts/sync-nf.mjs` 从主仓投影，不要手改生成物。

---

## 官方名称（大厅文案对齐用）

模块：季节天气，任务剧情，NPC 对话，NPC 交互，世界知识库，事件叙事，技术文档结构，数据结构，时间推进，认知边界，组合规则，主循环，输出生成器。

管线：P00 通用文档生成管线，P01 标准管线（官方核心装配），P90 技术文档生成管线。

资产键：STYLE_DNA，TECH_RULES，TECH_TEMPLATES。

---

## 未完成 / 已知问题

1. 轨道 B 未开始（原型未验收，不要擅自灌进 Next）。
2. 成画已是达拉斯 12k 调色盘点云（contain + 凌厉弹簧）。**B4 已过闸**（见 `painting/b4-perf.json`）。不要为了“再快一点”改弹簧 / atlas / contain / CRT。
3. 大厅目录在窄报章栏会按字折行。
4. 介绍 / 大厅 / 社区成画共用画作点云（cap 取模）；彩蛋仍是首页多一条成画入口。字形 NF 栅格不再是 live 目标。
5. 原型「打开完整大厅/社区页」依赖 localhost:3000。
6. `painting/01`–`06` + `source.json` + `catalog.json` 已跟踪；`painting/masters/` gitignore。并发会话共用本仓时，禁止顺手 stash/reset。
7. 别的对话框如果打开的是 GitHub 默认 `main`，会看不到原型。先 `git fetch` 再 `git checkout task/T-0005-community`。
8. 规格里的盒装介绍按钮组、春夏秋、玻璃卡、Fusion Pixel，原型里都还没有；用户已否掉额外盒装按钮。

---

## 设计偏差（对规格）

- 成画目标图应为作者点名英雄图 → B2 已 12k 调色盘点云 + contain；B3 成画/回退用凌厉弹簧 0.055 / 0.90。
- 首页混沌仍用 Langevin/OU + curl；成画相位不再走那组。
- 报章面板全透明，不是规格建议的 `rgba(20,20,23,0.78)` 档案底板（用户锁死透明）。
- 四导航都能进「成画 + 换文案」，规格只写了介绍成画。
- 十字准星做过又按用户要求删掉。

---

## 改 UI 时怎么验

浏览器里按真人路径点，不要只截一张静图：

1. 首页星尘漂，无准星，普通指针。
2. 点介绍 → 左侧收成画作点云（cap 子集），右侧两句渐显。
3. 自动放映开启时：加载即介绍成画，约 10s 后交到大厅、再社区，再回介绍。图注随幅更新。『放映暂停』持久停。
4. 点数据大厅 / 社区 → 换源重组，并接管为手动（静置 30s 才恢复自动）。
5. 点首页 → 打散，文案隐藏。
6. 停在首页，点页脚 NF（内容契约层左边）→ 收成 NF 银蓝字形，导航仍是首页，介绍句不出现。自动放映不得自己调彩蛋。
7. GitHub/Gitee hover：字变实 + 细下划线；指针划过粒子会被拨开。

---

## 变更历史

| 日期 | 说明 |
|---|---|
| 2026-09-12 | 「没有自动呼吸轮播（不要加）」被《自动放映 · 修订包》v1.0 R1 替代。『成画即停 rAF』被 R3 三态纪律修订。『装配仅一次』作用域改为每幅每次登场一次（R2）。 |

---

## 新会话建议第一步

1. 打开 http://localhost:8768/ 看现行原型（没有服务就在 `prototype/` 起 python http.server）。
2. 读 `prototype/index.html` 的 CSS 报章区 + `openArchive` / `triggerEgg`，不要重写引擎。
3. 只做用户这一次点名的事。现网默认 Pixi，介绍/大厅/社区默认 100k bin。`points.bin` 现有 9B `NFPT` 头。不要改弹簧。不要删 `physics()` / `applySpring`。径向重映射 S2c 已落盘。未听到 `继续` 不得开 S3，也不得把 50k 写进现网。
