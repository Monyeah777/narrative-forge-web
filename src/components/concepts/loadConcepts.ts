import { readFileSync } from "node:fs";
import path from "node:path";

export type MappingRow = {
  nf: string;
  web: string;
  note: string;
};

export type ConceptLink = {
  label: string;
  href: string;
};

export type ConceptsContent = {
  placeholder: boolean;
  title: string;
  metaDescription: string;
  headingMapping: string;
  headingQuality: string;
  headingPaths: string;
  headingAi: string;
  headingHuman: string;
  what: string[];
  mapping: MappingRow[];
  quality: string[];
  pathAi: string[];
  pathHuman: string[];
  links: ConceptLink[];
};

function parseFrontMatter(raw: string): {
  fields: Record<string, string>;
  body: string;
} {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) {
    throw new Error("content/concepts.mdx missing front matter");
  }
  const fields: Record<string, string> = {};
  for (const line of match[1].split(/\r?\n/)) {
    const idx = line.indexOf(":");
    if (idx === -1) continue;
    fields[line.slice(0, idx).trim()] = line.slice(idx + 1).trim();
  }
  return { fields, body: match[2] };
}

function section(body: string, heading: string): string {
  const escaped = heading.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const re = new RegExp(
    `## ${escaped}\\r?\\n([\\s\\S]*?)(?=\\r?\\n## |$)`,
  );
  return body.match(re)?.[1].trim() ?? "";
}

function paragraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((block) => block.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

function parseMapping(text: string): MappingRow[] {
  const rows: MappingRow[] = [];
  for (const line of text.split(/\r?\n/)) {
    if (!line.startsWith("|")) continue;
    const cells = line
      .split("|")
      .slice(1, -1)
      .map((cell) => cell.trim());
    if (cells.length < 3) continue;
    if (cells[0] === "nf" || /^-+$/.test(cells[0])) continue;
    rows.push({ nf: cells[0], web: cells[1], note: cells[2] });
  }
  return rows;
}

function parseLinks(text: string): ConceptLink[] {
  const links: ConceptLink[] = [];
  const re = /\[([^\]]+)\]\((https?:[^)]+)\)/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    links.push({ label: match[1], href: match[2] });
  }
  return links;
}

export function loadConcepts(): ConceptsContent {
  const file = path.join(process.cwd(), "content", "concepts.mdx");
  const { fields, body } = parseFrontMatter(readFileSync(file, "utf8"));
  return {
    placeholder: fields.placeholder === "true",
    title: fields.title ?? "",
    metaDescription: fields.meta_description ?? "",
    headingMapping: fields.heading_mapping ?? "",
    headingQuality: fields.heading_quality ?? "",
    headingPaths: fields.heading_paths ?? "",
    headingAi: fields.heading_ai ?? "",
    headingHuman: fields.heading_human ?? "",
    what: paragraphs(section(body, "what")),
    mapping: parseMapping(section(body, "mapping")),
    quality: paragraphs(section(body, "quality")),
    pathAi: paragraphs(section(body, "path_ai")),
    pathHuman: paragraphs(section(body, "path_human")),
    links: parseLinks(section(body, "links")),
  };
}
