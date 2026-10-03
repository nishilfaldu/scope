# Scope

Scope connects Slack accounts through Vercel Connect and lets an operator approve time-limited agent access to selected accounts.

## How it works

- A **connection** stores a Slack workspace/user identity and a Vercel Connect reference. Scope stores no Slack access or refresh tokens. One user can connect multiple Slack accounts.
- A **slice** belongs to a user and stable agent lineage, has a token and secret, an expiry, a revocation state, and an `auto` or `approve` mint policy.
- An **agent connection** is an operator-approved relationship with an opaque ID and secret. It identifies the Scope account that later slice requests must address. Revoking it blocks new requests and every slice created through it.
- Each allowed account has one indexed **slice binding** that selects a connection. A slice can allow several accounts for the same app. Bindings are separate rows; the slice does not store an array of apps or accounts.
- An agent presents its slice token and secret to `POST /api/credentials`. If several Slack accounts are allowed, it selects a `bindingId` from `GET /api/accounts?app=slack`. Scope requests a fresh rotating Slack user token through Connect. Under `approve`, the operator first approves a one-time mint request for that account.

**Revocation boundary:** Revoking an agent, revoking a slice, or disconnecting an account blocks future mints. An issued Slack bearer token can remain usable until Slack expires or revokes it. Scope reports the actual provider expiry and rejects standing tokens, bot tokens, unexpected scopes, and mismatched account references.

## Agent approval

An agent first calls `POST /api/agent-connections`, sends only the returned `connectUrl` to the operator, and keeps the private claim handle. The operator verifies their email in Scope and explicitly connects the agent. The agent claims a stable agent ID plus an opaque connection ID and secret, stores them, and acknowledges delivery with `POST /api/agent-connections/ack` using `claimHandle` and `agentConnectionSecret`. A lost claim response can be retried until two minutes after the first claim. New connections cannot request access before acknowledgment; unacknowledged connections are retired at that fixed deadline. The pairing name is requester supplied and is not a verified identity.

For planned rotation, the agent calls the same endpoint with its active connection ID and secret in the connection headers. The link is bound to the original Scope account. Approval stages replacement credentials while the current connection remains active. The agent may retry the claim until it receives those credentials, then proves possession through `POST /api/agent-connections/activate`. Activation atomically swaps the active credential generation and revokes the previous one; slices and slice requests remain attached to the stable agent lineage. Retrying activation is safe.

If an agent loses its credentials, it creates an ordinary connection link. The operator may explicitly replace one of their active agents and preserve that agent's grants. A deliberately revoked connection cannot rotate or be selected for reconnection; it must connect as new and request new grants.

Every later `POST /api/access-requests` includes that connection ID and secret in `x-agent-connection-id` and `x-agent-connection-secret`. The backend derives the owner from the connection before issuing the request link. The operator reviews requested apps and permissions, chooses connected accounts, and explicitly approves or denies. OTP verification only creates a session. If an account is missing, the operator adds it in `/connections` and returns to the request.

For an existing slice with approval policy, `POST /api/credentials` returns a `/requests/token/[token]` link. The decision screen shows the slice, app, and specific connected account. Only the slice owner's Scope user ID can read or decide it. A connected provider login is never used to establish ownership. Approval permits one short-lived credential claim through the existing private agent claim path; the browser never receives provider tokens or slice secrets.

Scope sign-in uses email codes, independently of Slack. Codes are 128-bit random values, expire in 10 minutes, and are single use.

Use a random, task-stable `Idempotency-Key` header (32–128 characters) when creating an access request. The same key and payload return the same pending or approved request and private handle before it is claimed. A different payload with that key returns `IDEMPOTENCY_CONFLICT`. Treat this key as a secret because a caller holding it can recover the claim handle while the request is live. Agent errors include stable `code`, `retryable`, and `nextAction` fields. A denied or expired request needs a fresh task and key. An approved slice can first be claimed for five minutes after approval. The first claim starts a fixed two-minute acknowledgment window; retries do not extend it. A completed acknowledgment can be confirmed later through the ack endpoint or status.

## Connect and account selection

Slack authorization and refresh are managed by Vercel Connect. The signed-in operator connects from `/connections`; accounts are keyed by Scope user and Slack workspace/user ID. Display names never authorize access. Each slice binds one or more selected accounts, with ownership and grant-version checks before credential delivery.

## Slack Connect setup

Create a managed Slack connector in Vercel and link it to the intended project environments. Configure `CONNECT_SLACK_CONNECTOR`, `CONNECT_BRIDGE_SECRET`, `SCOPE_CONVEX_SITE_URL`, and `SCOPE_BOARD_ORIGIN` on the Next.js deployment. The bridge uses the project's Vercel OIDC identity. Configure `CONNECT_BRIDGE_URL` and the same `CONNECT_BRIDGE_SECRET` on Convex, plus `BOARD_ORIGIN` for the frontend. A protected preview can additionally use the temporary `CONNECT_BRIDGE_PROTECTION_COOKIE`.

The bridge resolves a short-lived, one-use Convex ticket before authorizing, minting, or revoking an account. Managed Slack consent requests only the supported user permissions in `convex/connect/contracts.ts`; Slack's implicit `identify` scope is accepted. There is no legacy OAuth fallback.

An agent may reduce its own authority without operator approval. Connection credentials authorize `POST /api/agent-connections/revoke`; slice credentials authorize `POST /api/slices/revoke`. Private request credentials authorize cancellation through `/api/agent-connections/cancel`, `/api/access-requests/cancel`, and `/api/credentials/cancel`. Revocation and cancellation never expand access. Request fields are immutable after a link is created.

A failed Connect request leaves an approved mint request available to retry until its claim window expires. Local revocation and account changes are checked again after the bridge responds.

`GET /` on the Convex HTTP origin provides route discovery and a complete polling, claim, and acknowledgment guide. A running or resumable agent must do the polling; Scope does not wake it. All deadline fields and `serverTime` are Unix milliseconds. `status` remains inspectable after denial or timeout, while a wrong private handle returns 401. `GET /` also lists routes. `GET /api/apps` reports app availability for a slice. Its `connected` flag means at least one account allowed by the slice is still connected; unbound apps report `false`. `GET /api/accounts?app=<app>` returns each available account's display login and opaque `bindingId`. If an account is removed from the slice while a mint is pending, that mint can no longer be claimed.

## Run it

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). Convex HTTP routes live on the deployment's `.convex.site` origin.

## Deploy

Set `BOARD_ORIGIN` to the frontend origin and configure the Connect bridge above. Set `RESEND_API_KEY` and verify the sending domain in Resend. OTP mail defaults to `Scope <login@nishilfaldu.site>`; `RESEND_FROM` overrides the sender.

`TOKEN_ENCRYPTION_KEY` is a base64-encoded 32-byte AES-256 key used to encrypt recoverable agent and slice claim secrets. Keep the key stable across deployments so outstanding handoffs remain readable. Slack tokens are managed by Connect and are never stored in Scope.

`GET /api/health` reports whether the Slack bridge is configured, without returning secrets or verifying external availability.

## Test

```bash
pnpm test
```
