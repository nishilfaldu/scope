# Scope roadmap

Scope lets a person give an AI agent a provider token for a limited time. The agent asks. The person approves on the web or on their phone. The agent's command runs with the token.

This file records the target design and the build order. Read it before you change the data model, the trust model, or the CLI.

## Design rules

- Keep the simplest version that still delivers the premise.
- Convex owns all state and all authorization checks.
- Next runs only the work that calls Vercel Connect. The Connect SDK needs a Vercel OIDC token, so this work must run on Vercel.
- Scope never stores provider tokens. Vercel Connect stores them.
- Agent names and reasons are display text. They never grant access.

## Target design

### Identity

- **Person:** a WorkOS AuthKit login in the web app. Convex reads it from `ctx.auth`.
- **Agent:** a record that the person creates on the Agents page. Scope shows a random token once. Convex stores only its SHA-256 hash. `scope login` saves the token in a private file. Deleting the agent revokes the token and ends its open approvals.
- **Connect subject:** `{ type: "user", id: <WorkOS user id>, issuer: <WorkOS issuer> }`. Scope derives it from the person. A client cannot choose it. This removes the need for a shared service secret between Next and Convex.

### Data

| Table               | Fields                                                                                                    |
| ------------------- | --------------------------------------------------------------------------------------------------------- |
| `agents`            | owner, name, token hash, last used                                                                        |
| `accounts`          | owner, provider, connector, installation (optional), label                                                |
| `approvals`         | owner, agent, provider, account (set on approval), reason, status, `expiresAt`, collection count and time |
| `pushSubscriptions` | owner, endpoint, keys                                                                                     |

- An account row exists only after consent succeeds. There is no setup state.
- One account per provider per person, for now. Connecting again replaces the account.
- Approval status is one of `pending`, `approved`, `denied`, `ended`, `expired`.
- `expiresAt` is the decision deadline while pending (30 minutes). It is the end of the window after approval (15, 30 or 60 minutes).
- A scheduled mutation marks the row `expired` at `expiresAt`. Queries never read the clock.

### Flows

1. **Connect.** The person picks a provider. Next starts Connect consent for the derived subject. The callback reads the label and installation from the Connect token response and saves the account. If an older Slack installation is replaced, Next revokes it.
2. **Request.** `scope run slack --reason "…" --env SLACK_TOKEN -- cmd`. The agent asks for a provider, not an account. An open request or approval for the same agent and provider is reused. A push notification goes to each saved device.
3. **Approve.** The person picks the account and the duration, or denies.
4. **Collect.** The CLI polls, then calls Next. Next calls one Convex mutation, `claim`. It checks the agent, the approval, the window and the account, then records the collection. Next gets the token from Connect and returns it. The CLI runs the command with the token in one environment variable, a small base environment, and a timeout.
5. **End approval.** This stops further collection. It does not revoke tokens that were already released.
6. **Disconnect.** Next revokes the grant in Connect first. If that succeeds, Convex deletes the account and ends its open approvals. If it fails, the account stays and the person can retry.

### Routes

- Next: `POST /api/accounts/connect`, `GET /api/accounts/callback`, `POST /api/accounts/disconnect`, `POST /api/agent/[operation]` (`whoami`, `request`, `status`, `token`).
- Pages: `/requests`, `/accounts`, `/agents`, `/notifications`.

## Build order

### Step 1: core rebuild (done; verified live)

Code, tests, typecheck, lint and build pass. Verified live on dev: agent creation, CLI login, the no-account error, and the start of Connect consent. Not yet verified live: consent callback, approval, token collection and disconnect.

- Agents with pasted tokens. Remove the WorkOS device flow, refresh tokens, `proper-lockfile`, `jose` and `/api/cli/config`.
- The data model above. Remove the service secret and the forwarded session claims.
- Request by provider. Approve picks account and duration. Expiry through `runAt`.
- Next keeps only the Connect routes.
- Remove the account setup lifecycle, provider-specific identity calls, label refresh, `design-review`, UI review seed data, empty directories and `scope.module.css` (Tailwind and shadcn stay).
- Dev data is deleted, not migrated. The app is not in production.

### Step 2: notifications

- Keep the existing web push.
- Put the agent name, provider and reason in the notification.
- Add a one-tap Deny action.
- Add a one-tap Approve action with a 30-minute default. Use it only when the person has exactly one account for that provider. Otherwise open the page with choices filled in.
- If the browser session has expired, open the page instead of acting.
- iOS web push has no action buttons. A tap opens the page.

### Step 3: permissions (minimal)

- Add an optional `readGrant(token)` per connector. Start with Slack: read the `x-oauth-scopes` header from `auth.test`.
- Call it once in the consent callback. Store `grantedScopes` and `checkedAt` on the account for display only.
- Map the Slack scopes Scope requests to plain language. Show raw names for unknown scopes.
- Show the list on the approval page, in the notification, and on the Accounts page as "as of {date}".
- If a provider reports nothing, say "Permissions were set on {provider}'s consent screen". Never show requested scopes as granted.
- Do not reject a grant that differs from the request. Do not suggest the list restricts the token.
- Add GitHub (`x-oauth-scopes` from `GET /user`) and Google (`tokeninfo`) when they get real users.

### Step 4: choose the next bet from usage

- **Credential proxy** for one provider, if users ask for "read-only" or "stop it now". See below.
- **Expo app**, if most approvals happen on iPhones. It gives action buttons and Face ID.
- **Device-code pairing**, if pasting the agent token is the main complaint.

### Not now

Ed25519 agent keys, Notion and Vercel permission display, a localhost proxy, Slack DM approvals.

## Notes for later decisions

### Credential proxy

Commands still run on the person's machine. Only provider API calls go through Scope. The child gets a placeholder token and a base URL that points at Scope. The proxy checks the approval and an allowlist of methods and paths, adds the real token, and forwards the call.

- Gains: the token never leaves the server, ending an approval stops calls at once, every call is in the audit log, and the reason can become an enforced rule.
- Costs: tools must accept a custom base URL (Slack `WebClient`, Octokit, Notion and googleapis do; `gh`, `gcloud` and hardcoded `curl` do not). Vercel limits bodies to 4.5 MB. WebSocket APIs need separate handling. Each provider needs its own rules.
- The permission list from step 3 can become the allowlist the person approves.

### Alternatives considered

- **Next and Postgres only, no Convex:** one backend, but no reactivity or scheduler. Not worth a migration once the service secret is gone.
- **No agent login at all (claim by URL):** simplest, but no push notifications and open to link phishing.
- **Ed25519 agent keys:** stronger than bearer tokens and closer to a real passport. Same tables. A clean upgrade later.
