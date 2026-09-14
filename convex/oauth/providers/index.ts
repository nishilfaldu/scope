import type { ProviderId } from "../../permissions";
import type { ProviderOAuth } from "../types";
import { github } from "./github";
import { google } from "./google";
import { slack } from "./slack";

export const PROVIDER_OAUTH: Record<ProviderId, ProviderOAuth> = {
  github,
  google,
  slack,
};
