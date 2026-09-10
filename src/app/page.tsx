import { Hero } from "@/components/home/M01_Hero/Hero";
import { StatBar } from "@/components/home/M02_StatBar/StatBar";
import { countStats } from "@/components/home/M02_StatBar/countStats";
import { loadHomeCopy } from "@/components/home/loadHomeCopy";
import registry from "../../content/generated/registry.json";

export default function Home() {
  const copy = loadHomeCopy();
  const counts = countStats(registry);

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 py-4">
      <Hero
        copy={{
          placeholder: copy.placeholder,
          brand: copy.brand,
          tagline: copy.tagline,
          ctaGithub: copy.ctaGithub,
          ctaGitee: copy.ctaGitee,
        }}
      />
      <StatBar
        counts={counts}
        labels={{
          modules: copy.statModules,
          pipelines: copy.statPipelines,
          community: copy.statCommunity,
          assetKeys: copy.statAssetKeys,
        }}
      />
    </main>
  );
}
