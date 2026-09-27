# Scope

Scope lets a user connect OAuth accounts and give an agent a slice that can request provider credentials for selected apps.

## How it works

- A **connection** stores one provider account's encrypted OAuth tokens. Google has separate Gmail, Calendar, Drive, Docs, and Sheets connections, each with its own consent scopes and callback. One user can connect multiple accounts to the same app.
- A **slice** belongs to a user and stable agent lineage, has a token and secret, an expiry, a revocation state, and an `auto` or `approve` mint policy.
- An **agent connection** is an operator-approved relationship with an opaque ID and secret. It identifies the Scope account that later slice requests must address. Revoking it blocks new requests and every slice created through it.
- Each allowed account has one indexed **slice binding** that selects a connection. A slice can allow several accounts for the same app. Bindings are separate rows; the slice does not store an array of apps or accounts.
- An agent presents its slice token and secret to `POST /api/credentials`. When several accounts are allowed for an app, it chooses a `bindingId` from `GET /api/accounts?app=<app>`. Drive, Docs, and Sheets return an opaque `brokerToken` for `/api/google/operations`; their Google bearer tokens never leave Scope. Other apps return provider access tokens. Under `approve`, the operator first approves a one-time mint request for that account.

**Revocation boundary:** Revoking an agent connection, revoking a slice, or disconnecting an account blocks future mints and future Drive, Docs, and Sheets broker operations. Other apps still return provider-native access tokens, which remain usable until their provider expires or revokes them. Their credential response reports the provider's expiry, or `null` if the provider did not give one.

The vault never hands out its stored access token or refresh token. Providers without a refresh-capable grant cannot mint agent credentials and return `SHORT_LIVED_UNAVAILABLE`.

## Agent approval

An agent first calls `POST /api/agent-connections`, sends only the returned `connectUrl` to the operator, and keeps the private claim handle. The operator verifies their email in Scope and explicitly connects the agent. The agent claims a stable agent ID plus an opaque connection ID and secret, stores them, and acknowledges delivery with `POST /api/agent-connections/ack` using `claimHandle` and `agentConnectionSecret`. A lost claim response can be retried until two minutes after the first claim. New connections cannot request access before acknowledgment; unacknowledged connections are retired at that fixed deadline. The pairing name is requester supplied and is not a verified identity.

For planned rotation, the agent calls the same endpoint with its active connection ID and secret in the connection headers. The link is bound to the original Scope account. Approval stages replacement credentials while the current connection remains active. The agent may retry the claim until it receives those credentials, then proves possession through `POST /api/agent-connections/activate`. Activation atomically swaps the active credential generation and revokes the previous one; slices and slice requests remain attached to the stable agent lineage. Retrying activation is safe.

If an agent loses its credentials, it creates an ordinary connection link. The operator may explicitly replace one of their active agents and preserve that agent's grants. A deliberately revoked connection cannot rotate or be selected for reconnection; it must connect as new and request new grants.

Every later `POST /api/access-requests` includes that connection ID and secret in `x-agent-connection-id` and `x-agent-connection-secret`. The backend derives the owner from the connection before issuing the request link. The operator reviews requested apps and permissions, chooses connected accounts, and explicitly approves or denies. OTP verification only creates a session. If an account is missing, the operator adds it in `/connections` and returns to the request.

For an existing slice with approval policy, `POST /api/credentials` returns a `/requests/token/[token]` link. The decision screen shows the slice, app, and specific connected account. Only the slice owner's Scope user ID can read or decide it. A connected provider login is never used to establish ownership. Approval permits one short-lived credential claim through the existing private agent claim path; the browser never receives provider tokens or slice secrets.

Google OAuth remains available for connecting Gmail, Calendar, Drive, Docs, and Sheets. It is not a Scope sign-in method. Email codes are 128-bit random values, expire in 10 minutes, and are single use. The longer code prevents practical collisions in the auth library's global code lookup.

Use a random, task-stable `Idempotency-Key` header (32–128 characters) when creating an access request. The same key and payload return the same pending or approved request and private handle before it is claimed. A different payload with that key returns `IDEMPOTENCY_CONFLICT`. Treat this key as a secret because a caller holding it can recover the claim handle while the request is live. Agent errors include stable `code`, `retryable`, and `nextAction` fields. A denied or expired request needs a fresh task and key. An approved slice can first be claimed for five minutes after approval. The first claim starts a fixed two-minute acknowledgment window; retries do not extend it. A completed acknowledgment can be confirmed later through the ack endpoint or status.

## Connect and account selection

The signed-in operator connects apps from `/connections`. Each connection is keyed by user, provider, app, and the provider's stable account ID. The display login is never used as an account key. Slice creation and onboarding approval page through apps and account choices, retaining selections across pages. At least one account must be chosen for every selected app; several may be chosen.

The underlying Google Drive grant can authorize Docs and Sheets operations, so Scope keeps the Drive bearer server-side and restricts agents to vetted non-Docs and non-Sheets file operations. The three connections, slice bindings, and broker credentials are independent. Google grants with missing or broader scope metadata must be reconnected. A GitHub App user grant can be bound to one active agent lineage because refreshing its user token invalidates the prior access token.

