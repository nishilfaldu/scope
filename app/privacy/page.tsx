import type { Metadata } from "next";
import type { ReactNode } from "react";

import { PublicFooter } from "@/components/public/public-footer";
import { PublicHeader } from "@/components/public/public-header";

export const metadata: Metadata = {
  title: "Privacy policy · Scope",
  description:
    "How Scope accesses, uses, stores, shares, retains, and deletes account and connected-service data.",
};

type PolicySection = { id: string; title: string; content: ReactNode };

const sections: PolicySection[] = [
  {
    id: "data-we-collect",
    title: "Data we collect and access",
    content: (
      <>
        <p>
          Scope collects your email address for sign-in and stores account and
          security records needed to operate the service. When you connect a
          provider account, Scope stores the provider account identifier,
          display name or email returned by the provider, the app you connected,
          granted authorization metadata, and a Vercel Connect account
          reference. Scope does not store Slack access or refresh tokens.
        </p>
        <p>
          Scope connects Airtable and Slack accounts through Vercel Connect.
          Provider sign-in shows the requested permissions and is separate from
          Scope sign-in. Access through MCP is currently available for Airtable;
          Slack account connection does not enable Slack MCP access.
        </p>
      </>
    ),
  },
  {
    id: "how-we-use-data",
    title: "How we use connected-service data",
    content: (
      <>
        <p>
          Scope uses provider authorization data to show you which accounts are
          connected and to provide the access-control features you request. When
          an agent requests access, Scope shows you the app, connected account,
          access permissions, task, and sharing window. Scope issues credentials
          for that request only after the required approval and ownership checks
          succeed.
        </p>
        <p>
          Scope does not use connected-service data for advertising, credit
          decisions, or sale to data brokers.
        </p>
      </>
    ),
  },
  {
    id: "sharing",
    title: "Sharing and disclosure",
    content: (
      <>
        <p>
          When you approve an access request, Scope provides a credential to the
          agent identified in the request so it can access the specific app and
          account you approved. The agent may then process data from that
          connected service to perform the task described in the request. You
          should approve only agents and requests you trust.
        </p>
        <p>
          Scope uses infrastructure service providers to host the application,
          store encrypted credentials and application records, and deliver
          transactional sign-in email. They process data only to provide those
          services. Scope may also disclose information when required by law or
          to protect the service and its users. Scope does not sell
          connected-service data or transfer it for advertising.
        </p>
      </>
    ),
  },
  {
    id: "storage-security",
    title: "Storage and security",
    content: (
      <p>
        Vercel Connect manages Slack authorization and credentials. Scope
        encrypts temporary credential replay data and applies ownership and
        recipient checks before sharing credentials through WorkOS-authorized
        MCP. Browser approval pages never receive provider credentials. Data is
        encrypted in transit using HTTPS. No security measure is perfect, but we
        limit access to the systems and data required to operate Scope.
      </p>
    ),
  },
  {
    id: "retention-deletion",
    title: "Retention, revocation, and deletion",
    content: (
      <>
        <p>
          Scope retains your account information while your account is active.
          Scope removes temporary encrypted replay material after its sharing
          window and retains connection metadata and request history. A longer
          retention period may be required for security, fraud prevention, or
          law. Request, approval, and audit records may be retained for a
          limited period to protect users and investigate service abuse.
        </p>
        <p>
          You can stop further sharing through an account, request, or
          authorized MCP connection in Scope. Previously received credentials
          may remain active at the provider. You can also revoke Scope in the
          connected provider&apos;s account settings. To request deletion of
          your Scope account and associated data, email{" "}
          <a href="mailto:nishilfaldu@gmail.com">nishilfaldu@gmail.com</a>.
        </p>
      </>
    ),
  },
  {
    id: "changes-contact",
    title: "Changes and contact",
    content: (
      <>
        <p>
          We will update this policy when our data practices change and revise
          the effective date shown above. Material changes will be communicated
          in the application or by email when appropriate.
        </p>
        <p>
          Questions, privacy requests, and deletion requests can be sent to the
          developer responsible for Scope at{" "}
          <a href="mailto:nishilfaldu@gmail.com">nishilfaldu@gmail.com</a>.
        </p>
      </>
    ),
  },
];

export default function PrivacyPage() {
  return (
    <div className="min-h-svh bg-[#f7f9f5] text-[#172019] dark:bg-background dark:text-foreground">
      <PublicHeader />
      <main className="mx-auto max-w-6xl px-5 py-14 sm:px-8 sm:py-20">
        <div className="grid gap-12 lg:grid-cols-[14rem_minmax(0,44rem)] lg:gap-20">
          <aside className="lg:sticky lg:top-10 lg:self-start">
            <p className="text-sm font-semibold">Scope</p>
            <p className="mt-1 text-sm text-[#68746a] dark:text-muted-foreground">
              Effective October 3, 2026
            </p>
            <nav
              className="mt-7 hidden border-l border-[#d8e1d4] pl-4 text-sm lg:block dark:border-border"
              aria-label="Privacy policy sections"
            >
              <ul className="space-y-3 text-[#5d695f] dark:text-muted-foreground">
                {sections.map((section) => (
                  <li key={section.id}>
                    <a
                      className="hover:text-foreground"
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
            <h1 className="text-4xl font-semibold tracking-[-0.045em] sm:text-5xl">
              Privacy policy
            </h1>
            <p className="mt-6 text-lg leading-8 text-[#526054] dark:text-muted-foreground">
              This policy explains how Scope accesses, uses, stores, shares,
              retains, and deletes personal information and data from services
              you connect to Scope.
            </p>
            <div className="mt-12 divide-y divide-[#d8e1d4] border-y border-[#d8e1d4] dark:divide-border dark:border-border">
              {sections.map((section) => (
                <section
                  className="scroll-mt-8 py-9"
                  id={section.id}
                  key={section.id}
                >
                  <h2 className="text-xl font-semibold tracking-[-0.02em]">
                    {section.title}
                  </h2>
                  <div className="mt-4 space-y-4 text-[15px] leading-7 text-[#526054] [&_a]:font-medium [&_a]:text-foreground [&_a]:underline [&_a]:underline-offset-4 dark:text-muted-foreground">
                    {section.content}
                  </div>
                </section>
              ))}
            </div>
          </article>
        </div>
      </main>
      <PublicFooter />
    </div>
  );
}
