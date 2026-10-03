import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { config, db, requester } from "@/lib/probe-server";
import { notifyApproval } from "@/lib/probe-push";

export const runtime = "nodejs";
export const maxDuration = 300;
export async function POST(request: Request) {
  let actor;
  try {
    actor = await requester(request);
  } catch {
    return new Response(null, {
      status: 401,
      headers: {
        "WWW-Authenticate": `Bearer resource_metadata="${config("SCOPE_PROBE_ORIGIN")}/.well-known/oauth-protected-resource/api/probe/mcp"`,
      },
    });
  }
  if (
    request.headers.get("origin") &&
    request.headers.get("origin") !== config("SCOPE_PROBE_ORIGIN")
  )
    return new Response(null, { status: 403 });
  const server = new McpServer({
    name: "scope-approval-probe",
    version: "0.1.0",
  });
  server.registerTool(
    "request_approval",
    {
      description:
        "Request approval for an Airtable account. Reuse the same key on retry. Returns status only; provider credentials are available solely through the private local helper.",
      inputSchema: {
        accountId: z.string(),
        key: z.string().min(16).max(128),
        reason: z.string().min(1).max(1000),
        waitSeconds: z.number().int().min(0).max(240).default(90),
      },
    },
    async (args, extra) => {
      try {
        const created = await db().mutation(api.probe.request, {
          ...actor,
          key: args.key,
          accountId: args.accountId as Id<"probeAccounts">,
          reason: args.reason,
        });
        if (created.created) await notifyApproval(actor.userId);
        const until = Date.now() + args.waitSeconds * 1000;
        let status: string = created.status;
        while (Date.now() < until && !extra.signal.aborted) {
          const c = await db().query(api.probe.agentStatus, {
            ...actor,
            id: created.id,
          });
          status = c.revoked
            ? "revoked"
            : c.expiresAt <= Date.now()
              ? "expired"
              : c.status;
          if (!["pending", "acquiring"].includes(status)) break;
          await new Promise((r) => setTimeout(r, 1000));
        }
        return {
          content: [
            {
              type: "text",
              text: JSON.stringify({
                requestId: created.id,
                status,
                approvalUrl: config("SCOPE_PROBE_ORIGIN") + "/lab",
                retryKey: args.key,
              }),
            },
          ],
        };
      } catch {
        return {
          isError: true,
          content: [
            {
              type: "text",
              text: "Approval unavailable. Retry with the same key after checking account setup.",
            },
          ],
        };
      }
    },
  );
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(request);
}
