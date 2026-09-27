# Credential handoffs in Scope

The public agent entry point is `GET /` on the Convex HTTP origin. It returns the route index, an ordered integration guide, and `rediscoveryUrl`. An agent can reread that guide at any time, but it must retain its private claim handles and credentials. Scope does not wake agents or send messages to their chats. A running or resumable agent must poll.

## Three separate clocks

All `*At` values and `serverTime` are Unix milliseconds.

| Field                  | Meaning                                                                                              |
| ---------------------- | ---------------------------------------------------------------------------------------------------- |
| `approvalDeadlineAt`   | Last moment the operator can approve (15 minutes for pairing, 24 hours for a slice request)          |
| `pickupDeadlineAt`     | Last moment the agent can make its first claim (5 minutes after approval)                            |
| `ackDeadlineAt`        | Last moment it can first acknowledge a claimed new connection or slice (2 minutes after first claim) |
| `activationDeadlineAt` | Equivalent deadline for a replacement connection                                                     |
| `sliceExpiresAt`       | End of the approved slice grant, measured from approval                                              |
| `credentialExpiresAt`  | End of one issued provider or broker credential, when known                                          |

Approval is a human decision, not usable authorization. A new connection or slice is staged until its claim is acknowledged. A replacement connection is staged until activation atomically swaps the old and new generations. A completed resource can later be revoked or expire; status reports both handoff and current resource state. Delayed expiry jobs inspect the current phase, so an old pickup job does not retire a claimed handoff. Terminal causes follow event time, not cleanup order: the first elapsed deadline, grant expiry, or revocation wins. A deadline wins a timestamp tie because completion at the deadline is already too late. Later revocation can change current resource status without rewriting the earlier cause.

## Pair an agent

1. `POST /api/agent-connections` with JSON `{ "agentName": "Research agent" }`. Share only `connectUrl` with the operator. Keep `claimHandle` private.
2. Poll `POST /api/agent-connections/status` with JSON `{ "claimHandle": "ach_..." }`, initially about every five seconds, then with bounded backoff while pending. Stop on denial or timeout. Claim promptly after approval.
3. `POST /api/agent-connections/claim` with the same JSON. The first successful claim fixes the completion deadline. Persist the returned `agentConnectionId` and `agentConnectionSecret` before proceeding. A lost claim response can be retried with the same handle until the fixed deadline.
4. For a new connection, `POST /api/agent-connections/ack` with JSON `{ "claimHandle": "ach_...", "agentConnectionSecret": "acs_..." }`. For a replacement, `POST /api/agent-connections/activate` with headers `x-agent-connection-id: <returned ID>` and `x-agent-connection-secret: <returned secret>`. Read `ackRequired`, `activationRequired`, the applicable deadline, and `nextAction` in the claim response; never call both completion endpoints.
5. A lost completion response can be retried even after the deadline. The endpoint confirms historical completion and current authority without reactivating a revoked resource. A reclaim after completion returns `409 CLAIM_ALREADY_ACKNOWLEDGED`; inspect status. The agent may request slices only while its connection is active.

The pairing name is requester supplied; it is not verified identity. For planned rotation, the agent includes its current connection headers when creating the pairing link. The operator approves the replacement. The old generation stays active until activation commits; its slices remain attached to the stable agent lineage. An operator revoke permanently kills that lineage and its slices.

## Request a slice

1. With active connection headers, `POST /api/access-requests` with JSON `{ "apps": ["files"], "ttlMs": 3600000, "reason": "Read project files" }`. A random task-stable `Idempotency-Key` header of 32–128 characters allows retry of the same pending or approved request. Keep that key and returned `claimHandle` private; share only `approvalUrl`.
2. Poll `POST /api/access-requests/status` with JSON `{ "claimHandle": "ch_..." }`. It returns decision, `handoffStatus`, `resourceStatus`, cause, applicable deadlines, and `nextAction`. Approval starts the slice's approved lifetime, but the slice remains staged.
3. After approval, `POST /api/access-requests/claim` with the same JSON. Persist `sliceToken` and `sliceSecret`, then `POST /api/access-requests/ack` with JSON `{ "claimHandle": "ch_...", "sliceSecret": "ss_..." }` before `ackDeadlineAt`. Retry a lost claim response before the fixed deadline; retry a lost ack response afterward to confirm its recorded result. Ack does not extend `sliceExpiresAt`.
4. After status is ready, `GET /api/accounts?app=files` with headers `x-slice-token` and `x-slice-secret` to select a `bindingId`. `POST /api/credentials` with JSON `{ "sliceToken": "st_...", "sliceSecret": "ss_...", "app": "files", "bindingId": "<selected binding ID>" }`. `bindingId` may be omitted when exactly one account is allowed. A staged or revoked slice cannot mint or use protected discovery.

`auto` minting returns a provider credential or a Google broker credential immediately. Under `approve`, `/api/credentials` returns a one-time approval URL and `requestId`. After approval, `POST /api/credentials/claim` with JSON `{ "sliceToken": "st_...", "sliceSecret": "ss_...", "requestId": "<returned ID>" }` performs issuance. That per-mint claim is not a passive status check and requires no acknowledgment (`ackRequired: false`). Its separate one-minute claim window is unchanged.

## Failure and recovery

| HTTP/code                 | Meaning and response                                                                        |
| ------------------------- | ------------------------------------------------------------------------------------------- |
| `401 UNAUTHORIZED`        | Unknown or incorrect private credentials; no lifecycle details                              |
| `409 CLAIM_ACK_REQUIRED`  | Correct credentials, unfinished ack; follow `completionPath`, required fields, and deadline |
| `409 ACTIVATION_REQUIRED` | Correct replacement credentials, unfinished activation; follow the returned completion path |
| `403 REVOKED`             | Correct credentials, but authority was withdrawn; see reason                                |
| `403 EXPIRED`             | Correct credentials, but a deadline or grant lifetime ended                                 |

A denied, timed-out, or later revoked request remains inspectable through its private status endpoint, which returns HTTP 200. The operator's pairing and request pages show the same handoff phase and reason. Wrong credentials never reveal that state. HTTP status uses one action timestamp for both its projection and `serverTime`. Owner views refresh their clock every 30 seconds; backend authorization checks each request immediately.

Staged slices cannot change mint policy or account bindings. Complete the claim first; changing policy never repairs an incomplete handoff. Expired Google broker credential hashes and metadata are retained so they continue to return `403 EXPIRED`, while unknown hashes return `401 UNAUTHORIZED`. This costs one retained metadata row per issuance; there is no broker-expiry deletion job.

Provider OAuth tokens are stored encrypted in Convex. A slice binds specific connected accounts to apps. Gmail, Calendar, and Google files have separate Google connection rows. Google files combines Drive, Docs, and Sheets in one grant and mints an opaque broker credential; Google bearer tokens remain server-side. Provider-native tokens issued for other apps can remain usable until the provider expires or revokes them, even after Scope revokes future minting.
