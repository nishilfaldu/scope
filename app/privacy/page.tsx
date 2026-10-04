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
          reference. Scope does not store provider access or refresh tokens.
        </p>
        <p>
          Scope connects Slack accounts through Vercel Connect. Provider sign-in
          shows the requested permissions and is separate from Scope sign-in.
          Slack shows the permissions requested by the configured Connect
          connector. The CLI requests approval and receives credentials
          privately for a local program.
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
          connected and provide the access controls you request. Access shows
          the account, stated purpose and current approval status. You choose
          how long to allow token requests without asking again. The window
          begins at approval and does not set the provider token&apos;s expiry.
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
          authenticated CLI session for the selected account and grant. Every
          token includes all permissions granted when you connected the account.
          The stated purpose does not restrict the token. Approve only requests
          from programs you trust.
        </p>
        <p>
          Scope uses infrastructure service providers to host the application,
          manage provider credentials and store application records, and deliver
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
        Vercel Connect manages provider authorization and credentials. Scope
        stores approval records and applies ownership, account, permission,
        deadline, and recipient checks before private credential delivery. The
        CLI stores its own Scope login session privately on your device. It
        injects provider credentials into a child program&apos;s environment.
        Approval pages and CLI metadata never receive provider credentials. The
        CLI masks known credentials in output. It is not a sandbox; a program
        holding a credential can write or transmit it. Data is encrypted in
        transit using HTTPS. No security measure is perfect, but we limit access
        to the systems and data required to operate Scope.
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
          Scope retains connection metadata and request history. A longer
          retention period may be required for security, fraud prevention, or
          law. Request, approval, and audit records may be retained for a
          limited period to protect users and investigate service abuse.
        </p>
        <p>
          End approval stops further token collection in Scope. It does not
          revoke tokens already received or stop programs. Disconnect blocks
          collection immediately and asks Vercel Connect to revoke the selected
          subject and installation. Connect attempts provider revocation where
          supported. Scope reports completion from Connect&apos;s result.
          Provider credentials may remain valid when upstream revocation is
          unsupported. A failure can be retried with Disconnect. You can also
          revoke Scope in the provider&apos;s account settings. To request
          deletion of your Scope account and associated data, email{" "}
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
              Effective October 4, 2026
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
