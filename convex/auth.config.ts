import { env } from "./_generated/server";
import type { AuthConfig } from "convex/server";

// Web sessions: every first-party app in a WorkOS environment shares this
// issuer, so ownerId() also requires the web client_id.
const web = {
  type: "customJwt",
  issuer: `https://api.workos.com/user_management/${env.WORKOS_CLIENT_ID}`,
  algorithm: "RS256",
  jwks: `https://api.workos.com/sso/jwks/${env.WORKOS_CLIENT_ID}`,
} as const;

// MCP apps: AuthKit issues these tokens with aud set to the /mcp resource.
const mcp =
  env.WORKOS_AUTHKIT_DOMAIN && env.SCOPE_MCP_RESOURCE
    ? [
        {
          type: "customJwt",
          issuer: env.WORKOS_AUTHKIT_DOMAIN,
          algorithm: "RS256",
          jwks: `${env.WORKOS_AUTHKIT_DOMAIN}/oauth2/jwks`,
          applicationID: env.SCOPE_MCP_RESOURCE,
        } as const,
      ]
    : [];

export default {
  providers: [web, ...mcp],
} satisfies AuthConfig;
