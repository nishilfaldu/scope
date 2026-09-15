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
] as const;

export type AppId = (typeof ALL_APPS)[number];

export const PROVIDERS = ["github", "google", "slack", "airtable", "notion"] as const;

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
);

export const providerValidator = v.union(
  v.literal("github"),
  v.literal("google"),
  v.literal("slack"),
  v.literal("airtable"),
  v.literal("notion"),
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
    default: {
      const _exhaustive: never = app;
      return _exhaustive;
    }
  }
}

export function appsForProvider(provider: ProviderId): AppId[] {
  return ALL_APPS.filter((app) => providerForApp(app) === provider);
}
