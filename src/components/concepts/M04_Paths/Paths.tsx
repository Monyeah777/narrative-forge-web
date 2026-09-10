import type { PathsProps } from "./contract";

export function Paths({
  heading,
  aiHeading,
  humanHeading,
  pathAi,
  pathHuman,
  links,
}: PathsProps) {
  return (
    <section className="flex flex-col gap-6">
      <h2 className="text-xl font-medium text-foreground">{heading}</h2>
      <div className="flex flex-col gap-4">
        <h3 className="text-base font-medium text-foreground">{aiHeading}</h3>
        {pathAi.map((text) => (
          <p key={text}>{text}</p>
        ))}
      </div>
      <div className="flex flex-col gap-4">
        <h3 className="text-base font-medium text-foreground">{humanHeading}</h3>
        {pathHuman.map((text) => (
          <p key={text}>{text}</p>
        ))}
      </div>
      <ul className="flex flex-col gap-2">
        {links.map((link) => (
          <li key={link.href}>
            <a
              className="underline underline-offset-4"
              href={link.href}
              rel="noreferrer"
              target="_blank"
            >
              {link.label}
            </a>
          </li>
        ))}
      </ul>
    </section>
  );
}
