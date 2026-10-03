import { createServer } from "node:http";
import { randomBytes, createHash } from "node:crypto";
import { writeFile, rename } from "node:fs/promises";
import { configPath, loadConfig } from "./helper.mjs";

const config = await loadConfig();
const issuer = new URL(config.issuer);
if (
  issuer.protocol !== "https:" ||
  issuer.pathname !== "/" ||
  issuer.search ||
  issuer.hash ||
  issuer.username ||
  issuer.password ||
  !config.clientId
)
  throw new Error(
    "Configure an HTTPS WorkOS issuer and a registered public OAuth client first.",
  );
const verifier = randomBytes(32).toString("base64url"),
  state = randomBytes(32).toString("hex");
const callback = createServer();
await new Promise((resolve) => callback.listen(47831, "127.0.0.1", resolve));
const redirect = "http://127.0.0.1:47831/callback";
const url = new URL("/oauth2/authorize", issuer);
url.search = new URLSearchParams({
  response_type: "code",
  client_id: config.clientId,
  redirect_uri: redirect,
  scope: "openid profile email",
  resource: config.origin + "/api/probe/mcp",
  code_challenge: createHash("sha256").update(verifier).digest("base64url"),
  code_challenge_method: "S256",
  state,
}).toString();
const timer = setTimeout(() => {
  callback.close();
  process.exitCode = 1;
}, 10 * 60_000);
callback.on("request", async (req, res) => {
  const received = new URL(req.url, "http://127.0.0.1:47831");
  if (
    req.method !== "GET" ||
    received.pathname !== "/callback" ||
    received.searchParams.get("state") !== state ||
    !received.searchParams.get("code") ||
    (received.searchParams.has("iss") &&
      received.searchParams.get("iss") !== issuer.origin)
  ) {
    res.writeHead(400);
    res.end("Invalid authorization callback");
    return;
  }
  try {
    const response = await fetch(new URL("/oauth2/token", issuer), {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: config.clientId,
        redirect_uri: redirect,
        code: received.searchParams.get("code"),
        code_verifier: verifier,
        resource: config.origin + "/api/probe/mcp",
      }),
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error("Token exchange failed");
    const token = await response.json();
    if (
      typeof token.access_token !== "string" ||
      !token.access_token ||
      !Number.isFinite(token.expires_in) ||
      token.expires_in <= 0
    )
      throw new Error("Invalid response");
    delete config.agentConnectionId;
    delete config.agentConnectionSecret;
    const temp = configPath + "." + randomBytes(8).toString("hex");
    await writeFile(
      temp,
      JSON.stringify({
        ...config,
        accessToken: token.access_token,
        expiresAt: Date.now() + token.expires_in * 1000,
      }),
      { mode: 0o600, flag: "wx" },
    );
    await rename(temp, configPath);
    res.end("Scope helper signed in. You can close this page.");
    console.log("Scope helper signed in; credential saved privately.");
  } catch {
    res.writeHead(400);
    res.end("Authorization failed. Check WorkOS setup and retry.");
    process.exitCode = 1;
  } finally {
    clearTimeout(timer);
    callback.close();
  }
});
console.log(
  "Open this URL to sign in to the local Scope helper:\n" + url.toString(),
);
