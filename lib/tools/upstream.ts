import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import type { ZodRawShape } from "zod";
import { ToolFailure, type ToolImplementation } from "./types";

// A tool on a provider's official MCP server. Scope keeps its own schema for
// each one, so only these arguments reach the provider, and its own read-only
// flag in shared/tools.ts.
export function proxy(
  server: string,
  prefix: string,
  upstreamName = (name: string) => name,
) {
  return <Input>(
    name: string,
    description: string,
    inputSchema: ZodRawShape,
    summary: (input: Input, token: string) => string | Promise<string>,
  ): ToolImplementation => ({
    name: `${prefix}_${name}`,
    description,
    inputSchema,
    summary: summary as (input: never, token: string) => string,
    run: (token, input: Record<string, unknown>) =>
      callUpstream(server, token, upstreamName(name), input),
  });
}

const maxText = 100_000;

// Calls one tool on a provider's official MCP server with the person's token.
// Only text content is returned; other content types are dropped.
export async function callUpstream(
  url: string,
  token: string,
  name: string,
  args: Record<string, unknown>,
) {
  const client = new Client({ name: "Scope", version: "0.1.0" });
  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
    fetch: (input, init) =>
      fetch(input, {
        ...init,
        redirect: "error",
        signal: AbortSignal.timeout(30_000),
      }),
  });
  try {
    await client.connect(transport);
    const result = await client.callTool({ name, arguments: args });
    const text = (Array.isArray(result.content) ? result.content : [])
      .flatMap((part) =>
        part?.type === "text" && typeof part.text === "string"
          ? [part.text]
          : [],
      )
      .join("\n");
    const trimmed =
      text.length > maxText
        ? `${text.slice(0, maxText)}\n[Scope cut the result at ${maxText} characters.]`
        : text;
    if (result.isError) throw new ToolFailure(trimmed.slice(0, 2000));
    return trimmed;
  } finally {
    await client.close().catch(() => undefined);
  }
}
