// @vitest-environment node
import { expect, test, vi } from "vitest";
import { childEnvironment, executeCommand, runApproved } from "../cli/run.mjs";

const command = { argv: ["node", "script.mjs"], envVar: "SLACK_TOKEN" };

test("the child gets the token and a small environment only", () => {
  const env = childEnvironment("SLACK_TOKEN", "xoxp-1", {
    PATH: "/bin",
    HOME: "/home/me",
    SCOPE_CONFIG: "/secret",
    AWS_SECRET_ACCESS_KEY: "secret",
  });
  expect(env).toEqual({
    PATH: "/bin",
    HOME: "/home/me",
    SLACK_TOKEN: "xoxp-1",
  });
  for (const name of ["PATH", "SCOPE_TOKEN", "NODE_OPTIONS", "lower"])
    expect(() => childEnvironment(name, "x")).toThrow();
});

test("run asks, waits for approval, then executes with the token", async () => {
  const statuses = ["pending", "approved"];
  const call = vi.fn(async (operation: string) => {
    if (operation === "request")
      return { id: "a1", status: "pending", approvalUrl: "http://x/requests" };
    if (operation === "status") return { status: statuses.shift() };
    return { accessToken: "xoxp-1", expiresAt: Date.now() + 60_000 };
  });
  const execute = vi.fn(async () => ({ exitCode: 0 }));
  const output = vi.fn();
  const result = await runApproved(
    { providerId: "slack", reason: "Read channels", command, timeoutMs: 1000 },
    { call, execute, output, wait: async () => undefined },
  );
  expect(result).toEqual({ exitCode: 0 });
  expect(output).toHaveBeenCalledWith("Approve in Scope: http://x/requests");
  expect(call.mock.calls.map(([operation]) => operation)).toEqual([
    "request",
    "status",
    "status",
    "token",
  ]);
  expect(execute).toHaveBeenCalledWith(command, "xoxp-1", expect.anything());
});

test("a denied request never executes", async () => {
  const execute = vi.fn();
  await expect(
    runApproved(
      { providerId: "slack", reason: "Read", command, timeoutMs: 1000 },
      {
        call: async (operation: string) =>
          operation === "request"
            ? { id: "a1", status: "pending" }
            : { status: "denied" },
        execute,
        output: () => undefined,
        wait: async () => undefined,
      },
    ),
  ).rejects.toThrow("Request denied.");
  expect(execute).not.toHaveBeenCalled();
});

test("commands time out with exit code 124", async () => {
  const result = await executeCommand(
    {
      argv: [process.execPath, "-e", "setTimeout(() => {}, 10000)"],
      envVar: "SLACK_TOKEN",
    },
    "xoxp-1",
    { timeoutMs: 200 },
  );
  expect(result).toEqual({ exitCode: 124, reason: "timeout" });
});
