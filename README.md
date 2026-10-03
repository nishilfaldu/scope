# Scope

Scope lets people approve account access requested by their agents. Existing Scope sign-in remains the owner identity. WorkOS authorizes incoming MCP clients; Vercel Connect manages provider authorizations.

## Architecture

`/api/mcp` exposes `list_accounts`, `list_collectors`, `request_access`, and `get_request_status`. Hosted tool results contain approval state and links. A native requester chooses an owned, active local helper to collect access privately; it cannot collect provider credentials itself.

Each approval freezes one account authorization, grant/profile version, requester, collector, intent, display snapshot, and thirty-minute deadline. The private helper calls `/api/agent/deliver`; every permitted attempt freshly resolves and verifies the provider credential, then rechecks authority in a Convex transaction after provider IO. Token bytes may change on retry. Provider tokens, refresh tokens, ciphertext and replay leases are absent from the database. See [credential flows](docs/credential-flows.md).

Six product tables hold accounts, temporary connection attempts, client connections, approval requests, push subscriptions, and durable notification jobs. Scope authentication tables are unchanged. Owner views preserve the paper/green design, sidebar navigation, notification illustration and request timelines.

## Development

```sh
pnpm install
pnpm dev
```

Use [localhost:3000](http://localhost:3000). Read `AGENTS.md`, installed Next.js guides, and Convex guidelines before editing. The branch preview uses the development backend at [scope-preview.vercel.app](https://scope-preview.vercel.app). Production service calls are disabled.

Owner authentication uses existing Convex email sign-in configuration. Frontend configuration includes `NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_CONVEX_SITE_URL`, `SCOPE_ORIGIN`, `SCOPE_SERVICE_SECRET`, `WORKOS_ISSUER`, and `WORKOS_API_KEY`. Convex uses the matching `SCOPE_SERVICE_SECRET`, the registered public `SCOPE_HELPER_CLIENT_ID`, and push keys `SCOPE_VAPID_PUBLIC_KEY`/`SCOPE_VAPID_PRIVATE_KEY`; the browser uses `NEXT_PUBLIC_VAPID_PUBLIC_KEY`. Never commit secrets.

Integrations are static entries in `lib/providers.ts`, each with an explicit connector, API origin, fixed minimal access profile and readiness gate. `SCOPE_AIRTABLE_REST_CONNECTOR` and `SCOPE_SLACK_CONNECTOR` must refer to separate nonproduction connectors. **Both integrations remain disabled pending live OAuth acceptance.** The previous Airtable connector targets MCP and cannot be used for this REST helper. The current Connect catalog offers Airtable MCP OAuth or API PAT; custom REST OAuth requires a separately registered Airtable OAuth client. There is no PAT fallback.

## Local helper

Install its declared dependencies in `plugins/scope-local` when distributing the plugin. Its SDK stdio server exposes account/collector listing and two fixed reads: `airtable_list_bases` and `slack_list_channels`. It supports either a stable request key or a designated hosted request ID. Hosted requests must use the corresponding exact intent: `List the available Airtable bases` or `List public Slack channels`.

Create `~/.config/scope/config.json` (directory mode 0700, file mode 0600, owned by you) containing only the initial `origin`, HTTPS WorkOS `issuer`, and registered public `clientId`. The exact protected resource is `<origin>/api/mcp`, and the registered callback is `http://127.0.0.1:47831/callback`.

```sh
node plugins/scope-local/login.mjs
node plugins/scope-local/server.mjs
```

The SDK handles discovery, PKCE and `offline_access` refresh. The adapter saves issuer/client/resource-bound OAuth sessions atomically and serializes refresh across processes. Provider credentials remain memory-only, are sent to fixed REST destinations, and never enter tool output. Only safe reads retry once after provider 401; no arbitrary shell execution or ambiguous write replay exists.

## Validation and live readiness

```sh
pnpm test
pnpm lint
pnpm exec tsc --noEmit
pnpm build
node --test prototypes/mcp.check.mjs
```

Mocked tests cover owner isolation, requester/collector separation, grant/profile fencing, in-flight cancellation, callback proofs/retries, fresh SDK resolution, exact scopes/identity, private refresh persistence, push retries and UI states. The stdio check exercises long waits, caller cancellation and stable-key retry.

Live acceptance still requires disposable Airtable identities A/B, two distinct selected base grants under one identity, Slack workspace consent, provider rotation/expiry, resource/scope denial, interruption/reconnect races, observed revocation limits, native requester/helper delivery and a physical phone push test. Historical PAT screenshots are not proof of the new OAuth flow. Superseded authorization cleanup can retry only within its original ten-minute connection window; previously received access may remain active.
