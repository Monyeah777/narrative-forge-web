import { HallList } from "./HallList";
import { queryAssets } from "@/lib/data";

export default function HallPage() {
  const items = queryAssets();
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6">
      <h1 className="text-3xl font-medium tracking-tight">数据大厅</h1>
      <p className="text-sm text-muted-foreground">
        只读浏览主仓库投影。数字与分类来自 generated 数据。
      </p>
      <HallList items={items} />
    </main>
  );
}
