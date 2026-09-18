# Agent Passport

Agent Passport lets a user connect OAuth accounts and give an agent a slice that can request provider credentials for selected apps.

## How it works

- A **connection** stores one provider account's encrypted OAuth tokens. Google has separate Gmail, Calendar, Drive, Docs, and Sheets connections, each with its own consent scopes and callback. One user can connect multiple accounts to the same app.
- A **slice** belongs to a user, has a token and secret, an expiry, a revocation state, and an `auto` or `approve` mint policy.
- Each allowed account has one indexed **slice binding** that selects a connection. A slice can allow several accounts for the same app. Bindings are separate rows; the slice does not store an array of apps or accounts.
- An agent presents its slice token and secret to `POST /api/credentials`. When several accounts are allowed for an app, it chooses a `bindingId` from `GET /api/accounts?app=<app>`. The backend checks that exact binding, refreshes its provider connection, checks permissions again, then returns the newly issued provider access token. Under `approve`, the operator first approves a one-time mint request for that account.

**Revocation boundary:** Revoking a slice or disconnecting an account immediately blocks _future_ credential mints. An already issued provider-native access token remains usable until that provider expires or revokes it. Agent Passport does not proxy provider requests and cannot shorten an upstream token's lifetime. The credential response reports the provider's expiry, or `null` if the provider did not give one.

The vault never hands out its stored access token or refresh token. Providers without a refresh-capable grant cannot mint agent credentials and return `SHORT_LIVED_UNAVAILABLE`.

## Agent approval

An agent calls `POST /api/access-requests`, sends only the returned `approvalUrl` to the operator, and stores its private `claimHandle` in its own runtime. The link opens `/requests/new/[token]`. The operator verifies an Agent Passport email with an eight digit code, reviews requested apps and permissions, chooses connected accounts, and explicitly approves or denies. Verification only creates a session. If an account is missing, the operator adds it in `/connections` and returns to the request. Agent names and reasons are supplied by the requester and are not verified identities.

For an existing slice with approval policy, `POST /api/credentials` returns a `/requests/token/[token]` link. The decision screen shows the slice, app, and specific connected account. Only the slice owner's Agent Passport user ID can read or decide it. A connected provider login is never used to establish ownership. Approval permits one short-lived credential claim through the existing private agent claim path; the browser never receives provider tokens or slice secrets.

Google OAuth remains available for connecting Gmail, Calendar, Drive, Docs, and Sheets. It is not an Agent Passport sign-in method. Email codes expire in 10 minutes and are single use. Failed code attempts are limited to five per hour. Sending is limited to one email per minute and five per hour per normalized address, plus 100 emails per hour across the deployment.

Use a random, task-stable `Idempotency-Key` header (32–128 characters) when creating an access request. The same key and payload return the same pending or approved request and private handle before it is claimed. A different payload with that key returns `IDEMPOTENCY_CONFLICT`. Treat this key as a secret because a caller holding it can recover the claim handle while the request is live. Agent errors include stable `code`, `retryable`, and `nextAction` fields. A denied, expired, or claimed request needs a fresh task and key.

## Connect and account selection

The signed-in operator connects apps from `/connections`. Each connection is keyed by user, provider, app, and the provider's stable account ID. The display login is never used as an account key. Slice creation and onboarding approval page through apps and account choices, retaining selections across pages. At least one account must be chosen for every selected app; several may be chosen.

For Google, register five redirects on the same OAuth client:

- `https://<deployment>.convex.site/api/gmail/callback`
- `https://<deployment>.convex.site/api/calendar/callback`
- `https://<deployment>.convex.site/api/drive/callback`
- `https://<deployment>.convex.site/api/docs/callback`
- `https://<deployment>.convex.site/api/sheets/callback`

Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` once. Disconnect removes local access first. Provider revocation is attempted afterward; for Google it is attempted when the last app connection for that Google account is removed.

## Agent onboarding and minting

1. The agent calls `POST /api/access-requests` with `agentName`, `apps`, `ttlMs`, and optional `reason`.
2. The response contains a chat-safe `approvalUrl` and a private `claimHandle`. The operator opens the URL, selects one or more accounts for each app, and approves or denies. Opening the link alone does not assign it to an operator.
3. The agent polls `POST /api/access-requests/status` and claims slice credentials once with `POST /api/access-requests/claim`.
4. The agent calls `GET /api/accounts?app=<app>` with `x-slice-token` and `x-slice-secret` to see the accounts allowed for that app. It sends `sliceToken`, `sliceSecret`, `app`, and the chosen `bindingId` to `POST /api/credentials`. With a single allowed account, `bindingId` may be omitted. With several, omitting it returns `ACCOUNT_SELECTION_REQUIRED`. An auto slice mints immediately. An approve slice returns a request ID and approval URL for the exact account; after approval the agent calls `POST /api/credentials/claim`.

A failed provider refresh leaves an approved mint request available to retry until its claim window expires. The backend consumes the request only after refresh and the final slice, account, and binding check succeed.

`GET /` on the Convex HTTP origin lists routes. `GET /api/apps` reports app availability for a slice. Its `connected` flag means at least one account allowed by the slice is still connected; unbound apps report `false`. `GET /api/accounts?app=<app>` returns each available account's display login and opaque `bindingId`. If an account is removed from the slice while a mint is pending, that mint can no longer be claimed.

## Run it

```bash
pnpm install
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). Convex HTTP routes live on the deployment's `.convex.site` origin.

## Deploy

Set OAuth client IDs and secrets on the Convex deployment. Set `BOARD_ORIGIN` to the board's origin, such as `http://localhost:3000` in development, so OAuth can return there. Set `RESEND_API_KEY` and verify `nishilfaldu.site` in Resend. OTP mail defaults to `Agent Passport <login@nishilfaldu.site>`; set `RESEND_FROM` to override that sender.

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
