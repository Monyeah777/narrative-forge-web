import { buttonVariants } from "@/components/ui/button";
import { cn } from "cn";
import type { FollowProps } from "./contract";

export function Follow({ heading, links }: FollowProps) {
  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-lg font-medium text-foreground">{heading}</h2>
      <div className="flex flex-col gap-2 sm:flex-row">
        {links.map((link) => (
          <a
            className={cn(buttonVariants({ variant: "outline" }), "justify-center")}
            href={link.href}
            id={link.id}
            key={link.id}
            rel="noreferrer"
            target="_blank"
          >
            {link.label}
          </a>
        ))}
      </div>
    </section>
  );
}
