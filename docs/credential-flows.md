# Access delivery in Scope

Scope uses existing owner login, WorkOS Standalone client OAuth, and Vercel Connect provider authorization. An incoming client token must have a valid RS256 signature, issuer, exact `/api/mcp` audience, expiry and nonempty `sub`, `client_id`, `sid`. Signed `sub=scope:<ownerId>` must map to an existing Scope user. The issuer/subject/client/consent tuple identifies a client connection, not an individual chat.

## Request and approve

Hosted MCP exposes four control-plane tools and no credential delivery tool. The requester chooses an owned active helper collector. Collector eligibility comes from server configuration, never caller policy. A local eligible helper defaults to collecting its own request.

An approval binds one account authorization and grant/profile version, requester, collector, intent, immutable display snapshot, retry key and a thirty-minute deadline. Approval does not extend this deadline. Reusing a key with changed account, collector, reason or intent fails. The owner independently approves or denies in Scope.

## Fresh acquisition and private receipt

The designated helper authenticates at `/api/agent/deliver`. A preflight rejects unavailable requests before provider IO. Every permitted attempt calls Connect with the frozen opaque grant subject, optional selected installation, fixed scopes and `forceRefresh: true`. Provider verification checks expected identity, tenant where applicable, expiry, and exact granted scope evidence.

After IO, the final Convex transaction rechecks the current time, owner, exact collector, both connections, active account, integration and grant/profile versions. Only then may Next release the credential to that helper. No tokens, encrypted replay, credential fingerprints or acquisition leases are stored in Convex. A lost response obtains fresh credential bytes under the same approval; retries never move authority to another account or extend the deadline.

A stable private receipt proof survives delivery retries. It is excluded from owner and hosted results. The exact collector may acknowledge historical receipt even after local sharing stops; acknowledgement never renews authority and does not assert completed provider work.

## Stop, reconnect and cleanup

| Action                 | Effect                                                                                                        |
| ---------------------- | ------------------------------------------------------------------------------------------------------------- |
| Deny or expire         | Blocks new release; continuing requires another request.                                                      |
| Stop request           | Blocks future release under that request.                                                                     |
| Stop client connection | Blocks release for its existing approvals; WorkOS consent is unchanged.                                       |
| Stop account           | Blocks Scope sharing immediately; Connect disconnect outcome is reported separately.                          |
| Explicit reconnect     | Replaces the authorization with a new opaque subject and increments grantVersion; old requests cannot use it. |
| Receipt                | Records received access without asserting completed work or token revocation.                                 |

Previously released bearer access may remain active until provider expiry/revocation. JWT validation alone does not instantly observe external WorkOS consent revocation; Scope's local stop is immediate, while external revocation detection is bounded by token expiry.

Account connection attempts are owner/browser-proof-bound and expire after ten minutes. Completed callback retries validate the still-active exact account binding. Superseded Connect references remain on the attempt until successful cleanup acknowledgement, so lost responses and failed cleanup can retry. Expiry may discard an unforgotten reference; this is not a perpetual cleanup or provider-revocation guarantee.

## Provider readiness and notifications

Airtable REST and Slack read operations share the same approval engine. Fixed profiles are `schema.bases:read` and `channels:read`. The old MCP-targeted Airtable connector is rejected for REST. Both integrations are disabled until their own live OAuth acceptance evidence is recorded; PAT fallbacks are removed.

Push subscription endpoints use an explicit service allowlist. Durable notification jobs use fenced retries with cancellation and crash recovery. The owner-only test action returns counts, never subscription secrets. Push-service acceptance does not prove device receipt. Notification clicks open the authenticated exact request when available.
