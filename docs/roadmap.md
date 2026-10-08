# Scope roadmap

Scope lets a person use their accounts from any AI app without giving the app a token. Today an agent asks for a token, the person approves on the web or on their phone, and the agent's command runs with it. From step 4 on, Scope becomes an MCP gateway: apps call tools through Scope, and the person sets rules per app and per tool.

This file records the target design and the build order. Read it before you change the data model, the trust model, or the CLI.

## Design rules

- Keep the simplest version that still delivers the premise.
- Convex owns all state and all authorization checks.
- Next runs only the work that calls Vercel Connect (including `/mcp` tool calls), the OAuth metadata routes, and the notification action route. The Connect SDK needs a Vercel OIDC token, so this work must run on Vercel.
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
| `clients`           | owner, OAuth client ID, name, revoked at, last used                                                       |
| `rules`             | client, tool, rule (only overrides of the default)                                                        |
| `calls`             | owner, client, tool, decision, outcome                                                                    |

- An app approval has a client and a tool instead of an agent. "Once" approvals also store a SHA-256 hash of the canonical arguments.

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
- Next also has `POST /api/approvals/decide` for notification actions. It does not call Connect. It exists because the service worker has only the session cookie, not a Convex token.
- MCP: `POST /mcp` (stateless streamable HTTP), `GET /.well-known/oauth-protected-resource` (also at `/mcp`), `GET /.well-known/oauth-authorization-server` (proxies AuthKit).
- Pages: `/requests`, `/apps`, `/activity`, `/accounts`, `/agents`, `/notifications`.

## Build order

### Step 1: core rebuild (done; verified live)

Code, tests, typecheck, lint and build pass. Verified live on dev: agent creation, CLI login, the no-account error, and the start of Connect consent. Not yet verified live: consent callback, approval, token collection and disconnect.

- Agents with pasted tokens. Remove the WorkOS device flow, refresh tokens, `proper-lockfile`, `jose` and `/api/cli/config`.
- The data model above. Remove the service secret and the forwarded session claims.
- Request by provider. Approve picks account and duration. Expiry through `runAt`.
- Next keeps only the Connect routes.
- Remove the account setup lifecycle, provider-specific identity calls, label refresh, `design-review`, UI review seed data, empty directories and `scope.module.css` (Tailwind and shadcn stay).
- Dev data is deleted, not migrated. The app is not in production.

### Step 2: notifications (done; verified live on desktop Chrome)

- Keep the existing web push. The push lives until the decision deadline and is sent with high urgency.
- Put the agent name, provider and reason in the notification.
- Add a one-tap Deny action.
- Add a one-tap Approve action with a 30-minute default. Use it only when the person has exactly one account for that provider. Otherwise open the page with choices filled in.
- If the browser session has expired, open the page instead of acting.
- iOS web push has no action buttons. A tap opens the page.

### Step 3: permissions (done for Slack; verified live)

- Add an optional scope reader per provider (`grantReaders` in `lib/connect.ts`). Start with Slack: read the `x-oauth-scopes` header from `auth.test`. The reader also returns the workspace name as the account label when Connect has none.
- Call it once in the consent callback. Store `permissions: { scopes, checkedAt }` on the account for display only. If the reader fails, connect anyway and store nothing.
- Map the Slack scopes Scope requests to plain language. Show raw names for unknown scopes.
- Show the list on the approval page, in the notification, and on the Accounts page as "as of {date}".
- If a provider reports nothing, say "Permissions were set on {provider}'s consent screen". Never show requested scopes as granted.
- Do not reject a grant that differs from the request. Do not suggest the list restricts the token.
- Add GitHub (`x-oauth-scopes` from `GET /user`) and Google (`tokeninfo`) when they get real users.

## Direction change: MCP gateway (decided Oct 7, 2026)

**Why.** Steps 1 to 3 release a raw token to an agent that runs `scope run`. That misses the goal in three ways:

- Hosted apps (ChatGPT, Claude.ai, Grok, Instinct, Muse) have no shell. They reach accounts only through MCP.
- During an approval the token is unrestricted. The reason is display text, and a released token stays valid after the approval ends.
- Scope cannot see what the agent does, so it cannot enforce rules per action or log actions.

**What changes.** Scope becomes one MCP endpoint (`/mcp`) for every AI app. Scope keeps the provider tokens, runs each tool call itself, and returns the result. The app never sees a token.

