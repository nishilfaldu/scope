import type { AppId } from "../domain/apps";

export type ConnectionSecrets = {
  accessToken: string;
  refreshToken: string | null;
  tokenExpiresAt: number | null;
  login: string;
  providerUserId: string;
};

export type RefreshedTokens = {
  accessToken: string;
  refreshToken?: string;
  tokenExpiresAt?: number;
};

export type OAuthGrant = RefreshedTokens & {
  login: string;
  providerUserId: string;
};

export type AuthorizeStart = { url: string } | { error: string };

export type ProviderOAuth = {
  /** `app` is required for Google (per-app scopes); ignored by 1:1 providers. */
  authorize: (
    state: string,
    app?: AppId,
  ) => AuthorizeStart | Promise<AuthorizeStart>;
  exchange: (
    code: string,
    state?: string,
    app?: AppId,
  ) => Promise<OAuthGrant | { error: string }>;
  refresh: (connection: ConnectionSecrets) => Promise<RefreshedTokens | null>;
  revoke: (accessToken: string) => Promise<void>;
};
