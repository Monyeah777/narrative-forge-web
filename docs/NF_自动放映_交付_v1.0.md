# 《自动放映》交付 v1.0

> **裁决编号**：`NF-EXHIBIT-DELIVER-20260912` · 2026-09-12  
> **范围**：修订包 v1.0 §9.0–§9.6 · 轨道 A · `prototype/index.html`  
> **不包含**：轨道 B / Fusion Pixel / 彩度 v2–v3 / 手册 §6 总验收

运行时权威是 `prototype/index.html` 内联 `exhibitManifest`。`prototype/assets/exhibit-manifest.json` 是对照副本，**运行时不 fetch**。

叠 PR：#34 多画作 → #35 放映状态机 → #36 画区云 → #37 交接 → #38 像素块+尘埃 → #39 B4.1 → 本交付。

---

## 1 · Manifest diff

| 键 | 包落地前 | 现在（默认） |
|---|---|---|
| （无 manifest） | 单幅手动 assemble | `id=exhibit-v1` |
| `autoplay.enabled` | — | `true`（`?autoplay=0` 回手动） |
| `motion.discipline` | 成画停 rAF | `v2`（`?discipline=classic` 回旧规） |
| `dwellMs` / `transitionMs` / `introRevealMs` | — | `10000` / `3000` / `2400` |
| `idleResumeMs` / `hoverResumeMs` / `captionSwapMs` | — | `30000` / `1500` / `300` |
| `seed` / `seedMode` | 均匀全视口 | `0x4e46` / `cloud` |
| `catalog` | — | `INTRO, HALL, COMMUNITY` |
| `transition` | — | `group=develop, arc=on, handover=on` |
| `pixelBlock` | 软边 atlas cell 16 | `{ enabled: true, size: 2 }` |
| `dust` | — | `{ enabled: true, n: 640 }` |
| `frameScale` | 隐含 1.0 | `1.0`（`?frame=0.9\|1\|1.1`） |
| `colorVersion` | — | `v1`（v2/v3 待拍板，未做） |
| `interlude` / `control.pause` | — | `none` / `text` |

JSON 仅多一个 `note` 字段；`seed` 字面量 `20166` ≡ 内联 `0x4e46`。复测脚本断言：字段对齐、JSON 未被 fetch。

---

## 2 · Bench 表

量法：本 VM 用短协议 puppeteer（2–3s/相）。修订包 §5 写的 DevTools 30s×3 **未跑**。弹簧全程锁 **0.055 / 0.90 / 10**。

| 门 | 规格 | 测得 | 源 |
|---|---|---|---|
| §9.1 画区云 | 中位装配距离 ≤ 均匀×0.6 | 261.7 / 508.6 = **0.5146** | `painting/seed-cloud.json` |
| §9.2 交接 | §3 八条硬不变式 | core_delta **0.131s**，overlap **1.017s**，empty **0**，snapAll **0**，waves **5**，drift **1.2**，step **6** | `painting/handover-invariants.json` |
| §9.4 像素块 | 默认 2 / 回滚 16 / 对照 3 | cell **2 / 16 / 3**，hardFrac 0.733 / 0.516 | `painting/pixel-block-dust.json` |
| B4（旧） | work p95 ≤16.67ms | chaos p95 **5.30ms** | `painting/b4-perf.json` |
| §9.5 过渡 | p95≤12ms，无 >50ms 长任务 | p95 **1.90ms**，longtask **0** | `painting/b4-1-bench.json` |
| §9.5 停留 | ≤30Hz，≤2ms，零重算 | **24Hz**，p95 **0.20ms**，tickDelta **0** | 同上 |
| §9.5 不可见 | rAF=0，恢复不追赶 | rafDelta **0**，clockOffset 增长 | 同上 |
| §9.5 reduce | 静态、不轮换 | running=false，catalog 未前进 | 同上 |
| S5 classic | 成画停 rAF | tick 72→72（`?discipline=classic`） | 同上 |

---

