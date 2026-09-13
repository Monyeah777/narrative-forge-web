# 交接：NarrativeForge 展示站 + 首屏原型

把本文件整份丢进新对话框（或 `@HANDOFF.md`），并附上：

> 读 `HANDOFF.md`，按里面的锁死约定继续。先求证代码，不要凭记忆改。未明确要求不要 commit。UI 改完要在浏览器里点一遍。

上一会话：[宇宙像素档案原型](ec3b0955-b215-4fb7-a7a3-0fb68475fc6a)

日期：2026-09-11。用户身份：Student，倾向直接改代码迭代。界面与回复用中文。

## 当前进度（云端 Track A）

手册 **§5 已完成**（真机试炼 / bench.html 协议）。B4 / B4.1 已过闸。自动放映修订包 §9.0–§9.6 已交付。作者点名《PixiJS v8 迁移总手册》最高严谨模式：现网默认 Pixi + ticker。作者再点名「在网站的基础上执行」手册后，介绍/大厅/社区默认 S2b dart-thinning **50k NFPT** + §4 径向物理；100k bin 仍留仓。NF 彩蛋仍 12k JSON（现网径向物理已覆盖彩蛋/混沌/回巢，**不**径向重采样字形）。`?radial=0` 回 100k + `applySpring` 0.055；`?bin=0` 回 12k JSON。`SPRING_SHARP = 0.055` / C2 黄金未改。现网 Canvas2D 粒子 blit / worker 启动已拆除（`render-worker.js` 文件仍留仓）。150k/250k 仍只在隔离对照页。2026-09-12 已批准：原生 DPR≤3、`points.bin` 文件头 9B（`NFPT` + u8=3 + u32le count）。径向重映射 **S0–S5 隔离闸已齐**；现网接线在 `cursor/radial-live-wire-84d9`。S6 最高严谨检索优化在 `cursor/radial-strict-opt-84d9`：宽带 3.76 是端点不是带平均（理论上限 ≈2.50，S2b 已贴上限）；现网 `handbookShape`；Pixi 映射 A–D；不加载 `nf-radial-render.js`；E 申议未启用。证据 `painting/radial-live.json`、`painting/radial-s6.json`。其它待点名：§0.9 白名单 / 无 WebGL 文案 / PC 实验性 API / 作者机双端 60fps 数字后改档 / 启用 E。

- 凌厉弹簧 0.055 / 阻尼 0.90 / vmax 10；临界停止 0.6px / 0.06；驱离 100px 平方反比
- 成画 1.5s（最早 1.2s）、回退 1.1s；相位时间走固定步长，冻结不计入。**2026-09-13 起**：到点不再 snap 写终态，切换 formed 需再过完成度门控（p = 1 − rms/rms0 ≥ 0.995 且 rms ≤ 3px；`?autoplay=1` 的介绍首幅用 `introRevealMs` 2400ms 作预算），安全阀 = 预算 + 1.5s（触发会写 `__nfAnim.assembleClose.capHit`）。见 `painting/assembly-v3-d-g123.json`
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
- 径向重映射 S3：分支 `cursor/radial-s3-physics-84d9`（叠在 `cursor/radial-s2c-qc-84d9` 上）。隔离 `nf-radial-physics.js`，全开关，60/120Hz。#3/#4/#5/#6/#8 过。#5 用离散临界 `c*(k)`；手册 `c(r)` 对照仍振荡。现网弹簧 / ticker / 100k 未动。证据 `painting/radial-s3.json`。
- 径向重映射 S4：分支 `cursor/radial-s4-render-84d9`（叠在 `cursor/radial-s3-physics-84d9` 上）。隔离 `nf-radial-render.js`，菜单 A→D 每步 bench。A–D 后脚本 p95 6.48ms，超 +1.0ms / 2ms，**申议 E 未启用**。未替换现网 Pixi。证据 `painting/radial-s4.json`。
- 径向重映射 S5：分支 `cursor/radial-s5-accept-84d9`（叠在 `cursor/radial-s4-render-84d9` 上）。隔离总验收：§8 全表、15s 录像、放大、帧时、回退清单。证据 `painting/radial-s5.json`。
- 现网径向接线：分支 `cursor/radial-live-wire-84d9`（叠在 `cursor/radial-s5-accept-84d9` 上）。默认 50k + §4 物理 + Pixi。回退 `?radial=0`。不加载隔离 ImageData 渲染。证据 `painting/radial-live.json`。
- 径向 S6 检索优化：分支 `cursor/radial-strict-opt-84d9`（叠在 `cursor/radial-live-wire-84d9` 上）。§7 全词包第二遍。宽带密度贴 W 积分上限，不重采样。现网 `handbookShape` + 混沌/彩蛋走 §4。证据 `painting/radial-s6.json` / `painting/radial-s6-strict.json`。
- 粒子装配总卷 v3.0 阶段 A：分支 `cursor/assembly-v3-a-diag-84d9`（叠在 `cursor/radial-strict-opt-84d9` 上）。只诊断。证据 `painting/assembly-v3-a.json`。卷面 `docs/NF_粒子装配模块_整合总卷_v3.0.md` 效力高于历史单件。
- 粒子装配 C/E 物理：本条分支 `cursor/assembly-v3-ce-phys-84d9`（叠在 `cursor/assembly-v3-a-diag-84d9` 上）。生命周期 / 回收 / Q(r) / M0 涟漪 / M3 脉线。隔离默认关。现网 `?morph=0` 回退。S3 dual 未漂。DWELL 增量超 +1.0ms，申议 E/砍 N，二者都没开。证据 `painting/assembly-v3-ce.json`。

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
- 现网默认 bin：`prototype/pixi-cloud/dallas-radial-50k.bin`、`pixi-hall/scotland-radial-50k.bin`、`pixi-community/met-radial-50k.bin`（S2b u16 原样拷进 NFPT；100k bin 仍留仓）
- `prototype/points.json` 仍是 NF 字形生成物（约 1630 `{x,y}`），**不再被 live fetch**
- `prototype/gen-points.mjs` 确定性栅格 **N / F**（mulberry32 seed `0x4e46`）

