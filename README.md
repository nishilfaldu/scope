# Scope

Scope is an access inbox for WorkOS-authorized MCP connections. Owners review each Airtable account request, name their connections, manage provider accounts, and optionally enable push notifications.

## Current architecture

MCP at `/api/probe/mcp` accepts signed WorkOS resource tokens only. Signature, issuer, audience, expiry, client, consent and linked Scope ownership are checked before requests. The former direct agent invitations, secrets, claims, acknowledgments and slices are retired. Old approvals remain attached to their retired recipients; signing in through MCP cannot inherit them.

Each request selects one verified account and a stable retry key. The owner approves or denies in `/approvals`. Approval permits delivery within a fixed sharing window. An acquisition lease, encrypted replay, authenticated receipt, and live account/recipient checks protect retries. Provider credentials stay inside the private local helper and never enter MCP content, the chat, or owner views. See [credential flows](docs/credential-flows.md).

Account sign-in creates a temporary browser-bound attempt. Only successful provider verification adds an account. Failed or cancelled sign-in adds nothing. The two configured Airtable read-only bindings remain isolated by owner, connector, provider identity and exact base. Connection names and request intent are display information, never authority.

Stopping an account, connection or request blocks future sharing. Access already received may remain active at the provider. A receipt confirms access delivery, not completed work.

Slack sign-in and account management remain available through Vercel Connect. Slack sharing through MCP requires a separate provider tool and is explicitly shown as unavailable. Airtable OAuth needs a correctly configured upstream connector; it has no fallback to an unverified account.

## Development

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). Read `AGENTS.md`, installed Next.js guides, and `convex/_generated/ai/guidelines.md` before edits. Never use production deployment settings for preview work.

The current branch preview is [scope-preview.vercel.app](https://scope-preview.vercel.app), using the development backend. `/design-review` redirects to the real inbox. `/lab` remains a redirect for existing WorkOS callbacks and notification links.

## Configuration

Configure the existing Convex email sign-in (`RESEND_API_KEY`, optional `RESEND_FROM`, and `BOARD_ORIGIN`) and frontend Convex URL. Configure WorkOS issuer, API key, public client and protected resource for the intended frontend origin. The local helper uses PKCE login in `plugins/scope-local/login.mjs`, keeps its WorkOS token in a private file, and requires a fresh sign-in when that token expires. Old direct credentials are rejected.

The Airtable bridge uses `SCOPE_PROBE_SECRET`, a stable base64 32-byte `SCOPE_PROBE_TOKEN_KEY`, `SCOPE_PROBE_ORIGIN`, and the configured Connect connector. Read-only bindings additionally require the pinned `SCOPE_PAT_TEST_OWNER_ID`. Keep secrets in environment/private config files. The bridge is disabled when `VERCEL_ENV=production`.

Slack uses the existing managed connector and bridge: frontend `CONNECT_SLACK_CONNECTOR`, `CONNECT_BRIDGE_SECRET`, `SCOPE_CONVEX_SITE_URL`, `SCOPE_BOARD_ORIGIN`; Convex `CONNECT_BRIDGE_URL`, matching bridge secret, and `BOARD_ORIGIN`. Browser-bound one-use tickets and exact installation/provider checks protect OAuth completion. `GET /api/health` reports configuration without revealing secrets.

## Validation

```bash
pnpm test
pnpm lint
pnpm exec tsc --noEmit
pnpm build
node --test prototypes/helper.check.mjs prototypes/mcp.check.mjs
```

Tests cover authorization and account isolation, retry/receipt/cancellation races, provider verification, OAuth callback proof, push retries, and truthful request states. Browser viewport checks complement these; they do not replace physical iPhone installation and push-delivery testing.
