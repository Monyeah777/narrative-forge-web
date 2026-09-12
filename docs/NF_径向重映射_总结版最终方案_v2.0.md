# 《径向密度重映射 · 总结版最终方案》v2.0

> **性质**：《自动放映 · 修订包》S1 子规格的**定稿总卷**——合并《径向重映射_指导包 v1.0》与《高级重采样补充案》，经最高严谨模式评审、补全、完善
> **状态**：定稿（默认路径唯一；进阶全部休眠；开关化）
> **效力**：本件为采样-物理-执行层的最终方案；预算与状态机条款以《自动放映 · 修订包》为准。v1.0 指导包自本件起转为历史版本（变更记录见附录 C）。

**Cursor 读取须知**：单步闭环五闸；每步「先检索 → 后实现 → 再自验 → 汇报 → 等 `继续`」；开启高推理模式。
**红线**：不得改调色板/掩膜定义；不得引入发光；不得使用帧依赖系数；不得静默超预算；检索未过闸不得开工。

---

## 0 · 定稿摘要

- **双阶段采样管线**：带权候选生成（拒绝采样，5×N）→ 变密度蓝噪声细化（三档：dart-thinning〔默认〕/ 加权样本消除〔升级〕/ 单趟圆盘填充〔前沿，文献与实现已核〕）→ 50,000 点 + 统计报告 + 双跑哈希。
- **物理层不变**：固定步长 1/60、k/c 平滑场、各向异性阻尼、Simplex 漂移场、噪声 LUT、休眠（正文自包含收录）。
- **执行不变**：S0–S5 五闸；S2 细分为 S2a / S2b / S2c（先跑通 → 再加码 → 再质检）。

---

## 1 · 评审记录（对《高级重采样补充案》）

格式：确认✓ / 修订✎ / 补全➕

| # | 补充案命题 | 判定 | 评审意见 |
|---|---|---|---|
| 1 | 缺「核心引擎」，需变密度泊松盘采样落地 | ✓ | 采纳；升格为显式「双阶段管线」（§3.3） |
| 2 | 推荐「单趟圆填充法」（约束单元 / 线性时间 / 任意密度） | ✓ | **已核**：Cui et al. 2026, Computers & Graphics 135:104548——原文："extends to adaptive sampling of arbitrary density functions in linear time"；GitHub 有参考实现。执行层级 = 前沿档（§3.5③），移植可行性由 S1 闸核验 |
| 3 | `R_local = R_base · √(W_max / W(r))` | ✓ | 与 v1.0 一致（R_base ≡ s0）；边缘/中心间距比 ≈ 1.94× |
| 4 | 二分校准至 50k ± 5% | ✓➕ | 已含；补全校准日志与接受率监控（§3.6） |
| 5 | 最优传输（CVT / RG散射 / 熵正则 / 随机牛顿） | ✎➕ | 「RG散射、随机牛顿」无稳定文献对应，不写入执行；可检索等效物：**Sliced Optimal Transport Sampling**（Paulin et al., SIGGRAPH 2020，已核）与 CVT 系；列为休眠后处理（§3.5④） |
| 6 | 神经重采样不推荐 | ✓ | 与「确定性 / 可解释 / 双跑哈希」红线冲突；同意不采用 |
| 7 | 蓝噪声自适应（最大空圆插入） | ✓➕ | 采纳为「空洞/频谱修正」可选 pass（§3.5⑤），给出触发条件 |
| 8 | 面积元细节（拒绝采样 vs 逆变换） | ✓ | 与 v1.0 §2.3 一致；CDF-LUT 规格保留 |
| 9 | §2 结构修改建议 | ✓ | 落位为 §3.3–§3.6（并澄清：候选生成与细化是**两个阶段**，不是二选一的替代品） |
| 10 | 分阶段实施（先跑通再加码） | ✓ | 并入执行协议：S2a → S2b → S2c |
| 11 | 「Cursor 一次别写完全栈」 | ✓ | 默认路径唯一；进阶全部 dormant + 开关化 |
| 12 | （补全）确定性来自「定序」而非仅是种子 | ➕ | 细化依赖遍历顺序：固定 RNG + 固定遍历序（§3.7） |
| 13 | （补全）细化后需复测密度比 | ➕ | 50k 输出后复测分带密度（§8 #1） |