For Google, register five redirects on the same OAuth client:

- `https://<deployment>.convex.site/api/gmail/callback`
- `https://<deployment>.convex.site/api/calendar/callback`
- `https://<deployment>.convex.site/api/drive/callback`
- `https://<deployment>.convex.site/api/docs/callback`
- `https://<deployment>.convex.site/api/sheets/callback`

Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` once. Disconnect removes local access first. Provider revocation is attempted afterward; for Google it is attempted when the last app connection for that Google account is removed.

## Agent pairing, onboarding, and minting

1. The agent calls `POST /api/agent-connections` with `agentName`, gives the operator the `connectUrl`, and privately retains the `claimHandle`.
2. The agent polls `POST /api/agent-connections/status` with private JSON `{ "claimHandle": "ach_..." }`. After approval, it calls `/api/agent-connections/claim` with that body, stores the returned connection ID and secret, and follows the returned `nextAction`. For a new connection, `POST /api/agent-connections/ack` with JSON `{ "claimHandle": "ach_...", "agentConnectionSecret": "acs_..." }` completes setup. For a replacement, `POST /api/agent-connections/activate` with headers `x-agent-connection-id` and `x-agent-connection-secret` atomically swaps credentials. Both completion requests are idempotent; claim retries remain possible only until completion or its deadline.
3. The agent calls `POST /api/access-requests` with `apps`, `ttlMs`, a requester-supplied `reason`, and the connection credentials in headers. The response contains a chat-safe owner-bound `approvalUrl` and private `claimHandle`.
4. The operator opens the URL, selects one or more accounts for each app, and approves or denies. The agent polls `POST /api/access-requests/status`, claims slice credentials with `POST /api/access-requests/claim`, stores them, then acknowledges with `POST /api/access-requests/ack` using `claimHandle` and `sliceSecret`. The agent can first claim for five minutes after approval. The first claim starts a fixed two-minute acknowledgment window; it retries a lost claim response before that deadline. It retries a lost ack response with the same handle and secret, even after the deadline, to confirm recorded completion. An unacknowledged slice is retired. Its approved lifetime still begins at approval.
5. The agent calls `GET /api/accounts?app=<app>` with `x-slice-token` and `x-slice-secret` to see the accounts allowed for that app. It sends `sliceToken`, `sliceSecret`, `app`, and the chosen `bindingId` to `POST /api/credentials`. With a single allowed account, `bindingId` may be omitted. With several, omitting it returns `ACCOUNT_SELECTION_REQUIRED`. An auto slice mints immediately. An approve slice returns a request ID and approval URL for the exact account; after approval the agent calls `POST /api/credentials/claim`.

### Drive, Docs, and Sheets broker

For these apps, a successful credential response contains `brokerToken`, `tokenType: "ScopeBroker"`, `endpoint: "/api/google/operations"`, `app`, `bindingId`, and an expiry (at most 15 minutes). It has no `accessToken`. The agent sends JSON `{ "brokerToken": "gc_...", "operation": "..." }` to `POST /api/google/operations` on the same Convex HTTP origin. The broker verifies the current slice, agent, binding, connection, and OAuth grant on every call, refreshes a Google token server-side, and checks bounded scopes before calling a fixed Google endpoint. When Google omits `scope` from a refresh response, Scope uses the bounded scopes verified and stored at connection time; an explicit mismatched or broader refresh scope is rejected. The broker rejects redirects, limits requests to 64 KiB and upstream responses to 512 KiB (384 KiB for downloaded file bytes before base64 encoding), and allows 30 operations per slice per minute. Reconnect or disconnect invalidates previously issued broker credentials for that connection.

| App    | Operations                                                                 | Arguments                                                               |
| ------ | -------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Drive  | `drive.list`, `drive.metadata`, `drive.download`                           | `pageSize` (1–100) and `pageToken` for list; `id` for metadata/download |
| Docs   | `docs.get`, `docs.create`, `docs.batchUpdate`                              | `id` for get/update; `payload` for create/update                        |
| Sheets | `sheets.get`, `sheets.create`, `sheets.values.get`, `sheets.values.update` | `id` for get; `range` for values; `payload` for create/update           |

Drive list excludes Google Docs, Google Sheets, and shortcuts. Drive metadata and download reject these types even when the agent knows an ID; download returns `contentBase64` and `mimeType`. Docs and Sheets use only their respective APIs. The broker does not support arbitrary Google URLs, Drive upload, delete, copy, export, permissions, or listing Docs/Sheets by account. Agents needing those operations must use a future vetted broker operation. The broker does not claim parity with Google's APIs.

An agent may reduce its own authority without operator approval. Connection credentials authorize `POST /api/agent-connections/revoke`; slice credentials authorize `POST /api/slices/revoke`. Private request credentials authorize cancellation through `/api/agent-connections/cancel`, `/api/access-requests/cancel`, and `/api/credentials/cancel`. Revocation and cancellation never expand access. Request fields are immutable after a link is created.

A failed provider refresh leaves an approved mint request available to retry until its claim window expires. Drive, Docs, and Sheets verify a bounded fresh Google grant before issuing an opaque broker credential. A later broker operation can still fail if the grant expires or is revoked.

`GET /` on the Convex HTTP origin provides route discovery and a complete polling, claim, and acknowledgment guide. A running or resumable agent must do the polling; Scope does not wake it. All deadline fields and `serverTime` are Unix milliseconds. `status` remains inspectable after denial or timeout, while a wrong private handle returns 401. `GET /` also lists routes. `GET /api/apps` reports app availability for a slice. Its `connected` flag means at least one account allowed by the slice is still connected; unbound apps report `false`. `GET /api/accounts?app=<app>` returns each available account's display login and opaque `bindingId`. If an account is removed from the slice while a mint is pending, that mint can no longer be claimed.

## Run it

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). Convex HTTP routes live on the deployment's `.convex.site` origin.

## Deploy

Set OAuth client IDs and secrets on the Convex deployment. Set `BOARD_ORIGIN` to the board's origin, such as `http://localhost:3000` in development, so OAuth can return there. Set `RESEND_API_KEY` and verify `nishilfaldu.site` in Resend. OTP mail defaults to `Scope <login@nishilfaldu.site>`; set `RESEND_FROM` to override that sender.

