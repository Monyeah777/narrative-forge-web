# 粒子装配总卷 v3.0 · 模块 6–9（生命周期 / 回收 / Q(r) / M0 / M3）

卷：`docs/NF_粒子装配模块_整合总卷_v3.0.md`  
分支：`cursor/assembly-v3-ce-phys-84d9`（叠在 `cursor/assembly-v3-a-diag-84d9`）  
证据：`painting/assembly-v3-ce.json`  
回退：`?morph=0`（隔离默认仍关，S3 dual 不动）

本闸只补用户点名的两处缺口：**生命周期 / 回收 / 边界软化 Q(r)**，以及 **M0 涟漪 / M3 脉线**。不重采样、不改 50k/100k、不改 `W(r)`、不启用 E、不修 snapAll / 时钟 MAX_STEPS。

## 检索（本闸核到）

| # | 依据 | 核到的句子 | 本闸怎么用 |
|---|---|---|---|
| 15 | Reeves, W. T. (1983). *Particle Systems—a Technique for Modeling a Class of Fuzzy Objects*. ACM TOG 2(2), 91–108. §2.4 | 每帧：生成 → 赋属性 → **熄灭** → 动力学 → 渲染。熄灭三条件：寿命到 0；由色/透明度算出的 **intensity 低于阈值**；离开 parent 的 **region of interest**。 | τ∈[40,120]s 包络（卷面）；α≤0.01 或 r>1.25·R95 回收槽位而不是删粒子（N 恒定，供给—逸散平衡）。重生赋新 τ / age=0（Reeves 步骤 2）。 |
| 24/25 | 卷面写 Britannica *Phase velocity* / *Wave* | 本闸 Britannica 被 bot 墙。改核 OpenStax *University Physics Volume 1* §16.1 式 16.1：\(v=\lambda/T=\lambda f\)。行波 \(u=A\sin(2\pi t/T-2\pi r/\lambda+\varphi_0)\) 的等相位点 \(\mathrm{d}r/\mathrm{d}t=\lambda/T\)。 | M0：λ=56px，T=8s，\(v_\varphi=7\) px/s。验收：相位在 \((r,t)\) 与 \((r+v\Delta t,\,t+\Delta t)\) 相同。 |
| 17 | Bridson, Hourihan, Nordenstam (2007). *Curl-Noise for Procedural Fluid Flow*. SIGGRAPH 2007. §2.1 | 二维势是标量流函数：\(v=(\partial\psi/\partial y,\,-\partial\psi/\partial x)\)。\(\nabla\cdot\nabla\times\equiv 0\)，**不可能出现 gutter**。直接用 Perlin 当速度会有汇。势可调制，速度乘标量会破坏无散。 | M3 丝缕 = 两套斜交慢势之和的网格 curl（80–140px，T>10s）。**不**把 Simplex 当速度。LUT 1Hz（时间尺度 >10s）。 |
| 26/27 | NASA Glenn *Definition of Streamlines*；Cambridge MDP *node8*；MIT Unified Fluids Lect. 8 | **脉线 / streakline** = 某一时刻、所有曾经通过**固定点**的流体微团的连线（烟囱连续放烟、固定点连续滴染料）。流线 = 瞬时速度切线。定常流三者重合，非定常一般分开。 | M3 不是画线（§9-4 冻结），是边缘粒子沿径向外流 + 无散丝缕场的瞬时轨迹。源点 = 画作采样位置。 |
| — | 卷面 §4.2 #8 / §7 | \(Q(r)=\mathrm{smoothstep}(0.82,0.98)\)，\(\beta_\max=8\) px/s，**速度修正项**。 | 与 \(k(r)/c(r)\) 一样用目标半径 `rr`。去掉向外径向分量 ×Q，再加 \(8/60\) px/step 的向内偏置（本积分器速度单位是 px/步）。 |

未采用：Bohrium 中文转述（卷面 ◐）；把 Bridson 2007 *Poisson Disk* 错当成 curl-noise（那是另一篇）。

## 实现要点

隔离默认 `lifecycle/recycle/boundaryQ/ripple/streak = false`。现网径向 + `assemblyMorph` 打开；`?morph=0` 只留 `handbookShape`。

| 模块 | 层 | 公式 / 行为 |
|---|---|---|
| 生命周期 | 物理，仅 DWELL 推 age | 渐入 0.6s → 保持 → 末 20%τ 渐出。INTRO 不老化，避免装配期变透明。出生落在保持段前半。 |
| 回收 | 物理，仅 DWELL | Reeves 熄灭条件 → `respawn`。出生点沿目标半径向中心 8%（F5 上游；cloud 种子的装配方向是中心→画作）。 |
| Q(r) | 物理，仅 DWELL | 只处理 `rr≥0.82`。装配期关掉，避免边缘被推离目标、拖死 97% 结算。 |
| M0 | **渲染叠加** | \(u=A\cdot W_b(r)\cdot\sin(2\pi t/T-2\pi r/\lambda+\varphi_0)\)，A=0.5%·r_px，\(W_b=\mathrm{smoothstep}(0.10,0.35)\)。φ₀ 每世界一次，禁止逐粒子。V2 ±3% 写入 `tintA`，≤10Hz。 |
| M3 | **渲染态 `esc`** | \(W_e=\mathrm{smoothstep}(0.72,0.92)\,(1-\mathrm{smoothstep}(1,1.05))\)，\(U_0=5\) px/s。丝缕调制同一速度，不另加一套 24 px/s。不写回 `x_phys`。 |
| 余韵 | 两层共用 | 0→40%@2s → 100%@8s。INTRO/HANDOVER 为 0。 |

反 boil：空间低频（λ=56，丝缕 80–140px）+ 时间低频（T=8s / >10s）+ 相位按画作半径锁死。

## 守门数字

- S3 dual：`cdff787751379eca069c205dbeb730f7b34a13e85c9902dee0959acee143aa19`（未漂）
- 包络：0.3s/80s → 0.5；保持 1；76s → 0.25；80s → 0
- Q(0.82)=0，Q(0.90)=0.5，Q(0.98)=1；边缘向外踢速被吃掉，中心几乎不动
- M0：中心位移 0；边缘与闭式解一致；波峰相位误差 0
- M3：中心 `esc=0`；边缘 ~3.8px / 3s；物理 `x` 仍在目标上
- 预算（Node，8k 径向铺点 ×50k/8k）：DWELL 增量约 **+3.9ms > +1.0ms**。**申议，不静默砍 N、不启用 E。** Morph 保持现网开。优化已做：Q/M0 用预计算径向基、丝缕 LUT 1Hz、V2 10Hz、保持段跳包络。

## 过闸

公式与隔离哈希过。预算超标已申议。浏览器驻留形态见本 PR 录屏。下一闸仍等点名（B 采样 / snap / 时钟 / 像素=3）。
