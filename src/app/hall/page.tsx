import type { Metadata } from "next";
import { HallList } from "./HallList";
import { listHallItems } from "@/lib/data";

export const metadata: Metadata = {
  title: "数据大厅",
  description: "浏览官方核心模块、核心管线与资产键。",
};

export default function HallPage() {
  const items = listHallItems();
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6">
      <h1 className="text-3xl font-medium tracking-tight">数据大厅</h1>
      <p className="text-sm text-muted-foreground">
        只读浏览官方核心模块、核心管线与资产键。
      </p>
      <HallList items={items} />
    </main>
  );
}
