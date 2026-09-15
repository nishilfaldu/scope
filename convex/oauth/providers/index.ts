import type { ProviderId } from "../../domain/apps";
import type { ProviderOAuth } from "../types";
import { github } from "./github";
import { google } from "./google";
import { slack } from "./slack";
import { zoom } from "./zoom";

export const PROVIDER_OAUTH: Record<ProviderId, ProviderOAuth> = {
  github,
  google,
  slack,
  zoom,
};
