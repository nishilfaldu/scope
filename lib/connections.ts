import { PROVIDERS, type ProviderId } from "../convex/domain/apps";

export { PROVIDERS, type ProviderId };

export type ConnectionRow = {
  connected: boolean;
  login: string | null;
};

const siteUrl = process.env.NEXT_PUBLIC_CONVEX_SITE_URL ?? "";

export const PROVIDER_CONNECT_URL: Record<ProviderId, string> = {
  github: `${siteUrl}/api/github/connect`,
  google: `${siteUrl}/api/google/connect`,
  slack: `${siteUrl}/api/slack/connect`,
  vercel: `${siteUrl}/api/vercel/connect`,
};

export const CONNECT_ERRORS: Record<string, string> = {
  token:
    "The provider did not issue a token. Check the OAuth callback URL on the app.",
  incorrect_client_credentials:
    "The provider rejected the client secret. Set a new secret on Convex.",
  redirect_uri_mismatch:
    "The provider rejected the callback URL. Set it to this Convex site’s /api/<provider>/callback.",
  bad_verification_code:
    "The authorization code expired or was reused. Flip the toggle again.",
  state: "Connect session expired. Flip the toggle again.",
  code: "The provider did not return an authorization code.",
  config: "OAuth client id/secret are missing on Convex.",
};

export const CONNECTION_PROVIDERS = [
  {
    id: "github" as const,
    name: "GitHub",
    description: "One login. Passports can attach GitHub after you connect.",
  },
  {
    id: "google" as const,
    name: "Google",
    description:
      "One login for Gmail, Calendar, Drive, Docs, and Sheets. Connecting does not grant any agent access.",
  },
  {
    id: "slack" as const,
    name: "Slack",
    description: "One login. Passports can attach Slack after you connect.",
  },
  {
    id: "vercel" as const,
    name: "Vercel",
    description: "Projects, deployments, and account resources.",
  },
] as const;
