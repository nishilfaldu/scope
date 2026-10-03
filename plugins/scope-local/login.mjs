import { createServer } from "node:http";
import { auth } from "@modelcontextprotocol/sdk/client/auth.js";
import {
  loadConfig,
  oauthProvider,
  oauthFetch,
  oauthScope,
  redirectUrl,
  withConfigLock,
} from "./oauth.mjs";
let timer;
try {
  await withConfigLock(async () => {
    const config = await loadConfig();
    delete config.tokens;
    delete config.expiresAt;
    let expectedState;
    const provider = oauthProvider(config, (url) => {
      if (url.origin !== config.issuer)
        throw new Error("Unexpected authorization issuer");
      expectedState = url.searchParams.get("state");
      console.log(
        "Open this URL to sign in to the Scope helper:\n" + url.toString(),
      );
    });
    const callback = createServer();
    await new Promise((resolve, reject) => {
      callback.once("error", reject);
      callback.listen(47831, "127.0.0.1", resolve);
    });
    try {
      const completed = new Promise((resolve, reject) => {
        timer = setTimeout(
          () => reject(new Error("Authorization timed out")),
          10 * 60_000,
        );
        callback.on("request", async (req, res) => {
          const received = new URL(req.url, redirectUrl);
          if (
            req.method !== "GET" ||
            received.pathname !== "/callback" ||
            !expectedState ||
            received.searchParams.get("state") !== expectedState ||
            !received.searchParams.get("code") ||
            received.searchParams.has("error") ||
            (received.searchParams.has("iss") &&
              received.searchParams.get("iss") !== config.issuer)
          ) {
            res.writeHead(400);
            res.end("Invalid authorization callback");
            return;
          }
          expectedState = undefined;
          try {
            const result = await auth(provider, {
              serverUrl: config.origin + "/api/mcp",
              authorizationCode: received.searchParams.get("code"),
              scope: oauthScope,
              fetchFn: oauthFetch(config),
            });
            if (result !== "AUTHORIZED")
              throw new Error("Authorization failed");
            res.end("Scope helper signed in. You can close this page.");
            console.log("Scope helper signed in; session saved privately.");
            resolve();
          } catch {
            res.writeHead(400);
            res.end("Authorization failed. Start sign-in again.");
            reject(new Error("Scope sign-in failed"));
          } finally {
            clearTimeout(timer);
          }
        });
      });
      completed.catch(() => {});
      await auth(provider, {
        serverUrl: config.origin + "/api/mcp",
        scope: oauthScope,
        fetchFn: oauthFetch(config),
      });
      await completed;
    } finally {
      clearTimeout(timer);
      callback.close();
    }
  });
} catch {
  console.error(
    "Scope sign-in failed. Check configuration and start sign-in again.",
  );
  process.exitCode = 1;
}
