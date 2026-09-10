/**
 * 从 NarrativeForge 主仓库 raw/API（或本地 NF_LOCAL_ROOT）投影公开数据到 content/generated/。
 * 产物由本脚本生成，勿手编。
 */
import { existsSync } from "node:fs";
import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
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
const LOCAL_ROOT = resolveLocalRoot();

const HEADERS = {
  "User-Agent": "narrative-forge-web-sync",
  Accept: "application/vnd.github+json",
};

function resolveLocalRoot() {
  if (process.env.NF_LOCAL_ROOT) return process.env.NF_LOCAL_ROOT;
  const sibling = path.resolve(ROOT, "..", "NarrativeForge-main");
  return existsSync(sibling) ? sibling : "";
}

function toPosix(rel) {
  return rel.split(path.sep).join("/");
}

const PACK_SLUG = {
  校园情感领域包: "campus",
  西幻生存领域包: "survival",
  校园西幻轻混组合包: "mix",
  通用核心基础包: "base",
  技术文档域包: "techdoc",
};

function packKey(rel) {
  if (rel.startsWith("04_模块库/") || rel.startsWith("03_管线库/")) return "core";
  const folder = rel.split("/")[1] ?? "pkg";
  if (PACK_SLUG[folder]) return PACK_SLUG[folder];
  let hash = 2166136261;
  for (const ch of folder) {
    hash ^= ch.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return `pkg${(hash >>> 0).toString(36)}`;
}

function idKey(id) {
  const last = String(id).split(":").pop() ?? String(id);
  return last
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .toLowerCase();
}

/** ASCII slug，避免中文/冒号在 dev 与静态导出里 404。 */
function toSlug(kind, rel, id) {
  const prefix = kind === "pipeline" ? "p" : "m";
  return `${prefix}-${packKey(rel)}-${idKey(id)}`;
}

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

async function readSource(relPath) {
  if (LOCAL_ROOT) {
    return readFile(path.join(LOCAL_ROOT, relPath), "utf8");
  }
  return fetchText(rawUrl(relPath));
}

async function listTree() {
  if (LOCAL_ROOT) {
    const files = [];
    async function walk(dir) {
      const entries = await readdir(dir, { withFileTypes: true });
      for (const entry of entries) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          if (entry.name === ".git" || entry.name === "node_modules") continue;
          await walk(full);
        } else if (entry.isFile()) {
          files.push(toPosix(path.relative(LOCAL_ROOT, full)));
        }
      }
    }
    await walk(LOCAL_ROOT);
    return files;
  }
  const tree = await fetchJson(`${API_BASE}/git/trees/main?recursive=1`);
  return (tree.tree ?? [])
    .filter((node) => node?.type === "blob" && typeof node.path === "string")
    .map((node) => node.path);
}

