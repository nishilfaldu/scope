> Current disconnect behavior: Scope now delegates revocation to Vercel Connect for the exact subject/installation. The explicit Slack revoke/invalidation checks described below are historical acceptance evidence from the earlier implementation. They are not a guarantee of the current flow; provider revocation remains subject to Connect’s documented limits.

# Slack live acceptance

Status: automated checks and the live Slack/CLI/physical-phone approval flow passed. Only one Slack workspace was available.

Required evidence: configured versus effective scopes; real CLI login; request/phone approval/private receipt/read-only script output; verified Slack revocation; lower-scope reconnect; stale approval rejection; distinct workspace isolation when a second workspace is available. Never send real Slack messages for write-denial tests. Record only identities, permission names and results, never credentials.

Observed on 2026-10-03: shared `slack/scope-connect-test` grants rotating user tokens. `auth.test` confirmed the expected Slack user/workspace and all 16 configured scopes plus Slack's implicit `identify` scope. Scope now includes `identify` in the displayed and frozen connection permissions. The rotating grant was rejected before any credential release: revoking one access token cannot prove the underlying grant revoked. No app uninstall was attempted.

Hosted AuthKit and ordinary first-party application setup replaced the obsolete Connect/Standalone experiment. The Web default application is `client_01M41C6NBGYJ9APFYN9WKGGVP9`; the CLI is `client_01M427ANDBDGQ3WBX3XE4568VX`. Native device authorization resolves to `wonderful-fog-15-staging.authkit.app`. Live device login completed; the signature-verified token has the exact modern default-app issuer, immutable WorkOS user, signed CLI client ID, session ID and no `aud`. A real authenticated CLI account-list call succeeded. Browser login completed and Convex authenticated the same owner.

The isolated nonrotating Slack app `Scope CLI acceptance` (`A0C6DCTHK7F`) is configured through `slack/scope-cli-acceptance` (`scl_rIcr6oeMlnR1yGmOm6udPg`) and attached only to Scope development/preview. Live Slack grant, private delivery/read and revoke/reconnect checks passed as recorded below.

Live CLI execution: account `nh74ynzv6vr0zy0vb9a6tc9rvd8fn37s`, generation 1, request `mn70pzf2y6917ebh05m7dq0bgs8fncw8`. Browser approval displayed purpose separately from the full 17 effective permissions. The CLI privately collected, acknowledged receipt and ran `node examples/slack-channels.mjs` once, exit 0. Slack returned three public channel names. Reusing the invocation ID was rejected before another execution. Forced native AuthKit refresh rotated the private refresh token and preserved the signed CLI/user/session identity.

Disconnect completed through Slack `auth.revoke`, rejection of the old token by `auth.test`, and removal of the exact Connect grant. UI showed “Slack authorization revoked. Account disconnected.” with Reconnect and no Manage. Old request status became unavailable. The isolated connector was then reduced to `channels:read`; reconnect evidence follows.

Preview `scope-65t28bsfq-nishil-faldus-projects.vercel.app` reached Ready and owns the `scope-preview.vercel.app` alias. The CLI polling command transiently reported “Not authorized”; a subsequent authoritative deployment inspection confirmed the build succeeded.

Lower-scope reconnect succeeded on the same account at generation 2. Slack's effective grant is exactly `channels:read` plus implicit `identify`, with no history/write scopes retained from generation 1. A real `/api/cli/deliver` call for the old approved request returned unavailable after reconnect. This proves the revoked broad grant did not silently survive Slack's additive OAuth behavior.

All 94 tests, ESLint, TypeScript and production build passed after the first-party AuthKit migration. The user confirmed both the physical phone test notification and the real reduced-permission request notification arrived, and approved the request on their phone. Only one authorized Slack workspace was available; distinct-workspace isolation is covered automatically, not claimed as live evidence.

Physical phone evidence: user confirmed test arrival, then request-notification arrival and approval for `mn79e83q946fz6npkpwrsthwnd8fngmt` through `scope-preview.vercel.app`. This request used generation 2's reduced grant. The CLI completed a second private receipt and read-only script with exit 0. No browser screenshot or provider acknowledgement is substituted for this user-confirmed device evidence.

Stopping the native CLI connection in Agents succeeded. A real subsequent `scope accounts` call was rejected instead of recreating the stopped connection. `scope logout` then removed the private local session. The browser logout check exposed unset redirects on the new ordinary Web application; its staging homepage, initiate-login and exact local/preview sign-out URIs were configured. Preview sign-out returned to Scope, and requesting a protected page then showed hosted AuthKit sign-in.

Obsolete development-only Convex Auth and Standalone secrets (`RESEND_API_KEY`, `JWKS`, `JWT_PRIVATE_KEY`, `SCOPE_HELPER_CLIENT_ID`) were removed after the replacement deployment succeeded.

Final hosted-method configuration: Magic Auth enabled; password, passkeys, enterprise SSO and all social demo providers disabled in the staging environment. Fresh protected-page navigation showed only the hosted email sign-in control.
