import { afterEach, describe, expect, test, vi } from "vitest";
import { teams } from "../convex/oauth/providers/teams";

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });

describe("Microsoft Teams OAuth", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  test("authorizes with board-minted state and offline_access", () => {
    vi.stubEnv("TEAMS_CLIENT_ID", "teams-client");
    vi.stubEnv("TEAMS_CLIENT_SECRET", "teams-secret");
    vi.stubEnv("CONVEX_SITE_URL", "https://passport.convex.site");
    const started = teams.authorize("state-1");
    if (!("url" in started)) throw new Error("expected URL");
    const url = new URL(started.url);
    expect(url.origin + url.pathname).toBe(
      "https://login.microsoftonline.com/common/oauth2/v2.0/authorize",
    );
    expect(url.searchParams.get("client_id")).toBe("teams-client");
    expect(url.searchParams.get("state")).toBe("state-1");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://passport.convex.site/api/teams/callback",
    );
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("prompt")).toBe("consent");
    expect(url.searchParams.get("scope")).toContain("offline_access");
    expect(url.searchParams.get("scope")).toContain("User.Read");
    expect(url.searchParams.get("scope")).toContain("ChannelMessage.Send");
  });

  test("exchanges, identifies via Graph, and refreshes", async () => {
    vi.stubEnv("TEAMS_CLIENT_ID", "teams-client");
    vi.stubEnv("TEAMS_CLIENT_SECRET", "teams-secret");
    vi.stubEnv("CONVEX_SITE_URL", "https://passport.convex.site");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        json({
          access_token: "access-1",
          refresh_token: "refresh-1",
          expires_in: 3600,
        }),
      )
      .mockResolvedValueOnce(
        json({
          id: "aad-user-1",
          mail: "nishil@contoso.com",
          userPrincipalName: "nishil@contoso.com",
          displayName: "Nishil Faldu",
        }),
      )
      .mockResolvedValueOnce(
        json({
          access_token: "access-2",
          refresh_token: "refresh-2",
          expires_in: 3600,
        }),
      );

    await expect(teams.exchange("code-1")).resolves.toMatchObject({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      login: "nishil@contoso.com",
      providerUserId: "aad-user-1",
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://login.microsoftonline.com/common/oauth2/v2.0/token",
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://graph.microsoft.com/v1.0/me",
    );

    await expect(
      teams.refresh({
        accessToken: "access-1",
        refreshToken: "refresh-1",
        tokenExpiresAt: 1,
        login: "nishil@contoso.com",
        providerUserId: "aad-user-1",
      }),
    ).resolves.toMatchObject({
      accessToken: "access-2",
      refreshToken: "refresh-2",
    });

    await teams.revoke("access-2");
  });

  test("refresh hard-fails without a refresh token", async () => {
    await expect(
      teams.refresh({
        accessToken: "standing",
        refreshToken: null,
        tokenExpiresAt: Date.now() + 60_000,
        login: "nishil@contoso.com",
        providerUserId: "aad-user-1",
      }),
    ).resolves.toBeNull();
  });
});