function unquote(value) {
  const trimmed = value.trim();
  if (
    (trimmed.startsWith('"') && trimmed.endsWith('"')) ||
    (trimmed.startsWith("'") && trimmed.endsWith("'"))
  ) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function yamlScalar(block, key) {
  const re = new RegExp(`^\\s*${key}:\\s*(.*)$`, "m");
  const match = block.match(re);
  if (!match) return "";
  const value = unquote(match[1]);
  return value === "|" || value === ">" ? "" : value;
}

function extractFence(md, needle) {
  const re = /```yaml\r?\n([\s\S]*?)```/g;
  let match;
  while ((match = re.exec(md))) {
    if (match[1].includes(needle)) return match[1];
  }
  return "";
}

function firstParagraph(md) {
  const withoutFence = md.replace(/```[\s\S]*?```/g, "\n");
  const lines = withoutFence.split(/\r?\n/);
  const buf = [];
  for (const line of lines) {
    if (line.startsWith("#")) continue;
    if (line.startsWith(">")) continue;
    if (!line.trim()) {
      if (buf.length) break;
      continue;
    }
    buf.push(line.trim());
    if (buf.join("").length > 80) break;
  }
  return buf.join(" ").slice(0, 180);
}

function parseToolFace(block) {
  if (!/^\s*tool_face:/m.test(block)) return null;
  const after = block.split(/^\s*tool_face:\s*$/m)[1] ?? "";
  const parts = after.split(/^\s{2,}-\s+purpose:\s*/m).slice(1);
  return parts.map((part) => {
    const nl = part.indexOf("\n");
    const purpose = unquote(nl === -1 ? part : part.slice(0, nl));
    const rest = nl === -1 ? "" : part.slice(nl + 1);
    const candidates = [];
    for (const row of rest.matchAll(/^\s+-\s+repo:\s*(.+)$/gm)) {
      const slice = rest.slice(row.index, (row.index ?? 0) + 500);
      candidates.push({
        repo: unquote(row[1]),
        ref: yamlScalar(slice, "ref"),
        license: yamlScalar(slice, "license"),
        note: yamlScalar(slice, "note"),
      });
    }
    const guidance = {};
    const guide = rest.split(/^\s+guidance:\s*$/m)[1] ?? "";
    for (const line of guide.split(/\r?\n/)) {
      const m = line.match(/^\s+([^:-][^:]*):\s*(.*)$/);
      if (m) guidance[m[1].trim()] = m[2].trim();
    }
    return { purpose, candidates, guidance };
  });
}

function parsePipelineLayers(block) {
  const layers = [];
  const re = /- id:\s*(\S+)\r?\n\s+name:\s*(.+)/g;
  let match;
  while ((match = re.exec(block))) {
    layers.push({ id: match[1], name: unquote(match[2]) });
  }
  return layers;
}

function countModules(registry) {
  return Array.isArray(registry?.modules) ? registry.modules.length : 0;
}

function countVersions(changelog) {
  const headings = changelog.match(/^## \[[\d.]+\]/gm) ?? [];
  const tableRows = changelog.match(/^\| v[\d][^\n]*\|/gm) ?? [];
  return headings.length + tableRows.length;
}

function isOfficialModule(rel) {
  return rel.startsWith("04_模块库/") && rel.endsWith(".md");
}

function isCommunityModule(rel) {
  return (
    rel.startsWith("community/") &&
    rel.includes("/modules/") &&
    rel.endsWith(".md")
  );
}

function isOfficialPipeline(rel) {
  return rel.startsWith("03_管线库/") && rel.endsWith(".md");
}

function isCommunityPipeline(rel) {
  return (
    rel.startsWith("community/") &&
    rel.includes("/pipelines/") &&
    rel.endsWith(".md")
  );
}

function categoryFromPath(rel) {
  if (rel.startsWith("04_模块库/")) {
    const folder = rel.split("/")[1] ?? "";
    return folder.replace(/类$/, "");
  }
  if (rel.startsWith("community/")) {
    return rel.split("/")[1] ?? "社区";
  }
  if (rel.startsWith("03_管线库/")) return "官方管线";
  return "未分类";
}

async function projectModule(rel) {
  const md = await readSource(rel);
  const contract = extractFence(md, "machine_contract");
  const id =
    yamlScalar(contract, "id") ||
    path.basename(rel).replace(/\.md$/, "").split("_")[0];
  const name = yamlScalar(contract, "name") || id;
  const category = yamlScalar(contract, "category") || categoryFromPath(rel);
  return {
    id,
    slug: toSlug("module", rel, id),
    kind: "module",
    name,
    category,
    summary: firstParagraph(md),
    path: rel,
    source: rel.startsWith("04_模块库/") ? "官方核心" : "社区",
    tool_face: parseToolFace(contract),
  };
}

async function projectPipeline(rel) {
  const md = await readSource(rel);
  const block = extractFence(md, "Pipeline:") || extractFence(md, "id:");
  const id =
    yamlScalar(block, "id") ||
    path.basename(rel).replace(/\.md$/, "").split("_")[0];
  const name = yamlScalar(block, "name") || firstParagraph(md) || id;
  return {
    id,
    slug: toSlug("pipeline", rel, id),
    kind: "pipeline",
    name,
    category: categoryFromPath(rel),
    summary: firstParagraph(md),
    path: rel,
    source: rel.startsWith("03_管线库/") ? "官方核心" : "社区",
    layers: parsePipelineLayers(block),
    tool_face: null,
  };
}

const files = await listTree();
const officialModulePaths = files.filter(isOfficialModule).sort();
const communityModulePaths = files.filter(isCommunityModule).sort();
const officialPipelinePaths = files.filter(isOfficialPipeline).sort();
const communityPipelinePaths = files.filter(isCommunityPipeline).sort();

const registry = JSON.parse(await readSource("desktop/src/core/registry.json"));
const changelog = await readSource("CHANGELOG.md");

const inventory = {
  source: LOCAL_ROOT ? "local-walk" : "github:git/trees/main?recursive=1",
  kind: "index",
  entries: officialModulePaths.map((rel) => ({ path: rel })),
};

const modules = [];
for (const rel of [...officialModulePaths, ...communityModulePaths]) {
  modules.push(await projectModule(rel));
}
const pipelines = [];
for (const rel of [...officialPipelinePaths, ...communityPipelinePaths]) {
  pipelines.push(await projectPipeline(rel));
}

const slugs = [...modules, ...pipelines].map((item) => item.slug);
const dup = slugs.filter((slug, i) => slugs.indexOf(slug) !== i);
if (dup.length) {
  throw new Error(`duplicate hall slugs: ${[...new Set(dup)].join(", ")}`);
}
if (slugs.some((slug) => !/^[a-z0-9-]+$/.test(slug))) {
  throw new Error("hall slug must be ascii [a-z0-9-]");
}

const modulesDoc = {
  official_count: officialModulePaths.length,
  community_count: communityModulePaths.length,
  items: modules,
};
const pipelinesDoc = {
  official_count: officialPipelinePaths.length,
  community_count: communityPipelinePaths.length,
  items: pipelines,
};

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
await writeFile(
  path.join(OUT_DIR, "modules.json"),
  `${JSON.stringify(modulesDoc, null, 2)}\n`,
  "utf8",
);
await writeFile(
  path.join(OUT_DIR, "pipelines.json"),
  `${JSON.stringify(pipelinesDoc, null, 2)}\n`,
  "utf8",
);

console.log(`模块数 ${modules.length}`);
console.log(`版本数 ${countVersions(changelog)}`);
console.log(`清单条数 ${inventory.entries.length}`);
console.log(`管线数 ${pipelines.length}`);
console.log(`registry模块 ${countModules(registry)}`);
if (LOCAL_ROOT) console.log(`本地源 ${LOCAL_ROOT}`);