> 核验动作：Bing 检索快照 4 组（SOT / circle packing / weighted sample elimination / 详情补核），2026-09-12。
> 术语提醒：① 禁写「LOD 逆向」；②「各向异性」仅在径/切分解实现时使用。

---

## 2 · 术语与定位（压缩版）

- 本任务 = 径向加权重要性重采样（stippling 密度场）+ 空间变阻尼弹簧网络 + 确定性蓝噪声点集。
- 报告用定位短语：**"density-adaptive blue-noise point set generation via weighted two-stage sampling"**。
- 禁用词：LOD 类比、AI 感、随机质量。

---

## 3 · 数据层 · 最终管线

### 3.1 场与坐标（单一真值源）
- `r(p) = clamp(|p − c*| / R95, 0, 1)`；`c*` = 候选像素质心；`R95` = 候选到 c* 距离的 95 分位。
- `c*`、`R95` 写入 points 文件 meta，物理层直接复用。

### 3.2 权重
`W(r) = 0.2 + 0.8·e^(−2.5·r)` → W(0)=1.0，W(1)≈0.266，设计密度比 **3.76×**。

### 3.3 双阶段管线（定稿）

```
阶段 1 · 带权候选生成（拒绝采样）
  均匀抽候选像素 → 以 P = W(r)/Wmax 接受 → 5×N ≈ 250k 带权候选

阶段 2 · 变密度蓝噪声细化（三档，默认 ①）
  ① dart-thinning（默认）：网格加速；R_local = s0·√(Wmax/W(p))；接受数 50k ± 5%
  ② 加权样本消除（升级档，已核）：Yuksel 2015 + cySampleElim（文档明示支持加权/任意域）
  ③ 单趟圆盘填充（前沿档，已核）：Cui et al. 2026, C&G 135:104548；线性时间 + 任意密度

输出：50,000 点 + meta + 统计报告 + 双跑哈希
```

### 3.4 默认档实现要点
- 网格 `cell = s_max`；候选按**种子洗牌后的固定顺序**遍历；接受条件：与所有已接受点的距离 ≥ `R_local(p)`。
- `s0` 初值：`s0 ≈ 0.54·√(A_mask / N)`；二分 2–3 轮校准。
- **禁止**用「逐点独立随机半径」近似——必须执行真实距离检查，否则退化为加权白噪声。
- 若接受率不足导致计数偏差 > ±5%：加大候选池（上限 10×N）或下调 s0 重跑。

### 3.5 升级与后处理（全部休眠，触发才做）
- ④ **Sliced OT 后处理**：细化结果局部密度不均且其他档无效时评估（Paulin et al. 2020）。
- ⑤ **最大空圆插入修正**：仅对残留空洞定点修复（触发：目检或 NN p99 超标；做法：最大空圆中心插入 → 局部最小间距校验）。
- ⑥ **轻量松弛**：对扎堆瑕疵做 2–3 轮位移上限约束的 Lloyd-lite；默认关。

### 3.6 校准协议（必交日志）

| 轮次 | s0 | 候选数 | 接受数 | 接受率 | 备注 |
|---|---|---|---|---|---|
| 1 | 初值 | | | | |
| 2 | | | | | |
| 3（锁定）| | | | | 写入 meta |

### 3.7 确定性与定序
- 固定 RNG 种子；候选遍历顺序 = 固定洗牌序（或 index 序，二选一后固定）；**不得依赖并行/时间**；双跑哈希一致才算过。

### 3.8 输出与统计
- 分带密度表（[0,0.3]/[0.3,0.6]/[0.6,0.85]/[0.85,1]）；NN mean/p95/p99。
- 可选频谱检查：2D 直方图 → FFT → 径向平均功率谱；标准 = 无显著低频峰与栅格峰；以目检为主、频检为辅。

---

## 4 · 物理层 · 定稿速览（自包含，未变更）