规格要作者选定的 Monet 英雄图。B1-1 六张 1200px 已齐；B1-2 采成 12k；B1-4 接到 fetch；B2 已 12k 调色盘上屏（contain）；B3 已改凌厉弹簧与可打断时序。

数量：介绍/大厅/社区默认径向 **~50k**（Dallas 50601 / Scotland 50441 / Met 50471）；`?radial=0` 回 100k；`?bin=0` 回 12k JSON；`?fx=lite` 才降到 2000 做评测对照。彩蛋仍约 12k 字形 JSON。

物理常量（B3 凌厉组 · 默认）：

```
SPRING 0.055  DAMP 0.90  VMAX 10
GAMMA0 0.042  KT0 0.0018  V_TERM 0.01
CURL_AMP 20  CURL_K 0.0036  REPEL_R 100  REPEL 1.1
STOP_PX 0.6  STOP_V 0.06  ASSEMBLE 1.5s  DISPERSE 1.1s
POINTER_LERP 0.2  SIZES [2,3,4]
```

成画停留：径向默认开时停留继续走 ticker（边缘漂移是渲染位，不写入积分器）。`?radial=0` 时仍可在 settled 后停 ticker。指针靠近仍走现网驱离（半径 100px，冻结关闭）。混沌 / 交接 / 彩蛋仍走原弹簧。SETTINGS 可切 A/B/C（只作用于回退弹簧路径）。

精灵：调色板软边图集（中心 α≈0.85），ImageBitmap，按亮度 2/3/4px，按色分桶绘制。

---

## 查询闸表（现网 · 2026-09-13 并入仓库文档）

查询闸只解析一次（`NF_QUERY`，惰性缓存；解析失败等价取不到，不抛）。回退优先级：**先 `?radial=0`，再 `?bin=0`**。

| 闸 | 取值 | 作用 |
|---|---|---|
| `dpr` | 1–3 | DPR 实验闸（原生整数 ≤3 为默认） |
| `fx` | `lite` | 评测对照降到 2000 点 |
| `bin` | `0` | 回 12k JSON（介绍/大厅/社区） |
| `radial` | `0` | 回 100k + `applySpring` 0.055 |
| `morph` | `0` | 回退装配形态叠构（只留 `handbookShape`） |
| `autoplay` | `0` | 关自动放映 |
| `dwell` | 毫秒 | 覆盖停留时长（下限 1000） |
| `seed` | `uniform` / `cloud` | 画区云 seeding（默认 cloud） |
| `handover` | `0` | 关交接过渡 |
| `arc` | `off` / `on` | 交接轻弧 |
| `group` | `sharp` / `develop` | 交接分组曲线 |
| `block` | `0` / `1` | 像素块开关（O2 未决，现状默认开、2 设备像素） |
| `pixel` | `2` / `3` | 像素块尺寸对照 |
| `dust` | `0` | 关外围尘埃（默认 640 粒 ≈1.27%） |
| `discipline` | `classic` / `v2` | 三态性能纪律（默认 v2） |
| `frame` | `0.9` / `1` / `1.1` | 画区缩放对照 |
| `nf-points` | `placeholder` | 占位点集（离线/无网对照） |
| `n` | 2000–100000 | **计数档（卷面 §7）**：预览 20–30k；缺省/0 保持默认 50k（不静默改档）；非法值忽略并告警 |
| `degrade` | `1` | 应急看门狗：停留期 work.p95 连续 3 次 > 8ms → 保画降到 30k（写 console 与 `__nfRender.nTier.logs`）；回退＝去掉该参或用 `?n=50601` |
| `scenebox` | `0` | **修-1 回退**：`rOfPixel` 回旧的视口轴归一（默认走画作盒口径） |
| `qpush` | `1` | **修-2 回退**：恢复 Q(r) 的恒定内推（默认已删，只保留外向抑制） |
| `repelscope` | `window` | **修-3 回退**：相位判据回「指针在窗口内即 live」（默认＝指针须落在画作盒上） |
| `streakgate` | `awake` | **§4#2 回退**：丝缕门槛回「只醒着粒子累积」（默认＝带内睡眠粒子也累积，2026-09-13 授权） |
| `streakband` | 0.72–0.95（**默认 0.82**） | **§4#2 成本档**：收窄丝缕带下沿；`?streakband=0.72` 回全带 |
| `shapering` | `1` | **圆环修正回退**：丝缕带回圆形口径（默认＝Chebyshev 方框口径，四角参与逸散） |
| `repelfamily` | `off` | **R1b 回退**：REPEL 相位暂停余韵族（默认＝保留，贴近看画面仍活着） |
| `rampa` | 0.5–4 | **§4#3**：余韵斜坡前段时长；默认 1（0.4@1s），`?rampa=2` 回旧档（0.4@2s） |
| `birthin` | 0–0.5 | **§4#4**：回收出生点内缩比；默认 0.02（外环内移降约 4 倍），`?birthin=0.08` 回旧档 |
| `streakcap` | `on` | **无上限逸散回退**（作者 2026-09-13）：丝缕权重恢复 1.05 处上端截断（默认＝带内权重恒 1，外围一路外走不停在盒沿） |
| `recyclefar` | `0` | **无边界逸散回退**（作者 2026-09-13）：回收回旧圆形口径 `rOfPixel ≥ 1.25·R95`（默认＝出画才回收，视口外扩 5%） |
| `driftall` | `off` | **整幅流动回退**（作者 2026-09-13）：丝缕回到「只动带内」（默认＝全幅参与外向流动，圆心也有速度） |
| `driftlag` | 0–60（默认 **6** 秒） | **启动排序**：lag(R)=driftLag·(1−min(1,R/1.5))，R = 到画作中心的盒半径 → 先外围后内；`0` = 全幅同时起 |
| `streaku0` | 0.5–20（默认 **5** px/s） | **逸散速度**：丝缕外向速度（卷面 §7 的 U0）。2026-09-13 曾抬到 7（第 6 轮），作者「先把以前的速度改回来」后**回退到 5**；`?streaku0=7` 仍可试更快 |
| `restore` | 0–2（默认 **0.8**） | **中间复原**：内核区复原加速（生命推进 ×(1+restore·(1−min(1,R/1.5)))、淡入 ×1/rate）；`?restore=0` 关闭 |
| `fountain` | 0–2（默认 **0**） | **喷泉回流**（机制保留备用）：超出比例振幅后恒速拉回。作者判定「改的不好，不如以前流动了」→ **默认关**；`?fountain=0.3–2` 可再试 |
| `repel` | `old` | **指针驱离回退**：回旧口径（100px + 1/d² + 硬截断/上限）；默认＝42px 紧凑核 w=(1−d/R)²（无硬边、不结圈） |
| `repelr` | 16–200（默认 **42** px） | 指针驱离半径（小范围） |
| `repelv` | 0.2–6（默认 **1.35** /步） | 指针驱离中心推力 |
| `upload` | `0` | **上传采样与三图放映总关**（规格 v1）：不加载 `nf-upload.js`、不绑拖拽/控制台键 → 100% 旧行为 |
| `upmax` | 1–3（默认 3） | 上传槽位上限 |
| `upstart` | `auto` | 槽 ≥2 即自动开始自定义放映（默认 manual：点放映条「自定义放映 ▶」） |
| `sampler` | `fast` | 采样退回「解析初值 + 1 轮」的快速档（默认 full：s0 二分至 ±2%） |
| `source` | 0–0.6（默认 **0.20**） | **中心源临时上限**：容量 = N×(1+source)，源槽从画作中心生成、中心补满后慢速退役 → 总数在 [N, N+源槽] 呼吸；`?source=0` 关 |
| `sourcetarget` / `sourcerate` | 0.3–1（覆盖**后段**目标，默认后段 1.0）／5–3000（覆盖**后段**速率，默认后段 600） | **两段式**：前段固定 目标 0.4 + 速率 160 粒/s（丝滑铺开），8→22s 平滑升档到后段（补黑洞）；`?sourcelife=` 源粒子寿命（默认 11.5s） |