**Prior art.** [Executor](https://executor.sh/) is an open-source MCP gateway with per-tool allow, require-approval and block policies. Scope builds its own so it is free to run and owned by us, and it adds what Executor's docs do not show:

- **Rules per app.** ChatGPT can read Slack, Cursor can write to GitHub, and Grok gets nothing. Each app is its own revocable client.
- **Phone approval.** "Ask" sends the existing push with Approve and Deny, plus time-boxed approvals.
- **Per-app revoke and audit.** One click cuts off one app. The log shows which app called which tool, and what was decided.

**Kept from steps 1 to 3.** Convex, WorkOS login, accounts through Vercel Connect, approvals and push, permission display.

### Step 4: gateway spike (done for Cursor; verified live on dev)

Verified from Cursor: AuthKit sign-in through Dynamic Client Registration, all four Slack tools listed, reads allowed, a post approved from a notification and then sent. Not yet tested: Claude.ai, ChatGPT, Claude Code and Codex. Hosted apps need a public HTTPS URL and Client ID Metadata Documents.

Prove the riskiest part first: can each app's OAuth flow connect to Scope?

- `/mcp` in Next (streamable HTTP). Tool calls need Connect tokens, so they run on Vercel.
- WorkOS AuthKit is the OAuth server for MCP clients, with dynamic client registration. Next validates the access token and maps it to the owner and the client.
- One tool: Slack `list_channels`, through `tokenFor`.
- Connect from Claude.ai, ChatGPT, Cursor, Claude Code and Codex. Record which apps work.

### Step 5: clients, rules and approvals (done; verified live on dev)

Built as below, with these differences: `clients` sits beside `agents` until step 7; the call waits 25 seconds; approvals can be "this call only" (same arguments, 10 minutes) or timed; a blocked tool is hidden from the app; Convex verifies the MCP token as a second auth provider. Verified live: allow, ask with approval, block, revoke and restore, and the Activity log.

- `agents` becomes `clients`: one row per MCP client registration, revocable.
- A rule per client and tool: allow, ask, or block. Defaults come from tool hints (read-only allowed, writes ask).
- "Ask" creates an approval with the tool name and an argument summary, then sends the push. The call waits about 30 seconds, then returns "waiting for approval, call again".
- Audit log: client, tool, decision, time, error. Never store results or full arguments.
- New client-facing Convex functions. Owner functions keep requiring the web app's `client_id`.

### Step 6: providers

- Slack: a few tools of our own (list channels, read history, search, post). Done in step 5.
- Decided: a failed provider call does not give back a "this call only" approval. A failure can come after the action took effect (for example a timeout after Slack posted), so a refund could repeat it without asking.
- Decided: calls from revoked apps and to blocked tools appear in Activity, at most once a minute per app, tool and decision. A blocked call from a cached tool list gets "blocked in Scope", not "tool not found".
- Done: GitHub, Notion, Vercel and Google through their official MCP servers (`lib/tools/upstream.ts`). Scope lists a curated set of upstream tools with its own input schemas, so only listed arguments reach the provider. Scope sets each tool's read-only flag itself and ignores upstream hints. Results are text only, cut at 100,000 characters.
- Notion uses a Connect connector with the MCP target (`mcp.notion.com`), not the REST API connector. Its tokens do not work on the REST API.
- Verified live: GitHub, Notion and Vercel reads, and an approved Notion write.
- Open: Google calls fail until the Cloud project is in the Google Workspace Developer Preview Program. Vercel tokens reach only the personal account until the Vercel App is installed on the team.

### Step 7: retire raw-token release

Remove `scope run` token release, or keep it only for the owner's own scripts behind a per-account switch. Decide after step 5.

### Not now

Ed25519 agent keys, Notion and Vercel permission display, Linear, a localhost proxy, Slack DM approvals, an Expo app, device-code pairing, code mode (one `execute` tool, as Executor does).

## Parked ideas

### Agents prove who they are to third parties (parked Oct 7, 2026)

An agent shows a third party (a website, an API, another agent) who it is, who it acts for, and what it may do. The third party verifies this without calling the person. This is the original "agent passport" premise. It is a different product from the gateway: identity and delegation, not integrations. Possible shape: signed agent keys (see Ed25519 below) plus short-lived signed delegation claims. Revisit after the gateway works.

## Notes for later decisions

### Credential proxy

Superseded by the MCP gateway, which gets the same gains without the custom base URL. Kept for reference.

Commands still run on the person's machine. Only provider API calls go through Scope. The child gets a placeholder token and a base URL that points at Scope. The proxy checks the approval and an allowlist of methods and paths, adds the real token, and forwards the call.

- Gains: the token never leaves the server, ending an approval stops calls at once, every call is in the audit log, and the reason can become an enforced rule.
- Costs: tools must accept a custom base URL (Slack `WebClient`, Octokit, Notion and googleapis do; `gh`, `gcloud` and hardcoded `curl` do not). Vercel limits bodies to 4.5 MB. WebSocket APIs need separate handling. Each provider needs its own rules.
- The permission list from step 3 can become the allowlist the person approves.

### Alternatives considered

- **Next and Postgres only, no Convex:** one backend, but no reactivity or scheduler. Not worth a migration once the service secret is gone.
- **No agent login at all (claim by URL):** simplest, but no push notifications and open to link phishing.
- **Ed25519 agent keys:** stronger than bearer tokens and closer to a real passport. Same tables. A clean upgrade later.
