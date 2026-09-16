# Agent Passport

Agent Passport gives agents short-lived access without giving them a user's real credentials.

The system has two layers:

1. A **passport** belongs to the user. It is the long-lived vault that holds the user's connected services and their real upstream tokens.
2. A **slice** belongs to one agent. It is a scoped, expiring grant created from one passport.

Connect once, give many agents access. A user can connect GitHub, Google, or Slack once, then give each agent its own slice of that access.

## Architecture

```mermaid
flowchart TB
  User([Signed-in user]) --> Board[Web board]
  Board --> Passport[Passport vault]

  Passport --> Connections[Connections\nencrypted upstream OAuth tokens]
  Passport --> Grants[Grants\napproved apps + expiry]
  Grants --> Slices[Slices\nper-agent token + secret\nmintPolicy: auto | approve]

  Agent([Agent]) --> SiteAPI["Agent API (.convex.site)"]
  SiteAPI -->|"POST /api/credentials"| Slices

  Slices -->|mintPolicy auto| Mint[Short-lived mint\nprovider-native access token]
  Slices -->|mintPolicy approve| Inbox[Approvals inbox]
  Inbox -->|Approve| Claim["POST /api/credentials/claim"]
  Claim --> Mint

  Connections -.->|refresh stays in vault\nno standing handoff| Mint
  Mint --> Providers[Upstream providers\nGitHub · Google · Slack · …]
  Agent --> Providers
```

*User signs in on the board, connects providers into the passport vault, and creates per-agent slices from grants. Agents call the `.convex.site` API with slice credentials; Agent Passport mints a short-lived provider token (auto, or after board approval) and never hands out vault standing access or refresh tokens. Agents then call providers directly.*

## Passport

A passport is owned by a user and stays inside Agent Passport. It holds:

- the user's identity
- connected services
- upstream OAuth access and refresh tokens
- every slice created from the passport
- grant and audit history

The passport does not have an external key and secret. Nothing outside the backend authenticates as the passport.

The user reaches it through their signed-in dashboard session. The backend uses its upstream OAuth tokens to talk to GitHub, Slack, Google, and other services.

A user can have more than one passport when they need separation, such as work and personal accounts.

## Slice

A slice is created for one agent and one grant. It contains:

- a slice token and slice secret
- the passport and user it belongs to
- the agent it was created for
- allowed services and actions
- an expiry
- revocation state
- a **mint policy** (`auto` or `approve`, default `auto`)

A slice never contains an upstream OAuth token or a copy of the grant's apps. It points to the grant, which remains the single source of truth for allowed apps, so grant changes apply to live slices immediately.

When an agent calls the API, Agent Passport finds the slice and checks that it is valid, not expired, not revoked, and allowed to perform the requested action. The agent gets exactly the power in that grant and nothing else from the user's account.

Every agent gets its own slice. Two agents never share one. That keeps revocation and audit history specific to one agent. Revoke one slice and that agent becomes a stranger while the user's passport, connected services, and other agents keep working.

## Connect flow

The user connects a service from the dashboard:

1. The signed-in user clicks Connect for GitHub, Slack, Google, or another service.
2. Agent Passport creates a one-time OAuth state value bound to the signed-in user, their passport, the service, and a short expiry.
3. Agent Passport sends the user to the provider's official OAuth consent screen.
4. The provider returns an authorization code and the same state value.
5. Agent Passport verifies the state before exchanging the code.
6. The upstream access and refresh tokens are encrypted and stored on the user's passport.
7. Slices can use that connection without making the user connect the service again.

There are two different consent screens:

- The provider screen grants Agent Passport the upstream connection.
- The Agent Passport board Approvals inbox grants one agent a short-lived credential when the slice uses mint policy `approve`.

The upstream service does not need to know which agent holds the slice.

## Giving an agent access

Onboarding is one sentence: give the agent the Convex `.convex.site` API origin plus the slice token and slice secret from the board.

### Auto mint (default)

1. Create a slice on the board with mint policy **Auto** (the default).
2. The agent calls `POST /api/credentials` with `sliceToken`, `sliceSecret`, and `app`.
3. On success it receives a **provider-native short-lived access token** — never the vault's standing upstream access or refresh token.

### Approve-gated mint (board inbox)

Stripe Link–style operator approval on the web board only (no phone, pairing, or push):

1. Create a slice with mint policy **Approve** (or switch an active slice to Approve on the detail page).
2. The agent calls `POST /api/credentials` as usual.
3. Instead of a token, it receives **202** with `code: "APPROVAL_REQUIRED"`, a `requestId`, and a pending `expiresAt` (~5 minutes).
4. The request appears in the board **Approvals** inbox (sidebar badge). The operator clicks **Approve** or **Deny**.
5. The agent polls `POST /api/credentials/claim` with `sliceToken`, `sliceSecret`, and `requestId`.
   - Still pending → **202** `APPROVAL_REQUIRED`
   - Denied → **403** `APPROVAL_DENIED`
   - Expired (pending TTL or post-approve claim window) → **403** `APPROVAL_EXPIRED`
   - Approved → Agent Passport **mints a provider-native short-lived access token at claim time** (not at approve) and returns **200** once. The claim window is ~60 seconds and single-use.
