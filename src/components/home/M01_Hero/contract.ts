import type { HomeCopy } from "../loadHomeCopy";

export type HeroProps = {
  copy: Pick<
    HomeCopy,
    "placeholder" | "brand" | "tagline" | "ctaGithub" | "ctaGitee"
  >;
};
