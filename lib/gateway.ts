import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { ConvexHttpClient } from "convex/browser";
import { ConvexError } from "convex/values";
import { api } from "@/convex/_generated/api";
import { tokenFor } from "@/lib/connect";
import { db, scopeOrigin } from "@/lib/scope-server";
import { ToolFailure, type ToolImplementation } from "@/lib/tools/types";
import { slackTools } from "@/lib/tools/slack";
import { providerName } from "@/shared/connectors";
import { toolFor } from "@/shared/tools";

const implementations: ToolImplementation[] = [...slackTools];

// MCP clients usually time out a tool call after about a minute.
const approvalWaitMs = 25_000,
  pollMs = 1_500;

export const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "Authorization, Content-Type, Mcp-Protocol-Version, Mcp-Session-Id",
  "Access-Control-Expose-Headers": "WWW-Authenticate, Mcp-Session-Id",
};

export function mcpResource() {
  return `${scopeOrigin()}/mcp`;
}

function unauthorized() {
  return Response.json(
    { error: "Sign in to Scope to use this MCP server." },
    {
      status: 401,
      headers: {
        ...corsHeaders,
        "WWW-Authenticate": [
          'Bearer error="invalid_token"',
          'error_description="Sign in to Scope"',
          `resource_metadata="${scopeOrigin()}/.well-known/oauth-protected-resource"`,
        ].join(", "),
      },
    },
  );
}

function text(value: string, isError = false): CallToolResult {
  return { content: [{ type: "text", text: value }], isError };
}

async function argsHash(input: unknown) {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(canonical(input)),
  );
  return Array.from(new Uint8Array(digest), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value && typeof value === "object")
    return `{${Object.keys(value)
      .sort()
      .filter((k) => (value as Record<string, unknown>)[k] !== undefined)
      .map(
        (k) =>
          `${JSON.stringify(k)}:${canonical((value as Record<string, unknown>)[k])}`,
      )
      .join(",")}}`;
  return JSON.stringify(value);
}

async function waitForDecision(client: ConvexHttpClient, id: string) {
  const deadline = Date.now() + approvalWaitMs;
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, pollMs));
    const status = await client.query(api.gateway.approvalStatus, {
      id: id as never,
    });
    if (status !== "pending") return status;
  }
  return "pending";
}

async function callTool(
  client: ConvexHttpClient,
  tool: ToolImplementation,
  input: unknown,
): Promise<CallToolResult> {
  const info = toolFor(tool.name)!,
    provider = providerName(info.providerId);
  const request: { tool: string; argsHash: string; summary?: string } = {
    tool: tool.name,
    argsHash: await argsHash(input),
  };
  let result = await client.mutation(api.gateway.authorize, request);
  if (result.decision === "describe") {
    const token = await tokenFor(result.account).catch(() => "");
    request.summary = await tool.summary(input as never, token);
    result = await client.mutation(api.gateway.authorize, request);
  }
  if (result.decision === "waiting") {
    const status = await waitForDecision(client, result.approvalId);
    if (status === "approved")
      result = await client.mutation(api.gateway.authorize, request);
    else if (status === "denied") result = { decision: "denied" };
  }
  switch (result.decision) {
    case "describe":
      return text(`Scope could not describe "${info.title}".`, true);
    case "waiting":
      return text(
        `Waiting for the user to approve "${info.title}" in Scope. They got a notification. Tell the user, then call this tool again with the same arguments after they approve.`,
      );
    case "busy":
      return text(
        "Several requests are already waiting for the user's approval in Scope. Wait for them before asking again.",
        true,
      );
    case "denied":
      return text(`The user denied "${info.title}" in Scope.`, true);
    case "blocked":
      return text(`The user blocked "${info.title}" for this app.`, true);
    case "no-account":
      return text(
        `No ${provider} account is connected. Ask the user to connect one at ${scopeOrigin()}/accounts.`,
        true,
      );
  }
  try {
    const output = await tool.run(
      await tokenFor(result.account),
      input as never,
    );
    await client.mutation(api.gateway.finish, {
      callId: result.callId,
      outcome: "ok",
    });
    return text(JSON.stringify(output));
  } catch (error) {
    await client
      .mutation(api.gateway.finish, {
        callId: result.callId,
        outcome: "failed",
      })
      .catch(() => undefined);
    return text(
      error instanceof ToolFailure
        ? error.message
        : `${provider} call failed. The account may need to be reconnected in Scope.`,
      true,
    );
  }
}

// Stateless streamable HTTP: one server per request.
export async function handleMcp(request: Request) {
  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer ([^\s]+)$/)?.[1];
  if (!token) return unauthorized();
  const client = db();
  client.setAuth(token);
  let visible: string[];
  try {
    visible = await client.query(api.gateway.visibleTools, {});
  } catch (error) {
    if (error instanceof ConvexError && error.data === "client-revoked")
      return Response.json(
        { error: "This app was revoked in Scope." },
        { status: 403, headers: corsHeaders },
      );
    return unauthorized();
  }
  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return Response.json(
      {
        jsonrpc: "2.0",
        error: { code: -32700, message: "Parse error" },
        id: null,
      },
      { status: 400, headers: corsHeaders },
    );
  }
  const init = (Array.isArray(body) ? body : [body]).find(
    (m) => m?.method === "initialize",
  );
  const info = init?.params?.clientInfo,
    name = info?.title || info?.name;
  if (init)
    await client
      .mutation(api.gateway.hello, {
        name: typeof name === "string" ? name : "",
      })
      .catch(() => undefined);

  const server = new McpServer({ name: "Scope", version: "0.1.0" });
  for (const tool of implementations) {
    const info = toolFor(tool.name);
    if (!info || !visible.includes(tool.name)) continue;
    server.registerTool(
      tool.name,
      {
        title: info.title,
        description: tool.description,
        inputSchema: tool.inputSchema,
        annotations: {
          title: info.title,
          readOnlyHint: info.readOnly,
          destructiveHint: !info.readOnly,
          openWorldHint: true,
        },
      },
      (input: unknown) => callTool(client, tool, input),
    );
  }
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });
  await server.connect(transport);
  const response = await transport.handleRequest(request, { parsedBody: body });
  for (const [key, value] of Object.entries(corsHeaders))
    response.headers.set(key, value);
  return response;
}
