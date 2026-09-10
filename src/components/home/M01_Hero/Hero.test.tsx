import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { countStats } from "../M02_StatBar/countStats";

test("灯牌数字与 registry.json 一致", () => {
  const registryPath = path.join(
    process.cwd(),
    "content",
    "generated",
    "registry.json",
  );
  const registry = JSON.parse(readFileSync(registryPath, "utf8")) as {
    modules: unknown[];
    protocols: Array<{ pipeline?: string; assets?: { count?: number } }>;
  };
  const counts = countStats(registry);

  assert.equal(counts.modules, registry.modules.length);
  assert.equal(counts.community, registry.protocols.length);
  assert.equal(
    counts.pipelines,
    new Set(registry.protocols.map((item) => item.pipeline).filter(Boolean))
      .size,
  );
  assert.equal(
    counts.assetKeys,
    registry.protocols.reduce(
      (sum, item) => sum + (item.assets?.count ?? 0),
      0,
    ),
  );
});
