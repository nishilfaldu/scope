# Scope

Scope lets a person give an AI agent a provider token for a limited time. The agent asks through the CLI. The person approves in the web app and picks the account and the duration. The agent's command then runs with the token.

**A token carries every permission granted when the account was connected. The reason does not restrict it.** Review the provider consent screen before you connect.

The target design and the build order are in [docs/roadmap.md](docs/roadmap.md).

## Run locally

```sh
pnpm install
pnpm dev
```

Open [localhost:3000/requests](http://localhost:3000/requests). Read `AGENTS.md`, the installed Next.js guides and the Convex guidelines before you edit. The personal development backend is `bright-dinosaur-692`.

## Use the CLI

1. In Scope, open **Accounts** and connect a provider.
2. Open **Agents**, create an agent, and copy its token.
3. Sign in and run a command:

```sh
pnpm scope login --origin http://localhost:3000
pnpm scope run slack --reason "Summarize public channels" --env SLACK_TOKEN -- node examples/slack-channels.mjs
pnpm scope logout
```

`login` asks for the token, checks it, and saves it to `~/.config/scope/config.json` (directory 0700, file 0600). `SCOPE_CONFIG` selects another file. `SCOPE_TOKEN` supplies the token without a prompt.

`run` asks for a provider. It prints the approval link and waits. A request waits up to 30 minutes. The person can approve for 15 minutes, 30 minutes or 1 hour. During that window the same agent gets tokens for that provider without a new prompt. Collecting a token does not extend the window.

The command gets the token in one environment variable plus a small base environment. Default timeout is 300 seconds. `--timeout SECONDS` accepts 1–3600. A timeout exits with 124 and a cancel exits with 130.

## End approval, Disconnect and Delete agent

- **End approval** stops further token collection. It does not revoke tokens that were already given out.
- **Disconnect** asks Vercel Connect to revoke the grant. If that succeeds, Scope deletes the account and ends its approvals. Tokens can stay valid if the provider does not support revocation.
- **Delete agent** makes its token stop working and ends its open requests and approvals.

## Security boundary

- Scope never stores provider tokens. Vercel Connect stores and refreshes them.
- The Connect subject is the person's WorkOS user ID. No client can choose it.
- Convex stores only a SHA-256 hash of each agent token. The token is the agent's only authority.
- Agent names and reasons are display text. They never grant access.
- **The CLI is not a sandbox.** A program with a token can print, store or send it.

## Configuration

Next: `NEXT_PUBLIC_CONVEX_URL`, `SCOPE_ORIGIN`, `WORKOS_CLIENT_ID`, `WORKOS_API_KEY`, `WORKOS_COOKIE_PASSWORD`, `NEXT_PUBLIC_WORKOS_REDIRECT_URI`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, and one connector ID per provider: `SCOPE_SLACK_CONNECTOR`, `SCOPE_GITHUB_CONNECTOR`, `SCOPE_GOOGLE_CONNECTOR`, `SCOPE_NOTION_CONNECTOR`, `SCOPE_VERCEL_CONNECTOR`.

Convex: `WORKOS_CLIENT_ID`, `SCOPE_VAPID_PUBLIC_KEY`, `SCOPE_VAPID_PRIVATE_KEY`.

To add a provider, add an entry to `shared/connectors.ts` and configure its connector in Vercel Connect.

## Verification

```sh
pnpm test
pnpm lint
pnpm exec tsc --noEmit
pnpm build
```
