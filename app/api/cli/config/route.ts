import { config, json, scopeOrigin } from "@/lib/scope-server";
export function GET() {
  return json({
    origin: scopeOrigin(),
    webClientId: config("WORKOS_CLIENT_ID"),
    clientId: config("SCOPE_CLI_CLIENT_ID"),
    authkitDomain: config("WORKOS_AUTHKIT_DOMAIN"),
  });
}
