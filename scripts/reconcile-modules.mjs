/**
 * 对账：大厅 modules.json 官方模块数 = 主仓库 04_模块库清单条数。
 */
import { readFileSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const modules = JSON.parse(
  readFileSync(path.join(root, "content", "generated", "modules.json"), "utf8"),
);
const inventory = JSON.parse(
  readFileSync(
    path.join(root, "content", "generated", "04_模块库清单.json"),
    "utf8",
  ),
);

if (modules.official_count !== inventory.entries.length) {
  throw new Error(
    `official ${modules.official_count} != inventory ${inventory.entries.length}`,
  );
}
if (modules.items.length !== modules.official_count + modules.community_count) {
  throw new Error("modules.items length mismatch");
}
console.log(
  `对账通过 官方${modules.official_count} 社区${modules.community_count} 合计${modules.items.length}`,
);
