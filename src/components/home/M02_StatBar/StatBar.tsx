import type { StatBarProps } from "./contract";

export function StatBar({ counts, labels }: StatBarProps) {
  const items = [
    { label: labels.modules, value: counts.modules },
    { label: labels.pipelines, value: counts.pipelines },
    { label: labels.community, value: counts.community },
    { label: labels.assetKeys, value: counts.assetKeys },
  ];

  return (
    <section className="grid grid-cols-2 gap-px border border-border bg-border sm:grid-cols-4">
      {items.map((item) => (
        <div
          className="bg-background px-4 py-6 text-center"
          key={item.label}
        >
          <p className="text-2xl font-medium tabular-nums text-foreground">
            {item.value}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">{item.label}</p>
        </div>
      ))}
    </section>
  );
}
