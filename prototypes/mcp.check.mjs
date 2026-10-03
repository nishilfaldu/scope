import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

test(
  "installed stdio helper waits 90 seconds, survives a caller timeout, and retries the same request",
  { timeout: 120_000 },
  async () => {
    const requests = new Map();
    const server = createServer(async (req, res) => {
      let raw = "";
      for await (const chunk of req) raw += chunk;
      const body = JSON.parse(raw || "{}");
      if (req.headers.authorization !== "Bearer synthetic-probe-auth") {
        res.writeHead(401);
        res.end();
        return;
      }
      res.setHeader("Content-Type", "application/json");
      if (req.url === "/api/probe/request") {
        if (!requests.has(body.key))
          requests.set(body.key, { id: body.key, status: "pending" });
        res.end(JSON.stringify(requests.get(body.key)));
        return;
      }
      if (req.url === "/approve") {
        requests.get(body.id).status = "approved";
        res.end("{}");
        return;
      }
      if (req.url === "/api/probe/deliver") {
        res.end(JSON.stringify(requests.get(body.id)));
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise((r) => server.listen(0, "127.0.0.1", r));
    const origin = `http://127.0.0.1:${server.address().port}`;
    const temp = await mkdtemp(join(tmpdir(), "scope-mcp-probe-"));
    const file = join(temp, "config.json");
    await writeFile(
      file,
      JSON.stringify({ origin, accessToken: "synthetic-probe-auth" }),
      { mode: 0o600 },
    );
    const clients = [];
    const started = Date.now();
    async function client() {
      const c = new Client({ name: "scope-wire-test", version: "1.0.0" });
      const transport = new StdioClientTransport({
        command: process.execPath,
        args: [
          resolve(
            process.env.SCOPE_INSTALLED_HELPER ??
              "plugins/scope-local/server.mjs",
          ),
        ],
        env: { SCOPE_PROBE_CONFIG: file },
        stderr: "pipe",
      });
      let stderr = "";
      transport.stderr?.on("data", (b) => (stderr += b));
      await c.connect(transport);
      clients.push({ c, transport, getStderr: () => stderr });
      return c;
    }
    async function approve(id) {
      await fetch(origin + "/approve", {
        method: "POST",
        headers: {
          Authorization: "Bearer synthetic-probe-auth",
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ id }),
      });
    }
    const call = (c, key, timeout) =>
      c.callTool(
        {
          name: "airtable_list_bases",
          arguments: {
            accountId: "dummy-account",
            reason: "Wait probe",
            key,
            waitSeconds: 110,
          },
        },
        undefined,
        { timeout },
      );
    try {
      const early = await client(),
        long = await client(),
        retry = await client();
      const catalog = await early.listTools();
      assert.equal(catalog.tools[0].name, "airtable_list_bases");
      const pEarly = call(early, "probe-after-10-seconds", 60_000);
      const pLong = call(long, "probe-after-90-seconds", 110_000);
      const pRetry = call(retry, "probe-retry-same-key-90", 60_000).then(
        () => {
          throw new Error("Expected timeout");
        },
        () => true,
      );
      await delay(10_000);
      await approve("probe-after-10-seconds");
      assert.equal(
        JSON.parse((await pEarly).content[0].text).status,
        "approved",
      );
      await delay(Math.max(0, 90_000 - (Date.now() - started)));
      await approve("probe-after-90-seconds");
      await approve("probe-retry-same-key-90");
      assert.equal(await pRetry, true);
      assert.equal(
        JSON.parse((await pLong).content[0].text).status,
        "approved",
      );
      const recovered = await call(retry, "probe-retry-same-key-90", 10_000);
      assert.equal(
        JSON.parse(recovered.content[0].text).requestId,
        "probe-retry-same-key-90",
      );
      assert.equal(requests.size, 3);
      for (const item of clients)
        assert.ok(!item.getStderr().includes("synthetic-probe-auth"));
    } finally {
      await Promise.all(clients.map(({ c }) => c.close()));
      await new Promise((r) => server.close(r));
      await rm(temp, { recursive: true, force: true });
    }
  },
);
