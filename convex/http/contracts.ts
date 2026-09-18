import { ALL_APPS } from "../domain/apps";
import { AGENT_ERROR_CODES, AGENT_ERROR_GUIDANCE } from "../lib/errors";

// Human-readable route discovery. Response contracts belong to the handlers and
// their HTTP tests, not a second handwritten schema.
const routes = [
  { method: "GET", path: "/", summary: "API route index." },
  { method: "GET", path: "/api/health", summary: "Liveness and OAuth configuration." },
  { method: "GET", path: "/api/capabilities", summary: "Public, machine-readable app capabilities and OAuth scope model." },
  { method: "POST", path: "/api/access-requests", summary: "Start agent onboarding; returns an approval URL and private claim handle." },
  { method: "POST", path: "/api/access-requests/status", summary: "Poll onboarding with the claim handle." },
  { method: "POST", path: "/api/access-requests/claim", summary: "Claim approved slice credentials during the short recovery window." },
  { method: "POST", path: "/api/credentials", summary: "Mint a provider-native token for one allowed app." },
  { method: "POST", path: "/api/credentials/claim", summary: "Claim an approved credential request." },
  { method: "GET", path: "/api/apps", summary: "Discover available apps for a slice." },
  ...ALL_APPS.flatMap((app) => [
    { method: "GET", path: `/api/${app}/connect`, summary: `Start ${app} OAuth.` },
    { method: "GET", path: `/api/${app}/callback`, summary: `${app} OAuth callback.` },
  ]),
];

export const discoverySpec = {
  name: "Agent Passport API",
  summary: "Slices control future credential mints. Issued provider tokens remain valid until their provider expires or revokes them.",
  errors: AGENT_ERROR_CODES,
  errorGuidance: AGENT_ERROR_GUIDANCE,
  routes,
};
