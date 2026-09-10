"use client";

import type { HallAsset } from "@/lib/data";
import Link from "next/link";
import { useMemo, useState } from "react";

export function HallList({ items }: { items: HallAsset[] }) {
  const [kind, setKind] = useState<"all" | HallAsset["kind"]>("all");
  const [category, setCategory] = useState("all");

  const categories = useMemo(() => {
    const set = new Set(items.map((item) => item.category));
    return [...set].sort();
  }, [items]);

  const visible = items.filter((item) => {
    if (kind !== "all" && item.kind !== kind) return false;
    if (category !== "all" && item.category !== category) return false;
    return true;
  });

  return (
    <div className="flex flex-col gap-6">
      <div className="flex flex-wrap gap-2">
        {(["all", "module", "pipeline"] as const).map((value) => (
          <button
            className={`rounded-md border px-3 py-1.5 text-sm ${
              kind === value
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-background"
            }`}
            key={value}
            onClick={() => setKind(value)}
            type="button"
          >
            {value === "all" ? "全部" : value === "module" ? "模块" : "管线"}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap gap-2">
        <button
          className={`rounded-md border px-3 py-1.5 text-sm ${
            category === "all"
              ? "border-foreground bg-foreground text-background"
              : "border-border bg-background"
          }`}
          onClick={() => setCategory("all")}
          type="button"
        >
          全部分类
        </button>
        {categories.map((name) => (
          <button
            className={`rounded-md border px-3 py-1.5 text-sm ${
              category === name
                ? "border-foreground bg-foreground text-background"
                : "border-border bg-background"
            }`}
            key={name}
            onClick={() => setCategory(name)}
            type="button"
          >
            {name}
          </button>
        ))}
      </div>
      <p className="text-sm text-muted-foreground">{visible.length} 条</p>
      <ul className="flex flex-col gap-3">
        {visible.map((item) => (
          <li key={`${item.kind}-${item.id}`}>
            <Link
              className="block rounded-md border border-border px-4 py-3 hover:bg-muted"
              href={`/hall/${item.slug}`}
            >
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{item.name}</span>
                <span className="text-xs text-muted-foreground">
                  {item.kind === "module" ? "模块" : "管线"} · {item.category}
                </span>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">{item.id}</p>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  );
}