- 平滑场：`S(r) = smoothstep(0.50, 0.88, r)`；`k(r) = 0.10 − 0.08·S(r)`；`c(r) = 0.92 − 0.14·S(r)`（1/60s 定步长系数）。
- 固定步长：累积器 + `h = 1/60s`；dt 钳制 50ms；渲染插值；`v ← (v + k(r)·(T − x))·c(r)`；`x ← x + v`。
- 各向异性：`c_rad = c(r) + δ`，`c_tan = c(r) − δ`，`δ = 0.04·S(r)`；开关 `anisotropy.enabled`。
- 飘逸场：Simplex 3D 双路；`f_s = 0.006/px`、`f_t = 0.05/s`、`A_max = 5px`；`A(r) = A_max·smoothstep(0.55, 0.92, r)`；渲染位 `x_render = x + Δ`，Δ 不入积分器。
- 噪声 LUT：64×64 @30Hz 重算 + 双线性。
- 休眠：`|v|<0.05px/步 且 |x−T|<0.5px` → sleep；驱离/重组/过渡唤醒。
- 状态门控：INTRO/HANDOVER Δ×0；DWELL Δ×1；驱离中 Δ×0.5；reduced-motion 全静。

---

## 5 · 渲染与性能（不变）

- 继承像素块规格（哑光 / 整数对齐 / 关平滑 / 禁发光）。
- 优化菜单：A. 中心烘焙；B. ImageData 脏矩形；C. 噪声 LUT；D. 边缘集分时交替；E. 申议（降 count / WebGL，需拍板）。
- 预算：DWELL 脚本增量 ≤ +1.0ms；穷尽 A–D 仍超 → 提交证据申议；**不得静默超支**。

---

## 6 · 执行协议（S0–S5 · S2 三分）

- **S0** 现状诊断（量化空洞 + 帧时基线 + 成因初判）。
- **S1** 检索落稿（§7 词包 ≥3 搜；≥2 引用；写 `docs/research/径向重映射-备忘.md`；含③圆填充论文与 GitHub 实现的可行性读数）。
- **S2a** 带权候选跑通：50k 中间产物 + 分带密度统计 + 哈希。
- **S2b** 细化默认档：校准日志 + 接受率监控；汇报时给出「是否升级②/③」建议。
- **S2c** 质检：NN / 密度比 /（可选）频谱；不过 → 触发升级评估（② / ⑤）。
- **S3** 物理层（全部开关；60/120Hz 双档回归）。
- **S4** 渲染接入（菜单 A→D，每步 bench）。
- **S5** 总验收（§8 全表 + 15s 视频 + 放大对比 + 帧时曲线 + 回退清单）。

每步产物落盘后再等 `继续`；不得跳闸。

---

## 7 · 检索词包（增补版）

| # | 类别 | 英文检索词（优先） | 用途 |
|---|---|---|---|
| 1 | 点集重采样 | weighted voronoi stippling / sample elimination poisson disk / **single pass poisson disk circle packing** / variable density poisson disk sampling / blue noise sampling survey | S2；经典先行 |
| 2 | 采样统计 | rejection sampling / inverse transform sampling / alias method Vose | S2；面积元坑 |
| 3 | 物理积分 | fix your timestep gaffer / semi-implicit euler / frame rate independent damping | S3 |
| 4 | 噪声 | simplex noise javascript / fastnoise-lite / opensimplex2 / noise lookup table bilinear | S3 |
| 5 | 渲染性能 | canvas imagedata dirty rect / putimagedata performance / offscreen canvas cache / canvas2d 50000 particles | S4 |
| 6 | 视觉参考 | stippled artwork animation / particle nebula drift field / starfield density falloff | 风格校准 |
| 7 | 验收统计 | nearest neighbor distribution uniformity test / radial density profile measurement python / **radial power spectrum blue noise analysis** | S5 |
| 8 | 升级档专搜 | **weighted sample elimination cySampleElim** / **sliced optimal transport sampling** / **largest empty circle insertion** | 升级评估 |

**纪律**：优先论文/官方文档；**警惕 demo 代码的帧依赖系数**。

---

## 8 · 验收指标（10 条）

