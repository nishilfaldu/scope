import { env } from "./_generated/server";
import type { AuthConfig } from "convex/server";

// All first-party applications in this WorkOS environment share the default
// application's issuer. owner() also requires the signed web client_id and sid.
export default {
  providers: [
    {
      type: "customJwt",
      issuer: `https://api.workos.com/user_management/${env.WORKOS_CLIENT_ID}`,
      algorithm: "RS256",
      jwks: `https://api.workos.com/sso/jwks/${env.WORKOS_CLIENT_ID}`,
    },
  ],
} satisfies AuthConfig;
