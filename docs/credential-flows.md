# Access delivery in Scope

Scope has one agent authorization path: WorkOS-authorized MCP. There are no direct agent invitations or slice credentials. Old direct approvals are fenced to their retired recipients and never transferred to a new MCP authorization.

## Authenticate and request

1. The MCP client signs in through WorkOS for Scope's exact protected resource. Public local clients use PKCE and a validated state/issuer callback. The server verifies the JWT signature, issuer, audience, expiry, subject, client and consent, then resolves the linked Scope owner.
2. `request_approval` selects one verified Airtable account, a task-stable retry key and reason, with optional human-readable intent. It returns request status and an owner approval link. It returns no provider credential.
3. The owner decides in Scope. Read and mutation ownership checks are independent of provider identity. Stopped accounts, stopped recipients and elapsed deadlines cannot authorize delivery. Retrying a key with another account or reason fails. Existing retries without the newer intent field remain compatible.

## Acquire, replay and confirm

The private local helper calls the authenticated delivery endpoint. A single acquisition lease wins. Vercel Connect obtains the exact account's credential; Airtable verifies provider identity and, for read-only bindings, exactly the configured base. Scope rechecks account, requester, request and lease after the asynchronous provider call before saving encrypted delivery material.

A lost response can replay the same encrypted delivery within its fixed deadline. Retry does not extend the window. Token history deduplicates the same provider credential while preserving each request's distinct expiry and receipt. Ciphertext, leases and receipt secrets are excluded from owner presentation.

The helper uses access only against its fixed Airtable API operation, then acknowledges receipt through the same authenticated recipient. The acknowledgment is idempotent. Approval, attempted delivery and confirmed receipt remain separate timeline milestones. Scope cannot confirm completed agent work.

## Boundaries

| Event                     | Effect                                                                                       |
| ------------------------- | -------------------------------------------------------------------------------------------- |
| Denied or expired request | No new access delivery; a new task needs a new request.                                      |
| Stop a request            | Blocks later delivery and replay for that request.                                           |
| Stop an MCP connection    | Blocks its requests, acquisition finalization and replay. It does not revoke WorkOS consent. |
| Stop an account           | Blocks future Scope sharing immediately; provider disconnection is reported separately.      |
| Sharing window ends       | Clears encrypted replay material while preserving decision and receipt history.              |
| Helper receipt            | Confirms received access, without asserting task completion or provider expiry.              |

Previously received access may remain active until the provider expires or revokes it. The configured shared Airtable PAT is not revoked by local stop sharing. Slack account connection is supported, but no Slack MCP access tool currently exists.

## Connections and notifications

An Airtable OAuth attempt stores a unique subject and owner/browser proof for ten minutes. Failed, cancelled, expired or wrong-owner completion cannot add an account. Successful completion verifies the provider and exact installation before adding it; identical callback retries return the same account without duplicating or reactivating a blocked binding. Configured read-only bindings are verified before atomic save and cannot silently select the other base.

Push jobs are durable and use fenced retries. Expired subscriptions are retired. Notifications are optional. Browser permission alone does not mean this device has a saved subscription, and acceptance by a push service does not prove device delivery.
