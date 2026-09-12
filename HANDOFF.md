# 交接：NarrativeForge 展示站 + 首屏原型

把本文件整份丢进新对话框（或 `@HANDOFF.md`），并附上：

> 读 `HANDOFF.md`，按里面的锁死约定继续。先求证代码，不要凭记忆改。未明确要求不要 commit。UI 改完要在浏览器里点一遍。

上一会话：[宇宙像素档案原型](ec3b0955-b215-4fb7-a7a3-0fb68475fc6a)

日期：2026-09-11。用户身份：Student，倾向直接改代码迭代。界面与回复用中文。

## 当前进度（云端 Track A）

手册 **B3 已完成**。刚做完单点微调：**全屏曲面 CRT**（撤销左右硬切分）。不要开 B4。

- 凌厉弹簧 0.055 / 阻尼 0.90 / vmax 10；临界停止 0.6px / 0.06；驱离 100px 平方反比
- 成画 1.5s（最早 1.2s）、回退 1.1s；相位时间走固定步长，冻结不计入
- START / 介绍 = assemble（可打断、不重置数组）；首页 = 软解构
- SAVE 冻结（aria-pressed 常亮）；SETTINGS 循环 A/B/C（LOW DRIFT / STORM / STILL）
- `prefers-reduced-motion` → 直接静态成画
- 本条分支：`cursor/b3-assemble-spring-52ec`（叠在 `cursor/b2-render-atlas-52ec` 上）
- B2 仍有效：12k ImageBitmap 分桶绘制
- CRT 微调：画布 100vw×100vh；成画 70vh、中心偏左 15%；报章无底板；`.crt-shell` 是**空的全屏叠层**（不要拿带 `transform` 的外壳去包 canvas，否则 `position:fixed` 不再相对视口）；厚边框+微曲面（无 WebGL / Pixi / fragment shader）
- `ntx/nty` 永远是画作源空间 0–1；`tx/ty` 才是屏幕像素。`toNorm()` 不得回写 `ntx/nty`
- 本条分支：`cursor/crt-fullscreen-tube-52ec`（叠在 `cursor/b3-assemble-spring-52ec` 上）

---

## 仓库与预览

| 项 | 值 |
|---|---|
| 本仓 | `C:\Users\mon_7\Downloads\narrative-forge-web` |
| GitHub | `Monyeah777/narrative-forge-web` |
| 当前分支 | 云端叠 PR 在 `cursor/crt-fullscreen-tube-52ec` |
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
- **不要**再加盒装 CTA / 测试按钮。访客控件只有：四项导航 + GitHub/Gitee + 文案里那颗彩蛋 NF。
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

`window.assemble()` → 等同点「介绍」；`window.disperse()` → 等同点「首页」。

事件架构保留：Pointer Events、`prefers-reduced-motion`、`visibilitychange`、resize debounce ~150ms、固定步长 1/60 + 累加器（每帧最多 2 步）。

---

## 轨道 A · 状态机（现状，不是规格原文）

规格原文只有「首页混沌 / 介绍成画」。实现已扩成四视图：

| 动作 | 粒子 | 右侧 |
|---|---|---|
| 首页 | `disperse` → `chaos` | 报头+导航，dossier 隐藏 |
| 介绍 | 若已 formed 只换面板；否则 `assemble` | 介绍两句 |
| 数据大厅 | 同上 | 官方 13 模块 + P00/P01/P90 + 三资产键 +「打开完整大厅」 |
| 社区 | 同上 | 货架说明 +「打开社区页」 |
| 彩蛋 NF | `assemble`，**不改导航** | 若人在首页，仍不显示介绍文案 |

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
- `prototype/assets/points.json` 契约 v2：`{id,w,h,count,note,palette,points:[[x,y,i],...]}`，12k，与 `painting/points.json` 同字节
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

成画静止后停 rAF。指针靠近仍驱离（半径 100px，冻结关闭）。混沌态环面包裹。SETTINGS 可切 A/B/C。

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
2. 成画已是达拉斯 12k 调色盘点云（contain + 凌厉弹簧）。**60fps / long task / 相似度是 B4**。不要在 B4 前改视觉档。
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
3. 点数据大厅 / 社区 → 点云留着，只换文案；不是只改 `aria-current`。
4. 点首页 → 打散，文案隐藏。
5. 停在首页，点页脚 NF（内容契约层左边）→ 收成画作点云，导航仍是首页，介绍句不出现。
6. GitHub/Gitee hover：字变实 + 细下划线；指针划过粒子会被拨开。

---

## 新会话建议第一步

1. 打开 http://localhost:8768/ 看现行原型（没有服务就在 `prototype/` 起 python http.server）。
2. 读 `prototype/index.html` 的 CSS 报章区 + `openArchive` / `triggerEgg`，不要重写引擎。
3. 只做用户这一次点名的事。规格里未点名的轨道 B、Fusion Pixel，先问。B4 性能自检等用户说「继续」。
