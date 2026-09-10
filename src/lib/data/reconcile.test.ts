import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { moduleCatalogMeta, queryAssets } from "./index";

test("模块数与主仓库一致", () => {
  const inventory = JSON.parse(
    readFileSync(
      path.join(process.cwd(), "content", "generated", "04_模块库清单.json"),
      "utf8",
    ),
  ) as { entries: unknown[] };
  const meta = moduleCatalogMeta();
  assert.equal(meta.official_count, inventory.entries.length);
  assert.equal(
    queryAssets({ kind: "module", source: "官方核心" }).length,
    inventory.entries.length,
  );
  assert.equal(queryAssets({ kind: "module" }).length, meta.total);
  assert.equal(meta.total, meta.official_count + meta.community_count);
  const slugs = queryAssets().map((item) => item.slug);
  assert.equal(new Set(slugs).size, slugs.length);
  assert.ok(slugs.every((slug) => /^[a-z0-9-]+$/.test(slug)));
  const timed = queryAssets({ kind: "module" }).find((item) => item.id === "通用:M10");
  const communityTime = queryAssets({ kind: "module" }).find(
    (item) => item.id === "M10" || item.path.includes("M10_死亡重生"),
  );
  assert.ok(timed?.slug && /^[a-z0-9-]+$/.test(timed.slug));
  assert.ok(communityTime?.slug);
  assert.notEqual(timed.slug, communityTime.slug);
});
