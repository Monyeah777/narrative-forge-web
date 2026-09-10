import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { MappingProps } from "./contract";

export function Mapping({ heading, rows }: MappingProps) {
  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-xl font-medium text-foreground">{heading}</h2>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {rows.map((row) => (
          <Card key={row.nf} size="sm">
            <CardHeader>
              <CardTitle>
                {row.nf} = {row.web}
              </CardTitle>
              <CardDescription>
                {row.nf} → {row.web}
              </CardDescription>
            </CardHeader>
            <CardContent>
              <p>{row.note}</p>
            </CardContent>
          </Card>
        ))}
      </div>
    </section>
  );
}
