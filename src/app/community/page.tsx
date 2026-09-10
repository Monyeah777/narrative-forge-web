import { Follow } from "@/components/community/M02_Follow/Follow";
import { Shelf } from "@/components/community/M01_Shelf/Shelf";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "社区入口",
  description: "NarrativeForge 内容货架即将开放。货架分 official / community / experimental 三档。",
};

export default function CommunityPage() {
  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-10 px-4 py-8 sm:px-6">
      <header className="flex flex-col gap-3">
        <p className="text-sm text-muted-foreground">占位 · 待作者确认</p>
        <h1 className="text-3xl font-medium tracking-tight">社区入口</h1>
        <p className="max-w-prose text-base leading-relaxed">
          内容货架即将开放。community/ 是公开的社区内容货架：领域包（模块 + 资产 +
          管线 + 装载手册）。第三方上架默认 community 档，实战验证后再议升级。不照搬代码市场。
        </p>
        <p className="text-sm text-muted-foreground">
          「即将开放」措辞待作者确认。本页不承诺开放日期。
        </p>
      </header>
      <Shelf
        tier="official"
        title="official"
        note="官方档预览。格子为占位，不是上架清单。"
        slots={3}
      />
      <Shelf
        tier="community"
        title="community"
        note="社区档预览。第三方默认从此档起步。"
        slots={6}
      />
      <Shelf
        tier="experimental"
        title="experimental"
        note="实验档预览。未经验证的试放位置。"
        slots={4}
      />
      <Follow
        heading="关注"
        links={[
          {
            id: "github",
            label: "GitHub star",
            href: "https://github.com/Monyeah777/NarrativeForge",
          },
          {
            id: "gitee",
            label: "Gitee 收藏",
            href: "https://gitee.com/monyeah777/narrative-forge",
          },
        ]}
      />
      <p className="text-sm">
        <a
          className="underline underline-offset-4"
          href="https://github.com/Monyeah777/NarrativeForge/blob/main/community/README.md"
          rel="noreferrer"
          target="_blank"
        >
          community/README.md
        </a>
      </p>
    </main>
  );
}
