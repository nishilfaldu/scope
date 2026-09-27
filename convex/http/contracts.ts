import { ALL_APPS } from "../domain/apps";
import { AGENT_ERROR_CODES, AGENT_ERROR_GUIDANCE } from "../lib/errors";

// Human-readable route discovery. Response contracts belong to the handlers and
// their HTTP tests, not a second handwritten schema.
const routes = [
  { method: "GET", path: "/", summary: "API route index." },
  {
    method: "POST",
    path: "/api/agent-connections/activate",
    summary: "Activate claimed replacement credentials idempotently.",
  },
  {
    method: "GET",
    path: "/api/health",
    summary: "Liveness and OAuth configuration.",
  },
  {
    method: "POST",
    path: "/api/agent-connections/cancel",
    summary: "Cancel a pending agent connection invitation.",
  },
  {
    method: "POST",
    path: "/api/agent-connections/revoke",
    summary: "Revoke the calling agent connection and all of its slices.",
  },
  {
    method: "POST",
    path: "/api/agent-connections",
    summary:
      "Create a short-lived operator pairing link and private claim handle.",
  },
  {
    method: "POST",
    path: "/api/agent-connections/status",
    summary: "Poll an agent pairing decision with its private claim handle.",
  },
  {
    method: "POST",
    path: "/api/agent-connections/claim",
    summary:
      "Claim credentials; new claims retry until acknowledged or expired, replacements until activation.",
  },
  {
    method: "POST",
    path: "/api/agent-connections/ack",
    summary:
      "Acknowledge storage of a new connection secret using its claim handle and secret.",
  },
  {
    method: "POST",
    path: "/api/access-requests",
    summary:
      "Create an owner-bound slice request using an active agent connection.",
  },
  {
    method: "POST",
    path: "/api/access-requests/status",
    summary: "Poll onboarding with the claim handle.",
  },
  {
    method: "POST",
    path: "/api/access-requests/claim",
    summary: "Claim approved slice credentials until acknowledged or expired.",
  },
  {
    method: "POST",
    path: "/api/access-requests/ack",
    summary:
      "Acknowledge storage of slice credentials using the claim handle and slice secret.",
  },
  {
    method: "POST",
    path: "/api/access-requests/cancel",
    summary: "Cancel the calling agent's pending slice request.",
  },
  {
    method: "POST",
    path: "/api/credentials",
    summary:
      "Mint an allowed app credential. Drive, Docs, and Sheets return an opaque Scope broker credential; other apps return provider-native tokens.",
  },
  {
    method: "POST",
    path: "/api/google/operations",
    summary:
      "Run a vetted Drive, Docs, or Sheets operation with an opaque broker credential.",
  },
  {
    method: "POST",
    path: "/api/credentials/claim",
    summary: "Claim an approved credential request.",
  },
  {
    method: "POST",
    path: "/api/credentials/cancel",
    summary: "Cancel a pending token request using its slice credentials.",
  },
  {
    method: "POST",
    path: "/api/slices/revoke",
    summary: "Revoke a slice using that slice's credentials.",
  },
  {
    method: "GET",
    path: "/api/apps",
    summary: "Discover available apps for a slice.",
  },
  {
    method: "GET",
    path: "/api/accounts",
    summary:
      "List the accounts allowed for one app on a slice; requires an app query parameter and returns binding IDs.",
  },
  ...ALL_APPS.flatMap((app) => [
    {
      method: "GET",
      path: `/api/${app}/connect`,
      summary: `Start ${app} OAuth.`,
    },
    {
      method: "GET",
      path: `/api/${app}/callback`,
      summary: `${app} OAuth callback.`,
    },
  ]),
];