---

## Codex 批次 0–5 与 O1① 现状（2026-09-13 · 分支 `codex/batch0-confirm`）

- **批次 0 确认**：四项守门复验全过（C2 / NFPT / S3 dual / vendor），7 步录屏改用 14 张截图 + 程序化像素统计；证据 `painting/codex-baseline.json`。
- **批次 1 无损清理**：查询闸改一次解析 + 惰性缓存（`NF_QUERY`）；`wakeLoop` 并为 `startLoop` 薄包装；删 `raf` 残留变量与 `cancelAnimationFrame` 残调用；死链只标记。证据 `painting/codex-batch1.json`。
- **批次 2 性能**：验证面（`__nfRadial` / `__nfPixiLive`）对象复用 + ≤4Hz 发布；curl 网格只在 legacy 混沌消费时刷新；睡眠粒子跳丝缕 + FIL LUT 分步摊销 + 渲染侧去每帧数组分配；Pixi 整柱重建改内容键比较 + 自适应分帧（首帧 α=0.35）。参数一律未动。证据 `painting/codex-batch2.json`、申议 `docs/research/批次2-DWELL申议.md`。
- **批次 3 生成序列**：装配结算改完成度门控（p ≥ 0.995 且 rms ≤ 3px），删除 snap 写终态；G1/G2/G3 复跑闸 `scripts/assembly-v3-d-g123.mjs`，证据 `painting/assembly-v3-d-g123.json`、`painting/assembly-v3-d-rms.svg`；申议 `docs/research/批次3-生成序列申议.md`。
- **批次 4 结构治理**：精灵/染色簇（14 个函数）、quiet-wait 机制、worker 残链、`snapAllToTargets`、死常数（WALL/TINT/STOP/GLYPH_N,F）、不可达 `try/catch` 全部物理删除；`render-worker.js` 文件仍留仓。CI 新增 `goldens` 作业（`scripts/check-goldens.mjs`：C2 / NFPT / S3 dual / vendor），不改原 lint-build。证据 `painting/codex-batch4.json`。
- **批次 5 轨道 B 准备**：拆分映射表（18 分区 → B1–B14 单元）与接口冻结草案（9 节）。证据 `painting/codex-batch5.json`；两份文档待作者评审。
- **O1① 无损优化（已穷尽）**：`applyRadialPhysics` / `syncRadialFromLive` / `rebuildRadialWorld` 的逐元素拷贝改 `TypedArray.set()`，并删除非 live 路径里「拷进去又被渲染回填覆盖」的冗余预拷贝。停留帧（50k）省 **−1.4 ~ −2.0ms**（两次独立同进程 A/B）；morph 增量几乎不动（4.19 → 4.05）。`.set()` 与逐元素赋值经 20 万值比对逐位一致。证据 `painting/codex-o1a.json`、`painting/codex-o1b.json`（后者含逐块归因与全部否决项：renderAll −0.012 / qOfR LUT −0.088 / micro 重排 −0.019 / `hypot→sqrt` −0.431 但改数值）。
- **待裁决**：O1 ②（砍 N）/ ③（E 实验）、O2（像素块 / 尘埃）；材料见 `docs/research/O1-DWELL裁决材料.md`、`docs/research/O2-像素块与尘埃裁决材料.md`。
- **O2 路 A 已实现（作者裁决）**：像素块＝方形贴图（实心 / nearest）+ 设备像素整数对齐 + `roundPixels`，`?block=0` 回软边、`?pixel=3` 出 3 设备像素（默认仍 2px，与 `pixelBlock.size` 一致）；尘埃＝接回渲染（独立容器、`#d6d2c8`、静态 alpha 0.08–0.22、点径 1.6 CSS px）且数量改 **5% × N**（50k → 2530；`?fx=lite` → 100），`dust.n=0` 表示自动、`?dust=0` 整链关闭。证据 `painting/codex-o2a.json`；方块样式与尘埃强度待作者目检 `nf-baseline-artifacts/o2a-visual-ab.jpg`。
- **O1② 计数档（作者裁决）**：`?n=<2000–100000>` 预览档（缺省/0 保持默认 50k，非法值告警忽略）、`?degrade=1` 应急看门狗（停留期 work.p95 连续 3 次 > 8ms → 保画降 30k，带日志）；证据 `painting/codex-o1c.json`。
- **O1③ E 实验关档**：卷面附表第 12 行「不复申议」——WebGL 已由现网 Pixi 落地、降 count 并入应急档；`__nfRadial.render.E_petition` 同步更正为 `closed-by-volume: …`。阶段 E（驻留形态）经逐条校准：13 项 in-spec（含余韵斜坡实测 0.4@2s / 1.0@8s）、逸散 160px@32s 落在 80–160 带内。证据 `painting/calibration-audit.json`。
- **时钟口径对齐（作者裁决）**：时间源 `ticker.elapsedMS` → **`ticker.deltaMS`**；`FRAME_CLAMP=0.25s + MAX_STEPS=2` → **`MAX_FRAME_S=0.05` + 不限步**（单帧钳制即安全边界：≤3 步 @1/60）。证据面新增 `__nfRender.clock`；A 诊断记录的三条时钟偏差就此闭合。证据 `painting/codex-o1d.json`。
- **P0/P1/F1 三项修复（裁决 v1）**：修-1 `rOfPixel` 改画作盒口径（`createWorld` 增 `sceneW/sceneH`+盒中心；不传参严格回退旧路径）；修-2 删除 Q(r) 恒定内推（保留外向抑制）；修-3 相位判据改 `pointerOn && pointerOnPainting()`。三个回退开关 `?scenebox=0` / `?qpush=1` / `?repelscope=window`。验收锚点全部命中：`radiusMode=scene-box`、rr≥0.72 **31.86%**、≥0.82 **17.79%**、`we` 载体 **15269/50601=30.18%**；外环 10s 位移 现状 −55.3px（全内向）→ 修后 **0.000px**；页面 `escP95` 0 → **2.52→11.17→12.17**（指针停在报章区即可，不再冻帧）。S3 dual 未漂。证据 `painting/p0p1f1.json`。
- **§4#2 已授权并落地（2026-09-13）**：带内睡眠粒子恢复丝缕累积（`streakSleeping`，回退 `?streakgate=awake`）。载体自 2s 起满额 **15269**（旧门槛为 0 @10s），页面 `escP95` 3/10/30s = **3.26 / 28.73 / 70.46**（旧门槛 0.48/6.47/9.12）；逸散在 ~45s 趋于饱和（Node 83.7px）。**成本实测 +2.20ms/帧（裁决估算 +0.2~0.85ms），已按「不静默超预算」上报待拍板**。证据 `painting/p0p1f1-4-2.json`。
- **第二轮五项（作者「同意，全做」+ 圆环问题，2026-09-13）**：① §4#2 成本档采纳收窄带（默认 `streakWeLo=0.82`）；② §4#3 余韵前段 0.4@2s → **0.4@1s**（`rampA=1`）；③ §4#4 回收出生内缩 0.08 → **0.02**（外环内移 90s：−15.32 → **−3.83px**）；④ R1b 取倾向档：**REPEL 保留余韵族**（实测 REPEL 下 morph=1、esc 载体 12572）；⑤ **圆环修正**：丝缕带口径由圆形改 **Chebyshev 方框**，四角载体占比 **38.1% → 98.9%**，圆环边界消失。五项各有回退开关（`?streakband=0.72` / `?rampa=2` / `?birthin=0.08` / `?repelfamily=off` / `?shapering=1`）。全闸 32 项 0 报错、7 步全过、金测全绿。证据 `painting/p0p1f1-r2-allfix.json`。
- **第三轮 无边界逸散（作者「取消圆环边界」→「变成方形框了，希望外围不受限制逸散」，2026-09-13）**：⑥ **无上限逸散**——删 `weOfR` 的 1.05 上端截断（带内权重恒 1），方框壳层堆积消失：盒沿 r∈[1.00,1.05] 相对邻带亮度增量 旧 **+6.33→+8.56**（10s→26s，越积越深）→ 新 **+2.31→+0.93**；⑦ **出画回收**——回收判据由圆形 `rOfPixel ≥ 1.25·R95`（本页几何 = 画作右缘外仅 122px、盒角方向仅 16px 的消失界线）改为**渲染位置出画才回收**。可见逸散：`escP95` 旧口径恒 **~12px**，新口径 **32.5→133.2→247.1px**（10/30/55s），单浏览器长时程 30/60/100/150s = **124/141/179/178px**；内核各区同幅老化，无差动塌陷。回退 `?streakcap=on` / `?recyclefar=0`。成本不增反降（DWELL 窗口 work 均值 6.83ms vs 旧圆形回收 7.58ms）。金测全绿（S3 dual 未漂）。证据 `painting/p0p1f1-r3-unbounded.json`。
- **第四轮 整幅流动（作者「不再固定中心，整幅画都向外逸散，别忘了复原机制，先外围后内」，2026-09-13）**：⑧ **全幅参与**——丝缕门槛由带内放到全幅、圆心保留速度下限（`DRIFT_WE_FLOOR=0.45`），成画态载体 **23.5% → 100%**；⑨ **先外围后内**——启动延迟 `lag(R)=driftLag·(1−min(1,R/1.5))`，每环首动（0.5px）实测 **0.78 / 1.02 / 1.25 / 3.05 / 4.88s**（由外向内），`?driftlag=0` 则全环 0.88s 同时起；⑩ **复原保留**——出画回收 + 生命期淡出，38s 内 respawn **24121 次**（≈635/s），各环样本数与总量恒定（50601），显示半径整体外移 ≈0.2–0.4 盒半径（稳定外流而非抽空）。像素级 500ms 差分：4.5s 时最内环运动像素仅 7.06% 而外环 22–25%（肉眼可见的先外后内），7.2s 起各环齐平。回退 `?driftall=off` / `?driftlag=` / `?streaku0=`。**成本 +2.31ms/帧**（work 均值 11.68 vs 9.38ms，全幅载体的代价）已按「不静默超预算」上报待拍板。另发现接线缺陷：页面写 `radialWorld.tx/ty` 从不调 `refreshR()`，`rBand[]` 停留在建 world 时的画作层口径（0.002–0.999，实际 0–3.81）——本轮排序改用实时半径规避，是否补 `refreshR` 待裁决。证据 `painting/p0p1f1-r4-flow.json`。
- **第五轮 中间复原加速（作者「就这样，但可以中间复原的速度稍快一点」，2026-09-13）**：⑪ **内核复原加速**——按粒子所属半径 R（取物理位置，不随 esc 外移）给内核加速：生命推进 ×(1+restore·(1−min(1,R/1.5)))、入生淡入 ×1/rate，外圈 R≥1.5 时 rate=1 与前轮逐项一致。默认 `restore=0.6`。实测内核环（R<0.5）38s：平均外移 **109.2 → 86.3px（−21%）**、「在家（<20px）」比例 **10.1% → 14.7%**、复原次数 **23991 → 27276（+13.7%）**；外圈 4 环三档同值（噪声内）。`?restore=1.2` 可再强一档（内核外移 −48%、在家 26.4%）。成本 **+0.10ms**（1.2 档 +0.56ms）。成画态载体仍 100%、`capHit=0`、页面 0 报错、金测全绿（`lifeEnvelope` 不传 inScale 时逐位同旧）。回退 `?restore=0`。证据 `painting/p0p1f1-r5-inner-restore.json`。
- **第六轮 喷泉（作者「再稍微快一点不留中间的洞，就行喷泉一样」，2026-09-13）**：⑫ **整体提速** U0 5→**7px/s**、内核速度下限 0.45→**0.7**、复原 0.6→**0.8**；⑬ **喷泉回流**——画作主体的逸散位移超出各自**比例振幅**（reach(R)=fountain·(8px+0.25·R·盒短半轴)，R=所属半径）后被**恒定速度** 3·U0 拉回，成员度在 R 0.8→1.0 柔和退出（最外圈继续逸散、喂光晕）。关键结构：成比例振幅 → 整场按比例伸缩、密度守恒；回流速度不按 R 削弱（削弱会让中环跑很远、留下环状变薄）。实测密度剖面（按显示位置分环、密度=计数/环面积、以 dwell≈0.9s 为基准）：旧档最内环 **6.7%**（明显的洞）→ 默认 **57%**，剖面 0.56–0.78 平坦无洞无环状变薄；`?fountain=1.5` 中心会重新变薄（最内环回 0）。代价（诚实记账）：内核运动量低于「任其外走」档（1.5s 像素差分内环 11–14% vs 外环 19–24%）——洞没了，但中间是「密且持续小幅脉动」。成画态载体 **91.9%→100%**、`capHit=0`、页面 0 报错、金测全绿。回退 `?fountain=0` / `?streaku0=5` / `?restore=0.6`。证据 `painting/p0p1f1-r6-fountain.json`。
- **第七轮 指针驱离（作者「交互周围会有圆圈，范围太大，驱散也不符合物理规律，不用圆圈小范围」，2026-09-13）**：⑭ **去掉圆圈 + 小范围**——旧口径 `REPEL_R=100px` + `f=1.1·R²/d²`（近处被上限压平、到边界才硬截断）会把粒子在 r≈100px 堆成可见圆圈：实测显示径向密度在 95–105px 为 **0.063/0.070**、邻带 0.024–0.025（**2.7×**），0–25px 全空、近心清空率 **100%**。新口径：半径 **42px** + **紧凑核 w=(1−d/R)²**（边界力→0，无硬边）→ 峰值/邻带 **1.3×**、剖面平滑、近心清空率 64–75%、指针离开 2s 内回到 17.9%（复原正常）。回退 `?repel=old`；调参 `?repelr=<16–200>` / `?repelv=<0.2–6>`。金测全绿、页面 0 报错。证据 `painting/p0p1f1-r7-pointer.json`。
- **速度回退（作者「先把以前的速度改回来」，2026-09-13）**：⑮ **回到第 4/5 轮那档**——`streaku0` 7 → **5px/s**、内核速度下限 0.7 → **0.45**、`fountain` 默认 0.6 → **0（关）**；`restore` 保留 **0.8**（那是作者第 5 轮自己要求的「中间复原稍快一点」）。复验：`escP95` 10/30/55s = **35.8 / 136.1 / 259.9px**（第 4 轮基线 32.5 / 133.2 / 247.1 同档；第 6 轮那档 49.4 / 189.4 / 363.8 已撤）。金测全绿、页面 0 报错。证据 `nf-baseline-artifacts/speed-check.json`。
  - 下一步（作者「让从中心生成的更快 + 增加临时最大粒子上限」）：模块侧脚手架已就位且**当前惰性**（`createWorld` 支持 `sourceN` 容量与 `alive[]` 标志；页面未传 `sourceN` ⇒ 容量 = n、行为与本轮逐位一致，金测可证）；待做的是页面容量接线 + 中心源控制器（缺氧即从中心生成、中心补满后慢速退役 ⇒ 总数在 [n, n+srcN] 呼吸）。
