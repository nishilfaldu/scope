# Scope

Scope asks for phone approval before a local program receives access to a connected Slack account. The Connect connector defines the requested permissions; review them in Slack's consent screen. Every approval gives the program that connection's full permissions. The stated purpose explains the task; it does not restrict the credential.

## Run locally

```sh
pnpm install
pnpm dev
```

Use [localhost:3000](http://localhost:3000). Read `AGENTS.md`, installed Next.js guides, and Convex guidelines before editing. Production service calls are disabled. The development preview is [scope-preview.vercel.app](https://scope-preview.vercel.app).

In Connections, choose Connect account and review Slack's consent screen. Permission changes require updating the connector configuration, disconnecting and reconnecting. Disconnect blocks sharing immediately. It shows as complete only after Slack token invalidation is verified and the selected Connect grant is removed. Failed revocation keeps the internal reference and offers retry.

## Use the CLI

```sh
pnpm scope login --origin http://localhost:3000
pnpm scope accounts
pnpm scope run --account ACCOUNT_ID --reason "Summarize public channels" --env SLACK_TOKEN -- node examples/slack-channels.mjs
pnpm scope status REQUEST_ID
pnpm scope cancel REQUEST_ID
pnpm scope logout
```

The package exposes the `scope` executable through `cli/index.mjs`. `pnpm scope` runs it from this checkout. Run it through your coding host's normal command tool. There is no execution server or MCP transport.

Login uses the first-party WorkOS AuthKit device flow. It displays a short code and hosted verification URL. The public CLI sends only its client ID, never an API key or client secret. Browser sign-in uses hosted Magic Auth email codes and returns to `/callback`; the web app stays on localhost:3000. The private session is stored at `~/.config/scope/config.json` (directory 0700, file 0600). `SCOPE_CONFIG` selects another private config file. Refresh is serialized across processes. Logout removes the local session; stop the connection in Agents to block its requests.

`run` prints an invocation ID and approval URL. Approve on your phone. The CLI privately collects the credential, confirms receipt, and spawns the exact command argv with the credential in the named environment variable. It supplies a small normal environment (PATH, HOME, locale and temporary-directory settings), excluding broker credentials. Shell execution requires an explicit shell argv, such as `sh -c ...`.

Use `--id ID` to resume the same pending invocation. Account, purpose, argv, working directory and environment variable are frozen. Changed commands need a new ID. Private invocation journals contain metadata and execution state, never provider tokens. Once execution starts, the same ID cannot run again—even after a crash. Check the program's effects before creating a new invocation. Arbitrary commands are never automatically retried.

Default execution timeout is 300 seconds. `--timeout SECONDS` accepts 1–3600. Output is limited to 1 MiB across stdout and stderr; excess output stops the command. Exit status is preserved; timeout returns 124, output overflow 125, cancellation 130. On POSIX, cancellation stops the child process group. A detached descendant can escape that group.

## Security boundary

The CLI masks the literal credential and common URL, base64 and hex encodings in stdout/stderr, including split chunks. This protects against accidental disclosure. **It is not a sandbox.** A program holding the bearer can encode it differently, write it to disk, read other local files or transmit it. The coding host's normal execution restrictions still apply.

Scope stores account identities, configured/effective scopes, generation, requests and receipts. It does not store provider access/refresh tokens. Vercel Connect manages provider grants. WorkOS AuthKit identifies both the browser owner and CLI through the immutable WorkOS user ID. Each CLI session remains a separate requester. A receipt confirms credential arrival, not successful business work. The fixed 30-minute approval deadline controls collection, not the provider credential's lifetime. See [credential flows](docs/credential-flows.md).

Slack is the only implemented provider. The current flow supports standard nonrotating Slack user grants (`xoxp`), not bots or rotating grants. Rotated-token revocation does not remove the underlying installation, so those grants are rejected. Effective permissions are checked with Slack `auth.test` and `x-oauth-scopes` at connection and before release. Broader access is rejected. One Slack app/user/workspace authorization can have only one live Scope connection across owners; different workspaces and users remain separate.

## Configuration

Frontend: `NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_CONVEX_SITE_URL`, `SCOPE_ORIGIN`, `SCOPE_SERVICE_SECRET`, `WORKOS_CLIENT_ID`, `WORKOS_API_KEY`, `WORKOS_COOKIE_PASSWORD`, `WORKOS_ISSUER`, `WORKOS_AUTHKIT_DOMAIN`, `NEXT_PUBLIC_WORKOS_REDIRECT_URI`, `SCOPE_CLI_CLIENT_ID`, `SCOPE_SLACK_CONNECTOR`, `NEXT_PUBLIC_VAPID_PUBLIC_KEY`. Connect must be linked to development/preview and configured for user scopes only.

Convex: matching `SCOPE_SERVICE_SECRET`, `WORKOS_CLIENT_ID` (default/Web application), `SCOPE_CLI_CLIENT_ID` (ordinary first-party CLI application in the same environment), `SCOPE_VAPID_PUBLIC_KEY`, `SCOPE_VAPID_PRIVATE_KEY`. There are no Convex Auth or Resend secrets. Never commit secrets.

## Verification

```sh
pnpm test
pnpm lint
pnpm exec tsc --noEmit
pnpm build
```

Tests cover connector permission validation, provider identity/scope mismatches, ownership, exact requester, generation fencing, fixed deadlines, disconnect/reconnect, final authority checks after provider IO, concurrent delivery and private receipts, AuthKit device login and refresh binding, CLI waits, no reruns, exit/cancel/output handling and fake-secret disclosure boundaries.

Live acceptance is tracked in [acceptance evidence](docs/slack-acceptance.md). Automated mocks alone do not establish real provider consent, revocation or phone delivery.

Set the ordinary Web application’s homepage and initiate-login URL in WorkOS Applications → Redirects. Add exact local and preview origin roots to Sign-out URIs; environment-level redirects alone do not configure the application logout fallback. In staging Methods/Providers, enable Magic Auth and disable password, passkeys, enterprise SSO and social providers for email-code-only sign-in.
