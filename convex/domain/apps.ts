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
] as const;

export type AppId = (typeof ALL_APPS)[number];

export const GOOGLE_APPS = [
  "gmail",
  "calendar",
  "drive",
  "docs",
  "sheets",
] as const satisfies readonly AppId[];

export type GoogleAppId = (typeof GOOGLE_APPS)[number];

export const PROVIDERS = [
  "github",
  "google",
  "slack",
  "airtable",
  "notion",
  "linear",
  "vercel",
  "zoom",
] as const;

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
);

export function isAppId(value: string): value is AppId {
  return (ALL_APPS as readonly string[]).includes(value);
}

export function isGoogleApp(app: AppId): app is GoogleAppId {
  return (GOOGLE_APPS as readonly string[]).includes(app);
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
    default: {
      const _exhaustive: never = app;
      return _exhaustive;
    }
  }
}

export function appsForProvider(provider: ProviderId): AppId[] {
  return ALL_APPS.filter((app) => providerForApp(app) === provider);
}

/**
 * Non-Google providers map 1:1 to a single app id (github→github, …).
 * Google has multiple apps under one provider — returns null.
 */
export function soleAppForProvider(provider: ProviderId): AppId | null {
  const apps = appsForProvider(provider);
  return apps.length === 1 ? apps[0]! : null;
}

const GOOGLE_APP_SCOPES: Record<GoogleAppId, string> = {
  gmail: "https://www.googleapis.com/auth/gmail.modify",
  calendar: "https://www.googleapis.com/auth/calendar",
  drive: "https://www.googleapis.com/auth/drive",
  docs: "https://www.googleapis.com/auth/documents",
  sheets: "https://www.googleapis.com/auth/spreadsheets",
};

/** OpenID identity scopes plus only the scopes for this Google app. */
export function scopesForGoogleApp(app: AppId): string {
  if (!isGoogleApp(app)) {
    throw new Error(`scopesForGoogleApp requires a Google app, got ${app}`);
  }
  return ["openid", "email", "profile", GOOGLE_APP_SCOPES[app]].join(" ");
}
