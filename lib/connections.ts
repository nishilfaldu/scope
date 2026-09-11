export type ConnectionStatus =
  | { connected: false }
  | { connected: true; login: string };

export const GITHUB_CONNECT_URL = `${process.env.NEXT_PUBLIC_CONVEX_SITE_URL}/api/github/connect`;

export const CONNECT_ERRORS: Record<string, string> = {
  token:
    "GitHub did not issue a token. The App callback URL must be this Convex site’s /api/github/callback.",
  incorrect_client_credentials:
    "GitHub rejected the client secret. Generate a new client secret on the App and set GITHUB_CLIENT_SECRET.",
  redirect_uri_mismatch:
    "GitHub rejected the callback URL. Set the App’s User authorization callback URL to this Convex site’s /api/github/callback.",
  bad_verification_code:
    "The GitHub authorization code expired or was reused. Flip the toggle again.",
  state: "Connect session expired. Flip the toggle again.",
  code: "GitHub did not return an authorization code.",
  config: "GitHub App client id/secret are missing on Convex.",
};

export const CONNECTION_PROVIDERS = [
  {
    id: "github",
    name: "GitHub",
    description: "Act on GitHub as you. Token stays on the server.",
    connectUrl: GITHUB_CONNECT_URL,
  },
] as const;

export type ProviderId = (typeof CONNECTION_PROVIDERS)[number]["id"];
