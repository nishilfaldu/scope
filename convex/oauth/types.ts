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
  authorize: (state: string) => AuthorizeStart;
  exchange: (code: string) => Promise<OAuthGrant | { error: string }>;
  refresh: (connection: ConnectionSecrets) => Promise<RefreshedTokens | null>;
  revoke: (accessToken: string) => Promise<void>;
};
