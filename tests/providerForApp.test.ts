import { describe, expect, test } from "vitest";
import {
  ALL_APPS,
  providerForApp,
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
