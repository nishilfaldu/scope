import type { Metadata } from "next";
import type { ReactNode } from "react";

import { PublicFooter } from "@/components/public/public-footer";
import { PublicHeader } from "@/components/public/public-header";

export const metadata: Metadata = {
  title: "Privacy policy · Scope Identity",
  description:
    "How Scope Identity accesses, uses, stores, shares, retains, and deletes account and Google user data.",
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
          granted authorization metadata, and encrypted OAuth access and refresh
          credentials.
        </p>
        <p>
          If you connect Google services, your authorization can allow access to
          Gmail messages and metadata, calendars and events, Drive files, Google
          Docs, and Google Sheets, according to the individual Google app and
          permissions shown during consent. Scope does not use Google OAuth as a
          sign-in method.
        </p>
      </>
    ),
  },
  {
    id: "how-we-use-data",
    title: "How we use Google user data",
    content: (
      <>
        <p>
          Scope uses Google authorization data to show you which Google accounts
          are connected and to provide the access-control features you request.
          When an agent requests access, Scope shows you the app, connected
          account, requested permissions, reason, and duration. Scope issues
          credentials for that request only after the required approval and
          ownership checks succeed.
        </p>
        <p>
          Scope does not use Google user data for advertising, credit decisions,
          or sale to data brokers. Scope does not use Google Workspace API data
          to develop, improve, or train generalized or non-personalized AI or
          machine-learning models.
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
          agent identified in the request so it can access the specific Google
          app and account you approved. The agent may then process Google user
          data to perform the task described in that request. You should approve
          only agents and requests you trust.
        </p>
        <p>
          Scope uses infrastructure service providers to host the application,
          store encrypted credentials and application records, and deliver
          transactional sign-in email. They process data only to provide those
          services. Scope may also disclose information when required by law or
          to protect the service and its users. Scope does not sell Google user
          data or transfer it for advertising.
        </p>
      </>
    ),
  },
  {
    id: "storage-security",
    title: "Storage and security",
    content: (
      <p>
        Provider access and refresh credentials are encrypted before storage.
        Scope keeps provider secrets and slice secrets out of browser approval
        pages and applies ownership checks before issuing credentials. Data is
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
          Connection credentials and metadata are retained until you disconnect
          that provider account or request account deletion, unless a longer
          period is required for security, fraud prevention, or law. Request,
          approval, and audit records may be retained for a limited period to
          protect users and investigate service abuse.
        </p>
        <p>
          You can disconnect a Google account or revoke an agent connection or
          slice in Scope. This stops future credentials from being issued
          through that connection. You can also revoke Scope from your Google
          Account permissions. To request deletion of your Scope account and
          associated data, email{" "}
          <a href="mailto:nishilfaldu@gmail.com">nishilfaldu@gmail.com</a>.
        </p>
      </>
    ),
  },
  {
    id: "limited-use",
    title: "Google API Services User Data Policy",
    content: (
      <p>
        Scope&apos;s use and transfer to any other app of information received
        from Google APIs adheres to the Google API Services User Data Policy,
        including the Limited Use requirements.
      </p>
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
          developer responsible for Scope Identity at{" "}
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
            <p className="text-sm font-semibold">Scope Identity</p>
            <p className="mt-1 text-sm text-[#68746a] dark:text-muted-foreground">
              Effective September 20, 2026
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
              This policy explains how Scope Identity accesses, uses, stores,
              shares, retains, and deletes personal information and Google user
              data when you use Scope.
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
