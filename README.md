# NarrativeForge 展示站（narrative-forge-web）

NarrativeForge（NF）的公开展示站：用静态站点呈现主仓库已公开的协议、模块与数据，不承担运行时后端。

本仓库与 [NarrativeForge](https://github.com/Monyeah777/NarrativeForge) 主仓分离。站点数据由投影脚本从主仓 raw 拉取，生成文件位于 `content/generated/`，不要手改。

## 怎么跑

需要 Node.js ≥ 18。

```bash
npm install
node scripts/sync-nf.mjs
npm run dev
```

本地开发默认 http://localhost:3000 。

静态导出：

```bash
npm run build
```

产物在 `out/`（已在 `next.config.ts` 开启 `output: 'export'`）。

## 结构导航

```
specs/           设计令牌与后续任务/文案（tokens.json 初稿）
content/generated/  主仓库投影（脚本生成）
scripts/sync-nf.mjs 拉取 registry.json、04 模块库清单、CHANGELOG.md
prototype/       首屏 Canvas 原型（零依赖，不参与 Next 构建）
src/app/         App Router 页面
src/components/  UI（含 shadcn）
src/lib/         工具与后续数据访问层
```

轨道 A 原型在 `prototype/`：本地可 `python -m http.server` 打开 `index.html`。粒子成形与彩蛋逻辑在该文件的 `openArchive` / `triggerEgg`。当前在分支 `task/T-0005-community`，尚未合进 `main`。

## 技术基座

Next.js（App Router）+ TypeScript + Tailwind CSS + shadcn/ui；构建为纯静态站点。CI 在每次 push 上跑 lint、build，并检查 `out/` 静态产物。
