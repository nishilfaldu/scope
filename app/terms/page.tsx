import type { Metadata } from "next";
import type { ReactNode } from "react";

import { LegalDocument } from "@/components/public/legal-document";

export const metadata: Metadata = {
  title: "Terms of service · Scope",
  description: "Terms governing access to and use of Scope.",
};

type TermsSection = { id: string; title: string; content: ReactNode };

const sections: TermsSection[] = [
  {
    id: "using-scope",
    title: "Using Scope",
    content: (
      <p>
        Scope is an MCP server that lets AI apps you choose use your connected
        accounts under rules you set. You must provide accurate account
        information, keep your sign-in email secure, and use Scope only in
        compliance with applicable laws and these terms. You must be old enough
        and authorized to accept these terms for yourself or the organization
        you represent.
      </p>
    ),
  },
  {
    id: "connections",
    title: "Connected services",
    content: (
      <>
        <p>
          Scope connects GitHub, Notion, Google (Gmail and Google Calendar) and
          Vercel accounts through Vercel Connect. Your use of a connected
          service remains subject to that provider&apos;s terms and policies.
          Scope is not operated by or endorsed by those providers.
        </p>
        <p>
          You may connect only accounts you are authorized to use. You review
          the permissions for a connection on the provider&apos;s consent
          screen. Every token includes all permissions granted when you
          connected the account. The stated purpose does not restrict the token.
          Disconnect asks Vercel Connect to revoke the authorization and ends
          active approvals for that account. If a provider cannot revoke the
          credential, it may remain valid until it expires. You can also revoke
          Scope in the provider&apos;s account settings.
        </p>
      </>
    ),
  },
  {
    id: "apps-approvals",
    title: "AI apps, rules and approvals",
    content: (
      <>
        <p>
          AI apps that connect to Scope are operated by you or by third parties
          you choose. Scope does not verify an app&apos;s instructions or
          fitness for a task. App names come from the app and are display text.
          For each app and tool, you choose Allow, Ask me or Block. By default,
          tools that only read run without asking, and other tools ask you
          first.
        </p>
        <p>
          When a tool asks, Scope shows a summary of the request. Scope builds
          the summary from the request and from details it looks up from the
          provider, such as a channel name or page title. Review it before you
          approve. &quot;This call only&quot; covers one call with the same
          arguments for 10 minutes. A timed approval lets that app use that tool
          with any arguments for 15 minutes, 30 minutes or 1 hour. End approval
          stops a timed approval. Revoke stops all calls from one app. Neither
          takes back results that the app already received.
        </p>
        <p>
          Scope returns tool results to the app that made the call. What the app
          does with them is governed by that app&apos;s own terms. You are
          responsible for the rules you set and the approvals you grant.
        </p>
      </>
    ),
  },
  {
    id: "acceptable-use",
    title: "Acceptable use",
    content: (
      <p>
        You may not use Scope to access accounts without authorization, violate
        another person&apos;s rights, distribute malware, interfere with the
        service, evade access controls, probe for vulnerabilities without
        permission, or conduct unlawful, deceptive, or abusive activity. We may
        suspend access needed to protect Scope, its users, or connected
        providers.
      </p>
    ),
  },
  {
    id: "availability",
    title: "Availability and changes",
    content: (
      <p>
        Scope is a pre-release service and may change, experience interruptions,
        or stop supporting a provider, tool or feature. Connected providers may
        also change or revoke their APIs, MCP servers and credentials. We may
        update the service and these terms; continued use after updated terms
        take effect means you accept them.
      </p>
    ),
  },
  {
    id: "warranty-liability",
    title: "Warranty and liability",
    content: (
      <>
        <p>
          Scope is provided on an &quot;as is&quot; and &quot;as available&quot;
          basis without warranties of uninterrupted operation, fitness for a
          particular purpose, or compatibility with every AI app or provider.
        </p>
        <p>
          To the extent permitted by law, the developer of Scope will not be
          liable for indirect, incidental, special, consequential, or punitive
          damages, or for loss of data, access, revenue, or opportunity arising
          from use of Scope or of an AI app you connect to it.
        </p>
      </>
    ),
  },
  {
    id: "ending-use",
    title: "Ending use",
    content: (
      <p>
        You may stop using Scope at any time, revoke apps, disconnect provider
        accounts, and end active approvals. To request deletion of your Scope
        account, email{" "}
        <a href="mailto:nishilfaldu@gmail.com">nishilfaldu@gmail.com</a>. We may
        suspend or terminate access for a material breach of these terms or when
        needed to protect the service.
      </p>
    ),
  },
  {
    id: "contact",
    title: "Contact",
    content: (
      <p>
        Questions about these terms can be sent to the developer responsible for
        Scope at{" "}
        <a href="mailto:nishilfaldu@gmail.com">nishilfaldu@gmail.com</a>.
      </p>
    ),
  },
];

export default function TermsPage() {
  return (
    <LegalDocument
      title="Terms of service"
      lede="These terms govern your access to and use of Scope, including provider connections, the AI apps you connect, and the rules and approvals you set."
      effective="Effective October 7, 2026"
      navLabel="Terms of service sections"
      sections={sections}
    />
  );
}
