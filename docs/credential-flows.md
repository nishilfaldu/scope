# Credential flows

The current model has connected accounts, access approvals and push subscriptions. Agents are labels on approval snapshots. There is no separate agent authorization table and no server-side command binding.

## Connection

The signed-in owner selects a product key from the server-owned connector catalog. Scope chooses the configured Connect target and starts consent. Scope inserts a provisional account with a unique Connect subject, saved authorization parameters and a browser proof hash. The callback verifies the owner and proof, resolves the identity and installation, and records available permission information, and records those references on the same row before deciding whether to activate it. Expired, mismatched and failed setups retain a recovery path. A duplicate grant cannot be activated or revoked while another saved account holds it.

Saved-account management and CLI discovery use indexed pagination. Connector metadata is needed only to start new consent. Confirmed disconnections are hidden with an indexed visibility field. Failed disconnections remain available through the same action.

## Approval

The Next service verifies the WorkOS bearer signature, issuer, audience/client and session claims. A private service boundary forwards those immutable claims to Convex. Convex checks owner, issuer, client, session, account and grant version. A transaction reuses an eligible active approval or pending request. Display names and reasons never authorize access.

Pending requests wait 30 minutes. Approval starts a separate 15-, 30- or 60-minute collection window, defaulting to 30 minutes. Scheduled Convex mutations move expired approvals into History. The UI uses subscriptions; only a pending countdown has a local timer. An aggregate supplies the full pending count, independent of pagination.

## Collection

Preflight checks the approved window and current account. Token retrieval uses the saved Connect connector, subject, issuer, installation and authorization parameters with `forceRefresh: true`. The SDK cache is bypassed; Connect may return the same token. A final mutation checks the same reference and authority again. Scope does not independently inspect the delivered token’s identity or effective permissions. Ending approval, disconnecting, changing the grant or expiry during IO prevents release. Tokens remain in the server and CLI response path; they are never written to Convex or exposed to browser pages.

Every token includes all permissions granted when you connected the account. The stated purpose does not restrict the token.

Each collection increments a count and records first/last times. A private receipt proof records arrival. Collection and receipt do not extend or close approval. There is no unbounded per-token log.

## Execution and revocation

Commands belong to the local invocation journal. New commands can share an approval. A journal marked running or finished cannot rerun automatically. Cancellation stops local execution without ending another invocation's shared approval. Pipe draining after child exit and timeout is bounded even when detached descendants inherit output streams.

End approval stops Scope collection only. Disconnect first blocks the account, then calls Connect revoke with the exact subject and installation. Completion is monotonic. A retry uses the same reference and accepts only an explicit absent user authorization as already complete. Connect handles provider revocation where supported; Scope does not independently call Slack revoke or test invalidation. A collection window never changes a provider token's lifetime.

The Access page shows Needs approval, Active approvals and History. Each has indexed pagination, one current status and optional Activity. Permissions recorded at setup belong to the collapsed account disclosure in Connections. Unknown permissions are shown as unavailable. Connect has no uniform granted-permissions field. Slack inspection is a setup helper for identity and permission information; it is not part of delivery or disconnect.

Sources: [Connect SDK](https://vercel.com/docs/connect/ts-sdk-reference), [revocation semantics](https://vercel.com/docs/connect/concepts/tokens#revocation).
