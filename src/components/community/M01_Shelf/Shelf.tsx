import type { ShelfProps } from "./contract";

export function Shelf({ tier, title, note, slots }: ShelfProps) {
  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-medium text-foreground">{title}</h2>
        <p className="font-mono text-xs text-muted-foreground">{tier}</p>
      </div>
      <p className="text-sm text-muted-foreground">{note}</p>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {Array.from({ length: slots }, (_, index) => (
          <div
            aria-hidden="true"
            className="aspect-[4/3] rounded-md border border-dashed border-border bg-muted/40"
            data-tier={tier}
            key={`${tier}-${index}`}
          />
        ))}
      </div>
    </section>
  );
}
