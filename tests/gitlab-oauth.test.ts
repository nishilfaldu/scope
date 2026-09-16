import { afterEach, describe, expect, test, vi } from "vitest";
import { gitlab } from "../convex/oauth/providers/gitlab";

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });

describe("GitLab OAuth", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllEnvs();
  });

  test("authorizes with board-minted state and api scope", () => {
    vi.stubEnv("GITLAB_CLIENT_ID", "gitlab-client");
    vi.stubEnv("GITLAB_CLIENT_SECRET", "gitlab-secret");
    vi.stubEnv("CONVEX_SITE_URL", "https://passport.convex.site");
    const started = gitlab.authorize("state-1");
    if (!("url" in started)) throw new Error("expected URL");
    const url = new URL(started.url);
    expect(url.origin + url.pathname).toBe("https://gitlab.com/oauth/authorize");
    expect(url.searchParams.get("client_id")).toBe("gitlab-client");
    expect(url.searchParams.get("state")).toBe("state-1");
    expect(url.searchParams.get("redirect_uri")).toBe(
      "https://passport.convex.site/api/gitlab/callback",
    );
    expect(url.searchParams.get("response_type")).toBe("code");
    expect(url.searchParams.get("scope")).toContain("api");
    expect(url.searchParams.get("scope")).toContain("read_user");
  });

  test("exchanges, identifies via /api/v4/user, refreshes, and revokes", async () => {
    vi.stubEnv("GITLAB_CLIENT_ID", "gitlab-client");
    vi.stubEnv("GITLAB_CLIENT_SECRET", "gitlab-secret");
    vi.stubEnv("CONVEX_SITE_URL", "https://passport.convex.site");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        json({
          access_token: "access-1",
          refresh_token: "refresh-1",
          expires_in: 7200,
        }),
      )
      .mockResolvedValueOnce(
        json({
          id: 42,
          username: "nishil",
          email: "nishil@example.com",
          name: "Nishil Faldu",
        }),
      )
      .mockResolvedValueOnce(
        json({
          access_token: "access-2",
          refresh_token: "refresh-2",
          expires_in: 7200,
        }),
      )
      .mockResolvedValueOnce(json({}));

    await expect(gitlab.exchange("code-1")).resolves.toMatchObject({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      login: "nishil",
      providerUserId: "42",
    });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://gitlab.com/oauth/token");
    expect(fetchMock.mock.calls[1]?.[0]).toBe("https://gitlab.com/api/v4/user");

    await expect(
      gitlab.refresh({
        accessToken: "access-1",
        refreshToken: "refresh-1",
        tokenExpiresAt: 1,
        login: "nishil",
        providerUserId: "42",
      }),
    ).resolves.toMatchObject({
      accessToken: "access-2",
      refreshToken: "refresh-2",
    });

    await gitlab.revoke("access-2");
    expect(fetchMock.mock.calls[3]?.[0]).toBe("https://gitlab.com/oauth/revoke");
  });

  test("refresh hard-fails without a refresh token", async () => {
    await expect(
      gitlab.refresh({
        accessToken: "standing",
        refreshToken: null,
        tokenExpiresAt: Date.now() + 60_000,
        login: "nishil",
        providerUserId: "42",
      }),
    ).resolves.toBeNull();
  });
});
