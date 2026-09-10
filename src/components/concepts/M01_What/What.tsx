import type { WhatProps } from "./contract";

export function What({ placeholder, title, paragraphs }: WhatProps) {
  return (
    <section className="flex flex-col gap-4">
      {placeholder ? (
        <p className="text-sm text-muted-foreground">占位 · 待作者审校</p>
      ) : null}
      <h1 className="text-3xl font-medium tracking-tight text-foreground">
        {title}
      </h1>
      {paragraphs.map((text) => (
        <p key={text}>{text}</p>
      ))}
    </section>
  );
}
