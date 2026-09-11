import assert from "node:assert/strict";
import test from "node:test";
import { loadHomeCopy } from "../loadHomeCopy";

test("首页文案从 copy 读取，不含灯牌字段", () => {
  const copy = loadHomeCopy();
  assert.equal(copy.brand, "NarrativeForge");
  assert.ok(copy.ctaGithub.href.includes("github.com"));
  assert.ok(copy.ctaGitee.href.includes("gitee.com"));
  assert.equal("statModules" in copy, false);
});
