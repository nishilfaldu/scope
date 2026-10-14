import type { Metadata } from "next";
import Link from "next/link";

import { ProductPreview } from "@/components/public/product-preview";
import { PublicShell } from "@/components/public/public-shell";
import { AppMark } from "@/components/shared/app-mark";
import { CopyField } from "@/components/shared/copy-field";
import { Button } from "@/components/ui/button";
import { siteDescription, siteUrl } from "@/lib/site";

export const metadata: Metadata = {
  alternates: { canonical: "/" },
};

const structuredData = {
  "@context": "https://schema.org",
  "@type": "SoftwareApplication",
  name: "Scope",
  url: siteUrl,
  description: siteDescription,
  applicationCategory: "DeveloperApplication",
  operatingSystem: "Web",
};

const signIn = "/signin?redirectTo=/requests";

const mcpUrl = new URL(
  "/mcp",
  process.env.SCOPE_ORIGIN ?? "https://scope.nishilfaldu.site",
).href;

const accounts = [
  {
    id: "slack",
    name: "Slack",
    runs: "Search and read messages, channels and canvases",
    asks: "Send, schedule or react to messages, and edit canvases",
  },
  {
    id: "github",
    name: "GitHub",
    runs: "Read repos, files, issues, pull requests and commits",
    asks: "Open issues and PRs, comment, commit and merge",
  },
  {
    id: "google",
    name: "Google",
    runs: "Search and read mail, calendars and events",
    asks: "Draft emails, and create, change or answer events",
  },
  {
    id: "notion",
    name: "Notion",
    runs: "Search and read pages, comments and databases",
    asks: "Create, change, move or comment on pages",
  },
  {
    id: "vercel",
    name: "Vercel",
    runs: "Read projects, deployments and logs",
    asks: "Promote, roll back, cancel or pause deployments",
  },
];

const steps = [
  {
    title: "Connect an account",
    body: "Sign in and connect Slack, GitHub, Notion, Google or Vercel. Apps never get your tokens. Scope runs each call and returns only the result.",
  },
  {
    title: "Add Scope to an app",
    body: "Paste the server URL into Cursor, Claude, ChatGPT or another MCP app. The app signs in to Scope and gets its own rules.",
  },
  {
    title: "Decide each call",
    body: "Reads run unless you block them. Writes ask first, in Scope or from a notification on your phone or browser. Every call goes to Activity, without its arguments or results.",
  },
];

const apps = [
  { name: "Cursor", how: "Add a custom MCP server and paste the URL." },
  { name: "Claude", how: "Add a custom connector and paste the URL." },
  { name: "ChatGPT", how: "Add a custom connector and paste the URL." },
];

