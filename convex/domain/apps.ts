import { v } from "convex/values";

export const ALL_APPS = [
  "github",
  "gmail",
  "calendar",
  "files",
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
  "files",
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
  v.literal("files"),
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
    case "files":
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

const GOOGLE_APP_SCOPE: Record<GoogleAppId, string> = {
  gmail: "https://www.googleapis.com/auth/gmail.modify",
  calendar: "https://www.googleapis.com/auth/calendar",
  // Drive already authorizes the broker's Docs and Sheets operations.
  files: "https://www.googleapis.com/auth/drive",
};

/** Account identification uses each service's API, with no identity scopes. */
export function scopesForGoogleApp(app: AppId): string {
  if (!isGoogleApp(app)) {
    throw new Error(`scopesForGoogleApp requires a Google app, got ${app}`);
  }
  return GOOGLE_APP_SCOPE[app];
}

/** Accept exactly the requested service authority, with no legacy grant extras. */
export function googleScopesAreBounded(
  app: AppId,
  scopes: readonly string[] | undefined,
): boolean {
  if (!isGoogleApp(app) || !scopes) return false;
  return (
    scopes.length > 0 &&
    scopes.every((scope) => scope === GOOGLE_APP_SCOPE[app])
  );
}

export function effectiveGoogleApps(app: AppId): AppId[] {
  return [app];
}