6. Claim and auto mint both refuse vault standing-token handoff. Agents never receive `connection.accessToken` or `connection.refreshToken`. Refresh secrets stay encrypted in the vault; only a freshly minted access token is returned. If the provider cannot mint (standing-only grant, missing refresh), the API hard-fails with **503** `SHORT_LIVED_UNAVAILABLE`.

There are no plaintext or API compatibility shims beyond the default `auto` policy for existing slices. Callers that previously relied on receiving the standing upstream token will break — by design, pre-launch.

### Short-lived mint per provider

| Provider | Agent mint behavior | Notes |
| --- | --- | --- |
| **Google** | Mint via `refresh_token` → new short-lived access | Requires offline refresh from connect (`access_type=offline`). No refresh → hard-fail. |
| **Airtable** | Mint via refresh → short-lived access | No refresh → hard-fail. |
| **Linear** | Mint via refresh → short-lived access | No refresh → hard-fail. |
| **Vercel** | Mint via refresh → short-lived access | Needs `offline_access` on connect. No refresh → hard-fail. |
| **Zoom** | Mint via refresh → short-lived access | No refresh → hard-fail. |
| **Slack** | Mint via token-rotation refresh → new access | Standing `xoxp` without rotation → hard-fail. |
| **Notion** | Mint via refresh → new access | Legacy non-expiring tokens without refresh → hard-fail. |
| **GitHub** | Mint via GitHub App user-token refresh → new access | Classic OAuth / standing-only user tokens (no refresh) → **hard-fail**. Use a GitHub App (`Iv…` client) that issues refreshable user access tokens. |

There is **no** request proxy. Agents call providers directly with the minted Bearer.

## Expiry and renewal

A slice stops working at its expiry.

The agent cannot extend it. It can only request renewal. Renewal goes back through user approval and starts with the same services, actions, and duration as the previous grant. The user can change any of them before approving.

There are two paths:

- **same-policy renewal:** approve the existing scope for another period
- **changed renewal:** approve a different scope or duration, which creates a new grant

Per-user defaults can control renewal behavior, including always asking before any renewal.

## What an agent can never do

Agents spend power. Users grant power. An agent cannot:

1. renew or extend its own slice
2. add services, actions, or time to its own slice
3. create slices for other agents
4. view, revoke, or change another agent's slice
5. read an upstream OAuth access or refresh token (including the vault standing token)
6. connect or disconnect a service on the user's passport
7. change grant defaults or expiry policy
8. change the user's sign-in methods or authentication factors
9. approve its own request
10. read passports or slices owned by another user

These limits come from the data model and API boundaries, not from instructions given to the agent.

## Run it

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). Convex HTTP routes live on the deployment's `.convex.site` origin.

## Deploy

Set OAuth client IDs and secrets on the Convex deployment. Set `BOARD_ORIGIN` to the board's origin, such as `http://localhost:3000` in development, so OAuth can return there.

All connection secrets (upstream OAuth access and refresh tokens) are stored encrypted at rest with AES-256-GCM using `TOKEN_ENCRYPTION_KEY` in Convex env. Generate a base64-encoded 32-byte key and set it before connecting services:

```bash
openssl rand -base64 32
npx convex env set TOKEN_ENCRYPTION_KEY <base64-32-byte-key>
```

Keep the same key across deploys. Rotating it without re-saving connections will break decryption of existing ciphertext. If anything was stored before encryption was enabled, reconnect those providers so tokens are stored as `enc:v1:` ciphertext.

`GET /api/health` reports which OAuth providers have both a non-empty client ID and secret. It does not return the values.

If schema deploy fails because `tokenLogs` still has rows, delete those documents in the Convex dashboard, then deploy again. Do not add a wipe mutation.

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

1. Open [My integrations](https://www.notion.so/profile/integrations) and create a new public integration for Agent Passport.
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
3. Add the smallest scopes required by the product, including `user:read:user` so Agent Passport can identify the connection. Zoom issues refresh tokens with the authorization-code grant.
4. Set the confidential client credentials and deploy:

   ```bash
   npx convex env set ZOOM_CLIENT_ID <client-id>
   npx convex env set ZOOM_CLIENT_SECRET <client-secret>
   npx convex deploy
   ```

5. Connect Zoom from `/connections`. Disconnecting revokes the current access token through Zoom's OAuth revoke endpoint.

Official references: [Zoom OAuth](https://developers.zoom.us/docs/integrations/oauth/) and [Zoom API reference](https://developers.zoom.us/docs/api/).
