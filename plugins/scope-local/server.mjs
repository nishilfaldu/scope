import { createInterface } from "node:readline";
import { listBases } from "./helper.mjs";

const calls = new Map();
const reply = (id, result) =>
  process.stdout.write(JSON.stringify({ jsonrpc: "2.0", id, result }) + "\n");
const failure = (id) =>
  reply(id, {
    isError: true,
    content: [
      {
        type: "text",
        text: "Scope request failed. Check sign-in or account setup and retry with the same key.",
      },
    ],
  });
async function handle(message) {
  const { id, method, params } = message;
  if (method === "notifications/cancelled") {
    calls.get(params?.requestId)?.abort();
    return;
  }
  if (id === undefined) return;
  if (method === "initialize")
    return reply(id, {
      protocolVersion: "2025-11-25",
      capabilities: { tools: {} },
      serverInfo: { name: "scope-local", version: "0.1.0" },
    });
  if (method === "ping") return reply(id, {});
  if (method === "tools/list")
    return reply(id, {
      tools: [
        {
          name: "airtable_list_bases",
          description:
            "Read Airtable bases locally after Scope phone approval. Reuse the same key when retrying; credentials never appear in tool results.",
          inputSchema: {
            type: "object",
            properties: {
              accountId: { type: "string" },
              reason: { type: "string" },
              key: { type: "string", minLength: 16, maxLength: 128 },
              waitSeconds: {
                type: "integer",
                minimum: 0,
                maximum: 240,
                default: 90,
              },
            },
            required: ["accountId", "reason", "key"],
            additionalProperties: false,
          },
          annotations: { readOnlyHint: true, openWorldHint: true },
        },
      ],
    });
  if (method === "tools/call" && params?.name === "airtable_list_bases") {
    const controller = new AbortController();
    calls.set(id, controller);
    try {
      const result = await listBases(params.arguments, {
        signal: controller.signal,
      });
      reply(id, { content: [{ type: "text", text: JSON.stringify(result) }] });
    } catch {
      failure(id);
    } finally {
      calls.delete(id);
    }
    return;
  }
  process.stdout.write(
    JSON.stringify({
      jsonrpc: "2.0",
      id,
      error: { code: -32601, message: "Method not found" },
    }) + "\n",
  );
}
const lines = createInterface({ input: process.stdin });
lines.on("line", (line) => {
  if (line.length > 16_384) return;
  try {
    void handle(JSON.parse(line)).catch(() => {});
  } catch {
    process.stdout.write(
      JSON.stringify({
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "Parse error" },
      }) + "\n",
    );
  }
});
lines.on("close", () => {
  for (const call of calls.values()) call.abort();
});
