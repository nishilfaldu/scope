import { afterEach, describe, expect, test, vi } from "vitest";
import { zoom } from "../convex/oauth/providers/zoom";
const json = (body: unknown) => new Response(JSON.stringify(body));
describe("Zoom OAuth", () => {
  afterEach(() => vi.unstubAllEnvs());
  test("authorizes with board-minted state", () => {
    vi.stubEnv("ZOOM_CLIENT_ID", "zoom-client"); vi.stubEnv("ZOOM_CLIENT_SECRET", "zoom-secret"); vi.stubEnv("CONVEX_SITE_URL", "https://passport.convex.site");
    const started = zoom.authorize("state-1");
    if (!("url" in started)) throw new Error("expected URL");
    const url = new URL(started.url);
    expect(url.origin + url.pathname).toBe("https://zoom.us/oauth/authorize");
    expect(url.searchParams.get("state")).toBe("state-1");
    expect(url.searchParams.get("redirect_uri")).toBe("https://passport.convex.site/api/zoom/callback");
  });
  test("exchanges, identifies, refreshes, and revokes", async () => {
    vi.stubEnv("ZOOM_CLIENT_ID", "zoom-client"); vi.stubEnv("ZOOM_CLIENT_SECRET", "zoom-secret"); vi.stubEnv("CONVEX_SITE_URL", "https://passport.convex.site");
    const fetchMock = vi.spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(json({ access_token: "access-1", refresh_token: "refresh-1", expires_in: 3600 }))
      .mockResolvedValueOnce(json({ id: "usr1", email: "nishil@example.com" }))
      .mockResolvedValueOnce(json({ access_token: "access-2", refresh_token: "refresh-2", expires_in: 3600 }))
      .mockResolvedValueOnce(json({ status: "success" }));
    await expect(zoom.exchange("code-1")).resolves.toMatchObject({ accessToken: "access-1", refreshToken: "refresh-1", login: "nishil@example.com", providerUserId: "usr1" });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://zoom.us/oauth/token");
    await expect(zoom.refresh({ accessToken: "access-1", refreshToken: "refresh-1", tokenExpiresAt: 1, login: "nishil@example.com", providerUserId: "usr1" })).resolves.toMatchObject({ accessToken: "access-2", refreshToken: "refresh-2" });
    await zoom.revoke("access-2");
    expect(fetchMock.mock.calls[3]?.[0]).toBe("https://zoom.us/oauth/revoke");
  });
});
