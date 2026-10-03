import { ALL_APPS, type AppId } from "../convex/domain/apps";

export { ALL_APPS, type AppId };
export const CONNECTION_APPS = [
  { id: "slack", name: "Slack", description: "Slack workspace access." },
] as const satisfies ReadonlyArray<{
  id: AppId;
  name: string;
  description: string;
}>;

const siteUrl = process.env.NEXT_PUBLIC_CONVEX_SITE_URL ?? "";
export const APP_CONNECT_URL = Object.fromEntries(
  ALL_APPS.map((app) => [app, `${siteUrl}/api/${app}/connect`]),
) as Record<AppId, string>;
export const CONNECT_ERRORS: Record<string, string> = {
  connect:
    "Slack could not verify this account and its permissions. Try connecting again or contact the Scope administrator.",
  state: "Connect session expired. Try connecting again.",
  code: "The provider did not return an authorization code.",
};
