import { mkdir, writeFile, rename } from "node:fs/promises";
import { dirname } from "node:path";
import { randomBytes } from "node:crypto";
import { setTimeout as delay } from "node:timers/promises";
import { configPath } from "../plugins/scope-local/helper.mjs";

process.loadEnvFile(".env.local");
const site = process.env.NEXT_PUBLIC_CONVEX_SITE_URL;
const origin = process.env.SCOPE_PROBE_ORIGIN;
if (!site || !origin || !process.env.CONVEX_DEPLOYMENT?.startsWith("dev:"))
  throw new Error("Development setup required");
async function post(path, body) {
  const r = await fetch(site + path, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    redirect: "error",
  });
  if (!r.ok) throw new Error("Scope pairing request failed");
  return { status: r.status, body: await r.json() };
}
try {
  const { body: invite } = await post("/api/agent-connections", {
    agentName: "Scope local Airtable prototype",
  });
  console.log(
    JSON.stringify({
      approvalUrl: origin + new URL(invite.connectUrl).pathname,
      expiresAt: invite.approvalDeadlineAt,
    }),
  );
  while (Date.now() < invite.approvalDeadlineAt) {
    const { status, body } = await post("/api/agent-connections/claim", {
      claimHandle: invite.claimHandle,
    });
    if (status === 202) {
      await delay(1500);
      continue;
    }
    if (!body.agentConnectionId || !body.agentConnectionSecret)
      throw new Error("Incomplete pairing");
    await mkdir(dirname(configPath), { recursive: true, mode: 0o700 });
    const temp = configPath + "." + randomBytes(8).toString("hex");
    await writeFile(
      temp,
      JSON.stringify({
        origin,
        agentConnectionId: body.agentConnectionId,
        agentConnectionSecret: body.agentConnectionSecret,
        accessToken: `scope-agent.${body.agentConnectionId}.${body.agentConnectionSecret}`,
      }),
      { flag: "wx", mode: 0o600 },
    );
    await rename(temp, configPath);
    await post("/api/agent-connections/ack", {
      claimHandle: invite.claimHandle,
      agentConnectionSecret: body.agentConnectionSecret,
    });
    console.log(
      JSON.stringify({
        paired: true,
        authentication: "existing Scope agent connection",
        configSavedPrivately: true,
      }),
    );
    process.exit(0);
  }
  throw new Error("Pairing expired");
} catch {
  console.error("Pairing did not complete; no credentials were printed.");
  process.exitCode = 1;
}
