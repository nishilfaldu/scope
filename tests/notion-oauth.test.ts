import { afterEach, describe, expect, test, vi } from "vitest";
import { notion } from "../convex/oauth/providers/notion";

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });

describe("Notion OAuth", () => {
  afterEach(() => vi.unstubAllEnvs());

  test("builds a user-owned authorization request", () => {
    vi.stubEnv("NOTION_CLIENT_ID", "notion-client");
    vi.stubEnv("NOTION_CLIENT_SECRET", "notion-secret");
    vi.stubEnv("CONVEX_SITE_URL", "https://scope.convex.site");
    const started = notion.authorize("state-1");
    expect(started).toEqual({
      url: "https://api.notion.com/v1/oauth/authorize?client_id=notion-client&redirect_uri=https%3A%2F%2Fscope.convex.site%2Fapi%2Fnotion%2Fcallback&response_type=code&owner=user&state=state-1",
    });
  });

  test("exchanges, refreshes, and revokes with Notion's OAuth contract", async () => {
    vi.stubEnv("NOTION_CLIENT_ID", "notion-client");
    vi.stubEnv("NOTION_CLIENT_SECRET", "notion-secret");
    vi.stubEnv("CONVEX_SITE_URL", "https://scope.convex.site");
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        json({
          access_token: "access-1",
          refresh_token: "refresh-1",
          bot_id: "bot-1",
          workspace_name: "Roadmap",
          workspace_id: "workspace-1",
          owner: { type: "user", user: { id: "user-1", name: "Nishil" } },
        }),
      )
      .mockResolvedValueOnce(
        json({
          access_token: "access-2",
          refresh_token: "refresh-2",
        }),
      )
      .mockResolvedValueOnce(json({}));

    await expect(notion.exchange("code-1")).resolves.toMatchObject({
      accessToken: "access-1",
      refreshToken: "refresh-1",
      login: "Roadmap · Nishil",
      providerUserId: "workspace-1:bot-1",
    });
    await expect(
      notion.refresh({
        accessToken: "access-1",
        refreshToken: "refresh-1",
        tokenExpiresAt: null,
        login: "Roadmap · Nishil",
        providerUserId: "workspace-1:bot-1",
      }),
    ).resolves.toMatchObject({
      accessToken: "access-2",
      refreshToken: "refresh-2",
    });
    await notion.revoke("access-2");

    expect(fetchMock).toHaveBeenNthCalledWith(
      1,
      "https://api.notion.com/v1/oauth/token",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({
          grant_type: "authorization_code",
          code: "code-1",
          redirect_uri: "https://scope.convex.site/api/notion/callback",
        }),
      }),
    );
    expect(fetchMock).toHaveBeenNthCalledWith(
      3,
      "https://api.notion.com/v1/oauth/revoke",
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ token: "access-2" }),
      }),
    );
  });
});
