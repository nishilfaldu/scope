import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { z } from "zod";
import type { Id } from "@/convex/_generated/dataModel";
import { clientActor, scopeOrigin } from "@/lib/scope-server";
import {
  ensureConnection,
  listAccounts,
  listCollectors,
  requestAccess,
  requestStatus,
  waitForDecision,
} from "@/lib/approval-service";
export const runtime = "nodejs";
export const maxDuration = 300;
const result = (value: unknown) => ({
  content: [{ type: "text" as const, text: JSON.stringify(value) }],
});
export async function POST(request: Request) {
  let actor;
  try {
    actor = await clientActor(request);
    await ensureConnection(actor);
  } catch {
    return new Response(null, {
      status: 401,
      headers: {
        "WWW-Authenticate": `Bearer resource_metadata="${scopeOrigin()}/.well-known/oauth-protected-resource/api/mcp"`,
      },
    });
  }
  if (
    request.headers.has("origin") &&
    request.headers.get("origin") !== scopeOrigin()
  )
    return new Response(null, { status: 403 });
  const server = new McpServer({ name: "scope", version: "0.2.0" });
  const guarded = <T>(work: () => Promise<T>) =>
    work()
      .then(result)
      .catch(() => ({
        isError: true,
        content: [
          {
            type: "text" as const,
            text: "Request unavailable. Check sign-in and account setup, then retry with the same key.",
          },
        ],
      }));
  server.registerTool(
    "list_accounts",
    {
      description:
        "List connected accounts available for human-approved access.",
      inputSchema: {},
    },
    async () => guarded(() => listAccounts(actor)),
  );
  server.registerTool(
    "list_collectors",
    {
      description:
        "List your signed-in local helpers eligible to privately receive approved access.",
      inputSchema: {},
    },
    async () => guarded(() => listCollectors(actor)),
  );
  server.registerTool(
    "request_access",
    {
      description:
        "Ask the owner to approve access to one account for a designated local helper. Reuse the same key on retry. Returns approval state and link, never provider credentials. Intent explains the task; the fixed access profile governs permissions.",
      inputSchema: {
        accountId: z.string(),
        key: z.string().min(16).max(128),
        reason: z.string().trim().min(1).max(1000),
        intent: z.string().trim().min(1).max(240).optional(),
        collectorConnectionId: z.string().optional(),
        waitSeconds: z.number().int().min(0).max(240).default(90),
      },
    },
    async (args, extra) =>
      guarded(async () => {
        const created = await requestAccess(actor, {
          accountId: args.accountId as Id<"connectedAccounts">,
          key: args.key,
          reason: args.reason,
          intent: args.intent,
          collectorConnectionId: args.collectorConnectionId as
            Id<"clientConnections"> | undefined,
        });
        return {
          ...(await waitForDecision(
            actor,
            created.id,
            args.waitSeconds,
            extra.signal,
          )),
          approvalUrl: created.approvalUrl,
          retryKey: args.key,
        };
      }),
  );
  server.registerTool(
    "get_request_status",
    {
      description:
        "Read approval state for a request you created or are assigned to collect. Does not collect access or report completed provider work.",
      inputSchema: { requestId: z.string() },
    },
    async (args) =>
      guarded(() =>
        requestStatus(actor, args.requestId as Id<"approvalRequests">),
      ),
  );
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  return transport.handleRequest(request);
}
