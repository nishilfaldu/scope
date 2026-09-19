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
      "Claim approved credentials; replacement claims retry until activation.",
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
    summary: "Claim approved slice credentials once.",
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
      "Mint a provider-native token for an allowed app and account binding.",
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
  errors: AGENT_ERROR_CODES,
  errorGuidance: AGENT_ERROR_GUIDANCE,
  routes,
};
