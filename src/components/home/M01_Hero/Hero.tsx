import { buttonVariants } from "@/components/ui/button";
import { cn } from "cn";
import type { HeroProps } from "./contract";

export function Hero({ copy }: HeroProps) {
  return (
    <section className="flex flex-col gap-4 px-4 py-8 sm:px-6">
      {copy.placeholder ? (
        <p className="text-sm text-muted-foreground">占位</p>
      ) : null}
      <h1 className="text-3xl font-medium tracking-tight text-foreground">
        {copy.brand}
      </h1>
      <p className="max-w-prose text-base leading-relaxed text-foreground">
        {copy.tagline}
      </p>
      <div className="flex flex-col gap-2 sm:flex-row">
        <a
          className={cn(buttonVariants({ variant: "default" }), "justify-center")}
          href={copy.ctaGithub.href}
          rel="noreferrer"
          target="_blank"
        >
          {copy.ctaGithub.label}
        </a>
        <a
          className={cn(buttonVariants({ variant: "outline" }), "justify-center")}
          href={copy.ctaGitee.href}
          rel="noreferrer"
          target="_blank"
        >
          {copy.ctaGitee.label}
        </a>
      </div>
    </section>
  );
}
