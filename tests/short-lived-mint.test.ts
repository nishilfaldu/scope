import { afterEach, describe, expect, test, vi } from "vitest";
import { github } from "../convex/oauth/providers/github";
import { google } from "../convex/oauth/providers/google";
import { slack } from "../convex/oauth/providers/slack";
import { notion } from "../convex/oauth/providers/notion";
import { airtable } from "../convex/oauth/providers/airtable";
import { linear } from "../convex/oauth/providers/linear";
import { vercel } from "../convex/oauth/providers/vercel";
import { zoom } from "../convex/oauth/providers/zoom";
import type { ConnectionSecrets } from "../convex/oauth/types";

const standing: ConnectionSecrets = {
  accessToken: "standing_upstream_token",
  refreshToken: null,
  tokenExpiresAt: Date.now() + 60_000,
  login: "user",
  providerUserId: "1",
};

const json = (body: unknown) =>
  new Response(JSON.stringify(body), {
    headers: { "Content-Type": "application/json" },
  });

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
});

describe("provider refresh never returns standing vault token", () => {
  test.each([
    ["github", github],
    ["google", google],
    ["slack", slack],
    ["notion", notion],
    ["airtable", airtable],
    ["linear", linear],
    ["vercel", vercel],
    ["zoom", zoom],
  ] as const)(
    "%s hard-fails when refresh token is missing",
    async (_name, provider) => {
      await expect(provider.refresh(standing)).resolves.toBeNull();
    },
  );

  test("github refresh mints a distinct access token and keeps refresh out of agent concern", async () => {
    vi.stubEnv("GITHUB_CLIENT_ID", "Iv1.testapp");
    vi.stubEnv("GITHUB_CLIENT_SECRET", "github-secret");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      json({
        access_token: "ghu_fresh",
        refresh_token: "ghr_new",
        expires_in: 28_800,
      }),
    );
    const minted = await github.refresh({
      ...standing,
      accessToken: "ghs_standing_token",
      refreshToken: "ghr_old",
    });
    expect(minted).toMatchObject({ accessToken: "ghu_fresh" });
    expect(minted!.accessToken).not.toBe("ghs_standing_token");
    expect(minted!.refreshToken).toBe("ghr_new");
  });

  test("google refresh mints a distinct access token", async () => {
    vi.stubEnv("GOOGLE_CLIENT_ID", "google-client");
    vi.stubEnv("GOOGLE_CLIENT_SECRET", "google-secret");
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      json({ access_token: "ya29.fresh", expires_in: 3600 }),
    );
    const minted = await google.refresh({
      ...standing,
      accessToken: "ya29.standing",
      refreshToken: "1//refresh",
    });
    expect(minted).toMatchObject({ accessToken: "ya29.fresh" });
    expect(minted!.accessToken).not.toBe("ya29.standing");
  });
});
