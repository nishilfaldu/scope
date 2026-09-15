import { afterEach, describe, expect, test, vi } from "vitest";
import { linear } from "../convex/oauth/providers/linear";

const json = (body: unknown) => new Response(JSON.stringify(body));

describe("Linear OAuth", () => {
  afterEach(() => vi.unstubAllEnvs());
  test("authorizes as the user with read and write scopes", () => {
    vi.stubEnv("LINEAR_CLIENT_ID", "linear-client");
    vi.stubEnv("LINEAR_CLIENT_SECRET", "linear-secret");
    vi.stubEnv("CONVEX_SITE_URL", "https://passport.convex.site");
    expect(linear.authorize("state-1")).toEqual({
      url: "https://linear.app/oauth/authorize?client_id=linear-client&redirect_uri=https%3A%2F%2Fpassport.convex.site%2Fapi%2Flinear%2Fcallback&response_type=code&scope=read%2Cwrite&actor=user&state=state-1",
    });
  });
  test("exchanges, reads viewer identity, refreshes, and revokes", async () => {
    vi.stubEnv("LINEAR_CLIENT_ID", "linear-client");
    vi.stubEnv("LINEAR_CLIENT_SECRET", "linear-secret");
    vi.stubEnv("CONVEX_SITE_URL", "https://passport.convex.site");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        json({
          access_token: "access-1",
          refresh_token: "refresh-1",
          expires_in: 86399,
        }),
      )
      .mockResolvedValueOnce(
        json({
          data: {
            viewer: {
              id: "user-1",
              name: "Nishil",
              email: "nishil@example.com",
            },
          },
        }),
      )
      .mockResolvedValueOnce(
        json({
          access_token: "access-2",
          refresh_token: "refresh-2",
          expires_in: 86399,
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 200 }));
    await expect(linear.exchange("code-1")).resolves.toMatchObject({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      login: "nishil@example.com",
      providerUserId: "user-1",
    });
    await expect(
      linear.refresh({
        accessToken: "access-1",
        refreshToken: "refresh-1",
        tokenExpiresAt: 1,
        login: "nishil@example.com",
        providerUserId: "user-1",
      }),
    ).resolves.toMatchObject({
      accessToken: "access-2",
      refreshToken: "refresh-2",
    });
    await linear.revoke("access-2");
    expect(fetchMock).toHaveBeenNthCalledWith(
      4,
      "https://api.linear.app/oauth/revoke",
      expect.objectContaining({ body: "token=access-2" }),
    );
  });
});