- **第八轮 中心源 + 临时上限（作者「改的不好不如以前流动了，不如让从中心生成的更快，增加一个临时最大粒子上限运行」，2026-09-13「执行」）**：⑯ **源汇模型替代回流**——粒子照旧一路向外（`fountain` 默认关、速度仍是「以前那档」U0=5），缺口由**从画作中心新生成**补上：容量 = N×(1+source)（默认 +15%：50,601 → **58,191**），源槽在中心出生（抖动 = 整个中心带）、目标与 home 都取自中心带，10Hz 控制器按「中心填充率」生成（≤320 粒/s）与退役（70 粒/s）→ **总数在 [N, 容量] 之间呼吸**。实测：存活 51.3k(5s) → 53.2k(20s) → **54.8k(44s)**（源 753→2,605→4,213），中心填充 0.24→0.38→0.586；密度剖面最内环 无源 **0.095**（20s 一度 0.048，就是那个洞）→ 开源自 **3.95**（洞消失）；中心带比「当时的周围」密 2–4×（周围同时被抽稀到 0.35–0.57）＝源的形状。回退 `?source=0`（容量回落 50,601、行为同旧版）；调参 `?sourcetarget=<0.3–1>` / `?sourcerate=` / `?sourcelife=`。金测全绿（S3 dual 未漂）。证据 `painting/p0p1f1-r8-source.json`。
- **第九轮 三版合体（作者「结合更平版的初始生成速度，丝滑平铺；生成之后结合更喷与生成更快补齐中心黑洞；三版取优点，摒弃默认」）**：⑰ **中心源改两段式**——前段（0–8s）目标 0.4 + 速率 160 粒/s（更平版的优点：**丝滑平铺**，密度剖面 0.82–1.22 不结块）→ 过渡（8–22s，smoothstep 无突变）→ 后段目标 1.0 + 速率 600 粒/s（更喷 + 生成更快的优点：**补齐中心黑洞**）。容量默认 +20%（50,601 → **60,721**）。实测：中心填充 0.156(4.8s) → 0.353(19.8s) → 0.788(34.2s) → **0.962(57.4s)**；存活 50.8k→**57.6k**（源 180→7,003）；对照 `?source=0` 最内环 60s 仅 **0.063**（黑洞仍在）。上一轮的单一默认档（0.15/0.7）作废。金测全绿。证据 `painting/p0p1f1-r9-combined-source.json`。
  - 跟进（作者「中心后面生成的范围有点大，稍微缩小一点」）：中心带 `SRC_FILL_R` 0.25 → **0.18**（≈44×57px）、出生抖动 `SRC_BIRTH_R` 0.12 → **0.08**；页面池阈值改为跟随模块常数。复验（同批采样）：60s 中心填充仍 **0.955**（洞照样补齐），而 **0.2–0.3 环从 3.82 回到 0.933**（不再被源覆盖）→ 生成范围确实缩小；源粒子 7,003 → **4,434**（更省）。
  - 再跟进（作者「中心生成的时间再稍微早一点，采取 0.14 方案」）：中心带 0.18 → **0.14**（≈34×44px）、出生抖动 0.08 → **0.06**、强档起始 8s → **5s**、过渡 14s → **10s**。复验：9.8s 已到 目标 0.67 / 358 粒/s（上一版 19.8s 才 0.96/568），**15.8s 满强档**、中心填充 **0.644 → 29.7s 0.932**（上一版 34s 才 0.788）；源粒子 60s 时 7,003 → **3,163**；前段 2.8s 剖面 0.85–1.24 仍平。