export const discoverySpec = {
  name: "Scope API",
  summary:
    "Slices control future credential mints. Issued provider tokens remain valid until their provider expires or revokes them.",
  integrationGuide: {
    overview:
      "Pair an agent to a Scope account, ask the operator for a time-limited slice of selected apps and accounts, then mint credentials through that slice. Per-mint approval is separate and only applies when the slice's mint policy is approve.",
    rediscovery:
      "GET rediscoveryUrl on this same Convex HTTP origin whenever instructions are lost. Retain your private claim handles and credentials; rediscovery does not restore them.",
    runtime:
      "Polling requires a running or resumable agent runtime. Scope does not wake your agent or post into its chat.",
    polling:
      "Poll status about every five seconds initially, then use bounded backoff while pending. Claim promptly after approval, complete acknowledgment or activation immediately after safely persisting credentials, and stop at a terminal outcome or deadline.",
    privacy:
      "Send only connectUrl or approvalUrl to the operator. Keep claimHandle, agentConnectionSecret, sliceSecret, and Idempotency-Key private. Never paste them into chat.",
    pairing: [
      "POST /api/agent-connections with JSON {agentName}. Privately retain claimHandle; share connectUrl.",
      "POST /api/agent-connections/status with JSON {claimHandle}. Read handoffStatus, deadlines, resourceStatus, reason, and nextAction. Approval alone does not grant usable access.",
      "After approval, POST /api/agent-connections/claim with JSON {claimHandle}. The first successful claim starts the two-minute completion window. A lost response can be reclaimed with the same handle until completion or timeout; retries do not extend it.",
      "For a new connection, persist agentConnectionId and agentConnectionSecret, then POST /api/agent-connections/ack with JSON {claimHandle, agentConnectionSecret} before ackDeadlineAt. For a replacement, POST /api/agent-connections/activate with headers x-agent-connection-id and x-agent-connection-secret before activationDeadlineAt. The old connection remains active until activation commits.",
      "If the completion response is lost, retry the same completion request even after its deadline. It confirms the recorded completion and current resource state without reactivating revoked access. Reclaim after completion returns 409 CLAIM_ALREADY_ACKNOWLEDGED; inspect status rather than creating a new pairing.",
    ],
    replacement:
      "For planned rotation, POST /api/agent-connections with the current x-agent-connection-id and x-agent-connection-secret headers and JSON {}. Share connectUrl, then poll and claim as above. Persist the new credentials and follow nextAction to activate. If private connection credentials are lost, create a new pairing with {agentName}; the operator can select an existing active agent to replace. A timed-out replacement leaves its predecessor usable; start another pairing with the predecessor credentials.",
    slice: [
      "With an active connection, POST /api/access-requests with headers x-agent-connection-id, x-agent-connection-secret, and optionally a private task-stable Idempotency-Key (32–128 characters); JSON {apps:[app],ttlMs,reason}. Retain claimHandle and share only approvalUrl.",
      "POST /api/access-requests/status with JSON {claimHandle}. Read handoffStatus, resourceStatus, approvalDeadlineAt, pickupDeadlineAt, ackDeadlineAt, sliceExpiresAt, reasonCode, and nextAction. Do not infer readiness from approved alone.",
      "After approval, POST /api/access-requests/claim with JSON {claimHandle}. Persist sliceToken and sliceSecret, then POST /api/access-requests/ack with JSON {claimHandle,sliceSecret} before ackDeadlineAt. Retry the claim if its response is lost; retry ack if its response is lost. Slice lifetime begins at approval and may end before the ack deadline.",
      "After status is ready, GET /api/accounts?app=<app> with headers x-slice-token and x-slice-secret; POST /api/credentials with JSON {sliceToken,sliceSecret,app,bindingId} (bindingId optional if exactly one account). An approve-policy mint returns an operator URL and requestId; after approval POST /api/credentials/claim with JSON {sliceToken,sliceSecret,requestId}. This per-mint claim issues a credential; it is not a passive status check and requires no ack.",
    ],
    recovery:
      "401 means wrong private credentials. 409 CLAIM_ACK_REQUIRED or ACTIVATION_REQUIRED names the completion path and deadline; retrying the protected operation unchanged will not help. 403 REVOKED or EXPIRED means stop using that credential. Denied, timed-out, and revoked requests remain inspectable through their private status endpoint. Start a new approval only for a genuinely terminal request.",
    deadlineUnits:
      "All *At fields and serverTime are Unix milliseconds. Pairing approval: 15 minutes; slice approval: 24 hours; pickup after approval: 5 minutes; ack/activation after first claim: 2 minutes. Slice authorization ends at sliceExpiresAt even if handoff is unfinished.",
  },
  errors: AGENT_ERROR_CODES,
  errorGuidance: AGENT_ERROR_GUIDANCE,
  routes,
};
