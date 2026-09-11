import { Paths } from "@/components/concepts/M04_Paths/Paths";
import { Quality } from "@/components/concepts/M03_Quality/Quality";
import { What } from "@/components/concepts/M01_What/What";
import { loadConcepts } from "@/components/concepts/loadConcepts";
import type { Metadata } from "next";

const content = loadConcepts();

export const metadata: Metadata = {
  title: content.title,
  description: content.metaDescription,
};

export default function ConceptsPage() {
  return (
    <main className="mx-auto w-full max-w-[65ch] px-4 py-8 text-base leading-relaxed text-foreground sm:px-6">
      <What
        placeholder={content.placeholder}
        title={content.title}
        paragraphs={content.what}
      />
      <div className="mt-10 flex flex-col gap-10">
        <Quality heading={content.headingQuality} paragraphs={content.quality} />
        <Paths
          heading={content.headingPaths}
          aiHeading={content.headingAi}
          humanHeading={content.headingHuman}
          pathAi={content.pathAi}
          pathHuman={content.pathHuman}
          links={content.links}
        />
      </div>
    </main>
  );
}
