import type { QualityProps } from "./contract";

export function Quality({ heading, paragraphs }: QualityProps) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-xl font-medium text-foreground">{heading}</h2>
      {paragraphs.map((text) => (
        <p key={text}>{text}</p>
      ))}
    </section>
  );
}
