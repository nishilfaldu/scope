import { v } from "convex/values";

export const ALL_APPS = [
  "demo",
  "github",
  "gmail",
  "calendar",
  "drive",
  "docs",
  "sheets",
  "slack",
] as const;

export type AppId = (typeof ALL_APPS)[number];

export const ACCOUNT_APPS = [
  "github",
  "gmail",
  "calendar",
  "drive",
  "docs",
  "sheets",
  "slack",
] as const;

export type AccountAppId = (typeof ACCOUNT_APPS)[number];

export const PROVIDERS = ["github", "google", "slack"] as const;

export type ProviderId = (typeof PROVIDERS)[number];

export const appValidator = v.union(
  v.literal("demo"),
  v.literal("github"),
  v.literal("gmail"),
  v.literal("calendar"),
  v.literal("drive"),
  v.literal("docs"),
  v.literal("sheets"),
  v.literal("slack"),
);

export const accountAppValidator = v.union(
  v.literal("github"),
  v.literal("gmail"),
  v.literal("calendar"),
  v.literal("drive"),
  v.literal("docs"),
  v.literal("sheets"),
  v.literal("slack"),
);

export const providerValidator = v.union(
  v.literal("github"),
  v.literal("google"),
  v.literal("slack"),
);

export function isAccountAppId(value: string): value is AccountAppId {
  return (ACCOUNT_APPS as readonly string[]).includes(value);
}

export function providerForApp(app: AccountAppId): ProviderId;
export function providerForApp(app: AppId): ProviderId | null;
export function providerForApp(app: AppId): ProviderId | null {
  switch (app) {
    case "demo":
      return null;
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
    default: {
      const _exhaustive: never = app;
      return _exhaustive;
    }
  }
}

export function appsForProvider(provider: ProviderId): AccountAppId[] {
  switch (provider) {
    case "github":
      return ["github"];
    case "google":
      return ["gmail", "calendar", "drive", "docs", "sheets"];
    case "slack":
      return ["slack"];
    default: {
      const _exhaustive: never = provider;
      return _exhaustive;
    }
  }
}
