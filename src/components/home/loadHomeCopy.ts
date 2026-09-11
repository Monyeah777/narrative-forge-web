import { readFileSync } from "node:fs";
import path from "node:path";

export type HomeCopy = {
  placeholder: boolean;
  brand: string;
  tagline: string;
  ctaGithub: { label: string; href: string };
  ctaGitee: { label: string; href: string };
  metaTitle: string;
  metaDescription: string;
  ogTitle: string;
  ogDescription: string;
};

function parseFrontMatter(raw: string): Record<string, string> {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!match) {
    throw new Error("specs/copy/home.md missing front matter");
  }
  const fields: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    const key = line.slice(0, idx).trim();
    const value = line.slice(idx + 1).trim();
    fields[key] = value;
  }
  return fields;
}

export function loadHomeCopy(): HomeCopy {
  const file = path.join(process.cwd(), "specs", "copy", "home.md");
  const fields = parseFrontMatter(readFileSync(file, "utf8"));
  return {
    placeholder: fields.placeholder === "true",
    brand: fields.brand ?? "",
    tagline: fields.tagline ?? "",
    ctaGithub: {
      label: fields.cta_github_label ?? "",
      href: fields.cta_github_href ?? "",
    },
    ctaGitee: {
      label: fields.cta_gitee_label ?? "",
      href: fields.cta_gitee_href ?? "",
    },
    metaTitle: fields.meta_title ?? "",
    metaDescription: fields.meta_description ?? "",
    ogTitle: fields.og_title ?? "",
    ogDescription: fields.og_description ?? "",
  };
}
