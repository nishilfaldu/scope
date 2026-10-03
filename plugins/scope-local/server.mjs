import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { listBases, listChannels, scopeCall } from "./helper.mjs";
const server = new McpServer({ name: "scope-local", version: "0.2.0" });
const safe = (action) => async (args, extra) => {
  try {
    return {
      content: [
        {
          type: "text",
          text: JSON.stringify(await action(args, { signal: extra.signal })),
        },
      ],
    };
  } catch {
    return {
      isError: true,
      content: [
        {
          type: "text",
          text: "Scope request failed. Check sign-in or account setup and retry the same request.",
        },
      ],
    };
  }
};
server.registerTool(
  "list_accounts",
  {
    description: "List your available Scope account authorizations.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  safe((_args, options) => scopeCall("accounts", {}, options)),
);
server.registerTool(
  "list_collectors",
  {
    description:
      "List authorized local helpers that can privately receive access.",
    inputSchema: {},
    annotations: { readOnlyHint: true },
  },
  safe((_args, options) => scopeCall("collectors", {}, options)),
);
const inputSchema = {
  accountId: z.string().min(1).max(128),
  reason: z.string().min(1).max(1000),
  key: z
    .string()
    .regex(/^[\w-]{16,128}$/)
    .optional(),
  requestId: z
    .string()
    .regex(/^[\w-]{1,128}$/)
    .optional(),
  waitSeconds: z.number().int().min(0).max(240).default(90),
};
server.registerTool(
  "airtable_list_bases",
  {
    description:
      "List granted Airtable bases after Scope approval. Reuse key on retries, or supply the exact hosted requestId with intent 'List the available Airtable bases'. Credentials stay private.",
    inputSchema,
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  safe(listBases),
);
server.registerTool(
  "slack_list_channels",
  {
    description:
      "List public Slack channels after Scope approval. Reuse key on retries, or supply the exact hosted requestId with intent 'List public Slack channels'. Credentials stay private.",
    inputSchema,
    annotations: { readOnlyHint: true, openWorldHint: true },
  },
  safe(listChannels),
);
await server.connect(new StdioServerTransport());
