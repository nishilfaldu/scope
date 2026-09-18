import { afterEach, describe, expect, test, vi } from "vitest";
import { airtable } from "../convex/oauth/providers/airtable";

const json = (body: unknown) => new Response(JSON.stringify(body));

describe("Airtable OAuth", () => {
  afterEach(() => vi.unstubAllEnvs());
  test("authorizes with resource scopes and PKCE", async () => {
    vi.stubEnv("AIRTABLE_CLIENT_ID", "airtable-client");
    vi.stubEnv("AIRTABLE_CLIENT_SECRET", "airtable-secret");
    vi.stubEnv("CONVEX_SITE_URL", "https://passport.convex.site");
    const started = await airtable.authorize("state-1");
    if (!("url" in started)) throw new Error("expected URL");
    const url = new URL(started.url);
    expect(url.origin + url.pathname).toBe(
      "https://airtable.com/oauth2/v1/authorize",
    );
    expect(url.searchParams.get("state")).toBe("state-1");
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toContain("data.records:write");
  });
  test("exchanges with state-bound verifier, identifies the user, refreshes", async () => {
    vi.stubEnv("AIRTABLE_CLIENT_ID", "airtable-client");
    vi.stubEnv("AIRTABLE_CLIENT_SECRET", "airtable-secret");
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
      .mockResolvedValueOnce(json({ id: "usr1", email: "nishil@example.com" }))
      .mockResolvedValueOnce(
        json({
          access_token: "access-2",
          refresh_token: "refresh-2",
          expires_in: 3600,
        }),
      );
    await expect(airtable.exchange("code-1", "state-1")).resolves.toMatchObject(
      {
        accessToken: "access-1",
        refreshToken: "refresh-1",
        login: "nishil@example.com",
        providerUserId: "usr1",
      },
    );
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({
      body: expect.stringContaining("code_verifier=state1.state1"),
    });
    await expect(
      airtable.refresh({
        accessToken: "access-1",
        refreshToken: "refresh-1",
        tokenExpiresAt: 1,
        login: "nishil@example.com",
        providerUserId: "usr1",
      }),
    ).resolves.toMatchObject({
      accessToken: "access-2",
      refreshToken: "refresh-2",
    });
  });
});
