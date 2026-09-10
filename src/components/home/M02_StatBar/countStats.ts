import type { StatCounts } from "./contract";

export type RegistryLike = {
  modules?: unknown[];
  protocols?: Array<{
    pipeline?: string;
    assets?: { count?: number };
  }>;
};

export function countStats(registry: RegistryLike): StatCounts {
  const modules = Array.isArray(registry.modules) ? registry.modules.length : 0;
  const pipelines = new Set(
    (registry.protocols ?? [])
      .map((item) => item.pipeline)
      .filter((id): id is string => Boolean(id)),
  ).size;
  const community = Array.isArray(registry.protocols)
    ? registry.protocols.length
    : 0;
  const assetKeys = (registry.protocols ?? []).reduce((sum, item) => {
    const count = item.assets?.count;
    return sum + (typeof count === "number" ? count : 0);
  }, 0);
  return { modules, pipelines, community, assetKeys };
}