- **第十轮 隔离 + 边缘汇 + 后段弱档定稿（作者「后段弱一点版最终定稿」＋「切换回首页怎么还在生成？没有隔离机制吗？没有边缘消失防止爆满的机制吗？」）**：查出两个真缺陷——⑱ **源没有相位门**（`srcTick` 不判相位，INTRO/HANDOVER 也在生成）；⑲ **源粒子出画走的是重生**（`respawn`）而不是释放 → 槽位永不回收、总数会一路堆到上限。修法：`srcTick` 只在 dwell-like 生成、离开相位即 `srcRetireAll()` 释放全部源粒子（**相位隔离**）；源粒子出画或寿命到期改走 `srcFree()` **释放槽位**（**边缘汇**，基础粒子行为不变）；后段目标 1.0 → **0.6**（弱档定稿）、后段速率 600 → **1500 粒/s** 压住稳态误差。实测：**相位隔离**——autoplay=1 时 INTRO 相位源恒 0，进入 DWELL 且中心开始变稀（10s 后）才生成（18s 源 50 → 34s 701）；**场景切换**——点 hall 切场景后总数**精确回到 N=50,601、源清零**；**不爆满**——总数稳定在 **+1,420（+2.8%）**，离上限 60,721 还有 8,700 余量（此前会爬到 +11%），中心最内两环 2.2–2.6×（比 7–8× 温和）。金测全绿。证据 `painting/p0p1f1-r9-combined-source.json`（`revision_2026-09-13_isolate_sink_final`）。
- **第十一轮 模式隔离（作者「切换首页的时候中心还会继续生成」）**：⑳ 上一轮只加了**相位**门，而首页混沌态的相位恰好就是 DWELL → 照旧生成。补**模式门**：模块新增 `setSourceEnabled(on)`（关则立刻释放全部源粒子，`sourceEnabled` 外露），页面在 `setMode()` 与 `rebuildRadialWorld()` 里按模式开关——**只有 assemble / formed（画作态）开**，chaos（首页）/ disperse / handover 一律关。实测：**首页长留 45s**：mode=chaos、开关 **false**、源 **0**、存活 **50,601 = N**、中心填充 1（完全不生成）；**切到画作**：开关转 true、源从 0 按需生成（18s 143 → 28s 1,029，随后稳定 ~1,000、填充 ~0.49–0.51）。金测全绿。证据同上（`revision_2026-09-13_mode_isolation`）。
- **第十二轮 强档定稿 + 提前介入（作者「画作态更强可以可以，生成再稍微早那么 1s 或者 2s 就完美了」）**：㉑ 后段目标 0.6 → **0.8**（即作者试的 `?sourcetarget=0.8` 档，定为默认）；升档起点 5s → **3.5s**（提前 1.5s，满强档 15s → **13.5s**）。实测（画作态 autoplay=1）：源介入时点 **18s → 16s**（提前 2s）；稳态源粒子 ~**1,480**（+2.9%）、中心填充稳定 **0.63–0.67**（弱档 setpoint 时为 ~0.49，确实更强）；首页仍为「开关 false、源 0、总数 = N」。金测全绿。证据同上（`revision_2026-09-13_strong_earlier`）。
- **第十三轮 起点 1s + 目标 0.85（作者「改成 1s，画作态可以 0.85」）**：㉒ 升档起点 3.5s → **1s**（满强档 **11s**）、后段目标 0.8 → **0.85**。实测（画作态）：源介入 **16s → 14s**；稳态源粒子 ~**1,600（+3.2%）**、中心填充 **0.67–0.72**；首页仍完全不生成（开关 false、源 0、总数 = N）。金测全绿。证据同上（`revision_2026-09-13_1s_085`）。
- **第十四轮 生成区再收小（作者「中心生成区范围还是有点大，改小一点」）**：㉓ 中心带 0.14 → **0.10** 盒半径（≈24×31px）、出生抖动 0.06 → **0.05**。实测（画作态）：存活源粒子的**实际分布半径** P90 = **0.094–0.129**（≈24–32px）、均值 ≈0.09（≈22px）→ 生成确实压在更小范围；带更小、见稀更快 ⇒ 源介入提前到 **12s**；稳态源 ~**1,200–1,300（+2.4%）**、中心填充 ~**0.69–0.78**；首页仍完全不生成。金测全绿。证据同上（`revision_2026-09-13_band_010`）。
- **第十五轮 起步快/后段降速 + 同速外逸（作者「生成太快了，到了后期都挤中间，可以一开始快，后面减低速度和周围粒子相同速度」）**：㉔ 速率改**先快后慢**——快档 1500 粒/s，自升档起点 +12s 起用 12s 平滑降到**维持档 450 粒/s**（=强档×0.30，`?sourcerate=` 成比例缩放）；㉕ 源粒子外逸权重下限 **SRC_WE_MIN=1.0（≈5px/s，与周围同速）**，不再吃内核 0.45 的慢档。实测（画作态）：速率 1500 → 1445 → 1114 → 540 → **450/s**；源粒子平均半径 0.039→**0.123**、P90 0.062→**0.18**（确实随周围一起外走，不再赖在中心）；源数量 25s 达峰 ~1,889 后回落 ~1,245；**38.8s 密度剖面：中心带 0.43–0.61 vs 相邻环 0.48–0.61 ＝齐平**（不挤中间），而关源时最内环只有 0.06–0.18（洞仍被补）。首页仍完全不生成。金测全绿。证据同上（`revision_2026-09-13_taper_samespeed`）。
- **第十六轮 滑动鼠标顿挫（作者「有时滑动鼠标会顿住」）**：㉖ 先排除「扫进扫出触发世界重建」——实测连续滑动 8s **重建 0 次**；锁定指针路径本身：每帧 `wakeAll()` 把**全部 60,721 粒叫醒**（睡眠优化整段失效）＋ 8 次 6 万粒整表拷贝（x/y/vx/vy 拷进世界再拷回）。修法：**只唤醒被驱离波及的粒子**；**驱离改在模块内施加**（新 API `world.repelAt()`，省掉 4 次「拷进去」的整表拷贝）。回退 `?repelmodule=0`。复验：力形未变（近心轻推 + 离开复原；`?repel=old` 对照仍复现 100px 圆环）、金测全绿。**如实说明**：本地无头软件渲染噪声 ±3ms、基线 14–16ms/帧，量不出 1–2ms 改善；这两处去掉的是随粒子数增长的每帧工作量，真机上应明显缓解。证据 `painting/p0p1f1-r7-pointer.json`（`revision_2026-09-13_hover_hitch`）。
- **上传采样与三图放映 S1–S3（规格 v1，作者 2026-09-13 转发并确认「不兼容部分按 Codex 口径」）**：㉗ **采样器**——`prototype/nf-upload-worker.js` 复刻 S0 屏蔽（OKLab L≥0.19、质心、R95=p95）/S2a 候选（5×N、W(r)=0.2+0.8e^(−2.5r)、固定种子置换）/S2b 细化（r_local=s0·√(Wmax/w)、网格 dart-thinning、s0 二分 ±2%）/OKLab 256 色/count 拟合，Worker 与 Node 同一份代码；验收 §9-A 11 项全绿（N=50k 842ms），§9-B 真图 Dallas 原生 1200×1540：**R95 0.599042（与参考逐位吻合）、s0 2.667368（逐位吻合）**、count 50000、palette 256、1377ms。㉘ **接线**——`loadTargetRecord` 顶部 uploadRecord 分支、`radialPaintingKey()`/`radialR95()` 的 `upload:<id>` 口径、`openArchive(view,origin,overrideTarget)` 三参 + `exhibitShow` 传目标、`EXHIBIT_WORKS` 动态 caption、单图停留（paused-control）、`exhibitResumePlay` 拦截、catalog 换入换出、控制台 `UPLOAD` 键与放映条「自定义放映 ▶（n）」。验收 §9-C：上传图 escP95 0 → 34.29（同一条物理链）；§9-D：三图循环 U1→U2→U3→U1→U2（两圈）、返回默认目录、队列保留、0 报错。开关 `?upload=0` / `?upmax=` / `?upstart=auto` / `?sampler=fast`。金测全绿、三画资产未动。证据 `painting/upload-s2s3.json`。
- **第十八轮 投放面板（作者「太不方便了，你搜一下专业的解决方案」）**：㉙ 按专业 pattern 补齐入口——依据 `uxpatterns.dev/patterns/forms/file-input`（含 WCAG 2.2 / MDN 引用；旁证 saasui.design、filestack）的硬性条目：**拖放只能是增强、必须给可见择取入口**、必须显示所选文件（名/大小/可移除）、图片给缩略图、约束前置、>1s 过程给进度条、拖放区键盘可达（role=button + tabindex=0 + Enter/Space）、aria-live 播报与 `aria-label="移除 <名>"`。实现：`nf-upload.js` 内建**投放面板**（虚线拖放区 + 「拖入图片，或点击选择」+ 约束提示 + 槽位列表含缩略图/读数/逐项移除 + 底部「开始放映 ▶（n）」/「清空」）；控制台 `UPLOAD` 键改为**开面板**（不再直接弹框）；拖文件进页面 → 自动展开面板；Worker 新增阶段进度消息驱动逐行 `role=progressbar`；缩略图用 objectURL 并在移除/清空时 revoke。验收 `upload-panel-check.js` **9/9**（面板可开、键盘可达、约束前置、两行槽位缩略图+进度+移除标签、≥2 张「开始放映」可用、面板键 → rotating/UPLOAD_1、移除后槽=1 且放映条隐藏、0 报错）；金测全绿。截图 `nf-baseline-artifacts/upload-panel-2slots.jpg`。**待拍板**：① 进度仍是 4 档粗粒度；② 刷新保留（IndexedDB / File System Access API）仍是规格 §13-⑦ 未来件——要做请示意。
- **第十九轮 「放映一直是第一张」核查（作者提问）**：㉚ 结论 **不是 bug**——数据侧（`__nfExhibit.key`/`__nfRadial.scene`/`__nfPoints.id`/palette/tx 逐步全不同；两圈 1→2→3→1→2→3）与画面侧（画作盒内亮斑质心 **132,160 → 244,324 → 359,484 → 回到 131,160**；相邻步平均亮度差 10–11、变化像素 5.6%）双重证明会切换；悬停暂停也已排除（指针停在画作正中 14s 仍 U1→U2→U3）。看起来「没换」的真因两条：**① 单图停留**（规格 §7：投第 1 张即停在该图，须按「开始放映 ▶（n）」才进循环目录）+ **② `?dwell=30000`**（每张 30s）。修法：面板新增**状态行**（250ms，`role=status`+aria-live）把四条状态说清——未投放 / 单图停留（提示去按「开始放映」）/ 队列就绪 n/3 / 自定义放映中 第 k/n 张（下一张 Ns），悬停时补「悬停暂停」；`upload-state-line.js` 四条逐条命中、0 报错。证据 `painting/upload-s2s3.json`（`always_first_image_2026-09-13`）、截图 `show-step-{1..4}-*.jpg`、`upload-state-{single-stay,rotating}.jpg`。
- 上述四批的改动**尚未 commit**；工作树里的 `painting/codex-*.json`、`painting/assembly-v3-d-*` 与两份申议是随改动一起待提交的产物。

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
3. 只做用户这一次点名的事。现网默认 Pixi + 径向 50k（介绍/大厅/社区）。`?radial=0` 回 100k + 弹簧 0.055。`?bin=0` 回 12k JSON。`points.bin` 现有 9B `NFPT` 头。不要改 `SPRING_SHARP`。不要删 `physics()` / `applySpring`。不要启用 E，不要把现网换成 S4 ImageData。
