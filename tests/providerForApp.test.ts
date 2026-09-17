import { describe, expect, test } from "vitest";
import {
  ALL_APPS,
  providerForApp,
  scopesForGoogleApp,
  type AppId,
  type ProviderId,
} from "../convex/domain/apps";

const EXPECTED_PROVIDERS: Record<AppId, ProviderId> = {
  github: "github",
  gmail: "google",
  calendar: "google",
  drive: "google",
  docs: "google",
  sheets: "google",
  slack: "slack",
  airtable: "airtable",
  notion: "notion",
  linear: "linear",
  vercel: "vercel",
  zoom: "zoom",
};

describe("providerForApp", () => {
  test("maps every ALL_APPS entry to the expected provider", () => {
    for (const app of ALL_APPS) {
      expect(providerForApp(app)).toBe(EXPECTED_PROVIDERS[app]);
    }
  });
});

describe("scopesForGoogleApp", () => {
  test("includes identity scopes plus only the app scope", () => {
    const gmail = scopesForGoogleApp("gmail");
    expect(gmail).toContain("openid");
    expect(gmail).toContain("email");
    expect(gmail).toContain("profile");
    expect(gmail).toContain("gmail.modify");
    expect(gmail).not.toContain("calendar");
    expect(gmail).not.toContain("spreadsheets");
  });

  test("rejects non-google apps", () => {
    expect(() => scopesForGoogleApp("github")).toThrow(/Google app/);
  });
});