## 3 · A/B 对比集

裁决：维持修订包默认，不另起视觉档。彩度三版缺席。

| # | 对照 | 默认 | 回看 | 证据 |
|---|---|---|---|---|
| 1 | 方块 vs 软边 | 方块 2 | `?block=0` cell 16 | `b41_ab_soft.png` / `b41_ab_block2.png`；`px_01` / `px_03` |
| 2 | 方块 2 vs 3 | 2 | `?pixel=3` | `b41_ab_block3.png`；`px_04` |
| 3 | 画区 ±10% | 1.0 | `?frame=0.9\|1.1` | 中心三档都是 **504.35px**（Δ≈0）；高 567 / 630 / 693 |
| 4 | 彩度三版 | v1 | — | **待拍板，未做** |
| 5 | 显影 vs 凌厉 | develop | `?group=sharp` | `b41_ab_develop_mid.png` / `b41_ab_sharp_mid.png` |

数字在 `painting/b4-1-ab.json`。

---

## 4 · 断言日志

| 包 | `acceptance.pass` |
|---|---|
| `painting/seed-cloud.json` | true |
| `painting/handover-invariants.json` | true |
| `painting/pixel-block-dust.json` | true |
| `painting/b4-1-bench.json` | true |
| `painting/b4-1-ab.json` | true |
| `painting/exhibit-deliver.json`（本交付复测） | 见该文件 |

§3 复测读 `window.__nfHandover.pass.all`。§5 复测停留 Hz / tickDelta / lastPhysMs。

---

## 5 · 回退开关表（附录 A → 查询）

| 开关 | 取值 | 查询 | 实测 |
|---|---|---|---|
| `autoplay.enabled` | true / false | `?autoplay=0` | 关自动，进手动档 |
| `motion.discipline` | v2 / classic | `?discipline=classic` | 成画停 rAF |
| `transition.group` | develop / sharp | `?group=sharp` | 凌厉 vmax |
| `transition.arc` | on / off | `?arc=off` | 关轻弧 |
| `transition.handover` | on / off | `?handover=0` | catalog 换幅走 assemble |
| `pixelBlock.enabled` | true / false | `?block=0` | 软边 cell 16 |
| `pixelBlock.size` | 2 / 3 | `?pixel=3` | 大方块 |
| `seed.mode` | cloud / uniform | `?seed=uniform` | 全视口均匀 |
| `frame.scale` | 0.9 / 1.0 / 1.1 | `?frame=0.9` | 画区缩小、中心不动 |
| `dust.enabled` | true / false | `?dust=0` | 关尘埃 |
| `color.version` | v1 / v2 / v3 | **无查询** | 仅 v1，待拍板 |
| `control.pause` | text / hidden / off | **无查询** | 默认 text |
| `interlude` | none / glyph | **无查询** | 默认 none |

---

## 6 · R1–R3 冲突句

本仓没有独立《手册》文件。R1–R3 原文写在 `HANDOFF.md` 状态机节；旧句只留在变更历史，并标注被修订包替代。

全仓检索 `没有自动呼吸轮播` / `成画即停 rAF` / `不要加（自动）轮播` / `散点到装配`：命中只在修订包、本交付、`HANDOFF.md`。无第三处仍把旧锁当现行规则。

§9.0「手册两处旧句替换」：手册不在本仓，已在 HANDOFF 闭口。

---

## 7 · §11 未拍板

1. 『放映启停』：已按默认写入（图注级 text）。
2. NF 字形间奏：默认 `none`。
3. 彩度降饱和豁免：未纳入。点头再做 v2/v3。

---

## 8 · 验收勾选

- [x] §3 不变式全过（原测 + 本交付复测）
- [x] §5 / B4.1 达标（短协议）
- [x] R1–R3 无重复冲突句
- [x] 回退开关可查询（彩度 / pause / interlude 除外，见上表）
- [ ] 手册 §6 总验收（未点名，不做）
- [ ] 轨道 B（不做）
