import assetsDoc from "../../../content/generated/assets.json";
import modulesDoc from "../../../content/generated/modules.json";
import pipelinesDoc from "../../../content/generated/pipelines.json";

export type ToolFaceCandidate = {
  repo?: string;
  ref?: string;
  license?: string;
  note?: string;
};

export type ToolFaceEntry = {
  purpose: string;
  candidates: ToolFaceCandidate[];
  guidance: Record<string, string>;
};

export type HallAsset = {
  id: string;
  slug: string;
  kind: "module" | "pipeline" | "asset";
  name: string;
  category: string;
  summary: string;
  path: string;
  source: string;
  tool_face?: ToolFaceEntry[] | null;
  layers?: { id: string; name: string }[];
};

export type AssetFilter = {
  kind?: HallAsset["kind"];
  category?: string;
  source?: string;
};

export type AssetProfile = {
  kind?: HallAsset["kind"];
  category?: string;
  q?: string;
};

type CatalogFile = {
  official_count: number;
  community_count: number;
  items: HallAsset[];
};

const catalog: HallAsset[] = [
  ...(modulesDoc as CatalogFile).items,
  ...(pipelinesDoc as CatalogFile).items,
  ...(assetsDoc as CatalogFile).items,
];

function clone<T>(value: T): T {
  return structuredClone(value);
}

export function listAssets(): HallAsset[] {
  return catalog.map((item) => clone(item));
}

export function listHallItems(): HallAsset[] {
  return [
    ...queryAssets({ kind: "module", source: "官方核心" }),
    ...queryAssets({ kind: "pipeline", source: "官方核心" }),
    ...queryAssets({ kind: "asset", source: "官方核心" }),
  ];
}

export function getAsset(id: string): HallAsset | undefined {
  const found = catalog.find((item) => item.id === id || item.slug === id);
  return found ? clone(found) : undefined;
}

/** asset_query(filter) · 条件查询 */
export function queryAssets(filter: AssetFilter = {}): HallAsset[] {
  return listAssets().filter((item) => {
    if (filter.kind && item.kind !== filter.kind) return false;
    if (filter.category && item.category !== filter.category) return false;
    if (filter.source && item.source !== filter.source) return false;
    return true;
  });
}

/** asset_match(profile) · 画像匹配 */
export function matchAssets(profile: AssetProfile = {}): HallAsset[] {
  const q = profile.q?.trim().toLowerCase();
  return queryAssets({ kind: profile.kind, category: profile.category }).filter(
    (item) => {
      if (!q) return true;
      const hay = `${item.id} ${item.name} ${item.summary} ${item.category}`.toLowerCase();
      return hay.includes(q);
    },
  );
}

/** asset_roll(seed) · 只读确定性抽取（静态站，不用运行时随机） */
export function rollAsset(seed: string, profile: AssetProfile = {}): HallAsset | undefined {
  const pool = matchAssets(profile);
  if (!pool.length) return undefined;
  let hash = 0;
  for (const ch of seed) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return pool[hash % pool.length];
}

/** asset_register(entry) · 展示站只读，拒绝写入 */
export function registerAsset(): { ok: false; reason: string } {
  return { ok: false, reason: "readonly" };
}

export function moduleCatalogMeta() {
  const doc = modulesDoc as CatalogFile;
  return {
    official_count: doc.official_count,
    community_count: doc.community_count,
    total: doc.items.length,
  };
}
