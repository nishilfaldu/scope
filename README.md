# Agent Passport

Agent Passport gives agents short-lived access without giving them a user's real credentials.

The system has two layers:

1. A **passport** belongs to the user. It is the long-lived vault that holds the user's connected services and their real upstream tokens.
2. A **slice** belongs to one agent. It is a scoped, expiring grant created from one passport.

Connect once, give many agents access. A user can connect GitHub, Google, or Slack once, then give each agent its own slice of that access.

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
- The Agent Passport screen grants one agent a slice of that connection.

The upstream service does not need to know which agent holds the slice.

## Giving an agent access

Onboarding is one sentence: give the Agent Passport link to your agent.

The agent reads the link, requests the services, actions, and duration it needs, then gives the user a short-lived approval link. The user signs in and reviews the request. Approval creates a slice and locks in that policy.

The approval link points only to the request. It is one-time or short-lived because anyone holding it could start the connect flow. The grant record, not the link, holds the policy.

The duration comes from three places:

1. The agent may request one.
2. The user approves or changes it on the consent screen.
3. Agent Passport uses a product default when no duration was requested.

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
5. read an upstream OAuth access or refresh token
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
