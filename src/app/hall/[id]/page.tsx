import Link from "next/link";
import { notFound } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { getAsset, listAssets } from "@/lib/data";

export const dynamicParams = false;

export function generateStaticParams() {
  return listAssets()
    .map((item) => item.slug)
    .filter((id) => id.length > 0)
    .map((id) => ({ id }));
}

export default async function HallDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const asset = getAsset(id);
  if (!asset) notFound();

  const faces = asset.tool_face ?? [];

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-6 px-4 py-8 sm:px-6">
      <p className="text-sm">
        <Link className="underline underline-offset-4" href="/hall">
          数据大厅
        </Link>
      </p>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-3xl font-medium tracking-tight">{asset.name}</h1>
        <Badge variant="secondary">
          {asset.kind === "module" ? "模块" : "管线"}
        </Badge>
        <Badge variant="outline">{asset.category}</Badge>
      </div>
      <p className="text-sm text-muted-foreground">{asset.id}</p>
      <p className="text-base leading-relaxed">{asset.summary}</p>
      {asset.layers && asset.layers.length > 0 ? (
        <section>
          <h2 className="mb-2 text-lg font-medium">层</h2>
          <ul className="flex flex-col gap-1 text-sm">
            {asset.layers.map((layer) => (
              <li key={layer.id}>
                {layer.id} · {layer.name}
              </li>
            ))}
          </ul>
        </section>
      ) : null}
      {faces.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-medium">tool_face</h2>
          {faces.map((face) => (
            <Card key={face.purpose} size="sm">
              <CardHeader>
                <CardTitle>{face.purpose}</CardTitle>
                <CardDescription>模块工具面（建议层，引用≠背书）</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {Object.entries(face.guidance).map(([key, value]) => (
                  <p key={key} className="text-sm">
                    <span className="text-muted-foreground">{key}：</span>
                    {value}
                  </p>
                ))}
                {face.candidates.map((cand) => (
                  <p key={cand.repo} className="text-sm">
                    {cand.repo}
                    {cand.ref ? ` @ ${cand.ref}` : ""}
                    {cand.license ? ` · ${cand.license}` : ""}
                  </p>
                ))}
              </CardContent>
            </Card>
          ))}
        </section>
      ) : null}
      <p className="text-sm">
        <a
          className="underline underline-offset-4"
          href={`https://github.com/Monyeah777/NarrativeForge/blob/main/${asset.path}`}
          rel="noreferrer"
          target="_blank"
        >
          主仓库源文件
        </a>
      </p>
    </main>
  );
}
