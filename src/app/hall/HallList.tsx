"use client";

import type { HallAsset } from "@/lib/data";
import Link from "next/link";
import { useMemo, useState } from "react";

const TABS = [
  { id: "module", label: "核心板块" },
  { id: "pipeline", label: "核心管线" },
  { id: "asset", label: "资产" },
] as const;

const SECTION_ORDER = ["通用", "世界", "事件", "技术文档", "官方管线", "官方"];

function kindLabel(kind: HallAsset["kind"]) {
  if (kind === "module") return "模块";
  if (kind === "pipeline") return "管线";
  return "资产";
}

function groupByCategory(items: HallAsset[]) {
  const map = new Map<string, HallAsset[]>();
  for (const item of items) {
    const list = map.get(item.category) ?? [];
    list.push(item);
    map.set(item.category, list);
  }
  return [...map.keys()]
    .sort((a, b) => {
      const ia = SECTION_ORDER.indexOf(a);
      const ib = SECTION_ORDER.indexOf(b);
      if (ia !== -1 || ib !== -1) {
        return (ia === -1 ? 99 : ia) - (ib === -1 ? 99 : ib);
      }
      return a.localeCompare(b, "zh-CN");
    })
    .map((name) => ({ name, items: map.get(name) ?? [] }));
}

export function HallList({ items }: { items: HallAsset[] }) {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("module");

  const visible = useMemo(
    () => items.filter((item) => item.kind === tab),
    [items, tab],
  );
  const sections = useMemo(() => groupByCategory(visible), [visible]);

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-2">
        {TABS.map((item) => (
          <button
            className={`rounded-md border px-3 py-1.5 text-sm ${
              tab === item.id
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-background"
            }`}
            key={item.id}
            onClick={() => setTab(item.id)}
            type="button"
          >
            {item.label}
          </button>
        ))}
      </div>
      {sections.map((section) => (
        <section className="flex flex-col gap-3" key={section.name}>
          {tab === "module" || tab === "asset" ? (
            <h2 className="text-sm font-medium text-muted-foreground">
              {section.name}
            </h2>
          ) : null}
          <ul className="flex flex-col gap-3">
            {section.items.map((item) => (
              <li key={item.slug}>
                <Link
                  className="block rounded-md border border-border px-4 py-3 hover:bg-muted"
                  href={`/hall/${item.slug}`}
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{item.name}</span>
                    <span className="text-xs text-muted-foreground">
                      {kindLabel(item.kind)} · {item.category}
                    </span>
                  </div>
                  <p className="mt-1 text-sm text-muted-foreground">{item.id}</p>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
