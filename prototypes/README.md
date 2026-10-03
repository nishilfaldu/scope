# Scope approval experiments

Experimental branch: `codex/scope-approval-prototypes`, based exactly on cleanup commit `9ac1df0`. The cleanup is [PR 48](https://github.com/nishilfaldu/scope/pull/48), targeting main and left unmerged. The implemented approval flow lives at `/lab`, linked as **Approvals** in the actual Scope sidebar. It uses separate tables while the verified Slack flow remains available. The original checkout is the only active checkout.

## Live read-only PAT test

Continue in the single shared checkout `/Users/happyhome/Desktop/agent-passport`. Inspect the current branch and changes before editing; switch branches here rather than creating worktrees.

The user supplied `airtable/scope-prototype-read-only` (`scl_KfyFWYC864MEEK9JTdDRQ`), a shared app-subject PAT connector bound to development and preview only. The dedicated base is `app2SVjDmWa26jwo6`, **Scope Prototype Test**. Real `getTokenResponse(..., { subject: { type: "app" } })` retrieval succeeded. Private calls to Airtable's `whoami` and `bases` endpoints both returned HTTP 200, and the credential exposed exactly that one base. No provider token was printed or saved locally.

Connect supplies an `expiresAt` value even for this connector. The probe preserves that as the **Connect response expiry**, while marking the PAT's provider expiry as unverified (`providerExpiresAt: null`). This is not evidence of OAuth refresh, short-lived provider tokens, or two-account isolation. The helper rejects an unexpected base or extra base results.

This test uses the existing Scope agent-connection authentication instead of WorkOS. Run `node prototypes/pair-existing-auth.mjs` from the repo, then approve the named agent through Scope's existing pairing page. The script privately claims, saves and acknowledges the connection; model-visible output contains only the approval URL and completion status. The helper keeps the agent credential in its private configuration, and sends it only to Scope. The server validates that connection's active state and derives its owner; a client-supplied owner is never accepted.

The local server requires `SCOPE_PAT_TEST_OWNER_ID` and `CONNECT_AIRTABLE_PAT_CONNECTOR`. The former is pinned to the existing test owner, and the latter to the supplied connector. Add the shared test base in `/lab`, then invoke the actual Codex `airtable_list_bases` tool with its account ID. Approve the access request in `/lab`. Both approval and provider-data delivery must be observed before calling the full test successful. The “Revoke” control for this shared PAT blocks Scope delivery only; it deliberately does not revoke the shared connector for other uses.

**The real end-to-end test passed.** The human reported receiving the notification on their iPhone and approving the actual request. The outstanding native Codex `airtable_list_bases` call then returned `Scope Prototype Test` (`app2SVjDmWa26jwo6`), with no provider token in its result. A native same-key retry returned the same base and expiry; Scope showed one credential history row. This is separate from the earlier SDK timing simulation.

The request is `k578yh42hj91z5rv41rrxskf9d8fjcss`, key `pat-live-native-20261003-01`. During setup, an authenticated diagnostic created the pending request after the already-running helper used its older Bearer authentication format. The server now accepts that existing Scope credential envelope as well as the new helper's connection headers. The native call reused the pending request and completed after phone approval. No user identity or provider credential was fabricated.

After hardening the implementation, the updated helper was additionally run through the official MCP SDK against the **same real approval**. It returned the same base, explicitly reported `providerExpiresAt: null`, confirmed its receipt in Scope, and emitted zero stderr bytes. This additional run proves the new receipt path; the original native call is the proof of desktop-tool continuation. The older process loaded in this chat did not exercise the new PAT-specific checks; those were exercised by the updated helper and fixtures.

The returned `permissionLevel` field is included unchanged as Airtable metadata. The operation only read identity and base metadata. No write operation or provider-expiry/refresh experiment was performed.

![Actual approval and delivery history](pat-approved.png)

## Implemented after the live proof

- Requests bind the authenticated recipient, selected account, reason and idempotency key. Account/provider/installation bindings cannot be silently replaced after verification. Only the authenticated owner plus the private server bridge can confirm bindings.
- Existing Scope agent authority is checked in each request/delivery transaction, including after provider acquisition. Revocation or cancellation during the external call fences delivery. WorkOS JWT verification remains a separate supported code path requiring live setup.
- Each request has a fixed approval window and its own encrypted replay payload/deadline. Exact token fingerprints group history without sharing or extending another request's delivery expiry. New history rows contain no ciphertext. Scheduled cleanup removes expired delivery ciphertext, preserving decisions and nonsecret history.
- The helper acknowledges receipt after validation and before provider work. Scope preserves first-attempt and receipt timestamps separately. Receipt means receipt into the helper process, not durable local token storage or completed Airtable work. Retries remain possible within the original deadline.
- The app has an approval inbox, cancellation, paginated history and per-credential recipient pagination. Push links target the request. PAT expiry and local blocking are labeled separately from provider revocation.
- Request creation atomically schedules one notification job per saved subscription. Jobs use leases, crash recovery, bounded retries and 404/410 subscription cleanup. Provider errors are never logged. A failed notification does not lose the approval request.

Removed/replaced: synchronous push sending from request handlers, encrypted-token storage in newly created history rows, history recipient discovery limited to the latest 100 requests, mutable installation confirmation, and the ambiguous PAT expiry/revocation labels. The manual test-push endpoint remains for setup.

Existing agent pairing, Slack slices and their regression tests are retained: existing authentication is currently the proven path, and WorkOS/live multi-account OAuth have not passed their replacement gates. No legacy-data migration is required; the user explicitly permits deleting development data. No idle-chat wakeup, custom launcher, Dots integration, production rollout or PR merge was added.

![Implemented Scope inbox with confirmed receipt](scope-implemented.png)

## Earlier prototype evidence (before the live PAT test)

| Experiment           | Observed result                                                                                                                                                                                                                               | Still unverified                                                                         |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------- |
| Cleanup baseline     | 95 tests, typecheck, lint, formatting and Next build passed before commit/push                                                                                                                                                                | Human PR review and merge                                                                |
| Prototype boundaries | 104 tests passed, including JWT signature/issuer/audience/expiry checks, ownership, requester binding, independent account approvals, conflicting retries, denial, acquisition leases, revocation during acquisition and shared-token history | Real WorkOS-issued tokens                                                                |
| Private local helper | Three fixture checks passed: only fixed Airtable endpoints receive provider bearer credentials; pending retries retain the key; wrong account, expired grant and credential echo fail closed                                                  | Actual Airtable API token via Connect                                                    |
| MCP wire timing      | Installed helper launched through the official MCP SDK; 10-second and 90-second approvals completed, and a 60-second client timeout recovered after approval at 90 seconds with the same key; no duplicate request                            | An ordinary Codex desktop chat waiting on this tool, followed by physical-phone approval |
| Native Codex plugin  | `codex plugin add scope-local@scope-prototypes` succeeded. Codex app-server MCP discovery launched `scope-local` and listed `airtable_list_bases` without an error                                                                            | Public marketplace distribution and tool invocation from the existing desktop chat       |
| Push                 | Chrome permission granted; subscription saved under the signed-in owner; test push service accepted 1, failed 0                                                                                                                               | Device receipt, notification tap, iPhone Home Screen installation and approval           |
| Airtable OAuth       | Connect connector created and attached only to development + preview. Authorization reached Airtable and failed before consent                                                                                                                | Two distinct accounts, API access, expiry and provider revocation                        |
| WorkOS staging       | Dashboard reached sign-in; integration code and cryptographic fixture checks are ready                                                                                                                                                        | Staging credentials, resource/client configuration and live sign-in                      |

The MCP timing test uses a local HTTP fixture with synthetic credentials. It proves protocol timing and retry behavior, not a live Connect/WorkOS/phone round trip. Native discovery started no model conversation and is not a custom agent launcher.

## What stopped the Airtable test

Vercel CLI 62.1.0 lists Airtable's MCP connection as OAuth with automatic client registration or a supplied client ID/secret. Its API connection is a personal access token. A PAT is not an expiring OAuth substitute for this experiment.

The experimental connector is `airtable/scope-airtable-probe` (`scl_KMH4VGLP3ARUsbPme4mDwQ`), linked to the `scope` project in development and preview only. The managed MCP authorization produced:

> invalid client_id or mismatched redirect_uri

The request used the connector URL as `client_id` and `https://connect.vercel.com/callback` as its redirect URI. No provider token was acquired. A registered Airtable OAuth client is the next gate. Supplying that client may fix authorization; it does **not** yet prove an MCP-scoped token works with Airtable's REST API.

After configuration, connect account A and account B separately in `/lab`, switching the Airtable login as needed. Each connection attempt gets a distinct Connect subject. Verify both with `/v0/meta/whoami`; require different provider user IDs and stable installation IDs. Then request each account separately and check that the local helper returns that account's bases. Revoke A, confirm that further A delivery fails, and check B independently. Test a previously issued A token privately against Airtable after revocation; never print it or return it to the model.

The server calls `getTokenResponse` with the selected subject and installation, requests refresh, and rejects absent/non-finite/near-expired expiry. It preserves the provider's returned expiry instead of inventing a Scope lifetime. Connect holds refresh credentials. Scope stores only encrypted access credentials for retry recovery and a keyed fingerprint for history grouping. The local helper keeps provider access tokens in process memory only.

`revokeToken` is called for the exact selected subject/installation after Scope blocks future delivery. API success is reported separately from the local block. Previously issued bearer validity remains provider-dependent; no successful live Airtable revocation has been observed. See [Connect token semantics](https://vercel.com/docs/connect/concepts/tokens) and [SDK reference](https://vercel.com/docs/connect/sdk-reference).

## WorkOS setup, retaining Convex login

[Standalone Connect](https://workos.com/docs/authkit/connect/standalone) lets Scope authenticate users with its existing Convex email-OTP flow. Configure a staging WorkOS environment, then set:

- `WORKOS_API_KEY`: server-only staging secret.
- `WORKOS_ISSUER`: exact HTTPS AuthKit issuer origin, without a trailing slash.
- Login URI: `<scope-origin>/lab`.
- Resource identifier: `<scope-origin>/api/probe/mcp`.
- A public OAuth client for the local helper, with redirect URI `http://127.0.0.1:47831/callback` and authorization-code/PKCE support.
- For Codex remote MCP sign-in, enable the registration method supported by the client (WorkOS documents CIMD and optional dynamic registration).

Scope completes `external_auth_id` only after its own authenticated session, using external identity `scope:<Convex user ID>`. Resource requests verify the WorkOS JWT's signature, issuer, audience, expiry, subject, client ID and consent/session ID. The server retrieves the [WorkOS user](https://workos.com/docs/reference/authkit/user) and maps its `external_id` back to the existing Convex owner. Requester IDs are derived from verified claims; tool arguments cannot nominate another owner.

The requester displayed in the approval is `sub:client_id:sid`. This identifies an authenticated OAuth user/client/consent. It does **not** distinguish two chats sharing the same OAuth consent. Unique cryptographic identity per agent/chat needs separate client credentials or another attested identity design.

WorkOS publishes free staging access to all products, AuthKit free through one million monthly active users, and an optional custom domain at $99/month. No payment blocker was observed. This is not a quote for every possible Connect feature or production usage; confirm the desired production configuration in the dashboard. [Published pricing](https://workos.com/pricing).

## Local plugin installation and login

From this checkout:

```sh
codex plugin marketplace add "$PWD" --json
codex plugin add scope-local@scope-prototypes --json
```

The dependency-free Node helper lives in `plugins/scope-local`. The plugin sets its working directory to its installed root, so `node server.mjs` resolves after Codex copies the plugin to its cache. This was verified with native MCP discovery. Node 22 or newer must be on the host PATH. There is no npm lifecycle installation requirement.

Create `~/.config/scope-probe/config.json` privately (`0600`, parent directory `0700`) with:

```json
{
  "origin": "https://YOUR-SCOPE-PREVIEW",
  "issuer": "https://YOUR-WORKOS-ISSUER",
  "clientId": "YOUR-PUBLIC-OAUTH-CLIENT"
}
```

Run `node plugins/scope-local/login.mjs` locally and open its sign-in link. This performs loopback authorization with PKCE and saves the **WorkOS** access credential in that private file. It never saves a provider credential. The login prototype does not retain refresh tokens; repeat login when the WorkOS access credential expires. Do not paste access tokens into chat or tool arguments.

Once the installed plugin is loaded by a Codex chat, invoke `airtable_list_bases` with the account ID shown in `/lab`, a reason, and a random 16–128-character key containing letters, numbers, underscores or hyphens. Preserve exactly the same key/account/reason on retry. Example non-secret arguments:

```json
{
  "accountId": "ACCOUNT-ID-FROM-LAB",
  "reason": "List bases for this task",
  "key": "unique-request-key-123456",
  "waitSeconds": 90
}
```

The helper privately requests approval, waits, retrieves an approved access token over authenticated HTTPS, checks Airtable identity locally, and calls Airtable locally. Successful tool output includes only selected base data and account/expiry metadata. It never exposes a token retrieval MCP tool. Errors are generic, stderr stays empty, and the fixed Airtable URLs reject redirects. Provider content is still untrusted data.

The remote endpoint `/api/probe/mcp` is a separate WorkOS OAuth/approval-status experiment. Its `request_approval` tool never retrieves or returns a provider credential. A remote Codex OAuth consent and the separately registered local helper client have different requester identities; their approval IDs cannot be interchanged. Use the local helper for the end-to-end provider-data experiment.

Local install is proven. Public distribution is a separate gate: OpenAI's [plugin packaging documentation](https://developers.openai.com/plugins/build/plugins) distinguishes local testing from supported submission paths; local-only MCP submission requires the documented OpenAI support path rather than assuming arbitrary local commands are accepted publicly.

## Phone and timeout test procedure

Implementation preview: [Scope approvals](https://scope-njifgndqk-nishil-faldus-projects.vercel.app/lab). Vercel reported `READY`, target `preview`, build command `pnpm build`, with a 300-second MCP function limit. The deployment explicitly uses the development Convex URLs and probe secrets. WorkOS environment fields are still absent, so live MCP authorization cannot complete yet. The new preview was opened and correctly redirected to Scope sign-in. The successful phone approval used the earlier preview origin; sign in and enable notifications on this new origin when testing this build on a phone.

The development backend is `bright-dinosaur-692`. The frontend lab runs locally at `http://localhost:3001/lab`; use the HTTPS preview recorded below for a physical phone. The preview build uses `pnpm build`, not `convex deploy`. Probe server code refuses Vercel production execution. Existing production flows are not a substitute test target.

1. Open the HTTPS preview on iPhone, sign in using the existing Scope flow, add it to Home Screen, and launch it from the icon.
2. Tap Enable notifications, grant permission, and send a test notification. Confirm actual device receipt separately from server acceptance.
3. Start the local tool call in an ordinary Codex chat. On the phone, inspect the requester, exact account and reason; approve. Confirm the waiting chat receives provider data, with no bearer credential visible.
4. Repeat with a delay longer than the client's tool timeout. After the user sends another message, retry with the identical key. Verify the same request/credential is used. No idle wakeup is required.
5. Deny another request; try a different signed-in owner; revoke during acquisition. Each must fail without delivering credentials. Inspect one history accordion per unique token and its recipient list.

The development backend additionally requires `SCOPE_VAPID_PUBLIC_KEY` and `SCOPE_VAPID_PRIVATE_KEY`, matching the frontend subscription key pair. Configure them privately; never paste them into chat.

The request lifetime is 30 minutes, acquisition lease 30 seconds, helper/server wait at most 240 seconds, and remote route maximum duration 300 seconds. These are implementation bounds, not a promise that a host will wait that long. Lost responses recover the stored encrypted credential until the approval or provider token expires.

## Checks and remaining limits

Latest local validation: 111 application tests, five helper tests, TypeScript and lint passed; the complete Webpack production build passed. The final development functions were deployed to `bright-dinosaur-692`. The native live result and updated-helper live receipt are recorded above.

`pnpm build` explicitly uses Next's supported Webpack builder. The default Turbopack builder repeatedly failed locally during CSS processing with `binding to a port: Operation not permitted`; the Webpack production build passed. Pre-push still runs the full normal build and tests.

```sh
pnpm test
pnpm exec tsc --noEmit
pnpm exec eslint .
pnpm build
node --test prototypes/helper.check.mjs
SCOPE_INSTALLED_HELPER=/absolute/installed/plugin/server.mjs node --test prototypes/mcp.check.mjs
```

This is a development/preview implementation, not a completed production cutover. The owner inbox and credential/recipient history are paginated; connected accounts are limited to 100 displayed rows. Token deduplication is per account. JavaScript clears references after a local call but does not guarantee secure memory zeroing. A canceled call may have already finalized a credential, which is why retry is idempotent. Provider refresh/rotation behavior, live provider revocation, WorkOS staging sign-in, and two-account isolation remain live verification gates. Physical-phone receipt/approval was reported by the user, and the ordinary native Codex tool completed successfully. Sleep/restart and idle-chat wakeup are not proven; after a timeout, manually re-prompt and retry the same key.

Private setup files are ignored by Git and Vercel uploads. `SCOPE_PROBE_SECRET` is shared only between the prototype server and development Convex deployment; `SCOPE_PROBE_TOKEN_KEY` is the server's AES-GCM key; VAPID private material remains server-only. No WorkOS or Airtable provider secret is committed.

![Local lab after push service acceptance](approval-lab.png)
