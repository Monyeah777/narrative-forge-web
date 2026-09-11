"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

const links = [
  { href: "/", label: "首页" },
  { href: "/concepts", label: "NF 是什么" },
  { href: "/hall", label: "数据大厅" },
  { href: "/community", label: "社区" },
];

export function SiteNav() {
  const pathname = usePathname();

  return (
    <header className="border-b border-border">
      <nav
        aria-label="站点"
        className="mx-auto flex w-full max-w-3xl flex-wrap items-center gap-x-4 gap-y-2 px-4 py-3 sm:px-6"
      >
        <Link className="font-medium text-foreground" href="/">
          NarrativeForge
        </Link>
        <ul className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          {links.map((link) => {
            const current =
              link.href === "/"
                ? pathname === "/"
                : pathname === link.href || pathname.startsWith(`${link.href}/`);
            return (
              <li key={link.href}>
                <Link
                  aria-current={current ? "page" : undefined}
                  className={
                    current
                      ? "text-foreground underline underline-offset-4"
                      : "text-muted-foreground hover:text-foreground"
                  }
                  href={link.href}
                >
                  {link.label}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </header>
  );
}
