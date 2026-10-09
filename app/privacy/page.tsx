import type { Metadata } from "next";
import type { ReactNode } from "react";

import { LegalDocument } from "@/components/public/legal-document";

export const metadata: Metadata = {
  title: "Privacy policy · Scope",
  description:
    "How Scope accesses, uses, stores, shares, retains, and deletes account and connected-service data.",
};

type PolicySection = { id: string; title: string; content: ReactNode };

const sections: PolicySection[] = [
  {
    id: "data-we-collect",
    title: "Data we collect and store",
    content: (
      <>
        <p>
          Scope collects your email address for sign-in. For each provider
          account you connect, Scope stores the provider, a Vercel Connect
          reference, an installation identifier where the provider has one, a
          display name such as the workspace name, and the permissions the
          provider reported at connect time, where it reports them. Scope does
          not store provider access or refresh tokens.
        </p>
        <p>
          For each AI app that signs in, Scope stores its OAuth client
          identifier, its name, when it was last used, whether it is revoked,
          and the rules you set for it. Activity stores the app, tool, decision,
          outcome and time of each call. Activity never stores tool arguments or
          results.
        </p>
        <p>
          An approval request stores the app, tool, account, status and times,
          and a short summary of the call. The summary can include parts of the
          request, such as a channel name, an email recipient, a page title or
          the first characters of a message. For notifications, Scope stores the
          push subscription of each device you enable.
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
          When an app calls a tool, Scope gets a credential from Vercel Connect,
          sends the request to the provider&apos;s API or official MCP server,
          and returns the result to that app. Scope processes the request and
          result only to complete the call. To write approval summaries, Scope
          may read small details from the provider, such as a channel name, page
          title, issue title, event title or deployment address.
        </p>
        <p>
          Scope does not use connected-service data for advertising, credit
          decisions, training models, or sale to data brokers. People do not
          read your connected-service data, except with your permission, for
          security, or when required by law.
        </p>
        <p>
          Scope&apos;s use and transfer of information received from Google APIs
          adheres to the{" "}
          <a href="https://developers.google.com/terms/api-services-user-data-policy">
            Google API Services User Data Policy
          </a>
          , including the Limited Use requirements.
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
          Scope sends tool results only to the AI app that made the call, under
          the rules and approvals you set. That app&apos;s own privacy policy
          governs what it does with the results, including sending them to its
          model provider. Approve only calls from apps you trust.
        </p>
        <p>
          Scope uses service providers to host the application (Vercel), manage
          provider credentials (Vercel Connect), store application records
          (Convex), handle sign-in and sign-in email (WorkOS), and deliver push
          notifications (the push service of your browser or device). A
          notification contains the app name, tool and request summary. These
          providers process data only to provide their services. Scope may also
          disclose information when required by law or to protect the service
          and its users. Scope does not sell connected-service data or transfer
          it for advertising.
        </p>
      </>
    ),
  },
  {
    id: "storage-security",
    title: "Storage and security",
    content: (
      <p>
        Vercel Connect stores and refreshes provider credentials. Scope does not
        inspect each token&apos;s permissions. AI apps never receive them. Each
        app signs in separately and can act only through Scope&apos;s tools,
        under its own rules. Scope checks the app, the rule, the approval and
        the account before each call. For tools that forward to a
        provider&apos;s MCP server, Scope sends only the arguments that it
        accepts for that tool. Data is encrypted in transit using HTTPS. No
        security measure is perfect, but we limit access to the systems and data
        required to operate Scope.
      </p>
    ),
  },
  {
    id: "retention-deletion",
    title: "Retention, revocation, and deletion",
    content: (
      <>
        <p>
          Scope retains your account information, connected accounts, apps,
          rules, approval history and Activity while your account is active. A
          longer retention period may be required for security, fraud
          prevention, or law.
        </p>
        <p>
          Revoke stops all calls from one app. End approval stops a timed
          approval. Neither deletes results that an app already received.
          Disconnect asks Vercel Connect to revoke the authorization, deletes
          the connected account from Scope, and ends its approvals. Provider
          credentials may remain valid when the provider does not support
          revocation. You can also revoke Scope in the provider&apos;s account
          settings. To request deletion of your Scope account and associated
          data, email{" "}
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
    <LegalDocument
      title="Privacy policy"
      lede="This policy explains how Scope accesses, uses, stores, shares, retains, and deletes personal information and data from services you connect to Scope."
      effective="Effective October 7, 2026"
      navLabel="Privacy policy sections"
      sections={sections}
    />
  );
}
