import type { ReactNode } from "react";

import { PublicShell } from "@/components/public/public-shell";

export function LegalDocument({
  title,
  lede,
  effective,
  navLabel,
  sections,
}: {
  title: string;
  lede: string;
  effective: string;
  navLabel: string;
  sections: { id: string; title: string; content: ReactNode }[];
}) {
  return (
    <PublicShell>
      <main
        id="content"
        className="mx-auto max-w-6xl px-5 py-16 sm:px-8 sm:py-24"
      >
        <div className="grid gap-12 lg:grid-cols-[13rem_minmax(0,42rem)] lg:justify-center lg:gap-16">
          <aside className="lg:sticky lg:top-24 lg:self-start">
            <p className="font-semibold">Scope</p>
            <p className="mt-1 text-scope-quiet">{effective}</p>
            <nav
              className="mt-7 hidden border-l border-scope-line pl-4 lg:block"
              aria-label={navLabel}
            >
              <ul className="space-y-3 text-scope-quiet">
                {sections.map((section) => (
                  <li key={section.id}>
                    <a
                      className="rounded-md hover:text-scope-ink focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/30"
                      href={`#${section.id}`}
                    >
                      {section.title}
                    </a>
                  </li>
                ))}
              </ul>
            </nav>
          </aside>
          <article>
            <h1 className="text-4xl font-semibold tracking-[-0.04em] sm:text-5xl">
              {title}
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-8 text-scope-quiet">
              {lede}
            </p>
            <div className="mt-12 divide-y divide-scope-line border-y border-scope-line">
              {sections.map((section) => (
                <section
                  className="scroll-mt-24 py-9"
                  id={section.id}
                  key={section.id}
                >
                  <h2 className="text-xl font-semibold tracking-[-0.02em]">
                    {section.title}
                  </h2>
                  <div className="mt-4 space-y-4 text-[15px] leading-7 text-scope-quiet [&_a]:font-medium [&_a]:text-scope-ink [&_a]:underline [&_a]:underline-offset-4">
                    {section.content}
                  </div>
                </section>
              ))}
            </div>
          </article>
        </div>
      </main>
    </PublicShell>
  );
}
