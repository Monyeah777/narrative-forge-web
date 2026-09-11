# 交接：NarrativeForge 展示站 + 首屏原型

把**本文件整份**丢进新对话框（`@HANDOFF.md`），并先贴下面「开场口令」。手册冲突以手册为准；**用户最新一条口令同时赢过手册和本文件**。先求证代码，不要凭记忆改。UI 改完要在浏览器里点一遍。

上一长会话：[闭环执行协议](https://cursor.com/agents/bc-6c7fea7d-85b8-45f0-90a5-5e11ea94ae29)  
更早：[宇宙像素档案原型](ec3b0955-b215-4fb7-a7a3-0fb68475fc6a)

日期：2026-09-11。用户身份：Student，倾向直接改代码迭代。界面与回复用中文。

---

## 开场口令（新对话框第一句，整段复制）

```
读 @HANDOFF.md。按里面的锁死约定继续。先 git fetch，再 checkout cursor/b1-2-sampling-ae29（不要 main，不要停在 pixel-nav-vol-red / a0-1-color-scheme）。

手册：@NF_Cursor______v1_2026-09-11_b3f3.md（若没有这份上传，以用户给出的《NF · Cursor 总执行手册 v1》为准）。用户最新口令赢手册。

轨道 A：只改 prototype/index.html（Canvas 2D）。不要移植进 Next，除非用户点名。单步闭环：一次只做手册一条（或用户点名的一次微调）；做完用【参考链接】【实现摘要】【自测证据】汇报，停等「继续」。不要自己开下一条。

当前手册进度：A0–A2 + A3-1/2/5 已落地；A3-3 跳过；A3-4 做过又按用户删掉。B1-1 / B1-2 已完成。屏幕粒子仍是 NF 字形（prototype/points.json），画作 12k 在 painting/points.json 尚未接入。

下一手册条默认 B1-4（把契约 v2 接进 fetch/preload）。动手前先报告分叉：PR #23（cursor/b1-1-hd-bake-52ec）用 HD master 重烤了 01-dallas.jpg 为 1200×1540，但没有重跑 B1-2 采样，且没有叠在 B1-2 上。用户没表态前不要擅自选 A/B。

三键只留灯、不控粒子；导航不要 START。不要改 Langevin 物理常数。不要把运行时粒子数直接跳到 12k，除非正在做用户点名的 B1-4/B2。禁止 stash / reset --hard / force-push，除非用户确认。
```

---

## 0. 新会话立刻要做的 git

```
git fetch origin
git checkout cursor/b1-2-sampling-ae29
git pull origin cursor/b1-2-sampling-ae29
```

这是**引擎 + 12k 采样**的 tip（PR #22）。本交接文件若在 `cursor/handoff-transfer-ae29`，那是叠在 B1-2 上的文档 PR，checkout 它也可以（含更新后的 HANDOFF.md）。

**不要**停在：

| 错的分支 | 为什么 |
|---|---|
| `main` | 看不到原型 |
| `task/T-0005-community` | 只有最早那版尘场 |
| `cursor/pixel-nav-vol-red-ae29` | 栈中段，缺 arcade / CRT / B1 |
| `cursor/a0-1-color-scheme-ae29` | 叠错基底的 A0-1（PR #1）；正统 A0-1 是 PR #2 |
| 只 checkout `cursor/b1-1-hd-bake-52ec` | 有 HD 烤图，**没有** B1-2 的 12k 点，也没有 B1-2 之后的引擎 tip 之上的采样 |

云端 Agent：按环境叠 PR；新分支名 `cursor/<描述>-ae29`；`base_branch` 必须是当前 tip，不要叠回过期分支。本机 Cursor：用户没说 commit 就不要 commit。任何会话都禁止 stash / reset --hard / restore 覆盖 / force-push，除非先说明影响并得到「确认/可以/执行」。

---

## 1. 当前停在哪 / 下一步

手册 **B1-2 已完成**，等用户说「继续」。**不要开 B1-3**（实现路径 A/B 对照：路径 A 的 Python 脚本已经是采样器）。

| 项 | 状态 |
|---|---|
| 工程内预览源（B1-2 这条线上） | `painting/01-dallas.jpg` **1200×1519**，Commons 公版替身，`standIn: true`，已 EXIF 烘焙、画心 `cropNorm`、HSV S×0.88 |
| 元数据 | `painting/source.json` |
| 预处理 | `scripts/prep-painting.py` |
| 采样 | `scripts/sample-painting.py` → `painting/points.json`（契约 v2）+ `painting/sample-stats.json` |
| 屏幕粒子 | 仍 `fetch("points.json")` → `prototype/points.json`（NF 栅格 ~1630 点，`{points:[{x,y},…]}`） |
| 运行时数量 | 仍 `capCount()` **960 / 1280 / 1600**，不是 12k |
| 作者本机 `painting/` | 云端克隆里原先没有；B1-1 曾临时入库 `painting/masters/`（达拉斯 / 苏格兰 / 费城 / Met / 竖图 + previews） |

**默认下一手册条：B1-4**（preload + 加载契约 v2；gzip 已 76609 < 120KB）。B1-4 会改 `fetch` / `parsePoints` / 数量，等于把 12k 送进循环——这和「用户说过先别改物理、先别跳 12k」冲突。执行 B1-4 前在【实现摘要】里写明这条冲突，按用户「继续」视为授权接加载，**仍不要改** `SPRING` / `GAMMA0` / curl 等常数（那是 B3）。

### 分叉（动手前必须报告，禁止自行裁决）

并行 PR **#23** `cursor/b1-1-hd-bake-52ec`（base = `cursor/b1-1-dallas-preview-ae29`，**不是** B1-2）：

- 用 `dallas_lespeupliers_5497x7054.jpg` 重烤 `01-dallas.jpg` → **1200×1540**，master 已是画心故 **不裁框**
- `source.json`：`standIn: false`，`cropNorm: null`
- 删掉 `painting/masters/`（高清不进 git）
- **没有**重跑 `sample-painting.py`，因此这条线上没有新的 12k

用户说「继续」且没点名时，停下来给两个方案：

1. **先吃 HD**：把 #23 合进/rebase 到 B1-2 之上（或 cherry-pick 烤图 + source.json + prep 修补），再重跑 `python3 scripts/sample-painting.py`，**然后**才 B1-4。
2. **先通管线**：忽略 #23，对当前 Commons 替身的 12k 做 B1-4；HD 以后再重采。

作者本机 `C:\Users\mon_7\Downloads\narrative-forge-web\painting` 若另有主视觉：`python3 scripts/prep-painting.py --input <file>` → `python3 scripts/sample-painting.py`。高清原图 gitignore，只跟踪 1200px 预览 + v2 采样。

---

## 2. 执行协议（单步闭环）

1. 一次只做**手册一条编号**，或用户点名的**一次**微调。
2. 先按该条【检索词】搜 2–4 条，再改代码。
3. 改完用该条【验收】自测（数字 + 截图/录屏如适用）。
4. 汇报固定三段：**【参考链接】【实现摘要】【自测证据】**。禁止把多条揉成一条。
5. 停。等用户说「继续」再开下一条。
6. 冲突或不可行 → §0.8：停 + 报告冲突点 + ≥2 个方案。禁止静默改参数。

手册赢旧 HANDOFF；**用户最新口令赢手册**（下面 §4 已登记的口令继续有效，直到用户改口）。

云端预览：在 `prototype/` 跑 `python3 -m http.server 8768 --bind 127.0.0.1` → http://127.0.0.1:8768/ 。**不要**让用户双击 `index.html`。交付时可把 `prototype/` 打成 zip 放到 `/opt/cursor/artifacts/`，并附 `打开预览.txt`。

---

## 3. 仓库 / 预览 / 两轨

| 项 | 值 |
|---|---|
| GitHub | `Monyeah777/narrative-forge-web` |
| 本机 | `C:\Users\mon_7\Downloads\narrative-forge-web` |
| 手册 | 上传区 `NF_Cursor______v1_2026-09-11_b3f3.md`；基底未述部分仍看《NF首屏_执行清单 v3.0》 |
| 原型 | `prototype/index.html`（同目录 `points.json`、`gen-points.mjs`） |
| 画作 | `painting/01-dallas.jpg` + `source.json` + `points.json` + `sample-stats.json` |
| NF 主仓 | `C:\Users\mon_7\Downloads\NarrativeForge-main` |
| Next | `npm run dev` → http://localhost:3000 （**不是**当前主战场） |
| 原型预览 | `prototype/` 下 python http.server **8768** |

Next.js 版本与训练记忆不同。改 Next 前读 `node_modules/next/dist/docs/`。根目录 `AGENTS.md` 会被 `next dev` 重写。

**轨道 A（进行中）**：零依赖单文件 `prototype/index.html`。只吃 Canvas 2D。不进 Next 构建。

**轨道 B（未开始）**：原型验收后 1:1 移植 `src/app/page.tsx`。现在不要动 `src/app` 首屏。

站点里已有 `SiteNav`、大厅裁剪、社区占位，和原型是两套 UI。

---

## 4. 用户口令（赢过手册 · 不要改回去）

1. **街机控制台重做**：三键从 `.paper` 挪到视口**右下**，像素字（Press Start 2P **10px**，`letter-spacing: 0.25em`，键距 `2rem`）。左 `INSERT COIN`、右 `CREDIT 01`（8px `#8E959D`，不可点）。无边框/填充/发光/`text-shadow`。`.arcade`：`position:fixed; right:8%; bottom:2.75rem; z-index:10000; pointer-events:none`，键 `pointer-events:auto`。CRT 暗角会吃掉 `.stage` 里的小字，所以 arcade / viewfinder 必须是 **body 兄弟、CRT 之后**，不能放进 `.paper`。
2. **三键只留灯、不控粒子**（覆盖手册 A3-2 / A3-3 与 B3「状态联动」里 START=assemble / SAVE=冻结 / SETTINGS=切 drive）：
   - START：`#A33B2A`，1.8s 呼吸 0.3↔1，`:active { transform: translateY(1px) }`；**没有 click handler**，**不** `assemble`。
   - SAVE：点击加 `is-saved` → `#E5E7EB` **1.5s**；**不**冻结。
   - SETTINGS：点击加 `is-lit` + **inline** `color:#6F8FAF` **1s**（否则 hover 白会盖住）；**不**切 drive，**没有** `> MODE:` 行。
   - 循环里已删除 `DRIVES` / `applyDrive` / `setFrozen` / `data-frozen`；弹簧回到 `SPRING` / `VMAX`。
3. **A3-3 跳过**（MODE aria-live + SETTINGS 循环）——和（2）冲突。
4. **不要**在「首页」旁边再放装饰 START（A3-4 做过，用户说「首页旁边的start删掉」后已从 PR #20 去掉）。`#btn-home` 文案只有「首页」。街机 `#btn-start` 保留。
5. **A3-5 彩蛋染色已落地**：assemble 过程白精灵；进入 `formed` 后 200ms 淡到与标题同一对金属渐变（见 §6）。介绍/大厅/社区成的也是同一套 NF 字形；页脚 NF 是首页多一条入口，不是唯一触发。

---

## 5. 锁死视觉（以代码为准，不是旧 Courier 稿）

- 深空 `#050505`，禁 `#000`。
- `color-scheme: dark` + `<meta name="theme-color" content="#050505">`。
- Canvas `#void`：`position:fixed; inset 0; 100vw/100vh; z-index:1`；`touch-action: none`；`getContext("2d")` **不要** `{alpha:false}`；每帧 `clearRect`，禁止 `fillRect(#050505)`。
- `.fx-grid` z-index **0**（8px α 0.018 + 40px α 0.022）。不要在 reduced-motion 里藏栅格。不要实现会藏栅格的 `?fx=lite`。
- `.fx-crt` z-index **9999**，`pointer-events:none`，无 `backdrop-filter`，扫描线**不滚动**。高光 **0.14** @78%/-8%；板洗 0.05；扫描线 **0.03**；暗角 **0.55**；1px 内沿 0.14。
- `.viewfinder`：body 兄弟、CRT 之后，`z-index:10000`，`inset:16px`。四角 `#8E959D`。REC 点 2.4s 呼吸。
- `.paper`：除 A1-4 底板光 α **0.028** / 180px 外全透明。禁黑板底板。
- 标题：自托管 Press Start 2P；N/F 金属渐变 **135°**；FORGE 后空 `.cursor` 闪烁块。文字**不要** `image-rendering`。标题最大 40px、8px 网格对齐。
  - N：`#5A6B72 → #3A4A52 → #25343E`
  - F：`#D0E3F0 → #8BA7C4 → #4A6B8A`
- 导航：首页 / 介绍 / 大厅 / 社区。Fusion Pixel 12、**12px**、`letter-spacing: 0.25em`、`text-shadow: none`。`::before` 画 `>`，HTML 里不要写勾。同时只有一个 `aria-current`。
- VOL：标签 `#8E959D`，`VOL. 01` `#A33B2A`；scramble 之后要 `paintVol()`，否则红会丢。
- GitHub / Gitee：自托管 Press Start 2P，无边框无填充，`rel="noopener noreferrer"`。不要再走 Google Fonts CDN。
- 访客控件只有：四项导航 + GitHub/Gitee + 页脚彩蛋 NF + 右下三键（灯）。不要再加盒装 CTA。不要加回 `#sight` / `cursor:none`。
- 禁：WebGL / Three / p5、字体 CDN、每帧 `getImageData`、每帧 `ctx.arc()`、`shadowBlur` / 发光、扫描线动画、`backdrop-filter`、双色 glitch、大面积彩色渐变、自动降级路径。
- `:focus-visible` 环 `#6F8FAF` / 2px / offset 3px。控制钮 `touch-action: manipulation`（画布是 `none`）。
- 调试：`?dpr=` 可用。

### 文案（锁）

- 报头：`NarrativeForge`（两行 NARRATIVE / FORGE）
- VOL：`COSMIC PIXEL ARCHIVE · VOL. 01`
- 介绍主句：把叙事，变成工程。
- 介绍副句：质量不是猜出来的，是校验出来的。
- 页脚：`NF · 内容契约层 · 定内容，不定模型`

### 必须保留的 ID / API

`#stage` `#void` `#dossier` `#btn-home` `#btn-intro` `#btn-hall` `#btn-community` `#btn-egg` `#btn-start` `#btn-save` `#btn-settings`

`window.assemble()` → 介绍（`openArchive("intro")`）；`window.disperse()` → 首页。

事件架构保留：Pointer Events、`prefers-reduced-motion`、`visibilitychange`、resize debounce ~150ms、固定步长 `DT=1/60` + 累加器（`MAX_STEPS=2`，`FRAME_CLAMP=0.25`）。

---

## 6. 状态机 / 彩蛋 / 染色（现状）

规格原文只有「首页混沌 / 介绍成画」。实现已扩成四视图：

| 动作 | 粒子 | 右侧 |
|---|---|---|
| 首页 | `disperse` → `chaos` | 报头+导航，dossier 隐藏 |
| 介绍 | 已 formed 只换面板；否则 `assemble` | 介绍两句 |
| 数据大厅 | 同上 | 官方 13 模块 + P00/P01/P90 + 三资产键 +「打开完整大厅」 |
| 社区 | 同上 | 货架说明 +「打开社区页」 |
| 页脚 NF | `assemble`，**不改导航** | 人在首页则不显示介绍文案 |

`currentView`：`home | intro | hall | community`。

彩蛋点击对象：页脚「**NF** · 内容契约层」里、内容契约层**左边**那颗 `#btn-egg`。不是视口角落小字（已删 `.egg-mark`）。不是点「社区」。已 formed 再点 NF：`burstFromGlyph` + `assemble`。

A3-5：`ntx < GLYPH_SPLIT` → N 否则 F；`t = (clamp(u)+clamp(v))/2` 落在 `gen-points.mjs` 几何上（`GLYPH_N` ox 0.07，`GLYPH_F` ox 0.34，cell 0.034×0.075）。离屏 `source-in` 预染（`TINT_STEPS` 12），**禁止每帧 `getImageData`**。reduced-motion：formed 时直接显色。

独立预览时 `#go-hall` / `#go-community` 写成 `http://localhost:3000/hall` 与 `/community`。Next 没开就会 404，已知。

---

## 7. 粒子引擎（不要重写物理）

文件：

- `prototype/index.html` 引擎
- `prototype/points.json` v1：`{ "points": [{x,y}, ...] }` 归一化 0..1，约 **1630** 点
- `prototype/gen-points.mjs` 确定性栅格 N/F（mulberry32 seed `0x4e46`），落在左约 62%
- `painting/points.json` 契约 v2：`palette[]` + `points: [[x,y,i], ...]`，**12000** 点，k=256，seed **20038**（脚本默认也提到 `0x4E46`）

`parsePoints()` 今天只抽 x,y（对象 `{x,y}` 或数组 `[x,y,…]`），**丢掉 palette 索引**。接 B1-4 时要同时吃 v2，并改 preload（现在 preload 的是 `prototype/points.json`）。

物理常量（现状；与手册 B3 凌厉组 0.055/0.90 **不同**，改前先问）：

```
SPRING 0.012  GAMMA0 0.042  KT0 0.0018  V_TERM 0.01
CURL_AMP 20  CURL_K 0.0036  REPEL_R 50  REPEL 0.11
VMAX 1.05  IDLE 0.14  POINTER_LERP 0.2
DT 1/60  MAX_STEPS 2  FRAME_CLAMP 0.25
SIZES [4, 6, 8]
```

有字形时（`hasGlyph`）：formed 且指针不在则关卷流，弹簧用满 `SPRING`。指针靠近仍驱离。混沌态环面包裹。NaN 走 `healParticle`。`imageSmoothingEnabled = true`。

精灵：实心径向（中心不透明、边缘透明），三色相（暖/银/冷），假深度 `z`。这是 NF 字形期的样子；B2 才改成调色板图集 + ImageBitmap + 2/3/4px。

手册要 12k 全设备一致、取消分档。运行时仍分档 960/1280/1600——这是 B1-4 / B4 的冲突点，不要在别的条目里偷偷改。

---

## 8. B1-2 采样数字（Commons 替身 · 在 tip 上）

`painting/sample-stats.json`：

| 检查 | 值 | 手册门槛 |
|---|---|---|
| count | 12000 | 12000 |
| k | 256 | 160–256 |
| gzip | **76609** | <120KB |
| raw | 240054 | — |
| dark cull L<0.19 | **0.05%** | 约 3–6%（达拉斯高调；p01 L≈0.54；故意保持 0.19 以免吃中灰） |
| ΔEOK×100 mean | **0.72** | ≤2 通过 |
| ΔEOK×100 max | **3.76** | ≤2 **未过**（k-center max 2.16；盖满 ≤2 约需 k≈268） |
| 色相「总量」有符号圆均值 | **0.01°** | ≤2° 通过 |
| 未加权 \|Δh\| 均值 | ~7.7° | 手册「总量」按圆均值理解 |

散点远看像原画。**不要**把 `painting/points.json` 直接覆盖 `prototype/points.json`（格式不同，且会毁掉 NF 字形兜底）。

---

## 9. PR 栈（正统一条链）

| PR | 分支 | base | 内容 |
|---|---|---|---|
| #2 | `cursor/a0-1-prototype-color-scheme-ae29` | T-0005 | A0-1（正统） |
| #3–#16 | A0-2 … A3-2 | 叠 | 焦点 / 触控 / 字体 / 标题 / 栅格 / clearRect / CRT / 取景器 / 控制台视觉+曾接线 |
| #17 | `cursor/arcade-console-panel-ae29` | A3-2 | 街机 HUD；后来 commit 拆掉粒子控制 |
| #18 | `cursor/a3-4-nav-start-ae29` | arcade | 导航 START（**已被 #20 覆盖**） |
| #19 | `cursor/a3-5-egg-tint-ae29` | A3-4 | NF 金属染色 |
| #20 | `cursor/remove-nav-start-ae29` | A3-5 | 删导航 START |
| #21 | `cursor/b1-1-dallas-preview-ae29` | #20 | B1-1 Commons 1200×1519 |
| **#22** | **`cursor/b1-2-sampling-ae29`** | #21 | **B1-2 12k · 当前引擎+采样 tip** |

旁路（不要当成 tip）：

| PR | 说明 |
|---|---|
| #1 | 错基底的 A0-1，忽略 |
| **#23** | HD 重烤 1200×1540，base 在 B1-1，**未**含 B1-2 采样 |

---

## 10. 未完成 / 已知问题

1. 轨道 B（Next 首屏移植）未开始。
2. 屏幕仍是像素 NF；接画作 = B1-4。HD 烤图在 #23，与 12k 采样不在同一分支。
3. 大厅目录在窄报章栏会按字折行。
4. 介绍/大厅/社区成画都是同一套 NF；若用户要「只有彩蛋才出字形」，先问再改。
5. 「打开完整大厅/社区页」依赖 localhost:3000。
6. 手册 CRT 扫描线 α 0.012、栅格 0.025；代码里扫描线 **0.03**、双套栅格 0.018/0.022——这是已落地的视觉，不要用手册旧表覆盖，除非用户点名。
7. 手册 A3-2 验收（START 重组 / SAVE 冻结 / SETTINGS 切 B）已被用户口令废止；A3-5 染色仍要保持。
8. B2（软边 2/3/4px + ImageBitmap + 分桶色）/ B3（凌厉弹簧、可打断、停帧）/ B4（bench）都还没做。B3 物理与当前 Langevin **会打架**——做到那条时按 §0.8 停，不要先斩后奏。
9. 并发会话共用本仓：禁止顺手 stash/reset。

---

## 11. 官方名称（大厅文案）

模块：季节天气，任务剧情，NPC 对话，NPC 交互，世界知识库，事件叙事，技术文档结构，数据结构，时间推进，认知边界，组合规则，主循环，输出生成器。

管线：P00 通用文档生成管线，P01 标准管线（官方核心装配），P90 技术文档生成管线。

资产键：STYLE_DNA，TECH_RULES，TECH_TEMPLATES。

`content/generated/` 由 `scripts/sync-nf.mjs` 从主仓投影，不要手改生成物。

---

## 12. 改 UI 时怎么验

浏览器里按真人路径点，不要只截一张静图：

1. 首页星尘漂，无准星，普通指针；栅格从粒子缝里透出来。
2. 点介绍 → 左侧收成 NF，成形后 N/F 金属染色，右侧两句渐显。
3. 点数据大厅 / 社区 → 字形留着，只换文案。
4. 点首页 → 打散，文案隐藏。
5. 停在首页，点页脚 NF → 收成 NF，导航仍是首页，介绍句不出现。
6. START 只呼吸，不组字；SAVE 银灯 1.5s；SETTINGS 蓝灯 1s。粒子不被这三键改变。
7. 导航没有第二个 START。GitHub/Gitee hover 字变实 + 细下划线；指针划过粒子会被拨开。
8. Tab 焦点环可见。取景器四角和 REC 在 CRT 之上仍可读。

---

## 13. 新会话建议第一步

1. fetch + checkout §0 的 tip，打开 http://127.0.0.1:8768/ 看现行原型。
2. 读 `prototype/index.html` 的 arcade / viewfinder / `openArchive` / `triggerEgg` / `glyphTintK`，不要重写引擎。
3. 只做用户这一次点名的事。没说「继续」就不要开 B1-4。规格里的 Fusion Pixel 子集化、Next 移植、手册 B3 弹簧，先问。