export default function HomePage() {
  return (
    <PublicShell>
      <script
        type="application/ld+json"
        dangerouslySetInnerHTML={{ __html: JSON.stringify(structuredData) }}
      />
      <main id="content">
        <section className="mx-auto max-w-6xl px-5 pt-12 text-center sm:px-8 sm:pt-16">
          <h1 className="mx-auto max-w-[14ch] text-5xl leading-[1.02] font-semibold tracking-[-0.045em] text-balance sm:text-6xl lg:text-[64px]">
            <span className="block">Connect once.</span>
            <span className="block">Decide what each AI app can do.</span>
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-lg leading-8 text-pretty text-scope-quiet">
            One MCP server for Cursor, Claude, ChatGPT and your other AI apps.
            You set the rules. Scope runs the calls.
          </p>
          <div className="mt-7 flex flex-wrap items-center justify-center gap-3">
            <Button
              size="lg"
              nativeButton={false}
              render={<Link href={signIn} />}
            >
              Sign in to Scope
            </Button>
            <Button
              size="lg"
              variant="outline"
              nativeButton={false}
              className="bg-white"
              render={<a href="#how" />}
            >
              See how it works
            </Button>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 pt-10 pb-20 sm:px-8 sm:pb-28">
          <ProductPreview />
          <p className="mt-4 text-center text-[15px] text-pretty text-scope-quiet">
            The preview works. Approve the request, or open Apps and change a
            rule.
          </p>
        </section>

        <section
          id="how"
          className="border-y border-scope-line bg-white scroll-mt-16"
        >
          <div className="mx-auto grid max-w-6xl grid-cols-1 gap-12 px-5 py-20 sm:px-8 sm:py-28 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)] lg:gap-20">
            <div>
              <h2 className="text-3xl font-semibold tracking-[-0.03em] text-balance sm:text-4xl">
                How it works
              </h2>
              <ol className="mt-10 space-y-8">
                {steps.map((step, index) => (
                  <li key={step.title} className="flex gap-4">
                    <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-scope-hover text-xs font-semibold text-scope-green">
                      {index + 1}
                    </span>
                    <div>
                      <h3 className="pt-1 text-base font-semibold">
                        {step.title}
                      </h3>
                      <p className="mt-2 max-w-md text-[15px] leading-6 text-pretty text-scope-quiet">
                        {step.body}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
            </div>
            <div className="self-start rounded-2xl border border-scope-line bg-scope-wash/60 p-6 sm:p-8">
              <h3 className="text-lg font-semibold tracking-[-0.02em]">
                Add Scope to an app
              </h3>
              <p className="mt-2 text-[15px] leading-6 text-pretty text-scope-quiet">
                Use this URL in every app. The app opens a browser window so you
                can sign in to Scope.
              </p>
              <div className="mt-6">
                <CopyField label="Server URL" value={mcpUrl} />
              </div>
              <dl className="mt-6 divide-y divide-scope-line border-t border-scope-line text-[15px]">
                {apps.map((app) => (
                  <div key={app.name} className="flex gap-4 py-3">
                    <dt className="w-20 shrink-0 font-medium">{app.name}</dt>
                    <dd className="text-scope-quiet">{app.how}</dd>
                  </div>
                ))}
                <div className="flex flex-col gap-2 py-3">
                  <dt className="font-medium">Claude Code</dt>
                  <dd>
                    <code className="block overflow-x-auto rounded-lg bg-white px-3 py-2 font-mono text-[13px] whitespace-nowrap">
                      claude mcp add --transport http scope {mcpUrl}
                    </code>
                  </dd>
                </div>
              </dl>
            </div>
          </div>
        </section>

        <section
          id="accounts"
          className="mx-auto max-w-6xl scroll-mt-16 px-5 py-20 sm:px-8 sm:py-28"
        >
          <div className="max-w-2xl">
            <h2 className="text-3xl font-semibold tracking-[-0.03em] text-balance sm:text-4xl">
              The accounts you already use.
            </h2>
            <p className="mt-4 text-lg leading-8 text-pretty text-scope-quiet">
              Reads run right away. Anything that changes data asks you first.
              You can change either rule for each app.
            </p>
          </div>
          <div className="mt-10 border-t border-scope-line text-[15px]">
            <div
              aria-hidden
              className="hidden grid-cols-[12rem_1fr_1fr] gap-6 border-b border-scope-line py-3 text-scope-quiet md:grid"
            >
              <span>Account</span>
              <span>Runs right away</span>
              <span>Asks you first</span>
            </div>
            <ul className="divide-y divide-scope-line border-b border-scope-line">
              {accounts.map((account) => (
                <li
                  key={account.id}
                  className="grid gap-3 py-5 md:grid-cols-[12rem_1fr_1fr] md:gap-6"
                >
                  <p className="flex items-center gap-3 font-medium">
                    <AppMark providerId={account.id} />
                    {account.name}
                  </p>
                  <p className="leading-6 text-pretty">
                    <span className="block text-scope-quiet md:sr-only">
                      Runs right away
                    </span>
                    {account.runs}
                  </p>
                  <p className="leading-6 text-pretty">
                    <span className="block text-scope-quiet md:sr-only">
                      Asks you first
                    </span>
                    {account.asks}
                  </p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        <section className="mx-auto max-w-6xl px-5 pb-24 text-center sm:px-8 sm:pb-32">
          <h2 className="text-3xl font-semibold tracking-[-0.03em] text-balance sm:text-4xl">
            Add Scope to your first app.
          </h2>
          <p className="mx-auto mt-4 max-w-lg text-lg leading-8 text-balance text-scope-quiet">
            Sign in, connect an account, then paste the server URL into your
            app.
          </p>
          <Button
            size="lg"
            nativeButton={false}
            className="mt-8"
            render={<Link href={signIn} />}
          >
            Sign in to Scope
          </Button>
        </section>
      </main>
    </PublicShell>
  );
}