All connection secrets (upstream OAuth access and refresh tokens) are stored encrypted at rest with AES-256-GCM using `TOKEN_ENCRYPTION_KEY` in Convex env. Generate a base64-encoded 32-byte key and set it before connecting services:

```bash
openssl rand -base64 32
npx convex env set TOKEN_ENCRYPTION_KEY <base64-32-byte-key>
```

Keep the same key across deploys. Rotating it without re-saving connections will break decryption of existing ciphertext. If anything was stored before encryption was enabled, reconnect those providers so tokens are stored as `enc:v1:` ciphertext.

`GET /api/health` reports which OAuth providers have both a non-empty client ID and secret. It does not return the values.

## Test

```bash
pnpm test
```

### Airtable OAuth setup

1. Create an OAuth integration at [Airtable's integration management page](https://airtable.com/create/oauth).
2. Register `https://<deployment>.convex.site/api/airtable/callback` as its redirect URI.
3. Select `data.records:read`, `data.records:write`, `schema.bases:read`, `schema.bases:write`, and `user.email:read`. Add the required support email, privacy policy, and terms URLs.
4. Set the confidential client credentials and deploy:

   ```bash
   npx convex env set AIRTABLE_CLIENT_ID <client-id>
   npx convex env set AIRTABLE_CLIENT_SECRET <client-secret>
   npx convex deploy
   ```

5. Connect Airtable from `/connections`. The user chooses which bases and workspaces the token may access.

Official references: [Airtable OAuth](https://airtable.com/developers/web/api/oauth-reference) and [token identity](https://airtable.com/developers/web/api/get-user-id-scopes).

### Notion OAuth setup

Notion support uses a public OAuth connection. Until the app is registered, the Notion tile is present but connect returns a configuration error.

1. Open [My integrations](https://www.notion.so/profile/integrations) and create a new public integration for Scope.
2. Enable the content capabilities agents should receive; users select shared pages and databases on Notion's consent screen.
3. Register `https://<deployment>.convex.site/api/notion/callback`.
4. Set `NOTION_CLIENT_ID` and `NOTION_CLIENT_SECRET` on the Convex deployment, deploy, then connect from `/connections`.

Notion references: [Authorization](https://developers.notion.com/guides/get-started/authorization), [token exchange](https://developers.notion.com/reference/create-a-token), [refresh](https://developers.notion.com/reference/refresh-a-token), and [revoke](https://developers.notion.com/reference/revoke-token).

### Linear OAuth setup

Create an OAuth application in Linear settings, register `https://<deployment>.convex.site/api/linear/callback`, set `LINEAR_CLIENT_ID` and `LINEAR_CLIENT_SECRET` on the Convex deployment, deploy, then connect from `/connections`.

### Vercel OAuth setup

Create a Sign in with Vercel application, register `https://<deployment>.convex.site/api/vercel/callback`, enable the required OpenID scopes, and set `VERCEL_CLIENT_ID` and `VERCEL_CLIENT_SECRET` on the Convex deployment. Deploy, then connect from `/connections`.

### Zoom OAuth setup

1. Create a user-managed OAuth app in the [Zoom App Marketplace](https://marketplace.zoom.us/develop/create).
2. Register `https://<deployment>.convex.site/api/zoom/callback` as both the redirect URL and the allow-list URL.
3. Add the smallest scopes required by the product, including `user:read:user` so Scope can identify the connection. Zoom issues refresh tokens with the authorization-code grant.
4. Set the confidential client credentials and deploy:

   ```bash
   npx convex env set ZOOM_CLIENT_ID <client-id>
   npx convex env set ZOOM_CLIENT_SECRET <client-secret>
   npx convex deploy
   ```

5. Connect Zoom from `/connections`. Disconnecting revokes the current access token through Zoom's OAuth revoke endpoint.

Official references: [Zoom OAuth](https://developers.zoom.us/docs/integrations/oauth/) and [Zoom API reference](https://developers.zoom.us/docs/api/).