| # | 指标 | 达标线 |
|---|---|---|
| 1 | 密度重分布（细化后复测） | 中心/边缘 ≥ 2.0×（设计 3.76×） |
| 2 | 空洞清除 | NN p99 ≤ 1.8×median；无肉眼空圆 |
| 3 | 飘逸度 | edge std ≥ 3× center；center ≤ 0.3px |
| 4 | 无拖影 | 边缘单帧位移 p99 ≤ 0.5px |
| 5 | 复位 | 中心 ≤1.0s / 边缘 ≤1.5s |
| 6 | 帧率无关 | 60/120Hz 复位时间差 ≤10% |
| 7 | 性能 | B4.1 + §5 协议 |
| 8 | 确定性 | 双跑哈希一致（含细化遍历序） |
| 9 | 无回归 | 驱离/重组/状态机全过 |
| 10 | 频谱（可选） | 径向功率谱无显著低频/栅格峰（目检为主） |

---

## 9 · 交付物清单

采样脚本 + points + meta / 校准日志 / 物理模块 / 回归测试（60&120Hz）/ bench 表 / 研究备忘 / 15s 视频 + 截图集 / 断言日志 / 回退开关增补表 / 偏差对照表。

---

## 附录 A · 参数总表（增量部分）

| 参数 | 键 | 默认 | 说明 |
|---|---|---|---|
| 细化档位 | `refine.mode` | `thinning` | `thinning / elimination / circlePacking` |
| 候选池比 | `refine.candidateRatio` | 5× | 上限 10× |
| 基准半径 | `refine.s0` | 校准值 | 二分 2–3 轮锁定入 meta |
| 遍历定序 | `refine.order` | `seeded-shuffle` | 二选一后固定 |
| 频谱检查 | `qc.spectrum` | off | 质检不达标时开启 |
| OT 后处理 | `post.ot` | off | 触发才做 |
| 空圆修正 | `post.lec` | off | 触发才做 |
| 轻量松弛 | `post.relax` | off | 触发才做 |

## 附录 B · 参考文献（更新）

1. Cui, J., Li, Z., Li, Y., Guo, Z., Dai, Z., Zhang, J. (2026). *Single pass Poisson disk sampling via circle packing*. Computers & Graphics, 135, 104548. doi:10.1016/j.cag.2026.104548 ✅已核（含 GitHub 参考实现）
2. Yuksel, C. (2015). *Sample Elimination for Generating Poisson Disk Sample Sets*. CGF 34:25–32. doi:10.1111/cgf.12538 ✅已核（cyCodeBase 含加权版本）
3. Fiedler, G. *Fix Your Timestep!* gafferongames.com ✅已核
4. Paulin, L., Bonneel, N., Coeurjolly, D., Iehl, J.-C., Webanck, A., Desbrun, M., Ostromoukhov, V. (2020). *Sliced Optimal Transport Sampling*. ACM TOG (SIGGRAPH 2020) ✅已核
5. Bridson, R. (2007). *Fast Poisson Disk Sampling in Arbitrary Dimensions*.
6. Secord, A. (2002). *Weighted Voronoi Stippling*.
7. Bowers et al. (2011). Parallel PD w/ variable radius（待核）。
8. Yan et al. Blue-noise sampling survey（待核）。
9. Ulichney (1987/88). Blue-noise dithering（可选）。
10. Vose (1991). Alias method（可选）。
11. MDN：`putImageData` / OffscreenCanvas / rAF。

## 附录 C · 变更记录（v1.0 → v2.0）

1. 融合《高级重采样补充案》并完成 13 条评审（§1）。
2. 数据层升格为**三档可执行管线**（dart-thinning / 加权样本消除 / 单趟圆盘填充——后者文献与代码已核）。
3. 新增：§3.6 校准协议、§3.7 定序确定性、§3.8 频谱检查（可选）、§3.5 升级与后处理（休眠）。
4. 执行协议：S2 拆分为 S2a / S2b / S2c。
5. 文献更新：+Cui 2026、+Paulin 2020、+Yuksel 加权版说明。
6. v1.0 与本件冲突处，以本件为准。

---

*—— 完（从 S0 开闸；改哪条点编号，出 v2.1）*