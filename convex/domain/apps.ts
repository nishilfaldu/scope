import { v } from "convex/values";

export const ALL_APPS = ["slack"] as const;
export type AppId = (typeof ALL_APPS)[number];
export const appValidator = v.literal("slack");

export function isAppId(value: string): value is AppId {
  return value === "slack";
}
