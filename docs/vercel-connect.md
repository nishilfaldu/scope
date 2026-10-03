# Vercel Connect integration

Starting main: `60e574800bf39be6c67e69dcf02fca9213acba5b` (fetched `origin/main` on 2026-10-02). Implementation branch: `codex/vercel-connect-implementation`.

This is an opt-in Slack provider layer. Scope continues to own authentication, agent pairing, owner checks, account selection, slices, approval and claim policies, expiration, and local revocation. The existing **Vercel OAuth provider** still connects a Vercel account; it is unrelated to **Vercel Connect**.

The authorization-to-mint flow is exercised end to end with mocked Vercel/Slack HTTP and SDK responses. A second test exercises the actual installed `@vercel/connect@2.3.5` and OIDC implementation over mocked HTTP. TypeScript, ESLint, all 242 tests, the Next.js production build, and a development Convex push pass. Real Slack consent and live issuance have **not** been verified: no Connect connector, project OIDC, or bridge configuration was provisioned. Do not remove the legacy Slack provider until the acceptance steps below succeed.

## Why there is a Vercel bridge

[Connect authentication](https://vercel.com/docs/connect/concepts/authentication) restricts Vercel access tokens to app subjects or their own user. A project OIDC identity can request delegated application user subjects. Convex is not a Vercel runtime and must not hold a static developer access token to impersonate arbitrary Scope users.

`app/api/connect/bridge/route.ts` runs on Vercel and uses the SDK's automatic project OIDC authentication. It accepts **only** `{ ticket }`, with server-to-server bearer authentication. A Convex internal mutation issues a random, hashed, single-use ticket with a 60-second lifetime and a scheduled cleanup. The bridge resolves it through the authenticated Convex `/api/connect/ticket` HTTP action. It cannot mint from caller-supplied subjects, users, account IDs, connector IDs, scopes, or arbitrary URLs. Neither endpoint enables CORS. Responses containing credentials use `Cache-Control: no-store`; redirects and transport failures do not forward secrets.

Commands are created inside the existing Scope authorization flow. The bridge uses a single operator-configured connector, verifies its managed Slack type/service with Connect, and verifies every credential against Slack. The ticket round trip adds a small transactional table and network hop; it avoids accepting a reusable token-minting payload.

## Authorization and account mapping

1. The signed-in owner starts the existing app-bound OAuth state and browser proof. When both bridge settings are present on Convex, a Slack state receives a fresh subject slot `scope:<Scope user ID>:<state UUID>`.
2. The existing `/api/slack/connect` route starts Connect authorization for that subject, issuer, and explicit Slack scope allowlist. A subject slot is fresh for every account authorization, so two provider accounts for one owner do not overwrite each other in Connect. Separate Scope owners also have separate subject slots, even when they authorize the same Slack account.
3. Connect handles the upstream authorization callback and redirects to Scope's existing `/oauth/complete` page. The callback URL includes the Scope state and the `code=connect` marker; this marker is not an authorization credential. The signed-in owner and browser proof must still match the state. The browser never receives the provider token.
4. Scope asks the bridge for the subject's authorized token. The bridge requires a managed Slack connector, a concrete installation ID, a rotating user token (`xoxe.xoxp-`), and a provider expiration between 30 seconds and roughly 12 hours from now. It rejects bot credentials, unrotated standing tokens, missing installations, and wildcard installations.
5. Slack `auth.test` supplies `team_id`, `user_id`, and the token's `X-OAuth-Scopes` header. The account key is **workspace ID + user ID**; the display login includes both user and workspace. Missing scope evidence and any scope outside Scope's existing Slack app boundary fail closed. A valid subset is retained; Connect does not imply that every requested permission was granted.
6. Scope saves a reference containing subject, issuer, connector ID, and installation ID. Subsequent issuance pins all those fields and compares Slack's workspace/user identity. Changing a connector's default workspace cannot redirect a selected account's mint.

The first authorization uses Connect's user authorization flow without an installation hint; its returned installation is then pinned. The integration does not select from an administrator's default app install, issue app/bot tokens, automatically install workspaces, or list all connector installations. If the managed connector cannot complete delegated user consent for the requested workspace, it fails closed. Complete the provider's required installation/consent setup externally, and verify this behavior with two workspaces before enabling it for users.

Custom OAuth Slack connectors are intentionally rejected. Their parsing, client configuration, user-token handling, installation metadata, refresh behavior, and scope semantics have not been verified as equivalent to the managed Slack connector. No other provider was migrated on the basis of the catalog alone.

## Credential issuance and revocation

The agent still requests `/api/credentials` with its slice credentials and selected `bindingId`. `authorizeCreate` or the approved request claim resolves the Scope owner and connection. Connect then supplies the provider credential. The SDK's `forceRefresh: true` bypasses its local cache to revalidate the grant on each issuance; it does **not** promise a different provider token on every request.

Connect rows bypass AES token decryption, Scope refresh leases, provider refresh requests, and vault token updates. Each bridge issuance performs connector metadata lookup, token retrieval, and Slack identity/scope verification; together with ticket resolution this adds network work compared with the legacy single provider refresh. Scope rechecks the connection version after the bridge call. The final transaction also checks that version alongside the existing parent pairing, slice, selected binding, mint policy, approved request, and expiry checks. Concurrent disconnection, reconnection, binding removal, pairing revocation, or slice expiry cannot deliver the returned token. Approved claims are consumed only by that final transaction.

The response reports the actual provider `expiresAt`. Scope's slice expiration gates future issuance; it does not shorten a token already handed to an agent. [Slack token rotation](https://docs.slack.dev/authentication/using-token-rotation/) supplies the provider-native 12-hour expiry. An unrotated `xoxp-` token is rejected even if a Connect response includes a finite cache expiration.

Disconnect deletes the local row first, immediately preventing future Scope minting, then requests Connect revocation for that subject and installation. Failure does not undo local disconnection. Reconnecting a verified existing Connect account preserves the row ID/bindings and advances its generation. It replaces the local subject reference without automatically revoking the old upstream grant, matching Scope's existing reconnect behavior. Independent upstream grants for the same Slack user/client have not been proved; automatic revocation could invalidate the new credential. Upstream revocation remains best effort: [Connect's revocation semantics](https://vercel.com/docs/connect/concepts/tokens) depend on the provider, and other cached/issued tokens can survive until expiry. Revocation for one Scope subject is not evidence that Slack keeps a second subject's upstream grant usable; the live two-owner acceptance check must verify that provider behavior.

Pairing and slice revocation retain their existing local semantics. Polling, private claim-handle retention, acknowledgment, and agents' durable credential storage are unchanged; Connect does not solve those concerns.

## Configuration and deployment

Use separate connector/project links and bridge secrets for development/preview/production. A project environment link does not partition provider installations; separate connectors are required for provider-level environment isolation. Keep every setting below server-side.

| Runtime                  | Setting                   | Value                                                                                      |
| ------------------------ | ------------------------- | ------------------------------------------------------------------------------------------ |
| Convex                   | `CONNECT_BRIDGE_URL`      | Exact reachable Vercel URL ending in `/api/connect/bridge`                                 |
| Convex and Vercel        | `CONNECT_BRIDGE_SECRET`   | The same random server secret within one environment; generate with `openssl rand -hex 32` |
| Vercel                   | `CONNECT_SLACK_CONNECTOR` | Managed Slack connector ID or UID, e.g. `slack/scope-dev`                                  |
| Vercel                   | `SCOPE_CONVEX_SITE_URL`   | Corresponding Convex HTTP origin, e.g. `https://<dev>.convex.site`                         |
| Vercel                   | `SCOPE_BOARD_ORIGIN`      | Owner UI origin; must match Convex `BOARD_ORIGIN`                                          |
| Vercel runtime/local SDK | `VERCEL_OIDC_TOKEN`       | Automatically supplied on Vercel; pulled locally through Vercel CLI                        |

Keep the existing `NEXT_PUBLIC_CONVEX_URL`, `NEXT_PUBLIC_CONVEX_SITE_URL`, Scope auth configuration, `BOARD_ORIGIN`, Resend configuration, and `TOKEN_ENCRYPTION_KEY`. Never use a developer `VERCEL_TOKEN` as a delegated identity substitute. No Connect secret or OIDC token goes in a `NEXT_PUBLIC_` variable.

For a development project, the [official CLI reference](https://vercel.com/docs/cli/connect) documents this setup:

```sh
vercel link
vercel connect create slack --name scope-dev
vercel connect attach slack/scope-dev --environment development --environment preview
vercel env pull
```

Inspect the connector's user authorization and scope configuration. Its managed app must issue rotating delegated user credentials with scopes inside `SLACK_SCOPES` in `convex/connect/contracts.ts`, and include a concrete installation ID. Configure the bridge on the matching Vercel environment, then set the two Convex bridge settings. Existing Slack client ID/secret settings can stay while legacy rows remain. Their env declarations remain required by the existing application configuration; retain them until legacy support is intentionally retired.

Convex must be able to reach the bridge URL. A cloud Convex action cannot call a developer's `localhost`; use an accessible preview deployment or an authenticated tunnel for local work. Local OIDC expires; refresh it with `vercel env pull`. A preview protected by Vercel Deployment Protection must allow the authenticated server call, or it will fail closed. No bypass credential is implemented here.

Deploy Convex functions and the Next.js bridge to their matching **development** environments before enabling the bridge. This implementation was pushed only to `bright-dinosaur-692` development. No Vercel deployment or production change was made. Production rollout requires fresh approval and a deliberate connector/secret/environment setup.

Removing the two Convex bridge settings makes newly started Slack flows use legacy OAuth. Already saved Connect references still require a working bridge, so disabling the settings is not a transparent rollback for migrated accounts; reconnect or disconnect those accounts deliberately.

## Live acceptance before retiring legacy Slack

- Two distinct Scope users independently authorize Slack, including a shared upstream Slack user. Verify neither can complete the other's state, bind/discover its accounts, approve its requests, or disconnect it. Disconnect one and verify the other's **real** provider grant remains usable or document the upstream limitation.
- One Scope user authorizes two workspaces/accounts. Verify both labels, explicit `bindingId` selection, ambiguous-selection rejection, and that changing the connector default does not change the issued identity. If Connect does not return the installation ID or does not support this consent selection, keep the feature disabled.
- Verify the managed connector's actual token shape, rotation expiry, and `auth.test` scopes. No bot, standing token, missing scope evidence, extra scope, or custom OAuth connector should pass. Confirm a safe Slack read operation with the token. Posting messages requires a user-chosen destination and separate authorization.
- Exercise both `auto` and `approve`: pending approval must not mint; one approved claim must issue once; a revoked/expired parent pairing or slice and a removed binding must block delivery. Disconnect/reconnect during issuance must block stale delivery.
- Verify live consent returns to the same browser and preserves the callback state. A denied/expired consent must not create a connection. Verify SDK error responses remain generic and no tokens appear in logs or browser responses.

## Before/after and cleanup

| Area                        | Starting main                                                           | Implemented Slack Connect path                                                                        |
| --------------------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Provider authorization      | Scope builds Slack OAuth URL, exchanges code, identifies user           | Connect handles upstream consent; Scope retains owner/state/browser proof and verifies Slack identity |
| Stored upstream credentials | Encrypted access token, optional refresh token and token expiry         | No provider credentials; only subject/issuer/connector/installation reference                         |
| Refresh coordination        | Durable refresh lease, rotating refresh request, encrypted token update | Connect owns upstream refresh; no Scope refresh lease or token write                                  |
| Account identity            | Legacy Slack user ID                                                    | Slack workspace ID + user ID, selected installation pinned                                            |
| Mint policy                 | Scope auto/approve + selected account + final recheck                   | Same policy, plus connection version fence                                                            |
| Disconnect                  | Delete local connection, then best-effort Slack revoke                  | Delete local connection, then best-effort Connect revoke for selected subject/installation            |

Removed from every matching replaced connection row: `accessToken`, `refreshToken`, `tokenExpiresAt`, `refreshLease`, and `refreshLeaseExpiresAt`. The schema union prohibits these fields on a Connect row. Its retained `grantVersion` and `connectionGeneration` protect reconnects; `grantedScopes` remains useful evidence. The shared Slack allowlist replaces the provider-local scope string, so the two paths cannot silently drift.

No existing table or provider module was deleted. `oauthStates` retains all old fields and adds optional `connectSubjectId`; its owner/session/browser proof still provides the completion boundary for every provider. `connections` retains the legacy schema branch for unmigrated accounts. `connectBridgeTickets` is the only new table; its hashed tickets expire after 60 seconds and are deleted atomically on use.

Legacy Slack rows with a user-only ID cannot safely be matched to a workspace-qualified ID. They remain until the owner verifies the new account and disconnects the old one. A verified matching workspace-qualified legacy row is replaced in place, deleting its secrets/leases and preserving bindings. Late legacy callbacks cannot overwrite a migrated row. Retired Connect subject slots, abandoned consent attempts, and former legacy upstream grants may require provider/dashboard cleanup. They cannot be reached through the current Scope account reference; do not revoke shared upstream grants automatically until their isolation is verified.

Retained modules include `convex/oauth/providers/slack.ts` for legacy Slack rows, all seven other provider modules, `oauth/access.ts` and connection refresh mutations for those providers, the encryption utility/key for unmigrated OAuth and private agent handoff secrets, and the existing OAuth state/finish paths. No existing dependency became unused. Added dependency: pinned `@vercel/connect@2.3.5` and its OIDC transitive dependencies. `pnpm-workspace.yaml` now explicitly names this single package; this prevents pnpm 11 from treating the policy-only file as an empty workspace.

This first-provider integration **increases total code size**: it adds the bridge, security checks, reference storage, and tests while legacy provider coverage stays supported. The simplification is the removal of local token custody and refresh work from migrated rows, not a claim that the repository is already smaller. Real provider coverage is the prerequisite for deleting the old modules/fields/configuration. Use the baseline commit above for the full review; the production TypeScript changes add 742 lines and remove 56 (net +686), excluding generated bindings. The six new production modules total 540 lines. Tests add more than 800 lines covering the integration and authorization boundaries. No entire module or dependency was removed. These counts include formatting in modified source files; they are not measures of runtime complexity.

After live Slack acceptance and migration of all legacy Slack rows, its OAuth provider module and Slack client-secret configuration can be retired. Shared OAuth state, vault, refresh leases, and encryption cannot be removed while other providers and private handoff encryption still depend on them. Future providers need their own verified identity, scope, token-lifetime, and installation rules before using this layer.

## Research sources

Reviewed official documentation and installed SDK source on 2026-10-02:

- [Authentication and subject restrictions](https://vercel.com/docs/connect/concepts/authentication)
- [Installations and default-selection behavior](https://vercel.com/docs/connect/concepts/installations)
- [Token scoping, cache bypass, and revocation](https://vercel.com/docs/connect/concepts/tokens)
- [SDK reference](https://vercel.com/docs/connect/ts-sdk-reference)
- [Official SDK source](https://github.com/vercel/vercel/tree/main/packages/connect/src), checked against the pinned package's `dist/token.js`, `authorization.js`, and `connector.js`
- [Slack token rotation](https://docs.slack.dev/authentication/using-token-rotation/), [auth.test](https://docs.slack.dev/reference/methods/auth.test/), and [scope response headers](https://docs.slack.dev/tools/node-slack-sdk/web-api/)
