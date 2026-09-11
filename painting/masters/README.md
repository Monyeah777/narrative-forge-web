# 彩页装置 · 高清源图（临时素材区）

> **性质**：临时入库（2026-09-11，作者指示）——仅用于让云端（Cursor）读取高清原画。
> 处理完成后可整体删除本目录，并移除 `.gitignore` 中的例外行。
> （历史约定「高清原图不进 git」，本目录为一次性破例。）

**用途**：为 `scripts/prep-painting.py` 提供 master，重烤彩页装置底图，替换 `painting/01-dallas.jpg` 的 1200px 替身（替身背景见 `painting/source.json`）。

## 高清原画（6 件 · 均 ≥2589px · 公共领域）

| 文件 | 馆藏 | 分辨率 | 大小 | 备注 |
|---|---|---|---|---|
| `dallas_lespeupliers_5497x7054.jpg` | 达拉斯美术馆 | 5497×7054 | 33.4 MB | 《Les peupliers》(W1304)；当前替身对应画作 |
| `scotland_GAP_4001.jpg` | 苏格兰国家美术馆 | 4001×4001 | 8.1 MB | 《Poplars on the Epte》· GAP 扫描 |
| `philadelphia_GAP_4248x5353.jpg` | 费城艺术博物馆 | 4248×5353 | 7.35 MB | 《Poplars》· GAP 扫描 |
| `philadelphia_upload_4249x5490.jpg` | 费城艺术博物馆 | 4249×5490 | 6.49 MB | 同画另一数字化版本（对照用） |
| `met_fourtrees_3689x3658.jpg` | 大都会艺术博物馆 | 3689×3658 | 4.18 MB | 《The Four Trees》· Met CC0 |
| `vertical_2589.jpg` | 待考 | 2589×3297 | 6.2 MB | 竖幅 · 来源待人工核定 |

## 预览（`previews/` · 长边 1200px · 仅供选图/比对）

`00_overview.jpg`（总览）＋ `01`–`06`（逐件：dallas / scotland / philadelphia-GAP / philadelphia-upload / met / vertical）。
**注意**：预览不要喂给 `prep-painting.py`，请用上表高清原画。

## 用法（云端示例）

```bash
python3 scripts/prep-painting.py --input painting/masters/dallas_lespeupliers_5497x7054.jpg
```

试烤其它候选：把对应文件路径换给 `--input`（先看 `previews/` 比选）。

## 完整性校验

```bash
cd painting/masters && sha256sum -c MANIFEST.sha256
```

## 来源与授权

全部为公共领域（Public Domain）。逐件 Commons 文件与馆方来源见同目录 `_素材清单.md`。
