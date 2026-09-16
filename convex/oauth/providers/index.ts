import type { ProviderId } from "../../domain/apps";
import type { ProviderOAuth } from "../types";
import { github } from "./github";
import { google } from "./google";
import { slack } from "./slack";
import { airtable } from "./airtable";
import { notion } from "./notion";
import { linear } from "./linear";
import { vercel } from "./vercel";
import { zoom } from "./zoom";
import { outlook } from "./outlook";

export const PROVIDER_OAUTH: Record<ProviderId, ProviderOAuth> = {
  github,
  google,
  slack,
  airtable,
  notion,
  linear,
  vercel,
  zoom,
  outlook,
};
