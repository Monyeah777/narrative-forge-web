import { Hero } from "@/components/home/M01_Hero/Hero";
import { loadHomeCopy } from "@/components/home/loadHomeCopy";

export default function Home() {
  const copy = loadHomeCopy();

  return (
    <main className="mx-auto flex w-full max-w-3xl flex-col gap-8 px-4 py-8 sm:px-6">
      <Hero
        copy={{
          placeholder: copy.placeholder,
          brand: copy.brand,
          tagline: copy.tagline,
          ctaGithub: copy.ctaGithub,
          ctaGitee: copy.ctaGitee,
        }}
      />
    </main>
  );
}
