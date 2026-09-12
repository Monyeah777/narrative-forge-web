# 粒子装配总卷 v3.0 · 阶段 A 诊断

卷：`docs/NF_粒子装配模块_整合总卷_v3.0.md`  
分支：`cursor/assembly-v3-a-diag-84d9`（叠在 `cursor/radial-strict-opt-84d9`）  
证据：`painting/assembly-v3-a.json`  
协议：本闸只诊断。不重采样、不改 50k/100k、不改 C2 golden、不进 B–G。

## 检索（本闸）

| # | 查了什么 | 结论 |
|---|---|---|
| 20 | PixiJS v8 Ticker `deltaMS` / `elapsedMS` | 官方：`deltaMS` 经 minFPS/speed 封顶，才是时间积分源；`elapsedMS` 是未封顶原始间隔。现网 `ticker.elapsedMS / 1000`。 |
| 12 | Gaffer *Fix Your Timestep* | 径向世界内层 `H=1/60` + 50ms 钳 + 插值有。外层 `FRAME_CLAMP=0.25` + `MAX_STEPS=2`（每帧最多 33ms）不是卷面写法。 |
| 17 | Bridson 2007 Curl-Noise | 卷面要 `w=∇×Ψ`、6px/s、LUT 64×64@30Hz。现网径向 LUT 是 Simplex **位移**；`curlVel` 只在旧 `applySpring` 轨。 |
| — | 面积元 `p(r)∝r·W(r)` | 2D 合格像素均匀抽 + `P=W/Wmax` 自动带 Jacobian。Dallas 直方图 L1：对合格×W = **0.035**，对非法 `p∝W` = **0.586**。 |
| 27/28 | 脉线 / streakline | 仍 ◐。代码无 M3 丝缕场。 |
| 19 | line boil / 完成≠停 | `formed` 会 `lockTo`；径向 `sleep` 把速度清零。红线 7 不成立。 |

未开 B 采样修复、未改 `W(r)`。

## ①②③ W 生效三件套

三幅锁定 S2b（sha 未变）。面板：`painting/assembly-v3-a-w-{dallas,scotland,met}.png`（原画 | W 热力 | 点叠 W）。

| 样本 | n | vs 50k | 对合格×W L1 | 对非法 W-only L1 | 面积元更近 |
|---|---:|---:|---:|---:|---|
| Dallas | 50601 | +1.20% | 0.0355 | 0.5855 | 是 |
| Scotland | 50441 | +0.88% | 0.0356 | 0.5736 | 是 |
| Met | 50471 | +0.94% | 0.0368 | 0.5723 | 是 |

计数在 ±5%。没有 20–30k 预览档，没有 30k 应急日志。掩膜仍是 `L<0.19` 暗部剔除，**不排除浅色**。Dallas 浅色天空占合格像素 70.1%、占点数 69.6%，没有「天空被挖空」。W 本身是纯径向，不是画作亮度场；边缘浅色天空 `W≈0.27`。

## 迁移证据包（10 模块）

勾 2 / 10（#2 积分、#4 各向异性）。其余缺口见 `painting/assembly-v3-a-migrate.json`。

现网时钟链：`elapsedMS` → `tick` 累积器 → `physics()` → `radialWorld.drain(1/60)`。容器：`ParticleContainer` + `position:true` + `addParticle`。`roundPixels` 未开。`makeSoftDot` 径向渐变（哑光/禁发光红线待 E/F 处理）。像素块默认 **2**（卷面 3）。尘埃 640 ≈ 1.3% of 50k（卷面 5%）。

## G1–G3 生成序列

Dallas 4k 云种子、现网 `handbookShape`、外层 `MAX_STEPS=2`。60Hz 与 120Hz 的 snap 时刻都是 **2.417s**。

| 项 | 数字 | 闸 |
|---|---|---|
| G1 无 snap RMS | 单调下降；p=0.6 很早（~0.28s），后段占比 0.93 ≥ 0.35 | 曲线过；不是 S 形 |
| G2 snap | t=2.417，p 已 0.9988，settled 0.841；P99=3.38px，前 1s 中位数 0.47，**比 7.2×** | **不过** |
| G3 | `snapAllToTargets` 在装配结束被调用；X1/X2/X6 成立 | 代码闭合 |

嫌疑：X1 写终态、X2 用 1.2s+97% 或超时而不是 `p≥0.995` 且禁止 snap、X6 后半靠 snap 冲线。X3 部分（掉帧被 2 步卡住）。X4/X5 本闸不测交接/换画重建。

`introRevealMs=2400` 只在自动放映 intro 生效；手动介绍仍 `ASSEMBLE_S=1.5`。

## 过闸

证据包齐（三件套 + 10 模块表 + G1–G3 + 双帧率）。**阶段 A 诊断闭合。不进入 B。**  
现网还没达到卷面 C–G 的完成定义。下一闸（等「继续」）才是 B：采样/掩膜/计数，若要动点必须先说，本闸没动。
