import { v } from "convex/values";

export const ALL_APPS = [
  "github",
  "gmail",
  "calendar",
  "drive",
  "docs",
  "sheets",
  "slack",
  "airtable",
  "notion",
  "linear",
  "vercel",
  "zoom",
  "teams",
] as const;

export type AppId = (typeof ALL_APPS)[number];

export const PROVIDERS = ["github", "google", "slack", "airtable", "notion", "linear", "vercel", "zoom", "teams"] as const;

export type ProviderId = (typeof PROVIDERS)[number];

export const appValidator = v.union(
  v.literal("github"),
  v.literal("gmail"),
  v.literal("calendar"),
  v.literal("drive"),
  v.literal("docs"),
  v.literal("sheets"),
  v.literal("slack"),
  v.literal("airtable"),
  v.literal("notion"),
  v.literal("linear"),
  v.literal("vercel"),
  v.literal("zoom"),
  v.literal("teams"),
);

export const providerValidator = v.union(
  v.literal("github"),
  v.literal("google"),
  v.literal("slack"),
  v.literal("airtable"),
  v.literal("notion"),
  v.literal("linear"),
  v.literal("vercel"),
  v.literal("zoom"),
  v.literal("teams"),
);

export function isAppId(value: string): value is AppId {
  return (ALL_APPS as readonly string[]).includes(value);
}

export function providerForApp(app: AppId): ProviderId {
  switch (app) {
    case "github":
      return "github";
    case "gmail":
    case "calendar":
    case "drive":
    case "docs":
    case "sheets":
      return "google";
    case "slack":
      return "slack";
    case "airtable":
      return "airtable";
    case "notion":
      return "notion";
    case "linear":
      return "linear";
    case "vercel":
      return "vercel";
    case "zoom":
      return "zoom";
    case "teams":
      return "teams";
    default: {
      const _exhaustive: never = app;
      return _exhaustive;
    }
  }
}

export function appsForProvider(provider: ProviderId): AppId[] {
  return ALL_APPS.filter((app) => providerForApp(app) === provider);
}
