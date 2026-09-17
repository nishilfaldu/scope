# Agent Passport

Agent Passport lets a user connect OAuth accounts and give an agent a slice that can request provider credentials for selected apps.

## How it works

- A **connection** stores one provider account's encrypted OAuth tokens. Google has separate Gmail, Calendar, Drive, Docs, and Sheets connections, each with its own consent scopes and callback. One user can connect multiple accounts to the same app.
- A **slice** belongs to a user, has a token and secret, an expiry, a revocation state, and an `auto` or `approve` mint policy.
- Each allowed app has one indexed **slice binding** that selects a connection. Bindings are separate rows so minting one app reads one binding and management can page through large slices. The model supports up to 1,500 bindings per slice.
- An agent presents its slice token and secret to `POST /api/credentials`. The backend checks the slice and binding, refreshes the selected provider connection, checks permissions again, then returns the newly issued provider access token. Under `approve`, the operator first approves a one-time mint request.

**Revocation boundary:** Revoking a slice or disconnecting an account immediately blocks *future* credential mints. An already issued provider-native access token remains usable until that provider expires or revokes it. Agent Passport does not proxy provider requests and cannot shorten an upstream token's lifetime. The credential response reports the provider's expiry, or `null` if the provider did not give one.

The vault never hands out its stored access token or refresh token. Providers without a refresh-capable grant cannot mint agent credentials and return `SHORT_LIVED_UNAVAILABLE`.

## Connect and account selection

The signed-in operator connects apps from `/connections`. Each connection is keyed by user, provider, app, and the provider's stable account ID. The display login is never used as an account key. Slice creation and onboarding approval page through apps and account choices, retaining selections across pages. One account must be chosen for every selected app.

For Google, register five redirects on the same OAuth client:

- `https://<deployment>.convex.site/api/gmail/callback`
- `https://<deployment>.convex.site/api/calendar/callback`
- `https://<deployment>.convex.site/api/drive/callback`
- `https://<deployment>.convex.site/api/docs/callback`
- `https://<deployment>.convex.site/api/sheets/callback`

Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET` once. Disconnect removes local access first. Provider revocation is attempted afterward; for Google it is attempted when the last app connection for that Google account is removed.

## Agent onboarding and minting

1. The agent calls `POST /api/access-requests` with `agentName`, `apps`, `ttlMs`, and optional `reason`.
2. The response contains a chat-safe `approvalUrl` and a private `claimHandle`. The operator opens the URL and approves or denies. Opening the link alone does not assign it to an operator.
3. The agent polls `POST /api/access-requests/status` and claims slice credentials once with `POST /api/access-requests/claim`.
4. The agent sends `sliceToken`, `sliceSecret`, and one `app` to `POST /api/credentials`. An auto slice mints immediately. An approve slice returns a request ID and approval URL; after approval the agent calls `POST /api/credentials/claim`.

A failed provider refresh leaves an approved mint request available to retry until its claim window expires. The backend consumes the request only after refresh and the final slice, account, and binding check succeed.

`GET /` on the Convex HTTP origin lists routes. `GET /api/apps` reports app availability for a slice. Its `connected` flag means the slice's selected account for that app is still connected; unbound apps report `false`.

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
