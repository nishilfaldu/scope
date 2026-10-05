# Scope

Scope lets you allow a verified CLI session to collect tokens for a connected Slack account for a limited time.

**Every token includes all permissions granted when you connected the account. The stated purpose does not restrict the token.** Review permissions in Slack during connection setup and in Connections afterward.

## Run locally

```sh
pnpm install
pnpm dev
```

Use [localhost:3000/access](http://localhost:3000/access). Read `AGENTS.md`, the installed Next.js guides and Convex guidelines before editing. The personal development backend is `bright-dinosaur-692`. Production service calls are disabled.

## Use the CLI

```sh
pnpm scope login --origin http://localhost:3000
pnpm scope accounts
pnpm scope run --account ACCOUNT_ID --name "Research assistant" --reason "Summarize public channels" --env SLACK_TOKEN -- node examples/slack-channels.mjs
pnpm scope status APPROVAL_ID
pnpm scope logout
```

Login uses WorkOS AuthKit's device flow. The CLI displays a code and a verification URL. It sends no API key or client secret. The private login session lives at `~/.config/scope/config.json` (directory 0700, file 0600). `SCOPE_CONFIG` selects another private config file. Refresh is serialized across processes.

A request waits up to 30 minutes for your decision. In Access, choose 15 minutes, 30 minutes or 1 hour. The approved window starts when you approve. During that window, the same authenticated CLI session can collect tokens for the same account and grant without asking again. Concurrent requests reuse the same pending or active approval. Collection and receipt never extend the window. Agent names and reasons are display labels, not authority.

The CLI runs your command with the credential in the named environment variable. Its local journal freezes the account, purpose, name, argv, working directory and environment variable for each invocation ID. `--id ID` resumes a pending invocation. Once a command starts, that ID cannot run again, including after a crash. Use a new ID for another command and check any uncertain effects first. Tokens and receipt proofs are never journaled.

Default execution timeout is 300 seconds. `--timeout SECONDS` accepts 1–3600. Output is limited to 1 MiB across both streams. Timeout returns 124, output overflow 125 and cancellation 130. On POSIX, cancellation stops the child process group. A detached descendant can escape it, but inherited output pipes cannot keep the CLI waiting indefinitely. Cancelling a command does not end the shared approval.

## End approval and Disconnect

**End approval** stops further token collection through Scope. It does not revoke provider tokens or stop programs that already received them. A later attempt can request a new approval. The approval window does not set the provider token's expiry.

**Disconnect** blocks Scope collection immediately and asks Vercel Connect to revoke the exact subject and installation. Connect attempts upstream revocation where supported. Scope trusts that result and does not call Slack's revoke endpoint or independently test token invalidation. Provider credentials can remain valid if upstream revocation is unsupported. Failures show a toast; the same Disconnect action retries safely. Confirmed completion hides the saved account. Approval history remains.

Connections lists saved accounts even when connector metadata is unavailable. Adding an account requires that metadata. Connection setup creates a durable provisional account record. Failed or expired callbacks retain references for recovery. Duplicate setup cannot revoke a grant held by another live saved account.

## Security boundary

Scope stores provider identities, granted permissions, account versions, approval windows and collection evidence. It never stores provider access or refresh tokens. Vercel Connect manages provider credentials. WorkOS identifies the browser owner and the CLI session. Owner, issuer, client, session, account, grant version and saved Connect reference are checked before and after token retrieval. A receipt is evidence of arrival, not successful work or termination of authority.

The CLI supplies a small normal environment and excludes broker credentials. It masks literal credentials and common encodings in output, including split chunks. **It is not a sandbox.** A program with a bearer token can write, encode or transmit it. Use your coding host's normal execution controls.

Slack user grants are the only enabled connector. A server-owned catalog selects the connector; clients cannot supply a Connect target. Shared Connect operations handle authorization, token retrieval and revocation. Slack `auth.test` runs only during setup or recovery to identify duplicate grants and record available permissions. Those permissions describe setup, not each delivered token. Scope does not independently inspect each token’s identity or effective permissions. It relies on Connect for the saved authorization. `forceRefresh: true` bypasses the SDK cache; it does not guarantee newly minted bytes. Configuration changes require reconnecting; existing accounts keep their saved authorization parameters.

To add a connector, add a catalog entry and configure it in Connect. Confirm its identity metadata supports safe duplicate detection and cleanup. Add a setup helper only when needed, then test that connector’s setup and token behavior. The approval engine and CLI remain shared.

## Configuration

Frontend: `NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_CONVEX_SITE_URL`, `SCOPE_ORIGIN`, `SCOPE_SERVICE_SECRET`, `WORKOS_CLIENT_ID`, `WORKOS_API_KEY`, `WORKOS_COOKIE_PASSWORD`, `WORKOS_ISSUER`, `WORKOS_AUTHKIT_DOMAIN`, `NEXT_PUBLIC_WORKOS_REDIRECT_URI`, `SCOPE_CLI_CLIENT_ID`, `SCOPE_SLACK_CONNECTOR`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`.

Convex: matching `SCOPE_SERVICE_SECRET`, `WORKOS_CLIENT_ID`, `SCOPE_CLI_CLIENT_ID`, `SCOPE_VAPID_PUBLIC_KEY`, `SCOPE_VAPID_PRIVATE_KEY`. Link Connect only to development/preview for acceptance. Never commit secrets.

Use an ordinary first-party WorkOS CLI application in the same environment as the web application. Set the web application's homepage, initiate-login URL and exact local/preview sign-out URIs in WorkOS Applications → Redirects. Enable Magic Auth for email-code sign-in.

## Verification

```sh
pnpm test
pnpm lint
pnpm exec tsc --noEmit
pnpm build
```

See [connector architecture](docs/connector-architecture.md), [credential flows](docs/credential-flows.md), [UI review data](docs/ui-review-data.md), [timed access acceptance](docs/timed-access-acceptance.md) and [historical live acceptance](docs/slack-acceptance.md). Provider behavior is described in [Connect token documentation](https://vercel.com/docs/connect/concepts/tokens#revocation). Automated tests do not establish live provider consent or device delivery.
