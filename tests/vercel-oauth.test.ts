import { afterEach, describe, expect, test, vi } from "vitest";
import { vercel } from "../convex/oauth/providers/vercel";

const json = (body: unknown) => new Response(JSON.stringify(body));

describe("Vercel OAuth", () => {
  afterEach(() => vi.unstubAllEnvs());

  test("authorizes with OpenID identity and offline access", () => {
    vi.stubEnv("VERCEL_CLIENT_ID", "vercel-client");
    vi.stubEnv("VERCEL_CLIENT_SECRET", "vercel-secret");
    vi.stubEnv("CONVEX_SITE_URL", "https://scope.convex.site");
    expect(vercel.authorize("state-1")).toEqual({
      url: "https://vercel.com/oauth/authorize?client_id=vercel-client&redirect_uri=https%3A%2F%2Fscope.convex.site%2Fapi%2Fvercel%2Fcallback&response_type=code&scope=openid+email+profile+offline_access&state=state-1",
    });
  });

  test("exchanges, reads user info, refreshes, and revokes", async () => {
    vi.stubEnv("VERCEL_CLIENT_ID", "vercel-client");
    vi.stubEnv("VERCEL_CLIENT_SECRET", "vercel-secret");
    vi.stubEnv("CONVEX_SITE_URL", "https://scope.convex.site");
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
          sub: "user-1",
          preferred_username: "nishil",
          email: "nishil@example.com",
        }),
      )
      .mockResolvedValueOnce(
        json({
          access_token: "access-2",
          refresh_token: "refresh-2",
          expires_in: 7200,
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }));

    await expect(vercel.exchange("code-1")).resolves.toMatchObject({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      login: "nishil",
      providerUserId: "user-1",
    });
    await expect(
      vercel.refresh({
        accessToken: "access-1",
        refreshToken: "refresh-1",
        tokenExpiresAt: 1,
        login: "nishil",
        providerUserId: "user-1",
      }),
    ).resolves.toMatchObject({
      accessToken: "access-2",
      refreshToken: "refresh-2",
    });
    await vercel.revoke("access-2");
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "https://api.vercel.com/login/oauth/token/revoke",
      expect.objectContaining({ body: "token=access-2" }),
    );
  });
});
