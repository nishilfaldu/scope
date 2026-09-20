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

const GOOGLE_PROVIDER_SCOPES = [
  "openid",
  "email",
  "profile",
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/calendar",
  "https://www.googleapis.com/auth/drive",
  "https://www.googleapis.com/auth/documents",
  "https://www.googleapis.com/auth/spreadsheets",
] as const;

/** Request the provider-wide maximum for every Google connection. */
export function scopesForGoogleApp(app: AppId): string {
  if (!isGoogleApp(app)) {
    throw new Error(`scopesForGoogleApp requires a Google app, got ${app}`);
  }
  return GOOGLE_PROVIDER_SCOPES.join(" ");
}
