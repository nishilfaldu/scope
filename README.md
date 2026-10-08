# Scope

Scope is one MCP server for all your AI apps. An app signs in to Scope, and Scope runs each tool call with your connected account. The app never gets a provider token. You set a rule per app and per tool (Allow, Ask me, Block), approve "Ask me" calls from your phone, revoke one app at a time, and see every call in Activity.

The older CLI flow still works: an agent asks for a provider token for a limited time, and its command runs with the token. **A released token carries every permission granted when the account was connected. The reason does not restrict it.**

The target design and the build order are in [docs/roadmap.md](docs/roadmap.md).

## Run locally

```sh
pnpm install
pnpm dev
```

Open [localhost:3000/requests](http://localhost:3000/requests). Read `AGENTS.md`, the installed Next.js guides and the Convex guidelines before you edit. The personal development backend is `bright-dinosaur-692`.

## Use from an AI app (MCP)

1. In Scope, open **Accounts** and connect a provider.
2. Add the MCP server URL from **Apps** (`http://localhost:3000/mcp` locally) to the AI app. For Cursor, add `"scope": { "url": "http://localhost:3000/mcp" }` to `~/.cursor/mcp.json`.
3. The app opens a WorkOS sign-in. After sign-in, it appears on **Apps**.

Read-only tools run without asking. Other tools send an approval request. The call waits about 25 seconds for a decision, then tells the app to call again. "This call only" covers the same arguments for 10 minutes. A timed approval (15, 30 or 60 minutes) covers any arguments for that tool. A blocked tool is hidden from that app. After a deny, the same call is not asked again for 2 minutes.

Tools exist for Slack, GitHub, Notion, Gmail, Google Calendar and Vercel. An app sees only the tools of providers you connected. Slack tools are Scope's own. The others forward to the provider's official MCP server (`lib/tools/upstream.ts`).

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
- An MCP app's only authority is its AuthKit access token, whose audience is Scope's `/mcp` resource. Each OAuth client is a separate app with its own rules. App tokens cannot call owner functions, and the web session cannot call gateway functions.
- For forwarded tools, Scope sends only the arguments in its own schema and decides itself which tools are read-only. It does not trust the upstream server's tool hints.
- Approval requests show names that Scope looks up from the provider, such as the Slack channel name or Notion page title, not names from the model. Activity stores the app, tool, decision and outcome, never arguments or results.
- **The CLI is not a sandbox.** A program with a token can print, store or send it.

## Configuration

Next: `NEXT_PUBLIC_CONVEX_URL`, `SCOPE_ORIGIN`, `WORKOS_CLIENT_ID`, `WORKOS_API_KEY`, `WORKOS_COOKIE_PASSWORD`, `NEXT_PUBLIC_WORKOS_REDIRECT_URI`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `WORKOS_AUTHKIT_DOMAIN` (for example `https://example.authkit.app`), and one connector ID per provider: `SCOPE_SLACK_CONNECTOR`, `SCOPE_GITHUB_CONNECTOR`, `SCOPE_GOOGLE_CONNECTOR`, `SCOPE_NOTION_CONNECTOR`, `SCOPE_VERCEL_CONNECTOR`.

Convex: `WORKOS_CLIENT_ID`, `SCOPE_VAPID_PUBLIC_KEY`, `SCOPE_VAPID_PRIVATE_KEY`, `WORKOS_AUTHKIT_DOMAIN`, `SCOPE_MCP_RESOURCE` (`<SCOPE_ORIGIN>/mcp`).

WorkOS: enable Dynamic Client Registration (and Client ID Metadata Documents for ChatGPT and Claude.ai), and add `<SCOPE_ORIGIN>/mcp` as a Resource Indicator. Without the Resource Indicator, sign-in fails with `invalid_target`.

Vercel Connect: the Notion and Vercel connectors must use the MCP target (`https://mcp.notion.com/mcp` and `https://mcp.vercel.com`). Tokens from a Notion API connector fail on Notion's MCP server. A Vercel connector backed by your own Vercel App reaches only the personal account, because team permissions for Vercel Apps are in private beta. Google's MCP servers need the Cloud project in the Google Workspace Developer Preview Program.

To add a provider, add an entry to `shared/connectors.ts` and configure its connector in Vercel Connect. To add a tool, add it to `shared/tools.ts` and its implementation under `lib/tools/`.

## Verification

```sh
pnpm test
pnpm lint
pnpm exec tsc --noEmit
pnpm build
```
