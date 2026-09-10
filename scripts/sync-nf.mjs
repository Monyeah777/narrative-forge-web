/**
 * 从 NarrativeForge 主仓库 raw/API 投影公开数据到 content/generated/。
 * 产物由本脚本生成，勿手编。
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const OUT_DIR = path.join(ROOT, "content", "generated");
const RAW_BASE =
  process.env.NF_RAW_BASE ??
  "https://raw.githubusercontent.com/Monyeah777/NarrativeForge/main";
const API_BASE =
  process.env.NF_API_BASE ??
  "https://api.github.com/repos/Monyeah777/NarrativeForge";

const HEADERS = {
  "User-Agent": "narrative-forge-web-sync",
  Accept: "application/vnd.github+json",
};

function rawUrl(relPath) {
  return `${RAW_BASE}/${relPath.split("/").map(encodeURIComponent).join("/")}`;
}

async function fetchResponse(url) {
  const res = await fetch(url, { headers: HEADERS });
  if (!res.ok) {
    throw new Error(`fetch failed ${res.status} ${url}`);
  }
  return res;
}

async function fetchText(url) {
  return (await fetchResponse(url)).text();
}

async function fetchJson(url) {
  return (await fetchResponse(url)).json();
}

function countModules(registry) {
  return Array.isArray(registry?.modules) ? registry.modules.length : 0;
}

function countVersions(changelog) {
  const headings = changelog.match(/^## \[[\d.]+\]/gm) ?? [];
  const tableRows = changelog.match(/^\| v[\d][^\n]*\|/gm) ?? [];
  return headings.length + tableRows.length;
}

async function fetchModuleInventory() {
  const candidates = [
    "04_模块库清单.md",
    "04_模块库清单.json",
    "04_模块库/清单.md",
    "04_模块库/README.md",
  ];
  for (const rel of candidates) {
    const res = await fetch(rawUrl(rel), { headers: HEADERS });
    if (res.ok) {
      const text = await res.text();
      return {
        source: rel,
        kind: "file",
        text,
        entries: [],
      };
    }
  }

  const tree = await fetchJson(`${API_BASE}/git/trees/main?recursive=1`);
  const prefix = "04_模块库/";
  const entries = (tree.tree ?? [])
    .filter(
      (node) =>
        node?.type === "blob" &&
        typeof node.path === "string" &&
        node.path.startsWith(prefix),
    )
    .map((node) => ({
      path: node.path,
      sha: node.sha,
      size: node.size,
    }));

  return {
    source: "github:git/trees/main?recursive=1",
    kind: "index",
    generated_note: "主仓库无独立「04_模块库清单」文件，改为目录投影。",
    entries,
  };
}

const registry = await fetchJson(rawUrl("desktop/src/core/registry.json"));
const changelog = await fetchText(rawUrl("CHANGELOG.md"));
const inventory = await fetchModuleInventory();

await mkdir(OUT_DIR, { recursive: true });

await writeFile(
  path.join(OUT_DIR, "registry.json"),
  `${JSON.stringify(registry, null, 2)}\n`,
  "utf8",
);
await writeFile(path.join(OUT_DIR, "CHANGELOG.md"), changelog, "utf8");
await writeFile(
  path.join(OUT_DIR, "04_模块库清单.json"),
  `${JSON.stringify(inventory, null, 2)}\n`,
  "utf8",
);

const moduleCount = countModules(registry);
const versionCount = countVersions(changelog);
const inventoryCount =
  inventory.kind === "index"
    ? inventory.entries.length
    : inventory.text.split(/\r?\n/).filter(Boolean).length;

console.log(`模块数 ${moduleCount}`);
console.log(`版本数 ${versionCount}`);
console.log(`清单条数 ${inventoryCount}`);
