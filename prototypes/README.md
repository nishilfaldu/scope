# Scope implementation and historical experiments

Current work lives on `codex/scope-approval-prototypes` in the single shared checkout. [Draft PR 49](https://github.com/nishilfaldu/scope/pull/49) remains stacked on [PR 48](https://github.com/nishilfaldu/scope/pull/48); neither is merged. The branch preview is [scope-preview.vercel.app](https://scope-preview.vercel.app).

## Current implementation — October 3, 2026

The approved paper/green design now uses live owner data at `/approvals`, `/connections`, `/agents` and `/notifications`. `/design-review` redirects to the inbox. Pending decisions load independently of history; decided rows stay live. Saved MCP names follow their requests. Timelines distinguish approval, delivery attempt and receipt; ordinary state no longer has repeated explanatory text.

WorkOS-authorized MCP is the sole agent access path. Direct agent invitations, claims, secret authentication, slices, public decision routes, schemas, UI and tests are retired. Old direct request history stays visible as blocked and cannot move to a new MCP authorization. Development retirement copied prior names, stopped direct recipients and cancelled obsolete scheduled expiry jobs before removal. Archived tables were left in the dev database, outside the active schema.

Provider credentials remain private. Existing acquisition/replay/receipt fences, push retries, WorkOS resource validation and the two independent read-only Airtable bindings remain. Airtable account sign-in now uses temporary owner/browser-bound attempts; accounts appear only after verified provider success. Completion retries cannot duplicate an account or reactivate one that was blocked.

Slack sign-in remains, while the interface explicitly says Slack MCP access is unavailable. Airtable OAuth depends on upstream connector configuration; the prior provider setup failure remains a limitation. Physical iPhone installation/push delivery and native remote-client OAuth have not been re-proven by desktop viewport checks. The historical successful WorkOS/PAT delivery below predates this UI rollout and is evidence for the preserved credential path, not a fresh claim of OAuth-provider refresh.

Current architecture and setup: [README](../README.md), [credential flows](../docs/credential-flows.md).

## Historical evidence

Everything below records earlier experiments. Instructions describing direct agent authentication, pairing, slices, `/lab` UI or the sample `/design-review` are superseded by the current implementation above. Historical screenshots and provider results remain evidence of those earlier runs.

## Live read-only PAT test

Continue in the single shared checkout `/Users/happyhome/Desktop/agent-passport`. Inspect the current branch and changes before editing; switch branches here rather than creating worktrees.

The user supplied `airtable/scope-prototype-read-only` (`scl_KfyFWYC864MEEK9JTdDRQ`), a shared app-subject PAT connector bound to development and preview only. The dedicated base is `app2SVjDmWa26jwo6`, **Scope Prototype Test**. Real `getTokenResponse(..., { subject: { type: "app" } })` retrieval succeeded. Private calls to Airtable's `whoami` and `bases` endpoints both returned HTTP 200, and the credential exposed exactly that one base. No provider token was printed or saved locally.

Connect supplies an `expiresAt` value even for this connector. The probe preserves that as the **Connect response expiry**, while marking the PAT's provider expiry as unverified (`providerExpiresAt: null`). This is not evidence of OAuth refresh, short-lived provider tokens, or two-account isolation. The helper rejects an unexpected base or extra base results.

This test uses the existing Scope agent-connection authentication instead of WorkOS. Run `node prototypes/pair-existing-auth.mjs` from the repo, then approve the named agent through Scope's existing pairing page. The script privately claims, saves and acknowledges the connection; model-visible output contains only the approval URL and completion status. The helper keeps the agent credential in its private configuration, and sends it only to Scope. The server validates that connection's active state and derives its owner; a client-supplied owner is never accepted.

The server requires `SCOPE_PAT_TEST_OWNER_ID`, pinned to the existing test owner, and the nonsecret named bindings in `config/airtable-pat-bindings.json`. Each entry binds one connector to one expected base; raw PATs remain in Vercel Connect. `CONNECT_AIRTABLE_PAT_CONNECTOR` is no longer used. Choose a configured read-only test account in `/lab`, then invoke the actual Codex `airtable_list_bases` tool with its account ID. Registration accepts only the binding key, verifies its exact base scope, and reuses the matching active account on repeated registration. Approve the access request in `/lab`. Both approval and provider-data delivery must be observed before calling the full test successful. The “Revoke” control for this shared PAT blocks Scope delivery only; it deliberately does not revoke the shared connector for other uses.

**The real end-to-end test passed.** The human reported receiving the notification on their iPhone and approving the actual request. The outstanding native Codex `airtable_list_bases` call then returned `Scope Prototype Test` (`app2SVjDmWa26jwo6`), with no provider token in its result. A native same-key retry returned the same base and expiry; Scope showed one credential history row. This is separate from the earlier SDK timing simulation.

The request is `k578yh42hj91z5rv41rrxskf9d8fjcss`, key `pat-live-native-20261003-01`. During setup, an authenticated diagnostic created the pending request after the already-running helper used its older Bearer authentication format. The server now accepts that existing Scope credential envelope as well as the new helper's connection headers. The native call reused the pending request and completed after phone approval. No user identity or provider credential was fabricated.

After hardening the implementation, the updated helper was additionally run through the official MCP SDK against the **same real approval**. It returned the same base, explicitly reported `providerExpiresAt: null`, confirmed its receipt in Scope, and emitted zero stderr bytes. This additional run proves the new receipt path; the original native call is the proof of desktop-tool continuation. The older process loaded in this chat did not exercise the new PAT-specific checks; those were exercised by the updated helper and fixtures.

The returned `permissionLevel` field is included unchanged as Airtable metadata. The operation only read identity and base metadata. No write operation or provider-expiry/refresh experiment was performed.

![Actual approval and delivery history](pat-approved.png)

## Two-account PAT implementation and live proof

The server map now contains two real, separately owned Airtable accounts:

| Binding       | Connect connector           | Expected base                              | Verified provider identity |
| ------------- | --------------------------- | ------------------------------------------ | -------------------------- |
| `prototype-a` | `scl_KfyFWYC864MEEK9JTdDRQ` | `app2SVjDmWa26jwo6` · Scope Prototype Test | `usrjN3TNbJDt0TRC0`        |
| `prototype-b` | `scl_pT19xygPR0LeNnCxDiIA`  | `appwt2UGDqUP0iZqY` · Untitled Base        | `usrfe7qGqbNku1Pdv`        |

Private preflight calls returned HTTP 200 for both identities and base lists, each exposing exactly its expected base. The owner registered B through the actual Scope UI. Both real requests were then created through the native Codex tool. After the human approved A on their phone, A returned its base while a same-key B call still returned `pending`. Only after the human separately approved B did B return its own base and distinct provider identity. Requests: A `k57cbbk153bkex7158tx3zbcxs8fj5jq`, B `k573n25wzabe4snp1y1tnqqnv98fj9fw`; retry keys `two-pat-live-A-20261003-01` and `two-pat-live-B-20261003-01`.

Fresh installed-helper runs through the official MCP SDK reused those same approvals, returned the correct bases with PAT-specific validation/expiry labels, confirmed receipt for each in Scope, and emitted zero stderr bytes. The native process already loaded in this chat returned the older result format; it proves the native round trip, while the fresh helper runs prove the current implementation. Credentials were not returned to the model.

Owner pinning, exact connector/base pairing, separate approvals, and authenticated recipient checks remain enforced. Automated tests additionally reject a wrong owner, swapped connector/base, substituted provider identity, extra base, removed binding on cached delivery, and another authenticated recipient. Both requests in that first pass used the same existing Scope agent connection. The subsequent WorkOS pass below adds live authentication and a second real recipient check. No schema or migration was needed for this extension.

![Two real approvals with confirmed helper receipt](two-pat-approved.png)

## Implemented after the live proof

- Requests bind the authenticated recipient, selected account, reason and idempotency key. Account/provider/installation bindings cannot be silently replaced after verification. Only the authenticated owner plus the private server bridge can confirm bindings.
- Existing Scope agent authority is checked in each request/delivery transaction, including after provider acquisition. Revocation or cancellation during the external call fences delivery. WorkOS JWT verification and separately approved provider delivery are live-tested against the stable preview.
- Each request has a fixed approval window and its own encrypted replay payload/deadline. Exact token fingerprints group history without sharing or extending another request's delivery expiry. New history rows contain no ciphertext. Scheduled cleanup removes expired delivery ciphertext, preserving decisions and nonsecret history.
- The helper acknowledges receipt after validation and before provider work. Scope preserves first-attempt and receipt timestamps separately. Receipt means receipt into the helper process, not durable local token storage or completed Airtable work. Retries remain possible within the original deadline.
- The app has an approval inbox, cancellation, paginated history and per-credential recipient pagination. Push links target the request. PAT expiry and local blocking are labeled separately from provider revocation.
- Request creation atomically schedules one notification job per saved subscription. Jobs use leases, crash recovery, bounded retries and 404/410 subscription cleanup. Provider errors are never logged. A failed notification does not lose the approval request.

Removed/replaced: synchronous push sending from request handlers, encrypted-token storage in newly created history rows, history recipient discovery limited to the latest 100 requests, mutable installation confirmation, and the ambiguous PAT expiry/revocation labels. The manual test-push endpoint remains for setup.

Existing agent pairing, Slack slices and their regression tests are retained: both existing Scope authentication and WorkOS staging authentication are proven through real PAT delivery. Live multi-account OAuth remains unverified. No legacy-data migration is required; the user explicitly permits deleting development data. No idle-chat wakeup, custom launcher, Dots integration, production rollout or PR merge was added.

![Implemented Scope inbox with confirmed receipt](scope-implemented.png)

## Live WorkOS and Scope-blocking checks

On October 3, 2026, the registered staging helper followed WorkOS authorization to the stable preview, used Scope's existing email-code sign-in, and received explicit human consent for identity/profile/email access. The authorization-code/PKCE exchange saved a WorkOS access token privately. The local callback completed even though Chrome displayed a blocked callback page. Neither a provider token nor the WorkOS token was printed. The original helper's Scope agent configuration is preserved; this test uses a separate mode-0600 `workos-test.json` configuration.

The first authenticated MCP call exposed the Standalone subject-mapping bug described above. After the fix, the real signed token mapped to the correct Scope owner, and the deployed remote MCP endpoint completed initialization, listed `request_approval`, and created separate A/B requests. The same existing consent was reused on another login without broadening permissions. This is repeated sign-in, not an OAuth refresh-token test; the prototype login does not retain refresh tokens.

- A (`k5716vnz3fs9ytg3x9291hwmjs8fje79`, key `workos-cancel-A-20261003-01`) was denied through the actual UI without releasing a PAT. The helper returned `denied` on the same key.
- B (`k5728j0jn1z1v85pseg4hxrem98fk8db`, key `workos-live-B-20261003-01`) initially returned `pending` with no token. A different real authenticated recipient, the existing Scope agent connection, received HTTP 400 for B's request and no credential. The human later approved B, but collection happened after its original approval deadline; the helper correctly returned `expired`.
- The human separately approved fresh B request `k57baqv0zfwttvf4x7psz4jnvx8fkm8j` (key `workos-live-B-20261003-02`). The installed helper, launched through the official MCP SDK with the real WorkOS token, returned B's expected identity `usrfe7qGqbNku1Pdv` and base `appwt2UGDqUP0iZqY` (Untitled Base). Scope recorded helper receipt at 11:46:10 AM Pacific. Output contained provider data and nonsecret expiry metadata, no credential; stderr was empty.
- Clicking **Stop further delivery** on that approved B request changed it to `cancelled`. The same helper/key then returned `cancelled` with no credential and empty stderr. B's account remains active; this cancelled only the specific approval.
- The UI's **Block future delivery** control was exercised on A (`j975rpvz3estx8mjbyfrmjajs18fkyjz`). New A requests were rejected while B remained independently pending. A private Connect/Airtable `whoami` check after the block returned HTTP 200 for A's expected identity: the PAT remains active at the provider. No provider-side revocation was attempted.

A is intentionally left blocked in Scope after this test. The underlying connector is untouched. Re-registering the configured A binding creates a new account record whose future deliveries require fresh approval. The account status label says **Scope delivery blocked**, avoiding an ambiguous claim that the PAT itself was revoked.

The agreed PAT flow is complete with no remaining human approval step. This WorkOS proof uses the installed helper through the official MCP SDK; the earlier native Codex tool proof used existing Scope agent authentication. Native remote Codex OAuth sign-in has not been tested. PATs do not exercise Airtable OAuth refresh or provider revocation; those require an OAuth setup or an explicit provider-side revocation experiment and do not block the current PAT flow.

![WorkOS-approved delivery with confirmed helper receipt](workos-approved.png)

![Stopping the approved WorkOS delivery](workos-cancelled.png)

## Interactive product design review

A new review area at [`/design-review`](https://scope-preview.vercel.app/design-review) explores a calmer experience across decisions, outcomes, connections, agent identity and notifications. Local address: `http://localhost:3000/design-review`. It uses sample data and local React state only, remains behind Scope sign-in, and returns not-found in Vercel production. The working approval routes, WorkOS/MCP, private helper and account bindings are unchanged by this review.

[Design direction, journeys, tradeoffs and visual evidence](scope-design-direction.md) explain the reasoning. Try Approve/Deny, expand an uncertain outcome, cancel or complete an example account sign-in, rename an agent, and walk through notification choices. This is a reviewable implementation before broader adoption; it does not claim the redesigned connection callback or sample permission scopes are already wired into live accounts.

## Integrated Scope UI (October 3, 2026)

The working flow uses Scope’s existing typography, green accents, shared controls and sidebar. `/approvals` is one unified paginated list with one row per request. Each row shows the saved agent name where available, account, current outcome and a contextual timestamp. Pending requests sort first within loaded results and expose Approve/Deny directly. The optional Needs approval filter applies to loaded requests; earlier requests remain loadable.

Expanding a row reveals a lightweight visual timeline: requested, decision, recorded delivery attempt, confirmed receipt, window ending and stopped sharing where known. Approval never implies receipt. A window that ended before any collection says “Not collected”; an attempted delivery without receipt says “Receipt unconfirmed.” New stops record their actual timestamp; old records do not invent one. Confirmed receipt remains visible after expiry or blocking, and blocking explicitly leaves previously received access unaffected.

Product views omit raw IDs, exact recipient strings, delivery counts, technical expiry diagnostics, PAT labels and diagnostic reasons. Airtable accounts live in Connections alongside Slack, with connection checking, adding configured accounts and future-delivery blocking. The Airtable sign-in option remains available. Helper configuration still uses the existing backend identifiers, which are no longer exposed as product UI fields. No logs screen was added.

`/notifications` retains Home Screen installation guidance, permission handling and subscription reuse. `/authorize-agent` retains the WorkOS continuation. `/lab` redirects request/account/WorkOS parameters, `/probe-sw.js` preserves existing subscriptions, and the manifest’s `/lab` identity preserves existing installations while opening `/approvals`. Private helper, authenticated recipient bindings, replay recovery and provider calls remain unchanged.

The latest check used `http://localhost:3000` and real development data. Request `k574f9dbh0dz665cadgqwzesah8fkzcv` appeared once with its timeline open at a 390 px viewport. Both action buttons measured 44 px high with no horizontal overflow. Tapping Deny kept the same row, added its decision event and made a native helper retry with key `scope-timeline-B-20261003-01` return `denied` without a credential. Desktop inspection covered a previously received delivery that was later stopped. Account A remains blocked and B remains active.

Earlier integration checks verified B’s connection, push-service acceptance for one existing subscription and a WorkOS PKCE sign-in with existing consent. A new physical iPhone installation or receipt was not re-confirmed in this UI pass. Automated checks cover owner-only names and deep links, secret exclusion, terminal actions, distinct approval/delivery/receipt states, real stop timestamps, legacy redirects and notification installation behavior.

![Unified request list and expanded timeline](scope-timeline-desktop.png)

![Phone approval actions and timeline](scope-timeline-mobile.png)

![Same request after denial](scope-timeline-denied.png)

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

Scope completes `external_auth_id` only after its own authenticated session, using external identity `scope:<Convex user ID>`. Resource requests verify the WorkOS JWT's signature, issuer, audience, expiry, subject, client ID and consent/session ID. For Standalone Connect, the signed `sub` preserves the `scope:<Convex user ID>` supplied by the authenticated completion endpoint. Resolve that namespaced subject only after JWT verification. It is not a User Management record: the first live attempt exposed an incorrect lookup that returned 404 and has been fixed. For native WorkOS user subjects, the server retains the [WorkOS user](https://workos.com/docs/reference/authkit/user) lookup and verifies its linked `external_id`. Requester IDs are derived from verified claims; tool arguments cannot nominate another owner.

The internal WorkOS requester binding is `sub:client_id:sid`; product rows use a human-readable helper label. This identifies an authenticated OAuth user/client/consent. It does **not** distinguish two chats sharing the same OAuth consent. Unique cryptographic identity per agent/chat needs separate client credentials or another attested identity design.

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
  "origin": "https://scope-preview.vercel.app",
  "issuer": "https://YOUR-WORKOS-ISSUER",
  "clientId": "YOUR-PUBLIC-OAUTH-CLIENT"
}
```

Run `node plugins/scope-local/login.mjs` locally and open its sign-in link. This performs loopback authorization with PKCE and saves the **WorkOS** access credential in that private file. It never saves a provider credential. The login prototype does not retain refresh tokens; repeat login when the WorkOS access credential expires. Do not paste access tokens into chat or tool arguments.

Once the installed plugin is loaded by a Codex chat, invoke `airtable_list_bases` with the account ID from private developer setup, a reason, and a random 16–128-character key containing letters, numbers, underscores or hyphens. Preserve exactly the same key/account/reason on retry. Example non-secret arguments:

```json
{
  "accountId": "ACCOUNT-ID-FROM-SETUP",
  "reason": "List bases for this task",
  "key": "unique-request-key-123456",
  "waitSeconds": 90
}
```

The helper privately requests approval, waits, retrieves an approved access token over authenticated HTTPS, checks Airtable identity locally, and calls Airtable locally. Successful tool output includes only selected base data and account/expiry metadata. It never exposes a token retrieval MCP tool. Errors are generic, stderr stays empty, and the fixed Airtable URLs reject redirects. Provider content is still untrusted data.

The remote endpoint `/api/probe/mcp` is a separate WorkOS OAuth/approval-status experiment. Its `request_approval` tool never retrieves or returns a provider credential. A remote Codex OAuth consent and the separately registered local helper client have different requester identities; their approval IDs cannot be interchanged. Use the local helper for the end-to-end provider-data experiment.

Local install is proven. Public distribution is a separate gate: OpenAI's [plugin packaging documentation](https://developers.openai.com/plugins/build/plugins) distinguishes local testing from supported submission paths; local-only MCP submission requires the documented OpenAI support path rather than assuming arbitrary local commands are accepted publicly.

## Phone and timeout test procedure

Canonical preview: [Scope approvals](https://scope-preview.vercel.app/approvals). WorkOS staging now uses this stable external sign-in URI and `https://scope-preview.vercel.app/api/probe/mcp` as its sole default resource. Staging issuer/API-key fields are configured; live WorkOS sign-in and authenticated MCP tool discovery now pass. The server respects the configured stable origin for same-origin checks, callback URLs and JWT audience. Generated deployment URLs are build references rather than the canonical sign-in address.

Vercel has a verified project-domain binding from `scope-preview.vercel.app` to `codex/scope-approval-prototypes`. Its native Git deployment integration automatically assigns this address after successful deployments from that branch. Other branches and production cannot claim the address through this binding; no additional GitHub deployment secret or alias workflow is needed. See [Vercel branch domains](https://vercel.com/docs/domains/working-with-domains/assign-domain-to-a-git-branch).

The prototype branch has preview-only environment overrides for the development Convex URLs, probe encryption/bridge secrets, pinned test owner, VAPID configuration and stable origin. Production is unchanged. The build command is `pnpm build`, without a Convex deployment. Phone notifications are origin-specific: use the stable address for future sign-in, Home Screen installation and subscription setup.

The development backend is `bright-dinosaur-692`. The frontend runs locally at `http://localhost:3000/approvals`; use the HTTPS preview recorded below for a physical phone. The preview build uses `pnpm build`, not `convex deploy`. Probe server code refuses Vercel production execution. Existing production flows are not a substitute test target.

1. Open the HTTPS preview on iPhone, sign in using the existing Scope flow, add it to Home Screen, and launch it from the icon.
2. Tap Enable notifications, grant permission, and send a test notification. Confirm actual device receipt separately from server acceptance.
3. Start the local tool call in an ordinary Codex chat. On the phone, inspect the requester, account and access requested; approve. Confirm the waiting chat receives provider data, with no bearer credential visible.
4. Repeat with a delay longer than the client's tool timeout. After the user sends another message, retry with the identical key. Verify the same request/credential is used. No idle wakeup is required.
5. Deny another request; try a different signed-in owner; revoke during acquisition. Each must fail without delivering credentials. Inspect the same request row and its timeline.

The development backend additionally requires `SCOPE_VAPID_PUBLIC_KEY` and `SCOPE_VAPID_PRIVATE_KEY`, matching the frontend subscription key pair. Configure them privately; never paste them into chat.

The request lifetime is 30 minutes, acquisition lease 30 seconds, helper/server wait at most 240 seconds, and remote route maximum duration 300 seconds. These are implementation bounds, not a promise that a host will wait that long. Lost responses recover the stored encrypted credential until the approval or provider token expires.

## Checks and remaining limits

Latest local validation: 140 application tests and six helper tests, plus TypeScript, lint and the Webpack production build. See the draft PR checks for the latest commit result. The final development functions were deployed to `bright-dinosaur-692`. The native live result and updated-helper live receipt are recorded above.

`pnpm build` explicitly uses Next's supported Webpack builder. The default Turbopack builder repeatedly failed locally during CSS processing with `binding to a port: Operation not permitted`; the Webpack production build passed. Pre-push still runs the full normal build and tests.

```sh
pnpm test
pnpm exec tsc --noEmit
pnpm exec eslint .
pnpm build
node --test prototypes/helper.check.mjs
SCOPE_INSTALLED_HELPER=/absolute/installed/plugin/server.mjs node --test prototypes/mcp.check.mjs
```

This is a development/preview implementation, not a completed production cutover. The owner inbox and credential/recipient history are paginated; connected accounts are limited to 100 displayed rows. Token deduplication is per account. JavaScript clears references after a local call but does not guarantee secure memory zeroing. A canceled call may have already finalized a credential, which is why retry is idempotent. Provider refresh/rotation behavior and live provider revocation remain unverified. WorkOS staging sign-in, authenticated remote MCP discovery, separately approved PAT delivery, and cancellation of that delivery passed. An expired real WorkOS token returned HTTP 401 with an OAuth challenge; this does not prove refresh-token handling or provider PAT expiry. Two-account PAT selection and independent approvals passed as recorded above; they do not establish multi-account OAuth behavior. Physical-phone receipt/approval was reported by the user, and the ordinary native Codex tool completed successfully. Sleep/restart and idle-chat wakeup are not proven; after a timeout, manually re-prompt and retry the same key.

Private setup files are ignored by Git and Vercel uploads. `SCOPE_PROBE_SECRET` is shared only between the prototype server and development Convex deployment; `SCOPE_PROBE_TOKEN_KEY` is the server's AES-GCM key; VAPID private material remains server-only. No WorkOS or Airtable provider secret is committed.

![Local lab after push service acceptance](approval-lab.png)
